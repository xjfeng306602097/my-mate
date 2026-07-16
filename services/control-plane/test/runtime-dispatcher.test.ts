import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DockerWorkerProvisioner,
  buildWorkerProvisionRequest,
  type DockerCommandResult,
} from "../src/node-provisioner.js";
import { ExecutionAdapterRuntimeDispatcher } from "../src/runtime-dispatcher.js";
import type { RuntimeWorkerHub } from "../src/runtime-worker-hub.js";
import { WorkerRuntimeDispatcher } from "../src/worker-runtime-dispatcher.js";
import { buildRuntimeWorkerJob } from "../src/runtime-protocol.js";
import type { NodeProvisioner } from "../src/node-provisioner.js";
import { saveRuntimeWorkerRecord } from "../src/runtime/runtime-worker-store.js";
import {
  getWorkerLeaseRecord,
  listWorkerLeaseRecords,
  saveWorkerLeaseRecord,
} from "../src/runtime/worker-lease-store.js";
import {
  getRuntimeHumanGate,
  saveRuntimeHumanGate,
} from "../src/runtime/human-gate-store.js";
import type { DispatchEnvelope, NormalizedExecutionReport } from "../src/types.js";
import { createStubExecutionAdapter, resetTestRoot } from "./helpers.js";
import { setManagedProviderCredential } from "../src/provider-secret-store.js";
import { finalizeRunWorkspace } from "../src/runtime/run-workspace.js";

function buildEnvelope(overrides: Partial<DispatchEnvelope> = {}): DispatchEnvelope {
  return {
    run_id: "run-dispatcher-001",
    node_run_id: "node-run-dispatcher-001",
    template_id: "template-dispatcher",
    template_version: 1,
    workspace_id: "workspace-dispatcher",
    requested_by: "tester",
    intent: "Verify runtime dispatcher",
    node_id: "node_dispatcher",
    node_name: "Dispatcher Node",
    node_type: "agent_task",
    agent_profile: "dispatcher-agent",
    runtime_agent_ref: "dispatcher-runtime",
    agent_runtime: "openclaw",
    harness_profile: null,
    openclaw_agent_id: "dispatcher-runtime",
    allowed_skills: [],
    allowed_tools: [],
    registry_provenance: {
      agent_profile_requested: "dispatcher-agent",
      agent_profile_resolved: "dispatcher-agent",
      agent_profile_status: "active",
      agent_profile_source: "registry",
      runtime_agent_ref_source: "registry",
      openclaw_agent_id_source: "registry",
      skill_bindings: [],
      tool_bindings: [],
    },
    timeout_seconds: 900,
    parallelism_budget: 1,
    retry_policy: {
      max_attempts: 1,
      attempt: 1,
    },
    input_payload: {
      node_config: {},
    },
    output_contract: {},
    trace_context: {
      run_id: "run-dispatcher-001",
      node_run_id: "node-run-dispatcher-001",
      requested_by: "tester",
    },
    ...overrides,
  };
}

test("ExecutionAdapterRuntimeDispatcher wraps adapter dispatch in runtime result", async () => {
  const adapter = createStubExecutionAdapter();
  const dispatcher = new ExecutionAdapterRuntimeDispatcher(adapter);
  const job = buildRuntimeWorkerJob(buildEnvelope(), {
    createdAt: "2026-07-10T00:00:00.000Z",
    dispatchSequence: 3,
  });

  const result = await dispatcher.dispatchJob(job);

  assert.equal(adapter.dispatchEnvelopes.length, 1);
  assert.equal(adapter.dispatchEnvelopes[0]?.node_run_id, "node-run-dispatcher-001");
  assert.equal(result.job, job);
  assert.equal(result.target_kind, "external-bridge");
  assert.equal(result.status, "accepted");
  assert.equal(result.dispatch_id, "disp_stub_node-run-dispatcher-001");
  assert.equal(result.worker_id, null);
  assert.equal(result.lease_id, null);
  assert.equal(result.compatibility.adapter_kind, "stub");
  assert.deepEqual(result.compatibility.raw_ref, {
    dispatch_id: "disp_stub_node-run-dispatcher-001",
    openclaw_task_id: null,
    openclaw_session_id: null,
  });
});

