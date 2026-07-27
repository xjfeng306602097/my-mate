import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";
import { overrideDataDir } from "../src/config.js";
import { executeConversationTool } from "../src/conversation-tools.js";
import { getConversationCodingTransaction } from "../src/conversation-coding-workspace.js";
import {
  recordProviderConnectionVerification,
  upsertProviderConnection,
} from "../src/provider-connection-store.js";
import { createSessionMessage } from "../src/session-message-store.js";
import { createSession, getSession } from "../src/session-store.js";
import {
  beginTaskCheckpoint,
  getLatestTaskCheckpoint,
} from "../src/task-checkpoint-store.js";
import {
  applyRuntimeWorkspaceChangeSet,
  getRuntimeWorkspaceChangeSet,
} from "../src/runtime/workspace-change-set.js";
import { registerWorkspaceBinding } from "../src/workspace-binding-store.js";

const startedAt = Date.now();
const runId = new Date().toISOString().replace(/[:.]/gu, "-");
const root = path.resolve("tmp", "long-task-stress", runId);
const dataRoot = path.join(root, "data");
const workspaceRoot = path.join(root, "workspace");
fs.mkdirSync(path.join(workspaceRoot, "source"), { recursive: true });
fs.writeFileSync(
  path.join(workspaceRoot, "source", "large.txt"),
  `LONG_TASK_SOURCE_HEADER\n${"large-source-record ".repeat(10_000)}\nLONG_TASK_SOURCE_FOOTER\n`,
  "utf8",
);
process.env.MY_MATE_DATA_DIR = dataRoot;
overrideDataDir(dataRoot);

const connection = upsertProviderConnection({
  connection_id: "long-task-stress-provider",
  name: "Long Task Stress Provider",
  agent_runtime: "glm",
  provider: "anthropic-compatible",
  protocol: "anthropic-messages",
  base_url: "https://long-task-stress.invalid",
  models: ["long-task-stress-model"],
  default_model: "long-task-stress-model",
  max_input_tokens: 4_096,
  max_output_tokens: 1_024,
  context_compression_enabled: true,
  context_compression_threshold_percent: 50,
  max_continuation_rounds: 0,
  max_tool_rounds: 16,
  credential_source: "managed",
  api_key: "long-task-stress-secret",
  status: "active",
  metadata: { purpose: "isolated-long-task-stress" },
});
recordProviderConnectionVerification(connection.connection_id, {
  status: "verified",
  tested_at: new Date().toISOString(),
  detail: "Deterministic stress Provider is ready.",
  duration_ms: 1,
  model: "long-task-stress-model",
});

const session = createSession({
  initial_message: "Execute the long repository stress task and produce a reviewed Change Set.",
  autonomy_mode: "assisted",
  provider_connection_id: connection.connection_id,
  model: "long-task-stress-model",
  created_by: "long-task-stress",
});
const userMessage = createSessionMessage({
  session_id: session.session_id,
  role: "user",
  kind: "text",
  content: { text: "Resume the interrupted implementation, create 100 files, inspect the large source, and verify the final result." },
});
registerWorkspaceBinding({
  workspaceId: session.workspace_id || "default",
  sessionId: session.session_id,
  desktopInstanceId: "long-task-stress-desktop",
  capabilityId: "long-task-stress-capability",
  rootPath: workspaceRoot,
  access: "snapshot-read",
  scope: "session",
});
const initialCheckpoint = beginTaskCheckpoint({
  session,
  sourceUserMessageId: userMessage.message_id,
});

function fileOperations(start: number, count: number) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return {
      kind: "write" as const,
      path: `generated/file-${String(index).padStart(3, "0")}.ts`,
      content: `export const stressItem${index} = ${index};\n`,
    };
  });
}

