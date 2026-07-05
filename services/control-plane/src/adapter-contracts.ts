import type {
  AdapterDispatchResult,
  CompiledNodeRecord,
  DispatchEnvelope,
  ExecutionArtifactRecord,
  NormalizedExecutionReport,
  OpenClawBridgeControlRequest,
  OpenClawBridgeDispatchRequest,
  RunPlanRecord,
  RunRecord,
} from "./types.js";
import {
  OPENCLAW_APPROVAL_CONSOLE_BASE_URL,
  OPENCLAW_BRIDGE_EXECUTION_MODE,
  OPENCLAW_CALLBACK_BASE_URL,
  OPENCLAW_CALLBACK_PATH,
  OPENCLAW_CALLBACK_TOKEN,
  OPENCLAW_CONTAINER_NAME,
  OPENCLAW_GATEWAY_BASE_URL,
} from "./config.js";
import { nowIso } from "./utils.js";

export function buildDispatchEnvelope(
  run: RunRecord,
  plan: RunPlanRecord,
  node: CompiledNodeRecord,
  options?: {
    extraInputPayload?: Record<string, unknown>;
  },
): DispatchEnvelope {
  return {
    run_id: run.run_id,
    node_run_id: node.node_run_id,
    template_id: run.template_id,
    template_version: run.template_version,
    workspace_id: run.workspace_id,
    requested_by: run.requested_by,
    intent: run.intent,
    node_id: node.node_id,
    node_name: node.name,
    node_type: node.type,
    agent_profile: node.agent_profile,
    openclaw_agent_id: node.openclaw_agent_id,
    allowed_skills: node.allowed_skills,
    allowed_tools: node.allowed_tools,
    registry_provenance: node.registry_provenance,
    timeout_seconds: node.timeout_seconds,
    parallelism_budget: node.parallelism_budget,
    retry_policy: node.retry_policy,
    input_payload: options?.extraInputPayload
      ? {
          ...node.input_payload,
          ...options.extraInputPayload,
        }
      : node.input_payload,
    output_contract: node.output_contract,
    trace_context: {
      run_id: run.run_id,
      node_run_id: node.node_run_id,
      requested_by: run.requested_by,
    },
  };
}

export function buildAcceptedReport(
  envelope: DispatchEnvelope,
  dispatch: AdapterDispatchResult,
): NormalizedExecutionReport {
  return {
    run_id: envelope.run_id,
    node_run_id: envelope.node_run_id,
    status: "accepted",
    progress: {
      percent: 0,
      message: "Dispatch accepted",
    },
    artifacts: [],
    error: null,
    raw_ref: {
      dispatch_id: dispatch.dispatch_id,
      openclaw_task_id: dispatch.openclaw_task_id,
      openclaw_session_id: dispatch.openclaw_session_id,
    },
    created_at: nowIso(),
  };
}

export function buildProgressReport(input: {
  envelope: DispatchEnvelope;
  dispatch: AdapterDispatchResult;
  percent: number;
  message: string;
}): NormalizedExecutionReport {
  return {
    run_id: input.envelope.run_id,
    node_run_id: input.envelope.node_run_id,
    status: "running",
    progress: {
      percent: input.percent,
      message: input.message,
    },
    artifacts: [],
    error: null,
    raw_ref: {
      dispatch_id: input.dispatch.dispatch_id,
      openclaw_task_id: input.dispatch.openclaw_task_id,
      openclaw_session_id: input.dispatch.openclaw_session_id,
    },
    created_at: nowIso(),
  };
}

export function buildCompletedReport(input: {
  envelope: DispatchEnvelope;
  dispatch: AdapterDispatchResult;
  artifacts?: ExecutionArtifactRecord[];
}): NormalizedExecutionReport {
  return {
    run_id: input.envelope.run_id,
    node_run_id: input.envelope.node_run_id,
    status: "completed",
    progress: {
      percent: 100,
      message: "Node completed",
    },
    artifacts: input.artifacts ?? [],
    error: null,
    raw_ref: {
      dispatch_id: input.dispatch.dispatch_id,
      openclaw_task_id: input.dispatch.openclaw_task_id,
      openclaw_session_id: input.dispatch.openclaw_session_id,
    },
    created_at: nowIso(),
  };
}

export function buildFailedReport(input: {
  envelope: DispatchEnvelope;
  dispatch: AdapterDispatchResult;
  code: string;
  message: string;
}): NormalizedExecutionReport {
  return {
    run_id: input.envelope.run_id,
    node_run_id: input.envelope.node_run_id,
    status: "failed",
    progress: {
      percent: 100,
      message: "Node failed",
    },
    artifacts: [],
    error: {
      code: input.code,
      message: input.message,
    },
    raw_ref: {
      dispatch_id: input.dispatch.dispatch_id,
      openclaw_task_id: input.dispatch.openclaw_task_id,
      openclaw_session_id: input.dispatch.openclaw_session_id,
    },
    created_at: nowIso(),
  };
}

export function buildOpenClawBridgeDispatchRequest(
  envelope: DispatchEnvelope,
): OpenClawBridgeDispatchRequest {
  return {
    run_id: envelope.run_id,
    node_run_id: envelope.node_run_id,
    node_id: envelope.node_id,
    node_name: envelope.node_name,
    node_type: envelope.node_type,
    template_id: envelope.template_id,
    template_version: envelope.template_version,
    workspace_id: envelope.workspace_id,
    requested_by: envelope.requested_by,
    intent: envelope.intent,
    openclaw_agent_id: envelope.openclaw_agent_id,
    allowed_skills: envelope.allowed_skills,
    allowed_tools: envelope.allowed_tools,
    registry_provenance: envelope.registry_provenance,
    timeout_seconds: envelope.timeout_seconds,
    parallelism_budget: envelope.parallelism_budget,
    retry_policy: envelope.retry_policy,
    input_payload: envelope.input_payload,
    output_contract: envelope.output_contract,
    callback: {
      report_url: `${OPENCLAW_CALLBACK_BASE_URL}${OPENCLAW_CALLBACK_PATH}`,
      bearer_token: OPENCLAW_CALLBACK_TOKEN || null,
    },
    trace_context: envelope.trace_context,
    openclaw_runtime: {
      execution_mode: OPENCLAW_BRIDGE_EXECUTION_MODE,
      gateway_base_url: OPENCLAW_GATEWAY_BASE_URL || null,
      approval_console_base_url: OPENCLAW_APPROVAL_CONSOLE_BASE_URL || null,
      container_name: OPENCLAW_CONTAINER_NAME || null,
    },
  };
}

export function buildOpenClawBridgeControlRequest(input: {
  runId: string;
  nodeRunId: string | null;
  action: "pause" | "resume" | "cancel" | "retry" | "skip";
}): OpenClawBridgeControlRequest {
  return {
    run_id: input.runId,
    node_run_id: input.nodeRunId,
    action: input.action,
    trace_context: {
      run_id: input.runId,
      node_run_id: input.nodeRunId,
    },
  };
}
