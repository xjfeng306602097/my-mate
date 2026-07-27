import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CapabilityToolError, getCapabilityRegistry } from "../src/capability-registry.js";
import { finalizeConversationCodingTransaction } from "../src/conversation-coding-workspace.js";
import { executeConversationTool } from "../src/conversation-tools.js";
import { createSession } from "../src/session-store.js";
import { registerWorkspaceBinding } from "../src/workspace-binding-store.js";
import { resetTestRoot, TEST_ROOT } from "./helpers.js";

function registerTool(name: string, handler: (input: { attempt: number; idempotency_key: string | null }) => Record<string, unknown> | Promise<Record<string, unknown>>, policy: Record<string, unknown> = {}) {
  return getCapabilityRegistry().registerTool({
    descriptor: {
      capability_id: name,
      plugin_id: "policy.test",
      name,
      description: "Tool execution policy test tool.",
      version: "1.0.0",
      risk_level: "T0",
      permission_scopes: ["test.read"],
      executor: "control-plane",
      metadata: {},
    },
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    handler: ({ attempt, idempotency_key: idempotencyKey }) => handler({ attempt, idempotency_key: idempotencyKey }),
    execution_policy: policy,
  });
}

test("Capability Registry retries transient failures and opens a circuit", async () => {
  resetTestRoot();
  const registry = getCapabilityRegistry();
  registry.clear();
  let attempts = 0;
  registerTool("policy_retry_test", async ({ attempt }) => {
    attempts += 1;
    if (attempt === 1) throw new CapabilityToolError("mcp_tool_call_failed", "temporary");
    return { ok: true, attempts };
  }, {
    max_attempts: 2,
    initial_backoff_ms: 0,
    retryable_error_codes: ["mcp_tool_call_failed"],
  });
  const session = createSession({ initial_message: "test", created_by: "test" });
  const result = await registry.executeTool({ toolName: "policy_retry_test", session, arguments: {} });
  assert.deepEqual(result, { ok: true, attempts: 2 });

  let failures = 0;
  registerTool("policy_circuit_test", () => {
    failures += 1;
    throw new CapabilityToolError("mcp_tool_call_failed", "still unavailable");
  }, {
    max_attempts: 1,
    circuit_breaker: { failure_threshold: 2, reset_timeout_ms: 30_000 },
    retryable_error_codes: ["mcp_tool_call_failed"],
  });
  await assert.rejects(() => registry.executeTool({ toolName: "policy_circuit_test", session, arguments: {} }), /still unavailable/u);
  await assert.rejects(() => registry.executeTool({ toolName: "policy_circuit_test", session, arguments: {} }), /still unavailable/u);
  await assert.rejects(
    () => registry.executeTool({ toolName: "policy_circuit_test", session, arguments: {} }),
    (error: unknown) => (error as { code?: string }).code === "capability_circuit_open",
  );
  assert.equal(failures, 2);
});

test("副作用 Capability requires and reuses a stable idempotency key", async () => {
  resetTestRoot();
  const registry = getCapabilityRegistry();
  registry.clear();
  let calls = 0;
  registerTool("policy_mutation_test", ({ idempotency_key: idempotencyKey }) => {
    calls += 1;
    return { ok: true, idempotency_key: idempotencyKey, calls };
  }, { side_effects: "external_mutation", max_attempts: 1 });
  const definition = registry.listToolDefinitions().find((tool) => tool.name === "policy_mutation_test");
  assert.deepEqual(definition?.input_schema.required, ["idempotency_key"]);
  const session = createSession({ initial_message: "test", created_by: "test" });
  const missing = await executeConversationTool({ session, call: { id: "mutation-missing", name: "policy_mutation_test", arguments: {} } });
  assert.equal(missing.is_error, true);
  assert.equal(missing.content.code, "idempotency_key_required");
  const first = await executeConversationTool({
    session,
    call: { id: "mutation-first", name: "policy_mutation_test", arguments: { idempotency_key: "write:1" } },
  });
  const replay = await executeConversationTool({
    session,
    call: { id: "mutation-replay", name: "policy_mutation_test", arguments: { idempotency_key: "write:1" } },
  });
  assert.equal(first.is_error, false);
  assert.equal(replay.is_error, false);
  assert.equal(replay.content.idempotent_replay, true);
  assert.equal(calls, 1);
});

test("core Workspace mutations replay before a pending Change Set can reject a duplicate", async () => {
  resetTestRoot();
  getCapabilityRegistry().clear();
  const rootPath = path.join(TEST_ROOT, `policy-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(rootPath, { recursive: true });
  const session = createSession({ initial_message: "update the workspace", created_by: "test", autonomy_mode: "assisted" });
  registerWorkspaceBinding({
    workspaceId: session.workspace_id || "default",
    sessionId: session.session_id,
    desktopInstanceId: "tool-policy-test",
    capabilityId: "tool-policy-workspace",
    rootPath,
    access: "sandbox-write",
    scope: "session",
  });
  const args = {
    idempotency_key: "workspace:write:1",
    operations: [{ kind: "write", path: "result.txt", content: "durable result\n" }],
  };
  const first = await executeConversationTool({
    session,
    call: { id: "workspace-first", name: "workspace_apply_operations", arguments: args },
  });
  assert.equal(first.is_error, false);
  const changeSet = finalizeConversationCodingTransaction(session);
  assert.equal(changeSet?.status, "pending");

  const replay = await executeConversationTool({
    session,
    call: { id: "workspace-replay", name: "workspace_apply_operations", arguments: args },
  });
  assert.equal(replay.is_error, false, JSON.stringify(replay.content));
  assert.equal(replay.content.idempotent_replay, true);
  assert.equal(replay.content.original_action_id, first.action_id);
});
