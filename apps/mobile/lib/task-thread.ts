import { groupValidation } from "@/lib/planner";
import type {
  MissionDetailResponse,
  PlannerValidationResult,
  RouteCompareSummary,
  RuntimeGraphSummary,
  SessionDetailResponse,
  SessionMessageKind,
  SessionMessageRecord,
  SessionSummary,
} from "@/lib/types";

type ThreadDetail = SessionDetailResponse | MissionDetailResponse;

export type PlanOptionKey = "primary" | "alternative";
export type ThreadTone = "neutral" | "warn" | "success" | "danger";

export type ValidationStateSummary = {
  label: string;
  tone: ThreadTone;
  warningCount: number;
  hasRequiredInputRisk: boolean;
  hasRegistryRisk: boolean;
  hasGraphRisk: boolean;
  isReadyForStrictRun: boolean;
  runHint: string;
};

export type ThreadOverview = {
  stageLabel: string;
  stageTone: ThreadTone;
  headline: string;
  detail: string;
  nextStepLabel: string;
  nextStepDetail: string;
  pendingApprovalCount: number;
  pendingHumanInputCount: number;
  artifactCount: number;
  latestRunId: string | null;
  latestSubtask: {
    nodeName: string;
    status: string | null;
    progressPercent: number;
    progressMessage: string | null;
  } | null;
  autoRefreshRecommended: boolean;
};

export type NarrativeStep = {
  key: string;
  title: string;
  detail: string;
  tone: ThreadTone;
  status: "done" | "active" | "pending";
};

export type OrchestratorBriefingItem = {
  key: string;
  label: string;
  detail: string;
  tone: ThreadTone;
};

export type OrchestratorBriefing = {
  title: string;
  summary: string;
  tone: ThreadTone;
  items: OrchestratorBriefingItem[];
};

export type ExecutionNarrativeBeat = {
  key: string;
  title: string;
  detail: string;
  tone: ThreadTone;
  status: "done" | "active" | "pending";
};

export type ComposerDirectiveChip = {
  key: string;
  label: string;
  instruction: string;
  recommended: boolean;
};

export type ThreadMessageProjection = {
  visibleMessages: SessionMessageRecord[];
  hiddenPlanningRevisionCount: number;
  hiddenPlannerMessageCount: number;
};

export type ConversationProjection = {
  conversationMessages: SessionMessageRecord[];
  hiddenNonConversationMessageCount: number;
};

export type PlanOptionSummary = {
  optionKey: PlanOptionKey;
  templateName: string;
  validationSummary: ValidationStateSummary;
  recommendationReason: string | null;
  nodeCount: number;
  readyFrontierCount: number;
  warningGroups: Array<{
    key: string;
    title: string;
    tone: ThreadTone;
    items: string[];
  }>;
  checklist: Record<string, unknown> | null;
  candidatePlan: Record<string, unknown> | null;
  content: Record<string, unknown>;
  confirmed: boolean;
  selectedRevise: boolean;
};

export type PlanOptionsNarrative = {
  revision: number;
  sourceRevision: number | null;
  sourceOption: PlanOptionKey | null;
  selectedOption: PlanOptionKey;
  focusedOption: PlanOptionKey;
  focusedTemplateName: string;
  comparisonSummary: string;
  summaries: PlanOptionSummary[];
};

export type RouteCompareNarrativeGroup = {
  key: string;
  label: string;
  count: number;
  items: string[];
  tone: ThreadTone;
};

export type RouteCompareNarrative = {
  title: string;
  detail: string;
  tone: ThreadTone;
  leftLabel: string;
  rightLabel: string;
  summaryLines: string[];
  groups: RouteCompareNarrativeGroup[];
};

export type RuntimeGraphNarrative = {
  title: string;
  detail: string;
  tone: ThreadTone;
  activeNodeLabels: string[];
  blockedNodeLabels: string[];
  packageLabels: string[];
};

export type OrchestratorTurn = {
  key: string;
  phase:
    | "understand"
    | "draft"
    | "compare"
    | "confirm"
    | "execute"
    | "waiting"
    | "deliver";
  title: string;
  detail: string;
  userRead: string | null;
  workspaceImpact: string | null;
  nextActionLabel: string | null;
  nextActionDetail: string | null;
  generatedOutputs: string[];
  tone: ThreadTone;
  status: "done" | "active" | "pending";
};

export type WorkPackage = {
  key: string;
  title: string;
  summary: string;
  status: "done" | "active" | "pending" | "blocked";
  tone: ThreadTone;
  nodeCount: number;
  readyCount: number;
  primaryAgentLabel: string | null;
  artifactExpectation: string | null;
  blocker: string | null;
  activeNodeName: string | null;
};

export type WorkspaceArtifactSurface = {
  key: string;
  title: string;
  summary: string;
  tone: ThreadTone;
  chips: string[];
  detailLines: string[];
};

export type MissionOutput = {
  key: string;
  title: string;
  summary: string;
  status: "requested" | "prepared" | "in_progress" | "returned";
  tone: ThreadTone;
  source: "mission_spec" | "pipeline" | "runtime" | "artifact";
  pipelineKeys: string[];
  artifactMessageIds: string[];
  detailLines: string[];
};

export type MissionWorkspaceStageKey =
  | "briefing"
  | "work"
  | "plan"
  | "execution"
  | "thread";

export const FALLBACK_MISSION_WORKSPACE_CONTRACT_VERSION = 0;

export type MissionStageSummary = {
  key: MissionWorkspaceStageKey;
  label: string;
  title: string;
  detail: string;
  metric: string;
  tone: ThreadTone;
  status: "done" | "active" | "pending";
};

export type MissionRouteSummary = {
  activeRevision: number | null;
  activeOption: PlanOptionKey | null;
  latestRevision: number | null;
  confirmedRevision: number | null;
  confirmedOption: PlanOptionKey | null;
  selectedTemplateId: string | null;
  selectedTemplateName: string | null;
  alternativeAvailable: boolean;
  stale: boolean;
  staleReason: string | null;
};

export type MissionPipelineSummary = {
  total: number;
  ready: number;
  active: number;
  blocked: number;
  completed: number;
  primaryAgentLabels: string[];
};

export type MissionCheckpointSummary = {
  total: number;
  completed: number;
  active: number;
  pending: number;
  labels: string[];
};

export type MissionRevisionLineageSummary = {
  sourceRevision: number | null;
  sourceOption: PlanOptionKey | null;
  latestRevision: number | null;
  confirmedRevision: number | null;
  confirmedOption: PlanOptionKey | null;
};

export type MissionSpecSummary = {
  objective: string | null;
  sourceBrief: string | null;
  constraints: string[];
  requestedOutputs: string[];
  openQuestions: string[];
  decisionFocus: string | null;
  route: MissionRouteSummary;
  pipelineSummary: MissionPipelineSummary;
  checkpointSummary: MissionCheckpointSummary;
  revisionLineage: MissionRevisionLineageSummary;
};

export type MissionPipeline = {
  key: string;
  title: string;
  summary: string;
  status: WorkPackage["status"];
  tone: ThreadTone;
  nodeCount: number;
  readyCount: number;
  primaryAgentLabel: string | null;
  artifactExpectation: string | null;
  blocker: string | null;
  activeNodeName: string | null;
};

export type MissionCheckpoint = {
  key: string;
  label: string;
  detail: string;
  tone: ThreadTone;
  status: "done" | "active" | "pending";
};

export type MissionWorkspaceSectionKey =
  | "brief"
  | "work"
  | "checkpoints"
  | "outputs"
  | "runtime";

export type MissionWorkspaceSection = {
  key: MissionWorkspaceSectionKey;
  label: string;
  title: string;
  summary: string;
  tone: ThreadTone;
  status: "done" | "active" | "pending" | "blocked";
  itemCount: number;
  detailLines: string[];
};

export type MissionSnapshot = {
  workspace_contract_version: number;
  missionTitle: string;
  missionSummary: string;
  missionStatusLabel: string;
  missionStatusTone: ThreadTone;
  objective: string | null;
  spec: MissionSpecSummary;
  stages: MissionStageSummary[];
  pipelines: MissionPipeline[];
  checkpoints: MissionCheckpoint[];
  outputs: MissionOutput[];
  workspaceSections: MissionWorkspaceSection[];
  artifactSurfaces: WorkspaceArtifactSurface[];
  nextActionLabel: string | null;
  nextActionDetail: string | null;
  latestUserInstruction: string | null;
  orchestratorReadback: string | null;
  latestOrchestratorReply: string | null;
  activeRouteRevision: number | null;
  activeRouteOption: PlanOptionKey | null;
  activeRunId: string | null;
  conversationTurns: number;
  evidenceCount: number;
};

export type WorkspaceStagePhase = OrchestratorTurn["phase"];

export type StructuredWorkspaceState = {
  stage: WorkspaceStagePhase | null;
  workingGoal: string | null;
  constraintsSummary: string | null;
  pendingDecision: string | null;
  openQuestions: string[];
  latestOrchestratorIntent: string | null;
  draftTemplateName: string | null;
  draftNodeCount: number | null;
  hasActiveDraft: boolean;
  activePlanRevision: number | null;
  activePlanOption: PlanOptionKey | null;
  latestPlanRevision: number | null;
  latestPlanOption: PlanOptionKey | null;
  hasActivePlan: boolean;
  hasConfirmedPlan: boolean;
  activePlanTemplateName: string | null;
  activePlanNodeCount: number | null;
  activePlanReadyFrontierCount: number | null;
  activePlanWarningCount: number | null;
  activePlanReadyForStrictRun: boolean | null;
  activePlanFirstWarning: string | null;
  confirmedPlanRevision: number | null;
  confirmedPlanOption: PlanOptionKey | null;
  planStale: boolean;
  staleReason: string | null;
  needsReplan: boolean;
  needsConfirmation: boolean;
  suggestedPlanRevision: number | null;
  suggestedPlanOption: PlanOptionKey | null;
  nextRecommendedAction: string | null;
  nextRecommendedLabel: string | null;
  nextRecommendedDetail: string | null;
  latestRunId: string | null;
  runStatus: string | null;
  latestRunSummary: string | null;
  latestSubtask: {
    nodeName: string;
    status: string | null;
    progressPercent: number;
    progressMessage: string | null;
  } | null;
  pendingApprovalCount: number;
  pendingHumanInputCount: number;
  pendingInterventionCount: number;
  pendingDagPatchCount: number;
  latestInterventionSummary: string | null;
  latestInterventionKind: string | null;
  latestInterventionStatus: string | null;
  latestDagPatchSummary: string | null;
  latestDagPatchStatus: string | null;
  artifactCount: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function getPatchOperationOutcomes(content: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(content.operation_outcomes)) {
    return content.operation_outcomes.filter(isObject);
  }
  const metadata = isObject(content.metadata) ? content.metadata : null;
  return Array.isArray(metadata?.operation_outcomes)
    ? metadata.operation_outcomes.filter(isObject)
    : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function slugKey(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function countRouteCompareChanges(
  changeSet: RouteCompareSummary["changedNodes"],
): number {
  return changeSet.added.length + changeSet.removed.length + changeSet.changed.length;
}

function routeCompareGroup(input: {
  key: string;
  label: string;
  changeSet: RouteCompareSummary["changedNodes"];
  tone?: ThreadTone;
}): RouteCompareNarrativeGroup | null {
  const count = countRouteCompareChanges(input.changeSet);
  if (count === 0) {
    return null;
  }
  return {
    key: input.key,
    label: input.label,
    count,
    tone: input.tone || "neutral",
    items: [
      ...input.changeSet.added.map((item) => `Added ${item}`),
      ...input.changeSet.removed.map((item) => `Removed ${item}`),
      ...input.changeSet.changed.map((item) => `Changed ${item}`),
    ].slice(0, 4),
  };
}

export function buildRouteCompareNarrative(
  compare: RouteCompareSummary | null,
): RouteCompareNarrative | null {
  if (!compare) {
    return null;
  }

  const groups = [
    routeCompareGroup({
      key: "nodes",
      label: "Nodes",
      changeSet: compare.changedNodes,
    }),
    routeCompareGroup({
      key: "edges",
      label: "Edges",
      changeSet: compare.changedEdges,
    }),
    routeCompareGroup({
      key: "approvals",
      label: "Gates",
      changeSet: compare.changedApprovals,
      tone: "warn",
    }),
    routeCompareGroup({
      key: "outputs",
      label: "Outputs",
      changeSet: compare.changedOutputs,
      tone: "success",
    }),
    routeCompareGroup({
      key: "risks",
      label: "Risks",
      changeSet: compare.changedRisks,
      tone: "warn",
    }),
  ].filter((group): group is RouteCompareNarrativeGroup => !!group);

  const title =
    compare.comparisonKind === "confirmed_vs_latest"
      ? "Confirmed route versus latest route"
      : compare.comparisonKind === "revision"
        ? "Route revision changes"
        : compare.comparisonKind === "option"
          ? "Primary versus alternative route"
          : "Route compare";
  const summaryDetail =
    compare.summaryLines.find((line) => !/^Comparing /i.test(line)) ||
    compare.recommendation.detail ||
    "No material route changes detected.";

  return {
    title,
    detail: summaryDetail,
    tone: compare.recommendation.tone,
    leftLabel: compare.left.label,
    rightLabel: compare.right.label,
    summaryLines: compare.summaryLines,
    groups,
  };
}

export function buildRuntimeGraphNarrative(
  graph: RuntimeGraphSummary | null,
): RuntimeGraphNarrative | null {
  if (!graph) {
    return null;
  }

  const activeNodes = graph.nodes.filter((node) =>
    node.markers.includes("active_frontier") ||
    node.status === "running" ||
    node.status === "waiting_human",
  );
  const blockedNodes = graph.nodes.filter((node) =>
    node.markers.includes("blocked") || node.markers.includes("waiting_human"),
  );
  const completedCount = graph.statusCounts.completed || 0;
  const skippedCount = graph.statusCounts.skipped || 0;
  const doneCount = completedCount + skippedCount;
  const tone: ThreadTone =
    blockedNodes.length > 0
      ? "warn"
      : graph.runStatus === "completed"
        ? "success"
        : activeNodes.length > 0
          ? "success"
          : "neutral";
  const title =
    blockedNodes.length > 0
      ? "Runtime topology needs attention"
      : graph.runStatus === "completed"
        ? "Runtime topology completed"
        : activeNodes.length > 0
          ? "Runtime topology is live"
          : "Runtime topology is ready";
  const detail =
    graph.summaryLines.find((line) => /frontier|waiting|blocked|skipped/i.test(line)) ||
    `${graph.nodes.length} node(s), ${graph.edges.length} edge(s), ${graph.workPackages.length} work package(s).`;

  return {
    title,
    detail,
    tone,
    activeNodeLabels: activeNodes.map((node) => node.name).slice(0, 4),
    blockedNodeLabels: blockedNodes.map((node) => node.name).slice(0, 4),
    packageLabels: graph.workPackages.map((pkg) => pkg.label).slice(0, 4),
  };
}

function getReadableDraftStrategy(value: string | null): string {
  if (!value) {
    return "the current planner strategy";
  }
  if (value === "template_variant") {
    return "a template-guided draft pass";
  }
  if (value === "registry_synthesis") {
    return "a registry-driven synthesis pass";
  }
  return value.replace(/[_-]+/g, " ");
}

function isMetaMissionQuestion(question: string): boolean {
  return /draft a DAG first|go straight to full plan options/i.test(question);
}

function asPlanOption(value: unknown): PlanOptionKey | null {
  if (value === "primary" || value === "alternative") {
    return value;
  }
  return null;
}

function asWorkspaceStage(value: unknown): WorkspaceStagePhase | null {
  if (
    value === "understand" ||
    value === "draft" ||
    value === "compare" ||
    value === "confirm" ||
    value === "execute" ||
    value === "waiting" ||
    value === "deliver"
  ) {
    return value;
  }
  return null;
}

export function readWorkspaceState(detail: ThreadDetail): StructuredWorkspaceState {
  const workspace = isObject(detail.session.workspace_state) ? detail.session.workspace_state : null;
  const latestSubtask = isObject(workspace?.latest_subtask) ? workspace.latest_subtask : null;

  return {
    stage: asWorkspaceStage(workspace?.stage),
    workingGoal: asString(workspace?.working_goal) || asString(detail.session.working_goal),
    constraintsSummary:
      asString(workspace?.constraints_summary) || asString(detail.session.constraints_summary),
    pendingDecision:
      normalizeWorkspaceNarrativeText(
        asString(workspace?.pending_decision) || asString(detail.session.pending_decision),
      ),
    openQuestions: asStringArray(workspace?.open_questions),
    latestOrchestratorIntent:
      asString(workspace?.latest_orchestrator_intent) ||
      asString(detail.session.latest_orchestrator_intent),
    draftTemplateName: asString(workspace?.draft_template_name),
    draftNodeCount: asNumber(workspace?.draft_node_count),
    hasActiveDraft: workspace?.has_active_draft === true,
    activePlanRevision: asNumber(workspace?.active_plan_revision),
    activePlanOption: asPlanOption(workspace?.active_plan_option),
    latestPlanRevision: asNumber(workspace?.latest_plan_revision),
    latestPlanOption: asPlanOption(workspace?.latest_plan_option),
    hasActivePlan: workspace?.has_active_plan === true,
    hasConfirmedPlan: workspace?.has_confirmed_plan === true,
    activePlanTemplateName: asString(workspace?.active_plan_template_name),
    activePlanNodeCount: asNumber(workspace?.active_plan_node_count),
    activePlanReadyFrontierCount: asNumber(workspace?.active_plan_ready_frontier_count),
    activePlanWarningCount: asNumber(workspace?.active_plan_warning_count),
    activePlanReadyForStrictRun:
      typeof workspace?.active_plan_ready_for_strict_run === "boolean"
        ? workspace.active_plan_ready_for_strict_run
        : null,
    activePlanFirstWarning: asString(workspace?.active_plan_first_warning),
    confirmedPlanRevision:
      asNumber(workspace?.confirmed_plan_revision) ?? detail.session.confirmed_plan_revision ?? null,
    confirmedPlanOption:
      asPlanOption(workspace?.confirmed_plan_option) || detail.session.confirmed_plan_option || null,
    planStale: workspace?.plan_stale === true,
    staleReason: normalizeWorkspaceNarrativeText(asString(workspace?.stale_reason)),
    needsReplan: workspace?.needs_replan === true,
    needsConfirmation: workspace?.needs_confirmation === true,
    suggestedPlanRevision: asNumber(workspace?.suggested_plan_revision),
    suggestedPlanOption: asPlanOption(workspace?.suggested_plan_option),
    nextRecommendedAction: asString(workspace?.next_recommended_action),
    nextRecommendedLabel: asString(workspace?.next_recommended_label),
    nextRecommendedDetail: normalizeWorkspaceNarrativeText(asString(workspace?.next_recommended_detail)),
    latestRunId: asString(workspace?.latest_run_id) || detail.session.latest_run_id,
    runStatus: asString(workspace?.run_status),
    latestRunSummary: normalizeWorkspaceNarrativeText(asString(workspace?.latest_run_summary)),
    latestSubtask:
      latestSubtask && asString(latestSubtask.node_name)
        ? {
            nodeName: asString(latestSubtask.node_name) || "Current node",
            status: asString(latestSubtask.status),
            progressPercent: asNumber(latestSubtask.progress_percent) || 0,
            progressMessage: normalizeWorkspaceNarrativeText(asString(latestSubtask.progress_message)),
          }
        : null,
    pendingApprovalCount: asNumber(workspace?.pending_approval_count) || 0,
    pendingHumanInputCount: asNumber(workspace?.pending_human_input_count) || 0,
    pendingInterventionCount: asNumber(workspace?.pending_intervention_count) || 0,
    pendingDagPatchCount: asNumber(workspace?.pending_dag_patch_count) || 0,
    latestInterventionSummary: normalizeWorkspaceNarrativeText(asString(workspace?.latest_intervention_summary)),
    latestInterventionKind: asString(workspace?.latest_intervention_kind),
    latestInterventionStatus: asString(workspace?.latest_intervention_status),
    latestDagPatchSummary: normalizeWorkspaceNarrativeText(asString(workspace?.latest_dag_patch_summary)),
    latestDagPatchStatus: asString(workspace?.latest_dag_patch_status),
    artifactCount: asNumber(workspace?.artifact_count) || 0,
  };
}

export function getPlanRevision(message: SessionMessageRecord | null): number | null {
  if (!message) {
    return null;
  }
  if (message.kind !== "plan_card" && message.kind !== "plan_options_card") {
    return null;
  }
  return asNumber(message.content.revision);
}

export function getLatestMessage(
  messages: SessionMessageRecord[],
  kinds: SessionMessageKind[],
): SessionMessageRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (kinds.includes(message.kind)) {
      return message;
    }
  }
  return null;
}

