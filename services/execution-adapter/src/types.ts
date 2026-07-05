export type DispatchStatus = "accepted" | "running" | "waiting_human" | "completed" | "failed" | "cancelled";
export type BridgeExecutionMode = "mock" | "native-agent" | "container-exec";
export type ControlAction = "pause" | "resume" | "cancel" | "retry" | "skip";
export type DispatchRepairAction = "mark_failed" | "mark_cancelled" | "normalize_session_key";
export type RegistryStatus = "active" | "disabled";

export interface RegistrySkillProvenance {
  skill_id: string;
  sources: Array<"agent_profile_default" | "node_allowed">;
  registry_status: RegistryStatus | "missing";
  included: boolean;
  excluded_reason: "disallowed_by_agent_profile" | "disabled" | "missing" | null;
}

export interface RegistryToolProvenance {
  tool_id: string;
  sources: Array<"agent_profile_allowed" | "node_allowed">;
}

export interface RegistryProvenance {
  agent_profile_requested: string | null;
  agent_profile_resolved: string | null;
  agent_profile_status: RegistryStatus | "missing" | null;
  agent_profile_source: "registry" | "template_binding" | "fallback" | "none";
  openclaw_agent_id_source: "registry" | "template_binding" | "fallback" | "none";
  skill_bindings: RegistrySkillProvenance[];
  tool_bindings: RegistryToolProvenance[];
}

export interface DispatchRequest {
  run_id: string;
  node_run_id: string;
  node_id: string;
  node_name: string;
  node_type: string;
  template_id: string;
  template_version: number;
  workspace_id: string;
  requested_by: string;
  intent: string;
  openclaw_agent_id: string | null;
  allowed_skills: string[];
  allowed_tools: string[];
  registry_provenance?: RegistryProvenance;
  timeout_seconds: number;
  parallelism_budget: number;
  retry_policy: {
    max_attempts: number;
    attempt: number;
  };
  input_payload: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  callback: {
    report_url: string;
    bearer_token: string | null;
  };
  trace_context: {
    run_id: string;
    node_run_id: string;
    requested_by: string;
  };
  openclaw_runtime: {
    execution_mode: string;
    gateway_base_url: string | null;
    approval_console_base_url: string | null;
    container_name: string | null;
  };
}

export interface DispatchResponse {
  dispatch_id: string;
  openclaw_task_id: string | null;
  openclaw_session_id: string | null;
  status: "accepted" | "rejected" | "deferred";
}

export interface ControlRequest {
  run_id: string;
  node_run_id: string | null;
  action: ControlAction;
  trace_context: {
    run_id: string;
    node_run_id: string | null;
  };
}

export interface DispatchRepairRequest {
  action: DispatchRepairAction;
  reason?: string;
}

export interface ArtifactRecord {
  artifact_id: string;
  type: string;
  name: string;
  storage_uri: string;
  mime_type: string;
  size_bytes: number;
}

export interface DirectAgentReference {
  attempted: boolean;
  sessionId: string | null;
  sessionKey: string | null;
  sessionFile: string | null;
  runId: string | null;
  taskId: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  completionText: string | null;
  reportText: string | null;
  mode: "completed-inline" | "async-task";
}

export interface ReportPayload {
  run_id: string;
  node_run_id: string;
  status: DispatchStatus;
  progress?: {
    percent: number;
    message: string;
  };
  artifacts?: ArtifactRecord[];
  error?: {
    code: string;
    message: string;
  } | null;
  raw_ref?: {
    dispatch_id: string | null;
    openclaw_task_id: string | null;
    openclaw_session_id: string | null;
  } | null;
  created_at?: string;
}

export interface DispatchRecord {
  dispatch_id: string;
  run_id: string;
  node_run_id: string;
  node_id: string;
  node_name: string;
  openclaw_agent_id: string | null;
  status: DispatchStatus | "queued";
  mode: BridgeExecutionMode;
  callback_url: string;
  callback_bearer_token: string | null;
  openclaw_task_id: string | null;
  openclaw_session_id: string | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  native_handoff_file: string | null;
  openclaw_state_path: string | null;
  openclaw_dispatch_file: string | null;
  openclaw_result_session_id: string | null;
  openclaw_result_session_key: string | null;
  openclaw_result_session_file: string | null;
  openclaw_result_run_id: string | null;
  openclaw_result_trajectory_dir: string | null;
  poll_started_at: string | null;
  last_polled_at: string | null;
  last_reported_status: DispatchStatus | "queued" | null;
  direct_agent: DirectAgentReference | null;
  request_snapshot: DispatchRequest;
}
