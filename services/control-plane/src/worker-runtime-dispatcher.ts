import type { NodeAction, RunAction } from "./control-actions.js";
import { PUBLIC_BASE_URL, RUNTIME_WORKER_ACK_TIMEOUT_MS } from "./config.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import {
  ExecutionAdapterRuntimeDispatcher,
  type RuntimeDispatchResult,
  type RuntimeDispatcher,
} from "./runtime-dispatcher.js";
import type {
  NormalizedExecutionReport,
} from "./types.js";
import type { NodeProvisioner, WorkerCleanupResult } from "./node-provisioner.js";
import { buildWorkerProvisionRequest } from "./node-provisioner.js";
import type { RuntimeWorkerHub } from "./runtime-worker-hub.js";
import {
  isTerminalWorkerEventKind,
  type RuntimeWorkerJob,
  type WorkerEvent,
} from "./runtime-protocol.js";
import {
  findLatestRuntimeJobRecordForNode,
  listRuntimeJobRecords,
} from "./runtime/runtime-job-store.js";
import { getRuntimeWorkerRecord } from "./runtime/runtime-worker-store.js";
import {
  findActiveWorkerLeaseForJob,
  findActiveWorkerLeaseForWorker,
  getWorkerLeaseRecord,
  listWorkerLeaseRecords,
  saveWorkerLeaseRecord,
  type WorkerLeaseRecord,
} from "./runtime/worker-lease-store.js";
import { nowIso } from "./utils.js";
import { appendRunEvent } from "./event-store.js";
import {
  getRuntimeHumanGate,
  saveRuntimeHumanGate,
} from "./runtime/human-gate-store.js";
import { InProcessRuntimeWorkerClient } from "./in-process-runtime-worker-client.js";

export class WorkerRuntimeDispatcher implements RuntimeDispatcher {
  readonly kind = "docker-runtime-worker";

  private workerEventHandler: (event: WorkerEvent) => Promise<void> = async () => {};
  private readonly localWorkerClient = new InProcessRuntimeWorkerClient();

  constructor(
    private readonly workerHub: RuntimeWorkerHub,
    private readonly nodeProvisioner: NodeProvisioner,
    executionAdapter: ExecutionAdapter,
  ) {
    this.fallbackAdapterBridge = new ExecutionAdapterRuntimeDispatcher(executionAdapter);
    this.workerHub.setEventHandler(async (event) => {
      await this.handleWorkerEvent(event);
      if (isTerminalWorkerEventKind(event.kind)) {
        await this.releaseTerminalWorker(event);
      }
    });
    this.workerHub.setStaleHandler(async (worker) => {
      const lease = findActiveWorkerLeaseForWorker(worker.worker_id);
      if (!lease) {
        return;
      }
      lease.status = "failed";
      lease.last_error = "Runtime worker heartbeat timed out.";
      saveWorkerLeaseRecord(lease);
      appendRunEvent({
        run_id: lease.run_id,
        node_run_id: lease.node_run_id,
        type: "lease.failed",
        actor_type: "system",
        actor_id: "runtime-provisioner",
        payload: {
          lease_id: lease.lease_id,
          worker_id: lease.worker_id,
          job_id: lease.job_id,
          reason: lease.last_error,
        },
        created_at: nowIso(),
        idempotency_key: `lease.failed:${lease.lease_id}:heartbeat_timeout`,
      });
      await this.cleanupLeaseWithAudit(lease, "heartbeat_timeout");
    });
  }

  private readonly fallbackAdapterBridge: ExecutionAdapterRuntimeDispatcher;

  bindWorkerEventHandler(handler: (event: WorkerEvent) => Promise<void>): void {
    this.workerEventHandler = handler;
  }

  enqueueRun(_runId: string): void {
    // RuntimeEngine owns the ready frontier and calls dispatchJob directly.
  }

  notifyRunAction(runId: string, action: RunAction): void {
    if (action === "cancel") {
      this.nodeProvisioner.cancelQueued?.({
        runId,
        reason: "Run cancelled while waiting for Runtime Worker capacity.",
      });
    }
    if (action === "pause" || action === "resume" || action === "cancel") {
      for (const job of listRuntimeJobRecords(runId)) {
        if (!["dispatching", "accepted", "running", "waiting_human"].includes(job.status)) {
          continue;
        }
        const lease = findActiveWorkerLeaseForJob(job.job_id);
        if (lease) {
          this.workerHub.sendControl({
            workerId: lease.worker_id,
            jobId: job.job_id,
            action,
            reason: `run_${action}`,
          });
        }
      }
      return;
    }
    this.fallbackAdapterBridge.notifyRunAction(runId, action);
  }

