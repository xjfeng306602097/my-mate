import { appendRunEvent } from "./event-store.js";
import {
  applyNodeStatus,
  areAllNodesCompleted,
  getCompiledNode,
  getMutableNodeRun,
  recomputeFrontier,
  unlockReadyNodeRuns,
} from "./node-scheduler.js";
import { listNodeRuns, saveNodeRuns } from "./node-run-store.js";
import { getRun, saveRun } from "./run-store.js";
import { getRunPlan, saveRunPlan } from "./run-plan-store.js";
import type { CompiledNodeRecord, NodeStatus, RunStatus } from "./types.js";
import { nowIso } from "./utils.js";

export type RunAction = "pause" | "resume" | "cancel";
export type NodeAction = "retry" | "skip";

function isTerminalRunStatus(status: RunStatus): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

function isTerminalNodeStatus(status: NodeStatus): boolean {
  return ["completed", "failed", "skipped", "cancelled"].includes(status);
}

function ensureRunState(runId: string) {
  const run = getRun(runId);
  const plan = getRunPlan(runId);
  const nodeRuns = listNodeRuns(runId);
  if (!run || !plan) {
    throw new Error("RUN_NOT_FOUND");
  }
  return { run, plan, nodeRuns };
}

function recordRunActionEvent(
  runId: string,
  type: "run.paused" | "run.resumed" | "run.cancelled",
  actorId: string,
  payload: Record<string, unknown>,
  createdAt: string,
) {
  return appendRunEvent({
    run_id: runId,
    type,
    actor_type: "operator",
    actor_id: actorId,
    payload,
    created_at: createdAt,
  });
}

function updateCancelledNodeStatuses(
  runId: string,
  nodeRuns: ReturnType<typeof listNodeRuns>,
  timestamp: string,
): void {
  for (const nodeRun of nodeRuns) {
    if (isTerminalNodeStatus(nodeRun.status)) {
      continue;
    }

    nodeRun.status = "cancelled";
    nodeRun.progress = {
      percent: nodeRun.progress.percent,
      message: "Cancelled",
      updated_at: timestamp,
    };
    nodeRun.finished_at = timestamp;
  }
  saveNodeRuns(runId, nodeRuns);
}

export function applyRunAction(
  runId: string,
  action: RunAction,
  actorId = "operator",
): { run_id: string; status: RunStatus } {
  const { run, plan, nodeRuns } = ensureRunState(runId);
  const timestamp = nowIso();

  if (action === "pause") {
    if (run.status !== "running") {
      throw new Error("INVALID_RUN_STATE");
    }

    const event = recordRunActionEvent(runId, "run.paused", actorId, {}, timestamp);
    run.status = "paused";
    run.current_summary = "Run paused";
    run.updated_at = timestamp;
    run.last_event_id = event.event_id;
    plan.status = "paused";
    saveRun(run);
    saveRunPlan(plan);
    return { run_id: run.run_id, status: run.status };
  }

  if (action === "resume") {
    if (run.status !== "paused") {
      throw new Error("INVALID_RUN_STATE");
    }

    const event = recordRunActionEvent(runId, "run.resumed", actorId, {}, timestamp);
    run.status = "running";
    run.current_summary = "Run resumed";
    run.updated_at = timestamp;
    run.last_event_id = event.event_id;
    plan.status = "running";
    saveRun(run);
    saveRunPlan(plan);
    return { run_id: run.run_id, status: run.status };
  }

  if (isTerminalRunStatus(run.status)) {
    throw new Error("INVALID_RUN_STATE");
  }

  const event = recordRunActionEvent(runId, "run.cancelled", actorId, {}, timestamp);
  run.status = "cancelled";
  run.current_summary = "Run cancelled";
  run.updated_at = timestamp;
  run.finished_at = timestamp;
  run.last_event_id = event.event_id;
  plan.status = "cancelled";
  recomputeFrontier(plan);
  saveRun(run);
  saveRunPlan(plan);
  updateCancelledNodeStatuses(runId, nodeRuns, timestamp);
  return { run_id: run.run_id, status: run.status };
}

function resetCompiledNodeForRetry(node: CompiledNodeRecord): void {
  node.status = "ready";
  node.execution_ref = {
    openclaw_task_id: null,
    openclaw_session_id: null,
  };
}

