import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PUBLIC_BASE_URL,
  DATA_DIR,
  RUNTIME_DOCKER_BIN,
  RUNTIME_WORKER_ACK_TIMEOUT_MS,
  RUNTIME_WORKER_AUTO_REMOVE,
  RUNTIME_WORKER_DEFAULT_CPUS,
  RUNTIME_WORKER_DEFAULT_MEMORY_MB,
  RUNTIME_WORKER_DEFAULT_PIDS,
  RUNTIME_WORKER_HEALTH_TIMEOUT_MS,
  RUNTIME_WORKER_IMAGE,
  RUNTIME_WORKER_MANAGER_WS_URL,
  RUNTIME_WORKER_MAX_CONCURRENT,
  RUNTIME_WORKER_QUEUE_LIMIT,
  RUNTIME_WORKER_QUEUE_TIMEOUT_MS,
  RUNTIME_WORKER_REGISTER_TIMEOUT_MS,
  RUNTIME_SECRET_ENVS_DIR,
  RUNTIME_WORKSPACES_DIR,
} from "./config.js";
import { getManagedProviderCredential } from "./provider-secret-store.js";
import { deriveRuntimeWorkerToken } from "./runtime-worker-auth.js";
import {
  runtimeWorkerWebSocketUrl,
  type RuntimeWorkerHub,
} from "./runtime-worker-hub.js";
import type { RuntimeWorkerJob, WorkerLease } from "./runtime-protocol.js";
import {
  getWorkerLeaseRecord,
  listWorkerLeaseRecords,
  saveWorkerLeaseRecord,
  type WorkerLeaseRecord,
} from "./runtime/worker-lease-store.js";
import {
  getWorkerReconciliationRecord,
  saveWorkerReconciliationRecord,
  type WorkerReconciliationRecord,
} from "./runtime/worker-reconciliation-store.js";
import { ensureRunWorkspace, runWorkspaceHostPath } from "./runtime/run-workspace.js";
import { nowIso, slugify } from "./utils.js";

export interface WorkerProvisionRequest {
  request_id: string;
  job: RuntimeWorkerJob;
  manager_base_url: string | null;
  manager_worker_ws_url: string | null;
  requested_at: string;
}

export type WorkerProvisionResult =
  | {
      status: "ready";
      lease: WorkerLease;
    }
  | {
      status: "deferred";
      reason: string;
      retryable: boolean;
    }
  | {
      status: "failed";
      reason: string;
      retryable: boolean;
    };

export interface NodeProvisioner {
  readonly kind: string;
  provisionWorker(request: WorkerProvisionRequest): Promise<WorkerProvisionResult>;
  releaseWorker?(lease: WorkerLease, reason?: string): Promise<WorkerCleanupResult | void>;
  reconcileWorkers?(input?: {
    reason?: string;
    reconciledAt?: string;
  }): Promise<WorkerReconciliationResult>;
  getCapacityStatus?(): WorkerProvisionerCapacityStatus;
  getRecoveryStatus?(): WorkerProvisionerRecoveryStatus;
  cancelQueued?(input: {
    runId: string;
    nodeRunId?: string;
    reason: string;
  }): number;
}

export interface WorkerProvisionerCapacityStatus {
  max_concurrent_workers: number;
  active_workers: number;
  queue_depth: number;
  queue_limit: number;
  queue_timeout_ms: number;
}

export interface WorkerCleanupResult {
  status: "succeeded" | "failed";
  lease_id: string;
  run_id: string;
  node_run_id: string;
  worker_id: string;
  attempt_id: string;
  attempt: number;
  reason: string;
  container_ref: string | null;
  resource_found: boolean;
  capacity_released: boolean;
  started_at: string;
  completed_at: string;
  error: string | null;
}

export interface WorkerContainerInventoryRecord {
  container_id: string;
  container_name: string;
  state: string;
  run_id: string | null;
  job_id: string | null;
  labels: Record<string, string>;
}

export interface WorkerReconciliationResult extends WorkerReconciliationRecord {}

export interface WorkerProvisionerRecoveryStatus {
  cleanup_pending: number;
  cleanup_failed: number;
  last_reconciliation_at: string | null;
  last_reconciliation_status: "not_run" | "healthy" | "degraded" | "failed";
  discovered_containers: number;
  orphan_containers: number;
  removed_containers: number;
  cleanup_failures: number;
}

export class LocalWorkerProvisioner implements NodeProvisioner {
  readonly kind = "local";

  async provisionWorker(request: WorkerProvisionRequest): Promise<WorkerProvisionResult> {
    return {
      status: "ready",
      lease: {
        lease_id: `lease:${request.job.job_id}`,
        worker_id: `local:${request.job.node_run_id}`,
        target_kind: "local",
        run_id: request.job.run_id,
        node_run_id: request.job.node_run_id,
        container_id: null,
        execution_ref: null,
        acquired_at: request.requested_at,
        expires_at: null,
        metadata: {
          provisioner_kind: this.kind,
        },
      },
    };
  }
}

