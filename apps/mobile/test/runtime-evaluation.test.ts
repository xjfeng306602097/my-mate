import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRuntimeNodeEvidence,
  buildRuntimeTopology,
  latestRuntimeEvaluationBundle,
  upsertRuntimeRecord,
} from "../lib/runtime-evaluation";
import type {
  EvaluationResult,
  ReplayResult,
  RuntimeGraphNode,
  RuntimeGraphSummary,
  RuntimeRunProjection,
  ScorecardResult,
  TraceProjection,
} from "../lib/types";

const now = "2026-07-10T08:00:00.000Z";

function node(id: string, workPackageKey: string, workPackageLabel: string): RuntimeGraphNode {
  return {
    nodeRunId: `node-run-${id}`,
    nodeId: id,
    name: id.toUpperCase(),
    type: "task",
    status: "completed",
    progress: { percent: 100, message: `${id} complete`, updated_at: now },
    attempt: 1,
    startedAt: now,
    finishedAt: now,
    agentProfile: "operator",
    runtimeAgentRef: "runtime-agent",
    openclawAgentId: null,
    approvalKind: null,
    humanInputRequired: false,
    expectedArtifacts: [],
    workPackageKey,
    workPackageLabel,
    markers: ["terminal"],
  };
}

function graph(): RuntimeGraphSummary {
  const nodes = [
    node("plan", "planning", "Planning"),
    node("research", "discovery", "Discovery"),
    node("build", "implementation", "Implementation"),
    node("integrate", "implementation", "Implementation"),
  ];
  return {
    runId: "run-1",
    templateId: "template-1",
    templateVersion: 1,
    runStatus: "completed",
    intent: "test topology",
    generatedAt: now,
    nodes,
    edges: [
      { fromNodeId: "plan", toNodeId: "research", fromNodeRunId: "node-run-plan", toNodeRunId: "node-run-research", label: null, condition: null, status: "satisfied" },
      { fromNodeId: "plan", toNodeId: "build", fromNodeRunId: "node-run-plan", toNodeRunId: "node-run-build", label: null, condition: null, status: "satisfied" },
      { fromNodeId: "research", toNodeId: "integrate", fromNodeRunId: "node-run-research", toNodeRunId: "node-run-integrate", label: null, condition: null, status: "satisfied" },
      { fromNodeId: "build", toNodeId: "integrate", fromNodeRunId: "node-run-build", toNodeRunId: "node-run-integrate", label: null, condition: null, status: "satisfied" },
    ],
    frontier: [],
    statusCounts: { pending: 0, ready: 0, running: 0, waiting_human: 0, completed: 4, failed: 0, skipped: 0, cancelled: 0 },
    markers: { activeFrontier: [], waitingHuman: [], blocked: [], skipped: [] },
    workPackages: [],
    summaryLines: [],
  };
}

test("runtime topology groups Kahn depth by work package and marks branch/merge", () => {
  const stages = buildRuntimeTopology(graph());
  assert.equal(stages.length, 3);
  assert.deepEqual(stages.map((stage) => stage.nodeCount), [1, 2, 1]);
  assert.equal(stages[0]?.branchCount, 1);
  assert.equal(stages[1]?.groups.length, 2);
  assert.equal(stages[2]?.convergenceCount, 1);
  assert.equal(stages[2]?.groups[0]?.nodes[0]?.incomingCount, 2);
});

test("runtime topology keeps cyclic nodes visible with deterministic fallback depth", () => {
  const cyclic = graph();
  cyclic.nodes = cyclic.nodes.slice(0, 2);
  cyclic.edges = [
    { fromNodeId: "plan", toNodeId: "research", fromNodeRunId: "node-run-plan", toNodeRunId: "node-run-research", label: null, condition: null, status: "active" },
    { fromNodeId: "research", toNodeId: "plan", fromNodeRunId: "node-run-research", toNodeRunId: "node-run-plan", label: null, condition: null, status: "active" },
  ];
  const stages = buildRuntimeTopology(cyclic);
  assert.equal(stages.reduce((total, stage) => total + stage.nodeCount, 0), 2);
  assert.deepEqual(stages.flatMap((stage) => stage.groups.flatMap((group) => group.nodes.map((item) => item.node.nodeId))), ["plan", "research"]);
});

