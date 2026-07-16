import crypto, { randomUUID } from "node:crypto";
import path from "node:path";
import {
  MEMORIES_DIR,
  MEMORY_COLLECTIONS_DIR,
  MEMORY_CONFLICTS_DIR,
  MEMORY_SHARES_DIR,
} from "./config.js";
import { deserializeMemoryRecord } from "./memory-encryption.js";
import { deleteMemory, getMemory, MemoryStoreError, updateMemory } from "./memory-store.js";
import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  MemoryCollection,
  MemoryConflictRecord,
  MemoryKind,
  MemoryRecord,
  MemoryShareGrant,
  SharedMemoryView,
} from "./types.js";
import { nowIso } from "./utils.js";
import { getWorkspace } from "./workspace-store.js";

function workspaceId(): string {
  return getActiveWorkspaceId() || "default";
}

function actorId(): string {
  return getActivePrincipalId() || "system";
}

function collectionPath(collectionId: string): string {
  return path.join(MEMORY_COLLECTIONS_DIR, `${encodeURIComponent(collectionId)}.json`);
}

function shareDir(sourceWorkspaceId: string): string {
  return path.join(MEMORY_SHARES_DIR, encodeURIComponent(sourceWorkspaceId));
}

function sharePath(sourceWorkspaceId: string, shareId: string): string {
  return path.join(shareDir(sourceWorkspaceId), `${encodeURIComponent(shareId)}.json`);
}

function conflictDir(targetWorkspaceId: string): string {
  return path.join(MEMORY_CONFLICTS_DIR, encodeURIComponent(targetWorkspaceId));
}

function conflictPath(targetWorkspaceId: string, conflictId: string): string {
  return path.join(conflictDir(targetWorkspaceId), `${encodeURIComponent(conflictId)}.json`);
}

function requiredText(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum || /[\0\r\n]/u.test(value)) {
    throw new MemoryStoreError("memory_sharing_invalid", `${field} is required and must be at most ${maximum} characters.`);
  }
  return value.trim();
}

function stringList(value: unknown, field: string, maximum = 100): string[] {
  if (!Array.isArray(value)) throw new MemoryStoreError("memory_sharing_invalid", `${field} must be an array.`);
  return [...new Set(value.map((item) => requiredText(item, field, 160)))].slice(0, maximum);
}

function requiredContent(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 4_000) {
    throw new MemoryStoreError("memory_sharing_invalid", `${field} is required and must be at most 4000 characters.`);
  }
  return value.trim().replace(/\r\n/gu, "\n");
}

