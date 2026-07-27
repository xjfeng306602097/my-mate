import type { NodeAction, RunAction } from "./control-actions.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import type { RuntimeWorkerClient } from "./runtime-worker-client.js";
import type { AdapterDispatchResult, NormalizedExecutionReport } from "./types.js";
import {
  ExecutionAdapterRuntimeDispatcher,
  type RuntimeDispatchResult,
  type RuntimeDispatcher,
} from "./runtime-dispatcher.js";
import type { RuntimeWorkerJob, WorkerEvent } from "./runtime-protocol.js";

export class LocalRuntimeWorkerDispatcher implements RuntimeDispatcher {
  readonly kind = "local-runtime-worker";

  constructor(
    private readonly workerClient: RuntimeWorkerClient,
    private readonly fallbackAdapterBridge: ExecutionAdapterRuntimeDispatcher,
  ) {}

  enqueueRun(runId: string): void {
    this.fallbackAdapterBridge.enqueueRun(runId);
  }

  notifyRunAction(runId: string, action: RunAction): void {
    this.fallbackAdapterBridge.notifyRunAction(runId, action);
  }

  notifyNodeAction(runId: string, nodeRunId: string, action: NodeAction): void {
    this.fallbackAdapterBridge.notifyNodeAction(runId, nodeRunId, action);
  }

  async dispatchJob(job: RuntimeWorkerJob): Promise<RuntimeDispatchResult> {
    if (job.harness.agent_runtime !== "local") {
      return await this.fallbackAdapterBridge.dispatchJob(job);
    }

    const result = await this.workerClient.runJob(job);
    return {
      status: "accepted",
      dispatch_id: `runtime-worker:${job.job_id}`,
      job,
      target_kind: job.provision.target_kind,
      worker_id: result.worker_id,
      lease_id: null,
      accepted_at: result.events[0]?.created_at || null,
      worker_events: result.events,
      compatibility: {
        adapter_kind: "runtime-worker",
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

  async handleWorkerEvent(event: WorkerEvent): Promise<void> {
    if (event.kind === "worker.accepted") {
      return;
    }
    await this.fallbackAdapterBridge.handleWorkerEvent(event);
  }

  async handleReport(report: NormalizedExecutionReport): Promise<void> {
    await this.fallbackAdapterBridge.handleReport(report);
  }
}

export function buildLocalRuntimeWorkerDispatcher(input: {
  workerClient: RuntimeWorkerClient;
  executionAdapter: ExecutionAdapter;
}): RuntimeDispatcher {
  return new LocalRuntimeWorkerDispatcher(
    input.workerClient,
    new ExecutionAdapterRuntimeDispatcher(input.executionAdapter),
  );
}
