import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  RUNTIME_WORKER_HEARTBEAT_INTERVAL_MS,
  RUNTIME_WORKER_STALE_AFTER_MS,
} from "./config.js";
import {
  RUNTIME_PROTOCOL_VERSION,
  createRuntimeMessageBase,
  isRuntimeProtocolMessage,
  type JobAckMessage,
  type JobControlAckMessage,
  type JobControlMessage,
  type JobDispatchMessage,
  type RuntimeControlAction,
  type RuntimeWorkerJob,
  type WorkerEvent,
  type WorkerEvidence,
  type WorkerRegisterMessage,
  type WorkerToManagerMessage,
} from "./runtime-protocol.js";
import {
  getRuntimeWorkerRecord,
  listRuntimeWorkerRecords,
  saveRuntimeWorkerRecord,
  type RuntimeWorkerRecord,
} from "./runtime/runtime-worker-store.js";
import { saveWorkerEvidence } from "./runtime/worker-evidence-store.js";
import { deriveRuntimeWorkerToken } from "./runtime-worker-auth.js";
import { nowIso } from "./utils.js";
import { appendRunEvent } from "./event-store.js";
import {
  getRuntimeHumanGate,
  saveRuntimeHumanGate,
} from "./runtime/human-gate-store.js";

interface WorkerConnection {
  workerId: string;
  socket: WebSocket;
  activeJobId: string | null;
  activeJob: RuntimeWorkerJob | null;
  messageChain: Promise<void>;
}

interface WorkerExpectation {
  token: string;
  metadata: Record<string, unknown>;
  expectedAt: string;
}

