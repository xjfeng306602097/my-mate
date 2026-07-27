import assert from "node:assert/strict";
import test from "node:test";
import { LIFECYCLE_STATUSES, genericStatusTone, lifecycleExecutionState, lifecycleStatusTone } from "../src/lifecycle-status-model.js";

test("every Studio lifecycle status has an explicit domain projection", () => {
  for (const [domain, statuses] of Object.entries(LIFECYCLE_STATUSES)) {
    for (const status of statuses) {
      assert.match(lifecycleExecutionState(domain, status), /^(not_started|active|waiting|successful|unsuccessful)$/u);
      assert.match(lifecycleStatusTone(domain, status), /^(neutral|warn|success|danger)$/u);
    }
  }
});

test("active work is never projected as successful", () => {
  for (const domain of ["run", "node", "session", "agent_dag", "agent_task", "agent_run"]) {
    assert.equal(lifecycleExecutionState(domain, "running"), "active");
    assert.equal(lifecycleStatusTone(domain, "running"), "warn");
  }
  assert.equal(genericStatusTone("running"), "warn");
});

test("successful and unsuccessful terminal states remain distinct", () => {
  assert.equal(lifecycleStatusTone("node", "skipped"), "success");
  assert.equal(lifecycleStatusTone("run", "completed"), "success");
  assert.equal(lifecycleStatusTone("agent_run", "failed"), "danger");
  assert.equal(lifecycleStatusTone("session", "cancelled"), "danger");
  assert.equal(lifecycleExecutionState("run", "unknown"), "not_started");
});
