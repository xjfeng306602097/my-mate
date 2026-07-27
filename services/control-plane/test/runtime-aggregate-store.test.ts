import assert from "node:assert/strict";
import test from "node:test";
import { assertRuntimeAggregateConsistency } from "../src/runtime/runtime-aggregate-store.js";
import type { NodeRunRecord, RunPlanRecord, RunRecord } from "../src/types.js";

function fixture() {
  const run = { run_id: "run-aggregate", status: "running" } as RunRecord;
  const plan = {
    run_id: run.run_id,
    status: "running",
    compiled_nodes: [{ node_run_id: "node-aggregate", status: "running" }],
  } as RunPlanRecord;
  const nodeRuns = [{ node_run_id: "node-aggregate", run_id: run.run_id, status: "running" }] as NodeRunRecord[];
  return { run, plan, nodeRuns };
}

test("runtime aggregate consistency accepts aligned Run, RunPlan, and NodeRuns", () => {
  const { run, plan, nodeRuns } = fixture();
  assert.doesNotThrow(() => assertRuntimeAggregateConsistency(run, plan, nodeRuns));
});

test("runtime aggregate consistency rejects missing and divergent NodeRuns", () => {
  const { run, plan, nodeRuns } = fixture();
  assert.throws(
    () => assertRuntimeAggregateConsistency(run, plan, []),
    (error: unknown) => (error as { code?: string }).code === "runtime_aggregate_node_cardinality_mismatch",
  );
  nodeRuns[0]!.status = "completed";
  assert.throws(
    () => assertRuntimeAggregateConsistency(run, plan, nodeRuns),
    (error: unknown) => (error as { code?: string }).code === "runtime_aggregate_node_status_mismatch",
  );
});
