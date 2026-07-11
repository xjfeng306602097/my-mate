import WebSocket, { type RawData } from "ws";
import { getSupportedHarnesses } from "./harness/factory.js";
import { buildWorkerEvidenceV2 } from "./evidence-normalizer.js";
import { runRuntimeWorkerJob } from "./worker-runtime.js";
import {
  createRuntimeMessageBase,
  isRuntimeProtocolMessage,
  runtimeEventIdempotencyKey,
  type JobAckMessage,
  type ManagerToWorkerMessage,
  type NormalizedExecutionReport,
  type RuntimeWorkerJob,
  type WorkerEvidence,
  type WorkerEvent,
  type WorkerToManagerMessage,
} from "./types.js";

export interface RuntimeWorkerManagerClientOptions {
  managerUrl: string;
  workerId: string;
  token: string;
  version?: string;
  reconnectDelayMs?: number;
  metadata?: Record<string, unknown>;
  exitOnRelease?: boolean;
}

function parseJson(data: RawData): unknown {
  return JSON.parse(
    Array.isArray(data)
      ? Buffer.concat(data).toString("utf-8")
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString("utf-8")
        : Buffer.from(data).toString("utf-8"),
  ) as unknown;
}

function isRuntimeWorkerJob(value: unknown): value is RuntimeWorkerJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.job_id === "string" &&
    typeof record.run_id === "string" &&
    typeof record.node_run_id === "string" &&
    !!record.harness &&
    typeof record.harness === "object"
  );
}

