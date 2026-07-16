import crypto, { randomUUID } from "node:crypto";
import path from "node:path";
import {
  MEMORY_EXTERNAL_BINDINGS_DIR,
  MEMORY_EXTERNAL_SOURCES_DIR,
  MEMORY_SYNC_RUNS_DIR,
} from "./config.js";
import { getMcpHost } from "./mcp-host.js";
import { getMcpServer } from "./mcp-server-store.js";
import {
  createMemoryShare,
  createMemoryConflict,
  getMemoryCollection,
  listMemoryShares,
} from "./memory-sharing-store.js";
import {
  createMemory,
  deleteMemory,
  getMemory,
  MemoryStoreError,
  updateMemory,
} from "./memory-store.js";
import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  MemoryConflictRecord,
  MemoryExternalItem,
  MemoryExternalSource,
  MemoryKind,
  MemoryRecord,
  MemorySyncRun,
} from "./types.js";
import { nowIso } from "./utils.js";

interface ExternalBinding {
  schema_version: 1;
  workspace_id: string;
  source_id: string;
  external_id: string;
  external_version: string;
  memory_id: string;
  last_synced_memory_version: number;
  last_synced_digest: string;
  updated_at: string;
}

function workspaceId(): string {
  return getActiveWorkspaceId() || "default";
}

function actorId(): string {
  return getActivePrincipalId() || "system";
}

function sourceDir(targetWorkspaceId: string): string {
  return path.join(MEMORY_EXTERNAL_SOURCES_DIR, encodeURIComponent(targetWorkspaceId));
}

function sourcePath(targetWorkspaceId: string, sourceId: string): string {
  return path.join(sourceDir(targetWorkspaceId), `${encodeURIComponent(sourceId)}.json`);
}

function bindingDir(targetWorkspaceId: string, sourceId: string): string {
  return path.join(MEMORY_EXTERNAL_BINDINGS_DIR, encodeURIComponent(targetWorkspaceId), encodeURIComponent(sourceId));
}

function bindingPath(targetWorkspaceId: string, sourceId: string, externalId: string): string {
  return path.join(bindingDir(targetWorkspaceId, sourceId), `${encodeURIComponent(externalId)}.json`);
}

function syncPath(targetWorkspaceId: string, syncId: string): string {
  return path.join(MEMORY_SYNC_RUNS_DIR, encodeURIComponent(targetWorkspaceId), `${encodeURIComponent(syncId)}.json`);
}

function requiredText(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum || /[\0\r\n]/u.test(value)) {
    throw new MemoryStoreError("memory_external_invalid", `${field} is required and must be at most ${maximum} characters.`);
  }
  return value.trim();
}

function normalizeContent(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 4_000) {
    throw new MemoryStoreError("memory_external_invalid", "External Memory content must be 1-4000 characters.");
  }
  return value.trim().replace(/\r\n/gu, "\n");
}

