import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { RUN_PLAN_INITIAL_DIR, RUNS_DIR } from "../src/config.js";
import { appendRunEvent } from "../src/event-store.js";
import { listNodeRuns, saveNodeRuns } from "../src/node-run-store.js";
import { getRunPlan, saveRunPlan } from "../src/run-plan-store.js";
import { getRun, saveRun } from "../src/run-store.js";
import { buildRuntimeWorkerJob } from "../src/runtime-protocol.js";
import {
  createRuntimeJobRecord,
  saveRuntimeJobRecord,
} from "../src/runtime/runtime-job-store.js";
import { saveWorkerEvidence } from "../src/runtime/worker-evidence-store.js";
import {
  createInitialReplayRuntimeState,
  reduceRuntimeState,
} from "../src/evaluation/runtime-state-reducer.js";
import type { DispatchEnvelope, EventRecord } from "../src/types.js";
import {
  buildPublishedTemplate,
  createStubExecutionAdapter,
  getJson,
  postJson,
  resetTestRoot,
  seedTemplate,
  startTestServer,
} from "./helpers.js";

async function createTerminalRun(baseUrl: string, templateId: string): Promise<string> {
  const created = await postJson(`${baseUrl}/api/runs`, {
    intent: "Trace and replay a deterministic run",
    template_id: templateId,
    inputs: { goal: "verify replay" },
    validation_mode: "warn",
  });
  assert.equal(created.status, 201);
  const runId = created.body.run_id as string;
  const plan = getRunPlan(runId)!;
  const nodeRuns = listNodeRuns(runId);
  const nodeRun = nodeRuns[0]!;
  const startedAt = "2026-07-10T10:00:01.000Z";
  const finishedAt = "2026-07-10T10:00:02.000Z";
  const started = appendRunEvent({
    run_id: runId,
    node_run_id: nodeRun.node_run_id,
    type: "node.started",
    actor_type: "system",
    actor_id: "trace-replay-test",
    payload: { node_id: plan.compiled_nodes[0]!.node_id },
    created_at: startedAt,
  });
  appendRunEvent({
    run_id: runId,
    node_run_id: nodeRun.node_run_id,
    type: "node.completed",
    actor_type: "system",
    actor_id: "trace-replay-test",
    payload: { node_id: plan.compiled_nodes[0]!.node_id },
    created_at: finishedAt,
    causation_id: started.event_id,
  });
  const completed = appendRunEvent({
    run_id: runId,
    type: "run.completed",
    actor_type: "system",
    actor_id: "trace-replay-test",
    payload: { completed_nodes: 1 },
    created_at: finishedAt,
  });
  nodeRun.status = "completed";
  nodeRun.attempt = 1;
  nodeRun.progress = { percent: 100, message: "Completed", updated_at: finishedAt };
  nodeRun.started_at = startedAt;
  nodeRun.finished_at = finishedAt;
  saveNodeRuns(runId, nodeRuns);
  plan.compiled_nodes[0]!.status = "completed";
  plan.compiled_nodes[0]!.retry_policy.attempt = 1;
  plan.frontier = [];
  plan.status = "completed";
  saveRunPlan(plan);
  const run = getRun(runId)!;
  run.status = "completed";
  run.current_summary = "Run completed";
  run.started_at = startedAt;
  run.finished_at = finishedAt;
  run.updated_at = finishedAt;
  run.last_event_id = completed.event_id;
  saveRun(run);
  return runId;
}

test("trace and replay verify a complete V2 run and persist deterministic results", async () => {
  resetTestRoot();
  const templateId = "trace-replay-complete";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const runId = await createTerminalRun(server.baseUrl, templateId);
    const trace = await getJson(`${server.baseUrl}/api/runs/${runId}/trace`);
    assert.equal(trace.status, 200);
    assert.equal(trace.body.completeness, "complete");
    assert.deepEqual(trace.body.spans.map((span: { kind: string }) => span.kind), ["run", "node"]);

    const replay = await postJson(`${server.baseUrl}/api/runs/${runId}/replays`, {});
    assert.equal(replay.status, 201);
    assert.equal(replay.body.verification, "pass");
    assert.equal(replay.body.event_completeness, "complete");
    assert.equal(replay.body.projection_differences.length, 0);
    assert.equal(replay.body.missing_references.length, 0);
    const duplicate = await postJson(`${server.baseUrl}/api/runs/${runId}/replays`, {});
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.replay_id, replay.body.replay_id);

    const plan = await postJson(`${server.baseUrl}/api/runs/${runId}/replay-plans`, {});
    assert.equal(plan.status, 201);
    assert.equal(plan.body.replay_id, replay.body.replay_id);
    assert.equal(plan.body.recommendations.length, 0);
  } finally {
    await server.close();
  }
});

