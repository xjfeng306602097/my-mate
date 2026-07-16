import { createHash } from "node:crypto";
import path from "node:path";
import { CONVERSATION_ACTIONS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  ConversationActionRecord,
  ConversationActionRiskLevel,
} from "./types.js";
import type { CapabilityExecutor } from "./capability-registry.js";
import {
  ensureDir,
  generateConversationActionId,
  nowIso,
  writeJsonAtomic,
} from "./utils.js";

function sessionDir(sessionId: string): string {
  return path.join(CONVERSATION_ACTIONS_DIR, encodeURIComponent(sessionId));
}

function actionPath(sessionId: string, actionId: string): string {
  return path.join(sessionDir(sessionId), `${encodeURIComponent(actionId)}.json`);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function conversationActionArgumentsDigest(args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(stableValue(args))).digest("hex");
}

export function saveConversationAction(action: ConversationActionRecord): ConversationActionRecord {
  ensureDir(sessionDir(action.session_id));
  writeJsonAtomic(actionPath(action.session_id, action.action_id), action);
  return action;
}

export function getConversationAction(sessionId: string, actionId: string): ConversationActionRecord | null {
  const storage = getJsonStorageBackend();
  const file = actionPath(sessionId, actionId);
  return storage.exists(file) ? storage.readJson<ConversationActionRecord>(file) : null;
}

export function createConversationAction(input: {
  workspaceId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  riskLevel: ConversationActionRiskLevel;
  executor?: Exclude<CapabilityExecutor, "worker"> | "runtime-worker";
}): ConversationActionRecord {
  const timestamp = nowIso();
  return saveConversationAction({
    action_id: generateConversationActionId(),
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    tool_call_id: input.toolCallId,
    tool_name: input.toolName,
    arguments: input.arguments,
    arguments_digest: conversationActionArgumentsDigest(input.arguments),
    risk_level: input.riskLevel,
    executor: input.executor || "control-plane",
    status: "running",
    approval_id: null,
    result: null,
    error_code: null,
    created_at: timestamp,
    started_at: timestamp,
    completed_at: null,
    updated_at: timestamp,
  });
}

export function completeConversationAction(input: {
  action: ConversationActionRecord;
  result: Record<string, unknown>;
  errorCode?: string | null;
}): ConversationActionRecord {
  const timestamp = nowIso();
  return saveConversationAction({
    ...input.action,
    status: input.errorCode ? "failed" : "succeeded",
    result: input.result,
    error_code: input.errorCode || null,
    completed_at: timestamp,
    updated_at: timestamp,
  });
}

export function markConversationActionPendingApproval(
  action: ConversationActionRecord,
): ConversationActionRecord {
  return saveConversationAction({
    ...action,
    status: "pending_approval",
    updated_at: nowIso(),
  });
}

export function markConversationActionApproved(
  action: ConversationActionRecord,
): ConversationActionRecord {
  return saveConversationAction({
    ...action,
    status: "running",
    result: { approved: true, desktop_attested: true },
    updated_at: nowIso(),
  });
}

export function listConversationActions(sessionId: string): ConversationActionRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(sessionDir(sessionId))
    .map((file) => storage.readJson<ConversationActionRecord>(file))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}
