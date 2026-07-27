import { saveNodeRuns } from "../node-run-store.js";
import { saveRunPlan } from "../run-plan-store.js";
import { saveRun } from "../run-store.js";
import { runJsonStorageTransaction } from "../storage-backend.js";
import type { NodeRunRecord, RunPlanRecord, RunRecord } from "../types.js";
import { DomainError } from "../domain-error.js";

function aggregateError(code: string, message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError({
    code,
    message,
    httpStatus: 409,
    retryable: false,
    severity: "critical",
    remediation: "Restore the Run, RunPlan, and NodeRun aggregate from one consistent checkpoint before retrying.",
    domain: "runtime",
    details,
  });
}

export interface RuntimeAggregateSaveOptions {
  recovery?: boolean;
}

export function assertRuntimeAggregateConsistency(
  run: RunRecord,
  plan: RunPlanRecord,
  nodeRuns: NodeRunRecord[],
): void {
  if (run.run_id !== plan.run_id) {
    throw aggregateError("runtime_aggregate_run_id_mismatch", "Run and RunPlan identifiers do not match.", { run_id: run.run_id, plan_run_id: plan.run_id });
  }
  const nodeRunById = new Map(nodeRuns.map((nodeRun) => [nodeRun.node_run_id, nodeRun]));
  if (nodeRunById.size !== nodeRuns.length) {
    throw aggregateError("runtime_aggregate_duplicate_node_run", "Runtime aggregate contains duplicate NodeRun identifiers.");
  }
  if (plan.compiled_nodes.length !== nodeRuns.length) {
    throw aggregateError("runtime_aggregate_node_cardinality_mismatch", "RunPlan and NodeRun cardinality do not match.", { plan_nodes: plan.compiled_nodes.length, node_runs: nodeRuns.length });
  }
  for (const node of plan.compiled_nodes) {
    const nodeRun = nodeRunById.get(node.node_run_id);
    if (!nodeRun || nodeRun.run_id !== run.run_id) {
      throw aggregateError("runtime_aggregate_node_run_mismatch", `NodeRun ${node.node_run_id} is missing or belongs to another Run.`, { node_run_id: node.node_run_id });
    }
    if (node.status !== nodeRun.status) {
      throw aggregateError("runtime_aggregate_node_status_mismatch", `Node ${node.node_run_id} status differs between RunPlan and NodeRun.`, { node_run_id: node.node_run_id, plan_status: node.status, node_run_status: nodeRun.status });
    }
  }
}

export function saveRuntimeAggregate(
  run: RunRecord,
  plan: RunPlanRecord,
  nodeRuns: NodeRunRecord[],
  options: RuntimeAggregateSaveOptions = {},
): { run: RunRecord; plan: RunPlanRecord; nodeRuns: NodeRunRecord[] } {
  assertRuntimeAggregateConsistency(run, plan, nodeRuns);
  return runJsonStorageTransaction(() => ({
    run: saveRun(run, options),
    plan: saveRunPlan(plan, options),
    nodeRuns: saveNodeRuns(run.run_id, nodeRuns, options),
  }));
}
