import assert from "node:assert/strict";
import test from "node:test";
import { saveArtifact } from "../src/artifact-store.js";
import { appendRunEvent, listRunEvents } from "../src/event-store.js";
import { listNodeRuns, saveNodeRuns } from "../src/node-run-store.js";
import { getRunPlan, saveRunPlan } from "../src/run-plan-store.js";
import { getRun, saveRun } from "../src/run-store.js";
import { saveWorkerEvidence } from "../src/runtime/worker-evidence-store.js";
import { validateWorkflowTemplate } from "../src/validators.js";
import {
  registerEvaluatorProvider,
  unregisterEvaluatorProvider,
  type EvaluatorProvider,
} from "../src/evaluation/evaluator-registry.js";
import { buildEvaluationEvidenceView } from "../src/evaluation/evaluator-view.js";
import { recoverPendingEvaluations } from "../src/evaluation/evaluation-engine.js";
import { saveEvaluation } from "../src/evaluation/evaluation-store.js";
import type { EvaluationResult } from "../src/evaluation/types.js";
import { EVALUATION_MAX_ATTEMPTS } from "../src/config.js";
import { getOrCreateRunEvidenceSnapshot } from "../src/evaluation/run-evidence-snapshot.js";
import type { ScorecardCheckDefinition } from "../src/types.js";
import {
  buildPublishedTemplate,
  createStubExecutionAdapter,
  getJson,
  postJson,
  resetTestRoot,
  seedTemplate,
  startTestServer,
} from "./helpers.js";

function checks(qualityPass = true): ScorecardCheckDefinition[] {
  return [
    {
      id: "report-artifact",
      type: "artifact_contract",
      artifact_type: "report",
      mime_type: "text/plain",
      min_count: 1,
      require_resolvable_uri: true,
    },
    {
      id: "run-completed-contract",
      type: "deterministic_assertion",
      subject: "run",
      path: "status",
      operator: "equals",
      expected: "completed",
    },
    {
      id: "summary-quality",
      type: "deterministic_assertion",
      subject: "run",
      path: "current_summary",
      operator: "contains",
      expected: qualityPass ? "Completed" : "Missing phrase",
      quality: true,
    },
  ];
}

async function createTerminalRun(baseUrl: string, input?: {
  checks?: ScorecardCheckDefinition[];
  enforcement?: "off" | "advisory" | "strict";
  artifact?: boolean;
  artifactType?: string;
}) {
  const templateId = `evaluation-template-${Math.random().toString(36).slice(2, 8)}`;
  seedTemplate(buildPublishedTemplate({
    template_id: templateId,
    policy: {
      max_parallel_nodes: 1,
      default_timeout_seconds: 900,
      budget_policy: {},
      approval_policy: {},
      scorecard: {
        profile: "pipeline-v1",
        version: 1,
        enforcement: input?.enforcement || "advisory",
        settle_timeout_seconds: 30,
        checks: input?.checks || checks(),
      },
    },
  }));
  const created = await postJson(`${baseUrl}/api/runs`, {
    intent: "Evaluate independent verdict dimensions",
    template_id: templateId,
    inputs: { goal: "Produce a quality report" },
    validation_mode: "warn",
  });
  assert.equal(created.status, 201);
  const runId = created.body.run_id as string;
  const plan = getRunPlan(runId)!;
  const nodeRuns = listNodeRuns(runId);
  const node = nodeRuns[0]!;
  node.status = "completed";
  node.attempt = 1;
  node.progress = { percent: 100, message: "Completed evaluation task", updated_at: "2026-07-10T05:00:02.000Z" };
  node.started_at = "2026-07-10T05:00:01.000Z";
  node.finished_at = "2026-07-10T05:00:02.000Z";
  saveNodeRuns(runId, nodeRuns);
  plan.compiled_nodes[0]!.status = "completed";
  plan.status = "completed";
  saveRunPlan(plan);
  const run = getRun(runId)!;
  run.status = "completed";
  run.current_summary = "Completed quality report";
  run.started_at = "2026-07-10T05:00:01.000Z";
  run.finished_at = "2026-07-10T05:00:02.000Z";
  run.updated_at = run.finished_at;
  saveRun(run);
  appendRunEvent({ run_id: runId, node_run_id: node.node_run_id, type: "node.started", actor_type: "system", actor_id: "evaluation-test", created_at: "2026-07-10T05:00:01.000Z" });
  appendRunEvent({ run_id: runId, node_run_id: node.node_run_id, type: "node.completed", actor_type: "system", actor_id: "evaluation-test", created_at: "2026-07-10T05:00:02.000Z" });
  appendRunEvent({ run_id: runId, type: "run.completed", actor_type: "system", actor_id: "evaluation-test", created_at: "2026-07-10T05:00:02.000Z" });
  if (input?.artifact !== false) {
    saveArtifact({
      artifact_id: `artifact-${runId}`,
      run_id: runId,
      node_run_id: node.node_run_id,
      type: input?.artifactType || "report",
      name: "quality-report.txt",
      storage_uri: `workspace://artifacts/${runId}/quality-report.txt`,
      mime_type: "text/plain",
      size_bytes: 64,
      created_at: "2026-07-10T05:00:02.000Z",
    });
  }
  return runId;
}

