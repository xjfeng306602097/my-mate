import { ScrollView, StyleSheet, View } from "react-native";
import { RuntimeTopology } from "@/components/runtime-topology";
import type {
  EvaluationResult,
  ReplayResult,
  RuntimeGraphNode,
  RuntimeGraphSummary,
  RuntimeRunProjection,
  ScorecardResult,
  TraceProjection,
} from "@/lib/types";

const now = "2026-07-10T08:10:00.000Z";

function runtimeNode(
  nodeId: string,
  name: string,
  status: RuntimeGraphNode["status"],
  workPackageKey: string,
  workPackageLabel: string,
  attempt = 1,
): RuntimeGraphNode {
  return {
    nodeRunId: `fixture-node-${nodeId}`,
    nodeId,
    name,
    type: "task",
    status,
    progress: {
      percent: status === "completed" ? 100 : status === "failed" ? 62 : 0,
      message: status === "failed" ? "Provider tool execution failed after retry." : `${name} ${status}.`,
      updated_at: now,
    },
    attempt,
    startedAt: status === "pending" ? null : now,
    finishedAt: ["completed", "failed"].includes(status) ? now : null,
    agentId: "delivery-agent",
    runtimeAgentRef: "codex:fixture",
    approvalKind: null,
    humanInputRequired: false,
    expectedArtifacts: ["result"],
    workPackageKey,
    workPackageLabel,
    markers: status === "failed" ? ["blocked", "terminal"] : status === "completed" ? ["terminal"] : [],
  };
}

const nodes = [
  runtimeNode("prepare", "Prepare execution brief", "completed", "discovery", "Discovery"),
  runtimeNode("research", "Collect provider evidence", "completed", "discovery", "Discovery"),
  runtimeNode("build", "Run provider native tools", "failed", "implementation", "Implementation", 2),
  runtimeNode("integrate", "Integrate branch outputs", "pending", "implementation", "Implementation"),
  runtimeNode("deliver", "Evaluate final delivery", "pending", "validation", "Validation"),
];

const graph: RuntimeGraphSummary = {
  runId: "fixture-run",
  templateId: "fixture-template",
  templateVersion: 2,
  runStatus: "failed",
  intent: "Exercise runtime evaluation UI",
  generatedAt: now,
  nodes,
  edges: [
    { fromNodeId: "prepare", toNodeId: "research", fromNodeRunId: "fixture-node-prepare", toNodeRunId: "fixture-node-research", label: "evidence", condition: null, status: "satisfied" },
    { fromNodeId: "prepare", toNodeId: "build", fromNodeRunId: "fixture-node-prepare", toNodeRunId: "fixture-node-build", label: "execution", condition: null, status: "satisfied" },
    { fromNodeId: "research", toNodeId: "integrate", fromNodeRunId: "fixture-node-research", toNodeRunId: "fixture-node-integrate", label: null, condition: null, status: "active" },
    { fromNodeId: "build", toNodeId: "integrate", fromNodeRunId: "fixture-node-build", toNodeRunId: "fixture-node-integrate", label: null, condition: null, status: "blocked" },
    { fromNodeId: "integrate", toNodeId: "deliver", fromNodeRunId: "fixture-node-integrate", toNodeRunId: "fixture-node-deliver", label: null, condition: null, status: "pending" },
  ],
  frontier: [],
  statusCounts: { pending: 2, ready: 0, running: 0, waiting_human: 0, completed: 2, failed: 1, skipped: 0, cancelled: 0 },
  markers: { activeFrontier: [], waitingHuman: [], blocked: ["fixture-node-build"], skipped: [] },
  workPackages: [],
  summaryLines: ["Provider tool execution blocked integration."],
};

