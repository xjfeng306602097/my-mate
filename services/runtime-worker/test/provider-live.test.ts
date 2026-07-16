import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRuntimeWorkerJob } from "../src/worker-runtime.js";
import type { RuntimeAgentRuntime } from "../src/types.js";
import { buildJob } from "./worker-runtime.test.js";

const runLive = process.env.MY_MATE_RUN_LIVE_PROVIDER_TESTS === "true";
const commandEnv: Record<string, string> = {
  kimi: "MY_MATE_KIMI_COMMAND",
  openclaw: "MY_MATE_OPENCLAW_WORKER_BRIDGE_URL",
};

test("opt-in live provider completes the workspace tool and usage scenario", { skip: !runLive }, async () => {
  const provider = process.env.MY_MATE_LIVE_PROVIDER as RuntimeAgentRuntime | undefined;
  assert.ok(
    provider && ["codex", "claude-sdk", "glm", "kimi", "openclaw"].includes(provider),
    "MY_MATE_LIVE_PROVIDER must be one of codex, claude-sdk, glm, kimi, or openclaw.",
  );
  const requiredEnv = commandEnv[provider];
  if (requiredEnv) {
    assert.ok(process.env[requiredEnv], `${requiredEnv} is required for live ${provider} verification.`);
  }
  if (provider === "glm") {
    assert.ok(
      process.env.MY_MATE_GLM_ANTHROPIC_BASE_URL,
      "MY_MATE_GLM_ANTHROPIC_BASE_URL is required for live GLM verification.",
    );
    assert.ok(
      process.env.GLM_API_KEY || process.env.ZAI_API_KEY || process.env.ZHIPU_API_KEY,
      "GLM_API_KEY, ZAI_API_KEY, or ZHIPU_API_KEY is required for live GLM verification.",
    );
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-live-provider-"));
  const previousWorkspace = process.env.MY_MATE_WORKSPACE;
  process.env.MY_MATE_WORKSPACE = tempRoot;
  try {
    const verificationToken = `token_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    fs.writeFileSync(
      path.join(tempRoot, "live-acceptance-input.json"),
      `${JSON.stringify({ verification_token: verificationToken, values: [17, 25] }, null, 2)}\n`,
      "utf-8",
    );
    const job = buildJob();
    job.harness.agent_runtime = provider;
    job.harness.runtime_agent_ref = process.env.MY_MATE_LIVE_MODEL || null;
    job.harness.allowed_tools = ["read", "shell"];
    job.envelope.intent = [
      "Use an available file-reading or shell tool to read live-acceptance-input.json from the workspace.",
      "Return only <verification_token>|<sum of values> using the file contents.",
      "Do not guess the token and do not modify any file.",
    ].join(" ");
    const result = await runRuntimeWorkerJob(job, { workerId: `live-${provider}` });
    const native = result.evidence.filter((item) => item.source?.synthetic === false);
    assert.ok(native.length > 0, `${provider} returned no recognized provider-native events.`);
    const modelText = native
      .filter((item) => item.kind === "model_text")
      .map((item) => item.summary)
      .join("\n");
    assert.ok(
      modelText.includes(`${verificationToken}|42`),
      `${provider} did not return the value derived from the isolated workspace fixture.`,
    );
    const toolCalls = native.filter((item) => item.kind === "tool_call");
    const toolResults = native.filter((item) => item.kind === "tool_result");
    const toolCallIds = new Set(toolCalls.map((item) => item.trace?.tool_call_id).filter(Boolean));
    const correlated = toolResults.some((item) => {
      const id = item.trace?.tool_call_id;
      return !!id && toolCallIds.has(id);
    });
    const requireTools = process.env.MY_MATE_LIVE_REQUIRE_TOOLS !== "false";
    if (requireTools) {
      assert.ok(toolCalls.length > 0, `${provider} returned no provider-native tool call.`);
      assert.ok(toolResults.length > 0, `${provider} returned no provider-native tool result.`);
      assert.ok(correlated, `${provider} tool call and result correlation was not preserved.`);
    }
    const usage = native.find((item) => item.kind === "usage")?.usage;
    assert.ok(usage, `${provider} returned no provider-native usage record.`);
    assert.notEqual(usage.availability, "unavailable", `${provider} usage was unavailable.`);
    console.log(`LIVE_ACCEPTANCE_EVIDENCE ${JSON.stringify({
      scenario: "workspace_tool_usage",
      output_verified: true,
      native_evidence_count: native.length,
      tool_call_count: toolCalls.length,
      tool_result_count: toolResults.length,
      tool_correlation_verified: correlated,
      usage_availability: usage.availability,
    })}`);
  } finally {
    if (previousWorkspace === undefined) delete process.env.MY_MATE_WORKSPACE;
    else process.env.MY_MATE_WORKSPACE = previousWorkspace;
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
