import path from "node:path";
import { SESSIONS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import { ensureCoreMemorySnapshot } from "./memory-snapshot-store.js";
import { resolveSessionAgentBinding } from "./agent-runtime-store.js";
import type { CreateSessionRequest, SessionRecord } from "./types.js";
import { ensureDir, generateSessionId, nowIso, writeJsonAtomic } from "./utils.js";
import {
  SESSION_LIFECYCLE,
  assertLifecycleTransition,
  parseLifecycleStatus,
} from "@my-mate/shared-types/domain-lifecycle";
import { assertSchemaValid, validateSession } from "./validators.js";

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
  const activeWorkspaceId = getActiveWorkspaceId();
  if (activeWorkspaceId && normalized.workspace_id !== activeWorkspaceId) {
    throw new Error("WORKSPACE_SCOPE_MISMATCH");
  }
  const storage = getJsonStorageBackend();
  const target = sessionPath(normalized.session_id);
  if (storage.exists(target)) {
    const previous = normalizeSessionRecord(storage.readJson<SessionRecord>(target));
    assertLifecycleTransition(SESSION_LIFECYCLE, previous.status, normalized.status);
  }
  assertSchemaValid(validateSession, normalized, "Session");
  writeJsonAtomic(target, normalized);
  return normalized;
}

export function createSession(input: CreateSessionRequest): SessionRecord {
  ensureDir(SESSIONS_DIR);

  const timestamp = nowIso();
  const currentGoal =
    typeof input.initial_message === "string" && input.initial_message.trim()
      ? input.initial_message.trim()
      : null;
  const providerConnectionId =
    typeof input.provider_connection_id === "string" && input.provider_connection_id.trim()
      ? input.provider_connection_id.trim()
      : null;
  const conversationModel =
    typeof input.model === "string" && input.model.trim()
      ? input.model.trim()
      : null;

  const session: SessionRecord = {
    session_id: generateSessionId(),
    workspace_id: getActiveWorkspaceId() || "default",
    title: deriveTitle(input),
    status: "draft",
    created_by: getActivePrincipalId() ||
      (typeof input.created_by === "string" && input.created_by.trim()
        ? input.created_by.trim()
        : "demo-user"),
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
      conversation_provider_connection_id: providerConnectionId,
      conversation_model: conversationModel,
      agent_id: typeof input.agent_id === "string" && input.agent_id.trim() ? input.agent_id.trim() : "default-agent",
      agent_version: typeof input.agent_version === "number" && Number.isInteger(input.agent_version) ? input.agent_version : null,
      agent_binding_mode: input.agent_binding_mode === "follow_latest" ? "follow_latest" : "pinned",
      autonomy_mode:
        input.autonomy_mode === "review_first" || input.autonomy_mode === "autopilot"
          ? input.autonomy_mode
          : "assisted",
      workspace_state: null,
    },
  };

  // Bind a complete Agent snapshot at session creation when a usable provider exists.
  // Draft sessions without a configured provider remain valid and are bound lazily on first execution.
  try {
    const binding = resolveSessionAgentBinding(session);
    session.metadata = { ...session.metadata, agent_binding_snapshot: binding };
  } catch {
    // Provider setup may be completed after creating a draft Session.
  }

  const saved = saveSession(session);
  ensureCoreMemorySnapshot(saved);
  return saved;
}

function normalizeSessionRecord(record: SessionRecord): SessionRecord {
  const sourceMetadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? record.metadata
    : {};
  const legacyMetadata = sourceMetadata as Record<string, unknown>;
  const {
    orchestrator_profile_id: legacyOrchestratorProfileId,
    agent_profile_id: legacyAgentProfileId,
    ...canonicalMetadata
  } = legacyMetadata;
  const agentId = typeof canonicalMetadata.agent_id === "string" && canonicalMetadata.agent_id.trim()
    ? canonicalMetadata.agent_id.trim()
    : typeof legacyOrchestratorProfileId === "string" && legacyOrchestratorProfileId.trim()
      ? legacyOrchestratorProfileId.trim()
      : typeof legacyAgentProfileId === "string" && legacyAgentProfileId.trim()
        ? legacyAgentProfileId.trim()
        : "default-agent";
  const normalized = {
    ...record,
    status: parseLifecycleStatus(SESSION_LIFECYCLE, record.status),
    workspace_id:
      typeof record.workspace_id === "string" && record.workspace_id.trim()
        ? record.workspace_id.trim()
        : "default",
    archived: record.archived === true,
    archived_at: typeof record.archived_at === "string" ? record.archived_at : null,
    archived_by: typeof record.archived_by === "string" ? record.archived_by : null,
    hidden: record.hidden === true || record.metadata?.hidden_from_task_list === true,
    hidden_at: typeof record.hidden_at === "string"
      ? record.hidden_at
      : record.metadata?.hidden_from_task_list === true
        ? record.updated_at
        : null,
    hidden_by: typeof record.hidden_by === "string"
      ? record.hidden_by
      : record.metadata?.hidden_from_task_list === true
        ? "session-compatibility-projection"
        : null,
    confirmed_proposal_id:
      typeof record.confirmed_proposal_id === "string" && record.confirmed_proposal_id.trim()
        ? record.confirmed_proposal_id.trim()
        : null,
    metadata: { ...canonicalMetadata, agent_id: agentId },
  };
  assertSchemaValid(validateSession, normalized, "Session");
  return normalized;
}

export function listSessions(): SessionRecord[] {
  ensureDir(SESSIONS_DIR);
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(SESSIONS_DIR);

  const activeWorkspaceId = getActiveWorkspaceId();
  const sessions = files.map((filePath) =>
    normalizeSessionRecord(storage.readJson<SessionRecord>(filePath)),
  ).filter((session) => !activeWorkspaceId || session.workspace_id === activeWorkspaceId);

  sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return sessions;
}

export function getSession(sessionId: string): SessionRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = sessionPath(sessionId);
  if (!storage.exists(filePath)) {
    return null;
  }
  const session = normalizeSessionRecord(storage.readJson<SessionRecord>(filePath));
  const activeWorkspaceId = getActiveWorkspaceId();
  return activeWorkspaceId && session.workspace_id !== activeWorkspaceId ? null : session;
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
