import { randomUUID } from "node:crypto";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  AgentCapabilityPlanRecord,
  ExecutionShapeDecisionRecord,
  InterviewDecisionRecord,
  MissionDeltaRecord,
  MissionInterviewRecord,
  MissionSpecRevisionRecord,
} from "./types.js";
import { nowIso } from "./utils.js";

type OrchestrationFact =
  | MissionSpecRevisionRecord
  | MissionDeltaRecord
  | InterviewDecisionRecord
  | MissionInterviewRecord
  | ExecutionShapeDecisionRecord
  | AgentCapabilityPlanRecord;

const factFolders = {
  missionRevision: "mission-spec-revisions",
  missionDelta: "mission-deltas",
  interviewDecision: "interview-decisions",
  missionInterview: "mission-interviews",
  executionShapeDecision: "execution-shape-decisions",
  agentCapabilityPlan: "agent-capability-plans",
} as const;

function sessionDir(folder: string, sessionId: string): string {
  return path.join(DATA_DIR, folder, encodeURIComponent(sessionId));
}

function recordPath(folder: string, sessionId: string, id: string): string {
  return path.join(sessionDir(folder, sessionId), `${encodeURIComponent(id)}.json`);
}

function write<T extends OrchestrationFact>(folder: string, id: string, record: T): T {
  getJsonStorageBackend().writeJson(recordPath(folder, record.session_id, id), record);
  return record;
}

function list<T extends OrchestrationFact>(folder: string, sessionId: string): T[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(sessionDir(folder, sessionId))
    .map((file) => storage.readJson<T>(file))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

function latest<T extends OrchestrationFact>(folder: string, sessionId: string): T | null {
  return list<T>(folder, sessionId).at(-1) || null;
}

export function orchestrationFactId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function saveMissionSpecRevision(record: MissionSpecRevisionRecord): MissionSpecRevisionRecord {
  return write(factFolders.missionRevision, record.revision_id, record);
}

export function listMissionSpecRevisions(sessionId: string): MissionSpecRevisionRecord[] {
  return list<MissionSpecRevisionRecord>(factFolders.missionRevision, sessionId)
    .sort((left, right) => left.revision - right.revision);
}

export function getLatestMissionSpecRevision(sessionId: string): MissionSpecRevisionRecord | null {
  return listMissionSpecRevisions(sessionId).at(-1) || null;
}

export function saveMissionDelta(record: MissionDeltaRecord): MissionDeltaRecord {
  return write(factFolders.missionDelta, record.delta_id, record);
}

export function listMissionDeltas(sessionId: string): MissionDeltaRecord[] {
  return list<MissionDeltaRecord>(factFolders.missionDelta, sessionId);
}

export function getLatestMissionDelta(sessionId: string): MissionDeltaRecord | null {
  return latest(factFolders.missionDelta, sessionId);
}

export function saveInterviewDecision(record: InterviewDecisionRecord): InterviewDecisionRecord {
  return write(factFolders.interviewDecision, record.decision_id, record);
}

export function listInterviewDecisions(sessionId: string): InterviewDecisionRecord[] {
  return list<InterviewDecisionRecord>(factFolders.interviewDecision, sessionId);
}

export function getLatestInterviewDecision(sessionId: string): InterviewDecisionRecord | null {
  return latest(factFolders.interviewDecision, sessionId);
}

export function saveMissionInterview(record: MissionInterviewRecord): MissionInterviewRecord {
  return write(factFolders.missionInterview, record.interview_id, record);
}

export function listMissionInterviews(sessionId: string): MissionInterviewRecord[] {
  return list<MissionInterviewRecord>(factFolders.missionInterview, sessionId);
}

export function getLatestMissionInterview(sessionId: string): MissionInterviewRecord | null {
  return latest(factFolders.missionInterview, sessionId);
}

export function saveExecutionShapeDecision(
  record: ExecutionShapeDecisionRecord,
): ExecutionShapeDecisionRecord {
  return write(factFolders.executionShapeDecision, record.decision_id, record);
}

export function listExecutionShapeDecisions(sessionId: string): ExecutionShapeDecisionRecord[] {
  return list<ExecutionShapeDecisionRecord>(factFolders.executionShapeDecision, sessionId);
}

export function getLatestExecutionShapeDecision(
  sessionId: string,
): ExecutionShapeDecisionRecord | null {
  return latest(factFolders.executionShapeDecision, sessionId);
}

export function saveAgentCapabilityPlan(record: AgentCapabilityPlanRecord): AgentCapabilityPlanRecord {
  return write(factFolders.agentCapabilityPlan, record.plan_id, record);
}

export function listAgentCapabilityPlans(sessionId: string): AgentCapabilityPlanRecord[] {
  return list<AgentCapabilityPlanRecord>(factFolders.agentCapabilityPlan, sessionId);
}

export function getLatestAgentCapabilityPlan(sessionId: string): AgentCapabilityPlanRecord | null {
  return latest(factFolders.agentCapabilityPlan, sessionId);
}

export function touchMissionInterview(
  record: MissionInterviewRecord,
  update: Partial<Pick<MissionInterviewRecord, "status" | "readiness_score" | "questions">>,
): MissionInterviewRecord {
  return saveMissionInterview({ ...record, ...update, updated_at: nowIso() });
}