const projection: RuntimeRunProjection = {
  projection_version: 2,
  generated_at: now,
  run_id: "fixture-run",
  graph,
  jobs: [
    { job_id: "job-build-1", run_id: "fixture-run", node_run_id: "fixture-node-build", attempt: 1, dispatch_sequence: 1, status: "failed", worker_id: "worker-fixture", lease_id: "lease-fixture", target_kind: "docker-worker", agent_runtime: "codex", runtime_agent_ref: "codex:fixture", created_at: "2026-07-10T08:05:00.000Z", accepted_at: "2026-07-10T08:05:01.000Z", finished_at: "2026-07-10T08:05:12.000Z", last_event_id: "event-1", last_error: "Provider request timed out after 10 seconds.", compatibility: { adapter_kind: null, dispatch_id: "dispatch-1", provider_refs: {} }, job: {} },
    { job_id: "job-build-2", run_id: "fixture-run", node_run_id: "fixture-node-build", attempt: 2, dispatch_sequence: 2, status: "failed", worker_id: "worker-fixture", lease_id: "lease-fixture", target_kind: "docker-worker", agent_runtime: "codex", runtime_agent_ref: "codex:fixture", created_at: "2026-07-10T08:06:00.000Z", accepted_at: "2026-07-10T08:06:01.000Z", finished_at: "2026-07-10T08:06:18.000Z", last_event_id: "event-2", last_error: "Tool process exited with status 1.", compatibility: { adapter_kind: null, dispatch_id: "dispatch-2", provider_refs: {} }, job: {} },
  ],
  leases: [{ lease_id: "lease-fixture", worker_id: "worker-fixture", job_id: "job-build-2", target_kind: "docker-worker", run_id: "fixture-run", node_run_id: "fixture-node-build", container_id: "container-fixture", status: "released", acquired_at: now, last_heartbeat_at: now, expires_at: null, released_at: now, release_reason: "job_failed", last_error: null, metadata: {} }],
  workers: [{ worker_id: "worker-fixture", status: "disconnected", version: "1.0.0", capabilities: ["tools"], supported_harnesses: ["codex"], active_job_id: null, expected_at: now, registered_at: now, last_heartbeat_at: now, disconnected_at: now, released_at: null, metadata: {} }],
  evidence: [
    { evidence_schema_version: 2, evidence_id: "prompt-build", run_id: "fixture-run", node_run_id: "fixture-node-build", job_id: "job-build-2", worker_id: "worker-fixture", sequence: 1, kind: "prompt", source: { provider: "openai", model: "gpt-5", native_event_id: "response-fixture", synthetic: false }, trace: { trace_id: "trace-fixture", span_id: "span-prompt", parent_span_id: "span-job-2", tool_call_id: null }, summary: "Execute build and verification tools", input_ref: "prompt:build", output_ref: null, storage_uri: null, inline_payload: { objective: "Build the runtime evaluation surface", constraints: ["Run checks", "Record evidence"] }, redaction_status: "not_required", created_at: "2026-07-10T08:06:02.000Z" },
    { evidence_schema_version: 2, evidence_id: "tool-call-build", run_id: "fixture-run", node_run_id: "fixture-node-build", job_id: "job-build-2", worker_id: "worker-fixture", sequence: 2, kind: "tool_call", source: { provider: "openai", model: "gpt-5", native_event_id: "call-native", synthetic: false }, trace: { trace_id: "trace-fixture", span_id: "span-tool-call", parent_span_id: "span-job-2", tool_call_id: "call-test-suite" }, summary: "Run mobile test suite", storage_uri: null, inline_payload: { command: "npm test" }, redaction_status: "not_required", created_at: "2026-07-10T08:06:05.000Z" },
    { evidence_schema_version: 2, evidence_id: "tool-result-build", run_id: "fixture-run", node_run_id: "fixture-node-build", job_id: "job-build-2", worker_id: "worker-fixture", sequence: 3, kind: "tool_result", source: { provider: "openai", model: "gpt-5", native_event_id: "result-native", synthetic: false }, trace: { trace_id: "trace-fixture", span_id: "span-tool-result", parent_span_id: "span-tool-call", tool_call_id: "call-test-suite" }, summary: "Test suite returned status 1", storage_uri: "workspace://logs/mobile-test.log", inline_payload: null, redaction_status: "not_required", created_at: "2026-07-10T08:06:16.000Z" },
    { evidence_schema_version: 2, evidence_id: "usage-build", run_id: "fixture-run", node_run_id: "fixture-node-build", job_id: "job-build-2", worker_id: "worker-fixture", sequence: 4, kind: "usage", source: { provider: "openai", model: "gpt-5", native_event_id: "usage-native", synthetic: false }, trace: { trace_id: "trace-fixture", span_id: "span-usage", parent_span_id: "span-job-2", tool_call_id: null }, summary: "Provider usage", storage_uri: null, inline_payload: null, usage: { availability: "partial", input_tokens: 1680, output_tokens: 420, cache_read_tokens: 320, cache_write_tokens: null, reasoning_tokens: 180, total_tokens: 2280, duration_ms: 17000, turn_count: 1, provider_reported_cost: null, estimated_cost: { currency: "USD", amount_decimal: "0.0432", catalog_id: "fixture-pricing", catalog_version: "1" } }, redaction_status: "not_required", created_at: "2026-07-10T08:06:17.000Z" },
    { evidence_schema_version: 2, evidence_id: "error-build", run_id: "fixture-run", node_run_id: "fixture-node-build", job_id: "job-build-2", worker_id: "worker-fixture", sequence: 5, kind: "error", source: { provider: "openai", model: "gpt-5", native_event_id: "error-native", synthetic: false }, trace: { trace_id: "trace-fixture", span_id: "span-error", parent_span_id: "span-job-2", tool_call_id: "call-test-suite" }, summary: "Tool process exited with status 1", storage_uri: "workspace://logs/mobile-test.log", inline_payload: null, redaction_status: "not_required", created_at: "2026-07-10T08:06:18.000Z" },
  ],
  handoffs: [{ type: "node_handoff", handoff_id: "handoff-build", job_id: "job-build-2", run_id: "fixture-run", node_run_id: "fixture-node-build", node_id: "build", port: "failure", content: { status: "failed" }, summary: "Failure context routed to integration", routed_node_run_ids: ["fixture-node-integrate"], skipped_node_run_ids: [], created_at: now }],
  artifacts: [{ artifact_id: "artifact-log", run_id: "fixture-run", node_run_id: "fixture-node-build", type: "log", name: "mobile-test.log", storage_uri: "workspace://logs/mobile-test.log", mime_type: "text/plain", size_bytes: 4096, created_at: now }],
  provider_evidence: {
    model_job_count: 2,
    native_evidence_count: 5,
    usage: { latest_by_job: [], token_completeness: "partial", provider_reported_cost_completeness: "unavailable", estimated_cost_completeness: "partial", aggregate_tokens: { input_tokens: 1680, output_tokens: 420, cache_read_tokens: 320, cache_write_tokens: null, reasoning_tokens: 180, total_tokens: 2280 }, provider_reported_costs: {}, estimated_costs: { USD: "0.0432" } },
    tools: { calls: [], results: [], open_tool_call_ids: [] },
  },
  event_delivery: { tracked_jobs: 2, ignored_events: 0, cursors: [] },
  summary: { active_jobs: 0, connected_workers: 0, active_leases: 0, evidence_items: 5, native_evidence_items: 5, open_tool_calls: 0, handoffs: 1, artifacts: 1 },
};

