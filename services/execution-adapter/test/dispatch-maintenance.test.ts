import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDispatchMaintenance,
  normalizeDispatchSessionKey,
} from "../src/dispatch-maintenance.js";
import { createDispatchRecord } from "./helpers.js";

test("normalizes async direct-agent session key suffix to lower-case", () => {
  const record = createDispatchRecord();
  const normalized = normalizeDispatchSessionKey(record);
  assert.equal(
    normalized,
    "agent:backend:explicit:bridge-disp_test_001",
  );
});

test("maintenance aligns non-terminal status with last reported terminal state", () => {
  const record = createDispatchRecord({
    status: "running",
    last_reported_status: "failed",
    last_error: "already reported failure",
  });

  const decision = evaluateDispatchMaintenance(record);
  assert.equal(decision.action, "align_terminal");
  assert.equal(decision.terminalStatus, "failed");
  assert.match(decision.reason, /terminal status/i);
});

test("maintenance finalizes stale failed launch records", () => {
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

  const decision = evaluateDispatchMaintenance(
    record,
    Date.parse("2026-06-07T08:10:30.000Z"),
  );
  assert.equal(decision.action, "finalize");
  assert.equal(decision.terminalStatus, "failed");
  assert.equal(decision.errorCode, "OPENCLAW_DIRECT_AGENT_STALE_FAILED_LAUNCH");
});

test("maintenance resumes unfinished async dispatches without terminal drift", () => {
  const record = createDispatchRecord({
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
    last_reported_status: "running",
    last_polled_at: "2026-06-07T08:05:00.000Z",
  });

  const decision = evaluateDispatchMaintenance(
    record,
    Date.parse("2026-06-07T08:06:00.000Z"),
  );
  assert.equal(decision.action, "resume");
  assert.equal(decision.terminalStatus, null);
});
