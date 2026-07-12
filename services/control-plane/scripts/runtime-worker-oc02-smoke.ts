import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { overrideDataDir, RUNTIME_WORKER_IMAGE } from "../src/config.js";
import { DockerWorkerProvisioner } from "../src/node-provisioner.js";
import { saveNodeRuns } from "../src/node-run-store.js";
import { saveRunPlan } from "../src/run-plan-store.js";
import { saveRun } from "../src/run-store.js";
import type { RuntimeDispatchResult, RuntimeDispatcher } from "../src/runtime-dispatcher.js";
import type { RuntimeWorkerJob, WorkerEvent } from "../src/runtime-protocol.js";
import { RuntimeWorkerHub } from "../src/runtime-worker-hub.js";
import { RuntimeEngine } from "../src/runtime/runtime-engine.js";
import { saveRuntimeJobRecord } from "../src/runtime/runtime-job-store.js";
import { scanRuntimeTimeouts } from "../src/runtime/runtime-recovery-service.js";
import { listRuntimeCompensations } from "../src/runtime/runtime-compensation-store.js";
import { saveWorkerLeaseRecord } from "../src/runtime/worker-lease-store.js";
import type { NormalizedExecutionReport } from "../src/types.js";

const repoRoot = path.resolve(process.cwd());
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-oc02-docker-"));
const suffix = `${process.pid}-${Date.now()}`;
const image = RUNTIME_WORKER_IMAGE;
const containerName = `my-mate-oc02-timeout-${suffix}`;
const runId = `run-oc02-smoke-${suffix}`;
const nodeRunId = `node-oc02-smoke-${suffix}`;
const jobId = `job-oc02-smoke-${suffix}`;
const leaseId = `lease:${jobId}`;
const workerId = `worker:${jobId}`;
const expiredAt = "2026-07-11T00:00:01.000Z";