function configuredWorkerCapabilities(): string[] {
  const configured = (process.env.MY_MATE_WORKER_CAPABILITIES || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [
    ...new Set([
      "workspace",
      "artifacts",
      "handoff",
      "evidence",
      "control.cancel",
      ...configured,
    ]),
  ];
}

export class RuntimeWorkerManagerClient {
  private socket: WebSocket | null = null;
  private stopping = false;
  private registered = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 10000;
  private activeJobId: string | null = null;
  private activeAbortController: AbortController | null = null;
  private readonly completedJobs = new Set<string>();
  private messageChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: RuntimeWorkerManagerClientOptions) {}

  start(): void {
    this.stopping = false;
    this.connect();
  }

  stop(): void {
    this.stopping = true;
    this.registered = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopping) {
      return;
    }
    const socket = new WebSocket(this.options.managerUrl);
    this.socket = socket;
    socket.on("open", () => this.register());
    socket.on("message", (data) => {
      const task = async () => this.handleMessage(data);
      this.messageChain = this.messageChain.then(task, task);
    });
    socket.on("close", () => {
      this.registered = false;
      this.stopHeartbeat();
      if (!this.stopping) {
        this.scheduleReconnect();
      }
    });
    socket.on("error", () => {
      // The close handler owns reconnection.
    });
  }

  private register(): void {
    this.send({
      ...createRuntimeMessageBase(),
      kind: "worker.register",
      worker_id: this.options.workerId,
      token: this.options.token,
      version: this.options.version || "0.1.0",
      capabilities: configuredWorkerCapabilities(),
      supported_harnesses: getSupportedHarnesses(),
      metadata: {
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        lease_id: process.env.MY_MATE_WORKER_LEASE_ID || null,
        workspace: process.env.MY_MATE_WORKSPACE || null,
        ...(this.options.metadata || {}),
      },
    });
  }

  private async handleMessage(data: RawData): Promise<void> {
    let parsed: unknown;
    try {
      parsed = parseJson(data);
    } catch {
      return;
    }
    if (!isRuntimeProtocolMessage(parsed)) {
      return;
    }
    const message = parsed as ManagerToWorkerMessage;
    if (message.kind === "worker.registered") {
      this.registered = true;
      this.heartbeatIntervalMs = Math.max(1000, message.heartbeat_interval_ms);
      this.startHeartbeat();
      return;
    }
    if (message.kind === "job.dispatch") {
      await this.handleJob(message.job);
      return;
    }
    if (message.kind === "job.control") {
      if (message.job_id !== this.activeJobId) {
        return;
      }
      if (message.action === "cancel") {
        this.activeAbortController?.abort(message.reason || "cancelled by manager");
      }
      return;
    }
    if (message.kind === "worker.release") {
      this.stop();
      if (this.options.exitOnRelease !== false) {
        setTimeout(() => process.exit(0), 25).unref();
      }
    }
  }

  private async handleJob(jobValue: unknown): Promise<void> {
    if (!isRuntimeWorkerJob(jobValue)) {
      this.sendAck({
        jobId: "unknown",
        status: "invalid_job",
        reason: "RuntimeWorkerJob is invalid.",
      });
      return;
    }
    const job = jobValue;
    if (this.completedJobs.has(job.job_id)) {
      this.sendAck({ jobId: job.job_id, status: "duplicate", reason: null });
      return;
    }
    if (this.activeJobId) {
      this.sendAck({
        jobId: job.job_id,
        status: "worker_busy",
        reason: `Worker is running ${this.activeJobId}.`,
      });
      return;
    }
    if (!getSupportedHarnesses().includes(job.harness.agent_runtime)) {
      this.sendAck({
        jobId: job.job_id,
        status: "unsupported_runtime",
        reason: `Harness ${job.harness.agent_runtime} is not available in this worker image.`,
      });
      return;
    }

    this.activeJobId = job.job_id;
    this.activeAbortController = new AbortController();
    this.sendAck({ jobId: job.job_id, status: "accepted", reason: null });
    let lastSequence = 0;
    let lastEvidenceSequence = 0;
    try {
      const result = await runRuntimeWorkerJob(job, {
        workerId: this.options.workerId,
        signal: this.activeAbortController.signal,
        emitEvidence: async (evidence) => {
          lastEvidenceSequence = evidence.sequence || lastEvidenceSequence;
          this.sendEvidence(evidence);
        },
      });
      for (const event of result.events) {
        if (this.activeAbortController.signal.aborted) {
          throw new Error(
            typeof this.activeAbortController.signal.reason === "string"
              ? this.activeAbortController.signal.reason
              : "Runtime job cancelled.",
          );
        }
        lastSequence = event.sequence;
        this.sendEvent(event);
      }
      this.completedJobs.add(job.job_id);
      if (this.completedJobs.size > 128) {
        this.completedJobs.delete(this.completedJobs.values().next().value as string);
      }
    } catch (error) {
      const cancelled = this.activeAbortController.signal.aborted;
      const sequence = lastSequence + 1;
      const kind = cancelled ? "worker.cancelled" as const : "worker.failed" as const;
      const message = error instanceof Error ? error.message : "Runtime worker failed.";
      const report: NormalizedExecutionReport = {
        run_id: job.run_id,
        node_run_id: job.node_run_id,
        status: cancelled ? "cancelled" : "failed",
        progress: { percent: 100, message },
        artifacts: [],
        error: { code: cancelled ? "worker_cancelled" : "worker_failed", message },
        raw_ref: {
          job_id: job.job_id,
          worker_id: this.options.workerId,
          lease_id: process.env.MY_MATE_WORKER_LEASE_ID || null,
          target_kind: job.provision.target_kind,
          dispatch_id: `worker:${this.options.workerId}:${job.job_id}`,
          provider_refs: {},
          openclaw_task_id: null,
          openclaw_session_id: null,
        },
        created_at: new Date().toISOString(),
      };
      const event: WorkerEvent = {
        event_id: `${job.job_id}:evt:${sequence}`,
        idempotency_key: runtimeEventIdempotencyKey({
          runId: job.run_id,
          nodeRunId: job.node_run_id,
          jobId: job.job_id,
          sequence,
          kind,
        }),
        sequence,
        kind,
        job_id: job.job_id,
        run_id: job.run_id,
        node_run_id: job.node_run_id,
        worker_id: this.options.workerId,
        created_at: report.created_at,
        report,
      };
      const errorEvidence = buildWorkerEvidenceV2({
        job,
        workerId: this.options.workerId,
        sequence: lastEvidenceSequence + 1,
        event: {
          kind: "error",
          summary: message,
          source: {
            provider: job.harness.agent_runtime,
            model: null,
            native_event_id: null,
            synthetic: true,
          },
          inline_payload: { cancelled },
          created_at: report.created_at,
        },
      });
      this.sendEvidence(errorEvidence);
      this.sendEvent(event);
    } finally {
      this.activeJobId = null;
      this.activeAbortController = null;
      this.sendHeartbeat();
    }
  }

  private sendAck(input: {
    jobId: string;
    status: JobAckMessage["status"];
    reason: string | null;
  }): void {
    this.send({
      ...createRuntimeMessageBase(),
      kind: "job.ack",
      worker_id: this.options.workerId,
      job_id: input.jobId,
      status: input.status,
      reason: input.reason,
    });
  }

  private sendEvent(event: WorkerEvent): void {
    this.send({
      ...createRuntimeMessageBase(),
      kind: "worker.event",
      worker_id: this.options.workerId,
      event,
    });
  }

  private sendEvidence(evidence: WorkerEvidence): void {
    this.send({
      ...createRuntimeMessageBase(),
      kind: "worker.evidence",
      worker_id: this.options.workerId,
      evidence,
    });
  }

  private sendHeartbeat(): void {
    if (!this.registered) {
      return;
    }
    this.send({
      ...createRuntimeMessageBase(),
      kind: "worker.heartbeat",
      worker_id: this.options.workerId,
      active_job_id: this.activeJobId,
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat(),
      this.heartbeatIntervalMs,
    );
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopping) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectDelayMs || 1500);
    this.reconnectTimer.unref();
  }

  private send(message: WorkerToManagerMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }
}
