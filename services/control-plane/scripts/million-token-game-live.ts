import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const startedAt = Date.now();
const serviceRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(serviceRoot, "..", "..");
const sourceDataRoot = path.join(serviceRoot, "data");
const connectionId = (process.env.MY_MATE_LIVE_PROVIDER_CONNECTION_ID || "openai-default").trim();
const synthetic = (process.env.MY_MATE_MILLION_TOKEN_MODE || "real").trim().toLowerCase() === "synthetic";
const sourceConnectionPath = path.join(sourceDataRoot, "provider-connections", `${connectionId}.json`);
assert.ok(fs.existsSync(sourceConnectionPath), `Provider Connection ${connectionId} does not exist.`);

const sourceConnection = JSON.parse(fs.readFileSync(sourceConnectionPath, "utf8")) as Record<string, unknown>;
assert.equal(sourceConnection.status, "active", `Provider Connection ${connectionId} is not active.`);
assert.equal(
  (sourceConnection.verification as Record<string, unknown> | undefined)?.status,
  "verified",
  `Provider Connection ${connectionId} is not verified.`,
);
const model = String(sourceConnection.default_model || "");
assert.ok(model, `Provider Connection ${connectionId} has no default model.`);

const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const reportRoot = path.join(repoRoot, "tmp", "million-token-game", runId);
const dataRoot = path.join(reportRoot, "data");
const workspaceRoot = path.resolve(repoRoot, "..", `my-mate-million-token-game-${runId}`);
fs.mkdirSync(path.join(dataRoot, "provider-connections"), { recursive: true });
fs.mkdirSync(workspaceRoot, { recursive: false });
fs.cpSync(path.join(sourceDataRoot, "provider-secrets"), path.join(dataRoot, "provider-secrets"), { recursive: true });

const testConnection = {
  ...sourceConnection,
  provider: synthetic ? "anthropic-compatible" : sourceConnection.provider,
  protocol: synthetic ? "anthropic-messages" : sourceConnection.protocol,
  base_url: synthetic ? "https://synthetic-provider.invalid" : sourceConnection.base_url,
  max_input_tokens: 160_000,
  max_output_tokens: 8_192,
  context_compression_enabled: true,
  context_compression_threshold_percent: 50,
  max_continuation_rounds: 16,
  max_tool_rounds: 24,
};
fs.writeFileSync(
  path.join(dataRoot, "provider-connections", `${connectionId}.json`),
  `${JSON.stringify(testConnection, null, 2)}\n`,
  "utf8",
);
process.env.MY_MATE_DATA_DIR = dataRoot;
process.env.MY_MATE_CONVERSATION_TIMEOUT_MS = String(15 * 60_000);

const [
  { createApp },
  { createSession, getSession, saveSession },
  { createSessionMessage },
  { getLatestTaskCheckpoint },
  { registerWorkspaceBinding },
  { getRuntimeWorkspaceChangeSet, applyRuntimeWorkspaceChangeSet },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/session-store.js"),
  import("../src/session-message-store.js"),
  import("../src/task-checkpoint-store.js"),
  import("../src/workspace-binding-store.js"),
  import("../src/runtime/workspace-change-set.js"),
]);

const session = createSession({
  initial_message: "Build and verify Neon Circuit Arena as a million-token long task.",
  autonomy_mode: "assisted",
  provider_connection_id: connectionId,
  model,
  created_by: "million-token-game-live",
});
session.metadata = {
  ...session.metadata,
  long_task_budget: {
    max_wall_time_ms: 2 * 60 * 60 * 1_000,
    max_turn_attempts: 12,
    max_total_tokens: 4_000_000,
  },
};
saveSession(session);

// Historical design records are deliberately compressible. The current user
// specification remains immutable and is resent through every real tool round.
for (let index = 0; index < 12; index += 1) {
  createSessionMessage({
    session_id: session.session_id,
    role: index % 2 === 0 ? "user" : "orchestrator",
    kind: "text",
    content: {
      text: `Historical game architecture review ${index + 1}. ${"Canvas lifecycle, deterministic update loop, keyboard input, collision evidence, accessible HUD, responsive viewport, restart safety, and offline delivery were reviewed. ".repeat(45)}`,
    },
  });
}

