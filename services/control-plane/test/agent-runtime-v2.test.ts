import assert from "node:assert/strict";
import test from "node:test";
import { recordProviderConnectionVerification, upsertProviderConnection } from "../src/provider-connection-store.js";
import { createSession } from "../src/session-store.js";
import { createAgentBindingSnapshot, getPublishedAgentVersion, listAgentDefinitions, listAgentRuns, migrateLegacyAgentRegistry, resolveSessionAgentBinding, upsertAgentDefinition } from "../src/agent-runtime-store.js";
import { createUserSchedule, saveUserSchedule } from "../src/user-schedule-store.js";
import { UserScheduleRunner } from "../src/user-schedule-runner.js";
import { createSessionMessage } from "../src/session-message-store.js";
import { buildPublishedTemplate, getJson, resetTestRoot, seedAgentProfile, seedTemplate, startTestServer } from "./helpers.js";
import { getTemplate, migrateWorkflowAgentBindings } from "../src/template-store.js";
import { compileRunPlan } from "../src/run-plan-compiler.js";
import { createMemory } from "../src/memory-store.js";
import { runBackgroundMemoryReview } from "../src/memory-background-review.js";
import { generateProviderConversationReply } from "../src/conversation-provider.js";
import { listSessionMessages } from "../src/session-message-store.js";

function configure() {
  const connection = upsertProviderConnection({
    connection_id: "v2-connection",
    name: "V2 Provider",
    agent_runtime: "glm",
    provider: "glm",
    protocol: "openai-compatible",
    base_url: "https://provider.example",
    models: ["glm-5.2"],
    default_model: "glm-5.2",
    api_key: "v2-secret",
    credential_source: "managed",
    credential_env: "GLM_API_KEY",
    status: "active",
    metadata: {},
  });
  recordProviderConnectionVerification(connection.connection_id, { status: "verified", tested_at: new Date().toISOString(), detail: "test", duration_ms: 1, model: "glm-5.2" });
  seedAgentProfile({ profile_id: "default-agent", name: "Default Agent", description: "Migrated default", provider_connection_id: connection.connection_id, agent_runtime: "glm", default_skills: [], allowed_tools: ["system_clock_read"], policy_tags: [], status: "active", metadata: {} });
  return connection;
}

test("legacy profiles project into versioned Agent definitions and pinned snapshots", () => {
  resetTestRoot();
  configure();
  const result = migrateLegacyAgentRegistry("default");
  assert.equal(result.agents, 1);
  const definition = listAgentDefinitions("default").find((item) => item.agent_id === "default-agent");
  assert.equal(definition?.published_version, 1);
  assert.equal(getPublishedAgentVersion("default-agent")?.model_policy.provider_connection_id, "v2-connection");
  assert.deepEqual(getPublishedAgentVersion("default-agent")?.runtime_policy, {
    runtime: "native",
    sandbox: "auto",
    timeout_seconds: 1800,
  });
  const snapshot = createAgentBindingSnapshot({ agentId: "default-agent", providerConnectionId: "v2-connection", model: "glm-5.2" });
  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.agent_version, 1);
  assert.equal(snapshot.model, "glm-5.2");
  assert.ok(snapshot.snapshot_digest);
  assert.equal(snapshot.runtime_policy.runtime, "native");
});

test("Agent publishing always converges to the Native Runtime", () => {
  resetTestRoot();
  configure();
  const published = upsertAgentDefinition({
    name: "Native Runtime Agent",
    createdBy: "test",
    version: {
      runtime_policy: {
        runtime: "native",
        sandbox: "docker",
        timeout_seconds: 900,
      },
    },
  });
  assert.deepEqual(published.version.runtime_policy, {
    runtime: "native",
    sandbox: "docker",
    timeout_seconds: 900,
  });
});