export function applyNodeAction(
  runId: string,
  nodeRunId: string,
  action: NodeAction,
  actorId = "operator",
): { run_id: string; node_run_id: string; status: NodeStatus } {
  const { run, plan, nodeRuns } = ensureRunState(runId);
  const timestamp = nowIso();
  const node = getCompiledNode(plan, nodeRunId);
  const nodeRun = getMutableNodeRun(nodeRuns, nodeRunId);

  if (!node || !nodeRun) {
    throw new Error("NODE_NOT_FOUND");
  }

  if (action === "retry") {
    if (!["failed", "cancelled"].includes(nodeRun.status)) {
      throw new Error("INVALID_NODE_STATE");
    }

    resetCompiledNodeForRetry(node);
    node.retry_policy.attempt = nodeRun.attempt;
    nodeRun.status = "ready";
    nodeRun.progress = {
      percent: 0,
      message: "Ready for retry",
      updated_at: timestamp,
    };
    nodeRun.started_at = null;
    nodeRun.finished_at = null;
    recomputeFrontier(plan);

    const event = appendRunEvent({
      run_id: runId,
      node_run_id: nodeRunId,
      type: "node.ready",
      actor_type: "operator",
      actor_id: actorId,
      payload: {
        node_id: node.node_id,
        reason: "manual_retry",
      },
      created_at: timestamp,
    });

    run.status = "running";
    run.current_summary = `Node queued for retry: ${node.name}`;
    run.updated_at = timestamp;
    run.blocked_reason = null;
    run.waiting_reason = null;
    run.finished_at = null;
    run.last_event_id = event.event_id;
    plan.status = "running";
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(runId, nodeRuns);
    return { run_id: run.run_id, node_run_id: nodeRunId, status: nodeRun.status };
  }

  if (!["pending", "ready", "waiting_human", "failed"].includes(nodeRun.status)) {
    throw new Error("INVALID_NODE_STATE");
  }

  applyNodeStatus(plan, nodeRuns, nodeRunId, "skipped", timestamp, "Node skipped", 100);
  const skippedEvent = appendRunEvent({
    run_id: runId,
    node_run_id: nodeRunId,
    type: "node.skipped",
    actor_type: "operator",
    actor_id: actorId,
    payload: {
      node_id: node.node_id,
      node_name: node.name,
    },
    created_at: timestamp,
  });

  const unlockedNodes = unlockReadyNodeRuns(plan, nodeRuns, timestamp);
  let lastEventId = skippedEvent.event_id;
  for (const unlockedNode of unlockedNodes) {
    const readyEvent = appendRunEvent({
      run_id: runId,
      node_run_id: unlockedNode.node_run_id,
      type: "node.ready",
      actor_type: "system",
      actor_id: "scheduler",
      payload: {
        node_id: unlockedNode.node_id,
        node_name: unlockedNode.name,
        node_type: unlockedNode.type,
      },
      created_at: timestamp,
    });
    lastEventId = readyEvent.event_id;
  }

  if (areAllNodesCompleted(nodeRuns)) {
    const completedEvent = appendRunEvent({
      run_id: runId,
      type: "run.completed",
      actor_type: "system",
      actor_id: "control-plane",
      payload: {
        completed_nodes: nodeRuns.length,
      },
      created_at: timestamp,
    });
    run.status = "completed";
    run.current_summary = "Run completed";
    run.finished_at = timestamp;
    run.last_event_id = completedEvent.event_id;
    lastEventId = completedEvent.event_id;
    plan.status = "completed";
  } else if (run.status === "paused") {
    run.current_summary = "Run paused";
    run.last_event_id = lastEventId;
  } else {
    run.status = "running";
    run.current_summary =
      unlockedNodes.length > 0
        ? `${unlockedNodes.length} downstream node(s) unlocked`
        : `Node skipped: ${node.name}`;
    run.last_event_id = lastEventId;
    plan.status = "running";
  }

  run.updated_at = timestamp;
  saveRun(run);
  saveRunPlan(plan);
  saveNodeRuns(runId, nodeRuns);
  return { run_id: run.run_id, node_run_id: nodeRunId, status: nodeRun.status };
}
