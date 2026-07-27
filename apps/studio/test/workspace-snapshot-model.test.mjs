import assert from "node:assert/strict";
import test from "node:test";
import {
  cloneWorkspaceSnapshot,
  isSameWorkspaceRun,
  isSameWorkspaceSession,
  shouldAcceptWorkspaceSnapshot,
} from "../src/workspace-snapshot-model.js";

function snapshot(sessionId, runId, artifactId = "") {
  return {
    session: { session_id: sessionId },
    selected_run_id: runId,
    artifacts: artifactId ? [{ artifact_id: artifactId }] : [],
  };
}

test("workspace snapshots never reuse state across Sessions", () => {
  const alpha = snapshot("session-alpha", "run-alpha", "artifact-alpha");
  const beta = snapshot("session-beta", "run-beta");
  assert.equal(shouldAcceptWorkspaceSnapshot(alpha, beta), false);
  assert.equal(isSameWorkspaceSession(alpha, beta), false);
  assert.equal(isSameWorkspaceRun(alpha, beta), false);
});

test("run-scoped state is reusable only for the same Session and Run", () => {
  const current = snapshot("session-alpha", "run-1", "artifact-1");
  assert.equal(isSameWorkspaceRun(current, snapshot("session-alpha", "run-1")), true);
  assert.equal(isSameWorkspaceRun(current, snapshot("session-alpha", "run-2")), false);
});

test("cached workspace snapshots are detached from live state", () => {
  const live = snapshot("session-alpha", "run-1", "artifact-1");
  const cached = cloneWorkspaceSnapshot(live);
  live.artifacts.push({ artifact_id: "artifact-2" });
  assert.deepEqual(cached.artifacts.map((item) => item.artifact_id), ["artifact-1"]);
});