test("ExecutionAdapterRuntimeDispatcher forwards worker report events to legacy adapter", async () => {
  const reports: NormalizedExecutionReport[] = [];
  const adapter = {
    ...createStubExecutionAdapter(),
    async handleReport(report: NormalizedExecutionReport) {
      reports.push(report);
    },
  };
  const dispatcher = new ExecutionAdapterRuntimeDispatcher(adapter);
  const report: NormalizedExecutionReport = {
    run_id: "run-dispatcher-001",
    node_run_id: "node-run-dispatcher-001",
    status: "running",
    progress: {
      percent: 50,
      message: "Runtime worker is running",
    },
    artifacts: [],
    error: null,
    raw_ref: {
      dispatch_id: "disp-runtime",
      openclaw_task_id: null,
      openclaw_session_id: null,
    },
    created_at: "2026-07-10T00:00:00.000Z",
  };

  await dispatcher.handleWorkerEvent({
    event_id: "evt-runtime-worker",
    idempotency_key: "run-001:node-run-001:job-001:1:worker.progress",
    sequence: 1,
    kind: "worker.progress",
    job_id: "job-runtime",
    run_id: report.run_id,
    node_run_id: report.node_run_id,
    worker_id: null,
    created_at: report.created_at,
    report,
  });

  assert.deepEqual(reports, [report]);
});

test("WorkerRuntimeDispatcher executes low-risk local jobs without provisioning Docker", async () => {
  let provisionCalls = 0;
  const workerHub = {
    setEventHandler() {},
    setStaleHandler() {},
  } as unknown as RuntimeWorkerHub;
  const provisioner: NodeProvisioner = {
    kind: "test-provisioner",
    async provisionWorker() {
      provisionCalls += 1;
      throw new Error("Local jobs must not provision a container.");
    },
  };
  const dispatcher = new WorkerRuntimeDispatcher(workerHub, provisioner, createStubExecutionAdapter());
  const job = buildRuntimeWorkerJob(buildEnvelope({
    agent_runtime: "local",
    runtime_agent_ref: null,
    openclaw_agent_id: null,
    allowed_tools: ["read"],
    input_payload: { node_config: { worker_target_kind: "local" } },
  }));

  const result = await dispatcher.dispatchJob(job);
  assert.equal(result.target_kind, "local");
  assert.equal(result.compatibility.adapter_kind, "in-process-runtime-worker");
  assert.equal(result.worker_events?.at(-1)?.kind, "worker.completed");
  assert.equal(provisionCalls, 0);
});

