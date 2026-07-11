import { buildDagLayout } from "./dag-layout.js";

const RUNTIME_NODE_WIDTH = 224;
const RUNTIME_NODE_HEIGHT = 112;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function durationMs(startedAt, finishedAt, nowMs) {
  const start = timestamp(startedAt);
  if (start === null) return null;
  const finish = timestamp(finishedAt) ?? nowMs;
  return Math.max(0, finish - start);
}

function latestBy(items, keyOf) {
  const latest = new Map();
  for (const item of items) latest.set(keyOf(item), item);
  return latest;
}

function sumKnown(values) {
  const known = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

function aggregateMoney(usages, field) {
  const totals = new Map();
  for (const usage of usages) {
    const money = record(usage?.[field]);
    const currency = typeof money.currency === "string" ? money.currency : "";
    const amount = Number(money.amount_decimal);
    if (!currency || !Number.isFinite(amount)) continue;
    totals.set(currency, (totals.get(currency) || 0) + amount);
  }
  return Object.fromEntries(
    [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => [currency, amount.toFixed(6).replace(/\.?0+$/, "") || "0"]),
  );
}

function buildUsageSummary(jobs, evidence, traceSpans) {
  const modelSpans = traceSpans.filter((span) => span.kind === "model" && span.usage);
  const usageByJob = latestBy(
    evidence.filter((item) => item.kind === "usage" && item.usage),
    (item) => item.job_id || item.evidence_id,
  );
  const usages = modelSpans.length
    ? modelSpans.map((span) => span.usage).filter(Boolean)
    : [...usageByJob.values()].map((item) => item.usage).filter(Boolean);
  const modelJobCount = jobs.filter((job) => job.agent_runtime && job.agent_runtime !== "local").length;
  const tokenCompleteCount = usages.filter(
    (usage) => usage.input_tokens !== null && usage.input_tokens !== undefined && usage.output_tokens !== null && usage.output_tokens !== undefined,
  ).length;
  const denominator = Math.max(modelJobCount, usages.length);
  const tokenCompleteness = !denominator || !tokenCompleteCount
    ? "unavailable"
    : tokenCompleteCount === denominator
      ? "complete"
      : "partial";
  const providerCostCount = usages.filter((usage) => usage.provider_reported_cost).length;
  const estimatedCostCount = usages.filter((usage) => usage.estimated_cost).length;
  const costCount = Math.max(providerCostCount, estimatedCostCount);
  const costCompleteness = !denominator || !costCount
    ? "unavailable"
    : costCount === denominator
      ? "complete"
      : "partial";
  return {
    recordCount: usages.length,
    tokenCompleteness,
    costCompleteness,
    inputTokens: sumKnown(usages.map((usage) => usage.input_tokens)),
    outputTokens: sumKnown(usages.map((usage) => usage.output_tokens)),
    totalTokens: sumKnown(usages.map((usage) => usage.total_tokens)),
    cacheReadTokens: sumKnown(usages.map((usage) => usage.cache_read_tokens)),
    cacheWriteTokens: sumKnown(usages.map((usage) => usage.cache_write_tokens)),
    reasoningTokens: sumKnown(usages.map((usage) => usage.reasoning_tokens)),
    durationMs: sumKnown(usages.map((usage) => usage.duration_ms)),
    turnCount: sumKnown(usages.map((usage) => usage.turn_count)),
    providerReportedCosts: aggregateMoney(usages, "provider_reported_cost"),
    estimatedCosts: aggregateMoney(usages, "estimated_cost"),
    raw: usages,
  };
}

function edgeConditionLabel(condition) {
  const value = record(condition);
  const entries = Object.entries(value);
  if (!entries.length) return "";
  return entries
    .slice(0, 2)
    .map(([key, item]) => `${key}=${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
    .join(", ");
}

function nodeStatusTone(status) {
  if (status === "completed" || status === "skipped") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "waiting_human" || status === "ready") return "warn";
  return "neutral";
}

function edgeTone(status, skipped) {
  if (skipped) return "skipped";
  if (status === "blocked") return "blocked";
  if (status === "active") return "active";
  if (status === "satisfied") return "satisfied";
  return "pending";
}

function maxAttemptsFromJobs(jobs, fallback) {
  const values = jobs.map((job) =>
    Number(job?.job?.envelope?.retry_policy?.max_attempts ?? job?.job?.envelope?.retryPolicy?.maxAttempts),
  ).filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : Math.max(1, Number(fallback || 1));
}

function buildNodeModel(node, index, context) {
  const jobs = context.jobs.filter((item) => item.node_run_id === node.nodeRunId);
  const leases = context.leases.filter((lease) => jobs.some((job) => job.job_id === lease.job_id || job.lease_id === lease.lease_id));
  const workers = context.workers.filter((worker) => jobs.some((job) => job.worker_id === worker.worker_id) || leases.some((lease) => lease.worker_id === worker.worker_id));
  const evidence = context.evidence.filter((item) => item.node_run_id === node.nodeRunId);
  const handoffs = context.handoffs.filter((item) => item.node_run_id === node.nodeRunId);
  const artifacts = context.artifacts.filter((item) => item.node_run_id === node.nodeRunId);
  const traceSpans = context.traceSpans.filter((span) => span.node_run_id === node.nodeRunId);
  const toolSpans = traceSpans.filter((span) => span.kind === "tool");
  const toolCalls = evidence.filter((item) => item.kind === "tool_call");
  const toolResults = evidence.filter((item) => item.kind === "tool_result");
  const errorSpans = traceSpans.filter((span) => span.status === "error");
  const errors = [
    ...jobs.filter((job) => job.last_error).map((job) => ({ summary: job.last_error, created_at: job.finished_at || job.created_at, source: "job" })),
    ...evidence.filter((item) => item.kind === "error").map((item) => ({ summary: item.summary, created_at: item.created_at, source: "evidence" })),
    ...errorSpans.map((span) => ({ summary: span.name, created_at: span.finished_at || span.started_at, source: span.kind })),
  ];
  const latestJob = jobs.at(-1) || null;
  const latestLease = leases.at(-1) || null;
  const latestWorker = workers.at(-1) || null;
  const usage = buildUsageSummary(jobs, evidence, traceSpans);
  const attempt = Math.max(Number(node.attempt || 0), ...jobs.map((job) => Number(job.attempt || 0)), 0);
  const maxAttempts = maxAttemptsFromJobs(jobs, attempt || 1);
  const duration = durationMs(node.startedAt, node.finishedAt, context.nowMs);
  const role = node.agentProfile || node.runtimeAgentRef || node.type || "task";
  const prompts = evidence.filter((item) => item.kind === "prompt");
  const skipped = node.status === "skipped" || array(node.markers).includes("skipped");
  return {
    ...node,
    index,
    order: index,
    role,
    tone: nodeStatusTone(node.status),
    progressPercent: Math.max(0, Math.min(100, Number(node.progress?.percent || 0))),
    progressMessage: node.progress?.message || "",
    attempt,
    maxAttempts,
    durationMs: duration,
    activeJobId: latestJob?.job_id || null,
    activeWorkerId: latestWorker?.worker_id || latestJob?.worker_id || null,
    activeLeaseId: latestLease?.lease_id || latestJob?.lease_id || null,
    targetKind: latestJob?.target_kind || null,
    jobs,
    leases,
    workers,
    evidence,
    traceSpans,
    prompts,
    toolSpans,
    toolCalls,
    toolResults,
    toolCallCount: toolSpans.length || toolCalls.length,
    toolFailureCount: toolSpans.filter((span) => span.status === "error").length + toolResults.filter((item) => /error|fail|reject/i.test(item.summary || "")).length,
    usage,
    handoffs,
    artifacts,
    errors,
    errorSummary: errors.at(-1)?.summary || null,
    humanGateState: node.status === "waiting_human"
      ? node.approvalKind || (node.humanInputRequired ? "human_input" : "waiting_human")
      : null,
    skipped,
    width: RUNTIME_NODE_WIDTH,
    height: RUNTIME_NODE_HEIGHT,
  };
}

function buildNeighbors(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.nodeRunId, []]));
  const outgoing = new Map(nodes.map((node) => [node.nodeRunId, []]));
  for (const edge of edges) {
    if (!edge.valid) continue;
    incoming.get(edge.toNodeRunId)?.push(edge.fromNodeRunId);
    outgoing.get(edge.fromNodeRunId)?.push(edge.toNodeRunId);
  }
  return { incoming, outgoing };
}

export function buildRuntimeGraphModel(input = {}) {
  const graph = record(input.graph);
  const projection = record(input.projection);
  const trace = record(input.trace);
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const context = {
    jobs: array(projection.jobs),
    leases: array(projection.leases),
    workers: array(projection.workers),
    evidence: array(projection.evidence),
    handoffs: array(projection.handoffs),
    artifacts: array(projection.artifacts),
    traceSpans: array(trace.spans),
    nowMs,
  };
  const sourceNodes = array(graph.nodes);
  const nodes = sourceNodes.map((node, index) => buildNodeModel(node, index, context));
  const nodeByNodeId = new Map(nodes.map((node) => [node.nodeId, node]));
  const nodeByRunId = new Map(nodes.map((node) => [node.nodeRunId, node]));
  const sourceEdges = array(graph.edges).map((edge, index) => {
    const fromNode = nodeByNodeId.get(edge.fromNodeId) || nodeByRunId.get(edge.fromNodeRunId) || null;
    const toNode = nodeByNodeId.get(edge.toNodeId) || nodeByRunId.get(edge.toNodeRunId) || null;
    const conditionLabel = edgeConditionLabel(edge.condition);
    const skipped = !!toNode?.skipped && edge.status !== "satisfied";
    return {
      ...edge,
      id: `runtime-edge-${index}:${edge.fromNodeRunId || edge.fromNodeId}->${edge.toNodeRunId || edge.toNodeId}`,
      index,
      fromNodeRunId: fromNode?.nodeRunId || edge.fromNodeRunId || null,
      toNodeRunId: toNode?.nodeRunId || edge.toNodeRunId || null,
      label: edge.label || conditionLabel || "",
      conditionLabel,
      valid: !!fromNode && !!toNode,
      tone: edgeTone(edge.status, skipped),
      skipped,
      handoffs: context.handoffs.filter((handoff) =>
        handoff.node_run_id === fromNode?.nodeRunId && array(handoff.routed_node_run_ids).includes(toNode?.nodeRunId),
      ),
    };
  });
  const layout = buildDagLayout(
    nodes.map((node) => ({ id: node.nodeRunId, order: node.order, width: node.width, height: node.height })),
    sourceEdges.filter((edge) => edge.valid).map((edge) => ({ id: edge.id, from: edge.fromNodeRunId, to: edge.toNodeRunId })),
    { minWidth: 720, minHeight: 360, paddingX: 32, paddingY: 34, columnGap: 96, rowGap: 38 },
  );
  const layoutNodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const layoutEdgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const positionedNodes = nodes.map((node) => ({ ...node, ...layoutNodeById.get(node.nodeRunId) }));
  const positionedEdges = sourceEdges.map((edge) => ({ ...edge, ...(layoutEdgeById.get(edge.id) || {}) }));
  const selectedNode = positionedNodes.find((node) => node.nodeRunId === input.selectedNodeRunId) || null;
  const usageProjection = record(projection.provider_evidence).usage || {};
  const runUsage = {
    tokenCompleteness: usageProjection.token_completeness || buildUsageSummary(context.jobs, context.evidence, context.traceSpans).tokenCompleteness,
    providerCostCompleteness: usageProjection.provider_reported_cost_completeness || "unavailable",
    estimatedCostCompleteness: usageProjection.estimated_cost_completeness || "unavailable",
    aggregateTokens: record(usageProjection.aggregate_tokens),
    providerReportedCosts: record(usageProjection.provider_reported_costs),
    estimatedCosts: record(usageProjection.estimated_costs),
  };
  const route = record(projection.route);
  const runStartedAt = positionedNodes.map((node) => timestamp(node.startedAt)).filter((value) => value !== null).sort((a, b) => a - b)[0] || null;
  const runFinishedAt = positionedNodes.map((node) => timestamp(node.finishedAt)).filter((value) => value !== null).sort((a, b) => b - a)[0] || null;
  const runDurationMs = runStartedAt === null ? null : Math.max(0, (runFinishedAt ?? nowMs) - runStartedAt);
  const neighbors = buildNeighbors(positionedNodes, positionedEdges);
  return {
    runId: graph.runId || projection.run_id || "",
    runStatus: graph.runStatus || "unknown",
    runTone: nodeStatusTone(graph.runStatus),
    route: {
      id: route.route_id || "",
      label: route.template_name || `${graph.templateId || "Route"} v${graph.templateVersion || 1}`,
      source: route.source_kind || "unknown",
    },
    runDurationMs,
    generatedAt: graph.generatedAt || projection.generated_at || null,
    nodes: positionedNodes,
    edges: positionedEdges,
    workPackages: array(graph.workPackages),
    frontier: array(graph.frontier),
    layout,
    selectedNode,
    neighbors,
    usage: runUsage,
    trace: {
      completeness: trace.completeness || "unavailable",
      spans: context.traceSpans,
      hasMore: trace.has_more === true,
    },
    scorecards: array(input.scorecards),
    evaluations: array(input.evaluations),
    replay: input.replay || null,
    routeChanges: input.routeChanges || null,
    evidence: context.evidence,
    summary: record(projection.summary),
  };
}

export function findRuntimeNeighbor(model, nodeRunId, direction) {
  const nodes = array(model?.nodes);
  const current = nodes.find((node) => node.nodeRunId === nodeRunId) || null;
  if (!current) return nodes[0] || null;
  const incoming = model.neighbors?.incoming?.get(nodeRunId) || [];
  const outgoing = model.neighbors?.outgoing?.get(nodeRunId) || [];
  if (direction === "left") {
    return incoming.map((id) => nodes.find((node) => node.nodeRunId === id)).filter(Boolean).sort((a, b) => Math.abs(a.y - current.y) - Math.abs(b.y - current.y))[0] || current;
  }
  if (direction === "right") {
    return outgoing.map((id) => nodes.find((node) => node.nodeRunId === id)).filter(Boolean).sort((a, b) => Math.abs(a.y - current.y) - Math.abs(b.y - current.y))[0] || current;
  }
  const sameColumn = nodes.filter((node) => node.column === current.column).sort((a, b) => a.y - b.y);
  const index = sameColumn.findIndex((node) => node.nodeRunId === nodeRunId);
  const offset = direction === "up" ? -1 : 1;
  return sameColumn[Math.max(0, Math.min(sameColumn.length - 1, index + offset))] || current;
}
