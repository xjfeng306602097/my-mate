import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyExecutionRef } from "../src/execution-ref.js";
import { listNodeRuns, saveNodeRuns } from "../src/node-run-store.js";
import { getRunPlan, saveRunPlan } from "../src/run-plan-store.js";
import { getRun, saveRun } from "../src/run-store.js";
import {
  ExecutionAdapterRuntimeDispatcher,
  type RuntimeDispatchResult,
  type RuntimeDispatcher,
} from "../src/runtime-dispatcher.js";
import { RuntimeEngine } from "../src/runtime/runtime-engine.js";
import { listExecutionReplays } from "../src/runtime/execution-replay-store.js";
import { listRuntimeJobRecords, saveRuntimeJobRecord } from "../src/runtime/runtime-job-store.js";
import { scanRuntimeTimeouts } from "../src/runtime/runtime-recovery-service.js";
import { listRuntimeCompensations } from "../src/runtime/runtime-compensation-store.js";
import { saveWorkerLeaseRecord } from "../src/runtime/worker-lease-store.js";
import type { RuntimeWorkerJob, WorkerEvent } from "../src/runtime-protocol.js";
import type { NormalizedExecutionReport } from "../src/types.js";
import {
  buildPublishedTemplate,
  createStubExecutionAdapter,
  getJson,
  postJson,
  resetTestRoot,
  seedTemplate,
  startTestServer,
} from "./helpers.js";

async function waitForJob(runId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const job = listRuntimeJobRecords(runId).at(-1);
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Runtime job was not created.");
}

async function createRunningRun(baseUrl: string, templateId: string): Promise<string> {
  const created = await postJson(`${baseUrl}/api/runs`, {
    intent: "Exercise OC-02 recovery",
    template_id: templateId,
    inputs: { goal: "preserve frozen input", secret_marker: "source-value" },
    validation_mode: "warn",
  });
  assert.equal(created.status, 201);
  const runId = created.body.run_id as string;
  await waitForJob(runId);
  return runId;
}

function failNodeAndJob(runId: string): string {
  const job = listRuntimeJobRecords(runId).at(-1)!;
  const plan = getRunPlan(runId)!;
  const nodeRuns = listNodeRuns(runId);
  const nodeRun = nodeRuns.find((item) => item.node_run_id === job.node_run_id)!;
  const node = plan.compiled_nodes.find((item) => item.node_run_id === job.node_run_id)!;
  const timestamp = "2026-07-11T01:00:00.000Z";
  job.status = "failed";
  job.finished_at = timestamp;
  job.last_error = "source execution failed";
  saveRuntimeJobRecord(job);
  node.status = "failed";
  node.execution_ref = createEmptyExecutionRef();
  nodeRun.status = "failed";
  nodeRun.finished_at = timestamp;
  nodeRun.progress = { percent: 100, message: "source execution failed", updated_at: timestamp };
  plan.status = "failed";
  plan.frontier = [];
  saveRunPlan(plan);
  saveNodeRuns(runId, nodeRuns);
  const run = getRun(runId)!;
  run.status = "failed";
  run.finished_at = timestamp;
  run.blocked_reason = "source execution failed";
  saveRun(run);
  return nodeRun.node_run_id;
}

test("OC-02 failure replay dispatches a new job from frozen identity and is idempotent", async () => {
  resetTestRoot();
  const templateId = "oc02-failure-replay";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({
    executionAdapter: adapter,
    dispatcher: new ExecutionAdapterRuntimeDispatcher(adapter),
  });
  try {
    const runId = await createRunningRun(server.baseUrl, templateId);
    const nodeRunId = failNodeAndJob(runId);
    const sourceJob = listRuntimeJobRecords(runId).at(-1)!;
    const sourceEnvelope = JSON.parse(JSON.stringify(sourceJob.job.envelope));

    const replay = await postJson(
      `${server.baseUrl}/api/runs/${runId}/nodes/${encodeURIComponent(nodeRunId)}/recovery-replays`,
      {},
      { "idempotency-key": "oc02-replay-key" },
    );
    assert.equal(replay.status, 201);
    assert.equal(replay.body.source_job_id, sourceJob.job_id);
    assert.equal(replay.body.status, "dispatching");
    assert.equal("frozen_job" in replay.body, false);

    const replayJobs = listRuntimeJobRecords(runId).filter((job) => job.execution_kind === "failure_replay");
    assert.equal(replayJobs.length, 1);
    assert.notEqual(replayJobs[0]!.job_id, sourceJob.job_id);
    assert.equal(replayJobs[0]!.source_job_id, sourceJob.job_id);
    assert.equal(replayJobs[0]!.identity_digest, replay.body.identity_digest);
    assert.deepEqual(replayJobs[0]!.job.envelope.input_payload, sourceEnvelope.input_payload);
    assert.equal(replayJobs[0]!.job.envelope.runtime_agent_ref, sourceEnvelope.runtime_agent_ref);
    assert.deepEqual(replayJobs[0]!.job.envelope.allowed_tools, sourceEnvelope.allowed_tools);

    const duplicate = await postJson(
      `${server.baseUrl}/api/runs/${runId}/nodes/${encodeURIComponent(nodeRunId)}/recovery-replays`,
      {},
      { "idempotency-key": "oc02-replay-key" },
    );
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.replay_id, replay.body.replay_id);
    assert.equal(listExecutionReplays(runId).length, 1);
    assert.equal(listRuntimeJobRecords(runId).filter((job) => job.execution_kind === "failure_replay").length, 1);

    const recovery = await getJson(`${server.baseUrl}/api/runs/${runId}/recovery`);
    assert.equal(recovery.status, 200);
    assert.equal(recovery.body.summary.execution_replays, 1);
    assert.equal(recovery.body.posture, "recovering");
  } finally {
    await server.close();
  }
});