  notifyNodeAction(runId: string, nodeRunId: string, action: NodeAction): void {
    this.nodeProvisioner.cancelQueued?.({
      runId,
      nodeRunId,
      reason: `Node ${action} requested while waiting for Runtime Worker capacity.`,
    });
    const job = findLatestRuntimeJobRecordForNode(runId, nodeRunId);
    const lease = job ? findActiveWorkerLeaseForJob(job.job_id) : null;
    if (job && lease) {
      this.workerHub.sendControl({
        workerId: lease.worker_id,
        jobId: job.job_id,
        action: action === "retry" || action === "skip" ? "cancel" : action,
        reason: `node_${action}`,
      });
      return;
    }
    this.fallbackAdapterBridge.notifyNodeAction(runId, nodeRunId, action);
  }

  resumeHumanGate(input: {
    runId: string;
    nodeRunId: string;
    gateId: string;
    decision: "resume" | "reject";
    payload: Record<string, unknown>;
  }): { delivered: boolean; controlId: string | null } {
    const gate = getRuntimeHumanGate(input.runId, input.gateId);
    if (!gate || gate.node_run_id !== input.nodeRunId || gate.transport !== "worker_native") {
      return { delivered: false, controlId: null };
    }
    const lease = findActiveWorkerLeaseForJob(gate.job_id);
    if (!lease) {
      gate.last_error = "Active Runtime Worker lease was not found.";
      saveRuntimeHumanGate(gate);
      return { delivered: false, controlId: null };
    }
    const controlId = `control:${gate.job_id}:${Date.now().toString(36)}`;
    const delivered = this.workerHub.sendControl({
      workerId: lease.worker_id,
      jobId: gate.job_id,
      controlId,
      action: input.decision === "resume" ? "resume" : "cancel",
      gateId: gate.gate_id,
      payload: input.payload,
      reason: input.decision === "resume" ? "human_gate_resolved" : "human_gate_rejected",
    });
    gate.status = delivered
      ? input.decision === "resume" ? "resuming" : "rejected"
      : gate.status;
    gate.response_payload = input.payload;
    gate.control_id = delivered ? controlId : null;
    gate.resolved_at = input.decision === "reject" && delivered ? nowIso() : null;
    gate.last_error = delivered ? null : "Runtime Worker control channel is unavailable.";
    saveRuntimeHumanGate(gate);
    appendRunEvent({
      run_id: gate.run_id,
      node_run_id: gate.node_run_id,
      type: delivered ? "human_gate.control_sent" : "human_gate.control_failed",
      actor_type: "system",
      actor_id: "runtime-dispatcher",
      payload: {
        gate_id: gate.gate_id,
        job_id: gate.job_id,
        control_id: delivered ? controlId : null,
        decision: input.decision,
        transport: gate.transport,
      },
      created_at: nowIso(),
      idempotency_key: delivered ? `human_gate.control:${controlId}` : undefined,
    });
    return { delivered, controlId: delivered ? controlId : null };
  }

