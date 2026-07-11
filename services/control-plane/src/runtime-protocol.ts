import type {
  DispatchEnvelope,
  NormalizedExecutionReport,
} from "./types.js";
import type {
  NodeHandoff as SharedNodeHandoff,
  RuntimeAgentRuntime as SharedRuntimeAgentRuntime,
  RuntimeHarnessSpec as SharedRuntimeHarnessSpec,
  RuntimeWorkerJob as SharedRuntimeWorkerJob,
  WorkerEvent as SharedWorkerEvent,
  WorkerEventKind as SharedWorkerEventKind,
  WorkerLease as SharedWorkerLease,
  WorkerProvisionSpec as SharedWorkerProvisionSpec,
  WorkerTargetKind as SharedWorkerTargetKind,
  WorkerWorkspaceSpec as SharedWorkerWorkspaceSpec,
} from "@my-mate/shared-types/runtime-protocol";

export {
  RUNTIME_PROTOCOL_VERSION,
  createRuntimeMessageBase,
  isRuntimeProtocolMessage,
  isTerminalWorkerEventKind,
  runtimeEventIdempotencyKey,
} from "@my-mate/shared-types/runtime-protocol";
export type {
  JobAckMessage,
  JobAckStatus,
  JobControlMessage,
  JobDispatchMessage,
  ManagerToWorkerMessage,
  ProtocolErrorMessage,
  RuntimeControlAction,
  RuntimeSocketMessageBase,
  WorkerEvidence,
  WorkerEvidenceKind,
  WorkerEvidenceMessage,
  WorkerHeartbeatMessage,
  WorkerRegisterMessage,
  WorkerRegisteredMessage,
  WorkerReleaseMessage,
  WorkerToManagerMessage,
} from "@my-mate/shared-types/runtime-protocol";

export type RuntimeAgentRuntime = SharedRuntimeAgentRuntime;
export type WorkerTargetKind = SharedWorkerTargetKind;
export type WorkerEventKind = SharedWorkerEventKind;
export type RuntimeHarnessSpec = SharedRuntimeHarnessSpec;
export type WorkerWorkspaceSpec = SharedWorkerWorkspaceSpec;
export type WorkerProvisionSpec = SharedWorkerProvisionSpec;
export type RuntimeWorkerJob = SharedRuntimeWorkerJob<DispatchEnvelope>;
export type WorkerLease = SharedWorkerLease;
export type NodeHandoff = SharedNodeHandoff;
export type WorkerEvent = SharedWorkerEvent<NormalizedExecutionReport>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asNonEmptyString(item))
    .filter((item): item is string => item !== null);
}

function getNodeConfig(envelope: DispatchEnvelope): Record<string, unknown> {
  const nodeConfig = envelope.input_payload.node_config;
  return isRecord(nodeConfig) ? nodeConfig : {};
}

function inferAgentRuntime(envelope: DispatchEnvelope): RuntimeAgentRuntime {
  const explicit = asNonEmptyString(envelope.agent_runtime);
  if (explicit) {
    return explicit;
  }
  if (asNonEmptyString(envelope.openclaw_agent_id) || asNonEmptyString(envelope.runtime_agent_ref)) {
    return "openclaw";
  }
  return "local";
}

function inferTargetKind(envelope: DispatchEnvelope): WorkerTargetKind {
  const nodeConfig = getNodeConfig(envelope);
  const explicitTarget = asNonEmptyString(nodeConfig.worker_target_kind);
  if (
    explicitTarget === "local" ||
    explicitTarget === "external-bridge" ||
    explicitTarget === "docker-worker" ||
    explicitTarget === "node-worker"
  ) {
    return explicitTarget;
  }

  const runtime = inferAgentRuntime(envelope);
  const configuredDefault = asNonEmptyString(
    process.env.MY_MATE_RUNTIME_DEFAULT_TARGET_KIND,
  );
  if (
    configuredDefault === "local" ||
    configuredDefault === "external-bridge" ||
    configuredDefault === "docker-worker" ||
    configuredDefault === "node-worker"
  ) {
    if (runtime !== "openclaw" || configuredDefault === "external-bridge") {
      return configuredDefault;
    }
  }
  if (runtime === "local") {
    return "local";
  }
  if (runtime === "openclaw") {
    return "external-bridge";
  }
  return "docker-worker";
}

function buildWorkspaceSpec(envelope: DispatchEnvelope): WorkerWorkspaceSpec {
  const projectSlug = asNonEmptyString(envelope.input_payload.project_slug);
  const projectLocalRepo = asNonEmptyString(envelope.input_payload.project_local_repo);
  const nodeConfig = getNodeConfig(envelope);
  const workspace = isRecord(nodeConfig.workspace) ? nodeConfig.workspace : {};
  const mode = asNonEmptyString(workspace.mode);

  return {
    workspace_id: envelope.workspace_id,
    mode:
      mode === "shared" || mode === "isolated" || mode === "external"
        ? mode
        : projectLocalRepo
          ? "shared"
          : "unknown",
    project_slug: projectSlug,
    project_local_repo: projectLocalRepo,
    metadata: workspace,
  };
}

