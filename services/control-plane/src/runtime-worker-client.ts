import type { RuntimeWorkerJob, WorkerEvent } from "./runtime-protocol.js";

export interface RuntimeWorkerClient {
  readonly kind: string;
  runJob(job: RuntimeWorkerJob): Promise<{
    worker_id: string;
    events: WorkerEvent[];
  }>;
}