  async dispatchJob(job: RuntimeWorkerJob): Promise<RuntimeDispatchResult> {
    if (job.provision.target_kind === "local") {
      if (job.harness.agent_runtime !== "local") {
        throw new Error(`Local execution is unavailable for runtime ${job.harness.agent_runtime}.`);
      }
      const result = await this.localWorkerClient.runJob(job);
      return {
        status: "accepted",
        dispatch_id: `runtime-worker:${job.job_id}`,
        job,
        target_kind: "local",
        worker_id: result.worker_id,
        lease_id: null,
        accepted_at: result.events[0]?.created_at || null,
        worker_events: result.events,
        compatibility: {
          adapter_kind: "in-process-runtime-worker",
          raw_ref: {
            dispatch_id: `runtime-worker:${job.job_id}`,
            provider_refs: {
              task_id: `local-task:${job.node_run_id}`,
              session_id: `local-session:${job.node_run_id}`,
            },
          },
        },
      };
    }

    const provision = await this.nodeProvisioner.provisionWorker(
      buildWorkerProvisionRequest({
        requestId: `provision:${job.job_id}`,
        job,
        managerBaseUrl: PUBLIC_BASE_URL,
        managerWorkerWsUrl: PUBLIC_BASE_URL,
      }),
    );
    if (provision.status !== "ready") {
      throw new Error(provision.reason);
    }

    const lease = provision.lease as WorkerLeaseRecord;
    appendRunEvent({
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      type: "lease.acquired",
      actor_type: "system",
      actor_id: "runtime-provisioner",
      payload: {
        lease_id: lease.lease_id,
        worker_id: lease.worker_id,
        job_id: job.job_id,
        container_id: lease.container_id,
      },
      created_at: lease.acquired_at,
      idempotency_key: `lease.acquired:${lease.lease_id}`,
    });
    const worker = getRuntimeWorkerRecord(lease.worker_id);
    const missingCapabilities = job.provision.required_capabilities.filter(
      (capability) => !worker?.capabilities.includes(capability),
    );
    if (missingCapabilities.length > 0) {
      await this.cleanupLeaseWithAudit(lease, "capability_mismatch");
      appendRunEvent({
        run_id: job.run_id,
        node_run_id: job.node_run_id,
        type: "lease.failed",
        actor_type: "system",
        actor_id: "runtime-provisioner",
        payload: {
          lease_id: lease.lease_id,
          worker_id: lease.worker_id,
          job_id: job.job_id,
          reason: "capability_mismatch",
          missing_capabilities: missingCapabilities,
        },
        created_at: nowIso(),
        idempotency_key: `lease.failed:${lease.lease_id}:capability_mismatch`,
      });
      throw new Error(
        `Runtime worker ${lease.worker_id} is missing capabilities: ${missingCapabilities.join(", ")}.`,
      );
    }
    let ack;
    try {
      ack = await this.workerHub.dispatchJob(
        lease.worker_id,
        job,
        RUNTIME_WORKER_ACK_TIMEOUT_MS,
      );
      if (ack.status !== "accepted" && ack.status !== "duplicate") {
        throw new Error(ack.reason || `Runtime worker rejected job with ${ack.status}.`);
      }
    } catch (error) {
      await this.cleanupLeaseWithAudit(lease, "dispatch_failed");
      appendRunEvent({
        run_id: job.run_id,
        node_run_id: job.node_run_id,
        type: "lease.failed",
        actor_type: "system",
        actor_id: "runtime-provisioner",
        payload: {
          lease_id: lease.lease_id,
          worker_id: lease.worker_id,
          job_id: job.job_id,
          reason: error instanceof Error ? error.message : "dispatch_failed",
        },
        created_at: nowIso(),
        idempotency_key: `lease.failed:${lease.lease_id}:dispatch_failed`,
      });
      throw error;
    }
    const persistedLease = getWorkerLeaseRecord(job.run_id, lease.lease_id) || lease;
    persistedLease.status = "active";
    persistedLease.job_id = job.job_id;
    persistedLease.last_heartbeat_at = ack.sent_at;
    saveWorkerLeaseRecord(persistedLease);
    appendRunEvent({
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      type: "lease.activated",
      actor_type: "system",
      actor_id: "runtime-dispatcher",
      payload: {
        lease_id: persistedLease.lease_id,
        worker_id: persistedLease.worker_id,
        job_id: job.job_id,
      },
      created_at: ack.sent_at,
      idempotency_key: `lease.activated:${persistedLease.lease_id}`,
    });

    return {
      status: "accepted",
      dispatch_id: `worker:${lease.worker_id}:${job.job_id}`,
      job,
      target_kind: job.provision.target_kind,
      worker_id: lease.worker_id,
      lease_id: lease.lease_id,
      accepted_at: ack.sent_at,
      worker_events: [],
      compatibility: {
        adapter_kind: this.kind,
        raw_ref: {
          job_id: job.job_id,
          worker_id: lease.worker_id,
          lease_id: lease.lease_id,
          target_kind: job.provision.target_kind,
          dispatch_id: `worker:${lease.worker_id}:${job.job_id}`,
          provider_refs: {},
        },
      },
    };
  }

  async handleWorkerEvent(event: WorkerEvent): Promise<void> {
    await this.workerEventHandler(event);
  }

  async handleReport(report: NormalizedExecutionReport): Promise<void> {
    void report;
  }

  getRuntimeStatus() {
    const summary = this.workerHub.getSummary();
    const capacity = this.nodeProvisioner.getCapacityStatus?.();
    const recovery = this.nodeProvisioner.getRecoveryStatus?.();
    return {
      node_provisioner_kind: this.nodeProvisioner.kind,
      node_provisioner_status: "ready" as const,
      worker_hub_kind: this.workerHub.kind,
      connected_workers: summary.connected_workers,
      busy_workers: summary.busy_workers,
      stale_workers: summary.stale_workers,
      worker_capacity_limit: capacity?.max_concurrent_workers || 0,
      worker_capacity_active: capacity?.active_workers || 0,
      worker_queue_depth: capacity?.queue_depth || 0,
      worker_queue_limit: capacity?.queue_limit || 0,
      worker_queue_timeout_ms: capacity?.queue_timeout_ms || 0,
      worker_cleanup_pending: recovery?.cleanup_pending || 0,
      worker_cleanup_failed: recovery?.cleanup_failed || 0,
      worker_reconciliation_at: recovery?.last_reconciliation_at || null,
      worker_reconciliation_status: recovery?.last_reconciliation_status || "not_run",
      worker_reconciliation_discovered: recovery?.discovered_containers || 0,
      worker_reconciliation_orphans: recovery?.orphan_containers || 0,
      worker_reconciliation_removed: recovery?.removed_containers || 0,
      worker_reconciliation_failures: recovery?.cleanup_failures || 0,
    };
  }

