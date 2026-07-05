import fs from "node:fs";
import path from "node:path";
import { SESSIONS_DIR } from "./config.js";
import type { CreateSessionRequest, SessionRecord } from "./types.js";
import { ensureDir, generateSessionId, nowIso, writeJsonAtomic } from "./utils.js";

function sessionPath(sessionId: string): string {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

function deriveTitle(input: CreateSessionRequest): string {
  const explicitTitle = typeof input.title === "string" ? input.title.trim() : "";
  if (explicitTitle) {
    return explicitTitle;
  }

  const initialMessage =
    typeof input.initial_message === "string" ? input.initial_message.trim() : "";
  if (!initialMessage) {
    return "New Task";
  }

  const compact = initialMessage.replace(/\s+/g, " ");
  return compact.length > 72 ? `${compact.slice(0, 72).trimEnd()}...` : compact;
}

export function saveSession(session: SessionRecord): SessionRecord {
  ensureDir(SESSIONS_DIR);
  const normalized = normalizeSessionRecord(session);
  writeJsonAtomic(sessionPath(normalized.session_id), normalized);
  return normalized;
}

export function createSession(input: CreateSessionRequest): SessionRecord {
  ensureDir(SESSIONS_DIR);

  const timestamp = nowIso();
  const currentGoal =
    typeof input.initial_message === "string" && input.initial_message.trim()
      ? input.initial_message.trim()
      : null;
  const orchestratorProfileId =
    typeof input.orchestrator_profile_id === "string" && input.orchestrator_profile_id.trim()
      ? input.orchestrator_profile_id.trim()
      : null;

  const session: SessionRecord = {
    session_id: generateSessionId(),
    title: deriveTitle(input),
    status: "draft",
    created_by:
      typeof input.created_by === "string" && input.created_by.trim()
        ? input.created_by.trim()
        : "demo-user",
    created_at: timestamp,
    updated_at: timestamp,
    current_goal: currentGoal,
    current_plan_summary: null,
    latest_run_id: null,
    active_run_ids: [],
    last_orchestrator_message_id: null,
    confirmed_plan_revision: null,
    confirmed_plan_option: null,
    confirmed_proposal_id: null,
    archived: false,
    archived_at: null,
    archived_by: null,
    hidden: false,
    hidden_at: null,
    hidden_by: null,
    metadata: {
      working_goal: currentGoal,
      constraints_summary: null,
      open_questions: [],
      pending_decision: currentGoal
        ? "Clarify constraints or ask the orchestrator to draft the workflow."
        : "Describe the task so the orchestrator can frame the objective.",
      latest_orchestrator_intent: currentGoal ? "capture_goal" : "idle",
      orchestrator_profile_id: orchestratorProfileId,
      workspace_state: null,
    },
  };

  return saveSession(session);
}

function normalizeSessionRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    archived: record.archived === true,
    archived_at: typeof record.archived_at === "string" ? record.archived_at : null,
    archived_by: typeof record.archived_by === "string" ? record.archived_by : null,
    hidden: record.hidden === true,
    hidden_at: typeof record.hidden_at === "string" ? record.hidden_at : null,
    hidden_by: typeof record.hidden_by === "string" ? record.hidden_by : null,
    confirmed_proposal_id:
      typeof record.confirmed_proposal_id === "string" && record.confirmed_proposal_id.trim()
        ? record.confirmed_proposal_id.trim()
        : null,
    metadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata
        : {},
  };
}

export function listSessions(): SessionRecord[] {
  ensureDir(SESSIONS_DIR);
  const files = fs
    .readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(SESSIONS_DIR, entry.name));

  const sessions = files.map((filePath) =>
    normalizeSessionRecord(JSON.parse(fs.readFileSync(filePath, "utf-8")) as SessionRecord),
  );

  sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return sessions;
}

export function getSession(sessionId: string): SessionRecord | null {
  const filePath = sessionPath(sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return normalizeSessionRecord(JSON.parse(fs.readFileSync(filePath, "utf-8")) as SessionRecord);
}

export function archiveSession(
  sessionId: string,
  actorId = "user",
  reason: string | null = null,
): SessionRecord | null {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }
  const timestamp = nowIso();
  session.archived = true;
  session.archived_at = timestamp;
  session.archived_by = actorId;
  session.hidden = false;
  session.hidden_at = null;
  session.hidden_by = null;
  session.updated_at = timestamp;
  session.metadata = {
    ...session.metadata,
    archived_reason: reason,
    session_visibility: "archived",
  };
  return saveSession(session);
}

export function unarchiveSession(sessionId: string, actorId = "user"): SessionRecord | null {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }
  const timestamp = nowIso();
  session.archived = false;
  session.archived_at = null;
  session.archived_by = null;
  session.updated_at = timestamp;
  session.metadata = {
    ...session.metadata,
    unarchived_at: timestamp,
    unarchived_by: actorId,
    session_visibility: session.hidden ? "hidden" : "active",
  };
  return saveSession(session);
}

export function hideSession(sessionId: string, actorId = "user"): SessionRecord | null {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }
  const timestamp = nowIso();
  session.hidden = true;
  session.hidden_at = timestamp;
  session.hidden_by = actorId;
  session.archived = false;
  session.archived_at = null;
  session.archived_by = null;
  session.updated_at = timestamp;
  session.metadata = {
    ...session.metadata,
    hidden_reason: "Hidden from default mission/session lists.",
    session_visibility: "hidden",
  };
  return saveSession(session);
}

export function unhideSession(sessionId: string, actorId = "user"): SessionRecord | null {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }
  const timestamp = nowIso();
  session.hidden = false;
  session.hidden_at = null;
  session.hidden_by = null;
  session.updated_at = timestamp;
  session.metadata = {
    ...session.metadata,
    unhidden_at: timestamp,
    unhidden_by: actorId,
    session_visibility: session.archived ? "archived" : "active",
  };
  return saveSession(session);
}