function digest(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryStoreError("memory_external_invalid", "tool_arguments must be an object.");
  }
  const text = JSON.stringify(value);
  if (text.length > 20_000) throw new MemoryStoreError("memory_external_invalid", "tool_arguments are too large.");
  const containsSecretField = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(containsSecretField);
    if (!node || typeof node !== "object") return false;
    return Object.entries(node as Record<string, unknown>).some(([key, child]) =>
      /(?:api[_-]?key|token|password|passwd|secret|credential)/iu.test(key) || containsSecretField(child),
    );
  };
  if (containsSecretField(value)) {
    throw new MemoryStoreError("memory_external_secret_rejected", "External source arguments cannot contain credential fields; configure secrets on the MCP server.", 422);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export function createMemoryExternalSource(input: {
  name?: unknown;
  provider?: unknown;
  server_id?: unknown;
  tool_name?: unknown;
  tool_arguments?: unknown;
  collection_id?: unknown;
}): MemoryExternalSource {
  const targetWorkspaceId = workspaceId();
  const provider = input.provider === "mcp" ? "mcp" : input.provider === "push" ? "push" : null;
  if (!provider) throw new MemoryStoreError("memory_external_invalid", "provider must be mcp or push.");
  const serverId = provider === "mcp" ? requiredText(input.server_id, "server_id", 160) : null;
  const toolName = provider === "mcp" ? requiredText(input.tool_name, "tool_name", 200) : null;
  if (serverId && !getMcpServer(serverId, targetWorkspaceId)) {
    throw new MemoryStoreError("memory_external_mcp_not_found", "MCP server was not found in this Workspace.", 404);
  }
  const collectionId = typeof input.collection_id === "string" && input.collection_id.trim() ? input.collection_id.trim() : null;
  if (collectionId) {
    const collection = getMemoryCollection(collectionId);
    if (!collection || collection.owner_workspace_id !== targetWorkspaceId) {
      throw new MemoryStoreError("memory_collection_not_found", "Owned Memory collection was not found.", 404);
    }
  }
  const timestamp = nowIso();
  const source: MemoryExternalSource = {
    schema_version: 1,
    source_id: `memsrc_${randomUUID()}`,
    workspace_id: targetWorkspaceId,
    name: requiredText(input.name, "name"),
    provider,
    server_id: serverId,
    tool_name: toolName,
    tool_arguments: normalizeToolArguments(input.tool_arguments),
    collection_id: collectionId,
    status: "active",
    last_cursor: null,
    last_sync_at: null,
    last_error: null,
    created_by: actorId(),
    created_at: timestamp,
    updated_at: timestamp,
  };
  getJsonStorageBackend().writeJson(sourcePath(targetWorkspaceId, source.source_id), source);
  return source;
}

export function listMemoryExternalSources(targetWorkspaceId = workspaceId()): MemoryExternalSource[] {
  return getJsonStorageBackend().listJsonFiles(sourceDir(targetWorkspaceId))
    .map((file) => getJsonStorageBackend().readJson<MemoryExternalSource>(file))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getMemoryExternalSource(sourceId: string): MemoryExternalSource | null {
  const storage = getJsonStorageBackend();
  const file = sourcePath(workspaceId(), sourceId);
  return storage.exists(file) ? storage.readJson<MemoryExternalSource>(file) : null;
}

function saveSource(source: MemoryExternalSource): MemoryExternalSource {
  getJsonStorageBackend().writeJson(sourcePath(source.workspace_id, source.source_id), source);
  return source;
}

function getBinding(source: MemoryExternalSource, externalId: string): ExternalBinding | null {
  const storage = getJsonStorageBackend();
  const file = bindingPath(source.workspace_id, source.source_id, externalId);
  return storage.exists(file) ? storage.readJson<ExternalBinding>(file) : null;
}

function saveBinding(source: MemoryExternalSource, item: MemoryExternalItem, memory: MemoryRecord): ExternalBinding {
  const binding: ExternalBinding = {
    schema_version: 1,
    workspace_id: source.workspace_id,
    source_id: source.source_id,
    external_id: item.external_id,
    external_version: item.external_version,
    memory_id: memory.memory_id,
    last_synced_memory_version: memory.version,
    last_synced_digest: digest(memory.content),
    updated_at: nowIso(),
  };
  getJsonStorageBackend().writeJson(bindingPath(source.workspace_id, source.source_id, item.external_id), binding);
  return binding;
}

function ensureCollectionShare(source: MemoryExternalSource, memory: MemoryRecord): void {
  if (!source.collection_id) return;
  const collection = getMemoryCollection(source.collection_id);
  if (!collection || collection.owner_workspace_id !== source.workspace_id || collection.status !== "active") return;
  const targets = collection.member_workspace_ids.filter((item) => item !== source.workspace_id);
  if (!targets.length || listMemoryShares(source.workspace_id).some((share) =>
    share.status === "active" && share.collection_id === collection.collection_id && share.source_memory_id === memory.memory_id,
  )) return;
  createMemoryShare({
    collection_id: collection.collection_id,
    memory_id: memory.memory_id,
    target_workspace_ids: targets,
    mode: "read_only",
    version_policy: "follow_latest",
  });
}

function normalizeItem(value: unknown): MemoryExternalItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryStoreError("memory_external_invalid", "External item must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const kind = new Set<MemoryKind>(["preference", "fact", "convention", "decision", "lesson"]).has(raw.kind as MemoryKind)
    ? raw.kind as MemoryKind
    : "fact";
  return {
    external_id: requiredText(raw.external_id, "external_id", 300),
    external_version: requiredText(raw.external_version, "external_version", 200),
    content: raw.deleted === true ? "[deleted]" : normalizeContent(raw.content),
    kind,
    tags: Array.isArray(raw.tags)
      ? [...new Set(raw.tags.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(0, 20)
      : [],
    deleted: raw.deleted === true,
  };
}

export function ingestExternalMemoryBatch(input: {
  sourceId: string;
  items: unknown;
  cursor?: unknown;
}): MemorySyncRun {
  const source = getMemoryExternalSource(input.sourceId);
  if (!source) throw new MemoryStoreError("memory_external_source_not_found", "External Memory source was not found.", 404);
  if (source.status === "disabled") throw new MemoryStoreError("memory_external_source_disabled", "External Memory source is disabled.", 409);
  if (!Array.isArray(input.items) || input.items.length > 1_000) {
    throw new MemoryStoreError("memory_external_invalid", "items must be an array with at most 1000 entries.");
  }
  const items = input.items.map(normalizeItem);
  const counters = { created: 0, updated: 0, deleted: 0, conflicts: 0, skipped: 0 };
  for (const item of items) {
    const binding = getBinding(source, item.external_id);
    if (binding?.external_version === item.external_version) {
      counters.skipped += 1;
      continue;
    }
    const current = binding ? getMemory(binding.memory_id) : null;
    if (item.deleted) {
      if (current?.status === "active") {
        const locallyChanged = Boolean(binding) && (
          current.version !== binding!.last_synced_memory_version || digest(current.content) !== binding!.last_synced_digest
        );
        if (locallyChanged) {
          createMemoryConflict({
            workspaceId: source.workspace_id,
            kind: "external_update",
            targetMemoryId: current.memory_id,
            sourceId: source.source_id,
            externalId: item.external_id,
            externalVersion: item.external_version,
            baseMemoryVersion: binding!.last_synced_memory_version,
            currentContent: current.content,
            proposedContent: "External source requested deletion.",
            proposedDeleted: true,
            proposedKind: current.kind,
            proposedTags: current.tags,
            proposedBy: `external:${source.source_id}`,
          });
          counters.conflicts += 1;
          continue;
        }
        const deleted = deleteMemory(current.memory_id, `external:${source.source_id}`);
        if (deleted) saveBinding(source, item, deleted);
        counters.deleted += 1;
      } else counters.skipped += 1;
      continue;
    }
    if (!binding || !current) {
      const memory = createMemory({
        scope_kind: "workspace",
        scope_id: source.workspace_id,
        kind: item.kind,
        content: item.content,
        tags: [...item.tags, "external-sync"],
        sensitivity: "normal",
        source: { origin: "imported", provider_id: source.source_id, note: `external:${item.external_id}` },
      }, { origin: "imported", createdBy: `external:${source.source_id}` });
      saveBinding(source, item, memory);
      ensureCollectionShare(source, memory);
      counters.created += 1;
      continue;
    }
    const locallyChanged = current.version !== binding.last_synced_memory_version || digest(current.content) !== binding.last_synced_digest;
    if (locallyChanged && digest(current.content) !== digest(item.content)) {
      createMemoryConflict({
        workspaceId: source.workspace_id,
        kind: "external_update",
        targetMemoryId: current.memory_id,
        sourceId: source.source_id,
        externalId: item.external_id,
        externalVersion: item.external_version,
        baseMemoryVersion: binding.last_synced_memory_version,
        currentContent: current.content,
        proposedContent: item.content,
        proposedKind: item.kind,
        proposedTags: item.tags,
        proposedBy: `external:${source.source_id}`,
      });
      counters.conflicts += 1;
      continue;
    }
    const updated = updateMemory(current.memory_id, {
      kind: item.kind,
      content: item.content,
      tags: [...item.tags, "external-sync"],
      source: { origin: "imported", provider_id: source.source_id, note: `external:${item.external_id}` },
    }, `external:${source.source_id}`)!;
    saveBinding(source, item, updated);
    ensureCollectionShare(source, updated);
    counters.updated += 1;
  }
  const cursor = typeof input.cursor === "string" && input.cursor.trim() ? input.cursor.trim().slice(0, 500) : source.last_cursor;
  const timestamp = nowIso();
  saveSource({ ...source, status: "active", last_cursor: cursor, last_sync_at: timestamp, last_error: null, updated_at: timestamp });
  const run: MemorySyncRun = {
    schema_version: 1,
    sync_id: `memsync_${randomUUID()}`,
    workspace_id: source.workspace_id,
    source_id: source.source_id,
    status: counters.conflicts ? "partial" : "completed",
    received: items.length,
    ...counters,
    cursor,
    error: null,
    completed_at: timestamp,
  };
  getJsonStorageBackend().writeJson(syncPath(source.workspace_id, run.sync_id), run);
  return run;
}

function parseMcpBatch(result: Record<string, unknown>): { items: unknown[]; cursor?: unknown } {
  const structured = result.structured_content;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    const value = structured as Record<string, unknown>;
    if (Array.isArray(value.items)) return { items: value.items, cursor: value.next_cursor ?? value.cursor };
  }
  if (typeof result.content === "string" && result.content.trim()) {
    const value = JSON.parse(result.content) as Record<string, unknown>;
    if (Array.isArray(value.items)) return { items: value.items, cursor: value.next_cursor ?? value.cursor };
  }
  throw new MemoryStoreError("memory_external_result_invalid", "MCP sync tool must return { items, next_cursor? }.", 422);
}

export async function syncExternalMemorySource(sourceId: string): Promise<MemorySyncRun> {
  const source = getMemoryExternalSource(sourceId);
  if (!source) throw new MemoryStoreError("memory_external_source_not_found", "External Memory source was not found.", 404);
  if (source.provider !== "mcp" || !source.server_id || !source.tool_name) {
    throw new MemoryStoreError("memory_external_sync_unsupported", "This source accepts push ingestion instead of pull sync.", 409);
  }
  try {
    await getMcpHost().initialize(source.workspace_id);
    const result = await getMcpHost().callTool(source.workspace_id, source.server_id, source.tool_name, {
      ...source.tool_arguments,
      ...(source.last_cursor ? { cursor: source.last_cursor } : {}),
    });
    const batch = parseMcpBatch(result);
    return ingestExternalMemoryBatch({ sourceId, items: batch.items, cursor: batch.cursor });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : "External Memory sync failed.";
    saveSource({ ...source, status: "degraded", last_error: message, updated_at: nowIso() });
    throw error;
  }
}

export function acknowledgeExternalConflict(conflict: MemoryConflictRecord, memory: MemoryRecord): void {
  if (conflict.kind !== "external_update" || !conflict.source_id || !conflict.external_id || !conflict.external_version) return;
  const source = getMemoryExternalSource(conflict.source_id);
  if (!source) return;
  saveBinding(source, {
    external_id: conflict.external_id,
    external_version: conflict.external_version,
    content: memory.content,
    kind: memory.kind,
    tags: memory.tags,
  }, memory);
}

export function listMemorySyncRuns(sourceId?: string): MemorySyncRun[] {
  return getJsonStorageBackend().listJsonFiles(path.join(MEMORY_SYNC_RUNS_DIR, encodeURIComponent(workspaceId())))
    .map((file) => getJsonStorageBackend().readJson<MemorySyncRun>(file))
    .filter((item) => !sourceId || item.source_id === sourceId)
    .sort((left, right) => right.completed_at.localeCompare(left.completed_at));
}

export function purgeExternalMemoryBinding(memoryId: string): number {
  const storage = getJsonStorageBackend();
  let removed = 0;
  for (const source of listMemoryExternalSources()) {
    for (const file of storage.listJsonFiles(bindingDir(source.workspace_id, source.source_id))) {
      if (storage.readJson<ExternalBinding>(file).memory_id !== memoryId) continue;
      storage.removeJson(file);
      removed += 1;
    }
  }
  return removed;
}