function getFirstUserTextMessage(messages: SessionMessageRecord[]): SessionMessageRecord | null {
  return (
    messages.find((message) => message.role === "user" && message.kind === "text") || null
  );
}

function getLatestConversationReply(messages: SessionMessageRecord[]): SessionMessageRecord | null {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "orchestrator" &&
          message.kind === "text" &&
          !!asString(message.content.text),
      ) || null
  );
}

function getThreadTaskBrief(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): string | null {
  const firstUserText = asString(getFirstUserTextMessage(visibleMessages)?.content.text);
  const currentGoal = asString(detail.session.current_goal);
  const workingGoal = asString(detail.session.working_goal);
  return workingGoal || firstUserText || currentGoal || null;
}

function isInternalPlannerLabel(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return /^planner[-_]/i.test(value) || /^studio-smoke-template[-_]/i.test(value);
}

function getRecommendationSummary(message: SessionMessageRecord): {
  selectedTemplateName: string | null;
  warningCount: number;
  alternativeTemplateNames: string[];
  recommendationReason: string | null;
} | null {
  if (!isPlannerRecommendationMessage(message)) {
    return null;
  }

  const recommendation = isObject(message.content.recommendation)
    ? message.content.recommendation
    : null;
  const selectedTemplate = recommendation && isObject(recommendation.selected_template)
    ? recommendation.selected_template
    : null;
  const candidates = recommendation && Array.isArray(recommendation.candidates)
    ? recommendation.candidates.filter((item): item is Record<string, unknown> => isObject(item))
    : [];
  const selectedTemplateId = asString(selectedTemplate?.template_id);
  const warningCount =
    asNumber(message.content.warning_count) ||
    (typeof message.content.text === "string"
      ? Number.parseInt(
          message.content.text.match(/with (\d+) warning\(s\)/i)?.[1] || "",
          10,
        ) || 0
      : 0);

  return {
    selectedTemplateName:
      asString(selectedTemplate?.name) ||
      (!isInternalPlannerLabel(asString(message.content.template_id))
        ? asString(message.content.template_id)
        : null) ||
      null,
    warningCount,
    alternativeTemplateNames: candidates
      .filter((candidate) => asString(candidate.template_id) !== selectedTemplateId)
      .map((candidate) => asString(candidate.name) || asString(candidate.template_id))
      .filter((item): item is string => !!item)
      .slice(0, 3),
    recommendationReason: asString(selectedTemplate?.reason),
  };
}

function buildReadablePlannerRecommendationText(message: SessionMessageRecord): string | null {
  const summary = getRecommendationSummary(message);
  if (!summary) {
    return null;
  }

  const templateLabel = summary.selectedTemplateName || "the current workflow template";
  const warningLine =
    summary.warningCount > 0
      ? `It still carries ${summary.warningCount} warning(s) that should be reviewed before a strict run.`
      : "No immediate validation blockers were detected for the recommended route.";
  const alternativeLine =
    summary.alternativeTemplateNames.length > 0
      ? `Backup routes remain available: ${summary.alternativeTemplateNames.join(", ")}.`
      : null;

  return [
    `I shaped the current mission into a recommended execution route using ${templateLabel}.`,
    warningLine,
    alternativeLine,
  ]
    .filter((item): item is string => !!item)
    .join(" ");
}

function normalizeMissionNarrativeText(text: string): string {
  return text
    .replace(/^Logged your note\.\s*/i, "Logged your note. ")
    .replace(/\btask brief\b/gi, "mission brief")
    .replace(/\btask framing\b/gi, "mission framing")
    .replace(/\btask context\b/gi, "mission context")
    .replace(/\btask intent\b/gi, "mission intent")
    .replace(/\bcurrent task\b/gi, "current mission")
    .replace(/\bthe task\b/gi, "the mission")
    .replace(/\ba task\b/gi, "a mission")
    .replace(/\bthis task\b/gi, "this mission")
    .replace(/\bthread\b/gi, "mission")
    .replace(/\bplan comparison\b/gi, "route comparison")
    .replace(/\bCreate plan\b/g, "Create route")
    .replace(/\bplan options\b/gi, "route options")
    .replace(/\bplan option\b/gi, "route option")
    .replace(/\blatest plan\b/gi, "latest route")
    .replace(/\bcompiled plan\b/gi, "compiled route")
    .replace(/\bexecution plan\b/gi, "execution route")
    .replace(/\bplan proposal\b/gi, "route proposal")
    .replace(/\bworkflow templates\b/gi, "route templates")
    .replace(/\bworkflow moves\b/gi, "mission moves")
    .replace(/\bworkflow shape\b/gi, "workflow shape")
    .replace(/\bplan revision v(\d+)\b/gi, "route revision v$1")
    .replace(/\bplan v(\d+)\b/gi, "route v$1")
    .replace(/\bplan is now stale\b/gi, "route is now stale")
    .replace(/\bplan already existed\b/gi, "route already existed")
    .replace(/\bUse Revise\b/g, "Use Revise")
    .replace(/\bcurrent thread context\b/gi, "current mission context");
}

function normalizeWorkspaceNarrativeText(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return normalizeMissionNarrativeText(value)
    .replace(/\bplan\b/gi, "route")
    .replace(/\btask context\b/gi, "mission context")
    .replace(/\btask intent\b/gi, "mission intent")
    .replace(/\bMove the thread forward\b/g, "Move the mission forward")
    .replace(/\bUse the thread tools\b/g, "Use the mission tools");
}

function isPlannerStyleSummary(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return (
    /matched intent terms/i.test(value) ||
    /recommended template/i.test(value) ||
    /revision kept/i.test(value) ||
    /alternative templates:/i.test(value) ||
    /planner-/i.test(value)
  );
}

function getLatestReadablePlannerSummary(
  visibleMessages: SessionMessageRecord[],
): string | null {
  const latestRecommendation =
    [...visibleMessages].reverse().find((message) => isPlannerRecommendationMessage(message)) || null;
  return latestRecommendation ? buildReadablePlannerRecommendationText(latestRecommendation) : null;
}

function getReadableSessionPlanSummary(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): string | null {
  const latestSummaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const summaryFromRun = asString(latestSummaryMessage?.content.current_summary);
  if (summaryFromRun) {
    return summaryFromRun;
  }

  const latestDraftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  if (latestDraftMessage) {
    const draftTemplate = isObject(latestDraftMessage.content.draft_template)
      ? latestDraftMessage.content.draft_template
      : null;
    const plannerContext = isObject(latestDraftMessage.content.planner_context)
      ? latestDraftMessage.content.planner_context
      : null;
    const strategy = getReadableDraftStrategy(asString(plannerContext?.draft_strategy));
    const nodeCount = Array.isArray(draftTemplate?.nodes) ? draftTemplate.nodes.length : null;
    return `I shaped the mission into an initial workflow draft using ${strategy}${typeof nodeCount === "number" ? ` across ${nodeCount} node(s)` : ""}.`;
  }

  const planContext = getLatestPlanContext(detail, visibleMessages);
  const activePlanName = getPlanContentIdentity(planContext.activeContent);
  const activePlanValidation = summarizeValidationState(
    getValidationFromPlanContent(planContext.activeContent),
  );
  if (activePlanName) {
    const revision = getPlanRevision(planContext.activePlanMessage) || null;
    const option = planContext.confirmedOption || planContext.activeOption || "primary";
    if (planContext.confirmedRevision !== null) {
      return `I am holding ${activePlanName} as the confirmed execution route on route v${planContext.confirmedRevision} / ${option}. ${activePlanValidation.runHint}`;
    }
    if (revision !== null) {
      return `I compiled ${activePlanName} into route v${revision} / ${option}. ${activePlanValidation.runHint}`;
    }
    return `I mapped the mission onto ${activePlanName}. ${activePlanValidation.runHint}`;
  }

  const recommendationSummary = getLatestReadablePlannerSummary(visibleMessages);
  if (recommendationSummary) {
    return recommendationSummary;
  }

  const currentPlanSummary = asString(detail.session.current_plan_summary);
  if (currentPlanSummary && !isPlannerStyleSummary(currentPlanSummary)) {
    return currentPlanSummary;
  }

  return null;
}

export function getMessageKindLabel(kind: SessionMessageKind): string {
  const labels: Record<SessionMessageKind, string> = {
    text: "Message",
    system: "Update",
    orchestrator_turn: "Turn",
    goal_update_card: "Goal Update",
    decision_card: "Decision",
    workspace_snapshot_card: "Workspace",
    intervention_card: "Intervention",
    dag_patch_card: "DAG Patch",
    draft_card: "DAG Draft",
    plan_card: "Route",
    plan_options_card: "Route Options",
    run_card: "Run",
    summary_card: "Run Update",
    subtask_card: "Subtask",
    approval_card: "Approval",
    human_input_card: "Human Input",
    artifact_card: "Artifact",
  };
  return labels[kind] || kind;
}

export function isPlannerRecommendationMessage(message: SessionMessageRecord): boolean {
  return (
    message.role === "orchestrator" &&
    message.kind === "text" &&
    isObject(message.content.recommendation)
  );
}

export function isPlanConfirmationEchoMessage(message: SessionMessageRecord): boolean {
  if (message.role !== "orchestrator" || message.kind !== "text") {
    return false;
  }

  const text = asString(message.content.text);
  return !!text && /^Confirmed plan v\d+ for execution\.$/.test(text);
}

export function isConversationTextMessage(message: SessionMessageRecord): boolean {
  if (message.role === "user" && message.kind === "text" && !!asString(message.content.text)) {
    return true;
  }
  if (message.role === "orchestrator" && message.kind === "text" && !!asString(message.content.text)) {
    return true;
  }
  return (
    message.role === "orchestrator" &&
    message.kind === "orchestrator_turn" &&
    (!!asString(message.content.summary) || !!asString(message.content.user_text))
  );
}

function isTransitionAckMessage(message: SessionMessageRecord): boolean {
  if (message.role !== "orchestrator" || message.kind !== "text") {
    return false;
  }
  const text = asString(message.content.text);
  if (!text) {
    return false;
  }
  return (
    /^I treated this as/i.test(text) ||
    /^I understood this as/i.test(text) ||
    /^Logged your note\./i.test(text) ||
    /^I logged that note\./i.test(text) ||
    /^I recorded that mission change\./i.test(text) ||
    /^I am treating this as the active mission:/i.test(text) ||
    /^I captured the mission brief\./i.test(text) ||
    /^I added that to the mission brief:/i.test(text) ||
    /^I tightened the mission brief with that instruction\./i.test(text) ||
    /^Right now,/i.test(text) ||
    /^I treated that as a follow-up question or note/i.test(text)
  );
}

function buildLegacyOrchestratorTurnReply(message: SessionMessageRecord): string | null {
  const narrativeReply = asString(message.content.narrative_reply);
  if (narrativeReply) {
    return narrativeReply;
  }
  const summary = asString(message.content.summary);
  const workspaceImpact = normalizeWorkspaceNarrativeText(asString(message.content.workspace_impact));
  const nextActionDetail = normalizeWorkspaceNarrativeText(asString(message.content.next_action_detail));

  if (workspaceImpact && nextActionDetail) {
    const trimmedImpact = workspaceImpact.replace(/\s+/g, " ").trim().replace(/[.]+$/g, "");
    const normalizedImpact = trimmedImpact
      ? `${trimmedImpact.charAt(0).toLowerCase()}${trimmedImpact.slice(1)}`
      : "the workspace moved forward";
    return `Right now, ${normalizedImpact}. Next I recommend: ${nextActionDetail}`;
  }

  if (summary && nextActionDetail && !/next i recommend:/i.test(summary)) {
    return `${summary.replace(/\s+/g, " ").trim()} Next I recommend: ${nextActionDetail}`;
  }

  return summary || asString(message.content.user_text) || null;
}

export function getConversationMessageText(message: SessionMessageRecord): string | null {
  if (message.kind === "orchestrator_turn") {
    return normalizeMissionNarrativeText(
      buildLegacyOrchestratorTurnReply(message) || "The orchestrator recorded a new turn.",
    );
  }
  const text = asString(message.content.text);
  if (!text) {
    return null;
  }

  if (isPlanConfirmationEchoMessage(message)) {
    const revision = asNumber(message.content.revision);
    const option =
      message.content.option === "alternative"
        ? "alternative"
        : message.content.option === "primary"
          ? "primary"
          : null;
    return `Confirmed route v${revision || "?"}${option ? ` / ${option}` : ""}. Execution source is locked; run it when ready.`;
  }

  if (isPlannerRecommendationMessage(message)) {
    return buildReadablePlannerRecommendationText(message) || text;
  }

  if (message.role === "orchestrator") {
    return normalizeMissionNarrativeText(text);
  }

  return text;
}

export function projectConversationMessages(input: {
  messages: SessionMessageRecord[];
}): ConversationProjection {
  const source = input.messages.filter(isConversationTextMessage);
  const conversationMessages = source.filter((message, index) => {
    if (message.kind === "orchestrator_turn") {
      return true;
    }
    if (!isTransitionAckMessage(message)) {
      return true;
    }
    const nextMessage = source[index + 1];
    return !(
      nextMessage &&
      nextMessage.role === "orchestrator" &&
      ((nextMessage.kind === "text" && !!asString(nextMessage.content.text)) ||
        nextMessage.kind === "orchestrator_turn")
    );
  });
  return {
    conversationMessages,
    hiddenNonConversationMessageCount: input.messages.length - conversationMessages.length,
  };
}

export function getReadableSessionListSummary(
  session: Pick<
    SessionSummary,
    | "status"
    | "current_goal"
    | "current_plan_summary"
    | "confirmed_plan_revision"
    | "confirmed_plan_option"
    | "pending_decision"
    | "working_goal"
  >,
): string | null {
  const pendingDecision = asString(session.pending_decision);
  if (pendingDecision) {
    return pendingDecision
      .replace(/^The task brief/i, "The mission brief")
      .replace(/\btask\b/gi, "mission")
      .replace(/\bplan\b/gi, "route");
  }
  const summary = asString(session.current_plan_summary);
  if (summary && !isPlannerStyleSummary(summary)) {
    return summary;
  }

  if (session.status === "ready_to_run" && typeof session.confirmed_plan_revision === "number") {
    return `Confirmed route v${session.confirmed_plan_revision} / ${session.confirmed_plan_option || "primary"} is ready to launch.`;
  }
  if (session.status === "running") {
    return "Mission execution is in progress. Open the mission for live work updates.";
  }
  if (session.status === "waiting_human") {
    return "Mission execution is waiting on a human decision or structured input.";
  }
  if (session.status === "completed") {
    return "The last mission execution completed. Open the mission to review the handoff and outputs.";
  }
  if (session.status === "failed") {
    return "The last mission execution failed. Open the mission to inspect the latest summary and revise the route.";
  }

  return asString(session.working_goal) || asString(session.current_goal);
}

