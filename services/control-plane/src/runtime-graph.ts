import type {
  CompiledNodeRecord,
  NodeRunRecord,
  NodeStatus,
  RunPlanRecord,
  RunRecord,
  RuntimeGraphEdge,
  RuntimeGraphMarker,
  RuntimeGraphNode,
  RuntimeGraphSummary,
  RuntimeGraphWorkPackage,
} from "./types.js";
import { isPlainObject, nowIso } from "./utils.js";

type WorkPackagePresentation = {
  key: string;
  label: string;
};

const NODE_STATUSES: NodeStatus[] = [
  "pending",
  "ready",
  "running",
  "waiting_human",
  "completed",
  "failed",
  "skipped",
  "cancelled",
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value && !!value.trim()).map((value) => value.trim()))];
}

function extractExpectedArtifacts(node: CompiledNodeRecord): string[] {
  const expectedArtifacts = isPlainObject(node.output_contract) && Array.isArray(node.output_contract.expected_artifacts)
    ? node.output_contract.expected_artifacts
    : [];
  return expectedArtifacts.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function inferWorkPackage(node: CompiledNodeRecord): WorkPackagePresentation {
  const name = `${node.name} ${node.node_id} ${node.type}`.toLowerCase();
  if (node.approval_kind || node.type === "approval") {
    return {
      key: "review",
      label: "Review and approval",
    };
  }
  if (node.human_input_schema || node.type === "human_input") {
    return {
      key: "human-input",
      label: "Human input",
    };
  }
  if (/deliver|final|handoff|publish|notify|send/.test(name)) {
    return {
      key: "deliver",
      label: "Delivery",
    };
  }
  if (/collect|research|context|gather|scan|intake/.test(name)) {
    return {
      key: "research",
      label: "Context collection",
    };
  }
  if (/draft|write|compose|generate|summar/i.test(name)) {
    return {
      key: "draft",
      label: "Drafting",
    };
  }
  if (extractExpectedArtifacts(node).length > 0) {
    return {
      key: "deliver",
      label: "Delivery",
    };
  }
  return {
    key: "other",
    label: "Execution",
  };
}

function emptyProgress(status: NodeStatus, timestamp: string) {
  return {
    percent: status === "completed" || status === "skipped" ? 100 : 0,
    message: status === "ready" ? "Ready for dispatch" : "Waiting for dependencies",
    updated_at: timestamp,
  };
}

function isBlockedStatus(status: NodeStatus): boolean {
  return status === "failed" || status === "cancelled" || status === "waiting_human";
}

function isDoneStatus(status: NodeStatus): boolean {
  return status === "completed" || status === "skipped";
}

function mergeNodeStatus(node: CompiledNodeRecord, nodeRun: NodeRunRecord | null): NodeStatus {
  return nodeRun?.status || node.status;
}

function buildNodeMarkers(input: {
  node: CompiledNodeRecord;
  status: NodeStatus;
  frontier: Set<string>;
}): RuntimeGraphMarker[] {
  const markers: RuntimeGraphMarker[] = [];
  if (input.frontier.has(input.node.node_run_id)) {
    markers.push("active_frontier");
  }
  if (input.status === "ready") {
    markers.push("ready");
  }
  if (input.status === "waiting_human") {
    markers.push("waiting_human");
  }
  if (input.node.approval_kind || input.node.type === "approval") {
    markers.push("approval_gate");
  }
  if (input.node.human_input_schema || input.node.type === "human_input") {
    markers.push("human_input_gate");
  }
  if (input.status === "failed" || input.status === "cancelled") {
    markers.push("blocked");
  }
  if (input.status === "skipped") {
    markers.push("skipped");
  }
  if (isDoneStatus(input.status) || input.status === "cancelled") {
    markers.push("terminal");
  }
  return [...new Set(markers)];
}

function buildGraphNodes(input: {
  plan: RunPlanRecord;
  nodeRuns: NodeRunRecord[];
  generatedAt: string;
}): RuntimeGraphNode[] {
  const nodeRunById = new Map(input.nodeRuns.map((nodeRun) => [nodeRun.node_run_id, nodeRun]));
  const frontier = new Set(input.plan.frontier);

  return input.plan.compiled_nodes.map((node) => {
    const nodeRun = nodeRunById.get(node.node_run_id) || null;
    const status = mergeNodeStatus(node, nodeRun);
    const workPackage = inferWorkPackage(node);
    return {
      nodeRunId: node.node_run_id,
      nodeId: node.node_id,
      name: node.name,
      type: node.type,
      status,
      progress: nodeRun?.progress || emptyProgress(status, input.generatedAt),
      attempt: nodeRun?.attempt ?? node.retry_policy.attempt,
      startedAt: nodeRun?.started_at || null,
      finishedAt: nodeRun?.finished_at || null,
      agentProfile: node.agent_profile,
      openclawAgentId: node.openclaw_agent_id,
      approvalKind: node.approval_kind,
      humanInputRequired: !!node.human_input_schema || node.type === "human_input",
      expectedArtifacts: extractExpectedArtifacts(node),
      workPackageKey: workPackage.key,
      workPackageLabel: workPackage.label,
      markers: buildNodeMarkers({
        node,
        status,
        frontier,
      }),
    };
  });
}

function buildGraphEdges(input: {
  plan: RunPlanRecord;
  graphNodes: RuntimeGraphNode[];
}): RuntimeGraphEdge[] {
  const nodeByNodeId = new Map(input.graphNodes.map((node) => [node.nodeId, node]));

  return input.plan.edges.map((edge) => {
    const fromNode = nodeByNodeId.get(edge.from) || null;
    const toNode = nodeByNodeId.get(edge.to) || null;
    const fromDone = !!fromNode && isDoneStatus(fromNode.status);
    const toReadyOrActive = !!toNode && ["ready", "running", "waiting_human"].includes(toNode.status);
    const toBlocked = !!toNode && isBlockedStatus(toNode.status);
    const status: RuntimeGraphEdge["status"] = fromDone
      ? "satisfied"
      : toBlocked
        ? "blocked"
        : toReadyOrActive
          ? "active"
          : "pending";

    return {
      fromNodeId: edge.from,
      toNodeId: edge.to,
      fromNodeRunId: fromNode?.nodeRunId || null,
      toNodeRunId: toNode?.nodeRunId || null,
      label: edge.label,
      condition: isPlainObject(edge.condition) ? edge.condition : null,
      status,
    };
  });
}

function buildStatusCounts(nodes: RuntimeGraphNode[]): Record<NodeStatus, number> {
  const counts = Object.fromEntries(NODE_STATUSES.map((status) => [status, 0])) as Record<NodeStatus, number>;
  for (const node of nodes) {
    counts[node.status] += 1;
  }
  return counts;
}

function buildWorkPackages(nodes: RuntimeGraphNode[]): RuntimeGraphWorkPackage[] {
  const groups = new Map<string, RuntimeGraphNode[]>();
  for (const node of nodes) {
    const current = groups.get(node.workPackageKey) || [];
    current.push(node);
    groups.set(node.workPackageKey, current);
  }

  return [...groups.entries()].map(([key, groupNodes]) => {
    const label = groupNodes[0]?.workPackageLabel || key;
    const readyCount = groupNodes.filter((node) => node.status === "ready").length;
    const activeCount = groupNodes.filter((node) => node.status === "running" || node.status === "waiting_human").length;
    const completedCount = groupNodes.filter((node) => isDoneStatus(node.status)).length;
    const blockedCount = groupNodes.filter((node) => isBlockedStatus(node.status)).length;
    const allDone = groupNodes.length > 0 && groupNodes.every((node) => isDoneStatus(node.status));
    const status: RuntimeGraphWorkPackage["status"] =
      blockedCount > 0
        ? "blocked"
        : activeCount > 0 || readyCount > 0
          ? "active"
          : allDone
            ? "done"
            : "pending";

    return {
      key,
      label,
      nodeRunIds: groupNodes.map((node) => node.nodeRunId),
      status,
      readyCount,
      activeCount,
      completedCount,
      blockedCount,
    };
  });
}

function buildSummaryLines(input: {
  run: RunRecord;
  nodes: RuntimeGraphNode[];
  edges: RuntimeGraphEdge[];
  frontier: string[];
  workPackages: RuntimeGraphWorkPackage[];
}): string[] {
  const waitingCount = input.nodes.filter((node) => node.status === "waiting_human").length;
  const blockedCount = input.nodes.filter((node) => node.status === "failed" || node.status === "cancelled").length;
  const skippedCount = input.nodes.filter((node) => node.status === "skipped").length;
  const completedCount = input.nodes.filter((node) => node.status === "completed").length;
  const lines = [
    `${input.nodes.length} node(s), ${input.edges.length} edge(s), ${input.workPackages.length} work package(s).`,
  ];
  if (input.frontier.length > 0) {
    lines.push(`${input.frontier.length} node(s) are currently in the active frontier.`);
  }
  if (waitingCount > 0) {
    lines.push(`${waitingCount} node(s) are waiting on human approval or input.`);
  }
  if (blockedCount > 0) {
    lines.push(`${blockedCount} node(s) are blocked by failure or cancellation.`);
  }
  if (skippedCount > 0) {
    lines.push(`${skippedCount} node(s) have been skipped.`);
  }
  if (input.run.status === "completed") {
    lines.push(`${completedCount} node(s) completed in the final run topology.`);
  }
  return lines;
}

export function buildRuntimeGraphSummary(input: {
  run: RunRecord;
  plan: RunPlanRecord;
  nodeRuns: NodeRunRecord[];
}): RuntimeGraphSummary {
  const generatedAt = nowIso();
  const nodes = buildGraphNodes({
    plan: input.plan,
    nodeRuns: input.nodeRuns,
    generatedAt,
  });
  const edges = buildGraphEdges({
    plan: input.plan,
    graphNodes: nodes,
  });
  const frontier = uniqueStrings(
    input.plan.frontier.filter((nodeRunId) => nodes.some((node) => node.nodeRunId === nodeRunId)),
  );
  const workPackages = buildWorkPackages(nodes);

  return {
    runId: input.run.run_id,
    templateId: input.run.template_id,
    templateVersion: input.run.template_version,
    runStatus: input.run.status,
    intent: input.run.intent,
    generatedAt,
    nodes,
    edges,
    frontier,
    statusCounts: buildStatusCounts(nodes),
    markers: {
      activeFrontier: frontier,
      waitingHuman: nodes
        .filter((node) => node.markers.includes("waiting_human"))
        .map((node) => node.nodeRunId),
      blocked: nodes
        .filter((node) => node.markers.includes("blocked"))
        .map((node) => node.nodeRunId),
      skipped: nodes
        .filter((node) => node.markers.includes("skipped"))
        .map((node) => node.nodeRunId),
    },
    workPackages,
    summaryLines: buildSummaryLines({
      run: input.run,
      nodes,
      edges,
      frontier,
      workPackages,
    }),
  };
}
