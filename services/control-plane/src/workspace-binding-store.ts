import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_BINDINGS_DIR } from "./config.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  WorkspaceBindingAccess,
  WorkspaceBindingRecord,
  WorkspaceBindingScope,
} from "./types.js";
import { ensureDir, nowIso, writeJsonAtomic } from "./utils.js";

function bindingPath(bindingId: string): string {
  return path.join(WORKSPACE_BINDINGS_DIR, `${encodeURIComponent(bindingId)}.json`);
}

function rootFingerprint(rootPath: string): string {
  return createHash("sha256").update(process.platform).update("\0").update(rootPath).digest("hex");
}

export function workspaceCapabilityDigest(capabilityId: string): string {
  return createHash("sha256").update(capabilityId).digest("hex");
}

function refreshStatus(binding: WorkspaceBindingRecord): WorkspaceBindingRecord {
  if (binding.status === "active" && binding.expires_at && Date.parse(binding.expires_at) <= Date.now()) {
    binding.status = "expired";
    binding.updated_at = nowIso();
    writeJsonAtomic(bindingPath(binding.binding_id), binding);
  }
  return binding;
}

export function publicWorkspaceBinding(binding: WorkspaceBindingRecord | null) {
  if (!binding) return null;
  return {
    binding_id: binding.binding_id,
    session_id: binding.session_id,
    display_name: binding.display_name,
    access: binding.access,
    scope: binding.scope,
    status: binding.status,
    expires_at: binding.expires_at,
    updated_at: binding.updated_at,
  };
}

export function saveWorkspaceBinding(binding: WorkspaceBindingRecord): WorkspaceBindingRecord {
  ensureDir(WORKSPACE_BINDINGS_DIR);
  writeJsonAtomic(bindingPath(binding.binding_id), binding);
  return binding;
}

export function getWorkspaceBinding(bindingId: string): WorkspaceBindingRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = bindingPath(bindingId);
  if (!storage.exists(filePath)) return null;
  const binding = refreshStatus(storage.readJson<WorkspaceBindingRecord>(filePath));
  const activeWorkspaceId = getActiveWorkspaceId();
  return activeWorkspaceId && binding.workspace_id !== activeWorkspaceId ? null : binding;
}

export function listSessionWorkspaceBindings(sessionId: string): WorkspaceBindingRecord[] {
  const storage = getJsonStorageBackend();
  const activeWorkspaceId = getActiveWorkspaceId();
  return storage.listJsonFiles(WORKSPACE_BINDINGS_DIR)
    .map((file) => refreshStatus(storage.readJson<WorkspaceBindingRecord>(file)))
    .filter((binding) => binding.session_id === sessionId)
    .filter((binding) => !activeWorkspaceId || binding.workspace_id === activeWorkspaceId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function getActiveSessionWorkspaceBinding(sessionId: string): WorkspaceBindingRecord | null {
  return listSessionWorkspaceBindings(sessionId).find((binding) => binding.status === "active") || null;
}

export function registerWorkspaceBinding(input: {
  workspaceId: string;
  sessionId: string;
  desktopInstanceId: string;
  capabilityId: string;
  rootPath: string;
  displayName?: string;
  access: WorkspaceBindingAccess;
  scope: WorkspaceBindingScope;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}): WorkspaceBindingRecord {
  const resolvedRoot = fs.realpathSync(path.resolve(input.rootPath));
  if (!fs.statSync(resolvedRoot).isDirectory()) throw new Error("WORKSPACE_ROOT_NOT_DIRECTORY");
  const existing = getActiveSessionWorkspaceBinding(input.sessionId);
  const timestamp = nowIso();
  if (existing) {
    existing.status = "revoked";
    existing.revoked_at = timestamp;
    existing.updated_at = timestamp;
    saveWorkspaceBinding(existing);
  }
  return saveWorkspaceBinding({
    binding_id: `wsbind_${randomUUID()}`,
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    desktop_instance_id: input.desktopInstanceId,
    capability_digest: workspaceCapabilityDigest(input.capabilityId),
    root_path: resolvedRoot,
    root_fingerprint: rootFingerprint(resolvedRoot),
    display_name: input.displayName?.trim() || path.basename(resolvedRoot),
    access: input.access,
    scope: input.scope,
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
    expires_at: input.expiresAt || null,
    revoked_at: null,
    last_validated_at: timestamp,
    metadata: input.metadata || {},
  });
}

export function revokeWorkspaceBinding(bindingId: string): WorkspaceBindingRecord {
  const binding = getWorkspaceBinding(bindingId);
  if (!binding) throw new Error("WORKSPACE_BINDING_NOT_FOUND");
  if (binding.status === "revoked") return binding;
  const timestamp = nowIso();
  binding.status = "revoked";
  binding.revoked_at = timestamp;
  binding.updated_at = timestamp;
  return saveWorkspaceBinding(binding);
}