export function summarizeValidationState(
  validation: PlannerValidationResult | null,
): ValidationStateSummary {
  const groups = groupValidation(validation);
  const warningCount =
    typeof validation?.warnings?.length === "number"
      ? validation.warnings.length
      : groups.reduce((total, group) => total + group.items.length, 0);
  const hasRequiredInputRisk = groups.some((group) => group.key === "required_input");
  const hasRegistryRisk = groups.some((group) => group.key === "registry");
  const hasGraphRisk = groups.some((group) => group.key === "graph");
  const isReadyForStrictRun = !!validation?.passed && warningCount === 0;

  if (isReadyForStrictRun) {
    return {
      label: "Launch-ready",
      tone: "success",
      warningCount,
      hasRequiredInputRisk,
      hasRegistryRisk,
      hasGraphRisk,
      isReadyForStrictRun,
      runHint: "No missing-input or agent-binding blockers were detected.",
    };
  }

  if (hasRequiredInputRisk) {
    return {
      label: "Required input missing",
      tone: "danger",
      warningCount,
      hasRequiredInputRisk,
      hasRegistryRisk,
      hasGraphRisk,
      isReadyForStrictRun,
      runHint: "Launch is expected to stop until the missing inputs are filled.",
    };
  }

  if (hasRegistryRisk) {
    return {
      label: "Agent binding risk",
      tone: "warn",
      warningCount,
      hasRequiredInputRisk,
      hasRegistryRisk,
      hasGraphRisk,
      isReadyForStrictRun,
      runHint: "Launch may stop on agent or skill binding issues.",
    };
  }

  if (hasGraphRisk) {
    return {
      label: "Workflow graph needs review",
      tone: "warn",
      warningCount,
      hasRequiredInputRisk,
      hasRegistryRisk,
      hasGraphRisk,
      isReadyForStrictRun,
      runHint: "Review the generated node graph before attempting launch.",
    };
  }

  return {
    label: warningCount > 0 ? "Warnings need review" : "Needs review",
    tone: warningCount > 0 ? "warn" : "neutral",
    warningCount,
    hasRequiredInputRisk,
    hasRegistryRisk,
    hasGraphRisk,
    isReadyForStrictRun,
    runHint:
      warningCount > 0
        ? "Inspect the route warnings before attempting launch."
        : "Review the latest route output before launch.",
  };
}

export function extractPlanOptionContent(
  message: SessionMessageRecord | null,
  option: PlanOptionKey,
): Record<string, unknown> | null {
  if (!message) {
    return null;
  }

  if (message.kind === "plan_options_card") {
    const content =
      option === "alternative"
        ? message.content.alternative
        : message.content.primary;
    return isObject(content) ? content : null;
  }

  if (message.kind === "plan_card" && option === "primary") {
    return message.content;
  }

  return null;
}

function getValidationFromPlanContent(
  content: Record<string, unknown> | null,
): PlannerValidationResult | null {
  if (!content || !isObject(content.validation)) {
    return null;
  }

  const validation = content.validation;
  if (
    typeof validation.passed === "boolean" &&
    Array.isArray(validation.warnings) &&
    Array.isArray(validation.details)
  ) {
    return validation as unknown as PlannerValidationResult;
  }
  return null;
}

function getSelectedPlanOption(message: SessionMessageRecord | null): PlanOptionKey | null {
  if (!message) {
    return null;
  }

  if (message.kind === "plan_options_card") {
    return message.content.selected_option === "alternative" ? "alternative" : "primary";
  }

  if (message.kind === "plan_card") {
    return "primary";
  }

  return null;
}

function getPlanContentIdentity(content: Record<string, unknown> | null): string | null {
  if (!content) {
    return null;
  }

  return asString(content.template_name) || asString(content.template_id);
}

export function getPlanReason(content: Record<string, unknown> | null): string | null {
  if (!content) {
    return null;
  }

  const rawReason = asString(content.recommendation_reason);
  if (rawReason && !isPlannerStyleSummary(rawReason)) {
    return rawReason;
  }

  const templateName = getPlanContentIdentity(content) || "this route";
  const source = asString(content.source);
  const validationSummary = summarizeValidationState(getValidationFromPlanContent(content));
  const routeLabel = source === "alternative" ? "backup route" : "main route";
  const riskLine =
    validationSummary.warningCount > 0
      ? `It carries ${validationSummary.warningCount} warning(s), so review the checklist before launch.`
      : "It is the cleanest route from the current planner pass.";

  return `${templateName} is the ${routeLabel} for this revision. ${riskLine}`;
}

function getCandidatePlan(content: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!content || !isObject(content.candidate_plan)) {
    return null;
  }
  return content.candidate_plan;
}

function getNodeCountFromPlan(content: Record<string, unknown> | null): number {
  const candidatePlan = getCandidatePlan(content);
  return Array.isArray(candidatePlan?.compiled_nodes) ? candidatePlan.compiled_nodes.length : 0;
}

function getReadyFrontierCountFromPlan(content: Record<string, unknown> | null): number {
  const candidatePlan = getCandidatePlan(content);
  return Array.isArray(candidatePlan?.frontier) ? candidatePlan.frontier.length : 0;
}

function getCompiledNodes(content: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const candidatePlan = getCandidatePlan(content);
  if (!candidatePlan || !Array.isArray(candidatePlan.compiled_nodes)) {
    return [];
  }
  return candidatePlan.compiled_nodes.filter((item): item is Record<string, unknown> => isObject(item));
}

function inferPackageBucket(node: Record<string, unknown>): "research" | "draft" | "review" | "deliver" | "other" {
  const name = `${asString(node.name) || ""} ${asString(node.node_id) || ""}`.toLowerCase();
  const allowedTools = Array.isArray(node.allowed_tools)
    ? node.allowed_tools.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase())
    : [];
  const expectedArtifacts =
    isObject(node.output_contract) && Array.isArray(node.output_contract.expected_artifacts)
      ? node.output_contract.expected_artifacts
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.toLowerCase())
      : [];

  if (
    name.includes("collect") ||
    name.includes("research") ||
    name.includes("context") ||
    allowedTools.includes("web")
  ) {
    return "research";
  }
  if (
    name.includes("write") ||
    name.includes("draft") ||
    name.includes("summary") ||
    expectedArtifacts.some((item) => item.includes("draft") || item.includes("summary"))
  ) {
    return "draft";
  }
  if (
    name.includes("review") ||
    name.includes("approval") ||
    asString(node.approval_kind)
  ) {
    return "review";
  }
  if (name.includes("end") || name.includes("deliver") || name.includes("publish")) {
    return "deliver";
  }
  return "other";
}

function getBucketPresentation(bucket: "research" | "draft" | "review" | "deliver" | "other") {
  if (bucket === "research") {
    return {
      title: "Context collection",
      summary: "Gather source material and mission context before the rest of the mission moves.",
    };
  }
  if (bucket === "draft") {
    return {
      title: "Draft assembly",
      summary: "Turn collected context into a concrete working draft and structured output.",
    };
  }
  if (bucket === "review") {
    return {
      title: "Review and approval",
      summary: "Hold the task at a quality or human gate before continuing the next branch.",
    };
  }
  if (bucket === "deliver") {
    return {
      title: "Delivery handoff",
      summary: "Finalize the remaining nodes and close the execution loop with a deliverable.",
    };
  }
  return {
    title: "Execution package",
    summary: "A remaining work package in the current orchestration path.",
  };
}

function getNodeStatusPriority(status: string | null): number {
  if (status === "running" || status === "waiting_human") {
    return 4;
  }
  if (status === "ready") {
    return 3;
  }
  if (status === "pending") {
    return 2;
  }
  if (status === "failed" || status === "cancelled" || status === "blocked") {
    return 1;
  }
  return 0;
}

function getLatestPlanContext(detail: ThreadDetail, visibleMessages: SessionMessageRecord[]) {
  const latestPlanMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  const confirmedRevision = detail.session.confirmed_plan_revision ?? null;
  const confirmedOption = detail.session.confirmed_plan_option ?? null;

  const confirmedPlanMessage =
    typeof confirmedRevision === "number"
      ? [...visibleMessages].reverse().find((message) => getPlanRevision(message) === confirmedRevision) ||
        null
      : null;

  const activePlanMessage = confirmedPlanMessage || latestPlanMessage;
  const activeOption =
    confirmedPlanMessage && confirmedOption
      ? confirmedOption
      : getSelectedPlanOption(activePlanMessage);
  const activeContent =
    activePlanMessage && activeOption
      ? extractPlanOptionContent(activePlanMessage, activeOption)
      : null;

  return {
    latestPlanMessage,
    activePlanMessage,
    activeOption,
    activeContent,
    confirmedRevision,
    confirmedOption,
  };
}

function buildMissionPipelineSummary(pipelines: MissionPipeline[]): MissionPipelineSummary {
  return {
    total: pipelines.length,
    ready: pipelines.filter((pipeline) => pipeline.readyCount > 0).length,
    active: pipelines.filter((pipeline) => pipeline.status === "active").length,
    blocked: pipelines.filter((pipeline) => pipeline.status === "blocked").length,
    completed: pipelines.filter((pipeline) => pipeline.status === "done").length,
    primaryAgentLabels: uniqueStrings(pipelines.map((pipeline) => pipeline.primaryAgentLabel)),
  };
}

function buildMissionCheckpointSummary(checkpoints: MissionCheckpoint[]): MissionCheckpointSummary {
  return {
    total: checkpoints.length,
    completed: checkpoints.filter((checkpoint) => checkpoint.status === "done").length,
    active: checkpoints.filter((checkpoint) => checkpoint.status === "active").length,
    pending: checkpoints.filter((checkpoint) => checkpoint.status === "pending").length,
    labels: checkpoints.map((checkpoint) => checkpoint.label),
  };
}

function getRunTone(status: string | null): ThreadTone {
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  if (status === "completed") {
    return "success";
  }
  if (status === "running" || status === "waiting_human") {
    return "success";
  }
  if (status === "queued" || status === "paused" || status === "blocked") {
    return "warn";
  }
  return "neutral";
}

export function deriveThreadOverview(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): ThreadOverview {
  const workspace = readWorkspaceState(detail);
  const pendingApprovalCount = visibleMessages.filter(
    (message) => message.kind === "approval_card",
  ).length;
  const pendingHumanInputCount = visibleMessages.filter(
    (message) => message.kind === "human_input_card",
  ).length;
  const artifactCount = visibleMessages.filter(
    (message) => message.kind === "artifact_card",
  ).length;
  const latestRunMessage = getLatestMessage(visibleMessages, ["run_card", "summary_card"]);
  const latestDraftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  const latestPlanMessage = getLatestMessage(visibleMessages, [
    "plan_options_card",
    "plan_card",
  ]);
  const latestSubtaskMessage = getLatestMessage(visibleMessages, ["subtask_card"]);
  const latestRunId =
    asString(latestRunMessage?.content.run_id) || detail.session.latest_run_id || null;
  const latestSubtask = latestSubtaskMessage
    ? {
        nodeName: asString(latestSubtaskMessage.content.node_name) || "Subtask",
        status: asString(latestSubtaskMessage.content.status),
        progressPercent: asNumber(
          isObject(latestSubtaskMessage.content.progress)
            ? latestSubtaskMessage.content.progress.percent
            : null,
        ) || 0,
        progressMessage: asString(
          isObject(latestSubtaskMessage.content.progress)
            ? latestSubtaskMessage.content.progress.message
            : null,
        ),
      }
    : null;
  const confirmedRevision = detail.session.confirmed_plan_revision ?? null;
  const confirmedOption = detail.session.confirmed_plan_option ?? null;
  const confirmedPlanMessage =
    typeof confirmedRevision === "number"
      ? [...visibleMessages]
          .reverse()
          .find((message) => getPlanRevision(message) === confirmedRevision) || null
      : null;
  const confirmedPlanContent =
    confirmedOption && confirmedPlanMessage
      ? extractPlanOptionContent(confirmedPlanMessage, confirmedOption)
      : null;
  const confirmedValidation = getValidationFromPlanContent(confirmedPlanContent);
  const confirmedValidationSummary = summarizeValidationState(confirmedValidation);
  const runStatus = detail.latest_run?.status || asString(workspace.runStatus) || detail.session.status;
  const autoRefreshRecommended = [
    "planning",
    "ready_to_run",
    "running",
    "queued",
    "waiting_human",
    "paused",
    "blocked",
  ].includes(detail.session.status) || [
    "queued",
    "running",
    "waiting_human",
    "paused",
    "blocked",
  ].includes(runStatus || "");
  const nextStepLabel = workspace.nextRecommendedLabel || "Move the mission forward";
  const nextStepDetail =
    normalizeWorkspaceNarrativeText(workspace.nextRecommendedDetail) ||
    "Use the mission tools to move from chat into orchestration.";

  if (pendingApprovalCount > 0) {
    return {
      stageLabel: "Waiting on you",
      stageTone: "warn",
      headline: "An approval is blocking the current run.",
      detail: "Review the approval card in the timeline so the orchestrator can continue.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: true,
    };
  }

  if (pendingHumanInputCount > 0) {
    return {
      stageLabel: "Waiting on you",
      stageTone: "warn",
      headline: "The orchestrator needs extra mission input.",
      detail: "Fill the requested fields in the timeline so the run can resume.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: true,
    };
  }

  if (detail.session.status === "failed") {
    return {
      stageLabel: "Run failed",
      stageTone: "danger",
      headline: "The latest execution stopped with a failure.",
      detail: "Inspect the latest run update, then revise the route or retry with clearer instructions.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended,
    };
  }

  if (detail.session.status === "cancelled") {
    return {
      stageLabel: "Run cancelled",
      stageTone: "neutral",
      headline: "The linked run is no longer active.",
      detail: "You can draft a new route or revise the last one from the mission.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: false,
    };
  }

  if (detail.session.status === "completed") {
    return {
      stageLabel: "Completed",
      stageTone: "success",
      headline: "The latest run completed successfully.",
      detail:
        artifactCount > 0
          ? "Artifacts and run updates are available in the timeline."
          : "Review the final run summary and any generated outputs in the timeline.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: false,
    };
  }

  if (detail.session.status === "running" || detail.session.status === "waiting_human") {
    return {
      stageLabel: "Running",
      stageTone: "success",
      headline: latestSubtask
        ? `The orchestrator is working on ${latestSubtask.nodeName}.`
        : "The orchestrator is executing the confirmed plan.",
      detail: latestSubtask?.progressMessage || "Live node updates will continue to stream into the timeline.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: true,
    };
  }

  if (workspace.planStale) {
    return {
      stageLabel: "Route stale",
      stageTone: "warn",
      headline: workspace.hasActivePlan
        ? "The current route no longer matches the latest instruction."
        : "The current draft no longer matches the latest instruction.",
      detail:
        normalizeWorkspaceNarrativeText(workspace.staleReason) ||
        "Revise the route so the orchestration surface reflects the updated brief before execution.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: false,
    };
  }

  if (confirmedRevision !== null) {
    const optionLabel = confirmedOption || "primary";
    if (confirmedValidation && !confirmedValidationSummary.isReadyForStrictRun) {
      return {
        stageLabel: "Route confirmed",
        stageTone: confirmedValidationSummary.tone,
        headline: `Route v${confirmedRevision} / ${optionLabel} is confirmed but still has execution risk.`,
        detail: confirmedValidationSummary.runHint,
        nextStepLabel,
        nextStepDetail,
        pendingApprovalCount,
        pendingHumanInputCount,
        artifactCount,
        latestRunId,
        latestSubtask,
        autoRefreshRecommended: false,
      };
    }

    return {
      stageLabel: "Ready to run",
      stageTone: "success",
      headline: `Route v${confirmedRevision} / ${optionLabel} is confirmed.`,
      detail: "The mission is ready to launch a real run from the confirmed option.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: false,
    };
  }

  if (latestPlanMessage) {
    return {
      stageLabel: workspace.needsConfirmation ? "Needs confirmation" : "Route options ready",
      stageTone: "warn",
      headline: workspace.needsConfirmation
        ? "A route is ready to be locked for execution."
        : "The orchestrator has proposed executable route options.",
      detail: normalizeWorkspaceNarrativeText(workspace.nextRecommendedDetail) ||
        "Compare the main and backup options, then confirm the one you want to execute.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: false,
    };
  }

  if (latestDraftMessage) {
    return {
      stageLabel: "Draft ready",
      stageTone: "warn",
      headline: "A DAG draft is ready for planning.",
      detail: normalizeWorkspaceNarrativeText(workspace.nextRecommendedDetail) ||
        "Use the draft as the source for full route options or discard it and draft again.",
      nextStepLabel,
      nextStepDetail,
      pendingApprovalCount,
      pendingHumanInputCount,
      artifactCount,
      latestRunId,
      latestSubtask,
      autoRefreshRecommended: false,
    };
  }

  return {
    stageLabel: "Need orchestration",
    stageTone: "neutral",
    headline: "The mission has context but no compiled route yet.",
    detail: normalizeWorkspaceNarrativeText(workspace.nextRecommendedDetail) ||
      "Send more mission detail, draft a DAG, or ask the orchestrator to plan the work.",
    nextStepLabel,
    nextStepDetail,
    pendingApprovalCount,
    pendingHumanInputCount,
    artifactCount,
    latestRunId,
    latestSubtask,
    autoRefreshRecommended: false,
  };
}

