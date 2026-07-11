export const RUNTIME_PROTOCOL_VERSION = "my_mate_runtime_v1" as const;

export type RuntimeProtocolVersion = typeof RUNTIME_PROTOCOL_VERSION;

export type RuntimeAgentRuntime =
  | "local"
  | "openclaw"
  | "codex"
  | "claude-sdk"
  | "kimi"
  | (string & {});

export type WorkerTargetKind =
  | "local"
  | "external-bridge"
  | "docker-worker"
  | "node-worker";

export type WorkerEventKind =
  | "worker.accepted"
  | "worker.progress"
  | "worker.waiting_human"
  | "worker.completed"
  | "worker.failed"
  | "worker.cancelled"
  | "worker.handoff"
  | "worker.provisioning_requested"
  | "worker.provisioning_completed"
  | "worker.provisioning_failed";

export type WorkerEvidenceKind =
  | "prompt"
  | "model_turn"
  | "model_text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "handoff"
  | "artifact_ref"
  | "error"
  | "usage"
  | "log";

export interface MoneyAmount {
  currency: string;
  amount_decimal: string;
}

export interface EstimatedMoneyAmount extends MoneyAmount {
  catalog_id: string;
  catalog_version: string;
}

export interface UsageSummary {
  availability: "available" | "partial" | "unavailable";
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  turn_count: number | null;
  provider_reported_cost: MoneyAmount | null;
  estimated_cost: EstimatedMoneyAmount | null;
}

export interface WorkerEvidenceSource {
  provider: string | null;
  model: string | null;
  native_event_id: string | null;
  synthetic: boolean;
}

export interface WorkerEvidenceTrace {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  tool_call_id: string | null;
}

export interface HarnessEvidenceEvent {
  kind: WorkerEvidenceKind;
  summary: string;
  source?: Partial<WorkerEvidenceSource>;
  trace?: Partial<WorkerEvidenceTrace>;
  input_ref?: string | null;
  output_ref?: string | null;
  storage_uri?: string | null;
  inline_payload?: unknown;
  usage?: UsageSummary | null;
  redaction_status?: "not_required" | "redacted" | "blocked";
  sensitive_paths?: string[];
  created_at?: string;
}

export interface RuntimeHarnessSpec {
  agent_runtime: RuntimeAgentRuntime;
  runtime_agent_ref: string | null;
  harness_profile: string | null;
  allowed_skills: string[];
  allowed_tools: string[];
}

export interface WorkerWorkspaceSpec {
  workspace_id: string;
  mode: "shared" | "isolated" | "external" | "unknown";
  project_slug: string | null;
  project_local_repo: string | null;
  container_path?: string | null;
  metadata: Record<string, unknown>;
}

export interface WorkerProvisionSpec {
  required: boolean;
  target_kind: WorkerTargetKind;
  image: string | null;
  container_group: string | null;
  required_capabilities: string[];
  env: Record<string, string>;
  workspace: WorkerWorkspaceSpec;
  resource_limits?: {
    cpus?: number | null;
    memory_mb?: number | null;
    pids?: number | null;
  };
}

export interface RuntimeWorkerJob<TEnvelope = Record<string, unknown>> {
  job_id: string;
  run_id: string;
  node_run_id: string;
  node_id: string;
  node_name: string;
  node_type: string;
  attempt: number;
  dispatch_sequence: number;
  envelope: TEnvelope;
  harness: RuntimeHarnessSpec;
  provision: WorkerProvisionSpec;
  trace_context: {
    run_id: string;
    node_run_id: string;
    requested_by: string;
  };
  created_at: string;
}

export interface ProviderNeutralExecutionRef {
  job_id?: string | null;
  worker_id?: string | null;
  lease_id?: string | null;
  target_kind?: WorkerTargetKind | null;
  dispatch_id: string | null;
  provider_refs?: Record<string, string | null>;
  openclaw_task_id: string | null;
  openclaw_session_id: string | null;
}

export interface ExecutionArtifactRecord {
  artifact_id: string;
  type: string;
  name: string;
  storage_uri: string;
  mime_type: string;
  size_bytes: number;
}

export interface NormalizedExecutionReport {
  run_id: string;
  node_run_id: string;
  status:
    | "accepted"
    | "running"
    | "waiting_human"
    | "completed"
    | "failed"
    | "cancelled";
  progress: {
    percent: number;
    message: string;
  };
  artifacts: ExecutionArtifactRecord[];
  error: {
    code: string;
    message: string;
  } | null;
  raw_ref: ProviderNeutralExecutionRef;
  created_at: string;
}

export interface WorkerLease {
  lease_id: string;
  worker_id: string;
  job_id?: string | null;
  target_kind: WorkerTargetKind;
  run_id: string;
  node_run_id: string;
  container_id: string | null;
  execution_ref: ProviderNeutralExecutionRef | null;
  acquired_at: string;
  last_heartbeat_at?: string | null;
  expires_at: string | null;
  released_at?: string | null;
  release_reason?: string | null;
  metadata: Record<string, unknown>;
}

export interface NodeHandoff {
  type: "node_handoff";
  handoff_id?: string;
  job_id?: string;
  run_id: string;
  node_run_id: string;
  node_id: string;
  port: string;
  content: unknown;
  content_ref?: string | null;
  summary: string | null;
  created_at: string;
}

export interface WorkerEvidence {
  evidence_schema_version?: 1 | 2;
  evidence_id: string;
  run_id: string;
  node_run_id: string;
  job_id: string;
  worker_id: string;
  sequence?: number;
  kind: WorkerEvidenceKind;
  source?: WorkerEvidenceSource;
  trace?: WorkerEvidenceTrace;
  summary: string;
  input_ref?: string | null;
  output_ref?: string | null;
  storage_uri: string | null;
  inline_payload: unknown;
  usage?: UsageSummary | null;
  redaction_status: "not_required" | "redacted" | "blocked";
  created_at: string;
}