test("node evidence exposes attempts, prompt, native tools, usage, errors and trace", () => {
  const runtimeGraph = graph();
  const projection = {
    projection_version: 2,
    generated_at: now,
    run_id: "run-1",
    graph: runtimeGraph,
    jobs: [
      { job_id: "job-2", run_id: "run-1", node_run_id: "node-run-build", attempt: 2, dispatch_sequence: 2, status: "completed", worker_id: "worker-1", lease_id: "lease-1", target_kind: "docker-worker", agent_runtime: "codex", runtime_agent_ref: "runtime-agent", created_at: now, accepted_at: now, finished_at: now, last_event_id: "event-2", last_error: null, compatibility: { adapter_kind: null, dispatch_id: null, openclaw_task_id: null, openclaw_session_id: null }, job: {} },
      { job_id: "job-1", run_id: "run-1", node_run_id: "node-run-build", attempt: 1, dispatch_sequence: 1, status: "failed", worker_id: "worker-1", lease_id: "lease-1", target_kind: "docker-worker", agent_runtime: "codex", runtime_agent_ref: "runtime-agent", created_at: now, accepted_at: now, finished_at: now, last_event_id: "event-1", last_error: "Provider timeout", compatibility: { adapter_kind: null, dispatch_id: null, openclaw_task_id: null, openclaw_session_id: null }, job: {} },
    ],
    leases: [],
    workers: [],
    evidence: [
      { evidence_schema_version: 2, evidence_id: "prompt-1", run_id: "run-1", node_run_id: "node-run-build", job_id: "job-2", worker_id: "worker-1", kind: "prompt", source: { provider: "openai", model: "gpt-test", native_event_id: "native-1", synthetic: false }, trace: { trace_id: "trace-1", span_id: "span-prompt", parent_span_id: null, tool_call_id: null }, summary: "Provider prompt", storage_uri: null, inline_payload: { objective: "Build" }, redaction_status: "not_required", created_at: now },
      { evidence_schema_version: 2, evidence_id: "tool-1", run_id: "run-1", node_run_id: "node-run-build", job_id: "job-2", worker_id: "worker-1", kind: "tool_call", trace: { trace_id: "trace-1", span_id: "span-tool", parent_span_id: null, tool_call_id: "call-1" }, summary: "Run tests", storage_uri: null, inline_payload: null, redaction_status: "not_required", created_at: now },
      { evidence_schema_version: 2, evidence_id: "usage-1", run_id: "run-1", node_run_id: "node-run-build", job_id: "job-2", worker_id: "worker-1", kind: "usage", summary: "Usage", storage_uri: null, inline_payload: null, usage: { availability: "available", input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 2, total_tokens: 17, duration_ms: 900, turn_count: 1, provider_reported_cost: { currency: "USD", amount_decimal: "0.01" }, estimated_cost: null }, redaction_status: "not_required", created_at: now },
      { evidence_schema_version: 2, evidence_id: "error-1", run_id: "run-1", node_run_id: "node-run-build", job_id: "job-1", worker_id: "worker-1", kind: "error", summary: "Attempt failed", storage_uri: null, inline_payload: null, redaction_status: "not_required", created_at: now },
    ],
    handoffs: [{ type: "node_handoff", handoff_id: "handoff-1", job_id: "job-2", run_id: "run-1", node_run_id: "node-run-build", node_id: "build", port: "result", content: {}, summary: "Build complete", routed_node_run_ids: ["node-run-integrate"], skipped_node_run_ids: [], created_at: now }],
    artifacts: [{ artifact_id: "artifact-1", run_id: "run-1", node_run_id: "node-run-build", type: "file", name: "result.json", storage_uri: "workspace://result.json", mime_type: "application/json", size_bytes: 10, created_at: now }],
    event_delivery: { tracked_jobs: 2, ignored_events: 0, cursors: [] },
    summary: { active_jobs: 0, connected_workers: 0, active_leases: 0, evidence_items: 4, handoffs: 1, artifacts: 1 },
  } satisfies RuntimeRunProjection;
  const trace = {
    schema_version: 1,
    run_id: "run-1",
    trace_id: "trace-1",
    completeness: "complete",
    spans: [{ span_id: "span-tool", parent_span_id: null, trace_id: "trace-1", run_id: "run-1", node_run_id: "node-run-build", job_id: "job-2", kind: "tool", name: "Run tests", status: "ok", started_at: now, finished_at: now, input_ref: null, output_ref: null, tool_call_id: "call-1", provider: "openai", model: "gpt-test", usage: null, attributes: {} }],
    cursor: null,
    has_more: false,
  } satisfies TraceProjection;

  const detail = buildRuntimeNodeEvidence(runtimeGraph, projection, trace, "node-run-build");
  assert.deepEqual(detail?.jobs.map((job) => job.attempt), [1, 2]);
  assert.equal(detail?.prompts.length, 1);
  assert.equal(detail?.toolEvents[0]?.trace?.tool_call_id, "call-1");
  assert.equal(detail?.usageEvents[0]?.usage?.total_tokens, 17);
  assert.deepEqual(detail?.errors.map((item) => item.summary), ["Provider timeout", "Attempt failed"]);
  assert.equal(detail?.handoffs.length, 1);
  assert.equal(detail?.artifacts.length, 1);
  assert.equal(detail?.traceSpans.length, 1);
});

test("evaluation bundle and upsert retain the newest record", () => {
  const olderScorecard = { scorecard_id: "score-0", created_at: "2026-07-10T07:00:00.000Z" } as ScorecardResult;
  const scorecard = { scorecard_id: "score-1", created_at: "2026-07-10T08:00:00.000Z" } as ScorecardResult;
  const olderEvaluation = { evaluation_id: "eval-0", created_at: "2026-07-10T07:00:00.000Z" } as EvaluationResult;
  const evaluation = { evaluation_id: "eval-1", created_at: "2026-07-10T08:00:00.000Z" } as EvaluationResult;
  const replay = { replay_id: "replay-1" } as ReplayResult;
  assert.deepEqual(latestRuntimeEvaluationBundle({ scorecards: [scorecard, olderScorecard], evaluations: [evaluation, olderEvaluation], replay }), { scorecard, evaluation, replay });
  assert.deepEqual(upsertRuntimeRecord([{ scorecard_id: "score-1", value: 1 }], { scorecard_id: "score-1", value: 2 }, "scorecard_id"), [{ scorecard_id: "score-1", value: 2 }]);
});
