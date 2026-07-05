import fs from "node:fs";
import path from "node:path";
import { DAG_PROPOSALS_DIR } from "./config.js";
import type {
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
  return {
    ...record,
    orchestrator_profile_id:
      typeof record.orchestrator_profile_id === "string" && record.orchestrator_profile_id.trim()
        ? record.orchestrator_profile_id.trim()
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
    assignments: Array.isArray(record.assignments) ? record.assignments : [],
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

export function saveDagProposal(proposal: DagProposalRecord): DagProposalRecord {
  const normalized = normalizeDagProposalRecord(proposal);
  ensureDir(sessionDagProposalDir(normalized.session_id));
  writeJsonAtomic(dagProposalPath(normalized.session_id, normalized.proposal_id), normalized);
  return normalized;
}

export function createDagProposal(input: {
  missionId: string;
  sessionId: string;
  orchestratorProfileId: string | null;
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
  warnings?: string[];
  checklist?: string[];
  supersedesProposalId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): DagProposalRecord {
  const timestamp = input.createdAt || nowIso();
  return saveDagProposal({
    proposal_id: generateDagProposalId(),
    mission_id: input.missionId,
    session_id: input.sessionId,
    orchestrator_profile_id: input.orchestratorProfileId,
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
    warnings: input.warnings || [],
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
    metadata: input.metadata || {},
  });
}

export function getDagProposal(sessionId: string, proposalId: string): DagProposalRecord | null {
  const filePath = dagProposalPath(sessionId, proposalId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return normalizeDagProposalRecord(
    JSON.parse(fs.readFileSync(filePath, "utf-8")) as DagProposalRecord,
  );
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
  ensureDir(dirPath);
  const files = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));

  const proposals = files.map((filePath) =>
    normalizeDagProposalRecord(
      JSON.parse(fs.readFileSync(filePath, "utf-8")) as DagProposalRecord,
    ),
  );

  proposals.sort((a, b) => {
    if (a.created_at === b.created_at) {
      return b.proposal_id.localeCompare(a.proposal_id);
    }
    return b.created_at.localeCompare(a.created_at);
  });
  return proposals;
}
