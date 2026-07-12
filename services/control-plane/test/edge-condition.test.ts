import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateEdgeCondition,
  outcomeFromHandoffPort,
  routingPortsMatch,
  type EdgeConditionContext,
} from "../src/runtime/edge-condition.js";

const context: EdgeConditionContext = {
  outcome: { status: "completed" },
  handoff: {
    port: "success",
    content: { score: 92, labels: ["verified", "release"] },
    content_ref: null,
    summary: "Quality gate passed",
  },
  error: null,
  source: {
    node_id: "review",
    node_run_id: "node-run-review",
    name: "Review",
    attempt: 1,
  },
  run: {
    run_id: "run-condition",
    status: "running",
  },
};

test("edge condition evaluates lifecycle kinds and port aliases", () => {
  assert.equal(evaluateEdgeCondition({ kind: "on_success" }, context).matched, true);
  assert.equal(evaluateEdgeCondition({ kind: "on_failure" }, context).matched, false);
  assert.equal(routingPortsMatch("done", "success"), true);
  assert.equal(routingPortsMatch("error", "failure"), true);
  assert.equal(outcomeFromHandoffPort("rejected"), "failed");
});

test("edge condition evaluates bounded structured predicates", () => {
  const result = evaluateEdgeCondition({
    all: [
      { path: "handoff.content.score", op: "gte", value: 90 },
      { path: "handoff.content.labels", op: "contains", value: "verified" },
      { path: "error", op: "eq", value: null },
    ],
  }, context);
  assert.deepEqual(result, {
    matched: true,
    valid: true,
    reason: "all",
    observed_path: null,
    observed_value: null,
  });

  assert.equal(
    evaluateEdgeCondition({ path: "handoff.summary", op: "contains", value: "passed" }, context).matched,
    true,
  );
});

test("edge condition fails closed for invalid shapes and unsafe paths", () => {
  assert.equal(evaluateEdgeCondition({ script: "return true" }, context).valid, false);
  assert.equal(
    evaluateEdgeCondition({ kind: "always", script: "return true" }, context).valid,
    false,
  );
  assert.equal(
    evaluateEdgeCondition({ all: [{ kind: "always" }], fallback: true }, context).valid,
    false,
  );
  assert.equal(
    evaluateEdgeCondition({ path: "handoff.__proto__.polluted", op: "exists" }, context).matched,
    false,
  );
  assert.equal(
    evaluateEdgeCondition({ path: "handoff.content.score", op: "in", value: "92" }, context).valid,
    false,
  );
});
