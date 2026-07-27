import type {
  DispatchEnvelope,
  NormalizedExecutionReport,
} from "./types.js";
import type {
  NodeHandoff as SharedNodeHandoff,
  RuntimeAgentRuntime as SharedRuntimeAgentRuntime,
  RuntimeExecutionPolicy as SharedRuntimeExecutionPolicy,
  RuntimeHarnessSpec as SharedRuntimeHarnessSpec,
  RuntimeWorkerJob as SharedRuntimeWorkerJob,
  WorkerEvent as SharedWorkerEvent,
  WorkerEventKind as SharedWorkerEventKind,
  WorkerLease as SharedWorkerLease,
  WorkerProvisionSpec as SharedWorkerProvisionSpec,
  WorkerTargetKind as SharedWorkerTargetKind,
  WorkerWorkspaceSpec as SharedWorkerWorkspaceSpec,
  WorkerWorkspaceContext as SharedWorkerWorkspaceContext,
  WorkerWorkspaceContextFile as SharedWorkerWorkspaceContextFile,
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
  JobControlAckMessage,
  JobControlMessage,
  JobDispatchMessage,
  ManagerToWorkerMessage,
  ProtocolErrorMessage,
  RuntimeControlAction,
  RuntimeHumanGate,
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
export type RuntimeExecutionPolicy = SharedRuntimeExecutionPolicy;
export type WorkerTargetKind = SharedWorkerTargetKind;
export type WorkerEventKind = SharedWorkerEventKind;
export type RuntimeHarnessSpec = SharedRuntimeHarnessSpec;
export type WorkerWorkspaceSpec = SharedWorkerWorkspaceSpec;
export type WorkerWorkspaceContext = SharedWorkerWorkspaceContext;
export type WorkerWorkspaceContextFile = SharedWorkerWorkspaceContextFile;
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
  return asNonEmptyString(envelope.provider_connection?.agent_runtime) || "local";
}

const HIGH_RISK_TOOL_PATTERN = /(?:^|[-_.])(write|edit|patch|apply_patch|save|delete|remove|rename|move|shell|terminal|exec|command|bash|powershell|cmd|git)(?:$|[-_.])/i;

function requestedTargetKind(envelope: DispatchEnvelope): WorkerTargetKind | null {
  const nodeConfig = getNodeConfig(envelope);
  const explicitTarget = asNonEmptyString(nodeConfig.worker_target_kind);
  if (
    explicitTarget === "local" ||
    explicitTarget === "docker-worker" ||
    explicitTarget === "node-worker"
  ) {
    return explicitTarget;
  }

  return null;
}

function resolveExecutionPolicy(envelope: DispatchEnvelope): RuntimeExecutionPolicy {
  const requestedTarget = requestedTargetKind(envelope);
  const runtime = inferAgentRuntime(envelope);
  const projectLocalRepo = asNonEmptyString(envelope.input_payload.project_local_repo);
  const highRiskTools = envelope.allowed_tools.filter((tool) => HIGH_RISK_TOOL_PATTERN.test(tool));
  const hasMutableProjectAccess = !!projectLocalRepo && highRiskTools.length > 0;
  const reasons: string[] = [];

  let resolvedTarget: WorkerTargetKind;
  if (hasMutableProjectAccess) {
    resolvedTarget = "docker-worker";
    reasons.push(`Mutable project tools require sandbox execution: ${highRiskTools.join(", ")}.`);
    if (requestedTarget === "local") {
      reasons.push("The requested local target was overridden by workspace safety policy.");
    }
  } else if (projectLocalRepo) {
    resolvedTarget = "docker-worker";
    reasons.push("Live project paths are staged into a Docker sandbox even for declared read-only tools.");
  } else if (requestedTarget === "local" && runtime !== "local") {
    resolvedTarget = "docker-worker";
    reasons.push(`Runtime ${runtime} has no approved host harness and cannot use the local target.`);
  } else if (requestedTarget) {
    resolvedTarget = requestedTarget;
    reasons.push(`Using explicitly requested target ${requestedTarget}.`);
  } else {
    const configuredDefault = asNonEmptyString(
      process.env.MY_MATE_RUNTIME_DEFAULT_TARGET_KIND,
    );
    if (
      configuredDefault === "local" ||
      configuredDefault === "docker-worker" ||
      configuredDefault === "node-worker"
    ) {
      resolvedTarget = configuredDefault;
      reasons.push(`Using configured default target ${configuredDefault}.`);
    } else if (runtime === "local") {
      resolvedTarget = "local";
      reasons.push("Local deterministic runtime does not request mutable project access.");
    } else {
      resolvedTarget = "docker-worker";
      reasons.push(`Agent runtime ${runtime} defaults to an isolated Docker worker.`);
    }
  }

  return {
    risk_level: hasMutableProjectAccess ? "high" : projectLocalRepo ? "elevated" : "low",
    workspace_access: projectLocalRepo ? "sandbox-write" : "none",
    requires_change_approval: !!projectLocalRepo,
    requested_target_kind: requestedTarget,
    resolved_target_kind: resolvedTarget,
    reasons,
  };
}

