import type { RuntimeWorkerJob } from "../runtime-protocol.js";

export type RuntimeCompensationReason =
  | "node_timeout"
  | "job_timeout"
  | "lease_expired"
  | "worker_lost"
  | "operator_requested";

export type RuntimeCompensationStatus =
  | "detected"
  | "cancelling"
  | "cleanup_pending"
  | "cleanup_failed"
  | "completed";

export interface RuntimeCompensationRecord {
  schema_version: 1;
  compensation_id: string;
  run_id: string;
  node_run_id: string;
  job_id: string;
  worker_id: string | null;
  lease_id: string | null;
  reason: RuntimeCompensationReason;
  status: RuntimeCompensationStatus;
  deadline_at: string;
  detected_at: string;
  updated_at: string;
  completed_at: string | null;
  cleanup_attempt_ids: string[];
  capacity_released: boolean;
  retry_scheduled: boolean;
  redispatched_job_id: string | null;
  last_error: string | null;
  evidence_event_ids: string[];
}

export type ExecutionReplayStatus =
  | "requested"
  | "dispatching"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExecutionReplayRecord {
  schema_version: 1;
  replay_id: string;
  idempotency_key: string;
  run_id: string;
  node_run_id: string;
  source_job_id: string;
  replay_job_id: string | null;
  source_attempt: number;
  replay_attempt: number | null;
  status: ExecutionReplayStatus;
  requested_by: string;
  requested_at: string;
  updated_at: string;
  completed_at: string | null;
  identity_digest: string;
  plan_identity: {
    template_id: string;
    template_version: number;
    node_id: string;
    node_run_id: string;
  };
  runtime_identity: {
    target_kind: string;
    agent_runtime: string;
    runtime_agent_ref: string | null;
    harness_profile: string | null;
  };
  lineage_event_ids: string[];
  last_error: string | null;
  frozen_job: RuntimeWorkerJob;
}

export type ExecutionReplayView = Omit<ExecutionReplayRecord, "frozen_job"> & {
  frozen_input: {
    intent: string;
    input_keys: string[];
    allowed_skills: string[];
    allowed_tools: string[];
  };
};

export interface RuntimeRecoveryView {
  run_id: string;
  generated_at: string;
  posture: "healthy" | "recovering" | "degraded";
  summary: {
    compensations: number;
    pending_compensations: number;
    cleanup_failures: number;
    execution_replays: number;
    active_replays: number;
  };
  compensations: RuntimeCompensationRecord[];
  execution_replays: ExecutionReplayView[];
}
