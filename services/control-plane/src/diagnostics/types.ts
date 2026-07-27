export type DoctorMode = "quick" | "docker" | "model";

export type DoctorRuntime =
  | "local"
  | "docker-worker"
  | "codex"
  | "claude-sdk"
  | "kimi"
  | "glm";

export type DoctorReadinessTarget = "runtime" | "deterministic" | "model";

export interface DoctorRequest {
  mode: DoctorMode;
  runtime?: DoctorRuntime;
  model_probe?: boolean;
  provider_connection_id?: string;
}

export interface DoctorCheck {
  id: string;
  category:
    | "control_plane"
    | "storage"
    | "runtime"
    | "docker"
    | "worker"
    | "workspace"
    | "harness"
    | "provider";
  status: "pass" | "warn" | "fail" | "skipped";
  required_for: DoctorReadinessTarget[];
  summary: string;
  detail: string | null;
  remediation: string | null;
  duration_ms: number;
}

export interface DoctorReport {
  schema_version: 1;
  report_id: string;
  generated_at: string;
  runtime_ready: boolean;
  deterministic_ready: boolean;
  model_ready: boolean;
  model_verified: boolean | null;
  storage_backend: string;
  runtime_dispatcher: string;
  checks: DoctorCheck[];
}

export interface DoctorCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type DoctorCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<DoctorCommandResult>;

export interface DoctorRuntimeStatus {
  dispatcher_kind: string;
  legacy_execution_adapter_bridge: boolean;
  node_provisioner_kind: string;
  node_provisioner_status: "not_wired" | "ready" | "deferred";
  worker_hub_kind: string | null;
  connected_workers: number;
  busy_workers: number;
  stale_workers: number;
  worker_capacity_limit: number;
  worker_capacity_active: number;
  worker_queue_depth: number;
  worker_queue_limit: number;
  worker_queue_timeout_ms: number;
  worker_cleanup_pending: number;
  worker_cleanup_failed: number;
  worker_reconciliation_at: string | null;
  worker_reconciliation_status: "not_run" | "healthy" | "degraded" | "failed";
  worker_reconciliation_discovered: number;
  worker_reconciliation_orphans: number;
  worker_reconciliation_removed: number;
  worker_reconciliation_failures: number;
}

export interface DoctorWorkerHub {
  expectWorker(input: {
    workerId: string;
    token: string;
    metadata?: Record<string, unknown>;
  }): unknown;
  waitForWorker(workerId: string, timeoutMs: number): Promise<unknown>;
  releaseWorker(workerId: string, reason: string): void;
}
