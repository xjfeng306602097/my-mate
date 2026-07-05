import { LOCAL_EXECUTION_STEP_DELAY_MS } from "./config.js";
import type { NodeAction, RunAction } from "./control-actions.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import {
  buildAcceptedReport,
  buildCompletedReport,
  buildDispatchEnvelope,
  buildFailedReport,
  buildProgressReport,
} from "./adapter-contracts.js";
import { appendRunEvent } from "./event-store.js";
import {
  applyNodeStatus,
  areAllNodesCompleted,
  getReadyNodeRuns,
  recomputeFrontier,
  unlockReadyNodeRuns,
} from "./node-scheduler.js";
import { listNodeRuns, saveNodeRuns } from "./node-run-store.js";
import { getRun, saveRun } from "./run-store.js";
import { getRunPlan, saveRunPlan } from "./run-plan-store.js";
import type {
  AdapterDispatchResult,
  DispatchEnvelope,
  ExecutionMaintenanceResult,
  NormalizedExecutionReport,
} from "./types.js";
import { generateEventId, isPlainObject, nowIso } from "./utils.js";

const activeRuns = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildLocalExecutionRef(nodeRunId: string) {
  return {
    openclaw_task_id: `local-task-${nodeRunId}`,
    openclaw_session_id: `local-session-${nodeRunId}`,
  };
}

function buildLocalDispatchResult(nodeRunId: string): AdapterDispatchResult {
  return {
    dispatch_id: `disp_${generateEventId()}`,
    openclaw_task_id: `local-task-${nodeRunId}`,
    openclaw_session_id: `local-session-${nodeRunId}`,
    status: "accepted",
  };
}

function resolveStepDelayMs(nodeInputPayload: Record<string, unknown>): number {
  const nodeConfig = nodeInputPayload.node_config;
  if (
    isPlainObject(nodeConfig) &&
    typeof nodeConfig.simulated_step_delay_ms === "number" &&
    Number.isFinite(nodeConfig.simulated_step_delay_ms) &&
    nodeConfig.simulated_step_delay_ms >= 0
  ) {
    return nodeConfig.simulated_step_delay_ms;
  }

  return LOCAL_EXECUTION_STEP_DELAY_MS;
}

function resolveSimulatedFailureCount(nodeInputPayload: Record<string, unknown>): number {
  const nodeConfig = nodeInputPayload.node_config;
  if (
    isPlainObject(nodeConfig) &&
    typeof nodeConfig.simulated_failure_count === "number" &&
    Number.isFinite(nodeConfig.simulated_failure_count) &&
    nodeConfig.simulated_failure_count >= 0
  ) {
    return nodeConfig.simulated_failure_count;
  }

  return 0;
}

async function waitForExecutableState(
  runId: string,
): Promise<"continue" | "cancelled" | "missing"> {
  while (true) {
    const run = getRun(runId);
    if (!run) {
      return "missing";
    }

    if (run.status === "cancelled") {
      return "cancelled";
    }

    if (run.status === "paused") {
      await sleep(50);
      continue;
    }

    return "continue";
  }
}

function loadExecutionState(runId: string) {
  const run = getRun(runId);
  const plan = getRunPlan(runId);
  const nodeRuns = listNodeRuns(runId);
  if (!run || !plan) {
    return null;
  }
  return { run, plan, nodeRuns };
}

async function failRun(runId: string, reason: string): Promise<void> {
  const run = getRun(runId);
  const plan = getRunPlan(runId);
  if (!run || !plan) {
    return;
  }

  const timestamp = nowIso();
  const failedEvent = appendRunEvent({
    run_id: runId,
    type: "run.failed",
    actor_type: "system",
    actor_id: "local-execution-engine",
    payload: {
      reason,
    },
    created_at: timestamp,
  });

  run.status = "failed";
  run.current_summary = reason;
  run.blocked_reason = reason;
  run.finished_at = timestamp;
  run.updated_at = timestamp;
  run.last_event_id = failedEvent.event_id;
  saveRun(run);

  plan.status = "failed";
  recomputeFrontier(plan);
  saveRunPlan(plan);
}

