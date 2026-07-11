const BASE_TIME = Date.parse("2026-07-10T08:00:00.000Z");

function iso(offsetSeconds) {
  return new Date(BASE_TIME + offsetSeconds * 1000).toISOString();
}

function node(id, order, status = "pending", extra = {}) {
  const started = status === "pending" || status === "ready" ? null : iso(order * 9);
  const terminal = ["completed", "failed", "skipped", "cancelled"].includes(status);
  return {
    nodeRunId: `nr-${id}`,
    nodeId: id,
    name: extra.name || id.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase()),
    type: extra.type || "agent_task",
    status,
    progress: {
      percent: extra.progress ?? (status === "completed" || status === "skipped" ? 100 : status === "running" ? 58 : status === "waiting_human" ? 74 : status === "failed" ? 82 : 0),
      message: extra.message || (status === "completed" ? "Output returned" : status === "running" ? "Processing current step" : status === "waiting_human" ? "Operator decision required" : status === "failed" ? "Provider tool execution failed" : "Waiting for dependencies"),
      updated_at: iso(order * 9 + 4),
    },
    attempt: extra.attempt || 1,
    startedAt: started,
    finishedAt: terminal ? iso(order * 9 + 7) : null,
    agentProfile: extra.agent || `${id}-agent`,
    runtimeAgentRef: extra.runtime || "codex",
    openclawAgentId: null,
    approvalKind: extra.approvalKind || null,
    humanInputRequired: extra.humanInputRequired === true,
    expectedArtifacts: extra.expectedArtifacts || [],
    workPackageKey: extra.workPackageKey || `stage-${Math.floor(order / 3) + 1}`,
    workPackageLabel: extra.workPackageLabel || `Stage ${Math.floor(order / 3) + 1}`,
    workPackageOrder: Math.floor(order / 3),
    workPackageIdentitySource: "declared",
    markers: extra.markers || (status === "waiting_human" ? ["waiting_human", "approval_gate"] : status === "failed" ? ["blocked"] : status === "running" ? ["active_frontier"] : terminal ? ["terminal"] : []),
  };
}

function edge(from, to, status = "pending", label = null, condition = null) {
  return {
    fromNodeId: from,
    toNodeId: to,
    fromNodeRunId: `nr-${from}`,
    toNodeRunId: `nr-${to}`,
    label,
    condition,
    status,
  };
}

function job(nodeId, attempt = 1, status = "completed", extra = {}) {
  const order = Number(extra.order || 1);
  return {
    job_id: `job-${nodeId}-${attempt}`,
    run_id: extra.runId || "fixture-run",
    node_run_id: `nr-${nodeId}`,
    attempt,
    dispatch_sequence: attempt,
    status,
    worker_id: `worker-${nodeId}`,
    lease_id: `lease-${nodeId}`,
    target_kind: "docker-worker",
    agent_runtime: extra.runtime || "codex",
    runtime_agent_ref: extra.runtime || "codex",
    created_at: iso(order * 9),
    accepted_at: iso(order * 9 + 1),
    finished_at: ["completed", "failed", "cancelled", "rejected"].includes(status) ? iso(order * 9 + 7) : null,
    last_event_id: null,
    last_error: extra.error || null,
    compatibility: {},
    job: {
      envelope: {
        retry_policy: { max_attempts: extra.maxAttempts || 1, attempt },
      },
    },
  };
}