test("Agent publishing rejects unverified Connections and models outside the selected Connection", () => {
  resetTestRoot();
  configure();
  const unverified = upsertProviderConnection({
    connection_id: "unverified-agent-connection",
    name: "Unverified Agent Provider",
    agent_runtime: "glm",
    provider: "glm",
    protocol: "openai-compatible",
    base_url: "https://unverified.example",
    models: ["unverified-model"],
    default_model: "unverified-model",
    api_key: "unverified-secret",
    credential_source: "managed",
    credential_env: "GLM_API_KEY",
    status: "active",
    metadata: {},
  });

  assert.throws(() => upsertAgentDefinition({
    name: "Unverified Binding Agent",
    createdBy: "test",
    version: { model_policy: { deployment_id: null, provider_connection_id: unverified.connection_id, model: "unverified-model", allow_runtime_override: false } },
  }), (error: unknown) => (error as { code?: string }).code === "agent_provider_unverified");

  assert.throws(() => upsertAgentDefinition({
    name: "Wrong Model Agent",
    createdBy: "test",
    version: { model_policy: { deployment_id: null, provider_connection_id: "v2-connection", model: "another-provider-model", allow_runtime_override: false } },
  }), (error: unknown) => (error as { code?: string }).code === "agent_model_unavailable");
});

test("Agent binding snapshots preserve and enforce the published Connection and model", () => {
  resetTestRoot();
  configure();
  const alternateConnection = upsertProviderConnection({
    connection_id: "alternate-v2-connection",
    name: "Alternate V2 Provider",
    agent_runtime: "glm",
    provider: "glm",
    protocol: "openai-compatible",
    base_url: "https://alternate-provider.example",
    models: ["glm-5.2"],
    default_model: "glm-5.2",
    api_key: "alternate-v2-secret",
    credential_source: "managed",
    credential_env: "GLM_API_KEY",
    status: "active",
    metadata: {},
  });
  recordProviderConnectionVerification(alternateConnection.connection_id, { status: "verified", tested_at: new Date().toISOString(), detail: "test", duration_ms: 1, model: "glm-5.2" });
  const published = upsertAgentDefinition({
    agentId: "pinned-model-agent",
    name: "Pinned Model Agent",
    createdBy: "test",
    version: { model_policy: { deployment_id: null, provider_connection_id: "v2-connection", model: "glm-5.2", allow_runtime_override: false } },
  });
  const snapshot = createAgentBindingSnapshot({ agentId: published.definition.agent_id });
  assert.equal(snapshot.provider_connection_id, "v2-connection");
  assert.equal(snapshot.model, "glm-5.2");
  assert.throws(() => createAgentBindingSnapshot({
    agentId: published.definition.agent_id,
    model: "another-provider-model",
  }), (error: unknown) => (error as { code?: string }).code === "agent_model_override_forbidden");
  assert.throws(() => createAgentBindingSnapshot({
    agentId: published.definition.agent_id,
    providerConnectionId: alternateConnection.connection_id,
    model: "glm-5.2",
  }), (error: unknown) => (error as { code?: string }).code === "agent_provider_override_forbidden");
});

test("legacy Agent routing metadata is normalized at the registry boundary", () => {
  resetTestRoot();
  configure();
  const published = upsertAgentDefinition({
    agentId: "default-agent",
    name: "Default Agent",
    createdBy: "test",
    version: {
      role: "orchestrator",
      metadata: { default_subagent_profile_ids: ["writer-agent", "writer-agent"] } as Record<string, unknown>,
    },
  });
  assert.deepEqual(published.version.metadata.preferred_agent_ids, ["writer-agent"]);
  assert.equal("default_subagent_profile_ids" in published.version.metadata, false);
  assert.deepEqual(getPublishedAgentVersion("default-agent")?.metadata.preferred_agent_ids, ["writer-agent"]);
});

test("historical Session bindings converge to the Native Runtime before execution", () => {
  resetTestRoot();
  configure();
  const current = createAgentBindingSnapshot({ agentId: "default-agent" });
  const legacy = {
    ...current,
    runtime_policy: { ...current.runtime_policy, runtime: "openclaw" },
    snapshot_digest: "legacy-binding-digest",
  } as unknown as typeof current;
  const normalized = resolveSessionAgentBinding({
    workspace_id: "default",
    metadata: { agent_binding_snapshot: legacy },
  });
  assert.equal(normalized.runtime_policy.runtime, "native");
  assert.notEqual(normalized.snapshot_digest, "legacy-binding-digest");
});