let authorizationRequests = 0;
const firstBatch = fileOperations(0, 20);
const preCrash = await executeConversationTool({
  session,
  call: {
    id: "pre-crash-batch",
    name: "workspace_apply_operations",
    arguments: { idempotency_key: "stress-batch-000-019", operations: firstBatch },
  },
  onDesktopCapability: async (request) => {
    assert.equal(request.type, "workspace.authorize");
    authorizationRequests += 1;
    registerWorkspaceBinding({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      desktopInstanceId: "long-task-stress-desktop",
      capabilityId: "long-task-stress-capability",
      rootPath: workspaceRoot,
      access: "sandbox-write",
      scope: "session",
    });
  },
});
assert.equal(preCrash.is_error, false, JSON.stringify(preCrash.content));
assert.equal(authorizationRequests, 1);

function sseRound(input: {
  stopReason: "tool_use" | "end_turn" | "max_tokens";
  inputTokens: number;
  outputTokens?: number;
  text?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
}): Response {
  const events: string[] = [
    `data: ${JSON.stringify({ type: "message_start", message: { model: "long-task-stress-model", usage: { input_tokens: input.inputTokens } } })}\n\n`,
  ];
  if (input.text) {
    events.push(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: input.text } })}\n\n`);
  }
  if (input.toolCall) {
    events.push(`data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: input.toolCall.id, name: input.toolCall.name, input: input.toolCall.arguments } })}\n\n`);
  }
  events.push(
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: input.stopReason }, usage: { output_tokens: input.outputTokens || 20 } })}\n\n`,
    `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  );
  return new Response(events.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

let providerRounds = 0;
let compressionCalls = 0;
const providerFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  if (String(body.system || "").startsWith("Compress a long-running task conversation")) {
    compressionCalls += 1;
    return new Response(JSON.stringify({
      model: "long-task-stress-model",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Goal: finish the 100-file stress change. Preserve completed idempotency keys and continue from workspace_status." }],
      usage: { input_tokens: 1_500, output_tokens: 40 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  providerRounds += 1;
  if (providerRounds === 1) {
    return sseRound({
      stopReason: "tool_use",
      inputTokens: 1_000,
      toolCall: {
        id: "replay-pre-crash",
        name: "workspace_apply_operations",
        arguments: { idempotency_key: "stress-batch-000-019", operations: firstBatch },
      },
    });
  }
  if (providerRounds === 2) {
    return sseRound({ stopReason: "tool_use", inputTokens: 2_600, toolCall: { id: "read-large-1", name: "workspace_read_text", arguments: { path: "source/large.txt" } } });
  }
  if (providerRounds === 3) {
    return sseRound({ stopReason: "tool_use", inputTokens: 3_100, toolCall: { id: "write-020-059", name: "workspace_apply_operations", arguments: { idempotency_key: "stress-batch-020-059", operations: fileOperations(20, 40) } } });
  }
  if (providerRounds === 4) {
    return sseRound({ stopReason: "tool_use", inputTokens: 2_900, toolCall: { id: "read-large-2", name: "workspace_read_text", arguments: { path: "source/large.txt" } } });
  }
  if (providerRounds === 5) {
    return sseRound({ stopReason: "tool_use", inputTokens: 3_200, toolCall: { id: "write-060-099", name: "workspace_apply_operations", arguments: { idempotency_key: "stress-batch-060-099", operations: fileOperations(60, 40) } } });
  }
  if (providerRounds === 6) {
    return sseRound({ stopReason: "max_tokens", inputTokens: 3_500, text: "All file batches are written in the sandbox; verification remains. " });
  }
  if (providerRounds === 7) {
    return sseRound({ stopReason: "tool_use", inputTokens: 2_000, toolCall: { id: "final-status", name: "workspace_status", arguments: {} } });
  }
  return sseRound({
    stopReason: "end_turn",
    inputTokens: 2_300,
    text: "Verified 100 generated files in the persistent sandbox. The implementation is complete and ready for Change Set review.",
  });
};

const restartedApp = createApp({ conversation: { fetchImpl: providerFetch } });
const recovery = await restartedApp.locals.recoverConversationCheckpoints();
assert.equal(recovery.recovered, 1, JSON.stringify(recovery));
assert.equal(recovery.results[0]?.status, "resumed", JSON.stringify(recovery));

const recoveredSession = getSession(session.session_id)!;
const checkpoint = getLatestTaskCheckpoint(session.session_id)!;
const transaction = getConversationCodingTransaction(session.session_id)!;
const changeSetId = String(recoveredSession.metadata.latest_workspace_change_set_id || "");
const changeSet = getRuntimeWorkspaceChangeSet(changeSetId);

assert.equal(initialCheckpoint.auto_resume_eligible, true);
assert.equal(checkpoint.status, "waiting_human");
assert.ok(checkpoint.transitions.some((transition) => transition.reason === "server_restart"));
assert.ok(checkpoint.transitions.some((transition) => transition.reason === "automatic_resume"));
assert.ok(checkpoint.transitions.some((transition) => transition.reason === "continuation_limit"));
assert.equal(checkpoint.provider_state?.completion_contract.status, "satisfied");
assert.equal(checkpoint.long_task_runtime.exhausted, false);
assert.equal(checkpoint.long_task_runtime.turn_attempts, checkpoint.resume_attempts + 1);
assert.ok(checkpoint.long_task_runtime.cumulative_input_tokens > 0);
assert.ok(checkpoint.long_task_runtime.cumulative_output_tokens > 0);
assert.equal(
  checkpoint.long_task_runtime.cumulative_total_tokens,
  checkpoint.long_task_runtime.cumulative_input_tokens + checkpoint.long_task_runtime.cumulative_output_tokens,
);
assert.match(String(checkpoint.context_summary || ""), /LONG_TASK_CONTEXT_SNAPSHOT/u);
assert.ok(Number(recoveredSession.metadata.conversation_context_compaction_count || 0) >= 1);
assert.equal(typeof recoveredSession.metadata.conversation_loop_context_snapshot, "object");
assert.equal(transaction.operation_ledger.length, 3);
assert.equal(transaction.operation_ledger.filter((entry) => entry.idempotency_key === "stress-batch-000-019").length, 1);
assert.ok(changeSet);
assert.equal(changeSet!.status, "pending");
assert.equal(changeSet!.changes.length, 100);
assert.equal(fs.existsSync(path.join(workspaceRoot, "generated")), false);

applyRuntimeWorkspaceChangeSet({
  changeSetId,
  actor: "long-task-stress-desktop",
  comment: "Automated isolated stress acceptance.",
});
assert.equal(fs.readdirSync(path.join(workspaceRoot, "generated")).length, 100);
assert.equal(
  fs.readFileSync(path.join(workspaceRoot, "generated", "file-099.ts"), "utf8"),
  "export const stressItem99 = 99;\n",
);

const report = {
  ok: true,
  run_id: runId,
  session_id: session.session_id,
  checkpoint_id: checkpoint.checkpoint_id,
  workspace_root: workspaceRoot,
  data_root: dataRoot,
  authorization_requests: authorizationRequests,
  provider_rounds: providerRounds,
  provider_summary_calls: compressionCalls,
  compaction_count: recoveredSession.metadata.conversation_context_compaction_count,
  resume_attempts: checkpoint.resume_attempts,
  turn_attempts: checkpoint.long_task_runtime.turn_attempts,
  cumulative_input_tokens: checkpoint.long_task_runtime.cumulative_input_tokens,
  cumulative_output_tokens: checkpoint.long_task_runtime.cumulative_output_tokens,
  cumulative_total_tokens: checkpoint.long_task_runtime.cumulative_total_tokens,
  operation_ledger_entries: transaction.operation_ledger.length,
  change_set_id: changeSetId,
  changed_files: changeSet!.changes.length,
  duration_ms: Date.now() - startedAt,
};
fs.writeFileSync(path.join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
