import type {
  CompiledNodeRecord,
  NodeRunRecord,
  NodeStatus,
  RunPlanRecord,
} from "./types.js";

function toProgress(status: NodeRunRecord["status"], timestamp: string) {
  if (status === "ready") {
    return {
      percent: 0,
      message: "Ready for dispatch",
      updated_at: timestamp,
    };
  }

  return {
    percent: 0,
    message: "Waiting for dependencies",
    updated_at: timestamp,
  };
}

export function materializeInitialNodeRuns(
  plan: RunPlanRecord,
  timestamp: string,
): NodeRunRecord[] {
  return plan.compiled_nodes.map((node) => ({
    node_run_id: node.node_run_id,
    run_id: plan.run_id,
    status: node.status,
    progress: toProgress(node.status, timestamp),
    attempt: node.retry_policy.attempt,
    started_at: null,
    finished_at: null,
  }));
}

export function getReadyNodeRuns(plan: RunPlanRecord): RunPlanRecord["compiled_nodes"] {
  return plan.compiled_nodes.filter((node) => node.status === "ready");
}

export function recomputeFrontier(plan: RunPlanRecord): void {
  plan.frontier = plan.compiled_nodes
    .filter((node) => node.status === "ready")
    .map((node) => node.node_run_id);
}

export function getCompiledNode(
  plan: RunPlanRecord,
  nodeRunId: string,
): CompiledNodeRecord | undefined {
  return plan.compiled_nodes.find((node) => node.node_run_id === nodeRunId);
}

export function getMutableNodeRun(
  nodeRuns: NodeRunRecord[],
  nodeRunId: string,
): NodeRunRecord | undefined {
  return nodeRuns.find((node) => node.node_run_id === nodeRunId);
}

export function applyNodeStatus(
  plan: RunPlanRecord,
  nodeRuns: NodeRunRecord[],
  nodeRunId: string,
  status: NodeStatus,
  timestamp: string,
  message: string,
  percent: number,
): void {
  const compiledNode = getCompiledNode(plan, nodeRunId);
  const nodeRun = getMutableNodeRun(nodeRuns, nodeRunId);
  if (!compiledNode || !nodeRun) {
    throw new Error(`Node state not found for ${nodeRunId}`);
  }

  const previousStatus = nodeRun.status;
  compiledNode.status = status;
  nodeRun.status = status;
  nodeRun.progress = {
    percent,
    message,
    updated_at: timestamp,
  };

  if (status === "running" && previousStatus !== "running") {
    nodeRun.attempt += 1;
    compiledNode.retry_policy.attempt = nodeRun.attempt;
    nodeRun.started_at = nodeRun.started_at ?? timestamp;
  }

  if (status === "completed" || status === "failed" || status === "cancelled") {
    nodeRun.finished_at = timestamp;
  }

  recomputeFrontier(plan);
}

export function unlockReadyNodeRuns(
  plan: RunPlanRecord,
  nodeRuns: NodeRunRecord[],
  timestamp: string,
): CompiledNodeRecord[] {
  const compiledByNodeId = new Map(plan.compiled_nodes.map((node) => [node.node_id, node]));
  const nodeRunById = new Map(nodeRuns.map((nodeRun) => [nodeRun.node_run_id, nodeRun]));
  const unlocked: CompiledNodeRecord[] = [];

  for (const compiledNode of plan.compiled_nodes) {
    const nodeRun = nodeRunById.get(compiledNode.node_run_id);
    if (!nodeRun || nodeRun.status !== "pending") {
      continue;
    }

    const inboundEdges = plan.edges.filter((edge) => edge.to === compiledNode.node_id);
    const allDependenciesCompleted = inboundEdges.every((edge) => {
      const dependency = compiledByNodeId.get(edge.from);
      if (!dependency) {
        return false;
      }
      const dependencyRun = nodeRunById.get(dependency.node_run_id);
      return ["completed", "skipped"].includes(dependencyRun?.status ?? "");
    });

    if (!allDependenciesCompleted) {
      continue;
    }

    compiledNode.status = "ready";
    nodeRun.status = "ready";
    nodeRun.progress = {
      percent: 0,
      message: "Ready for dispatch",
      updated_at: timestamp,
    };
    unlocked.push(compiledNode);
  }

  recomputeFrontier(plan);
  return unlocked;
}

export function areAllNodesCompleted(nodeRuns: NodeRunRecord[]): boolean {
  return (
    nodeRuns.length > 0 &&
    nodeRuns.every((nodeRun) =>
      ["completed", "skipped", "cancelled"].includes(nodeRun.status),
    )
  );
}