test("OpenClaw can no longer be configured as a Provider Connection", () => {
  resetTestRoot();
  assert.throws(() => upsertProviderConnection({
    connection_id: "retired-openclaw",
    name: "Retired OpenClaw",
    agent_runtime: "openclaw",
    provider: "openclaw",
    base_url: "http://127.0.0.1:4020",
    models: ["legacy-agent"],
    default_model: "legacy-agent",
    credential_source: "environment",
    credential_env: "MY_MATE_OPENCLAW_BRIDGE_API_KEY",
    status: "active",
    metadata: {},
  }), /OpenClaw Provider Connections are retired/u);
});

test("legacy Workflow nodes are durably backfilled with pinned AgentBindingSnapshot values", () => {
  resetTestRoot();
  configure();
  const legacy = buildPublishedTemplate({
    template_id: "legacy-agent-binding",
    workspace_scope: "default",
    nodes: [
      {
        ...buildPublishedTemplate().nodes[0],
        id: "legacy-node",
        agent_profile: "default-agent",
      },
    ],
  });
  seedTemplate(legacy);
  const result = migrateWorkflowAgentBindings("default");
  assert.equal(result.migrated_templates, 1);
  assert.equal(result.migrated_nodes, 1);
  assert.equal(result.unresolved_nodes.length, 0);
  const migrated = getTemplate("legacy-agent-binding")!;
  assert.equal(migrated.nodes[0]?.agent_profile, undefined);
  assert.equal(migrated.nodes[0]?.agent_id, "default-agent");
  assert.equal(migrated.nodes[0]?.agent_binding_snapshot?.schema_version, 2);
  assert.equal(migrated.nodes[0]?.agent_binding_snapshot?.agent_role, "orchestrator");
  assert.equal((migrated.metadata.agent_binding_migration as { compatibility_fields_retained?: boolean }).compatibility_fields_retained, false);
  assert.equal(migrateWorkflowAgentBindings("default").migrated_nodes, 0);

  const compiled = compileRunPlan({
    run_id: "run-agent-v2",
    template_id: migrated.template_id,
    template_version: migrated.version,
    workspace_id: "default",
    requested_by: "test",
    intent: "verify canonical binding",
    inputs: {},
    status: "queued",
    current_summary: "",
    waiting_reason: null,
    blocked_reason: null,
    last_event_id: null,
    proposal_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
  }, migrated);
  assert.equal(compiled.compiled_nodes[0]?.agent_profile, undefined);
  assert.equal(compiled.compiled_nodes[0]?.agent_id, "default-agent");
  assert.equal(compiled.planner_context.legacy_profile_fallback_reads, 0);
});

test("Workflow node capability overrides can only narrow a pinned Agent binding", () => {
  resetTestRoot();
  configure();
  upsertAgentDefinition({
    agentId: "scoped-agent",
    name: "Scoped Agent",
    createdBy: "test",
    version: {
      role: "worker",
      skill_policy: { locked_skills: [], denied_skills: [], dynamic_activation: false },
      tool_policy: { allowed_tools: ["read", "write"], denied_tools: [], max_tool_rounds: 8 },
    },
  });
  const template = buildPublishedTemplate({
    template_id: "narrow-agent-capabilities",
    nodes: [{
      ...buildPublishedTemplate().nodes[0],
      id: "scoped-node",
      agent_profile: undefined,
      agent_id: "scoped-agent",
      allowed_skills: ["coding-agent", "not-granted"],
      config: { allowed_tools: ["workspace_read_text", "workspace_run_command"] },
    }],
  }) as ReturnType<typeof buildPublishedTemplate> & { status: "published" };
  const compiled = compileRunPlan({
    run_id: "run-narrow-agent", template_id: template.template_id, template_version: 1, workspace_id: "default", requested_by: "test", intent: "narrow capabilities", inputs: {}, status: "queued", current_summary: "", waiting_reason: null, blocked_reason: null, last_event_id: null, proposal_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), started_at: null, finished_at: null,
  }, template);
  assert.deepEqual(compiled.compiled_nodes[0]?.allowed_skills, []);
  assert.deepEqual(compiled.compiled_nodes[0]?.allowed_tools, ["workspace_read_text"]);
});

