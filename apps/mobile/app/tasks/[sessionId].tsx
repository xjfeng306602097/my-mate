import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ApiError,
  approve,
  confirmDagPatch,
  confirmSessionPlan,
  createRunFromSession,
  createSessionIntervention,
  createSessionDraft,
  getMission,
  getRunGraph,
  planSession,
  rejectDagPatch,
  reviseSessionPlan,
  reject,
  sendSessionMessage,
  submitHumanInput,
} from "@/lib/api";
import { formatStatus, formatTime } from "@/lib/format";
import { groupValidation } from "@/lib/planner";
import type {
  MissionDetailResponse,
  MissionRouteSummary,
  MissionSpecSummary,
  MissionView,
  RuntimeGraphSummary,
  SessionMessageRecord,
} from "@/lib/types";
import {
  buildSchemaPayload,
  SchemaForm,
  validateRequiredFields,
  type SchemaValue,
} from "@/components/schema-form";
import { EmptyState } from "@/components/empty-state";
import { Badge, Panel, PrimaryButton, Screen, Section } from "@/components/ui";
import {
  buildComposerDirectiveChipsV2,
  buildExecutionNarrativeV2,
  buildMissionSnapshot,
  buildOrchestratorBriefing,
  buildOrchestratorTurns,
  buildWorkspaceArtifactSurfaces,
  buildPlanOptionsNarrative,
  buildRuntimeGraphNarrative,
  buildWorkPackages,
  deriveThreadOverview,
  extractPlanOptionContent,
  getConversationMessageText,
  getLatestMessage,
  getMessageKindLabel,
  getPlanReason,
  getPlanRevision,
  isConversationTextMessage,
  projectConversationMessages,
  projectThreadMessages,
  readWorkspaceState,
  summarizeValidationState,
  type PlanOptionKey,
} from "@/lib/task-thread";

type ReviseTarget = {
  revision: number;
  option: PlanOptionKey;
};

type WorkspaceStageKey = "briefing" | "work" | "plan" | "execution" | "thread";

type WorkspaceStage = {
  key: WorkspaceStageKey;
  label: string;
  title: string;
  detail: string;
  metric: string;
  tone: "neutral" | "warn" | "success" | "danger";
};

type WorkspaceSectionTone = "neutral" | "warn" | "success" | "danger";

type WorkspaceSection = {
  key: string;
  eyebrow: string;
  title: string;
  detail: string;
  tone: WorkspaceSectionTone;
  body: React.ReactNode;
  stages?: WorkspaceStageKey[];
  layout?: "full" | "split";
};

type InterventionMessage = SessionMessageRecord & {
  kind: "approval_card" | "human_input_card" | "intervention_card" | "dag_patch_card";
};

type RuntimeGraphNodeView = RuntimeGraphSummary["nodes"][number];
type RuntimeGraphWorkPackageView = RuntimeGraphSummary["workPackages"][number];

function getMissionSpecFromDetail(
  detail: MissionDetailResponse | null,
  fallbackSpec: MissionSpecSummary | null,
): MissionSpecSummary | null {
  return (
    detail?.mission_spec ||
    detail?.mission.mission_spec ||
    detail?.session.mission_spec ||
    fallbackSpec ||
    null
  );
}

function getMissionRouteLabel(route: MissionRouteSummary | null | undefined): string {
  if (!route) {
    return "Unrouted";
  }

  const revision = route.activeRevision ?? route.confirmedRevision ?? route.latestRevision;
  const option = route.activeOption || route.confirmedOption || "primary";
  if (typeof revision === "number") {
    return `v${revision} / ${option}`;
  }

  if (route.selectedTemplateName) {
    return route.selectedTemplateName;
  }

  return route.stale ? "Needs refresh" : "Unrouted";
}

function getMissionViewFromDetail(detail: MissionDetailResponse | null): MissionView | null {
  return detail?.mission_view || detail?.mission.mission_view || null;
}

function formatShortId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 18) {
    return trimmed;
  }
  const parts = trimmed.split("_");
  const prefix = parts[0] || "proposal";
  const suffix = parts[parts.length - 1] || trimmed.slice(-6);
  return `${prefix}...${suffix}`;
}

function getLatestRunIdFromMissionDetail(detail: MissionDetailResponse | null): string | null {
  return detail?.latest_run?.run_id || detail?.session.latest_run_id || detail?.mission.latest_run_id || null;
}

function formatAttachmentSize(sizeBytes: number | null | undefined): string | null {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return null;
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isInterventionMessage(message: SessionMessageRecord): message is InterventionMessage {
  return (
    message.kind === "approval_card" ||
    message.kind === "human_input_card" ||
    message.kind === "intervention_card" ||
    message.kind === "dag_patch_card"
  );
}

function messageTone(
  message: SessionMessageRecord,
): "neutral" | "warn" | "success" | "danger" {
  if (message.kind === "run_card") {
    const status = message.content.status;
    if (status === "completed") {
      return "success";
    }
    if (status === "failed" || status === "cancelled") {
      return "danger";
    }
    return "warn";
  }
  if (
    message.kind === "plan_card" ||
    message.kind === "plan_options_card" ||
    message.kind === "draft_card"
  ) {
    return "warn";
  }
  if (
    message.kind === "approval_card" ||
    message.kind === "human_input_card" ||
    message.kind === "intervention_card" ||
    message.kind === "dag_patch_card"
  ) {
    return "warn";
  }
  if (message.kind === "artifact_card") {
    return "success";
  }
  return "neutral";
}

function runtimeStatusTone(status: string): WorkspaceSectionTone {
  if (status === "completed" || status === "skipped") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  if (status === "waiting_human" || status === "paused" || status === "blocked") {
    return "warn";
  }
  if (status === "running" || status === "ready") {
    return "success";
  }
  return "neutral";
}

function runtimePackageTone(status: RuntimeGraphWorkPackageView["status"]): WorkspaceSectionTone {
  if (status === "done") {
    return "success";
  }
  if (status === "blocked") {
    return "warn";
  }
  if (status === "active") {
    return "success";
  }
  return "neutral";
}

function runtimeMarkerLabel(marker: RuntimeGraphNodeView["markers"][number]): string {
  if (marker === "active_frontier") {
    return "Frontier";
  }
  if (marker === "waiting_human") {
    return "Human wait";
  }
  if (marker === "approval_gate") {
    return "Approval";
  }
  if (marker === "human_input_gate") {
    return "Input";
  }
  if (marker === "blocked") {
    return "Blocked";
  }
  if (marker === "skipped") {
    return "Skipped";
  }
  if (marker === "terminal") {
    return "Terminal";
  }
  return "Ready";
}

function runtimeMarkerTone(marker: RuntimeGraphNodeView["markers"][number]): WorkspaceSectionTone {
  if (marker === "blocked") {
    return "danger";
  }
  if (marker === "waiting_human" || marker === "approval_gate" || marker === "human_input_gate") {
    return "warn";
  }
  if (marker === "active_frontier" || marker === "ready" || marker === "terminal") {
    return "success";
  }
  return "neutral";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function getPatchTopology(content: Record<string, unknown>): Record<string, unknown> | null {
  if (isObject(content.resumed_topology)) {
    return content.resumed_topology;
  }
  const metadata = isObject(content.metadata) ? content.metadata : null;
  return isObject(metadata?.resumed_topology) ? metadata.resumed_topology : null;
}

function getPatchGraphPreview(content: Record<string, unknown>): Record<string, unknown> | null {
  if (isObject(content.graph_preview)) {
    return content.graph_preview;
  }
  const metadata = isObject(content.metadata) ? content.metadata : null;
  return isObject(metadata?.graph_preview) ? metadata.graph_preview : null;
}

function getReadableDraftStrategy(value: string | null): string {
  if (!value) {
    return "unknown";
  }
  if (value === "template_variant") {
    return "template-guided draft";
  }
  if (value === "registry_synthesis") {
    return "registry-driven synthesis";
  }
  return value.replace(/[_-]+/g, " ");
}

function isRuntimeInterventionStatus(status: string | null | undefined): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting_human" ||
    status === "paused" ||
    status === "blocked"
  );
}

function mergeSessionMessages(
  existing: SessionMessageRecord[],
  incoming: SessionMessageRecord[],
): SessionMessageRecord[] {
  const merged = new Map<string, SessionMessageRecord>();
  for (const message of [...existing, ...incoming]) {
    merged.set(message.message_id, message);
  }
  return [...merged.values()].sort((left, right) => {
    if (left.created_at === right.created_at) {
      return left.message_id.localeCompare(right.message_id);
    }
    return left.created_at.localeCompare(right.created_at);
  });
}

function getDefaultReviseTarget(
  message: SessionMessageRecord | null,
  confirmedRevision: number | null,
  confirmedOption: PlanOptionKey | null,
): ReviseTarget | null {
  const revision = getPlanRevision(message);
  if (!revision) {
    return null;
  }

  if (confirmedRevision === revision && confirmedOption) {
    return {
      revision,
      option: confirmedOption,
    };
  }

  if (message?.kind === "plan_options_card") {
    return {
      revision,
      option: message.content.selected_option === "alternative" ? "alternative" : "primary",
    };
  }

  return {
    revision,
    option: "primary",
  };
}

function resolveWorkspaceStageForDetail(
  detail: MissionDetailResponse | null,
  fallback: WorkspaceStageKey,
): WorkspaceStageKey {
  if (!detail) {
    return fallback;
  }

  const workspace = readWorkspaceState(detail);
  const hasDraft = detail.messages.some((message) => message.kind === "draft_card");
  const hasPlan = detail.messages.some(
    (message) => message.kind === "plan_options_card" || message.kind === "plan_card",
  );
  const sessionStatus = detail.session.status;

  if (
    detail.session.latest_run_id ||
    sessionStatus === "running" ||
    sessionStatus === "waiting_human" ||
    sessionStatus === "completed" ||
    sessionStatus === "failed" ||
    sessionStatus === "cancelled"
  ) {
    return "execution";
  }

  if (
    workspace.planStale ||
    workspace.hasConfirmedPlan ||
    workspace.hasActivePlan ||
    workspace.needsConfirmation ||
    hasPlan
  ) {
    return "plan";
  }

  if (workspace.hasActiveDraft || hasDraft) {
    return "plan";
  }

  const intent = workspace.latestOrchestratorIntent || detail.session.latest_orchestrator_intent;
  if (intent === "ask_run" || intent === "run_started") {
    return "execution";
  }
  if (
    intent === "ask_plan" ||
    intent === "plan_ready" ||
    intent === "confirm_ready" ||
    intent === "ask_confirm" ||
    intent === "ask_revise"
  ) {
    return "plan";
  }
  if (intent === "ask_draft" || intent === "draft_ready") {
    return "plan";
  }
  if (intent === "add_constraint" || intent === "clarify" || intent === "capture_goal") {
    return "briefing";
  }

  return fallback;
}

function inferPreferredWorkspaceStage(
  detail: { session: MissionDetailResponse["session"] },
  fallback: WorkspaceStageKey = "briefing",
): WorkspaceStageKey {
  const workspace = isObject(detail.session.workspace_state) ? detail.session.workspace_state : null;
  const phase = asString(workspace?.stage);
  const latestIntent =
    asString(workspace?.latest_orchestrator_intent) || asString(detail.session.latest_orchestrator_intent);
  const pendingApprovalCount = asNumber(workspace?.pending_approval_count) || 0;
  const pendingHumanInputCount = asNumber(workspace?.pending_human_input_count) || 0;
  const hasActivePlan =
    workspace?.has_active_plan === true ||
    asNumber(workspace?.latest_plan_revision) !== null ||
    detail.session.confirmed_plan_revision !== null;
  const hasActiveDraft =
    workspace?.has_active_draft === true || asNumber(workspace?.draft_node_count) !== null;
  const planStale = workspace?.plan_stale === true;

  if (pendingApprovalCount > 0 || pendingHumanInputCount > 0) {
    return "execution";
  }

  if (
    detail.session.status === "running" ||
    detail.session.status === "waiting_human" ||
    detail.session.status === "completed" ||
    detail.session.status === "failed" ||
    detail.session.status === "cancelled"
  ) {
    return "execution";
  }

  if (planStale) {
    return hasActivePlan || hasActiveDraft ? "plan" : "briefing";
  }

  if (
    latestIntent === "ask_plan" ||
    latestIntent === "ask_revise" ||
    latestIntent === "ask_confirm" ||
    latestIntent === "plan_ready" ||
    latestIntent === "confirm_ready" ||
    latestIntent === "draft_ready" ||
    latestIntent === "ask_draft"
  ) {
    return "plan";
  }

  if (latestIntent === "ask_run" || latestIntent === "run_started") {
    return "execution";
  }

  if (phase === "draft" || phase === "compare" || phase === "confirm") {
    return "plan";
  }

  if (phase === "execute" || phase === "waiting" || phase === "deliver") {
    return "execution";
  }

  if (hasActivePlan || hasActiveDraft) {
    return "plan";
  }

  if (
    latestIntent === "add_constraint" ||
    latestIntent === "clarify" ||
    latestIntent === "capture_goal"
  ) {
    return "briefing";
  }

  if (phase === "understand") {
    return "briefing";
  }

  return fallback;
}