const HARNESS_COMMAND_ENV_NAMES = [
  "MY_MATE_CODEX_COMMAND",
  "MY_MATE_CLAUDE_SDK_COMMAND",
  "MY_MATE_KIMI_COMMAND",
  "MY_MATE_OPENCLAW_WORKER_BRIDGE_URL",
] as const;

function buildProvisionEnv(envelope: DispatchEnvelope): Record<string, string> {
  const runtime = inferAgentRuntime(envelope);
  const nodeConfig = getNodeConfig(envelope);
  const env: Record<string, string> = {
    AGENT_BACKEND: runtime,
    MY_MATE_RUN_ID: envelope.run_id,
    MY_MATE_NODE_RUN_ID: envelope.node_run_id,
    MY_MATE_WORKSPACE_ID: envelope.workspace_id,
  };
  const runtimeAgentRef = asNonEmptyString(envelope.runtime_agent_ref);
  if (runtimeAgentRef) {
    env.MY_MATE_RUNTIME_AGENT_REF = runtimeAgentRef;
  }
  const configuredEnv = isRecord(nodeConfig.worker_env)
    ? nodeConfig.worker_env
    : isRecord(nodeConfig.runtime_env)
      ? nodeConfig.runtime_env
      : {};
  for (const [key, value] of Object.entries(configuredEnv)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string") {
      env[key] = value;
    }
  }
  for (const name of HARNESS_COMMAND_ENV_NAMES) {
    if (!env[name] && process.env[name]) {
      env[name] = process.env[name] as string;
    }
  }
  return env;
}

function buildResourceLimits(
  nodeConfig: Record<string, unknown>,
): RuntimeWorkerJob["provision"]["resource_limits"] {
  const configured = isRecord(nodeConfig.resource_limits)
    ? nodeConfig.resource_limits
    : isRecord(nodeConfig.worker_resources)
      ? nodeConfig.worker_resources
      : {};
  const positiveNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  const cpus = positiveNumber(configured.cpus);
  const memoryMb = positiveNumber(configured.memory_mb);
  const pids = positiveNumber(configured.pids);
  if (cpus === null && memoryMb === null && pids === null) {
    return undefined;
  }
  return {
    cpus,
    memory_mb: memoryMb === null ? null : Math.floor(memoryMb),
    pids: pids === null ? null : Math.floor(pids),
  };
}

export function buildRuntimeWorkerJob(
  envelope: DispatchEnvelope,
  options?: {
    jobId?: string;
    dispatchSequence?: number;
    createdAt?: string;
    targetKind?: WorkerTargetKind;
  },
): RuntimeWorkerJob {
  const nodeConfig = getNodeConfig(envelope);
  const targetKind = options?.targetKind ?? inferTargetKind(envelope);
  const dispatchSequence = Math.max(1, Math.floor(options?.dispatchSequence ?? 1));
  const image =
    asNonEmptyString(nodeConfig.worker_image) ||
    asNonEmptyString(nodeConfig.docker_image) ||
    asNonEmptyString(nodeConfig.image);

  return {
    job_id:
      options?.jobId ||
      `${envelope.run_id}:${envelope.node_run_id}:attempt-${envelope.retry_policy.attempt}:dispatch-${dispatchSequence}`,
    run_id: envelope.run_id,
    node_run_id: envelope.node_run_id,
    node_id: envelope.node_id,
    node_name: envelope.node_name,
    node_type: envelope.node_type,
    attempt: envelope.retry_policy.attempt,
    dispatch_sequence: dispatchSequence,
    envelope,
    harness: {
      agent_runtime: inferAgentRuntime(envelope),
      runtime_agent_ref: asNonEmptyString(envelope.runtime_agent_ref),
      harness_profile: asNonEmptyString(envelope.harness_profile),
      allowed_skills: [...envelope.allowed_skills],
      allowed_tools: [...envelope.allowed_tools],
    },
    provision: {
      required: targetKind === "docker-worker" || targetKind === "node-worker",
      target_kind: targetKind,
      image,
      container_group: asNonEmptyString(nodeConfig.container_group),
      required_capabilities: asStringArray(nodeConfig.required_capabilities),
      env: buildProvisionEnv(envelope),
      workspace: buildWorkspaceSpec(envelope),
      resource_limits: buildResourceLimits(nodeConfig),
    },
    trace_context: envelope.trace_context,
    created_at: options?.createdAt || new Date().toISOString(),
  };
}

export function reportFromWorkerEvent(event: WorkerEvent): NormalizedExecutionReport | null {
  return "report" in event ? (event.report as NormalizedExecutionReport) : null;
}
