import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getLocalProject, resolveProjectOutputRoot } from "./local-project-store.js";
import { getRunRoute } from "./run-route-store.js";
import { getTaskWorkspace } from "./task-workspace-store.js";
import type { ArtifactRecord, SessionAttachmentRecord } from "./types.js";
import { runWorkspaceHostPath } from "./runtime/run-workspace.js";
import { listWorkerLeaseRecords } from "./runtime/worker-lease-store.js";

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeFileName(value: string): string {
  const leaf = path.basename(value.trim().replaceAll("\\", "/"));
  if (!leaf || leaf === "." || leaf === ".." || leaf.includes("\0")) {
    throw new Error("ARTIFACT_FILE_NAME_INVALID");
  }
  return leaf;
}

function ensureSafeOutputRoot(projectRoot: string, outputRoot: string): string {
  const relative = path.relative(projectRoot, outputRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("ARTIFACT_OUTPUT_ESCAPES_PROJECT");
  let cursor = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error("ARTIFACT_OUTPUT_SYMLINK_BLOCKED");
    }
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  const realProject = fs.realpathSync(projectRoot);
  const realOutput = fs.realpathSync(outputRoot);
  if (!isInside(realProject, realOutput)) throw new Error("ARTIFACT_OUTPUT_ESCAPES_PROJECT");
  return realOutput;
}

function targetForFile(outputRoot: string, fileName: string, overwrite: boolean): string {
  const leaf = safeFileName(fileName);
  const direct = path.join(outputRoot, leaf);
  if (overwrite || !fs.existsSync(direct)) return direct;
  const extension = path.extname(leaf);
  const stem = path.basename(leaf, extension);
  for (let index = 2; index <= 999; index += 1) {
    const candidate = path.join(outputRoot, `${stem}-${index}${extension}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("ARTIFACT_OUTPUT_NAME_EXHAUSTED");
}

function atomicWrite(target: string, content: Buffer): void {
  const temporary = `${target}.my-mate-${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    if (!fs.existsSync(target)) throw error;
    fs.copyFileSync(temporary, target);
    fs.rmSync(temporary, { force: true });
  }
}

export function publishTaskArtifact(input: {
  sessionId: string;
  fileName: string;
  content: Buffer;
  overwrite?: boolean;
}): { published_relative_path: string; absolute_path: string } | null {
  const taskWorkspace = getTaskWorkspace(input.sessionId);
  if (!taskWorkspace || taskWorkspace.status !== "active") return null;
  const project = getLocalProject(taskWorkspace.project_id);
  if (!project || project.status !== "active") return null;
  const outputRoot = ensureSafeOutputRoot(
    project.root_path,
    resolveProjectOutputRoot(project, taskWorkspace.output_relative_path),
  );
  const target = targetForFile(outputRoot, input.fileName, input.overwrite !== false);
  atomicWrite(target, input.content);
  return {
    published_relative_path: path.relative(project.root_path, target).split(path.sep).join("/"),
    absolute_path: target,
  };
}

function runtimeArtifactRelativePath(storageUri: string): string | null {
  if (!storageUri.startsWith("workspace://")) return null;
  const relativePath = storageUri.slice("workspace://".length).replaceAll("\\", "/");
  const segments = relativePath.split("/").filter(Boolean);
  if (!segments.length || relativePath.startsWith("/") || /^[A-Za-z]:\//u.test(relativePath) || segments.some((item) => item === "." || item === "..")) {
    return null;
  }
  return segments.join("/");
}

export function resolveRuntimeArtifactSource(runId: string, artifact: ArtifactRecord): string | null {
  const relativePath = runtimeArtifactRelativePath(artifact.storage_uri);
  if (!relativePath) return null;
  const leaseRoots = listWorkerLeaseRecords(runId)
    .filter((lease) => !artifact.node_run_id || lease.node_run_id === artifact.node_run_id)
    .map((lease) => lease.metadata?.workspace_host_path)
    .filter((value): value is string => typeof value === "string" && !!value.trim());
  for (const rootValue of [...new Set([...leaseRoots, runWorkspaceHostPath(runId)])]) {
    const root = path.resolve(rootValue);
    if (!fs.existsSync(root)) continue;
    const candidate = path.resolve(root, ...relativePath.split("/"));
    if (!isInside(root, candidate)) continue;
    try {
      const realRoot = fs.realpathSync(root);
      const realCandidate = fs.realpathSync(candidate);
      if (isInside(realRoot, realCandidate) && fs.statSync(realCandidate).isFile()) return realCandidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function publishRuntimeArtifact(runId: string, artifact: ArtifactRecord): ArtifactRecord {
  const sessionId = getRunRoute(runId)?.session_id;
  if (!sessionId) return { ...artifact, publication_status: "unpublished", published_relative_path: null };
  const source = resolveRuntimeArtifactSource(runId, artifact);
  if (!source) {
    return { ...artifact, publication_status: "failed", published_relative_path: null, publication_error: "ARTIFACT_SOURCE_UNAVAILABLE" };
  }
  try {
    const published = publishTaskArtifact({
      sessionId,
      fileName: artifact.name,
      content: fs.readFileSync(source),
      overwrite: false,
    });
    return published
      ? { ...artifact, publication_status: "published", published_relative_path: published.published_relative_path, publication_error: null }
      : { ...artifact, publication_status: "unpublished", published_relative_path: null, publication_error: null };
  } catch (error) {
    return {
      ...artifact,
      publication_status: "failed",
      published_relative_path: null,
      publication_error: error instanceof Error ? error.message : "ARTIFACT_PUBLICATION_FAILED",
    };
  }
}

export function resolvePublishedArtifactPath(input: {
  sessionId: string;
  publishedRelativePath: unknown;
}): string | null {
  if (typeof input.publishedRelativePath !== "string" || !input.publishedRelativePath.trim()) return null;
  const taskWorkspace = getTaskWorkspace(input.sessionId);
  if (!taskWorkspace) return null;
  const project = getLocalProject(taskWorkspace.project_id);
  if (!project) return null;
  const candidate = path.resolve(project.root_path, ...input.publishedRelativePath.replaceAll("\\", "/").split("/"));
  if (!isInside(project.root_path, candidate)) return null;
  try {
    const realProject = fs.realpathSync(project.root_path);
    const realCandidate = fs.realpathSync(candidate);
    return isInside(realProject, realCandidate) && fs.statSync(realCandidate).isFile() ? realCandidate : null;
  } catch {
    return null;
  }
}

export function resolvePublishedSessionArtifactPath(sessionId: string, artifact: SessionAttachmentRecord): string | null {
  return resolvePublishedArtifactPath({
    sessionId,
    publishedRelativePath: artifact.metadata?.published_relative_path,
  });
}

export function resolvePublishedRuntimeArtifactPath(runId: string, artifact: ArtifactRecord): string | null {
  const sessionId = getRunRoute(runId)?.session_id;
  return sessionId
    ? resolvePublishedArtifactPath({ sessionId, publishedRelativePath: artifact.published_relative_path })
    : null;
}