interface WorkerWaiter {
  resolve: (record: RuntimeWorkerRecord) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface AckWaiter {
  resolve: (ack: JobAckMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RuntimeWorkerHubSummary {
  connected_workers: number;
  busy_workers: number;
  stale_workers: number;
  expected_workers: number;
  worker_ids: string[];
}

function parseJson(data: RawData): unknown {
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString("utf-8")
    : data instanceof ArrayBuffer
      ? Buffer.from(data).toString("utf-8")
      : Buffer.from(data).toString("utf-8");
  return JSON.parse(text) as unknown;
}

function pathWorkerId(req: IncomingMessage): string | null {
  const url = new URL(req.url || "/", "http://runtime.local");
  const match = url.pathname.match(/^\/ws\/runtime-workers\/([^/]+)$/);
  return match ? decodeURIComponent(match[1] || "") : null;
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}\n`,
  );
  socket.destroy();
}

export function matchesEvidenceDispatchIdentity(input: {
  connectionWorkerId: string;
  messageWorkerId: string;
  activeJob: RuntimeWorkerJob | null;
  evidence: WorkerEvidence;
}): boolean {
  return Boolean(
    input.activeJob &&
    input.messageWorkerId === input.connectionWorkerId &&
    input.evidence.worker_id === input.connectionWorkerId &&
    input.evidence.job_id === input.activeJob.job_id &&
    input.evidence.run_id === input.activeJob.run_id &&
    input.evidence.node_run_id === input.activeJob.node_run_id,
  );
}

function journalWorkerStatusChange(input: {
  record: RuntimeWorkerRecord;
  previousStatus: RuntimeWorkerRecord["status"];
  createdAt: string;
}): void {
  if (input.previousStatus === input.record.status) return;
  const runId = typeof input.record.metadata.run_id === "string" ? input.record.metadata.run_id : null;
  const nodeRunId = typeof input.record.metadata.node_run_id === "string"
    ? input.record.metadata.node_run_id
    : null;
  if (!runId) return;
  appendRunEvent({
    run_id: runId,
    node_run_id: nodeRunId,
    type: "worker.status_changed",
    actor_type: "system",
    actor_id: "worker-hub",
    payload: {
      worker_id: input.record.worker_id,
      previous_status: input.previousStatus,
      status: input.record.status,
      active_job_id: input.record.active_job_id,
    },
    created_at: input.createdAt,
    idempotency_key: `worker.status_changed:${input.record.worker_id}:${input.record.status}:${input.record.active_job_id || "idle"}`,
  });
}

export class RuntimeWorkerHub {
  readonly kind = "websocket-worker-hub";

  private readonly server = new WebSocketServer({ noServer: true });
  private readonly connections = new Map<string, WorkerConnection>();
  private readonly expectations = new Map<string, WorkerExpectation>();
  private readonly workerWaiters = new Map<string, Set<WorkerWaiter>>();
  private readonly ackWaiters = new Map<string, AckWaiter>();
  private eventHandler: (event: WorkerEvent) => Promise<void> = async () => {};
  private evidenceHandler: (evidence: WorkerEvidence) => Promise<void> = async (evidence) => {
    const saved = saveWorkerEvidence(evidence);
    appendRunEvent({
      run_id: saved.run_id,
      node_run_id: saved.node_run_id,
      type: "evidence.recorded",
      actor_type: "agent",
      actor_id: `runtime-worker:${saved.worker_id}`,
      payload: {
        evidence_id: saved.evidence_id,
        job_id: saved.job_id,
        evidence_schema_version: saved.evidence_schema_version || 1,
        sequence: saved.sequence || null,
        kind: saved.kind,
        source: saved.source || null,
        trace: saved.trace || null,
        redaction_status: saved.redaction_status,
      },
      created_at: saved.created_at,
      idempotency_key: `evidence.recorded:${saved.evidence_id}`,
    });
  };
  private staleHandler: (worker: RuntimeWorkerRecord) => Promise<void> = async () => {};
  private attached = false;
  private staleTimer: NodeJS.Timeout | null = null;

  attach(httpServer: HttpServer): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.resetPersistedConnectionState();
    httpServer.on("upgrade", (req, socket, head) => {
      const workerId = pathWorkerId(req);
      if (!workerId) return;
      this.server.handleUpgrade(req, socket, head, (webSocket) => {
        this.handleConnection(workerId, webSocket);
      });
    });
    this.staleTimer = setInterval(() => this.sweepStaleWorkers(), 5000);
    this.staleTimer.unref();
  }

  setEventHandler(handler: (event: WorkerEvent) => Promise<void>): void {
    this.eventHandler = handler;
  }

  setEvidenceHandler(handler: (evidence: WorkerEvidence) => Promise<void>): void {
    this.evidenceHandler = handler;
  }

  setStaleHandler(handler: (worker: RuntimeWorkerRecord) => Promise<void>): void {
    this.staleHandler = handler;
  }

  expectWorker(input: {
    workerId: string;
    token: string;
    metadata?: Record<string, unknown>;
    expectedAt?: string;
  }): RuntimeWorkerRecord {
    const expectedAt = input.expectedAt || nowIso();
    this.expectations.set(input.workerId, {
      token: input.token,
      metadata: input.metadata || {},
      expectedAt,
    });
    const record = saveRuntimeWorkerRecord({
      worker_id: input.workerId,
      status: "expected",
      version: "",
      capabilities: [],
      supported_harnesses: [],
      harness_capabilities: {},
      active_job_id: null,
      expected_at: expectedAt,
      registered_at: null,
      last_heartbeat_at: null,
      disconnected_at: null,
      released_at: null,
      metadata: input.metadata || {},
    });
    const runId = typeof input.metadata?.run_id === "string" ? input.metadata.run_id : null;
    const nodeRunId = typeof input.metadata?.node_run_id === "string" ? input.metadata.node_run_id : null;
    if (runId) {
      appendRunEvent({
        run_id: runId,
        node_run_id: nodeRunId,
        type: "worker.expected",
        actor_type: "system",
        actor_id: "worker-hub",
        payload: { worker_id: input.workerId, metadata: input.metadata || {} },
        created_at: expectedAt,
        idempotency_key: `worker.expected:${input.workerId}`,
      });
    }
    return record;
  }

  async waitForWorker(workerId: string, timeoutMs: number): Promise<RuntimeWorkerRecord> {
    const current = getRuntimeWorkerRecord(workerId);
    const connection = this.connections.get(workerId);
    if (current && connection?.socket.readyState === WebSocket.OPEN) {
      return current;
    }

    return await new Promise<RuntimeWorkerRecord>((resolve, reject) => {
      const waiter: WorkerWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeWorkerWaiter(workerId, waiter);
          reject(new Error(`Worker ${workerId} did not register within ${timeoutMs}ms.`));
        }, timeoutMs),
      };
      const waiters = this.workerWaiters.get(workerId) || new Set<WorkerWaiter>();
      waiters.add(waiter);
      this.workerWaiters.set(workerId, waiters);
    });
  }

  async dispatchJob(
    workerId: string,
    job: RuntimeWorkerJob,
    timeoutMs: number,
  ): Promise<JobAckMessage> {
    const connection = this.connections.get(workerId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Runtime worker ${workerId} is not connected.`);
    }
    if (this.ackWaiters.has(job.job_id)) {
      throw new Error(`Runtime job ${job.job_id} is already awaiting acknowledgement.`);
    }

