import type { RuntimeWorkerClient } from "./runtime-worker-client.js";
import {
  runtimeEventIdempotencyKey,
  type RuntimeWorkerJob,
  type WorkerEvent,
} from "./runtime-protocol.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class InProcessRuntimeWorkerClient implements RuntimeWorkerClient {
  readonly kind = "in-process-runtime-worker";

  async runJob(job: RuntimeWorkerJob): Promise<{
    worker_id: string;
    events: WorkerEvent[];
  }> {
    const workerId = "runtime-worker-local";
    const rawRef = {
      dispatch_id: `runtime-worker:${job.job_id}`,
      provider_refs: {
        task_id: `local-task:${job.node_run_id}`,
        session_id: `local-session:${job.node_run_id}`,
      },
    };
    const eventBase = (sequence: number, kind: WorkerEvent["kind"]) => ({
      event_id: `${job.job_id}:evt:${sequence}`,
      idempotency_key: runtimeEventIdempotencyKey({
        runId: job.run_id,
        nodeRunId: job.node_run_id,
        jobId: job.job_id,
        sequence,
        kind,
      }),
      sequence,
      job_id: job.job_id,
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      worker_id: workerId,
      created_at: nowIso(),
    });

    return {
      worker_id: workerId,
      events: [
        {
          ...eventBase(1, "worker.accepted"),
          kind: "worker.accepted",
          report: {
            run_id: job.run_id,
            node_run_id: job.node_run_id,
            status: "accepted",
            progress: {
              percent: 0,
              message: "Worker accepted local runtime job",
            },
            artifacts: [],
            error: null,
            raw_ref: rawRef,
            created_at: nowIso(),
          },
        },
        {
          ...eventBase(2, "worker.progress"),
          kind: "worker.progress",
          report: {
            run_id: job.run_id,
            node_run_id: job.node_run_id,
            status: "running",
            progress: {
              percent: 60,
              message: `Worker is processing ${job.node_name}`,
            },
            artifacts: [],
            error: null,
            raw_ref: rawRef,
            created_at: nowIso(),
          },
        },
        {
          ...eventBase(3, "worker.completed"),
          kind: "worker.completed",
          report: {
            run_id: job.run_id,
            node_run_id: job.node_run_id,
            status: "completed",
            progress: {
              percent: 100,
              message: `${job.node_name} completed by runtime worker`,
            },
            artifacts: [
              {
                artifact_id: `artifact_${job.node_run_id}`,
                type: "summary",
                name: `${job.node_name}.summary.txt`,
                storage_uri: `runtime-worker://artifacts/${job.run_id}/${job.node_run_id}/summary.txt`,
                mime_type: "text/plain",
                size_bytes: 64,
              },
            ],
            error: null,
            raw_ref: rawRef,
            created_at: nowIso(),
          },
        },
      ],
    };
  }
}