test("DockerWorkerProvisioner builds an isolated worker container and filters secret env", async () => {
  resetTestRoot();
  const sourceWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-runtime-source-"));
  fs.writeFileSync(path.join(sourceWorkspace, "README.md"), "sandbox source\n", "utf8");
  fs.writeFileSync(path.join(sourceWorkspace, ".env"), "SECRET=blocked\n", "utf8");
  const previousPassthrough = process.env.MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV = "OPENAI_API_KEY";
  process.env.OPENAI_API_KEY = "host-secret-value";
  setManagedProviderCredential({
    connectionId: "glm-docker-test",
    workspaceId: "default",
    apiKey: "connection-secret-value",
  });
  const expectedWorkers: Array<{ workerId: string; token: string }> = [];
  const releasedWorkers: Array<{ workerId: string; reason: string }> = [];
  const workerHub = {
    expectWorker(input: { workerId: string; token: string }) {
      expectedWorkers.push(input);
    },
    async waitForWorker(workerId: string) {
      return {
        worker_id: workerId,
        status: "connected",
        version: "0.1.0",
        capabilities: [],
        supported_harnesses: ["codex"],
        active_job_id: null,
        expected_at: null,
        registered_at: "2026-07-10T00:00:01.000Z",
        last_heartbeat_at: "2026-07-10T00:00:01.000Z",
        disconnected_at: null,
        released_at: null,
        metadata: {},
      };
    },
    releaseWorker(workerId: string, reason: string) {
      releasedWorkers.push({ workerId, reason });
    },
  } as unknown as RuntimeWorkerHub;
  const commands: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  let managedEnvFile = "";
  let managedEnvFileContents = "";
  const commandRunner = async (
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<DockerCommandResult> => {
    commands.push({ command, args, timeoutMs });
    if (args[0] === "run" && args.includes("--env-file")) {
      managedEnvFile = args[args.indexOf("--env-file") + 1] || "";
      managedEnvFileContents = fs.readFileSync(managedEnvFile, "utf8");
    }
    return {
      exitCode: 0,
      stdout: args[0] === "run" ? "container-runtime-001" : "",
      stderr: "",
    };
  };
  const job = buildRuntimeWorkerJob(
    buildEnvelope({
      agent_runtime: "glm",
      openclaw_agent_id: null,
      provider_connection: {
        connection_id: "glm-docker-test",
        agent_runtime: "glm",
        provider: "anthropic-compatible",
        protocol: "anthropic-messages",
        base_url: "https://glm.example.test/anthropic",
        model: "glm-5.2",
        credential_source: "managed",
        credential_env: "GLM_API_KEY",
      },
    }),
    { createdAt: "2026-07-10T00:00:00.000Z" },
  );
  job.provision.env = {
    PUBLIC_FLAG: "enabled",
    API_KEY: "must-not-be-forwarded",
  };
  job.provision.workspace.project_local_repo = sourceWorkspace;
  job.provision.resource_limits = { cpus: 1.5, memory_mb: 768, pids: 128 };
  const provisioner = new DockerWorkerProvisioner(workerHub, {
    commandRunner,
    dockerBin: "docker-test",
    image: "my-mate-runtime-worker:test",
    registerTimeoutMs: 1000,
  });

  const result = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({
      requestId: "provision-test-001",
      job,
      managerBaseUrl: "http://127.0.0.1:4010",
      requestedAt: "2026-07-10T00:00:00.000Z",
    }),
  );

  assert.equal(result.status, "ready");
  assert.equal(commands.length, 2);
  const dockerRun = commands[0];
  assert.ok(dockerRun);
  assert.equal(dockerRun.command, "docker-test");
  assert.equal(dockerRun.args[0], "run");
  assert.ok(dockerRun.args.includes("my-mate-runtime-worker:test"));
  assert.ok(dockerRun.args.includes("PUBLIC_FLAG=enabled"));
  assert.ok(!dockerRun.args.some((arg) => arg.includes("must-not-be-forwarded")));
  assert.ok(dockerRun.args.includes("OPENAI_API_KEY"));
  assert.ok(dockerRun.args.includes("--env-file"));
  assert.equal(managedEnvFileContents, "GLM_API_KEY=connection-secret-value\n");
  assert.ok(!dockerRun.args.some((arg) => arg.includes("host-secret-value")));
  assert.ok(!dockerRun.args.some((arg) => arg.includes("connection-secret-value")));
  assert.equal(fs.existsSync(managedEnvFile), false);
  assert.ok(dockerRun.args.some((arg) => arg.includes("host.docker.internal")));
  const mount = dockerRun.args[dockerRun.args.indexOf("--mount") + 1] || "";
  assert.ok(mount.includes("target=/workspace"));
  assert.ok(!mount.includes(`source=${sourceWorkspace},`));
  const sandboxPath = mount.match(/source=([^,]+),target=\/workspace/u)?.[1] || "";
  assert.equal(fs.readFileSync(path.join(sandboxPath, "README.md"), "utf8"), "sandbox source\n");
  assert.equal(fs.existsSync(path.join(sandboxPath, ".env")), false);
  assert.ok(dockerRun.args.includes("--init"));
  assert.ok(dockerRun.args.some((arg) => arg.startsWith("my-mate.manager-id=manager-")));
  assert.deepEqual(
    dockerRun.args.slice(dockerRun.args.indexOf("--cap-drop"), dockerRun.args.indexOf("--cap-drop") + 2),
    ["--cap-drop", "ALL"],
  );
  assert.deepEqual(
    dockerRun.args.slice(dockerRun.args.indexOf("--security-opt"), dockerRun.args.indexOf("--security-opt") + 2),
    ["--security-opt", "no-new-privileges:true"],
  );
  assert.ok(dockerRun.args.includes("--cpus"));
  assert.ok(dockerRun.args.includes("--memory"));
  assert.ok(dockerRun.args.includes("--pids-limit"));
  assert.equal(dockerRun.args[dockerRun.args.indexOf("--cpus") + 1], "1.5");
  assert.equal(dockerRun.args[dockerRun.args.indexOf("--memory") + 1], "768m");
  assert.equal(dockerRun.args[dockerRun.args.indexOf("--pids-limit") + 1], "128");
  assert.equal(commands[1]?.args[0], "exec");
  assert.equal(expectedWorkers.length, 1);
  assert.ok(expectedWorkers[0]?.token);
  if (result.status === "ready") {
    const persisted = getWorkerLeaseRecord(result.lease.run_id, result.lease.lease_id);
    assert.equal(persisted?.metadata.health_status, "healthy");
    assert.equal(persisted?.metadata.capacity_state, "allocated");
  }

  if (result.status === "ready") {
    fs.writeFileSync(path.join(sandboxPath, "README.md"), "worker edit\n", "utf8");
    await provisioner.releaseWorker(result.lease, "test_complete");
  }
  assert.deepEqual(commands[2]?.args.slice(0, 2), ["rm", "-f"]);
  assert.deepEqual(releasedWorkers, [
    { workerId: result.status === "ready" ? result.lease.worker_id : "", reason: "test_complete" },
  ]);
  if (result.status === "ready") {
    const persisted = getWorkerLeaseRecord(result.lease.run_id, result.lease.lease_id);
    assert.equal(persisted?.metadata.workspace_change_set_id, undefined);
    const changeSet = finalizeRunWorkspace({
      runId: result.lease.run_id,
      nodeRunId: result.lease.node_run_id,
      jobId: result.lease.job_id || "test-job",
    });
    assert.equal(changeSet?.status, "pending");
    assert.equal(fs.readFileSync(path.join(sourceWorkspace, "README.md"), "utf8"), "sandbox source\n");
  }
  if (previousPassthrough === undefined) {
    delete process.env.MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV;
  } else {
    process.env.MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV = previousPassthrough;
  }
  if (previousOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
  fs.rmSync(sourceWorkspace, { recursive: true, force: true });
});

function createReadyWorkerHub(releasedWorkers: Array<{ workerId: string; reason: string }> = []) {
  return {
    expectWorker() {},
    async waitForWorker(workerId: string) {
      return {
        worker_id: workerId,
        status: "connected",
        version: "0.1.0",
        capabilities: [],
        supported_harnesses: ["codex"],
        active_job_id: null,
        expected_at: null,
        registered_at: "2026-07-10T00:00:01.000Z",
        last_heartbeat_at: "2026-07-10T00:00:01.000Z",
        disconnected_at: null,
        released_at: null,
        metadata: {},
      };
    },
    releaseWorker(workerId: string, reason: string) {
      releasedWorkers.push({ workerId, reason });
    },
  } as unknown as RuntimeWorkerHub;
}

function buildDockerTestJob(jobId: string) {
  const job = buildRuntimeWorkerJob(
    buildEnvelope({
      run_id: `run-${jobId}`,
      node_run_id: `node-${jobId}`,
      agent_runtime: "codex",
      openclaw_agent_id: null,
    }),
    { jobId, createdAt: "2026-07-10T00:00:00.000Z" },
  );
  job.provision.workspace.project_local_repo = null;
  return job;
}

function createSuccessfulDockerRunner(commands: string[][]) {
  return async (_command: string, args: string[]): Promise<DockerCommandResult> => {
    commands.push(args);
    return {
      exitCode: 0,
      stdout: args[0] === "run" ? `container-${commands.length}` : "",
      stderr: "",
    };
  };
}

test("DockerWorkerProvisioner queues at capacity and drains work in FIFO order", async () => {
  resetTestRoot();
  const commands: string[][] = [];
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: createSuccessfulDockerRunner(commands),
    maxConcurrentWorkers: 1,
    queueLimit: 3,
    queueTimeoutMs: 5000,
  });
  const firstPromise = provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "first", job: buildDockerTestJob("job-capacity-first") }),
  );
  const first = await firstPromise;
  assert.equal(first.status, "ready");

  const secondPromise = provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "second", job: buildDockerTestJob("job-capacity-second") }),
  );
  const thirdPromise = provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "third", job: buildDockerTestJob("job-capacity-third") }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(provisioner.getCapacityStatus(), {
    max_concurrent_workers: 1,
    active_workers: 1,
    queue_depth: 2,
    queue_limit: 3,
    queue_timeout_ms: 5000,
  });
  assert.equal(commands.filter((args) => args[0] === "run").length, 1);

  if (first.status === "ready") await provisioner.releaseWorker(first.lease, "first_complete");
  const second = await secondPromise;
  assert.equal(second.status, "ready");
  assert.equal(commands.filter((args) => args[0] === "run").length, 2);
  assert.equal(provisioner.getCapacityStatus().queue_depth, 1);

  if (second.status === "ready") await provisioner.releaseWorker(second.lease, "second_complete");
  const third = await thirdPromise;
  assert.equal(third.status, "ready");
  assert.equal(commands.filter((args) => args[0] === "run").length, 3);
  if (third.status === "ready") await provisioner.releaseWorker(third.lease, "third_complete");
  assert.equal(provisioner.getCapacityStatus().active_workers, 0);
});