async function applyNormalizedReport(report: NormalizedExecutionReport): Promise<void> {
  const run = getRun(report.run_id);
  const plan = getRunPlan(report.run_id);
  const nodeRuns = listNodeRuns(report.run_id);
  if (!run || !plan) {
    return;
  }

  const node = plan.compiled_nodes.find((item) => item.node_run_id === report.node_run_id);
  const nodeRun = nodeRuns.find((item) => item.node_run_id === report.node_run_id);
  if (!node || !nodeRun) {
    return;
  }

  if (report.status === "accepted") {
    node.execution_ref = {
      openclaw_task_id: report.raw_ref.openclaw_task_id,
      openclaw_session_id: report.raw_ref.openclaw_session_id,
    };
    saveRunPlan(plan);
    return;
  }

  if (report.status === "running") {
    applyNodeStatus(
      plan,
      nodeRuns,
      report.node_run_id,
      "running",
      report.created_at,
      report.progress.message,
      report.progress.percent,
    );
    run.status = run.status === "queued" ? "running" : run.status;
    run.started_at = run.started_at ?? report.created_at;
    run.current_summary = report.progress.message;
    run.updated_at = report.created_at;
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(report.run_id, nodeRuns);
    return;
  }

  if (report.status === "failed") {
    applyNodeStatus(
      plan,
      nodeRuns,
      report.node_run_id,
      "failed",
      report.created_at,
      report.error?.message || "Node failed",
      report.progress.percent,
    );
    run.status = "failed";
    run.current_summary = report.error?.message || "Node failed";
    run.blocked_reason = report.error?.message || "Node failed";
    run.updated_at = report.created_at;
    run.finished_at = report.created_at;
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(report.run_id, nodeRuns);
    return;
  }

  if (report.status === "completed") {
    applyNodeStatus(
      plan,
      nodeRuns,
      report.node_run_id,
      "completed",
      report.created_at,
      report.progress.message,
      report.progress.percent,
    );
    saveRunPlan(plan);
    saveNodeRuns(report.run_id, nodeRuns);
  }
}