async function waitForEvaluation(baseUrl: string, runId: string, evaluationId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await getJson(`${baseUrl}/api/runs/${runId}/evaluations/${encodeURIComponent(evaluationId)}`);
    if (!["queued", "running"].includes(String(response.body.status))) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Evaluation did not reach a terminal state.");
}

test("declarative scorecard keeps pipeline and contract verdicts independent", async () => {
  resetTestRoot();
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const passRun = await createTerminalRun(server.baseUrl, { enforcement: "strict" });
    const passed = await postJson(`${server.baseUrl}/api/runs/${passRun}/scorecards`, {});
    assert.equal(passed.body.pipeline_verdict, "pass");
    assert.equal(passed.body.contract_verdict, "pass");
    assert.equal(passed.body.gate_verdict, "pass");
    assert.equal(passed.body.total_checks, 16);

    const failRun = await createTerminalRun(server.baseUrl, { enforcement: "strict", artifactType: "summary" });
    const failed = await postJson(`${server.baseUrl}/api/runs/${failRun}/scorecards`, {});
    assert.equal(failed.body.pipeline_verdict, "pass");
    assert.equal(failed.body.contract_verdict, "fail");
    assert.equal(failed.body.gate_verdict, "reject");
    assert.ok(failed.body.findings.some((finding: { check_id: string }) => finding.check_id === "contract.report-artifact"));
  } finally {
    await server.close();
  }
});

test("declarative policy schema rejects executable or unknown check types", () => {
  const template = buildPublishedTemplate({
    policy: {
      max_parallel_nodes: 1,
      default_timeout_seconds: 900,
      budget_policy: {},
      approval_policy: {},
      scorecard: {
        profile: "pipeline-v1",
        version: 1,
        enforcement: "strict",
        settle_timeout_seconds: 30,
        checks: [{ id: "unsafe", type: "custom_script", script: "return true" }],
      },
    },
  });
  assert.equal(validateWorkflowTemplate(template), false);
  const scriptedKnownCheck = buildPublishedTemplate({
    policy: {
      max_parallel_nodes: 1,
      default_timeout_seconds: 900,
      budget_policy: {},
      approval_policy: {},
      scorecard: {
        profile: "pipeline-v1",
        version: 1,
        enforcement: "strict",
        settle_timeout_seconds: 30,
        checks: [{ id: "unsafe-known", type: "required_evidence", kinds: ["model_text"], script: "return true" }],
      },
    },
  });
  assert.equal(validateWorkflowTemplate(scriptedKnownCheck), false);
});

test("none and deterministic evaluators preserve explicit quality semantics", async () => {
  resetTestRoot();
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const runId = await createTerminalRun(server.baseUrl);
    const none = await postJson(`${server.baseUrl}/api/runs/${runId}/evaluations`, { evaluator: "none" });
    assert.equal(none.status, 201);
    assert.equal(none.body.pipeline_verdict, "pass");
    assert.equal(none.body.contract_verdict, "pass");
    assert.equal(none.body.quality_verdict, "not_evaluated");
    assert.equal(none.body.status, "completed");

    const deterministic = await postJson(`${server.baseUrl}/api/runs/${runId}/evaluations`, { evaluator: "deterministic-v1" });
    assert.equal(deterministic.body.quality_verdict, "pass");
    assert.ok(deterministic.body.findings.some((finding: { check_id: string }) => finding.check_id === "quality.summary-quality"));

    const duplicate = await postJson(`${server.baseUrl}/api/runs/${runId}/evaluations`, { evaluator: "none" });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.evaluation_id, none.body.evaluation_id);
    assert.equal(listRunEvents(runId).filter((event) => event.type === "evaluation.completed").length, 2);
  } finally {
    await server.close();
  }
});

