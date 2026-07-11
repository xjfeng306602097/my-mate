import type { NodeAction, RunAction } from "./control-actions.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import type { AdapterDispatchResult, NormalizedExecutionReport } from "./types.js";
import {
  buildRuntimeWorkerJob,
  reportFromWorkerEvent,
  type RuntimeWorkerJob,
  type WorkerEvent,
  type WorkerTargetKind,
} from "./runtime-protocol.js";

export type RuntimeDispatchStatus = AdapterDispatchResult["status"] | "queued";

export interface RuntimeDispatchResult {
  status: RuntimeDispatchStatus;
  dispatch_id: string | null;
  job: RuntimeWorkerJob;
  target_kind: WorkerTargetKind;
  worker_id: string | null;
  lease_id: string | null;
  accepted_at: string | null;
  worker_events?: WorkerEvent[];
  compatibility: {
    adapter_kind: string | null;
    raw_ref: NormalizedExecutionReport["raw_ref"];
    adapter_dispatch?: AdapterDispatchResult;
  };
}

export interface RuntimeDispatcher {
  readonly kind: string;
  enqueueRun(runId: string): void;
  notifyRunAction(runId: string, action: RunAction): void;
  notifyNodeAction(runId: string, nodeRunId: string, action: NodeAction): void;
  dispatchJob(job: RuntimeWorkerJob): Promise<RuntimeDispatchResult>;
  handleWorkerEvent(event: WorkerEvent): Promise<void>;
  handleReport(report: NormalizedExecutionReport): Promise<void>;
  bindWorkerEventHandler?(handler: (event: WorkerEvent) => Promise<void>): void;
  getRuntimeStatus?(): {
    node_provisioner_kind: string;
    node_provisioner_status: "not_wired" | "ready" | "deferred";
    worker_hub_kind: string | null;
    connected_workers: number;
    busy_workers: number;
    stale_workers: number;
    worker_capacity_limit?: number;
    worker_capacity_active?: number;
    worker_queue_depth?: number;
    worker_queue_limit?: number;
    worker_queue_timeout_ms?: number;
    worker_cleanup_pending?: number;
    worker_cleanup_failed?: number;
    worker_reconciliation_at?: string | null;
    worker_reconciliation_status?: "not_run" | "healthy" | "degraded" | "failed";
    worker_reconciliation_discovered?: number;
    worker_reconciliation_orphans?: number;
    worker_reconciliation_removed?: number;
    worker_reconciliation_failures?: number;
  };
}

export class ExecutionAdapterRuntimeDispatcher implements RuntimeDispatcher {
  readonly kind: string;

  constructor(private readonly adapter: ExecutionAdapter) {
    this.kind = adapter.kind;
  }

  enqueueRun(runId: string): void {
    this.adapter.enqueueRun(runId);
  }

  notifyRunAction(runId: string, action: RunAction): void {
    this.adapter.notifyRunAction(runId, action);
  }

  notifyNodeAction(runId: string, nodeRunId: string, action: NodeAction): void {
    this.adapter.notifyNodeAction(runId, nodeRunId, action);
  }

  async dispatchJob(job: RuntimeWorkerJob): Promise<RuntimeDispatchResult> {
    const dispatch = await this.adapter.dispatchNode(job.envelope);
    const acceptedAt = dispatch.status === "accepted" ? new Date().toISOString() : null;
    return {
      status: dispatch.status,
      dispatch_id: dispatch.dispatch_id,
      job,
      target_kind: job.provision.target_kind,
      worker_id: null,
      lease_id: null,
      accepted_at: acceptedAt,
      worker_events: [],
      compatibility: {
        adapter_kind: this.adapter.kind,
        raw_ref: {
          dispatch_id: dispatch.dispatch_id,
          openclaw_task_id: dispatch.openclaw_task_id,
          openclaw_session_id: dispatch.openclaw_session_id,
        },
        adapter_dispatch: dispatch,
      },
    };
  }

  async handleWorkerEvent(event: WorkerEvent): Promise<void> {
    const report = reportFromWorkerEvent(event);
    if (report) {
      await this.handleReport(report);
    }
  }

  async handleReport(report: NormalizedExecutionReport): Promise<void> {
    await this.adapter.handleReport(report);
  }
}

export function buildRuntimeJobDispatcherInput(
  envelope: RuntimeWorkerJob["envelope"],
): RuntimeWorkerJob {
  return buildRuntimeWorkerJob(envelope);
}