const trace: TraceProjection = {
  schema_version: 1,
  run_id: "fixture-run",
  trace_id: "trace-fixture",
  completeness: "complete",
  spans: [
    { span_id: "span-job-2", parent_span_id: "span-build", trace_id: "trace-fixture", run_id: "fixture-run", node_run_id: "fixture-node-build", job_id: "job-build-2", kind: "job", name: "Attempt 2", status: "error", started_at: "2026-07-10T08:06:00.000Z", finished_at: "2026-07-10T08:06:18.000Z", input_ref: "prompt:build", output_ref: "evidence:error-build", tool_call_id: null, provider: "openai", model: "gpt-5", usage: null, attributes: { attempt: 2 } },
    { span_id: "span-tool-call", parent_span_id: "span-job-2", trace_id: "trace-fixture", run_id: "fixture-run", node_run_id: "fixture-node-build", job_id: "job-build-2", kind: "tool", name: "Run mobile test suite", status: "error", started_at: "2026-07-10T08:06:05.000Z", finished_at: "2026-07-10T08:06:16.000Z", input_ref: "tool-input:call-test-suite", output_ref: "tool-output:call-test-suite", tool_call_id: "call-test-suite", provider: "openai", model: "gpt-5", usage: null, attributes: {} },
  ],
  cursor: null,
  has_more: false,
};

