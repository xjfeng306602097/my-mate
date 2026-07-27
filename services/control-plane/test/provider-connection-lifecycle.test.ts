import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentBindingSnapshot,
  createAgentRun,
  getPublishedAgentVersion,
  upsertAgentDefinition,
} from "../src/agent-runtime-store.js";
import {
  deleteProviderConnection,
  inspectProviderConnectionReferences,
  migrateProviderConnectionReferences,
  ProviderConnectionLifecycleError,
} from "../src/provider-connection-lifecycle.js";
import {
  disableProviderConnection,
  getProviderConnection,
  recordProviderConnectionVerification,
  upsertProviderConnection,
} from "../src/provider-connection-store.js";
import { getManagedProviderCredential } from "../src/provider-secret-store.js";
import { createSession, getSession } from "../src/session-store.js";
import { getTemplate } from "../src/template-store.js";
import { createUserSchedule, getUserSchedule } from "../src/user-schedule-store.js";
import { buildPublishedTemplate, getJson, resetTestRoot, seedTemplate, startTestServer } from "./helpers.js";

function createConnection(input: {
  id: string;
  model: string;
  verified?: boolean;
  status?: "active" | "disabled";
}) {
  const connection = upsertProviderConnection({
    connection_id: input.id,
    name: input.id,
    agent_runtime: "glm",
    provider: "test-provider",
    protocol: "openai-compatible",
    base_url: "https://provider.example/v1",
    models: [input.model],
    default_model: input.model,
    api_key: `${input.id}-secret`,
    status: input.status || "active",
  });
  if (input.verified !== false) {
    return recordProviderConnectionVerification(connection.connection_id, {
      status: "verified",
      tested_at: new Date().toISOString(),
      detail: "Verified by lifecycle test.",
      duration_ms: 1,
      model: input.model,
    });
  }
  return connection;
}

test("disabled Provider Connection migrates live bindings before deleting its credential and record", () => {
  resetTestRoot();
  const source = createConnection({ id: "lifecycle-source", model: "source-model" });
  const target = createConnection({ id: "lifecycle-target", model: "target-model" });
  const agent = upsertAgentDefinition({
    workspaceId: "default",
    agentId: "lifecycle-agent",
    name: "Lifecycle Agent",
    createdBy: "test",
    version: {
      role: "specialist",
      model_policy: {
        deployment_id: null,
        provider_connection_id: source.connection_id,
        model: "source-model",
        allow_runtime_override: false,
      },
    },
  });
  const session = createSession({
    title: "Lifecycle Session",
    provider_connection_id: source.connection_id,
    model: "source-model",
    agent_id: agent.definition.agent_id,
    agent_version: agent.version.version,
  });
  const schedule = createUserSchedule({
    workspaceId: "default",
    name: "Lifecycle Schedule",
    prompt: "Run the lifecycle check.",
    providerConnectionId: source.connection_id,
    model: "source-model",
    agentId: agent.definition.agent_id,
    agentVersion: agent.version.version,
    timezone: "UTC",
    recurrence: { kind: "interval", interval_minutes: 60 },
    enabled: false,
    createdBy: "test",
  });
  const binding = createAgentBindingSnapshot({
    workspaceId: "default",
    agentId: agent.definition.agent_id,
    agentVersion: agent.version.version,
    providerConnectionId: source.connection_id,
    model: "source-model",
  });
  const template = buildPublishedTemplate({
    template_id: "lifecycle-template",
    name: "Lifecycle Template",
    nodes: [{
      ...buildPublishedTemplate().nodes[0],
      agent_profile: agent.definition.agent_id,
      agent_id: agent.definition.agent_id,
      agent_version: agent.version.version,
      agent_binding_snapshot: binding,
    }],
  });
  seedTemplate(template);

  const initial = inspectProviderConnectionReferences(source.connection_id);
  assert.equal(initial.connection_status, "active");
  assert.equal(initial.migratable_count, 4);
  assert.deepEqual(
    new Set(initial.references.map((item) => item.kind)),
    new Set(["agent", "session", "schedule", "workflow_template"]),
  );
  assert.equal(initial.can_delete, false);

  assert.throws(
    () => migrateProviderConnectionReferences({
      sourceConnectionId: source.connection_id,
      targetConnectionId: target.connection_id,
    }),
    (error: unknown) => error instanceof ProviderConnectionLifecycleError
      && error.code === "provider_connection_must_be_disabled",
  );

  disableProviderConnection(source.connection_id);
  const migrated = migrateProviderConnectionReferences({
    sourceConnectionId: source.connection_id,
    targetConnectionId: target.connection_id,
    targetModel: "target-model",
    actorId: "test",
  });
  assert.deepEqual({
    agents: migrated.migrated_agents,
    sessions: migrated.migrated_sessions,
    schedules: migrated.migrated_schedules,
    templates: migrated.migrated_workflow_templates,
  }, { agents: 1, sessions: 1, schedules: 1, templates: 1 });
  assert.equal(migrated.remaining.can_delete, true);
  assert.equal(migrated.remaining.migratable_count, 0);

  const latestAgent = getPublishedAgentVersion(agent.definition.agent_id, "default");
  assert.equal(latestAgent?.version, 2);
  assert.equal(latestAgent?.model_policy.provider_connection_id, target.connection_id);
  assert.equal(latestAgent?.model_policy.model, "target-model");
  assert.equal(getSession(session.session_id)?.metadata.conversation_provider_connection_id, target.connection_id);
  assert.equal(getSession(session.session_id)?.metadata.conversation_model, "target-model");
  assert.equal(getUserSchedule("default", schedule.schedule_id)?.provider_connection_id, target.connection_id);
  assert.equal(getUserSchedule("default", schedule.schedule_id)?.model, "target-model");
  assert.equal(
    getTemplate(template.template_id)?.nodes[0]?.agent_binding_snapshot?.provider_connection_id,
    target.connection_id,
  );
  assert.equal(getManagedProviderCredential(source.connection_id), `${source.connection_id}-secret`);

  const deleted = deleteProviderConnection(source.connection_id);
  assert.deepEqual(deleted, {
    connection_id: source.connection_id,
    deleted: true,
    credential_deleted: true,
  });
  assert.equal(getProviderConnection(source.connection_id), null);
  assert.equal(getManagedProviderCredential(source.connection_id), null);
  assert.ok(getProviderConnection(target.connection_id));
});

