import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRuntimeWorkerJob } from "../src/worker-runtime.js";
import type { RuntimeAgentRuntime } from "../src/types.js";
import { buildJob } from "./worker-runtime.test.js";

const runLive = process.env.MY_MATE_RUN_LIVE_PROVIDER_TESTS === "true";
const commandEnv: Record<string, string> = {
  codex: "MY_MATE_CODEX_COMMAND",
  "claude-sdk": "MY_MATE_CLAUDE_SDK_COMMAND",
  kimi: "MY_MATE_KIMI_COMMAND",
  openclaw: "MY_MATE_OPENCLAW_WORKER_BRIDGE_URL",
};

test("opt-in live provider emits at least one native evidence record", { skip: !runLive }, async () => {
  const provider = process.env.MY_MATE_LIVE_PROVIDER as RuntimeAgentRuntime | undefined;
  assert.ok(
    provider && Object.hasOwn(commandEnv, provider),
    "MY_MATE_LIVE_PROVIDER must be one of codex, claude-sdk, kimi, or openclaw.",
  );
  const requiredEnv = commandEnv[provider];
  assert.ok(process.env[requiredEnv], `${requiredEnv} is required for live ${provider} verification.`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-live-provider-"));
  const previousWorkspace = process.env.MY_MATE_WORKSPACE;
  process.env.MY_MATE_WORKSPACE = tempRoot;
  try {
    const job = buildJob();
    job.harness.agent_runtime = provider;
    job.harness.runtime_agent_ref = process.env.MY_MATE_LIVE_MODEL || null;
    job.envelope.intent = "Reply with exactly: MY_MATE_LIVE_PROVIDER_OK";
    const result = await runRuntimeWorkerJob(job, { workerId: `live-${provider}` });
    const native = result.evidence.filter((item) => item.source?.synthetic === false);
    assert.ok(native.length > 0, `${provider} returned no recognized provider-native events.`);
  } finally {
    if (previousWorkspace === undefined) delete process.env.MY_MATE_WORKSPACE;
    else process.env.MY_MATE_WORKSPACE = previousWorkspace;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
