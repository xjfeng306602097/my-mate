import path from "node:path";
import { DAG_PROPOSALS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { resolveAgentCapabilities } from "./agent-capability-resolver.js";
import { synchronizeMissionEvolution } from "./mission-evolution.js";
import type {
  AgentCapabilityPlanRecord,
  AgentRequirement,
  DagProposalRecord,
  DagProposalStatus,
  MissionSpecContract,
  RouteCompareSummary,
} from "./types.js";
import { ensureDir, generateDagProposalId, nowIso, writeJsonAtomic } from "./utils.js";

function sessionDagProposalDir(sessionId: string): string {
  return path.join(DAG_PROPOSALS_DIR, sessionId);
}

function dagProposalPath(sessionId: string, proposalId: string): string {
  return path.join(sessionDagProposalDir(sessionId), `${proposalId}.json`);
}

function normalizeDagProposalRecord(record: DagProposalRecord): DagProposalRecord {
  const legacy = record as DagProposalRecord & { orchestrator_profile_id?: string | null };
  const { orchestrator_profile_id: _legacyOrchestratorProfileId, ...canonical } = legacy;
  return {
    ...canonical,
    orchestrator_agent_id:
      typeof record.orchestrator_agent_id === "string" && record.orchestrator_agent_id.trim()
        ? record.orchestrator_agent_id.trim()
        : typeof legacy.orchestrator_profile_id === "string" && legacy.orchestrator_profile_id.trim()
          ? legacy.orchestrator_profile_id.trim()
        : null,
    source_message_id:
      typeof record.source_message_id === "string" && record.source_message_id.trim()
        ? record.source_message_id.trim()
        : null,
    source_revision:
      typeof record.source_revision === "number" && Number.isInteger(record.source_revision)
        ? record.source_revision
        : null,
    source_option:
      record.source_option === "primary" || record.source_option === "alternative"
        ? record.source_option
        : null,
    mission_spec_contract: record.mission_spec_contract || null,
    route_compare: record.route_compare || null,
    protocol_version: 1,
    assignments: Array.isArray(record.assignments) ? record.assignments : [],
    orchestration_decision: record.orchestration_decision || null,
    dag_definition: record.dag_definition || null,
    compiled_agent_dag_id:
      typeof record.compiled_agent_dag_id === "string" && record.compiled_agent_dag_id.trim()
        ? record.compiled_agent_dag_id.trim()
        : null,
    compiled_at: typeof record.compiled_at === "string" ? record.compiled_at : null,
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
    checklist: Array.isArray(record.checklist) ? record.checklist : [],
    confirmed_at: typeof record.confirmed_at === "string" ? record.confirmed_at : null,
    confirmed_by: typeof record.confirmed_by === "string" ? record.confirmed_by : null,
    rejected_at: typeof record.rejected_at === "string" ? record.rejected_at : null,
    rejected_by: typeof record.rejected_by === "string" ? record.rejected_by : null,
    superseded_at: typeof record.superseded_at === "string" ? record.superseded_at : null,
    superseded_by_proposal_id:
      typeof record.superseded_by_proposal_id === "string" && record.superseded_by_proposal_id.trim()
        ? record.superseded_by_proposal_id.trim()
        : null,
    supersedes_proposal_id:
      typeof record.supersedes_proposal_id === "string" && record.supersedes_proposal_id.trim()
        ? record.supersedes_proposal_id.trim()
        : null,
    metadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata
        : {},
  };
}

export function buildProposalAgentRequirements(input: {
  definition: NonNullable<DagProposalRecord["dag_definition"]>;
  assignments: DagProposalRecord["assignments"];
}): AgentRequirement[] {
  const assignments = new Map(input.assignments.map((assignment) => [assignment.node_id, assignment]));
  return input.definition.nodes
    .filter((node) => !!node.agent_selector)
    .map((node) => {
      const assignment = assignments.get(node.node_id);
      const workspaceTools = node.allowed_tools.filter((tool) => tool.toLocaleLowerCase().startsWith("workspace_"));
      const workspaceWrite = workspaceTools.some((tool) => /write|apply|patch|delete|move|rename|run_command/iu.test(tool));
      const requestedIsolation = typeof node.metadata.isolation_requirement === "string"
        ? node.metadata.isolation_requirement
        : "auto";
      return {
        requirement_id: `${input.definition.definition_id}:${node.node_id}`,
        node_id: node.node_id,
        preferred_agent_id: node.agent_selector?.agent_id || assignment?.agent_id || null,
        preferred_agent_version: node.agent_selector?.agent_version || null,
        role: node.agent_selector?.role || null,
        capability_tags: node.agent_selector?.capability_tags || [],
        required_skills: node.allowed_skills,
        required_tools: node.allowed_tools,
        model_constraints: {
          provider_connection_id: null,
          model: assignment?.model || null,
          minimum_context_window: typeof node.metadata.minimum_context_window === "number"
            ? node.metadata.minimum_context_window
            : null,
        },
        memory_policy: {},
        permission_policy: {
          workspace_read: workspaceTools.length > 0,
          workspace_write: workspaceWrite,
          autonomy_ceiling: node.autonomy_mode,
        },
        isolation_requirement:
          requestedIsolation === "local" || requestedIsolation === "docker" || requestedIsolation === "isolated"
            ? requestedIsolation
            : "auto",
        input_contract: node.input_contract,
        output_contract: node.output_contract,
      };
    });
}

export function saveDagProposal(proposal: DagProposalRecord): DagProposalRecord {
  const normalized = normalizeDagProposalRecord(proposal);
  ensureDir(sessionDagProposalDir(normalized.session_id));
  writeJsonAtomic(dagProposalPath(normalized.session_id, normalized.proposal_id), normalized);
  return normalized;
}

export function createDagProposal(input: {
  missionId: string;
  sessionId: string;
  orchestratorAgentId: string | null;
  sourceMessageId: string | null;
  sourceRevision: number | null;
  sourceOption: "primary" | "alternative" | null;
  status?: DagProposalStatus;
  title: string;
  summary: string;
  missionSpecContract: MissionSpecContract | null;
  plannerContext: DagProposalRecord["planner_context"];
  dagDraft: Record<string, unknown>;
  routeCompare: RouteCompareSummary | null;
  assignments?: DagProposalRecord["assignments"];
  orchestrationDecision?: DagProposalRecord["orchestration_decision"];
  dagDefinition?: DagProposalRecord["dag_definition"];
  warnings?: string[];
  checklist?: string[];
  supersedesProposalId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): DagProposalRecord {
  const timestamp = input.createdAt || nowIso();
  let capabilityPlanId: string | null = null;
  let capabilityPlanStatus: "ready" | "partial" | "blocked" | null = null;
  let capabilityGapCount = 0;
  const capabilityWarnings: string[] = [];
  if (input.missionSpecContract && input.dagDefinition) {
    const evolution = synchronizeMissionEvolution({
      missionSpec: input.missionSpecContract,
      sourceMessageId: input.sourceMessageId,
      createdAt: timestamp,
    });
    const requirements = buildProposalAgentRequirements({
      definition: input.dagDefinition,
      assignments: input.assignments || [],
    });
    const capabilityPlan = resolveAgentCapabilities({
      missionId: input.missionId,
      sessionId: input.sessionId,
      missionRevisionId: evolution.revision.revision_id,
      requirements,
      createdAt: timestamp,
    });
    capabilityPlanId = capabilityPlan.plan_id;
    capabilityPlanStatus = capabilityPlan.status;
    capabilityGapCount = capabilityPlan.gaps.length;
    if (capabilityPlan.status !== "ready") {
      capabilityWarnings.push(
        `${capabilityPlan.gaps.length} Agent capability gap(s) must be resolved before execution.`,
      );
    }
  }
  return saveDagProposal({
    protocol_version: 1,
    proposal_id: generateDagProposalId(),
    mission_id: input.missionId,
    session_id: input.sessionId,
    orchestrator_agent_id: input.orchestratorAgentId,
    source_message_id: input.sourceMessageId,
    source_revision: input.sourceRevision,
    source_option: input.sourceOption,
    status: input.status || "review_ready",
    title: input.title,
    summary: input.summary,
    mission_spec_contract: input.missionSpecContract,
    planner_context: input.plannerContext,
    dag_draft: input.dagDraft,
    route_compare: input.routeCompare,
    assignments: input.assignments || [],
    orchestration_decision: input.orchestrationDecision || null,
    dag_definition: input.dagDefinition || null,
    compiled_agent_dag_id: null,
    compiled_at: null,
    warnings: [...new Set([...(input.warnings || []), ...capabilityWarnings])],
    checklist: input.checklist || [],
    created_at: timestamp,
    updated_at: timestamp,
    confirmed_at: null,
    confirmed_by: null,
    rejected_at: null,
    rejected_by: null,
    superseded_at: null,
    superseded_by_proposal_id: null,
    supersedes_proposal_id: input.supersedesProposalId || null,
    metadata: {
      ...(input.metadata || {}),
      capability_plan_id: capabilityPlanId,
      capability_plan_status: capabilityPlanStatus,
      capability_gap_count: capabilityGapCount,
    },
  });
}

export function refreshDagProposalCapabilityPlan(input: {
  proposal: DagProposalRecord;
  workspaceId?: string;
  availableToolNames?: Iterable<string>;
  createdAt?: string;
}): { proposal: DagProposalRecord; plan: AgentCapabilityPlanRecord | null } {
  if (!input.proposal.mission_spec_contract || !input.proposal.dag_definition) {
    return { proposal: input.proposal, plan: null };
  }
  const timestamp = input.createdAt || nowIso();
  const evolution = synchronizeMissionEvolution({
    missionSpec: input.proposal.mission_spec_contract,
    sourceMessageId: input.proposal.source_message_id,
    createdAt: timestamp,
  });
  const plan = resolveAgentCapabilities({
    workspaceId: input.workspaceId,
    missionId: input.proposal.mission_id,
    sessionId: input.proposal.session_id,
    missionRevisionId: evolution.revision.revision_id,
    requirements: buildProposalAgentRequirements({
      definition: input.proposal.dag_definition,
      assignments: input.proposal.assignments,
    }),
    availableToolNames: input.availableToolNames,
    createdAt: timestamp,
  });
  const warningPattern = /^(?:\d+ Agent capability gap\(s\) must be resolved before execution\.|Agent capability gap:)/u;
  const warnings = input.proposal.warnings.filter((warning) => !warningPattern.test(warning));
  if (plan.status !== "ready") {
    warnings.push(`${plan.gaps.length} Agent capability gap(s) must be resolved before execution.`);
    for (const gap of plan.gaps.slice(0, 5)) {
      warnings.push(`Agent capability gap: ${gap.value} ${gap.resolution_hint}`);
    }
  }
  const proposal = updateDagProposal(input.proposal.session_id, input.proposal.proposal_id, (current) => ({
    ...current,
    warnings: [...new Set(warnings)],
    metadata: {
      ...current.metadata,
      capability_plan_id: plan.plan_id,
      capability_plan_status: plan.status,
      capability_gap_count: plan.gaps.length,
    },
  })) || input.proposal;
  return { proposal, plan };
}

export function getDagProposal(sessionId: string, proposalId: string): DagProposalRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = dagProposalPath(sessionId, proposalId);
  if (!storage.exists(filePath)) {
    return null;
  }
  return normalizeDagProposalRecord(storage.readJson<DagProposalRecord>(filePath));
}

export function updateDagProposal(
  sessionId: string,
  proposalId: string,
  updater: (current: DagProposalRecord) => DagProposalRecord,
): DagProposalRecord | null {
  const current = getDagProposal(sessionId, proposalId);
  if (!current) {
    return null;
  }
  const next = updater(current);
  next.updated_at = nowIso();
  return saveDagProposal(next);
}

export function listSessionDagProposals(sessionId: string): DagProposalRecord[] {
  const dirPath = sessionDagProposalDir(sessionId);
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(dirPath);

  const proposals = files.map((filePath) =>
    normalizeDagProposalRecord(storage.readJson<DagProposalRecord>(filePath)),
  );

  proposals.sort((a, b) => {
    if (a.created_at === b.created_at) {
      return b.proposal_id.localeCompare(a.proposal_id);
    }
    return b.created_at.localeCompare(a.created_at);
  });
  return proposals;
}

export function listAllDagProposals(): DagProposalRecord[] {
  const storage = getJsonStorageBackend();
  const proposals = storage.listDirs(DAG_PROPOSALS_DIR).flatMap((directory) =>
    storage.listJsonFiles(directory).map((filePath) =>
      normalizeDagProposalRecord(storage.readJson<DagProposalRecord>(filePath)),
    ),
  );
  return proposals.sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at) || right.proposal_id.localeCompare(left.proposal_id),
  );
}

export function getDagProposalById(proposalId: string): DagProposalRecord | null {
  return listAllDagProposals().find((proposal) => proposal.proposal_id === proposalId) || null;
}

export function getConfirmedProposalForAgentDag(
  sessionId: string,
  dagId: string,
): DagProposalRecord | null {
  return listSessionDagProposals(sessionId).find((proposal) =>
    proposal.status === "confirmed" && proposal.compiled_agent_dag_id === dagId,
  ) || null;
}