test("model evaluator runs asynchronously and persists structured output", async () => {
  resetTestRoot();
  const fake: EvaluatorProvider = {
    descriptor: () => ({ id: "model-test", kind: "model", version: "fixture-v1", provider: "fixture", model: "judge-test", prompt_version: "fixture-prompt" }),
    async evaluate() {
      attempts += 1;
      return {
        quality_verdict: "pass",
        findings: [{
          check_id: "quality.fixture",
          dimension: "quality",
          severity: "info",
          passed: true,
          summary: "Fixture judge accepted the output.",
          detail: "Recorded structured result.",
          evidence_refs: [],
        }],
        usage: {
          availability: "available",
          input_tokens: 20,
          output_tokens: 5,
          cache_read_tokens: null,
          cache_write_tokens: null,
          reasoning_tokens: null,
          total_tokens: 25,
          duration_ms: null,
          turn_count: 1,
          provider_reported_cost: null,
          estimated_cost: null,
        },
      };
    },
  };
  let attempts = 0;
  registerEvaluatorProvider(fake);
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const runId = await createTerminalRun(server.baseUrl);
    const queued = await postJson(`${server.baseUrl}/api/runs/${runId}/evaluations`, { evaluator: "model-test" });
    assert.equal(queued.status, 202);
    assert.equal(queued.body.status, "queued");
    const completed = await waitForEvaluation(server.baseUrl, runId, queued.body.evaluation_id as string);
    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.quality_verdict, "pass");
    assert.equal(completed.body.evaluator_usage.total_tokens, 25);
    const stale = {
      ...(completed.body as EvaluationResult),
      status: "running" as const,
      quality_verdict: "not_evaluated" as const,
      attempt: 1,
      started_at: "2026-07-10T00:00:00.000Z",
      completed_at: null,
    };
    saveEvaluation(stale);
    const recovery = recoverPendingEvaluations(Date.parse("2026-07-10T00:02:00.000Z"));
    assert.equal(recovery.recovered, 1);
    const recovered = await waitForEvaluation(server.baseUrl, runId, stale.evaluation_id);
    assert.equal(recovered.body.status, "completed");
    assert.equal(attempts, 2);
  } finally {
    unregisterEvaluatorProvider("model-test");
    await server.close();
  }
});

test("model evaluator provider failures become quality error after retry budget", async () => {
  resetTestRoot();
  let attempts = 0;
  registerEvaluatorProvider({
    descriptor: () => ({ id: "model-failure", kind: "model", version: "fixture-v1", provider: "fixture", model: "judge-failure", prompt_version: "fixture-prompt" }),
    async evaluate() {
      attempts += 1;
      throw new Error("recorded judge failure");
    },
  });
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const runId = await createTerminalRun(server.baseUrl);
    const queued = await postJson(`${server.baseUrl}/api/runs/${runId}/evaluations`, { evaluator: "model-failure" });
    const failed = await waitForEvaluation(server.baseUrl, runId, queued.body.evaluation_id as string);
    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.quality_verdict, "error");
    assert.equal(attempts, EVALUATION_MAX_ATTEMPTS);
    assert.match(String(failed.body.error), /recorded judge failure/);
  } finally {
    unregisterEvaluatorProvider("model-failure");
    await server.close();
  }
});

test("evaluation evidence view excludes raw inline provider payloads", async () => {
  resetTestRoot();
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const runId = await createTerminalRun(server.baseUrl);
    const nodeRunId = listNodeRuns(runId)[0]!.node_run_id;
    saveWorkerEvidence({
      evidence_schema_version: 2,
      evidence_id: "evaluation-view-evidence",
      run_id: runId,
      node_run_id: nodeRunId,
      job_id: "evaluation-view-job",
      worker_id: "evaluation-view-worker",
      sequence: 1,
      kind: "model_text",
      source: { provider: "fixture", model: "fixture-model", native_event_id: "evaluation-view-native", synthetic: false },
      trace: { trace_id: `trace:${runId}`, span_id: "span:view", parent_span_id: null, tool_call_id: null },
      summary: "Safe summary",
      input_ref: null,
      output_ref: null,
      storage_uri: null,
      inline_payload: { private_context: "judge-should-not-see" },
      usage: null,
      redaction_status: "not_required",
      created_at: "2026-07-10T05:00:02.000Z",
    });
    const snapshot = getOrCreateRunEvidenceSnapshot(runId);
    const view = buildEvaluationEvidenceView(snapshot);
    assert.equal("inline_payload" in view.evidence[0]!, false);
    assert.doesNotMatch(JSON.stringify(view), /judge-should-not-see|api_key|authorization/i);
  } finally {
    await server.close();
  }
});
