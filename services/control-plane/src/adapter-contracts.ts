import type {
  AdapterDispatchResult,
  CompiledNodeRecord,
  DispatchEnvelope,
  ExecutionArtifactRecord,
  NormalizedExecutionReport,
  RunPlanRecord,
  RunRecord,
} from "./types.js";
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
    agent_id: node.agent_id ?? node.agent_binding_snapshot?.agent_id ?? null,
    agent_version: node.agent_version ?? null,
    agent_binding_snapshot: node.agent_binding_snapshot ?? null,
    runtime_agent_ref: node.runtime_agent_ref ?? null,
    agent_runtime: node.agent_runtime ?? null,
    harness_profile: node.harness_profile ?? null,
    provider_connection: node.provider_connection ?? null,
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
      provider_refs: dispatch.provider_refs,
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
      provider_refs: input.dispatch.provider_refs,
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
      provider_refs: input.dispatch.provider_refs,
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
      provider_refs: input.dispatch.provider_refs,
    },
    created_at: nowIso(),
  };
}