class PassiveDispatcher implements RuntimeDispatcher {
  readonly kind = "oc02-test";
  enqueueRun() {}
  notifyRunAction() {}
  notifyNodeAction() {}
  async dispatchJob(job: RuntimeWorkerJob): Promise<RuntimeDispatchResult> {
    return {
      status: "accepted",
      dispatch_id: `test:${job.job_id}`,
      job,
      target_kind: job.provision.target_kind,
      worker_id: null,
      lease_id: null,
      accepted_at: job.created_at,
      compatibility: {
        adapter_kind: this.kind,
        raw_ref: {
          dispatch_id: `test:${job.job_id}`,
          provider_refs: {},
        },
      },
    };
  }
  async handleWorkerEvent(_event: WorkerEvent) {}
  async handleReport(_report: NormalizedExecutionReport) {}
}

test("OC-02 timeout compensation retains capacity on cleanup failure and resumes idempotently", async () => {
  resetTestRoot();
  const templateId = "oc02-timeout-compensation";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({
    executionAdapter: adapter,
    dispatcher: new ExecutionAdapterRuntimeDispatcher(adapter),
  });
  let runId = "";
  try {
    runId = await createRunningRun(server.baseUrl, templateId);
  } finally {
    await server.close();
  }
  const job = listRuntimeJobRecords(runId).at(-1)!;
  job.status = "running";
  job.accepted_at = "2026-07-11T00:00:00.000Z";
  job.created_at = "2026-07-11T00:00:00.000Z";
  job.job.created_at = job.created_at;
  job.job.envelope.timeout_seconds = 1;
  job.worker_id = "worker-oc02";
  job.lease_id = "lease-oc02";
  saveRuntimeJobRecord(job);
  saveWorkerLeaseRecord({
    lease_id: "lease-oc02",
    worker_id: "worker-oc02",
    job_id: job.job_id,
    target_kind: "docker-worker",
    run_id: runId,
    node_run_id: job.node_run_id,
    container_id: "container-oc02",
    execution_ref: null,
    acquired_at: job.created_at,
    last_heartbeat_at: job.created_at,
    expires_at: "2026-07-11T00:00:01.000Z",
    released_at: null,
    release_reason: null,
    status: "active",
    last_error: null,
    metadata: { capacity_state: "active" },
  });

  const engine = new RuntimeEngine({ dispatcher: new PassiveDispatcher() });
  const failed = await scanRuntimeTimeouts({
    engine,
    provisioner: {
      kind: "failing-cleanup",
      async provisionWorker() { throw new Error("not used"); },
      async releaseWorker() { throw new Error("docker unavailable"); },
    },
    runId,
    now: () => "2026-07-11T00:00:05.000Z",
  });
  assert.equal(failed.detected, 1);
  assert.equal(failed.failed, 1);
  assert.equal(failed.records[0]!.capacity_released, false);
  assert.equal(failed.records[0]!.status, "cleanup_failed");

  const recovered = await scanRuntimeTimeouts({
    engine,
    provisioner: {
      kind: "successful-cleanup",
      async provisionWorker() { throw new Error("not used"); },
      async releaseWorker(lease) {
        return {
          status: "succeeded" as const,
          lease_id: lease.lease_id,
          run_id: lease.run_id,
          node_run_id: lease.node_run_id,
          worker_id: lease.worker_id,
          attempt_id: `cleanup:${lease.lease_id}:2`,
          attempt: 2,
          reason: "timeout_compensation",
          container_ref: lease.container_id,
          resource_found: true,
          capacity_released: true,
          started_at: "2026-07-11T00:00:06.000Z",
          completed_at: "2026-07-11T00:00:07.000Z",
          error: null,
        };
      },
    },
    runId,
    now: () => "2026-07-11T00:00:07.000Z",
  });
  assert.equal(recovered.completed, 1);
  assert.equal(recovered.records[0]!.capacity_released, true);
  assert.equal(recovered.records[0]!.cleanup_attempt_ids.length, 1);
  assert.equal(listRuntimeCompensations(runId).length, 1);
  assert.equal(listRuntimeCompensations(runId)[0]!.status, "completed");
});