test("running Agent work blocks Provider Connection migration and deletion", () => {
  resetTestRoot();
  const source = createConnection({ id: "running-source", model: "source-model" });
  const target = createConnection({ id: "running-target", model: "target-model" });
  const agent = upsertAgentDefinition({
    workspaceId: "default",
    agentId: "running-agent",
    name: "Running Agent",
    version: {
      model_policy: {
        deployment_id: null,
        provider_connection_id: source.connection_id,
        model: "source-model",
        allow_runtime_override: false,
      },
    },
  });
  const binding = createAgentBindingSnapshot({
    workspaceId: "default",
    agentId: agent.definition.agent_id,
    providerConnectionId: source.connection_id,
    model: "source-model",
  });
  createAgentRun({ workspaceId: "default", kind: "conversation", bindingSnapshot: binding });
  disableProviderConnection(source.connection_id);

  const report = inspectProviderConnectionReferences(source.connection_id);
  assert.equal(report.blocking_count, 1);
  assert.equal(report.references.some((item) => item.kind === "agent_run" && item.blocking), true);
  assert.throws(
    () => migrateProviderConnectionReferences({
      sourceConnectionId: source.connection_id,
      targetConnectionId: target.connection_id,
    }),
    (error: unknown) => error instanceof ProviderConnectionLifecycleError
      && error.code === "provider_connection_has_running_references",
  );
  assert.throws(
    () => deleteProviderConnection(source.connection_id),
    (error: unknown) => error instanceof ProviderConnectionLifecycleError
      && error.code === "provider_connection_has_references",
  );
});

test("migration rejects an unverified replacement and an unused disabled Connection can be deleted", () => {
  resetTestRoot();
  const source = createConnection({ id: "unverified-source", model: "source-model" });
  const target = createConnection({ id: "unverified-target", model: "target-model", verified: false });
  upsertAgentDefinition({
    workspaceId: "default",
    agentId: "unverified-agent",
    name: "Unverified Agent",
    version: {
      model_policy: {
        deployment_id: null,
        provider_connection_id: source.connection_id,
        model: "source-model",
        allow_runtime_override: false,
      },
    },
  });
  disableProviderConnection(source.connection_id);
  assert.throws(
    () => migrateProviderConnectionReferences({
      sourceConnectionId: source.connection_id,
      targetConnectionId: target.connection_id,
    }),
    (error: unknown) => error instanceof ProviderConnectionLifecycleError
      && error.code === "provider_connection_target_unverified",
  );

  const unused = createConnection({ id: "unused-disabled", model: "unused-model", status: "disabled" });
  assert.equal(inspectProviderConnectionReferences(unused.connection_id).can_delete, true);
  assert.equal(deleteProviderConnection(unused.connection_id).deleted, true);
  assert.equal(getProviderConnection(unused.connection_id), null);
});

test("Provider Connection lifecycle routes expose reference inspection and permanent deletion", async () => {
  resetTestRoot();
  const source = createConnection({ id: "lifecycle-api", model: "api-model", status: "disabled" });
  const server = await startTestServer();
  try {
    const references = await getJson(
      `${server.baseUrl}/api/registry/provider-connections/${source.connection_id}/references`,
    );
    assert.equal(references.status, 200);
    assert.equal(references.body.can_delete, true);

    const response = await fetch(
      `${server.baseUrl}/api/registry/provider-connections/${source.connection_id}`,
      { method: "DELETE" },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      connection_id: source.connection_id,
      deleted: true,
      credential_deleted: true,
    });

    const missing = await getJson(
      `${server.baseUrl}/api/registry/provider-connections/${source.connection_id}/references`,
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "provider_connection_not_found");
  } finally {
    await server.close();
  }
});