test("Workflow migration reports Agent tasks without a selector as unresolved", () => {
  resetTestRoot();
  configure();
  const template = buildPublishedTemplate({
    template_id: "missing-agent-selector",
    workspace_scope: "default",
    nodes: [{
      ...buildPublishedTemplate().nodes[0],
      id: "unbound-agent-task",
      type: "agent_task",
      agent_profile: null,
      agent_id: null,
      agent_binding_snapshot: null,
    }],
  });
  seedTemplate(template);
  const result = migrateWorkflowAgentBindings("default");
  assert.equal(result.unresolved_nodes.length, 1);
  assert.equal(result.compatibility_fields_retained, true);
});

test("new Sessions pin a complete Agent binding and Agent runs are durable", () => {
  resetTestRoot();
  configure();
  const session = createSession({ initial_message: "inspect system time", provider_connection_id: "v2-connection", model: "glm-5.2" });
  const snapshot = session.metadata.agent_binding_snapshot as { schema_version?: number; provider_connection_id?: string };
  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.provider_connection_id, "v2-connection");
  assert.equal(listAgentRuns("default").length, 0);
  const custom = upsertAgentDefinition({ name: "Research Agent", description: "Bound research runtime", createdBy: "test" });
  assert.equal(custom.definition.published_version, 1);
  assert.equal(custom.version.agent_id, custom.definition.agent_id);
});

test("Agent versions pin responsibility, capabilities, contracts, and model routing", () => {
  resetTestRoot();
  configure();
  const published = upsertAgentDefinition({
    agentId: "contract-agent",
    name: "Contract Agent",
    description: "Own structured delivery",
    createdBy: "test",
    version: {
      role: "specialist",
      responsibility: "Produce a tested report.",
      model_policy: {
        deployment_id: null,
        provider_connection_id: "v2-connection",
        model: "glm-5.2",
        allow_runtime_override: false,
        routing_preference: "quality",
        fallback_models: ["glm-5.2-air"],
        allow_model_escalation: true,
      },
      capability_policy: {
        capability_tags: ["research", "reporting"],
        allow_delegation: false,
        input_contract: { topic: "string" },
        output_contract: { report: "string" },
        acceptance_criteria: ["Report is complete."],
        verification_steps: ["Check every cited source."],
      },
    },
  });
  const snapshot = createAgentBindingSnapshot({ agentId: published.definition.agent_id });
  assert.equal(snapshot.responsibility, "Produce a tested report.");
  assert.deepEqual(snapshot.capability_policy?.capability_tags, ["research", "reporting"]);
  assert.equal(snapshot.model_routing_policy?.routing_preference, "quality");
  assert.deepEqual(snapshot.model_routing_policy?.fallback_models, ["glm-5.2-air"]);
  assert.equal(snapshot.capability_policy?.output_contract.report, "string");
});

test("Agent publishing fails closed when a locked Skill is unavailable", () => {
  resetTestRoot();
  configure();
  assert.throws(() => upsertAgentDefinition({
    name: "Invalid Skill Agent",
    createdBy: "test",
    version: { skill_policy: { locked_skills: [{ skill_id: "missing-skill", version: null }], denied_skills: [], dynamic_activation: false } },
  }), (error: unknown) => (error as { code?: string }).code === "agent_skill_unavailable");
});