export interface HarnessResult {
  reports: NormalizedExecutionReport[];
  handoffs?: NodeHandoff[];
}

export interface HarnessClient {
  execute(
    job: RuntimeWorkerJob,
    emit: (event: HarnessEvidenceEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<HarnessResult>;
}

export interface WorkerEventBase {
  event_id: string;
  idempotency_key: string;
  sequence: number;
  kind: WorkerEventKind;
  job_id: string;
  run_id: string;
  node_run_id: string;
  worker_id: string | null;
  created_at: string;
}

export type WorkerEvent<TReport = NormalizedExecutionReport> =
  | (WorkerEventBase & {
      kind:
        | "worker.accepted"
        | "worker.progress"
        | "worker.waiting_human"
        | "worker.completed"
        | "worker.failed"
        | "worker.cancelled";
      report: TReport;
    })
  | (WorkerEventBase & {
      kind: "worker.handoff";
      handoff: NodeHandoff;
    })
  | (WorkerEventBase & {
      kind: "worker.provisioning_requested";
      provision: WorkerProvisionSpec;
    })
  | (WorkerEventBase & {
      kind: "worker.provisioning_completed";
      lease: WorkerLease;
    })
  | (WorkerEventBase & {
      kind: "worker.provisioning_failed";
      reason: string;
      retryable: boolean;
    });

export type JobAckStatus =
  | "accepted"
  | "rejected"
  | "duplicate"
  | "worker_busy"
  | "lease_expired"
  | "unsupported_runtime"
  | "invalid_job";

export type RuntimeControlAction = "pause" | "resume" | "cancel";

export interface RuntimeSocketMessageBase {
  protocol: RuntimeProtocolVersion;
  message_id: string;
  sent_at: string;
}

export interface WorkerRegisterMessage extends RuntimeSocketMessageBase {
  kind: "worker.register";
  worker_id: string;
  token: string;
  version: string;
  capabilities: string[];
  supported_harnesses: RuntimeAgentRuntime[];
  metadata: Record<string, unknown>;
}

export interface WorkerHeartbeatMessage extends RuntimeSocketMessageBase {
  kind: "worker.heartbeat";
  worker_id: string;
  active_job_id: string | null;
}

export interface JobAckMessage extends RuntimeSocketMessageBase {
  kind: "job.ack";
  worker_id: string;
  job_id: string;
  status: JobAckStatus;
  reason: string | null;
}

export interface WorkerEventMessage<TReport = NormalizedExecutionReport>
  extends RuntimeSocketMessageBase {
  kind: "worker.event";
  worker_id: string;
  event: WorkerEvent<TReport>;
}

export interface WorkerEvidenceMessage extends RuntimeSocketMessageBase {
  kind: "worker.evidence";
  worker_id: string;
  evidence: WorkerEvidence;
}

export type WorkerToManagerMessage =
  | WorkerRegisterMessage
  | WorkerHeartbeatMessage
  | JobAckMessage
  | WorkerEventMessage
  | WorkerEvidenceMessage;

export interface WorkerRegisteredMessage extends RuntimeSocketMessageBase {
  kind: "worker.registered";
  worker_id: string;
  heartbeat_interval_ms: number;
  stale_after_ms: number;
}

export interface JobDispatchMessage<TEnvelope = Record<string, unknown>>
  extends RuntimeSocketMessageBase {
  kind: "job.dispatch";
  job: RuntimeWorkerJob<TEnvelope>;
}

export interface JobControlMessage extends RuntimeSocketMessageBase {
  kind: "job.control";
  job_id: string;
  action: RuntimeControlAction;
  reason: string | null;
}

export interface WorkerReleaseMessage extends RuntimeSocketMessageBase {
  kind: "worker.release";
  worker_id: string;
  reason: string;
}

export interface ProtocolErrorMessage extends RuntimeSocketMessageBase {
  kind: "protocol.error";
  code: string;
  message: string;
  related_message_id: string | null;
}

export type ManagerToWorkerMessage<TEnvelope = Record<string, unknown>> =
  | WorkerRegisteredMessage
  | JobDispatchMessage<TEnvelope>
  | JobControlMessage
  | WorkerReleaseMessage
  | ProtocolErrorMessage;

export function createRuntimeMessageBase(input?: {
  messageId?: string;
  sentAt?: string;
}): RuntimeSocketMessageBase {
  return {
    protocol: RUNTIME_PROTOCOL_VERSION,
    message_id:
      input?.messageId ||
      `rtmsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    sent_at: input?.sentAt || new Date().toISOString(),
  };
}

export function runtimeEventIdempotencyKey(input: {
  runId: string;
  nodeRunId: string;
  jobId: string;
  sequence: number;
  kind: WorkerEventKind;
}): string {
  return `${input.runId}:${input.nodeRunId}:${input.jobId}:${input.sequence}:${input.kind}`;
}

export function isTerminalWorkerEventKind(kind: WorkerEventKind): boolean {
  return (
    kind === "worker.completed" ||
    kind === "worker.failed" ||
    kind === "worker.cancelled"
  );
}

export function isRuntimeProtocolMessage(value: unknown): value is RuntimeSocketMessageBase & {
  kind: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.protocol === RUNTIME_PROTOCOL_VERSION &&
    typeof record.message_id === "string" &&
    typeof record.sent_at === "string" &&
    typeof record.kind === "string"
  );
}
