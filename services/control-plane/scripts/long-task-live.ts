import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const serviceRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(serviceRoot, "..", "..");
const sourceDataRoot = path.join(serviceRoot, "data");
const connectionId = (process.env.MY_MATE_LIVE_PROVIDER_CONNECTION_ID || "openai-default").trim();
const sourceConnection = path.join(sourceDataRoot, "provider-connections", `${connectionId}.json`);

assert.ok(fs.existsSync(sourceConnection), `Provider Connection ${connectionId} does not exist.`);
const sourceRecord = JSON.parse(fs.readFileSync(sourceConnection, "utf8")) as Record<string, unknown>;
assert.equal(sourceRecord.status, "active", `Provider Connection ${connectionId} is not active.`);
assert.equal(
  (sourceRecord.verification as Record<string, unknown> | undefined)?.status,
  "verified",
  `Provider Connection ${connectionId} has not been verified.`,
);

const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const root = path.join(repoRoot, "tmp", "long-task-live", runId);
const dataRoot = path.join(root, "data");
fs.mkdirSync(path.join(dataRoot, "provider-connections"), { recursive: true });
fs.cpSync(path.join(sourceDataRoot, "provider-secrets"), path.join(dataRoot, "provider-secrets"), { recursive: true });

const liveRecord = {
  ...sourceRecord,
  max_input_tokens: 16_384,
  max_output_tokens: 700,
  context_compression_enabled: true,
  context_compression_threshold_percent: 20,
  max_continuation_rounds: 1,
  max_tool_rounds: 8,
};
fs.writeFileSync(
  path.join(dataRoot, "provider-connections", `${connectionId}.json`),
  `${JSON.stringify(liveRecord, null, 2)}\n`,
  "utf8",
);
process.env.MY_MATE_DATA_DIR = dataRoot;

const [{ createApp }, { createSession, saveSession }, { createSessionMessage }, { getLatestTaskCheckpoint }] = await Promise.all([
  import("../src/app.js"),
  import("../src/session-store.js"),
  import("../src/session-message-store.js"),
  import("../src/task-checkpoint-store.js"),
]);

const model = String(sourceRecord.default_model || "");
assert.ok(model, `Provider Connection ${connectionId} has no default model.`);
const prompt = [
  "Live long-task acceptance test.",
  "First call system_clock_read and system_info_read to collect real local evidence.",
  "Then produce a complete, structured engineering analysis of resilient multi-agent DAG execution.",
  "Cover state persistence, retries, idempotency, permissions, cancellation, review, observability, and recovery.",
  "Do not merely announce future work. Finish the answer and explicitly summarize the evidence returned by both tools.",
].join("\n");
const session = createSession({
  initial_message: "External Provider long-task acceptance",
  autonomy_mode: "assisted",
  provider_connection_id: connectionId,
  model,
  created_by: "long-task-live-acceptance",
});
session.metadata = {
  ...session.metadata,
  long_task_budget: {
    max_wall_time_ms: 10 * 60 * 1_000,
    max_turn_attempts: 4,
    max_total_tokens: 200_000,
  },
};
saveSession(session);
for (let index = 0; index < 4; index += 1) {
  createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: `Historical design review ${index + 1}: explain durable execution constraints.` },
  });
  createSessionMessage({
    session_id: session.session_id,
    role: "orchestrator",
    kind: "text",
    content: {
      text: `Historical review ${index + 1}. ${"Checkpoint context, operation ledger, durable state, recovery evidence, and permission boundaries were reviewed. ".repeat(85)}`,
      response_source: "provider",
      usage: { input_tokens: 1_000, output_tokens: 1_000 },
    },
  });
}
createSessionMessage({
  session_id: session.session_id,
  role: "user",
  kind: "text",
  content: { text: prompt },
});

const app = createApp();
let text = "";
await app.locals.streamConversationTurn({
  sessionId: session.session_id,
  resumeLatestUser: true,
  allowedToolNames: ["system_clock_read", "system_info_read"],
  onDelta: (delta: string) => { text += delta; },
});

const checkpoint = getLatestTaskCheckpoint(session.session_id);
assert.ok(checkpoint, "The real Provider turn did not persist a TaskCheckpoint.");
assert.ok(text.trim().length > 200, "The real Provider did not return a substantive response.");
assert.equal(checkpoint.provider_state?.completion_contract.status, "satisfied");
assert.ok((checkpoint.provider_state?.tool_rounds || 0) >= 1, "The real Provider did not execute the requested tools.");
assert.ok(checkpoint.long_task_runtime.cumulative_total_tokens > 0, "Token usage was not persisted.");
assert.ok((checkpoint.provider_state?.compaction_count || 0) >= 1, "The real Provider path did not cross the compaction boundary.");
assert.equal(checkpoint.long_task_runtime.exhausted, false);

const report = {
  ok: true,
  provider_connection_id: connectionId,
  model,
  session_id: session.session_id,
  checkpoint_id: checkpoint.checkpoint_id,
  checkpoint_status: checkpoint.status,
  completion_contract: checkpoint.provider_state?.completion_contract.status,
  tool_rounds: checkpoint.provider_state?.tool_rounds,
  continuation_rounds: checkpoint.provider_state?.continuation_rounds,
  compaction_count: checkpoint.provider_state?.compaction_count,
  turn_attempts: checkpoint.long_task_runtime.turn_attempts,
  resume_attempts: checkpoint.resume_attempts,
  cumulative_total_tokens: checkpoint.long_task_runtime.cumulative_total_tokens,
  response_characters: text.length,
  isolated_data_root: dataRoot,
};
fs.writeFileSync(path.join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