export class DeferredDockerWorkerProvisioner implements NodeProvisioner {
  readonly kind = "docker";

  async provisionWorker(request: WorkerProvisionRequest): Promise<WorkerProvisionResult> {
    return {
      status: "deferred",
      reason:
        `Docker worker provisioning is not wired yet for ${request.job.run_id}/${request.job.node_run_id}.`,
      retryable: true,
    };
  }
}

export interface DockerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type DockerCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<DockerCommandResult>;

function runDockerCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<DockerCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Docker command timed out: ${command} ${args.join(" ")}`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf-8").trim(),
        stderr: Buffer.concat(stderr).toString("utf-8").trim(),
      });
    });
  });
}

function dockerSafeName(value: string): string {
  return slugify(value).replace(/[^a-z0-9_.-]/g, "-").slice(0, 54) || "worker";
}

function writeManagedCredentialEnvFile(
  leaseId: string,
  envName: string,
  credential: string,
): string {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envName) || /[\r\n\0]/.test(credential)) {
    throw new Error("Managed Provider credential cannot be injected safely.");
  }
  fs.mkdirSync(RUNTIME_SECRET_ENVS_DIR, { recursive: true });
  const file = path.join(RUNTIME_SECRET_ENVS_DIR, `${dockerSafeName(leaseId)}.env`);
  fs.writeFileSync(file, `${envName}=${credential}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows may not apply POSIX modes; the file remains short-lived.
  }
  return file;
}

function containerManagerBaseUrl(request: WorkerProvisionRequest): string {
  const configured =
    RUNTIME_WORKER_MANAGER_WS_URL ||
    request.manager_worker_ws_url ||
    request.manager_base_url ||
    PUBLIC_BASE_URL;
  const url = new URL(configured);
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    url.hostname = "host.docker.internal";
  }
  return url.toString();
}

