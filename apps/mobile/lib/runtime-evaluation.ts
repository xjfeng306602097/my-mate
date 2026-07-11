import type {
  EvaluationResult,
  ReplayResult,
  RuntimeGraphNode,
  RuntimeGraphSummary,
  RuntimeJobRecord,
  RuntimeNodeHandoff,
  RuntimeRunProjection,
  RuntimeWorkerEvidence,
  ScorecardResult,
  TraceProjection,
  TraceSpan,
} from "./types";

export interface RuntimeTopologyNode {
  node: RuntimeGraphNode;
  depth: number;
  incomingCount: number;
  outgoingCount: number;
  isBranch: boolean;
  isConvergence: boolean;
}

export interface RuntimeTopologyGroup {
  key: string;
  label: string;
  nodes: RuntimeTopologyNode[];
}

export interface RuntimeTopologyStage {
  depth: number;
  label: string;
  groups: RuntimeTopologyGroup[];
  nodeCount: number;
  branchCount: number;
  convergenceCount: number;
}

export interface RuntimeNodeEvidenceDetail {
  node: RuntimeGraphNode;
  jobs: RuntimeJobRecord[];
  evidence: RuntimeWorkerEvidence[];
  prompts: RuntimeWorkerEvidence[];
  toolEvents: RuntimeWorkerEvidence[];
  usageEvents: RuntimeWorkerEvidence[];
  handoffs: RuntimeNodeHandoff[];
  artifacts: RuntimeRunProjection["artifacts"];
  errors: Array<{ id: string; summary: string; createdAt: string | null }>;
  traceSpans: TraceSpan[];
}

export interface RuntimeEvaluationBundle {
  scorecard: ScorecardResult | null;
  evaluation: EvaluationResult | null;
  replay: ReplayResult | null;
}

function resolveEdgeNodeRunId(
  graph: RuntimeGraphSummary,
  edge: RuntimeGraphSummary["edges"][number],
  side: "from" | "to",
): string | null {
  const explicit = side === "from" ? edge.fromNodeRunId : edge.toNodeRunId;
  if (explicit) return explicit;
  const nodeId = side === "from" ? edge.fromNodeId : edge.toNodeId;
  return graph.nodes.find((node) => node.nodeId === nodeId)?.nodeRunId || null;
}

export function buildRuntimeTopology(graph: RuntimeGraphSummary): RuntimeTopologyStage[] {
  const order = new Map(graph.nodes.map((node, index) => [node.nodeRunId, index]));
  const incoming = new Map(graph.nodes.map((node) => [node.nodeRunId, new Set<string>()]));
  const outgoing = new Map(graph.nodes.map((node) => [node.nodeRunId, new Set<string>()]));

  for (const edge of graph.edges) {
    const from = resolveEdgeNodeRunId(graph, edge, "from");
    const to = resolveEdgeNodeRunId(graph, edge, "to");
    if (!from || !to || from === to || !incoming.has(to) || !outgoing.has(from)) continue;
    incoming.get(to)?.add(from);
    outgoing.get(from)?.add(to);
  }

  const remaining = new Map(
    graph.nodes.map((node) => [node.nodeRunId, incoming.get(node.nodeRunId)?.size || 0]),
  );
  const depth = new Map(graph.nodes.map((node) => [node.nodeRunId, 0]));
  const queue = graph.nodes
    .filter((node) => remaining.get(node.nodeRunId) === 0)
    .map((node) => node.nodeRunId);
  const visited = new Set<string>();

  while (queue.length) {
    queue.sort((left, right) => (order.get(left) || 0) - (order.get(right) || 0));
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of outgoing.get(current) || []) {
      depth.set(next, Math.max(depth.get(next) || 0, (depth.get(current) || 0) + 1));
      remaining.set(next, Math.max(0, (remaining.get(next) || 0) - 1));
      if (remaining.get(next) === 0) queue.push(next);
    }
  }

  for (const node of graph.nodes) {
    if (visited.has(node.nodeRunId)) continue;
    const knownParentDepths = [...(incoming.get(node.nodeRunId) || [])]
      .filter((parent) => visited.has(parent))
      .map((parent) => depth.get(parent) || 0);
    depth.set(node.nodeRunId, knownParentDepths.length ? Math.max(...knownParentDepths) + 1 : 0);
  }

  const byDepth = new Map<number, RuntimeTopologyNode[]>();
  for (const node of graph.nodes) {
    const nodeDepth = depth.get(node.nodeRunId) || 0;
    const item: RuntimeTopologyNode = {
      node,
      depth: nodeDepth,
      incomingCount: incoming.get(node.nodeRunId)?.size || 0,
      outgoingCount: outgoing.get(node.nodeRunId)?.size || 0,
      isBranch: (outgoing.get(node.nodeRunId)?.size || 0) > 1,
      isConvergence: (incoming.get(node.nodeRunId)?.size || 0) > 1,
    };
    byDepth.set(nodeDepth, [...(byDepth.get(nodeDepth) || []), item]);
  }

  return [...byDepth.entries()]
    .sort(([left], [right]) => left - right)
    .map(([stageDepth, nodes]) => {
      const groupMap = new Map<string, RuntimeTopologyGroup>();
      for (const item of nodes.sort(
        (left, right) => (order.get(left.node.nodeRunId) || 0) - (order.get(right.node.nodeRunId) || 0),
      )) {
        const key = item.node.workPackageKey || "execution";
        const group = groupMap.get(key) || {
          key,
          label: item.node.workPackageLabel || "Execution",
          nodes: [],
        };
        group.nodes.push(item);
        groupMap.set(key, group);
      }
      return {
        depth: stageDepth,
        label: `Stage ${stageDepth + 1}`,
        groups: [...groupMap.values()],
        nodeCount: nodes.length,
        branchCount: nodes.filter((item) => item.isBranch).length,
        convergenceCount: nodes.filter((item) => item.isConvergence).length,
      };
    });
}