test("replay reports legacy partial and detects persisted projection drift", async () => {
  resetTestRoot();
  const templateId = "trace-replay-partial";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const partialRunId = await createTerminalRun(server.baseUrl, templateId);
    fs.rmSync(path.join(RUN_PLAN_INITIAL_DIR, `${encodeURIComponent(partialRunId)}.json`));
    const partial = await postJson(`${server.baseUrl}/api/runs/${partialRunId}/replays`, {});
    assert.equal(partial.body.event_completeness, "legacy_partial");
    assert.equal(partial.body.verification, "partial");

    const driftRunId = await createTerminalRun(server.baseUrl, templateId);
    const drifted = getRun(driftRunId)!;
    drifted.status = "failed";
    drifted.current_summary = "Projection drift injected by test";
    // Bypass the guarded store deliberately: this test verifies replay detection of on-disk corruption.
    fs.writeFileSync(path.join(RUNS_DIR, `${driftRunId}.json`), `${JSON.stringify(drifted, null, 2)}\n`, "utf8");
    const failed = await postJson(`${server.baseUrl}/api/runs/${driftRunId}/replays`, {});
    assert.equal(failed.body.event_completeness, "complete");
    assert.equal(failed.body.verification, "fail");
    assert.ok(failed.body.projection_differences.some(
      (item: { category: string; field: string }) => item.category === "run" && item.field === "status",
    ));
  } finally {
    await server.close();
  }
});

test("rerun preserves frozen route lineage and is idempotent", async () => {
  resetTestRoot();
  const templateId = "trace-replay-rerun";
  seedTemplate(buildPublishedTemplate({ template_id: templateId, version: 4 }));
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const sourceRunId = await createTerminalRun(server.baseUrl, templateId);
    const headers = { "idempotency-key": "rerun-once" };
    const first = await postJson(`${server.baseUrl}/api/runs/${sourceRunId}/reruns`, {
      reason: "Retry with reviewed input",
      input_overrides: { goal: "reviewed replay" },
    }, headers);
    assert.equal(first.status, 201);
    assert.equal(first.body.source_run_id, sourceRunId);
    assert.equal(first.body.route.source_kind, "rerun");
    assert.equal(first.body.route.route_id, `template:${templateId}@4`);
    const second = await postJson(`${server.baseUrl}/api/runs/${sourceRunId}/reruns`, {
      reason: "Retry with reviewed input",
      input_overrides: { goal: "reviewed replay" },
    }, headers);
    assert.equal(second.status, 200);
    assert.equal(second.body.run_id, first.body.run_id);
    const conflict = await postJson(`${server.baseUrl}/api/runs/${sourceRunId}/reruns`, {
      reason: "Retry with different input",
      input_overrides: { goal: "different replay" },
    }, headers);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "idempotency_key_conflict");
    const rerunPlan = getRunPlan(first.body.run_id as string)!;
    assert.equal(rerunPlan.inputs.goal, "reviewed replay");
    assert.equal(rerunPlan.planner_context.rerun_mode, "frozen_effective_plan");
    const replay = await postJson(`${server.baseUrl}/api/runs/${first.body.run_id}/replays`, {});
    assert.equal(replay.body.verification, "pass");
  } finally {
    await server.close();
  }
});