export function buildNarrativeSteps(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): NarrativeStep[] {
  const draftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  const planMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  const runMessage = getLatestMessage(visibleMessages, ["run_card"]);
  const summaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const subtaskMessage = getLatestMessage(visibleMessages, ["subtask_card"]);
  const approvalMessage = getLatestMessage(visibleMessages, ["approval_card"]);
  const humanInputMessage = getLatestMessage(visibleMessages, ["human_input_card"]);

  const planningTitle = draftMessage ? "Drafted a workflow shape" : "Understood the mission";
  const planningDetail = draftMessage
    ? `A draft DAG is available and can be promoted into full route options.`
    : planMessage
      ? "The orchestrator matched the mission to executable route templates."
      : "The mission is still waiting for planning context or a planner action.";

  const planDetail = planMessage
    ? (() => {
        const revision = getPlanRevision(planMessage) || 1;
        if (planMessage.kind === "plan_options_card") {
          const primary = isObject(planMessage.content.primary) ? planMessage.content.primary : null;
          const alternative = isObject(planMessage.content.alternative)
            ? planMessage.content.alternative
            : null;
          return `Revision v${revision} compiled ${primary ? "a primary" : ""}${
            primary && alternative ? " and " : ""
          }${alternative ? "an alternative" : ""} route option for comparison.`;
        }
        return `Revision v${revision} produced a compiled execution route.`;
      })()
    : "No compiled route exists yet.";

  let executionDetail = "Execution has not started yet.";
  let executionTone: ThreadTone = "neutral";
  let executionStatus: NarrativeStep["status"] = "pending";
  if (summaryMessage) {
    const status = asString(summaryMessage.content.status);
    const currentSummary = asString(summaryMessage.content.current_summary) || "Run update available.";
    executionDetail =
      status === "completed"
        ? `The latest run finished successfully. ${currentSummary}`
        : status === "failed"
          ? `The latest run failed. ${currentSummary}`
          : `${currentSummary}`;
    executionTone =
      status === "completed"
        ? "success"
        : status === "failed" || status === "cancelled"
          ? "danger"
          : "warn";
    executionStatus = status === "completed" || status === "failed" || status === "cancelled" ? "done" : "active";
  } else if (runMessage) {
    const status = asString(runMessage.content.status) || "queued";
    const planRevision = asNumber(runMessage.content.plan_revision);
    executionDetail = planRevision
      ? `A real run was launched from route v${planRevision}. Current run status: ${status}.`
      : `A real run was launched from this mission. Current run status: ${status}.`;
    executionTone = status === "queued" || status === "running" ? "warn" : "neutral";
    executionStatus = "active";
  }

  let interventionDetail = "No human intervention is needed right now.";
  let interventionTone: ThreadTone = "neutral";
  let interventionStatus: NarrativeStep["status"] = "pending";
  if (approvalMessage) {
    interventionDetail = "A human approval is blocking the next step in the run.";
    interventionTone = "warn";
    interventionStatus = "active";
  } else if (humanInputMessage) {
    interventionDetail = "The orchestrator needs additional mission input to continue.";
    interventionTone = "warn";
    interventionStatus = "active";
  } else if (subtaskMessage && detail.session.status === "running") {
    const nodeName = asString(subtaskMessage.content.node_name) || "current node";
    const progressMessage = isObject(subtaskMessage.content.progress)
      ? asString(subtaskMessage.content.progress.message)
      : null;
    interventionDetail = progressMessage
      ? `${nodeName} is the most recent active step. ${progressMessage}`
      : `${nodeName} is the most recent active step.`;
    interventionTone = "success";
    interventionStatus = "active";
  } else if (summaryMessage && asString(summaryMessage.content.status) === "completed") {
    interventionDetail = "Execution is complete. You can review the output or ask for a revision.";
    interventionTone = "success";
    interventionStatus = "done";
  }

  return [
    {
      key: "understand",
      title: planningTitle,
      detail: planningDetail,
      tone: planMessage || draftMessage ? "success" : "neutral",
      status: planMessage || draftMessage ? "done" : "active",
    },
    {
      key: "plan",
      title: "Compiled an execution path",
      detail: planDetail,
      tone:
        typeof detail.session.confirmed_plan_revision === "number"
          ? "success"
          : planMessage
            ? "warn"
            : "neutral",
      status:
        typeof detail.session.confirmed_plan_revision === "number"
          ? "done"
          : planMessage
            ? "active"
            : "pending",
    },
    {
      key: "execute",
      title: "Moved the plan into execution",
      detail: executionDetail,
      tone: executionTone,
      status: executionStatus,
    },
    {
      key: "intervene",
      title: "Kept the human in the loop",
      detail: interventionDetail,
      tone: interventionTone,
      status: interventionStatus,
    },
  ];
}

export function buildOrchestratorTurns(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): OrchestratorTurn[] {
  const structuredTurns = visibleMessages.filter(
    (message) => message.kind === "orchestrator_turn" && message.role === "orchestrator",
  );
  if (structuredTurns.length > 0) {
    const recentTurns = structuredTurns.slice(-10);
    return recentTurns.map((message, index) => {
      const intent = asString(message.content.intent) || "capture_goal";
      const autoTransition = asString(message.content.auto_transition);
      const phase: OrchestratorTurn["phase"] =
        intent === "ask_draft" || autoTransition === "draft"
          ? "draft"
          : intent === "ask_plan" ||
              intent === "ask_revise" ||
              autoTransition === "plan" ||
              autoTransition === "revise"
            ? "compare"
            : intent === "ask_confirm"
              ? "confirm"
              : intent === "ask_run" || autoTransition === "run"
                ? "execute"
                : "understand";
      const isLast = index === recentTurns.length - 1;
      const title =
        intent === "capture_goal"
          ? "Captured the mission objective"
          : intent === "add_constraint"
            ? "Tightened the working brief"
            : intent === "clarify"
            ? "Refined the mission brief"
              : intent === "ask_draft"
                ? "Shifted the mission into DAG drafting"
                : intent === "ask_plan"
                  ? "Shifted the mission into route comparison"
                  : intent === "ask_revise"
                    ? "Queued a route revision"
                    : intent === "ask_confirm"
                      ? "Moved the mission to confirmation"
                      : intent === "ask_run"
                        ? "Moved the mission toward execution"
                        : phase === "draft"
                          ? "Shaped a draft workflow"
                          : phase === "compare"
                            ? "Compiled a decision surface"
                            : phase === "confirm"
                              ? "Locked the execution source"
                              : phase === "execute"
                                ? "Opened the execution path"
                                : "Updated the mission understanding";
      const tone: ThreadTone =
        phase === "execute"
          ? "success"
          : phase === "confirm" || phase === "compare" || phase === "draft"
            ? isLast
              ? "warn"
              : "success"
            : isLast && detail.session.status === "draft"
              ? "neutral"
              : "success";
      return {
        key: message.message_id,
        phase,
        title,
        detail:
          normalizeWorkspaceNarrativeText(asString(message.content.workspace_impact)) ||
          normalizeMissionNarrativeText(asString(message.content.summary) || "") ||
          "The orchestrator recorded a new mission turn.",
        userRead:
          normalizeMissionNarrativeText(asString(message.content.user_read) || "") ||
          normalizeMissionNarrativeText(asString(message.content.summary) || "") ||
          null,
        workspaceImpact:
          normalizeWorkspaceNarrativeText(asString(message.content.workspace_impact)) ||
          normalizeWorkspaceNarrativeText(asString(message.content.summary)) ||
          null,
        nextActionLabel: normalizeMissionNarrativeText(asString(message.content.next_action_label) || "") || null,
        nextActionDetail: normalizeWorkspaceNarrativeText(asString(message.content.next_action_detail)),
        generatedOutputs: asStringArray(message.content.generated_outputs),
        tone,
        status: isLast ? "active" : "done",
      };
    });
  }

  const latestUserMessage =
    [...visibleMessages]
      .reverse()
      .find((message) => message.role === "user" && message.kind === "text") || null;
  const draftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  const planMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  const runMessage = getLatestMessage(visibleMessages, ["run_card"]);
  const summaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const subtaskMessage = getLatestMessage(visibleMessages, ["subtask_card"]);
  const approvalMessage = getLatestMessage(visibleMessages, ["approval_card"]);
  const humanInputMessage = getLatestMessage(visibleMessages, ["human_input_card"]);
  const artifactMessages = visibleMessages.filter((message) => message.kind === "artifact_card");
  const confirmedRevision = detail.session.confirmed_plan_revision ?? null;
  const confirmedOption = detail.session.confirmed_plan_option ?? null;
  const latestConversationReply = getLatestConversationReply(visibleMessages);
  const latestStructuredMessage =
    getLatestMessage(visibleMessages, [
      "draft_card",
      "plan_options_card",
      "plan_card",
      "run_card",
      "summary_card",
      "subtask_card",
      "approval_card",
      "human_input_card",
      "artifact_card",
    ]) || null;
  const latestUserText = asString(latestUserMessage?.content.text);
  const hasUnansweredUserInstruction =
    !!latestUserMessage &&
    (!latestStructuredMessage || latestUserMessage.created_at > latestStructuredMessage.created_at) &&
    (!latestConversationReply || latestUserMessage.created_at > latestConversationReply.created_at);
  const taskBrief = getThreadTaskBrief(detail, visibleMessages);

  const turns: OrchestratorTurn[] = [];

  turns.push({
    key: "understand",
    phase: "understand",
    title: "Read the mission and framed the objective",
    detail:
      getReadableSessionPlanSummary(detail, visibleMessages) ||
      taskBrief ||
      "The mission has context, but it still needs orchestration structure.",
    userRead: taskBrief,
    workspaceImpact:
      planMessage || draftMessage
        ? "The brief has been converted into orchestration state."
        : "The brief is available for the next orchestration move.",
    nextActionLabel: null,
    nextActionDetail: null,
    generatedOutputs: taskBrief ? ["Working brief"] : [],
    tone: planMessage || draftMessage ? "success" : "neutral",
    status: planMessage || draftMessage ? "done" : "active",
  });

  if (hasUnansweredUserInstruction) {
    turns.push({
      key: `latest-instruction-${latestUserMessage.message_id}`,
      phase: planMessage ? "compare" : draftMessage ? "draft" : "understand",
      title: "Accepted the latest instruction",
      detail: latestUserText
        ? planMessage
          ? `Using "${latestUserText}" as revision guidance for the next route option.`
          : draftMessage
            ? `Using "${latestUserText}" to promote the current draft into route options.`
            : `Using "${latestUserText}" as the source for the next DAG draft.`
        : "A new user instruction is waiting to be converted into the next orchestration step.",
      userRead: latestUserText,
      workspaceImpact: planMessage
        ? "This instruction should become a route revision instead of a silent note."
        : draftMessage
          ? "This instruction should shape the next planning pass."
          : "This instruction should shape the first DAG draft.",
      nextActionLabel: planMessage ? "Revise the route" : draftMessage ? "Create route options" : "Draft DAG",
      nextActionDetail: "Promote the latest instruction into a visible orchestration artifact.",
      generatedOutputs: ["Pending orchestration instruction"],
      tone: "warn",
      status: "active",
    });
  }

  if (draftMessage) {
    const draftTemplate = isObject(draftMessage.content.draft_template)
      ? draftMessage.content.draft_template
      : null;
    const plannerContext = isObject(draftMessage.content.planner_context)
      ? draftMessage.content.planner_context
      : null;
    turns.push({
      key: "draft",
      phase: "draft",
      title: "Sketched a draft workflow",
      detail: `Built ${
        asString(draftTemplate?.name) || asString(draftTemplate?.template_id) || "a draft DAG"
      } with ${Array.isArray(draftTemplate?.nodes) ? draftTemplate.nodes.length : 0} node(s) using ${
        getReadableDraftStrategy(asString(plannerContext?.draft_strategy))
      }.`,
      userRead: null,
      workspaceImpact: "The mission now has a draft DAG that can be promoted into comparable route options.",
      nextActionLabel: planMessage ? null : "Use draft to route",
      nextActionDetail: planMessage ? null : "Convert the draft into a primary route and a backup route.",
      generatedOutputs: ["DAG draft"],
      tone: planMessage ? "success" : "warn",
      status: planMessage ? "done" : "active",
    });
  }

  if (planMessage) {
    const revision = getPlanRevision(planMessage) || 1;
    const selectedOption = getSelectedPlanOption(planMessage) || "primary";
    turns.push({
      key: "compare",
      phase: "compare",
      title:
        planMessage.kind === "plan_options_card"
          ? "Compiled comparable execution routes"
          : "Compiled a runnable execution route",
      detail:
        planMessage.kind === "plan_options_card"
          ? `Revision v${revision} is now comparing the ${selectedOption} route against a backup path inside the same mission.`
          : `Revision v${revision} produced a single compiled route that is ready for confirmation review.`,
      userRead: null,
      workspaceImpact: "The workspace has concrete route options instead of a loose mission brief.",
      nextActionLabel: typeof confirmedRevision === "number" ? null : "Confirm or revise",
      nextActionDetail:
        typeof confirmedRevision === "number"
          ? null
          : "Choose a route, run it, or revise the plan from the preferred option.",
        generatedOutputs: planMessage.kind === "plan_options_card" ? ["Primary route", "Alternative route"] : ["Compiled route"],
      tone: typeof confirmedRevision === "number" ? "success" : "warn",
      status: typeof confirmedRevision === "number" ? "done" : "active",
    });
  }

  if (typeof confirmedRevision === "number") {
    turns.push({
      key: "confirm",
      phase: "confirm",
      title: "Locked the execution source",
      detail: `The mission is anchored to route v${confirmedRevision} / ${confirmedOption || "primary"} for the next real run.`,
      userRead: null,
      workspaceImpact: "The selected route is now the execution source.",
      nextActionLabel: runMessage ? null : "Run this plan",
      nextActionDetail: runMessage ? null : "Open a real run from the confirmed route.",
      generatedOutputs: ["Confirmed execution source"],
      tone: runMessage ? "success" : "warn",
      status: runMessage ? "done" : "active",
    });
  }

  if (runMessage || subtaskMessage) {
    const nodeName = asString(subtaskMessage?.content.node_name) || "the active node";
    const progressMessage =
      subtaskMessage && isObject(subtaskMessage.content.progress)
        ? asString(subtaskMessage.content.progress.message)
        : null;
    turns.push({
      key: "execute",
      phase: "execute",
      title: "Moved the mission into execution",
      detail: progressMessage
        ? `The run is currently working through ${nodeName}. Latest note: ${progressMessage}`
        : runMessage
          ? `A real run is open and continues to project its state back into the mission.`
          : `The execution path has been opened and is moving into active node work.`,
      userRead: null,
      workspaceImpact: "Runtime state is being projected back into the mission workspace.",
      nextActionLabel:
        detail.session.status === "completed" ? "Review outputs" : "Monitor execution",
      nextActionDetail:
        detail.session.status === "completed"
          ? "Inspect the final run state and any returned artifacts."
          : "Watch node progress or intervene from the composer.",
      generatedOutputs: ["Run state projection"],
      tone:
        detail.session.status === "completed"
          ? "success"
          : detail.session.status === "failed"
            ? "danger"
            : "success",
      status:
        detail.session.status === "completed" ||
        detail.session.status === "failed" ||
        detail.session.status === "cancelled"
          ? "done"
          : "active",
    });
  }

  if (approvalMessage || humanInputMessage) {
    turns.push({
      key: "waiting",
      phase: "waiting",
      title: approvalMessage ? "Paused at a human gate" : "Paused for missing input",
      detail: approvalMessage
        ? asString(approvalMessage.content.summary) ||
          "The next step is blocked until the pending approval is resolved."
        : asString(humanInputMessage?.content.summary) ||
          "The current run is waiting for a structured human input payload.",
      userRead: null,
      workspaceImpact: "Execution is paused until the human checkpoint is resolved.",
      nextActionLabel: approvalMessage ? "Resolve approval" : "Submit input",
      nextActionDetail: "Handle the gate from the mission so the run can continue.",
      generatedOutputs: [approvalMessage ? "Approval checkpoint" : "Input checkpoint"],
      tone: "warn",
      status: "active",
    });
  }

  if (detail.session.status === "completed" || artifactMessages.length > 0 || summaryMessage) {
    const summary =
      asString(summaryMessage?.content.current_summary) ||
      (artifactMessages.length > 0
        ? `${artifactMessages.length} artifact(s) were returned to the mission.`
        : "The latest run has closed and returned its final state.");
    turns.push({
      key: "deliver",
      phase: "deliver",
      title: detail.session.status === "completed" ? "Closed the loop with a deliverable" : "Prepared the handoff state",
      detail: summary,
      userRead: null,
      workspaceImpact: "The latest run has been condensed back into the orchestration workspace.",
      nextActionLabel: "Review outputs",
      nextActionDetail: "Review the final state or give a follow-up instruction for another pass.",
      generatedOutputs: artifactMessages.length > 0 ? ["Run summary", "Artifacts"] : ["Run summary"],
      tone:
        detail.session.status === "failed"
          ? "danger"
          : detail.session.status === "completed" || artifactMessages.length > 0
            ? "success"
            : "neutral",
      status:
        detail.session.status === "completed"
          ? "done"
          : artifactMessages.length > 0 || summaryMessage
            ? "active"
            : "pending",
    });
  }

  return turns;
}

