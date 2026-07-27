import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveAcceptancePlan,
  runLiveAcceptance,
} from "./live-acceptance-lib.mjs";

const manifest = {
  schema_version: 1,
  providers: [
    {
      id: "codex",
      harness_builtin: true,
      harness_name: "codex-appserver",
      credential_envs: ["OPENAI_API_KEY", "CODEX_API_KEY"],
      credential_optional: true,
      credential_mode: "agent_session",
      model_env: "MY_MATE_LIVE_MODEL",
    },
  ],
  judges: [{
    id: "anthropic",
    evaluator_id: "model-v1",
    credential_envs: ["ANTHROPIC_API_KEY"],
    model_env: "MY_MATE_EVALUATOR_MODEL",
  }],
};

test("live acceptance auto-selects only credential-ready lanes without exposing values", () => {
  const env = {
    MY_MATE_LIVE_PROVIDERS: "auto",
    MY_MATE_LIVE_JUDGE: "auto",
    OPENAI_API_KEY: "secret-openai-value",
    ANTHROPIC_API_KEY: "secret-anthropic-value",
    MY_MATE_EVALUATOR_MODEL: "judge-model",
  };
  const plan = buildLiveAcceptancePlan(manifest, env);
  assert.equal(plan.find((lane) => lane.id === "provider:codex")?.runnable, true);
  assert.equal(plan.find((lane) => lane.id === "provider:codex")?.credential_source, "OPENAI_API_KEY");
  assert.equal(plan.find((lane) => lane.id === "judge:anthropic")?.runnable, true);
  assert.equal(JSON.stringify(plan).includes("secret-openai-value"), false);
  assert.equal(JSON.stringify(plan).includes("secret-anthropic-value"), false);
});

test("live acceptance accepts a built-in Agent Harness session without an API key", () => {
  const plan = buildLiveAcceptancePlan(manifest, {
    MY_MATE_LIVE_PROVIDERS: "codex",
  });
  const codex = plan.find((lane) => lane.id === "provider:codex");
  assert.equal(codex?.selected, true);
  assert.equal(codex?.runnable, true);
  assert.equal(codex?.credential_source, "agent_session");
});

test("live acceptance redacts execution errors", async () => {
  const secret = "provider-secret-value";
  const failed = await runLiveAcceptance({
    manifest,
    env: {
      MY_MATE_LIVE_PROVIDERS: "codex",
      OPENAI_API_KEY: secret,
    },
    startedAt: "2026-07-12T00:00:00.000Z",
    completedAt: "2026-07-12T00:00:01.000Z",
    async execute() { throw new Error(`provider returned ${secret}`); },
  });
  const error = failed.lanes.find((lane) => lane.id === "provider:codex")?.error || "";
  assert.equal(error.includes(secret), false);
  assert.match(error, /\[REDACTED\]/);
});

test("live acceptance preserves the tail of long provider failures", async () => {
  const failed = await runLiveAcceptance({
    manifest,
    env: { MY_MATE_LIVE_PROVIDERS: "codex" },
    async execute() {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${"tap prelude\n".repeat(300)}actual provider failure at the end`,
        attemptCount: 1,
      };
    },
  });
  const error = failed.lanes.find((lane) => lane.id === "provider:codex")?.error || "";
  assert.equal(error.length, 2000);
  assert.match(error, /actual provider failure at the end$/);
});

test("live acceptance extracts the actual failure from Node TAP output", async () => {
  const failed = await runLiveAcceptance({
    manifest,
    env: { MY_MATE_LIVE_PROVIDERS: "codex" },
    async execute() {
      return {
        exitCode: 1,
        stdout: [
          "TAP version 13",
          "# Subtest: provider lane",
          "not ok 1 - provider lane",
          "  error: 'Claude Agent SDK timed out after 120000ms.'",
          "1..1",
        ].join("\n"),
        stderr: "",
        attemptCount: 1,
      };
    },
  });
  assert.equal(
    failed.lanes.find((lane) => lane.id === "provider:codex")?.error,
    "Claude Agent SDK timed out after 120000ms.",
  );
});

test("live acceptance records passed, skipped, and digest-only output evidence", async () => {
  const result = await runLiveAcceptance({
    manifest,
    env: {
      MY_MATE_LIVE_PROVIDERS: "codex",
      OPENAI_API_KEY: "configured-key",
      MY_MATE_LIVE_MODEL: "provider-model",
    },
    startedAt: "2026-07-12T00:00:00.000Z",
    completedAt: "2026-07-12T00:00:01.000Z",
    async execute() {
      return {
        exitCode: 0,
        stdout: "native evidence ok",
        stderr: "",
        attemptCount: 2,
        evidence: {
          scenario: "workspace_tool_usage",
          output_verified: true,
          native_evidence_count: 7,
          tool_call_count: 1,
          tool_result_count: 1,
          tool_correlation_verified: true,
          usage_availability: "available",
        },
      };
    },
  });
  assert.equal(result.status, "passed");
  const provider = result.lanes.find((lane) => lane.id === "provider:codex");
  assert.equal(provider?.status, "passed");
  assert.match(provider?.output_digest || "", /^sha256:[a-f0-9]{64}$/);
  assert.equal(provider?.model, "provider-model");
  assert.equal(provider?.attempt_count, 2);
  assert.equal(provider?.evidence?.tool_correlation_verified, true);
  assert.equal(result.lanes.find((lane) => lane.id === "judge:anthropic")?.status, "skipped");
  assert.equal(
    result.lanes.find((lane) => lane.id === "judge:anthropic")?.evaluator_id,
    "model-v1",
  );
});