const acceptanceMatrix = Array.from({ length: 2_800 }, (_, index) => {
  const id = String(index + 1).padStart(5, "0");
  return `AC-${id}: preserve deterministic gameplay, responsive canvas sizing, keyboard and pointer input, readable HUD, pause/restart behavior, collision safety, offline execution, and maintainable JavaScript boundaries.`;
}).join("\n");

const taskPrompt = [
  "Build a polished browser game named Neon Circuit Arena in the authorized empty Workspace.",
  "It must be a complete offline HTML5 Canvas survival game with index.html, styles.css, game.js, and README.md.",
  "Gameplay requirements: move with WASD/arrows, aim with pointer, auto-fire energy bolts, enemy waves, pickups, score, combo, health, pause, restart, responsive high-DPI canvas, and a clear game-over state.",
  "Visual requirements: dark neutral arena, cyan player energy, red/pink enemies, amber pickups, crisp HUD, subtle particles, screen shake, no external assets, and no network dependency.",
  "Engineering requirements: deterministic delta-time update, bounded entity arrays, collision helpers, input cleanup, requestAnimationFrame lifecycle, visibility pause, and concise comments only where needed.",
  "Execute the following protocol using exactly one tool call in each Provider round. Never batch multiple tool calls in one response:",
  "1. Call workspace_status.",
  "2. Call workspace_apply_operations with idempotency_key game-index-v1 to create only index.html.",
  "3. Call workspace_apply_operations with idempotency_key game-styles-v1 to create only styles.css.",
  "4. Call workspace_apply_operations with idempotency_key game-script-v1 to create only game.js.",
  "5. Call workspace_apply_operations with idempotency_key game-readme-v1 to create only README.md.",
  "6. Call workspace_list to verify the file set.",
  "7. Call workspace_read_text for index.html.",
  "8. Call workspace_read_text for styles.css.",
  "9. Call workspace_read_text for game.js.",
  "10. Call workspace_read_text for README.md.",
  "11. Call workspace_status.",
  "12. Call workspace_list again.",
  "13. Call workspace_read_text for game.js again to verify the final implementation survived context continuation.",
  "14. Call workspace_status one final time, then provide the final completion report.",
  "Do not stop at a plan, do not say you will work later, and do not claim completion without tool evidence.",
  "The following large acceptance matrix is intentional long-context evidence. Do not reproduce it in output; implement its shared constraints:",
  acceptanceMatrix,
].join("\n\n");
createSessionMessage({
  session_id: session.session_id,
  role: "user",
  kind: "text",
  content: { text: taskPrompt },
});

registerWorkspaceBinding({
  workspaceId: session.workspace_id || "default",
  sessionId: session.session_id,
  desktopInstanceId: "million-token-game-desktop",
  capabilityId: "million-token-game-capability",
  rootPath: workspaceRoot,
  access: "snapshot-read",
  scope: "session",
});

