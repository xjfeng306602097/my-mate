import express from "express";
import type { Request, Response } from "express";
import { createApprovalRecord, findPendingApprovalForNode, getApproval, listApprovals, saveApproval } from "./approval-store.js";
import { createArtifactRecord, listArtifacts, upsertArtifacts } from "./artifact-store.js";
import { applyNodeAction, applyRunAction } from "./control-actions.js";
import { buildAcceptedReport } from "./adapter-contracts.js";
import { appendRunEvent, listRunEvents } from "./event-store.js";
import {
  createDagPatch,
  getDagPatch,
  listSessionDagPatches,
  updateDagPatch,
} from "./dag-patch-store.js";
import {
  createDagProposal,
  getDagProposal,
  listSessionDagProposals,
  updateDagProposal,
} from "./dag-proposal-store.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import { getExecutionAdapter } from "./execution-adapter-factory.js";
import {
  createHumanInputRecord,
  findPendingHumanInputForNode,
  getHumanInput,
  listHumanInputs,
  saveHumanInput,
} from "./human-input-store.js";
import {
  applyNodeStatus,
  areAllNodesCompleted,
  getCompiledNode,
  getMutableNodeRun,
  getReadyNodeRuns,
  materializeInitialNodeRuns,
  unlockReadyNodeRuns,
} from "./node-scheduler.js";
import { listNodeRuns, saveNodeRuns } from "./node-run-store.js";
import {
  generateCandidatePlan,
  generateDagDraft,
  recommendTemplate,
  validateRunRequestForTemplate,
} from "./planner.js";
import type { PlannerInvocationOptions } from "./planner.js";
import {
  getOrchestratorProfile,
  listOrchestratorProfiles,
  upsertOrchestratorProfile,
} from "./orchestrator-profile-store.js";
import { createSessionMessage, listSessionMessages } from "./session-message-store.js";
import { createSessionIntervention, listSessionInterventions } from "./session-intervention-store.js";
import { createSessionAttachment, listSessionAttachments } from "./session-attachment-store.js";
import {
  archiveSession,
  createSession,
  getSession,
  hideSession,
  listSessions,
  saveSession,
  unarchiveSession,
  unhideSession,
} from "./session-store.js";
import { createRun, getRun, listRuns, saveRun } from "./run-store.js";
import { compileRunPlan } from "./run-plan-compiler.js";
import { getRunPlan, saveRunPlan } from "./run-plan-store.js";
import {
  assertTemplateDraftBody,
  archiveTemplate,
  createTemplate,
  createNextTemplateVersion,
  deriveTemplateDraft,
  getTemplateLineage,
  getTemplate,
  listTemplates,
  publishTemplate,
  updateTemplateDraft,
} from "./template-store.js";
import {
  disableAgentProfile,
  disableSkill,
  getAgentProfile,
  getSkill,
  listAgentProfiles,
  listSkills,
  upsertAgentProfile,
  upsertSkill,
} from "./registry-store.js";
import type {
  AgentProfileRecord,
  AgentHostingSummary,
  ConfirmSessionPlanRequest,
  ConfirmDagProposalRequest,
  CreateDagProposalRequest,
  CreateSessionInterventionRequest,
  DeriveTemplateRequest,
  CreateRunRequest,
  CreateSessionAttachmentRequest,
  CreateRunFromSessionRequest,
  CreateSessionMessageRequest,
  CreateSessionRequest,
  CreateTemplateRequest,
  DagPatchGraphPreview,
  DagPatchOperation,
  DagPatchOperationOutcome,
  DagPatchRecord,
  DagPatchTopologySnapshot,
  DagProposalAssignment,
  DagProposalRecord,
  DispatchEnvelope,
  EventRecord,
  MobileHomeResponse,
  MobileInboxItem,
  MobileRunDetail,
  MobileRunFollowUp,
  MobileRunSummary,
  MissionDetailResponse,
  MissionListItem,
  MissionRouteSummary,
  MissionSpecContract,
  MissionView,
  OpenClawReportCallbackRequest,
  PlannerCandidatePlanRequest,
  PlannerDagDraftRequest,
  PlannerTemplateSelectionRequest,
  PlanSessionRequest,
  RuntimeSummary,
  ReviseSessionPlanRequest,
  RejectDagProposalRequest,
  RunValidationMode,
  RunPlanRecord,
  RouteCompareOption,
  SessionDagDraftRequest,
  SessionInterventionKind,
  SessionInterventionStatus,
  SessionRecord,
  SessionWorkspaceDetailResponse,
  SessionWorkspaceStreamEvent,
  SessionMessageRecord,
  SupersedeDagProposalRequest,
  UpdateAgentHostingRequest,
  UpdateDagProposalAssignmentsRequest,
  UpdateTemplateRequest,
  UpsertAgentProfileRequest,
  UpsertOrchestratorProfileRequest,
  UpsertSkillRequest,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTemplateRecord,
} from "./types.js";
import { generateNodeRunId, isPlainObject, nowIso, slugify } from "./utils.js";
import {
  buildMissionWorkspaceProjection,
  MISSION_WORKSPACE_CONTRACT_VERSION,
  type MissionWorkspaceProjection,
} from "./mission-workspace.js";
import { buildRouteCompareSummary } from "./route-compare.js";
import { buildRuntimeGraphSummary } from "./runtime-graph.js";
import {
  AUTO_APPROVE_HUMAN_GATES,
  ENABLE_LOCAL_EXECUTION,
  OPENCLAW_APPROVAL_CONSOLE_BASE_URL,
  OPENCLAW_BRIDGE_BASE_URL,
  OPENCLAW_BRIDGE_CONTROL_PATH,
  OPENCLAW_BRIDGE_DISPATCH_PATH,
  OPENCLAW_BRIDGE_EXECUTION_MODE,
  OPENCLAW_BRIDGE_SWEEP_PATH,
  OPENCLAW_CALLBACK_BASE_URL,
  OPENCLAW_CALLBACK_PATH,
  OPENCLAW_CALLBACK_TOKEN,
  OPENCLAW_CONTAINER_NAME,
  OPENCLAW_GATEWAY_BASE_URL,
  PLANNER_LLM_MAX_TOKENS,
  PLANNER_LLM_MODEL,
  PLANNER_LLM_TIMEOUT_MS,
} from "./config.js";
import { buildDispatchEnvelope } from "./adapter-contracts.js";
import {
  getCurrentPlannerProvider,
  getFallbackPlannerProvider,
  listPlannerProviderIds,
} from "./planner.js";

function getSingleParam(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first || null : null;
  }
  return typeof value === "string" ? value || null : null;
}

function getPositiveNumberQueryParam(value: unknown): number | null {
  const raw = getSingleParam(value);
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getRouteCompareOptionQueryParam(
  value: unknown,
): RouteCompareOption | null {
  const raw = getSingleParam(value);
  if (raw === "primary" || raw === "alternative") {
    return raw;
  }
  return null;
}

type PlanCardComparable = {
  revision: number;
  template_id: string | null;
  compiled_nodes: Array<{
    node_id: string;
    name: string;
  }>;
  frontier: string[];
  warning_count: number;
};

type PlanCardRevisionDiff = {
  previous_revision: number | null;
  previous_template_id: string | null;
  template_changed: boolean;
  previous_node_count: number;
  node_count_delta: number;
  added_nodes: string[];
  removed_nodes: string[];
  previous_frontier_count: number;
  frontier_count_delta: number;
  previous_warning_count: number;
  warning_count_delta: number;
  summary_lines: string[];
};

type ReviseDirective =
  | { kind: "add_review_node"; reason: string }
  | { kind: "flatten_parallelism"; reason: string }
  | { kind: "increase_parallelism"; reason: string }
  | { kind: "add_approval_gate"; reason: string; target_index: number | null }
  | { kind: "add_fanout_review_stage"; reason: string };

function toNodeDiffLabel(node: { node_id: string; name: string }): string {
  if (node.name && node.node_id && node.name !== node.node_id) {
    return `${node.name} (${node.node_id})`;
  }
  return node.name || node.node_id;
}

function normalizePlanCardComparable(message: SessionMessageRecord): PlanCardComparable | null {
  if (message.kind !== "plan_card") {
    return null;
  }

  const revision = typeof message.content.revision === "number" ? message.content.revision : 0;
  const templateId =
    typeof message.content.template_id === "string" && message.content.template_id.trim()
      ? message.content.template_id.trim()
      : null;
  const candidatePlan = isPlainObject(message.content.candidate_plan)
    ? message.content.candidate_plan
    : null;
  const compiledNodes = Array.isArray(candidatePlan?.compiled_nodes)
    ? candidatePlan.compiled_nodes
    : [];
  const frontier = Array.isArray(candidatePlan?.frontier)
    ? candidatePlan.frontier.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];
  const validation = isPlainObject(message.content.validation) ? message.content.validation : null;
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];

  return {
    revision,
    template_id: templateId,
    compiled_nodes: compiledNodes
      .filter((node): node is Record<string, unknown> => isPlainObject(node))
      .map((node) => {
        const nodeId =
          typeof node.node_id === "string" && node.node_id.trim()
            ? node.node_id.trim()
            : typeof node.node_run_id === "string" && node.node_run_id.trim()
              ? node.node_run_id.trim()
              : typeof node.name === "string" && node.name.trim()
                ? node.name.trim()
                : "unknown-node";
        const name =
          typeof node.name === "string" && node.name.trim() ? node.name.trim() : nodeId;
        return {
          node_id: nodeId,
          name,
        };
      }),
    frontier,
    warning_count: warnings.length,
  };
}

function buildPlanRevisionDiff(
  previousPlanCard: SessionMessageRecord | null,
  nextPlanCard: {
    template_id: string;
    candidate_plan: unknown;
    validation: unknown;
  },
): PlanCardRevisionDiff | null {
  if (!previousPlanCard) {
    return null;
  }

  const previous = normalizePlanCardComparable(previousPlanCard);
  if (!previous) {
    return null;
  }

  const nextComparable = normalizePlanCardComparable({
    message_id: "plan_diff_preview",
    session_id: previousPlanCard.session_id,
    role: "system",
    kind: "plan_card",
    content: {
      revision: previous.revision + 1,
      template_id: nextPlanCard.template_id,
      candidate_plan: nextPlanCard.candidate_plan,
      validation: nextPlanCard.validation,
    },
    created_at: previousPlanCard.created_at,
    linked_run_id: null,
    linked_node_run_id: null,
  });
  if (!nextComparable) {
    return null;
  }

  const previousNodeMap = new Map(previous.compiled_nodes.map((node) => [node.node_id, node]));
  const nextNodeMap = new Map(nextComparable.compiled_nodes.map((node) => [node.node_id, node]));

  const addedNodes = nextComparable.compiled_nodes
    .filter((node) => !previousNodeMap.has(node.node_id))
    .map(toNodeDiffLabel)
    .sort((left, right) => left.localeCompare(right));
  const removedNodes = previous.compiled_nodes
    .filter((node) => !nextNodeMap.has(node.node_id))
    .map(toNodeDiffLabel)
    .sort((left, right) => left.localeCompare(right));

  const previousNodeCount = previous.compiled_nodes.length;
  const nextNodeCount = nextComparable.compiled_nodes.length;
  const nodeCountDelta = nextNodeCount - previousNodeCount;
  const previousFrontierCount = previous.frontier.length;
  const nextFrontierCount = nextComparable.frontier.length;
  const frontierCountDelta = nextFrontierCount - previousFrontierCount;
  const previousWarningCount = previous.warning_count;
  const nextWarningCount = nextComparable.warning_count;
  const warningCountDelta = nextWarningCount - previousWarningCount;
  const templateChanged = previous.template_id !== nextComparable.template_id;

  const summaryLines: string[] = [];
  if (templateChanged) {
    summaryLines.push(
      `Template changed from ${previous.template_id || "none"} to ${nextComparable.template_id || "none"}.`,
    );
  }
  if (nodeCountDelta !== 0) {
    summaryLines.push(
      `Node count ${nodeCountDelta > 0 ? "increased" : "decreased"} by ${Math.abs(nodeCountDelta)}.`,
    );
  }
  if (addedNodes.length > 0) {
    summaryLines.push(`Added: ${addedNodes.slice(0, 3).join(", ")}${addedNodes.length > 3 ? ", ..." : ""}.`);
  }
  if (removedNodes.length > 0) {
    summaryLines.push(`Removed: ${removedNodes.slice(0, 3).join(", ")}${removedNodes.length > 3 ? ", ..." : ""}.`);
  }
  if (frontierCountDelta !== 0) {
    summaryLines.push(
      `Ready frontier ${frontierCountDelta > 0 ? "increased" : "decreased"} by ${Math.abs(frontierCountDelta)}.`,
    );
  }
  if (warningCountDelta !== 0) {
    summaryLines.push(
      `Validation warnings ${warningCountDelta > 0 ? "increased" : "decreased"} by ${Math.abs(warningCountDelta)}.`,
    );
  }
  if (summaryLines.length === 0) {
    summaryLines.push("No material planning changes detected.");
  }

  return {
    previous_revision: previous.revision || null,
    previous_template_id: previous.template_id,
    template_changed: templateChanged,
    previous_node_count: previousNodeCount,
    node_count_delta: nodeCountDelta,
    added_nodes: addedNodes,
    removed_nodes: removedNodes,
    previous_frontier_count: previousFrontierCount,
    frontier_count_delta: frontierCountDelta,
    previous_warning_count: previousWarningCount,
    warning_count_delta: warningCountDelta,
    summary_lines: summaryLines,
  };
}

function alternativePlanExists(message: SessionMessageRecord): boolean {
  return (
    message.kind === "plan_options_card" &&
    isPlainObject(message.content.alternative)
  );
}

function isTemplateDeriveBody(value: unknown): value is DeriveTemplateRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("template_id" in value && typeof value.template_id !== "string") {
    return false;
  }
  if ("name" in value && typeof value.name !== "string") {
    return false;
  }
  if ("description" in value && typeof value.description !== "string") {
    return false;
  }
  if ("metadata" in value && !isPlainObject(value.metadata)) {
    return false;
  }
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseRunValidationMode(value: unknown): RunValidationMode | null {
  if (value === undefined) {
    return "strict";
  }
  if (value === "warn" || value === "strict" || value === "bypass") {
    return value;
  }
  return null;
}

function isOrchestratorProfileBody(value: unknown): value is UpsertOrchestratorProfileRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("orchestrator_id" in value && typeof value.orchestrator_id !== "string") {
    return false;
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    return false;
  }
  if ("provider" in value && typeof value.provider !== "string") {
    return false;
  }
  if ("model" in value && typeof value.model !== "string") {
    return false;
  }
  if ("system_prompt" in value && typeof value.system_prompt !== "string") {
    return false;
  }
  if ("default_tools" in value && !isStringArray(value.default_tools)) {
    return false;
  }
  if (
    "default_subagent_profile_ids" in value &&
    !isStringArray(value.default_subagent_profile_ids)
  ) {
    return false;
  }
  if ("planning_policy" in value && !isPlainObject(value.planning_policy)) {
    return false;
  }
  if ("handoff_policy" in value && !isPlainObject(value.handoff_policy)) {
    return false;
  }
  if ("metadata" in value && !isPlainObject(value.metadata)) {
    return false;
  }
  return true;
}

function getOptionalStringField(
  value: Record<string, unknown>,
  key: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (!(key in value) || value[key] === undefined || value[key] === null) {
    return { ok: true, value: null };
  }
  if (typeof value[key] !== "string") {
    return { ok: false, message: `${key} must be a string when provided.` };
  }
  const trimmed = value[key].trim();
  return { ok: true, value: trimmed || null };
}

function resolvePlannerInvocationOptions(
  body: unknown,
): { ok: true; value: PlannerInvocationOptions } | { ok: false; status: number; message: string } {
  if (!isPlainObject(body)) {
    return { ok: true, value: {} };
  }

  const profileId = getOptionalStringField(body, "orchestrator_profile_id");
  if (!profileId.ok) {
    return { ok: false, status: 400, message: profileId.message };
  }
  const providerId = getOptionalStringField(body, "planner_provider_id");
  if (!providerId.ok) {
    return { ok: false, status: 400, message: providerId.message };
  }
  const model = getOptionalStringField(body, "planner_model");
  if (!model.ok) {
    return { ok: false, status: 400, message: model.message };
  }
  const systemPrompt = getOptionalStringField(body, "orchestrator_system_prompt");
  if (!systemPrompt.ok) {
    return { ok: false, status: 400, message: systemPrompt.message };
  }

  const profile = profileId.value ? getOrchestratorProfile(profileId.value) : null;
  if (profileId.value && !profile) {
    return {
      ok: false,
      status: 404,
      message: "Orchestrator profile not found.",
    };
  }

  return {
    ok: true,
    value: {
      providerId: providerId.value || profile?.provider || null,
      model: model.value || profile?.model || null,
      orchestratorProfileId: profile?.orchestrator_id || profileId.value || null,
      orchestratorSystemPrompt: systemPrompt.value || profile?.system_prompt || null,
    },
  };
}

function resolveSessionPlannerInvocationOptions(session: SessionRecord): PlannerInvocationOptions {
  const metadata =
    session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
      ? session.metadata
      : {};
  const profileId =
    typeof metadata.orchestrator_profile_id === "string" && metadata.orchestrator_profile_id.trim()
      ? metadata.orchestrator_profile_id.trim()
      : null;
  const profile = profileId ? getOrchestratorProfile(profileId) : null;
  return {
    providerId: profile?.provider || null,
    model: profile?.model || null,
    orchestratorProfileId: profile?.orchestrator_id || profileId,
    orchestratorSystemPrompt: profile?.system_prompt || null,
  };
}

function isAgentProfileBody(value: unknown): value is UpsertAgentProfileRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("profile_id" in value && typeof value.profile_id !== "string") {
    return false;
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    return false;
  }
  if ("description" in value && typeof value.description !== "string") {
    return false;
  }
  if (typeof value.openclaw_agent_id !== "string") {
    return false;
  }
  if ("default_skills" in value && !isStringArray(value.default_skills)) {
    return false;
  }
  if ("allowed_tools" in value && !isStringArray(value.allowed_tools)) {
    return false;
  }
  if ("disallowed_skills" in value && !isStringArray(value.disallowed_skills)) {
    return false;
  }
  if ("policy_tags" in value && !isStringArray(value.policy_tags)) {
    return false;
  }
  if ("status" in value && value.status !== "active" && value.status !== "disabled") {
    return false;
  }
  if ("metadata" in value && !isPlainObject(value.metadata)) {
    return false;
  }
  return true;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAgentHostingUpdateBody(value: unknown): value is UpdateAgentHostingRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("openclaw_agent_id" in value && typeof value.openclaw_agent_id !== "string") {
    return false;
  }
  if ("provider" in value && !isNullableString(value.provider)) {
    return false;
  }
  if ("model" in value && !isNullableString(value.model)) {
    return false;
  }
  if ("runtime_mode" in value && !isNullableString(value.runtime_mode)) {
    return false;
  }
  return true;
}

function isSkillBody(value: unknown): value is UpsertSkillRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("skill_id" in value && typeof value.skill_id !== "string") {
    return false;
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    return false;
  }
  if ("description" in value && typeof value.description !== "string") {
    return false;
  }
  if ("category" in value && typeof value.category !== "string") {
    return false;
  }
  if ("allowed_tools" in value && !isStringArray(value.allowed_tools)) {
    return false;
  }
  if ("input_schema" in value && !isPlainObject(value.input_schema)) {
    return false;
  }
  if ("output_contract" in value && !isPlainObject(value.output_contract)) {
    return false;
  }
  if ("tags" in value && !isStringArray(value.tags)) {
    return false;
  }
  if ("status" in value && value.status !== "active" && value.status !== "disabled") {
    return false;
  }
  if ("metadata" in value && !isPlainObject(value.metadata)) {
    return false;
  }
  return true;
}

function isCreateSessionBody(value: unknown): value is CreateSessionRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("title" in value && value.title !== undefined && typeof value.title !== "string") {
    return false;
  }
  if (
    "initial_message" in value &&
    value.initial_message !== undefined &&
    typeof value.initial_message !== "string"
  ) {
    return false;
  }
  if (
    "created_by" in value &&
    value.created_by !== undefined &&
    typeof value.created_by !== "string"
  ) {
    return false;
  }
  if (
    "orchestrator_profile_id" in value &&
    value.orchestrator_profile_id !== undefined &&
    typeof value.orchestrator_profile_id !== "string"
  ) {
    return false;
  }
  return true;
}

function isCreateSessionMessageBody(value: unknown): value is CreateSessionMessageRequest {
  return (
    isPlainObject(value) &&
    typeof value.content === "string" &&
    !!value.content.trim()
  );
}

function isCreateSessionAttachmentBody(value: unknown): value is CreateSessionAttachmentRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if (typeof value.storage_uri !== "string" || !value.storage_uri.trim()) {
    return false;
  }
  if ("name" in value && value.name !== undefined && typeof value.name !== "string") {
    return false;
  }
  if ("mime_type" in value && value.mime_type !== undefined && value.mime_type !== null && typeof value.mime_type !== "string") {
    return false;
  }
  if (
    "size_bytes" in value &&
    value.size_bytes !== undefined &&
    value.size_bytes !== null &&
    (typeof value.size_bytes !== "number" || !Number.isFinite(value.size_bytes) || value.size_bytes < 0)
  ) {
    return false;
  }
  if ("kind" in value && value.kind !== undefined && value.kind !== null && typeof value.kind !== "string") {
    return false;
  }
  if ("summary" in value && value.summary !== undefined && value.summary !== null && typeof value.summary !== "string") {
    return false;
  }
  if ("created_by" in value && value.created_by !== undefined && value.created_by !== null && typeof value.created_by !== "string") {
    return false;
  }
  if ("metadata" in value && value.metadata !== undefined && !isPlainObject(value.metadata)) {
    return false;
  }
  return true;
}

function isSessionInterventionKind(value: unknown): value is SessionInterventionKind {
  return (
    value === "guidance" ||
    value === "change_request" ||
    value === "pause_request" ||
    value === "resume_request" ||
    value === "skip_request" ||
    value === "add_node_request" ||
    value === "parallelism_request"
  );
}

function isCreateSessionInterventionBody(
  value: unknown,
): value is CreateSessionInterventionRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if (typeof value.content !== "string" || !value.content.trim()) {
    return false;
  }
  if ("kind" in value && value.kind !== undefined && !isSessionInterventionKind(value.kind)) {
    return false;
  }
  if (
    "target_run_id" in value &&
    value.target_run_id !== undefined &&
    typeof value.target_run_id !== "string"
  ) {
    return false;
  }
  if (
    "target_node_run_id" in value &&
    value.target_node_run_id !== undefined &&
    typeof value.target_node_run_id !== "string"
  ) {
    return false;
  }
  if ("metadata" in value && value.metadata !== undefined && !isPlainObject(value.metadata)) {
    return false;
  }
  return true;
}

function isPlanSessionBody(value: unknown): value is PlanSessionRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("template_id" in value && value.template_id !== undefined && typeof value.template_id !== "string") {
    return false;
  }
  if (
    "draft_message_id" in value &&
    value.draft_message_id !== undefined &&
    typeof value.draft_message_id !== "string"
  ) {
    return false;
  }
  if ("inputs" in value && value.inputs !== undefined && !isPlainObject(value.inputs)) {
    return false;
  }
  return true;
}

function isSessionDagDraftBody(value: unknown): value is SessionDagDraftRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("template_id" in value && value.template_id !== undefined && typeof value.template_id !== "string") {
    return false;
  }
  if ("inputs" in value && value.inputs !== undefined && !isPlainObject(value.inputs)) {
    return false;
  }
  if (
    "max_agent_nodes" in value &&
    value.max_agent_nodes !== undefined &&
    (typeof value.max_agent_nodes !== "number" || !Number.isFinite(value.max_agent_nodes))
  ) {
    return false;
  }
  return true;
}

function isReviseSessionPlanBody(value: unknown): value is ReviseSessionPlanRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if (typeof value.instructions !== "string" || !value.instructions.trim()) {
    return false;
  }
  if (
    "revision" in value &&
    value.revision !== undefined &&
    (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 1)
  ) {
    return false;
  }
  if ("option" in value && value.option !== undefined && value.option !== "primary" && value.option !== "alternative") {
    return false;
  }
  return true;
}

function isCreateRunFromSessionBody(value: unknown): value is CreateRunFromSessionRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("template_id" in value && value.template_id !== undefined && typeof value.template_id !== "string") {
    return false;
  }
  if ("inputs" in value && value.inputs !== undefined && !isPlainObject(value.inputs)) {
    return false;
  }
  if (
    "validation_mode" in value &&
    value.validation_mode !== undefined &&
    parseRunValidationMode(value.validation_mode) === null
  ) {
    return false;
  }
  if (
    "plan_revision" in value &&
    value.plan_revision !== undefined &&
    (typeof value.plan_revision !== "number" ||
      !Number.isInteger(value.plan_revision) ||
      value.plan_revision < 1)
  ) {
    return false;
  }
  if (
    "plan_option" in value &&
    value.plan_option !== undefined &&
    value.plan_option !== "primary" &&
    value.plan_option !== "alternative"
  ) {
    return false;
  }
  if ("proposal_id" in value && value.proposal_id !== undefined && typeof value.proposal_id !== "string") {
    return false;
  }
  return true;
}

function isConfirmSessionPlanBody(value: unknown): value is ConfirmSessionPlanRequest {
  return (
    isPlainObject(value) &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision) &&
    value.revision >= 1 &&
    (!("option" in value) ||
      value.option === undefined ||
      value.option === "primary" ||
      value.option === "alternative")
  );
}

function isCreateDagProposalBody(value: unknown): value is CreateDagProposalRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("source_message_id" in value && value.source_message_id !== undefined && typeof value.source_message_id !== "string") {
    return false;
  }
  if (
    "source_revision" in value &&
    value.source_revision !== undefined &&
    (typeof value.source_revision !== "number" ||
      !Number.isInteger(value.source_revision) ||
      value.source_revision < 1)
  ) {
    return false;
  }
  if (
    "source_option" in value &&
    value.source_option !== undefined &&
    value.source_option !== "primary" &&
    value.source_option !== "alternative"
  ) {
    return false;
  }
  if ("template_id" in value && value.template_id !== undefined && typeof value.template_id !== "string") {
    return false;
  }
  if ("inputs" in value && value.inputs !== undefined && !isPlainObject(value.inputs)) {
    return false;
  }
  return true;
}

function isDagProposalAssignment(value: unknown): value is DagProposalAssignment {
  if (!isPlainObject(value)) {
    return false;
  }
  if (typeof value.node_id !== "string" || !value.node_id.trim()) {
    return false;
  }
  const nullableStringFields = [
    "node_name",
    "subagent_profile_id",
    "provider",
    "model",
    "input_context",
    "output_contract",
  ];
  for (const field of nullableStringFields) {
    if (field in value && value[field] !== null && value[field] !== undefined && typeof value[field] !== "string") {
      return false;
    }
  }
  if (!Array.isArray(value.allowed_tools) || !value.allowed_tools.every((item) => typeof item === "string")) {
    return false;
  }
  if (!Array.isArray(value.allowed_skills) || !value.allowed_skills.every((item) => typeof item === "string")) {
    return false;
  }
  if ("metadata" in value && value.metadata !== undefined && !isPlainObject(value.metadata)) {
    return false;
  }
  return true;
}

function normalizeDagProposalAssignment(value: DagProposalAssignment): DagProposalAssignment {
  return {
    node_id: value.node_id.trim(),
    node_name: typeof value.node_name === "string" && value.node_name.trim() ? value.node_name.trim() : null,
    subagent_profile_id:
      typeof value.subagent_profile_id === "string" && value.subagent_profile_id.trim()
        ? value.subagent_profile_id.trim()
        : null,
    provider: typeof value.provider === "string" && value.provider.trim() ? value.provider.trim() : null,
    model: typeof value.model === "string" && value.model.trim() ? value.model.trim() : null,
    allowed_tools: value.allowed_tools.map((item) => item.trim()).filter(Boolean),
    allowed_skills: value.allowed_skills.map((item) => item.trim()).filter(Boolean),
    input_context:
      typeof value.input_context === "string" && value.input_context.trim() ? value.input_context.trim() : null,
    output_contract:
      typeof value.output_contract === "string" && value.output_contract.trim()
        ? value.output_contract.trim()
        : null,
    metadata: isPlainObject(value.metadata) ? value.metadata : {},
  };
}

function isUpdateDagProposalAssignmentsBody(
  value: unknown,
): value is UpdateDagProposalAssignmentsRequest {
  return (
    isPlainObject(value) &&
    Array.isArray(value.assignments) &&
    value.assignments.every((item) => isDagProposalAssignment(item))
  );
}

function isConfirmDagProposalBody(value: unknown): value is ConfirmDagProposalRequest {
  return (
    isPlainObject(value) &&
    (!("confirmed_by" in value) || value.confirmed_by === undefined || typeof value.confirmed_by === "string")
  );
}

function isRejectDagProposalBody(value: unknown): value is RejectDagProposalRequest {
  return (
    isPlainObject(value) &&
    (!("rejected_by" in value) || value.rejected_by === undefined || typeof value.rejected_by === "string") &&
    (!("reason" in value) || value.reason === undefined || typeof value.reason === "string")
  );
}

function isSupersedeDagProposalBody(value: unknown): value is SupersedeDagProposalRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("source_message_id" in value && value.source_message_id !== undefined && typeof value.source_message_id !== "string") {
    return false;
  }
  if ("reason" in value && value.reason !== undefined && typeof value.reason !== "string") {
    return false;
  }
  if ("template_id" in value && value.template_id !== undefined && typeof value.template_id !== "string") {
    return false;
  }
  if ("inputs" in value && value.inputs !== undefined && !isPlainObject(value.inputs)) {
    return false;
  }
  return true;
}