async function executeReadyNode(runId: string, nodeRunId: string): Promise<void> {
  const initialState = loadExecutionState(runId);
  if (!initialState) {
    throw new Error("Run state missing during execution");
  }
  let { run, plan, nodeRuns } = initialState;
  if (run.status === "paused" || run.status === "cancelled") {
    return;
  }

  const node = plan.compiled_nodes.find((item) => item.node_run_id === nodeRunId);
  if (!node) {
    throw new Error(`Compiled node not found: ${nodeRunId}`);
  }
  const dispatchEnvelope = buildDispatchEnvelope(run, plan, node);
  const dispatchResult = buildLocalDispatchResult(nodeRunId);
  const stepDelayMs = resolveStepDelayMs(node.input_payload);
  const simulatedFailureCount = resolveSimulatedFailureCount(node.input_payload);

  const startTime = nowIso();
  if (run.status === "queued") {
    const runStartedEvent = appendRunEvent({
      run_id: runId,
      type: "run.started",
      actor_type: "system",
      actor_id: "local-execution-engine",
      payload: {
        node_run_id: nodeRunId,
      },
      created_at: startTime,
    });

    run.status = "running";
    plan.status = "running";
    run.started_at = run.started_at ?? startTime;
    run.updated_at = startTime;
    run.current_summary = `Running node: ${node.name}`;
    run.last_event_id = runStartedEvent.event_id;
  } else {
    plan.status = "running";
    run.current_summary = `Running node: ${node.name}`;
    run.updated_at = startTime;
  }

  applyNodeStatus(plan, nodeRuns, nodeRunId, "running", startTime, "Node is running", 10);
  node.execution_ref = buildLocalExecutionRef(nodeRunId);
  await applyNormalizedReport(buildAcceptedReport(dispatchEnvelope, dispatchResult));
  const nodeStartedEvent = appendRunEvent({
    run_id: runId,
    node_run_id: nodeRunId,
    type: "node.started",
    actor_type: "system",
    actor_id: "local-adapter",
    payload: {
      node_id: node.node_id,
      node_name: node.name,
      execution_ref: node.execution_ref,
    },
    created_at: startTime,
  });
  run.last_event_id = nodeStartedEvent.event_id;
  saveRun(run);
  saveRunPlan(plan);
  saveNodeRuns(runId, nodeRuns);

  await sleep(stepDelayMs);

  const stateAfterStart = await waitForExecutableState(runId);
  if (stateAfterStart !== "continue") {
    return;
  }

  const reloadedAfterStart = loadExecutionState(runId);
  if (!reloadedAfterStart) {
    return;
  }
  ({ run, plan, nodeRuns } = reloadedAfterStart);
  const reloadedNodeAfterStart = plan.compiled_nodes.find((item) => item.node_run_id === nodeRunId);
  const reloadedNodeRunAfterStart = nodeRuns.find((item) => item.node_run_id === nodeRunId);
  if (!reloadedNodeAfterStart || !reloadedNodeRunAfterStart) {
    return;
  }
  if (reloadedNodeRunAfterStart.status !== "running") {
    return;
  }

  const progressTime = nowIso();
  await applyNormalizedReport(
    buildProgressReport({
      envelope: dispatchEnvelope,
      dispatch: dispatchResult,
      percent: 60,
      message: `Processing node: ${reloadedNodeAfterStart.name}`,
    }),
  );
  const nodeProgressEvent = appendRunEvent({
    run_id: runId,
    node_run_id: nodeRunId,
    type: "node.progress",
    actor_type: "system",
    actor_id: "local-adapter",
    payload: {
      node_id: reloadedNodeAfterStart.node_id,
      percent: 60,
      message: `Processing node: ${reloadedNodeAfterStart.name}`,
    },
    created_at: progressTime,
  });
  applyNodeStatus(
    plan,
    nodeRuns,
    nodeRunId,
    "running",
    progressTime,
    "Node is processing",
    60,
  );
  run.updated_at = progressTime;
  run.last_event_id = nodeProgressEvent.event_id;
  saveRun(run);
  saveRunPlan(plan);
  saveNodeRuns(runId, nodeRuns);

  await sleep(stepDelayMs);

  const stateAfterProgress = await waitForExecutableState(runId);
  if (stateAfterProgress !== "continue") {
    return;
  }

  const reloadedAfterProgress = loadExecutionState(runId);
  if (!reloadedAfterProgress) {
    return;
  }
  ({ run, plan, nodeRuns } = reloadedAfterProgress);
  const reloadedNodeAfterProgress = plan.compiled_nodes.find(
    (item) => item.node_run_id === nodeRunId,
  );
  const reloadedNodeRunAfterProgress = nodeRuns.find(
    (item) => item.node_run_id === nodeRunId,
  );
  if (!reloadedNodeAfterProgress || !reloadedNodeRunAfterProgress) {
    return;
  }
  if (reloadedNodeRunAfterProgress.status !== "running") {
    return;
  }

  const progressTime2 = nowIso();
  await applyNormalizedReport(
    buildProgressReport({
      envelope: dispatchEnvelope,
      dispatch: dispatchResult,
      percent: 85,
      message: `Finalizing node: ${reloadedNodeAfterProgress.name}`,
    }),
  );
  const nodeProgressEvent2 = appendRunEvent({
    run_id: runId,
    node_run_id: nodeRunId,
    type: "node.progress",
    actor_type: "system",
    actor_id: "local-adapter",
    payload: {
      node_id: reloadedNodeAfterProgress.node_id,
      percent: 85,
      message: `Finalizing node: ${reloadedNodeAfterProgress.name}`,
    },
    created_at: progressTime2,
  });
  applyNodeStatus(
    plan,
    nodeRuns,
    nodeRunId,
    "running",
    progressTime2,
    "Node is finalizing",
    85,
  );
  run.updated_at = progressTime2;
  run.last_event_id = nodeProgressEvent2.event_id;
  saveRun(run);
  saveRunPlan(plan);
  saveNodeRuns(runId, nodeRuns);

  await sleep(stepDelayMs);

  const stateBeforeFinish = await waitForExecutableState(runId);
  if (stateBeforeFinish !== "continue") {
    return;
  }

  const reloadedBeforeFinish = loadExecutionState(runId);
  if (!reloadedBeforeFinish) {
    return;
  }
  ({ run, plan, nodeRuns } = reloadedBeforeFinish);
  const reloadedNodeBeforeFinish = plan.compiled_nodes.find(
    (item) => item.node_run_id === nodeRunId,
  );
  const reloadedNodeRunBeforeFinish = nodeRuns.find(
    (item) => item.node_run_id === nodeRunId,
  );
  if (!reloadedNodeBeforeFinish || !reloadedNodeRunBeforeFinish) {
    return;
  }
  if (reloadedNodeRunBeforeFinish.status !== "running") {
    return;
  }

  if (reloadedNodeRunBeforeFinish.attempt <= simulatedFailureCount) {
    await applyNormalizedReport(
      buildFailedReport({
        envelope: dispatchEnvelope,
        dispatch: dispatchResult,
        code: "SIMULATED_FAILURE",
        message: `Node failed: ${reloadedNodeBeforeFinish.name}`,
      }),
    );
    const failTime = nowIso();
    applyNodeStatus(
      plan,
      nodeRuns,
      nodeRunId,
      "failed",
      failTime,
      "Node failed",
      100,
    );
    const nodeFailedEvent = appendRunEvent({
      run_id: runId,
      node_run_id: nodeRunId,
      type: "node.failed",
      actor_type: "system",
      actor_id: "local-adapter",
      payload: {
        node_id: reloadedNodeBeforeFinish.node_id,
        node_name: reloadedNodeBeforeFinish.name,
        execution_ref: reloadedNodeBeforeFinish.execution_ref,
      },
      created_at: failTime,
    });

    run.status = "failed";
    run.current_summary = `Node failed: ${reloadedNodeBeforeFinish.name}`;
    run.blocked_reason = `Node failed: ${reloadedNodeBeforeFinish.name}`;
    run.updated_at = failTime;
    run.finished_at = failTime;
    run.last_event_id = nodeFailedEvent.event_id;
    plan.status = "failed";
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(runId, nodeRuns);
    return;
  }

  await applyNormalizedReport(
    buildCompletedReport({
      envelope: dispatchEnvelope,
      dispatch: dispatchResult,
    }),
  );
  const finishTime = nowIso();
  applyNodeStatus(
    plan,
    nodeRuns,
    nodeRunId,
    "completed",
    finishTime,
    "Node completed",
    100,
  );
  const nodeCompletedEvent = appendRunEvent({
    run_id: runId,
    node_run_id: nodeRunId,
    type: "node.completed",
    actor_type: "system",
    actor_id: "local-adapter",
    payload: {
      node_id: reloadedNodeBeforeFinish.node_id,
      node_name: reloadedNodeBeforeFinish.name,
      execution_ref: reloadedNodeBeforeFinish.execution_ref,
    },
    created_at: finishTime,
  });

  let lastEventId = nodeCompletedEvent.event_id;
  const unlockedNodes = unlockReadyNodeRuns(plan, nodeRuns, finishTime);
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
      created_at: finishTime,
    });
    lastEventId = readyEvent.event_id;
  }

  if (areAllNodesCompleted(nodeRuns)) {
    const completedEvent = appendRunEvent({
      run_id: runId,
      type: "run.completed",
      actor_type: "system",
      actor_id: "local-execution-engine",
      payload: {
        completed_nodes: nodeRuns.length,
      },
      created_at: finishTime,
    });
    run.status = "completed";
    run.current_summary = "Run completed";
    run.finished_at = finishTime;
    run.updated_at = finishTime;
    run.last_event_id = completedEvent.event_id;
    lastEventId = completedEvent.event_id;
    plan.status = "completed";
  } else if (unlockedNodes.length > 0) {
    run.current_summary = `${unlockedNodes.length} downstream node(s) unlocked`;
    run.updated_at = finishTime;
    run.last_event_id = lastEventId;
    plan.status = "running";
  } else {
    run.current_summary = "Waiting for next dispatch";
    run.updated_at = finishTime;
    run.last_event_id = lastEventId;
    plan.status = "running";
  }

  saveRun(run);
  saveRunPlan(plan);
  saveNodeRuns(runId, nodeRuns);
}

