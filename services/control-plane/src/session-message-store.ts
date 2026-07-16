import path from "node:path";
import { SESSION_MESSAGES_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getSession } from "./session-store.js";
import { appendSessionRecallJournal } from "./session-recall-store.js";
import type {
  SessionMessageKind,
  SessionMessageRecord,
  SessionMessageRole,
} from "./types.js";
import {
  ensureDir,
  generateSessionMessageId,
  nowIso,
  writeJsonAtomic,
} from "./utils.js";

function sessionMessageDir(sessionId: string): string {
  return path.join(SESSION_MESSAGES_DIR, sessionId);
}

function sessionMessagePath(sessionId: string, messageId: string): string {
  return path.join(sessionMessageDir(sessionId), `${messageId}.json`);
}

export function saveSessionMessage(message: SessionMessageRecord): SessionMessageRecord {
  const session = getSession(message.session_id);
  if (!session) throw new Error("SESSION_NOT_FOUND");
  ensureDir(sessionMessageDir(message.session_id));
  writeJsonAtomic(sessionMessagePath(message.session_id, message.message_id), message);
  try {
    appendSessionRecallJournal(session, message);
  } catch {
    // Recall is a rebuildable derived index and must not invalidate canonical message writes.
  }
  return message;
}

export function createSessionMessage(input: {
  session_id: string;
  role: SessionMessageRole;
  kind: SessionMessageKind;
  content: Record<string, unknown>;
  created_at?: string;
  linked_run_id?: string | null;
  linked_node_run_id?: string | null;
}): SessionMessageRecord {
  const message: SessionMessageRecord = {
    message_id: generateSessionMessageId(),
    session_id: input.session_id,
    role: input.role,
    kind: input.kind,
    content: input.content,
    created_at: input.created_at || nowIso(),
    linked_run_id: input.linked_run_id ?? null,
    linked_node_run_id: input.linked_node_run_id ?? null,
  };

  return saveSessionMessage(message);
}

export function listSessionMessages(sessionId: string): SessionMessageRecord[] {
  if (!getSession(sessionId)) return [];
  const dirPath = sessionMessageDir(sessionId);
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(dirPath);

  const messages = files.map((filePath) =>
    storage.readJson<SessionMessageRecord>(filePath),
  );

  messages.sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.message_id.localeCompare(b.message_id);
    }
    return a.created_at.localeCompare(b.created_at);
  });
  return messages;
}
