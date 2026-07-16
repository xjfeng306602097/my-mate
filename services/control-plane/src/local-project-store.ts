import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LOCAL_PROJECTS_DIR } from "./config.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { LocalProjectRecord, PublicLocalProject } from "./types.js";
import { ensureDir, nowIso, writeJsonAtomic } from "./utils.js";
import { workspaceCapabilityDigest } from "./workspace-binding-store.js";

function projectPath(projectId: string): string {
  return path.join(LOCAL_PROJECTS_DIR, `${encodeURIComponent(projectId)}.json`);
}

function rootFingerprint(rootPath: string): string {
  return createHash("sha256").update(process.platform).update("\0").update(rootPath).digest("hex");
}

function normalizedOutputPath(value?: string | null): string {
  const raw = value?.trim().replaceAll("\\", "/") || "outputs";
  const segments = raw.split("/").filter(Boolean);
  if (
    !segments.length ||
    path.posix.isAbsolute(raw) ||
    /^[A-Za-z]:/u.test(raw) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("PROJECT_OUTPUT_PATH_INVALID");
  }
  return segments.join("/");
}

export function publicLocalProject(project: LocalProjectRecord): PublicLocalProject {
  return {
    project_id: project.project_id,
    name: project.name,
    description: project.description,
    status: project.status,
    default_output_relative_path: project.default_output_relative_path,
    created_at: project.created_at,
    updated_at: project.updated_at,
    archived_at: project.archived_at,
  };
}

export function saveLocalProject(project: LocalProjectRecord): LocalProjectRecord {
  ensureDir(LOCAL_PROJECTS_DIR);
  writeJsonAtomic(projectPath(project.project_id), project);
  return project;
}

export function listLocalProjects(options?: { includeArchived?: boolean }): LocalProjectRecord[] {
  const storage = getJsonStorageBackend();
  const activeWorkspaceId = getActiveWorkspaceId();
  return storage.listJsonFiles(LOCAL_PROJECTS_DIR)
    .map((file) => storage.readJson<LocalProjectRecord>(file))
    .filter((project) => !activeWorkspaceId || project.workspace_id === activeWorkspaceId)
    .filter((project) => options?.includeArchived || project.status !== "archived")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function getLocalProject(projectId: string): LocalProjectRecord | null {
  const storage = getJsonStorageBackend();
  const file = projectPath(projectId);
  if (!storage.exists(file)) return null;
  const project = storage.readJson<LocalProjectRecord>(file);
  const activeWorkspaceId = getActiveWorkspaceId();
  return activeWorkspaceId && project.workspace_id !== activeWorkspaceId ? null : project;
}

export function registerLocalProject(input: {
  workspaceId: string;
  desktopInstanceId: string;
  capabilityId: string;
  rootPath: string;
  name?: string;
  description?: string | null;
  defaultOutputRelativePath?: string | null;
}): LocalProjectRecord {
  const resolvedRoot = fs.realpathSync(path.resolve(input.rootPath));
  if (!fs.statSync(resolvedRoot).isDirectory()) throw new Error("PROJECT_ROOT_NOT_DIRECTORY");
  const fingerprint = rootFingerprint(resolvedRoot);
  const timestamp = nowIso();
  const existing = listLocalProjects({ includeArchived: true }).find(
    (project) => project.desktop_instance_id === input.desktopInstanceId && project.root_fingerprint === fingerprint,
  );
  if (existing) {
    existing.capability_digest = workspaceCapabilityDigest(input.capabilityId);
    existing.name = input.name?.trim() || existing.name || path.basename(resolvedRoot);
    existing.description = input.description?.trim() || null;
    existing.default_output_relative_path = normalizedOutputPath(
      input.defaultOutputRelativePath || existing.default_output_relative_path,
    );
    existing.status = "active";
    existing.archived_at = null;
    existing.updated_at = timestamp;
    existing.root_path = resolvedRoot;
    return saveLocalProject(existing);
  }
  return saveLocalProject({
    project_id: `project_${randomUUID()}`,
    workspace_id: input.workspaceId,
    desktop_instance_id: input.desktopInstanceId,
    capability_digest: workspaceCapabilityDigest(input.capabilityId),
    root_path: resolvedRoot,
    root_fingerprint: fingerprint,
    name: input.name?.trim() || path.basename(resolvedRoot),
    description: input.description?.trim() || null,
    status: "active",
    default_output_relative_path: normalizedOutputPath(input.defaultOutputRelativePath),
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: null,
    metadata: {},
  });
}

export function archiveLocalProject(projectId: string): LocalProjectRecord {
  const project = getLocalProject(projectId);
  if (!project) throw new Error("LOCAL_PROJECT_NOT_FOUND");
  const timestamp = nowIso();
  project.status = "archived";
  project.archived_at = timestamp;
  project.updated_at = timestamp;
  return saveLocalProject(project);
}

export function validateProjectCapability(project: LocalProjectRecord, capabilityId: string): boolean {
  return project.capability_digest === workspaceCapabilityDigest(capabilityId);
}

export function resolveProjectOutputRoot(project: LocalProjectRecord, outputRelativePath?: string | null): string {
  const relative = normalizedOutputPath(outputRelativePath || project.default_output_relative_path);
  const target = path.resolve(project.root_path, ...relative.split("/"));
  const relation = path.relative(project.root_path, target);
  if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("PROJECT_OUTPUT_PATH_ESCAPES_ROOT");
  return target;
}