test("DockerWorkerProvisioner cancels queued work without launching Docker", async () => {
  resetTestRoot();
  const commands: string[][] = [];
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: createSuccessfulDockerRunner(commands),
    maxConcurrentWorkers: 1,
    queueTimeoutMs: 5000,
  });
  const first = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "first", job: buildDockerTestJob("job-cancel-first") }),
  );
  const queuedJob = buildDockerTestJob("job-cancel-queued");
  const queuedPromise = provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "queued", job: queuedJob }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(provisioner.cancelQueued({
    runId: queuedJob.run_id,
    nodeRunId: queuedJob.node_run_id,
    reason: "operator cancelled queued node",
  }), 1);
  const queued = await queuedPromise;
  assert.equal(queued.status, "failed");
  assert.equal(queued.retryable, false);
  assert.match(queued.reason, /operator cancelled/);
  assert.equal(commands.filter((args) => args[0] === "run").length, 1);
  if (first.status === "ready") await provisioner.releaseWorker(first.lease, "test_complete");
});

test("DockerWorkerProvisioner cancels active provisioning before dispatch can proceed", async () => {
  resetTestRoot();
  let markDockerRunStarted: (() => void) | null = null;
  const dockerRunStarted = new Promise<void>((resolve) => { markDockerRunStarted = resolve; });
  const dockerRunGate = { resolve: () => {} };
  const dockerRunCanFinish = new Promise<void>((resolve) => { dockerRunGate.resolve = resolve; });
  const commands: string[][] = [];
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: async (_command, args) => {
      commands.push(args);
      if (args[0] === "run") {
        markDockerRunStarted?.();
        await dockerRunCanFinish;
        return { exitCode: 0, stdout: "cancelled-provision-container", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const job = buildDockerTestJob("job-active-provision-cancel");
  const pending = provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "active-cancel", job }),
  );
  await dockerRunStarted;
  assert.equal(provisioner.cancelQueued({
    runId: job.run_id,
    nodeRunId: job.node_run_id,
    reason: "operator paused during provisioning",
  }), 1);
  dockerRunGate.resolve();
  const result = await pending;
  if (result.status === "ready") assert.fail("Cancelled provisioning returned a ready lease.");
  assert.equal(result.status, "failed");
  assert.equal(result.retryable, false);
  assert.match(result.reason, /operator paused during provisioning/);
  assert.equal(commands.some((args) => args[0] === "exec"), false);
  assert.equal(provisioner.getCapacityStatus().active_workers, 0);
});