let authorizationRequests = 0;
const progress: Array<Record<string, unknown>> = [];
let streamedText = "";
function sseRound(input: { inputTokens: number; stopReason: "tool_use" | "end_turn"; text?: string; toolCall?: { id: string; name: string; arguments: Record<string, unknown> } }): Response {
  const events: string[] = [`data: ${JSON.stringify({ type: "message_start", message: { model, usage: { input_tokens: input.inputTokens } } })}\n\n`];
  if (input.text) events.push(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: input.text } })}\n\n`);
  if (input.toolCall) events.push(`data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: input.toolCall.id, name: input.toolCall.name, input: input.toolCall.arguments } })}\n\n`);
  events.push(`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: input.stopReason }, usage: { output_tokens: 180 } })}\n\n`, "data: {\"type\":\"message_stop\"}\n\n");
  return new Response(events.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}
let syntheticRound = 0;
const syntheticFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  if (String(body.system || "").startsWith("Compress a long-running task conversation")) {
    return new Response(JSON.stringify({ model, stop_reason: "end_turn", content: [{ type: "text", text: "Preserve completed game operations and continue verification from workspace_status." }], usage: { input_tokens: 1_200, output_tokens: 80 } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  syntheticRound += 1;
  const inputTokens = 90_000;
  const fileOperations = (index: number) => {
    const file = ["index.html", "styles.css", "game.js", "README.md"][index] || `extra-${index}.txt`;
    const content = file === "index.html"
      ? `<canvas id="arena" aria-label="Neon Circuit Arena"></canvas>\n<script src="game.js"></script>\n${"<!-- offline game shell -->\n".repeat(24)}`
      : file === "game.js"
        ? `const canvas = document.querySelector("#arena");\nfunction frame(time) { /* deterministic update loop */ requestAnimationFrame(frame); }\nrequestAnimationFrame(frame);\n${"// bounded entity and collision update\n".repeat(24)}`
        : `${file}\n${"Neon Circuit Arena offline survival game requirements and verification notes.\n".repeat(24)}`;
    return [{ kind: "write", path: file, content }];
  };
  const calls: Array<Parameters<typeof sseRound>[0]> = [
    { inputTokens, stopReason: "tool_use", toolCall: { id: "synthetic-status", name: "workspace_status", arguments: {} } },
    ...[0, 1, 2, 3].map((index) => ({ inputTokens, stopReason: "tool_use" as const, toolCall: { id: `synthetic-write-${index}`, name: "workspace_apply_operations", arguments: { idempotency_key: `game-${index}-v1`, operations: fileOperations(index) } } })),
    { inputTokens, stopReason: "tool_use", toolCall: { id: "synthetic-list", name: "workspace_list", arguments: {} } },
    ...["index.html", "styles.css", "game.js", "README.md"].map((file) => ({ inputTokens, stopReason: "tool_use" as const, toolCall: { id: `synthetic-read-${file}`, name: "workspace_read_text", arguments: { path: file } } })),
    { inputTokens, stopReason: "tool_use", toolCall: { id: "synthetic-status-2", name: "workspace_status", arguments: {} } },
    { inputTokens, stopReason: "tool_use", toolCall: { id: "synthetic-list-2", name: "workspace_list", arguments: {} } },
    { inputTokens, stopReason: "tool_use", toolCall: { id: "synthetic-read-game-2", name: "workspace_read_text", arguments: { path: "game.js" } } },
    { inputTokens, stopReason: "end_turn", text: "Verified the complete Neon Circuit Arena game. All requested files were written, read back, and the final implementation is ready." },
  ];
  return sseRound(calls[Math.min(syntheticRound, calls.length) - 1] || calls.at(-1)!);
};
const app = createApp(synthetic ? { conversation: { fetchImpl: syntheticFetch } } : undefined);
const turnController = new AbortController();
const turnTimeout = setTimeout(() => turnController.abort(new Error("Million-token Desktop stress timed out.")), Number(process.env.MY_MATE_MILLION_TOKEN_TIMEOUT_MS || 10 * 60_000));
turnTimeout.unref?.();
let turnError: string | null = null;
try {
  await app.locals.streamConversationTurn({
    sessionId: session.session_id,
    resumeLatestUser: true,
    signal: turnController.signal,
    allowedToolNames: [
      "workspace_status",
      "workspace_apply_operations",
      "workspace_list",
      "workspace_read_text",
    ],
    onDelta: (delta: string) => { streamedText += delta; },
    onToolProgress: (event: Record<string, unknown>) => { progress.push(structuredClone(event)); },
    onDesktopCapability: async (request: { type: string }) => {
      assert.equal(request.type, "workspace.authorize");
      authorizationRequests += 1;
      registerWorkspaceBinding({
        workspaceId: session.workspace_id || "default",
        sessionId: session.session_id,
        desktopInstanceId: "million-token-game-desktop",
        capabilityId: "million-token-game-capability",
        rootPath: workspaceRoot,
        access: "sandbox-write",
        scope: "session",
      });
    },
  });
} catch (error) {
  turnError = error instanceof Error ? error.message : String(error);
}
clearTimeout(turnTimeout);

if (turnError) {
  const failureReport = {
    ok: false,
    mode: synthetic ? "synthetic" : "real",
    provider_connection_id: connectionId,
    model,
    session_id: session.session_id,
    failure_reason: turnError,
    authorization_requests: authorizationRequests,
    provider_progress_events: progress.length,
    duration_ms: Date.now() - startedAt,
  };
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.writeFileSync(path.join(reportRoot, "report.json"), `${JSON.stringify(failureReport, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(failureReport, null, 2));
  process.exitCode = 2;
  process.exit();
}