function contentDigest(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function readMemoryFromWorkspace(sourceWorkspaceId: string, memoryId: string): MemoryRecord | null {
  const storage = getJsonStorageBackend();
  const file = path.join(MEMORIES_DIR, encodeURIComponent(sourceWorkspaceId), `${encodeURIComponent(memoryId)}.json`);
  if (!storage.exists(file)) return null;
  const memory = deserializeMemoryRecord(storage.readJson<unknown>(file)).record;
  return memory.workspace_id === sourceWorkspaceId ? memory : null;
}

export function createMemoryCollection(input: {
  name?: unknown;
  kind?: unknown;
  member_workspace_ids?: unknown;
}): MemoryCollection {
  const ownerWorkspaceId = workspaceId();
  const kind = input.kind === "organization" ? "organization" : input.kind === "team" ? "team" : null;
  if (!kind) throw new MemoryStoreError("memory_sharing_invalid", "kind must be team or organization.");
  const members = stringList(input.member_workspace_ids || [], "member_workspace_id");
  for (const memberId of members) {
    if (memberId !== "default" && !getWorkspace(memberId)) {
      throw new MemoryStoreError("memory_workspace_not_found", `Workspace ${memberId} was not found.`, 404);
    }
  }
  const timestamp = nowIso();
  const collection: MemoryCollection = {
    schema_version: 1,
    collection_id: `memcol_${randomUUID()}`,
    kind,
    name: requiredText(input.name, "name"),
    owner_workspace_id: ownerWorkspaceId,
    member_workspace_ids: [...new Set([ownerWorkspaceId, ...members])],
    status: "active",
    created_by: actorId(),
    created_at: timestamp,
    updated_at: timestamp,
  };
  getJsonStorageBackend().writeJson(collectionPath(collection.collection_id), collection);
  return collection;
}

export function listMemoryCollections(targetWorkspaceId = workspaceId()): MemoryCollection[] {
  return getJsonStorageBackend().listJsonFiles(MEMORY_COLLECTIONS_DIR)
    .map((file) => getJsonStorageBackend().readJson<MemoryCollection>(file))
    .filter((item) => item.member_workspace_ids.includes(targetWorkspaceId))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getMemoryCollection(collectionId: string): MemoryCollection | null {
  const storage = getJsonStorageBackend();
  const file = collectionPath(collectionId);
  return storage.exists(file) ? storage.readJson<MemoryCollection>(file) : null;
}

export function updateMemoryCollection(collectionId: string, input: {
  name?: unknown;
  member_workspace_ids?: unknown;
  status?: unknown;
}): MemoryCollection | null {
  const current = getMemoryCollection(collectionId);
  if (!current) return null;
  if (current.owner_workspace_id !== workspaceId()) throw new MemoryStoreError("memory_sharing_forbidden", "Only the owner Workspace can change this collection.", 403);
  const members = input.member_workspace_ids === undefined
    ? current.member_workspace_ids
    : stringList(input.member_workspace_ids, "member_workspace_id");
  for (const memberId of members) {
    if (memberId !== "default" && !getWorkspace(memberId)) {
      throw new MemoryStoreError("memory_workspace_not_found", `Workspace ${memberId} was not found.`, 404);
    }
  }
  const next: MemoryCollection = {
    ...current,
    name: input.name === undefined ? current.name : requiredText(input.name, "name"),
    member_workspace_ids: [...new Set([current.owner_workspace_id, ...members])],
    status: input.status === "archived" ? "archived" : input.status === "active" ? "active" : current.status,
    updated_at: nowIso(),
  };
  getJsonStorageBackend().writeJson(collectionPath(collectionId), next);
  return next;
}

export function createMemoryShare(input: {
  collection_id?: unknown;
  memory_id?: unknown;
  target_workspace_ids?: unknown;
  mode?: unknown;
  version_policy?: unknown;
}): MemoryShareGrant {
  const sourceWorkspaceId = workspaceId();
  const collectionId = requiredText(input.collection_id, "collection_id", 160);
  const memoryId = requiredText(input.memory_id, "memory_id", 160);
  const collection = getMemoryCollection(collectionId);
  if (!collection || collection.status !== "active") throw new MemoryStoreError("memory_collection_not_found", "Memory collection was not found.", 404);
  if (collection.owner_workspace_id !== sourceWorkspaceId) throw new MemoryStoreError("memory_sharing_forbidden", "Only the collection owner can publish Memory.", 403);
  const memory = getMemory(memoryId);
  if (!memory || memory.status !== "active") throw new MemoryStoreError("memory_not_found", "Memory was not found.", 404);
  if (memory.sensitivity !== "normal") throw new MemoryStoreError("memory_share_sensitive", "Private and Restricted Memory cannot be shared across Workspaces.", 422);
  const targets = stringList(input.target_workspace_ids || [], "target_workspace_id")
    .filter((item) => item !== sourceWorkspaceId);
  if (!targets.length || targets.some((item) => !collection.member_workspace_ids.includes(item))) {
    throw new MemoryStoreError("memory_share_target_invalid", "Every target Workspace must be a collection member.", 422);
  }
  const mode = input.mode === "suggest_changes" ? "suggest_changes" : "read_only";
  const versionPolicy = input.version_policy === "follow_latest" ? "follow_latest" : "pinned";
  const timestamp = nowIso();
  const share: MemoryShareGrant = {
    schema_version: 1,
    share_id: `memshare_${randomUUID()}`,
    collection_id: collectionId,
    source_workspace_id: sourceWorkspaceId,
    source_memory_id: memory.memory_id,
    source_memory_version: memory.version,
    target_workspace_ids: targets,
    mode,
    version_policy: versionPolicy,
    status: "active",
    published_content: memory.content,
    published_digest: contentDigest(memory.content),
    created_by: actorId(),
    created_at: timestamp,
    updated_at: timestamp,
    revoked_at: null,
  };
  getJsonStorageBackend().writeJson(sharePath(sourceWorkspaceId, share.share_id), share);
  return share;
}

export function listMemoryShares(targetWorkspaceId = workspaceId()): MemoryShareGrant[] {
  const storage = getJsonStorageBackend();
  return storage.listDirs(MEMORY_SHARES_DIR)
    .flatMap((directory) => storage.listJsonFiles(directory))
    .map((file) => storage.readJson<MemoryShareGrant>(file))
    .filter((share) => share.source_workspace_id === targetWorkspaceId || share.target_workspace_ids.includes(targetWorkspaceId))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function getMemoryShare(shareId: string): MemoryShareGrant | null {
  return listMemoryShares("__all__").find((item) => item.share_id === shareId) || (() => {
    const storage = getJsonStorageBackend();
    for (const directory of storage.listDirs(MEMORY_SHARES_DIR)) {
      const file = path.join(directory, `${encodeURIComponent(shareId)}.json`);
      if (storage.exists(file)) return storage.readJson<MemoryShareGrant>(file);
    }
    return null;
  })();
}

export function revokeMemoryShare(shareId: string): MemoryShareGrant | null {
  const share = getMemoryShare(shareId);
  if (!share) return null;
  if (share.source_workspace_id !== workspaceId()) throw new MemoryStoreError("memory_sharing_forbidden", "Only the source Workspace can revoke a share.", 403);
  const timestamp = nowIso();
  const next = { ...share, status: "revoked" as const, revoked_at: timestamp, updated_at: timestamp };
  getJsonStorageBackend().writeJson(sharePath(share.source_workspace_id, share.share_id), next);
  return next;
}

function projectedMemory(share: MemoryShareGrant, targetWorkspaceId: string): SharedMemoryView | null {
  const collection = getMemoryCollection(share.collection_id);
  if (!collection) return null;
  const source = readMemoryFromWorkspace(share.source_workspace_id, share.source_memory_id);
  const canFollow = share.version_policy === "follow_latest" && source?.status === "active" && source.sensitivity === "normal";
  const content = canFollow ? source.content : share.published_content;
  const version = canFollow ? source.version : share.source_memory_version;
  const freshness: SharedMemoryView["freshness"] = !source || source.status !== "active"
    ? "source_unavailable"
    : source.version === share.source_memory_version ? "current" : "stale";
  const base = source || ({
    schema_version: 1,
    kind: "fact",
    confidence: 1,
    importance: 0.5,
    tags: [],
    valid_from: null,
    valid_until: null,
    expires_at: null,
    supersedes_memory_id: null,
    created_at: share.created_at,
    updated_at: share.updated_at,
  } as Partial<MemoryRecord>);
  const memory: MemoryRecord = {
    ...(base as MemoryRecord),
    schema_version: 1,
    memory_id: `shared_${share.share_id}`,
    workspace_id: targetWorkspaceId,
    scope_kind: "workspace",
    scope_id: targetWorkspaceId,
    content,
    sensitivity: "normal",
    status: share.status === "active" && freshness !== "source_unavailable" ? "active" : "deleted",
    version,
    source: {
      origin: "system",
      session_id: null,
      message_ids: [],
      action_id: null,
      provider_id: "memory-sharing",
      note: `share:${share.share_id}:${share.source_workspace_id}:${share.source_memory_id}`,
    },
    created_by: share.created_by,
    updated_by: share.created_by,
    updated_at: canFollow && source ? source.updated_at : share.updated_at,
  };
  return {
    share: (({ published_content: _content, ...publicShare }) => publicShare)(share),
    collection,
    projected_memory: memory,
    freshness,
  };
}

export function listSharedMemoryViews(targetWorkspaceId = workspaceId()): SharedMemoryView[] {
  return listMemoryShares(targetWorkspaceId)
    .filter((share) => share.status === "active" && share.target_workspace_ids.includes(targetWorkspaceId))
    .map((share) => projectedMemory(share, targetWorkspaceId))
    .filter((item): item is SharedMemoryView => Boolean(item));
}

export function getSharedProjectedMemory(memoryId: string, targetWorkspaceId = workspaceId()): MemoryRecord | null {
  return listSharedMemoryViews(targetWorkspaceId).find((item) => item.projected_memory.memory_id === memoryId)?.projected_memory || null;
}

export function createMemoryConflict(input: {
  workspaceId: string;
  kind: MemoryConflictRecord["kind"];
  targetMemoryId: string;
  shareId?: string | null;
  sourceId?: string | null;
  externalId?: string | null;
  externalVersion?: string | null;
  baseMemoryVersion: number;
  currentContent: string;
  proposedContent: string;
  proposedDeleted?: boolean;
  proposedKind: MemoryKind;
  proposedTags?: string[];
  proposedBy?: string;
}): MemoryConflictRecord {
  const existing = listMemoryConflicts(input.workspaceId).find((item) =>
    item.status === "pending" && item.kind === input.kind && item.target_memory_id === input.targetMemoryId &&
    item.share_id === (input.shareId || null) && item.source_id === (input.sourceId || null) &&
    item.proposed_content === input.proposedContent,
  );
  if (existing) return existing;
  const conflict: MemoryConflictRecord = {
    schema_version: 1,
    conflict_id: `memconf_${randomUUID()}`,
    workspace_id: input.workspaceId,
    kind: input.kind,
    status: "pending",
    target_memory_id: input.targetMemoryId,
    share_id: input.shareId || null,
    source_id: input.sourceId || null,
    external_id: input.externalId || null,
    external_version: input.externalVersion || null,
    base_memory_version: input.baseMemoryVersion,
    current_content: input.currentContent,
    proposed_content: input.proposedContent,
    proposed_deleted: input.proposedDeleted === true,
    proposed_kind: input.proposedKind,
    proposed_tags: input.proposedTags || [],
    proposed_by: input.proposedBy || actorId(),
    resolution: null,
    resolved_memory_version: null,
    resolved_by: null,
    resolved_at: null,
    created_at: nowIso(),
  };
  getJsonStorageBackend().writeJson(conflictPath(input.workspaceId, conflict.conflict_id), conflict);
  return conflict;
}

export function suggestSharedMemoryChange(shareId: string, proposedContentValue: unknown): MemoryConflictRecord {
  const share = getMemoryShare(shareId);
  const targetWorkspaceId = workspaceId();
  if (!share || share.status !== "active" || !share.target_workspace_ids.includes(targetWorkspaceId)) {
    throw new MemoryStoreError("memory_share_not_found", "Shared Memory was not found.", 404);
  }
  if (share.mode !== "suggest_changes") throw new MemoryStoreError("memory_share_read_only", "This shared Memory is read-only.", 403);
  const source = readMemoryFromWorkspace(share.source_workspace_id, share.source_memory_id);
  if (!source || source.status !== "active") throw new MemoryStoreError("memory_share_source_unavailable", "Source Memory is unavailable.", 409);
  const proposedContent = requiredContent(proposedContentValue, "proposed_content");
  return createMemoryConflict({
    workspaceId: share.source_workspace_id,
    kind: "shared_suggestion",
    targetMemoryId: source.memory_id,
    shareId: share.share_id,
    baseMemoryVersion: source.version,
    currentContent: source.content,
    proposedContent,
    proposedKind: source.kind,
    proposedTags: source.tags,
  });
}

export function listMemoryConflicts(targetWorkspaceId = workspaceId()): MemoryConflictRecord[] {
  return getJsonStorageBackend().listJsonFiles(conflictDir(targetWorkspaceId))
    .map((file) => getJsonStorageBackend().readJson<MemoryConflictRecord>(file))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function getMemoryConflict(conflictId: string): MemoryConflictRecord | null {
  return listMemoryConflicts().find((item) => item.conflict_id === conflictId) || null;
}

export function resolveMemoryConflict(conflictId: string, input: {
  resolution?: unknown;
  merged_content?: unknown;
}): { conflict: MemoryConflictRecord; memory: MemoryRecord } | null {
  const conflict = getMemoryConflict(conflictId);
  if (!conflict) return null;
  if (conflict.status !== "pending") throw new MemoryStoreError("memory_conflict_resolved", "Memory conflict is already resolved.", 409);
  const current = getMemory(conflict.target_memory_id);
  if (!current) throw new MemoryStoreError("memory_not_found", "Conflict target Memory was not found.", 404);
  const resolution = input.resolution === "accept_proposed" || input.resolution === "keep_current" || input.resolution === "merge" || input.resolution === "dismiss"
    ? input.resolution
    : null;
  if (!resolution) throw new MemoryStoreError("memory_conflict_invalid", "A valid resolution is required.");
  let memory = current;
  if (resolution === "accept_proposed") {
    memory = conflict.proposed_deleted
      ? (deleteMemory(current.memory_id, actorId()) || current)
      : updateMemory(current.memory_id, { content: conflict.proposed_content, kind: conflict.proposed_kind, tags: conflict.proposed_tags }, actorId())!;
  } else if (resolution === "merge") {
    memory = updateMemory(current.memory_id, { content: requiredContent(input.merged_content, "merged_content") }, actorId())!;
  }
  const timestamp = nowIso();
  const next: MemoryConflictRecord = {
    ...conflict,
    status: resolution === "dismiss" ? "dismissed" : "resolved",
    resolution,
    resolved_memory_version: memory.version,
    resolved_by: actorId(),
    resolved_at: timestamp,
  };
  getJsonStorageBackend().writeJson(conflictPath(conflict.workspace_id, conflict.conflict_id), next);
  return { conflict: next, memory };
}

export function purgeMemorySharingReferences(sourceWorkspaceId: string, memoryId: string): Record<string, number> {
  const storage = getJsonStorageBackend();
  let shares = 0;
  let conflicts = 0;
  for (const file of storage.listJsonFiles(shareDir(sourceWorkspaceId))) {
    const share = storage.readJson<MemoryShareGrant>(file);
    if (share.source_memory_id !== memoryId) continue;
    storage.removeJson(file);
    shares += 1;
  }
  for (const file of storage.listJsonFiles(conflictDir(sourceWorkspaceId))) {
    const conflict = storage.readJson<MemoryConflictRecord>(file);
    if (conflict.target_memory_id !== memoryId) continue;
    storage.removeJson(file);
    conflicts += 1;
  }
  return { shares, conflicts };
}