function usageEvidence(nodeId, attempt = 1, extra = {}) {
  const order = Number(extra.order || 1);
  const total = extra.totalTokens ?? 420 + order * 17;
  return {
    evidence_schema_version: 2,
    evidence_id: `ev-usage-${nodeId}-${attempt}`,
    run_id: extra.runId || "fixture-run",
    node_run_id: `nr-${nodeId}`,
    job_id: `job-${nodeId}-${attempt}`,
    worker_id: `worker-${nodeId}`,
    sequence: 4,
    kind: "usage",
    source: { provider: extra.provider || "openai", model: extra.model || "fixture-model", native_event_id: `native-${nodeId}`, synthetic: false },
    trace: { trace_id: "trace:fixture-run", span_id: `model:job-${nodeId}-${attempt}`, parent_span_id: `job:job-${nodeId}-${attempt}`, tool_call_id: null },
    summary: "Provider usage reported.",
    input_ref: null,
    output_ref: null,
    storage_uri: null,
    inline_payload: null,
    usage: extra.unavailable ? {
      availability: "unavailable",
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
      total_tokens: null,
      duration_ms: null,
      turn_count: null,
      provider_reported_cost: null,
      estimated_cost: null,
    } : {
      availability: "available",
      input_tokens: total - 90,
      output_tokens: 90,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 24,
      total_tokens: total,
      duration_ms: 2400 + order * 100,
      turn_count: 1,
      provider_reported_cost: extra.noCost ? null : { currency: "USD", amount_decimal: (total / 100000).toFixed(6) },
      estimated_cost: null,
    },
    redaction_status: "not_required",
    created_at: iso(order * 9 + 6),
  };
}

function promptEvidence(nodeId, order) {
  return {
    evidence_schema_version: 2,
    evidence_id: `ev-prompt-${nodeId}`,
    run_id: "fixture-run",
    node_run_id: `nr-${nodeId}`,
    job_id: `job-${nodeId}-1`,
    worker_id: `worker-${nodeId}`,
    sequence: 1,
    kind: "prompt",
    source: { provider: "openai", model: "fixture-model", native_event_id: null, synthetic: false },
    trace: { trace_id: "trace:fixture-run", span_id: `prompt:${nodeId}`, parent_span_id: `job:job-${nodeId}-1`, tool_call_id: null },
    summary: `Execute ${nodeId} and return structured evidence.`,
    input_ref: `prompt:${nodeId}`,
    output_ref: null,
    storage_uri: null,
    inline_payload: { objective: `Fixture objective for ${nodeId}`, constraints: ["deterministic", "auditable"] },
    usage: null,
    redaction_status: "not_required",
    created_at: iso(order * 9 + 2),
  };
}

function traceFor(nodes, jobs, evidence) {
  const spans = [{
    span_id: "run:fixture-run",
    parent_span_id: null,
    trace_id: "trace:fixture-run",
    run_id: "fixture-run",
    node_run_id: null,
    job_id: null,
    kind: "run",
    name: "Runtime Graph Fixture",
    status: nodes.some((item) => item.status === "failed") ? "error" : nodes.every((item) => ["completed", "skipped"].includes(item.status)) ? "ok" : "unknown",
    started_at: iso(0),
    finished_at: null,
    input_ref: "run-inputs:fixture-run",
    output_ref: null,
    tool_call_id: null,
    provider: null,
    model: null,
    usage: null,
    attributes: {},
  }];
  for (const item of nodes) {
    spans.push({
      span_id: `node:${item.nodeRunId}`,
      parent_span_id: "run:fixture-run",
      trace_id: "trace:fixture-run",
      run_id: "fixture-run",
      node_run_id: item.nodeRunId,
      job_id: null,
      kind: "node",
      name: item.name,
      status: item.status === "failed" ? "error" : item.status === "completed" || item.status === "skipped" ? "ok" : "unknown",
      started_at: item.startedAt || iso(0),
      finished_at: item.finishedAt,
      input_ref: `plan-node:${item.nodeRunId}`,
      output_ref: item.finishedAt ? `node-run:${item.nodeRunId}` : null,
      tool_call_id: null,
      provider: null,
      model: null,
      usage: null,
      attributes: { status: item.status, attempt: item.attempt },
    });
  }
  for (const item of jobs) {
    const usage = evidence.find((record) => record.job_id === item.job_id && record.kind === "usage")?.usage || null;
    spans.push({
      span_id: `job:${item.job_id}`,
      parent_span_id: `node:${item.node_run_id}`,
      trace_id: "trace:fixture-run",
      run_id: "fixture-run",
      node_run_id: item.node_run_id,
      job_id: item.job_id,
      kind: "job",
      name: `Attempt ${item.attempt}`,
      status: item.status === "failed" ? "error" : item.status === "completed" ? "ok" : "unknown",
      started_at: item.created_at,
      finished_at: item.finished_at,
      input_ref: `runtime-job:${item.job_id}`,
      output_ref: item.finished_at ? `runtime-result:${item.job_id}` : null,
      tool_call_id: null,
      provider: item.agent_runtime,
      model: null,
      usage: null,
      attributes: {},
    });
    spans.push({
      span_id: `model:${item.job_id}`,
      parent_span_id: `job:${item.job_id}`,
      trace_id: "trace:fixture-run",
      run_id: "fixture-run",
      node_run_id: item.node_run_id,
      job_id: item.job_id,
      kind: "model",
      name: "Provider model turn",
      status: item.status === "failed" ? "error" : item.status === "completed" ? "ok" : "unknown",
      started_at: item.accepted_at || item.created_at,
      finished_at: item.finished_at,
      input_ref: `prompt:${item.node_run_id}`,
      output_ref: item.finished_at ? `model-output:${item.job_id}` : null,
      tool_call_id: null,
      provider: "openai",
      model: "fixture-model",
      usage,
      attributes: {},
    });
  }
  return { schema_version: 1, run_id: "fixture-run", trace_id: "trace:fixture-run", completeness: "complete", spans, cursor: null, has_more: false };
}

