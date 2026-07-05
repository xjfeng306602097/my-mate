import type {
  RouteCompareChangeSet,
  RouteCompareKind,
  RouteCompareOption,
  RouteCompareSide,
  RouteCompareSummary,
  SessionMessageRecord,
  SessionRecord,
} from "./types.js";
import { isPlainObject } from "./utils.js";

type ComparableItem = {
  key: string;
  label: string;
  signature: string;
};

type ComparableRoute = {
  side: RouteCompareSide;
  nodes: ComparableItem[];
  edges: ComparableItem[];
  approvals: ComparableItem[];
  outputs: ComparableItem[];
  risks: ComparableItem[];
};

type RouteCompareBuildError = {
  ok: false;
  status: 400 | 404;
  code: string;
  message: string;
};

export type RouteCompareBuildResult =
  | {
      ok: true;
      summary: RouteCompareSummary;
    }
  | RouteCompareBuildError;

export type RouteCompareSelectorInput = {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  leftRevision?: number | null;
  leftOption?: RouteCompareOption | null;
  rightRevision?: number | null;
  rightOption?: RouteCompareOption | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value && !!value.trim()).map((value) => value.trim()))]
    .sort((left, right) => left.localeCompare(right));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function getPlanningRevision(message: SessionMessageRecord): number | null {
  if (message.kind !== "plan_card" && message.kind !== "plan_options_card") {
    return null;
  }
  return asNumber(message.content.revision);
}

function listPlanningMessages(messages: SessionMessageRecord[]): SessionMessageRecord[] {
  return messages.filter((message) => message.kind === "plan_options_card" || message.kind === "plan_card");
}

function getDefaultOptionForMessage(message: SessionMessageRecord): RouteCompareOption {
  if (message.kind === "plan_options_card" && message.content.selected_option === "alternative") {
    return "alternative";
  }
  if (message.kind === "plan_card" && message.content.option === "alternative") {
    return "alternative";
  }
  return "primary";
}

function getPlanningMessageByRevision(
  messages: SessionMessageRecord[],
  revision: number,
): SessionMessageRecord | null {
  return (
    messages.find(
      (message) =>
        message.kind === "plan_options_card" &&
        getPlanningRevision(message) === revision,
    ) ||
    messages.find(
      (message) =>
        message.kind === "plan_card" &&
        getPlanningRevision(message) === revision,
    ) ||
    null
  );
}