test("trace pairs provider-native tool calls and results under the model span", async () => {
  resetTestRoot();
  const templateId = "trace-tool-correlation";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const runId = await createTerminalRun(server.baseUrl, templateId);
    const run = getRun(runId)!;
    const plan = getRunPlan(runId)!;
    const node = plan.compiled_nodes[0]!;
    const envelope: DispatchEnvelope = {
      run_id: runId,
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
      runtime_agent_ref: node.runtime_agent_ref,
      agent_runtime: "codex",
      harness_profile: node.harness_profile || null,
      allowed_skills: node.allowed_skills,
      allowed_tools: node.allowed_tools,
      registry_provenance: node.registry_provenance,
      timeout_seconds: node.timeout_seconds,
      parallelism_budget: node.parallelism_budget,
      retry_policy: { max_attempts: 1, attempt: 1 },
      input_payload: node.input_payload,
      output_contract: node.output_contract,
      trace_context: { run_id: runId, node_run_id: node.node_run_id, requested_by: run.requested_by },
    };
    const job = buildRuntimeWorkerJob(envelope, {
      jobId: "trace-tool-job",
      createdAt: "2026-07-10T10:00:01.000Z",
      targetKind: "local",
    });
    const jobRecord = createRuntimeJobRecord({ job, status: "completed" });
    jobRecord.finished_at = "2026-07-10T10:00:02.000Z";
    saveRuntimeJobRecord(jobRecord);
    for (const [sequence, kind, spanId, createdAt] of [
      [1, "tool_call", "span-call", "2026-07-10T10:00:01.200Z"],
      [2, "tool_result", "span-result", "2026-07-10T10:00:01.400Z"],
    ] as const) {
      saveWorkerEvidence({
        evidence_schema_version: 2,
        evidence_id: `trace-tool-${sequence}`,
        run_id: runId,
        node_run_id: node.node_run_id,
        job_id: job.job_id,
        worker_id: "trace-tool-worker",
        sequence,
        kind,
        source: { provider: "codex", model: "gpt-test", native_event_id: `native-${sequence}`, synthetic: false },
        trace: { trace_id: `trace:${runId}`, span_id: spanId, parent_span_id: `job:${job.job_id}`, tool_call_id: "call-1" },
        summary: kind === "tool_call" ? "Read file" : "Read file completed",
        input_ref: kind === "tool_call" ? "input:call-1" : null,
        output_ref: kind === "tool_result" ? "output:call-1" : null,
        storage_uri: null,
        inline_payload: null,
        usage: null,
        redaction_status: "not_required",
        created_at: createdAt,
      });
    }
    const trace = await getJson(`${server.baseUrl}/api/runs/${runId}/trace?kind=tool`);
    assert.equal(trace.body.spans.length, 1);
    assert.equal(trace.body.spans[0].tool_call_id, "call-1");
    assert.equal(trace.body.spans[0].status, "ok");
    assert.equal(trace.body.spans[0].parent_span_id, `model:${job.job_id}`);
  } finally {
    await server.close();
  }
});

test("pure replay reducer handles retry followed by worker cancellation", async () => {
  resetTestRoot();
  const templateId = "trace-reducer-lifecycle";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const created = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Exercise reducer lifecycle",
      template_id: templateId,
      inputs: { goal: "reduce" },
      validation_mode: "warn",
    });
    const runId = created.body.run_id as string;
    const plan = getRunPlan(runId)!;
    const nodeRunId = plan.compiled_nodes[0]!.node_run_id;
    let state = createInitialReplayRuntimeState(runId, plan);
    const events: EventRecord[] = [
      { schema_version: 2, event_id: "r1", run_sequence: 1, run_id: runId, node_run_id: null, type: "run.started", actor_type: "system", actor_id: "test", payload: {}, created_at: "2026-07-10T11:00:00.000Z" },
      { schema_version: 2, event_id: "r2", run_sequence: 2, run_id: runId, node_run_id: nodeRunId, type: "node.started", actor_type: "system", actor_id: "test", payload: {}, created_at: "2026-07-10T11:00:01.000Z" },
      { schema_version: 2, event_id: "r3", run_sequence: 3, run_id: runId, node_run_id: nodeRunId, type: "job.failed", actor_type: "system", actor_id: "test", payload: { job_id: "job-1" }, created_at: "2026-07-10T11:00:02.000Z" },
      { schema_version: 2, event_id: "r4", run_sequence: 4, run_id: runId, node_run_id: nodeRunId, type: "node.ready", actor_type: "system", actor_id: "test", payload: { reason: "retry" }, created_at: "2026-07-10T11:00:03.000Z" },
      { schema_version: 2, event_id: "r5", run_sequence: 5, run_id: runId, node_run_id: nodeRunId, type: "node.started", actor_type: "system", actor_id: "test", payload: {}, created_at: "2026-07-10T11:00:04.000Z" },
      { schema_version: 2, event_id: "r6", run_sequence: 6, run_id: runId, node_run_id: nodeRunId, type: "job.cancelled", actor_type: "system", actor_id: "test", payload: { job_id: "job-2" }, created_at: "2026-07-10T11:00:05.000Z" },
    ];
    for (const event of events) state = reduceRuntimeState(state, event);
    assert.equal(state.run_status, "cancelled");
    assert.equal(state.nodes[nodeRunId]?.status, "cancelled");
    assert.equal(state.nodes[nodeRunId]?.attempt, 2);
    assert.equal(state.jobs["job-1"]?.status, "failed");
    assert.equal(state.jobs["job-2"]?.status, "cancelled");
  } finally {
    await server.close();
  }
});
