import path from "node:path";
import { SESSION_ATTACHMENTS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getActivePrincipalId } from "./request-security.js";
import { getSession } from "./session-store.js";
import type { CreateSessionAttachmentRequest, SessionAttachmentRecord } from "./types.js";
import { ensureDir, generateSessionAttachmentId, nowIso, writeJsonAtomic } from "./utils.js";

function sessionAttachmentDir(sessionId: string): string {
  return path.join(SESSION_ATTACHMENTS_DIR, sessionId);
}

function sessionAttachmentPath(sessionId: string, attachmentId: string): string {
  return path.join(sessionAttachmentDir(sessionId), `${attachmentId}.json`);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createSessionAttachment(input: {
  sessionId: string;
  request: CreateSessionAttachmentRequest;
  createdAt?: string;
}): SessionAttachmentRecord {
  const storageUri = input.request.storage_uri.trim();
  const name =
    normalizeNullableText(input.request.name) ||
    storageUri.split(/[\\/]/g).filter(Boolean).pop() ||
    "Attached file";
  const record: SessionAttachmentRecord = {
    attachment_id: generateSessionAttachmentId(),
    session_id: input.sessionId,
    name,
    storage_uri: storageUri,
    mime_type: normalizeNullableText(input.request.mime_type),
    size_bytes:
      typeof input.request.size_bytes === "number" && Number.isFinite(input.request.size_bytes) && input.request.size_bytes >= 0
        ? Math.floor(input.request.size_bytes)
        : null,
    kind: normalizeNullableText(input.request.kind) || "context",
    summary: normalizeNullableText(input.request.summary),
    created_by: getActivePrincipalId() || normalizeNullableText(input.request.created_by) || "user",
    created_at: input.createdAt || nowIso(),
    metadata: input.request.metadata || {},
  };
  return saveSessionAttachment(record);
}

export function saveSessionAttachment(record: SessionAttachmentRecord): SessionAttachmentRecord {
  if (!getSession(record.session_id)) throw new Error("SESSION_NOT_FOUND");
  ensureDir(sessionAttachmentDir(record.session_id));
  writeJsonAtomic(sessionAttachmentPath(record.session_id, record.attachment_id), record);
  return record;
}

export function listSessionAttachments(sessionId: string): SessionAttachmentRecord[] {
  if (!getSession(sessionId)) return [];
  const storage = getJsonStorageBackend();
  const dirPath = sessionAttachmentDir(sessionId);
  const files = storage.listJsonFiles(dirPath);

  const items = files.map((filePath) =>
    storage.readJson<SessionAttachmentRecord>(filePath),
  );
  items.sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.attachment_id.localeCompare(b.attachment_id);
    }
    return a.created_at.localeCompare(b.created_at);
  });
  return items;
}

export function deleteSessionAttachment(sessionId: string, attachmentId: string): SessionAttachmentRecord | null {
  const attachment = listSessionAttachments(sessionId).find((item) => item.attachment_id === attachmentId);
  if (!attachment) return null;
  getJsonStorageBackend().removeJson(sessionAttachmentPath(sessionId, attachment.attachment_id));
  return attachment;
}
