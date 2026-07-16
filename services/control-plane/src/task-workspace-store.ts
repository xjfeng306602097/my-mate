import { randomUUID } from "node:crypto";
import path from "node:path";
import { TASK_WORKSPACES_DIR } from "./config.js";
import { getLocalProject, publicLocalProject } from "./local-project-store.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { extendCoreMemorySnapshotForProject } from "./memory-snapshot-store.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { PublicTaskWorkspace, TaskWorkspaceRecord } from "./types.js";
import { ensureDir, nowIso, writeJsonAtomic } from "./utils.js";

function recordPath(sessionId: string): string {
  return path.join(TASK_WORKSPACES_DIR, `${encodeURIComponent(sessionId)}.json`);
}

function normalizeOutputRelativePath(value: string): string {
  const raw = value.trim().replaceAll("\\", "/");
  const segments = raw.split("/").filter(Boolean);
  if (!segments.length || path.posix.isAbsolute(raw) || /^[A-Za-z]:/u.test(raw) || segments.some((item) => item === "." || item === "..")) {
    throw new Error("TASK_OUTPUT_PATH_INVALID");
  }
  return segments.join("/");
}

export function saveTaskWorkspace(record: TaskWorkspaceRecord): TaskWorkspaceRecord {
  ensureDir(TASK_WORKSPACES_DIR);
  writeJsonAtomic(recordPath(record.session_id), record);
  return record;
}

export function getTaskWorkspace(sessionId: string): TaskWorkspaceRecord | null {
  const storage = getJsonStorageBackend();
  const file = recordPath(sessionId);
  if (!storage.exists(file)) return null;
  const record = storage.readJson<TaskWorkspaceRecord>(file);
  const activeWorkspaceId = getActiveWorkspaceId();
  return activeWorkspaceId && record.workspace_id !== activeWorkspaceId ? null : record;
}

export function bindTaskWorkspace(input: {
  workspaceId: string;
  sessionId: string;
  projectId: string;
  bindingId: string;
  outputRelativePath: string;
}): TaskWorkspaceRecord {
  const project = getLocalProject(input.projectId);
  if (!project || project.status !== "active" || project.workspace_id !== input.workspaceId) {
    throw new Error("LOCAL_PROJECT_NOT_AVAILABLE");
  }
  const existing = getTaskWorkspace(input.sessionId);
  const timestamp = nowIso();
  const record = saveTaskWorkspace({
    task_workspace_id: existing?.task_workspace_id || `taskws_${randomUUID()}`,
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    project_id: input.projectId,
    binding_id: input.bindingId,
    output_relative_path: normalizeOutputRelativePath(input.outputRelativePath),
    status: "active",
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
    archived_at: null,
    metadata: existing?.metadata || {},
  });
  extendCoreMemorySnapshotForProject(input.sessionId, input.projectId, input.workspaceId);
  return record;
}

export function archiveTaskWorkspace(sessionId: string): TaskWorkspaceRecord | null {
  const record = getTaskWorkspace(sessionId);
  if (!record) return null;
  const timestamp = nowIso();
  record.status = "archived";
  record.archived_at = timestamp;
  record.updated_at = timestamp;
  return saveTaskWorkspace(record);
}

export function restoreTaskWorkspace(sessionId: string): TaskWorkspaceRecord | null {
  const record = getTaskWorkspace(sessionId);
  if (!record) return null;
  record.status = "active";
  record.archived_at = null;
  record.updated_at = nowIso();
  return saveTaskWorkspace(record);
}

export function publicTaskWorkspace(record: TaskWorkspaceRecord | null): PublicTaskWorkspace | null {
  if (!record) return null;
  const project = getLocalProject(record.project_id);
  if (!project) return null;
  return {
    task_workspace_id: record.task_workspace_id,
    session_id: record.session_id,
    project: publicLocalProject(project),
    binding_id: record.binding_id,
    output_relative_path: record.output_relative_path,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    archived_at: record.archived_at,
  };
}
