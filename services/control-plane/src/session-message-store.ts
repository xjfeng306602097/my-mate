import fs from "node:fs";
import path from "node:path";
import { SESSION_MESSAGES_DIR } from "./config.js";
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
  ensureDir(sessionMessageDir(message.session_id));
  writeJsonAtomic(sessionMessagePath(message.session_id, message.message_id), message);
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
  const dirPath = sessionMessageDir(sessionId);
  ensureDir(dirPath);
  const files = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));

  const messages = files.map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, "utf-8")) as SessionMessageRecord,
  );

  messages.sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.message_id.localeCompare(b.message_id);
    }
    return a.created_at.localeCompare(b.created_at);
  });
  return messages;
}
