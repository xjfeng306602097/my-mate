import type {
  CompiledNodeRecord,
  NodeRunRecord,
  NodeStatus,
  RunPlanRecord,
  RunRecord,
  RuntimeGraphEdge,
  RuntimeGraphMarker,
  RuntimeGraphNode,
  RuntimeMonitoringSummary,
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

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(1, Math.floor(value));
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
  monitoring: RuntimeMonitoringSummary;
}): string[] {
  const waitingCount = input.nodes.filter((node) => node.status === "waiting_human").length;
  const blockedCount = input.nodes.filter((node) => node.status === "failed" || node.status === "cancelled").length;
  const skippedCount = input.nodes.filter((node) => node.status === "skipped").length;
  const completedCount = input.nodes.filter((node) => node.status === "completed").length;
  const lines = [
    `${input.nodes.length} node(s), ${input.edges.length} edge(s), ${input.workPackages.length} work package(s).`,
    `Runtime progress is ${input.monitoring.progress.percentComplete}% complete with ${input.monitoring.progress.frontierCount} node(s) in the active frontier.`,
    input.monitoring.checkpoints.detail,
    input.monitoring.cost.detail,
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

function buildRuntimeMonitoringSummary(input: {
  run: RunRecord;
  plan: RunPlanRecord;
  nodes: RuntimeGraphNode[];
  frontier: string[];
}): RuntimeMonitoringSummary {
  const totalNodes = input.nodes.length;
  const completedNodes = input.nodes.filter((node) => node.status === "completed").length;
  const skippedNodes = input.nodes.filter((node) => node.status === "skipped").length;
  const readyNodes = input.nodes.filter((node) => node.status === "ready").length;
  const runningNodes = input.nodes.filter((node) => node.status === "running").length;
  const waitingNodes = input.nodes.filter((node) => node.status === "waiting_human").length;
  const blockedNodes = input.nodes.filter((node) => node.status === "failed" || node.status === "cancelled").length;
  const activeNodes = runningNodes + waitingNodes;
  const progressValues = input.nodes.map((node) =>
    typeof node.progress?.percent === "number" && Number.isFinite(node.progress.percent)
      ? node.progress.percent
      : isDoneStatus(node.status)
        ? 100
        : 0,
  );
  const averageNodeProgress = clampPercent(
    progressValues.length
      ? progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length
      : 0,
  );
  const percentComplete = clampPercent(totalNodes ? ((completedNodes + skippedNodes) / totalNodes) * 100 : 0);
  const progressTone: RuntimeMonitoringSummary["progress"]["tone"] =
    blockedNodes > 0
      ? "danger"
      : waitingNodes > 0
        ? "warn"
        : input.run.status === "completed"
          ? "success"
          : activeNodes > 0 || readyNodes > 0
            ? "success"
            : "neutral";

  const approvalGateCount = input.nodes.filter((node) => node.markers.includes("approval_gate")).length;
  const humanInputGateCount = input.nodes.filter((node) => node.markers.includes("human_input_gate")).length;
  const blockedGateCount = input.nodes.filter(
    (node) =>
      (node.markers.includes("approval_gate") || node.markers.includes("human_input_gate")) &&
      (node.status === "failed" || node.status === "cancelled"),
  ).length;
  const nextCheckpointNode =
    input.nodes.find((node) => node.status === "waiting_human") ||
    input.nodes.find((node) => node.markers.includes("approval_gate") && node.status !== "completed") ||
    input.nodes.find((node) => node.markers.includes("human_input_gate") && node.status !== "completed") ||
    null;
  const checkpointTone: RuntimeMonitoringSummary["checkpoints"]["tone"] =
    blockedGateCount > 0 ? "danger" : waitingNodes > 0 ? "warn" : approvalGateCount + humanInputGateCount > 0 ? "success" : "neutral";

  const maxParallelNodes = asPositiveInteger(input.plan.policy_snapshot?.max_parallel_nodes);
  const activeCapacity = runningNodes + waitingNodes;
  const readyQueue = readyNodes;
  const capacityUtilization =
    maxParallelNodes && maxParallelNodes > 0
      ? Math.min(1, Number((activeCapacity / maxParallelNodes).toFixed(2)))
      : null;
  const timeoutBudgetSeconds = input.plan.compiled_nodes.reduce(
    (sum, node) => sum + (typeof node.timeout_seconds === "number" ? Math.max(0, node.timeout_seconds) : 0),
    0,
  );
  const remainingRetryBudget = input.plan.compiled_nodes.reduce((sum, node) => {
    const maxAttempts = typeof node.retry_policy.max_attempts === "number" ? node.retry_policy.max_attempts : 0;
    const attempt = typeof node.retry_policy.attempt === "number" ? node.retry_policy.attempt : 0;
    return sum + Math.max(0, maxAttempts - attempt);
  }, 0);
  const budgetPolicy = isPlainObject(input.plan.policy_snapshot?.budget_policy)
    ? input.plan.policy_snapshot.budget_policy
    : {};
  const budgetPolicyPresent = Object.keys(budgetPolicy).length > 0;
  const costPosture: RuntimeMonitoringSummary["cost"]["posture"] =
    blockedNodes > 0
      ? "blocked"
      : (capacityUtilization !== null && capacityUtilization >= 1 && readyQueue > 0) || waitingNodes > 0
        ? "attention"
        : "nominal";
  const costTone: RuntimeMonitoringSummary["cost"]["tone"] =
    costPosture === "blocked" ? "danger" : costPosture === "attention" ? "warn" : "success";

  return {
    progress: {
      totalNodes,
      completedNodes,
      skippedNodes,
      activeNodes,
      readyNodes,
      waitingNodes,
      blockedNodes,
      frontierCount: input.frontier.length,
      percentComplete,
      averageNodeProgress,
      label:
        blockedNodes > 0
          ? "Runtime blocked"
          : waitingNodes > 0
            ? "Waiting checkpoint"
            : input.run.status === "completed"
              ? "Runtime complete"
              : activeNodes > 0
                ? "Runtime active"
                : "Runtime ready",
      detail: `${completedNodes + skippedNodes}/${totalNodes} node(s) terminal, ${activeNodes} active, ${readyNodes} ready, ${blockedNodes} blocked.`,
      tone: progressTone,
    },
    checkpoints: {
      approvalGateCount,
      humanInputGateCount,
      waitingHumanCount: waitingNodes,
      blockedGateCount,
      nextCheckpointLabel: nextCheckpointNode?.name || null,
      nextActionLabel:
        waitingNodes > 0
          ? "Resolve waiting checkpoint"
          : nextCheckpointNode
            ? "Prepare checkpoint"
            : "Monitor run",
      detail:
        waitingNodes > 0
          ? `${waitingNodes} node(s) are waiting on human approval or input.`
          : approvalGateCount + humanInputGateCount > 0
            ? `${approvalGateCount + humanInputGateCount} human checkpoint node(s) are present in this run.`
            : "No human checkpoint is currently blocking runtime progress.",
      tone: checkpointTone,
    },
    cost: {
      label:
        costPosture === "blocked"
          ? "Cost posture blocked"
          : costPosture === "attention"
            ? "Cost posture needs attention"
            : "Cost posture nominal",
      detail: `Capacity ${activeCapacity}/${maxParallelNodes ?? "unbounded"} active, ${readyQueue} ready, timeout budget ${timeoutBudgetSeconds}s, retry budget ${remainingRetryBudget}.`,
      posture: costPosture,
      maxParallelNodes,
      activeCapacity,
      readyQueue,
      capacityUtilization,
      timeoutBudgetSeconds,
      remainingRetryBudget,
      budgetPolicyPresent,
      tone: costTone,
    },
  };
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
  const runtimeMonitoring = buildRuntimeMonitoringSummary({
    run: input.run,
    plan: input.plan,
    nodes,
    frontier,
  });

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
    runtimeMonitoring,
    summaryLines: buildSummaryLines({
      run: input.run,
      nodes,
      edges,
      frontier,
      workPackages,
      monitoring: runtimeMonitoring,
    }),
  };
}