export function buildWorkPackages(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): WorkPackage[] {
  const { activeContent } = getLatestPlanContext(detail, visibleMessages);
  const nodes = getCompiledNodes(activeContent);
  const approvalMessages = visibleMessages.filter((message) => message.kind === "approval_card");
  const humanInputMessages = visibleMessages.filter((message) => message.kind === "human_input_card");
  const latestSubtaskMessage = getLatestMessage(visibleMessages, ["subtask_card"]);
  const latestSummaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const taskBrief = getThreadTaskBrief(detail, visibleMessages);

  if (nodes.length === 0) {
    const blocker =
      approvalMessages.length > 0
        ? "Waiting on an approval before the next package can continue."
        : humanInputMessages.length > 0
          ? "Waiting on required human input before the next package can continue."
          : null;
    return [
      {
        key: "thread-package",
        title: "Mission shaping",
        summary:
          getReadableSessionPlanSummary(detail, visibleMessages) ||
          taskBrief ||
          "The mission is still converting mission intent into an executable work structure.",
        status:
          approvalMessages.length > 0 || humanInputMessages.length > 0
            ? "blocked"
            : getLatestMessage(visibleMessages, ["draft_card", "plan_card", "plan_options_card"])
              ? "active"
              : "pending",
        tone:
          approvalMessages.length > 0 || humanInputMessages.length > 0
            ? "warn"
            : getLatestMessage(visibleMessages, ["draft_card", "plan_card", "plan_options_card"])
              ? "success"
              : "neutral",
        nodeCount: 0,
        readyCount: 0,
        primaryAgentLabel: null,
        artifactExpectation: null,
        blocker,
        activeNodeName: null,
      },
    ];
  }

  const packages = new Map<
    string,
    {
      bucket: "research" | "draft" | "review" | "deliver" | "other";
      nodes: Array<Record<string, unknown>>;
    }
  >();

  for (const node of nodes) {
    const bucket = inferPackageBucket(node);
    const key = bucket;
    const entry = packages.get(key);
    if (entry) {
      entry.nodes.push(node);
    } else {
      packages.set(key, { bucket, nodes: [node] });
    }
  }

  const latestSubtaskName = asString(latestSubtaskMessage?.content.node_name);

  return [...packages.entries()]
    .map(([key, value]): WorkPackage => {
      const { title, summary } = getBucketPresentation(value.bucket);
      const statuses = value.nodes.map((node) => asString(node.status));
      const runningNode =
        value.nodes.find((node) => asString(node.name) === latestSubtaskName) ||
        value.nodes.find((node) => asString(node.status) === "running") ||
        value.nodes.find((node) => asString(node.status) === "waiting_human") ||
        null;
      const readyCount = value.nodes.filter((node) => asString(node.status) === "ready").length;
      const artifactExpectation = value.nodes
        .flatMap((node) => {
          if (!isObject(node.output_contract) || !Array.isArray(node.output_contract.expected_artifacts)) {
            return [];
          }
          return node.output_contract.expected_artifacts.filter(
            (item): item is string => typeof item === "string",
          );
        })
        .slice(0, 2)
        .join(", ");
      const agentCounts = new Map<string, number>();
      for (const node of value.nodes) {
        const label = asString(node.agent_profile) || asString(node.openclaw_agent_id);
        if (label) {
          agentCounts.set(label, (agentCounts.get(label) || 0) + 1);
        }
      }
      const primaryAgentLabel =
        [...agentCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;

      const hasWaiting = statuses.includes("waiting_human");
      const hasRunning = statuses.includes("running");
      const hasReady = statuses.includes("ready");
      const allDone = statuses.every((status) => status === "completed" || status === "skipped");
      const hasBlocked = statuses.some(
        (status) => status === "failed" || status === "cancelled" || status === "blocked",
      );
      const status: WorkPackage["status"] = hasBlocked
        ? "blocked"
        : hasWaiting
          ? "blocked"
          : hasRunning
            ? "active"
            : allDone
              ? "done"
              : hasReady
                ? "active"
                : "pending";
      const tone: ThreadTone =
        status === "blocked"
          ? "warn"
          : status === "done"
            ? "success"
            : status === "active"
              ? "success"
              : "neutral";
      const blocker =
        hasWaiting || approvalMessages.length > 0 || humanInputMessages.length > 0
          ? approvalMessages.length > 0
            ? asString(approvalMessages[0]?.content.summary) ||
              "This package is waiting on a human approval gate."
            : asString(humanInputMessages[0]?.content.summary) ||
              "This package is waiting on structured human input."
          : hasBlocked
            ? asString(latestSummaryMessage?.content.current_summary) || "A blocking run condition was reported."
            : null;

      return {
        key,
        title,
        summary,
        status,
        tone,
        nodeCount: value.nodes.length,
        readyCount,
        primaryAgentLabel,
        artifactExpectation: artifactExpectation || null,
        blocker,
        activeNodeName: runningNode ? asString(runningNode.name) : null,
      };
    })
    .sort((left, right) => {
      const leftPriority = getNodeStatusPriority(
        left.status === "active"
          ? "running"
          : left.status === "blocked"
            ? "waiting_human"
            : left.status === "pending"
              ? "pending"
              : "completed",
      );
      const rightPriority = getNodeStatusPriority(
        right.status === "active"
          ? "running"
          : right.status === "blocked"
            ? "waiting_human"
            : right.status === "pending"
              ? "pending"
              : "completed",
      );
      return rightPriority - leftPriority;
    });
}

export function buildOrchestratorBriefing(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): OrchestratorBriefing {
  const workspace = readWorkspaceState(detail);
  const latestGoalUpdate = getLatestMessage(visibleMessages, ["goal_update_card"]);
  const latestDecision = getLatestMessage(visibleMessages, ["decision_card"]);
  const latestDraftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  const latestRunMessage = getLatestMessage(visibleMessages, ["run_card"]);
  const latestSummaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const latestSubtaskMessage = getLatestMessage(visibleMessages, ["subtask_card"]);
  const approvalMessage = getLatestMessage(visibleMessages, ["approval_card"]);
  const humanInputMessage = getLatestMessage(visibleMessages, ["human_input_card"]);
  const artifactCount = visibleMessages.filter((message) => message.kind === "artifact_card").length;
  const { latestPlanMessage, activePlanMessage, activeOption, activeContent, confirmedRevision, confirmedOption } =
    getLatestPlanContext(detail, visibleMessages);
  const activePlanRevision = getPlanRevision(activePlanMessage);
  const activePlanValidation = getValidationFromPlanContent(activeContent);
  const activeValidationSummary = summarizeValidationState(activePlanValidation);
  const activePlanName = getPlanContentIdentity(activeContent);
  const activePlanReason = getPlanReason(activeContent);
  const taskBrief = getThreadTaskBrief(detail, visibleMessages);
  const workingGoal =
    asString(latestGoalUpdate?.content.working_goal) || asString(detail.session.working_goal) || taskBrief;
  const constraintsSummary =
    asString(latestGoalUpdate?.content.constraints_summary) || asString(detail.session.constraints_summary);
  const pendingDecision =
    asString(latestDecision?.content.pending_decision) || asString(detail.session.pending_decision);
  const openQuestions =
    Array.isArray(latestGoalUpdate?.content.open_questions)
      ? latestGoalUpdate?.content.open_questions
          .filter((item): item is string => typeof item === "string")
          .filter((item) => !isMetaMissionQuestion(item))
      : [];
  const subtaskNodeName = asString(latestSubtaskMessage?.content.node_name) || "the current node";
  const subtaskProgress =
    latestSubtaskMessage && isObject(latestSubtaskMessage.content.progress)
      ? asString(latestSubtaskMessage.content.progress.message)
      : null;
  const latestSummaryText =
    asString(latestSummaryMessage?.content.current_summary) ||
    getReadableSessionPlanSummary(detail, visibleMessages);

  if (workspace.planStale) {
    return {
      title: workspace.hasActivePlan
        ? "The current plan is stale against the latest brief."
        : "The current draft is stale against the latest brief.",
      summary:
        workspace.staleReason ||
        "The mission framing changed after the route was generated, so the workspace is holding execution until the route is refreshed.",
      tone: "warn",
      items: [
        {
          key: "understand",
          label: "Mission read",
          detail: workingGoal
            ? `I updated the working goal to: ${workingGoal}`
            : "I absorbed the latest instruction into the mission framing.",
          tone: "success",
        },
        {
          key: "move",
          label: "Current move",
          detail:
            constraintsSummary ||
            workspace.staleReason ||
            "The latest instruction changed the brief after the route was generated.",
          tone: "warn",
        },
        {
          key: "need",
          label: "Need from you",
          detail:
            workspace.nextRecommendedDetail ||
            "Revise the route so the workspace reflects the new mission framing before you confirm or run it.",
          tone: "warn",
        },
      ],
    };
  }

  if (approvalMessage) {
    return {
      title: "I reached a human approval gate.",
      summary: "The active run is paused until you resolve the pending approval.",
      tone: "warn",
      items: [
        {
          key: "understand",
          label: "Mission read",
          detail:
            activePlanName && activePlanRevision
              ? `I am executing ${activePlanName} through route v${activePlanRevision} / ${
                  confirmedOption || activeOption || "primary"
                }.`
              : "I already mapped the mission into an executable path and opened a run.",
          tone: "success",
        },
        {
          key: "move",
          label: "Current move",
          detail: subtaskProgress
            ? `I paused around ${subtaskNodeName}. Latest node note: ${subtaskProgress}`
            : `I paused the run at ${subtaskNodeName} because the next step requires approval.`,
          tone: "warn",
        },
        {
          key: "need",
          label: "Need from you",
          detail: "Approve or reject the pending step so I can continue the run from this mission.",
          tone: "warn",
        },
      ],
    };
  }

  if (humanInputMessage) {
    return {
      title: "I am waiting for missing mission input.",
      summary: "The run can continue as soon as the requested fields are filled in.",
      tone: "warn",
      items: [
        {
          key: "understand",
          label: "Mission read",
          detail:
            activePlanName && activePlanRevision
              ? `I already compiled ${activePlanName} into route v${activePlanRevision}.`
              : "I already have a partial execution path for this mission.",
          tone: "success",
        },
        {
          key: "move",
          label: "Current move",
          detail: subtaskProgress
            ? `I stopped at ${subtaskNodeName}. Latest node note: ${subtaskProgress}`
            : `I stopped at ${subtaskNodeName} because the run needs more structured input.`,
          tone: "warn",
        },
        {
          key: "need",
          label: "Need from you",
          detail: "Submit the requested input in the timeline so I can resume the current node.",
          tone: "warn",
        },
      ],
    };
  }

  if (detail.session.status === "completed") {
    return {
      title: "I finished the last orchestration loop.",
      summary:
        artifactCount > 0
          ? `The run completed and projected ${artifactCount} artifact(s) back into the mission.`
          : "The last linked run completed and the mission is ready for a follow-up instruction.",
      tone: "success",
      items: [
        {
          key: "understand",
          label: "Mission read",
          detail:
            activePlanName && confirmedRevision
              ? `I carried the mission through confirmed route v${confirmedRevision} / ${
                  confirmedOption || "primary"
                } using ${activePlanName}.`
              : "I carried the latest mission through the linked execution path.",
          tone: "success",
        },
        {
          key: "move",
          label: "Current move",
          detail:
            latestSummaryText ||
            "I have already closed the run and returned the final state to this mission.",
          tone: "success",
        },
        {
          key: "need",
          label: "Need from you",
          detail:
            artifactCount > 0
              ? "Review the returned artifacts or ask for another revision from this mission."
              : "Review the final summary or tell me how the next revision should change.",
          tone: "neutral",
        },
      ],
    };
  }

  if (detail.session.status === "running" || detail.session.status === "waiting_human") {
    return {
      title: "I am actively executing the mission.",
      summary: subtaskProgress
        ? `${subtaskNodeName} is currently at the live frontier.`
        : "A confirmed run is in flight and will keep projecting updates here.",
      tone: "success",
      items: [
        {
          key: "understand",
          label: "Mission read",
          detail:
            activePlanName && confirmedRevision
              ? `I anchored the mission on ${activePlanName} with route v${confirmedRevision} / ${
                  confirmedOption || "primary"
                }.`
              : "I already promoted the mission into a real run.",
          tone: "success",
        },
        {
          key: "move",
          label: "Current move",
          detail: subtaskProgress
            ? `I am working through ${subtaskNodeName}. Latest node note: ${subtaskProgress}`
            : `I am executing ${subtaskNodeName} and will keep writing updates back into the mission.`,
          tone: "success",
        },
        {
          key: "need",
          label: "Need from you",
          detail: "Nothing is blocked right now. You can watch the live story or seed a revision for the next pass.",
          tone: "neutral",
        },
      ],
    };
  }

  if (typeof confirmedRevision === "number") {
    return {
      title: "I have a confirmed execution path and I am holding the launch gate.",
      summary: activeValidationSummary.runHint,
      tone: activeValidationSummary.tone,
      items: [
        {
          key: "understand",
          label: "Mission read",
          detail:
            activePlanName && confirmedOption
              ? `I locked the mission onto ${activePlanName} via route v${confirmedRevision} / ${confirmedOption}.`
              : `I locked the mission onto route v${confirmedRevision}.`,
          tone: "success",
        },
        {
          key: "move",
          label: "Current move",
          detail: activeValidationSummary.isReadyForStrictRun
            ? "I am ready to create a strict run from the confirmed option."
            : "I am holding execution because the confirmed option still carries warnings you may want to revise.",
          tone: activeValidationSummary.tone,
        },
        {
          key: "need",
          label: "Need from you",
          detail: activeValidationSummary.isReadyForStrictRun
            ? "Run the confirmed option or send a revise directive to reshape it before launch."
            : "Either accept the risk and run, or revise the plan before opening a real run.",
          tone: activeValidationSummary.tone,
        },
      ],
    };
  }

  if (latestPlanMessage) {
    const revision = getPlanRevision(latestPlanMessage) || 1;
    const selectedOption = getSelectedPlanOption(latestPlanMessage) || "primary";
    return {
      title: "I translated the mission into executable route options.",
      summary:
        latestPlanMessage.kind === "plan_options_card"
          ? `Revision v${revision} is ready for comparison across a primary and backup route.`
          : `Revision v${revision} produced a single compiled route proposal.`,
      tone: "warn",
      items: [
        {
          key: "understand",
          label: "Mission read",
          detail: activePlanName
            ? `I matched the mission onto ${activePlanName}.`
            : `I compiled the mission into route revision v${revision}.`,
          tone: "success",
        },
        {
          key: "move",
          label: "Current move",
          detail:
            activePlanReason ||
            `My current recommendation is to start from the ${selectedOption} option in revision v${revision}.`,
          tone: "warn",
        },
        {
          key: "need",
          label: "Need from you",
          detail: "Confirm one option, run it directly, or tell me how to revise the plan from this mission.",
          tone: "warn",
        },
      ],
    };
  }

  if (latestDraftMessage) {
    const draftTemplate = isObject(latestDraftMessage.content.draft_template)
      ? latestDraftMessage.content.draft_template
      : null;
    const plannerContext = isObject(latestDraftMessage.content.planner_context)
      ? latestDraftMessage.content.planner_context
      : null;
    return {
      title: "I turned the ask into a draft workflow shape.",
      summary: `The draft is ready to be promoted into full route options.`,
      tone: "warn",
      items: [
        {
          key: "understand",
          label: "Mission read",
          detail: asString(latestDraftMessage.content.intent)
            ? `I drafted against the current intent: ${asString(latestDraftMessage.content.intent)}`
            : "I drafted from the latest mission context in the workspace.",
          tone: "success",
        },
        {
          key: "move",
          label: "Current move",
          detail: `I used ${
            asString(plannerContext?.draft_strategy) || "the current planner strategy"
          } to shape the first workflow route for this mission.`,
          tone: "warn",
        },
        {
          key: "need",
          label: "Need from you",
          detail: "Promote the draft into route options or discard it and ask me to draft again.",
          tone: "warn",
        },
      ],
    };
  }

  return {
    title: "I am still shaping the mission into a runnable workflow.",
    summary:
      pendingDecision ||
      "The mission has context, but no DAG draft or compiled route has been promoted yet.",
    tone: "neutral",
    items: [
      {
        key: "understand",
        label: "Mission read",
        detail: workingGoal
          ? `I currently have this working goal: ${workingGoal}`
          : getReadableSessionPlanSummary(detail, visibleMessages) || taskBrief
            ? `I currently have this mission framing: ${
                getReadableSessionPlanSummary(detail, visibleMessages) || taskBrief
              }`
            : "I only have the mission context that is already visible above.",
        tone: workingGoal ? "success" : "neutral",
      },
      {
        key: "constraints",
        label: "Constraints",
        detail:
          constraintsSummary ||
          "I do not have explicit constraints yet, so the workflow shape is still broad.",
        tone: constraintsSummary ? "warn" : "neutral",
      },
      {
        key: "need",
        label: "Need from you",
        detail:
          workspace.nextRecommendedDetail ||
          pendingDecision ||
          openQuestions[0] ||
          "Give me constraints, expected outputs, or tell me to draft the workflow so I can move from chat into orchestration.",
        tone: "warn",
      },
    ],
  };
}

export function buildExecutionNarrative(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): ExecutionNarrativeBeat[] {
  const latestPlanMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  const latestRunMessage = getLatestMessage(visibleMessages, ["run_card"]);
  const latestSummaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const latestSubtaskMessage = getLatestMessage(visibleMessages, ["subtask_card"]);
  const approvalMessage = getLatestMessage(visibleMessages, ["approval_card"]);
  const humanInputMessage = getLatestMessage(visibleMessages, ["human_input_card"]);
  const artifactCount = visibleMessages.filter((message) => message.kind === "artifact_card").length;
  const beats: ExecutionNarrativeBeat[] = [];
  const confirmedRevision = detail.session.confirmed_plan_revision ?? null;
  const confirmedOption = detail.session.confirmed_plan_option ?? null;

  if (typeof confirmedRevision === "number") {
    beats.push({
      key: "confirmed-source",
      title: "Locked the execution source",
      detail: latestRunMessage
        ? `Execution is anchored to confirmed route v${confirmedRevision} / ${
            confirmedOption || "primary"
          }.`
        : `Route v${confirmedRevision} / ${confirmedOption || "primary"} is confirmed and waiting to be launched.`,
      tone: latestRunMessage ? "success" : "warn",
      status: latestRunMessage ? "done" : "active",
    });
  } else if (latestPlanMessage) {
    const revision = getPlanRevision(latestPlanMessage) || 1;
    beats.push({
      key: "execution-gate",
      title: "Held execution behind a confirmation gate",
      detail: `Revision v${revision} is compiled, but a route option still needs to be confirmed before a real run starts.`,
      tone: "warn",
      status: "active",
    });
  }

  if (latestRunMessage) {
    const runId = asString(latestRunMessage.content.run_id) || detail.session.latest_run_id || "run";
    const status = asString(latestRunMessage.content.status);
    const planRevision = asNumber(latestRunMessage.content.plan_revision);
    const planOption =
      latestRunMessage.content.plan_option === "alternative" ? "alternative" : "primary";
    beats.push({
      key: "run-created",
      title: "Opened a real run",
      detail: planRevision
        ? `Started ${runId} from route v${planRevision} / ${planOption}. Current run state: ${
            status || "queued"
          }.`
        : `Started ${runId} from the current mission context.`,
      tone: getRunTone(status),
      status:
        status === "completed" || status === "failed" || status === "cancelled" ? "done" : "active",
    });
  }

  if (approvalMessage) {
    const summary = asString(approvalMessage.content.summary) || "A pending approval is blocking the next step.";
    beats.push({
      key: "approval-gate",
      title: "Paused at an approval gate",
      detail: summary,
      tone: "warn",
      status: "active",
    });
  } else if (humanInputMessage) {
    const summary =
      asString(humanInputMessage.content.summary) ||
      "A structured human input request is blocking the next step.";
    beats.push({
      key: "input-gate",
      title: "Paused for human input",
      detail: summary,
      tone: "warn",
      status: "active",
    });
  } else if (latestSubtaskMessage) {
    const nodeName = asString(latestSubtaskMessage.content.node_name) || "Current node";
    const status = asString(latestSubtaskMessage.content.status);
    const progress = isObject(latestSubtaskMessage.content.progress)
      ? latestSubtaskMessage.content.progress
      : null;
    const progressPercent = asNumber(progress?.percent);
    const progressMessage = asString(progress?.message);
    beats.push({
      key: "active-node",
      title: `Worked through ${nodeName}`,
      detail: progressMessage
        ? `${progressMessage}${typeof progressPercent === "number" ? ` (${progressPercent}%)` : ""}`
        : `Latest node state: ${status || "running"}${
            typeof progressPercent === "number" ? ` at ${progressPercent}%` : ""
          }.`,
      tone:
        detail.session.status === "completed"
          ? "success"
          : status === "failed"
            ? "danger"
            : "success",
      status: detail.session.status === "completed" ? "done" : "active",
    });
  }

  if (artifactCount > 0) {
    beats.push({
      key: "artifacts",
      title: "Projected outputs back into the mission",
      detail: `${artifactCount} artifact(s) were written back as mission-visible outputs.`,
      tone: "success",
      status: "done",
    });
  }

  if (latestSummaryMessage) {
    const status = asString(latestSummaryMessage.content.status);
    const summary =
      asString(latestSummaryMessage.content.current_summary) || "The latest run posted a summary update.";
    beats.push({
      key: "run-summary",
      title:
        status === "completed"
          ? "Closed the run successfully"
          : status === "failed"
            ? "Closed the run with a failure"
            : status === "cancelled"
              ? "Closed the run after cancellation"
              : "Posted a run summary",
      detail: summary,
      tone: getRunTone(status),
      status:
        status === "completed" || status === "failed" || status === "cancelled" ? "done" : "active",
    });
  }

  if (beats.length === 0) {
    return [
      {
        key: "execution-idle",
        title: "Execution has not started yet",
        detail:
          detail.session.current_goal || getReadableSessionPlanSummary(detail, visibleMessages)
            ? "The mission is still in planning mode. Draft a DAG or confirm a plan to open a real run."
            : "The mission is still purely conversational and has not been promoted into orchestration yet.",
        tone: "neutral",
        status: "pending",
      },
    ];
  }

  return beats;
}

export function buildWorkspaceArtifactSurfaces(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): WorkspaceArtifactSurface[] {
  const workspace = readWorkspaceState(detail);
  const latestGoalUpdate = getLatestMessage(visibleMessages, ["goal_update_card"]);
  const latestDecision = getLatestMessage(visibleMessages, ["decision_card"]);
  const latestDraftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  const latestSummaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const latestRunMessage = getLatestMessage(visibleMessages, ["run_card"]);
  const latestArtifactMessages = visibleMessages.filter((message) => message.kind === "artifact_card");
  const workPackages = buildWorkPackages(detail, visibleMessages);
  const planNarrative = (() => {
    const latestPlanMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
    return latestPlanMessage
      ? buildPlanOptionsNarrative({
          message: latestPlanMessage,
          confirmedPlanRevision: detail.session.confirmed_plan_revision ?? null,
          confirmedPlanOption: detail.session.confirmed_plan_option ?? null,
          activeReviseTarget: null,
        })
      : null;
  })();

  const workingGoal =
    asString(latestGoalUpdate?.content.working_goal) || workspace.workingGoal || getThreadTaskBrief(detail, visibleMessages);
  const constraintsSummary =
    asString(latestGoalUpdate?.content.constraints_summary) || workspace.constraintsSummary;
  const pendingDecision =
    asString(latestDecision?.content.pending_decision) || workspace.pendingDecision;
  const outputsCompleted =
    !!latestSummaryMessage && asString(latestSummaryMessage.content.status) === "completed";

  const surfaces: WorkspaceArtifactSurface[] = [
    {
      key: "brief",
      title: "Working brief",
      summary:
        workingGoal || "The mission goal has not been captured into a stable working brief yet.",
      tone: workingGoal ? "success" : "neutral",
      chips: [
        workspace.planStale ? "Route stale" : null,
        constraintsSummary ? "Constraints active" : null,
        workspace.openQuestions.filter((question) => !isMetaMissionQuestion(question)).length > 0
          ? `${workspace.openQuestions.filter((question) => !isMetaMissionQuestion(question)).length} open question(s)`
          : null,
      ].filter((item): item is string => !!item),
      detailLines: [
        constraintsSummary ? `Constraints: ${constraintsSummary}` : "Constraints are still broad.",
        pendingDecision ? `Next decision: ${pendingDecision}` : "No explicit next decision has been recorded yet.",
      ],
    },
    {
      key: "route",
      title: "Route model",
      summary:
        planNarrative
          ? `Revision v${planNarrative.revision} is the current route surface.`
          : latestDraftMessage
            ? "A DAG draft exists but has not been promoted into route options yet."
            : "No compiled route exists yet.",
      tone:
        workspace.planStale
          ? "warn"
          : planNarrative || latestDraftMessage
            ? "warn"
            : "neutral",
      chips: [
        workspace.activePlanTemplateName ? workspace.activePlanTemplateName : null,
        workspace.activePlanNodeCount !== null ? `${workspace.activePlanNodeCount} node(s)` : null,
        workspace.activePlanReadyFrontierCount !== null
          ? `${workspace.activePlanReadyFrontierCount} ready`
          : null,
      ].filter((item): item is string => !!item),
      detailLines: [
        workspace.staleReason ? `Route status: ${workspace.staleReason}` : "Route status is aligned with the latest brief.",
        workPackages.length > 0
          ? `Materialized packages: ${workPackages.length} package(s) are currently visible.`
          : "No materialized work packages are visible yet.",
      ],
    },
    {
      key: "decision",
      title: "Decision state",
      summary:
        planNarrative
          ? planNarrative.comparisonSummary
          : workspace.nextRecommendedDetail ||
            pendingDecision ||
            "The orchestrator has not exposed a concrete decision surface yet.",
      tone:
        workspace.needsConfirmation || planNarrative
          ? "warn"
          : workspace.nextRecommendedAction
            ? "success"
            : "neutral",
      chips: [
        workspace.confirmedPlanRevision !== null
          ? `Confirmed v${workspace.confirmedPlanRevision} / ${workspace.confirmedPlanOption || "primary"}`
          : null,
        workspace.nextRecommendedLabel || null,
      ].filter((item): item is string => !!item),
      detailLines: [
        workspace.nextRecommendedDetail || "No explicit next recommended move is recorded yet.",
        planNarrative
          ? `Focused option: ${planNarrative.focusedOption} / ${planNarrative.focusedTemplateName}.`
          : "A focused route will appear here after draft or plan generation.",
      ],
    },
    {
      key: "outputs",
      title: "Generated outputs",
      summary:
        latestArtifactMessages.length > 0
          ? `${latestArtifactMessages.length} artifact(s) and a run summary are available for review.`
          : outputsCompleted
            ? "Runtime state has been written back into the mission."
          : latestRunMessage || latestSummaryMessage
            ? "Runtime state is being written back into the mission."
            : "No runtime outputs have been generated yet.",
      tone:
        latestArtifactMessages.length > 0
          ? "success"
          : outputsCompleted
            ? "success"
          : latestRunMessage || latestSummaryMessage
            ? "warn"
            : "neutral",
      chips: [
        workspace.runStatus || null,
        workspace.latestSubtask?.nodeName ? `Node: ${workspace.latestSubtask.nodeName}` : null,
        workspace.artifactCount > 0 ? `${workspace.artifactCount} artifact(s)` : null,
      ].filter((item): item is string => !!item),
      detailLines: [
        workspace.latestRunSummary ||
          (outputsCompleted
            ? "The run completed and projected its final state back into the mission."
            : "No run summary has been projected yet."),
        workspace.latestSubtask?.progressMessage ||
          (outputsCompleted
            ? latestArtifactMessages.length > 0
              ? "Returned artifacts are available in the mission record."
              : "The run completed without returning artifact files."
            : "No active node progress is visible yet."),
      ],
    },
  ];

  return surfaces;
}

export function buildMissionSpecSummary(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
  pipelines?: MissionPipeline[],
  checkpoints?: MissionCheckpoint[],
): MissionSpecSummary {
  const workspace = readWorkspaceState(detail);
  const latestGoalUpdate = getLatestMessage(visibleMessages, ["goal_update_card"]);
  const latestDecision = getLatestMessage(visibleMessages, ["decision_card"]);
  const taskBrief = getThreadTaskBrief(detail, visibleMessages);
  const latestPlanContext = getLatestPlanContext(detail, visibleMessages);
  const activeNodes = getCompiledNodes(latestPlanContext.activeContent);
  const missionPipelines = pipelines || buildMissionPipelines(detail, visibleMessages);
  const missionCheckpoints = checkpoints || buildMissionCheckpoints(detail, visibleMessages);
  const sourceBrief =
    asString(latestGoalUpdate?.content.working_goal) ||
    workspace.workingGoal ||
    taskBrief ||
    asString(detail.session.current_goal);
  const constraints = uniqueStrings([
    asString(latestGoalUpdate?.content.constraints_summary),
    workspace.constraintsSummary,
  ]);
  const requestedOutputs = uniqueStrings(
    activeNodes.flatMap((node) => {
      if (!isObject(node.output_contract) || !Array.isArray(node.output_contract.expected_artifacts)) {
        return [];
      }
      return node.output_contract.expected_artifacts.filter(
        (item): item is string => typeof item === "string" && !!item.trim(),
      );
    }),
  );
  const openQuestions = uniqueStrings([
    ...asStringArray(latestGoalUpdate?.content.open_questions),
    ...workspace.openQuestions,
  ]).filter((item) => !isMetaMissionQuestion(item));
  const decisionFocus =
    asString(latestDecision?.content.pending_decision) ||
    workspace.pendingDecision ||
    workspace.nextRecommendedDetail ||
    null;
  const activePlanContent = latestPlanContext.activeContent;
  const selectedTemplateId =
    asString(activePlanContent?.template_id) ||
    asString(activePlanContent?.execution_template_id) ||
    null;
  const selectedTemplateName =
    workspace.activePlanTemplateName ||
    asString(activePlanContent?.template_name) ||
    selectedTemplateId;
  const latestRevision = workspace.latestPlanRevision ?? getPlanRevision(latestPlanContext.latestPlanMessage);
  const sourceRevision = asNumber(latestPlanContext.latestPlanMessage?.content.source_revision);
  const sourceOption = asPlanOption(latestPlanContext.latestPlanMessage?.content.source_option);

  return {
    objective: sourceBrief,
    sourceBrief: taskBrief,
    constraints,
    requestedOutputs,
    openQuestions,
    decisionFocus,
    route: {
      activeRevision: workspace.activePlanRevision ?? getPlanRevision(latestPlanContext.activePlanMessage),
      activeOption: workspace.activePlanOption || latestPlanContext.activeOption,
      latestRevision,
      confirmedRevision: workspace.confirmedPlanRevision,
      confirmedOption: workspace.confirmedPlanOption,
      selectedTemplateId,
      selectedTemplateName,
      alternativeAvailable:
        latestPlanContext.latestPlanMessage?.kind === "plan_options_card" &&
        isObject(latestPlanContext.latestPlanMessage.content.alternative),
      stale: workspace.planStale,
      staleReason: workspace.staleReason,
    },
    pipelineSummary: buildMissionPipelineSummary(missionPipelines),
    checkpointSummary: buildMissionCheckpointSummary(missionCheckpoints),
    revisionLineage: {
      sourceRevision,
      sourceOption,
      latestRevision,
      confirmedRevision: workspace.confirmedPlanRevision,
      confirmedOption: workspace.confirmedPlanOption,
    },
  };
}

export function buildMissionPipelines(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): MissionPipeline[] {
  return buildWorkPackages(detail, visibleMessages).map((pkg) => ({
    key: pkg.key,
    title: pkg.title,
    summary: pkg.summary,
    status: pkg.status,
    tone: pkg.tone,
    nodeCount: pkg.nodeCount,
    readyCount: pkg.readyCount,
    primaryAgentLabel: pkg.primaryAgentLabel,
    artifactExpectation: pkg.artifactExpectation,
    blocker: pkg.blocker,
    activeNodeName: pkg.activeNodeName,
  }));
}

export function buildMissionCheckpoints(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): MissionCheckpoint[] {
  const workspace = readWorkspaceState(detail);
  const latestDraftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  const latestPlanMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  const latestRunMessage = getLatestMessage(visibleMessages, ["run_card"]);
  const latestSummaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const approvalCount = visibleMessages.filter((message) => message.kind === "approval_card").length;
  const humanInputCount = visibleMessages.filter((message) => message.kind === "human_input_card").length;
  const interventionCount = visibleMessages.filter((message) => message.kind === "intervention_card").length;
  const dagPatchCount = visibleMessages.filter((message) => message.kind === "dag_patch_card").length;
  const artifactCount = visibleMessages.filter((message) => message.kind === "artifact_card").length;
  const confirmedRevision = detail.session.confirmed_plan_revision ?? null;

  const checkpoints: MissionCheckpoint[] = [
    {
      key: "brief-captured",
      label: "Mission brief",
      detail:
        workspace.workingGoal ||
        getReadableSessionPlanSummary(detail, visibleMessages) ||
        "Mission brief has not been stabilized yet.",
      tone: workspace.workingGoal ? "success" : "neutral",
      status: workspace.workingGoal ? "done" : "active",
    },
    {
      key: "draft-shaped",
      label: "Workflow draft",
      detail: latestDraftMessage
        ? "A draft workflow shape exists and can be promoted into full route options."
        : "No DAG draft has been shaped yet.",
      tone: latestDraftMessage ? "warn" : "neutral",
      status: latestDraftMessage ? "done" : "pending",
    },
    {
      key: "route-compiled",
      label: "Route comparison",
      detail: latestPlanMessage
        ? `Revision v${getPlanRevision(latestPlanMessage) || 1} is available in the workspace.`
        : "Comparable routes are not compiled yet.",
      tone: latestPlanMessage ? "warn" : "neutral",
      status: latestPlanMessage ? "done" : "pending",
    },
    {
      key: "launch-gate",
      label: "Launch gate",
      detail:
        typeof confirmedRevision === "number"
          ? `Execution is anchored to route v${confirmedRevision} / ${detail.session.confirmed_plan_option || "primary"}.`
          : "No route has been confirmed for execution yet.",
      tone: typeof confirmedRevision === "number" ? "success" : "warn",
      status: typeof confirmedRevision === "number" ? "done" : latestPlanMessage ? "active" : "pending",
    },
    {
      key: "runtime-state",
      label: "Runtime",
      detail: latestRunMessage
        ? asString(latestSummaryMessage?.content.current_summary) ||
          workspace.latestRunSummary ||
          "A real run is in flight and projecting state back."
        : "No real run has been opened yet.",
      tone: latestRunMessage ? getRunTone(asString(latestRunMessage.content.status)) : "neutral",
      status: latestRunMessage ? "active" : "pending",
    },
  ];

  if (approvalCount > 0 || humanInputCount > 0) {
    checkpoints.push({
      key: "human-gates",
      label: "Human gates",
      detail:
        approvalCount > 0
          ? `${approvalCount} approval gate(s) are waiting on review.`
          : `${humanInputCount} structured input request(s) are blocking the next step.`,
      tone: "warn",
      status: "active",
    });
  }

  if (artifactCount > 0) {
    checkpoints.push({
      key: "outputs-returned",
      label: "Outputs returned",
      detail: `${artifactCount} artifact(s) have been projected back into the mission record.`,
      tone: "success",
      status: detail.session.status === "completed" ? "done" : "active",
    });
  }

  if (interventionCount > 0 || dagPatchCount > 0) {
    checkpoints.push({
      key: "runtime-steering",
      label: "Runtime steering",
      detail:
        dagPatchCount > 0
          ? `${dagPatchCount} runtime patch proposal(s) are attached to the mission for review or replay.`
          : `${interventionCount} runtime intervention record(s) are attached to the mission.`,
      tone: dagPatchCount > 0 ? "warn" : "neutral",
      status: "active",
    });
  }

  return checkpoints;
}

function getMissionOutputTone(status: MissionOutput["status"]): ThreadTone {
  if (status === "returned") {
    return "success";
  }
  if (status === "prepared" || status === "in_progress") {
    return "warn";
  }
  return "neutral";
}

export function buildMissionOutputs(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
  requestedOutputs: string[],
  pipelines: MissionPipeline[],
): MissionOutput[] {
  const workspace = readWorkspaceState(detail);
  const outputs = new Map<string, MissionOutput>();
  const statusRank: Record<MissionOutput["status"], number> = {
    requested: 1,
    prepared: 2,
    in_progress: 3,
    returned: 4,
  };

  function upsert(inputOutput: MissionOutput) {
    const existing = outputs.get(inputOutput.key);
    if (!existing) {
      outputs.set(inputOutput.key, inputOutput);
      return;
    }
    const status =
      statusRank[inputOutput.status] > statusRank[existing.status]
        ? inputOutput.status
        : existing.status;
    outputs.set(inputOutput.key, {
      ...existing,
      title: inputOutput.title || existing.title,
      summary:
        statusRank[inputOutput.status] >= statusRank[existing.status]
          ? inputOutput.summary
          : existing.summary,
      status,
      tone: getMissionOutputTone(status),
      source:
        statusRank[inputOutput.status] >= statusRank[existing.status]
          ? inputOutput.source
          : existing.source,
      pipelineKeys: uniqueStrings([...existing.pipelineKeys, ...inputOutput.pipelineKeys]),
      artifactMessageIds: uniqueStrings([
        ...existing.artifactMessageIds,
        ...inputOutput.artifactMessageIds,
      ]),
      detailLines: uniqueStrings([...existing.detailLines, ...inputOutput.detailLines]),
    });
  }

  for (const output of requestedOutputs) {
    upsert({
      key: slugKey(output, "requested-output"),
      title: output,
      summary: "Requested by the mission contract.",
      status: "requested",
      tone: "neutral",
      source: "mission_spec",
      pipelineKeys: [],
      artifactMessageIds: [],
      detailLines: ["Tracked from MissionSpec requested outputs."],
    });
  }

  for (const pipeline of pipelines) {
    const expectedOutputs = pipeline.artifactExpectation
      ? pipeline.artifactExpectation
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    for (const output of expectedOutputs) {
      const status: MissionOutput["status"] = pipeline.status === "done" ? "in_progress" : "prepared";
      upsert({
        key: slugKey(output, pipeline.key),
        title: output,
        summary: `${pipeline.title} is prepared to produce this output.`,
        status,
        tone: getMissionOutputTone(status),
        source: "pipeline",
        pipelineKeys: [pipeline.key],
        artifactMessageIds: [],
        detailLines: [
          `Prepared by ${pipeline.title}.`,
          pipeline.primaryAgentLabel ? `Lead agent: ${pipeline.primaryAgentLabel}` : null,
        ].filter((item): item is string => !!item),
      });
    }
  }

  const artifactMessages = visibleMessages.filter((message) => message.kind === "artifact_card");
  for (const message of artifactMessages) {
    const artifactName =
      asString(message.content.name) ||
      asString(message.content.artifact_id) ||
      "Returned artifact";
    const storageUri = asString(message.content.storage_uri);
    const mimeType = asString(message.content.mime_type);
    upsert({
      key: slugKey(artifactName, message.message_id),
      title: artifactName,
      summary: "Returned by runtime and attached to the mission record.",
      status: "returned",
      tone: "success",
      source: "artifact",
      pipelineKeys: [],
      artifactMessageIds: [message.message_id],
      detailLines: [
        storageUri ? `Storage: ${storageUri}` : null,
        mimeType ? `Type: ${mimeType}` : null,
      ].filter((item): item is string => !!item),
    });
  }

  const latestSummaryMessage = getLatestMessage(visibleMessages, ["summary_card"]);
  const latestRunMessage = getLatestMessage(visibleMessages, ["run_card"]);
  const hasRuntimeSignal =
    !!latestRunMessage ||
    !!latestSummaryMessage ||
    !!detail.latest_run?.run_id ||
    !!detail.session.latest_run_id ||
    ["running", "waiting_human", "completed", "failed", "cancelled"].includes(detail.session.status);
  const runStatus =
    workspace.runStatus ||
    asString(latestSummaryMessage?.content.status) ||
    asString(latestRunMessage?.content.status) ||
    detail.latest_run?.status ||
    detail.session.status;
  const runSummary =
    workspace.latestRunSummary || asString(latestSummaryMessage?.content.current_summary);
  const latestRunId = detail.latest_run?.run_id || detail.session.latest_run_id || workspace.latestRunId;
  if (hasRuntimeSignal && outputs.size === 0) {
    const status: MissionOutput["status"] = runStatus === "completed" ? "returned" : "in_progress";
    upsert({
      key: "runtime-handoff",
      title: "Runtime handoff",
      summary: runSummary || "Runtime state is being projected back into the mission.",
      status,
      tone: getMissionOutputTone(status),
      source: "runtime",
      pipelineKeys: [],
      artifactMessageIds: [],
      detailLines: [
        latestRunId ? `Run: ${latestRunId}` : null,
        runStatus ? `Status: ${runStatus}` : null,
      ].filter((item): item is string => !!item),
    });
  }

  if (hasRuntimeSignal && runStatus && runStatus !== "completed") {
    for (const output of outputs.values()) {
      if (output.status !== "requested" && output.status !== "returned") {
        output.status = "in_progress";
        output.tone = getMissionOutputTone(output.status);
        output.source = output.source === "artifact" ? output.source : "runtime";
        output.summary = runSummary || output.summary;
      }
    }
  }

  return [...outputs.values()];
}

export function buildMissionWorkspaceSections(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
  spec: MissionSpecSummary,
  pipelines: MissionPipeline[],
  checkpoints: MissionCheckpoint[],
  outputs: MissionOutput[],
  _artifactSurfaces: WorkspaceArtifactSurface[],
): MissionWorkspaceSection[] {
  const workspace = readWorkspaceState(detail);
  const returnedOutputCount = outputs.filter((output) => output.status === "returned").length;
  const preparedOutputCount = outputs.filter(
    (output) => output.status === "prepared" || output.status === "in_progress",
  ).length;
  const blockedPipelineCount = pipelines.filter((pipeline) => pipeline.status === "blocked").length;
  const activeCheckpointCount = checkpoints.filter((checkpoint) => checkpoint.status === "active").length;
  const latestRunId = detail.latest_run?.run_id || detail.session.latest_run_id || workspace.latestRunId;
  const runStatus = workspace.runStatus || detail.latest_run?.status || detail.session.status;

  return [
    {
      key: "brief",
      label: "Brief",
      title: spec.objective || "Mission brief",
      summary: spec.sourceBrief || spec.decisionFocus || "Mission context is still being shaped.",
      tone: spec.objective ? "success" : "neutral",
      status: spec.objective ? "done" : "active",
      itemCount: spec.constraints.length + spec.openQuestions.length,
      detailLines: [
        spec.constraints.length > 0 ? `Constraints: ${spec.constraints.join(" / ")}` : "No explicit constraints yet.",
        spec.openQuestions.length > 0 ? `${spec.openQuestions.length} open question(s).` : "No open questions are blocking the brief.",
      ],
    },
    {
      key: "work",
      label: "Active work",
      title:
        pipelines.length > 0
          ? `${pipelines.length} pipeline${pipelines.length === 1 ? "" : "s"} materialized`
          : "Pipelines not materialized",
      summary:
        blockedPipelineCount > 0
          ? `${blockedPipelineCount} pipeline(s) need attention before execution can continue.`
          : pipelines[0]?.summary || "Compiled work packages will appear here once a route exists.",
      tone: blockedPipelineCount > 0 ? "warn" : pipelines.length > 0 ? "success" : "neutral",
      status:
        blockedPipelineCount > 0
          ? "blocked"
          : pipelines.some((pipeline) => pipeline.status === "active")
            ? "active"
            : pipelines.length > 0
              ? "done"
              : "pending",
      itemCount: pipelines.length,
      detailLines: [
        `${pipelines.filter((pipeline) => pipeline.status === "active").length} active.`,
        `${pipelines.filter((pipeline) => pipeline.status === "done").length} complete.`,
        `${preparedOutputCount} output target(s) prepared by pipelines.`,
      ],
    },
    {
      key: "checkpoints",
      label: "Checkpoints",
      title: `${spec.checkpointSummary.completed}/${spec.checkpointSummary.total} checkpoints complete`,
      summary:
        activeCheckpointCount > 0
          ? `${activeCheckpointCount} checkpoint(s) are currently active.`
          : "Mission checkpoints are waiting for the next orchestration step.",
      tone: activeCheckpointCount > 0 ? "warn" : checkpoints.length > 0 ? "success" : "neutral",
      status:
        activeCheckpointCount > 0
          ? "active"
          : checkpoints.length > 0 && spec.checkpointSummary.completed === spec.checkpointSummary.total
            ? "done"
            : "pending",
      itemCount: checkpoints.length,
      detailLines: checkpoints.slice(0, 4).map((checkpoint) => checkpoint.label),
    },
    {
      key: "outputs",
      label: "Outputs",
      title:
        outputs.length > 0
          ? `${outputs.length} mission output${outputs.length === 1 ? "" : "s"} tracked`
          : "Outputs not defined",
      summary:
        returnedOutputCount > 0
          ? `${returnedOutputCount} output(s) have returned to the mission.`
          : preparedOutputCount > 0
            ? `${preparedOutputCount} output target(s) are prepared or in progress.`
            : "Requested outputs will appear here after the mission is routed.",
      tone: returnedOutputCount > 0 ? "success" : preparedOutputCount > 0 ? "warn" : "neutral",
      status: returnedOutputCount > 0 ? "done" : preparedOutputCount > 0 ? "active" : "pending",
      itemCount: outputs.length,
      detailLines: outputs.slice(0, 4).map((output) => `${output.title}: ${output.status}`),
    },
    {
      key: "runtime",
      label: "Runtime",
      title: latestRunId ? `Run ${latestRunId}` : "Runtime not launched",
      summary: workspace.latestRunSummary || "Runtime state will become active after launch.",
      tone: getRunTone(runStatus),
      status:
        detail.session.status === "failed" || detail.session.status === "cancelled"
          ? "blocked"
          : latestRunId
            ? detail.session.status === "completed"
              ? "done"
              : "active"
            : "pending",
      itemCount: latestRunId ? 1 : 0,
      detailLines: [
        runStatus ? `Status: ${runStatus}` : "No runtime status yet.",
        latestRunId ? `Run id: ${latestRunId}` : "No active run id.",
      ],
    },
  ];
}

export function buildMissionSnapshot(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): MissionSnapshot {
  const workspace = readWorkspaceState(detail);
  const overview = deriveThreadOverview(detail, visibleMessages);
  const briefing = buildOrchestratorBriefing(detail, visibleMessages);
  const turns = buildOrchestratorTurns(detail, visibleMessages);
  const pipelines = buildMissionPipelines(detail, visibleMessages);
  const checkpoints = buildMissionCheckpoints(detail, visibleMessages);
  const spec = buildMissionSpecSummary(detail, visibleMessages, pipelines, checkpoints);
  const artifactSurfaces = buildWorkspaceArtifactSurfaces(detail, visibleMessages);
  const outputs = buildMissionOutputs(detail, visibleMessages, spec.requestedOutputs, pipelines);
  const workspaceSections = buildMissionWorkspaceSections(
    detail,
    visibleMessages,
    spec,
    pipelines,
    checkpoints,
    outputs,
    artifactSurfaces,
  );
  const latestDraftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  const latestPlanMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  const latestReply = getLatestConversationReply(visibleMessages);
  const latestUserText = asString(
    [...visibleMessages]
      .reverse()
      .find((message) => message.role === "user" && message.kind === "text")?.content.text,
  );
  const latestNarrativeTurn =
    turns.find((turn) => turn.status === "active") || turns[turns.length - 1] || null;
  const planNarrative =
    latestPlanMessage &&
    buildPlanOptionsNarrative({
      message: latestPlanMessage,
      confirmedPlanRevision: detail.session.confirmed_plan_revision ?? null,
      confirmedPlanOption: detail.session.confirmed_plan_option ?? null,
      activeReviseTarget: null,
    });
  const routeRefreshNeeded =
    workspace.planStale === true &&
    workspace.stage !== "execute" &&
    workspace.stage !== "waiting" &&
    workspace.stage !== "deliver";
  let activeStageKey: MissionWorkspaceStageKey = "briefing";
  if (workspace.stage === "draft" || workspace.stage === "compare" || workspace.stage === "confirm") {
    activeStageKey = "plan";
  } else if (
    workspace.stage === "execute" ||
    workspace.stage === "waiting" ||
    workspace.stage === "deliver"
  ) {
    activeStageKey = "execution";
  } else if (latestPlanMessage || latestDraftMessage) {
    activeStageKey = "plan";
  } else if (pipelines.length > 0) {
    activeStageKey = "work";
  } else if (latestReply || latestUserText) {
    activeStageKey = "thread";
  }

  const stages: MissionStageSummary[] = [
    {
      key: "briefing",
      label: "Mission brief",
      title: spec.objective || briefing.title || overview.headline || "Mission intake",
      detail:
        spec.constraints.length > 0
          ? `Constraints: ${spec.constraints.join(" / ")}`
          : briefing.summary || overview.detail || "Mission context is still being shaped.",
      metric: spec.openQuestions.length > 0 ? `${spec.openQuestions.length} open question(s)` : "brief ready",
      tone: routeRefreshNeeded ? "warn" : briefing.tone,
      status: activeStageKey === "briefing" ? "active" : spec.objective ? "done" : "pending",
    },
    {
      key: "work",
      label: "Pipelines",
      title:
        pipelines.length > 1
          ? `${pipelines.length} pipelines are materialized`
          : pipelines[0]?.title || "Pipelines not materialized",
      detail:
        pipelines[0]?.summary ||
        "The orchestrator will expose concrete pipelines here after a route is compiled.",
      metric: `${pipelines.reduce((total, item) => total + item.nodeCount, 0)} node(s)`,
      tone:
        pipelines.some((item) => item.status === "blocked")
          ? "warn"
          : pipelines.some((item) => item.status === "active" || item.status === "done")
            ? "success"
            : "neutral",
      status:
        activeStageKey === "work"
          ? "active"
          : pipelines.length > 0
            ? "done"
            : latestPlanMessage || latestDraftMessage
              ? "pending"
              : "pending",
    },
    {
      key: "plan",
      label: "Route",
      title: planNarrative
        ? `Route revision v${planNarrative.revision}`
        : latestDraftMessage
          ? "Draft workflow shape is ready"
          : "No route yet",
      detail:
        routeRefreshNeeded
          ? workspace.staleReason || workspace.nextRecommendedDetail || "The current route needs to be refreshed."
          : planNarrative?.comparisonSummary ||
            workspace.pendingDecision ||
            "Route comparison will appear after DAG drafting or plan compilation.",
      metric: planNarrative
        ? `${planNarrative.summaries.length} option(s)`
        : latestDraftMessage
          ? `${workspace.draftNodeCount || 0} draft node(s)`
          : "route pending",
      tone: routeRefreshNeeded ? "warn" : latestPlanMessage || latestDraftMessage ? "warn" : "neutral",
      status:
        activeStageKey === "plan"
          ? "active"
          : latestPlanMessage || latestDraftMessage
            ? "done"
            : "pending",
    },
    {
      key: "execution",
      label: "Runtime",
      title:
        workspace.latestSubtask?.nodeName ||
        checkpoints.find((checkpoint) => checkpoint.key === "runtime-state")?.label ||
        "Runtime story",
      detail:
        workspace.latestSubtask?.progressMessage ||
        workspace.latestRunSummary ||
        checkpoints.find((checkpoint) => checkpoint.key === "runtime-state")?.detail ||
        "Runtime events will be condensed here after launch.",
      metric: workspace.latestRunId ? workspace.runStatus || "run active" : "not launched",
      tone: overview.stageTone,
      status:
        activeStageKey === "execution"
          ? "active"
          : workspace.latestRunId || detail.session.status === "completed"
            ? "done"
            : "pending",
    },
    {
      key: "thread",
      label: "Conversation",
      title: latestReply ? "Live mission thread" : "Conversation has not started",
      detail:
        (latestReply ? getConversationMessageText(latestReply) : null) ||
        "The mission thread stays live while the workspace holds the evolving orchestration state.",
      metric: `${visibleMessages.filter((message) => isConversationTextMessage(message)).length} turn(s)`,
      tone: latestReply ? "neutral" : "neutral",
      status: activeStageKey === "thread" ? "active" : latestReply || latestUserText ? "done" : "pending",
    },
  ];

  return {
    workspace_contract_version: FALLBACK_MISSION_WORKSPACE_CONTRACT_VERSION,
    missionTitle: detail.session.title || "Mission",
    missionSummary:
      latestNarrativeTurn?.detail ||
      briefing.summary ||
      overview.detail ||
      "Mission workspace is ready for the next orchestration move.",
    missionStatusLabel: overview.stageLabel,
    missionStatusTone: overview.stageTone,
    objective: spec.objective,
    spec,
    stages,
    pipelines,
    checkpoints,
    outputs,
    workspaceSections,
    artifactSurfaces,
    nextActionLabel: workspace.nextRecommendedLabel || overview.nextStepLabel,
    nextActionDetail:
      normalizeWorkspaceNarrativeText(workspace.nextRecommendedDetail) || overview.nextStepDetail,
    latestUserInstruction: latestUserText,
    orchestratorReadback: latestNarrativeTurn?.userRead || briefing.summary || overview.detail,
    latestOrchestratorReply: latestReply ? getConversationMessageText(latestReply) : null,
    activeRouteRevision: spec.route.activeRevision,
    activeRouteOption: spec.route.activeOption,
    activeRunId: workspace.latestRunId || detail.session.latest_run_id || null,
    conversationTurns: visibleMessages.filter((message) => isConversationTextMessage(message)).length,
    evidenceCount: visibleMessages.filter((message) => !isConversationTextMessage(message)).length,
  };
}

function buildReadableComposerDirectiveChips(
  recommendedKey: string,
  confirmedRevision: number | null,
): ComposerDirectiveChip[] {
  const chips: ComposerDirectiveChip[] = [
    {
      key: "draft-then-plan",
      label: "Draft DAG",
      instruction:
        "First draft a DAG from this mission, then turn the draft into complete route options. Do not create a run yet.",
      recommended: false,
    },
    {
      key: "compare-plans",
      label: "Two routes",
      instruction:
        "Give me one primary route and one alternative route. Both must be complete, and explain the differences and recommendation reasons clearly.",
      recommended: false,
    },
    {
      key: "approval-gate",
      label: "Approval gate",
      instruction:
        "Add a human approval node before the key output. Pause for my confirmation before continuing.",
      recommended: false,
    },
    {
      key: "parallelize",
      label: "Parallelize",
      instruction:
        "Convert independent steps into a parallel fan-out, then add a consolidate node to merge the results.",
      recommended: false,
    },
    {
      key: "shorten",
      label: "Shorten",
      instruction:
        "Shorten this plan to only the necessary nodes and deliverables. Remove unnecessary intermediate steps.",
      recommended: false,
    },
    {
      key: "research-then-summarize",
      label: "Research first",
      instruction:
        "Add research and context collection first, then add a separate summary node for conclusions and next-step recommendations.",
      recommended: false,
    },
    {
      key: "confirm-before-run",
      label: "Confirm first",
      instruction:
        "Do not create a run directly. Return the final revision to the mission and wait for my confirmation before execution.",
      recommended: false,
    },
    {
      key: "capture-next-pass",
      label: "Next pass note",
      instruction:
        "Do not mutate the active run yet. Capture this note in the mission and use it as revision guidance for the next pass after the current run completes or pauses.",
      recommended: false,
    },
  ];

  return chips.map((chip) => ({
    ...chip,
    recommended:
      chip.key === recommendedKey ||
      (chip.key === "confirm-before-run" &&
        confirmedRevision === null &&
        recommendedKey !== "capture-next-pass"),
  }));
}

export function buildComposerDirectiveChips(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): ComposerDirectiveChip[] {
  const latestPlanMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  const latestDraftMessage = getLatestMessage(visibleMessages, ["draft_card"]);
  const approvals = visibleMessages.filter((message) => message.kind === "approval_card").length;
  const humanInputs = visibleMessages.filter((message) => message.kind === "human_input_card").length;
  const confirmedRevision = detail.session.confirmed_plan_revision ?? null;
  const recommendedKey =
    approvals > 0 ||
    humanInputs > 0 ||
    detail.session.status === "running" ||
    detail.session.status === "waiting_human"
      ? "capture-next-pass"
      : latestPlanMessage
        ? "parallelize"
        : latestDraftMessage
          ? "compare-plans"
          : "draft-then-plan";

  return buildReadableComposerDirectiveChips(recommendedKey, confirmedRevision);
}

export function buildComposerDirectiveChipsV2(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): ComposerDirectiveChip[] {
  return buildComposerDirectiveChips(detail, visibleMessages);
}

export function projectThreadMessages(input: {
  messages: SessionMessageRecord[];
  dismissedDraftIds?: string[];
  confirmedPlanRevision?: number | null;
  showPlanningHistory?: boolean;
}): ThreadMessageProjection {
  const {
    messages,
    dismissedDraftIds = [],
    confirmedPlanRevision = null,
    showPlanningHistory = false,
  } = input;

  const planMessages = messages.filter(
    (message) => message.kind === "plan_card" || message.kind === "plan_options_card",
  );
  const latestPlanRevision = planMessages.reduce<number | null>((latest, message) => {
    const revision = getPlanRevision(message);
    if (revision === null) {
      return latest;
    }
    return latest === null || revision > latest ? revision : latest;
  }, confirmedPlanRevision);

  let hiddenPlanningRevisionCount = 0;
  let hiddenPlannerMessageCount = 0;
  const hiddenPlanRevisions = new Set<number>();

  const visibleMessages = messages.filter((message) => {
    if (
      message.kind === "draft_card" &&
      dismissedDraftIds.includes(message.message_id)
    ) {
      hiddenPlannerMessageCount += 1;
      return false;
    }

    if (!showPlanningHistory && (message.kind === "plan_card" || message.kind === "plan_options_card")) {
      const revision = getPlanRevision(message);
      if (latestPlanRevision !== null && revision !== null && revision < latestPlanRevision) {
        if (!hiddenPlanRevisions.has(revision)) {
          hiddenPlanRevisions.add(revision);
          hiddenPlannerMessageCount += 1;
          hiddenPlanningRevisionCount += 1;
        }
        return false;
      }
    }

    if (
      message.role === "orchestrator" &&
      message.kind === "text" &&
      typeof message.content.text === "string" &&
      /confirmed plan v\d+/i.test(message.content.text)
    ) {
      return false;
    }

    return true;
  });

  return {
    visibleMessages,
    hiddenPlanningRevisionCount,
    hiddenPlannerMessageCount,
  };
}

export function buildExecutionNarrativeV2(
  detail: ThreadDetail,
  visibleMessages: SessionMessageRecord[],
): ExecutionNarrativeBeat[] {
  const latestPlanMessage = getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  const latestRunMessage = getLatestMessage(visibleMessages, ["run_card"]);
  const approvalMessages = visibleMessages.filter((message) => message.kind === "approval_card");
  const humanInputMessages = visibleMessages.filter((message) => message.kind === "human_input_card");
  const interventionMessages = visibleMessages.filter((message) => message.kind === "intervention_card");
  const dagPatchMessages = visibleMessages.filter((message) => message.kind === "dag_patch_card");
  const artifactMessages = visibleMessages.filter((message) => message.kind === "artifact_card");
  const summaryMessages = visibleMessages.filter((message) => message.kind === "summary_card");
  const subtaskMessages = visibleMessages.filter((message) => message.kind === "subtask_card");
  const confirmedRevision = detail.session.confirmed_plan_revision ?? null;
  const confirmedOption = detail.session.confirmed_plan_option ?? null;
  const beats: ExecutionNarrativeBeat[] = [];

  if (typeof confirmedRevision === "number") {
    beats.push({
      key: "confirmed-source",
      title: "Locked the execution source",
      detail: latestRunMessage
        ? `Execution is anchored to confirmed route v${confirmedRevision} / ${
            confirmedOption || "primary"
          }.`
        : `Route v${confirmedRevision} / ${confirmedOption || "primary"} is confirmed and waiting to be launched.`,
      tone: latestRunMessage ? "success" : "warn",
      status: latestRunMessage ? "done" : "active",
    });
  } else if (latestPlanMessage) {
    const revision = getPlanRevision(latestPlanMessage) || 1;
    beats.push({
      key: "execution-gate",
      title: "Held execution behind a confirmation gate",
      detail: `Revision v${revision} is compiled, but a route option still needs to be confirmed before a real run starts.`,
      tone: "warn",
      status: "active",
    });
  }

  if (latestRunMessage) {
    const runId = asString(latestRunMessage.content.run_id) || detail.session.latest_run_id || "run";
    const status = asString(latestRunMessage.content.status);
    const planRevision = asNumber(latestRunMessage.content.plan_revision);
    const planOption =
      latestRunMessage.content.plan_option === "alternative" ? "alternative" : "primary";
    beats.push({
      key: "run-created",
      title: "Opened a real run",
      detail: planRevision
        ? `Started ${runId} from route v${planRevision} / ${planOption}. Initial run state: ${
            status || "queued"
          }.`
        : `Started ${runId} from the current mission context.`,
      tone: getRunTone(status),
      status: "done",
    });
  }

  const seenNodeRuns = new Set<string>();
  for (const message of subtaskMessages) {
    const nodeRunId = asString(message.content.node_run_id) || message.message_id;
    if (seenNodeRuns.has(nodeRunId)) {
      continue;
    }
    seenNodeRuns.add(nodeRunId);

    const nodeName = asString(message.content.node_name) || "Node";
    const status = asString(message.content.status);
    const progress = isObject(message.content.progress) ? message.content.progress : null;
    const progressMessage = asString(progress?.message);
    const progressPercent = asNumber(progress?.percent);

    beats.push({
      key: `node-${nodeRunId}`,
      title:
        status === "completed"
          ? `Completed ${nodeName}`
          : status === "failed"
            ? `Failed at ${nodeName}`
            : status === "waiting_human"
              ? `${nodeName} is waiting on input`
              : `Worked through ${nodeName}`,
      detail: progressMessage
        ? `${progressMessage}${typeof progressPercent === "number" ? ` (${progressPercent}%)` : ""}`
        : `Latest node state: ${status || "running"}${
            typeof progressPercent === "number" ? ` at ${progressPercent}%` : ""
          }.`,
      tone:
        status === "failed"
          ? "danger"
          : status === "completed"
            ? "success"
            : status === "waiting_human"
              ? "warn"
              : "success",
      status:
        status === "completed" || status === "failed" || status === "cancelled" ? "done" : "active",
    });
  }

  for (const message of approvalMessages) {
    beats.push({
      key: `approval-${asString(message.content.approval_id) || message.message_id}`,
      title: "Paused at an approval gate",
      detail: asString(message.content.summary) || "A pending approval is blocking the next step.",
      tone: "warn",
      status: "active",
    });
  }

  for (const message of humanInputMessages) {
    beats.push({
      key: `input-${asString(message.content.input_request_id) || message.message_id}`,
      title: "Paused for human input",
      detail:
        asString(message.content.summary) ||
        "A structured human input request is blocking the next step.",
      tone: "warn",
      status: "active",
    });
  }

  for (const message of interventionMessages) {
    const status = asString(message.content.status) || "recorded";
    const summary =
      asString(message.content.summary) ||
      asString(message.content.content) ||
      "Runtime intervention was recorded in the workspace.";
    beats.push({
      key: `intervention-${asString(message.content.intervention_id) || message.message_id}`,
      title: status === "needs_review" ? "Captured a runtime intervention" : "Captured next-pass guidance",
      detail:
        status === "needs_review"
          ? `${summary} The request is recorded for review and can now be translated into an auditable runtime patch.`
          : `${summary} The guidance is queued for the next orchestration pass.`,
      tone: status === "needs_review" ? "warn" : "neutral",
      status: "active",
    });
  }

  for (const message of dagPatchMessages) {
    const status = asString(message.content.status) || "proposed";
    const summary =
      asString(message.content.summary) ||
      "A structured DAG patch proposal was generated from the runtime intervention.";
    const operations = Array.isArray(message.content.operations)
      ? message.content.operations.filter(isObject)
      : [];
    const operationNames = operations
      .map((operation) => asString(operation.op))
      .filter((operation): operation is string => !!operation);
    const applySupported = message.content.apply_supported === true;
    const unsupportedReason = asString(message.content.unsupported_reason);
    const outcomes = getPatchOperationOutcomes(message.content);
    const appliedOutcomeCount = outcomes.filter((outcome) => outcome.applied === true).length;
    const failedOutcomeCount = outcomes.filter((outcome) => outcome.applied !== true).length;
    const outcomeSummary =
      outcomes.length > 0
        ? ` Outcome: ${appliedOutcomeCount} applied${
            failedOutcomeCount > 0 ? `, ${failedOutcomeCount} failed` : ""
          }.`
        : "";
    const applyStateText =
      status === "applied"
        ? "Runtime topology was updated and the patch is now part of the audit trail."
        : status === "applied_with_errors"
          ? "Runtime topology was partially updated; review the failed operation outcomes."
          : status === "rejected"
            ? "The patch was rejected and kept as an audit record."
            : applySupported
              ? "This patch can be applied after confirmation."
              : unsupportedReason || "This proposal is recorded for audit, but it is not yet live-apply ready.";

    beats.push({
      key: `dag-patch-${asString(message.content.patch_id) || message.message_id}`,
      title:
        status === "needs_confirmation"
          ? "Proposed a runtime DAG change"
          : status === "unsupported"
            ? "Could not safely form an applyable DAG change"
            : status === "applied" || status === "applied_with_errors"
              ? "Applied a runtime DAG patch"
              : status === "rejected"
                ? "Rejected a runtime DAG patch"
                : "Recorded a DAG patch proposal",
      detail: `${summary}${
        operationNames.length > 0 ? ` Operation: ${operationNames.join(", ")}.` : ""
      }${outcomeSummary} ${applyStateText}`,
      tone:
        status === "applied"
          ? "success"
          : status === "unsupported" || status === "rejected"
            ? "neutral"
            : "warn",
      status:
        status === "applied" || status === "applied_with_errors" || status === "rejected"
          ? "done"
          : "active",
    });
  }

  for (const message of artifactMessages) {
    const artifactName = asString(message.content.name) || "Artifact";
    beats.push({
      key: `artifact-${asString(message.content.artifact_id) || message.message_id}`,
      title: `Projected ${artifactName}`,
      detail: "The run returned an artifact back into the mission.",
      tone: "success",
      status: "done",
    });
  }

  for (const message of summaryMessages) {
    const status = asString(message.content.status);
    const summary =
      asString(message.content.current_summary) || "The latest run posted a summary update.";
    beats.push({
      key: `summary-${asString(message.content.run_id) || message.message_id}`,
      title:
        status === "completed"
          ? "Closed the run successfully"
          : status === "failed"
            ? "Closed the run with a failure"
            : status === "cancelled"
              ? "Closed the run after cancellation"
              : status === "waiting_human"
                ? "Paused the run for human intervention"
                : "Posted a run summary",
      detail: summary,
      tone: getRunTone(status),
      status:
        status === "completed" || status === "failed" || status === "cancelled" ? "done" : "active",
    });
  }

  if (beats.length === 0) {
    return [
      {
        key: "execution-idle",
        title: "Execution has not started yet",
        detail:
          detail.session.current_goal || getReadableSessionPlanSummary(detail, visibleMessages)
            ? "The mission is still in planning mode. Draft a DAG or confirm a plan to open a real run."
            : "The mission is still purely conversational and has not been promoted into orchestration yet.",
        tone: "neutral",
        status: "pending",
      },
    ];
  }

  return beats;
}

export function buildPlanOptionsNarrative(input: {
  message: SessionMessageRecord;
  confirmedPlanRevision: number | null;
  confirmedPlanOption: PlanOptionKey | null;
  activeReviseTarget: { revision: number; option: PlanOptionKey } | null;
}): PlanOptionsNarrative | null {
  const { message, confirmedPlanRevision, confirmedPlanOption, activeReviseTarget } = input;
  if (message.kind !== "plan_options_card" && message.kind !== "plan_card") {
    return null;
  }

  const revision = getPlanRevision(message) || 1;
  const selectedOption = getSelectedPlanOption(message) || "primary";
  const sourceRevision = asNumber(message.content.source_revision);
  const sourceOption =
    message.content.source_option === "alternative"
      ? "alternative"
      : message.content.source_option === "primary"
        ? "primary"
        : null;

  const optionKeys: PlanOptionKey[] =
    message.kind === "plan_options_card" && isObject(message.content.alternative)
      ? ["primary", "alternative"]
      : ["primary"];

  type SummaryCandidate = PlanOptionSummary | null;

  const summaries = optionKeys
    .map((optionKey): SummaryCandidate => {
      const content = extractPlanOptionContent(message, optionKey);
      if (!content) {
        return null;
      }
      const validation = getValidationFromPlanContent(content);
      const checklist = isObject(content.confirmation_checklist)
        ? content.confirmation_checklist
        : null;
      return {
        optionKey,
        templateName: getPlanContentIdentity(content) || `${optionKey} option`,
        validationSummary: summarizeValidationState(validation),
        recommendationReason: getPlanReason(content),
        nodeCount: getNodeCountFromPlan(content),
        readyFrontierCount:
          asNumber(checklist?.ready_frontier_count) || getReadyFrontierCountFromPlan(content),
        warningGroups: groupValidation(validation).map((group) => ({
          key: group.key,
          title: group.title,
          tone: group.tone,
          items: group.items,
        })),
        checklist,
        candidatePlan: getCandidatePlan(content),
        content,
        confirmed:
          confirmedPlanRevision === revision && confirmedPlanOption === optionKey,
        selectedRevise:
          activeReviseTarget?.revision === revision &&
          activeReviseTarget.option === optionKey,
      };
    })
    .filter((item): item is PlanOptionSummary => item !== null);

  if (summaries.length === 0) {
    return null;
  }

  const focusedSummary: PlanOptionSummary =
    summaries.find((summary) => summary.confirmed) ||
    summaries.find((summary) => summary.selectedRevise) ||
    summaries.find((summary) => summary.optionKey === selectedOption) ||
    summaries[0];
  const alternateSummary =
    summaries.find((summary) => summary.optionKey !== focusedSummary.optionKey) || null;
  const nodeDelta = alternateSummary
    ? focusedSummary.nodeCount - alternateSummary.nodeCount
    : 0;
  const comparisonSummary = alternateSummary
    ? `${focusedSummary.templateName} is the current ${
        focusedSummary.confirmed ? "confirmed" : "recommended"
      } route, and ${
        nodeDelta === 0
          ? `both routes compile to the same number of nodes as ${alternateSummary.templateName}`
          : nodeDelta > 0
            ? `${focusedSummary.templateName} uses ${nodeDelta} more node(s) than ${alternateSummary.templateName}`
            : `${focusedSummary.templateName} uses ${Math.abs(nodeDelta)} fewer node(s) than ${alternateSummary.templateName}`
      }.`
    : `${focusedSummary.templateName} is the current ${
        focusedSummary.confirmed ? "confirmed" : "recommended"
      } route.`;

  return {
    revision,
    sourceRevision,
    sourceOption,
    selectedOption,
    focusedOption: focusedSummary.optionKey,
    focusedTemplateName: focusedSummary.templateName,
    comparisonSummary,
    summaries,
  };
}
