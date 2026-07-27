import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  recordProviderConnectionVerification,
  upsertProviderConnection,
} from "../src/provider-connection-store.js";
import { createSession, getSession } from "../src/session-store.js";
import {
  getActiveSessionWorkspaceBinding,
  getWorkspaceBinding,
  registerWorkspaceBinding,
  revokeWorkspaceBinding,
} from "../src/workspace-binding-store.js";
import {
  createStubExecutionAdapter,
  getJson,
  postJson,
  putJson,
  resetTestRoot,
  seedAgentProfile,
  seedSkill,
  seedTemplate,
  startTestServer,
} from "./helpers.js";

test("Desktop Workspace Bindings are session scoped and replace prior access", () => {
  resetTestRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-binding-"));
  try {
    const session = createSession({
      initial_message: "Modify this project",
      created_by: "test",
      autonomy_mode: "autopilot",
    });
    assert.equal(session.metadata.autonomy_mode, "autopilot");
    const readBinding = registerWorkspaceBinding({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      desktopInstanceId: "desktop-test",
      capabilityId: "capability-test",
      rootPath: root,
      access: "snapshot-read",
      scope: "session",
    });
    assert.equal(getActiveSessionWorkspaceBinding(session.session_id)?.binding_id, readBinding.binding_id);
    const writeBinding = registerWorkspaceBinding({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      desktopInstanceId: "desktop-test",
      capabilityId: "capability-test",
      rootPath: root,
      access: "sandbox-write",
      scope: "session",
    });
    assert.equal(getActiveSessionWorkspaceBinding(session.session_id)?.binding_id, writeBinding.binding_id);
    assert.equal(getWorkspaceBinding(readBinding.binding_id)?.status, "revoked");
    assert.equal(revokeWorkspaceBinding(writeBinding.binding_id).status, "revoked");
    assert.equal(getActiveSessionWorkspaceBinding(session.session_id), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop bridge authentication registers a public Binding and Session mode remains stable", async () => {
  resetTestRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-binding-api-"));
  const server = await startTestServer({ desktopBridgeToken: "desktop-secret" });
  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare project work",
      created_by: "test",
      defer_conversation_reply: true,
      autonomy_mode: "review_first",
    });
    const sessionId = created.body.session.session_id as string;
    const rejected = await postJson(`${server.baseUrl}/api/internal/desktop/workspace-bindings`, {
      session_id: sessionId,
      desktop_instance_id: "desktop-test",
      capability_id: "capability-test",
      root_path: root,
      access: "snapshot-read",
      scope: "session",
    });
    assert.equal(rejected.status, 401);
    const registered = await postJson(
      `${server.baseUrl}/api/internal/desktop/workspace-bindings`,
      {
        session_id: sessionId,
        desktop_instance_id: "desktop-test",
        capability_id: "capability-test",
        root_path: root,
        access: "snapshot-read",
        scope: "session",
      },
      { authorization: "Bearer desktop-secret" },
    );
    assert.equal(registered.status, 201);
    assert.equal(registered.body.binding.access, "snapshot-read");
    assert.equal("root_path" in registered.body.binding, false);
    const publicBinding = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/workspace-binding`);
    assert.equal(publicBinding.body.binding.binding_id, registered.body.binding.binding_id);
    assert.equal(getSession(sessionId)?.metadata.autonomy_mode, "review_first");

    const updated = await putJson(`${server.baseUrl}/api/sessions/${sessionId}/autopilot`, {
      mode: "assisted",
    });
    assert.equal(updated.status, 200);
    assert.equal(getSession(sessionId)?.metadata.autonomy_mode, "assisted");
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a read-only Desktop Binding gates mutable Runs and a write Binding routes by trusted id", async () => {
  resetTestRoot();
  seedSkill({ skill_id: "coding-agent", name: "Coding Agent" });
  seedSkill({ skill_id: "artifact-code", name: "Code Artifact" });
  seedSkill({ skill_id: "test-driven-development", name: "Test Driven Development" });
  const connection = upsertProviderConnection({
    connection_id: "workspace-binding-provider",
    name: "Workspace Binding Provider",
    agent_runtime: "codex",
    provider: "openai",
    protocol: "codex-appserver",
    base_url: null,
    models: ["gpt-test"],
    default_model: "gpt-test",
    credential_source: "managed",
    api_key: "workspace-binding-test-secret",
    credential_env: "OPENAI_API_KEY",
    status: "active",
    metadata: {},
  });
  recordProviderConnectionVerification(connection.connection_id, {
    status: "verified",
    tested_at: "2026-07-21T00:00:00.000Z",
    detail: "verified for test",
    duration_ms: 1,
    model: "gpt-test",
  });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    runtime_agent_ref: "backend",
    agent_runtime: "codex",
    provider_connection_id: connection.connection_id,
    default_skills: ["coding-agent"],
  });
  seedAgentProfile({
    profile_id: "default-agent",
    name: "Default Agent",
    runtime_agent_ref: "default",
    agent_runtime: "codex",
    provider_connection_id: connection.connection_id,
  });
  seedTemplate();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-binding-run-"));
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
    desktopBridgeToken: "desktop-run-secret",
  });
  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Modify the selected project",
      created_by: "test",
      defer_conversation_reply: true,
      autonomy_mode: "assisted",
    });
    const sessionId = created.body.session.session_id as string;
    registerWorkspaceBinding({
      workspaceId: "default",
      sessionId,
      desktopInstanceId: "desktop-test",
      capabilityId: "capability-test",
      rootPath: root,
      access: "snapshot-read",
      scope: "session",
    });
    const gated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      template_id: "mobile-test-template",
      inputs: { goal: "Modify the selected project" },
      validation_mode: "strict",
    });
    assert.equal(gated.status, 409);
    assert.equal(gated.body.code, "workspace_authorization_required");
    assert.equal(getSession(sessionId)?.metadata.pending_gate, "workspace_authorization");

    const authorized = await postJson(
      `${server.baseUrl}/api/internal/desktop/workspace-bindings`,
      {
        session_id: sessionId,
        desktop_instance_id: "desktop-test",
        capability_id: "capability-test",
        root_path: root,
        access: "sandbox-write",
        scope: "session",
      },
      { authorization: "Bearer desktop-run-secret" },
    );
    const writeBinding = authorized.body.binding;
    assert.equal(getSession(sessionId)?.metadata.pending_gate, null);
    const started = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      template_id: "mobile-test-template",
      inputs: { goal: "Modify the selected project", project_local_repo: "C:/forged/path" },
      validation_mode: "strict",
    });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    assert.equal(started.body.execution_kind, "agent_dag");
    const run = await getJson(`${server.baseUrl}/api/runs/${started.body.run_id}`);
    assert.equal(run.body.workspace_binding_id, writeBinding.binding_id);
    assert.equal(run.body.inputs.project_local_repo, undefined);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