export function createApp(options?: { executionAdapter?: ExecutionAdapter }) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const executionAdapter = options?.executionAdapter || getExecutionAdapter();

  function eventSummary(event: EventRecord): string | null {
    const message = event.payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    const error = event.payload.error;
    if (isPlainObject(error) && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
    const currentSummary = event.payload.current_summary;
    if (typeof currentSummary === "string" && currentSummary.trim()) {
      return currentSummary;
    }
    return null;
  }

  function resolveMobileNextActions(input: MobileRunDetail): string[] {
    const actions = new Set<string>();
    if (input.pending_approvals.length > 0) {
      actions.add("approve");
      actions.add("reject");
    }
    if (input.pending_human_inputs.length > 0) {
      actions.add("submit_human_input");
    }
    if (input.run.status === "running") {
      actions.add("pause");
      actions.add("cancel");
    }
    if (input.run.status === "paused") {
      actions.add("resume");
      actions.add("cancel");
    }
    if (input.run.status === "failed") {
      actions.add("retry_failed_node");
    }
    return [...actions];
  }

  function getActiveMobileTask(detail: MobileRunDetail): MobileRunSummary["active_task"] {
    return (
      detail.tasks.find((task) => ["ready", "running", "waiting_human"].includes(task.status)) ||
      null
    );
  }

  function buildMobileRunSummary(runId: string): MobileRunSummary | null {
    const detail = buildMobileRunDetail(runId);
    if (!detail) {
      return null;
    }

    return {
      run_id: detail.run.run_id,
      template_id: detail.run.template_id,
      template_version: detail.run.template_version,
      proposal_id: detail.run.proposal_id,
      status: detail.run.status,
      intent: detail.run.intent,
      current_summary: detail.run.current_summary,
      updated_at: detail.run.updated_at,
      active_task: getActiveMobileTask(detail),
      pending_approval_count: detail.pending_approvals.length,
      pending_human_input_count: detail.pending_human_inputs.length,
      artifact_count: detail.artifacts.length,
      next_actions: detail.next_actions,
    };
  }

  function buildMobileHomeResponse(): MobileHomeResponse {
    const runSummaries = listRuns()
      .map((run) => buildMobileRunSummary(run.run_id))
      .filter((item): item is MobileRunSummary => !!item);
    const missionItems = listMissionItems();

    const overview = {
      total_runs: runSummaries.length,
      active_runs: runSummaries.filter((item) => ["queued", "running", "paused"].includes(item.status))
        .length,
      waiting_runs: runSummaries.filter((item) => item.status === "waiting_human").length,
      failed_runs: runSummaries.filter((item) => item.status === "failed").length,
      completed_runs: runSummaries.filter((item) => item.status === "completed").length,
      cancelled_runs: runSummaries.filter((item) => item.status === "cancelled").length,
      pending_approval_count: runSummaries.reduce(
        (count, item) => count + item.pending_approval_count,
        0,
      ),
      pending_human_input_count: runSummaries.reduce(
        (count, item) => count + item.pending_human_input_count,
        0,
      ),
    };
    const missionOverview = {
      total_missions: missionItems.length,
      active_missions: missionItems.filter((item) => ["planning", "ready_to_run", "running"].includes(item.status)).length,
      waiting_missions: missionItems.filter((item) => item.status === "waiting_human").length,
      missions_needing_attention: missionItems.filter((item) => {
        const snapshot = item.mission_snapshot;
        return (
          item.status === "waiting_human" ||
          item.status === "failed" ||
          snapshot?.missionStatusTone === "warn" ||
          snapshot?.missionStatusTone === "danger" ||
          !!snapshot?.nextActionLabel
        );
      }).length,
    };

    const focusRun =
      runSummaries.find((item) => item.pending_approval_count + item.pending_human_input_count > 0) ||
      runSummaries.find((item) => ["running", "waiting_human", "paused", "failed"].includes(item.status)) ||
      runSummaries[0] ||
      null;
    const focusSession =
      missionItems.find((item) => item.status === "waiting_human") ||
      missionItems.find((item) => item.status === "failed") ||
      missionItems.find((item) => !!item.mission_snapshot?.nextActionLabel) ||
      missionItems.find((item) => ["running", "planning", "ready_to_run"].includes(item.status)) ||
      missionItems[0] ||
      null;

    return {
      overview,
      missions: missionOverview,
      focus_session: focusSession,
      recent_sessions: missionItems.slice(0, 8),
      focus_run: focusRun,
      recent_runs: runSummaries.slice(0, 10),
      inbox: {
        pending_count:
          overview.pending_approval_count + overview.pending_human_input_count,
        pending_approval_count: overview.pending_approval_count,
        pending_human_input_count: overview.pending_human_input_count,
      },
    };
  }

  function buildMobileInboxItems(): MobileInboxItem[] {
    const approvalItems: MobileInboxItem[] = listApprovals("pending").flatMap((approval) => {
      const detail = buildMobileRunDetail(approval.run_id);
      if (!detail) {
        return [];
      }

      return [
        {
          kind: "approval",
          request_id: approval.approval_id,
          run_id: approval.run_id,
          node_run_id: approval.node_run_id,
          run_status: detail.run.status,
          intent: detail.run.intent,
          summary: approval.summary,
          requested_at: approval.requested_at,
          task:
            detail.tasks.find((task) => task.node_run_id === approval.node_run_id) ||
            getActiveMobileTask(detail),
          input_schema: null,
          next_actions: ["approve", "reject"],
        },
      ];
    });

    const humanInputItems: MobileInboxItem[] = listHumanInputs("pending").flatMap((input) => {
      const detail = buildMobileRunDetail(input.run_id);
      if (!detail) {
        return [];
      }

      return [
        {
          kind: "human_input",
          request_id: input.input_request_id,
          run_id: input.run_id,
          node_run_id: input.node_run_id,
          run_status: detail.run.status,
          intent: detail.run.intent,
          summary: input.summary,
          requested_at: input.requested_at,
          task:
            detail.tasks.find((task) => task.node_run_id === input.node_run_id) ||
            getActiveMobileTask(detail),
          input_schema: input.input_schema,
          next_actions: ["submit_human_input"],
        },
      ];
    });

    return [...approvalItems, ...humanInputItems].sort((a, b) =>
      b.requested_at.localeCompare(a.requested_at),
    );
  }

  function buildMobileRunFollowUp(runId: string): MobileRunFollowUp | null {
    const detail = buildMobileRunDetail(runId);
    if (!detail) {
      return null;
    }
    const linkedSession =
      listSessions().find(
        (session) =>
          session.latest_run_id === runId ||
          session.active_run_ids.includes(runId),
      ) || null;
    const linkedMission = linkedSession ? buildMissionListItem(linkedSession.session_id) : null;

    return {
      run: detail.run,
      session_id: linkedSession?.session_id || null,
      mission: linkedMission,
      blocker:
        detail.run.waiting_reason ||
        detail.run.blocked_reason ||
        detail.pending_approvals[0]?.summary ||
        detail.pending_human_inputs[0]?.summary ||
        null,
      active_task: getActiveMobileTask(detail),
      pending_approvals: detail.pending_approvals,
      pending_human_inputs: detail.pending_human_inputs,
      latest_timeline: detail.timeline.slice(-10).reverse(),
      artifacts: detail.artifacts,
      artifact_count: detail.artifacts.length,
      next_actions: detail.next_actions,
    };
  }

  function buildMobileRunDetail(runId: string): MobileRunDetail | null {
    const run = getRun(runId);
    const plan = getRunPlan(runId);
    if (!run || !plan) {
      return null;
    }

    const nodeRuns = listNodeRuns(runId);
    const nodeRunById = new Map(nodeRuns.map((nodeRun) => [nodeRun.node_run_id, nodeRun]));
    const tasks = plan.compiled_nodes.map((node) => {
      const nodeRun = nodeRunById.get(node.node_run_id);
      return {
        node_run_id: node.node_run_id,
        node_id: node.node_id,
        name: node.name,
        type: node.type,
        status: nodeRun?.status || node.status,
        progress:
          nodeRun?.progress || {
            percent: 0,
            message: "Node state unavailable",
            updated_at: run.updated_at,
          },
        attempt: nodeRun?.attempt ?? node.retry_policy.attempt,
        started_at: nodeRun?.started_at ?? null,
        finished_at: nodeRun?.finished_at ?? null,
        openclaw_agent_id: node.openclaw_agent_id,
        execution_ref: node.execution_ref,
      };
    });

    const detail: MobileRunDetail = {
      run,
      tasks,
      pending_approvals: listApprovals("pending").filter((item) => item.run_id === runId),
      pending_human_inputs: listHumanInputs("pending").filter((item) => item.run_id === runId),
      artifacts: listArtifacts(runId),
      timeline: listRunEvents(runId).map((event) => ({
        event_id: event.event_id,
        node_run_id: event.node_run_id,
        type: event.type,
        actor_type: event.actor_type,
        actor_id: event.actor_id,
        summary: eventSummary(event),
        payload: event.payload,
        created_at: event.created_at,
      })),
      next_actions: [],
    };
    detail.next_actions = resolveMobileNextActions(detail);
    return detail;
  }

  function getLatestSessionGoal(sessionId: string): string | null {
    const session = getSession(sessionId);
    if (session?.current_goal && session.current_goal.trim()) {
      return session.current_goal.trim();
    }
    const messages = listSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "user" || message.kind !== "text") {
        continue;
      }
      const text = message.content.text;
      if (typeof text === "string" && text.trim()) {
        return text.trim();
      }
    }
    return null;
  }

  function getSessionMetadataObject(session: SessionRecord): Record<string, unknown> {
    return isPlainObject(session.metadata) ? session.metadata : {};
  }

  type PersistedMissionRouteState = {
    active_revision: number | null;
    active_option: "primary" | "alternative" | null;
    latest_revision: number | null;
    latest_option: "primary" | "alternative" | null;
    confirmed_revision: number | null;
    confirmed_option: "primary" | "alternative" | null;
    selected_template_id: string | null;
    selected_template_name: string | null;
    alternative_available: boolean;
    stale: boolean;
    stale_reason: string | null;
  };

  type PersistedMissionRevisionLineage = {
    source_revision: number | null;
    source_option: "primary" | "alternative" | null;
    latest_revision: number | null;
    confirmed_revision: number | null;
    confirmed_option: "primary" | "alternative" | null;
  };

  function buildPersistedMissionContractState(
    missionProjection: MissionWorkspaceProjection,
  ): {
    routeState: PersistedMissionRouteState;
    requestedOutputs: string[];
    revisionLineage: PersistedMissionRevisionLineage;
    specContract: MissionSpecContract;
  } {
    const route = missionProjection.missionSpec.route;
    const revisionLineage = missionProjection.missionSpec.revisionLineage;

    return {
      routeState: {
        active_revision: route.activeRevision,
        active_option: route.activeOption,
        latest_revision: route.latestRevision,
        latest_option: route.activeOption,
        confirmed_revision: route.confirmedRevision,
        confirmed_option: route.confirmedOption,
        selected_template_id: route.selectedTemplateId,
        selected_template_name: route.selectedTemplateName,
        alternative_available: route.alternativeAvailable,
        stale: route.stale,
        stale_reason: route.staleReason,
      },
      requestedOutputs: [...missionProjection.missionSpec.requestedOutputs],
      revisionLineage: {
        source_revision: revisionLineage.sourceRevision,
        source_option: revisionLineage.sourceOption,
        latest_revision: revisionLineage.latestRevision,
        confirmed_revision: revisionLineage.confirmedRevision,
        confirmed_option: revisionLineage.confirmedOption,
      },
      specContract: missionProjection.missionSpecContract,
    };
  }

  function getEffectiveConstraintsSummary(sessionId: string, session: SessionRecord): string | null {
    return summarizeSessionConstraints(
      listSessionMessages(sessionId),
      session.current_goal || getLatestSessionGoal(sessionId),
    );
  }

  function getSessionOpenQuestions(session: SessionRecord): string[] {
    const metadata = getSessionMetadataObject(session);
    const value = metadata.open_questions;
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .filter((item) => !isMetaDraftChoiceQuestion(item));
  }

  function isExecutionAnchoredSessionStatus(status: SessionRecord["status"]): boolean {
    return [
      "running",
      "waiting_human",
      "completed",
      "failed",
      "cancelled",
    ].includes(status);
  }

  function getSessionRouteStaleState(sessionId: string, session: SessionRecord): {
    planStale: boolean;
    staleReason: string | null;
  } {
    const metadata = getSessionMetadataObject(session);
    const planStale = metadata.route_stale === true;
    const staleReason =
      typeof metadata.stale_reason === "string" && metadata.stale_reason.trim()
        ? metadata.stale_reason.trim()
        : null;
    if (!planStale) {
      return {
        planStale: false,
        staleReason: null,
      };
    }

    const latestRouteAnchor = getLatestMessageByKinds(sessionId, ["plan_options_card", "plan_card", "draft_card"]);
    if (!latestRouteAnchor) {
      return {
        planStale,
        staleReason,
      };
    }

    const hasMutatingFollowUp = listSessionMessages(sessionId).some((message) => {
      if (
        message.role !== "user" ||
        message.kind !== "text" ||
        typeof message.content.text !== "string" ||
        message.created_at <= latestRouteAnchor.created_at
      ) {
        return false;
      }
      const intent = detectSessionMessageIntentRefined(message.content.text).intent;
      return intent === "add_constraint" || intent === "capture_goal";
    });

    if (!hasMutatingFollowUp) {
      return {
        planStale: false,
        staleReason: null,
      };
    }

    return {
      planStale,
      staleReason,
    };
  }

  function clearSessionRouteStaleState(session: SessionRecord): Record<string, unknown> {
    const metadata = getSessionMetadataObject(session);
    return {
      ...metadata,
      route_stale: false,
      stale_reason: null,
    };
  }

  function resolvePlanningMessageOption(
    message: SessionMessageRecord | null,
    fallbackOption?: "primary" | "alternative" | null,
  ): "primary" | "alternative" | null {
    if (!message) {
      return null;
    }
    if (message.kind === "plan_options_card") {
      if (message.content.selected_option === "alternative") {
        return "alternative";
      }
      if (fallbackOption === "alternative" && isPlainObject(message.content.alternative)) {
        return "alternative";
      }
      return "primary";
    }
    if (message.kind === "plan_card") {
      return "primary";
    }
    return null;
  }

  function resolveSessionConfirmationTarget(sessionId: string, session: SessionRecord): {
    available: boolean;
    blocked: "no_plan" | "stale" | null;
    revision: number | null;
    option: "primary" | "alternative" | null;
    planningMessage: SessionMessageRecord | null;
    alreadyConfirmed: boolean;
  } {
    const latestPlanningMessage = getLatestMessageByKinds(sessionId, ["plan_options_card", "plan_card"]);
    if (!latestPlanningMessage) {
      return {
        available: false,
        blocked: "no_plan",
        revision: null,
        option: null,
        planningMessage: null,
        alreadyConfirmed: false,
      };
    }

    const metadata = getSessionMetadataObject(session);
    const planStale = metadata.route_stale === true;
    const revision =
      typeof latestPlanningMessage.content.revision === "number"
        ? latestPlanningMessage.content.revision
        : null;
    const option = resolvePlanningMessageOption(latestPlanningMessage, session.confirmed_plan_option);
    const alreadyConfirmed =
      revision !== null &&
      option !== null &&
      session.confirmed_plan_revision === revision &&
      session.confirmed_plan_option === option;

    if (planStale) {
      return {
        available: false,
        blocked: "stale",
        revision,
        option,
        planningMessage: latestPlanningMessage,
        alreadyConfirmed,
      };
    }

    return {
      available: revision !== null && option !== null,
      blocked: revision !== null && option !== null ? null : "no_plan",
      revision,
      option,
      planningMessage: latestPlanningMessage,
      alreadyConfirmed,
    };
  }

  function buildSessionWorkspaceState(sessionId: string, session: SessionRecord): Record<string, unknown> {
    const latestPlanningMessage = getLatestMessageByKinds(sessionId, ["plan_options_card", "plan_card"]);
    const latestDraftMessage = getLatestMessageByKinds(sessionId, ["draft_card"]);
    const latestRunSummary = getLatestMessageByKinds(sessionId, ["summary_card"]);
    const latestSubtask = getLatestMessageByKinds(sessionId, ["subtask_card"]);
    const threadMessages = buildSessionThreadMessages(sessionId);
    const pendingApprovalCount = threadMessages.filter((message) => message.kind === "approval_card").length;
    const pendingHumanInputCount = threadMessages.filter((message) => message.kind === "human_input_card").length;
    const artifactCount = threadMessages.filter((message) => message.kind === "artifact_card").length;
    const interventionMessages = threadMessages.filter((message) => message.kind === "intervention_card");
    const dagPatchMessages = threadMessages.filter((message) => message.kind === "dag_patch_card");
    const pendingInterventionCount = interventionMessages.filter((message) => {
      const status = typeof message.content.status === "string" ? message.content.status : "";
      return status === "queued_for_next_pass" || status === "needs_review" || status === "recorded";
    }).length;
    const pendingDagPatchCount = dagPatchMessages.filter((message) => {
      const status = typeof message.content.status === "string" ? message.content.status : "";
      return status === "proposed" || status === "needs_confirmation";
    }).length;
    const latestIntervention = interventionMessages[interventionMessages.length - 1] || null;
    const latestDagPatch = dagPatchMessages[dagPatchMessages.length - 1] || null;
    const metadata = getSessionMetadataObject(session);
    const { planStale, staleReason } = getSessionRouteStaleState(sessionId, session);
    const confirmedPlanningMessage =
      typeof session.confirmed_plan_revision === "number"
        ? getPlanningMessageByRevision(sessionId, session.confirmed_plan_revision)
        : null;
    const activePlanningMessage = isExecutionAnchoredSessionStatus(session.status)
      ? confirmedPlanningMessage || latestPlanningMessage
      : latestPlanningMessage || confirmedPlanningMessage;
    const activePlanRevision =
      activePlanningMessage && typeof activePlanningMessage.content.revision === "number"
        ? activePlanningMessage.content.revision
        : null;
    const activePlanOption =
      activePlanningMessage === confirmedPlanningMessage && session.confirmed_plan_option
        ? session.confirmed_plan_option
        : resolvePlanningMessageOption(activePlanningMessage, session.confirmed_plan_option);
    const selectedPlanOptionContent =
      activePlanningMessage?.kind === "plan_options_card"
        ? activePlanningMessage.content[activePlanOption || "primary"]
        : null;
    const activePlanContent: Record<string, unknown> | null =
      activePlanningMessage?.kind === "plan_options_card"
        ? isPlainObject(selectedPlanOptionContent)
          ? selectedPlanOptionContent
          : null
        : activePlanningMessage?.kind === "plan_card"
          ? activePlanningMessage.content
          : null;
    const activePlanValidation = isPlainObject(activePlanContent?.validation)
      ? activePlanContent.validation
      : null;
    const activePlanWarnings = Array.isArray(activePlanValidation?.warnings)
      ? activePlanValidation.warnings.filter((item): item is string => typeof item === "string")
      : [];
    const activePlanNodeCount =
      isPlainObject(activePlanContent?.candidate_plan) &&
      Array.isArray(activePlanContent.candidate_plan.compiled_nodes)
        ? activePlanContent.candidate_plan.compiled_nodes.length
        : null;
    const activePlanReadyFrontierCount =
      isPlainObject(activePlanContent?.candidate_plan) &&
      Array.isArray(activePlanContent.candidate_plan.frontier)
        ? activePlanContent.candidate_plan.frontier.length
        : null;
    const draftTemplate = latestDraftMessage && isPlainObject(latestDraftMessage.content.draft_template)
      ? latestDraftMessage.content.draft_template
      : null;
    const latestSubtaskProgress = latestSubtask && isPlainObject(latestSubtask.content.progress)
      ? latestSubtask.content.progress
      : null;
    const latestPlanRevision =
      latestPlanningMessage && typeof latestPlanningMessage.content.revision === "number"
        ? latestPlanningMessage.content.revision
        : null;
    const latestPlanOption = resolvePlanningMessageOption(latestPlanningMessage, session.confirmed_plan_option);
    const hasActiveDraft = !!latestDraftMessage;
    const hasActivePlan = !!latestPlanningMessage;
    const hasConfirmedPlan = typeof session.confirmed_plan_revision === "number";
    const needsConfirmation =
      !!latestPlanningMessage &&
      !planStale &&
      !(
        hasConfirmedPlan &&
        latestPlanRevision !== null &&
        latestPlanRevision === session.confirmed_plan_revision &&
        latestPlanOption !== null &&
        latestPlanOption === session.confirmed_plan_option
      );
    const needsReplan = planStale && (hasActiveDraft || hasActivePlan) && !isExecutionAnchoredSessionStatus(session.status);
    const recommendedConfirmationTarget = resolveSessionConfirmationTarget(sessionId, session);
    const nextRecommendedAction = (() => {
      if (pendingApprovalCount > 0) {
        return {
          action: "approve",
          label: "Resolve approvals",
          detail: "Approve or reject the pending step so the run can continue.",
        };
      }
      if (pendingHumanInputCount > 0) {
        return {
          action: "input",
          label: "Submit requested input",
          detail: "Provide the missing structured input so the current node can resume.",
        };
      }
      if (session.status === "running" || session.status === "waiting_human") {
        if (pendingDagPatchCount > 0) {
          return {
            action: "review_patch",
            label: "Review proposed change",
            detail:
              latestDagPatch && typeof latestDagPatch.content.summary === "string"
                ? `A DAG patch proposal is waiting for review: ${latestDagPatch.content.summary}`
                : "A runtime patch proposal is waiting for review.",
          };
        }
        if (pendingInterventionCount > 0) {
          return {
            action: "review_intervention",
            label: "Intervention captured",
            detail:
              latestIntervention && typeof latestIntervention.content.summary === "string"
                ? `The latest runtime guidance is recorded for review: ${latestIntervention.content.summary}`
                : "Runtime guidance is recorded in the workspace for the next orchestration pass.",
          };
        }
        return {
          action: "monitor",
          label: "Monitor execution",
          detail: "Watch the live run narrative and intervene only if a gate appears.",
        };
      }
      if (session.status === "completed") {
        return {
          action: "review",
          label: "Review outputs",
          detail: "Inspect the final summary and returned artifacts before issuing the next revision.",
        };
      }
      if (needsReplan) {
        return {
          action: hasActivePlan ? "revise" : "draft",
          label: hasActivePlan ? "Revise the route" : "Refresh the draft",
          detail:
            staleReason ||
            (hasActivePlan
              ? "The latest instruction changed the task framing, so the current plan should be revised."
              : "The latest instruction changed the task framing, so the current draft should be refreshed."),
        };
      }
      if (hasActivePlan && needsConfirmation) {
        return {
          action: "confirm",
          label: "Confirm a route",
          detail: "Lock the preferred plan option before opening a real run.",
        };
      }
      if (hasConfirmedPlan) {
        return activePlanValidation?.passed
          ? {
              action: "run",
              label: "Launch the run",
              detail: "Open a strict run from the confirmed plan option.",
            }
          : {
              action: "revise",
              label: "Revise the confirmed route",
              detail: "The confirmed option still carries warnings that should be addressed before a strict run.",
            };
      }
      if (hasActiveDraft) {
        return {
          action: "plan",
          label: "Create plan options",
          detail: "Promote the current DAG draft into a primary route and a backup route.",
        };
      }
      return {
        action: "draft",
        label: "Draft a workflow",
        detail: "Turn the current brief into an initial DAG before comparing full plan options.",
      };
    })();

    return {
      stage:
        session.status === "completed"
          ? "deliver"
          : session.status === "waiting_human"
            ? "waiting"
            : session.status === "running"
              ? "execute"
              : typeof session.confirmed_plan_revision === "number"
                ? "confirm"
                : latestPlanningMessage
                  ? "compare"
                  : latestDraftMessage
                    ? "draft"
                    : "understand",
      working_goal:
        typeof metadata.working_goal === "string" && metadata.working_goal.trim()
          ? metadata.working_goal.trim()
          : session.current_goal,
      constraints_summary: getEffectiveConstraintsSummary(sessionId, session),
      pending_decision:
        typeof metadata.pending_decision === "string" && metadata.pending_decision.trim()
          ? metadata.pending_decision.trim()
          : null,
      open_questions: getSessionOpenQuestions(session),
      latest_orchestrator_intent:
        typeof metadata.latest_orchestrator_intent === "string" && metadata.latest_orchestrator_intent.trim()
          ? metadata.latest_orchestrator_intent.trim()
          : null,
      draft_template_id:
        draftTemplate && typeof draftTemplate.template_id === "string" && draftTemplate.template_id.trim()
          ? draftTemplate.template_id.trim()
          : null,
      draft_template_name:
        draftTemplate && typeof draftTemplate.name === "string" && draftTemplate.name.trim()
          ? draftTemplate.name.trim()
          : null,
      draft_node_count:
        draftTemplate && Array.isArray(draftTemplate.nodes) ? draftTemplate.nodes.length : null,
      has_active_draft: hasActiveDraft,
      active_plan_revision: activePlanRevision,
      active_plan_option: activePlanOption,
      latest_plan_revision: latestPlanRevision,
      latest_plan_option: latestPlanOption,
      has_active_plan: hasActivePlan,
      has_confirmed_plan: hasConfirmedPlan,
      active_plan_template_id:
        activePlanContent && typeof activePlanContent.template_id === "string" && activePlanContent.template_id.trim()
          ? activePlanContent.template_id.trim()
          : null,
      active_plan_template_name:
        activePlanContent && typeof activePlanContent.template_name === "string" && activePlanContent.template_name.trim()
          ? activePlanContent.template_name.trim()
          : null,
      active_plan_node_count: activePlanNodeCount,
      active_plan_ready_frontier_count: activePlanReadyFrontierCount,
      active_plan_warning_count: activePlanWarnings.length,
      active_plan_ready_for_strict_run:
        typeof activePlanValidation?.passed === "boolean"
          ? activePlanValidation.passed && activePlanWarnings.length === 0
          : null,
      active_plan_first_warning: activePlanWarnings[0] || null,
      confirmed_plan_revision: session.confirmed_plan_revision,
      confirmed_plan_option: session.confirmed_plan_option,
      plan_stale: planStale,
      stale_reason: staleReason,
      needs_replan: needsReplan,
      needs_confirmation: needsConfirmation,
      suggested_plan_revision: recommendedConfirmationTarget.revision,
      suggested_plan_option: recommendedConfirmationTarget.option,
      next_recommended_action: nextRecommendedAction.action,
      next_recommended_label: nextRecommendedAction.label,
      next_recommended_detail: nextRecommendedAction.detail,
      latest_run_id: session.latest_run_id,
      run_status: latestRunSummary && typeof latestRunSummary.content.status === "string"
        ? latestRunSummary.content.status
        : null,
      latest_run_summary:
        latestRunSummary && typeof latestRunSummary.content.current_summary === "string"
          ? latestRunSummary.content.current_summary
          : null,
      latest_subtask:
        latestSubtask && typeof latestSubtask.content.node_name === "string"
          ? {
              node_name: latestSubtask.content.node_name,
              status:
                typeof latestSubtask.content.status === "string"
                  ? latestSubtask.content.status
                  : null,
              progress_percent:
                latestSubtaskProgress && typeof latestSubtaskProgress.percent === "number"
                  ? latestSubtaskProgress.percent
                  : null,
              progress_message:
                latestSubtaskProgress && typeof latestSubtaskProgress.message === "string"
                  ? latestSubtaskProgress.message
                  : null,
            }
          : null,
      pending_approval_count: pendingApprovalCount,
      pending_human_input_count: pendingHumanInputCount,
      pending_intervention_count: pendingInterventionCount,
      pending_dag_patch_count: pendingDagPatchCount,
      latest_intervention_id:
        latestIntervention && typeof latestIntervention.content.intervention_id === "string"
          ? latestIntervention.content.intervention_id
          : null,
      latest_intervention_kind:
        latestIntervention && typeof latestIntervention.content.kind === "string"
          ? latestIntervention.content.kind
          : null,
      latest_intervention_status:
        latestIntervention && typeof latestIntervention.content.status === "string"
          ? latestIntervention.content.status
          : null,
      latest_intervention_summary:
        latestIntervention && typeof latestIntervention.content.summary === "string"
          ? latestIntervention.content.summary
          : null,
      latest_dag_patch_id:
        latestDagPatch && typeof latestDagPatch.content.patch_id === "string"
          ? latestDagPatch.content.patch_id
          : null,
      latest_dag_patch_status:
        latestDagPatch && typeof latestDagPatch.content.status === "string"
          ? latestDagPatch.content.status
          : null,
      latest_dag_patch_summary:
        latestDagPatch && typeof latestDagPatch.content.summary === "string"
          ? latestDagPatch.content.summary
          : null,
      artifact_count: artifactCount,
    };
  }

  function getLatestMessageByKinds(
    sessionId: string,
    kinds: SessionMessageRecord["kind"][],
  ): SessionMessageRecord | null {
    const messages = buildSessionThreadMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (kinds.includes(message.kind)) {
        return message;
      }
    }
    return null;
  }

  function syncSessionWorkingState(sessionId: string, session: SessionRecord): void {
    const workspaceState = buildSessionWorkspaceState(sessionId, session);
    const threadMessages = buildSessionThreadMessages(sessionId);
    const missionProjection = buildMissionWorkspaceProjection({
      session,
      messages: threadMessages,
      workspaceState,
    });
    const persistedMissionState = buildPersistedMissionContractState(missionProjection);
    const metadata = getSessionMetadataObject(session);
    session.metadata = {
      ...metadata,
      workspace_state: workspaceState,
      mission_route_state: persistedMissionState.routeState,
      mission_requested_outputs: persistedMissionState.requestedOutputs,
      mission_revision_lineage: persistedMissionState.revisionLineage,
      mission_spec_contract: persistedMissionState.specContract,
    };
    session.mission_spec = missionProjection.missionSpec;
    session.mission_spec_contract = missionProjection.missionSpecContract;
    session.mission_snapshot = missionProjection.missionSnapshot;
  }

  function persistSessionDecisionArtifacts(input: {
    session: SessionRecord;
    sessionId: string;
    interpretation: ReturnType<typeof interpretSessionMessage>;
    userText: string;
    orchestratorText: string;
    turnSummaryText?: string;
    createdAt?: string;
  }): SessionMessageRecord {
    const orchestratorMessage = appendSessionMessage({
      sessionId: input.sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text: input.orchestratorText,
      },
      createdAt: input.createdAt,
    });
    appendSessionMessage({
      sessionId: input.sessionId,
      role: "system",
      kind: "goal_update_card",
      content: {
        working_goal: input.interpretation.workingGoal,
        constraints_summary: input.interpretation.constraintsSummary,
        open_questions: input.interpretation.openQuestions,
      },
      createdAt: input.createdAt,
    });
    appendSessionMessage({
      sessionId: input.sessionId,
      role: "system",
      kind: "decision_card",
      content: {
        pending_decision: input.interpretation.pendingDecision,
        latest_orchestrator_intent: input.interpretation.intent,
      },
      createdAt: input.createdAt,
    });
    syncSessionWorkingState(input.sessionId, input.session);
    const workspaceState = getSessionMetadataObject(input.session).workspace_state as Record<string, unknown>;
    const autoTransition =
      input.interpretation.shouldAutoDraft
        ? "draft"
        : input.interpretation.shouldAutoPlan
          ? "plan"
          : input.interpretation.shouldAutoRevise
            ? "revise"
            : input.interpretation.intent === "ask_run"
              ? "run"
              : null;
    appendSessionMessage({
      sessionId: input.sessionId,
      role: "orchestrator",
      kind: "orchestrator_turn",
      content: {
        intent: input.interpretation.intent,
        summary: input.turnSummaryText || input.interpretation.turnText,
        narrative_reply: input.orchestratorText,
        user_text: input.userText,
        user_read: buildSessionTurnUserRead({
          intent: input.interpretation.intent,
          userText: input.userText,
          workingGoal: input.interpretation.workingGoal,
          constraintsSummary: input.interpretation.constraintsSummary,
        }),
        workspace_impact: buildSessionWorkspaceImpact({
          intent: input.interpretation.intent,
          pendingDecision: input.interpretation.pendingDecision,
          routeShouldGoStale: input.interpretation.shouldMarkRouteStale,
          staleReason: input.interpretation.staleReason,
          workingGoal: input.interpretation.workingGoal,
          constraintsSummary: input.interpretation.constraintsSummary,
          primaryOpenQuestion: input.interpretation.primaryOpenQuestion,
          constraintEffect: input.interpretation.constraintEffect,
          shouldAutoDraft: input.interpretation.shouldAutoDraft,
        }),
        next_action_label:
          typeof workspaceState?.next_recommended_label === "string"
            ? workspaceState.next_recommended_label
            : autoTransition === "draft"
              ? "Draft the workflow"
              : autoTransition === "plan"
                ? "Create plan options"
                : autoTransition === "revise"
                  ? "Revise the route"
                  : autoTransition === "run"
                    ? "Open execution"
                    : "Continue the thread",
        next_action_detail:
          typeof workspaceState?.next_recommended_detail === "string"
            ? workspaceState.next_recommended_detail
            : input.interpretation.pendingDecision,
        generated_outputs: buildSessionGeneratedOutputs({
          intent: input.interpretation.intent,
          workingGoal: input.interpretation.workingGoal,
          constraintsSummary: input.interpretation.constraintsSummary,
          openQuestions: input.interpretation.openQuestions,
          routeShouldGoStale: input.interpretation.shouldMarkRouteStale,
          workspaceState,
          primaryOpenQuestion: input.interpretation.primaryOpenQuestion,
          constraintEffect: input.interpretation.constraintEffect,
        }),
        workspace_stage:
          typeof workspaceState?.stage === "string"
            ? workspaceState.stage
            : null,
        auto_transition: autoTransition,
      },
      createdAt: input.createdAt,
    });
    appendSessionMessage({
      sessionId: input.sessionId,
      role: "system",
      kind: "workspace_snapshot_card",
      content: workspaceState,
      createdAt: input.createdAt,
    });
    input.session.updated_at = orchestratorMessage.created_at;
    input.session.last_orchestrator_message_id = orchestratorMessage.message_id;
    return orchestratorMessage;
  }

  function appendAutoOrchestratorTurn(input: {
    session: SessionRecord;
    sessionId: string;
    intent:
      | "ask_draft"
      | "ask_plan"
      | "ask_revise"
      | "ask_confirm"
      | "ask_run";
    summary: string;
    narrativeReply: string;
    userText: string;
    userRead: string;
    workspaceImpact: string;
    generatedOutputs: string[];
    autoTransition: "draft" | "plan" | "revise" | "run";
    nextActionLabel?: string | null;
    nextActionDetail?: string | null;
    createdAt?: string;
  }): void {
    syncSessionWorkingState(input.sessionId, input.session);
    const workspaceState = getSessionMetadataObject(input.session).workspace_state as Record<string, unknown>;
    appendSessionMessage({
      sessionId: input.sessionId,
      role: "orchestrator",
      kind: "orchestrator_turn",
      content: {
        intent: input.intent,
        summary: input.summary,
        narrative_reply: input.narrativeReply,
        user_text: input.userText,
        user_read: input.userRead,
        workspace_impact: input.workspaceImpact,
        next_action_label:
          input.nextActionLabel ||
          (typeof workspaceState?.next_recommended_label === "string"
            ? workspaceState.next_recommended_label
            : null),
        next_action_detail:
          input.nextActionDetail ||
          (typeof workspaceState?.next_recommended_detail === "string"
            ? workspaceState.next_recommended_detail
            : null),
        generated_outputs: input.generatedOutputs,
        workspace_stage:
          typeof workspaceState?.stage === "string" ? workspaceState.stage : null,
        auto_transition: input.autoTransition,
      },
      createdAt: input.createdAt,
    });
    appendSessionMessage({
      sessionId: input.sessionId,
      role: "system",
      kind: "workspace_snapshot_card",
      content: workspaceState,
      createdAt: input.createdAt,
    });
  }

  function persistSessionTransitionOutcome(input: {
    session: SessionRecord;
    sessionId: string;
    text: string;
    latestIntent: string;
    pendingDecision: string;
    errorCode?: string | null;
    failedTransition?: "draft" | "plan" | "confirm" | "revise" | "run";
  }): SessionMessageRecord {
    const orchestratorMessage = appendSessionMessage({
      sessionId: input.sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text: input.text,
        failed_transition: input.failedTransition || null,
        error_code: input.errorCode || null,
      },
    });
    input.session.metadata = {
      ...getSessionMetadataObject(input.session),
      pending_decision: input.pendingDecision,
      latest_orchestrator_intent: input.latestIntent,
    };
    syncSessionWorkingState(input.sessionId, input.session);
    input.session.last_orchestrator_message_id = orchestratorMessage.message_id;
    input.session.updated_at = orchestratorMessage.created_at;
    saveSession(input.session);
    return orchestratorMessage;
  }

  function buildSessionConversationReply(input: {
    session: SessionRecord;
    sessionId: string;
    userText: string;
    seededGoal: boolean;
  }): string {
    const latestPlanningMessage = getLatestMessageByKinds(input.sessionId, ["plan_options_card", "plan_card"]);
    const latestDraftMessage = getLatestMessageByKinds(input.sessionId, ["draft_card"]);
    const { planStale, staleReason } = getSessionRouteStaleState(input.sessionId, input.session);
    const metadata = getSessionMetadataObject(input.session);
    const detectedIntent = detectSessionMessageIntentRefined(input.userText).intent;
    const intent =
      detectedIntent ||
      (typeof metadata.latest_orchestrator_intent === "string"
        ? metadata.latest_orchestrator_intent.trim()
        : null);
    const workingGoal =
      typeof metadata.working_goal === "string" && metadata.working_goal.trim()
        ? metadata.working_goal.trim()
        : input.session.current_goal;
    const constraintsSummary =
      typeof metadata.constraints_summary === "string" && metadata.constraints_summary.trim()
        ? metadata.constraints_summary.trim()
        : null;
    const openQuestions = getSessionOpenQuestions(input.session);
    const primaryOpenQuestion = pickPrimaryOpenQuestion(openQuestions);
    const constraintEffect = inferConstraintEffect(constraintsSummary);
    const confirmedRevision = input.session.confirmed_plan_revision;
    const confirmedOption = input.session.confirmed_plan_option;
    const workspaceState = buildSessionWorkspaceState(input.sessionId, input.session);
    const nextMove =
      typeof workspaceState.next_recommended_detail === "string" && workspaceState.next_recommended_detail.trim()
        ? workspaceState.next_recommended_detail.trim()
        : typeof workspaceState.pending_decision === "string" && workspaceState.pending_decision.trim()
          ? workspaceState.pending_decision.trim()
          : "Keep refining the brief or ask me to generate the next orchestration artifact.";
    const routeState =
      typeof workspaceState.plan_stale === "boolean" && workspaceState.plan_stale
        ? "the current route is stale against the latest brief"
        : typeof workspaceState.confirmed_plan_revision === "number"
          ? `the mission is anchored to route v${workspaceState.confirmed_plan_revision} / ${
              typeof workspaceState.confirmed_plan_option === "string"
                ? workspaceState.confirmed_plan_option
                : "primary"
            }`
          : typeof workspaceState.active_plan_revision === "number"
            ? `the latest active route is v${workspaceState.active_plan_revision} / ${
                typeof workspaceState.active_plan_option === "string"
                  ? workspaceState.active_plan_option
                  : "primary"
              }`
            : workspaceState.has_active_draft === true
              ? "a DAG draft exists, but it has not been promoted into route options yet"
              : "the mission is still being shaped and does not have an active route yet";

    if (intent === "ask_status") {
      return `Right now, ${routeState}. Next I recommend: ${nextMove}`;
    }
    if (planStale && latestPlanningMessage) {
      const revision =
        typeof latestPlanningMessage.content.revision === "number"
          ? latestPlanningMessage.content.revision
          : null;
      return revision
        ? `I recorded that mission change. It shifts the brief enough that route v${revision} should be refreshed before you confirm or run it. ${staleReason || "Revise the route when you want me to rebuild it."}`
        : `I recorded that mission change. The current route should be refreshed before execution continues.`;
    }
    if (latestPlanningMessage?.kind === "plan_options_card" || latestPlanningMessage?.kind === "plan_card") {
      const revision =
        typeof latestPlanningMessage.content.revision === "number"
          ? latestPlanningMessage.content.revision
          : null;
      const selectedOption =
        confirmedRevision === revision && confirmedOption
          ? confirmedOption
          : latestPlanningMessage.kind === "plan_options_card" &&
              latestPlanningMessage.content.selected_option === "alternative"
            ? "alternative"
            : "primary";
      if (revision) {
        return confirmedRevision === revision && confirmedOption
          ? `I logged that note against confirmed route v${revision} / ${selectedOption} without rebuilding it yet. Right now, that confirmed route still stands. Next I recommend: say Revise when you want me to rebuild the route around this new note.`
          : `I logged that note against route v${revision} / ${selectedOption} without rebuilding it yet. Right now, that route still stands. Next I recommend: say Revise when you want me to turn this note into a new route revision.`;
      }
      return "I logged that note. The latest route stays unchanged until you explicitly revise it.";
    }
    if (latestDraftMessage) {
      return "I logged that note without changing the current DAG draft. Right now, the draft remains the active working shape. Next I recommend: promote it into route options when you want a concrete comparison.";
    }
    if (input.seededGoal) {
      if (primaryOpenQuestion) {
        return `Right now, I anchored the mission around: ${workingGoal}. Before I draft the workflow, I need one detail from you: ${primaryOpenQuestion}`;
      }
      return workingGoal
        ? `Right now, I anchored the mission around: ${workingGoal}. There is no active route yet. Next I recommend: ${nextMove}`
        : "I captured the mission brief. Ask for a DAG draft when you want me to start orchestration.";
    }
    if (intent === "add_constraint") {
      if (!latestPlanningMessage && !latestDraftMessage && constraintEffect) {
        return `I folded that into the mission brief. In the next workflow pass, I will reflect it by ${constraintEffect}. Right now, ${routeState}. Next I recommend: ${nextMove}`;
      }
      return constraintsSummary
        ? `I folded that into the mission brief: ${constraintsSummary}. Right now, ${routeState}. Next I recommend: ${nextMove}`
        : `I tightened the mission brief with that instruction. Right now, ${routeState}. Next I recommend: ${nextMove}`;
    }
    if (intent === "clarify" || intent === "capture_goal") {
      if (intent === "clarify") {
        return `I treated that as a follow-up question or note, so the active mission stayed as-is. Right now, ${routeState}. Next I recommend: ${nextMove}`;
      }
      return workingGoal
        ? `Right now, I refreshed the mission around: ${workingGoal}. ${routeState.charAt(0).toUpperCase()}${routeState.slice(1)}. Next I recommend: ${nextMove}`
        : `I updated the active mission. Right now, ${routeState}. Next I recommend: ${nextMove}`;
    }
    return `I logged that note. Right now, ${routeState}. Next I recommend: ${nextMove}`;
  }

  function normalizeTextForIntent(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function includesIntentFragment(text: string, fragments: string[]): boolean {
    return fragments.some((fragment) => text.includes(fragment));
  }

  function detectSessionMessageIntent(userText: string): {
    intent:
      | "capture_goal"
      | "clarify"
      | "add_constraint"
      | "ask_draft"
      | "ask_plan"
      | "ask_revise"
      | "ask_confirm"
      | "ask_run";
    directiveText: string | null;
  } {
    const normalized = normalizeTextForIntent(userText);
    const asksDraft =
      /(^|\b)(draft dag|draft workflow|璧疯崏dag|璧疯崏宸ヤ綔娴亅鍏堝嚭dag|鐢熸垚dag鑽夋)(\b|$)/i.test(userText);
    if (asksDraft) {
      return { intent: "ask_draft", directiveText: null };
    }

    const asksPlan =
      /(^|\b)(create plan|make a plan|plan this|鍑烘柟妗坾鐢熸垚鏂规|寮€濮嬭鍒抾缁欐垜鏂规|涓ゅ鏂规|plan options)(\b|$)/i.test(
        userText,
      );
    if (asksPlan) {
      return { intent: "ask_plan", directiveText: null };
    }

    const asksRun =
      /(^|\b)(run this|start run|execute now|launch run|鐩存帴鎵ц|寮€濮嬫墽琛寍杩愯杩欎釜鏂规)(\b|$)/i.test(userText);
    if (asksRun) {
      return { intent: "ask_run", directiveText: null };
    }

    const asksConfirm =
      /(^|\b)(confirm plan|confirm this|閿佸畾鏂规|纭鏂规|纭杩欎釜鏂规)(\b|$)/i.test(userText);
    if (asksConfirm) {
      return { intent: "ask_confirm", directiveText: null };
    }

    const revisePrefixes = [
      "revise plan:",
      "revise:",
      "淇敼鏂规:",
      "璋冩暣鏂规:",
      "璋冩暣璁″垝:",
      "淇鏂规:",
    ];
    const matchedPrefix = revisePrefixes.find((prefix) =>
      normalizeTextForIntent(userText).startsWith(normalizeTextForIntent(prefix)),
    );
    if (matchedPrefix) {
      return {
        intent: "ask_revise",
        directiveText: userText.slice(matchedPrefix.length).trim() || userText.trim(),
      };
    }

    const asksRevise =
      /(^|\b)(revise|adjust|change the plan|淇敼|璋冩暣|淇)(\b|$)/i.test(userText) &&
      /plan|鏂规|璁″垝|workflow|dag/i.test(userText);
    if (asksRevise) {
      return { intent: "ask_revise", directiveText: userText.trim() };
    }

    const looksConstraint =
      /(must|should|need to|don't|do not|without|include|exclude|tone|audience|deadline|budget|闇€瑕亅蹇呴』|涓嶈|鍖呭惈|鎺掗櫎|鍙ｅ惢|鍙椾紬|鎴|棰勭畻)/i.test(
        userText,
      );
    if (looksConstraint) {
      return { intent: "add_constraint", directiveText: null };
    }

    if (userText.trim().length <= 120) {
      return { intent: "clarify", directiveText: null };
    }

    return { intent: "capture_goal", directiveText: null };
  }

  function detectSessionMessageIntentRefined(userText: string): {
    intent:
      | "capture_goal"
      | "clarify"
      | "ask_status"
      | "add_constraint"
      | "ask_draft"
      | "ask_plan"
      | "ask_revise"
      | "ask_confirm"
      | "ask_run";
    directiveText: string | null;
  } {
    const normalized = normalizeTextForIntent(userText);
    if (!normalized) {
      return { intent: "clarify", directiveText: null };
    }

    const asksStatus = includesIntentFragment(normalized, [
      "what is the progress",
      "what's the progress",
      "status now",
      "current status",
      "where are we",
      "where is this at",
      "what changed",
      "what changed in the mission",
      "next best move",
      "next move",
      "what should we do next",
      "summarize what changed",
      "give me the progress",
      "progress now",
      "\u8fdb\u5ea6",
      "\u73b0\u5728\u5230\u54ea\u4e86",
      "\u76ee\u524d\u600e\u4e48\u6837",
      "\u73b0\u5728\u600e\u4e48\u6837",
      "\u4e0b\u4e00\u6b65",
      "\u63a5\u4e0b\u6765\u600e\u4e48\u505a",
      "\u603b\u7ed3\u4e0b\u53d8\u5316",
      "\u8bf4\u4e0b\u73b0\u5728\u72b6\u6001",
    ]);
    if (asksStatus) {
      return { intent: "ask_status", directiveText: null };
    }

    const asksDraft = includesIntentFragment(normalized, [
      "draft dag",
      "draft the dag",
      "draft workflow",
      "draft the workflow",
      "generate dag draft",
      "create dag draft",
      "dag draft",
      "\u8d77\u8349dag",
      "\u751f\u6210dag",
      "\u8349\u62dfdag",
      "\u5de5\u4f5c\u6d41\u8349\u6848",
    ]);
    if (asksDraft) {
      return { intent: "ask_draft", directiveText: null };
    }

    const asksPlan = includesIntentFragment(normalized, [
      "create plan",
      "make a plan",
      "plan this",
      "build a plan",
      "plan options",
      "compare plans",
      "compare plan options",
      "full plan",
      "alternative plan",
      "alternative plans",
      "\u751f\u6210\u65b9\u6848",
      "\u51fa\u65b9\u6848",
      "\u8ba1\u5212\u65b9\u6848",
      "\u4e24\u5957\u65b9\u6848",
      "\u6bd4\u8f83\u65b9\u6848",
    ]);
    if (asksPlan) {
      return { intent: "ask_plan", directiveText: null };
    }

    const asksRun = includesIntentFragment(normalized, [
      "run this",
      "run the plan",
      "start run",
      "execute now",
      "execute this",
      "execute this plan",
      "launch run",
      "start execution",
      "\u76f4\u63a5\u6267\u884c",
      "\u5f00\u59cb\u6267\u884c",
      "\u5f00\u59cb\u8fd0\u884c",
      "\u8fd0\u884c\u8fd9\u4e2a\u65b9\u6848",
    ]);
    if (asksRun) {
      return { intent: "ask_run", directiveText: null };
    }

    const asksConfirm = includesIntentFragment(normalized, [
      "confirm plan",
      "confirm this",
      "confirm this plan",
      "lock this plan",
      "lock the plan",
      "\u786e\u8ba4\u65b9\u6848",
      "\u786e\u8ba4\u8fd9\u4e2a\u65b9\u6848",
      "\u9501\u5b9a\u65b9\u6848",
      "\u9501\u5b9a\u8ba1\u5212",
    ]);
    if (asksConfirm) {
      return { intent: "ask_confirm", directiveText: null };
    }

    const revisePrefixes = [
      "revise plan:",
      "revise:",
      "adjust plan:",
      "change plan:",
      "\u4fee\u6539\u65b9\u6848:",
      "\u8c03\u6574\u65b9\u6848:",
      "\u8c03\u6574\u8ba1\u5212:",
      "\u4fee\u8ba2\u65b9\u6848:",
    ];
    const matchedPrefix = revisePrefixes.find((prefix) => normalized.startsWith(normalizeTextForIntent(prefix)));
    if (matchedPrefix) {
      return {
        intent: "ask_revise",
        directiveText: userText.slice(matchedPrefix.length).trim() || userText.trim(),
      };
    }

    const asksRevise =
      (/(^|\b)(revise|adjust|rework|modify|change the plan)(\b|$)/i.test(userText) ||
        includesIntentFragment(normalized, [
          "\u4fee\u6539",
          "\u8c03\u6574",
          "\u4fee\u8ba2",
          "\u91cd\u65b0\u89c4\u5212",
        ])) &&
      (/(^|\b)(plan|workflow|dag|route)(\b|$)/i.test(userText) ||
        includesIntentFragment(normalized, ["\u65b9\u6848", "\u8ba1\u5212", "\u6d41\u7a0b"]));
    if (asksRevise) {
      return { intent: "ask_revise", directiveText: userText.trim() };
    }

    const asksQuestion =
      /[?]\s*$/.test(userText.trim()) ||
      /^(what|which|how|why|when|where|who|can we|could we|should we|do we|is it|are we|what if|how about)\b/i.test(
        normalized,
      ) ||
      includesIntentFragment(normalized, [
        "\u4e0b\u4e00\u6b65",
        "\u63a5\u4e0b\u6765",
        "\u600e\u4e48",
        "\u5982\u4f55",
        "\u4e3a\u4ec0\u4e48",
        "\u662f\u5426",
        "\u8981\u4e0d\u8981",
      ]);
    if (asksQuestion) {
      return { intent: "clarify", directiveText: null };
    }

    const startsWithConstraintVerb =
      /^(keep|make|add|include|exclude|avoid|focus|highlight|surface|use|target|limit|cap)\b/i.test(normalized) ||
      includesIntentFragment(normalized, [
        "\u4fdd\u6301",
        "\u52a0\u4e0a",
        "\u8865\u5145",
        "\u5305\u542b",
        "\u6392\u9664",
        "\u4e0d\u8981",
        "\u907f\u514d",
        "\u7a81\u51fa",
        "\u5f3a\u8c03",
        "\u805a\u7126",
        "\u63a7\u5236\u5728",
      ]);
    const mentionsConstraintDetail = includesIntentFragment(normalized, [
      "keep it",
      "keep the",
      "make it",
      "make the",
      "must be",
      "need to",
      "needs to",
      "without",
      "do not",
      "don't",
      "tone",
      "audience",
      "deadline",
      "budget",
      "call to action",
      "cta",
      "top 3",
      "next action",
      "next actions",
      "risk",
      "risks",
      "concise",
      "crisp",
      "practical",
      "warm",
      "direct",
      "low fluff",
      "surface",
      "highlight",
      "focus on",
      "success criteria",
      "deliverable",
      "wording",
      "\u53d7\u4f17",
      "\u53e3\u543b",
      "\u8bed\u6c14",
      "\u622a\u6b62",
      "\u9884\u7b97",
      "\u98ce\u9669",
      "\u884c\u52a8",
      "\u7b80\u6d01",
      "\u76f4\u63a5",
      "\u4ea4\u4ed8\u7269",
        "\u7a81\u51fa",
        "\u5f3a\u8c03",
      ]);
    const looksLikeStatusQuestion = includesIntentFragment(normalized, [
      "what is the progress",
      "what's the progress",
      "status now",
      "current status",
      "where are we",
      "where is this at",
      "what changed",
      "next best move",
      "next move",
      "what should we do next",
      "summarize what changed",
      "give me the progress",
      "progress now",
      "\u8fdb\u5ea6",
      "\u73b0\u5728\u5230\u54ea\u4e86",
      "\u73b0\u5728\u600e\u4e48\u6837",
      "\u76ee\u524d\u600e\u4e48\u6837",
    ]);
    if ((startsWithConstraintVerb || mentionsConstraintDetail) && !looksLikeStatusQuestion) {
      return { intent: "add_constraint", directiveText: null };
    }

    const looksLikeGoalRefresh =
      /^(prepare|build|create|write|research|design|analyze|review|summarize|produce|generate|organize)\b/i.test(
        normalized,
      ) ||
      includesIntentFragment(normalized, [
        "\u51c6\u5907",
        "\u521b\u5efa",
        "\u751f\u6210",
        "\u64b0\u5199",
        "\u7814\u7a76",
        "\u8bbe\u8ba1",
        "\u5206\u6790",
        "\u603b\u7ed3",
        "\u6574\u7406",
      ]);
    if (looksLikeGoalRefresh) {
      return { intent: "capture_goal", directiveText: null };
    }

    if (userText.trim().length <= 160) {
      return { intent: "clarify", directiveText: null };
    }

    return { intent: "capture_goal", directiveText: null };
  }

  function summarizeSessionConstraints(messages: SessionMessageRecord[], currentGoal: string | null): string | null {
    const userTexts = messages
      .filter((message) => message.role === "user" && message.kind === "text")
      .map((message) => (typeof message.content.text === "string" ? message.content.text.trim() : ""))
      .filter((text) => !!text);
    const constraintTexts = userTexts.filter((text) => {
      if (text === currentGoal) {
        return false;
      }
      const intent = detectSessionMessageIntentRefined(text).intent;
      return intent === "add_constraint";
    });
    const constraints = [...new Set(constraintTexts)].slice(-3);
    if (constraints.length === 0) {
      return null;
    }
    return constraints.join(" | ");
  }

  function compactText(value: string, maxLength = 140): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  }

  function inferSessionOpenQuestions(sessionId: string, session: SessionRecord): string[] {
    const messages = buildSessionThreadMessages(sessionId);
    const hasDraft = messages.some((message) => message.kind === "draft_card");
    const hasPlan = messages.some(
      (message) => message.kind === "plan_card" || message.kind === "plan_options_card",
    );
    const metadata = getSessionMetadataObject(session);
    const constraintsSummary =
      typeof metadata.constraints_summary === "string" ? metadata.constraints_summary.trim() : "";
    const workingGoal =
      typeof metadata.working_goal === "string" && metadata.working_goal.trim()
        ? metadata.working_goal.trim()
        : session.current_goal || "";
    const questions: string[] = [];
    if (!constraintsSummary && !hasConstraintSignalsInBrief(workingGoal)) {
      questions.push("What constraints or success criteria should shape the workflow?");
    }
    if (!hasDraft && !hasPlan) {
      questions.push("Should the orchestrator draft a DAG first or go straight to full plan options?");
    }
    if (hasPlan && session.confirmed_plan_revision === null) {
      questions.push("Which plan option should be confirmed for execution?");
    }
    return questions.slice(0, 3);
  }

  function isMetaDraftChoiceQuestion(question: string): boolean {
    return /draft a DAG first|go straight to full plan options/i.test(question);
  }

  function pickPrimaryOpenQuestion(questions: string[]): string | null {
    for (const question of questions) {
      if (!isMetaDraftChoiceQuestion(question)) {
        return question;
      }
    }
    return null;
  }

  function hasConstraintSignalsInBrief(text: string | null): boolean {
    if (!text) {
      return false;
    }
    const normalized = normalizeTextForIntent(text);
    return includesIntentFragment(normalized, [
      "keep it",
      "keep the",
      "make it",
      "make the",
      "must be",
      "need to",
      "needs to",
      "without",
      "do not",
      "don't",
      "tone",
      "audience",
      "deadline",
      "budget",
      "top 3",
      "next action",
      "next actions",
      "risk",
      "risks",
      "concise",
      "crisp",
      "practical",
      "warm",
      "direct",
      "review",
      "checkpoint",
      "approval",
      "sign-off",
      "parallel",
      "fan-out",
      "multi-agent",
      "safe",
      "safest",
      "compare",
      "route first",
      "show me",
      "include",
      "highlight",
      "focus on",
      "success criteria",
      "deliverable",
      "鍙椾紬",
      "鍙ｅ惢",
      "璇皵",
      "鎴",
      "棰勭畻",
      "椋庨櫓",
      "琛屽姩",
      "concise",
      "鐩存帴",
      "deliverable",
      "绐佸嚭",
      "寮鸿皟",
      "瀹℃壒",
      "澶嶆牳",
      "妫€鏌ョ偣",
      "骞惰",
      "澶氳矾",
      "瀹夊叏",
      "绋冲Ε",
    ]);
  }

  function hasRouteShapingConstraintCue(text: string | null): boolean {
    if (!text) {
      return false;
    }
    const normalized = normalizeTextForIntent(text);
    return includesIntentFragment(normalized, [
      "research",
      "context collection",
      "discovery",
      "summary",
      "conclusion",
      "recap",
      "review",
      "approval",
      "checkpoint",
      "sign-off",
      "parallel",
      "fan-out",
      "fanout",
      "multi-agent",
      "鑳屾櫙",
      "璋冪爺",
      "context",
      "鎬荤粨",
      "鎽樿",
      "缁撹",
      "瀹℃壒",
      "澶嶆牳",
      "妫€鏌ョ偣",
      "骞惰",
      "澶氳矾",
    ]);
  }

  function inferConstraintEffect(constraintsSummary: string | null): string | null {
    if (!constraintsSummary) {
      return null;
    }
    const normalized = normalizeTextForIntent(constraintsSummary);
    const effects: string[] = [];

    if (includesIntentFragment(normalized, ["research", "context collection", "discovery", "context"])) {
      effects.push("opening with a research and context-collection step");
    }
    if (includesIntentFragment(normalized, ["summary", "conclusion", "recap", "recovery summary", "鎬荤粨", "鎽樿", "缁撹"])) {
      effects.push("adding a dedicated summary step near the end");
    }
    if (includesIntentFragment(normalized, ["review", "approval", "checkpoint", "sign-off", "瀹℃壒", "澶嶆牳", "妫€鏌ョ偣"])) {
      effects.push("inserting a review checkpoint before final delivery");
    }
    if (includesIntentFragment(normalized, ["parallel", "fan-out", "fanout", "multi-agent", "骞惰", "澶氳矾", "澶?agent"])) {
      effects.push("splitting part of the workflow into a wider fan-out");
    }
    if (includesIntentFragment(normalized, ["safe", "safest", "risk", "risks", "瀹夊叏", "绋冲Ε", "椋庨櫓"])) {
      effects.push("biasing the early route toward safer comparison and risk checks");
    }
    if (includesIntentFragment(normalized, ["concise", "practical", "direct"])) {
      effects.push("keeping the deliverable compact and execution-focused");
    }

    const uniqueEffects = [...new Set(effects)].slice(0, 2);
    if (uniqueEffects.length === 0) {
      return null;
    }
    if (uniqueEffects.length === 1) {
      return uniqueEffects[0];
    }
    return `${uniqueEffects[0]} and ${uniqueEffects[1]}`;
  }

  function buildOrchestratorDecisionText(
    sessionId: string,
    intent: ReturnType<typeof detectSessionMessageIntentRefined>["intent"],
    session: SessionRecord,
  ): string {
    const { planStale } = getSessionRouteStaleState(sessionId, session);
    switch (intent) {
      case "ask_status":
        return "Summarizing the current mission state and the next recommended move.";
      case "ask_draft":
        return "Preparing the next DAG draft from the current task framing.";
      case "ask_plan":
        return "Compiling comparable plan options from the current task framing.";
      case "ask_revise":
        return "Using the latest instruction as plan revision guidance.";
      case "ask_confirm":
        return planStale
          ? "The last instruction changed the task framing, so the route should be revised before confirmation."
          : "A plan confirmation target is needed before the execution source can be locked.";
      case "ask_run":
        return "A confirmed plan is preferred before opening a real run.";
      case "add_constraint":
        return "The task brief was tightened with new constraints and is ready for the next orchestration step.";
      case "clarify":
        return "The latest message was treated as a follow-up question or note without mutating the active route.";
      case "capture_goal":
      default:
        return "The task objective was refreshed and is ready to be shaped into a workflow.";
    }
  }

  function buildSessionTurnSummary(input: {
    intent: ReturnType<typeof detectSessionMessageIntentRefined>["intent"];
    userText: string;
    workingGoal: string | null;
    constraintsSummary: string | null;
    routeShouldGoStale: boolean;
    staleReason: string | null;
    primaryOpenQuestion: string | null;
    constraintEffect: string | null;
    shouldAutoDraft: boolean;
  }): string {
    const userRead = compactText(input.userText, 120);
    switch (input.intent) {
      case "ask_status":
        return "I reviewed the live mission state and surfaced the next best move.";
      case "ask_draft":
        return "I am turning the current mission into a DAG draft so we can inspect the first workflow shape.";
      case "ask_plan":
        return "I am compiling complete route options for the current mission so we can compare tradeoffs.";
      case "ask_revise":
        return `I am revising the active route using: "${userRead}".`;
      case "ask_run":
        return "I am moving the selected route toward a real run.";
      case "ask_confirm":
        return "I am locking the current route as the execution source.";
      case "add_constraint":
        if (input.shouldAutoDraft) {
          return input.constraintEffect
            ? `I absorbed the new constraint and now have enough context to draft the first workflow shape by ${input.constraintEffect}.`
            : "I absorbed the new constraint and now have enough context to draft the first workflow shape.";
        }
        return input.constraintsSummary
          ? `I absorbed this into the mission brief: ${compactText(input.constraintsSummary, 140)}. The next draft or route will use the updated constraints.`
          : `I absorbed this into the mission brief: "${userRead}". The next draft or route will use the updated constraints.`;
      case "clarify":
        return input.routeShouldGoStale
          ? input.staleReason || "The mission changed enough that the current route now needs a refresh."
          : "I treated this as a follow-up without changing the active route.";
      case "capture_goal":
      default:
        if (input.primaryOpenQuestion) {
          return `I anchored the mission and surfaced the one missing detail I need before drafting: ${compactText(input.primaryOpenQuestion, 140)}.`;
        }
        return input.workingGoal
          ? `I anchored the mission around: ${compactText(input.workingGoal, 140)}. There is no active route yet.`
          : `I captured the latest instruction as the active mission: "${userRead}".`;
    }
  }

  function buildSessionTurnUserRead(input: {
    intent: ReturnType<typeof detectSessionMessageIntentRefined>["intent"];
    userText: string;
    workingGoal: string | null;
    constraintsSummary: string | null;
  }): string | null {
    switch (input.intent) {
      case "ask_status":
        return "You want a live readback of mission progress, route state, and the next best move.";
      case "ask_draft":
        return "You want the current brief translated into a draft workflow.";
      case "ask_plan":
        return "You want the current brief compiled into comparable plan options.";
      case "ask_revise":
        return `You want the route adjusted using: ${compactText(input.userText, 120)}`;
      case "ask_run":
        return "You want the selected route moved into real execution.";
      case "ask_confirm":
        return "You want the current route locked as the execution source.";
      case "add_constraint":
        return input.constraintsSummary
          ? `You added a constraint set: ${compactText(input.constraintsSummary, 120)}`
          : `You added a new constraint: ${compactText(input.userText, 120)}`;
      case "clarify":
        return `You asked for more context or explanation around: ${compactText(input.userText, 120)}`;
      case "capture_goal":
      default:
        return input.workingGoal
          ? `You set the working goal to: ${compactText(input.workingGoal, 120)}`
          : `You defined the task around: ${compactText(input.userText, 120)}`;
    }
  }

  function buildSessionWorkspaceImpact(input: {
    intent: ReturnType<typeof detectSessionMessageIntentRefined>["intent"];
    pendingDecision: string | null;
    routeShouldGoStale: boolean;
    staleReason: string | null;
    workingGoal: string | null;
    constraintsSummary: string | null;
    primaryOpenQuestion: string | null;
    constraintEffect: string | null;
    shouldAutoDraft: boolean;
  }): string {
    if (input.routeShouldGoStale) {
      return input.staleReason || "The current route is stale and needs a refresh before it should be confirmed or run.";
    }
    switch (input.intent) {
      case "ask_status":
        return "The workspace stayed in readback mode without mutating the active route.";
      case "ask_draft":
        return "The workspace is moving from briefing into DAG drafting.";
      case "ask_plan":
        return "The workspace is moving from task framing into plan comparison.";
      case "ask_revise":
        return "The workspace is holding the latest instruction as route revision guidance.";
      case "ask_run":
        return "The workspace is preparing to open a real run from the selected route.";
      case "ask_confirm":
        return "The workspace is checking whether one route can be locked as the execution source.";
      case "add_constraint":
        if (input.shouldAutoDraft) {
          return input.constraintEffect
            ? `The mission brief is complete enough to move directly into DAG drafting, and the next workflow will change by ${input.constraintEffect}.`
            : "The mission brief is complete enough to move directly into DAG drafting.";
        }
        return input.constraintsSummary
          ? "The mission brief changed, and the next draft or route will use the updated constraints."
          : "The mission brief was tightened with a new instruction.";
      case "clarify":
        return input.workingGoal
          ? "The workspace kept the active route unchanged while answering the follow-up."
          : "The workspace kept the active mission unchanged while answering the follow-up.";
      case "capture_goal":
      default:
        if (input.primaryOpenQuestion) {
          return `The workspace is waiting on one missing planning detail before it drafts the first workflow shape: ${input.primaryOpenQuestion}`;
        }
        return input.workingGoal
          ? "The working goal was refreshed and is ready for orchestration."
          : input.pendingDecision || "The task context was updated for the next orchestration pass.";
    }
  }

  function buildSessionGeneratedOutputs(input: {
    intent: ReturnType<typeof detectSessionMessageIntentRefined>["intent"];
    workingGoal: string | null;
    constraintsSummary: string | null;
    openQuestions: string[];
    routeShouldGoStale: boolean;
    workspaceState: Record<string, unknown>;
    primaryOpenQuestion: string | null;
    constraintEffect: string | null;
  }): string[] {
    const outputs: string[] = [];
    if (input.workingGoal) {
      outputs.push(`Working goal: ${compactText(input.workingGoal, 72)}`);
    }
    if (input.constraintsSummary) {
      outputs.push(`Constraints: ${compactText(input.constraintsSummary, 72)}`);
    }
    const actionableOpenQuestions = input.openQuestions.filter(
      (question) => !isMetaDraftChoiceQuestion(question),
    );
    if (actionableOpenQuestions.length > 0) {
      outputs.push(`Open questions: ${actionableOpenQuestions.length}`);
    }
    if (input.primaryOpenQuestion) {
      outputs.push(`Need answer: ${compactText(input.primaryOpenQuestion, 72)}`);
    }
    if (input.constraintEffect) {
      outputs.push(`Route change: ${compactText(input.constraintEffect, 72)}`);
    }
    if (input.routeShouldGoStale) {
      outputs.push("Route status: refresh required");
    }
    const stage =
      typeof input.workspaceState.stage === "string" && input.workspaceState.stage.trim()
        ? input.workspaceState.stage.trim()
        : null;
    if (stage) {
      outputs.push(`Workspace stage: ${stage}`);
    }
    switch (input.intent) {
      case "ask_status":
        outputs.push("Requested output: mission status readback");
        break;
      case "ask_draft":
        outputs.push("Requested output: DAG draft");
        break;
      case "ask_plan":
        outputs.push("Requested output: plan options");
        break;
      case "ask_revise":
        outputs.push("Requested output: route revision");
        break;
      case "ask_confirm":
        outputs.push("Requested output: execution lock");
        break;
      case "ask_run":
        outputs.push("Requested output: real run");
        break;
      default:
        break;
    }
    return outputs.slice(0, 5);
  }

  function interpretSessionMessage(input: {
    sessionId: string;
    session: SessionRecord;
    userText: string;
    seededGoal: boolean;
  }): {
    intent: ReturnType<typeof detectSessionMessageIntentRefined>["intent"];
    workingGoal: string | null;
    constraintsSummary: string | null;
    pendingDecision: string | null;
    openQuestions: string[];
    primaryOpenQuestion: string | null;
    turnText: string;
    shouldAutoDraft: boolean;
    shouldAutoPlan: boolean;
    shouldAutoRevise: boolean;
    reviseInstructions: string | null;
    shouldMarkRouteStale: boolean;
    staleReason: string | null;
    constraintEffect: string | null;
  } {
    const detected = input.seededGoal
      ? {
          intent: "capture_goal" as const,
          directiveText: null,
        }
      : detectSessionMessageIntentRefined(input.userText);
    const persistedMessages = listSessionMessages(input.sessionId);
    const latestPlanningMessage = getLatestMessageByKinds(input.sessionId, ["plan_options_card", "plan_card"]);
    const latestDraftMessage = getLatestMessageByKinds(input.sessionId, ["draft_card"]);
    const workingGoal =
      input.seededGoal || detected.intent === "capture_goal"
        ? input.userText.trim()
        : input.session.current_goal || getLatestSessionGoal(input.sessionId);
    const constraintsSummary = summarizeSessionConstraints(
      [...persistedMessages, {
        message_id: "preview",
        session_id: input.sessionId,
        role: "user",
        kind: "text",
        content: { text: input.userText },
        created_at: nowIso(),
        linked_run_id: null,
        linked_node_run_id: null,
      }],
      workingGoal,
    );
    const pendingDecision = buildOrchestratorDecisionText(
      input.sessionId,
      detected.intent,
      input.session,
    );
    const previewSession: SessionRecord = {
      ...input.session,
      current_goal: workingGoal,
      metadata: {
        ...getSessionMetadataObject(input.session),
        working_goal: workingGoal,
        constraints_summary: constraintsSummary,
        pending_decision: pendingDecision,
      },
    };
    const routeExists = !!latestPlanningMessage || !!latestDraftMessage;
    const routeShouldGoStale =
      routeExists &&
      !input.seededGoal &&
      (detected.intent === "add_constraint" || detected.intent === "capture_goal");
    const staleReason =
      routeShouldGoStale
        ? latestPlanningMessage
          ? "The latest instruction changed the brief after a plan already existed."
          : "The latest instruction changed the brief after a DAG draft already existed."
        : null;
    const openQuestions = inferSessionOpenQuestions(input.sessionId, previewSession);
    const primaryOpenQuestion = pickPrimaryOpenQuestion(openQuestions);
    const constraintEffect = inferConstraintEffect(constraintsSummary);
    const goalLooksDetailed =
      !!workingGoal &&
      (workingGoal.length >= 60 ||
        /,| and | with | compare | first | include | keep | show | route /i.test(workingGoal));
    const shouldAutoDraft =
      !routeExists &&
      !!workingGoal &&
      (detected.intent === "ask_draft" ||
        (detected.intent === "capture_goal" && !primaryOpenQuestion && goalLooksDetailed) ||
        (detected.intent === "add_constraint" &&
          !!input.session.current_goal &&
          hasRouteShapingConstraintCue(constraintsSummary || input.userText)));
    const turnText = buildSessionTurnSummary({
      intent: detected.intent,
      userText: input.userText,
      workingGoal,
      constraintsSummary,
      routeShouldGoStale,
      staleReason,
      primaryOpenQuestion,
      constraintEffect,
      shouldAutoDraft,
    });
    return {
      intent: detected.intent,
      workingGoal,
      constraintsSummary,
      pendingDecision,
      openQuestions,
      primaryOpenQuestion,
      turnText,
      shouldAutoDraft,
      shouldAutoPlan: detected.intent === "ask_plan",
      shouldAutoRevise: detected.intent === "ask_revise",
      reviseInstructions: detected.directiveText,
      shouldMarkRouteStale: routeShouldGoStale,
      staleReason,
      constraintEffect,
    };
  }

  function getSessionLinkedRunIds(sessionId: string): string[] {
    const session = getSession(sessionId);
    if (!session) {
      return [];
    }

    const linkedRunIds = new Set<string>(session.active_run_ids);
    if (session.latest_run_id) {
      linkedRunIds.add(session.latest_run_id);
    }
    for (const message of listSessionMessages(sessionId)) {
      if (message.linked_run_id) {
        linkedRunIds.add(message.linked_run_id);
      }
    }

    return [...linkedRunIds].filter((runId) => !!getRun(runId));
  }

  function getSessionIdsLinkedToRun(runId: string): string[] {
    const sessionIds = new Set<string>();
    for (const session of listSessions()) {
      if (session.latest_run_id === runId || session.active_run_ids.includes(runId)) {
        sessionIds.add(session.session_id);
        continue;
      }
      if (listSessionMessages(session.session_id).some((message) => message.linked_run_id === runId)) {
        sessionIds.add(session.session_id);
      }
    }
    return [...sessionIds];
  }

  function sessionProjectionMessageId(prefix: string, sessionId: string, suffix: string): string {
    return `${prefix}_${sessionId}_${suffix}`;
  }

  function inferInterventionKind(content: string): SessionInterventionKind {
    const normalized = content.toLowerCase();
    if (/(resume|continue|carry on|proceed|restart|\u7ee7\u7eed|\u6062\u590d|\u7ee7\u7eed\u6267\u884c)/iu.test(content)) {
      return "resume_request";
    }
    if (/(pause|hold|stop|wait|\u6682\u505c|\u5148\u6682\u505c|\u505c\u4e00\u4e0b|\u7b49\u4e00\u4e0b)/iu.test(content)) {
      return "pause_request";
    }
    if (/(skip|omit|bypass|\u8df3\u8fc7|\u7565\u8fc7|\u4e0d\u8981\u6267\u884c)/iu.test(content)) {
      return "skip_request";
    }
    if (/(add|insert|append|include|\u6dfb\u52a0|\u65b0\u589e|\u52a0\u4e00\u4e2a|\u63d2\u5165|\u8865\u4e00\u4e2a)/iu.test(content)) {
      return "add_node_request";
    }
    if (/(parallel|fan-?out|concurrent|concurrency|workers?|agents?|\u5e76\u884c|\u5e76\u53d1|\u540c\u65f6|\u591a\u8def)/iu.test(content)) {
      return "parallelism_request";
    }
    if (/(change|revise|adjust|replace|\u8c03\u6574|\u4fee\u6539|\u53d8\u66f4|\u66ff\u6362)/iu.test(content)) {
      return "change_request";
    }
    if (normalized.trim()) {
      return "guidance";
    }
    return "guidance";
  }

  function summarizeInterventionContent(content: string): string {
    const compact = content.replace(/\s+/g, " ").trim();
    if (!compact) {
      return "Runtime intervention recorded.";
    }
    return compact.length > 140 ? `${compact.slice(0, 140).trimEnd()}...` : compact;
  }

  function normalizeRuntimeReference(value: string): string {
    return value
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function resolveTextTargetNode(
    plan: RunPlanRecord,
    text: string,
  ): RunPlanRecord["compiled_nodes"][number] | null {
    const normalizedText = normalizeRuntimeReference(text);
    if (!normalizedText) {
      return null;
    }
    const candidates = [...plan.compiled_nodes]
      .filter((node) => node.type !== "end")
      .sort((left, right) =>
        `${right.name} ${right.node_id}`.length - `${left.name} ${left.node_id}`.length,
      );
    for (const node of candidates) {
      const references = [
        node.node_run_id,
        node.node_id,
        node.name,
      ]
        .filter((item): item is string => typeof item === "string" && !!item.trim())
        .map(normalizeRuntimeReference)
        .filter((item) => item.length >= 3);
      if (references.some((reference) => normalizedText.includes(reference))) {
        return node;
      }
    }
    return null;
  }

  function extractRequestedRuntimeStep(value: string): string {
    const compact = value.replace(/\s+/g, " ").trim();
    const match = compact.match(
      /\b(?:add|insert|append|include)\b\s+(?:one\s+more|another|a|an|one|the)?\s*(.+?)(?:\s+\b(?:before|after|to|into|for)\b.+)?$/i,
    );
    const candidate = match?.[1]?.replace(/[.]+$/g, "").trim();
    if (candidate && candidate.length >= 3) {
      return candidate;
    }
    return compact;
  }

  function extractRequestedRuntimeChange(value: string): Record<string, unknown> {
    const compact = value.replace(/\s+/g, " ").trim();
    const replacement = compact.match(
      /\b(?:replace|change|swap)\b\s+(.+?)\s+\b(?:with|to|into)\b\s+(.+?)(?:[.]+)?$/i,
    );
    if (replacement?.[1]?.trim() && replacement?.[2]?.trim()) {
      return {
        requested_change: compact,
        replace_from: replacement[1].trim(),
        replace_to: replacement[2].trim(),
      };
    }
    return {
      requested_change: compact,
    };
  }

  function buildInterventionIntent(kind: SessionInterventionKind): string {
    switch (kind) {
      case "pause_request":
        return "User wants the active run to pause or wait before continuing.";
      case "resume_request":
        return "User wants to resume or continue the active run after a runtime patch.";
      case "skip_request":
        return "User wants to skip or bypass part of the active run.";
      case "add_node_request":
        return "User wants to add a new task step to the active orchestration.";
      case "parallelism_request":
        return "User wants to adjust fan-out or parallel execution behavior.";
      case "change_request":
        return "User wants to change the active route or execution behavior.";
      case "guidance":
      default:
        return "User provided runtime guidance for the current or next execution pass.";
    }
  }

  function resolvePatchTargetNode(
    runId: string | null,
    nodeRunId: string | null,
    targetText?: string,
  ) {
    if (!runId) {
      return null;
    }
    const plan = getRunPlan(runId);
    if (!plan) {
      return null;
    }
    if (nodeRunId) {
      const explicitNode = plan.compiled_nodes.find((node) => node.node_run_id === nodeRunId);
      if (explicitNode) {
        return explicitNode;
      }
    }
    if (targetText) {
      const textNode = resolveTextTargetNode(plan, targetText);
      if (textNode) {
        return textNode;
      }
    }
    return (
      plan.compiled_nodes.find((node) =>
        ["running", "waiting_human", "ready", "pending"].includes(node.status),
      ) || plan.compiled_nodes[0] || null
    );
  }

  function buildPatchOperation(input: {
    kind: SessionInterventionKind;
    runId: string | null;
    nodeRunId: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  }): DagPatchOperation | null {
    const targetNode = resolvePatchTargetNode(input.runId, input.nodeRunId, input.summary);
    const target = {
      node_run_id: targetNode?.node_run_id || input.nodeRunId || null,
      node_id: targetNode?.node_id || null,
      node_name: targetNode?.name || null,
    };

    switch (input.kind) {
      case "pause_request":
        return {
          op: "pause_for_replan",
          ...target,
          reason: "Pause the active run so the requested change can be reviewed before execution continues.",
          supported: true,
        };
      case "resume_request":
        return {
          op: "resume_with_patch",
          ...target,
          reason: "Resume execution after the user confirms the active runtime state should continue.",
          supported: true,
        };
      case "skip_request":
        return {
          op: "skip_node",
          ...target,
          reason: target.node_run_id
            ? "Skip the targeted or currently active node after human confirmation."
            : "Skip was requested, but no target node could be resolved from the active run.",
          supported: !!target.node_run_id,
        };
      case "add_node_request":
        return {
          op: "add_node",
          ...target,
          value: {
            requested_step: extractRequestedRuntimeStep(input.summary),
            placement: target.node_id ? "after_target_or_before_final_delivery" : "append_before_final_delivery",
          },
          reason: "Insert a new work step that captures the requested additional work.",
          supported: true,
        };
      case "parallelism_request":
        return {
          op: "change_parallelism",
          ...target,
          value: {
            requested_parallelism:
              resolveRequestedParallelism(input.metadata?.requested_parallelism) ||
              extractRequestedParallelismFromText(input.summary) ||
              "increase_or_adjust",
          },
          reason: "Adjust fan-out or parallel execution for the active route.",
          supported: true,
        };
      case "change_request":
        return {
          op: "pause_for_replan",
          ...target,
          value: extractRequestedRuntimeChange(input.summary),
          reason: "Hold the run and replan from the current state because the user requested a route change.",
          supported: true,
        };
      case "guidance":
      default:
        return {
          op: "record_guidance",
          ...target,
          reason: "Record guidance for the next orchestration pass without changing the active DAG.",
          supported: false,
        };
    }
  }

  function buildDagPatchProposal(input: {
    kind: SessionInterventionKind;
    runId: string | null;
    nodeRunId: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  }): Omit<
    DagPatchRecord,
    | "patch_id"
    | "session_id"
    | "run_id"
    | "intervention_id"
    | "requested_by"
    | "created_at"
    | "updated_at"
    | "applied_at"
    | "applied_by"
    | "rejected_at"
    | "rejected_by"
    | "operation_outcomes"
    | "application_errors"
    | "resumed_topology"
    | "graph_preview"
    | "metadata"
  > {
    const operation = buildPatchOperation(input);
    const operations = operation ? [operation] : [];
    if (
      operation &&
      (operation.op === "add_node" || operation.op === "change_parallelism")
    ) {
      operations.push({
        op: "resume_with_patch",
        node_run_id: null,
        node_id: null,
        node_name: null,
        reason: "Resume execution after the runtime patch is applied and the scheduler has refreshed the ready frontier.",
        supported: true,
      });
    }
    const patchLike = input.kind !== "guidance";
    const allOperationsSupported =
      operations.length > 0 && operations.every((item) => item.supported);
    const allOperationsApplyReady =
      operations.length > 0 && operations.every((item) => isApplyReadyOperation(item));

    return {
      status: patchLike && allOperationsSupported ? "needs_confirmation" : "unsupported",
      reason: patchLike
        ? "The intervention was translated into a structured DAG patch proposal."
        : "The intervention is guidance only, so no live DAG patch is proposed.",
      summary: patchLike
        ? `Proposed patch for runtime intervention: ${input.summary}`
        : `Recorded next-pass guidance: ${input.summary}`,
      operations,
      requires_confirmation: patchLike && allOperationsSupported,
      apply_supported: allOperationsApplyReady,
      unsupported_reason:
        patchLike && allOperationsSupported
          ? allOperationsApplyReady
            ? null
            : "One or more operations in this patch are not yet wired to a live apply path."
          : "No applicable live DAG patch could be safely inferred.",
    };
  }

  function isApplyReadyOperation(operation: DagPatchOperation): boolean {
    if (!operation.supported) {
      return false;
    }
    return (
      operation.op === "pause_for_replan" ||
      operation.op === "skip_node" ||
      operation.op === "change_parallelism" ||
      operation.op === "add_node" ||
      operation.op === "resume_with_patch"
    );
  }

  function cloneDagPatchTopology(
    topology: DagPatchTopologySnapshot | null,
  ): DagPatchTopologySnapshot | null {
    if (!topology) {
      return null;
    }
    return {
      node_count: topology.node_count,
      edge_count: topology.edge_count,
      frontier: [...topology.frontier],
      ready_node_run_ids: [...topology.ready_node_run_ids],
      running_node_run_ids: [...topology.running_node_run_ids],
      waiting_node_run_ids: [...topology.waiting_node_run_ids],
      max_parallel_nodes: topology.max_parallel_nodes,
    };
  }

  function buildDagPatchGraphPreview(input: {
    runId: string | null;
    operations: DagPatchOperation[];
    actualTopology?: DagPatchTopologySnapshot | null;
    previousPreview?: DagPatchGraphPreview | null;
  }): DagPatchGraphPreview | null {
    const beforeTopology =
      cloneDagPatchTopology(input.previousPreview?.before_topology || null) ||
      captureDagPatchTopology(input.runId);
    const predictedTopology =
      cloneDagPatchTopology(input.previousPreview?.predicted_topology || null) ||
      cloneDagPatchTopology(beforeTopology);
    let nodeDelta = input.previousPreview?.node_delta || 0;
    let edgeDelta = input.previousPreview?.edge_delta || 0;
    let parallelismDelta = input.previousPreview?.parallelism_delta ?? null;
    let statusEffect = input.previousPreview?.status_effect || null;
    let frontierEffect = input.previousPreview?.frontier_effect || null;

    const operationLabels = input.operations.map((operation) =>
      operation.node_name
        ? `${operation.op.replace(/_/g, " ")}: ${operation.node_name}`
        : operation.op.replace(/_/g, " "),
    );
    const targetNodeNames = input.operations
      .map((operation) => operation.node_name)
      .filter((name): name is string => typeof name === "string" && !!name.trim());

    for (const operation of input.operations) {
      if (operation.op === "add_node") {
        nodeDelta += 1;
        edgeDelta += operation.node_id ? 1 : 0;
        if (predictedTopology) {
          predictedTopology.node_count += 1;
          predictedTopology.edge_count += operation.node_id ? 1 : 0;
        }
        frontierEffect = operation.node_id
          ? "A new node is inserted after the target and may unlock after its dependency completes."
          : "A new ready node may be appended to the active frontier.";
      }
      if (operation.op === "skip_node") {
        statusEffect = operation.node_name
          ? `${operation.node_name} will be marked skipped.`
          : "The targeted node will be marked skipped.";
        frontierEffect = "Skipping may unlock downstream nodes after the scheduler refreshes.";
      }
      if (operation.op === "change_parallelism") {
        const requestedParallelism = resolveRequestedParallelism(operation.value);
        if (requestedParallelism && predictedTopology) {
          const previous = predictedTopology.max_parallel_nodes || 1;
          predictedTopology.max_parallel_nodes = requestedParallelism;
          parallelismDelta = requestedParallelism - previous;
        }
        frontierEffect = "Scheduler capacity will be refreshed after the parallelism change.";
      }
      if (operation.op === "pause_for_replan") {
        statusEffect = "The run will pause so the route can be reviewed.";
      }
      if (operation.op === "resume_with_patch") {
        statusEffect = "The run will resume and refresh the ready frontier after patch application.";
      }
      if (operation.op === "record_guidance") {
        statusEffect = "Guidance is recorded without changing the live graph.";
      }
    }

    const summaryLines = [
      `${operationLabels.length} operation(s): ${operationLabels.join(", ") || "none"}.`,
      nodeDelta || edgeDelta
        ? `Predicted graph delta: ${nodeDelta >= 0 ? "+" : ""}${nodeDelta} node(s), ${edgeDelta >= 0 ? "+" : ""}${edgeDelta} edge(s).`
        : "No structural node or edge delta is predicted.",
      parallelismDelta !== null
        ? `Parallelism delta: ${parallelismDelta >= 0 ? "+" : ""}${parallelismDelta}.`
        : null,
      frontierEffect,
      statusEffect,
      input.actualTopology
        ? `Actual topology: ${input.actualTopology.node_count} node(s), ${input.actualTopology.edge_count} edge(s).`
        : null,
    ].filter((line): line is string => typeof line === "string" && !!line.trim());

    return {
      summary_lines: summaryLines,
      operation_labels: operationLabels,
      before_topology: beforeTopology,
      predicted_topology: predictedTopology,
      actual_topology: input.actualTopology || input.previousPreview?.actual_topology || null,
      node_delta: nodeDelta,
      edge_delta: edgeDelta,
      parallelism_delta: parallelismDelta,
      target_node_names: [...new Set(targetNodeNames)],
      status_effect: statusEffect,
      frontier_effect: frontierEffect,
    };
  }

  function countActiveDispatchNodes(plan: RunPlanRecord): number {
    return plan.compiled_nodes.filter((node) =>
      node.status === "running" || node.status === "waiting_human",
    ).length;
  }

  function resolveMaxParallelNodes(plan: RunPlanRecord): number {
    const raw =
      isPlainObject(plan.policy_snapshot) && typeof plan.policy_snapshot.max_parallel_nodes === "number"
        ? plan.policy_snapshot.max_parallel_nodes
        : null;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.max(1, Math.floor(raw));
    }
    return 1;
  }

  function resolveRequestedParallelism(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(1, Math.floor(value));
    }
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return Math.max(1, Math.floor(parsed));
      }
    }
    if (isPlainObject(value) && "requested_parallelism" in value) {
      return resolveRequestedParallelism(value.requested_parallelism);
    }
    return null;
  }

  function extractRequestedParallelismFromText(value: string): number | null {
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact) {
      return null;
    }
    const patterns = [
      /\b(?:parallelism|parallel|concurrency|concurrent|fan-?out|agents?)\s*(?:to|=|:)?\s*(\d{1,2})\b/i,
      /\b(\d{1,2})\s*(?:parallel|concurrent|agents?|workers?)\b/i,
    ];
    for (const pattern of patterns) {
      const match = compact.match(pattern);
      const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
      if (Number.isInteger(parsed) && parsed > 0) {
        return Math.max(1, Math.floor(parsed));
      }
    }
    return null;
  }

  function buildInterventionPatchPreview(input: {
    kind: SessionInterventionKind;
    runId: string | null;
    nodeRunId: string | null;
    summary: string;
  }) {
    const proposal = buildDagPatchProposal(input);
    const graphPreview = buildDagPatchGraphPreview({
      runId: input.runId,
      operations: proposal.operations,
    });
    return {
      supported: proposal.status === "needs_confirmation",
      reason: proposal.reason,
      operations: proposal.operations.map((operation) => ({ ...operation })),
      graph_preview: graphPreview,
    };
  }

  function resolveInterventionStatus(kind: SessionInterventionKind): SessionInterventionStatus {
    return kind === "guidance" ? "queued_for_next_pass" : "needs_review";
  }

  function buildInterventionReceipt(input: {
    kind: SessionInterventionKind;
    runId: string | null;
    summary: string;
    patchId?: string | null;
    applyReady?: boolean;
  }): string {
    const scope = input.runId ? ` for run ${input.runId}` : "";
    if (input.kind === "guidance") {
      return `I recorded this as next-pass orchestration guidance${scope}: ${input.summary}`;
    }
    const patchScope = input.patchId ? ` Proposed patch ${input.patchId} is ready for review.` : "";
    if (input.applyReady) {
      return `I recorded this as a runtime intervention intent${scope}.${patchScope} Confirm to apply, or reject to discard: ${input.summary}`;
    }
    return `I recorded this as a runtime intervention intent${scope}.${patchScope} Some operations still need a live apply path: ${input.summary}`;
  }

  function projectSessionInterventionsToMessages(sessionId: string): SessionMessageRecord[] {
    return listSessionInterventions(sessionId).map((intervention) => ({
      message_id: sessionProjectionMessageId(
        "intervention",
        sessionId,
        intervention.intervention_id,
      ),
      session_id: sessionId,
      role: "system",
      kind: "intervention_card",
      content: {
        intervention_id: intervention.intervention_id,
        run_id: intervention.run_id,
        node_run_id: intervention.node_run_id,
        requested_by: intervention.requested_by,
        kind: intervention.kind,
        status: intervention.status,
        content: intervention.content,
        summary: intervention.summary,
        interpreted_intent: intervention.interpreted_intent,
        patch_preview: intervention.patch_preview,
        metadata: intervention.metadata,
        created_at: intervention.created_at,
      },
      created_at: intervention.created_at,
      linked_run_id: intervention.run_id,
      linked_node_run_id: intervention.node_run_id,
    }));
  }

  function projectSessionDagPatchesToMessages(sessionId: string): SessionMessageRecord[] {
    return listSessionDagPatches(sessionId).map((patch) => ({
      message_id: sessionProjectionMessageId("dag-patch", sessionId, patch.patch_id),
      session_id: sessionId,
      role: "system",
      kind: "dag_patch_card",
      content: {
        patch_id: patch.patch_id,
        intervention_id: patch.intervention_id,
        run_id: patch.run_id,
        requested_by: patch.requested_by,
        status: patch.status,
        reason: patch.reason,
        summary: patch.summary,
        operations: patch.operations,
        requires_confirmation: patch.requires_confirmation,
        apply_supported: patch.apply_supported,
        unsupported_reason: patch.unsupported_reason,
        operation_outcomes: patch.operation_outcomes || [],
        application_errors: patch.application_errors || [],
        resumed_topology: patch.resumed_topology || null,
        graph_preview: patch.graph_preview || null,
        applied_at: patch.applied_at || null,
        applied_by: patch.applied_by || null,
        rejected_at: patch.rejected_at || null,
        rejected_by: patch.rejected_by || null,
        metadata: patch.metadata,
        created_at: patch.created_at,
      },
      created_at: patch.created_at,
      linked_run_id: patch.run_id,
      linked_node_run_id:
        patch.operations.find((operation) => typeof operation.node_run_id === "string")
          ?.node_run_id || null,
    }));
  }

  function projectRunToSessionMessages(sessionId: string): SessionMessageRecord[] {
    const linkedRunIds = getSessionLinkedRunIds(sessionId);
    const projectionMessages: SessionMessageRecord[] = [];

    for (const runId of linkedRunIds) {
      const run = getRun(runId);
      const plan = getRunPlan(runId);
      if (!run || !plan) {
        continue;
      }

      projectionMessages.push({
        message_id: sessionProjectionMessageId("summary", sessionId, runId),
        session_id: sessionId,
        role: "orchestrator",
        kind: "summary_card",
        content: {
          run_id: runId,
          status: run.status,
          intent: run.intent,
          current_summary: run.current_summary,
          waiting_reason: run.waiting_reason,
          blocked_reason: run.blocked_reason,
        },
        created_at: run.updated_at,
        linked_run_id: runId,
        linked_node_run_id: null,
      });

      const nodeRuns = listNodeRuns(runId);
      const nodeRunById = new Map(nodeRuns.map((nodeRun) => [nodeRun.node_run_id, nodeRun]));
      for (const node of plan.compiled_nodes) {
        const nodeRun = nodeRunById.get(node.node_run_id);
        if (!nodeRun) {
          continue;
        }
        if (!["ready", "running", "waiting_human", "failed", "completed"].includes(nodeRun.status)) {
          continue;
        }

        projectionMessages.push({
          message_id: sessionProjectionMessageId("subtask", sessionId, node.node_run_id),
          session_id: sessionId,
          role: "system",
          kind: "subtask_card",
          content: {
            run_id: runId,
            node_run_id: node.node_run_id,
            node_id: node.node_id,
            node_name: node.name,
            node_type: node.type,
            status: nodeRun.status,
            progress: nodeRun.progress,
            openclaw_agent_id: node.openclaw_agent_id,
          },
          created_at: nodeRun.progress.updated_at || run.updated_at,
          linked_run_id: runId,
          linked_node_run_id: node.node_run_id,
        });
      }

      for (const approval of listApprovals("pending").filter((item) => item.run_id === runId)) {
        projectionMessages.push({
          message_id: sessionProjectionMessageId("approval", sessionId, approval.approval_id),
          session_id: sessionId,
          role: "system",
          kind: "approval_card",
          content: {
            approval_id: approval.approval_id,
            summary: approval.summary,
            kind: approval.kind,
            status: approval.status,
            requested_at: approval.requested_at,
          },
          created_at: approval.requested_at,
          linked_run_id: runId,
          linked_node_run_id: approval.node_run_id,
        });
      }

      for (const input of listHumanInputs("pending").filter((item) => item.run_id === runId)) {
        projectionMessages.push({
          message_id: sessionProjectionMessageId("input", sessionId, input.input_request_id),
          session_id: sessionId,
          role: "system",
          kind: "human_input_card",
          content: {
            input_request_id: input.input_request_id,
            summary: input.summary,
            status: input.status,
            requested_at: input.requested_at,
            input_schema: input.input_schema,
          },
          created_at: input.requested_at,
          linked_run_id: runId,
          linked_node_run_id: input.node_run_id,
        });
      }

      for (const artifact of listArtifacts(runId)) {
        projectionMessages.push({
          message_id: sessionProjectionMessageId("artifact", sessionId, artifact.artifact_id),
          session_id: sessionId,
          role: "system",
          kind: "artifact_card",
          content: {
            artifact_id: artifact.artifact_id,
            name: artifact.name,
            type: artifact.type,
            storage_uri: artifact.storage_uri,
            mime_type: artifact.mime_type,
            size_bytes: artifact.size_bytes,
            created_at: artifact.created_at,
          },
          created_at: artifact.created_at,
          linked_run_id: runId,
          linked_node_run_id: artifact.node_run_id,
        });
      }
    }

    projectionMessages.sort((a, b) => {
      if (a.created_at === b.created_at) {
        return a.message_id.localeCompare(b.message_id);
      }
      return a.created_at.localeCompare(b.created_at);
    });
    return projectionMessages;
  }

  function buildSessionThreadMessages(sessionId: string): SessionMessageRecord[] {
    const persistedMessages = listSessionMessages(sessionId);
    const projectionMessages = projectRunToSessionMessages(sessionId);
    const interventionMessages = projectSessionInterventionsToMessages(sessionId);
    const dagPatchMessages = projectSessionDagPatchesToMessages(sessionId);
    const deduped = new Map<string, SessionMessageRecord>();

    for (const message of [
      ...persistedMessages,
      ...projectionMessages,
      ...interventionMessages,
      ...dagPatchMessages,
    ]) {
      deduped.set(message.message_id, message);
    }

    return [...deduped.values()].sort((a, b) => {
      if (a.created_at === b.created_at) {
        return a.message_id.localeCompare(b.message_id);
      }
      return a.created_at.localeCompare(b.created_at);
    });
  }

  function buildSessionSummary(sessionId: string) {
    const session = getSession(sessionId);
    if (!session) {
      return null;
    }

    const linkedRunIds = getSessionLinkedRunIds(sessionId);
    const linkedRuns = linkedRunIds
      .map((runId) => getRun(runId))
      .filter((run): run is NonNullable<typeof run> => !!run)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    const latestLinkedRun = linkedRuns[0] || null;
    const activeRunIds = linkedRuns
      .filter((run) => ["queued", "running", "waiting_human", "paused", "blocked"].includes(run.status))
      .map((run) => run.run_id);
    let derivedStatus = session.status;
    if (latestLinkedRun) {
      if (latestLinkedRun.status === "waiting_human") {
        derivedStatus = "waiting_human";
      } else if (latestLinkedRun.status === "queued" || latestLinkedRun.status === "running") {
        derivedStatus = "running";
      } else if (latestLinkedRun.status === "completed") {
        derivedStatus = "completed";
      } else if (latestLinkedRun.status === "failed") {
        derivedStatus = "failed";
      } else if (latestLinkedRun.status === "cancelled") {
        derivedStatus = "cancelled";
      }
    }

    const summaryUpdatedAt =
      latestLinkedRun && latestLinkedRun.updated_at > session.updated_at
        ? latestLinkedRun.updated_at
        : session.updated_at;
    const summaryLatestRunId = latestLinkedRun?.run_id || session.latest_run_id;
    const summarySession: SessionRecord = {
      ...session,
      status: derivedStatus,
      updated_at: summaryUpdatedAt,
      latest_run_id: summaryLatestRunId,
      active_run_ids: activeRunIds,
    };
    const metadata = getSessionMetadataObject(summarySession);
    const workspaceState = buildSessionWorkspaceState(sessionId, summarySession);
    const threadMessages = buildSessionThreadMessages(sessionId);
    const missionProjection = buildMissionWorkspaceProjection({
      session: summarySession,
      messages: threadMessages,
      workspaceState,
    });
    const persistedMissionState = buildPersistedMissionContractState(missionProjection);

    return {
      session_id: session.session_id,
      title: session.title,
      status: derivedStatus,
      created_by: session.created_by,
      created_at: session.created_at,
      updated_at: summaryUpdatedAt,
      current_goal: session.current_goal,
      current_plan_summary: session.current_plan_summary,
      latest_run_id: summaryLatestRunId,
      active_run_ids: activeRunIds,
      last_orchestrator_message_id: session.last_orchestrator_message_id,
      confirmed_plan_revision: session.confirmed_plan_revision,
      confirmed_plan_option: session.confirmed_plan_option,
      confirmed_proposal_id: session.confirmed_proposal_id,
      archived: session.archived,
      archived_at: session.archived_at,
      archived_by: session.archived_by,
      hidden: session.hidden,
      hidden_at: session.hidden_at,
      hidden_by: session.hidden_by,
      metadata: {
        ...metadata,
        workspace_state: workspaceState,
        mission_route_state: persistedMissionState.routeState,
        mission_requested_outputs: persistedMissionState.requestedOutputs,
        mission_revision_lineage: persistedMissionState.revisionLineage,
        mission_spec_contract: persistedMissionState.specContract,
      },
      mission_spec: missionProjection.missionSpec,
      mission_spec_contract: missionProjection.missionSpecContract,
      mission_snapshot: missionProjection.missionSnapshot,
      working_goal: typeof metadata.working_goal === "string" ? metadata.working_goal : session.current_goal,
      constraints_summary: getEffectiveConstraintsSummary(sessionId, summarySession),
      open_question_count: getSessionOpenQuestions(session).length,
      pending_decision: typeof metadata.pending_decision === "string" ? metadata.pending_decision : null,
      latest_orchestrator_intent:
        typeof metadata.latest_orchestrator_intent === "string" ? metadata.latest_orchestrator_intent : null,
      workspace_state: workspaceState,
      message_count: threadMessages.length,
    };
  }

  function buildMissionListItem(sessionId: string): MissionListItem | null {
    const session = buildSessionSummary(sessionId);
    if (!session) {
      return null;
    }
    const missionView = buildMissionView(session);

    return {
      mission_id: session.session_id,
      session_id: session.session_id,
      title: session.title,
      status: session.status,
      updated_at: session.updated_at,
      created_at: session.created_at,
      archived: session.archived,
      archived_at: session.archived_at,
      archived_by: session.archived_by,
      hidden: session.hidden,
      hidden_at: session.hidden_at,
      hidden_by: session.hidden_by,
      latest_run_id: session.latest_run_id,
      active_run_ids: session.active_run_ids,
      message_count: session.message_count,
      mission_spec: session.mission_spec || null,
      mission_spec_contract: session.mission_spec_contract || null,
      mission_snapshot: session.mission_snapshot || null,
      mission_view: missionView,
    };
  }

  type SessionSummaryProjection = NonNullable<ReturnType<typeof buildSessionSummary>>;
  type SessionListVisibility = "active" | "archived" | "hidden" | "all";
  type SessionListFilters = {
    query: string | null;
    status: string | null;
    visibility: SessionListVisibility;
    includeArchived: boolean;
    includeHidden: boolean;
  };

  function formatMissionViewRouteLabel(route: MissionRouteSummary | null | undefined): string {
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

  function buildMissionView(session: SessionSummaryProjection): MissionView {
    const spec = session.mission_spec;
    const snapshot = session.mission_snapshot;
    const pipelineSummary = spec?.pipelineSummary;
    const checkpointSummary = spec?.checkpointSummary;
    const workLabel = pipelineSummary
      ? `${pipelineSummary.active} live / ${pipelineSummary.total} total`
      : snapshot?.pipelines?.length
        ? `${snapshot.pipelines.length} workspace item${snapshot.pipelines.length === 1 ? "" : "s"}`
        : "Not materialized";
    const checkpointLabel = checkpointSummary
      ? `${checkpointSummary.completed}/${checkpointSummary.total}`
      : snapshot?.checkpoints?.length
        ? `${snapshot.checkpoints.length}`
        : "None";

    return {
      title: snapshot?.missionTitle || spec?.objective || session.title || session.session_id,
      summary:
        snapshot?.missionSummary ||
        spec?.decisionFocus ||
        spec?.sourceBrief ||
        session.current_goal ||
        "No mission summary yet",
      statusLabel: snapshot?.missionStatusLabel || session.status,
      statusTone: snapshot?.missionStatusTone || "neutral",
      nextActionLabel: snapshot?.nextActionLabel || null,
      nextActionDetail: snapshot?.nextActionDetail || session.pending_decision || null,
      routeLabel: spec?.route
        ? formatMissionViewRouteLabel(spec.route)
        : typeof snapshot?.activeRouteRevision === "number"
          ? `v${snapshot.activeRouteRevision} / ${snapshot.activeRouteOption || "primary"}`
          : "Unrouted",
      workLabel,
      checkpointLabel,
      updatedLabel: session.updated_at,
    };
  }

  function parseBooleanQuery(value: unknown): boolean {
    const raw = getSingleParam(value);
    if (!raw) {
      return false;
    }
    return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase());
  }

  function parseSessionListVisibility(value: unknown): SessionListVisibility {
    const raw = getSingleParam(value)?.toLowerCase();
    if (raw === "archived" || raw === "hidden" || raw === "all") {
      return raw;
    }
    return "active";
  }

  function buildSessionListFilters(query: Request["query"]): SessionListFilters {
    const visibility = parseSessionListVisibility(query.visibility);
    return {
      query: getSingleParam(query.q) || getSingleParam(query.search),
      status: getSingleParam(query.status),
      visibility,
      includeArchived: visibility === "all" || parseBooleanQuery(query.include_archived),
      includeHidden: visibility === "all" || parseBooleanQuery(query.include_hidden),
    };
  }

  function sessionMatchesVisibility(
    session: Pick<SessionSummaryProjection, "archived" | "hidden">,
    filters: SessionListFilters,
  ): boolean {
    if (filters.visibility === "archived") {
      return session.archived && (!session.hidden || filters.includeHidden);
    }
    if (filters.visibility === "hidden") {
      return session.hidden;
    }
    if (filters.visibility === "all") {
      return true;
    }
    if (session.hidden && !filters.includeHidden) {
      return false;
    }
    if (session.archived && !filters.includeArchived) {
      return false;
    }
    return true;
  }

  function searchableSessionText(session: SessionSummaryProjection): string {
    const spec = session.mission_spec;
    const snapshot = session.mission_snapshot;
    const view = buildMissionView(session);
    const values = [
      session.session_id,
      session.title,
      session.status,
      session.current_goal,
      session.current_plan_summary,
      session.latest_run_id,
      session.working_goal,
      session.constraints_summary,
      session.pending_decision,
      spec?.objective,
      spec?.sourceBrief,
      spec?.decisionFocus,
      ...(spec?.constraints || []),
      ...(spec?.requestedOutputs || []),
      ...(spec?.openQuestions || []),
      snapshot?.missionTitle,
      snapshot?.missionSummary,
      snapshot?.objective,
      snapshot?.nextActionLabel,
      snapshot?.nextActionDetail,
      snapshot?.latestUserInstruction,
      view.title,
      view.summary,
      view.statusLabel,
      view.nextActionLabel,
      view.nextActionDetail,
      view.routeLabel,
      view.workLabel,
      view.checkpointLabel,
    ];
    return values
      .filter((value): value is string => typeof value === "string" && !!value.trim())
      .join(" ")
      .toLowerCase();
  }

  function sessionMatchesFilters(
    session: SessionSummaryProjection,
    filters: SessionListFilters,
  ): boolean {
    if (!sessionMatchesVisibility(session, filters)) {
      return false;
    }
    if (filters.status && session.status !== filters.status) {
      return false;
    }
    if (filters.query && !searchableSessionText(session).includes(filters.query.toLowerCase())) {
      return false;
    }
    return true;
  }

  function listSessionSummaries(filters: SessionListFilters): SessionSummaryProjection[] {
    return listSessions()
      .map((session) => buildSessionSummary(session.session_id))
      .filter((session): session is SessionSummaryProjection => !!session)
      .filter((session) => sessionMatchesFilters(session, filters));
  }

  function getDefaultSessionListFilters(): SessionListFilters {
    return {
      query: null,
      status: null,
      visibility: "active",
      includeArchived: false,
      includeHidden: false,
    };
  }

  function listMissionItems(filters: SessionListFilters = getDefaultSessionListFilters()): MissionListItem[] {
    return listSessionSummaries(filters)
      .map((session) => buildMissionListItem(session.session_id))
      .filter((item): item is MissionListItem => !!item)
      .filter((mission) => sessionMatchesVisibility(mission, filters));
  }

  function buildMissionDetailResponse(sessionId: string): MissionDetailResponse | null {
    const session = buildSessionSummary(sessionId);
    if (!session) {
      return null;
    }

    const mission = buildMissionListItem(sessionId);
    if (!mission) {
      return null;
    }

    const messages = buildSessionThreadMessages(sessionId);
    const workspaceState = isPlainObject(session.workspace_state) ? session.workspace_state : {};
    const missionProjection = buildMissionWorkspaceProjection({
      session: session as SessionRecord,
      messages,
      workspaceState,
    });

    return {
      mission,
      session,
      messages,
      latest_run: session.latest_run_id ? getRun(session.latest_run_id) : null,
      attachments: listSessionAttachments(sessionId),
      workspace_state: workspaceState,
      next_actions: buildSessionNextActions(sessionId),
      workspace_contract_version: MISSION_WORKSPACE_CONTRACT_VERSION,
      mission_spec: missionProjection.missionSpec,
      mission_spec_contract: missionProjection.missionSpecContract,
      mission_snapshot: missionProjection.missionSnapshot,
      mission_view: mission.mission_view,
    };
  }

  function buildSessionNextActions(sessionId: string): string[] {
    const session = buildSessionSummary(sessionId);
    if (!session) {
      return [];
    }
    const workspaceState = isPlainObject(session.workspace_state) ? session.workspace_state : {};
    const actions: string[] = [];

    if (typeof workspaceState.next_recommended_action === "string" && workspaceState.next_recommended_action.trim()) {
      actions.push(workspaceState.next_recommended_action.trim());
    }
    if (typeof workspaceState.needs_confirmation === "boolean" && workspaceState.needs_confirmation) {
      actions.push("confirm");
    }
    if (typeof workspaceState.needs_replan === "boolean" && workspaceState.needs_replan) {
      actions.push("revise");
    }
    if (typeof workspaceState.pending_approval_count === "number" && workspaceState.pending_approval_count > 0) {
      actions.push("approve");
    }
    if (
      typeof workspaceState.pending_human_input_count === "number" &&
      workspaceState.pending_human_input_count > 0
    ) {
      actions.push("submit_human_input");
    }

    return [...new Set(actions)];
  }

  function buildSessionWorkspaceDetailResponse(sessionId: string): SessionWorkspaceDetailResponse | null {
    const mission = buildMissionDetailResponse(sessionId);
    if (!mission) {
      return null;
    }

    return {
      session: mission.session,
      messages: mission.messages,
      latest_run: mission.latest_run,
      attachments: mission.attachments,
      workspace_state: mission.workspace_state || {},
      next_actions: mission.next_actions || [],
      workspace_contract_version: mission.workspace_contract_version || MISSION_WORKSPACE_CONTRACT_VERSION,
      mission_spec: mission.mission_spec || null,
      mission_spec_contract: mission.mission_spec_contract || null,
      mission_snapshot: mission.mission_snapshot || null,
    };
  }

  function buildAgentHostingSummary(agentProfiles = listAgentProfiles()): AgentHostingSummary {
    return {
      ownership: {
        execution_runtime: "openclaw",
        orchestration_binding: "my_mate",
      },
      profiles: agentProfiles.map((profile) => {
        const metadata = isPlainObject(profile.metadata) ? profile.metadata : {};
        const openclaw = isPlainObject(metadata.openclaw) ? metadata.openclaw : {};
        const provider =
          typeof openclaw.provider === "string" && openclaw.provider.trim()
            ? openclaw.provider.trim()
            : typeof metadata.openclaw_provider === "string" && metadata.openclaw_provider.trim()
              ? metadata.openclaw_provider.trim()
              : null;
        const model =
          typeof openclaw.model === "string" && openclaw.model.trim()
            ? openclaw.model.trim()
            : typeof metadata.openclaw_model === "string" && metadata.openclaw_model.trim()
              ? metadata.openclaw_model.trim()
              : null;
        const runtimeMode =
          typeof openclaw.runtime_mode === "string" && openclaw.runtime_mode.trim()
            ? openclaw.runtime_mode.trim()
            : typeof metadata.openclaw_runtime_mode === "string" && metadata.openclaw_runtime_mode.trim()
              ? metadata.openclaw_runtime_mode.trim()
              : null;
        const ready = profile.status === "active" && !!profile.openclaw_agent_id.trim();

        return {
          profile_id: profile.profile_id,
          name: profile.name,
          status: profile.status,
          openclaw_agent_id: profile.openclaw_agent_id,
          default_skills: profile.default_skills,
          provider,
          model,
          runtime_mode: runtimeMode,
          managed_by: "my_mate_registry" as const,
          health: {
            status:
              profile.status === "disabled"
                ? "disabled" as const
                : ready
                  ? "ready" as const
                  : "needs_binding" as const,
            detail:
              profile.status === "disabled"
                ? "Agent profile is disabled."
                : ready
                  ? "Profile is bound to an OpenClaw agent; provider/model settings are passed as registry intent."
                  : "Profile needs an OpenClaw agent id before execution can resolve it.",
          },
        };
      }),
    };
  }

  function buildRuntimeSummary(): RuntimeSummary {
    const plannerProvider = getCurrentPlannerProvider();
    const fallbackPlannerProvider = getFallbackPlannerProvider();
    const agentProfiles = listAgentProfiles();
    const skills = listSkills();
    const templates = listTemplates();
    const bridgeConfigured = !!OPENCLAW_BRIDGE_BASE_URL;
    const callbackConfigured = !!OPENCLAW_CALLBACK_BASE_URL;

    return {
      execution_runtime: {
        adapter_kind: executionAdapter.kind,
        local_execution_enabled: ENABLE_LOCAL_EXECUTION,
        auto_approve_human_gates: AUTO_APPROVE_HUMAN_GATES,
        bridge_base_url: OPENCLAW_BRIDGE_BASE_URL || null,
        bridge_execution_mode: OPENCLAW_BRIDGE_EXECUTION_MODE || null,
        bridge_dispatch_path: OPENCLAW_BRIDGE_DISPATCH_PATH || null,
        bridge_control_path: OPENCLAW_BRIDGE_CONTROL_PATH || null,
        bridge_sweep_path: OPENCLAW_BRIDGE_SWEEP_PATH || null,
        callback_base_url: OPENCLAW_CALLBACK_BASE_URL || null,
        callback_path: OPENCLAW_CALLBACK_PATH || null,
        gateway_base_url: OPENCLAW_GATEWAY_BASE_URL || null,
        approval_console_base_url: OPENCLAW_APPROVAL_CONSOLE_BASE_URL || null,
        container_name: OPENCLAW_CONTAINER_NAME || null,
        runtime_health: {
          status:
            executionAdapter.kind === "openclaw" && !bridgeConfigured
              ? "warn"
              : "ok",
          detail:
            executionAdapter.kind === "openclaw" && !bridgeConfigured
              ? "OpenClaw bridge adapter is selected but bridge base URL is not configured."
              : executionAdapter.kind === "openclaw"
                ? "OpenClaw bridge runtime is configured."
                : "Local execution runtime is active.",
          bridge_configured: bridgeConfigured,
          callback_configured: callbackConfigured,
        },
        maintenance: {
          supported_actions: ["dispatch_sweep"],
        },
      },
      agent_hosting: buildAgentHostingSummary(agentProfiles),
      planner: {
        provider_id: plannerProvider.id,
        provider_name: plannerProvider.displayName,
        fallback_provider_id: fallbackPlannerProvider.id,
        fallback_provider_name: fallbackPlannerProvider.displayName,
        registered_provider_ids: listPlannerProviderIds(),
        llm_model: PLANNER_LLM_MODEL,
        llm_max_tokens: PLANNER_LLM_MAX_TOKENS,
        llm_timeout_ms: PLANNER_LLM_TIMEOUT_MS,
      },
      registry: {
        agent_profile_count: agentProfiles.length,
        active_agent_profile_count: agentProfiles.filter((item) => item.status === "active").length,
        skill_count: skills.length,
        active_skill_count: skills.filter((item) => item.status === "active").length,
        template_count: templates.length,
        published_template_count: templates.filter((item) => item.status === "published").length,
        draft_template_count: templates.filter((item) => item.status === "draft").length,
      },
    };
  }

  function updateAgentHostingProfile(
    profileId: string,
    update: UpdateAgentHostingRequest,
  ): AgentProfileRecord | null {
    const current = getAgentProfile(profileId);
    if (!current) {
      return null;
    }

    const currentMetadata = isPlainObject(current.metadata) ? current.metadata : {};
    const currentOpenClaw = isPlainObject(currentMetadata.openclaw) ? currentMetadata.openclaw : {};
    const nextOpenClaw = {
      ...currentOpenClaw,
      provider:
        update.provider === undefined
          ? currentOpenClaw.provider ?? null
          : update.provider?.trim() || null,
      model:
        update.model === undefined
          ? currentOpenClaw.model ?? null
          : update.model?.trim() || null,
      runtime_mode:
        update.runtime_mode === undefined
          ? currentOpenClaw.runtime_mode ?? null
          : update.runtime_mode?.trim() || null,
    };

    return upsertAgentProfile({
      profile_id: current.profile_id,
      name: current.name,
      description: current.description,
      openclaw_agent_id:
        update.openclaw_agent_id === undefined
          ? current.openclaw_agent_id
          : update.openclaw_agent_id.trim(),
      default_skills: current.default_skills,
      allowed_tools: current.allowed_tools,
      disallowed_skills: current.disallowed_skills,
      policy_tags: current.policy_tags,
      status: current.status,
      metadata: {
        ...currentMetadata,
        openclaw: nextOpenClaw,
      },
    });
  }

  function buildSessionWorkspaceStreamSnapshot(sessionId: string) {
    const workspace = buildSessionWorkspaceDetailResponse(sessionId);
    if (!workspace) {
      return null;
    }

    return {
      session: workspace.session,
      messages: workspace.messages,
      latest_run: workspace.latest_run,
      workspace_state: workspace.workspace_state,
      next_actions: workspace.next_actions,
      mission_snapshot: workspace.mission_snapshot,
      mission_spec: workspace.mission_spec,
      mission_spec_contract: workspace.mission_spec_contract,
      attachments: workspace.attachments,
      artifacts: workspace.latest_run ? listArtifacts(workspace.latest_run.run_id) : [],
      pending_approvals: workspace.latest_run
        ? listApprovals("pending").filter((item) => item.run_id === workspace.latest_run?.run_id)
        : [],
      pending_human_inputs: workspace.latest_run
        ? listHumanInputs("pending").filter((item) => item.run_id === workspace.latest_run?.run_id)
        : [],
      interventions: listSessionInterventions(sessionId),
      dag_patches: listSessionDagPatches(sessionId),
    };
  }

  function buildSessionWorkspaceStreamSignature(snapshot: ReturnType<typeof buildSessionWorkspaceStreamSnapshot>): string {
    return JSON.stringify(snapshot);
  }

  function buildSessionWorkspaceStreamEvent(input: {
    sessionId: string;
    type: SessionWorkspaceStreamEvent["type"];
    data: Record<string, unknown>;
  }): SessionWorkspaceStreamEvent {
    return {
      event_id: generateNodeRunId("sess_evt"),
      type: input.type,
      session_id: input.sessionId,
      occurred_at: nowIso(),
      data: input.data,
    };
  }

  function buildSessionMessageTurnResponse(input: {
    sessionId: string;
    userMessage: SessionMessageRecord;
    baselineMessageCount: number;
  }) {
    const session = buildSessionSummary(input.sessionId);
    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    return {
      session,
      user_message: input.userMessage,
      messages: buildSessionThreadMessages(input.sessionId).slice(input.baselineMessageCount),
    };
  }

  function listPersistedPlanCards(sessionId: string): SessionMessageRecord[] {
    return listSessionMessages(sessionId).filter((message) => message.kind === "plan_card");
  }

  function listPersistedPlanningMessages(sessionId: string): SessionMessageRecord[] {
    return listSessionMessages(sessionId).filter(
      (message) => message.kind === "plan_options_card" || message.kind === "plan_card",
    );
  }

  function getPlanCardByRevision(sessionId: string, revision: number): SessionMessageRecord | null {
    return (
      listPersistedPlanCards(sessionId).find(
        (message) => typeof message.content.revision === "number" && message.content.revision === revision,
      ) || null
    );
  }

  function getPlanningMessageByRevision(sessionId: string, revision: number): SessionMessageRecord | null {
    const messages = listPersistedPlanningMessages(sessionId);
    return (
      messages.find(
        (message) =>
          message.kind === "plan_options_card" &&
          typeof message.content.revision === "number" &&
          message.content.revision === revision,
      ) ||
      messages.find(
        (message) =>
          message.kind === "plan_card" &&
          typeof message.content.revision === "number" &&
          message.content.revision === revision,
      ) ||
      null
    );
  }

  function getDraftMessageById(sessionId: string, messageId: string): SessionMessageRecord | null {
    return (
      listSessionMessages(sessionId).find(
        (message) => message.kind === "draft_card" && message.message_id === messageId,
      ) || null
    );
  }

  function extractPlanExecutionConfig(message: SessionMessageRecord | null): {
    revision: number | null;
    intent: string | null;
    template_id: string | null;
    execution_template_id: string | null;
    inputs: Record<string, unknown>;
    option: "primary" | "alternative";
  } | null {
    if (!message || message.kind !== "plan_card") {
      return null;
    }

    const revision =
      typeof message.content.revision === "number" ? message.content.revision : null;
    const intent =
      typeof message.content.intent === "string" && message.content.intent.trim()
        ? message.content.intent.trim()
        : null;
    const templateId =
      typeof message.content.template_id === "string" && message.content.template_id.trim()
        ? message.content.template_id.trim()
        : null;
    const inputs = isPlainObject(message.content.inputs) ? { ...message.content.inputs } : {};

    if (!templateId) {
      return null;
    }

    return {
      revision,
      intent,
      template_id: templateId,
      execution_template_id: templateId,
      inputs,
      option:
        message.content.option === "alternative"
          ? "alternative"
          : "primary",
    };
  }

  function extractPlanOptionExecutionConfig(message: SessionMessageRecord | null): {
    revision: number | null;
    option: "primary" | "alternative";
    intent: string | null;
    template_id: string | null;
    execution_template_id: string | null;
    inputs: Record<string, unknown>;
  } | null {
    if (!message) {
      return null;
    }
    if (message.kind === "plan_card") {
      return extractPlanExecutionConfig(message);
    }
    if (message.kind !== "plan_options_card") {
      return null;
    }

    const revision =
      typeof message.content.revision === "number" ? message.content.revision : null;
    const intent =
      typeof message.content.intent === "string" && message.content.intent.trim()
        ? message.content.intent.trim()
        : null;
    const selectedOption =
      message.content.selected_option === "alternative" ? "alternative" : "primary";
    const optionContent = isPlainObject(message.content[selectedOption])
      ? message.content[selectedOption]
      : null;
    const templateId =
      typeof optionContent?.template_id === "string" && optionContent.template_id.trim()
        ? optionContent.template_id.trim()
        : null;
    const executionTemplateId =
      typeof optionContent?.execution_template_id === "string" && optionContent.execution_template_id.trim()
        ? optionContent.execution_template_id.trim()
        : templateId;
    const inputs = isPlainObject(message.content.inputs) ? { ...message.content.inputs } : {};

    if (!templateId) {
      return null;
    }

    return {
      revision,
      option: selectedOption,
      intent,
      template_id: templateId,
      execution_template_id: executionTemplateId,
      inputs,
    };
  }

  function extractDraftTemplate(message: SessionMessageRecord | null): WorkflowTemplateRecord | null {
    if (!message || message.kind !== "draft_card") {
      return null;
    }

    const draftTemplate = isPlainObject(message.content.draft_template)
      ? message.content.draft_template
      : null;
    if (!draftTemplate) {
      return null;
    }

    const templateId =
      typeof draftTemplate.template_id === "string" && draftTemplate.template_id.trim()
        ? draftTemplate.template_id.trim()
        : "";
    const name =
      typeof draftTemplate.name === "string" && draftTemplate.name.trim()
        ? draftTemplate.name.trim()
        : "";
    const description =
      typeof draftTemplate.description === "string" ? draftTemplate.description : "";
    const policy = isPlainObject(draftTemplate.policy) ? draftTemplate.policy : null;
    const inputSchema = isPlainObject(draftTemplate.input_schema) ? draftTemplate.input_schema : null;
    const agentProfileBindings = isPlainObject(draftTemplate.agent_profile_bindings)
      ? draftTemplate.agent_profile_bindings
      : {};
    const metadata = isPlainObject(draftTemplate.metadata) ? draftTemplate.metadata : {};
    const nodes = Array.isArray(draftTemplate.nodes) ? draftTemplate.nodes : [];
    const edges = Array.isArray(draftTemplate.edges) ? draftTemplate.edges : [];
    if (!templateId || !name || !policy || !inputSchema) {
      return null;
    }

    return {
      template_id: templateId,
      version: 1,
      name,
      status: "published",
      description,
      workspace_scope:
        typeof draftTemplate.workspace_scope === "string" && draftTemplate.workspace_scope.trim()
          ? draftTemplate.workspace_scope.trim()
          : "default",
      input_schema: inputSchema,
      policy: policy as unknown as WorkflowTemplateRecord["policy"],
      agent_profile_bindings: agentProfileBindings,
      nodes: nodes as WorkflowNode[],
      edges: edges as WorkflowEdge[],
      metadata,
      created_at: message.created_at,
      updated_at: message.created_at,
      published_at: message.created_at,
    };
  }

  function getLatestPlanningMessage(sessionId: string): SessionMessageRecord | null {
    const messages = listSessionMessages(sessionId).slice().reverse();
    return (
      messages.find(
        (message) =>
          message.kind === "plan_options_card" ||
          message.kind === "plan_card" ||
          message.kind === "draft_card",
      ) || null
    );
  }

  async function resolveSessionPlanningInput(input: {
    sessionId: string;
    session: SessionRecord;
    latestGoal: string;
    templateId?: string;
    inputs?: Record<string, unknown>;
    revisionInstruction?: string | null;
    sourcePlanCard?: SessionMessageRecord | null;
    draftMessage?: SessionMessageRecord | null;
  }) {
    const persistedPlanningMessages = listPersistedPlanningMessages(input.sessionId);
    const priorPlanCount = new Set(
      persistedPlanningMessages
        .map((message) =>
          typeof message.content.revision === "number" ? message.content.revision : null,
        )
        .filter((revision): revision is number => revision !== null),
    ).size;
    const persistedPlanCards = listPersistedPlanCards(input.sessionId);
    const sourcePlanConfig = extractPlanOptionExecutionConfig(input.sourcePlanCard || null);
    const mergedInputs = {
      ...(sourcePlanConfig?.inputs || {}),
      ...(input.inputs || {}),
    };
    if (!("goal" in mergedInputs) && input.latestGoal) {
      mergedInputs.goal = input.latestGoal;
    }

    const plannerOptions = resolveSessionPlannerInvocationOptions(input.session);
    const recommendation = await recommendTemplate(input.latestGoal, plannerOptions);
    const draftTemplate = extractDraftTemplate(input.draftMessage || null);
    let templateId =
      input.templateId?.trim() ||
      sourcePlanConfig?.template_id ||
      draftTemplate?.template_id ||
      "";
    if (!templateId && recommendation) {
      templateId = recommendation.selected_template.template_id;
    }
    if (!templateId) {
      return {
        ok: false as const,
        status: 404,
        body: {
          code: "no_published_templates",
          message: "No published templates are available for planning.",
        },
      };
    }

    return {
      ok: true as const,
      templateId,
      recommendation,
      inputs: mergedInputs,
      priorPlanCount,
      previousPlanCard: persistedPlanCards[persistedPlanCards.length - 1] || null,
      sourcePlanConfig,
      draftTemplate,
    };
  }

  function resolveExecutionTemplateIdFromDraftTemplate(
    draftTemplate: WorkflowTemplateRecord | null,
  ): string | null {
    if (!draftTemplate || !isPlainObject(draftTemplate.metadata)) {
      return null;
    }

    const sourceTemplateId = draftTemplate.metadata.planner_source_template_id;
    if (typeof sourceTemplateId === "string" && sourceTemplateId.trim()) {
      return sourceTemplateId.trim();
    }

    const versioning = isPlainObject(draftTemplate.metadata.versioning)
      ? draftTemplate.metadata.versioning
      : null;
    const rootTemplateId = versioning?.root_template_id;
    if (typeof rootTemplateId === "string" && rootTemplateId.trim()) {
      return rootTemplateId.trim();
    }

    return null;
  }

  async function inferRevisedTemplateId(input: {
    session: SessionRecord;
    latestGoal: string;
    instructions: string;
    sourcePlanCard: SessionMessageRecord | null;
  }): Promise<{
    templateId: string | null;
    reason: string;
    recommendation: Awaited<ReturnType<typeof recommendTemplate>>;
  }> {
    const sourceConfig = extractPlanOptionExecutionConfig(input.sourcePlanCard);
    const baseTemplateId = sourceConfig?.template_id || null;
    const plannerOptions = resolveSessionPlannerInvocationOptions(input.session);
    const recommendation = await recommendTemplate(
      `${input.latestGoal} ${input.instructions}`,
      plannerOptions,
    );
    if (!recommendation) {
      return {
        templateId: baseTemplateId,
        reason: "No alternative published template recommendation was available, so the current template was kept.",
        recommendation: null,
      };
    }

    const instructions = input.instructions.toLowerCase();
    const requestedChange = /\b(change|switch|different|alternative|instead|use)\b/.test(instructions);
    const selectedTemplateId = recommendation.selected_template.template_id;
    if (requestedChange && selectedTemplateId && selectedTemplateId !== baseTemplateId) {
      return {
        templateId: selectedTemplateId,
        reason: `Revision requested a changed approach, so the orchestrator switched to ${recommendation.selected_template.name}.`,
        recommendation,
      };
    }

    return {
      templateId: baseTemplateId || selectedTemplateId,
      reason:
        baseTemplateId
          ? `Revision kept the current template${
              sourceConfig?.template_id ? `: ${sourceConfig.template_id}` : ""
            }, and updated the plan assumptions.`
          : selectedTemplateId
            ? `Revision selected template ${recommendation.selected_template.name}.`
            : "Revision updated the plan assumptions.",
      recommendation,
    };
  }

  function parseReviseDirectives(instructions: string): ReviseDirective[] {
    const normalized = instructions.toLowerCase();
    const directives: ReviseDirective[] = [];
    const ordinalMatch =
      normalized.match(/\b(?:step|phase|task)\s+(\d+)\b/) ||
      normalized.match(/\b(first|second|third|fourth)\s+(?:step|phase|task)\b/);
    let targetIndex: number | null = null;
    if (ordinalMatch) {
      const raw = ordinalMatch[1];
      if (raw === "first") {
        targetIndex = 0;
      } else if (raw === "second") {
        targetIndex = 1;
      } else if (raw === "third") {
        targetIndex = 2;
      } else if (raw === "fourth") {
        targetIndex = 3;
      } else {
        const parsed = Number.parseInt(raw, 10);
        targetIndex = Number.isFinite(parsed) && parsed >= 1 ? parsed - 1 : null;
      }
    }

    if (/\b(review|summary|summarize|final review|double-check)\b/.test(normalized)) {
      directives.push({
        kind: "add_review_node",
        reason: "Revision requested an explicit review or summary step.",
      });
    }
    if (/\b(parallel|in parallel|concurrently|fan out)\b/.test(normalized)) {
      directives.push({
        kind: "increase_parallelism",
        reason: "Revision requested a more parallel execution shape.",
      });
    }
    if (/\b(serial|sequential|one by one|step by step)\b/.test(normalized)) {
      directives.push({
        kind: "flatten_parallelism",
        reason: "Revision requested a more sequential execution shape.",
      });
    }
    if (/\b(approve|approval|human review|sign off|sign-off)\b/.test(normalized)) {
      directives.push({
        kind: "add_approval_gate",
        reason:
          targetIndex !== null
            ? `Revision requested explicit approval on step ${targetIndex + 1}.`
            : "Revision requested explicit approval or human review.",
        target_index: targetIndex,
      });
    }
    if (
      /\b(parallel|in parallel|concurrently|fan out)\b/.test(normalized) &&
      /\b(then|after|followed by|and then)\b/.test(normalized) &&
      /\b(review|summary|summarize|merge|consolidate|wrap up)\b/.test(normalized)
    ) {
      directives.push({
        kind: "add_fanout_review_stage",
        reason: "Revision requested a fan-out stage followed by a final consolidation step.",
      });
    }

    return directives;
  }

  function cloneWorkflowNode(node: WorkflowNode): WorkflowNode {
    return {
      ...node,
      allowed_skills: [...node.allowed_skills],
      config: { ...node.config },
      retry_policy: { ...node.retry_policy },
      human_input_schema: node.human_input_schema ? { ...node.human_input_schema } : null,
    };
  }

  function cloneWorkflowEdge(edge: WorkflowEdge): WorkflowEdge {
    return {
      ...edge,
      condition: edge.condition ? { ...edge.condition } : null,
    };
  }

  function buildMutatedTemplateFromSource(input: {
    sourceTemplateId: string | null;
    latestGoal: string;
    directives: ReviseDirective[];
  }): { template: WorkflowTemplateRecord | null; notes: string[] } {
    const sourceTemplate = input.sourceTemplateId ? getTemplate(input.sourceTemplateId) : null;
    if (!sourceTemplate) {
      return {
        template: null,
        notes: [],
      };
    }

    const template: WorkflowTemplateRecord = {
      ...sourceTemplate,
      nodes: sourceTemplate.nodes.map(cloneWorkflowNode),
      edges: sourceTemplate.edges.map(cloneWorkflowEdge),
      policy: {
        ...sourceTemplate.policy,
        budget_policy: { ...sourceTemplate.policy.budget_policy },
        approval_policy: { ...sourceTemplate.policy.approval_policy },
      },
      metadata: {
        ...sourceTemplate.metadata,
      },
      agent_profile_bindings: {
        ...sourceTemplate.agent_profile_bindings,
      },
    };
    const notes: string[] = [];

    for (const directive of input.directives) {
      if (directive.kind === "add_fanout_review_stage") {
        template.policy.max_parallel_nodes = Math.max(template.policy.max_parallel_nodes, 2);
        template.nodes = template.nodes.map((node) => ({
          ...node,
          parallelism: Math.max(node.parallelism, 2),
        }));
        if (!template.nodes.some((node) => node.id === "node_revision_review")) {
          const nodeIds = new Set(template.nodes.map((node) => node.id));
          const nodesWithOutgoingEdges = new Set(template.edges.map((edge) => edge.from));
          const terminalNodeIds = [...nodeIds].filter((nodeId) => !nodesWithOutgoingEdges.has(nodeId));
          template.nodes.push({
            id: "node_revision_review",
            name: "Revision Review",
            type: "agent_task",
            agent_profile: "backend",
            allowed_skills: ["coding-agent"],
            config: {
              allowed_tools: ["read", "write"],
              output_contract: {
                expected_artifacts: ["review-note"],
              },
            },
            retry_policy: {
              max_attempts: 1,
              backoff_seconds: 5,
            },
            timeout_seconds: template.policy.default_timeout_seconds || 900,
            parallelism: 1,
            approval_kind: null,
            human_input_schema: null,
          });
          for (const nodeId of terminalNodeIds) {
            template.edges.push({
              from: nodeId,
              to: "node_revision_review",
              condition: null,
              label: "consolidate",
            });
          }
        }
        notes.push(directive.reason);
      }

      if (directive.kind === "add_review_node") {
        if (!template.nodes.some((node) => node.id === "node_revision_review")) {
          const nodeIds = new Set(template.nodes.map((node) => node.id));
          const nodesWithOutgoingEdges = new Set(template.edges.map((edge) => edge.from));
          const terminalNodeIds = [...nodeIds].filter((nodeId) => !nodesWithOutgoingEdges.has(nodeId));
          template.nodes.push({
            id: "node_revision_review",
            name: "Revision Review",
            type: "agent_task",
            agent_profile: "backend",
            allowed_skills: ["coding-agent"],
            config: {
              allowed_tools: ["read", "write"],
              output_contract: {
                expected_artifacts: ["review-note"],
              },
            },
            retry_policy: {
              max_attempts: 1,
              backoff_seconds: 5,
            },
            timeout_seconds: template.policy.default_timeout_seconds || 900,
            parallelism: 1,
            approval_kind: null,
            human_input_schema: null,
          });
          for (const nodeId of terminalNodeIds) {
            template.edges.push({
              from: nodeId,
              to: "node_revision_review",
              condition: null,
              label: "review",
            });
          }
          notes.push(directive.reason);
        }
      }

      if (directive.kind === "increase_parallelism") {
        template.policy.max_parallel_nodes = Math.max(template.policy.max_parallel_nodes, 2);
        template.nodes = template.nodes.map((node) => ({
          ...node,
          parallelism: Math.max(node.parallelism, 2),
        }));
        notes.push(directive.reason);
      }

      if (directive.kind === "flatten_parallelism") {
        template.policy.max_parallel_nodes = 1;
        template.nodes = template.nodes.map((node) => ({
          ...node,
          parallelism: 1,
        }));
        notes.push(directive.reason);
      }

      if (directive.kind === "add_approval_gate") {
        let executableIndex = 0;
        let approvalApplied = false;
        template.nodes = template.nodes.map((node) => {
          if ((node.type !== "agent_task" && node.type !== "tool_task")) {
            return node;
          }
          const shouldApply =
            directive.target_index === null ? !approvalApplied : executableIndex === directive.target_index;
          executableIndex += 1;
          if (!shouldApply) {
            return node;
          }
          approvalApplied = true;
          return {
            ...node,
            approval_kind: node.approval_kind || "human_review",
          };
        });
        notes.push(directive.reason);
      }
    }

    template.updated_at = nowIso();
    template.metadata.revision_directives = input.directives.map((directive) => directive.kind);
    template.metadata.revision_goal = input.latestGoal;

    return {
      template,
      notes,
    };
  }

  function buildConfirmationChecklist(input: {
    revision: number;
    option: "primary" | "alternative";
    templateName: string;
    candidatePlan: { compiled_nodes: Array<{ status?: string }>; frontier?: string[] };
    validation: { passed: boolean; warnings: string[]; details?: Array<{ category?: string }> };
  }) {
    const warningDetails = Array.isArray(input.validation.details) ? input.validation.details : [];
    const hasRequiredInputRisk = warningDetails.some((detail) => detail.category === "required_input");
    const hasRegistryRisk = warningDetails.some((detail) => detail.category === "registry");
    return {
      revision: input.revision,
      option: input.option,
      template_name: input.templateName,
      node_count: input.candidatePlan.compiled_nodes.length,
      ready_frontier_count: Array.isArray(input.candidatePlan.frontier)
        ? input.candidatePlan.frontier.length
        : input.candidatePlan.compiled_nodes.filter((node) => node.status === "ready").length,
      validation_passed: input.validation.passed,
      warning_count: input.validation.warnings.length,
      has_required_input_risk: hasRequiredInputRisk,
      has_registry_risk: hasRegistryRisk,
    };
  }

  async function createSessionPlanMessages(input: {
    sessionId: string;
    session: SessionRecord;
    latestGoal: string;
    templateId: string;
    inputs: Record<string, unknown>;
    priorPlanCount: number;
    previousPlanCard: SessionMessageRecord | null;
    recommendation: Awaited<ReturnType<typeof recommendTemplate>>;
    explanationPrefix?: string | null;
    templateOverride?: WorkflowTemplateRecord | null;
    selectedOption?: "primary" | "alternative";
    sourceRevision?: number | null;
    sourceOption?: "primary" | "alternative" | null;
  }) {
    const templateForPlan = input.templateOverride || getTemplate(input.templateId);
    if (!templateForPlan) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }
    if (templateForPlan.status !== "published") {
      throw new Error("TEMPLATE_NOT_PUBLISHED");
    }

    const primaryTemplateId = templateForPlan.template_id;
    const primaryTemplateName = templateForPlan.name || primaryTemplateId;
    const plannerOptions = resolveSessionPlannerInvocationOptions(input.session);
    const candidateRun: PlannerCandidatePlanRequest = {
      intent: input.latestGoal,
      template_id: primaryTemplateId,
      inputs: input.inputs,
    };
    const candidatePlan =
      input.templateOverride
        ? {
            candidate_plan: compileRunPlan(
              {
                run_id: "candidate_run",
                template_id: templateForPlan.template_id,
                template_version: templateForPlan.version,
                workspace_id: templateForPlan.workspace_scope,
                requested_by: "planner",
                intent: input.latestGoal,
                status: "draft",
                current_summary: "Candidate run plan generated",
                waiting_reason: null,
                blocked_reason: null,
                started_at: null,
                finished_at: null,
                last_event_id: null,
                created_at: nowIso(),
                updated_at: nowIso(),
                inputs: input.inputs,
                proposal_id: null,
              },
              templateForPlan,
            ),
            validation: validateRunRequestForTemplate(candidateRun, templateForPlan),
          }
        : await generateCandidatePlan(candidateRun, plannerOptions);
    const planDiff = buildPlanRevisionDiff(input.previousPlanCard, {
      template_id: primaryTemplateId,
      candidate_plan: candidatePlan.candidate_plan,
      validation: candidatePlan.validation,
    });
    const template = templateForPlan;
    const revision = input.priorPlanCount + 1;
    const summary =
      candidatePlan.validation.passed
        ? `Recommended ${candidatePlan.candidate_plan.compiled_nodes.length} step(s) with ${primaryTemplateName}.`
        : `Recommended ${primaryTemplateName} with ${candidatePlan.validation.warnings.length} warning(s).`;
    const primaryRecommendation =
      input.recommendation?.candidates.find((candidate) => candidate.template_id === primaryTemplateId) || null;
    const recommendationReason =
      input.explanationPrefix ||
      primaryRecommendation?.reason ||
      input.recommendation?.selected_template.reason ||
      (template ? `Using template ${template.name}.` : `Using template ${primaryTemplateName}.`);
    const alternativeCandidates = input.recommendation
      ? input.recommendation.candidates.filter((candidate) => candidate.template_id !== primaryTemplateId)
      : [];
    const alternativeSummary =
      alternativeCandidates.length > 0
        ? `Alternative templates: ${alternativeCandidates
            .slice(0, 3)
            .map((candidate) => candidate.name)
            .join(", ")}.`
        : "";
    const alternativeCandidate = alternativeCandidates[0] || null;
    const alternativeTemplate =
      alternativeCandidate?.template_id ? getTemplate(alternativeCandidate.template_id) : null;
    const alternativePlan =
      alternativeTemplate && alternativeTemplate.status === "published"
        ? await generateCandidatePlan({
            intent: input.latestGoal,
            template_id: alternativeTemplate.template_id,
            inputs: input.inputs,
          }, plannerOptions)
        : null;

    const planSummary =
      candidatePlan.validation.passed
        ? `I mapped the task into ${candidatePlan.candidate_plan.compiled_nodes.length} executable step(s) using ${primaryTemplateName}.`
        : `I mapped the task onto ${primaryTemplateName}, but the current route still carries ${candidatePlan.validation.warnings.length} warning(s).`;
    const textMessage = appendSessionMessage({
      sessionId: input.sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text: `${planSummary} ${recommendationReason}${alternativeSummary ? ` ${alternativeSummary}` : ""}`,
        template_id: primaryTemplateId,
        template_name: primaryTemplateName,
        recommendation: input.recommendation,
      },
    });
    const planCard = appendSessionMessage({
      sessionId: input.sessionId,
      role: "system",
      kind: "plan_card",
      content: {
        revision,
        option: "primary",
        intent: input.latestGoal,
        template_id: primaryTemplateId,
        template_name: primaryTemplateName,
        recommendation: input.recommendation,
        candidate_plan: candidatePlan.candidate_plan,
        validation: candidatePlan.validation,
        inputs: input.inputs,
        diff: planDiff,
        confirmation_checklist: buildConfirmationChecklist({
          revision,
          option: "primary",
          templateName: primaryTemplateName,
          candidatePlan: candidatePlan.candidate_plan,
          validation: candidatePlan.validation,
        }),
      },
    });
    const primaryExecutionTemplateId =
      resolveExecutionTemplateIdFromDraftTemplate(templateForPlan) ||
      input.recommendation?.selected_template.template_id ||
      primaryTemplateId;
    const primaryPlanOption = {
      source: "primary" as const,
      template_id: primaryTemplateId,
      execution_template_id: primaryExecutionTemplateId,
      template_name: primaryTemplateName,
      recommendation_reason:
        primaryRecommendation?.reason ||
        input.recommendation?.selected_template.reason ||
        (template ? `Using template ${template.name}.` : `Using template ${primaryTemplateName}.`),
      candidate_plan: candidatePlan.candidate_plan,
      validation: candidatePlan.validation,
      confirmation_checklist: buildConfirmationChecklist({
        revision,
        option: "primary",
        templateName: primaryTemplateName,
        candidatePlan: candidatePlan.candidate_plan,
        validation: candidatePlan.validation,
      }),
    };
    const alternativePlanOption = alternativePlan
        ? {
          source: "alternative" as const,
          template_id: alternativeTemplate?.template_id || alternativeCandidate?.template_id || "",
          execution_template_id: alternativeTemplate?.template_id || alternativeCandidate?.template_id || "",
          template_name:
            alternativeTemplate?.name || alternativeCandidate?.name || alternativeCandidate?.template_id || "Alternative",
          recommendation_reason: alternativeCandidate?.reason || "Alternative recommendation.",
          candidate_plan: alternativePlan.candidate_plan,
          validation: alternativePlan.validation,
          confirmation_checklist: buildConfirmationChecklist({
            revision,
            option: "alternative",
            templateName:
              alternativeTemplate?.name || alternativeCandidate?.name || alternativeCandidate?.template_id || "Alternative",
            candidatePlan: alternativePlan.candidate_plan,
            validation: alternativePlan.validation,
          }),
        }
      : null;
    const planOptionsCard = appendSessionMessage({
      sessionId: input.sessionId,
      role: "system",
      kind: "plan_options_card",
      content: {
        revision,
        intent: input.latestGoal,
        inputs: input.inputs,
        selected_option: input.selectedOption || "primary",
        source_revision: input.sourceRevision ?? null,
        source_option: input.sourceOption ?? null,
        primary: primaryPlanOption,
        alternative: alternativePlanOption,
      },
    });

    return {
      candidatePlan,
      textMessage,
      planCard,
      planOptionsCard,
      summary,
    };
  }

  function appendSessionMessage(input: {
    sessionId: string;
    role: SessionMessageRecord["role"];
    kind: SessionMessageRecord["kind"];
    content: Record<string, unknown>;
    linkedRunId?: string | null;
    linkedNodeRunId?: string | null;
    createdAt?: string;
  }): SessionMessageRecord {
    return createSessionMessage({
      session_id: input.sessionId,
      role: input.role,
      kind: input.kind,
      content: input.content,
      created_at: input.createdAt,
      linked_run_id: input.linkedRunId,
      linked_node_run_id: input.linkedNodeRunId,
    });
  }

  function updateSessionFromRun(sessionId: string, runId: string, runStatus: string): void {
    const session = getSession(sessionId);
    if (!session) {
      return;
    }

    const activeRunIds = new Set(session.active_run_ids);
    if (["completed", "failed", "cancelled"].includes(runStatus)) {
      activeRunIds.delete(runId);
    } else {
      activeRunIds.add(runId);
    }
    session.latest_run_id = runId;
    session.active_run_ids = [...activeRunIds];
    session.status =
      runStatus === "waiting_human"
        ? "waiting_human"
        : runStatus === "running" || runStatus === "queued"
          ? "running"
          : runStatus === "completed"
            ? "completed"
            : runStatus === "failed"
              ? "failed"
              : runStatus === "cancelled"
                ? "cancelled"
                : "ready_to_run";
    session.updated_at = nowIso();
    saveSession(session);
    syncSessionWorkingState(sessionId, session);
    saveSession(session);
  }

  function refreshSessionsLinkedToRun(runId: string, runStatus: string): void {
    for (const sessionId of getSessionIdsLinkedToRun(runId)) {
      updateSessionFromRun(sessionId, runId, runStatus);
    }
  }

  function createRunAndPersist(input: {
    intent: string;
    templateId: string;
    inputs: Record<string, unknown>;
    validationMode: RunValidationMode;
    proposalId?: string | null;
  }) {
    const template = getTemplate(input.templateId.trim());
    if (!template) {
      return {
        ok: false as const,
        status: 404,
        body: {
          code: "template_not_found",
          message: "Template not found.",
        },
      };
    }
    if (template.status !== "published") {
      return {
        ok: false as const,
        status: 409,
        body: {
          code: "template_not_published",
          message: "Template must be published before it can be executed.",
        },
      };
    }

    const validation =
      input.validationMode === "bypass"
        ? {
            passed: true,
            warnings: [],
            details: [],
          }
        : validateRunRequestForTemplate(
            {
              intent: input.intent.trim(),
              template_id: input.templateId.trim(),
              inputs: input.inputs,
            },
            template,
          );

    if (input.validationMode === "strict" && !validation.passed) {
      return {
        ok: false as const,
        status: 409,
        body: {
          code: "run_validation_failed",
          message: "Run validation failed.",
          validation,
        },
      };
    }

    const run = createRun(
      {
        intent: input.intent.trim(),
        template_id: input.templateId.trim(),
        inputs: input.inputs,
        validation_mode: input.validationMode,
        proposal_id: input.proposalId || undefined,
      },
      {
        templateVersion: template.version,
      },
    );

    const runPlan = compileRunPlan(run, template);
    saveRunPlan(runPlan);

    const nodeRuns = materializeInitialNodeRuns(runPlan, run.created_at);
    saveNodeRuns(run.run_id, nodeRuns);

    appendRunEvent({
      run_id: run.run_id,
      type: "run.created",
      actor_type: "user",
      actor_id: run.requested_by,
      payload: {
        template_id: run.template_id,
        template_version: run.template_version,
        validation_mode: input.validationMode,
        validation_passed: validation.passed,
        validation_warning_count: validation.warnings.length,
        proposal_id: input.proposalId || null,
      },
      created_at: run.created_at,
    });

    const queuedEvent = appendRunEvent({
      run_id: run.run_id,
      type: "run.queued",
      actor_type: "system",
      actor_id: "control-plane",
      payload: {
        current_summary: run.current_summary,
      },
      created_at: run.created_at,
    });

    let lastEventId = queuedEvent.event_id;
    const readyNodes = getReadyNodeRuns(runPlan);
    for (const node of readyNodes) {
      const readyEvent = appendRunEvent({
        run_id: run.run_id,
        node_run_id: node.node_run_id,
        type: "node.ready",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          node_type: node.type,
        },
        created_at: run.created_at,
      });
      lastEventId = readyEvent.event_id;
    }

    if (readyNodes.length > 0) {
      run.current_summary = `${readyNodes.length} node(s) ready for dispatch`;
      run.updated_at = run.created_at;
    }

    run.last_event_id = lastEventId;
    saveRun(run);

    if (readyNodes.length > 0) {
      executionAdapter.enqueueRun(run.run_id);
      if (executionAdapter.kind === "openclaw") {
        queueReadyNodes(run.run_id);
      }
    }

    return {
      ok: true as const,
      status: 201,
      body: {
        run_id: run.run_id,
        status: run.status,
        validation,
      },
    };
  }

  function finalizeSessionStateAfterPlanning(input: {
    sessionId: string;
    session: SessionRecord;
    latestGoal: string;
    summary: string;
    validationPassed: boolean;
    updatedAt: string;
  }): void {
    input.session.status = input.validationPassed ? "ready_to_run" : "planning";
    input.session.current_goal = input.latestGoal;
    input.session.current_plan_summary = input.summary;
    const metadata = clearSessionRouteStaleState(input.session);
    input.session.metadata = {
      ...metadata,
      working_goal: input.latestGoal,
      pending_decision: input.validationPassed
        ? "Compare the plan options, confirm one route, or run it directly."
        : "Resolve the planning warnings or revise the route before execution.",
      latest_orchestrator_intent: "plan_ready",
    };
    syncSessionWorkingState(input.sessionId, input.session);
    input.session.updated_at = input.updatedAt;
    saveSession(input.session);
  }

  function getSessionMissionSpecContract(sessionId: string, session: SessionRecord): MissionSpecContract | null {
    if (session.mission_spec_contract) {
      return session.mission_spec_contract;
    }
    const summary = buildSessionSummary(sessionId);
    return summary?.mission_spec_contract || null;
  }

  function getSessionMissionId(session: SessionRecord): string {
    return session.mission_spec_contract?.missionId || session.session_id;
  }

  function buildDagProposalAssignments(
    draft: Awaited<ReturnType<typeof generateDagDraft>>,
  ): DagProposalAssignment[] {
    const draftNodes = Array.isArray(draft.draft_template.nodes) ? draft.draft_template.nodes : [];
    return draftNodes.map((node) => {
      const recommendation = draft.registry_recommendations.find(
        (item) => item.node_id === node.id,
      );
      const config = isPlainObject(node.config) ? node.config : {};
      const outputContract = isPlainObject(config.output_contract)
        ? JSON.stringify(config.output_contract)
        : typeof config.output_contract === "string" && config.output_contract.trim()
          ? config.output_contract.trim()
          : null;
      return {
        node_id: node.id,
        node_name: node.name || null,
        subagent_profile_id: recommendation?.agent_profile_id || node.agent_profile || null,
        provider:
          typeof config.provider === "string" && config.provider.trim()
            ? config.provider.trim()
            : null,
        model:
          typeof config.model === "string" && config.model.trim()
            ? config.model.trim()
            : null,
        allowed_tools: Array.isArray(config.allowed_tools)
          ? config.allowed_tools.filter((item): item is string => typeof item === "string")
          : [],
        allowed_skills: recommendation?.skill_ids || node.allowed_skills || [],
        input_context:
          typeof config.input_context === "string" && config.input_context.trim()
            ? config.input_context.trim()
            : null,
        output_contract: outputContract,
        metadata: {
          node_type: node.type,
          recommendation_reason: recommendation?.reason || null,
          openclaw_agent_id: recommendation?.openclaw_agent_id || null,
        },
      };
    });
  }

  async function createDagProposalForSession(input: {
    sessionId: string;
    session: SessionRecord;
    latestGoal: string;
    body: CreateDagProposalRequest | SupersedeDagProposalRequest;
    supersedesProposalId?: string | null;
  }): Promise<
    | { ok: true; status: 201; proposal: DagProposalRecord }
    | { ok: false; status: number; body: Record<string, unknown> }
  > {
    const plannerOptions = resolveSessionPlannerInvocationOptions(input.session);
    const draft = await generateDagDraft(
      {
        intent: input.latestGoal,
        template_id:
          typeof input.body.template_id === "string" && input.body.template_id.trim()
            ? input.body.template_id.trim()
            : undefined,
        inputs: isPlainObject(input.body.inputs) ? input.body.inputs : {},
        orchestrator_profile_id: plannerOptions.orchestratorProfileId || undefined,
        planner_provider_id: plannerOptions.providerId || undefined,
        planner_model: plannerOptions.model || undefined,
        orchestrator_system_prompt: plannerOptions.orchestratorSystemPrompt || undefined,
      },
      plannerOptions,
    );
    const executionTemplateId =
      (typeof input.body.template_id === "string" && input.body.template_id.trim()
        ? input.body.template_id.trim()
        : null) ||
      draft.template_recommendation?.selected_template.template_id ||
      draft.planner_context.source_template_id;

    if (!executionTemplateId) {
      return {
        ok: false,
        status: 404,
        body: {
          code: "proposal_template_missing",
          message: "No execution template could be resolved for the DAG proposal.",
        },
      };
    }

    const sourceRevision =
      "source_revision" in input.body &&
      typeof input.body.source_revision === "number" &&
      Number.isInteger(input.body.source_revision)
        ? input.body.source_revision
        : null;
    const sourceOption =
      "source_option" in input.body &&
      (input.body.source_option === "primary" || input.body.source_option === "alternative")
        ? input.body.source_option
        : null;
    const sourceMessageId =
      typeof input.body.source_message_id === "string" && input.body.source_message_id.trim()
        ? input.body.source_message_id.trim()
        : null;

    const proposal = createDagProposal({
      missionId: getSessionMissionId(input.session),
      sessionId: input.sessionId,
      orchestratorProfileId: plannerOptions.orchestratorProfileId || null,
      sourceMessageId,
      sourceRevision,
      sourceOption,
      title: draft.draft_template.name || input.session.title,
      summary: draft.draft_template.description || `DAG proposal for ${input.session.title}`,
      missionSpecContract: getSessionMissionSpecContract(input.sessionId, input.session),
      plannerContext: {
        provider_id: draft.planner_context.provider_id || plannerOptions.providerId || null,
        model: plannerOptions.model || draft.planner_context.planner_model || null,
        orchestrator_profile_id: plannerOptions.orchestratorProfileId || null,
        system_prompt_summary: plannerOptions.orchestratorSystemPrompt
          ? compactText(plannerOptions.orchestratorSystemPrompt, 240)
          : null,
        fallback_used: draft.planner_context.fallback_used === true,
        fallback_reason: draft.planner_context.fallback_reason || null,
      },
      dagDraft: draft as unknown as Record<string, unknown>,
      routeCompare: null,
      assignments: buildDagProposalAssignments(draft),
      warnings: draft.validation.warnings,
      checklist: [
        "Review generated DAG structure.",
        "Review subagent assignments.",
        "Confirm before creating a run.",
      ],
      supersedesProposalId: input.supersedesProposalId || null,
      metadata: {
        execution_template_id: executionTemplateId,
        inputs: isPlainObject(input.body.inputs) ? input.body.inputs : {},
        planner_source_template_id: draft.planner_context.source_template_id,
        validation_passed: draft.validation.passed,
      },
    });

    return {
      ok: true,
      status: 201,
      proposal,
    };
  }

  async function performSessionDagDraft(input: {
    sessionId: string;
    session: SessionRecord;
    latestGoal: string;
    templateId?: string;
    inputs?: Record<string, unknown>;
    maxAgentNodes?: number;
  }) {
    const plannerOptions = resolveSessionPlannerInvocationOptions(input.session);
    const result = await generateDagDraft({
      intent: input.latestGoal,
      template_id: input.templateId?.trim() || undefined,
      inputs: input.inputs || {},
      max_agent_nodes: input.maxAgentNodes,
    }, plannerOptions);
    const draftMessage = appendSessionMessage({
      sessionId: input.sessionId,
      role: "system",
      kind: "draft_card",
      content: {
        intent: input.latestGoal,
        draft_template: result.draft_template,
        template_recommendation: result.template_recommendation,
        registry_recommendations: result.registry_recommendations,
        validation: result.validation,
        planner_context: result.planner_context,
      },
    });
    const orchestratorMessage = appendSessionMessage({
      sessionId: input.sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text:
          result.planner_context.draft_strategy === "registry_synthesis"
            ? "I shaped the current task into an initial workflow draft from the available agents and skills."
            : "I translated the current brief into a draft workflow that is ready to promote into full plan options.",
      },
    });
    input.session.status = "planning";
    input.session.current_goal = input.latestGoal;
    input.session.current_plan_summary = `Drafted workflow using ${result.planner_context.draft_strategy}.`;
    input.session.metadata = {
      ...clearSessionRouteStaleState(input.session),
      working_goal: input.latestGoal,
      pending_decision: "Promote the draft into plan options or discard it and redraft.",
      latest_orchestrator_intent: "draft_ready",
      open_questions: [],
    };
    syncSessionWorkingState(input.sessionId, input.session);
    input.session.last_orchestrator_message_id = orchestratorMessage.message_id;
    input.session.updated_at = draftMessage.created_at;
    saveSession(input.session);

    return {
      session: buildSessionSummary(input.sessionId),
      draft_template: result.draft_template,
      template_recommendation: result.template_recommendation,
      registry_recommendations: result.registry_recommendations,
      validation: result.validation,
      planner_context: result.planner_context,
      messages: [orchestratorMessage, draftMessage],
      draftMessage,
    };
  }

  async function performSessionPlan(input: {
    sessionId: string;
    session: SessionRecord;
    latestGoal: string;
    templateId?: string;
    draftMessageId?: string;
    inputs?: Record<string, unknown>;
  }) {
    const effectiveDraftMessage =
      typeof input.draftMessageId === "string" && input.draftMessageId.trim()
        ? getDraftMessageById(input.sessionId, input.draftMessageId.trim())
        : !input.templateId
          ? getLatestMessageByKinds(input.sessionId, ["draft_card"])
          : null;
    const resolved = await resolveSessionPlanningInput({
      sessionId: input.sessionId,
      session: input.session,
      latestGoal: input.latestGoal,
      templateId: input.templateId,
      draftMessage: effectiveDraftMessage,
      inputs: input.inputs || {},
    });
    if (!resolved.ok) {
      return resolved;
    }
    if (
      typeof input.draftMessageId === "string" &&
      input.draftMessageId.trim() &&
      !resolved.draftTemplate
    ) {
      return {
        ok: false as const,
        status: 404,
        body: {
          code: "draft_not_found",
          message: "Requested draft message was not found.",
        },
      };
    }

    const { candidatePlan, textMessage, planCard, planOptionsCard, summary } = await createSessionPlanMessages({
      sessionId: input.sessionId,
      session: input.session,
      latestGoal: input.latestGoal,
      templateId: resolved.templateId,
      inputs: resolved.inputs,
      priorPlanCount: resolved.priorPlanCount,
      previousPlanCard: resolved.previousPlanCard,
      recommendation: resolved.recommendation,
      templateOverride: resolved.draftTemplate || undefined,
    });

    finalizeSessionStateAfterPlanning({
      sessionId: input.sessionId,
      session: input.session,
      latestGoal: input.latestGoal,
      summary,
      validationPassed: candidatePlan.validation.passed,
      updatedAt: planOptionsCard.created_at,
    });
    appendAutoOrchestratorTurn({
      session: input.session,
      sessionId: input.sessionId,
      intent: "ask_plan",
      summary: candidatePlan.validation.passed
        ? "I compiled the current brief into executable route options and surfaced the safest route to review first."
        : "I compiled route options, but the current comparison still carries validation risk that should be reviewed before execution.",
      narrativeReply: textMessage.content.text as string,
      userText: input.latestGoal,
      userRead: `You want the current brief turned into comparable route options: ${compactText(input.latestGoal, 120)}`,
      workspaceImpact:
        "The workspace now holds a primary route and a backup route, plus the current validation and confirmation state.",
      generatedOutputs: [
        `Route revision v${typeof planOptionsCard.content.revision === "number" ? planOptionsCard.content.revision : 1}`,
        alternativePlanExists(planOptionsCard) ? "Two route options" : "Single route option",
      ],
      autoTransition: "plan",
      nextActionLabel: candidatePlan.validation.passed ? "Confirm a route" : "Review route warnings",
      nextActionDetail: candidatePlan.validation.passed
        ? "Compare the main and backup routes, then confirm the one you want to execute."
        : "Review the validation risks or revise the route before a strict run.",
      createdAt: planOptionsCard.created_at,
    });
    input.session.last_orchestrator_message_id = textMessage.message_id;
    saveSession(input.session);

    return {
      ok: true as const,
      status: 200,
      body: {
        session: buildSessionSummary(input.sessionId),
        recommendation: resolved.recommendation,
        candidate_plan: candidatePlan.candidate_plan,
        validation: candidatePlan.validation,
        messages: [textMessage, planCard, planOptionsCard],
      },
      planOptionsCard,
    };
  }

  async function performSessionRevise(input: {
    sessionId: string;
    session: SessionRecord;
    latestGoal: string;
    instructions: string;
    revision?: number;
    option?: "primary" | "alternative";
    appendRequestMessage?: boolean;
  }) {
    const sourcePlanningMessage =
      typeof input.revision === "number"
        ? getPlanningMessageByRevision(input.sessionId, input.revision)
        : getLatestPlanningMessage(input.sessionId);
    if (!sourcePlanningMessage) {
      return {
        ok: false as const,
        status: 409,
        body: {
          code: "plan_revision_missing",
          message: "Create an initial plan before revising it.",
        },
      };
    }

    const revisedSelection = await inferRevisedTemplateId({
      session: input.session,
      latestGoal: input.latestGoal,
      instructions: input.instructions.trim(),
      sourcePlanCard: sourcePlanningMessage,
    });
    const directives = parseReviseDirectives(input.instructions.trim());
    const mutatedTemplate = buildMutatedTemplateFromSource({
      sourceTemplateId: revisedSelection.templateId,
      latestGoal: input.latestGoal,
      directives,
    });
    const resolved = await resolveSessionPlanningInput({
      sessionId: input.sessionId,
      session: input.session,
      latestGoal: input.latestGoal,
      templateId: revisedSelection.templateId || undefined,
      inputs: {
        revision_request: input.instructions.trim(),
      },
      revisionInstruction: input.instructions.trim(),
      sourcePlanCard: sourcePlanningMessage,
    });
    if (!resolved.ok) {
      return resolved;
    }

    const reviseRequestMessage =
      input.appendRequestMessage === false
        ? null
        : appendSessionMessage({
            sessionId: input.sessionId,
            role: "user",
            kind: "text",
            content: {
              text: `Revise plan: ${input.instructions.trim()}`,
              revision_request: input.instructions.trim(),
              source_revision:
                typeof sourcePlanningMessage.content.revision === "number"
                  ? sourcePlanningMessage.content.revision
                  : null,
              source_option: input.option === "alternative" ? "alternative" : "primary",
            },
          });
    const { candidatePlan, textMessage, planCard, planOptionsCard, summary } = await createSessionPlanMessages({
      sessionId: input.sessionId,
      session: input.session,
      latestGoal: input.latestGoal,
      templateId: resolved.templateId,
      inputs: resolved.inputs,
      priorPlanCount: resolved.priorPlanCount,
      previousPlanCard: resolved.previousPlanCard,
      recommendation: revisedSelection.recommendation || resolved.recommendation,
      explanationPrefix: `${revisedSelection.reason} ${
        mutatedTemplate.notes.length > 0 ? `${mutatedTemplate.notes.join(" ")} ` : ""
      }Revision request: ${input.instructions.trim()}.`,
      templateOverride: mutatedTemplate.template,
      selectedOption: input.option === "alternative" ? "alternative" : "primary",
      sourceRevision:
        typeof sourcePlanningMessage.content.revision === "number"
          ? sourcePlanningMessage.content.revision
          : null,
      sourceOption: input.option === "alternative" ? "alternative" : "primary",
    });

    finalizeSessionStateAfterPlanning({
      sessionId: input.sessionId,
      session: input.session,
      latestGoal: input.latestGoal,
      summary,
      validationPassed: candidatePlan.validation.passed,
      updatedAt: planOptionsCard.created_at,
    });
    input.session.last_orchestrator_message_id = textMessage.message_id;
    saveSession(input.session);

    return {
      ok: true as const,
      status: 200,
      body: {
        session: buildSessionSummary(input.sessionId),
        recommendation: revisedSelection.recommendation || resolved.recommendation,
        candidate_plan: candidatePlan.candidate_plan,
        validation: candidatePlan.validation,
        messages: [reviseRequestMessage, textMessage, planCard, planOptionsCard].filter(
          (message): message is SessionMessageRecord => !!message,
        ),
      },
      planOptionsCard,
    };
  }

  async function performSessionRun(input: {
    sessionId: string;
    session: SessionRecord;
    latestGoal: string;
    templateId?: string;
    inputs?: Record<string, unknown>;
    validationMode?: RunValidationMode;
    planRevision?: number;
    planOption?: "primary" | "alternative";
    proposalId?: string;
  }) {
    const { planStale, staleReason } = getSessionRouteStaleState(input.sessionId, input.session);
    if (planStale) {
      return {
        ok: false as const,
        status: 409,
        body: {
          code: "plan_stale",
          message:
            staleReason ||
            "The current route is stale because the task brief changed. Revise or replan before creating a run.",
        },
      };
    }
    const requestedProposalId =
      typeof input.proposalId === "string" && input.proposalId.trim()
        ? input.proposalId.trim()
        : typeof input.session.confirmed_proposal_id === "string" && input.session.confirmed_proposal_id.trim()
          ? input.session.confirmed_proposal_id.trim()
          : null;
    let selectedProposal: DagProposalRecord | null = null;
    if (requestedProposalId) {
      selectedProposal = getDagProposal(input.sessionId, requestedProposalId);
      if (!selectedProposal) {
        return {
          ok: false as const,
          status: 404,
          body: {
            code: "proposal_not_found",
            message: "Requested DAG proposal was not found.",
          },
        };
      }
      if (selectedProposal.status !== "confirmed" && selectedProposal.status !== "review_ready") {
        return {
          ok: false as const,
          status: 409,
          body: {
            code: "proposal_not_runnable",
            message: "Only review-ready or confirmed DAG proposals can create a run.",
          },
        };
      }
    }

    let selectedPlanCard: SessionMessageRecord | null = null;
    if (!selectedProposal && typeof input.planRevision === "number") {
      selectedPlanCard = getPlanningMessageByRevision(input.sessionId, input.planRevision);
      if (!selectedPlanCard) {
        return {
          ok: false as const,
          status: 404,
          body: {
            code: "plan_revision_not_found",
            message: "Requested plan revision was not found.",
          },
        };
      }
    } else if (!selectedProposal && typeof input.session.confirmed_plan_revision === "number") {
      selectedPlanCard = getPlanningMessageByRevision(input.sessionId, input.session.confirmed_plan_revision);
    } else if (!selectedProposal) {
      selectedPlanCard = getLatestPlanningMessage(input.sessionId);
    }

    const selectedOption =
      selectedProposal?.source_option ||
      input.planOption ||
      input.session.confirmed_plan_option ||
      "primary";
    const selectedPlanConfig = extractPlanOptionExecutionConfig(
      selectedPlanCard && selectedPlanCard.kind === "plan_options_card"
        ? {
            ...selectedPlanCard,
            content: {
              ...selectedPlanCard.content,
              selected_option: selectedOption,
            },
          }
        : selectedPlanCard,
    );
    const proposalMetadata = selectedProposal && isPlainObject(selectedProposal.metadata) ? selectedProposal.metadata : {};
    const proposalTemplateId =
      typeof proposalMetadata.execution_template_id === "string" && proposalMetadata.execution_template_id.trim()
        ? proposalMetadata.execution_template_id.trim()
        : null;
    let templateId =
      input.templateId?.trim() ||
      proposalTemplateId ||
      selectedPlanConfig?.execution_template_id ||
      selectedPlanConfig?.template_id ||
      "";
    if (!templateId) {
      const plannerOptions = resolveSessionPlannerInvocationOptions(input.session);
      const recommendation = await recommendTemplate(input.latestGoal, plannerOptions);
      if (!recommendation) {
        return {
          ok: false as const,
          status: 404,
          body: {
            code: "no_published_templates",
            message: "No published templates are available for run creation.",
          },
        };
      }
      templateId = recommendation.selected_template.template_id;
    }

    const requestedInputs = {
      ...(isPlainObject(proposalMetadata.inputs) ? proposalMetadata.inputs : {}),
      ...(selectedPlanConfig?.inputs || {}),
      ...(input.inputs || {}),
    };
    const runIntent = selectedPlanConfig?.intent || selectedProposal?.summary || input.latestGoal;
    if (!("goal" in requestedInputs) && runIntent) {
      requestedInputs.goal = runIntent;
    }
    const validationMode = input.validationMode || "strict";
    const result = createRunAndPersist({
      intent: runIntent,
      templateId,
      inputs: requestedInputs,
      validationMode,
      proposalId: selectedProposal?.proposal_id || requestedProposalId,
    });
    if (!result.ok) {
      return result;
    }

    const refreshedSession = getSession(input.sessionId);
    const runMessage = appendSessionMessage({
      sessionId: input.sessionId,
      role: "system",
      kind: "run_card",
      content: {
        run_id: result.body.run_id,
        status: result.body.status,
        template_id: templateId,
        validation: result.body.validation,
        plan_revision:
          selectedProposal?.source_revision ??
          selectedPlanConfig?.revision ??
          input.session.confirmed_plan_revision ??
          null,
        plan_option: selectedOption,
        proposal_id: selectedProposal?.proposal_id || null,
      },
      linkedRunId: result.body.run_id,
    });
    const orchestratorMessage = appendSessionMessage({
      sessionId: input.sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text: `Opened run ${result.body.run_id} from the current session context.`,
      },
      linkedRunId: result.body.run_id,
    });

    if (refreshedSession) {
      refreshedSession.current_goal = runIntent;
      refreshedSession.current_plan_summary = `Run ${result.body.run_id} created from session.`;
      refreshedSession.latest_run_id = result.body.run_id;
      refreshedSession.last_orchestrator_message_id = orchestratorMessage.message_id;
      refreshedSession.confirmed_plan_revision =
        selectedProposal?.source_revision ??
        selectedPlanConfig?.revision ??
        input.session.confirmed_plan_revision;
      refreshedSession.confirmed_plan_option = selectedOption;
      refreshedSession.confirmed_proposal_id = selectedProposal?.proposal_id || input.session.confirmed_proposal_id;
      refreshedSession.metadata = {
        ...clearSessionRouteStaleState(refreshedSession),
        working_goal: runIntent,
        latest_proposal_id: selectedProposal?.proposal_id || null,
        pending_decision: "Monitor the run, intervene if needed, or prepare the next revision.",
        latest_orchestrator_intent: "run_started",
      };
      syncSessionWorkingState(input.sessionId, refreshedSession);
      appendAutoOrchestratorTurn({
        session: refreshedSession,
        sessionId: input.sessionId,
        intent: "ask_run",
        summary: selectedProposal
          ? `I opened a real run from proposal ${selectedProposal.proposal_id}.`
          : `I opened a real run from route v${selectedPlanConfig?.revision ?? input.session.confirmed_plan_revision ?? "?"} / ${selectedOption}.`,
        narrativeReply: orchestratorMessage.content.text as string,
        userText: runIntent,
        userRead: `You want the selected route moved into real execution: ${compactText(runIntent, 120)}`,
        workspaceImpact:
          "The workspace is now tracking a live run, its current node, and any future approvals, interventions, or artifacts.",
        generatedOutputs: [
          `Run ${result.body.run_id}`,
          `Validation: ${result.body.validation.passed ? "passed" : "review needed"}`,
        ],
        autoTransition: "run",
        nextActionLabel: "Monitor execution",
        nextActionDetail: "Stay in the mission thread for node progress, approvals, and runtime interventions.",
        createdAt: runMessage.created_at,
      });
      refreshedSession.updated_at = runMessage.created_at;
      saveSession(refreshedSession);
    }

    return {
      ok: true as const,
      status: 201,
      body: {
        ...result.body,
        session: buildSessionSummary(input.sessionId),
        messages: [orchestratorMessage, runMessage],
      },
      runMessage,
    };
  }

  function queueReadyNodes(runId: string): void {
    const run = getRun(runId);
    const plan = getRunPlan(runId);
    if (!run || !plan) {
      return;
    }
    if (["paused", "completed", "failed", "cancelled"].includes(run.status)) {
      return;
    }

    const readyNodes = getReadyNodeRuns(plan);
    if (readyNodes.length === 0) {
      return;
    }

    const maxParallelNodes = resolveMaxParallelNodes(plan);
    const activeDispatchNodes = countActiveDispatchNodes(plan);
    const availableSlots = Math.max(0, maxParallelNodes - activeDispatchNodes);
    if (availableSlots <= 0) {
      return;
    }
    const readyNodesToDispatch = readyNodes.slice(0, availableSlots);
    if (readyNodesToDispatch.length === 0) {
      return;
    }

    const nodeRuns = listNodeRuns(runId);
    const dispatchTime = nowIso();

    if (run.status === "queued") {
      const runStartedEvent = appendRunEvent({
        run_id: runId,
        type: "run.started",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          ready_nodes: readyNodesToDispatch.length,
        },
        created_at: dispatchTime,
      });
      run.status = "running";
      run.started_at = run.started_at ?? dispatchTime;
      run.updated_at = dispatchTime;
      run.last_event_id = runStartedEvent.event_id;
    } else if (run.status !== "paused" && run.status !== "cancelled") {
      run.status = "running";
      run.updated_at = dispatchTime;
    }

    let lastEventId = run.last_event_id;
    for (const node of readyNodesToDispatch) {
      const nodeRun = getMutableNodeRun(nodeRuns, node.node_run_id);
      if (!nodeRun || nodeRun.status !== "ready") {
        continue;
      }

      if (node.type === "end") {
        applyNodeStatus(
          plan,
          nodeRuns,
          node.node_run_id,
          "completed",
          dispatchTime,
          "Workflow completed",
          100,
        );

        const completedEvent = appendRunEvent({
          run_id: runId,
          node_run_id: node.node_run_id,
          type: "node.completed",
          actor_type: "system",
          actor_id: "scheduler",
          payload: {
            node_id: node.node_id,
            node_name: node.name,
            artifacts: [],
          },
          created_at: dispatchTime,
        });
        lastEventId = completedEvent.event_id;
        run.current_summary = "Workflow completed";

        if (areAllNodesCompleted(nodeRuns)) {
          const runCompletedEvent = appendRunEvent({
            run_id: runId,
            type: "run.completed",
            actor_type: "system",
            actor_id: "control-plane",
            payload: {
              completed_nodes: nodeRuns.length,
            },
            created_at: dispatchTime,
          });
          run.status = "completed";
          run.current_summary = "Run completed";
          run.finished_at = dispatchTime;
          run.updated_at = dispatchTime;
          run.last_event_id = runCompletedEvent.event_id;
          plan.status = "completed";
          saveRun(run);
          saveRunPlan(plan);
          saveNodeRuns(runId, nodeRuns);
          return;
        }
        continue;
      }

      applyNodeStatus(
        plan,
        nodeRuns,
        node.node_run_id,
        "running",
        dispatchTime,
        "Dispatching to OpenClaw bridge",
        5,
      );

      const startedEvent = appendRunEvent({
        run_id: runId,
        node_run_id: node.node_run_id,
        type: "node.started",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          node_type: node.type,
          adapter: executionAdapter.kind,
        },
        created_at: dispatchTime,
      });
      lastEventId = startedEvent.event_id;
      run.current_summary = `Dispatching node: ${node.name}`;

      const upstreamNodeIds = new Set(
        plan.edges
          .filter((edge) => edge.to === node.node_id)
          .map((edge) => edge.from),
      );
      const upstreamCompiledNodes = plan.compiled_nodes.filter((compiled) =>
        upstreamNodeIds.has(compiled.node_id),
      );
      const artifactsByNodeRunId = new Map<string, ReturnType<typeof listArtifacts>>(
        upstreamCompiledNodes.map((compiled) => [
          compiled.node_run_id,
          listArtifacts(runId).filter((artifact) => artifact.node_run_id === compiled.node_run_id),
        ]),
      );
      const upstreamContext = upstreamCompiledNodes.map((compiled) => {
        const upstreamRun = getMutableNodeRun(nodeRuns, compiled.node_run_id);
        const upstreamArtifacts = artifactsByNodeRunId.get(compiled.node_run_id) || [];
        return {
          node_run_id: compiled.node_run_id,
          node_id: compiled.node_id,
          node_name: compiled.name,
          status: upstreamRun?.status || compiled.status,
          summary: upstreamRun?.progress.message || "",
          artifacts: upstreamArtifacts.map((artifact) => ({
            artifact_id: artifact.artifact_id,
            type: artifact.type,
            name: artifact.name,
            storage_uri: artifact.storage_uri,
            mime_type: artifact.mime_type,
            size_bytes: artifact.size_bytes,
          })),
        };
      });
      const extraInputPayload =
        (() => {
          const value: Record<string, unknown> = {};
          if (upstreamContext.length > 0) {
            value.upstream_context = {
              nodes: upstreamContext,
            };
          }

          const explicitProjectSlug =
            typeof run.inputs.project_slug === "string" && run.inputs.project_slug.trim()
              ? run.inputs.project_slug.trim()
              : typeof run.inputs.subject === "string" &&
                  /^[a-z0-9_-]+$/i.test(run.inputs.subject.trim())
                ? run.inputs.subject.trim()
              : null;
          const explicitProjectLocalRepo =
            typeof run.inputs.project_local_repo === "string" && run.inputs.project_local_repo.trim()
              ? run.inputs.project_local_repo.trim()
              : null;

          if (explicitProjectSlug) {
            value.project_slug = explicitProjectSlug;
          }
          if (explicitProjectLocalRepo) {
            value.project_local_repo = explicitProjectLocalRepo;
          }

          return Object.keys(value).length > 0 ? value : undefined;
        })();

      const envelope = buildDispatchEnvelope(run, plan, node, {
        extraInputPayload,
      });
      void executionAdapter
        .dispatchNode(envelope)
        .then(async (dispatch) => {
          node.execution_ref = {
            openclaw_task_id: dispatch.openclaw_task_id,
            openclaw_session_id: dispatch.openclaw_session_id,
          };
          saveRunPlan(plan);
          await executionAdapter.handleReport(buildAcceptedReport(envelope, dispatch));

          const payload: Record<string, unknown> = {
            dispatch_id: dispatch.dispatch_id,
            openclaw_task_id: dispatch.openclaw_task_id,
            openclaw_session_id: dispatch.openclaw_session_id,
            dispatch_status: dispatch.status,
          };

          appendRunEvent({
            run_id: runId,
            node_run_id: node.node_run_id,
            type: "node.progress",
            actor_type: "system",
            actor_id: "openclaw-adapter",
            payload,
            created_at: nowIso(),
          });
        })
        .catch((error) => {
          const failedAt = nowIso();
          const latestRun = getRun(runId);
          const latestPlan = getRunPlan(runId);
          const latestNodeRuns = listNodeRuns(runId);
          if (!latestRun || !latestPlan) {
            return;
          }

          const latestNode = getCompiledNode(latestPlan, node.node_run_id);
          const latestNodeRun = getMutableNodeRun(latestNodeRuns, node.node_run_id);
          if (!latestNode || !latestNodeRun) {
            return;
          }

          applyNodeStatus(
            latestPlan,
            latestNodeRuns,
            node.node_run_id,
            "failed",
            failedAt,
            error instanceof Error ? error.message : "OpenClaw dispatch failed",
            100,
          );

          const failedEvent = appendRunEvent({
            run_id: runId,
            node_run_id: node.node_run_id,
            type: "node.failed",
            actor_type: "system",
            actor_id: "openclaw-adapter",
            payload: {
              node_id: latestNode.node_id,
              node_name: latestNode.name,
              error: error instanceof Error ? error.message : "OpenClaw dispatch failed",
            },
            created_at: failedAt,
          });

          latestRun.status = "failed";
          latestRun.current_summary =
            error instanceof Error ? error.message : "OpenClaw dispatch failed";
          latestRun.blocked_reason = latestRun.current_summary;
          latestRun.finished_at = failedAt;
          latestRun.updated_at = failedAt;
          latestRun.last_event_id = failedEvent.event_id;
          latestPlan.status = "failed";
          saveRun(latestRun);
          saveRunPlan(latestPlan);
          saveNodeRuns(runId, latestNodeRuns);
        });
    }

    run.last_event_id = lastEventId ?? run.last_event_id;
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(runId, nodeRuns);
  }

  function isValidReportCallback(body: unknown): body is OpenClawReportCallbackRequest {
    if (!isPlainObject(body)) {
      return false;
    }
    return (
      typeof body.run_id === "string" &&
      !!body.run_id.trim() &&
      typeof body.node_run_id === "string" &&
      !!body.node_run_id.trim() &&
      typeof body.status === "string" &&
      !!body.status.trim()
    );
  }

  function applyOpenClawCallback(report: OpenClawReportCallbackRequest): void {
    const run = getRun(report.run_id);
    const plan = getRunPlan(report.run_id);
    const nodeRuns = listNodeRuns(report.run_id);
    if (!run || !plan) {
      throw new Error("RUN_NOT_FOUND");
    }

    const node = getCompiledNode(plan, report.node_run_id);
    const nodeRun = getMutableNodeRun(nodeRuns, report.node_run_id);
    if (!node || !nodeRun) {
      throw new Error("NODE_NOT_FOUND");
    }

    const timestamp = report.created_at || nowIso();
    const progress = report.progress || null;
    const normalizedMessage =
      progress?.message ||
      (report.status === "completed"
        ? "Node completed"
        : report.status === "failed"
          ? report.error?.message || "Node failed"
          : report.status === "accepted"
            ? "Dispatch accepted"
            : "Node running");
    const normalizedPercent =
      typeof progress?.percent === "number"
        ? progress.percent
        : report.status === "completed" || report.status === "failed"
          ? 100
          : report.status === "accepted"
            ? 0
            : 50;

    if (report.raw_ref) {
      node.execution_ref = {
        openclaw_task_id: report.raw_ref.openclaw_task_id,
        openclaw_session_id: report.raw_ref.openclaw_session_id,
      };
    }

    if (report.status === "accepted") {
      nodeRun.progress = {
        percent: normalizedPercent,
        message: normalizedMessage,
        updated_at: timestamp,
      };
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      return;
    }

    if (report.status === "running" || report.status === "waiting_human") {
      applyNodeStatus(
        plan,
        nodeRuns,
        report.node_run_id,
        report.status,
        timestamp,
        normalizedMessage,
        normalizedPercent,
      );

      let eventType:
        | "approval.requested"
        | "approval.granted"
        | "human_input.requested"
        | "human_input.submitted"
        | "node.progress" =
        "node.progress";
      let shouldAutoResumeNode = false;
      if (report.status === "waiting_human") {
        if ((process.env.MY_MATE_AUTO_APPROVE_HUMAN_GATES || "false").toLowerCase() === "true") {
          shouldAutoResumeNode = true;
          eventType = node.human_input_schema ? "human_input.submitted" : "approval.granted";
        } else {
          if (node.human_input_schema) {
            eventType = "human_input.requested";
            const pendingInput = findPendingHumanInputForNode(run.run_id, report.node_run_id);
            if (!pendingInput) {
              saveHumanInput(
                createHumanInputRecord({
                  runId: run.run_id,
                  nodeRunId: report.node_run_id,
                  summary: normalizedMessage,
                  inputSchema: node.human_input_schema,
                  requestedAt: timestamp,
                }),
              );
            }
          } else {
            eventType = "approval.requested";
            const pendingApproval = findPendingApprovalForNode(run.run_id, report.node_run_id);
            if (!pendingApproval) {
              saveApproval(
                createApprovalRecord({
                  runId: run.run_id,
                  nodeRunId: report.node_run_id,
                  kind: node.approval_kind || "human_review",
                  summary: normalizedMessage,
                  requestedAt: timestamp,
                }),
              );
            }
          }
        }
      }

      const event = appendRunEvent({
        run_id: run.run_id,
        node_run_id: report.node_run_id,
        type: eventType,
        actor_type: "agent",
        actor_id: "openclaw-bridge",
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          message: normalizedMessage,
          percent: normalizedPercent,
          auto_approved: shouldAutoResumeNode,
        },
        created_at: timestamp,
      });

      if (shouldAutoResumeNode) {
        node.status = "ready";
        node.execution_ref = {
          openclaw_task_id: null,
          openclaw_session_id: null,
        };
        node.retry_policy.attempt = nodeRun.attempt;
        nodeRun.status = "ready";
        nodeRun.progress = {
          percent: 0,
          message: "Human gate auto-approved; ready for dispatch",
          updated_at: timestamp,
        };
        nodeRun.finished_at = null;
      }

      run.status =
        report.status === "waiting_human" && !shouldAutoResumeNode
          ? "waiting_human"
          : "running";
      run.current_summary = shouldAutoResumeNode
        ? `Human gate auto-approved: ${node.name}`
        : normalizedMessage;
      run.waiting_reason =
        report.status === "waiting_human" && !shouldAutoResumeNode
          ? normalizedMessage
          : run.waiting_reason;
      run.updated_at = timestamp;
      run.last_event_id = event.event_id;
      plan.status = run.status;
      saveRun(run);
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      refreshSessionsLinkedToRun(run.run_id, run.status);
      if (shouldAutoResumeNode) {
        queueReadyNodes(run.run_id);
      }
      return;
    }

    if (report.status === "failed" || report.status === "cancelled") {
      applyNodeStatus(
        plan,
        nodeRuns,
        report.node_run_id,
        report.status,
        timestamp,
        normalizedMessage,
        normalizedPercent,
      );

      const event = appendRunEvent({
        run_id: run.run_id,
        node_run_id: report.node_run_id,
        type: "node.failed",
        actor_type: "agent",
        actor_id: "openclaw-bridge",
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          error: report.error || null,
        },
        created_at: timestamp,
      });

      run.status = report.status === "cancelled" ? "cancelled" : "failed";
      run.current_summary = normalizedMessage;
      run.blocked_reason = report.error?.message || normalizedMessage;
      run.finished_at = timestamp;
      run.updated_at = timestamp;
      run.last_event_id = event.event_id;
      plan.status = run.status;
      saveRun(run);
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      refreshSessionsLinkedToRun(run.run_id, run.status);
      return;
    }

    if (report.status !== "completed") {
      throw new Error("INVALID_REPORT_STATUS");
    }

    applyNodeStatus(
      plan,
      nodeRuns,
      report.node_run_id,
      "completed",
      timestamp,
      normalizedMessage,
      normalizedPercent,
    );

    const artifactRecords = (report.artifacts || []).map((artifact) =>
      createArtifactRecord({
        runId: run.run_id,
        nodeRunId: report.node_run_id,
        artifact,
        createdAt: timestamp,
      }),
    );
    if (artifactRecords.length > 0) {
      upsertArtifacts(artifactRecords);
      for (const artifactRecord of artifactRecords) {
        appendRunEvent({
          run_id: run.run_id,
          node_run_id: report.node_run_id,
          type: "artifact.created",
          actor_type: "agent",
          actor_id: "openclaw-bridge",
          payload: {
            artifact_id: artifactRecord.artifact_id,
            name: artifactRecord.name,
            type: artifactRecord.type,
            storage_uri: artifactRecord.storage_uri,
          },
          created_at: timestamp,
        });
      }
    }

    let lastEventId = appendRunEvent({
      run_id: run.run_id,
      node_run_id: report.node_run_id,
      type: "node.completed",
      actor_type: "agent",
      actor_id: "openclaw-bridge",
      payload: {
        node_id: node.node_id,
        node_name: node.name,
        artifacts: report.artifacts || [],
      },
      created_at: timestamp,
    }).event_id;

    const unlockedNodes = unlockReadyNodeRuns(plan, nodeRuns, timestamp);
    for (const unlockedNode of unlockedNodes) {
      const readyEvent = appendRunEvent({
        run_id: run.run_id,
        node_run_id: unlockedNode.node_run_id,
        type: "node.ready",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          node_id: unlockedNode.node_id,
          node_name: unlockedNode.name,
          node_type: unlockedNode.type,
        },
        created_at: timestamp,
      });
      lastEventId = readyEvent.event_id;
    }

    if (areAllNodesCompleted(nodeRuns)) {
      const completedEvent = appendRunEvent({
        run_id: run.run_id,
        type: "run.completed",
        actor_type: "system",
        actor_id: "control-plane",
        payload: {
          completed_nodes: nodeRuns.length,
        },
        created_at: timestamp,
      });
      run.status = "completed";
      run.current_summary = "Run completed";
      run.finished_at = timestamp;
      run.updated_at = timestamp;
      run.last_event_id = completedEvent.event_id;
      plan.status = "completed";
      saveRun(run);
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      refreshSessionsLinkedToRun(run.run_id, run.status);
      return;
    }

    run.status = "running";
    run.current_summary =
      unlockedNodes.length > 0
        ? `${unlockedNodes.length} downstream node(s) unlocked`
        : "Waiting for next node callback";
    run.updated_at = timestamp;
    run.last_event_id = lastEventId;
    plan.status = "running";
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(run.run_id, nodeRuns);
    refreshSessionsLinkedToRun(run.run_id, run.status);

    if (unlockedNodes.length > 0) {
      queueReadyNodes(run.run_id);
    }
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/api/templates", (_req: Request, res: Response) => {
    const items = listTemplates().map((template) => ({
      template_id: template.template_id,
      version: template.version,
      name: template.name,
      status: template.status,
      description: template.description,
      workspace_scope: template.workspace_scope,
      input_schema: template.input_schema,
      policy: template.policy,
      metadata: template.metadata,
    }));
    res.json({ items });
  });

  app.post("/api/templates", (req: Request, res: Response) => {
    const body = req.body;
    if (
      !assertTemplateDraftBody(body) ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      typeof body.description !== "string" ||
      !body.description.trim() ||
      !isPlainObject(body.input_schema) ||
      !isPlainObject(body.policy) ||
      !Array.isArray(body.nodes) ||
      !Array.isArray(body.edges)
    ) {
      return res.status(400).json({
        code: "invalid_request",
        message: "name, description, input_schema, policy, nodes, and edges are required.",
      });
    }

    try {
      const template = createTemplate(body as CreateTemplateRequest);
      return res.status(201).json({
        template_id: template.template_id,
        version: template.version,
        name: template.name,
        status: template.status,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_EXISTS") {
        return res.status(409).json({
          code: "template_exists",
          message: "Template already exists.",
        });
      }

      return res.status(400).json({
        code: "invalid_template",
        message: error instanceof Error ? error.message : "Template creation failed.",
      });
    }
  });

  app.get("/api/templates/:templateId", (req: Request, res: Response) => {
    const templateId = getSingleParam(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "templateId is required.",
      });
    }

    const template = getTemplate(templateId);
    if (!template) {
      return res.status(404).json({
        code: "not_found",
        message: "Template not found.",
      });
    }

    return res.json(template);
  });

  app.get("/api/templates/:templateId/lineage", (req: Request, res: Response) => {
    const templateId = getSingleParam(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "templateId is required.",
      });
    }

    const lineage = getTemplateLineage(templateId);
    if (!lineage) {
      return res.status(404).json({
        code: "not_found",
        message: "Template not found.",
      });
    }

    return res.json(lineage);
  });

  app.put("/api/templates/:templateId", (req: Request, res: Response) => {
    const templateId = getSingleParam(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "templateId is required.",
      });
    }

    const body = req.body;
    if (!assertTemplateDraftBody(body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "Template draft body is invalid.",
      });
    }

    try {
      const template = updateTemplateDraft(templateId, body as UpdateTemplateRequest);
      return res.json(template);
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_NOT_DRAFT") {
        return res.status(409).json({
          code: "template_not_draft",
          message: "Only draft templates can be updated.",
        });
      }

      return res.status(400).json({
        code: "invalid_template",
        message: error instanceof Error ? error.message : "Template update failed.",
      });
    }
  });

  app.post("/api/templates/:templateId/publish", (req: Request, res: Response) => {
    const templateId = getSingleParam(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "templateId is required.",
      });
    }

    try {
      const template = publishTemplate(templateId);
      return res.json({
        template_id: template.template_id,
        version: template.version,
        status: template.status,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_ARCHIVED") {
        return res.status(409).json({
          code: "template_archived",
          message: "Archived templates cannot be published.",
        });
      }

      return res.status(400).json({
        code: "invalid_template",
        message: error instanceof Error ? error.message : "Template publish failed.",
      });
    }
  });

  app.post("/api/templates/:templateId/archive", (req: Request, res: Response) => {
    const templateId = getSingleParam(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "templateId is required.",
      });
    }

    try {
      const template = archiveTemplate(templateId);
      return res.json({
        template_id: template.template_id,
        version: template.version,
        status: template.status,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Template not found.",
        });
      }
      return res.status(400).json({
        code: "invalid_template",
        message: error instanceof Error ? error.message : "Template archive failed.",
      });
    }
  });

  app.post("/api/templates/:templateId/derive", (req: Request, res: Response) => {
    const templateId = getSingleParam(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "templateId is required.",
      });
    }
    if (!isTemplateDeriveBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "template_id, name, description, and metadata are optional.",
      });
    }

    try {
      const template = deriveTemplateDraft(templateId, req.body);
      return res.status(201).json(template);
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_ARCHIVED") {
        return res.status(409).json({
          code: "template_archived",
          message: "Archived templates cannot be derived.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_EXISTS") {
        return res.status(409).json({
          code: "template_exists",
          message: "Template already exists.",
        });
      }
      return res.status(400).json({
        code: "invalid_template",
        message: error instanceof Error ? error.message : "Template derive failed.",
      });
    }
  });

  app.post("/api/templates/:templateId/new-version", (req: Request, res: Response) => {
    const templateId = getSingleParam(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "templateId is required.",
      });
    }
    if (!isTemplateDeriveBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "template_id, name, description, and metadata are optional.",
      });
    }

    try {
      const template = createNextTemplateVersion(templateId, req.body);
      return res.status(201).json(template);
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED") {
        return res.status(409).json({
          code: "template_not_published",
          message: "Only published templates can create a next version.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_EXISTS") {
        return res.status(409).json({
          code: "template_exists",
          message: "Template already exists.",
        });
      }
      return res.status(400).json({
        code: "invalid_template",
        message: error instanceof Error ? error.message : "Template new version failed.",
      });
    }
  });

  app.get("/api/orchestrator-profiles", (_req: Request, res: Response) => {
    return res.json({ items: listOrchestratorProfiles() });
  });

  app.post("/api/orchestrator-profiles", (req: Request, res: Response) => {
    if (!isOrchestratorProfileBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "name is required; provider, model, system_prompt, tools, subagents, and policies must be valid when provided.",
      });
    }
    try {
      const profile = upsertOrchestratorProfile(req.body);
      return res.status(201).json(profile);
    } catch (error) {
      return res.status(400).json({
        code: "invalid_orchestrator_profile",
        message: error instanceof Error ? error.message : "Orchestrator profile upsert failed.",
      });
    }
  });

  app.get("/api/orchestrator-profiles/:orchestratorId", (req: Request, res: Response) => {
    const orchestratorId = getSingleParam(req.params.orchestratorId);
    if (!orchestratorId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "orchestratorId is required.",
      });
    }
    const profile = getOrchestratorProfile(orchestratorId);
    if (!profile) {
      return res.status(404).json({
        code: "not_found",
        message: "Orchestrator profile not found.",
      });
    }
    return res.json(profile);
  });

  app.get("/api/registry/agent-profiles", (req: Request, res: Response) => {
    const status = getSingleParam(req.query.status as string | string[] | undefined);
    const items = listAgentProfiles(status === "active" || status === "disabled" ? status : undefined);
    return res.json({ items });
  });

  app.post("/api/registry/agent-profiles", (req: Request, res: Response) => {
    if (!isAgentProfileBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "name and openclaw_agent_id are required.",
      });
    }
    try {
      const profile = upsertAgentProfile(req.body);
      return res.status(201).json(profile);
    } catch (error) {
      return res.status(400).json({
        code: "invalid_agent_profile",
        message: error instanceof Error ? error.message : "Agent profile upsert failed.",
      });
    }
  });

  app.get("/api/registry/agent-profiles/:profileId", (req: Request, res: Response) => {
    const profileId = getSingleParam(req.params.profileId);
    if (!profileId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "profileId is required.",
      });
    }
    const profile = getAgentProfile(profileId);
    if (!profile) {
      return res.status(404).json({
        code: "not_found",
        message: "Agent profile not found.",
      });
    }
    return res.json(profile);
  });

  app.post("/api/registry/agent-profiles/:profileId/disable", (req: Request, res: Response) => {
    const profileId = getSingleParam(req.params.profileId);
    if (!profileId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "profileId is required.",
      });
    }
    try {
      return res.json(disableAgentProfile(profileId));
    } catch (error) {
      if (error instanceof Error && error.message === "AGENT_PROFILE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Agent profile not found.",
        });
      }
      return res.status(400).json({
        code: "invalid_agent_profile",
        message: error instanceof Error ? error.message : "Agent profile disable failed.",
      });
    }
  });

  app.get("/api/registry/skills", (req: Request, res: Response) => {
    const status = getSingleParam(req.query.status as string | string[] | undefined);
    const items = listSkills(status === "active" || status === "disabled" ? status : undefined);
    return res.json({ items });
  });

  app.post("/api/registry/skills", (req: Request, res: Response) => {
    if (!isSkillBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "name is required.",
      });
    }
    try {
      const skill = upsertSkill(req.body);
      return res.status(201).json(skill);
    } catch (error) {
      return res.status(400).json({
        code: "invalid_skill",
        message: error instanceof Error ? error.message : "Skill upsert failed.",
      });
    }
  });

  app.get("/api/registry/skills/:skillId", (req: Request, res: Response) => {
    const skillId = getSingleParam(req.params.skillId);
    if (!skillId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "skillId is required.",
      });
    }
    const skill = getSkill(skillId);
    if (!skill) {
      return res.status(404).json({
        code: "not_found",
        message: "Skill not found.",
      });
    }
    return res.json(skill);
  });

  app.post("/api/registry/skills/:skillId/disable", (req: Request, res: Response) => {
    const skillId = getSingleParam(req.params.skillId);
    if (!skillId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "skillId is required.",
      });
    }
    try {
      return res.json(disableSkill(skillId));
    } catch (error) {
      if (error instanceof Error && error.message === "SKILL_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Skill not found.",
        });
      }
      return res.status(400).json({
        code: "invalid_skill",
        message: error instanceof Error ? error.message : "Skill disable failed.",
      });
    }
  });

  app.post("/api/planner/template-selection", async (req: Request, res: Response) => {
    const body = req.body as Partial<PlannerTemplateSelectionRequest>;
    if (typeof body.intent !== "string" || !body.intent.trim()) {
      return res.status(400).json({
        code: "invalid_request",
        message: "intent is required.",
      });
    }

    const plannerOptions = resolvePlannerInvocationOptions(req.body);
    if (!plannerOptions.ok) {
      return res.status(plannerOptions.status).json({
        code: plannerOptions.status === 404 ? "not_found" : "invalid_request",
        message: plannerOptions.message,
      });
    }

    const recommendation = await recommendTemplate(body.intent.trim(), plannerOptions.value);
    if (!recommendation) {
      return res.status(404).json({
        code: "no_published_templates",
        message: "No published templates are available for planning.",
      });
    }

    return res.json(recommendation);
  });

  app.post("/api/planner/dag-draft", async (req: Request, res: Response) => {
    const body = req.body as Partial<PlannerDagDraftRequest>;
    if (typeof body.intent !== "string" || !body.intent.trim()) {
      return res.status(400).json({
        code: "invalid_request",
        message: "intent is required.",
      });
    }
    if ("template_id" in body && body.template_id !== undefined && typeof body.template_id !== "string") {
      return res.status(400).json({
        code: "invalid_request",
        message: "template_id must be a string when provided.",
      });
    }
    if ("inputs" in body && body.inputs !== undefined && !isPlainObject(body.inputs)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "inputs must be an object when provided.",
      });
    }
    if (
      "max_agent_nodes" in body &&
      body.max_agent_nodes !== undefined &&
      typeof body.max_agent_nodes !== "number"
    ) {
      return res.status(400).json({
        code: "invalid_request",
        message: "max_agent_nodes must be a number when provided.",
      });
    }

    const plannerOptions = resolvePlannerInvocationOptions(req.body);
    if (!plannerOptions.ok) {
      return res.status(plannerOptions.status).json({
        code: plannerOptions.status === 404 ? "not_found" : "invalid_request",
        message: plannerOptions.message,
      });
    }

    try {
      return res.json(
        await generateDagDraft(
          {
            intent: body.intent.trim(),
            template_id: body.template_id?.trim() || undefined,
            inputs: body.inputs || {},
            max_agent_nodes: body.max_agent_nodes,
          },
          plannerOptions.value,
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "template_not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED") {
        return res.status(409).json({
          code: "template_not_published",
          message: "Template must be published before it can seed a DAG draft.",
        });
      }

      return res.status(400).json({
        code: "dag_draft_failed",
        message: error instanceof Error ? error.message : "DAG draft generation failed.",
      });
    }
  });

  app.post("/api/planner/candidate-plan", async (req: Request, res: Response) => {
    const body = req.body as Partial<PlannerCandidatePlanRequest>;
    if (
      typeof body.intent !== "string" ||
      !body.intent.trim() ||
      typeof body.template_id !== "string" ||
      !body.template_id.trim() ||
      !isPlainObject(body.inputs) ||
      ("proposal_id" in body && body.proposal_id !== undefined && typeof body.proposal_id !== "string")
    ) {
      return res.status(400).json({
        code: "invalid_request",
        message: "intent, template_id, and inputs are required; proposal_id must be a string when provided.",
      });
    }

    const plannerOptions = resolvePlannerInvocationOptions(req.body);
    if (!plannerOptions.ok) {
      return res.status(plannerOptions.status).json({
        code: plannerOptions.status === 404 ? "not_found" : "invalid_request",
        message: plannerOptions.message,
      });
    }

    try {
      const result = await generateCandidatePlan(
        {
          intent: body.intent.trim(),
          template_id: body.template_id.trim(),
          inputs: body.inputs,
        },
        plannerOptions.value,
      );
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "template_not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED") {
        return res.status(409).json({
          code: "template_not_published",
          message: "Template must be published before it can be planned.",
        });
      }

      return res.status(400).json({
        code: "planning_failed",
        message: error instanceof Error ? error.message : "Candidate planning failed.",
      });
    }
  });

  app.post("/api/sessions", async (req: Request, res: Response) => {
    if (!isCreateSessionBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "title, initial_message, created_by, and orchestrator_profile_id must be strings when provided.",
      });
    }
    const requestedProfileId =
      typeof req.body.orchestrator_profile_id === "string" && req.body.orchestrator_profile_id.trim()
        ? req.body.orchestrator_profile_id.trim()
        : null;
    if (requestedProfileId && !getOrchestratorProfile(requestedProfileId)) {
      return res.status(404).json({
        code: "orchestrator_profile_not_found",
        message: "Orchestrator profile not found.",
      });
    }

    const session = createSession(req.body);
    if (typeof req.body.initial_message === "string" && req.body.initial_message.trim()) {
      const initialUserText = req.body.initial_message.trim();
      appendSessionMessage({
        sessionId: session.session_id,
        role: "user",
        kind: "text",
        content: {
          text: initialUserText,
        },
        createdAt: session.created_at,
      });
      const interpretation = interpretSessionMessage({
        sessionId: session.session_id,
        session,
        userText: initialUserText,
        seededGoal: true,
      });
      session.current_goal = interpretation.workingGoal;
      session.metadata = {
        ...getSessionMetadataObject(session),
        working_goal: interpretation.workingGoal,
        constraints_summary: interpretation.constraintsSummary,
        open_questions: interpretation.openQuestions,
        pending_decision: interpretation.pendingDecision,
        latest_orchestrator_intent: interpretation.intent,
      };
      persistSessionDecisionArtifacts({
        session,
        sessionId: session.session_id,
        interpretation,
        userText: initialUserText,
        orchestratorText: buildSessionConversationReply({
          session,
          sessionId: session.session_id,
          userText: initialUserText,
          seededGoal: true,
        }),
        turnSummaryText: interpretation.turnText,
      });
      if (interpretation.shouldAutoDraft && interpretation.workingGoal) {
        try {
          await performSessionDagDraft({
            sessionId: session.session_id,
            session,
            latestGoal: interpretation.workingGoal,
          });
        } catch (error) {
          const messageText =
            error instanceof Error && error.message === "TEMPLATE_NOT_FOUND"
              ? "I could not draft the workflow yet because the requested template no longer exists."
              : error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED"
                ? "I could not draft the workflow yet because the requested template is not published."
                : `I could not draft the workflow yet. ${error instanceof Error ? error.message : "Session DAG draft failed."}`;
          persistSessionTransitionOutcome({
            session,
            sessionId: session.session_id,
            text: messageText,
            latestIntent: interpretation.intent,
            pendingDecision: "Adjust the task brief or ask for another DAG draft once the draft source is valid.",
            failedTransition: "draft",
            errorCode:
              error instanceof Error && error.message === "TEMPLATE_NOT_FOUND"
                ? "template_not_found"
                : error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED"
                  ? "template_not_published"
                  : "dag_draft_failed",
          });
        }
      }
      saveSession(session);
    }

    return res.status(201).json({
      session: buildSessionSummary(session.session_id),
      messages: buildSessionThreadMessages(session.session_id),
    });
  });

  app.get("/api/sessions", (req: Request, res: Response) => {
    const filters = buildSessionListFilters(req.query);
    const items = listSessionSummaries(filters);
    return res.json({
      items,
      filters,
    });
  });

  app.get("/api/missions", (req: Request, res: Response) => {
    const filters = buildSessionListFilters(req.query);
    return res.json({
      items: listMissionItems(filters),
      filters,
    });
  });

  function updateSessionVisibility(
    req: Request,
    res: Response,
    action: "archive" | "unarchive" | "hide" | "unhide",
  ) {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    const requestedBy =
      typeof req.body?.requested_by === "string" && req.body.requested_by.trim()
        ? req.body.requested_by.trim()
        : "user";
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : null;
    const updated =
      action === "archive"
        ? archiveSession(sessionId, requestedBy, reason)
        : action === "unarchive"
          ? unarchiveSession(sessionId, requestedBy)
          : action === "hide"
            ? hideSession(sessionId, requestedBy)
            : unhideSession(sessionId, requestedBy);
    if (!updated) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const summary = buildSessionSummary(sessionId);
    return res.json({
      session: summary,
    });
  }

  app.post("/api/sessions/:sessionId/archive", (req: Request, res: Response) =>
    updateSessionVisibility(req, res, "archive"),
  );

  app.post("/api/sessions/:sessionId/unarchive", (req: Request, res: Response) =>
    updateSessionVisibility(req, res, "unarchive"),
  );

  app.post("/api/sessions/:sessionId/hide", (req: Request, res: Response) =>
    updateSessionVisibility(req, res, "hide"),
  );

  app.post("/api/sessions/:sessionId/unhide", (req: Request, res: Response) =>
    updateSessionVisibility(req, res, "unhide"),
  );

  app.get("/api/missions/:sessionId", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }

    const mission = buildMissionDetailResponse(sessionId);
    if (!mission) {
      return res.status(404).json({
        code: "not_found",
        message: "Mission not found.",
      });
    }

    return res.json(mission);
  });

  app.get("/api/runtime/summary", (_req: Request, res: Response) => {
    return res.json(buildRuntimeSummary());
  });

  app.get("/api/agents/hosting", (_req: Request, res: Response) => {
    return res.json(buildAgentHostingSummary());
  });

  app.put("/api/agents/:profileId/hosting", (req: Request, res: Response) => {
    const profileId = getSingleParam(req.params.profileId);
    if (!profileId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "profileId is required.",
      });
    }
    if (!isAgentHostingUpdateBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message:
          "Expected OpenClaw hosting fields: openclaw_agent_id, provider, model, runtime_mode.",
      });
    }

    const profile = updateAgentHostingProfile(profileId, req.body);
    if (!profile) {
      return res.status(404).json({
        code: "not_found",
        message: "Agent profile not found.",
      });
    }
    return res.json({
      profile,
      agent_hosting: buildAgentHostingSummary(),
    });
  });

  app.get("/api/sessions/:sessionId", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }

    const session = buildSessionSummary(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const mission = buildMissionDetailResponse(sessionId);
    if (!mission) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    return res.json({
      session: mission.session,
      messages: mission.messages,
      latest_run: mission.latest_run,
      attachments: mission.attachments,
      workspace_state: mission.workspace_state || {},
      next_actions: mission.next_actions || [],
      workspace_contract_version: mission.workspace_contract_version || MISSION_WORKSPACE_CONTRACT_VERSION,
      mission_spec: mission.mission_spec,
      mission_spec_contract: mission.mission_spec_contract,
      mission_snapshot: mission.mission_snapshot,
    });
  });

  app.get("/api/sessions/:sessionId/attachments", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }

    if (!getSession(sessionId)) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    return res.json({
      items: listSessionAttachments(sessionId),
    });
  });

  app.post("/api/sessions/:sessionId/attachments", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isCreateSessionAttachmentBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "storage_uri is required; attachment metadata fields must use supported types.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const attachment = createSessionAttachment({
      sessionId,
      request: req.body,
    });
    const attachments = listSessionAttachments(sessionId);
    const timestamp = nowIso();
    session.updated_at = timestamp;
    session.metadata = {
      ...getSessionMetadataObject(session),
      attachment_count: attachments.length,
      latest_attachment_at: attachment.created_at,
    };
    saveSession(session);

    return res.status(201).json({
      attachment,
      items: attachments,
    });
  });

  app.get("/api/sessions/:sessionId/compare", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const leftRevision = getPositiveNumberQueryParam(req.query.left_revision);
    const rightRevision = getPositiveNumberQueryParam(req.query.right_revision);
    const leftOption = getRouteCompareOptionQueryParam(req.query.left_option);
    const rightOption = getRouteCompareOptionQueryParam(req.query.right_option);
    const hasExplicitCompareSelector =
      !!getSingleParam(req.query.left_revision) ||
      !!getSingleParam(req.query.right_revision) ||
      !!getSingleParam(req.query.left_option) ||
      !!getSingleParam(req.query.right_option);
    if (
      (getSingleParam(req.query.left_revision) && leftRevision === null) ||
      (getSingleParam(req.query.right_revision) && rightRevision === null) ||
      (getSingleParam(req.query.left_option) && leftOption === null) ||
      (getSingleParam(req.query.right_option) && rightOption === null)
    ) {
      return res.status(400).json({
        code: "invalid_request",
        message:
          "Compare selectors must use positive integer revisions and primary/alternative options.",
      });
    }

    const result = buildRouteCompareSummary({
      session,
      messages: listSessionMessages(sessionId),
      leftRevision,
      leftOption,
      rightRevision,
      rightOption,
    });
    if (!result.ok) {
      if (!hasExplicitCompareSelector && result.code === "route_compare_unavailable") {
        return res.json(null);
      }
      return res.status(result.status).json({
        code: result.code,
        message: result.message,
      });
    }

    return res.json(result.summary);
  });

  app.get("/api/sessions/:sessionId/stream", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }

    if (!getSession(sessionId)) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders();

    const writeEvent = (event: SessionWorkspaceStreamEvent): void => {
      res.write(`id: ${event.event_id}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const snapshot = buildSessionWorkspaceStreamSnapshot(sessionId);
    if (!snapshot) {
      writeEvent(
        buildSessionWorkspaceStreamEvent({
          sessionId,
          type: "heartbeat",
          data: { status: "unavailable" },
        }),
      );
      res.end();
      return;
    }

    let lastSignature = buildSessionWorkspaceStreamSignature(snapshot);
    writeEvent(
      buildSessionWorkspaceStreamEvent({
        sessionId,
        type: "snapshot",
        data: snapshot as unknown as Record<string, unknown>,
      }),
    );

    const heartbeat = setInterval(() => {
      writeEvent(
        buildSessionWorkspaceStreamEvent({
          sessionId,
          type: "heartbeat",
          data: { status: "ok" },
        }),
      );
    }, 15000);

    const poller = setInterval(() => {
      const nextSnapshot = buildSessionWorkspaceStreamSnapshot(sessionId);
      if (!nextSnapshot) {
        return;
      }
      const nextSignature = buildSessionWorkspaceStreamSignature(nextSnapshot);
      if (nextSignature === lastSignature) {
        return;
      }
      lastSignature = nextSignature;
      writeEvent(
        buildSessionWorkspaceStreamEvent({
          sessionId,
          type: "workspace.updated",
          data: nextSnapshot as unknown as Record<string, unknown>,
        }),
      );
    }, 2000);

    req.on("close", () => {
      clearInterval(heartbeat);
      clearInterval(poller);
    });
  });

  app.get("/api/sessions/:sessionId/messages", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }

    if (!getSession(sessionId)) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    return res.json({
      items: buildSessionThreadMessages(sessionId),
    });
  });

  app.post("/api/sessions/:sessionId/messages", async (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isCreateSessionMessageBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "content is required.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const userText = req.body.content.trim();
    const baselineMessageCount = buildSessionThreadMessages(sessionId).length;
    const message = appendSessionMessage({
      sessionId,
      role: "user",
      kind: "text",
      content: {
        text: userText,
      },
    });
    const seededGoal = !session.current_goal && !!userText;
    const interpretation = interpretSessionMessage({
      sessionId,
      session,
      userText,
      seededGoal,
    });
    const metadataBeforePersist = getSessionMetadataObject(session);
    const nextRouteStale =
      interpretation.shouldMarkRouteStale
        ? true
        : metadataBeforePersist.route_stale === true;
    const nextStaleReason =
      interpretation.shouldMarkRouteStale
        ? interpretation.staleReason
        : typeof metadataBeforePersist.stale_reason === "string" && metadataBeforePersist.stale_reason.trim()
          ? (metadataBeforePersist.stale_reason as string).trim()
          : null;
    session.current_goal = interpretation.workingGoal;
    session.metadata = {
      ...metadataBeforePersist,
      working_goal: interpretation.workingGoal,
      constraints_summary: interpretation.constraintsSummary,
      open_questions: interpretation.openQuestions,
      pending_decision: interpretation.pendingDecision,
      latest_orchestrator_intent: interpretation.intent,
      route_stale: nextRouteStale,
      stale_reason: nextStaleReason,
    };
    let orchestratorText = interpretation.turnText;
    if (
      !interpretation.shouldAutoDraft &&
      !interpretation.shouldAutoPlan &&
      !interpretation.shouldAutoRevise &&
      interpretation.intent !== "ask_run"
    ) {
      orchestratorText = buildSessionConversationReply({
        session,
        sessionId,
        userText,
        seededGoal,
      });
    }
    const orchestratorMessage = persistSessionDecisionArtifacts({
      session,
      sessionId,
      interpretation,
      userText,
      orchestratorText,
      turnSummaryText: interpretation.turnText,
    });
    if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
      session.status = "draft";
      syncSessionWorkingState(sessionId, session);
    }
    saveSession(session);

    if (interpretation.shouldAutoDraft && interpretation.workingGoal) {
      try {
        await performSessionDagDraft({
          sessionId,
          session,
          latestGoal: interpretation.workingGoal,
        });
      } catch (error) {
        const messageText =
          error instanceof Error && error.message === "TEMPLATE_NOT_FOUND"
            ? "I could not draft the workflow yet because the requested template no longer exists."
            : error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED"
              ? "I could not draft the workflow yet because the requested template is not published."
              : `I could not draft the workflow yet. ${error instanceof Error ? error.message : "Session DAG draft failed."}`;
        persistSessionTransitionOutcome({
          session,
          sessionId,
          text: messageText,
          latestIntent: interpretation.intent,
          pendingDecision: "Adjust the task brief or ask for another DAG draft once the draft source is valid.",
          failedTransition: "draft",
          errorCode:
            error instanceof Error && error.message === "TEMPLATE_NOT_FOUND"
              ? "template_not_found"
              : error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED"
                ? "template_not_published"
                : "dag_draft_failed",
        });
      }
    } else if (interpretation.shouldAutoPlan && interpretation.workingGoal) {
      const planResult = await performSessionPlan({
        sessionId,
        session,
        latestGoal: interpretation.workingGoal,
      });
      if (planResult.ok) {
        return res.status(201).json(
          buildSessionMessageTurnResponse({
            sessionId,
            userMessage: message,
            baselineMessageCount,
          }),
        );
      }
      persistSessionTransitionOutcome({
        session,
        sessionId,
        text: typeof planResult.body.message === "string"
          ? `I could not compile a plan yet. ${planResult.body.message}`
          : "I could not compile a plan yet from the current thread state.",
        latestIntent: interpretation.intent,
        pendingDecision: "Tighten the brief or draft the workflow again before compiling the next plan options.",
        failedTransition: "plan",
        errorCode:
          isPlainObject(planResult.body) && typeof planResult.body.code === "string"
            ? planResult.body.code
            : null,
      });
    } else if (interpretation.intent === "ask_confirm") {
      const confirmationTarget = resolveSessionConfirmationTarget(sessionId, session);
      if (
        confirmationTarget.available &&
        confirmationTarget.revision !== null &&
        confirmationTarget.option !== null
      ) {
        session.confirmed_plan_revision = confirmationTarget.revision;
        session.confirmed_plan_option = confirmationTarget.option;
        const executionConfig = extractPlanOptionExecutionConfig(
          confirmationTarget.planningMessage &&
            confirmationTarget.planningMessage.kind === "plan_options_card"
            ? {
                ...confirmationTarget.planningMessage,
                content: {
                  ...confirmationTarget.planningMessage.content,
                  selected_option: confirmationTarget.option,
                },
              }
            : confirmationTarget.planningMessage,
        );
        session.current_plan_summary =
          executionConfig
            ? `Confirmed plan v${confirmationTarget.revision} (${confirmationTarget.option}) using ${executionConfig.template_id}.`
            : `Confirmed plan v${confirmationTarget.revision} (${confirmationTarget.option}).`;
        session.metadata = {
          ...clearSessionRouteStaleState(session),
          working_goal: session.current_goal,
          constraints_summary:
            typeof session.metadata?.constraints_summary === "string"
              ? (session.metadata.constraints_summary as string)
              : interpretation.constraintsSummary,
          open_questions: interpretation.openQuestions,
          pending_decision: executionConfig
            ? "The execution source is locked. Run it when you are ready, or revise from this confirmed route."
            : "The execution source is locked. Run it when you are ready, or revise from this confirmed route.",
          latest_orchestrator_intent: "confirm_ready",
        };
        syncSessionWorkingState(sessionId, session);
        const confirmationMessage = appendSessionMessage({
          sessionId,
          role: "orchestrator",
          kind: "text",
          content: {
            text: confirmationTarget.alreadyConfirmed
              ? `Plan v${confirmationTarget.revision} / ${confirmationTarget.option} was already confirmed and stays locked for execution.`
              : `Confirmed plan v${confirmationTarget.revision} / ${confirmationTarget.option}. The execution source is now locked for this thread.`,
            revision: confirmationTarget.revision,
            option: confirmationTarget.option,
            template_id: executionConfig?.template_id || null,
          },
        });
        session.last_orchestrator_message_id = confirmationMessage.message_id;
        session.updated_at = confirmationMessage.created_at;
        syncSessionWorkingState(sessionId, session);
        saveSession(session);
      } else {
        const blockedText =
          confirmationTarget.blocked === "stale"
            ? `I did not confirm the current route because the latest instruction made it stale. ${getSessionRouteStaleState(sessionId, session).staleReason || "Revise the route first."}`
            : "I could not confirm a route yet because there is no unambiguous plan revision in the thread. Draft a DAG or create a plan first.";
        persistSessionTransitionOutcome({
          session,
          sessionId,
          text: blockedText,
          latestIntent: interpretation.intent,
          pendingDecision:
            confirmationTarget.blocked === "stale"
              ? "Revise the route so the confirmed execution source matches the latest brief."
              : "Create or surface one clear plan revision before trying to confirm execution.",
          failedTransition: "confirm",
          errorCode: confirmationTarget.blocked === "stale" ? "plan_stale" : "plan_revision_missing",
        });
      }
    } else if (
      interpretation.shouldAutoRevise &&
      interpretation.workingGoal &&
      interpretation.reviseInstructions
    ) {
      const reviseResult = await performSessionRevise({
        sessionId,
        session,
        latestGoal: interpretation.workingGoal,
        instructions: interpretation.reviseInstructions,
        appendRequestMessage: false,
      });
      if (reviseResult.ok) {
        return res.status(201).json(
          buildSessionMessageTurnResponse({
            sessionId,
            userMessage: message,
            baselineMessageCount,
          }),
        );
      }
      persistSessionTransitionOutcome({
        session,
        sessionId,
        text: typeof reviseResult.body.message === "string"
          ? `I could not revise the plan yet. ${reviseResult.body.message}`
          : "I could not revise the plan yet from the current thread state.",
        latestIntent: interpretation.intent,
        pendingDecision: "Create or refresh a plan revision first, then apply the next revise instruction.",
        failedTransition: "revise",
        errorCode:
          isPlainObject(reviseResult.body) && typeof reviseResult.body.code === "string"
            ? reviseResult.body.code
            : null,
      });
    } else if (interpretation.intent === "ask_run" && interpretation.workingGoal) {
      const runResult = await performSessionRun({
        sessionId,
        session,
        latestGoal: interpretation.workingGoal,
        validationMode: "strict",
      });
      if (runResult.ok) {
        return res.status(201).json(
          buildSessionMessageTurnResponse({
            sessionId,
            userMessage: message,
            baselineMessageCount,
          }),
        );
      }
      persistSessionTransitionOutcome({
        session,
        sessionId,
        text:
          runResult.status === 409 && runResult.body.code === "run_validation_failed"
            ? "I did not open the run because strict validation still blocks execution. Revise the plan or run an explicitly selected option after clearing the warnings."
            : typeof runResult.body.message === "string"
              ? `I could not open the run yet. ${runResult.body.message}`
              : "I could not open the run yet from the current thread state.",
        latestIntent: interpretation.intent,
        pendingDecision:
          runResult.status === 409 && runResult.body.code === "run_validation_failed"
            ? "Revise the route or clear the remaining warnings before opening a strict run."
            : "Confirm a valid route and reopen execution when the thread is ready.",
        failedTransition: "run",
        errorCode:
          isPlainObject(runResult.body) && typeof runResult.body.code === "string"
            ? runResult.body.code
            : null,
      });
    }

    return res.status(201).json(
      buildSessionMessageTurnResponse({
        sessionId,
        userMessage: message,
        baselineMessageCount,
      }),
    );
  });

  app.post("/api/sessions/:sessionId/interventions", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isCreateSessionInterventionBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message:
          "content is required; kind, target_run_id, target_node_run_id, and metadata must match the intervention schema when provided.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const content = req.body.content.trim();
    const kind = req.body.kind || inferInterventionKind(content);
    const linkedRunIds = getSessionLinkedRunIds(sessionId);
    const requestedRunId =
      typeof req.body.target_run_id === "string" && req.body.target_run_id.trim()
        ? req.body.target_run_id.trim()
        : null;
    const runId = requestedRunId || session.latest_run_id || linkedRunIds[linkedRunIds.length - 1] || null;
    if (requestedRunId && !getRun(requestedRunId)) {
      return res.status(404).json({
        code: "run_not_found",
        message: "Target run not found.",
      });
    }

    const targetRun = runId ? getRun(runId) : null;
    const activeRuntime =
      !!targetRun &&
      ["queued", "running", "waiting_human", "paused", "blocked"].includes(targetRun.status);
    const status: SessionInterventionStatus =
      activeRuntime ? resolveInterventionStatus(kind) : "queued_for_next_pass";
    const nodeRunId =
      typeof req.body.target_node_run_id === "string" && req.body.target_node_run_id.trim()
        ? req.body.target_node_run_id.trim()
        : null;
    const summary = summarizeInterventionContent(content);
    const patchProposal = buildDagPatchProposal({
      kind,
      runId,
      nodeRunId,
      summary,
      metadata: isPlainObject(req.body.metadata) ? req.body.metadata : undefined,
    });
    const graphPreview = buildDagPatchGraphPreview({
      runId,
      operations: patchProposal.operations,
    });
    const patchPreview = {
      supported: patchProposal.status === "needs_confirmation",
      reason: patchProposal.reason,
      operations: patchProposal.operations.map((operation) => ({ ...operation })),
      graph_preview: graphPreview,
    };
    const intervention = createSessionIntervention({
      sessionId,
      runId,
      nodeRunId,
      requestedBy: session.created_by,
      kind,
      status,
      content,
      summary,
      interpretedIntent: buildInterventionIntent(kind),
      patchPreview,
      metadata: isPlainObject(req.body.metadata) ? req.body.metadata : {},
    });
    const dagPatch = createDagPatch({
      sessionId,
      runId,
      interventionId: intervention.intervention_id,
      requestedBy: session.created_by,
      status: patchProposal.status,
      reason: patchProposal.reason,
      summary: patchProposal.summary,
      operations: patchProposal.operations,
      requiresConfirmation: patchProposal.requires_confirmation,
      applySupported: patchProposal.apply_supported,
      unsupportedReason: patchProposal.unsupported_reason,
      graphPreview,
      metadata: {
        intervention_kind: kind,
        intervention_status: status,
        graph_preview: graphPreview,
      },
      createdAt: intervention.created_at,
    });
    const userMessage = appendSessionMessage({
      sessionId,
      role: "user",
      kind: "text",
      content: {
        text: content,
        intervention_id: intervention.intervention_id,
        target_run_id: runId,
        target_node_run_id: nodeRunId,
      },
      linkedRunId: runId,
      linkedNodeRunId: nodeRunId,
      createdAt: intervention.created_at,
    });
    const orchestratorMessage = appendSessionMessage({
      sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text: buildInterventionReceipt({
          kind,
          runId,
          summary,
          patchId: dagPatch.status === "needs_confirmation" ? dagPatch.patch_id : null,
          applyReady: dagPatch.apply_supported,
        }),
        intervention_id: intervention.intervention_id,
        patch_id: dagPatch.patch_id,
        intervention_kind: kind,
        intervention_status: status,
        patch_supported: patchPreview.supported,
      },
      linkedRunId: runId,
      linkedNodeRunId: nodeRunId,
      createdAt: intervention.created_at,
    });

    session.metadata = {
      ...getSessionMetadataObject(session),
      latest_intervention_id: intervention.intervention_id,
      latest_intervention_kind: kind,
      latest_dag_patch_id: dagPatch.patch_id,
      latest_dag_patch_status: dagPatch.status,
      latest_orchestrator_intent: "runtime_intervention",
      pending_decision:
        dagPatch.status === "needs_confirmation"
          ? dagPatch.apply_supported
            ? "A DAG patch proposal is ready for review and can be applied with confirmation."
            : "A DAG patch proposal is ready for review; some operations are not yet wired to a live apply path."
          : kind === "guidance"
            ? "The runtime guidance is captured for the next orchestration pass."
            : "The runtime intervention is captured, but no safely applicable DAG patch was inferred.",
    };
    session.last_orchestrator_message_id = orchestratorMessage.message_id;
    session.updated_at = orchestratorMessage.created_at;
    syncSessionWorkingState(sessionId, session);
    saveSession(session);

    return res.status(201).json({
      session: buildSessionSummary(sessionId),
      intervention,
      messages: buildSessionThreadMessages(sessionId).filter(
        (message) =>
          message.message_id === userMessage.message_id ||
          message.message_id === orchestratorMessage.message_id ||
          message.content.intervention_id === intervention.intervention_id ||
          message.content.patch_id === dagPatch.patch_id,
      ),
    });
  });

  type PatchOperationOutcome = DagPatchOperationOutcome;

  function createPatchOperationOutcome(operation: {
    op: DagPatchOperation["op"];
    node_run_id?: string | null;
    node_id?: string | null;
    node_name?: string | null;
  }): PatchOperationOutcome {
    return {
      op: operation.op,
      node_run_id: operation.node_run_id || null,
      node_id: operation.node_id || null,
      node_name: operation.node_name || null,
      applied: false,
      error: null,
      details: {},
    };
  }

  function captureDagPatchTopology(runId: string | null): DagPatchTopologySnapshot | null {
    if (!runId) {
      return null;
    }
    const plan = getRunPlan(runId);
    if (!plan) {
      return null;
    }
    return {
      node_count: plan.compiled_nodes.length,
      edge_count: plan.edges.length,
      frontier: Array.isArray(plan.frontier) ? [...plan.frontier] : [],
      ready_node_run_ids: plan.compiled_nodes
        .filter((node) => node.status === "ready")
        .map((node) => node.node_run_id),
      running_node_run_ids: plan.compiled_nodes
        .filter((node) => node.status === "running")
        .map((node) => node.node_run_id),
      waiting_node_run_ids: plan.compiled_nodes
        .filter((node) => node.status === "waiting_human")
        .map((node) => node.node_run_id),
      max_parallel_nodes: resolveMaxParallelNodes(plan),
    };
  }

  function buildPatchedNodeBase(input: {
    runId: string;
    plan: RunPlanRecord;
    requestedStep: string;
    targetNodeId: string | null;
    targetNodeRunId: string | null;
  }) {
    const requestedStep = input.requestedStep.trim() || "Additional task step";
    const run = getRun(input.runId);
    const nodeRuns = listNodeRuns(input.runId);
    const templateBindingNode =
      input.targetNodeRunId
        ? getCompiledNode(input.plan, input.targetNodeRunId)
        : null;
    const fallbackNode =
      templateBindingNode ||
      input.plan.compiled_nodes.find((node) => node.type !== "end") ||
      input.plan.compiled_nodes[0] ||
      null;
    const endNode =
      input.plan.compiled_nodes.find((node) => node.type === "end") || null;
    const nodeIdBase = slugify(requestedStep).slice(0, 40) || "runtime-added-step";
    const uniqueSuffix = Math.random().toString(36).slice(2, 7);
    const nodeId = `${nodeIdBase}-${uniqueSuffix}`;
    const nodeRunId = generateNodeRunId(nodeId);
    const inboundNodeId =
      input.targetNodeId ||
      templateBindingNode?.node_id ||
      fallbackNode?.node_id ||
      null;

    const inheritedAllowedSkills = Array.isArray(fallbackNode?.allowed_skills)
      ? [...fallbackNode.allowed_skills]
      : [];
    const inheritedAllowedTools = Array.isArray(fallbackNode?.allowed_tools)
      ? [...fallbackNode.allowed_tools]
      : [];

    const compiledNode: RunPlanRecord["compiled_nodes"][number] = {
      node_run_id: nodeRunId,
      node_id: nodeId,
      name: requestedStep,
      type: "agent_task",
      agent_profile: fallbackNode?.agent_profile || null,
      openclaw_agent_id: fallbackNode?.openclaw_agent_id || null,
      allowed_skills: inheritedAllowedSkills,
      allowed_tools: inheritedAllowedTools,
      approval_kind: fallbackNode?.approval_kind || null,
      human_input_schema: fallbackNode?.human_input_schema || null,
      status: inboundNodeId ? "pending" : "ready",
      retry_policy: {
        max_attempts: fallbackNode?.retry_policy.max_attempts || 1,
        attempt: 0,
      },
      timeout_seconds: fallbackNode?.timeout_seconds || 900,
      parallelism_budget: fallbackNode?.parallelism_budget || 1,
      input_payload: {
        run_inputs: run?.inputs || {},
        node_config: {
          runtime_patch_requested_step: requestedStep,
          source_patch_target_node_id: inboundNodeId,
        },
      },
      output_contract:
        fallbackNode && isPlainObject(fallbackNode.output_contract)
          ? { ...fallbackNode.output_contract }
          : {},
      execution_ref: {
        openclaw_task_id: null,
        openclaw_session_id: null,
      },
      registry_provenance:
        fallbackNode && isPlainObject(fallbackNode.registry_provenance)
          ? JSON.parse(JSON.stringify(fallbackNode.registry_provenance))
          : {
              agent_profile_requested: null,
              agent_profile_resolved: null,
              agent_profile_status: null,
              agent_profile_source: "none",
              openclaw_agent_id_source: "none",
              skill_bindings: [],
              tool_bindings: [],
            },
    };

    const nodeRun = {
      node_run_id: nodeRunId,
      run_id: input.runId,
      status: compiledNode.status,
      progress: {
        percent: 0,
        message: inboundNodeId ? "Waiting for dependencies" : "Ready for dispatch",
        updated_at: nowIso(),
      },
      attempt: 0,
      started_at: null,
      finished_at: null,
    };

    const insertedEdges: WorkflowEdge[] = [];
    const removedEdges: WorkflowEdge[] = [];

    if (inboundNodeId) {
      insertedEdges.push({
        from: inboundNodeId,
        to: nodeId,
        condition: null,
        label: "runtime_patch_injected",
      });
    }
    if (endNode) {
      const existingInboundToEnd = input.plan.edges.filter((edge) => edge.to === endNode.node_id);
      const edgeFromInboundToEnd =
        inboundNodeId
          ? existingInboundToEnd.find((edge) => edge.from === inboundNodeId) || null
          : null;
      if (edgeFromInboundToEnd) {
        removedEdges.push(edgeFromInboundToEnd);
      }
      insertedEdges.push({
        from: nodeId,
        to: endNode.node_id,
        condition: null,
        label: "runtime_patch_delivery",
      });
    }

    return { compiledNode, nodeRun, insertedEdges, removedEdges };
  }

  function applyAddNodeOperation(
    patch: DagPatchRecord,
    operation: DagPatchOperation,
  ): PatchOperationOutcome {
    const outcome = createPatchOperationOutcome(operation);
    if (!patch.run_id) {
      outcome.error = "missing_run_id";
      return outcome;
    }
    const plan = getRunPlan(patch.run_id);
    const run = getRun(patch.run_id);
    if (!plan || !run) {
      outcome.error = !run ? "run_not_found" : "run_plan_not_found";
      return outcome;
    }
    const requestedStep =
      isPlainObject(operation.value) && typeof operation.value.requested_step === "string"
        ? operation.value.requested_step
        : typeof operation.node_name === "string" && operation.node_name.trim()
          ? operation.node_name
          : "Additional task step";
    const nodeRuns = listNodeRuns(patch.run_id);
    const patched = buildPatchedNodeBase({
      runId: patch.run_id,
      plan,
      requestedStep,
      targetNodeId: operation.node_id || null,
      targetNodeRunId: operation.node_run_id || null,
    });

    if (plan.compiled_nodes.some((node) => node.node_id === patched.compiledNode.node_id)) {
      outcome.error = "duplicate_node_id";
      return outcome;
    }

    plan.compiled_nodes.push(patched.compiledNode);
    plan.edges = [
      ...plan.edges.filter(
        (edge) =>
          !patched.removedEdges.some(
            (removed) =>
              removed.from === edge.from &&
              removed.to === edge.to &&
              (removed.label || null) === (edge.label || null),
          ),
      ),
      ...patched.insertedEdges,
    ];
    nodeRuns.push(patched.nodeRun);
    const unlockedNodes = unlockReadyNodeRuns(plan, nodeRuns, nowIso());

    const insertedNodeRun = getMutableNodeRun(nodeRuns, patched.compiledNode.node_run_id);
    const nodeEventType = insertedNodeRun?.status === "ready" ? "node.ready" : "node.progress";
    const event = appendRunEvent({
      run_id: patch.run_id,
      node_run_id: patched.compiledNode.node_run_id,
      type: nodeEventType,
      actor_type: "operator",
      actor_id: "patch-apply",
      payload: {
        node_id: patched.compiledNode.node_id,
        node_name: patched.compiledNode.name,
        reason: "runtime_add_node_patch",
        inserted_after_node_id: operation.node_id || null,
        inserted_edges: patched.insertedEdges,
        removed_edges: patched.removedEdges,
        unlocked_node_run_ids: unlockedNodes.map((node) => node.node_run_id),
      },
      created_at: nowIso(),
    });

    run.updated_at = event.created_at;
    run.finished_at = null;
    run.last_event_id = event.event_id;
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      run.status = "running";
    }
    run.current_summary = `Inserted runtime step: ${patched.compiledNode.name}`;
    run.blocked_reason = null;
    if (run.status === "paused") {
      run.waiting_reason = "Runtime patch applied; resume when ready.";
    } else {
      run.waiting_reason = null;
    }
    if (plan.status === "completed" || plan.status === "failed" || plan.status === "cancelled") {
      plan.status = "running";
    }

    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(patch.run_id, nodeRuns);
    outcome.applied = true;
    outcome.node_run_id = patched.compiledNode.node_run_id;
    outcome.node_id = patched.compiledNode.node_id;
    outcome.node_name = patched.compiledNode.name;
    outcome.details = {
      inserted_node_run_id: patched.compiledNode.node_run_id,
      inserted_node_id: patched.compiledNode.node_id,
      inserted_after_node_id: operation.node_id || null,
      inserted_edges: patched.insertedEdges,
      removed_edges: patched.removedEdges,
      unlocked_node_run_ids: unlockedNodes.map((node) => node.node_run_id),
      node_status: insertedNodeRun?.status || patched.compiledNode.status,
    };
    return outcome;
  }

  function applyResumeWithPatchOperation(
    patch: DagPatchRecord,
  ): PatchOperationOutcome {
    const outcome = createPatchOperationOutcome({ op: "resume_with_patch" });
    if (!patch.run_id) {
      outcome.error = "missing_run_id";
      return outcome;
    }
    const run = getRun(patch.run_id);
    if (!run) {
      outcome.error = "run_not_found";
      return outcome;
    }
    const previousStatus = run.status;
    const beforeTopology = captureDagPatchTopology(patch.run_id);
    if (run.status === "paused") {
      applyRunAction(patch.run_id, "resume", "patch-apply");
      executionAdapter.notifyRunAction(patch.run_id, "resume");
    } else if (
      run.status === "queued" ||
      run.status === "running" ||
      run.status === "waiting_human" ||
      run.status === "blocked"
    ) {
      queueReadyNodes(patch.run_id);
      outcome.applied = true;
      outcome.details = {
        previous_run_status: previousStatus,
        next_run_status: getRun(patch.run_id)?.status || previousStatus,
        topology_before: beforeTopology,
        topology_after: captureDagPatchTopology(patch.run_id),
      };
      return outcome;
    } else {
      outcome.error = `run_state_${run.status}`;
      return outcome;
    }
    queueReadyNodes(patch.run_id);
    outcome.applied = true;
    outcome.details = {
      previous_run_status: previousStatus,
      next_run_status: getRun(patch.run_id)?.status || "running",
      topology_before: beforeTopology,
      topology_after: captureDagPatchTopology(patch.run_id),
    };
    return outcome;
  }

  function executePatchOperation(
    patch: DagPatchRecord,
    operation: DagPatchOperation,
  ): PatchOperationOutcome {
    const outcome = createPatchOperationOutcome(operation);
    try {
      if (!operation.supported) {
        outcome.error = "operation_not_supported";
        return outcome;
      }
      if (operation.op === "pause_for_replan") {
        if (!patch.run_id) {
          outcome.error = "missing_run_id";
          return outcome;
        }
        const run = getRun(patch.run_id);
        if (!run) {
          outcome.error = "run_not_found";
          return outcome;
        }
        if (run.status !== "running") {
          outcome.error = `run_state_${run.status}`;
          outcome.applied = run.status === "paused";
          if (outcome.applied) {
            outcome.error = null;
            outcome.details = {
              previous_run_status: run.status,
              next_run_status: run.status,
            };
          }
          return outcome;
        }
        const previousStatus = run.status;
        applyRunAction(patch.run_id, "pause", "patch-apply");
        executionAdapter.notifyRunAction(patch.run_id, "pause");
        outcome.applied = true;
        outcome.details = {
          previous_run_status: previousStatus,
          next_run_status: getRun(patch.run_id)?.status || "paused",
        };
        return outcome;
      }
      if (operation.op === "skip_node") {
        if (!patch.run_id) {
          outcome.error = "missing_run_id";
          return outcome;
        }
        if (!operation.node_run_id) {
          outcome.error = "missing_node_run_id";
          return outcome;
        }
        const beforeTopology = captureDagPatchTopology(patch.run_id);
        const result = applyNodeAction(patch.run_id, operation.node_run_id, "skip", "patch-apply");
        executionAdapter.notifyNodeAction(patch.run_id, operation.node_run_id, "skip");
        queueReadyNodes(patch.run_id);
        outcome.applied = true;
        outcome.details = {
          skipped_node_run_id: result.node_run_id,
          node_status: result.status,
          topology_before: beforeTopology,
          topology_after: captureDagPatchTopology(patch.run_id),
        };
        return outcome;
      }
      if (operation.op === "change_parallelism") {
        if (!patch.run_id) {
          outcome.error = "missing_run_id";
          return outcome;
        }
        const plan = getRunPlan(patch.run_id);
        if (!plan) {
          outcome.error = "run_plan_not_found";
          return outcome;
        }
        const requestedParallelism = resolveRequestedParallelism(operation.value);
        if (!requestedParallelism) {
          outcome.error = "invalid_parallelism_value";
          return outcome;
        }
        const policySnapshot = isPlainObject(plan.policy_snapshot)
          ? { ...plan.policy_snapshot }
          : {};
        const previousParallelism = resolveMaxParallelNodes(plan);
        const beforeTopology = captureDagPatchTopology(patch.run_id);
        policySnapshot.max_parallel_nodes = requestedParallelism;
        plan.policy_snapshot = policySnapshot;
        saveRunPlan(plan);
        queueReadyNodes(patch.run_id);
        outcome.applied = true;
        outcome.details = {
          previous_parallelism: previousParallelism,
          next_parallelism: requestedParallelism,
          topology_before: beforeTopology,
          topology_after: captureDagPatchTopology(patch.run_id),
        };
        return outcome;
      }
      if (operation.op === "add_node") {
        return applyAddNodeOperation(patch, operation);
      }
      if (operation.op === "resume_with_patch") {
        return applyResumeWithPatchOperation(patch);
      }
      // record_guidance and any other op are accepted as no-op records
      if (operation.op === "record_guidance") {
        outcome.applied = true;
        outcome.details = {
          recorded: true,
        };
        return outcome;
      }
      outcome.error = "operation_not_implemented";
      return outcome;
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : "unknown_error";
      return outcome;
    }
  }

  function applyDagPatchOperations(patch: DagPatchRecord): {
    operations: PatchOperationOutcome[];
    appliedCount: number;
    failedCount: number;
    applicationErrors: string[];
    resumedTopology: DagPatchTopologySnapshot | null;
  } {
    const outcomes: PatchOperationOutcome[] = [];
    let appliedCount = 0;
    let failedCount = 0;
    for (const operation of patch.operations) {
      const outcome = executePatchOperation(patch, operation);
      outcomes.push(outcome);
      if (outcome.applied) {
        appliedCount += 1;
      } else {
        failedCount += 1;
      }
    }
    const applicationErrors = outcomes
      .filter((outcome) => !outcome.applied)
      .map((outcome) => `${outcome.op}: ${outcome.error || "not_applied"}`);
    return {
      operations: outcomes,
      appliedCount,
      failedCount,
      applicationErrors,
      resumedTopology: captureDagPatchTopology(patch.run_id),
    };
  }

  function refreshSessionWorkspaceAfterPatch(
    sessionId: string,
    session: SessionRecord,
    patch: DagPatchRecord,
    decision: "applied" | "applied_with_errors" | "rejected",
    summary: string,
  ): SessionMessageRecord {
    session.metadata = {
      ...getSessionMetadataObject(session),
      latest_dag_patch_id: patch.patch_id,
      latest_dag_patch_status: patch.status,
      latest_orchestrator_intent: `patch_${decision}`,
      pending_decision:
        decision === "applied"
          ? null
          : decision === "applied_with_errors"
            ? "Some patch operations could not be applied; review the patch outcomes."
            : "Patch was rejected; the run continues unchanged.",
    };
    const orchestratorMessage = appendSessionMessage({
      sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text: summary,
        patch_id: patch.patch_id,
        patch_status: patch.status,
        intervention_id: patch.intervention_id,
      },
      linkedRunId: patch.run_id || null,
    });
    session.last_orchestrator_message_id = orchestratorMessage.message_id;
    session.updated_at = orchestratorMessage.created_at;
    syncSessionWorkingState(sessionId, session);
    saveSession(session);
    return orchestratorMessage;
  }

  function isTerminalPatchStatus(status: DagPatchRecord["status"]): boolean {
    return (
      status === "applied" ||
      status === "applied_with_errors" ||
      status === "rejected" ||
      status === "unsupported"
    );
  }

  app.post("/api/sessions/:sessionId/patches/:patchId/confirm", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    const patchId = getSingleParam(req.params.patchId);
    if (!sessionId || !patchId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId and patchId are required.",
      });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const patch = getDagPatch(sessionId, patchId);
    if (!patch) {
      return res.status(404).json({
        code: "not_found",
        message: "Patch not found.",
      });
    }
    if (isTerminalPatchStatus(patch.status)) {
      return res.status(409).json({
        code: "patch_already_resolved",
        message: `Patch is already ${patch.status} and cannot be confirmed again.`,
      });
    }
    if (!patch.apply_supported) {
      return res.status(409).json({
        code: "patch_not_apply_ready",
        message:
          patch.unsupported_reason ||
          "This patch contains operations that are not yet wired to a live apply path.",
      });
    }

    const result = applyDagPatchOperations(patch);
    const finalStatus: DagPatchRecord["status"] =
      result.failedCount === 0 ? "applied" : "applied_with_errors";
    const appliedAt = nowIso();
    const appliedBy = req.body?.requested_by || "user";
    const graphPreview = buildDagPatchGraphPreview({
      runId: patch.run_id,
      operations: patch.operations,
      previousPreview: patch.graph_preview || null,
      actualTopology: result.resumedTopology,
    });
    const updated = updateDagPatch(sessionId, patchId, (current) => ({
      ...current,
      status: finalStatus,
      applied_at: appliedAt,
      applied_by: appliedBy,
      operation_outcomes: result.operations,
      application_errors: result.applicationErrors,
      resumed_topology: result.resumedTopology,
      graph_preview: graphPreview,
      metadata: {
        ...current.metadata,
        applied_at: appliedAt,
        applied_by: appliedBy,
        operation_outcomes: result.operations,
        application_errors: result.applicationErrors,
        resumed_topology: result.resumedTopology,
        graph_preview: graphPreview,
      },
    }));
    if (!updated) {
      return res.status(500).json({
        code: "patch_update_failed",
        message: "Patch could not be persisted.",
      });
    }
    const summaryText =
      result.failedCount === 0
        ? `Patch applied. ${result.appliedCount} operation(s) succeeded.`
        : `Patch partially applied. ${result.appliedCount} succeeded, ${result.failedCount} failed.`;
    refreshSessionWorkspaceAfterPatch(
      sessionId,
      session,
      updated,
      finalStatus === "applied" ? "applied" : "applied_with_errors",
      summaryText,
    );
    return res.status(200).json({
      session: buildSessionSummary(sessionId),
      patch: updated,
      operation_outcomes: result.operations,
    });
  });

  app.post("/api/sessions/:sessionId/patches/:patchId/reject", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    const patchId = getSingleParam(req.params.patchId);
    if (!sessionId || !patchId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId and patchId are required.",
      });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const patch = getDagPatch(sessionId, patchId);
    if (!patch) {
      return res.status(404).json({
        code: "not_found",
        message: "Patch not found.",
      });
    }
    if (isTerminalPatchStatus(patch.status)) {
      return res.status(409).json({
        code: "patch_already_resolved",
        message: `Patch is already ${patch.status} and cannot be rejected again.`,
      });
    }
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : "User rejected the patch proposal.";
    const rejectedAt = nowIso();
    const rejectedBy = req.body?.requested_by || "user";
    const updated = updateDagPatch(sessionId, patchId, (current) => ({
      ...current,
      status: "rejected",
      reason,
      rejected_at: rejectedAt,
      rejected_by: rejectedBy,
      metadata: {
        ...current.metadata,
        rejected_at: rejectedAt,
        rejected_by: rejectedBy,
        rejection_reason: reason,
      },
    }));
    if (!updated) {
      return res.status(500).json({
        code: "patch_update_failed",
        message: "Patch could not be persisted.",
      });
    }
    refreshSessionWorkspaceAfterPatch(
      sessionId,
      session,
      updated,
      "rejected",
      `Patch rejected. ${reason}`,
    );
    return res.status(200).json({
      session: buildSessionSummary(sessionId),
      patch: updated,
    });
  });

  app.post("/api/sessions/:sessionId/plan", async (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isPlanSessionBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "template_id must be a string and inputs must be an object when provided.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const latestGoal = getLatestSessionGoal(sessionId) || session.current_goal;
    if (!latestGoal) {
      return res.status(409).json({
        code: "session_goal_missing",
        message: "Add a user task message before planning.",
      });
    }

    session.status = "planning";
    session.current_goal = latestGoal;
    session.updated_at = nowIso();
    saveSession(session);

    try {
      const result = await performSessionPlan({
        sessionId,
        session,
        latestGoal,
        templateId: req.body.template_id,
        draftMessageId: req.body.draft_message_id,
        inputs: isPlainObject(req.body.inputs) ? { ...req.body.inputs } : {},
      });
      if (!result.ok) {
        return res.status(result.status).json(result.body);
      }
      return res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "template_not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED") {
        return res.status(409).json({
          code: "template_not_published",
          message: "Template must be published before it can be planned.",
        });
      }
      return res.status(400).json({
        code: "planning_failed",
        message: error instanceof Error ? error.message : "Session planning failed.",
      });
    }
  });

  app.post("/api/sessions/:sessionId/dag-draft", async (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isSessionDagDraftBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "template_id must be a string, inputs must be an object, and max_agent_nodes must be numeric when provided.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const latestGoal = getLatestSessionGoal(sessionId) || session.current_goal;
    if (!latestGoal) {
      return res.status(409).json({
        code: "session_goal_missing",
        message: "Add a user task message before drafting a DAG.",
      });
    }

    try {
      const result = await performSessionDagDraft({
        sessionId,
        session,
        latestGoal,
        templateId: req.body.template_id,
        inputs: isPlainObject(req.body.inputs) ? { ...req.body.inputs } : {},
        maxAgentNodes: req.body.max_agent_nodes,
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "template_not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED") {
        return res.status(409).json({
          code: "template_not_published",
          message: "Template must be published before it can seed a DAG draft.",
        });
      }
      return res.status(400).json({
        code: "dag_draft_failed",
        message: error instanceof Error ? error.message : "Session DAG draft failed.",
      });
    }
  });

  app.post("/api/sessions/:sessionId/plan/revise", async (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isReviseSessionPlanBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "instructions is required and revision must be a positive integer when provided.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const latestGoal = getLatestSessionGoal(sessionId) || session.current_goal;
    if (!latestGoal) {
      return res.status(409).json({
        code: "session_goal_missing",
        message: "Add a user task message before revising a plan.",
      });
    }

    session.status = "planning";
    session.updated_at = nowIso();
    saveSession(session);

    try {
      const result = await performSessionRevise({
        sessionId,
        session,
        latestGoal,
        instructions: req.body.instructions.trim(),
        revision: req.body.revision,
        option: req.body.option,
      });
      if (!result.ok) {
        return res.status(result.status).json(result.body);
      }
      return res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
        return res.status(404).json({
          code: "template_not_found",
          message: "Template not found.",
        });
      }
      if (error instanceof Error && error.message === "TEMPLATE_NOT_PUBLISHED") {
        return res.status(409).json({
          code: "template_not_published",
          message: "Template must be published before it can be planned.",
        });
      }
      return res.status(400).json({
        code: "planning_failed",
        message: error instanceof Error ? error.message : "Session plan revision failed.",
      });
    }
  });

  app.post("/api/sessions/:sessionId/plan/confirm", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isConfirmSessionPlanBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "revision must be a positive integer.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const planningMessage = getPlanningMessageByRevision(sessionId, req.body.revision);
    const { planStale, staleReason } = getSessionRouteStaleState(sessionId, session);
    if (planStale) {
      return res.status(409).json({
        code: "plan_stale",
        message:
          staleReason ||
          "The current route is stale because the task brief changed. Revise the route before confirming it.",
      });
    }
    const executionConfig = extractPlanOptionExecutionConfig(
      planningMessage && planningMessage.kind === "plan_options_card"
        ? {
            ...planningMessage,
            content: {
              ...planningMessage.content,
              selected_option: req.body.option === "alternative" ? "alternative" : "primary",
            },
          }
        : planningMessage,
    );
    if (!planningMessage || !executionConfig) {
      return res.status(404).json({
        code: "plan_revision_not_found",
        message: "Requested plan revision was not found.",
      });
    }

    session.confirmed_plan_revision = req.body.revision;
    session.confirmed_plan_option = req.body.option === "alternative" ? "alternative" : "primary";
    session.current_plan_summary =
      `Confirmed plan v${req.body.revision} (${session.confirmed_plan_option}) using ${executionConfig.template_id}.`;
    session.metadata = {
      ...getSessionMetadataObject(session),
      ...clearSessionRouteStaleState(session),
      pending_decision: "The execution source is locked. Run it when you are ready, or revise from this confirmed route.",
      latest_orchestrator_intent: "confirm_ready",
    };
    syncSessionWorkingState(sessionId, session);
    session.updated_at = nowIso();
    saveSession(session);

    const orchestratorMessage = appendSessionMessage({
      sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text: `Confirmed plan v${req.body.revision} for execution.`,
        revision: req.body.revision,
        option: session.confirmed_plan_option,
        template_id: executionConfig.template_id,
      },
    });

    session.last_orchestrator_message_id = orchestratorMessage.message_id;
    session.updated_at = orchestratorMessage.created_at;
    syncSessionWorkingState(sessionId, session);
    saveSession(session);

    return res.json({
      session: buildSessionSummary(sessionId),
      revision: req.body.revision,
      option: session.confirmed_plan_option,
      message: orchestratorMessage,
    });
  });

  app.post("/api/sessions/:sessionId/dag-proposals", async (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isCreateDagProposalBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message:
          "source fields must be valid, template_id must be a string, and inputs must be an object when provided.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const latestGoal = getLatestSessionGoal(sessionId) || session.current_goal;
    if (!latestGoal) {
      return res.status(409).json({
        code: "session_goal_missing",
        message: "Add a user task message before creating a DAG proposal.",
      });
    }

    try {
      const result = await createDagProposalForSession({
        sessionId,
        session,
        latestGoal,
        body: req.body,
      });
      if (!result.ok) {
        return res.status(result.status).json(result.body);
      }
      appendSessionMessage({
        sessionId,
        role: "orchestrator",
        kind: "text",
        content: {
          text: `Created DAG proposal ${result.proposal.proposal_id} for review.`,
          proposal_id: result.proposal.proposal_id,
          status: result.proposal.status,
        },
      });
      return res.status(201).json({
        session: buildSessionSummary(sessionId),
        proposal: result.proposal,
      });
    } catch (error) {
      return res.status(400).json({
        code: "proposal_generation_failed",
        message: error instanceof Error ? error.message : "DAG proposal generation failed.",
      });
    }
  });

  app.get("/api/sessions/:sessionId/dag-proposals", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const items = listSessionDagProposals(sessionId).map((proposal) => ({
      proposal_id: proposal.proposal_id,
      session_id: proposal.session_id,
      mission_id: proposal.mission_id,
      status: proposal.status,
      title: proposal.title,
      summary: proposal.summary,
      source_revision: proposal.source_revision,
      source_option: proposal.source_option,
      created_at: proposal.created_at,
      updated_at: proposal.updated_at,
    }));

    return res.json({
      items,
      confirmed_proposal_id: session.confirmed_proposal_id,
    });
  });

  app.get("/api/sessions/:sessionId/dag-proposals/:proposalId", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    const proposalId = getSingleParam(req.params.proposalId);
    if (!sessionId || !proposalId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId and proposalId are required.",
      });
    }
    if (!getSession(sessionId)) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const proposal = getDagProposal(sessionId, proposalId);
    if (!proposal) {
      return res.status(404).json({
        code: "proposal_not_found",
        message: "DAG proposal not found.",
      });
    }
    return res.json({ proposal });
  });

  app.patch("/api/sessions/:sessionId/dag-proposals/:proposalId/assignments", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    const proposalId = getSingleParam(req.params.proposalId);
    if (!sessionId || !proposalId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId and proposalId are required.",
      });
    }
    if (!isUpdateDagProposalAssignmentsBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "assignments must be an array of valid proposal assignments.",
      });
    }
    if (!getSession(sessionId)) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const proposal = updateDagProposal(sessionId, proposalId, (current) => ({
      ...current,
      assignments: req.body.assignments.map(normalizeDagProposalAssignment),
    }));
    if (!proposal) {
      return res.status(404).json({
        code: "proposal_not_found",
        message: "DAG proposal not found.",
      });
    }
    return res.json({ proposal });
  });

  app.post("/api/sessions/:sessionId/dag-proposals/:proposalId/confirm", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    const proposalId = getSingleParam(req.params.proposalId);
    if (!sessionId || !proposalId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId and proposalId are required.",
      });
    }
    if (!isConfirmDagProposalBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "confirmed_by must be a string when provided.",
      });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const { planStale, staleReason } = getSessionRouteStaleState(sessionId, session);
    if (planStale) {
      return res.status(409).json({
        code: "plan_stale",
        message:
          staleReason ||
          "The current route is stale because the task brief changed. Revise the route before confirming it.",
      });
    }
    const timestamp = nowIso();
    const proposal = updateDagProposal(sessionId, proposalId, (current) => ({
      ...current,
      status: "confirmed",
      confirmed_at: timestamp,
      confirmed_by:
        typeof req.body.confirmed_by === "string" && req.body.confirmed_by.trim()
          ? req.body.confirmed_by.trim()
          : "user",
    }));
    if (!proposal) {
      return res.status(404).json({
        code: "proposal_not_found",
        message: "DAG proposal not found.",
      });
    }

    session.confirmed_proposal_id = proposal.proposal_id;
    session.confirmed_plan_revision = proposal.source_revision ?? session.confirmed_plan_revision;
    session.confirmed_plan_option = proposal.source_option ?? session.confirmed_plan_option;
    session.current_plan_summary = `Confirmed DAG proposal ${proposal.proposal_id}.`;
    session.metadata = {
      ...clearSessionRouteStaleState(session),
      pending_decision: "The DAG proposal is locked. Run it when you are ready, or supersede it with a revised proposal.",
      latest_orchestrator_intent: "confirm_ready",
      latest_proposal_id: proposal.proposal_id,
    };
    syncSessionWorkingState(sessionId, session);
    session.updated_at = timestamp;
    saveSession(session);

    const message = appendSessionMessage({
      sessionId,
      role: "orchestrator",
      kind: "text",
      content: {
        text: `Confirmed DAG proposal ${proposal.proposal_id} for execution.`,
        proposal_id: proposal.proposal_id,
      },
    });
    session.last_orchestrator_message_id = message.message_id;
    session.updated_at = message.created_at;
    syncSessionWorkingState(sessionId, session);
    saveSession(session);

    return res.json({
      session: buildSessionSummary(sessionId),
      proposal,
      message,
    });
  });

  app.post("/api/sessions/:sessionId/dag-proposals/:proposalId/reject", (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    const proposalId = getSingleParam(req.params.proposalId);
    if (!sessionId || !proposalId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId and proposalId are required.",
      });
    }
    if (!isRejectDagProposalBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "rejected_by and reason must be strings when provided.",
      });
    }
    if (!getSession(sessionId)) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const timestamp = nowIso();
    const proposal = updateDagProposal(sessionId, proposalId, (current) => ({
      ...current,
      status: "rejected",
      rejected_at: timestamp,
      rejected_by:
        typeof req.body.rejected_by === "string" && req.body.rejected_by.trim()
          ? req.body.rejected_by.trim()
          : "user",
      metadata: {
        ...current.metadata,
        rejection_reason:
          typeof req.body.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null,
      },
    }));
    if (!proposal) {
      return res.status(404).json({
        code: "proposal_not_found",
        message: "DAG proposal not found.",
      });
    }
    return res.json({ proposal });
  });

  app.post("/api/sessions/:sessionId/dag-proposals/:proposalId/supersede", async (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    const proposalId = getSingleParam(req.params.proposalId);
    if (!sessionId || !proposalId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId and proposalId are required.",
      });
    }
    if (!isSupersedeDagProposalBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "source_message_id, reason, template_id, and inputs must be valid when provided.",
      });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }
    const existing = getDagProposal(sessionId, proposalId);
    if (!existing) {
      return res.status(404).json({
        code: "proposal_not_found",
        message: "DAG proposal not found.",
      });
    }
    const latestGoal = getLatestSessionGoal(sessionId) || session.current_goal;
    if (!latestGoal) {
      return res.status(409).json({
        code: "session_goal_missing",
        message: "Add a user task message before superseding a DAG proposal.",
      });
    }

    try {
      const result = await createDagProposalForSession({
        sessionId,
        session,
        latestGoal,
        body: req.body,
        supersedesProposalId: proposalId,
      });
      if (!result.ok) {
        return res.status(result.status).json(result.body);
      }
      const timestamp = nowIso();
      const previous = updateDagProposal(sessionId, proposalId, (current) => ({
        ...current,
        status: "superseded",
        superseded_at: timestamp,
        superseded_by_proposal_id: result.proposal.proposal_id,
        metadata: {
          ...current.metadata,
          supersede_reason:
            typeof req.body.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null,
        },
      }));
      return res.status(201).json({
        session: buildSessionSummary(sessionId),
        proposal: result.proposal,
        superseded_proposal: previous,
      });
    } catch (error) {
      return res.status(400).json({
        code: "proposal_supersede_failed",
        message: error instanceof Error ? error.message : "DAG proposal supersede failed.",
      });
    }
  });

  app.post("/api/sessions/:sessionId/runs", async (req: Request, res: Response) => {
    const sessionId = getSingleParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "sessionId is required.",
      });
    }
    if (!isCreateRunFromSessionBody(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message:
          "template_id and proposal_id must be strings, inputs must be an object, and validation_mode must be valid.",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const latestGoal = getLatestSessionGoal(sessionId) || session.current_goal;
    if (!latestGoal) {
      return res.status(409).json({
        code: "session_goal_missing",
        message: "Add a user task message before creating a run.",
      });
    }

    const result = await performSessionRun({
      sessionId,
      session,
      latestGoal,
      templateId: req.body.template_id,
      inputs: isPlainObject(req.body.inputs) ? { ...req.body.inputs } : {},
      validationMode: req.body.validation_mode,
      planRevision: req.body.plan_revision,
      planOption: req.body.plan_option,
      proposalId: req.body.proposal_id,
    });
    if (!result.ok) {
      return res.status(result.status).json(result.body);
    }
    return res.status(result.status).json(result.body);
  });

  app.get("/api/runs", (_req: Request, res: Response) => {
    const runs = listRuns().map((run) => ({
      run_id: run.run_id,
      template_id: run.template_id,
      status: run.status,
      current_summary: run.current_summary,
      proposal_id: run.proposal_id,
    }));
    res.json({ items: runs });
  });

  app.get("/api/mobile/runs", (_req: Request, res: Response) => {
    const items = listRuns()
      .map((run) => buildMobileRunSummary(run.run_id))
      .filter((item): item is MobileRunSummary => !!item);
    return res.json({ items });
  });

  app.get("/api/mobile/home", (_req: Request, res: Response) => {
    return res.json(buildMobileHomeResponse());
  });

  app.get("/api/mobile/inbox", (_req: Request, res: Response) => {
    return res.json({
      items: buildMobileInboxItems(),
    });
  });

  app.get("/api/mobile/runs/:runId", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    const detail = buildMobileRunDetail(runId);
    if (!detail) {
      return res.status(404).json({
        code: "not_found",
        message: "Run not found.",
      });
    }

    return res.json(detail);
  });

  app.get("/api/mobile/runs/:runId/follow-up", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    const followUp = buildMobileRunFollowUp(runId);
    if (!followUp) {
      return res.status(404).json({
        code: "not_found",
        message: "Run not found.",
      });
    }

    return res.json(followUp);
  });

  app.post("/api/runs", (req: Request, res: Response) => {
    const body = req.body as Partial<CreateRunRequest>;

    if (
      typeof body.intent !== "string" ||
      !body.intent.trim() ||
      typeof body.template_id !== "string" ||
      !body.template_id.trim() ||
      !isPlainObject(body.inputs)
    ) {
      return res.status(400).json({
        code: "invalid_request",
        message: "intent, template_id, and inputs are required.",
      });
    }

    const validationMode = parseRunValidationMode(body.validation_mode);
    if (!validationMode) {
      return res.status(400).json({
        code: "invalid_request",
        message: "validation_mode must be one of: warn, strict, bypass.",
      });
    }

    const result = createRunAndPersist({
      intent: body.intent.trim(),
      templateId: body.template_id.trim(),
      inputs: body.inputs,
      validationMode,
      proposalId:
        typeof body.proposal_id === "string" && body.proposal_id.trim()
          ? body.proposal_id.trim()
          : null,
    });
    return res.status(result.status).json(result.body);
  });

  app.get("/api/runs/:runId", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    const run = getRun(runId);
    if (!run) {
      return res.status(404).json({
        code: "not_found",
        message: "Run not found.",
      });
    }

    return res.json({
      run_id: run.run_id,
      template_id: run.template_id,
      template_version: run.template_version,
      workspace_id: run.workspace_id,
      requested_by: run.requested_by,
      intent: run.intent,
      status: run.status,
      current_summary: run.current_summary,
      waiting_reason: run.waiting_reason,
      blocked_reason: run.blocked_reason,
      created_at: run.created_at,
      updated_at: run.updated_at,
      started_at: run.started_at,
      finished_at: run.finished_at,
      last_event_id: run.last_event_id,
      inputs: run.inputs,
      proposal_id: run.proposal_id,
    });
  });

  app.get("/api/runs/:runId/events", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    const run = getRun(runId);
    if (!run) {
      return res.status(404).json({
        code: "not_found",
        message: "Run not found.",
      });
    }

    return res.json({
      items: listRunEvents(runId),
    });
  });

  app.get("/api/runs/:runId/artifacts", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    const run = getRun(runId);
    if (!run) {
      return res.status(404).json({
        code: "not_found",
        message: "Run not found.",
      });
    }

    return res.json({
      items: listArtifacts(runId),
    });
  });

  app.get("/api/runs/:runId/plan", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    const run = getRun(runId);
    if (!run) {
      return res.status(404).json({
        code: "not_found",
        message: "Run not found.",
      });
    }

    const plan = getRunPlan(runId);
    if (!plan) {
      return res.status(404).json({
        code: "not_found",
        message: "Run plan not found.",
      });
    }

    return res.json(plan);
  });

  app.get("/api/runs/:runId/graph", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    const run = getRun(runId);
    if (!run) {
      return res.status(404).json({
        code: "not_found",
        message: "Run not found.",
      });
    }

    const plan = getRunPlan(runId);
    if (!plan) {
      return res.status(404).json({
        code: "not_found",
        message: "Run plan not found.",
      });
    }

    return res.json(
      buildRuntimeGraphSummary({
        run,
        plan,
        nodeRuns: listNodeRuns(runId),
      }),
    );
  });

  app.get("/api/runs/:runId/nodes", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    const run = getRun(runId);
    if (!run) {
      return res.status(404).json({
        code: "not_found",
        message: "Run not found.",
      });
    }

    return res.json({
      items: listNodeRuns(runId),
    });
  });

  app.post("/api/internal/ops/execution/dispatch-sweep", (_req: Request, res: Response) => {
    void executionAdapter
      .runMaintenance("dispatch_sweep")
      .then((result) => {
        if (!result.supported) {
          return res.status(409).json({
            code: "maintenance_unsupported",
            message: result.message || "Execution maintenance is not supported.",
            adapter_kind: result.adapter_kind,
          });
        }

        return res.status(202).json(result);
      })
      .catch((error) => {
        return res.status(500).json({
          code: "maintenance_failed",
          message:
            error instanceof Error ? error.message : "Execution maintenance failed.",
          adapter_kind: executionAdapter.kind,
        });
      });
  });

  app.post("/api/runs/:runId/actions/pause", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    try {
      const result = applyRunAction(runId, "pause");
      executionAdapter.notifyRunAction(runId, "pause");
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "RUN_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Run not found.",
        });
      }

      return res.status(409).json({
        code: "invalid_run_state",
        message: "Run cannot be paused in its current state.",
      });
    }
  });

  app.post("/api/runs/:runId/actions/resume", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    try {
      const result = applyRunAction(runId, "resume");
      executionAdapter.notifyRunAction(runId, "resume");
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "RUN_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Run not found.",
        });
      }

      return res.status(409).json({
        code: "invalid_run_state",
        message: "Run cannot be resumed in its current state.",
      });
    }
  });

  app.post("/api/runs/:runId/actions/cancel", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    if (!runId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId is required.",
      });
    }

    try {
      const result = applyRunAction(runId, "cancel");
      executionAdapter.notifyRunAction(runId, "cancel");
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "RUN_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Run not found.",
        });
      }

      return res.status(409).json({
        code: "invalid_run_state",
        message: "Run cannot be cancelled in its current state.",
      });
    }
  });

  app.post("/api/runs/:runId/nodes/:nodeRunId/actions/retry", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    const nodeRunId = getSingleParam(req.params.nodeRunId);
    if (!runId || !nodeRunId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId and nodeRunId are required.",
      });
    }

    try {
      const result = applyNodeAction(runId, nodeRunId, "retry");
      executionAdapter.notifyNodeAction(runId, nodeRunId, "retry");
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "RUN_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Run not found.",
        });
      }
      if (error instanceof Error && error.message === "NODE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Node run not found.",
        });
      }

      return res.status(409).json({
        code: "invalid_node_state",
        message: "Node cannot be retried in its current state.",
      });
    }
  });

  app.post("/api/runs/:runId/nodes/:nodeRunId/actions/skip", (req: Request, res: Response) => {
    const runId = getSingleParam(req.params.runId);
    const nodeRunId = getSingleParam(req.params.nodeRunId);
    if (!runId || !nodeRunId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "runId and nodeRunId are required.",
      });
    }

    try {
      const result = applyNodeAction(runId, nodeRunId, "skip");
      executionAdapter.notifyNodeAction(runId, nodeRunId, "skip");
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "RUN_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Run not found.",
        });
      }
      if (error instanceof Error && error.message === "NODE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Node run not found.",
        });
      }

      return res.status(409).json({
        code: "invalid_node_state",
        message: "Node cannot be skipped in its current state.",
      });
    }
  });

  app.get("/api/approvals", (_req: Request, res: Response) => {
    return res.json({
      items: listApprovals("pending"),
    });
  });

  app.post("/api/approvals/:approvalId/approve", (req: Request, res: Response) => {
    const approvalId = getSingleParam(req.params.approvalId);
    if (!approvalId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "approvalId is required.",
      });
    }

    const approval = getApproval(approvalId);
    if (!approval) {
      return res.status(404).json({
        code: "not_found",
        message: "Approval not found.",
      });
    }
    if (approval.status !== "pending") {
      return res.status(409).json({
        code: "invalid_approval_state",
        message: "Approval is not pending.",
      });
    }

    const timestamp = nowIso();
    approval.status = "approved";
    approval.resolved_at = timestamp;
    saveApproval(approval);

    const event = appendRunEvent({
      run_id: approval.run_id,
      node_run_id: approval.node_run_id,
      type: "approval.granted",
      actor_type: "operator",
      actor_id: "operator",
      payload: {
        approval_id: approval.approval_id,
        comment:
          isPlainObject(req.body) && typeof req.body.comment === "string" ? req.body.comment : "",
      },
      created_at: timestamp,
    });

    if (approval.node_run_id) {
      const run = getRun(approval.run_id);
      const plan = getRunPlan(approval.run_id);
      const nodeRuns = listNodeRuns(approval.run_id);
      const nodeRun = nodeRuns.find((item) => item.node_run_id === approval.node_run_id);
      const node = plan?.compiled_nodes.find((item) => item.node_run_id === approval.node_run_id);

      if (run && plan && nodeRun && node) {
        node.status = "ready";
        node.execution_ref = {
          openclaw_task_id: null,
          openclaw_session_id: null,
        };
        node.retry_policy.attempt = nodeRun.attempt;
        nodeRun.status = "ready";
        nodeRun.progress = {
          percent: 0,
          message: "Approval granted; ready for dispatch",
          updated_at: timestamp,
        };
        nodeRun.finished_at = null;
        run.status = "running";
        run.waiting_reason = null;
        run.current_summary = `Approval granted: ${node.name}`;
        run.updated_at = timestamp;
        run.last_event_id = event.event_id;
        plan.status = "running";
        saveRun(run);
        saveRunPlan(plan);
        saveNodeRuns(approval.run_id, nodeRuns);
        executionAdapter.notifyNodeAction(approval.run_id, approval.node_run_id, "retry");
      }
    }

    return res.json({
      approval_id: approval.approval_id,
      status: approval.status,
    });
  });

  app.post("/api/approvals/:approvalId/reject", (req: Request, res: Response) => {
    const approvalId = getSingleParam(req.params.approvalId);
    if (!approvalId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "approvalId is required.",
      });
    }

    const approval = getApproval(approvalId);
    if (!approval) {
      return res.status(404).json({
        code: "not_found",
        message: "Approval not found.",
      });
    }
    if (approval.status !== "pending") {
      return res.status(409).json({
        code: "invalid_approval_state",
        message: "Approval is not pending.",
      });
    }

    const timestamp = nowIso();
    approval.status = "rejected";
    approval.resolved_at = timestamp;
    saveApproval(approval);

    const event = appendRunEvent({
      run_id: approval.run_id,
      node_run_id: approval.node_run_id,
      type: "approval.rejected",
      actor_type: "operator",
      actor_id: "operator",
      payload: {
        approval_id: approval.approval_id,
        comment:
          isPlainObject(req.body) && typeof req.body.comment === "string" ? req.body.comment : "",
      },
      created_at: timestamp,
    });

    const run = getRun(approval.run_id);
    const plan = getRunPlan(approval.run_id);
    const nodeRuns = listNodeRuns(approval.run_id);
    if (run && plan && approval.node_run_id) {
      applyNodeStatus(
        plan,
        nodeRuns,
        approval.node_run_id,
        "failed",
        timestamp,
        "Approval rejected",
        100,
      );
      run.status = "failed";
      run.current_summary = "Approval rejected";
      run.blocked_reason = "Approval rejected";
      run.finished_at = timestamp;
      run.updated_at = timestamp;
      run.last_event_id = event.event_id;
      plan.status = "failed";
      saveRun(run);
      saveRunPlan(plan);
      saveNodeRuns(approval.run_id, nodeRuns);
    }

    return res.json({
      approval_id: approval.approval_id,
      status: approval.status,
    });
  });

  app.get("/api/human-inputs", (_req: Request, res: Response) => {
    return res.json({
      items: listHumanInputs("pending"),
    });
  });

  app.post("/api/human-inputs/:inputRequestId/submit", (req: Request, res: Response) => {
    const inputRequestId = getSingleParam(req.params.inputRequestId);
    if (!inputRequestId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "inputRequestId is required.",
      });
    }

    const inputRequest = getHumanInput(inputRequestId);
    if (!inputRequest) {
      return res.status(404).json({
        code: "not_found",
        message: "Human input request not found.",
      });
    }
    if (inputRequest.status !== "pending") {
      return res.status(409).json({
        code: "invalid_human_input_state",
        message: "Human input request is not pending.",
      });
    }

    const timestamp = nowIso();
    inputRequest.status = "submitted";
    inputRequest.submitted_at = timestamp;
    saveHumanInput(inputRequest);

    const event = appendRunEvent({
      run_id: inputRequest.run_id,
      node_run_id: inputRequest.node_run_id,
      type: "human_input.submitted",
      actor_type: "operator",
      actor_id: "operator",
      payload: {
        input_request_id: inputRequest.input_request_id,
        payload:
          isPlainObject(req.body) && isPlainObject(req.body.payload) ? req.body.payload : {},
      },
      created_at: timestamp,
    });

    if (inputRequest.node_run_id) {
      const run = getRun(inputRequest.run_id);
      const plan = getRunPlan(inputRequest.run_id);
      const nodeRuns = listNodeRuns(inputRequest.run_id);
      const nodeRun = nodeRuns.find((item) => item.node_run_id === inputRequest.node_run_id);
      const node = plan?.compiled_nodes.find((item) => item.node_run_id === inputRequest.node_run_id);

      if (run && plan && nodeRun && node) {
        node.status = "ready";
        node.execution_ref = {
          openclaw_task_id: null,
          openclaw_session_id: null,
        };
        node.retry_policy.attempt = nodeRun.attempt;
        nodeRun.status = "ready";
        nodeRun.progress = {
          percent: 0,
          message: "Human input submitted; ready for dispatch",
          updated_at: timestamp,
        };
        nodeRun.finished_at = null;
        const currentInputs =
          isPlainObject(node.input_payload.run_inputs) ? node.input_payload.run_inputs : {};
        node.input_payload = {
          ...node.input_payload,
          run_inputs: {
            ...currentInputs,
            human_input_submission:
              isPlainObject(req.body) && isPlainObject(req.body.payload) ? req.body.payload : {},
          },
        };
        run.status = "running";
        run.waiting_reason = null;
        run.current_summary = `Human input submitted: ${node.name}`;
        run.updated_at = timestamp;
        run.last_event_id = event.event_id;
        plan.status = "running";
        saveRun(run);
        saveRunPlan(plan);
        saveNodeRuns(inputRequest.run_id, nodeRuns);
        executionAdapter.notifyNodeAction(inputRequest.run_id, inputRequest.node_run_id, "retry");
      }
    }

    return res.json({
      input_request_id: inputRequest.input_request_id,
      status: inputRequest.status,
    });
  });

  app.post("/api/internal/openclaw/reports", (req: Request, res: Response) => {
    if (OPENCLAW_CALLBACK_TOKEN) {
      const authHeader = req.header("authorization") || "";
      const expected = `Bearer ${OPENCLAW_CALLBACK_TOKEN}`;
      if (authHeader !== expected) {
        return res.status(401).json({
          code: "unauthorized",
          message: "Invalid callback token.",
        });
      }
    }

    if (!isValidReportCallback(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "Callback body is invalid.",
      });
    }

    try {
      applyOpenClawCallback(req.body);
      return res.status(202).json({ accepted: true });
    } catch (error) {
      if (error instanceof Error && error.message === "RUN_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Run not found.",
        });
      }
      if (error instanceof Error && error.message === "NODE_NOT_FOUND") {
        return res.status(404).json({
          code: "not_found",
          message: "Node run not found.",
        });
      }
      if (error instanceof Error && error.message === "INVALID_REPORT_STATUS") {
        return res.status(409).json({
          code: "invalid_report_status",
          message: "Unsupported report status.",
        });
      }
      return res.status(500).json({
        code: "callback_failed",
        message: error instanceof Error ? error.message : "Callback processing failed.",
      });
    }
  });

  return app;
}