test("DockerWorkerProvisioner defers queued work after its capacity timeout", async () => {
  resetTestRoot();
  const commands: string[][] = [];
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: createSuccessfulDockerRunner(commands),
    maxConcurrentWorkers: 1,
    queueTimeoutMs: 1000,
  });
  const first = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "first", job: buildDockerTestJob("job-timeout-first") }),
  );
  const timedOut = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "timeout", job: buildDockerTestJob("job-timeout-queued") }),
  );
  assert.equal(timedOut.status, "deferred");
  assert.equal(timedOut.retryable, true);
  assert.match(timedOut.reason, /capacity wait exceeded 1000 ms/);
  assert.equal(provisioner.getCapacityStatus().queue_depth, 0);
  assert.equal(commands.filter((args) => args[0] === "run").length, 1);
  if (first.status === "ready") await provisioner.releaseWorker(first.lease, "test_complete");
});

test("DockerWorkerProvisioner rejects excess work when the capacity queue is full", async () => {
  resetTestRoot();
  const commands: string[][] = [];
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: createSuccessfulDockerRunner(commands),
    maxConcurrentWorkers: 1,
    queueLimit: 1,
    queueTimeoutMs: 5000,
  });
  const first = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "first", job: buildDockerTestJob("job-limit-first") }),
  );
  const queuedJob = buildDockerTestJob("job-limit-queued");
  const queuedPromise = provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "queued", job: queuedJob }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const rejected = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "rejected", job: buildDockerTestJob("job-limit-rejected") }),
  );
  assert.equal(rejected.status, "deferred");
  assert.equal(rejected.retryable, true);
  assert.match(rejected.reason, /queue is full \(1\)/);
  provisioner.cancelQueued({ runId: queuedJob.run_id, reason: "test cleanup" });
  await queuedPromise;
  if (first.status === "ready") await provisioner.releaseWorker(first.lease, "test_complete");
});