  private async cleanupLeaseWithAudit(
    lease: WorkerLeaseRecord,
    reason: string,
    causationId: string | null = null,
  ): Promise<{ succeeded: boolean; completedAt: string; result: WorkerCleanupResult | null }> {
    const attempt = (lease.cleanup?.attempt || 0) + 1;
    const attemptId = `cleanup:${lease.lease_id}:${attempt}`;
    const startedAt = nowIso();
    const started = appendRunEvent({
      run_id: lease.run_id,
      node_run_id: lease.node_run_id,
      type: "lease.cleanup_started",
      actor_type: "system",
      actor_id: "runtime-provisioner",
      payload: {
        lease_id: lease.lease_id,
        worker_id: lease.worker_id,
        job_id: lease.job_id,
        attempt_id: attemptId,
        attempt,
        reason,
        container_ref: lease.container_id,
      },
      created_at: startedAt,
      causation_id: causationId,
      idempotency_key: `lease.cleanup_started:${attemptId}`,
    });
    let result: WorkerCleanupResult | null = null;
    let error: string | null = null;
    try {
      result = (await this.nodeProvisioner.releaseWorker?.(lease, reason)) || null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Runtime Worker cleanup failed.";
    }
    const completedAt = result?.completed_at || nowIso();
    const succeeded = !error && (!result || result.status === "succeeded");
    if (!result) {
      const persisted: WorkerLeaseRecord = {
        ...lease,
        status: succeeded ? "released" : "cleanup_failed",
        released_at: succeeded ? completedAt : null,
        release_reason: reason,
        last_error: error,
        cleanup: {
          attempt_id: attemptId,
          attempt,
          status: succeeded ? "succeeded" : "failed",
          reason,
          container_ref: lease.container_id,
          started_at: startedAt,
          completed_at: completedAt,
          last_error: error,
        },
      };
      saveWorkerLeaseRecord(persisted);
    }
    appendRunEvent({
      run_id: lease.run_id,
      node_run_id: lease.node_run_id,
      type: succeeded ? "lease.cleanup_completed" : "lease.cleanup_failed",
      actor_type: "system",
      actor_id: "runtime-provisioner",
      payload: {
        lease_id: lease.lease_id,
        worker_id: lease.worker_id,
        job_id: lease.job_id,
        attempt_id: result?.attempt_id || attemptId,
        attempt: result?.attempt || attempt,
        reason,
        container_ref: result?.container_ref || lease.container_id,
        resource_found: result?.resource_found ?? !!lease.container_id,
        capacity_released: result?.capacity_released ?? succeeded,
        error: result?.error || error,
      },
      created_at: completedAt,
      causation_id: started.event_id,
      idempotency_key: `lease.cleanup_${succeeded ? "completed" : "failed"}:${result?.attempt_id || attemptId}`,
    });
    return { succeeded, completedAt, result };
  }

  private async releaseTerminalWorker(event: WorkerEvent): Promise<void> {
    const lease = findActiveWorkerLeaseForJob(event.job_id);
    if (!lease) {
      return;
    }
    const cleanup = await this.cleanupLeaseWithAudit(lease, event.kind, event.event_id);
    if (!cleanup.succeeded) return;
    const releasedAt = cleanup.completedAt;
    appendRunEvent({
      run_id: event.run_id,
      node_run_id: event.node_run_id,
      type: "lease.released",
      actor_type: "system",
      actor_id: "runtime-provisioner",
      payload: {
        lease_id: lease.lease_id,
        worker_id: lease.worker_id,
        job_id: event.job_id,
        reason: event.kind,
      },
      created_at: releasedAt,
      causation_id: event.event_id,
      idempotency_key: `lease.released:${lease.lease_id}`,
    });
    const activeJobs = listRuntimeJobRecords(event.run_id).filter((job) =>
      ["dispatching", "accepted", "running", "waiting_human"].includes(job.status),
    );
    const activeLeases = listWorkerLeaseRecords(event.run_id).filter((record) =>
      ["provisioning", "ready", "active", "cleanup_pending", "cleanup_failed"].includes(
        record.status,
      ),
    );
    if (activeJobs.length === 0 && activeLeases.length === 0) {
      appendRunEvent({
        run_id: event.run_id,
        node_run_id: event.node_run_id,
        type: "runtime.quiescent",
        actor_type: "system",
        actor_id: "runtime-dispatcher",
        payload: {
          terminal_job_id: event.job_id,
          active_jobs: 0,
          active_leases: 0,
        },
        created_at: releasedAt,
        causation_id: event.event_id,
        idempotency_key: `runtime.quiescent:${event.run_id}:${event.job_id}`,
      });
    }
  }
}