async function processRun(runId: string): Promise<void> {
  while (true) {
    const run = getRun(runId);
    const plan = getRunPlan(runId);
    const nodeRuns = listNodeRuns(runId);
    if (!run || !plan) {
      return;
    }

    if (["completed", "failed", "cancelled"].includes(run.status)) {
      return;
    }

    if (run.status === "paused") {
      return;
    }

    const readyNodes = getReadyNodeRuns(plan).map((node) => node.node_run_id);
    if (readyNodes.length === 0) {
      if (areAllNodesCompleted(nodeRuns)) {
        const timestamp = nowIso();
        const completedEvent = appendRunEvent({
          run_id: runId,
          type: "run.completed",
          actor_type: "system",
          actor_id: "local-execution-engine",
          payload: {
            completed_nodes: nodeRuns.length,
          },
          created_at: timestamp,
        });

        run.status = "completed";
        run.current_summary = "Run completed";
        run.finished_at = timestamp;
        run.updated_at = timestamp;
        run.last_event_id = completedEvent.event_id;
        plan.status = "completed";
        saveRun(run);
        saveRunPlan(plan);
      }
      return;
    }

    await executeReadyNode(runId, readyNodes[0]);
  }
}

export function queueRunExecution(runId: string): void {
  if (activeRuns.has(runId)) {
    return;
  }

  activeRuns.add(runId);
  setTimeout(() => {
    void processRun(runId)
      .catch(async (error) => {
        const message =
          error instanceof Error ? error.message : "Unexpected execution error";
        await failRun(runId, message);
      })
      .finally(() => {
        activeRuns.delete(runId);
      });
  }, 0);
}

export class LocalExecutionAdapter implements ExecutionAdapter {
  readonly kind = "local";

  enqueueRun(runId: string): void {
    queueRunExecution(runId);
  }

  notifyRunAction(runId: string, action: RunAction): void {
    if (action === "resume") {
      queueRunExecution(runId);
    }
  }

  notifyNodeAction(runId: string, _nodeRunId: string, _action: NodeAction): void {
    queueRunExecution(runId);
  }

  async dispatchNode(envelope: DispatchEnvelope): Promise<AdapterDispatchResult> {
    return buildLocalDispatchResult(envelope.node_run_id);
  }

  async handleReport(report: NormalizedExecutionReport): Promise<void> {
    await applyNormalizedReport(report);
  }

  async runMaintenance(_action: "dispatch_sweep"): Promise<ExecutionMaintenanceResult> {
    return {
      action: "dispatch_sweep",
      adapter_kind: this.kind,
      supported: false,
      message: "Local execution adapter does not manage external dispatch records.",
      summary: null,
    };
  }
}
