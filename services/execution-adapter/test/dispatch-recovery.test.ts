import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAsyncDispatchRecovery } from "../src/dispatch-recovery.js";
import { evaluateAsyncDispatchStaleness, shouldResumeAsyncDispatch } from "../src/async-dispatch-guard.js";
import { createDispatchRecord } from "./helpers.js";

test("should resume unfinished async direct-agent dispatches", () => {
  const record = createDispatchRecord();
  assert.equal(shouldResumeAsyncDispatch(record), true);

  const completed = createDispatchRecord({ status: "completed" });
  assert.equal(shouldResumeAsyncDispatch(completed), false);
});

test("dispatch recovery finalizes stale failed launch records", () => {
  const record = createDispatchRecord({
    last_polled_at: "2026-06-07T08:00:00.000Z",
    updated_at: "2026-06-07T08:00:00.000Z",
    direct_agent: {
      attempted: true,
      sessionId: "bridge-disp_test_001",
      sessionKey: "agent:backend:explicit:bridge-disp_test_001",
      sessionFile: null,
      runId: null,
      taskId: null,
      stdout: "",
      stderr: "FallbackSummaryError: all providers failed after timeout",
      exitCode: 1,
      completionText: null,
      reportText: null,
      mode: "async-task",
    },
  });

  const decision = evaluateAsyncDispatchRecovery(
    record,
    Date.parse("2026-06-07T08:10:30.000Z"),
  );

  assert.deepEqual(decision.action, "finalize");
  if (decision.action === "finalize") {
    assert.equal(decision.status, "failed");
    assert.equal(decision.errorCode, "OPENCLAW_DIRECT_AGENT_STALE_FAILED_LAUNCH");
  }
});

test("dispatch recovery finalizes long-running stale async records", () => {
  const record = createDispatchRecord({
    poll_started_at: "2026-06-07T08:00:00.000Z",
    last_polled_at: "2026-06-07T08:05:00.000Z",
    direct_agent: {
      attempted: true,
      sessionId: "bridge-disp_test_001",
      sessionKey: "agent:backend:explicit:bridge-disp_test_001",
      sessionFile: null,
      runId: null,
      taskId: null,
      stdout: "",
      stderr: "",
      exitCode: 0,
      completionText: null,
      reportText: null,
      mode: "async-task",
    },
  });

  const decision = evaluateAsyncDispatchRecovery(
    record,
    Date.parse("2026-06-07T08:40:30.000Z"),
  );

  assert.deepEqual(decision.action, "finalize");
  if (decision.action === "finalize") {
    assert.equal(decision.status, "failed");
    assert.equal(decision.errorCode, "OPENCLAW_DIRECT_AGENT_STALE_DISPATCH");
  }
});

test("staleness guard finalizes immediate non-zero launcher exits", () => {
  const record = createDispatchRecord({
    direct_agent: {
      attempted: true,
      sessionId: "bridge-disp_test_001",
      sessionKey: "agent:backend:explicit:bridge-disp_test_001",
      sessionFile: null,
      runId: null,
      taskId: null,
      stdout: "",
      stderr: "token is expired",
      exitCode: 1,
      completionText: null,
      reportText: null,
      mode: "async-task",
    },
  });

  const decision = evaluateAsyncDispatchStaleness(record);
  assert.equal(decision.shouldFinalizeAsFailed, true);
  assert.equal(decision.code, "OPENCLAW_DIRECT_AGENT_START_FAILED");
});
