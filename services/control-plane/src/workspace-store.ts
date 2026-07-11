import path from "node:path";
import type {
  AuthenticatedPrincipal,
  WorkspaceMemberRecord,
  WorkspaceMembership,
  WorkspaceRecord,
  WorkspaceRole,
} from "@my-mate/shared-types/identity";
import { WORKSPACES_DIR, WORKSPACE_MEMBERS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { nowIso, slugify } from "./utils.js";

function workspacePath(workspaceId: string): string {
  return path.join(WORKSPACES_DIR, `${encodeURIComponent(workspaceId)}.json`);
}

function memberPath(workspaceId: string, principalId: string): string {
  return path.join(
    WORKSPACE_MEMBERS_DIR,
    encodeURIComponent(workspaceId),
    `${encodeURIComponent(principalId)}.json`,
  );
}

export function ensureWorkspace(input: {
  workspaceId: string;
  name: string;
  createdBy: string;
}): WorkspaceRecord {
  const storage = getJsonStorageBackend();
  const workspaceId = slugify(input.workspaceId) || "default";
  const filePath = workspacePath(workspaceId);
  if (storage.exists(filePath)) return storage.readJson<WorkspaceRecord>(filePath);
  const timestamp = nowIso();
  const record: WorkspaceRecord = {
    workspace_id: workspaceId,
    name: input.name.trim() || workspaceId,
    status: "active",
    created_by: input.createdBy,
    created_at: timestamp,
    updated_at: timestamp,
  };
  storage.writeJson(filePath, record);
  return record;
}

export function getWorkspace(workspaceId: string): WorkspaceRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = workspacePath(workspaceId);
  return storage.exists(filePath) ? storage.readJson<WorkspaceRecord>(filePath) : null;
}

export function listWorkspaceRecords(workspaceIds?: readonly string[]): WorkspaceRecord[] {
  const storage = getJsonStorageBackend();
  const allowed = workspaceIds ? new Set(workspaceIds) : null;
  return storage
    .listJsonFiles(WORKSPACES_DIR)
    .map((file) => storage.readJson<WorkspaceRecord>(file))
    .filter((workspace) => !allowed || allowed.has(workspace.workspace_id))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getWorkspaceMember(
  workspaceId: string,
  principalId: string,
): WorkspaceMemberRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = memberPath(workspaceId, principalId);
  return storage.exists(filePath) ? storage.readJson<WorkspaceMemberRecord>(filePath) : null;
}

export function upsertWorkspaceMember(input: {
  workspaceId: string;
  principal: AuthenticatedPrincipal;
  role: WorkspaceRole;
  status?: WorkspaceMemberRecord["status"];
}): WorkspaceMemberRecord {
  const storage = getJsonStorageBackend();
  const current = getWorkspaceMember(input.workspaceId, input.principal.principal_id);
  const timestamp = nowIso();
  const record: WorkspaceMemberRecord = {
    workspace_id: input.workspaceId,
    principal_id: input.principal.principal_id,
    display_name: input.principal.display_name,
    principal_type: input.principal.principal_type,
    role: input.role,
    status: input.status || current?.status || "active",
    created_at: current?.created_at || timestamp,
    updated_at: timestamp,
  };
  storage.writeJson(memberPath(input.workspaceId, record.principal_id), record);
  return record;
}

export function listWorkspaceMembers(workspaceId: string): WorkspaceMemberRecord[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(path.join(WORKSPACE_MEMBERS_DIR, encodeURIComponent(workspaceId)))
    .map((file) => storage.readJson<WorkspaceMemberRecord>(file))
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
}

export function reconcileMembership(
  membership: WorkspaceMembership,
  principal: AuthenticatedPrincipal,
): WorkspaceMemberRecord {
  ensureWorkspace({
    workspaceId: membership.workspace_id,
    name: membership.workspace_name,
    createdBy: principal.principal_id,
  });
  const current = getWorkspaceMember(membership.workspace_id, principal.principal_id);
  if (current) return current;
  return upsertWorkspaceMember({
    workspaceId: membership.workspace_id,
    principal,
    role: membership.role,
  });
}