function extractOptionPayload(
  message: SessionMessageRecord,
  option: RouteCompareOption,
): Record<string, unknown> | null {
  if (message.kind === "plan_options_card") {
    const payload = message.content[option];
    return isPlainObject(payload) ? payload : null;
  }
  if (message.kind !== "plan_card") {
    return null;
  }
  const messageOption = getDefaultOptionForMessage(message);
  if (option !== messageOption) {
    return null;
  }
  return message.content;
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function extractOutputNames(value: unknown): string[] {
  if (!isPlainObject(value)) {
    return [];
  }

  const direct = [
    ...extractStringArray(value.expected_artifacts),
    ...extractStringArray(value.expected_outputs),
    ...extractStringArray(value.artifact_types),
    ...extractStringArray(value.outputs),
  ];
  const artifacts = Array.isArray(value.artifacts)
    ? value.artifacts
        .map((artifact) => {
          if (typeof artifact === "string") {
            return artifact;
          }
          if (!isPlainObject(artifact)) {
            return null;
          }
          return (
            asString(artifact.name) ||
            asString(artifact.type) ||
            asString(artifact.artifact_id)
          );
        })
        .filter((item): item is string => !!item)
    : [];

  return uniqueSorted([...direct, ...artifacts]);
}

function getNodeIdentity(node: Record<string, unknown>, index: number): string {
  return (
    asString(node.node_id) ||
    asString(node.id) ||
    asString(node.node_run_id) ||
    asString(node.name) ||
    `node-${index + 1}`
  );
}

function getNodeName(node: Record<string, unknown>, fallback: string): string {
  return asString(node.name) || fallback;
}

function formatNodeLabel(nodeId: string, nodeName: string): string {
  if (nodeName && nodeName !== nodeId) {
    return `${nodeName} (${nodeId})`;
  }
  return nodeName || nodeId;
}

function getNodeOutputContract(node: Record<string, unknown>): Record<string, unknown> | null {
  if (isPlainObject(node.output_contract)) {
    return node.output_contract;
  }
  const inputPayload = isPlainObject(node.input_payload) ? node.input_payload : null;
  const nodeConfig = isPlainObject(inputPayload?.node_config) ? inputPayload.node_config : null;
  return isPlainObject(nodeConfig?.output_contract) ? nodeConfig.output_contract : null;
}

function buildComparableNodes(compiledNodes: unknown): ComparableItem[] {
  if (!Array.isArray(compiledNodes)) {
    return [];
  }

  return compiledNodes
    .filter((node): node is Record<string, unknown> => isPlainObject(node))
    .map((node, index) => {
      const nodeId = getNodeIdentity(node, index);
      const nodeName = getNodeName(node, nodeId);
      const outputContract = getNodeOutputContract(node);
      const signature = stableSerialize({
        type: asString(node.type),
        agent_profile: asString(node.agent_profile),
        openclaw_agent_id: asString(node.openclaw_agent_id),
        allowed_skills: uniqueSorted(extractStringArray(node.allowed_skills)),
        allowed_tools: uniqueSorted(extractStringArray(node.allowed_tools)),
        approval_kind: asString(node.approval_kind),
        human_input_schema: isPlainObject(node.human_input_schema) ? node.human_input_schema : null,
        timeout_seconds: asNumber(node.timeout_seconds),
        parallelism_budget: asNumber(node.parallelism_budget) || asNumber(node.parallelism),
        output_contract: outputContract || {},
      });

      return {
        key: nodeId,
        label: formatNodeLabel(nodeId, nodeName),
        signature,
      };
    });
}

function buildComparableEdges(edges: unknown): ComparableItem[] {
  if (!Array.isArray(edges)) {
    return [];
  }

  return edges
    .filter((edge): edge is Record<string, unknown> => isPlainObject(edge))
    .map((edge, index) => {
      const from = asString(edge.from) || `unknown-from-${index + 1}`;
      const to = asString(edge.to) || `unknown-to-${index + 1}`;
      const label = asString(edge.label);
      return {
        key: `${from}->${to}`,
        label: `${from} -> ${to}${label ? ` (${label})` : ""}`,
        signature: stableSerialize({
          from,
          to,
          label,
          condition: isPlainObject(edge.condition) ? edge.condition : null,
        }),
      };
    });
}

function buildComparableApprovals(compiledNodes: unknown): ComparableItem[] {
  if (!Array.isArray(compiledNodes)) {
    return [];
  }

  const items: ComparableItem[] = [];
  compiledNodes
    .filter((node): node is Record<string, unknown> => isPlainObject(node))
    .forEach((node, index) => {
      const nodeId = getNodeIdentity(node, index);
      const nodeName = getNodeName(node, nodeId);
      const nodeType = asString(node.type);
      const approvalKind = asString(node.approval_kind);
      const humanInputSchema = isPlainObject(node.human_input_schema)
        ? node.human_input_schema
        : null;

      if (approvalKind || nodeType === "approval") {
        const gateLabel = approvalKind || "approval";
        items.push({
          key: `${nodeId}:approval`,
          label: `${formatNodeLabel(nodeId, nodeName)}: ${gateLabel}`,
          signature: stableSerialize({
            gate: "approval",
            approval_kind: approvalKind,
            node_type: nodeType,
          }),
        });
      }

      if (humanInputSchema || nodeType === "human_input") {
        items.push({
          key: `${nodeId}:human_input`,
          label: `${formatNodeLabel(nodeId, nodeName)}: human input`,
          signature: stableSerialize({
            gate: "human_input",
            schema: humanInputSchema || {},
            node_type: nodeType,
          }),
        });
      }
    });

  return items.sort((left, right) => left.label.localeCompare(right.label));
}

function buildComparableOutputs(candidatePlan: Record<string, unknown> | null): ComparableItem[] {
  if (!candidatePlan) {
    return [];
  }

  const compiledNodes = Array.isArray(candidatePlan.compiled_nodes)
    ? candidatePlan.compiled_nodes
    : [];
  const outputs = [
    ...extractOutputNames(candidatePlan.output_contract),
    ...extractStringArray(candidatePlan.requested_outputs),
  ];

  for (const node of compiledNodes) {
    if (!isPlainObject(node)) {
      continue;
    }
    outputs.push(...extractOutputNames(getNodeOutputContract(node)));
  }

  return uniqueSorted(outputs).map((output) => ({
    key: output,
    label: output,
    signature: output,
  }));
}

function buildComparableRisks(validation: Record<string, unknown> | null): ComparableItem[] {
  if (!validation) {
    return [];
  }

  const warningItems = extractStringArray(validation.warnings);
  const details = Array.isArray(validation.details)
    ? validation.details
        .filter((detail): detail is Record<string, unknown> => isPlainObject(detail))
        .map((detail) => asString(detail.message))
        .filter((item): item is string => !!item)
    : [];
  const fallback =
    validation.passed === false && warningItems.length === 0 && details.length === 0
      ? ["Validation did not pass."]
      : [];

  return uniqueSorted([...warningItems, ...details, ...fallback]).map((risk) => ({
    key: risk,
    label: risk,
    signature: risk,
  }));
}

function buildRouteFromMessage(input: {
  sessionId: string;
  message: SessionMessageRecord;
  option: RouteCompareOption;
}): ComparableRoute | null {
  const optionPayload = extractOptionPayload(input.message, input.option);
  if (!optionPayload) {
    return null;
  }

  const revision = getPlanningRevision(input.message);
  const candidatePlan = isPlainObject(optionPayload.candidate_plan)
    ? optionPayload.candidate_plan
    : null;
  const compiledNodes = Array.isArray(candidatePlan?.compiled_nodes)
    ? candidatePlan.compiled_nodes
    : [];
  const edges = Array.isArray(candidatePlan?.edges) ? candidatePlan.edges : [];
  const validation = isPlainObject(optionPayload.validation) ? optionPayload.validation : null;
  const nodes = buildComparableNodes(compiledNodes);
  const comparableEdges = buildComparableEdges(edges);
  const approvals = buildComparableApprovals(compiledNodes);
  const outputs = buildComparableOutputs(candidatePlan);
  const risks = buildComparableRisks(validation);
  const templateId =
    asString(optionPayload.template_id) ||
    asString(candidatePlan?.template_id) ||
    asString(input.message.content.template_id);
  const templateName =
    asString(optionPayload.template_name) ||
    asString(candidatePlan?.template_name) ||
    templateId;
  const label = `v${revision ?? "?"} / ${input.option}`;

  return {
    side: {
      revision,
      option: input.option,
      messageId: input.message.message_id,
      templateId,
      templateName,
      nodeCount: nodes.length,
      edgeCount: comparableEdges.length,
      approvalGateCount: approvals.length,
      outputCount: outputs.length,
      warningCount: risks.length,
      label,
    },
    nodes,
    edges: comparableEdges,
    approvals,
    outputs,
    risks,
  };
}

function resolveRoute(input: {
  sessionId: string;
  planningMessages: SessionMessageRecord[];
  revision: number | null;
  option: RouteCompareOption | null;
}): ComparableRoute | null {
  const message =
    typeof input.revision === "number"
      ? getPlanningMessageByRevision(input.planningMessages, input.revision)
      : input.planningMessages[input.planningMessages.length - 1] || null;
  if (!message) {
    return null;
  }

  const option = input.option || getDefaultOptionForMessage(message);
  return buildRouteFromMessage({
    sessionId: input.sessionId,
    message,
    option,
  });
}

function hasAlternative(message: SessionMessageRecord | null): boolean {
  return !!(
    message &&
    message.kind === "plan_options_card" &&
    isPlainObject(message.content.alternative)
  );
}

function compareItemSets(leftItems: ComparableItem[], rightItems: ComparableItem[]): RouteCompareChangeSet {
  const leftByKey = new Map(leftItems.map((item) => [item.key, item]));
  const rightByKey = new Map(rightItems.map((item) => [item.key, item]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let unchangedCount = 0;

  for (const right of rightItems) {
    const left = leftByKey.get(right.key);
    if (!left) {
      added.push(right.label);
      continue;
    }
    if (left.signature !== right.signature) {
      changed.push(right.label);
      continue;
    }
    unchangedCount += 1;
  }

  for (const left of leftItems) {
    if (!rightByKey.has(left.key)) {
      removed.push(left.label);
    }
  }

  return {
    added: uniqueSorted(added),
    removed: uniqueSorted(removed),
    changed: uniqueSorted(changed),
    unchangedCount,
  };
}

function countChanges(changeSet: RouteCompareChangeSet): number {
  return changeSet.added.length + changeSet.removed.length + changeSet.changed.length;
}

function summarizeChangeSet(label: string, changeSet: RouteCompareChangeSet): string | null {
  const parts: string[] = [];
  if (changeSet.added.length > 0) {
    parts.push(`${changeSet.added.length} added`);
  }
  if (changeSet.removed.length > 0) {
    parts.push(`${changeSet.removed.length} removed`);
  }
  if (changeSet.changed.length > 0) {
    parts.push(`${changeSet.changed.length} changed`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `${label}: ${parts.join(", ")}.`;
}

function inferCompareKind(input: {
  session: SessionRecord;
  left: ComparableRoute;
  right: ComparableRoute;
}): RouteCompareKind {
  if (
    input.left.side.revision === input.right.side.revision &&
    input.left.side.option === input.right.side.option
  ) {
    return "same_route";
  }
  if (input.left.side.revision === input.right.side.revision) {
    return "option";
  }
  if (
    typeof input.session.confirmed_plan_revision === "number" &&
    input.left.side.revision === input.session.confirmed_plan_revision &&
    input.left.side.option === (input.session.confirmed_plan_option || "primary")
  ) {
    return "confirmed_vs_latest";
  }
  return "revision";
}

function buildRecommendation(input: {
  changedNodes: RouteCompareChangeSet;
  changedApprovals: RouteCompareChangeSet;
  changedRisks: RouteCompareChangeSet;
  right: RouteCompareSide;
}): RouteCompareSummary["recommendation"] {
  if (countChanges(input.changedApprovals) > 0) {
    return {
      label: "Review gate changes",
      detail: "The route changes human approval or input gates, so confirm the control points before execution.",
      tone: "warn",
    };
  }
  if (input.changedRisks.added.length > 0 || input.right.warningCount > 0) {
    return {
      label: "Review new risk signals",
      detail: "The target route carries validation warnings or changed risk messages.",
      tone: "warn",
    };
  }
  if (countChanges(input.changedNodes) > 0) {
    return {
      label: "Review route shape",
      detail: "The target route changes the executable node set or node bindings.",
      tone: "neutral",
    };
  }
  return {
    label: "No material delta",
    detail: "The compared route endpoints have no material workflow differences.",
    tone: "success",
  };
}

function buildSummaryLines(input: {
  left: ComparableRoute;
  right: ComparableRoute;
  changedNodes: RouteCompareChangeSet;
  changedEdges: RouteCompareChangeSet;
  changedApprovals: RouteCompareChangeSet;
  changedOutputs: RouteCompareChangeSet;
  changedRisks: RouteCompareChangeSet;
}): string[] {
  const lines = [`Comparing ${input.left.side.label} against ${input.right.side.label}.`];
  if (input.left.side.templateId !== input.right.side.templateId) {
    lines.push(
      `Template changed from ${input.left.side.templateName || input.left.side.templateId || "none"} to ${input.right.side.templateName || input.right.side.templateId || "none"}.`,
    );
  }

  const materialLines = [
    summarizeChangeSet("Nodes", input.changedNodes),
    summarizeChangeSet("Edges", input.changedEdges),
    summarizeChangeSet("Approval and human gates", input.changedApprovals),
    summarizeChangeSet("Outputs", input.changedOutputs),
    summarizeChangeSet("Risks and warnings", input.changedRisks),
  ].filter((line): line is string => !!line);

  if (materialLines.length === 0 && lines.length === 1) {
    lines.push("No material route changes detected.");
  } else {
    lines.push(...materialLines);
  }

  return lines;
}

export function buildRouteCompareSummary(input: RouteCompareSelectorInput): RouteCompareBuildResult {
  const planningMessages = listPlanningMessages(input.messages);
  if (planningMessages.length === 0) {
    return {
      ok: false,
      status: 404,
      code: "route_compare_unavailable",
      message: "No route revisions are available for comparison.",
    };
  }

  const latestMessage = planningMessages[planningMessages.length - 1] || null;
  const previousMessage = planningMessages.length > 1 ? planningMessages[planningMessages.length - 2] : null;

  let leftRevision = input.leftRevision ?? null;
  let rightRevision = input.rightRevision ?? null;
  let leftOption = input.leftOption ?? null;
  let rightOption = input.rightOption ?? null;

  const explicitSelector =
    typeof input.leftRevision === "number" ||
    typeof input.rightRevision === "number" ||
    !!input.leftOption ||
    !!input.rightOption;

  if (!explicitSelector) {
    if (
      typeof input.session.confirmed_plan_revision === "number" &&
      input.session.confirmed_plan_option
    ) {
      leftRevision = input.session.confirmed_plan_revision;
      leftOption = input.session.confirmed_plan_option;
      rightRevision = getPlanningRevision(latestMessage as SessionMessageRecord);
      rightOption = latestMessage ? getDefaultOptionForMessage(latestMessage) : "primary";
    } else if (hasAlternative(latestMessage)) {
      leftRevision = getPlanningRevision(latestMessage as SessionMessageRecord);
      rightRevision = leftRevision;
      leftOption = "primary";
      rightOption = "alternative";
    } else if (previousMessage && latestMessage) {
      leftRevision = getPlanningRevision(previousMessage);
      rightRevision = getPlanningRevision(latestMessage);
      leftOption = getDefaultOptionForMessage(previousMessage);
      rightOption = getDefaultOptionForMessage(latestMessage);
    }
  }

  const right = resolveRoute({
    sessionId: input.session.session_id,
    planningMessages,
    revision: rightRevision,
    option: rightOption,
  });
  const left = resolveRoute({
    sessionId: input.session.session_id,
    planningMessages,
    revision: leftRevision,
    option: leftOption,
  }) || right;

  if (!left || !right) {
    return {
      ok: false,
      status: 404,
      code: "route_compare_target_not_found",
      message: "Requested route revision or option was not found.",
    };
  }

  const changedNodes = compareItemSets(left.nodes, right.nodes);
  const changedEdges = compareItemSets(left.edges, right.edges);
  const changedApprovals = compareItemSets(left.approvals, right.approvals);
  const changedOutputs = compareItemSets(left.outputs, right.outputs);
  const changedRisks = compareItemSets(left.risks, right.risks);

  return {
    ok: true,
    summary: {
      sessionId: input.session.session_id,
      comparisonKind: inferCompareKind({ session: input.session, left, right }),
      left: left.side,
      right: right.side,
      changedNodes,
      changedEdges,
      changedApprovals,
      changedOutputs,
      changedRisks,
      summaryLines: buildSummaryLines({
        left,
        right,
        changedNodes,
        changedEdges,
        changedApprovals,
        changedOutputs,
        changedRisks,
      }),
      recommendation: buildRecommendation({
        changedNodes,
        changedApprovals,
        changedRisks,
        right: right.side,
      }),
    },
  };
}