const scorecards: ScorecardResult[] = [{
  schema_version: 1, scorecard_id: "scorecard-fixture", run_id: "fixture-run", snapshot_id: "snapshot-fixture", evidence_digest: "digest-fixture", profile: "pipeline-v1", policy_version: 1, enforcement: "advisory", pipeline_verdict: "fail", contract_verdict: "incomplete", gate_verdict: "reject", passed_checks: 5, total_checks: 8, hard_error_count: 1, warning_count: 1, blind_spot_count: 1,
  findings: [{ check_id: "runtime.terminal", severity: "error", passed: false, summary: "Required integration did not run", detail: "The failed provider tool node blocked integration and final evaluation.", evidence_refs: ["evidence:error-build"] }],
  created_at: now,
}];

const evaluations: EvaluationResult[] = [{
  schema_version: 1, evaluation_id: "evaluation-fixture", run_id: "fixture-run", snapshot_id: "snapshot-fixture", evidence_digest: "digest-fixture", scorecard_id: "scorecard-fixture", evaluator: { id: "deterministic-v1", kind: "deterministic", version: "1", provider: null, model: null, prompt_version: null }, pipeline_verdict: "fail", contract_verdict: "incomplete", evidence_verdict: "complete", usage_verdict: "partial", quality_verdict: "fail", gate_verdict: "reject",
  findings: [{ check_id: "quality.output", dimension: "quality", severity: "error", passed: false, summary: "Final output unavailable", detail: "The required delivery artifact was not produced.", evidence_refs: ["node:fixture-node-deliver"] }],
  evaluator_usage: null, status: "completed", attempt: 1, created_at: now, started_at: now, completed_at: now, error: null,
}];

const replay: ReplayResult = {
  schema_version: 1, replay_id: "replay-fixture", run_id: "fixture-run", route_id: "route-fixture", event_digest: "events-fixture", event_completeness: "complete", verification: "partial", processed_events: 34, first_sequence: 1, last_sequence: 34,
  projection_differences: [{ category: "node", record_id: "fixture-node-build", field: "finished_at", replayed: "2026-07-10T08:06:18.000Z", persisted: null, severity: "warning", summary: "Persisted node finish time lagged the terminal event." }],
  missing_references: ["artifact:expected-delivery"], created_at: now,
};

export default function RuntimeEvaluationFixtureScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.frame}>
        <RuntimeTopology
          graph={graph}
          projection={projection}
          trace={trace}
          scorecards={scorecards}
          evaluations={evaluations}
          replay={replay}
          mode="full"
          title="Failed provider execution"
          detail="Inspect branch convergence, retry evidence and evaluation findings."
          onCreateScorecard={() => undefined}
          onRunEvaluation={() => undefined}
          onVerifyReplay={() => undefined}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f3f6fb" },
  content: { padding: 16, alignItems: "center" },
  frame: { width: "100%", maxWidth: 760, backgroundColor: "#ffffff", paddingHorizontal: 14, paddingVertical: 16, borderWidth: 1, borderColor: "#d7dfeb", borderRadius: 8 },
});