export default function TaskThreadScreen() {
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
  const { width } = useWindowDimensions();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const [data, setData] = useState<MissionDetailResponse | null>(null);
  const [runtimeGraph, setRuntimeGraph] = useState<RuntimeGraphSummary | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<SessionMessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [draftingDag, setDraftingDag] = useState(false);
  const [revising, setRevising] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [inputDrafts, setInputDrafts] = useState<Record<string, Record<string, SchemaValue>>>({});
  const [dismissedDraftIds, setDismissedDraftIds] = useState<string[]>([]);
  const [reviseTarget, setReviseTarget] = useState<ReviseTarget | null>(null);
  const [showPlanningHistory, setShowPlanningHistory] = useState(false);
  const [showThreadEvidence, setShowThreadEvidence] = useState(false);
  const [activeWorkspaceStage, setActiveWorkspaceStage] =
    useState<WorkspaceStageKey>("briefing");
  const [showComposerTools, setShowComposerTools] = useState(false);
  const [pendingScrollToLatest, setPendingScrollToLatest] = useState(false);
  const [pendingFocusStage, setPendingFocusStage] = useState<WorkspaceStageKey | null>(null);
  const [stageDetailTopY, setStageDetailTopY] = useState(0);
  const [initializedStageSessionId, setInitializedStageSessionId] = useState<string | null>(null);

  const scrollThreadToTop = useCallback(() => {
    scrollViewRef.current?.scrollTo({
      y: 0,
      animated: false,
    });
  }, []);

  const load = useCallback(async (): Promise<MissionDetailResponse | null> => {
    if (!sessionId) {
      setRuntimeGraph(null);
      return null;
    }
    try {
      setError(null);
      const next = await getMission(sessionId);
      const latestRunId = getLatestRunIdFromMissionDetail(next);
      const graph = latestRunId ? await getRunGraph(latestRunId).catch(() => null) : null;
      setData(next);
      setRuntimeGraph(graph);
      setOptimisticMessages((current) => {
        const persistedIds = new Set(next.messages.map((message) => message.message_id));
        return current.filter((message) => !persistedIds.has(message.message_id));
      });
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Load failed");
      setRuntimeGraph(null);
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId]);

  useEffect(() => {
    scrollThreadToTop();
    void load();
  }, [load, scrollThreadToTop]);

  useFocusEffect(
    useCallback(() => {
      scrollThreadToTop();
      void load();
    }, [load, scrollThreadToTop]),
  );

  useEffect(() => {
    if (!sessionId) {
      setInitializedStageSessionId(null);
    }
  }, [sessionId]);

  const confirmedRevision = data?.session.confirmed_plan_revision ?? null;
  const confirmedOption = data?.session.confirmed_plan_option ?? null;
  const confirmedProposalId = data?.session.confirmed_proposal_id ?? null;

  const sessionMessages = useMemo(() => {
    const persistedMessages = data?.messages || [];
    if (optimisticMessages.length === 0) {
      return persistedMessages;
    }

    const persistedIds = new Set(persistedMessages.map((message) => message.message_id));
    return [
      ...persistedMessages,
      ...optimisticMessages.filter((message) => !persistedIds.has(message.message_id)),
    ].sort((left, right) => {
      if (left.created_at === right.created_at) {
        return left.message_id.localeCompare(right.message_id);
      }
      return left.created_at.localeCompare(right.created_at);
    });
  }, [data?.messages, optimisticMessages]);

  const messageProjection = useMemo(() => {
    if (!data) {
      return {
        visibleMessages: sessionMessages,
        hiddenPlanningRevisionCount: 0,
        hiddenPlannerMessageCount: 0,
      };
    }

    return projectThreadMessages({
      messages: sessionMessages,
      dismissedDraftIds,
      confirmedPlanRevision: confirmedRevision,
      showPlanningHistory,
    });
  }, [data, sessionMessages, dismissedDraftIds, confirmedRevision, showPlanningHistory]);

  const visibleMessages = messageProjection.visibleMessages;

  const conversationProjection = useMemo(() => {
    return projectConversationMessages({
      messages: sessionMessages,
    });
  }, [sessionMessages]);

  const conversationMessages = conversationProjection.conversationMessages;

  const evidenceMessages = useMemo(() => {
    return visibleMessages.filter((message) => !isConversationTextMessage(message));
  }, [visibleMessages]);

  const latestPlanningMessage = useMemo(() => {
    return getLatestMessage(visibleMessages, ["plan_options_card", "plan_card"]);
  }, [visibleMessages]);

  const latestDraftMessage = useMemo(() => {
    return getLatestMessage(visibleMessages, ["draft_card"]);
  }, [visibleMessages]);

  const threadOverview = useMemo(() => {
    if (!data) {
      return null;
    }
    return deriveThreadOverview(data, visibleMessages);
  }, [data, visibleMessages]);

  const workspaceState = useMemo(() => {
    if (!data) {
      return null;
    }
    return readWorkspaceState(data);
  }, [data]);
  const routeRefreshNeeded =
    workspaceState?.planStale === true &&
    workspaceState.stage !== "execute" &&
    workspaceState.stage !== "waiting" &&
    workspaceState.stage !== "deliver";

  const orchestratorBriefing = useMemo(() => {
    if (!data) {
      return null;
    }
    return buildOrchestratorBriefing(data, visibleMessages);
  }, [data, visibleMessages]);

  const executionNarrative = useMemo(() => {
    if (!data) {
      return [];
    }
    return buildExecutionNarrativeV2(data, visibleMessages);
  }, [data, visibleMessages]);

  const orchestratorTurns = useMemo(() => {
    if (!data) {
      return [];
    }
    return buildOrchestratorTurns(data, visibleMessages);
  }, [data, visibleMessages]);

  const missionSnapshot = useMemo(() => {
    if (!data) {
      return null;
    }
    if (
      data.mission_snapshot &&
      typeof data.mission_snapshot.workspace_contract_version === "number" &&
      data.mission_snapshot.workspace_contract_version > 0
    ) {
      return data.mission_snapshot;
    }
    return buildMissionSnapshot(data, visibleMessages);
  }, [data, visibleMessages]);

  const hasVersionedWorkspaceContract =
    typeof missionSnapshot?.workspace_contract_version === "number" &&
    missionSnapshot.workspace_contract_version > 0;

  const missionSpec = useMemo(() => {
    if (hasVersionedWorkspaceContract && missionSnapshot?.spec) {
      return missionSnapshot.spec;
    }
    return getMissionSpecFromDetail(data, missionSnapshot?.spec || null);
  }, [data, hasVersionedWorkspaceContract, missionSnapshot]);

  const workPackages = useMemo(() => {
    if (hasVersionedWorkspaceContract) {
      return missionSnapshot?.pipelines || [];
    }
    if (!data) {
      return [];
    }
    return buildWorkPackages(data, visibleMessages);
  }, [data, hasVersionedWorkspaceContract, missionSnapshot, visibleMessages]);

  const workspaceArtifactSurfaces = useMemo(() => {
    if (hasVersionedWorkspaceContract) {
      return missionSnapshot?.artifactSurfaces || [];
    }
    if (!data) {
      return [];
    }
    return buildWorkspaceArtifactSurfaces(data, visibleMessages);
  }, [data, hasVersionedWorkspaceContract, missionSnapshot, visibleMessages]);

  const outputArtifactSurface = useMemo(() => {
    return workspaceArtifactSurfaces.find((surface) => surface.key === "outputs") || null;
  }, [workspaceArtifactSurfaces]);

  const missionView = useMemo(() => getMissionViewFromDetail(data), [data]);
  const missionRouteLabel = missionSpec
    ? getMissionRouteLabel(missionSpec.route)
    : missionView?.routeLabel || "Unrouted";
  const missionWorkLabel =
    missionSpec
      ? `${missionSpec.pipelineSummary.active}/${missionSpec.pipelineSummary.total}`
      : missionView?.workLabel || null;
  const missionCheckpointLabel =
    missionSpec
      ? `${missionSpec.checkpointSummary.completed}/${missionSpec.checkpointSummary.total}`
      : missionView?.checkpointLabel || null;
  const missionStatusLabel =
    missionSnapshot?.missionStatusLabel || missionView?.statusLabel || threadOverview?.stageLabel || "Mission";
  const missionStatusTone =
    missionSnapshot?.missionStatusTone || missionView?.statusTone || threadOverview?.stageTone || "neutral";
  const missionDisplayTitle =
    missionSnapshot?.missionTitle || missionView?.title || missionSpec?.objective || data?.mission.title || "Mission";
  const missionDisplaySummary =
    missionSnapshot?.missionSummary ||
    missionView?.summary ||
    missionSpec?.decisionFocus ||
    threadOverview?.headline ||
    "Mission workspace is ready.";
  const missionDisplayDetail =
    missionSnapshot?.nextActionDetail ||
    missionView?.nextActionDetail ||
    missionSpec?.sourceBrief ||
    threadOverview?.detail ||
    "Use the workspace to shape, confirm, and run work.";

  const directiveChips = useMemo(() => {
    if (!data) {
      return [];
    }
    return buildComposerDirectiveChipsV2(data, visibleMessages);
  }, [data, visibleMessages]);

  const latestConversationMessage = useMemo(() => {
    return conversationMessages.length > 0
      ? conversationMessages[conversationMessages.length - 1]
      : null;
  }, [conversationMessages]);

  const latestUserConversationMessage = useMemo(() => {
    return (
      [...conversationMessages]
        .reverse()
        .find((message) => message.role === "user" && message.kind === "text") || null
    );
  }, [conversationMessages]);

  const latestEvidenceMessage = useMemo(() => {
    return evidenceMessages.length > 0 ? evidenceMessages[evidenceMessages.length - 1] : null;
  }, [evidenceMessages]);

  const latestOrchestratorReplyText = useMemo(() => {
    const reply =
      [...conversationMessages]
        .reverse()
        .find(
          (message) =>
            message.role === "orchestrator" &&
            message.kind === "orchestrator_turn" &&
            typeof message.content.narrative_reply === "string",
        ) ||
      [...conversationMessages]
        .reverse()
        .find(
          (message) =>
            message.role === "orchestrator" &&
            message.kind === "text" &&
            typeof message.content.text === "string",
        ) || null;
    return reply ? getConversationMessageText(reply) : null;
  }, [conversationMessages]);

  const planOptionsNarrative = useMemo(() => {
    if (!latestPlanningMessage) {
      return null;
    }
    return buildPlanOptionsNarrative({
      message: latestPlanningMessage,
      confirmedPlanRevision: confirmedRevision,
      confirmedPlanOption: confirmedOption,
      activeReviseTarget: reviseTarget,
    });
  }, [latestPlanningMessage, confirmedRevision, confirmedOption, reviseTarget]);

  const runtimeGraphNarrative = useMemo(() => {
    return buildRuntimeGraphNarrative(runtimeGraph);
  }, [runtimeGraph]);

  const workspaceStages = useMemo<WorkspaceStage[]>(() => {
    if (missionSnapshot?.stages?.length) {
      return missionSnapshot.stages.map((stage) => ({
        key: stage.key,
        label: stage.label,
        title:
          !hasVersionedWorkspaceContract && stage.key === "execution" && runtimeGraphNarrative
            ? runtimeGraphNarrative.title
            : stage.title,
        detail:
          !hasVersionedWorkspaceContract && stage.key === "execution" && runtimeGraphNarrative
            ? runtimeGraphNarrative.detail
            : stage.detail,
        metric:
          !hasVersionedWorkspaceContract && stage.key === "execution" && runtimeGraph
            ? `${runtimeGraph.nodes.length} nodes`
            : stage.metric,
        tone:
          !hasVersionedWorkspaceContract && stage.key === "execution" && runtimeGraphNarrative
            ? runtimeGraphNarrative.tone
            : stage.tone,
      }));
    }

    const activePlanOptionCount = planOptionsNarrative?.summaries.length || 0;
    const workspaceStage = workspaceState?.stage;
    const routeRefreshNeeded =
      workspaceState?.planStale === true &&
      workspaceStage !== "execute" &&
      workspaceStage !== "waiting" &&
      workspaceStage !== "deliver";
    const workspaceStageMetric =
      workspaceStage === "draft"
        ? `${workspaceState?.draftNodeCount || 0} draft nodes`
        : workspaceStage === "compare" || workspaceStage === "confirm"
          ? `${workspaceState?.activePlanNodeCount || 0} plan nodes`
          : workspaceStage === "execute" || workspaceStage === "waiting" || workspaceStage === "deliver"
            ? `${workspaceState?.artifactCount || 0} artifacts`
            : `${workspaceState?.openQuestions.length || 0} open questions`;
    return [
      {
        key: "briefing",
        label: "Briefing",
        title:
          workspaceState?.workingGoal ||
          orchestratorBriefing?.title ||
          threadOverview?.headline ||
          "Current read",
        detail:
          workspaceState?.nextRecommendedDetail ||
          workspaceState?.pendingDecision ||
          orchestratorBriefing?.summary ||
          threadOverview?.detail ||
          "The orchestrator is reading the mission and deciding the next move.",
        metric: workspaceStageMetric,
        tone:
          routeRefreshNeeded
            ? "warn"
            : orchestratorBriefing?.tone || threadOverview?.stageTone || "neutral",
      },
      {
        key: "work",
        label: "Work",
        title:
          workPackages.length > 1
            ? `${workPackages.length} work packages`
            : workPackages[0]?.title || "Work package surface",
        detail:
          routeRefreshNeeded
            ? workspaceState?.nextRecommendedDetail ||
              "The latest mission note invalidated the current route, so these work packages should be refreshed."
            : workPackages[0]?.summary ||
          "The mission will appear here as concrete work packages once a route exists.",
        metric: `${workPackages.reduce((total, item) => total + item.nodeCount, 0)} nodes`,
        tone: routeRefreshNeeded
          ? "warn"
          : workPackages.some((item) => item.status === "blocked")
            ? "warn"
            : workPackages.some((item) => item.status === "active")
              ? "success"
              : workPackages.some((item) => item.status === "done")
                ? "success"
                : "neutral",
      },
      {
        key: "plan",
        label: "Route",
        title: latestPlanningMessage
          ? planOptionsNarrative
            ? `Route v${planOptionsNarrative.revision}`
            : "Route proposal"
          : latestDraftMessage
            ? "Draft workflow shape is ready"
            : "No route yet",
        detail: latestPlanningMessage
          ? routeRefreshNeeded
            ? workspaceState?.staleReason || workspaceState?.nextRecommendedDetail ||
              "The current route no longer matches the latest brief."
            : planOptionsNarrative?.comparisonSummary ||
              "A compiled route is ready for confirmation or revision."
          : latestDraftMessage
            ? workspaceState?.nextRecommendedDetail ||
              workspaceState?.pendingDecision ||
              "Promote the draft into comparable route options."
            : "Draft a DAG or create a route from the current mission context.",
        metric: activePlanOptionCount
          ? `${activePlanOptionCount} option${activePlanOptionCount > 1 ? "s" : ""}`
          : latestDraftMessage
            ? `${workspaceState?.draftNodeCount || 0} nodes`
            : "0 options",
        tone: latestPlanningMessage || latestDraftMessage ? "warn" : "neutral",
      },
      {
        key: "execution",
        label: "Execution",
        title:
          routeRefreshNeeded
            ? "Route refresh needed before execution"
            : runtimeGraphNarrative?.title ||
          workspaceState?.latestSubtask?.nodeName ||
          executionNarrative[0]?.title ||
          "Execution story",
        detail:
          routeRefreshNeeded
            ? workspaceState?.staleReason || workspaceState?.nextRecommendedDetail ||
              "The run surface is holding because the route should be refreshed first."
            : runtimeGraphNarrative?.detail ||
              workspaceState?.latestSubtask?.progressMessage ||
              workspaceState?.latestRunSummary ||
              executionNarrative[0]?.detail ||
              "Run events, node progress, and handoff outputs will be condensed here.",
        metric:
          runtimeGraph
            ? `${runtimeGraph.nodes.length} nodes`
            : workspaceState?.latestRunId
            ? workspaceState.runStatus || `${executionNarrative.length} beats`
            : `${executionNarrative.length} beats`,
        tone:
          runtimeGraphNarrative?.tone ||
          (threadOverview?.stageLabel === "Running"
            ? "success"
            : threadOverview?.stageTone || "neutral"),
      },
      {
        key: "thread",
        label: "Coordination",
        title: latestConversationMessage
          ? latestConversationMessage.role === "user"
            ? "Waiting for orchestrator"
            : "Latest orchestrator reply"
          : "Mission coordination",
        detail: latestConversationMessage
          ? getConversationMessageText(latestConversationMessage) ||
            `${latestConversationMessage.role === "user" ? "You" : "Orchestrator"} posted the latest turn.`
          : "Mission instructions and orchestrator replies stay here while route, runtime, and outputs remain organized above.",
        metric: `${conversationMessages.length} update${conversationMessages.length === 1 ? "" : "s"}`,
        tone: latestConversationMessage ? messageTone(latestConversationMessage) : "neutral",
      },
    ];
  }, [
    conversationMessages.length,
    executionNarrative,
    latestDraftMessage,
    latestConversationMessage,
    latestPlanningMessage,
    hasVersionedWorkspaceContract,
    missionSnapshot,
    orchestratorBriefing,
    planOptionsNarrative,
    runtimeGraph,
    runtimeGraphNarrative,
    threadOverview,
    workspaceState,
    workPackages,
  ]);

  const activeStage =
    workspaceStages.find((stage) => stage.key === activeWorkspaceStage) || workspaceStages[0];
  const stageCardWidth = Math.min(Math.max(width * 0.54, 176), 244);
  const isWideWorkspace = width >= 980;
  const compactConversationMessages = conversationMessages.slice(-4);

  const workspaceBridge = useMemo(() => {
    const activeOrchestratorTurn =
      orchestratorTurns.find((turn) => turn.status === "active") ||
      orchestratorTurns[orchestratorTurns.length - 1] ||
      null;
    const latestUserText =
      missionSnapshot?.latestUserInstruction ||
      (latestUserConversationMessage
        ? getConversationMessageText(latestUserConversationMessage)
        : null);
    const planLabel = planOptionsNarrative
      ? `Route v${planOptionsNarrative.revision} / ${planOptionsNarrative.focusedOption}`
      : latestDraftMessage
        ? "DAG draft"
        : null;
    const routeRefreshNeeded =
      workspaceState?.planStale === true &&
      workspaceState.stage !== "execute" &&
      workspaceState.stage !== "waiting" &&
      workspaceState.stage !== "deliver";
    const focusLabel = activeStage.key === "thread" ? "Briefing" : activeStage.label;
    const focusTitle =
      missionSnapshot?.stages.find((stage) => stage.key === activeStage.key)?.title ||
      activeOrchestratorTurn?.title ||
      (planOptionsNarrative
        ? `Comparing ${planOptionsNarrative.summaries.length} route${
            planOptionsNarrative.summaries.length === 1 ? "" : "s"
          }`
        : latestDraftMessage
          ? "Drafting the mission flow"
          : threadOverview?.headline ||
            workspaceState?.pendingDecision ||
            activeStage.title);
    const focusDetail =
      routeRefreshNeeded
        ? workspaceState.staleReason ||
          workspaceState.nextRecommendedDetail ||
          "The latest instruction changed the route and the workspace is waiting for a refresh."
        : missionSnapshot?.missionSummary ||
          activeOrchestratorTurn?.detail ||
          workspaceState?.pendingDecision ||
          workspaceState?.constraintsSummary ||
          (planOptionsNarrative
            ? `${planLabel} is the current decision surface in the workspace.`
            : latestDraftMessage
              ? "The current draft is being held as the source for the next planning pass."
              : workPackages[0]?.summary ||
                executionNarrative[0]?.detail ||
                threadOverview?.detail ||
                activeStage.detail);
    return {
      latestUserText,
      orchestratorRead:
        missionSnapshot?.orchestratorReadback ||
        activeOrchestratorTurn?.userRead ||
        latestOrchestratorReplyText ||
        orchestratorBriefing?.summary ||
        threadOverview?.detail ||
        "The orchestrator has not replied yet.",
      focusLabel,
      focusTitle,
      focusDetail,
      nextMoveLabel:
        missionSnapshot?.nextActionLabel ||
        workspaceState?.nextRecommendedLabel ||
        threadOverview?.nextStepLabel ||
        "Move the mission forward",
      nextMoveDetail:
        missionSnapshot?.nextActionDetail ||
        workspaceState?.nextRecommendedDetail ||
        threadOverview?.nextStepDetail ||
        "Send a new instruction or use the orchestration tools to continue.",
    };
  }, [
    activeStage.detail,
    activeStage.key,
    activeStage.label,
    activeStage.title,
    executionNarrative,
    latestDraftMessage,
    latestOrchestratorReplyText,
    latestUserConversationMessage,
    missionSnapshot,
    orchestratorBriefing?.summary,
    orchestratorTurns,
    planOptionsNarrative,
    threadOverview?.detail,
    threadOverview?.headline,
    threadOverview?.nextStepDetail,
    threadOverview?.nextStepLabel,
    workPackages,
    workspaceState,
  ]);

  const latestConfirmedContent = useMemo(() => {
    if (!latestPlanningMessage || confirmedRevision === null || !confirmedOption) {
      return null;
    }
    if (getPlanRevision(latestPlanningMessage) !== confirmedRevision) {
      const confirmedMessage =
        [...visibleMessages]
          .reverse()
          .find((message) => getPlanRevision(message) === confirmedRevision) || null;
      return extractPlanOptionContent(confirmedMessage, confirmedOption);
    }
    return extractPlanOptionContent(latestPlanningMessage, confirmedOption);
  }, [latestPlanningMessage, confirmedRevision, confirmedOption, visibleMessages]);

  const confirmedValidationSummary = useMemo(() => {
    const validation = isObject(latestConfirmedContent?.validation)
      ? (latestConfirmedContent.validation as never)
      : null;
    return summarizeValidationState(validation);
  }, [latestConfirmedContent]);

  const activeExecutionBeat = useMemo(() => {
    return executionNarrative.find((beat) => beat.status === "active") || executionNarrative[0] || null;
  }, [executionNarrative]);

  const interventionMessages = useMemo(() => {
    return visibleMessages.filter(isInterventionMessage);
  }, [visibleMessages]);

  const artifactMessages = useMemo(() => {
    return visibleMessages.filter((message) => message.kind === "artifact_card");
  }, [visibleMessages]);

  const sessionAttachments = data?.attachments || [];

  const latestRunMessage = useMemo(() => {
    return getLatestMessage(visibleMessages, ["run_card"]);
  }, [visibleMessages]);

  const latestSummaryMessage = useMemo(() => {
    return getLatestMessage(visibleMessages, ["summary_card"]);
  }, [visibleMessages]);

  const workspaceSections = useMemo<WorkspaceSection[]>(() => {
    const sections: WorkspaceSection[] = [];
    const stableWorkspaceStages: WorkspaceStageKey[] = [
      "briefing",
      "work",
      "plan",
      "execution",
      "thread",
    ];
    const routeRefreshNeeded =
      workspaceState?.planStale === true &&
      workspaceState.stage !== "execute" &&
      workspaceState.stage !== "waiting" &&
      workspaceState.stage !== "deliver";
    const spec = missionSpec || missionSnapshot?.spec || null;
    const missionObjective =
      spec?.objective ||
      missionSnapshot?.objective ||
      workspaceState?.workingGoal ||
      threadOverview?.headline ||
      orchestratorBriefing?.title ||
      "The orchestrator is reading the mission.";
    const missionConstraints = spec?.constraints || [];
    const missionOutputs = spec?.requestedOutputs || [];
    const missionOutputStatusRank: Record<string, number> = {
      returned: 4,
      in_progress: 3,
      prepared: 2,
      requested: 1,
    };
    const missionOutputItems = [...(missionSnapshot?.outputs || [])].sort(
      (left, right) =>
        (missionOutputStatusRank[right.status] || 0) -
        (missionOutputStatusRank[left.status] || 0),
    );
    const missionCheckpoints = missionSnapshot?.checkpoints || [];
    const missionWorkspaceSections = missionSnapshot?.workspaceSections || [];
    const useContractWorkspaceSections =
      hasVersionedWorkspaceContract && missionWorkspaceSections.length > 0;
    const missionWorkspaceSectionByKey = new Map<string, (typeof missionWorkspaceSections)[number]>();
    const legacySectionAliases: Record<string, string> = {
      brief: "objective",
      work: "work_packages",
      runtime: "execution_summary",
    };
    for (const section of missionWorkspaceSections) {
      missionWorkspaceSectionByKey.set(section.key, section);
      const alias = legacySectionAliases[section.key];
      if (alias && !missionWorkspaceSectionByKey.has(alias)) {
        missionWorkspaceSectionByKey.set(alias, section);
      }
    }
    const pushWorkspaceSection = (section: WorkspaceSection) => {
      const contractSection = useContractWorkspaceSections
        ? missionWorkspaceSectionByKey.get(section.key)
        : null;
      sections.push({
        ...section,
        eyebrow: contractSection?.label || section.eyebrow,
        title: contractSection?.title || section.title,
        detail: contractSection?.summary || section.detail,
        tone: contractSection?.tone || section.tone,
      });
    };
    const missionQuestions = spec?.openQuestions || workspaceState?.openQuestions || [];
    const missionRoute = spec?.route || null;
    const pipelineSummary = spec?.pipelineSummary || null;
    const checkpointSummary = spec?.checkpointSummary || null;
    const preparedOutputPackages = workPackages.filter((pkg) => !!pkg.artifactExpectation);
    const latestRunId =
      data?.latest_run?.run_id ||
      (typeof latestRunMessage?.content.run_id === "string" ? latestRunMessage.content.run_id : null) ||
      (typeof latestSummaryMessage?.content.run_id === "string" ? latestSummaryMessage.content.run_id : null);
    const latestRunStatus =
      (typeof latestSummaryMessage?.content.status === "string" ? latestSummaryMessage.content.status : null) ||
      (typeof latestRunMessage?.content.status === "string" ? latestRunMessage.content.status : null) ||
      data?.latest_run?.status ||
      null;
    const latestRunSummary =
      (typeof latestSummaryMessage?.content.current_summary === "string"
        ? latestSummaryMessage.content.current_summary
        : null) ||
      data?.latest_run?.current_summary ||
      null;
    const latestRunUpdatedAt =
      data?.latest_run?.updated_at || latestSummaryMessage?.created_at || latestRunMessage?.created_at || null;
    const outputEvidenceMessages = visibleMessages
      .filter((message) =>
        message.kind === "run_card" ||
        message.kind === "summary_card" ||
        message.kind === "artifact_card" ||
        message.kind === "subtask_card",
      )
      .slice(-3)
      .reverse();
    const outputSummary =
      missionWorkspaceSectionByKey.get("outputs")?.summary ||
      (artifactMessages.length > 0
        ? `${artifactMessages.length} deliverable${artifactMessages.length === 1 ? "" : "s"} projected back into the mission`
        : missionOutputs.length > 0
          ? `${missionOutputs.length} requested output${missionOutputs.length === 1 ? "" : "s"} are being tracked`
          : "No outputs have been requested or returned yet");

    pushWorkspaceSection({
      key: "objective",
      eyebrow: "Objective",
      title: missionObjective,
      detail:
        missionConstraints.length > 0
          ? `Constraints: ${missionConstraints.join(" / ")}`
          : workspaceState?.constraintsSummary ||
        threadOverview?.detail ||
        orchestratorBriefing?.summary ||
        "The workspace is holding the mission context and waiting for the next orchestration move.",
      tone: threadOverview?.stageTone || orchestratorBriefing?.tone || "neutral",
      stages: stableWorkspaceStages,
      layout: "full",
      body: (
        <View style={styles.workspaceSignalGrid}>
          {workspaceState?.nextRecommendedLabel ? (
            <View style={styles.workspaceSignalCard}>
              <Text style={styles.workspaceSignalLabel}>Next move</Text>
              <Text style={[styles.workspaceSignalText, styles.signalWarn]}>
                {workspaceState.nextRecommendedLabel}
              </Text>
              {workspaceState.nextRecommendedDetail ? (
                <Text style={styles.workspaceSignalMeta}>{workspaceState.nextRecommendedDetail}</Text>
              ) : null}
            </View>
          ) : null}
          {routeRefreshNeeded ? (
            <View style={styles.workspaceSignalCard}>
              <Text style={styles.workspaceSignalLabel}>Route status</Text>
              <Text style={[styles.workspaceSignalText, styles.signalWarn]}>
                {workspaceState.hasActivePlan ? "Current plan is stale" : "Current draft is stale"}
              </Text>
              {workspaceState.staleReason ? (
                <Text style={styles.workspaceSignalMeta}>{workspaceState.staleReason}</Text>
              ) : null}
            </View>
          ) : null}
          {orchestratorBriefing?.items.map((item) => (
            <View key={item.key} style={styles.workspaceSignalCard}>
              <Text style={styles.workspaceSignalLabel}>{item.label}</Text>
              <Text
                style={[
                  styles.workspaceSignalText,
                  item.tone === "danger"
                    ? styles.signalDanger
                    : item.tone === "warn"
                      ? styles.signalWarn
                      : item.tone === "success"
                        ? styles.signalSuccess
                        : null,
                ]}
              >
                {item.detail}
              </Text>
            </View>
          )) || null}
          {missionQuestions.map((question, index) => (
            <View key={`open-question-${index}`} style={styles.workspaceSignalCard}>
              <Text style={styles.workspaceSignalLabel}>Open question</Text>
              <Text style={[styles.workspaceSignalText, styles.signalWarn]}>{question}</Text>
            </View>
          ))}
        </View>
      ),
    });

    const routeSection = missionWorkspaceSectionByKey.get("route");
    pushWorkspaceSection({
      key: "route",
      eyebrow: routeSection?.label || "Route",
      title:
        routeSection?.title ||
        (routeRefreshNeeded
          ? "Route needs refresh"
          : missionRoute
            ? getMissionRouteLabel(missionRoute)
            : latestDraftMessage
              ? "Draft route is ready"
              : "Route not selected"),
      detail:
        routeSection?.summary ||
        (routeRefreshNeeded
          ? workspaceState?.staleReason ||
            workspaceState?.nextRecommendedDetail ||
            "The latest mission note changed the route and it should be refreshed."
          : planOptionsNarrative?.comparisonSummary ||
            missionRoute?.selectedTemplateName ||
            missionRoute?.selectedTemplateId ||
            "A normalized route will appear after planning."),
      tone:
        routeSection?.tone ||
        (routeRefreshNeeded
          ? "warn"
          : typeof missionRoute?.confirmedRevision === "number"
            ? "success"
            : planOptionsNarrative || latestDraftMessage
              ? "warn"
              : "neutral"),
      stages: stableWorkspaceStages,
      layout: "full",
      body: (
        <View style={styles.workspaceSignalGrid}>
          {routeRefreshNeeded ? (
            <View style={styles.workspaceSignalCard}>
              <Text style={styles.workspaceSignalLabel}>Route status</Text>
              <Text style={[styles.workspaceSignalText, styles.signalWarn]}>
                {workspaceState.hasActivePlan ? "Current plan is stale" : "Current draft is stale"}
              </Text>
              {workspaceState.staleReason ? (
                <Text style={styles.workspaceSignalMeta}>{workspaceState.staleReason}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.workspaceSignalCard}>
            <Text style={styles.workspaceSignalLabel}>Active route</Text>
            <Text
              style={[
                styles.workspaceSignalText,
                missionRoute?.stale
                  ? styles.signalWarn
                  : typeof missionRoute?.confirmedRevision === "number"
                    ? styles.signalSuccess
                    : null,
              ]}
            >
              {getMissionRouteLabel(missionRoute)}
            </Text>
            <Text style={styles.workspaceSignalMeta}>
              Template:{" "}
              {missionRoute?.selectedTemplateName ||
                missionRoute?.selectedTemplateId ||
                "No route template selected yet"}
            </Text>
            {missionRoute?.alternativeAvailable ? (
              <Text style={styles.workspaceSignalMeta}>Alternative route available</Text>
            ) : null}
          </View>
          {spec ? (
            <View style={styles.workspaceSignalCard}>
              <Text style={styles.workspaceSignalLabel}>Revision lineage</Text>
              <Text style={styles.workspaceSignalText}>
                Latest {spec.revisionLineage.latestRevision ?? "none"}
              </Text>
              <Text style={styles.workspaceSignalMeta}>
                Confirmed{" "}
                {typeof spec.revisionLineage.confirmedRevision === "number"
                  ? `v${spec.revisionLineage.confirmedRevision} / ${
                      spec.revisionLineage.confirmedOption || "primary"
                    }`
                  : "none"}
              </Text>
            </View>
          ) : null}
          {planOptionsNarrative ? (
            <View style={styles.workspaceSignalCard}>
              <Text style={styles.workspaceSignalLabel}>Route options</Text>
              <Text style={styles.workspaceSignalText}>
                {planOptionsNarrative.summaries.length} option
                {planOptionsNarrative.summaries.length === 1 ? "" : "s"} ready
              </Text>
              <Text style={styles.workspaceSignalMeta}>
                Focus: {planOptionsNarrative.focusedOption} / v{planOptionsNarrative.revision}
              </Text>
            </View>
          ) : latestDraftMessage ? (
            <View style={styles.workspaceSignalCard}>
              <Text style={styles.workspaceSignalLabel}>Draft route</Text>
              <Text style={styles.workspaceSignalText}>Draft DAG is ready</Text>
              <Text style={styles.workspaceSignalMeta}>
                Promote the draft into route options before execution.
              </Text>
            </View>
          ) : null}
        </View>
      ),
    });

    if (missionCheckpoints.length > 0 || useContractWorkspaceSections) {
      const checkpointSection = missionWorkspaceSectionByKey.get("checkpoints");
      pushWorkspaceSection({
        key: "checkpoints",
        eyebrow: checkpointSection?.label || "Checkpoints",
        title: checkpointSection?.title || "Mission checkpoints",
        detail:
          checkpointSection?.summary ||
          "Mission checkpoints keep mission intent, route, launch, runtime, gates, and outputs visible without opening raw cards.",
        tone: checkpointSection?.tone || (checkpointSummary?.active ? "warn" : "success"),
        stages: stableWorkspaceStages,
        layout: "full",
        body: (
          <View style={styles.workspaceCheckpointGrid}>
            {missionCheckpoints.length > 0 ? (
              missionCheckpoints.map((checkpoint) => (
                <View key={`mission-checkpoint-${checkpoint.key}`} style={styles.workspaceCheckpointCard}>
                  <View style={styles.workspaceArtifactTop}>
                    <Text style={styles.workspaceArtifactTitle}>{checkpoint.label}</Text>
                    <Badge
                      label={
                        checkpoint.status === "done"
                          ? "Done"
                          : checkpoint.status === "active"
                            ? "Active"
                            : "Pending"
                      }
                      tone={checkpoint.tone}
                    />
                  </View>
                  <Text style={styles.workspaceArtifactSummary}>{checkpoint.detail}</Text>
                  <View style={styles.workspaceArtifactDetailList}>
                    <Text style={styles.workspaceArtifactDetail}>
                      Type: {formatStatus(checkpoint.type || "checkpoint")}
                    </Text>
                    {typeof checkpoint.relatedRouteRevision === "number" ? (
                      <Text style={styles.workspaceArtifactDetail}>
                        Route: v{checkpoint.relatedRouteRevision}
                      </Text>
                    ) : null}
                    {checkpoint.relatedRunId ? (
                      <Text style={styles.workspaceArtifactDetail}>Run: {checkpoint.relatedRunId}</Text>
                    ) : null}
                    {checkpoint.relatedOutputKeys?.length ? (
                      <Text style={styles.workspaceArtifactDetail}>
                        Outputs: {checkpoint.relatedOutputKeys.slice(0, 3).join(", ")}
                      </Text>
                    ) : null}
                    {checkpoint.nextActionLabel ? (
                      <Text style={styles.workspaceArtifactDetail}>
                        Next: {checkpoint.nextActionLabel}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyStage}>
                <Text style={styles.timelineDetail}>
                  Checkpoints will appear here as the mission contract records route, launch, runtime, gate, or output progress.
                </Text>
              </View>
            )}
          </View>
        ),
      });
    }

    pushWorkspaceSection({
      key: "outputs",
      eyebrow: "Mission outputs",
      title:
        missionWorkspaceSectionByKey.get("outputs")?.title ||
        (artifactMessages.length > 0
          ? outputArtifactSurface?.title || "Deliverables are available for review"
          : missionOutputs.length > 0
            ? "Expected deliverables are defined"
            : "Deliverables have not materialized yet"),
      detail:
        missionWorkspaceSectionByKey.get("outputs")?.summary ||
        outputArtifactSurface?.summary ||
        (artifactMessages.length > 0
          ? "The latest run has already written deliverables back into the mission record."
          : preparedOutputPackages.length > 0
            ? `The current route already prepares deliverables across ${preparedOutputPackages.length} work package${
                preparedOutputPackages.length === 1 ? "" : "s"
              }.`
          : missionOutputs.length > 0
            ? "The mission spec already defines what should be handed back when execution finishes."
            : "Requested outputs and returned artifacts will surface here once the mission is routed and executed."),
      tone:
        missionWorkspaceSectionByKey.get("outputs")?.tone ||
        (artifactMessages.length > 0
          ? "success"
          : outputArtifactSurface?.tone || (missionOutputs.length > 0 ? "warn" : "neutral")),
      stages: stableWorkspaceStages,
      layout: "full",
      body: (
        <View style={styles.workspaceArtifactGrid}>
          {sessionAttachments.length > 0 ? (
            <View style={styles.workspaceArtifactCard}>
              <View style={styles.workspaceArtifactTop}>
                <Text style={styles.workspaceArtifactTitle}>Context attachments</Text>
                <Badge
                  label={`${sessionAttachments.length} file${
                    sessionAttachments.length === 1 ? "" : "s"
                  }`}
                  tone="neutral"
                />
              </View>
              <Text style={styles.workspaceArtifactSummary}>
                Attached task context is available to keep the mission brief grounded.
              </Text>
              <View style={styles.workspacePreparedOutputList}>
                {sessionAttachments.map((attachment) => {
                  const size = formatAttachmentSize(attachment.size_bytes);
                  return (
                    <View
                      key={`session-attachment-${attachment.attachment_id}`}
                      style={styles.workspacePreparedOutputCard}
                    >
                      <View style={styles.workspacePreparedOutputHeader}>
                        <Text style={styles.workspacePreparedOutputTitle}>{attachment.name}</Text>
                        <Badge label={attachment.kind || "context"} tone="neutral" />
                      </View>
                      <Text style={styles.workspacePreparedOutputDetail}>
                        {attachment.summary || attachment.storage_uri}
                      </Text>
                      <View style={styles.workspaceArtifactDetailList}>
                        <Text style={styles.workspaceArtifactDetail}>{attachment.storage_uri}</Text>
                        {attachment.mime_type ? (
                          <Text style={styles.workspaceArtifactDetail}>Type: {attachment.mime_type}</Text>
                        ) : null}
                        {size ? (
                          <Text style={styles.workspaceArtifactDetail}>Size: {size}</Text>
                        ) : null}
                        <Text style={styles.workspaceArtifactDetail}>
                          Attached: {formatTime(attachment.created_at)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
          {missionOutputItems.length > 0 ? (
            <View style={styles.workspaceArtifactCard}>
              <View style={styles.workspaceArtifactTop}>
                <Text style={styles.workspaceArtifactTitle}>Mission output ledger</Text>
                <Badge
                  label={`${missionOutputItems.length} output${
                    missionOutputItems.length === 1 ? "" : "s"
                  }`}
                  tone={missionOutputItems.some((item) => item.status === "returned") ? "success" : "warn"}
                />
              </View>
              <Text style={styles.workspaceArtifactSummary}>
                Outputs are now tracked as mission state, with requested, prepared, in-progress, and returned status.
              </Text>
              <View style={styles.workspacePreparedOutputList}>
                {missionOutputItems.map((output) => (
                  <View key={`mission-output-ledger-${output.key}`} style={styles.workspacePreparedOutputCard}>
                    <View style={styles.workspacePreparedOutputHeader}>
                      <Text style={styles.workspacePreparedOutputTitle}>{output.title}</Text>
                      <Badge label={formatStatus(output.status)} tone={output.tone} />
                    </View>
                    <Text style={styles.workspacePreparedOutputDetail}>{output.summary}</Text>
                    <View style={styles.workspaceOutputRow}>
                      <View style={styles.workspaceOutputChip}>
                        <Text style={styles.workspaceOutputText}>
                          Stage {formatStatus(output.stageKey || "plan")}
                        </Text>
                      </View>
                      {output.currentActionLabel ? (
                        <View style={styles.workspaceOutputChip}>
                          <Text style={styles.workspaceOutputText}>{output.currentActionLabel}</Text>
                        </View>
                      ) : null}
                      {output.history?.length ? (
                        <View style={styles.workspaceOutputChip}>
                          <Text style={styles.workspaceOutputText}>
                            {output.history.length} history
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {output.detailLines.length > 0 ||
                    output.pipelineKeys.length > 0 ||
                    output.relatedCheckpointKeys?.length ||
                    output.latestArtifactMessageId ||
                    output.history?.length ? (
                      <View style={styles.workspaceArtifactDetailList}>
                        {output.pipelineKeys.length > 0 ? (
                          <Text style={styles.workspaceArtifactDetail}>
                            Work packages: {output.pipelineKeys.slice(0, 3).join(", ")}
                          </Text>
                        ) : null}
                        {output.relatedCheckpointKeys?.length ? (
                          <Text style={styles.workspaceArtifactDetail}>
                            Checkpoints: {output.relatedCheckpointKeys.slice(0, 3).join(", ")}
                          </Text>
                        ) : null}
                        {output.latestArtifactMessageId ? (
                          <Text style={styles.workspaceArtifactDetail}>
                            Latest artifact: {output.latestArtifactMessageId}
                          </Text>
                        ) : null}
                        {output.detailLines.slice(0, 3).map((line) => (
                          <Text key={`${output.key}-${line}`} style={styles.workspaceArtifactDetail}>
                            {line}
                          </Text>
                        ))}
                        {output.history?.slice(0, 2).map((entry) => (
                          <Text key={`${output.key}-${entry.key}`} style={styles.workspaceArtifactDetail}>
                            {formatStatus(entry.status)}: {entry.summary}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {missionOutputs.length > 0 ? (
            <View style={styles.workspaceArtifactCard}>
              <View style={styles.workspaceArtifactTop}>
                <Text style={styles.workspaceArtifactTitle}>Expected deliverables</Text>
                <Badge
                  label={`${missionOutputs.length} target${missionOutputs.length === 1 ? "" : "s"}`}
                  tone={artifactMessages.length > 0 ? "success" : "warn"}
                />
              </View>
              <Text style={styles.workspaceArtifactSummary}>{outputSummary}</Text>
              <View style={styles.workspaceOutputRow}>
                {missionOutputs.map((output, index) => (
                  <View key={`mission-output-${index}`} style={styles.workspaceOutputChip}>
                    <Text style={styles.workspaceOutputText}>{output}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {preparedOutputPackages.length > 0 ? (
            <View style={styles.workspaceArtifactCard}>
              <View style={styles.workspaceArtifactTop}>
                <Text style={styles.workspaceArtifactTitle}>Prepared by the current route</Text>
                <Badge
                  label={`${preparedOutputPackages.length} package${
                    preparedOutputPackages.length === 1 ? "" : "s"
                  }`}
                  tone="warn"
                />
              </View>
              <Text style={styles.workspaceArtifactSummary}>
                These packages already declare what they are expected to hand back when the route executes.
              </Text>
              <View style={styles.workspacePreparedOutputList}>
                {preparedOutputPackages.map((pkg) => (
                  <View key={`prepared-output-${pkg.key}`} style={styles.workspacePreparedOutputCard}>
                    <View style={styles.workspacePreparedOutputHeader}>
                      <Text style={styles.workspacePreparedOutputTitle}>{pkg.title}</Text>
                      <Badge label={pkg.status === "active" ? "Live" : "Prepared"} tone={pkg.tone} />
                    </View>
                    <Text style={styles.workspacePreparedOutputDetail}>{pkg.summary}</Text>
                    <View style={styles.workspaceOutputRow}>
                      {pkg.artifactExpectation
                        ?.split(",")
                        .map((item) => item.trim())
                        .filter(Boolean)
                        .map((item) => (
                          <View key={`${pkg.key}-${item}`} style={styles.workspaceOutputChip}>
                            <Text style={styles.workspaceOutputText}>{item}</Text>
                          </View>
                        ))}
                    </View>
                    <View style={styles.workspaceArtifactDetailList}>
                      {pkg.primaryAgentLabel ? (
                        <Text style={styles.workspaceArtifactDetail}>Lead agent: {pkg.primaryAgentLabel}</Text>
                      ) : null}
                      {pkg.activeNodeName ? (
                        <Text style={styles.workspaceArtifactDetail}>Current node: {pkg.activeNodeName}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {outputArtifactSurface ? (
            <View style={styles.workspaceArtifactCard}>
              <View style={styles.workspaceArtifactTop}>
                <Text style={styles.workspaceArtifactTitle}>{outputArtifactSurface.title}</Text>
                <Badge
                  label={
                    artifactMessages.length > 0
                      ? "Returned"
                      : latestRunStatus === "completed"
                        ? "Recorded"
                      : outputArtifactSurface.tone === "warn"
                        ? "In progress"
                        : "Pending"
                  }
                  tone={artifactMessages.length > 0 ? "success" : outputArtifactSurface.tone}
                />
              </View>
              <Text style={styles.workspaceArtifactSummary}>{outputArtifactSurface.summary}</Text>
              {outputArtifactSurface.chips.length > 0 ? (
                <View style={styles.workspaceArtifactChipRow}>
                  {outputArtifactSurface.chips.map((chip) => (
                    <View key={`output-surface-chip-${chip}`} style={styles.workspaceArtifactChip}>
                      <Text style={styles.workspaceArtifactChipText}>{chip}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.workspaceArtifactDetailList}>
                {outputArtifactSurface.detailLines.map((line) => (
                  <Text key={`output-surface-line-${line}`} style={styles.workspaceArtifactDetail}>
                    {line}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
          {latestRunId || latestRunSummary ? (
            <View style={styles.workspaceArtifactCard}>
              <View style={styles.workspaceArtifactTop}>
                <Text style={styles.workspaceArtifactTitle}>Latest run handoff</Text>
                <Badge
                  label={latestRunStatus ? formatStatus(latestRunStatus) : "Recorded"}
                  tone={
                    latestRunStatus === "completed"
                      ? "success"
                      : latestRunStatus === "failed" || latestRunStatus === "cancelled"
                        ? "danger"
                        : latestRunStatus === "waiting_human" || latestRunStatus === "paused"
                          ? "warn"
                          : "neutral"
                  }
                />
              </View>
              <Text style={styles.workspaceArtifactSummary}>
                {latestRunSummary ||
                  (latestRunStatus
                    ? `The latest run is currently ${formatStatus(latestRunStatus).toLowerCase()}.`
                    : "The latest run has been recorded for this mission.")}
              </Text>
              <View style={styles.workspaceArtifactDetailList}>
                {latestRunId ? (
                  <Text style={styles.workspaceArtifactDetail}>Run id: {latestRunId}</Text>
                ) : null}
                {latestRunUpdatedAt ? (
                  <Text style={styles.workspaceArtifactDetail}>
                    Last update: {formatTime(latestRunUpdatedAt)}
                  </Text>
                ) : null}
              </View>
              {latestRunId ? (
                <View style={styles.workspaceArtifactActions}>
                  <Link href={`/runs/${latestRunId}` as never} asChild>
                    <Pressable>
                      <Text style={styles.linkText}>Open run detail</Text>
                    </Pressable>
                  </Link>
                </View>
              ) : null}
            </View>
          ) : null}
          {outputEvidenceMessages.length > 0 ? (
            <View style={styles.workspaceArtifactCard}>
              <View style={styles.workspaceArtifactTop}>
                <Text style={styles.workspaceArtifactTitle}>Output evidence</Text>
                <Badge
                  label={`${outputEvidenceMessages.length} signal${
                    outputEvidenceMessages.length === 1 ? "" : "s"
                  }`}
                  tone="neutral"
                />
              </View>
              <Text style={styles.workspaceArtifactSummary}>
                Recent run updates and returned outputs stay attached to the mission as auditable evidence.
              </Text>
              <View style={styles.workspaceEvidenceStack}>
                {outputEvidenceMessages.map((message) => (
                  <View key={`output-evidence-${message.message_id}`} style={styles.workspaceEvidenceCard}>
                    {renderTimelineMessage(message, true)}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {artifactMessages.map((message) => {
            const name = typeof message.content.name === "string" ? message.content.name : "Artifact";
            const storageUri =
              typeof message.content.storage_uri === "string" ? message.content.storage_uri : null;
            const mimeType =
              typeof message.content.mime_type === "string" ? message.content.mime_type : null;
            const createdAt =
              typeof message.content.created_at === "string" ? message.content.created_at : message.created_at;
            return (
              <View key={message.message_id} style={styles.workspaceArtifactCard}>
                <View style={styles.workspaceArtifactTop}>
                  <Text style={styles.workspaceArtifactTitle}>{name}</Text>
                  <Badge label="Artifact" tone="success" />
                </View>
                <Text style={styles.workspaceArtifactSummary}>
                  This deliverable has been projected back into the mission workspace.
                </Text>
                {storageUri ? (
                  <View style={styles.workspaceArtifactDetailList}>
                    <Text style={styles.workspaceArtifactDetail}>{storageUri}</Text>
                    {mimeType ? (
                      <Text style={styles.workspaceArtifactDetail}>Type: {mimeType}</Text>
                    ) : null}
                    {createdAt ? (
                      <Text style={styles.workspaceArtifactDetail}>
                        Returned: {formatTime(createdAt)}
                      </Text>
                    ) : null}
                  </View>
                ) : mimeType || createdAt ? (
                  <View style={styles.workspaceArtifactDetailList}>
                    {mimeType ? (
                      <Text style={styles.workspaceArtifactDetail}>Type: {mimeType}</Text>
                    ) : null}
                    {createdAt ? (
                      <Text style={styles.workspaceArtifactDetail}>
                        Returned: {formatTime(createdAt)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
          {missionOutputs.length === 0 && !outputArtifactSurface && artifactMessages.length === 0 ? (
            <View style={styles.emptyStage}>
              <Text style={styles.timelineDetail}>
                Outputs will appear here after the mission spec defines deliverables or a run returns artifacts.
              </Text>
            </View>
          ) : null}
        </View>
      ),
    });

    const pendingDecisionSection = missionWorkspaceSectionByKey.get("pending_decisions");
    const pendingDecisionItems = [
      workspaceState?.pendingDecision,
      workspaceState?.nextRecommendedLabel,
      workspaceState?.nextRecommendedDetail,
      ...missionQuestions,
    ].filter((item): item is string => typeof item === "string" && !!item.trim());
    pushWorkspaceSection({
      key: "pending_decisions",
      eyebrow: pendingDecisionSection?.label || "Pending Decisions",
      title:
        pendingDecisionSection?.title ||
        (pendingDecisionItems.length > 0
          ? "Decision needed before the mission moves"
          : "No blocking decision"),
      detail:
        pendingDecisionSection?.summary ||
        pendingDecisionItems[0] ||
        "No human decision is currently blocking progress or changing mission direction.",
      tone: pendingDecisionSection?.tone || (pendingDecisionItems.length > 0 ? "warn" : "neutral"),
      stages: stableWorkspaceStages,
      layout: "full",
      body: (
        <View style={styles.workspaceSignalGrid}>
          {pendingDecisionItems.length > 0 ? (
            pendingDecisionItems.slice(0, 6).map((item, index) => (
              <View key={`pending-decision-${index}`} style={styles.workspaceSignalCard}>
                <Text style={styles.workspaceSignalLabel}>
                  {index === 0 ? "Current decision" : "Decision context"}
                </Text>
                <Text style={[styles.workspaceSignalText, styles.signalWarn]}>{item}</Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyStage}>
              <Text style={styles.timelineDetail}>
                No blocking decision is recorded. This module will surface human gates or direction changes when they matter.
              </Text>
            </View>
          )}
        </View>
      ),
    });

    pushWorkspaceSection({
      key: "execution_summary",
      eyebrow: missionWorkspaceSectionByKey.get("execution_summary")?.label || "Execution Summary",
      title:
        missionWorkspaceSectionByKey.get("execution_summary")?.title ||
        runtimeGraphNarrative?.title ||
        (latestRunId ? `Run ${latestRunId}` : "Runtime not launched"),
      detail:
        missionWorkspaceSectionByKey.get("execution_summary")?.summary ||
        latestRunSummary ||
        runtimeGraphNarrative?.detail ||
        "Runtime state will appear here after a real run starts.",
      tone:
        missionWorkspaceSectionByKey.get("execution_summary")?.tone ||
        runtimeGraphNarrative?.tone ||
        (interventionMessages.length > 0 ? "warn" : latestRunStatus ? "success" : "neutral"),
      stages: stableWorkspaceStages,
      layout: "full",
      body: (
        <View style={styles.workspaceStack}>
          {runtimeGraph || latestRunId ? renderRuntimeGraphSurface("compact") : null}
          {interventionMessages.length > 0 ? (
            <View style={styles.workspaceInterventionStack}>
              {interventionMessages.map((message) => (
                <View key={message.message_id} style={styles.workspaceInterventionCard}>
                  {renderMessageBody(message)}
                </View>
              ))}
            </View>
          ) : null}
          {!runtimeGraph && !latestRunId && interventionMessages.length === 0 ? (
            <View style={styles.emptyStage}>
              <Text style={styles.timelineDetail}>
                Execution summary will appear here after a run starts or the mission records a runtime handoff.
              </Text>
            </View>
          ) : null}
        </View>
      ),
    });

    const evidenceSection = missionWorkspaceSectionByKey.get("evidence_summary");
    pushWorkspaceSection({
      key: "evidence_summary",
      eyebrow: evidenceSection?.label || "Evidence Summary",
      title:
        evidenceSection?.title ||
        (evidenceMessages.length > 0
          ? `${evidenceMessages.length} mission signal${evidenceMessages.length === 1 ? "" : "s"}`
          : "Evidence not attached yet"),
      detail:
        evidenceSection?.summary ||
        (evidenceMessages.length > 0
          ? "Planner, route, run, patch, and artifact details are preserved as audit context."
          : "Raw evidence and drilldown entries will appear after planning or execution signals exist."),
      tone: evidenceSection?.tone || "neutral",
      stages: stableWorkspaceStages,
      layout: "full",
      body: (
        <View style={styles.workspaceStack}>
          {outputEvidenceMessages.length > 0 ? (
            <View style={styles.workspaceArtifactCard}>
              <View style={styles.workspaceArtifactTop}>
                <Text style={styles.workspaceArtifactTitle}>Recent evidence</Text>
                <Badge
                  label={`${outputEvidenceMessages.length} signal${
                    outputEvidenceMessages.length === 1 ? "" : "s"
                  }`}
                  tone="neutral"
                />
              </View>
              <Text style={styles.workspaceArtifactSummary}>
                Recent run updates and returned outputs stay attached to the mission as auditable evidence.
              </Text>
              <View style={styles.workspaceEvidenceStack}>
                {outputEvidenceMessages.map((message) => (
                  <View key={`evidence-summary-${message.message_id}`} style={styles.workspaceEvidenceCard}>
                    {renderTimelineMessage(message, true)}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          <View style={styles.workspaceAuditBlock}>
            <View style={styles.workspaceAuditSummary}>
              <Text style={styles.workspaceAuditText}>
                {conversationMessages.length} coordination updates, {evidenceMessages.length} mission signals,
                {` ${messageProjection.hiddenPlanningRevisionCount} folded revision(s).`}
              </Text>
              <Pressable onPress={() => setShowThreadEvidence((current) => !current)}>
                <Text style={styles.linkText}>{showThreadEvidence ? "Hide signals" : "Open signals"}</Text>
              </Pressable>
            </View>
            {showThreadEvidence ? (
              <View style={styles.messages}>
                {evidenceMessages.map((message) => renderTimelineMessage(message))}
              </View>
            ) : latestEvidenceMessage ? (
              <View style={styles.auditPreviewCard}>
                <Text style={styles.auditPreviewLabel}>Latest signal</Text>
                <Text style={styles.auditPreviewTitle}>{getMessageKindLabel(latestEvidenceMessage.kind)}</Text>
                <Text style={styles.auditPreviewText}>
                  Open the signal rail to inspect the latest planner, run, approval, and output state.
                </Text>
              </View>
            ) : (
              <Text style={styles.timelineDetail}>
                No evidence cards yet. They will appear here once the orchestrator drafts, plans, or runs work.
              </Text>
            )}
          </View>
        </View>
      ),
    });

    pushWorkspaceSection({
      key: "work_packages",
      eyebrow: missionWorkspaceSectionByKey.get("work_packages")?.label || "Work Packages",
      title:
        missionWorkspaceSectionByKey.get("work_packages")?.title ||
        (workspaceState?.stage === "deliver"
          ? "Mission delivered a final state"
          : workspaceState?.stage === "waiting"
            ? "The orchestration is paused at a human gate"
            : routeRefreshNeeded
              ? "The route needs refresh against the latest brief"
              : workspaceState?.stage === "execute"
                ? workspaceState?.latestSubtask?.nodeName || "Execution is active"
                : activeExecutionBeat?.title || orchestratorTurns[0]?.title || "The mission flow is being shaped."),
      detail:
        missionWorkspaceSectionByKey.get("work_packages")?.summary ||
        (routeRefreshNeeded
          ? workspaceState?.staleReason || workspaceState?.nextRecommendedDetail ||
            "The workspace is pausing execution framing until the route is refreshed."
          : workspaceState?.latestSubtask?.progressMessage ||
            workspaceState?.latestRunSummary ||
            activeExecutionBeat?.detail ||
            orchestratorTurns.find((turn) => turn.status === "active")?.detail ||
            "The current execution flow will appear here as the mission moves from route into run."),
      tone:
        missionWorkspaceSectionByKey.get("work_packages")?.tone ||
        (routeRefreshNeeded
          ? "warn"
          : activeExecutionBeat?.tone || orchestratorTurns.find((turn) => turn.status === "active")?.tone || "neutral"),
      stages: stableWorkspaceStages,
      layout: "split",
      body: (
        <View style={styles.workspaceStack}>
          {workPackages.length > 0 ? (
            <View style={styles.workspacePackageGrid}>
              {workPackages.map((pkg) => {
                const packageContract = pkg as unknown as {
                  outputKeys?: string[];
                  checkpointKeys?: string[];
                  nextActionLabel?: unknown;
                };
                const packageOutputKeys = Array.isArray(packageContract.outputKeys)
                  ? packageContract.outputKeys
                  : [];
                const packageCheckpointKeys = Array.isArray(packageContract.checkpointKeys)
                  ? packageContract.checkpointKeys
                  : [];
                const packageNextAction =
                  typeof packageContract.nextActionLabel === "string"
                    ? packageContract.nextActionLabel
                    : null;
                return (
                  <View key={pkg.key} style={styles.workspacePackageSurface}>
                    <View style={styles.workspacePackageHeader}>
                      <Text style={styles.workspacePackageTitle}>{pkg.title}</Text>
                      <Badge
                        label={
                          pkg.status === "done"
                            ? "Done"
                            : pkg.status === "active"
                              ? "Live"
                              : pkg.status === "blocked"
                                ? "Blocked"
                                : "Queued"
                        }
                        tone={
                          pkg.status === "done"
                            ? "success"
                            : pkg.status === "blocked"
                              ? "warn"
                              : pkg.tone
                        }
                      />
                    </View>
                    <Text style={styles.workspacePackageSummary}>{pkg.summary}</Text>
                    <View style={styles.metricRow}>
                      <View style={styles.metricChip}>
                        <Text style={styles.metricLabel}>Nodes</Text>
                        <Text style={styles.metricValue}>{pkg.nodeCount}</Text>
                      </View>
                      <View style={styles.metricChip}>
                        <Text style={styles.metricLabel}>Ready frontier</Text>
                        <Text style={styles.metricValue}>{pkg.readyCount}</Text>
                      </View>
                    </View>
                    {pkg.primaryAgentLabel ? (
                      <Text style={styles.workspacePackageMeta}>Lead agent: {pkg.primaryAgentLabel}</Text>
                    ) : null}
                    {pkg.activeNodeName ? (
                      <Text style={styles.workspacePackageMeta}>Current node: {pkg.activeNodeName}</Text>
                    ) : null}
                    {packageOutputKeys.length ? (
                      <Text style={styles.workspacePackageMeta}>
                        Outputs: {packageOutputKeys.slice(0, 3).join(", ")}
                      </Text>
                    ) : null}
                    {packageCheckpointKeys.length ? (
                      <Text style={styles.workspacePackageMeta}>
                        Checkpoints: {packageCheckpointKeys.slice(0, 3).join(", ")}
                      </Text>
                    ) : null}
                    {packageNextAction ? (
                      <Text style={styles.workspacePackageMeta}>Next: {packageNextAction}</Text>
                    ) : null}
                    {pkg.blocker ? (
                      <Text style={[styles.workspacePackageMeta, styles.signalWarn]}>Blocker: {pkg.blocker}</Text>
                    ) : null}
                    {runtimeGraph ? (
                      <Pressable onPress={() => focusWorkspaceStage("execution")}>
                        <Text style={styles.linkText}>Open topology</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyStage}>
              <Text style={styles.timelineDetail}>
                Draft a DAG or compile a route to let the orchestrator materialize concrete work packages.
              </Text>
            </View>
          )}
          <View style={styles.workspaceTimeline}>
            {orchestratorTurns.map((turn) => (
              <View key={turn.key} style={styles.workspaceTimelineRow}>
                <View
                  style={[
                    styles.workspaceTimelineDot,
                    turn.tone === "danger"
                      ? styles.timelineDotDanger
                      : turn.tone === "warn"
                        ? styles.timelineDotWarn
                        : turn.tone === "success"
                          ? styles.timelineDotSuccess
                          : styles.timelineDotNeutral,
                  ]}
                />
                <View style={styles.workspaceTimelineCard}>
                  <View style={styles.workspaceTimelineHeader}>
                    <Text style={styles.workspaceTimelineTitle}>{turn.title}</Text>
                    <Badge
                      label={
                        turn.status === "done" ? "Done" : turn.status === "active" ? "Current" : "Queued"
                      }
                      tone={
                        turn.status === "done"
                          ? "success"
                          : turn.status === "active"
                            ? turn.tone
                            : "neutral"
                      }
                    />
                  </View>
                  <Text style={styles.workspaceTimelineDetail}>{turn.detail}</Text>
                  {turn.userRead ? (
                    <View style={styles.workspaceTurnInsight}>
                      <Text style={styles.workspaceTurnLabel}>Agent read</Text>
                      <Text style={styles.workspaceTurnText}>{turn.userRead}</Text>
                    </View>
                  ) : null}
                  {turn.workspaceImpact ? (
                    <View style={styles.workspaceTurnInsight}>
                      <Text style={styles.workspaceTurnLabel}>Workspace impact</Text>
                      <Text style={styles.workspaceTurnText}>{turn.workspaceImpact}</Text>
                    </View>
                  ) : null}
                  {turn.nextActionLabel || turn.nextActionDetail ? (
                    <View style={styles.workspaceTurnInsight}>
                      <Text style={styles.workspaceTurnLabel}>
                        {turn.nextActionLabel || "Next action"}
                      </Text>
                      {turn.nextActionDetail ? (
                        <Text style={styles.workspaceTurnText}>{turn.nextActionDetail}</Text>
                      ) : null}
                    </View>
                  ) : null}
                  {turn.generatedOutputs.length > 0 ? (
                    <View style={styles.workspaceOutputRow}>
                      {turn.generatedOutputs.map((output) => (
                        <View key={`${turn.key}-${output}`} style={styles.workspaceOutputChip}>
                          <Text style={styles.workspaceOutputText}>{output}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      ),
    });

    const sectionRank: Record<string, number> = {
      objective: 0,
      route: 1,
      work_packages: 2,
      checkpoints: 3,
      outputs: 4,
      pending_decisions: 5,
      execution_summary: 6,
      evidence_summary: 7,
    };
    const contractSectionRank = new Map<string, number>(
      missionWorkspaceSections.map((section, index) => [section.key, index]),
    );
    return [...sections].sort((left, right) => {
      const leftRank = useContractWorkspaceSections
        ? contractSectionRank.get(left.key)
        : undefined;
      const rightRank = useContractWorkspaceSections
        ? contractSectionRank.get(right.key)
        : undefined;
      return (
        (leftRank ?? sectionRank[left.key] ?? 50) -
        (rightRank ?? sectionRank[right.key] ?? 50)
      );
    });
  }, [
    conversationMessages.length,
    evidenceMessages,
    executionNarrative,
    latestDraftMessage,
    latestEvidenceMessage,
    messageProjection.hiddenPlanningRevisionCount,
    orchestratorBriefing,
    orchestratorTurns,
    planOptionsNarrative,
    runtimeGraph,
    runtimeGraphNarrative,
    showThreadEvidence,
    hasVersionedWorkspaceContract,
    missionSpec,
    missionSnapshot,
    threadOverview,
    workspaceState,
    workPackages,
    artifactMessages,
    outputArtifactSurface,
    activeExecutionBeat,
    latestRunMessage,
    latestSummaryMessage,
    data,
    workPackages,
    visibleMessages,
  ]);

  const activeWorkspaceSections = useMemo(() => {
    return workspaceSections.filter((section) => {
      if (!section.stages || section.stages.length === 0) {
        return true;
      }
      if (activeWorkspaceStage === "thread") {
        return section.stages.includes("thread") || section.stages.includes("briefing");
      }
      return section.stages.includes(activeWorkspaceStage);
    });
  }, [workspaceSections, activeWorkspaceStage]);

  useEffect(() => {
    if (!data || !sessionId || initializedStageSessionId === sessionId) {
      return;
    }
    setActiveWorkspaceStage((current) => resolveWorkspaceStageForDetail(data, current));
    setInitializedStageSessionId(sessionId);
  }, [data, initializedStageSessionId, sessionId]);

  useEffect(() => {
    if (!threadOverview?.autoRefreshRecommended || !sessionId) {
      return;
    }

    const timer = setInterval(() => {
      void load();
    }, 5000);

    return () => clearInterval(timer);
  }, [threadOverview?.autoRefreshRecommended, sessionId, load]);

  useEffect(() => {
    if (!pendingScrollToLatest) {
      return;
    }

    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
      setPendingScrollToLatest(false);
    }, 120);

    return () => clearTimeout(timer);
  }, [pendingScrollToLatest, activeWorkspaceStage, visibleMessages.length]);

  useEffect(() => {
    if (!pendingFocusStage || activeWorkspaceStage !== pendingFocusStage) {
      return;
    }

    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(stageDetailTopY - 16, 0),
        animated: true,
      });
      setPendingFocusStage(null);
    }, 140);

    return () => clearTimeout(timer);
  }, [pendingFocusStage, activeWorkspaceStage, stageDetailTopY, latestPlanningMessage?.message_id]);

  function focusWorkspaceStage(stage: WorkspaceStageKey) {
    setActiveWorkspaceStage(stage);
    setPendingFocusStage(stage);
  }

  function makeOptimisticUserMessage(text: string): SessionMessageRecord {
    return {
      message_id: `local_${Date.now()}`,
      session_id: sessionId,
      role: "user",
      kind: "text",
      content: {
        text,
        delivery_state: "sending",
      },
      created_at: new Date().toISOString(),
      linked_run_id: null,
      linked_node_run_id: null,
    };
  }

  async function handleAddNoteOnly() {
    if (!sessionId || !draft.trim()) {
      return;
    }

    const text = draft.trim();
    const runtimeCaptureMode =
      !reviseTarget &&
      (isRuntimeInterventionStatus(data?.session.status) ||
        isRuntimeInterventionStatus(data?.latest_run?.status));
    const optimisticMessage = makeOptimisticUserMessage(text);
    setSending(true);
    setDraft("");
    setShowComposerTools(false);
    Keyboard.dismiss();
    setOptimisticMessages((current) => [...current, optimisticMessage]);
    setActiveWorkspaceStage((current) => (current === "thread" ? "briefing" : current));
    setPendingScrollToLatest(false);
    try {
      const response = runtimeCaptureMode
        ? await createSessionIntervention({
            sessionId,
            content: text,
            target_run_id: data?.session.latest_run_id || undefined,
            metadata: {
              source: "mobile_mission_composer",
            },
          })
        : await sendSessionMessage(sessionId, text);
      setData((current) => ({
        mission: current
          ? {
              ...current.mission,
              title: response.session.title,
              status: response.session.status,
              updated_at: response.session.updated_at,
              latest_run_id: response.session.latest_run_id,
              active_run_ids: response.session.active_run_ids,
              archived: response.session.archived,
              archived_at: response.session.archived_at,
              archived_by: response.session.archived_by,
              hidden: response.session.hidden,
              hidden_at: response.session.hidden_at,
              hidden_by: response.session.hidden_by,
              message_count: mergeSessionMessages(current.messages || [], response.messages).length,
              mission_spec: current.mission_spec || current.mission.mission_spec,
              mission_spec_contract:
                current.mission_spec_contract || current.mission.mission_spec_contract || null,
              mission_snapshot: current.mission_snapshot || current.mission.mission_snapshot,
              mission_view: current.mission_view || current.mission.mission_view,
            }
          : {
              mission_id: response.session.session_id,
              session_id: response.session.session_id,
              title: response.session.title,
              status: response.session.status,
              updated_at: response.session.updated_at,
              created_at: response.session.created_at,
              latest_run_id: response.session.latest_run_id,
              active_run_ids: response.session.active_run_ids,
              archived: response.session.archived,
              archived_at: response.session.archived_at,
              archived_by: response.session.archived_by,
              hidden: response.session.hidden,
              hidden_at: response.session.hidden_at,
              hidden_by: response.session.hidden_by,
              message_count: response.messages.length,
              mission_spec: null,
              mission_spec_contract: null,
              mission_snapshot: null,
              mission_view: undefined,
            },
        session: response.session,
        messages: mergeSessionMessages(current?.messages || [], response.messages),
        latest_run: current?.latest_run || null,
        mission_spec: current?.mission_spec || null,
        mission_spec_contract: current?.mission_spec_contract || null,
        mission_snapshot: current?.mission_snapshot || null,
        mission_view: current?.mission_view || current?.mission.mission_view,
      }));
      setOptimisticMessages((current) =>
        current.filter((message) => message.message_id !== optimisticMessage.message_id),
      );
      const nextStage = runtimeCaptureMode
        ? "execution"
        : inferPreferredWorkspaceStage(
            { session: response.session },
            activeWorkspaceStage === "thread" ? "briefing" : activeWorkspaceStage,
          );
      focusWorkspaceStage(nextStage);
      setPendingScrollToLatest(nextStage === "thread");
    } catch (nextError) {
      setOptimisticMessages((current) =>
        current.filter((message) => message.message_id !== optimisticMessage.message_id),
      );
      Alert.alert(
        runtimeCaptureMode ? "Intervention failed" : "Send failed",
        nextError instanceof Error ? nextError.message : "Unknown error",
      );
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    if (!sessionId || !draft.trim()) {
      return;
    }
    await handleAddNoteOnly();
  }

  async function handlePlan() {
    if (!sessionId) {
      return;
    }
    setPlanning(true);
    try {
      const response = await planSession({ sessionId });
      await load();
      focusWorkspaceStage(inferPreferredWorkspaceStage(response, "plan"));
    } catch (nextError) {
      Alert.alert("Planning failed", nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setPlanning(false);
    }
  }

  async function handleRefreshRoute() {
    if (!sessionId) {
      return;
    }
    setPlanning(true);
    try {
      const response =
        latestDraftMessage && !latestPlanningMessage
          ? await planSession({
              sessionId,
              draft_message_id: latestDraftMessage.message_id,
            })
          : await planSession({ sessionId });
      setReviseTarget(null);
      await load();
      focusWorkspaceStage(inferPreferredWorkspaceStage(response, "plan"));
    } catch (nextError) {
      Alert.alert(
        "Route refresh failed",
        nextError instanceof Error ? nextError.message : "Unknown error",
      );
    } finally {
      setPlanning(false);
    }
  }

  async function handleDraftDag() {
    if (!sessionId) {
      return;
    }
    setDraftingDag(true);
    try {
      const response = await createSessionDraft({ sessionId });
      await load();
      focusWorkspaceStage(inferPreferredWorkspaceStage(response, "plan"));
    } catch (nextError) {
      Alert.alert("Draft failed", nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setDraftingDag(false);
    }
  }

  async function handleUseDraftToPlan(messageId: string) {
    if (!sessionId) {
      return;
    }
    setBusyId(messageId);
    try {
      const response = await planSession({
        sessionId,
        draft_message_id: messageId,
      });
      setDismissedDraftIds((current) => current.filter((item) => item !== messageId));
      await load();
      focusWorkspaceStage(inferPreferredWorkspaceStage(response, "plan"));
    } catch (nextError) {
      Alert.alert("Planning failed", nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setBusyId(null);
    }
  }

  function handleDiscardDraft(messageId: string) {
    setDismissedDraftIds((current) =>
      current.includes(messageId) ? current : [...current, messageId],
    );
  }

  async function handleRevisePlan() {
    if (!sessionId || !draft.trim()) {
      return;
    }

    const target =
      reviseTarget ||
      getDefaultReviseTarget(latestPlanningMessage, confirmedRevision, confirmedOption);
    if (!target) {
      Alert.alert("Revise failed", "Create a plan first.");
      return;
    }

    setRevising(true);
    try {
      const response = await reviseSessionPlan({
        sessionId,
        instructions: draft.trim(),
        revision: target.revision,
        option: target.option,
      });
      setDraft("");
      setReviseTarget(null);
      setShowComposerTools(false);
      Keyboard.dismiss();
      await load();
      focusWorkspaceStage(inferPreferredWorkspaceStage(response, "plan"));
    } catch (nextError) {
      Alert.alert("Revise failed", nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setRevising(false);
    }
  }

  async function handleCreateRun() {
    if (!sessionId) {
      return;
    }
    setCreatingRun(true);
    try {
      const response = await createRunFromSession({
        sessionId,
        validation_mode: "strict",
        plan_revision: confirmedRevision || undefined,
        plan_option: confirmedOption || undefined,
      });
      await load();
      setActiveWorkspaceStage(inferPreferredWorkspaceStage(response, "execution"));
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.code === "plan_stale") {
        focusWorkspaceStage("plan");
        Alert.alert("Route refresh needed", nextError.message);
        return;
      }
      Alert.alert(
        "Create run failed",
        nextError instanceof Error ? nextError.message : "Unknown error",
      );
    } finally {
      setCreatingRun(false);
    }
  }

  async function handleConfirmPlan(revision: number, option: PlanOptionKey) {
    if (!sessionId) {
      return;
    }
    const key = `${revision}:${option}`;
    setConfirmingKey(key);
    try {
      const response = await confirmSessionPlan({
        sessionId,
        revision,
        option,
      });
      await load();
      focusWorkspaceStage(inferPreferredWorkspaceStage({ session: response.session }, "plan"));
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.code === "plan_stale") {
        focusWorkspaceStage("plan");
        Alert.alert("Route refresh needed", nextError.message);
        return;
      }
      Alert.alert("Confirm failed", nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setConfirmingKey(null);
    }
  }

  async function handleCreateRunForPlan(revision: number, option: PlanOptionKey) {
    if (!sessionId) {
      return;
    }
    const key = `${revision}:${option}`;
    setRunningKey(key);
    try {
      const response = await createRunFromSession({
        sessionId,
        validation_mode: "strict",
        plan_revision: revision,
        plan_option: option,
      });
      await load();
      setActiveWorkspaceStage(inferPreferredWorkspaceStage(response, "execution"));
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.code === "plan_stale") {
        focusWorkspaceStage("plan");
        Alert.alert("Route refresh needed", nextError.message);
      } else if (nextError instanceof ApiError && nextError.code === "run_validation_failed") {
        Alert.alert("Create run failed", nextError.message);
      } else {
        Alert.alert(
          "Create run failed",
          nextError instanceof Error ? nextError.message : "Unknown error",
        );
      }
    } finally {
      setRunningKey(null);
    }
  }

  async function handlePatchAction(patchId: string, action: "confirm" | "reject") {
    if (!sessionId) return;
    setBusyId(patchId);
    try {
      if (action === "confirm") {
        const response = await confirmDagPatch({ sessionId, patchId });
        const partial = response.patch.status === "applied_with_errors";
        Alert.alert(
          partial ? "Patch partially applied" : "Patch applied",
          partial
            ? "Some operations failed. Review the patch outcomes."
            : "The patch operations were applied successfully.",
        );
      } else {
        await rejectDagPatch({
          sessionId,
          patchId,
          reason: "Rejected from mission workspace",
        });
      }
      await load();
    } catch (nextError) {
      Alert.alert(
        "Patch action failed",
        nextError instanceof Error ? nextError.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproval(approvalId: string, kind: "approve" | "reject") {
    setBusyId(approvalId);
    try {
      if (kind === "approve") {
        await approve(approvalId, "Approved from mission workspace");
      } else {
        await reject(approvalId, "Rejected from mission workspace");
      }
      await load();
      setActiveWorkspaceStage("execution");
    } catch (nextError) {
      Alert.alert(
        "Action failed",
        nextError instanceof Error ? nextError.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleSubmitHumanInput(
    requestId: string,
    schema: Record<string, unknown>,
  ) {
    const currentDraft = inputDrafts[requestId] || {};
    const missing = validateRequiredFields(schema, currentDraft);
    if (missing) {
      Alert.alert("Cannot submit", `Fill required field: ${missing}`);
      return;
    }

    setBusyId(requestId);
    try {
      await submitHumanInput(requestId, buildSchemaPayload(schema, currentDraft));
      await load();
      setActiveWorkspaceStage("execution");
    } catch (nextError) {
      Alert.alert(
        "Action failed",
        nextError instanceof Error ? nextError.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  }

  function handleApplyDirective(instruction: string) {
    setShowComposerTools(true);
    setDraft((current) => (current.trim() ? `${current.trim()}\n${instruction}` : instruction));
  }

  function renderMessageBody(message: SessionMessageRecord) {
    return (
      <MessageBody
        message={message}
        busyId={busyId}
        confirmingKey={confirmingKey}
        runningKey={runningKey}
        confirmedPlanRevision={confirmedRevision}
        confirmedPlanOption={confirmedOption}
        inputDrafts={inputDrafts}
        activeReviseTarget={reviseTarget}
        onUseDraft={(messageId) => void handleUseDraftToPlan(messageId)}
        onDiscardDraft={handleDiscardDraft}
        onApproval={(approvalId, kind) => void handleApproval(approvalId, kind)}
        onPatchAction={(patchId, action) => void handlePatchAction(patchId, action)}
        onHumanInput={(requestId, schema) => void handleSubmitHumanInput(requestId, schema)}
        onConfirmPlan={(revision, option) => void handleConfirmPlan(revision, option)}
        onRunPlan={(revision, option) => void handleCreateRunForPlan(revision, option)}
        routeRefreshNeeded={routeRefreshNeeded}
        onSelectReviseTarget={(target) => {
          setReviseTarget(target);
          setShowComposerTools(true);
          focusWorkspaceStage("plan");
        }}
        onDraftChange={(requestId, key, value) =>
          setInputDrafts((current) => ({
            ...current,
            [requestId]: {
              ...(current[requestId] || {}),
              [key]: value,
            },
          }))
        }
      />
    );
  }

  function renderTimelineMessage(message: SessionMessageRecord, compact = false) {
    const deliveryState = asString(message.content.delivery_state);
    return (
      <View
        key={message.message_id}
        style={[
          styles.timelineRow,
          compact ? styles.timelineRowCompact : null,
          message.role === "user" ? styles.timelineRowUser : null,
        ]}
      >
        {compact ? null : (
          <View style={styles.timelineRail}>
            <View
              style={[
                styles.timelineDot,
                message.role === "user"
                  ? styles.timelineDotUser
                  : messageTone(message) === "danger"
                    ? styles.timelineDotDanger
                    : messageTone(message) === "success"
                      ? styles.timelineDotSuccess
                      : messageTone(message) === "warn"
                        ? styles.timelineDotWarn
                        : styles.timelineDotNeutral,
              ]}
            />
          </View>
        )}
        <View
          style={[
            styles.messageBubble,
            compact ? styles.messageBubbleCompact : null,
            message.role === "user"
              ? styles.userBubble
              : message.kind === "plan_card" ||
                  message.kind === "plan_options_card" ||
                  message.kind === "draft_card" ||
                  message.kind === "run_card" ||
                  message.kind === "dag_patch_card"
                ? styles.cardBubble
                : styles.systemBubble,
          ]}
        >
          <View style={styles.messageHeader}>
            <Text style={styles.messageRole}>
              {message.role === "user"
                ? "You"
                : message.role === "orchestrator"
                  ? "Orchestrator"
                  : "System"}
            </Text>
            <View style={styles.messageHeaderRight}>
              <Badge
                label={deliveryState === "sending" ? "Sending" : getMessageKindLabel(message.kind)}
                tone={deliveryState === "sending" ? "warn" : messageTone(message)}
              />
              {compact ? null : <Text style={styles.messageTime}>{formatTime(message.created_at)}</Text>}
            </View>
          </View>
          {renderMessageBody(message)}
        </View>
      </View>
    );
  }

  function renderConversationMessage(message: SessionMessageRecord, compact = false) {
    const deliveryState = asString(message.content.delivery_state);
    const text = getConversationMessageText(message) || "Empty message";
    const isUser = message.role === "user";
    const isTurn = message.kind === "orchestrator_turn";
    const turnUserRead = isTurn && typeof message.content.user_read === "string"
      ? message.content.user_read
      : null;
    const turnWorkspaceImpact = isTurn && typeof message.content.workspace_impact === "string"
      ? message.content.workspace_impact
      : null;
    const turnNextActionLabel = isTurn && typeof message.content.next_action_label === "string"
      ? message.content.next_action_label
      : null;
    const turnNextActionDetail = isTurn && typeof message.content.next_action_detail === "string"
      ? message.content.next_action_detail
      : null;
    const turnGeneratedOutputs =
      isTurn && Array.isArray(message.content.generated_outputs)
        ? message.content.generated_outputs.filter((item): item is string => typeof item === "string").slice(0, compact ? 2 : 4)
        : [];
    return (
      <View
        key={message.message_id}
        style={[
          styles.conversationRow,
          isUser ? styles.conversationRowUser : null,
        ]}
      >
        <View
          style={[
            styles.conversationBubble,
            compact ? styles.conversationBubbleCompact : null,
            isUser ? styles.conversationBubbleUser : styles.conversationBubbleOrchestrator,
          ]}
        >
          <View style={styles.conversationMetaRow}>
            <Text
              style={[
                styles.conversationRole,
                isUser ? styles.conversationRoleUser : null,
              ]}
            >
              {isUser ? "You" : "Orchestrator"}
            </Text>
            {deliveryState === "sending" ? (
              <Text style={styles.conversationStatus}>Sending</Text>
            ) : compact ? null : (
              <Text style={styles.conversationTime}>{formatTime(message.created_at)}</Text>
            )}
          </View>
          <Text style={styles.conversationText}>{text}</Text>
          {!isUser && isTurn ? (
            <View style={styles.conversationTurnDetails}>
              {turnUserRead ? (
                <View style={styles.conversationInsightBlock}>
                  <Text style={styles.conversationInsightLabel}>Agent read</Text>
                  <Text style={styles.conversationInsightText}>{turnUserRead}</Text>
                </View>
              ) : null}
              {turnWorkspaceImpact ? (
                <View style={styles.conversationInsightBlock}>
                  <Text style={styles.conversationInsightLabel}>Workspace impact</Text>
                  <Text style={styles.conversationInsightText}>{turnWorkspaceImpact}</Text>
                </View>
              ) : null}
              {turnNextActionLabel || turnNextActionDetail ? (
                <View style={styles.conversationInsightBlock}>
                  <Text style={styles.conversationInsightLabel}>{turnNextActionLabel || "Next action"}</Text>
                  {turnNextActionDetail ? (
                    <Text style={styles.conversationInsightText}>{turnNextActionDetail}</Text>
                  ) : null}
                </View>
              ) : null}
              {turnGeneratedOutputs.length > 0 ? (
                <View style={styles.conversationOutputRow}>
                  {turnGeneratedOutputs.map((item) => (
                    <View key={`${message.message_id}-${item}`} style={styles.conversationOutputChip}>
                      <Text style={styles.conversationOutputText}>{item}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  function renderBriefingStage() {
    return (
      <View style={styles.narrativeList}>
        {orchestratorBriefing ? (
          <View style={styles.briefingCard}>
            <View style={styles.briefingHeader}>
              <View style={styles.overviewCopy}>
                <Badge label="Live briefing" tone={orchestratorBriefing.tone} />
                <Text style={styles.briefingTitle}>{orchestratorBriefing.title}</Text>
                <Text style={styles.briefingSummary}>{orchestratorBriefing.summary}</Text>
              </View>
            </View>
            <View style={styles.briefingList}>
              {orchestratorBriefing.items.map((item) => (
                <View key={item.key} style={styles.briefingRow}>
                  <Text style={styles.briefingLabel}>{item.label}</Text>
                  <Text
                    style={[
                      styles.briefingDetail,
                      item.tone === "danger"
                        ? styles.signalDanger
                        : item.tone === "warn"
                          ? styles.signalWarn
                          : item.tone === "success"
                            ? styles.signalSuccess
                            : null,
                    ]}
                  >
                    {item.detail}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <EmptyState
            title="No briefing yet"
            description="Send mission details or ask the orchestrator to draft a DAG."
          />
        )}
        <View style={styles.narrativeList}>
          {orchestratorTurns.map((turn) => (
            <View key={turn.key} style={styles.narrativeRow}>
              <View style={styles.narrativeRail}>
                <View
                  style={[
                    styles.narrativeDot,
                    turn.tone === "danger"
                      ? styles.timelineDotDanger
                      : turn.tone === "success"
                        ? styles.timelineDotSuccess
                        : turn.tone === "warn"
                          ? styles.timelineDotWarn
                          : styles.timelineDotNeutral,
                  ]}
                />
              </View>
              <View style={styles.narrativeBody}>
                <View style={styles.narrativeHeader}>
                  <Text style={styles.narrativeTitle}>{turn.title}</Text>
                  <Badge
                    label={
                      turn.status === "done"
                        ? "Done"
                        : turn.status === "active"
                          ? "Current"
                          : "Pending"
                    }
                    tone={
                      turn.status === "done"
                        ? "success"
                        : turn.status === "active"
                          ? turn.tone
                          : "neutral"
                    }
                  />
                </View>
                <Text style={styles.narrativeDetail}>{turn.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  function renderWorkStage() {
    return (
      <View style={styles.workPackageList}>
        {workPackages.map((pkg) => (
          <View key={pkg.key} style={styles.workPackageCard}>
            <View style={styles.workPackageHeader}>
              <View style={styles.overviewCopy}>
                <Badge
                  label={
                    pkg.status === "done"
                      ? "Done"
                      : pkg.status === "active"
                        ? "Live"
                        : pkg.status === "blocked"
                          ? "Blocked"
                          : "Pending"
                  }
                  tone={
                    pkg.status === "done"
                      ? "success"
                      : pkg.status === "blocked"
                        ? "warn"
                        : pkg.tone
                  }
                />
                <Text style={styles.workPackageTitle}>{pkg.title}</Text>
                <Text style={styles.workPackageSummary}>{pkg.summary}</Text>
              </View>
            </View>
            <View style={styles.metricRow}>
              <View style={styles.metricChip}>
                <Text style={styles.metricLabel}>Nodes</Text>
                <Text style={styles.metricValue}>{pkg.nodeCount}</Text>
              </View>
              <View style={styles.metricChip}>
                <Text style={styles.metricLabel}>Ready frontier</Text>
                <Text style={styles.metricValue}>{pkg.readyCount}</Text>
              </View>
              {pkg.primaryAgentLabel ? (
                <View style={styles.metricChip}>
                  <Text style={styles.metricLabel}>Lead agent</Text>
                  <Text style={styles.metricValue}>{pkg.primaryAgentLabel}</Text>
                </View>
              ) : null}
            </View>
            {pkg.activeNodeName ? (
              <Text style={styles.workPackageMeta}>Active node: {pkg.activeNodeName}</Text>
            ) : null}
            {pkg.artifactExpectation ? (
              <Text style={styles.workPackageMeta}>
                Expected output: {pkg.artifactExpectation}
              </Text>
            ) : null}
            {pkg.blocker ? (
              <Text style={[styles.workPackageMeta, styles.signalWarn]}>
                Blocker: {pkg.blocker}
              </Text>
            ) : null}
            {runtimeGraph ? (
              <Pressable onPress={() => focusWorkspaceStage("execution")}>
                <Text style={styles.linkText}>Open topology</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    );
  }

  function renderPlanStage() {
    const planningArtifact = latestPlanningMessage || latestDraftMessage;
    if (!planningArtifact) {
      return (
        <View style={styles.emptyStage}>
          <EmptyState
            title="No DAG or route yet"
            description="Draft a DAG or compile a route from the current mission context."
          />
          <View style={styles.actions}>
            <PrimaryButton
              label="Draft DAG"
              tone="muted"
              loading={draftingDag}
              onPress={() => void handleDraftDag()}
            />
            <PrimaryButton
              label="Create route"
              loading={planning}
              onPress={() => void handlePlan()}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.stageArtifact}>
        {latestPlanningMessage ? (
          <View style={styles.planFocusBanner}>
            <View style={styles.planFocusHeader}>
              <Badge
                label={`Route v${getPlanRevision(latestPlanningMessage) || 1}`}
                tone={confirmedRevision === getPlanRevision(latestPlanningMessage) ? "success" : "warn"}
              />
              <Text style={styles.planFocusTitle}>
                {confirmedRevision === getPlanRevision(latestPlanningMessage)
                  ? "This route is confirmed"
                  : "Review the latest route"}
              </Text>
            </View>
            <Text style={styles.planFocusText}>
              {planOptionsNarrative
                ? `${planOptionsNarrative.summaries.length} route${
                    planOptionsNarrative.summaries.length > 1 ? "s" : ""
                  } ready. Confirm a route, run it, or revise from the option below.`
                : "A compiled route is ready. Review its checklist before confirming or running."}
            </Text>
            {latestOrchestratorReplyText ? (
              <View style={styles.orchestratorReplyBlock}>
                <Text style={styles.orchestratorReplyLabel}>Orchestrator reply</Text>
                <Text style={styles.orchestratorReplyText}>{latestOrchestratorReplyText}</Text>
              </View>
            ) : null}
            {routeRefreshNeeded ? (
              <View style={styles.planFocusActions}>
                <PrimaryButton
                  label="Refresh route"
                  loading={planning}
                  onPress={() => void handleRefreshRoute()}
                />
                {planOptionsNarrative ? (
                  <PrimaryButton
                    label={`Revise ${planOptionsNarrative.focusedOption}`}
                    tone="muted"
                    onPress={() => {
                      setReviseTarget({
                        revision: planOptionsNarrative.revision,
                        option: planOptionsNarrative.focusedOption,
                      });
                      setShowComposerTools(true);
                    }}
                  />
                ) : null}
              </View>
            ) : planOptionsNarrative ? (
              <View style={styles.planFocusActions}>
                <PrimaryButton
                  label={
                    confirmedRevision === planOptionsNarrative.revision &&
                    confirmedOption === planOptionsNarrative.focusedOption
                      ? "Confirmed"
                      : `Confirm ${planOptionsNarrative.focusedOption}`
                  }
                  disabled={
                    confirmedRevision === planOptionsNarrative.revision &&
                    confirmedOption === planOptionsNarrative.focusedOption
                  }
                  loading={
                    confirmingKey ===
                    `${planOptionsNarrative.revision}:${planOptionsNarrative.focusedOption}`
                  }
                  onPress={() =>
                    void handleConfirmPlan(
                      planOptionsNarrative.revision,
                      planOptionsNarrative.focusedOption,
                    )
                  }
                />
                <PrimaryButton
                  label={`Run ${planOptionsNarrative.focusedOption}`}
                  tone="muted"
                  loading={
                    runningKey ===
                    `${planOptionsNarrative.revision}:${planOptionsNarrative.focusedOption}`
                  }
                  onPress={() =>
                    void handleCreateRunForPlan(
                      planOptionsNarrative.revision,
                      planOptionsNarrative.focusedOption,
                    )
                  }
                />
                <PrimaryButton
                  label={`Revise ${planOptionsNarrative.focusedOption}`}
                  tone="muted"
                  onPress={() => {
                    setReviseTarget({
                      revision: planOptionsNarrative.revision,
                      option: planOptionsNarrative.focusedOption,
                    });
                    setShowComposerTools(true);
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={[styles.messageBubble, styles.cardBubble, styles.stageMessageBubble]}>
          {renderMessageBody(planningArtifact)}
        </View>
      </View>
    );
  }

  function renderRuntimeGraphSurface(mode: "compact" | "full" = "full") {
    const latestRunId = getLatestRunIdFromMissionDetail(data);
    if (!runtimeGraph) {
      return (
        <View style={styles.emptyStage}>
          <Text style={styles.timelineDetail}>
            {latestRunId
              ? "The live execution map is not available for the latest run yet."
              : "Start a run to materialize the live execution map."}
          </Text>
        </View>
      );
    }

    const nodeNameById = new Map(runtimeGraph.nodes.map((node) => [node.nodeId, node.name]));
    const visibleNodes =
      mode === "compact" ? runtimeGraph.nodes.slice(0, 5) : runtimeGraph.nodes;
    const visibleEdges =
      mode === "compact" ? runtimeGraph.edges.slice(0, 4) : runtimeGraph.edges;
    const visiblePackages =
      mode === "compact" ? runtimeGraph.workPackages.slice(0, 4) : runtimeGraph.workPackages;

    return (
      <View style={styles.runtimeGraphSurface}>
        <View style={styles.runtimeGraphSummaryCard}>
          <View style={styles.runtimeGraphSummaryHeader}>
            <View style={styles.overviewCopy}>
              <Text style={styles.runtimeGraphEyebrow}>Live execution map</Text>
              <Text style={styles.runtimeGraphTitle}>
                {runtimeGraphNarrative?.title || "Live execution map"}
              </Text>
              <Text style={styles.runtimeGraphDetail}>
                {runtimeGraphNarrative?.detail ||
                  `${runtimeGraph.nodes.length} node(s), ${runtimeGraph.edges.length} edge(s).`}
              </Text>
            </View>
            <Badge label={formatStatus(runtimeGraph.runStatus)} tone={runtimeStatusTone(runtimeGraph.runStatus)} />
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metricChip}>
              <Text style={styles.metricLabel}>Nodes</Text>
              <Text style={styles.metricValue}>{runtimeGraph.nodes.length}</Text>
            </View>
            <View style={styles.metricChip}>
              <Text style={styles.metricLabel}>Edges</Text>
              <Text style={styles.metricValue}>{runtimeGraph.edges.length}</Text>
            </View>
            <View style={styles.metricChip}>
              <Text style={styles.metricLabel}>Frontier</Text>
              <Text style={styles.metricValue}>{runtimeGraph.frontier.length}</Text>
            </View>
            <View style={styles.metricChip}>
              <Text style={styles.metricLabel}>Packages</Text>
              <Text style={styles.metricValue}>{runtimeGraph.workPackages.length}</Text>
            </View>
          </View>
        </View>

        {visiblePackages.length > 0 ? (
          <View style={styles.runtimeGraphPackageList}>
            {visiblePackages.map((pkg) => (
              <View key={`runtime-package-${pkg.key}`} style={styles.runtimeGraphPackageCard}>
                <View style={styles.runtimeGraphPackageHeader}>
                  <Text style={styles.runtimeGraphPackageTitle}>{pkg.label}</Text>
                  <Badge
                    label={
                      pkg.status === "done"
                        ? "Done"
                        : pkg.status === "active"
                          ? "Live"
                          : pkg.status === "blocked"
                            ? "Blocked"
                            : "Queued"
                    }
                    tone={runtimePackageTone(pkg.status)}
                  />
                </View>
                <Text style={styles.runtimeGraphPackageMeta}>
                  {pkg.nodeRunIds.length} node(s), {pkg.readyCount} ready, {pkg.activeCount} active,
                  {` ${pkg.blockedCount} blocked`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.runtimeGraphNodeList}>
          {visibleNodes.map((node, index) => (
            <View key={node.nodeRunId} style={styles.runtimeGraphNodeRow}>
              <View
                style={[
                  styles.runtimeGraphNodeIndex,
                  runtimeStatusTone(node.status) === "danger"
                    ? styles.runtimeGraphNodeIndexDanger
                    : runtimeStatusTone(node.status) === "warn"
                      ? styles.runtimeGraphNodeIndexWarn
                      : runtimeStatusTone(node.status) === "success"
                        ? styles.runtimeGraphNodeIndexSuccess
                        : null,
                ]}
              >
                <Text style={styles.runtimeGraphNodeIndexText}>{index + 1}</Text>
              </View>
              <View style={styles.runtimeGraphNodeCard}>
                <View style={styles.runtimeGraphNodeHeader}>
                  <Text style={styles.runtimeGraphNodeTitle}>{node.name}</Text>
                  <Badge label={formatStatus(node.status)} tone={runtimeStatusTone(node.status)} />
                </View>
                <Text style={styles.runtimeGraphNodeMeta}>
                  {node.workPackageLabel} / {node.type}
                  {node.agentProfile ? ` / ${node.agentProfile}` : ""}
                </Text>
                {node.progress.message ? (
                  <Text style={styles.runtimeGraphNodeDetail}>{node.progress.message}</Text>
                ) : null}
                {node.markers.length > 0 ? (
                  <View style={styles.runtimeGraphMarkerRow}>
                    {node.markers.slice(0, 4).map((marker) => (
                      <Badge
                        key={`${node.nodeRunId}-${marker}`}
                        label={runtimeMarkerLabel(marker)}
                        tone={runtimeMarkerTone(marker)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        {visibleEdges.length > 0 ? (
          <View style={styles.runtimeGraphEdgeList}>
            {visibleEdges.map((edge, index) => (
              <View key={`runtime-edge-${edge.fromNodeId}-${edge.toNodeId}-${index}`} style={styles.runtimeGraphEdgeRow}>
                <Text style={styles.runtimeGraphEdgeText}>
                  {nodeNameById.get(edge.fromNodeId) || edge.fromNodeId} {"->"}{" "}
                  {nodeNameById.get(edge.toNodeId) || edge.toNodeId}
                </Text>
                <Badge label={formatStatus(edge.status)} tone={runtimeStatusTone(edge.status)} />
              </View>
            ))}
          </View>
        ) : null}

        {mode === "compact" && runtimeGraph.nodes.length > visibleNodes.length ? (
          <Pressable onPress={() => focusWorkspaceStage("execution")}>
            <Text style={styles.linkText}>Open full topology</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderExecutionStage() {
    return (
      <View style={styles.executionStageStack}>
        {runtimeGraph ? renderRuntimeGraphSurface("full") : null}
        <View style={styles.narrativeList}>
          {executionNarrative.map((beat) => (
            <View key={beat.key} style={styles.narrativeRow}>
              <View style={styles.narrativeRail}>
                <View
                  style={[
                    styles.narrativeDot,
                    beat.tone === "danger"
                      ? styles.timelineDotDanger
                      : beat.tone === "success"
                        ? styles.timelineDotSuccess
                        : beat.tone === "warn"
                          ? styles.timelineDotWarn
                          : styles.timelineDotNeutral,
                  ]}
                />
              </View>
              <View style={styles.narrativeBody}>
                <View style={styles.narrativeHeader}>
                  <Text style={styles.narrativeTitle}>{beat.title}</Text>
                  <Badge
                    label={
                      beat.status === "done"
                        ? "Done"
                        : beat.status === "active"
                          ? "Live"
                          : "Pending"
                    }
                    tone={
                      beat.status === "done"
                        ? "success"
                        : beat.status === "active"
                          ? beat.tone
                          : "neutral"
                    }
                  />
                </View>
                <Text style={styles.narrativeDetail}>{beat.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  function renderThreadStage() {
    return (
      <>
        <View style={styles.timelineHeader}>
          <View style={styles.overviewCopy}>
            <Text style={styles.timelineDetail}>
              This conversation is the live collaboration rail. The orchestrator should answer here, while route changes and evidence stay attached to the workspace instead of replacing the conversation.
            </Text>
            {messageProjection.hiddenPlanningRevisionCount > 0 ||
            messageProjection.hiddenPlannerMessageCount > 0 ? (
              <Text style={styles.timelineFoldHint}>
                Collapsed {messageProjection.hiddenPlanningRevisionCount} older route revision(s)
                {messageProjection.hiddenPlannerMessageCount > 0
                  ? ` and ${messageProjection.hiddenPlannerMessageCount} repeated planner note(s)`
                  : ""}
                .
              </Text>
            ) : null}
          </View>
          {latestConversationMessage ? (
            <View style={styles.latestEvent}>
              <Text style={styles.latestEventLabel}>Latest</Text>
              <Text style={styles.latestEventValue}>
                {latestConversationMessage.role === "user" ? "You" : "Orchestrator"}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.messages}>
          {conversationMessages.length === 0 ? (
            <EmptyState
              title="No coordination yet"
              description="Send the mission details and the orchestrator reply will appear here."
            />
          ) : (
            conversationMessages.map((message) => renderConversationMessage(message))
          )}
        </View>
        {evidenceMessages.length > 0 ||
        conversationProjection.hiddenNonConversationMessageCount > 0 ? (
          <View style={styles.evidencePanel}>
            <View style={styles.evidenceHeader}>
              <View style={styles.overviewCopy}>
                <Text style={styles.evidenceTitle}>Mission signals</Text>
                <Text style={styles.evidenceDetail}>
                  {latestEvidenceMessage
                    ? `Latest artifact: ${getMessageKindLabel(latestEvidenceMessage.kind)}.`
                    : "Planner cards, run updates, approvals, and artifacts are kept out of the main coordination rail."}
                </Text>
              </View>
              <Pressable onPress={() => setShowThreadEvidence((current) => !current)}>
                <Text style={styles.linkText}>
                  {showThreadEvidence ? "Hide cards" : "Show cards"}
                </Text>
              </Pressable>
            </View>
            {messageProjection.hiddenPlanningRevisionCount > 0 ? (
              <View style={styles.foldBanner}>
                <Text style={styles.foldBannerText}>
                  Older planning revisions are folded so the mission reads like one orchestration story.
                </Text>
                <Pressable onPress={() => setShowPlanningHistory((current) => !current)}>
                  <Text style={styles.linkText}>
                    {showPlanningHistory ? "Hide history" : "Show history"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {showThreadEvidence ? (
              <View style={styles.messages}>
                {evidenceMessages.map((message) => renderTimelineMessage(message))}
              </View>
            ) : null}
          </View>
        ) : null}
      </>
    );
  }

  function renderActiveStage(stageKey: WorkspaceStageKey = activeStage.key) {
    if (stageKey === "work") {
      return renderWorkStage();
    }
    if (stageKey === "plan") {
      return renderPlanStage();
    }
    if (stageKey === "execution") {
      return renderExecutionStage();
    }
    if (stageKey === "thread") {
      return renderThreadStage();
    }
    return renderBriefingStage();
  }

  function renderComposer(mode: "floating" | "dock" = "floating") {
    if (!data || loading || error) {
      return null;
    }
    const isDock = mode === "dock";
    const toolsOpen = isDock || showComposerTools || !!reviseTarget;
    const showDirectiveRail = directiveChips.length > 0 && toolsOpen;
    const runtimeCaptureMode =
      isRuntimeInterventionStatus(data.session.status) ||
      isRuntimeInterventionStatus(data.latest_run?.status);
    const primarySendLabel = reviseTarget
      ? "Send revision note"
      : runtimeCaptureMode
        ? "Record intervention"
        : "Send message";
    const composerTarget = reviseTarget
      ? `Revise target: v${reviseTarget.revision} / ${reviseTarget.option}`
      : runtimeCaptureMode
        ? "The run is already in flight. New notes here are stored as explicit runtime intervention records, not hidden plan changes."
      : latestPlanningMessage
        ? "Stay in mission coordination. Your next note can tighten the brief, revise the active route, or push the orchestrator toward confirmation."
        : latestDraftMessage
          ? "The current draft is live in the workspace. Add context here or promote it into full route options."
          : "Use this coordination rail to shape the mission. The orchestrator will keep the evolving brief and route in the workspace above.";

    return (
      <View
        style={[
          mode === "dock" ? styles.composerDock : styles.floatingComposer,
          toolsOpen
            ? mode === "dock"
              ? styles.composerDockExpanded
              : styles.floatingComposerExpanded
            : null,
        ]}
      >
        <View style={styles.composerHeader}>
          <View style={styles.overviewCopy}>
            <Text style={styles.composerTitle}>Talk to orchestrator</Text>
            <Text style={styles.composerTarget}>{composerTarget}</Text>
          </View>
          <View style={styles.composerHeaderActions}>
            {!isDock ? (
              <Pressable onPress={() => setShowComposerTools((current) => !current)}>
                <Text style={styles.linkText}>{toolsOpen ? "Hide tools" : "Open tools"}</Text>
              </Pressable>
            ) : null}
            {reviseTarget ? (
              <Pressable
                onPress={() => {
                  setReviseTarget(null);
                  if (!isDock) {
                    setShowComposerTools(false);
                  }
                }}
              >
                <Text style={styles.linkText}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {showDirectiveRail ? (
          <>
            <View style={styles.composerHeader}>
              <Text style={styles.composerHintText}>Suggested orchestration instructions</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.directiveRail}
            >
              {directiveChips.map((chip) => (
                <Pressable
                  key={chip.key}
                  style={[
                    styles.directiveChip,
                    chip.recommended ? styles.directiveChipRecommended : null,
                  ]}
                  onPress={() => handleApplyDirective(chip.instruction)}
                >
                  <Text
                    style={[
                      styles.directiveChipText,
                      chip.recommended ? styles.directiveChipTextRecommended : null,
                    ]}
                  >
                    {chip.label}
                    {chip.recommended ? " Recommended" : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}
        <View style={styles.expandedComposerInputBlock}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={
              runtimeCaptureMode
                ? "Add intervention intent, next-pass guidance, or the decision you want recorded..."
                : "Add mission detail, constraints, or the next instruction..."
            }
            multiline
            textAlignVertical="top"
            style={[
              styles.input,
              !toolsOpen && !isDock ? styles.inputCompact : null,
            ]}
          />
        </View>
        <View style={styles.composerPrimaryActions}>
          <PrimaryButton
            label={primarySendLabel}
            loading={sending}
            disabled={!draft.trim()}
            onPress={() => void handleSend()}
          />
          {!isDock ? (
            <PrimaryButton
              label={toolsOpen ? "Tools open" : "Orchestrate"}
              tone="muted"
              onPress={() => setShowComposerTools((current) => !current)}
            />
          ) : null}
          <PrimaryButton
            label="Latest"
            tone="muted"
            onPress={() => {
              setActiveWorkspaceStage("thread");
              scrollViewRef.current?.scrollToEnd({ animated: true });
            }}
          />
        </View>
        {toolsOpen ? (
          <View style={styles.composerActions}>
            <PrimaryButton
              label="Draft DAG"
              tone="muted"
              loading={draftingDag}
              onPress={() => void handleDraftDag()}
            />
            <PrimaryButton
              label={
                routeRefreshNeeded
                  ? "Refresh route"
                  : latestDraftMessage
                    ? "Create route from draft"
                    : "Create route"
              }
              tone="muted"
              loading={planning}
              onPress={() =>
                routeRefreshNeeded
                  ? void handleRefreshRoute()
                  : latestDraftMessage
                    ? void handleUseDraftToPlan(latestDraftMessage.message_id)
                    : void handlePlan()
              }
            />
            <PrimaryButton
              label={reviseTarget ? "Revise selected route" : "Revise route"}
              tone="muted"
              loading={revising}
              disabled={!draft.trim() || !latestPlanningMessage}
              onPress={() => void handleRevisePlan()}
            />
          </View>
        ) : null}
      </View>
    );
  }

  function renderProcessRail(canvasStage: WorkspaceStage) {
    const processStages = workspaceStages.filter((stage) => stage.key !== "thread");
    return (
      <View style={styles.processRail}>
        <View style={styles.processHeader}>
          <Text style={styles.eyebrowLabel}>Mission</Text>
          <Text style={styles.processTitle}>Orchestrator map</Text>
          <Text style={styles.processDetail}>
            The center workspace stays live. Use this rail to pivot which mission surface it is emphasizing.
          </Text>
        </View>
        <View style={styles.processStageList}>
          {processStages.map((stage, index) => {
            const selected = stage.key === canvasStage.key;
            return (
              <Pressable
                key={stage.key}
                onPress={() => setActiveWorkspaceStage(stage.key)}
                style={[
                  styles.processStageButton,
                  selected ? styles.processStageButtonSelected : null,
                ]}
              >
                <View
                  style={[
                    styles.processIndex,
                    selected ? styles.processIndexSelected : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.processIndexText,
                      selected ? styles.processIndexTextSelected : null,
                    ]}
                  >
                    {index + 1}
                  </Text>
                </View>
                <View style={styles.processStageCopy}>
                  <View style={styles.processStageHeader}>
                    <Text
                      style={[
                        styles.processStageLabel,
                        selected ? styles.processStageLabelSelected : null,
                      ]}
                    >
                      {stage.label}
                    </Text>
                    <Text style={styles.processStageMetric}>{stage.metric}</Text>
                  </View>
                  <Text style={styles.processStageTitle} numberOfLines={2}>
                    {stage.title}
                  </Text>
                  <Text style={styles.processStageDetail} numberOfLines={2}>
                    {stage.detail}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.auditSummaryPanel}>
          <Text style={styles.auditSummaryTitle}>Mission record</Text>
          <Text style={styles.auditSummaryText}>
            {conversationMessages.length} coordination update{conversationMessages.length === 1 ? "" : "s"} and {evidenceMessages.length} mission signal{evidenceMessages.length === 1 ? "" : "s"}.
          </Text>
          <Pressable onPress={() => setShowThreadEvidence((current) => !current)}>
            <Text style={styles.linkText}>
              {showThreadEvidence ? "Hide signals" : "Open signals"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderWorkspaceCanvas(canvasStage: WorkspaceStage) {
    return (
      <View style={styles.workspaceCanvas}>
        <View style={styles.canvasHeader}>
          <View style={styles.overviewCopy}>
            <Text style={styles.eyebrowLabel}>Workspace</Text>
            <Text style={styles.canvasTitle}>Live mission workspace</Text>
            <Text style={styles.canvasDetail}>
              The center surface holds the current mission output, while snapshots and evidence stay nearby instead of taking over the main canvas.
            </Text>
          </View>
          <Badge label={canvasStage.metric} tone={canvasStage.tone} />
        </View>
        <ScrollView
          style={styles.canvasScroll}
          contentContainerStyle={styles.canvasContent}
          showsVerticalScrollIndicator
        >
          <View style={styles.workspaceHeroCard}>
            <View style={styles.workspaceHeroCopy}>
              <Text style={styles.workspaceHeroEyebrow}>{canvasStage.label}</Text>
              <Text style={styles.workspaceHeroTitle}>{canvasStage.title}</Text>
              <Text style={styles.workspaceHeroDetail}>{canvasStage.detail}</Text>
            </View>
            <View style={styles.workspaceHeroMetrics}>
              <Badge label={threadOverview?.stageLabel || "Conversation"} tone={threadOverview?.stageTone || "neutral"} />
              <Badge label={canvasStage.metric} tone={canvasStage.tone} />
            </View>
          </View>
          {renderWorkspaceSections()}
          <View style={styles.workspaceCanvasMain}>
            <View style={styles.workspacePrimarySurface}>{renderActiveStage(canvasStage.key)}</View>
          </View>
        </ScrollView>
      </View>
    );
  }

  function renderWorkspaceSections() {
    if (activeWorkspaceSections.length === 0) {
      return null;
    }

    return (
      <View style={styles.workspaceSectionStack}>
        {activeWorkspaceSections.map((section) => (
          <View
            key={section.key}
            style={[
              styles.workspaceSectionCard,
              section.layout === "split" ? styles.workspaceSectionCardSplit : null,
            ]}
          >
            <View style={styles.workspaceSectionHeader}>
              <View style={styles.overviewCopy}>
                <Text style={styles.workspaceSectionEyebrow}>{section.eyebrow}</Text>
                <Text style={styles.workspaceSectionTitle}>{section.title}</Text>
                <Text style={styles.workspaceSectionDetail}>{section.detail}</Text>
              </View>
              <Badge label={section.eyebrow} tone={section.tone} />
            </View>
            <View
              style={[
                styles.workspaceSectionBody,
                section.layout === "split" ? styles.workspaceSectionBodySplit : null,
              ]}
            >
              {section.body}
            </View>
          </View>
        ))}
      </View>
    );
  }

  function renderConversationRail() {
    return (
      <View style={styles.conversationRail}>
        <View style={styles.conversationRailHeader}>
          <View style={styles.overviewCopy}>
            <Text style={styles.eyebrowLabel}>Coordination</Text>
            <Text style={styles.conversationRailTitle}>Mission coordination</Text>
            <Text style={styles.timelineDetail}>
              Every user note and orchestrator reply lands here, while the workspace keeps the evolving route, mission signals, and runtime state in view.
            </Text>
          </View>
          <Badge
            label={`${conversationMessages.length} update${conversationMessages.length === 1 ? "" : "s"}`}
            tone="neutral"
          />
        </View>
        <View style={styles.conversationBridgeCard}>
          <Text style={styles.conversationBridgeLabel}>Current mission read</Text>
          <Text style={styles.conversationBridgeTitle}>{workspaceBridge.focusTitle}</Text>
          <Text style={styles.conversationBridgeText}>{workspaceBridge.orchestratorRead}</Text>
        </View>
        <ScrollView
          style={styles.conversationRailScroll}
          contentContainerStyle={styles.conversationRailContent}
          showsVerticalScrollIndicator
        >
          {conversationMessages.length === 0 ? (
            <EmptyState
              title="No coordination yet"
              description="Send the mission details and orchestrator replies will appear here."
            />
          ) : (
            conversationMessages.map((message) => renderConversationMessage(message))
          )}
        </ScrollView>
      </View>
    );
  }

  function renderWideWorkspaceLayout() {
    if (!data) {
      return null;
    }

    const canvasStage =
      activeStage.key === "thread"
        ? workspaceStages.find((stage) => stage.key === "briefing") || workspaceStages[0]
        : activeStage;

    return (
      <View style={styles.wideRoot}>
        <View style={styles.wideTopBar}>
          <View style={styles.overviewCopy}>
            <Text style={styles.eyebrowLabel}>Mission</Text>
            <View style={styles.wideTitleRow}>
              <Text style={styles.wideTitle}>{missionDisplayTitle}</Text>
              <Badge label={missionStatusLabel} tone={missionStatusTone} />
              {missionRouteLabel ? (
                <Badge
                  label={missionRouteLabel}
                  tone={missionSpec?.route.stale ? "warn" : "neutral"}
                />
              ) : null}
              {confirmedProposalId ? (
                <Badge label={`Proposal ${formatShortId(confirmedProposalId)}`} tone="success" />
              ) : null}
            </View>
            <Text style={styles.wideSubtitle} numberOfLines={1}>
              {missionDisplaySummary}
            </Text>
          </View>
          <View style={styles.wideTopActions}>
                  {threadOverview?.latestRunId ? (
                    <Link href={`/runs/${threadOverview.latestRunId}` as never} asChild>
                      <Pressable>
                        <Text style={styles.linkText}>Open live run</Text>
                      </Pressable>
                    </Link>
                  ) : null}
            <Text style={styles.meta}>Updated {formatTime(data.mission.updated_at)}</Text>
          </View>
        </View>
        <View style={styles.wideBody}>
          <View style={styles.wideWorkspaceColumn}>
            <View style={styles.wideWorkspaceGrid}>
              {renderProcessRail(canvasStage)}
              {renderWorkspaceCanvas(canvasStage)}
            </View>
            {renderComposer("dock")}
          </View>
          {renderConversationRail()}
        </View>
      </View>
    );
  }

  if (!error && !loading && data && isWideWorkspace) {
    return (
      <Screen>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
          style={styles.workspaceShell}
        >
          {renderWideWorkspaceLayout()}
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
        style={styles.workspaceShell}
      >
        <ScrollView
          ref={scrollViewRef}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          contentContainerStyle={styles.content}
        >
          <Section
            action={
              data?.mission.latest_run_id ? (
                <Link href={`/runs/${data.mission.latest_run_id}` as never} asChild>
                  <Pressable>
                    <Text style={styles.linkText}>Open live run</Text>
                  </Pressable>
                </Link>
              ) : undefined
            }
          >
            {error ? (
              <Panel>
                <Text style={styles.errorText}>{error}</Text>
                <PrimaryButton label="Retry" onPress={() => void load()} />
              </Panel>
            ) : loading ? (
              <Panel>
                <Text style={styles.loadingText}>Loading mission...</Text>
              </Panel>
            ) : !data ? (
              <EmptyState title="Mission not found" description="The selected mission does not exist." />
            ) : (
              <>
              <Panel style={styles.compactOverviewPanel}>
                <View style={styles.overviewHeader}>
                  <View style={styles.overviewCopy}>
                    <Text style={styles.eyebrowLabel}>Current mission</Text>
                    <View style={styles.header}>
                      <Text style={styles.title}>{missionDisplayTitle}</Text>
                      <Badge label={missionStatusLabel} tone={missionStatusTone} />
                    </View>
                    <Text style={styles.overviewTitle}>
                      {missionDisplaySummary}
                    </Text>
                    <Text style={styles.overviewDetail} numberOfLines={2}>
                      {missionDisplayDetail}
                    </Text>
                  </View>
                  {threadOverview?.latestRunId ? (
                    <Link href={`/runs/${threadOverview.latestRunId}` as never} asChild>
                      <Pressable>
                        <Text style={styles.linkText}>Open live run</Text>
                      </Pressable>
                    </Link>
                  ) : null}
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>Updated {formatTime(data.mission.updated_at)}</Text>
                  <Text style={styles.meta}>
                    Next: {missionSnapshot?.nextActionLabel || missionView?.nextActionLabel || threadOverview?.nextStepLabel || "Move the mission forward"}
                  </Text>
                </View>
                <View style={styles.signalRow}>
                  {missionRouteLabel ? (
                    <View style={styles.signalChip}>
                      <Text style={styles.signalLabel}>Route</Text>
                      <Text
                        style={[
                          styles.signalValue,
                          missionSpec?.route.stale ? styles.signalWarn : null,
                        ]}
                      >
                        {missionRouteLabel}
                      </Text>
                    </View>
                  ) : null}
                  {typeof confirmedRevision === "number" ? (
                    <View style={styles.signalChip}>
                      <Text style={styles.signalLabel}>Confirmed</Text>
                      <Text style={styles.signalValue}>
                        v{confirmedRevision} / {confirmedOption || "primary"}
                      </Text>
                    </View>
                  ) : null}
                  {confirmedProposalId ? (
                    <View style={styles.signalChip}>
                      <Text style={styles.signalLabel}>Proposal</Text>
                      <Text style={styles.signalValue}>{formatShortId(confirmedProposalId)}</Text>
                    </View>
                  ) : null}
                  {threadOverview?.latestSubtask ? (
                    <View style={styles.signalChip}>
                      <Text style={styles.signalLabel}>Active node</Text>
                      <Text style={styles.signalValue}>
                        {threadOverview.latestSubtask.nodeName}
                        {typeof threadOverview.latestSubtask.progressPercent === "number"
                          ? ` ${threadOverview.latestSubtask.progressPercent}%`
                          : ""}
                      </Text>
                    </View>
                  ) : null}
                  {missionWorkLabel ? (
                    <View style={styles.signalChip}>
                      <Text style={styles.signalLabel}>Work</Text>
                      <Text style={styles.signalValue}>{missionWorkLabel}</Text>
                    </View>
                  ) : null}
                  {missionCheckpointLabel ? (
                    <View style={styles.signalChip}>
                      <Text style={styles.signalLabel}>Checkpoints</Text>
                      <Text style={styles.signalValue}>{missionCheckpointLabel}</Text>
                    </View>
                  ) : null}
                  {typeof confirmedRevision === "number" ? (
                    <View style={styles.signalChip}>
                      <Text style={styles.signalLabel}>Launch readiness</Text>
                      <Text
                        style={[
                          styles.signalValue,
                          confirmedValidationSummary.tone === "danger"
                            ? styles.signalDanger
                            : confirmedValidationSummary.tone === "warn"
                              ? styles.signalWarn
                              : confirmedValidationSummary.tone === "success"
                                ? styles.signalSuccess
                                : null,
                        ]}
                      >
                        {confirmedValidationSummary.label}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Panel>

              <View style={styles.workspaceBlock}>
                <View style={styles.workspaceIntro}>
                  <View style={styles.overviewCopy}>
                    <Text style={styles.eyebrowLabel}>Mission workspace</Text>
                    <Text style={styles.workspaceTitle}>{activeStage.title}</Text>
                    <Text style={styles.workspaceDetail}>{activeStage.detail}</Text>
                  </View>
                  <Badge label={activeStage.metric} tone={activeStage.tone} />
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.stageStrip}
                >
                  {workspaceStages.map((stage) => {
                    const selected = stage.key === activeWorkspaceStage;
                    return (
                      <Pressable
                        key={stage.key}
                        onPress={() => setActiveWorkspaceStage(stage.key)}
                        style={[
                          styles.stageCard,
                          { width: stageCardWidth },
                          selected ? styles.stageCardSelected : null,
                          stage.tone === "danger"
                            ? styles.stageCardDanger
                            : stage.tone === "warn"
                              ? styles.stageCardWarn
                              : stage.tone === "success"
                                ? styles.stageCardSuccess
                                : null,
                        ]}
                      >
                        <View style={styles.stageCardHeader}>
                          <Text
                            style={[
                              styles.stageCardLabel,
                              selected ? styles.stageCardLabelSelected : null,
                            ]}
                          >
                            {stage.label}
                          </Text>
                          <Text style={styles.stageCardMetric}>{stage.metric}</Text>
                        </View>
                        <Text
                          style={[
                            styles.stageCardTitle,
                            selected ? styles.stageCardTitleSelected : null,
                          ]}
                          numberOfLines={2}
                        >
                          {stage.title}
                        </Text>
                        <Text style={styles.stageCardDetail} numberOfLines={2}>
                          {stage.detail}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <View
                  onLayout={(event) => setStageDetailTopY(event.nativeEvent.layout.y)}
                >
                  <Panel style={styles.stageDetailPanel}>
                    <View style={styles.stageDetailHeader}>
                      <View style={styles.overviewCopy}>
                        <Text style={styles.sectionLabel}>
                          {activeStage.key === "thread" ? "Mission conversation" : "Current workspace surface"}
                        </Text>
                        <Text style={styles.timelineDetail}>{activeStage.detail}</Text>
                      </View>
                    </View>
                    {renderActiveStage()}
                  </Panel>
                </View>

                {renderWorkspaceSections()}

                {activeStage.key !== "thread" ? (
                  <Panel style={styles.conversationPeekPanel}>
                    <View style={styles.timelineHeader}>
                      <View style={styles.overviewCopy}>
                        <Text style={styles.sectionLabel}>Latest coordination updates</Text>
                        <Text style={styles.timelineDetail}>
                          Keep the freshest user and orchestrator updates nearby without collapsing the central workspace into a chat transcript.
                        </Text>
                      </View>
                      <Pressable onPress={() => setActiveWorkspaceStage("thread")}>
                        <Text style={styles.linkText}>Open history</Text>
                      </Pressable>
                    </View>
                    <View style={styles.messages}>
                      {compactConversationMessages.length === 0 ? (
                        <EmptyState
                          title="No conversation yet"
                          description="Use the composer below to add mission context."
                        />
                      ) : (
                        compactConversationMessages.map((message) =>
                          renderConversationMessage(message, true),
                        )
                      )}
                    </View>
                  </Panel>
                ) : null}
              </View>

              </>
            )}
          </Section>
        </ScrollView>
        {renderComposer()}
      </KeyboardAvoidingView>
    </Screen>
  );
}

function MessageBody(props: {
  message: SessionMessageRecord;
  busyId: string | null;
  confirmingKey: string | null;
  runningKey: string | null;
  confirmedPlanRevision: number | null;
  confirmedPlanOption: PlanOptionKey | null;
  activeReviseTarget: ReviseTarget | null;
  routeRefreshNeeded: boolean;
  inputDrafts: Record<string, Record<string, SchemaValue>>;
  onUseDraft: (messageId: string) => void;
  onDiscardDraft: (messageId: string) => void;
  onApproval: (approvalId: string, kind: "approve" | "reject") => void;
  onPatchAction: (patchId: string, action: "confirm" | "reject") => void;
  onHumanInput: (requestId: string, schema: Record<string, unknown>) => void;
  onConfirmPlan: (revision: number, option: PlanOptionKey) => void;
  onRunPlan: (revision: number, option: PlanOptionKey) => void;
  onSelectReviseTarget: (target: ReviseTarget) => void;
  onDraftChange: (requestId: string, key: string, value: SchemaValue) => void;
}) {
  const { message } = props;

  if (message.kind === "text" || message.kind === "system") {
    const text =
      message.kind === "text"
        ? getConversationMessageText(message) || ""
        : typeof message.content.text === "string"
          ? message.content.text
          : "";
    return <Text style={styles.messageText}>{text || "Empty message"}</Text>;
  }

  if (message.kind === "draft_card") {
    const draftTemplate = isObject(message.content.draft_template)
      ? message.content.draft_template
      : null;
    const plannerContext = isObject(message.content.planner_context)
      ? message.content.planner_context
      : null;
    const validation = isObject(message.content.validation)
      ? message.content.validation
      : null;
    const warnings = Array.isArray(validation?.warnings)
      ? validation.warnings.filter((item): item is string => typeof item === "string")
      : [];
    const registryRecommendations = Array.isArray(message.content.registry_recommendations)
      ? message.content.registry_recommendations
      : [];
    const validationSummary = summarizeValidationState(validation as never);
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>DAG draft</Text>
        <View style={styles.calloutBlock}>
          <Badge label={validationSummary.label} tone={validationSummary.tone} />
          <Text style={styles.calloutText}>{validationSummary.runHint}</Text>
        </View>
        <Text style={styles.messageText}>
          Strategy: {getReadableDraftStrategy(asString(plannerContext?.draft_strategy))}
        </Text>
        {asString(message.content.intent) ? (
          <Text style={styles.messageText}>Intent: {asString(message.content.intent)}</Text>
        ) : null}
        <Text style={styles.messageText}>
          Template: {asString(draftTemplate?.name) || asString(draftTemplate?.template_id) || "Draft"}
        </Text>
        <Text style={styles.messageText}>
          Draft nodes: {Array.isArray(draftTemplate?.nodes) ? draftTemplate.nodes.length : 0}
        </Text>
        <Text style={styles.messageText}>
          Registry recommendations: {registryRecommendations.length}
        </Text>
        <Text style={styles.messageText}>Warnings: {warnings.length}</Text>
        {warnings.slice(0, 3).map((warning) => (
          <Text key={warning} style={styles.warningText}>
            - {warning}
          </Text>
        ))}
        <View style={styles.inlineActions}>
          <PrimaryButton
            label="Use draft to plan"
            loading={props.busyId === message.message_id}
            onPress={() => props.onUseDraft(message.message_id)}
          />
          <PrimaryButton
            label="Discard draft"
            tone="muted"
            onPress={() => props.onDiscardDraft(message.message_id)}
          />
        </View>
      </View>
    );
  }

  if (message.kind === "plan_options_card") {
    const planNarrative = buildPlanOptionsNarrative({
      message,
      confirmedPlanRevision: props.confirmedPlanRevision,
      confirmedPlanOption: props.confirmedPlanOption,
      activeReviseTarget: props.activeReviseTarget,
    });
    if (!planNarrative) {
      return <Text style={styles.messageText}>Unsupported route options</Text>;
    }

    const focusedSummary =
      planNarrative.summaries.find((summary) => summary.optionKey === planNarrative.focusedOption) ||
      planNarrative.summaries[0];
    const alternateSummary =
      planNarrative.summaries.find((summary) => summary.optionKey !== focusedSummary.optionKey) || null;

    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>Route options v{planNarrative.revision}</Text>
        {planNarrative.sourceRevision ? (
          <Text style={styles.diffMeta}>
            Revised from v{planNarrative.sourceRevision} / {planNarrative.sourceOption || "primary"}
          </Text>
        ) : null}
        <View style={styles.planOverviewCard}>
              <Badge
                label={
                  focusedSummary.confirmed
                    ? "Confirmed route"
                    : planNarrative.focusedOption === "primary"
                      ? "Current recommendation"
                      : "Current backup route"
                }
                tone={focusedSummary.validationSummary.tone}
              />
          <Text style={styles.planOverviewTitle}>{planNarrative.focusedTemplateName}</Text>
          <Text style={styles.planOverviewDetail}>{planNarrative.comparisonSummary}</Text>
          <View style={styles.planCompareGrid}>
            {planNarrative.summaries.map((summary) => (
              <View key={summary.optionKey} style={styles.planCompareCard}>
                <View style={styles.planCompareHeader}>
                  <Text style={styles.planCompareTitle}>
                    {summary.optionKey === "primary" ? "Primary" : "Alternative"}
                  </Text>
                  {summary.confirmed ? <Badge label="Confirmed" tone="success" /> : null}
                </View>
                <Text style={styles.planCompareTemplate}>{summary.templateName}</Text>
                <Text style={styles.planCompareMeta}>
                  {`${summary.nodeCount} node(s) - ${summary.readyFrontierCount} ready frontier`}
                </Text>
                <Text
                  style={[
                    styles.planCompareMeta,
                    summary.validationSummary.tone === "danger"
                      ? styles.signalDanger
                      : summary.validationSummary.tone === "warn"
                        ? styles.signalWarn
                        : summary.validationSummary.tone === "success"
                          ? styles.signalSuccess
                          : null,
                  ]}
                >
                  {summary.validationSummary.label}
                </Text>
              </View>
            ))}
          </View>
          {alternateSummary ? (
            <Text style={styles.planOverviewHint}>
              Focused option is expanded below. The alternate route stays visible as a compact comparison.
            </Text>
          ) : null}
        </View>
        <PlanOptionCard
          optionKey={focusedSummary.optionKey}
          revision={planNarrative.revision}
          optionContent={focusedSummary.content}
          confirmingKey={props.confirmingKey}
          runningKey={props.runningKey}
          confirmedPlanRevision={props.confirmedPlanRevision}
          confirmedPlanOption={props.confirmedPlanOption}
          activeReviseTarget={props.activeReviseTarget}
          routeRefreshNeeded={props.routeRefreshNeeded}
          onConfirmPlan={props.onConfirmPlan}
          onRunPlan={props.onRunPlan}
          onSelectReviseTarget={props.onSelectReviseTarget}
        />
        {alternateSummary ? (
          <View style={styles.planCompactCard}>
            <View style={styles.planCompactHeader}>
              <Text style={styles.planCompactTitle}>
                Alternate view: {alternateSummary.templateName}
              </Text>
              <Badge
                label={alternateSummary.validationSummary.label}
                tone={alternateSummary.validationSummary.tone}
              />
            </View>
            <Text style={styles.planCompactText}>
              {alternateSummary.nodeCount} node(s), {alternateSummary.readyFrontierCount} ready frontier,
              {` ${alternateSummary.validationSummary.warningCount} warning(s).`}
            </Text>
            {alternateSummary.recommendationReason ? (
              <Text style={styles.planCompactText}>{alternateSummary.recommendationReason}</Text>
            ) : null}
            <View style={styles.inlineActions}>
              <PrimaryButton
                label={
                  props.routeRefreshNeeded
                    ? "Refresh route first"
                    : alternateSummary.confirmed
                      ? "Confirmed"
                      : "Confirm alternate"
                }
                tone={alternateSummary.confirmed ? "muted" : "muted"}
                disabled={alternateSummary.confirmed || props.routeRefreshNeeded}
                loading={props.confirmingKey === `${planNarrative.revision}:${alternateSummary.optionKey}`}
                onPress={() => props.onConfirmPlan(planNarrative.revision, alternateSummary.optionKey)}
              />
              <PrimaryButton
                label={props.routeRefreshNeeded ? "Run blocked" : "Run alternate"}
                tone="muted"
                disabled={props.routeRefreshNeeded}
                loading={props.runningKey === `${planNarrative.revision}:${alternateSummary.optionKey}`}
                onPress={() => props.onRunPlan(planNarrative.revision, alternateSummary.optionKey)}
              />
              <PrimaryButton
                label="Revise alternate"
                tone="muted"
                onPress={() =>
                  props.onSelectReviseTarget({
                    revision: planNarrative.revision,
                    option: alternateSummary.optionKey,
                  })
                }
              />
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  if (message.kind === "plan_card") {
    const revision = getPlanRevision(message) || 1;
    const templateName =
      asString(message.content.template_name) ||
      asString(message.content.template_id) ||
      "Unknown template";
    const validation = isObject(message.content.validation) ? message.content.validation : null;
    const warnings = Array.isArray(validation?.warnings)
      ? validation.warnings.filter((item): item is string => typeof item === "string")
      : [];
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>Route proposal v{revision}</Text>
        <Text style={styles.messageText}>Template: {templateName}</Text>
        <Text style={styles.messageText}>
          Validation: {warnings.length === 0 ? "passed" : `${warnings.length} warning(s)`}
        </Text>
      </View>
    );
  }

  if (message.kind === "run_card") {
    const runId = typeof message.content.run_id === "string" ? message.content.run_id : "";
    const status = typeof message.content.status === "string" ? message.content.status : "";
    const planRevision = asNumber(message.content.plan_revision);
    const planOption =
      message.content.plan_option === "alternative" ? "alternative" : "primary";
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>Run created</Text>
        <Text style={styles.messageText}>Run id: {runId}</Text>
        <Text style={styles.messageText}>Status: {formatStatus(status)}</Text>
        {planRevision ? (
          <Text style={styles.messageText}>
            Source plan: v{planRevision} / {planOption}
          </Text>
        ) : null}
        {runId ? (
          <Link href={`/runs/${runId}` as never} asChild>
            <Pressable>
              <Text style={styles.linkText}>Open run detail</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    );
  }

  if (message.kind === "summary_card") {
    const runId = typeof message.content.run_id === "string" ? message.content.run_id : "";
    const status = typeof message.content.status === "string" ? message.content.status : "";
    const summary =
      typeof message.content.current_summary === "string"
        ? message.content.current_summary
        : "Run update";
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>Run update</Text>
        <Text style={styles.messageText}>{summary}</Text>
        <Text style={styles.messageText}>Status: {formatStatus(status)}</Text>
        {runId ? (
          <Link href={`/runs/${runId}` as never} asChild>
            <Pressable>
              <Text style={styles.linkText}>Open run detail</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    );
  }

  if (message.kind === "subtask_card") {
    const nodeName =
      typeof message.content.node_name === "string" ? message.content.node_name : "Subtask";
    const status = typeof message.content.status === "string" ? message.content.status : "";
    const progress = isObject(message.content.progress) ? message.content.progress : null;
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>{nodeName}</Text>
        <Text style={styles.messageText}>Status: {formatStatus(status)}</Text>
        <Text style={styles.messageText}>
          Progress: {typeof progress?.percent === "number" ? progress.percent : 0}%
        </Text>
        {typeof progress?.message === "string" && progress.message ? (
          <Text style={styles.messageText}>{progress.message}</Text>
        ) : null}
      </View>
    );
  }

  if (message.kind === "approval_card") {
    const approvalId =
      typeof message.content.approval_id === "string" ? message.content.approval_id : "";
    const summary =
      typeof message.content.summary === "string" ? message.content.summary : "Approval needed";
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>Approval required</Text>
        <Text style={styles.messageText}>{summary}</Text>
        <View style={styles.inlineActions}>
          <PrimaryButton
            label="Approve"
            loading={props.busyId === approvalId}
            onPress={() => props.onApproval(approvalId, "approve")}
          />
          <PrimaryButton
            label="Reject"
            tone="danger"
            loading={props.busyId === approvalId}
            onPress={() => props.onApproval(approvalId, "reject")}
          />
        </View>
      </View>
    );
  }

  if (message.kind === "human_input_card") {
    const requestId =
      typeof message.content.input_request_id === "string" ? message.content.input_request_id : "";
    const summary =
      typeof message.content.summary === "string" ? message.content.summary : "Input needed";
    const inputSchema =
      (message.content.input_schema as Record<string, unknown> | undefined) || {
        properties: {},
        required: [],
      };
    const currentDraft = props.inputDrafts[requestId] || {};
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>Human input required</Text>
        <Text style={styles.messageText}>{summary}</Text>
        <SchemaForm
          schema={inputSchema}
          value={currentDraft}
          onChange={(key, value) => props.onDraftChange(requestId, key, value)}
        />
        <PrimaryButton
          label="Submit input"
          loading={props.busyId === requestId}
          onPress={() => props.onHumanInput(requestId, inputSchema)}
        />
      </View>
    );
  }

  if (message.kind === "intervention_card") {
    const kind = asString(message.content.kind) || "guidance";
    const status = asString(message.content.status) || "recorded";
    const summary =
      asString(message.content.summary) ||
      asString(message.content.content) ||
      "Runtime intervention recorded.";
    const intent = asString(message.content.interpreted_intent);
    const patchPreview = isObject(message.content.patch_preview)
      ? message.content.patch_preview
      : null;
    const patchReason = asString(patchPreview?.reason);
    const runId = asString(message.content.run_id);
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>Runtime intervention</Text>
        <View style={styles.optionTopline}>
          <Badge
            label={status === "needs_review" ? "Needs review" : "Queued"}
            tone={status === "needs_review" ? "warn" : "neutral"}
          />
          <Text style={styles.optionSummaryText}>{kind.replace(/_/g, " ")}</Text>
        </View>
        <Text style={styles.messageText}>{summary}</Text>
        {intent ? <Text style={styles.messageText}>{intent}</Text> : null}
        {runId ? <Text style={styles.messageText}>Target run: {runId}</Text> : null}
        {patchReason ? (
          <View style={styles.calloutBlock}>
            <Badge
              label={patchPreview?.supported === true ? "Patchable" : "Captured"}
              tone={patchPreview?.supported === true ? "success" : "warn"}
            />
            <Text style={styles.calloutText}>{patchReason}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (message.kind === "dag_patch_card") {
    const status = asString(message.content.status) || "proposed";
    const patchId = asString(message.content.patch_id);
    const summary =
      asString(message.content.summary) ||
      "A structured DAG patch proposal was generated from the runtime intervention.";
    const reason = asString(message.content.reason);
    const unsupportedReason = asString(message.content.unsupported_reason);
    const operations = Array.isArray(message.content.operations)
      ? message.content.operations.filter(isObject)
      : [];
    const outcomes = getPatchOperationOutcomes(message.content);
    const topology = getPatchTopology(message.content);
    const graphPreview = getPatchGraphPreview(message.content);
    const graphPreviewLines = Array.isArray(graphPreview?.summary_lines)
      ? graphPreview.summary_lines.filter((line): line is string => typeof line === "string" && !!line.trim())
      : [];
    const predictedTopology = isObject(graphPreview?.predicted_topology)
      ? graphPreview.predicted_topology
      : null;
    const actualTopology = isObject(graphPreview?.actual_topology)
      ? graphPreview.actual_topology
      : null;
    const readyCount = asNumber(topology?.ready_node_run_ids && Array.isArray(topology.ready_node_run_ids)
      ? topology.ready_node_run_ids.length
      : null);
    const runningCount = asNumber(
      topology?.running_node_run_ids && Array.isArray(topology.running_node_run_ids)
        ? topology.running_node_run_ids.length
        : null,
    );
    const applySupported = message.content.apply_supported === true;
    const requiresConfirmation = message.content.requires_confirmation === true;
    const canAct = !!patchId && applySupported && status === "needs_confirmation";
    const isBusy = !!patchId && props.busyId === patchId;
    const patchStateLabel =
      status === "applied"
        ? "Applied"
        : status === "applied_with_errors"
          ? "Partial"
          : status === "rejected"
            ? "Rejected"
            : applySupported
              ? "Apply ready"
              : "Apply disabled";
    const patchStateTone =
      status === "applied"
        ? "success"
        : status === "applied_with_errors"
          ? "warn"
          : status === "rejected"
            ? "neutral"
            : "warn";
    const patchStateText =
      status === "applied"
        ? "This patch has been applied and its operation outcomes are recorded in the mission workspace."
        : status === "applied_with_errors"
          ? "This patch was partially applied. Review the failed operation outcomes."
          : status === "rejected"
            ? "This patch was rejected and kept for audit."
            : applySupported
              ? "This patch can be applied after confirmation."
              : unsupportedReason || "This proposal is kept for audit, but it is not live-apply ready yet.";
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>DAG patch proposal</Text>
        <View style={styles.optionTopline}>
          <Badge
            label={
              status === "needs_confirmation"
                ? "Needs confirmation"
                : status === "unsupported"
                  ? "Not applyable yet"
                  : status.replace(/_/g, " ")
            }
            tone={status === "unsupported" ? "neutral" : "warn"}
          />
          <Text style={styles.optionSummaryText}>
            {requiresConfirmation ? "Human review required" : "Audit record"}
          </Text>
        </View>
        <Text style={styles.messageText}>{summary}</Text>
        {reason ? <Text style={styles.messageText}>{reason}</Text> : null}
        {graphPreviewLines.length > 0 ? (
          <View style={styles.calloutBlock}>
            <Badge label="Graph preview" tone={status === "needs_confirmation" ? "warn" : "success"} />
            {graphPreviewLines.slice(0, 4).map((line, index) => (
              <Text key={`graph-preview-${index}`} style={styles.calloutText}>
                {line}
              </Text>
            ))}
            {predictedTopology ? (
              <Text style={styles.calloutText}>
                Predicted: {asNumber(predictedTopology.node_count) ?? "-"} nodes /{" "}
                {asNumber(predictedTopology.edge_count) ?? "-"} edges
              </Text>
            ) : null}
            {actualTopology ? (
              <Text style={styles.calloutText}>
                Actual: {asNumber(actualTopology.node_count) ?? "-"} nodes /{" "}
                {asNumber(actualTopology.edge_count) ?? "-"} edges
              </Text>
            ) : null}
          </View>
        ) : null}
        {operations.length > 0 ? (
          <View style={styles.patchOperationStack}>
            {operations.map((operation, index) => {
              const op = asString(operation.op) || "operation";
              const nodeName = asString(operation.node_name);
              const operationReason = asString(operation.reason);
              return (
                <View key={`${op}-${index}`} style={styles.patchOperationCard}>
                  <View style={styles.optionTopline}>
                    <Badge label={op.replace(/_/g, " ")} tone="warn" />
                    <Text style={styles.optionSummaryText}>
                      {operation.supported === false ? "Needs mapping" : "Mapped"}
                    </Text>
                  </View>
                  {nodeName ? <Text style={styles.messageText}>Target: {nodeName}</Text> : null}
                  {operationReason ? (
                    <Text style={styles.messageText}>{operationReason}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
        {outcomes.length > 0 ? (
          <View style={styles.patchOperationStack}>
            {outcomes.map((outcome, index) => {
              const op = asString(outcome.op) || "operation";
              const nodeName = asString(outcome.node_name);
              const error = asString(outcome.error);
              const applied = outcome.applied === true;
              return (
                <View key={`outcome-${op}-${index}`} style={styles.patchOutcomeCard}>
                  <View style={styles.optionTopline}>
                    <Badge
                      label={applied ? "Applied" : "Failed"}
                      tone={applied ? "success" : "danger"}
                    />
                    <Text style={styles.optionSummaryText}>{op.replace(/_/g, " ")}</Text>
                  </View>
                  {nodeName ? <Text style={styles.messageText}>Result node: {nodeName}</Text> : null}
                  {error ? <Text style={styles.messageText}>Error: {error}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}
        {topology ? (
          <View style={styles.calloutBlock}>
            <Badge label="Topology" tone={status === "applied_with_errors" ? "warn" : "success"} />
            <Text style={styles.calloutText}>
              {`Nodes ${asNumber(topology.node_count) ?? "-"} / Edges ${
                asNumber(topology.edge_count) ?? "-"
              }${
                typeof readyCount === "number" || typeof runningCount === "number"
                  ? ` / Ready ${readyCount ?? 0} / Running ${runningCount ?? 0}`
                  : ""
              }`}
            </Text>
          </View>
        ) : null}
        <View style={styles.calloutBlock}>
          <Badge label={patchStateLabel} tone={patchStateTone} />
          <Text style={styles.calloutText}>{patchStateText}</Text>
        </View>
        {canAct && patchId ? (
          <View style={styles.inlineActions}>
            <PrimaryButton
              label="Confirm patch"
              loading={isBusy}
              onPress={() => props.onPatchAction(patchId, "confirm")}
            />
            <PrimaryButton
              label="Reject"
              tone="danger"
              loading={isBusy}
              onPress={() => props.onPatchAction(patchId, "reject")}
            />
          </View>
        ) : null}
      </View>
    );
  }

  if (message.kind === "artifact_card") {
    const name = typeof message.content.name === "string" ? message.content.name : "Artifact";
    const storageUri =
      typeof message.content.storage_uri === "string" ? message.content.storage_uri : "";
    return (
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>Artifact created</Text>
        <Text style={styles.messageText}>{name}</Text>
        {storageUri ? <Text style={styles.messageText}>{storageUri}</Text> : null}
      </View>
    );
  }

  return <Text style={styles.messageText}>Unsupported message</Text>;
}

function PlanOptionCard(props: {
  optionKey: PlanOptionKey;
  revision: number;
  optionContent: Record<string, unknown>;
  confirmingKey: string | null;
  runningKey: string | null;
  confirmedPlanRevision: number | null;
  confirmedPlanOption: PlanOptionKey | null;
  activeReviseTarget: ReviseTarget | null;
  routeRefreshNeeded: boolean;
  onConfirmPlan: (revision: number, option: PlanOptionKey) => void;
  onRunPlan: (revision: number, option: PlanOptionKey) => void;
  onSelectReviseTarget: (target: ReviseTarget) => void;
}) {
  const { optionKey, revision, optionContent } = props;
  const templateName =
    asString(optionContent.template_name) ||
    asString(optionContent.template_id) ||
    `${optionKey} option`;
  const recommendationReason = getPlanReason(optionContent);
  const candidatePlan = isObject(optionContent.candidate_plan)
    ? optionContent.candidate_plan
    : null;
  const validation = isObject(optionContent.validation)
    ? optionContent.validation
    : null;
  const checklist = isObject(optionContent.confirmation_checklist)
    ? optionContent.confirmation_checklist
    : null;
  const warnings = groupValidation(validation as never);
  const validationSummary = summarizeValidationState(validation as never);
  const confirmed =
    props.confirmedPlanRevision === revision && props.confirmedPlanOption === optionKey;
  const selectedRevise =
    props.activeReviseTarget?.revision === revision &&
    props.activeReviseTarget.option === optionKey;
  const actionKey = `${revision}:${optionKey}`;

  return (
    <View style={styles.optionCard}>
      <View style={styles.optionHeader}>
        <Text style={styles.optionTitle}>
          {optionKey === "primary" ? "Primary plan" : "Alternative plan"}
        </Text>
        <View style={styles.optionBadges}>
          {confirmed ? <Badge label="Confirmed" tone="success" /> : null}
          {selectedRevise ? <Badge label="Revise target" tone="warn" /> : null}
        </View>
      </View>
      <View style={styles.optionTopline}>
        <Badge label={validationSummary.label} tone={validationSummary.tone} />
        <Text style={styles.optionSummaryText}>
          {validationSummary.warningCount > 0
            ? `${validationSummary.warningCount} warning(s)`
            : "No warnings"}
        </Text>
      </View>
      <Text style={styles.messageText}>Template: {templateName}</Text>
      {recommendationReason ? <Text style={styles.messageText}>{recommendationReason}</Text> : null}
      <Text style={styles.optionHintText}>{validationSummary.runHint}</Text>

      {checklist ? (
        <View style={styles.checklistBlock}>
          <Text style={styles.checklistTitle}>Confirmation checklist</Text>
          <Text style={styles.checklistText}>
            Revision / option: v{asNumber(checklist.revision) || revision} / {optionKey}
          </Text>
          <Text style={styles.checklistText}>
            Nodes: {asNumber(checklist.node_count) || 0}
          </Text>
          <Text style={styles.checklistText}>
            Ready frontier: {asNumber(checklist.ready_frontier_count) || 0}
          </Text>
          <Text style={styles.checklistText}>
            Readiness: {checklist.validation_passed === true ? "clear" : "review needed"}
          </Text>
          <Text style={styles.checklistText}>
            Warnings: {asNumber(checklist.warning_count) || 0}
          </Text>
          <Text style={styles.checklistText}>
            Missing input risk: {checklist.has_required_input_risk === true ? "yes" : "no"}
          </Text>
          <Text style={styles.checklistText}>
            Agent binding risk: {checklist.has_registry_risk === true ? "yes" : "no"}
          </Text>
        </View>
      ) : null}

      <View style={styles.metricRow}>
        <View style={styles.metricChip}>
          <Text style={styles.metricLabel}>Nodes</Text>
          <Text style={styles.metricValue}>
            {Array.isArray(candidatePlan?.compiled_nodes) ? candidatePlan.compiled_nodes.length : 0}
          </Text>
        </View>
        <View style={styles.metricChip}>
          <Text style={styles.metricLabel}>Readiness</Text>
          <Text style={styles.metricValue}>
            {validationSummary.isReadyForStrictRun ? "Launch-ready" : "Needs review"}
          </Text>
        </View>
      </View>

      {warnings.length > 0 ? (
        <View style={styles.warningGroups}>
          {warnings.map((group) => (
            <View key={`${optionKey}-${group.key}`} style={styles.warningGroup}>
              <View style={styles.warningGroupHeader}>
                <Text style={styles.warningGroupTitle}>{group.title}</Text>
                <Badge label={`${group.items.length}`} tone={group.tone} />
              </View>
              {group.items.slice(0, 3).map((item) => (
                <Text key={item} style={styles.warningText}>
                  - {item}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.validationPassedText}>
          Readiness checks passed. This option is ready to launch.
        </Text>
      )}
      {props.routeRefreshNeeded ? (
        <View style={styles.calloutBlock}>
          <Badge label="Refresh required" tone="warn" />
          <Text style={styles.calloutText}>
            The latest brief changed after this route was compiled. Refresh or revise it before confirming or running.
          </Text>
        </View>
      ) : null}

      <View style={styles.inlineActions}>
        <PrimaryButton
          label={
            props.routeRefreshNeeded
              ? "Refresh route first"
              : confirmed
                ? "Confirmed"
                : "Confirm this plan"
          }
          tone={confirmed ? "muted" : undefined}
          disabled={confirmed || props.routeRefreshNeeded}
          loading={props.confirmingKey === actionKey}
          onPress={() => props.onConfirmPlan(revision, optionKey)}
        />
        <PrimaryButton
          label={props.routeRefreshNeeded ? "Run blocked" : "Run this plan"}
          tone="muted"
          disabled={props.routeRefreshNeeded}
          loading={props.runningKey === actionKey}
          onPress={() => props.onRunPlan(revision, optionKey)}
        />
        <PrimaryButton
          label="Revise from this plan"
          tone="muted"
          onPress={() =>
            props.onSelectReviseTarget({
              revision,
              option: optionKey,
            })
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  workspaceShell: {
    flex: 1,
    position: "relative",
  },
  content: {
    gap: 16,
    paddingBottom: 142,
  },
  wideRoot: {
    flex: 1,
    gap: 12,
  },
  wideTopBar: {
    minHeight: 76,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  wideTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  wideTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0f172a",
  },
  wideSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  wideTopActions: {
    alignItems: "flex-end",
    gap: 8,
  },
  wideBody: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    gap: 12,
  },
  wideWorkspaceColumn: {
    flex: 1,
    minWidth: 0,
    gap: 12,
  },
  wideWorkspaceGrid: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    gap: 12,
  },
  processRail: {
    width: 286,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 12,
  },
  processHeader: {
    gap: 6,
  },
  processTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  processDetail: {
    fontSize: 12,
    lineHeight: 17,
    color: "#64748b",
  },
  processStageList: {
    gap: 8,
  },
  processStageButton: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 10,
    gap: 10,
  },
  processStageButtonSelected: {
    borderColor: "#0f766e",
    backgroundColor: "#ecfdf5",
  },
  processIndex: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e2e8f0",
  },
  processIndexSelected: {
    backgroundColor: "#14b8a6",
  },
  processIndexText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#334155",
  },
  processIndexTextSelected: {
    color: "#ffffff",
  },
  processStageCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  processStageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  processStageLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748b",
    textTransform: "uppercase",
  },
  processStageLabelSelected: {
    color: "#0f766e",
  },
  processStageMetric: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
  },
  processStageTitle: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
    color: "#0f172a",
  },
  processStageDetail: {
    fontSize: 12,
    lineHeight: 17,
    color: "#475569",
  },
  auditSummaryPanel: {
    marginTop: "auto",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccfbf1",
    backgroundColor: "#f0fdfa",
    padding: 10,
    gap: 6,
  },
  auditSummaryTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0f766e",
  },
  auditSummaryText: {
    fontSize: 12,
    lineHeight: 17,
    color: "#334155",
  },
  workspaceCanvas: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  canvasHeader: {
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  canvasTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
  },
  canvasDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  canvasScroll: {
    flex: 1,
  },
  canvasContent: {
    padding: 14,
    gap: 12,
  },
  workspaceCanvasMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  workspacePrimarySurface: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 14,
  },
  workspaceArtifactGrid: {
    gap: 10,
  },
  workspaceCheckpointGrid: {
    gap: 10,
  },
  workspaceCheckpointCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 8,
  },
  workspaceArtifactCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 8,
  },
  workspaceArtifactTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  workspaceArtifactTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  workspaceArtifactSummary: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  workspaceArtifactChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  workspaceArtifactChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#eff6ff",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  workspaceArtifactChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  workspaceArtifactDetailList: {
    gap: 4,
  },
  workspaceArtifactDetail: {
    fontSize: 12,
    lineHeight: 17,
    color: "#475569",
  },
  workspaceArtifactActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  workspacePreparedOutputList: {
    gap: 10,
  },
  workspacePreparedOutputCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 6,
  },
  workspacePreparedOutputHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  workspacePreparedOutputTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  workspacePreparedOutputDetail: {
    fontSize: 12,
    lineHeight: 17,
    color: "#475569",
  },
  workspaceEvidenceStack: {
    gap: 8,
  },
  workspaceEvidenceCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 0,
    overflow: "hidden",
  },
  workspaceStack: {
    gap: 12,
  },
  workspaceHeroCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    padding: 14,
    gap: 12,
  },
  workspaceHeroCopy: {
    gap: 6,
  },
  workspaceHeroEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1d4ed8",
    textTransform: "uppercase",
  },
  workspaceHeroTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0f172a",
  },
  workspaceHeroDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  workspaceHeroMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  workspaceSectionStack: {
    gap: 12,
  },
  workspaceSectionCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 14,
    gap: 12,
  },
  workspaceSectionCardSplit: {
    backgroundColor: "#fcfdff",
  },
  workspaceSectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  workspaceSectionEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748b",
    textTransform: "uppercase",
  },
  workspaceSectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0f172a",
  },
  workspaceSectionDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  workspaceSectionBody: {
    gap: 12,
  },
  workspaceSectionBodySplit: {
    gap: 14,
  },
  workspaceSectionAccent: {
    width: 10,
    alignSelf: "stretch",
    borderRadius: 999,
    minHeight: 52,
  },
  workspaceSectionAccentNeutral: {
    backgroundColor: "#cbd5e1",
  },
  workspaceSectionAccentWarn: {
    backgroundColor: "#f59e0b",
  },
  workspaceSectionAccentSuccess: {
    backgroundColor: "#10b981",
  },
  workspaceSectionAccentDanger: {
    backgroundColor: "#ef4444",
  },
  workspaceSignalGrid: {
    gap: 10,
  },
  workspaceSignalCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 10,
    gap: 4,
  },
  workspaceSignalLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  workspaceSignalText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  workspaceSignalMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: "#64748b",
  },
  workspaceTimeline: {
    gap: 10,
  },
  workspaceTimelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  workspaceTimelineDot: {
    width: 10,
    marginTop: 16,
    marginLeft: 2,
    borderRadius: 999,
  },
  workspaceTimelineCard: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 10,
    gap: 6,
  },
  workspaceTimelineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  workspaceTimelineTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  workspaceTimelineDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  workspaceTurnInsight: {
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 8,
    gap: 3,
  },
  workspaceTurnLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2563eb",
    textTransform: "uppercase",
  },
  workspaceTurnText: {
    fontSize: 12,
    lineHeight: 17,
    color: "#334155",
  },
  workspaceOutputRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  workspaceOutputChip: {
    borderRadius: 8,
    backgroundColor: "#ecfeff",
    borderWidth: 1,
    borderColor: "#a5f3fc",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  workspaceOutputText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#155e75",
  },
  workspacePackageGrid: {
    gap: 10,
  },
  workspaceInterventionStack: {
    gap: 10,
  },
  workspaceInterventionCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fcd34d",
    backgroundColor: "#fffdf5",
    padding: 12,
  },
  patchOperationStack: {
    gap: 8,
  },
  patchOperationCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    padding: 10,
    gap: 6,
  },
  patchOutcomeCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    padding: 10,
    gap: 6,
  },
  workspacePackageSurface: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 8,
  },
  workspacePackageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  workspacePackageTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  workspacePackageSummary: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  workspacePackageMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: "#334155",
  },
  workspaceDecisionGrid: {
    gap: 10,
  },
  workspaceDecisionCallout: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    padding: 12,
    gap: 4,
  },
  workspaceDecisionCalloutTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#92400e",
  },
  workspaceDecisionCalloutText: {
    fontSize: 12,
    lineHeight: 18,
    color: "#92400e",
  },
  workspaceDecisionCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    padding: 12,
    gap: 6,
  },
  workspaceDecisionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  workspaceDecisionTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  workspaceDecisionTemplate: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
  },
  workspaceDecisionMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: "#475569",
  },
  workspaceDecisionReason: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  routeCompareGroupList: {
    gap: 8,
  },
  routeCompareGroup: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 8,
    gap: 4,
  },
  routeCompareGroupTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    color: "#334155",
  },
  workspaceAuditBlock: {
    gap: 10,
  },
  workspaceAuditSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  workspaceAuditText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#475569",
  },
  conversationRail: {
    width: 360,
    minHeight: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 10,
  },
  conversationRailHeader: {
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  conversationRailTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  conversationRailScroll: {
    flex: 1,
    minHeight: 0,
  },
  conversationRailContent: {
    gap: 10,
    paddingBottom: 6,
  },
  conversationBridgeCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    padding: 10,
    gap: 4,
  },
  conversationBridgeLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1d4ed8",
    textTransform: "uppercase",
  },
  conversationBridgeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  conversationBridgeText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  compactOverviewPanel: {
    gap: 8,
  },
  workspaceBlock: {
    gap: 12,
  },
  workspaceIntro: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  workspaceTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0f172a",
  },
  workspaceDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  stageStrip: {
    gap: 10,
    paddingRight: 4,
  },
  stageCard: {
    minHeight: 126,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 8,
  },
  stageCardSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  stageCardWarn: {
    borderColor: "#fde68a",
  },
  stageCardSuccess: {
    borderColor: "#bbf7d0",
  },
  stageCardDanger: {
    borderColor: "#fecaca",
  },
  stageCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  stageCardLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748b",
    textTransform: "uppercase",
  },
  stageCardLabelSelected: {
    color: "#1d4ed8",
  },
  stageCardMetric: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
  },
  stageCardTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  stageCardTitleSelected: {
    color: "#1e40af",
  },
  stageCardDetail: {
    fontSize: 12,
    lineHeight: 17,
    color: "#475569",
  },
  stageDetailPanel: {
    gap: 12,
  },
  stageDetailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  stageArtifact: {
    gap: 10,
  },
  planFocusBanner: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    padding: 12,
    gap: 8,
  },
  planFocusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  planFocusTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  planFocusText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  planFocusActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  orchestratorReplyBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 4,
  },
  orchestratorReplyLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  orchestratorReplyText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  emptyStage: {
    gap: 12,
  },
  conversationPeekPanel: {
    backgroundColor: "#f8fafc",
  },
  eyebrowLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
  },
  overviewHeader: {
    gap: 10,
  },
  overviewCopy: {
    gap: 8,
  },
  overviewTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  overviewDetail: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  meta: {
    fontSize: 12,
    color: "#64748b",
  },
  linkText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2563eb",
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  timelineHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  timelineDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748b",
  },
  timelineFoldHint: {
    fontSize: 12,
    lineHeight: 18,
    color: "#92400e",
  },
  narrativeList: {
    gap: 10,
  },
  executionStageStack: {
    gap: 12,
  },
  runtimeGraphSurface: {
    gap: 10,
  },
  runtimeGraphSummaryCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c7d2fe",
    backgroundColor: "#f8fbff",
    padding: 12,
    gap: 10,
  },
  runtimeGraphSummaryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  runtimeGraphEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1d4ed8",
    textTransform: "uppercase",
  },
  runtimeGraphTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
  },
  runtimeGraphDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  runtimeGraphPackageList: {
    gap: 8,
  },
  runtimeGraphPackageCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 6,
  },
  runtimeGraphPackageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  runtimeGraphPackageTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    color: "#0f172a",
  },
  runtimeGraphPackageMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: "#475569",
  },
  runtimeGraphNodeList: {
    gap: 8,
  },
  runtimeGraphNodeRow: {
    flexDirection: "row",
    gap: 10,
  },
  runtimeGraphNodeIndex: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  runtimeGraphNodeIndexWarn: {
    borderColor: "#fcd34d",
    backgroundColor: "#fffbeb",
  },
  runtimeGraphNodeIndexSuccess: {
    borderColor: "#bbf7d0",
    backgroundColor: "#f0fdf4",
  },
  runtimeGraphNodeIndexDanger: {
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  runtimeGraphNodeIndexText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#334155",
  },
  runtimeGraphNodeCard: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 6,
  },
  runtimeGraphNodeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  runtimeGraphNodeTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    color: "#0f172a",
  },
  runtimeGraphNodeMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: "#64748b",
  },
  runtimeGraphNodeDetail: {
    fontSize: 12,
    lineHeight: 17,
    color: "#334155",
  },
  runtimeGraphMarkerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  runtimeGraphEdgeList: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 8,
  },
  runtimeGraphEdgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  runtimeGraphEdgeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: "#334155",
  },
  workPackageList: {
    gap: 10,
  },
  workPackageCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 8,
  },
  workPackageHeader: {
    gap: 8,
  },
  workPackageTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  workPackageSummary: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  workPackageMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: "#334155",
  },
  briefingCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    padding: 12,
    gap: 10,
  },
  briefingHeader: {
    gap: 8,
  },
  briefingTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
  },
  briefingSummary: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  briefingList: {
    gap: 10,
  },
  briefingRow: {
    gap: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#dbeafe",
  },
  briefingLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  briefingDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  narrativeRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  narrativeRail: {
    width: 12,
    alignItems: "center",
    paddingTop: 10,
  },
  narrativeDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  narrativeBody: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 6,
  },
  narrativeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  narrativeTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  narrativeDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  latestEvent: {
    minWidth: 88,
    alignItems: "flex-end",
    gap: 2,
  },
  latestEventLabel: {
    fontSize: 11,
    color: "#64748b",
  },
  latestEventValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
    textAlign: "right",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  signalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  signalChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  signalLabel: {
    fontSize: 11,
    color: "#64748b",
  },
  signalValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  signalWarn: {
    color: "#b45309",
  },
  signalDanger: {
    color: "#b91c1c",
  },
  signalSuccess: {
    color: "#166534",
  },
  nextStepBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    padding: 12,
    gap: 4,
  },
  nextStepLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  nextStepDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  messages: {
    gap: 10,
  },
  conversationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  conversationRowUser: {
    justifyContent: "flex-end",
  },
  conversationBubble: {
    width: "92%",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  conversationBubbleCompact: {
    width: "100%",
    padding: 10,
  },
  conversationBubbleUser: {
    backgroundColor: "#e0f2fe",
    borderColor: "#bae6fd",
  },
  conversationBubbleOrchestrator: {
    backgroundColor: "#ffffff",
    borderColor: "#d7dfeb",
  },
  conversationMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  conversationRole: {
    fontSize: 12,
    fontWeight: "800",
    color: "#2563eb",
  },
  conversationRoleUser: {
    color: "#0369a1",
  },
  conversationStatus: {
    fontSize: 11,
    fontWeight: "700",
    color: "#b45309",
  },
  conversationTime: {
    fontSize: 11,
    color: "#94a3b8",
  },
  conversationText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a",
  },
  conversationTurnDetails: {
    marginTop: 10,
    gap: 8,
  },
  conversationInsightBlock: {
    gap: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#d7dfeb",
  },
  conversationInsightLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    textTransform: "uppercase",
  },
  conversationInsightText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  conversationOutputRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: 2,
  },
  conversationOutputChip: {
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: "100%",
  },
  conversationOutputText: {
    fontSize: 11,
    lineHeight: 14,
    color: "#334155",
  },
  evidencePanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 10,
  },
  evidenceHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  evidenceTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  evidenceDetail: {
    fontSize: 12,
    lineHeight: 18,
    color: "#64748b",
  },
  auditPreviewCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccfbf1",
    backgroundColor: "#f0fdfa",
    padding: 10,
    gap: 4,
  },
  auditPreviewLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0f766e",
    textTransform: "uppercase",
  },
  auditPreviewTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  auditPreviewText: {
    fontSize: 12,
    lineHeight: 17,
    color: "#475569",
  },
  foldBanner: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  foldBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#92400e",
  },
  progressBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    padding: 12,
    gap: 6,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  progressStatus: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  progressText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  timelineRowCompact: {
    gap: 0,
  },
  timelineRowUser: {
    justifyContent: "flex-end",
  },
  timelineRail: {
    width: 12,
    alignItems: "center",
    paddingTop: 18,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  timelineDotUser: {
    backgroundColor: "#2563eb",
  },
  timelineDotNeutral: {
    backgroundColor: "#94a3b8",
  },
  timelineDotWarn: {
    backgroundColor: "#f59e0b",
  },
  timelineDotSuccess: {
    backgroundColor: "#16a34a",
  },
  timelineDotDanger: {
    backgroundColor: "#dc2626",
  },
  messageBubble: {
    flex: 1,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  messageBubbleCompact: {
    padding: 10,
  },
  stageMessageBubble: {
    flex: 0,
  },
  userBubble: {
    backgroundColor: "#dbeafe",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  systemBubble: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardBubble: {
    backgroundColor: "#fffbea",
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  messageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  messageHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  messageRole: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  messageTime: {
    fontSize: 11,
    color: "#64748b",
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#334155",
  },
  cardContent: {
    gap: 6,
  },
  calloutBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 6,
  },
  calloutText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  optionCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 8,
  },
  planOverviewCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    padding: 12,
    gap: 8,
  },
  planOverviewTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  planOverviewDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  planOverviewHint: {
    fontSize: 12,
    lineHeight: 18,
    color: "#64748b",
  },
  planCompareGrid: {
    gap: 8,
  },
  planCompareCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 4,
  },
  planCompareHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  planCompareTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  planCompareTemplate: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  planCompareMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: "#475569",
  },
  planCompactCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 8,
  },
  planCompactHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  planCompactTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  planCompactText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  optionTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  optionBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  optionTopline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  optionSummaryText: {
    fontSize: 12,
    color: "#64748b",
  },
  optionHintText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
  checklistBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#eff6ff",
    padding: 10,
    gap: 3,
  },
  checklistTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  checklistText: {
    fontSize: 12,
    lineHeight: 18,
    color: "#334155",
  },
  warningGroups: {
    gap: 8,
  },
  warningGroup: {
    gap: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  warningGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  warningGroupTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
  },
  warningText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#b45309",
  },
  validationPassedText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#166534",
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metricChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  metricLabel: {
    fontSize: 11,
    color: "#64748b",
  },
  metricValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  input: {
    flex: 1,
    minHeight: 58,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a",
  },
  inputCompact: {
    height: 48,
    minHeight: 48,
  },
  compactComposerRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  expandedComposerInputBlock: {
    flexDirection: "row",
  },
  floatingComposer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 8,
    ...(Platform.OS === "web"
      ? {
          boxShadow: "0px 8px 16px rgba(15, 23, 42, 0.14)",
        }
      : {
          shadowColor: "#0f172a",
          shadowOpacity: 0.14,
          shadowRadius: 16,
          shadowOffset: {
            width: 0,
            height: 8,
          },
        }),
    elevation: 10,
  },
  floatingComposerExpanded: {
    padding: 12,
    gap: 10,
  },
  composerDock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#99f6e4",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 8,
  },
  composerDockExpanded: {
    padding: 12,
    gap: 10,
  },
  composerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  composerHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  composerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  composerTarget: {
    fontSize: 12,
    lineHeight: 17,
    color: "#64748b",
  },
  composerHintText: {
    fontSize: 12,
    lineHeight: 18,
    color: "#475569",
  },
  composerPrimaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  composerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  directiveRail: {
    gap: 8,
    paddingRight: 4,
  },
  targetBanner: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  targetBannerTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#92400e",
  },
  directiveBlock: {
    gap: 8,
  },
  directiveTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  directiveHint: {
    fontSize: 12,
    lineHeight: 18,
    color: "#64748b",
  },
  directiveChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  directiveChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  directiveChipRecommended: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  directiveChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  directiveChipTextRecommended: {
    color: "#1d4ed8",
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#b91c1c",
  },
  loadingText: {
    fontSize: 14,
    color: "#475569",
  },
  diffMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: "#92400e",
  },
});