function docker(args: string[], allowFailure = false): string {
  const result = spawnSync("docker", args, { cwd: repoRoot, encoding: "utf-8", windowsHide: true });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `docker ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

class PassiveDispatcher implements RuntimeDispatcher {
  readonly kind = "oc02-docker-smoke";
  enqueueRun() {}
  notifyRunAction() {}
  notifyNodeAction() {}
  async dispatchJob(job: RuntimeWorkerJob): Promise<RuntimeDispatchResult> {
    throw new Error(`Unexpected redispatch for ${job.job_id}.`);
  }
  async handleWorkerEvent(_event: WorkerEvent) {}
  async handleReport(_report: NormalizedExecutionReport) {}
}

async function main(): Promise<void> {
  overrideDataDir(dataDir);
  docker(["version", "--format", "{{.Server.Version}}"]);
  const containerId = docker([
    "run", "-d", "--name", containerName,
    "--label", "my-mate.runtime-worker=true",
    "--label", `my-mate.run-id=${runId}`,
    "--label", `my-mate.job-id=${jobId}`,
    image, "node", "-e", "setInterval(() => {}, 1000)",
  ]);

  try {
  const createdAt = "2026-07-11T00:00:00.000Z";
  saveRun({
    run_id: runId,
    template_id: "oc02-smoke-template",
    template_version: 1,
    workspace_id: "default",
    requested_by: "oc02-smoke",
    intent: "Verify real Docker timeout compensation",
    status: "running",
    current_summary: "Runtime Worker active",
    waiting_reason: null,
    blocked_reason: null,
    started_at: createdAt,
    finished_at: null,
    last_event_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    inputs: {},
    proposal_id: null,
  });
  saveRunPlan({
    run_id: runId,
    template_id: "oc02-smoke-template",
    template_version: 1,
    workspace_id: "default",
    requested_by: "oc02-smoke",
    intent: "Verify real Docker timeout compensation",
    inputs: {},
    compiled_nodes: [{
      node_id: "oc02-smoke-node",
      node_run_id: nodeRunId,
      name: "OC-02 Docker timeout",
      type: "agent_task",
      agent_profile: null,
      runtime_agent_ref: null,
      agent_runtime: "codex",
      harness_profile: null,
      openclaw_agent_id: null,
      allowed_skills: [],
      allowed_tools: [],
      approval_kind: null,
      human_input_schema: null,
      status: "running",
      retry_policy: { max_attempts: 1, attempt: 1 },
      timeout_seconds: 1,
      parallelism_budget: 1,
      input_payload: {},
      output_contract: {},
      execution_ref: {
        job_id: jobId,
        worker_id: workerId,
        lease_id: leaseId,
        target_kind: "docker-worker",
        dispatch_id: `worker:${workerId}:${jobId}`,
        provider_refs: {},
        openclaw_task_id: null,
        openclaw_session_id: null,
      },
      registry_provenance: {
        agent_profile_requested: null,
        agent_profile_resolved: null,
        agent_profile_status: null,
        agent_profile_source: "none",
        runtime_agent_ref_source: "none",
        openclaw_agent_id_source: "none",
        skill_bindings: [],
        tool_bindings: [],
      },
      work_package: {
        key: "oc02-smoke",
        label: "OC-02 Smoke",
        order: 0,
        identity_source: "declared",
      },
    } as never],
    edges: [],
    frontier: [],
    policy_snapshot: { max_parallel_nodes: 1 },
    planner_context: {},
    status: "running",
    created_at: createdAt,
  });
  saveNodeRuns(runId, [{
    node_run_id: nodeRunId,
    run_id: runId,
    status: "running",
    progress: { percent: 10, message: "Runtime Worker active", updated_at: createdAt },
    attempt: 1,
    started_at: createdAt,
    finished_at: null,
  }]);
  const job = {
    job_id: jobId,
    run_id: runId,
    node_run_id: nodeRunId,
    node_id: "oc02-smoke-node",
    node_name: "OC-02 Docker timeout",
    node_type: "agent",
    attempt: 1,
    dispatch_sequence: 1,
    envelope: {
      run_id: runId,
      node_run_id: nodeRunId,
      template_id: "oc02-smoke-template",
      template_version: 1,
      workspace_id: "default",
      requested_by: "oc02-smoke",
      intent: "Verify real Docker timeout compensation",
      node_id: "oc02-smoke-node",
      node_name: "OC-02 Docker timeout",
      node_type: "agent",
      agent_profile: null,
      runtime_agent_ref: null,
      agent_runtime: "codex",
      harness_profile: null,
      allowed_skills: [],
      allowed_tools: [],
      registry_provenance: { agent_profile: null, skills: [] },
      timeout_seconds: 1,
      parallelism_budget: 1,
      retry_policy: { max_attempts: 1, attempt: 1 },
      input_payload: {},
      output_contract: {},
      trace_context: { run_id: runId, node_run_id: nodeRunId, requested_by: "oc02-smoke" },
    },
    harness: {
      agent_runtime: "codex",
      runtime_agent_ref: null,
      harness_profile: null,
      allowed_skills: [],
      allowed_tools: [],
    },
    provision: {
      required: true,
      target_kind: "docker-worker",
      image,
      container_group: null,
      required_capabilities: [],
      env: {},
      workspace: null,
    },
    trace_context: { run_id: runId, node_run_id: nodeRunId, requested_by: "oc02-smoke" },
    created_at: createdAt,
  } as RuntimeWorkerJob;
  saveRuntimeJobRecord({
    job_id: jobId,
    run_id: runId,
    node_run_id: nodeRunId,
    attempt: 1,
    dispatch_sequence: 1,
    status: "running",
    worker_id: workerId,
    lease_id: leaseId,
    target_kind: "docker-worker",
    agent_runtime: "codex",
    runtime_agent_ref: null,
    created_at: createdAt,
    accepted_at: createdAt,
    finished_at: null,
    last_event_id: null,
    last_error: null,
    compatibility: { adapter_kind: null, dispatch_id: null, openclaw_task_id: null, openclaw_session_id: null },
    job,
  });
  saveWorkerLeaseRecord({
    lease_id: leaseId,
    worker_id: workerId,
    job_id: jobId,
    target_kind: "docker-worker",
    run_id: runId,
    node_run_id: nodeRunId,
    container_id: containerId,
    execution_ref: null,
    acquired_at: createdAt,
    last_heartbeat_at: createdAt,
    expires_at: expiredAt,
    released_at: null,
    release_reason: null,
    status: "active",
    last_error: null,
    metadata: { container_name: containerName, capacity_state: "active" },
  });

  const workerHub = new RuntimeWorkerHub();
  const provisioner = new DockerWorkerProvisioner(workerHub, { image });
  const outcome = await scanRuntimeTimeouts({
    engine: new RuntimeEngine({ dispatcher: new PassiveDispatcher() }),
    provisioner,
    runId,
    now: () => "2026-07-11T00:00:05.000Z",
  });
  workerHub.close();
  const compensation = listRuntimeCompensations(runId)[0];
  const remaining = docker(["ps", "-aq", "--filter", `id=${containerId}`]);
  if (
    outcome.completed !== 1 ||
    !compensation ||
    compensation.status !== "completed" ||
    !compensation.capacity_released ||
    remaining
  ) {
    throw new Error(`Unexpected OC-02 Docker result: ${JSON.stringify({ outcome, compensation, remaining })}`);
  }
  console.log(JSON.stringify({
    compensation_id: compensation.compensation_id,
    status: compensation.status,
    reason: compensation.reason,
    cleanup_attempt_ids: compensation.cleanup_attempt_ids,
    capacity_released: compensation.capacity_released,
    remaining_containers: 0,
  }, null, 2));
  } finally {
    docker(["rm", "-f", containerName], true);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
