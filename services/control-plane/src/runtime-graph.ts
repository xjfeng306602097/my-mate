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
import { normalizeCompiledWorkPackage } from "./work-package.js";
import type { NodeHandoffRecord } from "./runtime/node-handoff-store.js";
import { isFailureRoutingPort } from "./runtime/edge-condition.js";

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
  recoveredFailures: Set<string>;
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
  if (input.status === "failed" && input.recoveredFailures.has(input.node.node_run_id)) {
    markers.push("recovered_failure");
  } else if (input.status === "failed" || input.status === "cancelled") {
    markers.push("blocked");
  }
  if (input.status === "skipped") {
    markers.push("skipped");
  }
  if (
    isDoneStatus(input.status) ||
    input.status === "cancelled" ||
    input.recoveredFailures.has(input.node.node_run_id)
  ) {
    markers.push("terminal");
  }
  return [...new Set(markers)];
}

function buildGraphNodes(input: {
  plan: RunPlanRecord;
  nodeRuns: NodeRunRecord[];
  generatedAt: string;
  recoveredFailures: Set<string>;
}): RuntimeGraphNode[] {
  const nodeRunById = new Map(input.nodeRuns.map((nodeRun) => [nodeRun.node_run_id, nodeRun]));
  const frontier = new Set(input.plan.frontier);

  return input.plan.compiled_nodes.map((node, index) => {
    const nodeRun = nodeRunById.get(node.node_run_id) || null;
    const status = mergeNodeStatus(node, nodeRun);
    const workPackage = normalizeCompiledWorkPackage(node, index);
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
      agentId: node.agent_id ?? node.agent_binding_snapshot?.agent_id ?? null,
      runtimeAgentRef: node.runtime_agent_ref ?? null,
      approvalKind: node.approval_kind,
      humanInputRequired: !!node.human_input_schema || node.type === "human_input",
      expectedArtifacts: extractExpectedArtifacts(node),
      workPackageKey: workPackage.key,
      workPackageLabel: workPackage.label,
      workPackageOrder: workPackage.order,
      workPackageIdentitySource: workPackage.identity_source,
      markers: buildNodeMarkers({
        node,
        status,
        frontier,
        recoveredFailures: input.recoveredFailures,
      }),
    };
  });
}

function buildGraphEdges(input: {
  plan: RunPlanRecord;
  graphNodes: RuntimeGraphNode[];
  handoffs: NodeHandoffRecord[];
}): RuntimeGraphEdge[] {
  const nodeByNodeId = new Map(input.graphNodes.map((node) => [node.nodeId, node]));

  return input.plan.edges.map((edge, index) => {
    const fromNode = nodeByNodeId.get(edge.from) || null;
    const toNode = nodeByNodeId.get(edge.to) || null;
    const fromDone = !!fromNode && (
      isDoneStatus(fromNode.status) || fromNode.markers.includes("recovered_failure")
    );
    const toReadyOrActive = !!toNode && ["ready", "running", "waiting_human"].includes(toNode.status);
    const toBlocked = !!toNode && isBlockedStatus(toNode.status);
    const edgeKey = `${edge.from}:${index}:${edge.to}`;
    const sourceHandoffs = input.handoffs.filter(
      (handoff) => handoff.node_run_id === fromNode?.nodeRunId,
    );
    const evaluated = sourceHandoffs.some((handoff) =>
      handoff.routing_decisions?.some((decision) => decision.edge_key === edgeKey),
    );
    const routed = sourceHandoffs.some((handoff) =>
      handoff.routing_decisions?.some(
        (decision) => decision.edge_key === edgeKey && decision.matched,
      ) || (
        !handoff.routing_decisions?.length &&
        !!toNode &&
        handoff.routed_node_run_ids.includes(toNode.nodeRunId)
      ),
    );
    const status: RuntimeGraphEdge["status"] = routed
      ? toReadyOrActive ? "active" : "satisfied"
      : evaluated
        ? "blocked"
        : fromDone
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
    const completedCount = groupNodes.filter(
      (node) => isDoneStatus(node.status) || node.markers.includes("recovered_failure"),
    ).length;
    const blockedCount = groupNodes.filter(
      (node) => node.status === "waiting_human" || node.markers.includes("blocked"),
    ).length;
    const allDone = groupNodes.length > 0 && groupNodes.every(
      (node) => isDoneStatus(node.status) || node.markers.includes("recovered_failure"),
    );
    const status: RuntimeGraphWorkPackage["status"] =
      blockedCount > 0
        ? "blocked"
        : activeCount > 0 || readyCount > 0
          ? "active"
          : allDone
            ? "done"
            : "pending";
    const identitySource: RuntimeGraphWorkPackage["identitySource"] =
      groupNodes.some(
        (node) => node.workPackageIdentitySource === "legacy_inferred",
      )
        ? "legacy_inferred"
        : groupNodes.some(
              (node) => node.workPackageIdentitySource === "compiler_default",
            )
          ? "compiler_default"
          : "declared";

    return {
      key,
      label,
      order: Math.min(...groupNodes.map((node) => node.workPackageOrder)),
      identitySource,
      nodeRunIds: groupNodes.map((node) => node.nodeRunId),
      status,
      readyCount,
      activeCount,
      completedCount,
      blockedCount,
    };
  }).sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
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
  const blockedCount = input.nodes.filter((node) => node.markers.includes("blocked")).length;
  const recoveredCount = input.nodes.filter((node) => node.markers.includes("recovered_failure")).length;
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
  if (recoveredCount > 0) {
    lines.push(`${recoveredCount} failed node(s) were recovered by downstream routing.`);
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
  const recoveredNodes = input.nodes.filter((node) => node.markers.includes("recovered_failure")).length;
  const readyNodes = input.nodes.filter((node) => node.status === "ready").length;
  const runningNodes = input.nodes.filter((node) => node.status === "running").length;
  const waitingNodes = input.nodes.filter((node) => node.status === "waiting_human").length;
  const blockedNodes = input.nodes.filter((node) => node.markers.includes("blocked")).length;
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
  const percentComplete = clampPercent(
    totalNodes ? ((completedNodes + skippedNodes + recoveredNodes) / totalNodes) * 100 : 0,
  );
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
      detail: `${completedNodes + skippedNodes + recoveredNodes}/${totalNodes} node(s) terminal, ${activeNodes} active, ${readyNodes} ready, ${blockedNodes} blocked.`,
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
  handoffs?: NodeHandoffRecord[];
}): RuntimeGraphSummary {
  const generatedAt = nowIso();
  const handoffs = input.handoffs || [];
  const recoveredFailures = new Set(
    handoffs
      .filter((handoff) =>
        handoff.routed_node_run_ids.length > 0 &&
        (handoff.source_outcome === "failed" || isFailureRoutingPort(handoff.port))
      )
      .map((handoff) => handoff.node_run_id),
  );
  const nodes = buildGraphNodes({
    plan: input.plan,
    nodeRuns: input.nodeRuns,
    generatedAt,
    recoveredFailures,
  });
  const edges = buildGraphEdges({
    plan: input.plan,
    graphNodes: nodes,
    handoffs,
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