test("DockerWorkerProvisioner applies default resource isolation when the job omits limits", async () => {
  resetTestRoot();
  const commands: string[][] = [];
  const job = buildDockerTestJob("job-default-limits");
  delete job.provision.resource_limits;
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: createSuccessfulDockerRunner(commands),
    defaultResourceLimits: { cpus: 2, memoryMb: 1536, pids: 320 },
  });
  const result = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "defaults", job }),
  );
  assert.equal(result.status, "ready");
  const dockerRun = commands.find((args) => args[0] === "run");
  assert.ok(dockerRun);
  assert.equal(dockerRun[dockerRun.indexOf("--cpus") + 1], "2");
  assert.equal(dockerRun[dockerRun.indexOf("--memory") + 1], "1536m");
  assert.equal(dockerRun[dockerRun.indexOf("--pids-limit") + 1], "320");
  if (result.status === "ready") await provisioner.releaseWorker(result.lease, "test_complete");
});

test("DockerWorkerProvisioner cleans unhealthy containers and releases capacity", async () => {
  resetTestRoot();
  const commands: string[][] = [];
  const releasedWorkers: Array<{ workerId: string; reason: string }> = [];
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(releasedWorkers), {
    commandRunner: async (_command, args) => {
      commands.push(args);
      if (args[0] === "run") return { exitCode: 0, stdout: "unhealthy-container", stderr: "" };
      if (args[0] === "exec") return { exitCode: 1, stdout: "", stderr: "health failed" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    maxConcurrentWorkers: 1,
  });
  const result = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "unhealthy", job: buildDockerTestJob("job-unhealthy") }),
  );
  assert.equal(result.status, "failed");
  assert.match(result.reason, /health failed/);
  assert.ok(commands.some((args) => args[0] === "rm" && args[1] === "-f"));
  assert.equal(provisioner.getCapacityStatus().active_workers, 0);
  assert.deepEqual(releasedWorkers.map((item) => item.reason), ["provisioning_failed"]);
});

test("DockerWorkerProvisioner cleans up a container name when docker run fails", async () => {
  resetTestRoot();
  const commands: string[][] = [];
  const workerHub = {
    expectWorker() {},
    async waitForWorker() {
      throw new Error("worker should not be awaited after docker failure");
    },
    releaseWorker() {},
  } as unknown as RuntimeWorkerHub;
  const provisioner = new DockerWorkerProvisioner(workerHub, {
    commandRunner: async (_command, args) => {
      commands.push(args);
      return args[0] === "run"
        ? { exitCode: 1, stdout: "", stderr: "daemon unavailable" }
        : { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const job = buildRuntimeWorkerJob(
    buildEnvelope({ agent_runtime: "codex", openclaw_agent_id: null }),
    { createdAt: "2026-07-10T00:00:00.000Z" },
  );

  const result = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({ requestId: "provision-fail", job }),
  );

  assert.equal(result.status, "failed");
  assert.match(result.reason, /daemon unavailable/);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1]?.slice(0, 2), ["rm", "-f"]);
});

test("DockerWorkerProvisioner retains capacity on cleanup failure and retries idempotently", async () => {
  resetTestRoot();
  let cleanupSucceeds = false;
  const commands: string[][] = [];
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: async (_command, args) => {
      commands.push(args);
      if (args[0] === "run") return { exitCode: 0, stdout: "container-cleanup-retry", stderr: "" };
      if (args[0] === "exec") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "rm" && !cleanupSucceeds) {
        return { exitCode: 1, stdout: "", stderr: "daemon cleanup failure" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    maxConcurrentWorkers: 1,
  });
  const provisioned = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({
      requestId: "cleanup-retry",
      job: buildDockerTestJob("job-cleanup-retry"),
    }),
  );
  assert.equal(provisioned.status, "ready");
  if (provisioned.status !== "ready") return;

  const failed = await provisioner.releaseWorker(provisioned.lease, "test_cleanup");
  assert.equal(failed.status, "failed");
  assert.equal(failed.capacity_released, false);
  assert.equal(provisioner.getCapacityStatus().active_workers, 1);
  let persisted = getWorkerLeaseRecord(provisioned.lease.run_id, provisioned.lease.lease_id);
  assert.equal(persisted?.status, "cleanup_failed");
  assert.equal(persisted?.released_at, null);
  assert.match(persisted?.cleanup?.last_error || "", /daemon cleanup failure/);

  cleanupSucceeds = true;
  const retried = await provisioner.releaseWorker(provisioned.lease, "test_cleanup_retry");
  assert.equal(retried.status, "succeeded");
  assert.equal(retried.attempt, 2);
  assert.equal(provisioner.getCapacityStatus().active_workers, 0);
  persisted = getWorkerLeaseRecord(provisioned.lease.run_id, provisioned.lease.lease_id);
  assert.equal(persisted?.status, "released");
  assert.equal(persisted?.cleanup?.status, "succeeded");

  const cleanupCommandsBeforeDuplicate = commands.filter((args) => args[0] === "rm").length;
  const duplicate = await provisioner.releaseWorker(provisioned.lease, "duplicate_cleanup");
  assert.equal(duplicate.status, "succeeded");
  assert.equal(
    commands.filter((args) => args[0] === "rm").length,
    cleanupCommandsBeforeDuplicate,
  );
});

