import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DATA_DIR,
  RUNTIME_DOCKER_BIN,
  RUNTIME_WORKER_IMAGE,
  RUNTIME_WORKER_RELEASE_VERSION,
  RUNTIME_WORKSPACES_DIR,
} from "../config.js";
import { describeRuntimeWorkerImage } from "../runtime-worker-image.js";
import { getProviderConnection } from "../provider-connection-store.js";
import { getManagedProviderCredential } from "../provider-secret-store.js";
import {
  getJsonStorageBackend,
  getJsonStorageBackendKind,
  type JsonStorageBackend,
} from "../storage-backend.js";
import {
  defaultDoctorCommandRunner,
  expectedRuntimeProtocol,
  requireSuccessfulCommand,
  runDockerMountProbe,
  runDockerWorkerRegistrationProbe,
} from "./docker-probe.js";
import { inspectProviderConfiguration, runLiveProviderProbe } from "./provider-probe.js";
import { runStorageProbe } from "./storage-probe.js";
import type {
  DoctorCheck,
  DoctorCommandRunner,
  DoctorReport,
  DoctorRequest,
  DoctorRuntime,
  DoctorRuntimeStatus,
  DoctorWorkerHub,
} from "./types.js";

export interface DoctorServiceOptions {
  storage?: JsonStorageBackend;
  storageBackendKind?: string;
  runtimeStatus: DoctorRuntimeStatus;
  executionAdapterKind: string;
  workerHub?: DoctorWorkerHub | null;
  publicBaseUrl?: string;
  dockerBin?: string;
  workerImage?: string;
  workspaceRoot?: string;
  commandRunner?: DoctorCommandRunner;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

async function resolveHostShell(
  runner: DoctorCommandRunner,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const configured = env.MY_MATE_HOST_SHELL?.trim();
  if (configured) {
    await requireSuccessfulCommand({
      runner,
      command: configured,
      args: process.platform === "win32" ? ["--version"] : ["-c", "printf my-mate-host-shell"],
    });
    return configured;
  }

  if (process.platform !== "win32") {
    const shell = env.SHELL?.trim() || "/bin/sh";
    await requireSuccessfulCommand({
      runner,
      command: shell,
      args: ["-c", "printf my-mate-host-shell"],
    });
    return shell;
  }

  const gitResult = await requireSuccessfulCommand({
    runner,
    command: "git",
    args: ["--exec-path"],
  });
  const gitExecPath = gitResult.stdout.trim();
  const gitRoot = gitExecPath ? path.resolve(gitExecPath, "..", "..", "..") : "";
  const candidates = [
    env.GIT_BASH,
    gitRoot ? path.join(gitRoot, "bin", "bash.exe") : "",
    env.ProgramFiles ? path.join(env.ProgramFiles, "Git", "bin", "bash.exe") : "",
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe") : "",
  ].filter((item): item is string => !!item?.trim());
  const shell = candidates.find((candidate) => fs.existsSync(candidate));
  if (!shell) throw new Error("Git Bash was not found.");
  await requireSuccessfulCommand({ runner, command: shell, args: ["--version"] });
  return shell;
}

function elapsed(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function defaultRuntime(options: DoctorServiceOptions, mode: DoctorRequest["mode"]): DoctorRuntime {
  if (mode === "docker") return "docker-worker";
  const candidate = options.executionAdapterKind;
  if (["local", "openclaw", "codex", "claude-sdk", "kimi", "glm"].includes(candidate)) {
    return candidate as DoctorRuntime;
  }
  return options.runtimeStatus.node_provisioner_kind === "docker" ? "docker-worker" : "local";
}

function readiness(checks: DoctorCheck[], target: "runtime" | "deterministic" | "model"): boolean {
  const required = checks.filter((check) => check.required_for.includes(target));
  return required.length > 0 && required.every((check) => check.status === "pass");
}

export async function runDoctor(
  request: DoctorRequest,
  options: DoctorServiceOptions,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const env = options.env || process.env;
  const runtime = request.runtime || defaultRuntime(options, request.mode);
  const providerConnection = request.provider_connection_id
    ? getProviderConnection(request.provider_connection_id)
    : null;
  const providerRuntime = (providerConnection?.agent_runtime || runtime) as DoctorRuntime;
  const providerEnv: NodeJS.ProcessEnv = { ...env };
  if (providerConnection) {
    if (providerConnection.credential_source === "managed") {
      const managedCredential = getManagedProviderCredential(providerConnection.connection_id);
      if (managedCredential) providerEnv[providerConnection.credential_env] = managedCredential;
    }
    const model = providerConnection.default_model || undefined;
    if (providerRuntime === "glm") {
      if (providerConnection.base_url) providerEnv.MY_MATE_GLM_ANTHROPIC_BASE_URL = providerConnection.base_url;
      if (model) providerEnv.MY_MATE_GLM_MODEL = model;
    } else if (providerRuntime === "claude-sdk") {
      if (providerConnection.base_url) providerEnv.ANTHROPIC_BASE_URL = providerConnection.base_url;
      if (model) providerEnv.MY_MATE_CLAUDE_MODEL = model;
    } else if (providerRuntime === "codex") {
      if (providerConnection.base_url) providerEnv.OPENAI_BASE_URL = providerConnection.base_url;
      if (model) providerEnv.MY_MATE_CODEX_MODEL = model;
    } else if (providerRuntime === "kimi") {
      if (providerConnection.base_url) providerEnv.KIMI_BASE_URL = providerConnection.base_url;
      if (model) providerEnv.MY_MATE_KIMI_MODEL = model;
    } else if (providerRuntime === "openclaw" && providerConnection.base_url) {
      providerEnv.MY_MATE_OPENCLAW_BRIDGE_BASE_URL = providerConnection.base_url;
    }
  }
  const runner = options.commandRunner || defaultDoctorCommandRunner;
  const dockerBin = options.dockerBin || RUNTIME_DOCKER_BIN;
  const image = options.workerImage || RUNTIME_WORKER_IMAGE;
  const workspaceRoot = options.workspaceRoot || RUNTIME_WORKSPACES_DIR;

  const add = (check: DoctorCheck) => checks.push(check);
  const execute = async (
    base: Omit<DoctorCheck, "status" | "detail" | "duration_ms">,
    operation: () => void | Promise<void>,
    successDetail: string | null,
  ) => {
    const start = performance.now();
    try {
      await operation();
      add({ ...base, status: "pass", detail: successDetail, duration_ms: elapsed(start) });
      return true;
    } catch (error) {
      add({
        ...base,
        status: "fail",
        detail: error instanceof Error ? error.message : "Diagnostic check failed.",
        duration_ms: elapsed(start),
      });
      return false;
    }
  };

  add({
    id: "control_plane.process",
    category: "control_plane",
    status: "pass",
    required_for: ["runtime", "deterministic", "model"],
    summary: "Control Plane diagnostic service is responding.",
    detail: `Process ${process.pid} is running.`,
    remediation: null,
    duration_ms: 0,
  });

  const storage = options.storage || getJsonStorageBackend();
  await execute(
    {
      id: "storage.roundtrip",
      category: "storage",
      required_for: ["runtime", "deterministic", "model"],
      summary: "Storage accepts an atomic write/read round-trip.",
      remediation: "Check MY_MATE_DATA_DIR permissions and storage backend configuration.",
    },
    () => runStorageProbe(storage),
    "The diagnostics probe was written and read back successfully.",
  );

  await execute(
    {
      id: "storage.directories",
      category: "workspace",
      required_for: ["runtime", "deterministic", "model"],
      summary: "Runtime data and workspace directories are available.",
      remediation: "Create writable data and runtime workspace directories.",
    },
    () => {
      storage.ensureDir(DATA_DIR);
      fs.mkdirSync(workspaceRoot, { recursive: true });
      fs.accessSync(workspaceRoot, fs.constants.R_OK | fs.constants.W_OK);
    },
    `Workspace root is ${workspaceRoot}.`,
  );

  const hostShellStart = performance.now();
  try {
    const hostShell = await resolveHostShell(runner, env);
    add({
      id: "host.shell",
      category: "runtime",
      status: "pass",
      required_for: [],
      summary: process.platform === "win32" ? "Git Bash host shell is available." : "Host shell is available.",
      detail: `shell=${hostShell}`,
      remediation: null,
      duration_ms: elapsed(hostShellStart),
    });
  } catch (error) {
    add({
      id: "host.shell",
      category: "runtime",
      status: "warn",
      required_for: [],
      summary: process.platform === "win32" ? "Git Bash host shell is not available." : "Host shell is not available.",
      detail: error instanceof Error ? error.message : "Host shell check failed.",
      remediation: process.platform === "win32"
        ? "Install Git for Windows or set MY_MATE_HOST_SHELL to bash.exe."
        : "Set MY_MATE_HOST_SHELL or SHELL to an executable host shell.",
      duration_ms: elapsed(hostShellStart),
    });
  }

  const status = options.runtimeStatus;
  const workerRuntime = runtime === "docker-worker";
  const dispatcherReady = workerRuntime
    ? status.node_provisioner_kind === "docker" &&
      status.node_provisioner_status === "ready" &&
      !!status.worker_hub_kind
    : runtime === "local"
      ? !!options.executionAdapterKind
      : !!options.executionAdapterKind;
  add({
    id: "runtime.dispatcher",
    category: "runtime",
    status: dispatcherReady ? "pass" : "fail",
    required_for: ["runtime", "deterministic", "model"],
    summary: `Runtime dispatcher is configured for ${runtime}.`,
    detail: `dispatcher=${status.dispatcher_kind}; provisioner=${status.node_provisioner_kind}/${status.node_provisioner_status}`,
    remediation: dispatcherReady
      ? null
      : workerRuntime
        ? "Start Control Plane with MY_MATE_RUNTIME_DISPATCHER=docker-worker."
        : `Configure the ${runtime} execution adapter or Worker harness.`,
    duration_ms: 0,
  });

  if (workerRuntime || request.mode === "docker") {
    const imageIdentity = describeRuntimeWorkerImage(image, RUNTIME_WORKER_RELEASE_VERSION);
    add({
      id: "worker.image_identity",
      category: "worker",
      status: imageIdentity.release_ready ? "pass" : "warn",
      required_for: [],
      summary: "Runtime Worker image has an explicit release identity.",
      detail:
        `image=${imageIdentity.reference}; kind=${imageIdentity.kind}; ` +
        `expected_version=${imageIdentity.expected_version}`,
      remediation: imageIdentity.release_ready
        ? null
        : `Use my-mate-runtime-worker:${RUNTIME_WORKER_RELEASE_VERSION} or an image digest for release execution.`,
      duration_ms: 0,
    });
    const hubReady = !!status.worker_hub_kind && status.node_provisioner_status === "ready";
    add({
      id: "worker.hub",
      category: "worker",
      status: hubReady ? "pass" : "fail",
      required_for: ["runtime", "deterministic", "model"],
      summary: "Worker Hub is attached to the Docker runtime path.",
      detail: status.worker_hub_kind
        ? `${status.worker_hub_kind}; connected=${status.connected_workers}; stale=${status.stale_workers}`
        : "No Worker Hub is attached.",
      remediation: hubReady ? null : "Start the full Control Plane runtime server with Worker Hub enabled.",
      duration_ms: 0,
    });
    const capacityReady = status.worker_capacity_limit > 0 && status.worker_queue_limit > 0;
    add({
      id: "worker.capacity",
      category: "worker",
      status: capacityReady ? "pass" : "fail",
      required_for: ["runtime", "deterministic", "model"],
      summary: "Runtime Worker capacity queue is configured.",
      detail:
        `active=${status.worker_capacity_active}/${status.worker_capacity_limit}; ` +
        `queued=${status.worker_queue_depth}/${status.worker_queue_limit}; ` +
        `timeout_ms=${status.worker_queue_timeout_ms}`,
      remediation: capacityReady
        ? null
        : "Set positive Runtime Worker concurrency, queue limit, and queue timeout values.",
      duration_ms: 0,
    });
    const recoveryFailed =
      status.worker_cleanup_failed > 0 ||
      status.worker_reconciliation_status === "failed" ||
      status.worker_reconciliation_status === "degraded";
    const recoveryPending = status.worker_cleanup_pending > 0;
    add({
      id: "worker.recovery",
      category: "worker",
      status: recoveryFailed ? "fail" : recoveryPending || status.worker_reconciliation_status === "not_run" ? "warn" : "pass",
      required_for: ["runtime", "deterministic", "model"],
      summary: "Runtime Worker crash compensation is reconciled.",
      detail:
        `reconciliation=${status.worker_reconciliation_status}; ` +
        `at=${status.worker_reconciliation_at || "never"}; ` +
        `cleanup_pending=${status.worker_cleanup_pending}; cleanup_failed=${status.worker_cleanup_failed}; ` +
        `containers=${status.worker_reconciliation_discovered}; ` +
        `orphans=${status.worker_reconciliation_orphans}; removed=${status.worker_reconciliation_removed}`,
      remediation: recoveryFailed
        ? "Restore Docker access, remove retained Runtime Worker containers, and restart Control Plane to retry reconciliation."
        : recoveryPending
          ? "Wait for Runtime Worker cleanup to complete before dispatching more work."
          : null,
      duration_ms: 0,
    });
  }

  const needsDocker = request.mode === "docker" || (request.mode === "model" && workerRuntime);
  if (needsDocker) {
    await execute(
      {
        id: "docker.client",
        category: "docker",
        required_for: ["deterministic", "model"],
        summary: "Docker CLI is available.",
        remediation: "Install Docker CLI or set MY_MATE_RUNTIME_DOCKER_BIN.",
      },
      async () => {
        await requireSuccessfulCommand({ runner, command: dockerBin, args: ["version", "--format", "{{.Client.Version}}"] });
      },
      `Docker command: ${dockerBin}.`,
    );
    await execute(
      {
        id: "docker.daemon",
        category: "docker",
        required_for: ["deterministic", "model"],
        summary: "Docker daemon is reachable and runs Linux containers.",
        remediation: "Start Docker and switch it to Linux container mode.",
      },
      async () => {
        const result = await requireSuccessfulCommand({ runner, command: dockerBin, args: ["info", "--format", "{{.OSType}}"] });
        if (result.stdout.trim().toLowerCase() !== "linux") {
          throw new Error(`Docker daemon reported ${result.stdout || "an unknown OS"}; linux is required.`);
        }
      },
      "Docker daemon reports Linux container mode.",
    );
    await execute(
      {
        id: "docker.image",
        category: "docker",
        required_for: ["deterministic", "model"],
        summary: "Runtime Worker image is present.",
        remediation: "Run npm run runtime-worker:image to build the configured Worker image.",
      },
      async () => {
        await requireSuccessfulCommand({ runner, command: dockerBin, args: ["image", "inspect", image, "--format", "{{.Id}}"] });
      },
      `Worker image ${image} is available.`,
    );
    await execute(
      {
        id: "docker.image_protocol",
        category: "docker",
        required_for: ["deterministic", "model"],
        summary: "Runtime Worker image protocol matches Control Plane.",
        remediation: "Rebuild the Runtime Worker image from the current source tree.",
      },
      async () => {
        const result = await requireSuccessfulCommand({
          runner,
          command: dockerBin,
          args: ["image", "inspect", image, "--format", "{{ index .Config.Labels \"io.my-mate.runtime-protocol\" }}"],
        });
        if (result.stdout.trim() !== expectedRuntimeProtocol()) {
          throw new Error(`Image protocol is ${result.stdout.trim() || "missing"}; expected ${expectedRuntimeProtocol()}.`);
        }
      },
      `Image protocol is ${expectedRuntimeProtocol()}.`,
    );
    await execute(
      {
        id: "docker.image_healthcheck",
        category: "docker",
        required_for: ["deterministic", "model"],
        summary: "Runtime Worker image declares a container health check.",
        remediation: "Rebuild the Runtime Worker image from the current Dockerfile.",
      },
      async () => {
        const result = await requireSuccessfulCommand({
          runner,
          command: dockerBin,
          args: ["image", "inspect", image, "--format", "{{json .Config.Healthcheck}}"],
        });
        const healthcheck = result.stdout.trim();
        if (!healthcheck || healthcheck === "null" || healthcheck === "<nil>") {
          throw new Error("Worker image health check is missing.");
        }
      },
      "Worker image health check is declared.",
    );
    await execute(
      {
        id: "docker.workspace_mount",
        category: "workspace",
        required_for: ["deterministic", "model"],
        summary: "Worker image can read and write a disposable workspace mount.",
        remediation: "Check Docker file sharing and runtime workspace permissions.",
      },
      () => runDockerMountProbe({ runner, dockerBin, image, workspaceRoot }),
      "Disposable bind mount round-trip succeeded.",
    );
    if (options.workerHub && options.publicBaseUrl) {
      await execute(
        {
          id: "worker.registration_loopback",
          category: "worker",
          required_for: ["deterministic", "model"],
          summary: "A disposable Docker Worker can register with Worker Hub.",
          remediation: "Check MY_MATE_PUBLIC_BASE_URL, Docker host routing, Worker token, and WebSocket upgrades.",
        },
        () => runDockerWorkerRegistrationProbe({
          runner,
          dockerBin,
          image,
          publicBaseUrl: options.publicBaseUrl!,
          workerHub: options.workerHub!,
        }),
        "Disposable Worker registered and was released.",
      );
    } else {
      add({
        id: "worker.registration_loopback",
        category: "worker",
        status: "fail",
        required_for: ["deterministic", "model"],
        summary: "Docker Worker registration loopback is unavailable.",
        detail: "Doctor was not connected to an attached Worker Hub and public Control Plane URL.",
        remediation: "Run doctor through the full Control Plane server, not an unbound app instance.",
        duration_ms: 0,
      });
    }
  }

  if (request.provider_connection_id) {
    const runtimeMatches = !!providerConnection && (
      runtime === "local" || runtime === "docker-worker" || runtime === providerRuntime
    );
    const connectionReady = !!providerConnection && providerConnection.status === "active" && runtimeMatches;
    add({
      id: "provider.connection",
      category: "provider",
      status: connectionReady ? "pass" : "fail",
      required_for: ["model"],
      summary: connectionReady
        ? `Provider Connection ${request.provider_connection_id} is active.`
        : `Provider Connection ${request.provider_connection_id} is not usable.`,
      detail: !providerConnection
        ? "The connection was not found in the selected workspace."
        : providerConnection.status !== "active"
          ? "The connection is disabled."
          : !runtimeMatches
            ? `Connection runtime ${providerRuntime} does not match requested runtime ${runtime}.`
            : `runtime=${providerRuntime}; credential_env=${providerConnection.credential_env}; secret value is not returned.`,
      remediation: connectionReady
        ? null
        : "Select an active Provider Connection whose Agent Runtime matches the requested runtime.",
      duration_ms: 0,
    });
  }

  const provider = inspectProviderConfiguration(providerRuntime, providerEnv);
  if (["openclaw", "codex", "claude-sdk", "kimi", "glm"].includes(providerRuntime)) {
    add({
      id: "harness.configuration",
      category: "harness",
      status: provider.harnessConfigured ? "pass" : "fail",
      required_for: ["model"],
      summary: `${providerRuntime} harness is configured.`,
      detail: provider.harnessEnv
        ? `${provider.harnessEnv} is ${provider.harnessConfigured ? "configured" : "not configured"}.`
        : null,
      remediation: provider.harnessConfigured ? null : `Configure ${provider.harnessEnv || `${providerRuntime} harness`}.`,
      duration_ms: 0,
    });
    add({
      id: "provider.credential",
      category: "provider",
      status: provider.credentialConfigured ? "pass" : "fail",
      required_for: ["model"],
      summary: `${providerRuntime} credential reference is available.`,
      detail: provider.credentialSource
        ? `Credential source ${provider.credentialSource} is present; its value is not returned.`
        : "No supported credential reference is present.",
      remediation: provider.credentialConfigured ? null : `Configure ${providerConnection?.credential_env || `a credential reference for ${providerRuntime}`}.`,
      duration_ms: 0,
    });
  } else {
    add({
      id: "provider.credential",
      category: "provider",
      status: "skipped",
      required_for: [],
      summary: "No model provider was selected.",
      detail: `Runtime ${runtime} is deterministic-only.`,
      remediation: "Select codex, claude-sdk, glm, kimi, or openclaw for model readiness.",
      duration_ms: 0,
    });
  }

  let modelVerified: boolean | null = null;
  if (request.model_probe) {
    const start = performance.now();
    try {
      await runLiveProviderProbe({ runtime: providerRuntime, env: providerEnv, fetchImpl: options.fetchImpl });
      modelVerified = true;
      add({
        id: "provider.live_probe",
        category: "provider",
        status: "pass",
        required_for: [],
        summary: `${providerRuntime} live provider probe succeeded.`,
        detail: "Provider authentication and endpoint reachability were verified.",
        remediation: null,
        duration_ms: elapsed(start),
      });
    } catch (error) {
      modelVerified = false;
      add({
        id: "provider.live_probe",
        category: "provider",
        status: "fail",
        required_for: [],
        summary: `${providerRuntime} live provider probe failed.`,
        detail: error instanceof Error ? error.message : "Live provider probe failed.",
        remediation: "Check provider credentials, endpoint, model access, and network connectivity.",
        duration_ms: elapsed(start),
      });
    }
  } else {
    add({
      id: "provider.live_probe",
      category: "provider",
      status: "skipped",
      required_for: [],
      summary: "Live provider probe was not requested.",
      detail: "Set model_probe=true to perform a potentially billable live request.",
      remediation: null,
      duration_ms: 0,
    });
  }

  const generatedAt = (options.now || (() => new Date()))().toISOString();
  const modelCapableRuntime = ["openclaw", "codex", "claude-sdk", "kimi", "glm"].includes(providerRuntime);
  return {
    schema_version: 1,
    report_id: `doctor:${randomUUID()}`,
    generated_at: generatedAt,
    runtime_ready: readiness(checks, "runtime"),
    deterministic_ready: readiness(checks, "deterministic"),
    model_ready: modelCapableRuntime && readiness(checks, "model"),
    model_verified: modelVerified,
    storage_backend: options.storageBackendKind || getJsonStorageBackendKind(),
    runtime_dispatcher: status.dispatcher_kind,
    checks,
  };
}