test("Agent Memory Policy disables recall and background writes at the Provider boundary", async () => {
  resetTestRoot();
  configure();
  const published = upsertAgentDefinition({
    agentId: "default-agent",
    name: "Default Agent",
    createdBy: "test",
    version: {
      role: "orchestrator",
      memory_policy: { enabled: false, automatic_recall: false, write_mode: "disabled" },
    },
  });
  createMemory({ content: "CONFIDENTIAL_MEMORY_POLICY_SENTINEL", kind: "fact" });
  const session = createSession({
    initial_message: "Prepare the confidential memory-policy report with enough detail for extraction.",
    provider_connection_id: "v2-connection",
    model: "glm-5.2",
    agent_id: "default-agent",
    agent_version: published.version.version,
  });
  let providerBody = "";
  const fetchImpl: typeof fetch = async (_url, init) => {
    providerBody = String(init?.body || "");
    return new Response(JSON.stringify({
      model: "glm-5.2",
      choices: [{ finish_reason: "stop", message: { content: "Memory policy respected." } }],
      usage: { prompt_tokens: 20, completion_tokens: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const reply = await generateProviderConversationReply({
    session,
    messages: listSessionMessages(session.session_id),
    fetchImpl,
  });
  assert.equal(reply.text, "Memory policy respected.");
  assert.doesNotMatch(providerBody, /CONFIDENTIAL_MEMORY_POLICY_SENTINEL/);
  assert.doesNotMatch(providerBody, /memory_(?:search|remember|forget)/);
  assert.equal(reply.evidence.memory_context_id, null);
  const review = await runBackgroundMemoryReview(session.session_id);
  assert.equal(review.status, "skipped");
  assert.equal(review.reason, "agent_memory_disabled");
});

test("versioned Agent and AgentRun APIs expose the unified registry surface", async () => {
  resetTestRoot();
  configure();
  const server = await startTestServer();
  try {
    const response = await getJson(`${server.baseUrl}/api/agents`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.items));
    assert.ok(Array.isArray(response.body.deployments));
    assert.ok(Array.isArray(response.body.readiness));
    assert.ok(response.body.capabilities.some((item: { capability_id: string }) => item.capability_id === "workspace_run_command"));
    assert.ok(response.body.capabilities.some((item: { capability_id: string }) => item.capability_id === "workspace_status"));
    assert.equal(response.body.readiness.find((item: { agent_id: string }) => item.agent_id === "default-agent")?.state, "ready");
    assert.equal(response.body.workflow_migration.compatibility_mode, "canonical_v2");
    assert.equal(response.body.workflow_migration.removal_ready, true);
    assert.equal(response.body.workflow_migration.fallback_read_telemetry.fallback_reads, 0);
    const runs = await getJson(`${server.baseUrl}/api/agent-runs`);
    assert.equal(runs.status, 200);
    assert.ok(Array.isArray(runs.body.items));
  } finally {
    await server.close();
  }
});

test("Scheduled Task executes from its pinned Agent snapshot and records a Schedule AgentRun", async () => {
  resetTestRoot();
  const connection = configure();
  const now = new Date("2026-07-18T00:00:00.000Z");
  const schedule = createUserSchedule({
    workspaceId: "default",
    name: "Pinned agent schedule",
    prompt: "Return pinned result",
    providerConnectionId: connection.connection_id,
    model: "glm-5.2",
    timezone: "UTC",
    recurrence: { kind: "once", run_at: new Date(now.getTime() - 1000).toISOString() },
    createdBy: "agent-v2-test",
    now: new Date(now.getTime() - 60_000),
  });
  schedule.next_run_at = new Date(now.getTime() - 1000).toISOString();
  saveUserSchedule(schedule);
  assert.equal(schedule.agent_binding_snapshot?.model, "glm-5.2");
  const runner = new UserScheduleRunner({
    now: () => now,
    turnHandler: async (input) => {
      assert.equal(input.providerConnectionId, undefined);
      const session = createSession({ title: "Pinned agent schedule" });
      const message = createSessionMessage({ session_id: session.session_id, role: "orchestrator", kind: "text", content: { text: "pinned result" } });
      return { session, assistantMessage: message };
    },
  });
  await runner.runDue();
  const runs = listAgentRuns("default");
  assert.equal(runs.some((run) => run.kind === "schedule" && run.binding_snapshot.model === "glm-5.2" && run.status === "completed"), true);
});