test("DockerWorkerProvisioner confirms auto-remove races before releasing capacity", async () => {
  resetTestRoot();
  let inspectCalls = 0;
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: async (_command, args) => {
      if (args[0] === "run") return { exitCode: 0, stdout: "container-auto-remove", stderr: "" };
      if (args[0] === "exec") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "rm") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Error response from daemon: removal of container test is already in progress",
        };
      }
      if (args[0] === "inspect") {
        inspectCalls += 1;
        return inspectCalls === 1
          ? { exitCode: 0, stdout: "[]", stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "Error: No such container: test" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    maxConcurrentWorkers: 1,
  });
  const provisioned = await provisioner.provisionWorker(
    buildWorkerProvisionRequest({
      requestId: "auto-remove-race",
      job: buildDockerTestJob("job-auto-remove-race"),
    }),
  );
  assert.equal(provisioned.status, "ready");
  if (provisioned.status !== "ready") return;

  const cleanup = await provisioner.releaseWorker(provisioned.lease, "worker.completed");

  assert.equal(cleanup.status, "succeeded");
  assert.equal(cleanup.resource_found, true);
  assert.equal(inspectCalls, 2);
  assert.equal(provisioner.getCapacityStatus().active_workers, 0);
  assert.equal(
    getWorkerLeaseRecord(provisioned.lease.run_id, provisioned.lease.lease_id)?.status,
    "released",
  );
});