    const ackPromise = new Promise<JobAckMessage>((resolve, reject) => {
      const waiter: AckWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.ackWaiters.delete(job.job_id);
          reject(new Error(`Runtime worker ${workerId} did not acknowledge ${job.job_id}.`));
        }, timeoutMs),
      };
      this.ackWaiters.set(job.job_id, waiter);
    });

    const message: JobDispatchMessage<RuntimeWorkerJob["envelope"]> = {
      ...createRuntimeMessageBase(),
      kind: "job.dispatch",
      job,
    };
    connection.activeJob = job;
    connection.socket.send(JSON.stringify(message));
    return await ackPromise;
  }

  sendControl(input: {
    workerId: string;
    jobId: string;
    action: RuntimeControlAction;
    controlId?: string;
    gateId?: string | null;
    payload?: Record<string, unknown> | null;
    reason?: string | null;
  }): boolean {
    const connection = this.connections.get(input.workerId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    const message: JobControlMessage = {
      ...createRuntimeMessageBase(),
      kind: "job.control",
      control_id: input.controlId || `control:${input.jobId}:${Date.now().toString(36)}`,
      job_id: input.jobId,
      action: input.action,
      gate_id: input.gateId ?? null,
      payload: input.payload ?? null,
      reason: input.reason ?? null,
    };
    connection.socket.send(JSON.stringify(message));
    return true;
  }

  releaseWorker(workerId: string, reason: string): void {
    this.expectations.delete(workerId);
    const connection = this.connections.get(workerId);
    if (connection?.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(
        JSON.stringify({
          ...createRuntimeMessageBase(),
          kind: "worker.release",
          worker_id: workerId,
          reason,
        }),
      );
    }
    const current = getRuntimeWorkerRecord(workerId);
    if (current) {
      current.status = "released";
      current.released_at = nowIso();
      current.active_job_id = null;
      saveRuntimeWorkerRecord(current);
      const runId = typeof current.metadata.run_id === "string" ? current.metadata.run_id : null;
      const nodeRunId = typeof current.metadata.node_run_id === "string" ? current.metadata.node_run_id : null;
      if (runId) {
        appendRunEvent({
          run_id: runId,
          node_run_id: nodeRunId,
          type: "worker.released",
          actor_type: "system",
          actor_id: "worker-hub",
          payload: { worker_id: workerId, reason },
          created_at: current.released_at,
          idempotency_key: `worker.released:${workerId}`,
        });
      }
    }
  }

  getSummary(): RuntimeWorkerHubSummary {
    const records = listRuntimeWorkerRecords();
    return {
      connected_workers: records.filter((record) => record.status === "connected").length,
      busy_workers: records.filter((record) => record.status === "busy").length,
      stale_workers: records.filter((record) => record.status === "stale").length,
      expected_workers: records.filter((record) => record.status === "expected").length,
      worker_ids: [...this.connections.keys()],
    };
  }

  sweepStaleWorkers(now = Date.now()): string[] {
    const staleWorkerIds: string[] = [];
    for (const record of listRuntimeWorkerRecords()) {
      if (record.status !== "connected" && record.status !== "busy") {
        continue;
      }
      const heartbeatAt = Date.parse(record.last_heartbeat_at || record.registered_at || "");
      if (!Number.isFinite(heartbeatAt) || now - heartbeatAt <= RUNTIME_WORKER_STALE_AFTER_MS) {
        continue;
      }
      const previousStatus = record.status;
      record.status = "stale";
      saveRuntimeWorkerRecord(record);
      journalWorkerStatusChange({
        record,
        previousStatus,
        createdAt: nowIso(),
      });
      staleWorkerIds.push(record.worker_id);
      this.connections.get(record.worker_id)?.socket.close(1011, "heartbeat timeout");
      void this.staleHandler(record).catch(() => undefined);
    }
    return staleWorkerIds;
  }

  close(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    for (const connection of this.connections.values()) {
      connection.socket.close();
    }
    this.connections.clear();
    this.server.close();
  }

  private handleConnection(pathWorkerIdValue: string, socket: WebSocket): void {
    let registered = false;
    let connection: WorkerConnection | null = null;

    socket.on("message", (data) => {
      const run = async () => {
        let message: unknown;
        try {
          message = parseJson(data);
        } catch {
          this.sendProtocolError(socket, "invalid_json", "Runtime message must be valid JSON.");
          return;
        }
        if (!isRuntimeProtocolMessage(message)) {
          this.sendProtocolError(socket, "invalid_protocol", "Unsupported runtime protocol message.");
          return;
        }
        const runtimeMessage = message as WorkerToManagerMessage;
        if (!registered) {
          if (runtimeMessage.kind !== "worker.register") {
            this.sendProtocolError(socket, "registration_required", "Worker must register first.");
            socket.close(1008, "registration required");
            return;
          }
          connection = this.registerWorker(pathWorkerIdValue, socket, runtimeMessage);
          registered = connection !== null;
          return;
        }
        if (connection) {
          await this.handleWorkerMessage(connection, runtimeMessage);
        }
      };

      const activeConnection = connection;
      if (activeConnection) {
        activeConnection.messageChain = activeConnection.messageChain.then(run, run);
      } else {
        void run();
      }
    });

    socket.on("close", () => {
      const current = this.connections.get(pathWorkerIdValue);
      if (current?.socket === socket) {
        this.connections.delete(pathWorkerIdValue);
      }
      const record = getRuntimeWorkerRecord(pathWorkerIdValue);
      if (record && !record.released_at && record.status !== "released") {
        const previousStatus = record.status;
        record.status = "disconnected";
        record.disconnected_at = nowIso();
        saveRuntimeWorkerRecord(record);
        journalWorkerStatusChange({
          record,
          previousStatus,
          createdAt: record.disconnected_at,
        });
      }
    });
  }

  private registerWorker(
    pathWorkerIdValue: string,
    socket: WebSocket,
    message: WorkerRegisterMessage,
  ): WorkerConnection | null {
    if (message.worker_id !== pathWorkerIdValue) {
      this.sendProtocolError(socket, "worker_id_mismatch", "Worker id does not match URL.");
      socket.close(1008, "worker id mismatch");
      return null;
    }
    const expectation = this.expectations.get(message.worker_id);
    const persisted = getRuntimeWorkerRecord(message.worker_id);
    if (!expectation && persisted?.released_at) {
      this.sendProtocolError(socket, "worker_released", "Runtime worker lease was already released.");
      socket.close(1008, "worker released");
      return null;
    }
    const expectedToken = expectation?.token || deriveRuntimeWorkerToken(message.worker_id);
    if (!expectedToken || message.token !== expectedToken) {
      this.sendProtocolError(socket, "unauthorized", "Runtime worker token is invalid.");
      socket.close(1008, "unauthorized");
      return null;
    }

    const previous = this.connections.get(message.worker_id);
    if (previous && previous.socket !== socket) {
      previous.socket.close(1012, "worker reconnected");
    }
    const connection: WorkerConnection = {
      workerId: message.worker_id,
      socket,
      activeJobId: null,
      activeJob: null,
      messageChain: Promise.resolve(),
    };
    this.connections.set(message.worker_id, connection);
    this.expectations.delete(message.worker_id);

    const timestamp = nowIso();
    const record = saveRuntimeWorkerRecord({
      worker_id: message.worker_id,
      status: "connected",
      version: message.version,
      capabilities: [...message.capabilities],
      supported_harnesses: [...message.supported_harnesses],
      harness_capabilities: { ...message.harness_capabilities },
      active_job_id: null,
      expected_at: expectation?.expectedAt || null,
      registered_at: timestamp,
      last_heartbeat_at: timestamp,
      disconnected_at: null,
      released_at: null,
      metadata: {
        ...(expectation?.metadata || {}),
        ...message.metadata,
      },
    });
    const runId = typeof record.metadata.run_id === "string" ? record.metadata.run_id : null;
    const nodeRunId = typeof record.metadata.node_run_id === "string" ? record.metadata.node_run_id : null;
    if (runId) {
      appendRunEvent({
        run_id: runId,
        node_run_id: nodeRunId,
        type: "worker.registered",
        actor_type: "system",
        actor_id: "worker-hub",
        payload: {
          worker_id: record.worker_id,
          version: record.version,
          capabilities: record.capabilities,
          supported_harnesses: record.supported_harnesses,
          harness_capabilities: record.harness_capabilities || {},
        },
        created_at: timestamp,
        idempotency_key: `worker.registered:${record.worker_id}`,
      });
    }
    socket.send(
      JSON.stringify({
        ...createRuntimeMessageBase(),
        kind: "worker.registered",
        worker_id: message.worker_id,
        heartbeat_interval_ms: RUNTIME_WORKER_HEARTBEAT_INTERVAL_MS,
        stale_after_ms: RUNTIME_WORKER_STALE_AFTER_MS,
      }),
    );
    this.resolveWorkerWaiters(message.worker_id, record);
    return connection;
  }

  private async handleWorkerMessage(
    connection: WorkerConnection,
    message: WorkerToManagerMessage,
  ): Promise<void> {
    if (message.kind === "worker.heartbeat") {
      const previousActiveJobId = connection.activeJobId;
      const record = getRuntimeWorkerRecord(connection.workerId);
      if (record && !record.released_at && record.status !== "released") {
        const previousStatus = record.status;
        record.last_heartbeat_at = message.sent_at || nowIso();
        record.active_job_id = message.active_job_id;
        record.status = message.active_job_id ? "busy" : "connected";
        saveRuntimeWorkerRecord(record);
        journalWorkerStatusChange({
          record,
          previousStatus,
          createdAt: record.last_heartbeat_at,
        });
      }
      connection.activeJobId = message.active_job_id;
      if (!message.active_job_id && previousActiveJobId) connection.activeJob = null;
      return;
    }
    if (message.kind === "job.ack") {
      const waiter = this.ackWaiters.get(message.job_id);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.ackWaiters.delete(message.job_id);
        waiter.resolve(message);
      }
      const record = getRuntimeWorkerRecord(connection.workerId);
      if (
        record &&
        !record.released_at &&
        record.status !== "released" &&
        (message.status === "accepted" || message.status === "duplicate")
      ) {
        const previousStatus = record.status;
        record.status = "busy";
        record.active_job_id = message.job_id;
        saveRuntimeWorkerRecord(record);
        journalWorkerStatusChange({
          record,
          previousStatus,
          createdAt: message.sent_at || nowIso(),
        });
      }
      if (message.status === "accepted" || message.status === "duplicate") {
        connection.activeJobId = message.job_id;
      } else {
        connection.activeJob = null;
      }
      return;
    }
    if (message.kind === "job.control_ack") {
      this.recordControlAck(connection, message);
      return;
    }
    if (message.kind === "worker.event") {
      await this.eventHandler(message.event);
      return;
    }
    if (message.kind === "worker.evidence") {
      const evidence = message.evidence;
      const activeJob = connection.activeJob;
      if (!matchesEvidenceDispatchIdentity({
        connectionWorkerId: connection.workerId,
        messageWorkerId: message.worker_id,
        activeJob,
        evidence,
      })) {
        this.sendProtocolError(
          connection.socket,
          "evidence_identity_mismatch",
          "Worker evidence does not match the active dispatch identity.",
        );
        return;
      }
      try {
        await this.evidenceHandler(evidence);
      } catch (error) {
        this.sendProtocolError(
          connection.socket,
          "invalid_evidence",
          error instanceof Error ? error.message : "Worker evidence validation failed.",
        );
      }
      return;
    }
    if (message.kind === "worker.register") {
      this.sendProtocolError(connection.socket, "already_registered", "Worker is already registered.");
    }
  }

  private recordControlAck(connection: WorkerConnection, message: JobControlAckMessage): void {
    const job = connection.activeJob;
    if (!job || job.job_id !== message.job_id || message.worker_id !== connection.workerId) {
      this.sendProtocolError(
        connection.socket,
        "control_ack_identity_mismatch",
        "Worker control acknowledgement does not match the active dispatch identity.",
      );
      return;
    }
    appendRunEvent({
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      type: message.status === "applied" ? "job.control_applied" : "job.control_rejected",
      actor_type: "agent",
      actor_id: `runtime-worker:${connection.workerId}`,
      payload: {
        control_id: message.control_id,
        job_id: message.job_id,
        action: message.action,
        gate_id: message.gate_id,
        status: message.status,
        reason: message.reason,
      },
      created_at: message.sent_at || nowIso(),
      idempotency_key: `job.control_ack:${message.control_id}`,
    });
    if (message.gate_id) {
      const gate = getRuntimeHumanGate(job.run_id, message.gate_id);
      if (gate && gate.job_id === message.job_id) {
        if (message.status === "applied") {
          gate.status = message.action === "resume" ? "resumed" : "cancelled";
          gate.resolved_at = message.sent_at || nowIso();
          gate.last_error = null;
        } else {
          gate.status = "suspended";
          gate.last_error = message.reason || "Runtime Worker rejected human-gate control.";
        }
        gate.control_id = message.control_id;
        saveRuntimeHumanGate(gate);
      }
    }
  }

  private sendProtocolError(socket: WebSocket, code: string, message: string): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        ...createRuntimeMessageBase(),
        kind: "protocol.error",
        code,
        message,
        related_message_id: null,
      }),
    );
  }

  private resolveWorkerWaiters(workerId: string, record: RuntimeWorkerRecord): void {
    const waiters = this.workerWaiters.get(workerId);
    if (!waiters) {
      return;
    }
    this.workerWaiters.delete(workerId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(record);
    }
  }

  private removeWorkerWaiter(workerId: string, waiter: WorkerWaiter): void {
    const waiters = this.workerWaiters.get(workerId);
    waiters?.delete(waiter);
    if (waiters?.size === 0) {
      this.workerWaiters.delete(workerId);
    }
  }

  private resetPersistedConnectionState(): void {
    const disconnectedAt = nowIso();
    for (const record of listRuntimeWorkerRecords()) {
      if (!["expected", "connected", "busy", "stale"].includes(record.status)) {
        continue;
      }
      const previousStatus = record.status;
      record.status = "disconnected";
      record.active_job_id = null;
      record.disconnected_at = disconnectedAt;
      saveRuntimeWorkerRecord(record);
      journalWorkerStatusChange({ record, previousStatus, createdAt: disconnectedAt });
    }
  }
}

export function runtimeWorkerWebSocketUrl(baseUrl: string, workerId: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = `/ws/runtime-workers/${encodeURIComponent(workerId)}`;
  url.search = "";
  return url.toString();
}

export { RUNTIME_PROTOCOL_VERSION };