function configuredPassthroughEnvNames(): string[] {
  return (process.env.MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(
      (value) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && process.env[value] !== undefined,
    );
}

function runtimeManagerId(): string {
  return (
    process.env.MY_MATE_RUNTIME_MANAGER_ID ||
    `manager-${createHash("sha256").update(path.resolve(DATA_DIR)).digest("hex").slice(0, 16)}`
  );
}

function isDockerResourceMissing(result: DockerCommandResult): boolean {
  return /no such (container|object)/i.test(`${result.stdout}\n${result.stderr}`);
}

function cleanupError(result: DockerCommandResult): string {
  return result.stderr || result.stdout || `Docker cleanup exited with code ${result.exitCode}.`;
}

function isDockerRemovalInProgress(result: DockerCommandResult): boolean {
  return /removal of container .* already in progress/i.test(`${result.stdout}\n${result.stderr}`);
}

function parseDockerInspectOutput(stdout: string): WorkerContainerInventoryRecord[] {
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as Array<{
    Id?: unknown;
    Name?: unknown;
    Config?: { Labels?: unknown };
    State?: { Status?: unknown };
  }>;
  if (!Array.isArray(parsed)) {
    throw new Error("Docker inspect did not return an array.");
  }
  return parsed.flatMap((container) => {
    if (typeof container.Id !== "string" || !container.Id) return [];
    const labels =
      container.Config?.Labels && typeof container.Config.Labels === "object"
        ? Object.fromEntries(
            Object.entries(container.Config.Labels as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    return [{
      container_id: container.Id,
      container_name:
        typeof container.Name === "string" ? container.Name.replace(/^\//, "") : container.Id,
      state: typeof container.State?.Status === "string" ? container.State.Status : "unknown",
      run_id: labels["my-mate.run-id"] || null,
      job_id: labels["my-mate.job-id"] || null,
      labels,
    }];
  });
}

export class DockerWorkerProvisioner implements NodeProvisioner {
  readonly kind = "docker";

  private readonly managerId = runtimeManagerId();
  private readonly activeLeaseIds = new Set<string>();
  private readonly capacityQueue: Array<{
    lease: WorkerLeaseRecord;
    enqueuedAtMs: number;
    timer: NodeJS.Timeout;
    resolve: (result: { acquired: boolean; reason: string; retryable: boolean }) => void;
  }> = [];
  private readonly activeProvisioning = new Map<string, WorkerLeaseRecord>();
  private readonly provisioningCancellations = new Map<string, string>();
  private readonly maxConcurrentWorkers: number;
  private readonly queueLimit: number;
  private readonly queueTimeoutMs: number;

  constructor(
    private readonly workerHub: RuntimeWorkerHub,
    private readonly options: {
      commandRunner?: DockerCommandRunner;
      dockerBin?: string;
      image?: string;
      registerTimeoutMs?: number;
      healthTimeoutMs?: number;
      maxConcurrentWorkers?: number;
      queueLimit?: number;
      queueTimeoutMs?: number;
      defaultResourceLimits?: {
        cpus: number;
        memoryMb: number;
        pids: number;
      };
    } = {},
  ) {
    this.maxConcurrentWorkers = Math.max(
      1,
      Math.floor(options.maxConcurrentWorkers || RUNTIME_WORKER_MAX_CONCURRENT),
    );
    this.queueLimit = Math.max(1, Math.floor(options.queueLimit || RUNTIME_WORKER_QUEUE_LIMIT));
    this.queueTimeoutMs = Math.max(
      1000,
      Math.floor(options.queueTimeoutMs || RUNTIME_WORKER_QUEUE_TIMEOUT_MS),
    );
    for (const lease of listWorkerLeaseRecords()) {
      if (
        [
          "provisioning",
          "ready",
          "active",
          "stale",
          "cleanup_pending",
          "cleanup_failed",
        ].includes(lease.status)
      ) {
        this.activeLeaseIds.add(lease.lease_id);
      }
    }
  }

  getCapacityStatus(): WorkerProvisionerCapacityStatus {
    return {
      max_concurrent_workers: this.maxConcurrentWorkers,
      active_workers: this.activeLeaseIds.size,
      queue_depth: this.capacityQueue.length,
      queue_limit: this.queueLimit,
      queue_timeout_ms: this.queueTimeoutMs,
    };
  }

  getRecoveryStatus(): WorkerProvisionerRecoveryStatus {
    const leases = listWorkerLeaseRecords();
    const reconciliation = getWorkerReconciliationRecord();
    return {
      cleanup_pending: leases.filter((lease) => lease.status === "cleanup_pending").length,
      cleanup_failed: leases.filter((lease) => lease.status === "cleanup_failed").length,
      last_reconciliation_at: reconciliation?.completed_at || null,
      last_reconciliation_status: reconciliation?.status || "not_run",
      discovered_containers: reconciliation?.discovered_containers.length || 0,
      orphan_containers: reconciliation?.orphan_container_ids.length || 0,
      removed_containers: reconciliation?.removed_container_ids.length || 0,
      cleanup_failures:
        reconciliation?.cleanup_results.filter((result) => result.status === "failed").length || 0,
    };
  }

  cancelQueued(input: { runId: string; nodeRunId?: string; reason: string }): number {
    let cancelled = 0;
    for (let index = this.capacityQueue.length - 1; index >= 0; index -= 1) {
      const queued = this.capacityQueue[index];
      if (
        !queued ||
        queued.lease.run_id !== input.runId ||
        (input.nodeRunId && queued.lease.node_run_id !== input.nodeRunId)
      ) {
        continue;
      }
      this.capacityQueue.splice(index, 1);
      clearTimeout(queued.timer);
      this.activeProvisioning.delete(queued.lease.lease_id);
      this.provisioningCancellations.delete(queued.lease.lease_id);
      delete queued.lease.metadata.queue_position;
      delete queued.lease.metadata.queue_depth;
      queued.resolve({
        acquired: false,
        reason: input.reason,
        retryable: false,
      });
      cancelled += 1;
    }
    if (cancelled > 0) this.refreshQueueMetadata();
    for (const [leaseId, lease] of this.activeProvisioning) {
      if (
        lease.run_id === input.runId &&
        (!input.nodeRunId || lease.node_run_id === input.nodeRunId) &&
        !this.provisioningCancellations.has(leaseId)
      ) {
        this.provisioningCancellations.set(leaseId, input.reason);
        lease.metadata.provisioning_control = "cancel_requested";
        lease.metadata.provisioning_cancel_reason = input.reason;
        saveWorkerLeaseRecord(lease);
        cancelled += 1;
      }
    }
    return cancelled;
  }

  private throwIfProvisioningCancelled(lease: WorkerLeaseRecord): void {
    const reason = this.provisioningCancellations.get(lease.lease_id);
    if (reason) throw new Error(`PROVISIONING_CANCELLED: ${reason}`);
  }

  private acquireCapacity(lease: WorkerLeaseRecord): Promise<{
    acquired: boolean;
    reason: string;
    retryable: boolean;
  }> {
    if (this.activeLeaseIds.size < this.maxConcurrentWorkers) {
      this.activeLeaseIds.add(lease.lease_id);
      lease.metadata.capacity_state = "allocated";
      lease.metadata.capacity_limit = this.maxConcurrentWorkers;
      lease.metadata.capacity_allocated_at = nowIso();
      lease.metadata.queue_wait_ms = 0;
      saveWorkerLeaseRecord(lease);
      return Promise.resolve({ acquired: true, reason: "capacity_available", retryable: false });
    }
    if (this.capacityQueue.length >= this.queueLimit) {
      return Promise.resolve({
        acquired: false,
        reason: `Runtime Worker capacity queue is full (${this.queueLimit}).`,
        retryable: true,
      });
    }

    lease.metadata.capacity_state = "queued";
    lease.metadata.capacity_limit = this.maxConcurrentWorkers;
    lease.metadata.queued_at = nowIso();
    saveWorkerLeaseRecord(lease);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.capacityQueue.findIndex((item) => item.lease.lease_id === lease.lease_id);
        if (index < 0) return;
        this.capacityQueue.splice(index, 1);
        delete lease.metadata.queue_position;
        delete lease.metadata.queue_depth;
        this.refreshQueueMetadata();
        resolve({
          acquired: false,
          reason: `Runtime Worker capacity wait exceeded ${this.queueTimeoutMs} ms.`,
          retryable: true,
        });
      }, this.queueTimeoutMs);
      const queued = {
        lease,
        enqueuedAtMs: Date.now(),
        timer,
        resolve,
      };
      this.capacityQueue.push(queued);
      this.refreshQueueMetadata();
    });
  }

  private refreshQueueMetadata(): void {
    this.capacityQueue.forEach((queued, index) => {
      queued.lease.metadata.queue_position = index + 1;
      queued.lease.metadata.queue_depth = this.capacityQueue.length;
      saveWorkerLeaseRecord(queued.lease);
    });
  }

  private drainCapacityQueue(): void {
    while (
      this.activeLeaseIds.size < this.maxConcurrentWorkers &&
      this.capacityQueue.length > 0
    ) {
      const queued = this.capacityQueue.shift();
      if (!queued) break;
      clearTimeout(queued.timer);
      this.activeLeaseIds.add(queued.lease.lease_id);
      queued.lease.metadata.capacity_state = "allocated";
      queued.lease.metadata.capacity_allocated_at = nowIso();
      queued.lease.metadata.queue_wait_ms = Math.max(0, Date.now() - queued.enqueuedAtMs);
      delete queued.lease.metadata.queue_position;
      delete queued.lease.metadata.queue_depth;
      saveWorkerLeaseRecord(queued.lease);
      queued.resolve({ acquired: true, reason: "capacity_released", retryable: false });
    }
    this.refreshQueueMetadata();
  }

  private releaseCapacity(leaseId: string): void {
    if (!this.activeLeaseIds.delete(leaseId)) return;
    this.drainCapacityQueue();
  }

  async provisionWorker(request: WorkerProvisionRequest): Promise<WorkerProvisionResult> {
    const workerId = dockerSafeName(`worker-${request.job.job_id}`);
    const leaseId = `lease:${request.job.job_id}`;
    const containerName = dockerSafeName(`my-mate-${workerId}`);
    const token = deriveRuntimeWorkerToken(workerId);
    const acquiredAt = request.requested_at || nowIso();
    const requestedWorkspacePath = request.job.provision.workspace.project_local_repo;
    const sourceWorkspacePath = requestedWorkspacePath ? path.resolve(requestedWorkspacePath) : null;
    const workspaceHostPath = sourceWorkspacePath
      ? runWorkspaceHostPath(request.job.run_id)
      : path.resolve(RUNTIME_WORKSPACES_DIR, dockerSafeName(request.job.run_id));

    const baseLease: WorkerLeaseRecord = {
      lease_id: leaseId,
      worker_id: workerId,
      job_id: request.job.job_id,
      target_kind: "docker-worker",
      run_id: request.job.run_id,
      node_run_id: request.job.node_run_id,
      container_id: null,
      execution_ref: null,
      acquired_at: acquiredAt,
      last_heartbeat_at: null,
      expires_at: null,
      released_at: null,
      release_reason: null,
      status: "provisioning",
      last_error: null,
      metadata: {
        provisioner_kind: this.kind,
        container_name: containerName,
        image: request.job.provision.image || this.options.image || RUNTIME_WORKER_IMAGE,
        workspace_host_path: workspaceHostPath,
        workspace_source: sourceWorkspacePath ? "run_sandbox_copy" : "runtime_workspace",
        source_workspace_path: sourceWorkspacePath,
        requires_change_approval: request.job.provision.execution_policy.requires_change_approval,
        isolation_profile: "default-v1",
      },
    };
    saveWorkerLeaseRecord(baseLease);
    this.activeProvisioning.set(leaseId, baseLease);
    const capacity = await this.acquireCapacity(baseLease);
    if (!capacity.acquired) {
      this.activeProvisioning.delete(leaseId);
      this.provisioningCancellations.delete(leaseId);
      baseLease.status = capacity.retryable ? "failed" : "released";
      baseLease.last_error = capacity.reason;
      baseLease.released_at = nowIso();
      baseLease.release_reason = capacity.retryable ? "capacity_deferred" : "capacity_cancelled";
      baseLease.metadata.capacity_state = capacity.retryable ? "deferred" : "cancelled";
      saveWorkerLeaseRecord(baseLease);
      return {
        status: capacity.retryable ? "deferred" : "failed",
        reason: capacity.reason,
        retryable: capacity.retryable,
      };
    }
    const run = this.options.commandRunner || runDockerCommand;
    let managedCredentialEnvFile: string | null = null;
    try {
      this.throwIfProvisioningCancelled(baseLease);
      if (sourceWorkspacePath) {
        const baseline = ensureRunWorkspace({ runId: request.job.run_id, sourceRoot: sourceWorkspacePath });
        baseLease.metadata.workspace_baseline_created_at = baseline.created_at;
        baseLease.metadata.workspace_baseline_file_count = Object.keys(baseline.files).length;
        saveWorkerLeaseRecord(baseLease);
      } else {
        fs.mkdirSync(workspaceHostPath, { recursive: true });
      }
      this.workerHub.expectWorker({
        workerId,
        token,
        expectedAt: acquiredAt,
        metadata: {
          lease_id: leaseId,
          job_id: request.job.job_id,
          run_id: request.job.run_id,
          node_run_id: request.job.node_run_id,
          container_name: containerName,
        },
      });
      this.throwIfProvisioningCancelled(baseLease);
      const managerWsUrl = runtimeWorkerWebSocketUrl(
        containerManagerBaseUrl(request),
        workerId,
      );
      const image = request.job.provision.image || this.options.image || RUNTIME_WORKER_IMAGE;
      const args = [
        "run",
        "-d",
        ...(RUNTIME_WORKER_AUTO_REMOVE ? ["--rm"] : []),
        "--name",
        containerName,
        "--label",
        "my-mate.runtime-worker=true",
        "--label",
        `my-mate.manager-id=${this.managerId}`,
        "--label",
        `my-mate.job-id=${request.job.job_id}`,
        "--label",
        `my-mate.run-id=${request.job.run_id}`,
        "--init",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--mount",
        `type=bind,source=${workspaceHostPath},target=/workspace`,
        "-e",
        `MY_MATE_MANAGER_WS_URL=${managerWsUrl}`,
        "-e",
        `MY_MATE_WORKER_ID=${workerId}`,
        "-e",
        `MY_MATE_WORKER_TOKEN=${token}`,
        "-e",
        `MY_MATE_WORKER_LEASE_ID=${leaseId}`,
        "-e",
        `MY_MATE_WORKSPACE=/workspace`,
        "-e",
        `AGENT_BACKEND=${request.job.harness.agent_runtime}`,
      ];
      const explicitEnvNames = new Set<string>();
      for (const [key, value] of Object.entries(request.job.provision.env)) {
        if (/TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION/i.test(key)) {
          continue;
        }
        explicitEnvNames.add(key);
        args.push("-e", `${key}=${value}`);
      }
      for (const name of configuredPassthroughEnvNames()) {
        if (!explicitEnvNames.has(name)) {
          args.push("-e", name);
        }
      }
      const connectionCredentialEnv = request.job.harness.provider_connection?.credential_env;
      const providerConnection = request.job.harness.provider_connection;
      if (providerConnection?.credential_source === "managed") {
        const credential = getManagedProviderCredential(providerConnection.connection_id);
        if (!credential) {
          throw new Error("Provider Connection credential is not configured.");
        }
        managedCredentialEnvFile = writeManagedCredentialEnvFile(
          leaseId,
          providerConnection.credential_env,
          credential,
        );
        args.push("--env-file", managedCredentialEnvFile);
      } else if (
        connectionCredentialEnv &&
        /^[A-Z_][A-Z0-9_]*$/.test(connectionCredentialEnv) &&
        process.env[connectionCredentialEnv] !== undefined &&
        !explicitEnvNames.has(connectionCredentialEnv) &&
        !args.includes(connectionCredentialEnv)
      ) {
        args.push("-e", connectionCredentialEnv);
      }
      const limits = request.job.provision.resource_limits;
      const defaultLimits = this.options.defaultResourceLimits || {
        cpus: RUNTIME_WORKER_DEFAULT_CPUS,
        memoryMb: RUNTIME_WORKER_DEFAULT_MEMORY_MB,
        pids: RUNTIME_WORKER_DEFAULT_PIDS,
      };
      const cpus = limits?.cpus || defaultLimits.cpus;
      const memoryMb = limits?.memory_mb || defaultLimits.memoryMb;
      const pids = limits?.pids || defaultLimits.pids;
      args.push("--cpus", String(cpus));
      args.push("--memory", `${Math.floor(memoryMb)}m`);
      args.push("--pids-limit", String(Math.floor(pids)));
      baseLease.metadata.resource_limits = {
        cpus,
        memory_mb: Math.floor(memoryMb),
        pids: Math.floor(pids),
      };
      args.push(image);

      const result = await run(this.options.dockerBin || RUNTIME_DOCKER_BIN, args, 60000);
      if (result.exitCode !== 0 || !result.stdout) {
        throw new Error(result.stderr || result.stdout || "Docker did not return a container id.");
      }
      baseLease.container_id = result.stdout.split(/\s+/)[0] || null;
      baseLease.metadata.container_id = baseLease.container_id;
      saveWorkerLeaseRecord(baseLease);
      this.throwIfProvisioningCancelled(baseLease);
      const worker = await this.workerHub.waitForWorker(
        workerId,
        this.options.registerTimeoutMs || RUNTIME_WORKER_REGISTER_TIMEOUT_MS,
      );
      this.throwIfProvisioningCancelled(baseLease);
      const healthResult = await run(
        this.options.dockerBin || RUNTIME_DOCKER_BIN,
        [
          "exec",
          containerName,
          "node",
          "-e",
          "fetch('http://127.0.0.1:4040/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))",
        ],
        this.options.healthTimeoutMs || RUNTIME_WORKER_HEALTH_TIMEOUT_MS,
      );
      if (healthResult.exitCode !== 0) {
        throw new Error(
          healthResult.stderr || healthResult.stdout || "Runtime Worker health probe failed.",
        );
      }
      this.throwIfProvisioningCancelled(baseLease);
      baseLease.status = "ready";
      baseLease.last_heartbeat_at = worker.last_heartbeat_at;
      baseLease.metadata.health_status = "healthy";
      baseLease.metadata.health_checked_at = nowIso();
      saveWorkerLeaseRecord(baseLease);
      return {
        status: "ready",
        lease: baseLease,
      };
    } catch (error) {
      const cancelled =
        error instanceof Error && error.message.startsWith("PROVISIONING_CANCELLED:");
      baseLease.status = "failed";
      baseLease.last_error = error instanceof Error ? error.message : "Docker worker provisioning failed.";
      baseLease.release_reason = cancelled ? "provisioning_cancelled" : "provisioning_failed";
      baseLease.metadata.provisioning_error = baseLease.last_error;
      saveWorkerLeaseRecord(baseLease);
      await this.cleanupLease(baseLease, baseLease.release_reason, {
        containerRef: containerName,
        force: true,
      });
      return {
        status: "failed",
        reason:
          typeof baseLease.metadata.provisioning_error === "string"
            ? baseLease.metadata.provisioning_error
            : "Docker worker provisioning failed.",
        retryable: !cancelled,
      };
    } finally {
      if (managedCredentialEnvFile) {
        fs.rmSync(managedCredentialEnvFile, { force: true });
      }
      this.activeProvisioning.delete(leaseId);
      this.provisioningCancellations.delete(leaseId);
    }
  }

  private async listManagedWorkerContainers(): Promise<WorkerContainerInventoryRecord[]> {
    const run = this.options.commandRunner || runDockerCommand;
    const listed = await run(
      this.options.dockerBin || RUNTIME_DOCKER_BIN,
      [
        "ps",
        "-aq",
        "--filter",
        "label=my-mate.runtime-worker=true",
        "--filter",
        `label=my-mate.manager-id=${this.managerId}`,
      ],
      15000,
    );
    if (listed.exitCode !== 0) {
      throw new Error(listed.stderr || listed.stdout || "Docker container inventory failed.");
    }
    const containerIds = listed.stdout.split(/\s+/).filter(Boolean);
    if (containerIds.length === 0) return [];
    const inspected = await run(
      this.options.dockerBin || RUNTIME_DOCKER_BIN,
      ["inspect", ...containerIds],
      30000,
    );
    if (inspected.exitCode !== 0) {
      throw new Error(inspected.stderr || inspected.stdout || "Docker container inspection failed.");
    }
    return parseDockerInspectOutput(inspected.stdout);
  }

  private async cleanupLease(
    lease: WorkerLease,
    reason: string,
    options: { force?: boolean; containerRef?: string | null } = {},
  ): Promise<WorkerCleanupResult> {
    const persisted = getWorkerLeaseRecord(lease.run_id, lease.lease_id);
    const record: WorkerLeaseRecord = {
      ...(lease as WorkerLeaseRecord),
      ...(persisted || {}),
      job_id: persisted?.job_id || lease.job_id || "",
      status: persisted?.status || (lease as WorkerLeaseRecord).status || "cleanup_pending",
      last_heartbeat_at: persisted?.last_heartbeat_at || lease.last_heartbeat_at || null,
      released_at: persisted?.released_at || null,
      release_reason: reason,
      last_error: persisted?.last_error || null,
      metadata: { ...lease.metadata, ...(persisted?.metadata || {}) },
    };
    const previousCleanup = record.cleanup || null;
    if (
      !options.force &&
      record.status === "released" &&
      previousCleanup?.status === "succeeded"
    ) {
      this.releaseCapacity(record.lease_id);
      return {
        status: "succeeded",
        lease_id: record.lease_id,
        run_id: record.run_id,
        node_run_id: record.node_run_id,
        worker_id: record.worker_id,
        attempt_id: previousCleanup.attempt_id,
        attempt: previousCleanup.attempt,
        reason: previousCleanup.reason,
        container_ref: previousCleanup.container_ref,
        resource_found: false,
        capacity_released: true,
        started_at: previousCleanup.started_at,
        completed_at: previousCleanup.completed_at || previousCleanup.started_at,
        error: null,
      };
    }

    const startedAt = nowIso();
    const attempt = (previousCleanup?.attempt || 0) + 1;
    const attemptId = `cleanup:${record.lease_id}:${attempt}`;
    const containerRef =
      options.containerRef !== undefined
        ? options.containerRef
        : typeof record.metadata.container_name === "string"
          ? record.metadata.container_name
          : record.container_id;
    record.status = "cleanup_pending";
    record.released_at = null;
    record.release_reason = reason;
    record.last_error = null;
    record.cleanup = {
      attempt_id: attemptId,
      attempt,
      status: "pending",
      reason,
      container_ref: containerRef,
      started_at: startedAt,
      completed_at: null,
      last_error: null,
    };
    record.metadata.capacity_state = "cleanup_pending";
    saveWorkerLeaseRecord(record);
    this.workerHub.releaseWorker(record.worker_id, reason);

    let commandResult: DockerCommandResult = { exitCode: 0, stdout: "", stderr: "" };
    let commandError: string | null = null;
    if (containerRef) {
      const run = this.options.commandRunner || runDockerCommand;
      try {
        commandResult = await run(
          this.options.dockerBin || RUNTIME_DOCKER_BIN,
          ["rm", "-f", containerRef],
          15000,
        );
      } catch (error) {
        commandError = error instanceof Error ? error.message : "Docker cleanup command failed.";
        commandResult = { exitCode: 1, stdout: "", stderr: commandError };
      }
    }

    const resourceMissing = !!containerRef && isDockerResourceMissing(commandResult);
    const removedAfterRace =
      !!containerRef &&
      isDockerRemovalInProgress(commandResult) &&
      await this.waitForContainerRemoval(containerRef);
    const completedAt = nowIso();
    const succeeded =
      !containerRef || commandResult.exitCode === 0 || resourceMissing || removedAfterRace;
    if (succeeded) {
      record.status = "released";
      record.released_at = completedAt;
      record.last_error = null;
      record.cleanup = {
        ...record.cleanup,
        status: "succeeded",
        completed_at: completedAt,
        last_error: null,
      };
      record.metadata.capacity_state = "released";
      saveWorkerLeaseRecord(record);
      this.releaseCapacity(record.lease_id);
    } else {
      commandError = commandError || cleanupError(commandResult);
      record.status = "cleanup_failed";
      record.released_at = null;
      record.last_error = commandError;
      record.cleanup = {
        ...record.cleanup,
        status: "failed",
        completed_at: completedAt,
        last_error: commandError,
      };
      record.metadata.capacity_state = "cleanup_failed";
      saveWorkerLeaseRecord(record);
    }

    return {
      status: succeeded ? "succeeded" : "failed",
      lease_id: record.lease_id,
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      worker_id: record.worker_id,
      attempt_id: attemptId,
      attempt,
      reason,
      container_ref: containerRef,
      resource_found: !!containerRef && !resourceMissing,
      capacity_released: succeeded,
      started_at: startedAt,
      completed_at: completedAt,
      error: succeeded ? null : commandError,
    };
  }

  private async waitForContainerRemoval(containerRef: string): Promise<boolean> {
    const run = this.options.commandRunner || runDockerCommand;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        const inspected = await run(
          this.options.dockerBin || RUNTIME_DOCKER_BIN,
          ["inspect", containerRef],
          5000,
        );
        if (inspected.exitCode !== 0 && isDockerResourceMissing(inspected)) {
          return true;
        }
      } catch {
        // A transient Docker error is retried until the bounded deadline.
      }
    }
    return false;
  }

  async releaseWorker(
    lease: WorkerLease,
    reason = "job_terminal",
  ): Promise<WorkerCleanupResult> {
    return this.cleanupLease(lease, reason);
  }

  async reconcileWorkers(input: {
    reason?: string;
    reconciledAt?: string;
  } = {}): Promise<WorkerReconciliationResult> {
    const startedAt = input.reconciledAt || nowIso();
    const reason = input.reason || "control_plane_recovery";
    const reconciliationId = `reconcile:${startedAt}`;
    const leases = listWorkerLeaseRecords();
    const matchedLeaseIds = new Set<string>();
    const orphanContainerIds: string[] = [];
    const removedContainerIds: string[] = [];
    const retainedContainerIds: string[] = [];
    const cleanupResults: WorkerCleanupResult[] = [];
    let discoveredContainers: WorkerContainerInventoryRecord[] = [];
    let inventoryError: string | null = null;

    try {
      discoveredContainers = await this.listManagedWorkerContainers();
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Docker inventory reconciliation failed.";
    }

    for (const container of discoveredContainers) {
      const matchedLease = leases.find((lease) => {
        const containerName =
          typeof lease.metadata.container_name === "string"
            ? lease.metadata.container_name
            : null;
        return (
          lease.container_id === container.container_id ||
          containerName === container.container_name ||
          (!!container.job_id &&
            lease.job_id === container.job_id &&
            (!container.run_id || lease.run_id === container.run_id))
        );
      });
      if (matchedLease) {
        matchedLeaseIds.add(matchedLease.lease_id);
        const result = await this.cleanupLease(matchedLease, reason, {
          force: true,
          containerRef: container.container_id,
        });
        cleanupResults.push(result);
        if (result.status === "succeeded") removedContainerIds.push(container.container_id);
        else retainedContainerIds.push(container.container_id);
        continue;
      }

      orphanContainerIds.push(container.container_id);
      const orphanLease: WorkerLeaseRecord = {
        lease_id: `orphan:${container.container_id}`,
        worker_id: `orphan:${container.container_id}`,
        job_id: container.job_id || "",
        target_kind: "docker-worker",
        run_id: container.run_id || "",
        node_run_id: "",
        container_id: container.container_id,
        execution_ref: null,
        acquired_at: startedAt,
        last_heartbeat_at: null,
        expires_at: null,
        released_at: null,
        release_reason: null,
        status: "cleanup_pending",
        last_error: null,
        metadata: { container_name: container.container_name, orphan: true },
      };
      const result = await this.cleanupLease(orphanLease, reason, {
        force: true,
        containerRef: container.container_id,
      });
      cleanupResults.push(result);
      if (result.status === "succeeded") removedContainerIds.push(container.container_id);
      else retainedContainerIds.push(container.container_id);
    }

    const cleanupStatuses = new Set([
      "provisioning",
      "ready",
      "active",
      "stale",
      "cleanup_pending",
      "cleanup_failed",
    ]);
    for (const lease of leases) {
      if (matchedLeaseIds.has(lease.lease_id) || !cleanupStatuses.has(lease.status)) continue;
      cleanupResults.push(await this.cleanupLease(lease, reason));
    }

    const completedAt = nowIso();
    const cleanupFailed = cleanupResults.some((result) => result.status === "failed");
    return saveWorkerReconciliationRecord({
      schema_version: 1,
      reconciliation_id: reconciliationId,
      reason,
      status: inventoryError ? "failed" : cleanupFailed ? "degraded" : "healthy",
      started_at: startedAt,
      completed_at: completedAt,
      discovered_containers: discoveredContainers,
      matched_lease_ids: [...matchedLeaseIds],
      orphan_container_ids: orphanContainerIds,
      removed_container_ids: removedContainerIds,
      retained_container_ids: retainedContainerIds,
      cleanup_results: cleanupResults,
      inventory_error: inventoryError,
    });
  }

  async getStatus(): Promise<{ ready: boolean; detail: string }> {
    const run = this.options.commandRunner || runDockerCommand;
    try {
      const result = await run(
        this.options.dockerBin || RUNTIME_DOCKER_BIN,
        ["version", "--format", "{{.Server.Version}}"],
        10000,
      );
      return result.exitCode === 0 && !!result.stdout
        ? { ready: true, detail: `Docker server ${result.stdout}` }
        : { ready: false, detail: result.stderr || "Docker server is unavailable." };
    } catch (error) {
      return {
        ready: false,
        detail: error instanceof Error ? error.message : "Docker server is unavailable.",
      };
    }
  }
}

export function buildWorkerProvisionRequest(input: {
  requestId: string;
  job: RuntimeWorkerJob;
  managerBaseUrl?: string | null;
  managerWorkerWsUrl?: string | null;
  requestedAt?: string;
}): WorkerProvisionRequest {
  return {
    request_id: input.requestId,
    job: input.job,
    manager_base_url: input.managerBaseUrl ?? null,
    manager_worker_ws_url: input.managerWorkerWsUrl ?? null,
    requested_at: input.requestedAt || new Date().toISOString(),
  };
}

export { RUNTIME_WORKER_ACK_TIMEOUT_MS };