function buildFixture(name, nodes, edges, options = {}) {
  const jobs = options.jobs || nodes
    .filter((item) => item.status !== "pending" && item.status !== "ready" && item.status !== "skipped")
    .map((item, index) => job(item.nodeId, item.attempt || 1, item.status === "failed" ? "failed" : item.status === "completed" ? "completed" : "running", { order: index + 1, error: item.status === "failed" ? "Tool process exited with status 1." : null, maxAttempts: item.status === "failed" ? 3 : 1 }));
  const evidence = options.evidence || jobs.flatMap((item, index) => [
    promptEvidence(item.job.node_id || nodes.find((nodeItem) => nodeItem.nodeRunId === item.node_run_id)?.nodeId || `node-${index}`, index + 1),
    usageEvidence(nodes.find((nodeItem) => nodeItem.nodeRunId === item.node_run_id)?.nodeId || `node-${index}`, item.attempt, { order: index + 1, unavailable: options.missingUsage && index % 3 === 0, noCost: options.partialCost && index % 2 === 0 }),
  ]);
  const runStatus = options.runStatus || (nodes.some((item) => item.status === "failed") ? "failed" : nodes.every((item) => ["completed", "skipped"].includes(item.status)) ? "completed" : "running");
  const providerUsage = evidence.filter((item) => item.kind === "usage" && item.usage);
  const availableUsage = providerUsage.filter((item) => item.usage.input_tokens !== null);
  const providerCosts = providerUsage.filter((item) => item.usage.provider_reported_cost);
  return {
    name,
    graph: {
      runId: "fixture-run",
      templateId: `fixture-${name}`,
      templateVersion: 1,
      runStatus,
      intent: `${name} runtime graph acceptance fixture`,
      generatedAt: iso(200),
      nodes,
      edges,
      frontier: nodes.filter((item) => ["running", "waiting_human", "ready"].includes(item.status)).map((item) => item.nodeRunId),
      statusCounts: {},
      markers: {},
      workPackages: [],
      runtimeMonitoring: {},
      summaryLines: [],
    },
    projection: {
      projection_version: 2,
      generated_at: iso(200),
      run_id: "fixture-run",
      route: { schema_version: 1, run_id: "fixture-run", route_id: `route-${name}`, source_kind: "direct_template", template_name: `Fixture ${name}`, template_id: `fixture-${name}`, template_version: 1, work_packages: [] },
      jobs,
      leases: jobs.map((item) => ({ lease_id: item.lease_id, job_id: item.job_id, worker_id: item.worker_id, status: item.status === "running" ? "active" : "released" })),
      workers: jobs.map((item) => ({ worker_id: item.worker_id, status: item.status === "running" ? "busy" : "disconnected" })),
      evidence,
      handoffs: [],
      artifacts: nodes.filter((item) => item.status === "completed").map((item, index) => ({ artifact_id: `artifact-${item.nodeId}`, run_id: "fixture-run", node_run_id: item.nodeRunId, type: "file", name: `${item.nodeId}-output.json`, storage_uri: `workspace://fixture/${item.nodeId}.json`, mime_type: "application/json", size_bytes: 256 + index, created_at: iso(120 + index) })),
      provider_evidence: {
        usage: {
          token_completeness: availableUsage.length === jobs.length && jobs.length ? "complete" : availableUsage.length ? "partial" : "unavailable",
          provider_reported_cost_completeness: providerCosts.length === jobs.length && jobs.length ? "complete" : providerCosts.length ? "partial" : "unavailable",
          estimated_cost_completeness: "unavailable",
          aggregate_tokens: { total_tokens: availableUsage.reduce((total, item) => total + item.usage.total_tokens, 0) },
          provider_reported_costs: providerCosts.length ? { USD: providerCosts.reduce((total, item) => total + Number(item.usage.provider_reported_cost.amount_decimal), 0).toFixed(6) } : {},
          estimated_costs: {},
        },
      },
      recovery: {
        run_id: "fixture-run",
        generated_at: iso(214),
        posture: runStatus === "failed" ? "degraded" : "healthy",
        summary: {
          compensations: runStatus === "failed" ? 1 : 0,
          pending_compensations: runStatus === "failed" ? 1 : 0,
          cleanup_failures: runStatus === "failed" ? 1 : 0,
          execution_replays: 0,
          active_replays: 0,
        },
        compensations: runStatus === "failed" ? [{
          compensation_id: "compensation:fixture",
          node_run_id: nodes.find((item) => item.status === "failed")?.node_run_id || nodes[0]?.node_run_id,
          reason: "node_timeout",
          status: "cleanup_failed",
          cleanup_attempt_ids: ["cleanup:fixture:1"],
        }] : [],
        execution_replays: [],
      },
      summary: { active_jobs: jobs.filter((item) => item.status === "running").length, evidence_items: evidence.length },
    },
    trace: traceFor(nodes, jobs, evidence),
    scorecards: runStatus === "completed" ? [{
      schema_version: 1,
      scorecard_id: `scorecard-${name}`,
      run_id: "fixture-run",
      snapshot_id: `snapshot-${name}`,
      evidence_digest: `digest-${name}`,
      profile: "pipeline-v1",
      policy_version: 1,
      enforcement: "advisory",
      pipeline_verdict: "pass",
      contract_verdict: "pass",
      gate_verdict: "pass",
      passed_checks: 8,
      total_checks: 8,
      hard_error_count: 0,
      warning_count: 1,
      blind_spot_count: 0,
      findings: [{ check_id: "usage.cost", severity: "warning", passed: true, summary: "Estimated cost only", detail: "Provider-reported cost is partial; estimated cost remains available.", evidence_refs: ["evidence:usage"] }],
      created_at: iso(210),
    }] : [],
    evaluations: runStatus === "completed" ? [{
      schema_version: 1,
      evaluation_id: `eval-${name}`,
      run_id: "fixture-run",
      snapshot_id: `snapshot-${name}`,
      evidence_digest: `digest-${name}`,
      scorecard_id: `scorecard-${name}`,
      evaluator: { id: "deterministic-v1", kind: "deterministic", version: "1", provider: null, model: null, prompt_version: null },
      pipeline_verdict: "pass",
      contract_verdict: "pass",
      evidence_verdict: "complete",
      usage_verdict: "partial",
      quality_verdict: "pass",
      gate_verdict: "pass",
      findings: [{ check_id: "quality.outputs", dimension: "quality", severity: "info", passed: true, summary: "Terminal outputs recorded", detail: "All required terminal artifacts are referenced.", evidence_refs: ["artifact:fixture"] }],
      evaluator_usage: null,
      status: "completed",
      attempt: 1,
      created_at: iso(211),
      started_at: iso(211),
      completed_at: iso(212),
      error: null,
    }] : [],
    replay: runStatus === "completed" ? {
      schema_version: 1,
      replay_id: `replay-${name}`,
      run_id: "fixture-run",
      route_id: `route-${name}`,
      event_digest: `events-${name}`,
      event_completeness: "complete",
      verification: "pass",
      processed_events: 42,
      first_sequence: 1,
      last_sequence: 42,
      projection_differences: [],
      missing_references: [],
      created_at: iso(213),
    } : null,
  };
}

