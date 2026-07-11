import { appendRunEvent } from "../event-store.js";
import { createEmptyExecutionRef } from "../execution-ref.js";
import type {
  NodeProvisioner,
  WorkerCleanupResult,
  WorkerReconciliationResult,
} from "../node-provisioner.js";
import { applyNodeStatus, getCompiledNode } from "../node-scheduler.js";
import { listNodeRuns, saveNodeRuns } from "../node-run-store.js";
import { getRunPlan, saveRunPlan } from "../run-plan-store.js";
import { listRuns, saveRun } from "../run-store.js";
import { nowIso } from "../utils.js";
import {
  findLatestRuntimeJobRecordForNode,
  saveRuntimeJobRecord,
} from "./runtime-job-store.js";
import type { RuntimeEngine } from "./runtime-engine.js";
import {
  listWorkerLeaseRecords,
  saveWorkerLeaseRecord,
  type WorkerLeaseRecord,
} from "./worker-lease-store.js";

export interface RuntimeRecoverySummary {
  scanned_runs: number;
  recovered_runs: string[];
  redispatched_runs: string[];
  retried_nodes: string[];
  failed_nodes: string[];
  released_leases: string[];
  cleanup_failed_leases: string[];
  orphan_containers: string[];
  removed_containers: string[];
  redispatch_blocked_runs: string[];
  reconciliation: WorkerReconciliationResult | null;
}

const cleanupLeaseStatuses = new Set([
  "provisioning",
  "ready",
  "active",
  "stale",
  "cleanup_pending",
  "cleanup_failed",
]);

function appendCleanupAudit(result: WorkerCleanupResult, knownRunIds: Set<string>): void {
  if (!result.run_id || !knownRunIds.has(result.run_id)) return;
  const commonPayload = {
    lease_id: result.lease_id,
    worker_id: result.worker_id,
    attempt_id: result.attempt_id,
    attempt: result.attempt,
    reason: result.reason,
    container_ref: result.container_ref,
  };
  const started = appendRunEvent({
    run_id: result.run_id,
    node_run_id: result.node_run_id || null,
    type: "lease.cleanup_started",
    actor_type: "system",
    actor_id: "runtime-recovery",
    payload: commonPayload,
    created_at: result.started_at,
    idempotency_key: `lease.cleanup_started:${result.attempt_id}`,
  });
  appendRunEvent({
    run_id: result.run_id,
    node_run_id: result.node_run_id || null,
    type: result.status === "succeeded" ? "lease.cleanup_completed" : "lease.cleanup_failed",
    actor_type: "system",
    actor_id: "runtime-recovery",
    payload: {
      ...commonPayload,
      resource_found: result.resource_found,
      capacity_released: result.capacity_released,
      error: result.error,
    },
    created_at: result.completed_at,
    causation_id: started.event_id,
    idempotency_key: `lease.cleanup_${result.status === "succeeded" ? "completed" : "failed"}:${result.attempt_id}`,
  });
  if (result.status === "succeeded") {
    appendRunEvent({
      run_id: result.run_id,
      node_run_id: result.node_run_id || null,
      type: "lease.released",
      actor_type: "system",
      actor_id: "runtime-recovery",
      payload: commonPayload,
      created_at: result.completed_at,
      idempotency_key: `lease.released:${result.lease_id}`,
    });
  }
}