const finalSession = getSession(session.session_id)!;
const checkpoint = getLatestTaskCheckpoint(session.session_id)!;
const changeSetId = String(finalSession.metadata.latest_workspace_change_set_id || "");
const changeSet = changeSetId ? getRuntimeWorkspaceChangeSet(changeSetId) : null;

assert.equal(authorizationRequests, 1, "Workspace write authorization was not exercised exactly once.");
assert.equal(checkpoint.provider_state?.completion_contract.status, "satisfied");
assert.ok((checkpoint.provider_state?.tool_rounds || 0) >= 4, "The model did not execute enough real tool rounds.");
assert.ok((checkpoint.provider_state?.compaction_count || 0) >= 1, "The long context was not compacted.");
assert.ok(
  checkpoint.long_task_runtime.cumulative_total_tokens > 1_000_000,
  `Expected more than one million cumulative tokens, received ${checkpoint.long_task_runtime.cumulative_total_tokens}.`,
);
assert.ok(changeSet, "The model did not produce a verified Workspace Change Set.");
assert.equal(changeSet!.status, "pending");
assert.ok(changeSet!.changes.length >= 4, "The Change Set is missing game files.");

applyRuntimeWorkspaceChangeSet({
  changeSetId,
  actor: "million-token-game-live",
  comment: "Apply the explicitly requested million-token game acceptance output.",
});
for (const relativePath of ["index.html", "styles.css", "game.js", "README.md"]) {
  const file = path.join(workspaceRoot, relativePath);
  assert.ok(fs.existsSync(file), `${relativePath} was not created.`);
  assert.ok(fs.statSync(file).size > 200, `${relativePath} is unexpectedly small.`);
}
assert.match(fs.readFileSync(path.join(workspaceRoot, "index.html"), "utf8"), /canvas/iu);
assert.match(fs.readFileSync(path.join(workspaceRoot, "game.js"), "utf8"), /requestAnimationFrame/u);

const report = {
  ok: true,
  provider_connection_id: connectionId,
  model,
  session_id: session.session_id,
  checkpoint_id: checkpoint.checkpoint_id,
  checkpoint_status: checkpoint.status,
  completion_contract: checkpoint.provider_state?.completion_contract.status,
  provider_tool_rounds: checkpoint.provider_state?.tool_rounds,
  continuation_rounds: checkpoint.provider_state?.continuation_rounds,
  compaction_count: checkpoint.provider_state?.compaction_count,
  turn_attempts: checkpoint.long_task_runtime.turn_attempts,
  resume_attempts: checkpoint.resume_attempts,
  cumulative_input_tokens: checkpoint.long_task_runtime.cumulative_input_tokens,
  cumulative_reported_input_tokens: checkpoint.long_task_runtime.cumulative_reported_input_tokens,
  cumulative_estimated_input_tokens: checkpoint.long_task_runtime.cumulative_estimated_input_tokens,
  input_token_accounting: checkpoint.long_task_runtime.input_token_accounting,
  cumulative_output_tokens: checkpoint.long_task_runtime.cumulative_output_tokens,
  cumulative_total_tokens: checkpoint.long_task_runtime.cumulative_total_tokens,
  authorization_requests: authorizationRequests,
  tool_progress_events: progress.length,
  response_characters: streamedText.length,
  change_set_id: changeSetId,
  changed_files: changeSet!.changes.length,
  workspace_root: workspaceRoot,
  isolated_data_root: dataRoot,
  mode: synthetic ? "synthetic" : "real",
  duration_ms: Date.now() - startedAt,
};
fs.mkdirSync(reportRoot, { recursive: true });
fs.writeFileSync(path.join(reportRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