const fixtures = {
  linear: () => buildFixture("linear", [node("prepare", 0, "completed"), node("deliver", 1, "completed")], [edge("prepare", "deliver", "satisfied")]),
  branch: () => buildFixture("branch", [
    node("plan", 0, "completed"),
    node("research", 1, "running"),
    node("implement", 2, "running"),
    node("review", 3, "ready"),
  ], [edge("plan", "research", "active", "research"), edge("plan", "implement", "active", "build"), edge("plan", "review", "active", "review")]),
  merge: () => buildFixture("merge", [
    node("start", 0, "completed"),
    node("frontend", 1, "completed"),
    node("backend", 2, "completed"),
    node("integrate", 3, "running"),
    node("release", 4, "pending"),
  ], [edge("start", "frontend", "satisfied"), edge("start", "backend", "satisfied"), edge("frontend", "integrate", "active"), edge("backend", "integrate", "active"), edge("integrate", "release", "pending")]),
  waiting: () => buildFixture("waiting", [
    node("draft", 0, "completed"),
    node("security-review", 1, "waiting_human", { approvalKind: "human_review", name: "Security and compliance approval" }),
    node("publish", 2, "pending"),
  ], [edge("draft", "security-review", "active"), edge("security-review", "publish", "pending")]),
  failed: () => {
    const nodes = [node("prepare", 0, "completed"), node("tool-execution", 1, "failed", { attempt: 2, name: "Provider native tool execution" }), node("recover", 2, "pending")];
    const jobs = [job("prepare", 1, "completed", { order: 1 }), job("tool-execution", 1, "failed", { order: 2, maxAttempts: 3, error: "First attempt timed out." }), job("tool-execution", 2, "failed", { order: 3, maxAttempts: 3, error: "Tool process exited with status 1." })];
    return buildFixture("failed", nodes, [edge("prepare", "tool-execution", "satisfied"), edge("tool-execution", "recover", "blocked", "on success")], { jobs, runStatus: "failed", partialCost: true });
  },
  twenty: () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node(`node-${index + 1}`, index, index < 12 ? "completed" : index < 16 ? "running" : index === 16 ? "waiting_human" : "pending", {
      name: index === 7 ? "A very long work package node name used to verify truncation without layout movement" : undefined,
      workPackageLabel: index < 5 ? "Discovery" : index < 12 ? "Implementation and provider evidence collection" : "Validation",
    }));
    const edges = [];
    for (let index = 1; index < nodes.length; index += 1) {
      const parent = index < 4 ? 0 : index < 10 ? Math.max(1, Math.floor(index / 2)) : index - 3;
      edges.push(edge(nodes[parent].nodeId, nodes[index].nodeId, index < 12 ? "satisfied" : index < 17 ? "active" : "pending"));
    }
    edges.push(edge("node-4", "node-10", "satisfied", "merge"));
    edges.push(edge("node-8", "node-14", "active", "quality"));
    return buildFixture("twenty", nodes, edges, { missingUsage: true, partialCost: true });
  },
};

export const RUNTIME_GRAPH_FIXTURE_NAMES = Object.freeze(Object.keys(fixtures));

export function getRuntimeGraphFixture(name) {
  return (fixtures[name] || fixtures.linear)();
}