test("DockerWorkerProvisioner reconciliation removes labeled orphan containers", async () => {
  resetTestRoot();
  const commands: string[][] = [];
  const provisioner = new DockerWorkerProvisioner(createReadyWorkerHub(), {
    commandRunner: async (_command, args) => {
      commands.push(args);
      if (args[0] === "ps") {
        return { exitCode: 0, stdout: "orphan-container-id", stderr: "" };
      }
      if (args[0] === "inspect") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{
            Id: "orphan-container-id",
            Name: "/my-mate-orphan",
            Config: {
              Labels: {
                "my-mate.runtime-worker": "true",
                "my-mate.run-id": "missing-run",
                "my-mate.job-id": "missing-job",
              },
            },
            State: { Status: "running" },
          }]),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  const reconciliation = await provisioner.reconcileWorkers({
    reason: "startup_test",
    reconciledAt: "2026-07-10T00:05:00.000Z",
  });

  assert.equal(reconciliation.status, "healthy");
  assert.deepEqual(reconciliation.orphan_container_ids, ["orphan-container-id"]);
  assert.deepEqual(reconciliation.removed_container_ids, ["orphan-container-id"]);
  assert.deepEqual(reconciliation.retained_container_ids, []);
  assert.ok(commands.some((args) => args[0] === "rm" && args[2] === "orphan-container-id"));
  assert.ok(
    commands
      .find((args) => args[0] === "ps")
      ?.some((arg) => arg.startsWith("label=my-mate.manager-id=manager-")),
  );
  const orphanLease = listWorkerLeaseRecords().find(
    (lease) => lease.lease_id === "orphan:orphan-container-id",
  );
  assert.equal(orphanLease?.status, "released");
  assert.equal(provisioner.getRecoveryStatus().orphan_containers, 1);
});

test("WorkerRuntimeDispatcher releases provisioned workers when capability or ACK checks fail", async () => {
  resetTestRoot();
  const released: string[] = [];
  let dispatchCalls = 0;
  const workerHub = {
    setEventHandler() {},
    setStaleHandler() {},
    async dispatchJob() {
      dispatchCalls += 1;
      return {
        protocol: "my_mate_runtime_v1",
        message_id: "ack-rejected",
        sent_at: "2026-07-10T00:00:01.000Z",
        kind: "job.ack",
        worker_id: "worker-dispatch-check",
        job_id: "job-dispatch-check",
        status: "rejected",
        reason: "worker rejected test job",
      };
    },
    sendControl() {
      return true;
    },
    getSummary() {
      return {
        connected_workers: 1,
        busy_workers: 0,
        stale_workers: 0,
        expected_workers: 0,
        worker_ids: ["worker-dispatch-check"],
      };
    },
  } as unknown as RuntimeWorkerHub;
  const provisioner: NodeProvisioner = {
    kind: "test-provisioner",
    async provisionWorker(request) {
      saveRuntimeWorkerRecord({
        worker_id: "worker-dispatch-check",
        status: "connected",
        version: "0.1.0",
        capabilities: ["workspace"],
        supported_harnesses: ["codex"],
        active_job_id: null,
        expected_at: null,
        registered_at: request.requested_at,
        last_heartbeat_at: request.requested_at,
        disconnected_at: null,
        released_at: null,
        metadata: {},
      });
      return {
        status: "ready",
        lease: {
          lease_id: `lease:${request.job.job_id}`,
          worker_id: "worker-dispatch-check",
          job_id: request.job.job_id,
          target_kind: "docker-worker",
          run_id: request.job.run_id,
          node_run_id: request.job.node_run_id,
          container_id: "container-dispatch-check",
          execution_ref: null,
          acquired_at: request.requested_at,
          expires_at: null,
          metadata: {},
        },
      };
    },
    async releaseWorker(_lease, reason) {
      released.push(reason || "released");
    },
  };
  const dispatcher = new WorkerRuntimeDispatcher(
    workerHub,
    provisioner,
    createStubExecutionAdapter(),
  );
  const capabilityJob = buildRuntimeWorkerJob(
    buildEnvelope({ agent_runtime: "codex", openclaw_agent_id: null }),
  );
  capabilityJob.provision.required_capabilities = ["browser"];

  await assert.rejects(
    dispatcher.dispatchJob(capabilityJob),
    /missing capabilities: browser/,
  );
  assert.deepEqual(released, ["capability_mismatch"]);
  assert.equal(dispatchCalls, 0);

  const ackJob = buildRuntimeWorkerJob(
    buildEnvelope({ agent_runtime: "codex", openclaw_agent_id: null }),
    { jobId: "job-dispatch-check" },
  );
  await assert.rejects(dispatcher.dispatchJob(ackJob), /worker rejected test job/);
  assert.deepEqual(released, ["capability_mismatch", "dispatch_failed"]);
  assert.equal(dispatchCalls, 1);
});

test("WorkerRuntimeDispatcher resumes a persisted native human gate on its active lease", () => {
  resetTestRoot();
  const controls: Array<Record<string, unknown>> = [];
  const workerHub = {
    setEventHandler() {},
    setStaleHandler() {},
    sendControl(input: Record<string, unknown>) {
      controls.push(input);
      return true;
    },
  } as unknown as RuntimeWorkerHub;
  const dispatcher = new WorkerRuntimeDispatcher(
    workerHub,
    { kind: "test", async provisionWorker() { throw new Error("not used"); } },
    createStubExecutionAdapter(),
  );
  saveWorkerLeaseRecord({
    lease_id: "lease:gate-job",
    worker_id: "worker-gate",
    job_id: "gate-job",
    target_kind: "docker-worker",
    run_id: "run-gate",
    node_run_id: "node-gate",
    container_id: "container-gate",
    execution_ref: null,
    acquired_at: "2026-07-12T00:00:00.000Z",
    last_heartbeat_at: null,
    expires_at: null,
    released_at: null,
    release_reason: null,
    status: "active",
    last_error: null,
    metadata: {},
  });
  saveRuntimeHumanGate({
    gate_id: "gate-001",
    kind: "human_input",
    status: "suspended",
    transport: "worker_native",
    run_id: "run-gate",
    node_run_id: "node-gate",
    job_id: "gate-job",
    worker_id: "worker-gate",
    summary: "Select channel",
    input_schema: { type: "object" },
    request_payload: null,
    response_payload: null,
    requested_at: "2026-07-12T00:00:00.000Z",
    suspended_at: "2026-07-12T00:00:01.000Z",
    resolved_at: null,
    control_id: null,
    last_error: null,
  });

  const resumed = dispatcher.resumeHumanGate({
    runId: "run-gate",
    nodeRunId: "node-gate",
    gateId: "gate-001",
    decision: "resume",
    payload: { channel: "stable" },
  });
  assert.equal(resumed.delivered, true);
  assert.equal(controls.length, 1);
  assert.deepEqual(controls[0]?.payload, { channel: "stable" });
  assert.equal(controls[0]?.gateId, "gate-001");
  const persisted = getRuntimeHumanGate("run-gate", "gate-001");
  assert.equal(persisted?.status, "resuming");
  assert.equal(persisted?.control_id, resumed.controlId);
});