async function releaseLegacyLease(input: {
  provisioner?: NodeProvisioner | null;
  lease: WorkerLeaseRecord;
  timestamp: string;
}): Promise<WorkerCleanupResult> {
  const previousAttempt = input.lease.cleanup?.attempt || 0;
  const attempt = previousAttempt + 1;
  const attemptId = `cleanup:${input.lease.lease_id}:${attempt}`;
  const startedAt = input.timestamp;
  try {
    const result = await input.provisioner?.releaseWorker?.(
      input.lease,
      "control_plane_recovery",
    );
    if (result) return result;
    const released: WorkerLeaseRecord = {
      ...input.lease,
      status: "released",
      released_at: input.timestamp,
      release_reason: "control_plane_recovery",
      last_error: null,
      cleanup: {
        attempt_id: attemptId,
        attempt,
        status: "succeeded",
        reason: "control_plane_recovery",
        container_ref: input.lease.container_id,
        started_at: startedAt,
        completed_at: input.timestamp,
        last_error: null,
      },
    };
    saveWorkerLeaseRecord(released);
    return {
      status: "succeeded",
      lease_id: released.lease_id,
      run_id: released.run_id,
      node_run_id: released.node_run_id,
      worker_id: released.worker_id,
      attempt_id: attemptId,
      attempt,
      reason: "control_plane_recovery",
      container_ref: released.container_id,
      resource_found: !!released.container_id,
      capacity_released: true,
      started_at: startedAt,
      completed_at: input.timestamp,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime recovery cleanup failed.";
    const failed: WorkerLeaseRecord = {
      ...input.lease,
      status: "cleanup_failed",
      released_at: null,
      release_reason: "control_plane_recovery",
      last_error: message,
      cleanup: {
        attempt_id: attemptId,
        attempt,
        status: "failed",
        reason: "control_plane_recovery",
        container_ref: input.lease.container_id,
        started_at: startedAt,
        completed_at: input.timestamp,
        last_error: message,
      },
    };
    saveWorkerLeaseRecord(failed);
    return {
      status: "failed",
      lease_id: failed.lease_id,
      run_id: failed.run_id,
      node_run_id: failed.node_run_id,
      worker_id: failed.worker_id,
      attempt_id: attemptId,
      attempt,
      reason: "control_plane_recovery",
      container_ref: failed.container_id,
      resource_found: !!failed.container_id,
      capacity_released: false,
      started_at: startedAt,
      completed_at: input.timestamp,
      error: message,
    };
  }
}

export async function recoverRuntimeState(input: {
  engine: RuntimeEngine;
  provisioner?: NodeProvisioner | null;
  now?: () => string;
}): Promise<RuntimeRecoverySummary> {
  const timestamp = (input.now || nowIso)();
  const summary: RuntimeRecoverySummary = {
    scanned_runs: 0,
    recovered_runs: [],
    redispatched_runs: [],
    retried_nodes: [],
    failed_nodes: [],
    released_leases: [],
    cleanup_failed_leases: [],
    orphan_containers: [],
    removed_containers: [],
    redispatch_blocked_runs: [],
    reconciliation: null,
  };

  const runs = listRuns();
  const knownRunIds = new Set(runs.map((run) => run.run_id));
  let cleanupResults: WorkerCleanupResult[] = [];
  if (input.provisioner?.reconcileWorkers) {
    summary.reconciliation = await input.provisioner.reconcileWorkers({
      reason: "control_plane_recovery",
      reconciledAt: timestamp,
    });
    cleanupResults = summary.reconciliation.cleanup_results;
    summary.orphan_containers.push(...summary.reconciliation.orphan_container_ids);
    summary.removed_containers.push(...summary.reconciliation.removed_container_ids);
  } else if (input.provisioner) {
    for (const lease of listWorkerLeaseRecords().filter((record) =>
      cleanupLeaseStatuses.has(record.status),
    )) {
      cleanupResults.push(await releaseLegacyLease({
        provisioner: input.provisioner,
        lease,
        timestamp,
      }));
    }
  }

  const failedCleanupRunIds = new Set<string>();
  const releasedLeaseIdsByRun = new Map<string, Set<string>>();
  for (const result of cleanupResults) {
    appendCleanupAudit(result, knownRunIds);
    if (result.status === "succeeded") {
      summary.released_leases.push(result.lease_id);
      const runLeaseIds = releasedLeaseIdsByRun.get(result.run_id) || new Set<string>();
      runLeaseIds.add(result.lease_id);
      releasedLeaseIdsByRun.set(result.run_id, runLeaseIds);
    } else {
      summary.cleanup_failed_leases.push(result.lease_id);
      if (result.run_id) failedCleanupRunIds.add(result.run_id);
    }
  }
  const inventoryUnavailable = !!summary.reconciliation?.inventory_error;

  for (const run of runs) {
    if (run.status !== "queued" && run.status !== "running") {
      continue;
    }
    summary.scanned_runs += 1;
    const plan = getRunPlan(run.run_id);
    const nodeRuns = listNodeRuns(run.run_id);
    if (!plan || nodeRuns.length === 0) {
      continue;
    }

    const releasedLeaseIds = releasedLeaseIdsByRun.get(run.run_id) || new Set<string>();

    let interrupted = false;
    let exhausted = false;
    for (const nodeRun of nodeRuns) {
      if (nodeRun.status !== "running") {
        continue;
      }
      const node = getCompiledNode(plan, nodeRun.node_run_id);
      if (!node) {
        continue;
      }
      interrupted = true;
      const job = findLatestRuntimeJobRecordForNode(run.run_id, nodeRun.node_run_id);
      if (job && !["completed", "failed", "cancelled"].includes(job.status)) {
        job.status = "failed";
        job.finished_at = timestamp;
        job.last_error = "Control plane restarted while the runtime job was active.";
        saveRuntimeJobRecord(job);
      }
      applyNodeStatus(
        plan,
        nodeRuns,
        node.node_run_id,
        "failed",
        timestamp,
        "Interrupted by control-plane restart",
        100,
      );
      const failedEvent = appendRunEvent({
        run_id: run.run_id,
        node_run_id: node.node_run_id,
        type: "node.failed",
        actor_type: "system",
        actor_id: "runtime-recovery",
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          reason: "control_plane_restart",
          job_id: job?.job_id || null,
          released_lease_ids: [...releasedLeaseIds],
        },
        created_at: timestamp,
      });
      if (nodeRun.attempt < Math.max(1, node.retry_policy.max_attempts)) {
        applyNodeStatus(
          plan,
          nodeRuns,
          node.node_run_id,
          "ready",
          timestamp,
          `Recovered for retry (${nodeRun.attempt + 1}/${node.retry_policy.max_attempts})`,
          0,
        );
        node.execution_ref = createEmptyExecutionRef();
        nodeRun.finished_at = null;
        const readyEvent = appendRunEvent({
          run_id: run.run_id,
          node_run_id: node.node_run_id,
          type: "node.ready",
          actor_type: "system",
          actor_id: "runtime-recovery",
          payload: {
            node_id: node.node_id,
            node_name: node.name,
            previous_event_id: failedEvent.event_id,
            reason: "control_plane_restart",
            next_attempt: nodeRun.attempt + 1,
          },
          created_at: timestamp,
        });
        run.last_event_id = readyEvent.event_id;
        summary.retried_nodes.push(node.node_run_id);
      } else {
        exhausted = true;
        run.last_event_id = failedEvent.event_id;
        summary.failed_nodes.push(node.node_run_id);
      }
    }

    if (exhausted) {
      const failedEvent = appendRunEvent({
        run_id: run.run_id,
        type: "run.failed",
        actor_type: "system",
        actor_id: "runtime-recovery",
        payload: { reason: "control_plane_restart_retry_exhausted" },
        created_at: timestamp,
      });
      run.status = "failed";
      run.current_summary = "Run failed during control-plane recovery";
      run.blocked_reason = "A running node was interrupted and has no retries remaining.";
      run.finished_at = timestamp;
      run.updated_at = timestamp;
      run.last_event_id = failedEvent.event_id;
      plan.status = "failed";
    } else {
      if (interrupted) {
        const recoveredEvent = appendRunEvent({
          run_id: run.run_id,
          type: "run.resumed",
          actor_type: "system",
          actor_id: "runtime-recovery",
          payload: {
            reason: "control_plane_restart",
            retried_nodes: summary.retried_nodes.filter((nodeRunId) =>
              nodeRuns.some((nodeRun) => nodeRun.node_run_id === nodeRunId),
            ),
          },
          created_at: timestamp,
        });
        run.last_event_id = recoveredEvent.event_id;
        summary.recovered_runs.push(run.run_id);
      }
      run.status = "running";
      run.current_summary = interrupted ? "Run recovered after control-plane restart" : run.current_summary;
      run.blocked_reason = null;
      run.finished_at = null;
      run.updated_at = timestamp;
      plan.status = "running";
    }
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(run.run_id, nodeRuns);

    const cleanupBlocksDispatch = inventoryUnavailable || failedCleanupRunIds.has(run.run_id);
    if (cleanupBlocksDispatch && !exhausted) {
      run.current_summary = "Run recovery is waiting for Runtime Worker cleanup";
      run.blocked_reason = inventoryUnavailable
        ? "Docker Worker inventory could not be reconciled after the control-plane restart."
        : "A Runtime Worker resource could not be cleaned up after the control-plane restart.";
      run.updated_at = timestamp;
      saveRun(run);
      summary.redispatch_blocked_runs.push(run.run_id);
    } else if (!exhausted && nodeRuns.some((nodeRun) => nodeRun.status === "ready")) {
      await input.engine.queueReadyNodes(run.run_id, "runtime_recovery");
      summary.redispatched_runs.push(run.run_id);
    }
  }

  return summary;
}
