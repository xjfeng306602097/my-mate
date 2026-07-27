import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_DAG_LIFECYCLE,
  LifecycleTransitionError,
  NODE_LIFECYCLE,
  RUN_LIFECYCLE,
  assertLifecycleTransition,
  canTransitionLifecycle,
  parseLifecycleStatus,
  projectLifecycleStatus,
} from "../dist/domain-lifecycle.js";

test("lifecycle definitions distinguish normal and recovery transitions", () => {
  assert.equal(canTransitionLifecycle(RUN_LIFECYCLE, "running", "completed"), true);
  assert.equal(canTransitionLifecycle(RUN_LIFECYCLE, "queued", "waiting_human"), true);
  assert.equal(canTransitionLifecycle(NODE_LIFECYCLE, "ready", "waiting_human"), true);
  assert.equal(canTransitionLifecycle(NODE_LIFECYCLE, "waiting_human", "ready"), true);
  assert.equal(canTransitionLifecycle(NODE_LIFECYCLE, "ready", "failed"), true);
  assert.equal(canTransitionLifecycle(RUN_LIFECYCLE, "completed", "running"), false);
  assert.equal(canTransitionLifecycle(RUN_LIFECYCLE, "failed", "running"), false);
  assert.equal(canTransitionLifecycle(RUN_LIFECYCLE, "failed", "running", { recovery: true }), true);
  assert.throws(
    () => assertLifecycleTransition(AGENT_DAG_LIFECYCLE, "completed", "running"),
    LifecycleTransitionError,
  );
});

test("lifecycle parsers reject unknown persisted values", () => {
  assert.equal(parseLifecycleStatus(NODE_LIFECYCLE, "waiting_human"), "waiting_human");
  assert.throws(
    () => parseLifecycleStatus(NODE_LIFECYCLE, "done"),
    (error) => error.code === "invalid_lifecycle_status" && /Unknown Node status/.test(error.message),
  );
});

test("UI execution projection never treats running as successful", () => {
  assert.equal(projectLifecycleStatus(RUN_LIFECYCLE, "draft"), "not_started");
  assert.equal(projectLifecycleStatus(RUN_LIFECYCLE, "running"), "active");
  assert.equal(projectLifecycleStatus(RUN_LIFECYCLE, "waiting_human"), "waiting");
  assert.equal(projectLifecycleStatus(RUN_LIFECYCLE, "completed"), "successful");
  assert.equal(projectLifecycleStatus(RUN_LIFECYCLE, "failed"), "unsuccessful");
});