function inferTargetKind(envelope: DispatchEnvelope): WorkerTargetKind {
  return resolveExecutionPolicy(envelope).resolved_target_kind;
}

function buildWorkspaceSpec(
  envelope: DispatchEnvelope,
  context?: WorkerWorkspaceContext | null,
): WorkerWorkspaceSpec {
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
    context: context || null,
    metadata: workspace,
  };
}

const HARNESS_COMMAND_ENV_NAMES = [
  "MY_MATE_CODEX_COMMAND",
  "MY_MATE_CLAUDE_SDK_COMMAND",
  "MY_MATE_KIMI_COMMAND",
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
  const connection = envelope.provider_connection;
  if (connection) {
    const model = connection.model || runtimeAgentRef;
    if (connection.agent_runtime === "glm") {
      if (connection.base_url) env.MY_MATE_GLM_ANTHROPIC_BASE_URL = connection.base_url;
      if (model) env.MY_MATE_GLM_MODEL = model;
    } else if (connection.agent_runtime === "claude-sdk") {
      if (connection.base_url) env.ANTHROPIC_BASE_URL = connection.base_url;
      if (model) env.MY_MATE_CLAUDE_MODEL = model;
    } else if (connection.agent_runtime === "codex") {
      if (connection.base_url) env.OPENAI_BASE_URL = connection.base_url;
      if (model) env.MY_MATE_CODEX_MODEL = model;
    } else if (connection.agent_runtime === "kimi") {
      if (connection.base_url) env.KIMI_BASE_URL = connection.base_url;
      if (model) env.MY_MATE_KIMI_MODEL = model;
    }
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
    workspaceContext?: WorkerWorkspaceContext | null;
  },
): RuntimeWorkerJob {
  const nodeConfig = getNodeConfig(envelope);
  const executionPolicy = resolveExecutionPolicy(envelope);
  const targetOverride = options?.targetKind;
  const unsafeLocalOverride = targetOverride === "local" &&
    (executionPolicy.requires_change_approval || inferAgentRuntime(envelope) !== "local");
  const targetKind = targetOverride && !unsafeLocalOverride
    ? targetOverride
    : executionPolicy.resolved_target_kind;
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
      provider_connection: envelope.provider_connection,
      allowed_skills: [...envelope.allowed_skills],
      allowed_tools: [...envelope.allowed_tools],
    },
    provision: {
      required: targetKind === "docker-worker" || targetKind === "node-worker",
      target_kind: targetKind,
      execution_policy: {
        ...executionPolicy,
        resolved_target_kind: targetKind,
        reasons: targetOverride
          ? [
              ...executionPolicy.reasons,
              unsafeLocalOverride
                ? "An unsafe dispatcher local override was ignored."
                : `Dispatcher selected target ${targetKind}.`,
            ]
          : executionPolicy.reasons,
      },
      image,
      container_group: asNonEmptyString(nodeConfig.container_group),
      required_capabilities: asStringArray(nodeConfig.required_capabilities),
      env: buildProvisionEnv(envelope),
      workspace: buildWorkspaceSpec(envelope, options?.workspaceContext),
      resource_limits: buildResourceLimits(nodeConfig),
    },
    trace_context: envelope.trace_context,
    created_at: options?.createdAt || new Date().toISOString(),
  };
}

export function reportFromWorkerEvent(event: WorkerEvent): NormalizedExecutionReport | null {
  return "report" in event ? (event.report as NormalizedExecutionReport) : null;
}
