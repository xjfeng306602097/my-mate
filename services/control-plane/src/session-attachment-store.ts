import fs from "node:fs";
import path from "node:path";
import { SESSION_ATTACHMENTS_DIR } from "./config.js";
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
    created_by: normalizeNullableText(input.request.created_by) || "user",
    created_at: input.createdAt || nowIso(),
    metadata: input.request.metadata || {},
  };
  return saveSessionAttachment(record);
}

export function saveSessionAttachment(record: SessionAttachmentRecord): SessionAttachmentRecord {
  ensureDir(sessionAttachmentDir(record.session_id));
  writeJsonAtomic(sessionAttachmentPath(record.session_id, record.attachment_id), record);
  return record;
}

export function listSessionAttachments(sessionId: string): SessionAttachmentRecord[] {
  const dirPath = sessionAttachmentDir(sessionId);
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const files = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));

  const items = files.map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, "utf-8")) as SessionAttachmentRecord,
  );
  items.sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.attachment_id.localeCompare(b.attachment_id);
    }
    return a.created_at.localeCompare(b.created_at);
  });
  return items;
}
