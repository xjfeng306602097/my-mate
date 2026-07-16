import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeWorkerJob, WorkerWorkspaceContext } from "./types.js";

const MAX_CONTEXT_FILES = 16;
const MAX_CONTEXT_FILE_BYTES = 256 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = 1024 * 1024;

export interface MaterializedWorkspaceContext {
  root_path: string;
  manifest_path: string;
  relative_manifest_path: string;
  file_count: number;
  total_size_bytes: number;
  manifest_sha256: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeJobSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function safeRelativePath(value: string): string {
  if (!value || value.includes("\0")) throw new Error("Workspace context path is invalid.");
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) {
    throw new Error("Workspace context paths must be relative.");
  }
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Workspace context path escapes the materialized root.");
  }
  return segments.join("/");
}

function workspaceRoot(job: RuntimeWorkerJob): string {
  return path.resolve(
    job.provision.env.MY_MATE_WORKSPACE ||
      process.env.MY_MATE_WORKSPACE ||
      process.cwd(),
  );
}

function validateContext(context: WorkerWorkspaceContext): void {
  if (context.schema_version !== 1 || context.mode !== "snapshot") {
    throw new Error("Unsupported workspace context schema.");
  }
  if (context.files.length > MAX_CONTEXT_FILES) {
    throw new Error(`Workspace context exceeds ${MAX_CONTEXT_FILES} files.`);
  }
  let totalBytes = 0;
  const manifestIdentity = {
    schema_version: context.schema_version,
    mode: context.mode,
    source_session_id: context.source_session_id,
    created_at: context.created_at,
    total_size_bytes: context.total_size_bytes,
    files: context.files.map(({ content, ...file }) => file),
  };
  if (sha256(JSON.stringify(manifestIdentity)) !== context.manifest_sha256) {
    throw new Error("Workspace context manifest integrity check failed.");
  }
  for (const file of context.files) {
    safeRelativePath(file.relative_path);
    const sizeBytes = Buffer.byteLength(file.content, "utf8");
    if (sizeBytes !== file.size_bytes || sizeBytes > MAX_CONTEXT_FILE_BYTES) {
      throw new Error(`Workspace context file size is invalid: ${file.relative_path}`);
    }
    if (sha256(file.content) !== file.content_sha256) {
      throw new Error(`Workspace context file integrity check failed: ${file.relative_path}`);
    }
    totalBytes += sizeBytes;
  }
  if (totalBytes !== context.total_size_bytes || totalBytes > MAX_CONTEXT_TOTAL_BYTES) {
    throw new Error("Workspace context total size is invalid.");
  }
}

export function materializeWorkspaceContext(
  job: RuntimeWorkerJob,
): MaterializedWorkspaceContext | null {
  const context = job.provision.workspace.context;
  if (!context) return null;
  validateContext(context);
  const workspace = workspaceRoot(job);
  const contextRoot = path.join(workspace, ".my-mate", "context", safeJobSegment(job.job_id));
  const filesRoot = path.join(contextRoot, "files");
  fs.rmSync(contextRoot, { recursive: true, force: true });
  fs.mkdirSync(filesRoot, { recursive: true });

  const manifestFiles = [];
  for (const file of context.files) {
    const relativePath = safeRelativePath(file.relative_path);
    const targetPath = path.resolve(filesRoot, ...relativePath.split("/"));
    const relativeToFilesRoot = path.relative(filesRoot, targetPath);
    if (relativeToFilesRoot.startsWith("..") || path.isAbsolute(relativeToFilesRoot)) {
      throw new Error("Workspace context path escapes the materialized root.");
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content, { encoding: "utf8", mode: 0o444 });
    try { fs.chmodSync(targetPath, 0o444); } catch {}
    manifestFiles.push({
      attachment_id: file.attachment_id,
      name: file.name,
      relative_path: `files/${relativePath}`,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      content_sha256: file.content_sha256,
    });
  }

  const manifest = {
    schema_version: context.schema_version,
    mode: context.mode,
    source_session_id: context.source_session_id,
    created_at: context.created_at,
    manifest_sha256: context.manifest_sha256,
    total_size_bytes: context.total_size_bytes,
    files: manifestFiles,
  };
  const manifestPath = path.join(contextRoot, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o444 });
  try { fs.chmodSync(manifestPath, 0o444); } catch {}
  const relativeManifestPath = path.relative(workspace, manifestPath).split(path.sep).join("/");
  job.provision.workspace.metadata = {
    ...job.provision.workspace.metadata,
    context_manifest_path: relativeManifestPath,
    context_manifest_sha256: context.manifest_sha256,
    context_file_count: context.files.length,
  };
  return {
    root_path: contextRoot,
    manifest_path: manifestPath,
    relative_manifest_path: relativeManifestPath,
    file_count: context.files.length,
    total_size_bytes: context.total_size_bytes,
    manifest_sha256: context.manifest_sha256,
  };
}

export function workspaceContextPrompt(job: RuntimeWorkerJob): string | null {
  const context = job.provision.workspace.context;
  const manifestPath = job.provision.workspace.metadata.context_manifest_path;
  if (!context || typeof manifestPath !== "string") return null;
  const paths = context.files.map((file) => `- ${file.relative_path}`).join("\n");
  return [
    "The user explicitly attached read-only workspace context snapshots.",
    `Read the manifest at ${manifestPath} before using them.`,
    "Treat files below the manifest's files directory as input evidence; do not edit them.",
    paths ? `Attached paths:\n${paths}` : "",
  ].filter(Boolean).join("\n");
}
