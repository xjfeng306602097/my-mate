import { createHash } from "node:crypto";
import path from "node:path";
import { getRunRoute } from "../run-route-store.js";
import { listSessionAttachments } from "../session-attachment-store.js";
import type { SessionAttachmentRecord } from "../types.js";
import type { WorkerWorkspaceContext, WorkerWorkspaceContextFile } from "../runtime-protocol.js";

export const MAX_RUNTIME_CONTEXT_FILES = 16;
export const MAX_RUNTIME_CONTEXT_FILE_BYTES = 256 * 1024;
export const MAX_RUNTIME_CONTEXT_TOTAL_BYTES = 1024 * 1024;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) return null;
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) return null;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function contextFileFromAttachment(
  attachment: SessionAttachmentRecord,
): WorkerWorkspaceContextFile | null {
  const metadata = attachment.metadata || {};
  const content = typeof metadata.desktop_text_content === "string"
    ? metadata.desktop_text_content
    : typeof metadata.uploaded_text_content === "string"
      ? metadata.uploaded_text_content
      : typeof metadata.generated_text_content === "string"
        ? metadata.generated_text_content
        : null;
  if (content === null) return null;
  const relativePath = metadata.relative_path === undefined || metadata.relative_path === null
    ? safeRelativePath(attachment.name)
    : safeRelativePath(metadata.relative_path);
  if (!relativePath) return null;
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > MAX_RUNTIME_CONTEXT_FILE_BYTES) return null;
  return {
    attachment_id: attachment.attachment_id,
    name: path.posix.basename(relativePath) || attachment.name,
    relative_path: relativePath,
    mime_type: attachment.mime_type,
    size_bytes: sizeBytes,
    content_sha256: sha256(content),
    content,
  };
}

export function buildWorkspaceContextSnapshot(input: {
  sessionId: string;
  attachments: SessionAttachmentRecord[];
  createdAt?: string;
}): WorkerWorkspaceContext | null {
  const files: WorkerWorkspaceContextFile[] = [];
  const usedPaths = new Set<string>();
  let totalSizeBytes = 0;
  for (const attachment of input.attachments.slice().reverse()) {
    if (files.length >= MAX_RUNTIME_CONTEXT_FILES) break;
    const file = contextFileFromAttachment(attachment);
    if (!file || usedPaths.has(file.relative_path)) continue;
    if (totalSizeBytes + file.size_bytes > MAX_RUNTIME_CONTEXT_TOTAL_BYTES) continue;
    usedPaths.add(file.relative_path);
    files.push(file);
    totalSizeBytes += file.size_bytes;
  }
  files.reverse();
  if (!files.length) return null;
  const createdAt = input.createdAt || new Date().toISOString();
  const manifestIdentity = {
    schema_version: 1,
    mode: "snapshot",
    source_session_id: input.sessionId,
    created_at: createdAt,
    total_size_bytes: totalSizeBytes,
    files: files.map(({ content, ...file }) => file),
  };
  return {
    ...manifestIdentity,
    schema_version: 1,
    mode: "snapshot",
    manifest_sha256: sha256(JSON.stringify(manifestIdentity)),
    files,
  };
}

export function getWorkspaceContextSnapshotForRun(
  runId: string,
  createdAt?: string,
): WorkerWorkspaceContext | null {
  const sessionId = getRunRoute(runId)?.session_id;
  if (!sessionId) return null;
  return buildWorkspaceContextSnapshot({
    sessionId,
    attachments: listSessionAttachments(sessionId),
    createdAt,
  });
}