export function buildRuntimeNodeEvidence(
  graph: RuntimeGraphSummary,
  projection: RuntimeRunProjection | null,
  trace: TraceProjection | null,
  nodeRunId: string,
): RuntimeNodeEvidenceDetail | null {
  const node = graph.nodes.find((item) => item.nodeRunId === nodeRunId);
  if (!node) return null;
  const jobs = (projection?.jobs || [])
    .filter((item) => item.node_run_id === nodeRunId)
    .sort((left, right) => left.attempt - right.attempt || left.dispatch_sequence - right.dispatch_sequence);
  const evidence = (projection?.evidence || [])
    .filter((item) => item.node_run_id === nodeRunId)
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  const evidenceErrors = evidence
    .filter((item) => item.kind === "error")
    .map((item) => ({ id: item.evidence_id, summary: item.summary, createdAt: item.created_at }));
  const jobErrors = jobs
    .filter((item) => item.last_error)
    .map((item) => ({ id: item.job_id, summary: item.last_error || "Runtime job failed.", createdAt: item.finished_at }));
  return {
    node,
    jobs,
    evidence,
    prompts: evidence.filter((item) => item.kind === "prompt"),
    toolEvents: evidence.filter((item) => item.kind === "tool_call" || item.kind === "tool_result"),
    usageEvents: evidence.filter((item) => item.kind === "usage" && item.usage),
    handoffs: (projection?.handoffs || []).filter((item) => item.node_run_id === nodeRunId),
    artifacts: (projection?.artifacts || []).filter((item) => item.node_run_id === nodeRunId),
    errors: [...jobErrors, ...evidenceErrors],
    traceSpans: (trace?.spans || []).filter((item) => item.node_run_id === nodeRunId),
  };
}

export function latestRuntimeEvaluationBundle(input: {
  scorecards: ScorecardResult[];
  evaluations: EvaluationResult[];
  replay: ReplayResult | null;
}): RuntimeEvaluationBundle {
  const latestByCreatedAt = <T extends { created_at: string }>(items: T[]): T | null =>
    items.reduce<T | null>((latest, item) =>
      !latest || item.created_at.localeCompare(latest.created_at) > 0 ? item : latest, null);
  return {
    scorecard: latestByCreatedAt(input.scorecards),
    evaluation: latestByCreatedAt(input.evaluations),
    replay: input.replay,
  };
}

export function upsertRuntimeRecord<T extends object>(
  items: T[],
  item: T,
  idKey: keyof T,
): T[] {
  const id = item[idKey];
  return [...items.filter((candidate) => candidate[idKey] !== id), item];
}
