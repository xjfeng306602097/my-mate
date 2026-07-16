import crypto, { randomUUID } from "node:crypto";
import path from "node:path";
import {
  MEMORIES_DIR,
  MEMORY_BACKUPS_DIR,
  MEMORY_CANDIDATES_DIR,
  MEMORY_COLLECTIONS_DIR,
  MEMORY_CONFLICTS_DIR,
  MEMORY_EXTERNAL_BINDINGS_DIR,
  MEMORY_EXTERNAL_SOURCES_DIR,
  MEMORY_FEEDBACK_DIR,
  MEMORY_ONBOARDING_DIR,
  MEMORY_OPERATIONS_DIR,
  MEMORY_OVERLAYS_DIR,
  MEMORY_SETTINGS_DIR,
  MEMORY_SHARES_DIR,
  MEMORY_SNAPSHOTS_DIR,
  MEMORY_SYNC_RUNS_DIR,
  MEMORY_TURN_CONTEXTS_DIR,
} from "./config.js";
import {
  beginMemoryKeyRotation,
  deserializeCoreMemorySnapshot,
  deserializeMemoryCandidate,
  deserializeMemoryOnboarding,
  deserializeMemoryOverlay,
  deserializeMemoryRecord,
  deserializeTurnMemoryContext,
  discardRetiredMemoryKeys,
  getMemoryKeyStatus,
  serializeCoreMemorySnapshot,
  serializeMemoryCandidate,
  serializeMemoryOnboarding,
  serializeMemoryOverlay,
  serializeMemoryRecord,
  serializeTurnMemoryContext,
} from "./memory-encryption.js";
import { rebuildMemoryKnowledgeGraph } from "./memory-knowledge-provider.js";
import { rebuildMemoryRetrievalIndex } from "./memory-retrieval-index.js";
import { getMemorySettings } from "./memory-settings-store.js";
import { getMemory, listAllMemories, MemoryStoreError } from "./memory-store.js";
import { getActivePrincipalId, getActiveWorkspaceId, hasPermission } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  CoreMemorySnapshot,
  MemoryBackupMetadata,
  MemoryCandidateRecord,
  MemoryCollection,
  MemoryConflictRecord,
  MemoryExternalSource,
  MemoryIntegrityReport,
  MemoryOnboardingRecord,
  MemoryOperationsStatus,
  MemoryOverlayRecord,
  MemoryPurgeResult,
  MemoryRecommendationFeedback,
  MemoryRecord,
  MemoryRestoreResult,
  MemoryRetentionRunResult,
  MemorySettings,
  MemoryShareGrant,
  MemorySyncRun,
  TurnMemoryContextSnapshot,
} from "./types.js";
import { nowIso } from "./utils.js";
import { purgeMemorySharingReferences } from "./memory-sharing-store.js";
import { purgeExternalMemoryBinding } from "./memory-external-sync.js";

type BackupRecordType = "memory" | "candidate" | "snapshot" | "context" | "overlay" | "feedback" | "onboarding" | "settings" | "collection" | "share" | "conflict" | "external_source" | "external_binding" | "sync_run";

interface LogicalBackup {
  schema_version: 1;
  workspace_id: string;
  created_at: string;
  records: Array<{ type: BackupRecordType; value: unknown }>;
}

interface PersistedBackup {
  metadata: MemoryBackupMetadata;
  encryption: {
    schema_version: 1;
    algorithm: "aes-256-gcm+scrypt";
    salt: string;
    iv: string;
    auth_tag: string;
    ciphertext: string;
  };
}

function workspaceId(): string {
  return getActiveWorkspaceId() || "default";
}

function workspaceDir(root: string, targetWorkspaceId: string): string {
  return path.join(root, encodeURIComponent(targetWorkspaceId));
}

function listJsonRecursive(root: string): string[] {
  const storage = getJsonStorageBackend();
  return [
    ...storage.listJsonFiles(root),
    ...storage.listDirs(root).flatMap(listJsonRecursive),
  ];
}

function workspaceFiles(root: string, targetWorkspaceId: string): string[] {
  return listJsonRecursive(workspaceDir(root, targetWorkspaceId));
}

function operationPath(targetWorkspaceId: string, name: string): string {
  return path.join(workspaceDir(MEMORY_OPERATIONS_DIR, targetWorkspaceId), `${name}.json`);
}

function backupPath(targetWorkspaceId: string, backupId: string): string {
  return path.join(workspaceDir(MEMORY_BACKUPS_DIR, targetWorkspaceId), `${encodeURIComponent(backupId)}.json`);
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requirePassphrase(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 1_024) {
    throw new MemoryStoreError("memory_backup_passphrase_invalid", "Backup passphrase must be 12-1024 characters.");
  }
  return value;
}

function rewriteEncryptedWorkspaceRecords(targetWorkspaceId: string): number {
  const storage = getJsonStorageBackend();
  let rewritten = 0;
  for (const file of workspaceFiles(MEMORIES_DIR, targetWorkspaceId)) {
    const record = deserializeMemoryRecord(storage.readJson<unknown>(file)).record;
    if (record.sensitivity === "private") {
      storage.writeJson(file, serializeMemoryRecord(record));
      rewritten += 1;
    }
  }
  for (const file of workspaceFiles(MEMORY_CANDIDATES_DIR, targetWorkspaceId)) {
    const record = deserializeMemoryCandidate(storage.readJson<unknown>(file)).record;
    if (record.proposed_memory?.sensitivity === "private") {
      storage.writeJson(file, serializeMemoryCandidate(record));
      rewritten += 1;
    }
  }
  for (const file of workspaceFiles(MEMORY_SNAPSHOTS_DIR, targetWorkspaceId)) {
    const snapshot = deserializeCoreMemorySnapshot(storage.readJson<unknown>(file)).snapshot;
    if ([...snapshot.entries, ...snapshot.project_entries].some((entry) => entry.sensitivity === "private")) {
      storage.writeJson(file, serializeCoreMemorySnapshot(snapshot));
      rewritten += 1;
    }
  }
  for (const file of workspaceFiles(MEMORY_TURN_CONTEXTS_DIR, targetWorkspaceId)) {
    const snapshot = deserializeTurnMemoryContext(storage.readJson<unknown>(file)).snapshot;
    if (snapshot.entries.some((entry) => entry.sensitivity === "private")) {
      storage.writeJson(file, serializeTurnMemoryContext(snapshot));
      rewritten += 1;
    }
  }
  for (const file of workspaceFiles(MEMORY_OVERLAYS_DIR, targetWorkspaceId)) {
    const overlay = deserializeMemoryOverlay(storage.readJson<unknown>(file)).overlay;
    if (overlay.entry.sensitivity === "private") {
      storage.writeJson(file, serializeMemoryOverlay(overlay));
      rewritten += 1;
    }
  }
  for (const file of workspaceFiles(MEMORY_ONBOARDING_DIR, targetWorkspaceId)) {
    const onboarding = deserializeMemoryOnboarding(storage.readJson<unknown>(file)).record;
    if (onboarding.draft_entries.some((entry) => entry.sensitivity === "private")) {
      storage.writeJson(file, serializeMemoryOnboarding(onboarding));
      rewritten += 1;
    }
  }
  return rewritten;
}

export function rotateMemoryEncryptionKey(targetWorkspaceId = workspaceId()): {
  key: ReturnType<typeof getMemoryKeyStatus>;
  rewritten_records: number;
  retired_keys_destroyed: number;
} {
  beginMemoryKeyRotation(targetWorkspaceId);
  const rewritten = rewriteEncryptedWorkspaceRecords(targetWorkspaceId);
  const destroyed = discardRetiredMemoryKeys(targetWorkspaceId);
  const result = {
    key: getMemoryKeyStatus(targetWorkspaceId),
    rewritten_records: rewritten,
    retired_keys_destroyed: destroyed,
  };
  getJsonStorageBackend().writeJson(operationPath(targetWorkspaceId, "last-key-rotation"), {
    schema_version: 1,
    workspace_id: targetWorkspaceId,
    active_key_id: result.key.active_key_id,
    rewritten_records: rewritten,
    retired_keys_destroyed: destroyed,
    completed_at: nowIso(),
  });
  return result;
}

function removeMatching(
  files: string[],
  type: string,
  predicate: (value: unknown) => boolean,
  counters: Record<string, number>,
): void {
  const storage = getJsonStorageBackend();
  for (const file of files) {
    let matches = false;
    try {
      matches = predicate(storage.readJson<unknown>(file));
    } catch {
      continue;
    }
    if (!matches) continue;
    storage.removeJson(file);
    counters[type] = (counters[type] || 0) + 1;
  }
}

export function hardPurgeMemory(memoryId: string): MemoryPurgeResult {
  const targetWorkspaceId = workspaceId();
  const memory = getMemory(memoryId);
  if (!memory) throw new MemoryStoreError("memory_not_found", "Memory was not found.", 404);
  const principalId = getActivePrincipalId();
  if (principalId && memory.created_by !== principalId && memory.scope_id !== principalId && !hasPermission("memory.manage")) {
    throw new MemoryStoreError("memory_purge_forbidden", "Only the Memory owner or a Memory manager can purge it.", 403);
  }
  const storage = getJsonStorageBackend();
  const removed: Record<string, number> = {};
  const canonical = path.join(workspaceDir(MEMORIES_DIR, targetWorkspaceId), `${encodeURIComponent(memoryId)}.json`);
  storage.removeJson(canonical);
  removed.memory = 1;

  removeMatching(workspaceFiles(MEMORY_CANDIDATES_DIR, targetWorkspaceId), "candidate", (raw) => {
    const item = deserializeMemoryCandidate(raw).record;
    return item.target_memory_id === memoryId || item.committed_memory_id === memoryId;
  }, removed);
  removeMatching(workspaceFiles(MEMORY_SNAPSHOTS_DIR, targetWorkspaceId), "snapshot", (raw) => {
    const item = deserializeCoreMemorySnapshot(raw).snapshot;
    return [...item.entries, ...item.project_entries].some((entry) => entry.memory_id === memoryId);
  }, removed);
  removeMatching(workspaceFiles(MEMORY_TURN_CONTEXTS_DIR, targetWorkspaceId), "turn_context", (raw) =>
    deserializeTurnMemoryContext(raw).snapshot.entries.some((entry) => entry.memory_id === memoryId), removed);
  removeMatching(workspaceFiles(MEMORY_OVERLAYS_DIR, targetWorkspaceId), "overlay", (raw) =>
    deserializeMemoryOverlay(raw).overlay.memory_id === memoryId, removed);
  removeMatching(workspaceFiles(MEMORY_FEEDBACK_DIR, targetWorkspaceId), "feedback", (raw) =>
    (raw as MemoryRecommendationFeedback).memory_id === memoryId, removed);
  removeMatching(workspaceFiles(MEMORY_ONBOARDING_DIR, targetWorkspaceId), "onboarding", (raw) =>
    deserializeMemoryOnboarding(raw).record.committed_memory_ids.includes(memoryId), removed);
  const sharingRemoved = purgeMemorySharingReferences(targetWorkspaceId, memoryId);
  if (sharingRemoved.shares) removed.share = sharingRemoved.shares;
  if (sharingRemoved.conflicts) removed.conflict = sharingRemoved.conflicts;
  const bindingsRemoved = purgeExternalMemoryBinding(memoryId);
  if (bindingsRemoved) removed.external_binding = bindingsRemoved;

  rebuildMemoryRetrievalIndex();
  const knowledge = rebuildMemoryKnowledgeGraph(listAllMemories({ status: "all" }));
  let cryptoErasure = false;
  if (memory.sensitivity === "private") {
    rotateMemoryEncryptionKey(targetWorkspaceId);
    cryptoErasure = true;
  }
  const result: MemoryPurgeResult = {
    schema_version: 1,
    purge_id: `mempurge_${randomUUID()}`,
    workspace_id: targetWorkspaceId,
    memory_id: memoryId,
    removed_records: Object.values(removed).reduce((total, count) => total + count, 0),
    removed_by_type: removed,
    retrieval_rebuilt: true,
    knowledge_rebuilt: knowledge.status.state !== "degraded",
    cryptographic_erasure: cryptoErasure,
    completed_at: nowIso(),
  };
  storage.writeJson(operationPath(targetWorkspaceId, `purge-${result.purge_id}`), result);
  return result;
}

function backupRecords(targetWorkspaceId: string): LogicalBackup["records"] {
  const storage = getJsonStorageBackend();
  const records: LogicalBackup["records"] = [];
  for (const file of workspaceFiles(MEMORIES_DIR, targetWorkspaceId)) records.push({ type: "memory", value: deserializeMemoryRecord(storage.readJson(file)).record });
  for (const file of workspaceFiles(MEMORY_CANDIDATES_DIR, targetWorkspaceId)) records.push({ type: "candidate", value: deserializeMemoryCandidate(storage.readJson(file)).record });
  for (const file of workspaceFiles(MEMORY_SNAPSHOTS_DIR, targetWorkspaceId)) records.push({ type: "snapshot", value: deserializeCoreMemorySnapshot(storage.readJson(file)).snapshot });
  for (const file of workspaceFiles(MEMORY_TURN_CONTEXTS_DIR, targetWorkspaceId)) records.push({ type: "context", value: deserializeTurnMemoryContext(storage.readJson(file)).snapshot });
  for (const file of workspaceFiles(MEMORY_OVERLAYS_DIR, targetWorkspaceId)) records.push({ type: "overlay", value: deserializeMemoryOverlay(storage.readJson(file)).overlay });
  for (const file of workspaceFiles(MEMORY_FEEDBACK_DIR, targetWorkspaceId)) {
    const value = storage.readJson<Partial<MemoryRecommendationFeedback>>(file);
    if (value.feedback_id && value.session_id && value.memory_id) records.push({ type: "feedback", value });
  }
  for (const file of workspaceFiles(MEMORY_ONBOARDING_DIR, targetWorkspaceId)) records.push({ type: "onboarding", value: deserializeMemoryOnboarding(storage.readJson(file)).record });
  const settingsFile = path.join(MEMORY_SETTINGS_DIR, `${encodeURIComponent(targetWorkspaceId)}.json`);
  if (storage.exists(settingsFile)) records.push({ type: "settings", value: storage.readJson(settingsFile) });
  for (const file of storage.listJsonFiles(MEMORY_COLLECTIONS_DIR)) {
    const value = storage.readJson<MemoryCollection>(file);
    if (value.owner_workspace_id === targetWorkspaceId) records.push({ type: "collection", value });
  }
  for (const file of workspaceFiles(MEMORY_SHARES_DIR, targetWorkspaceId)) records.push({ type: "share", value: storage.readJson(file) });
  for (const file of workspaceFiles(MEMORY_CONFLICTS_DIR, targetWorkspaceId)) records.push({ type: "conflict", value: storage.readJson(file) });
  for (const file of workspaceFiles(MEMORY_EXTERNAL_SOURCES_DIR, targetWorkspaceId)) records.push({ type: "external_source", value: storage.readJson(file) });
  for (const file of workspaceFiles(MEMORY_EXTERNAL_BINDINGS_DIR, targetWorkspaceId)) records.push({ type: "external_binding", value: storage.readJson(file) });
  for (const file of workspaceFiles(MEMORY_SYNC_RUNS_DIR, targetWorkspaceId)) records.push({ type: "sync_run", value: storage.readJson(file) });
  return records;
}

export function createEncryptedMemoryBackup(input: { passphrase: unknown }): MemoryBackupMetadata {
  const passphrase = requirePassphrase(input.passphrase);
  const targetWorkspaceId = workspaceId();
  const createdAt = nowIso();
  const backupId = `membak_${randomUUID()}`;
  const backup: LogicalBackup = {
    schema_version: 1,
    workspace_id: targetWorkspaceId,
    created_at: createdAt,
    records: backupRecords(targetWorkspaceId),
  };
  const manifestDigest = digest(backup);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`my-mate:memory-backup:${targetWorkspaceId}:${backupId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(backup), "utf8"), cipher.final()]);
  const retentionDays = getMemorySettings(targetWorkspaceId).retention.backup_days;
  const metadata: MemoryBackupMetadata = {
    schema_version: 1,
    backup_id: backupId,
    workspace_id: targetWorkspaceId,
    record_count: backup.records.length,
    encrypted_bytes: ciphertext.length,
    manifest_digest: manifestDigest,
    created_by: getActivePrincipalId() || "system",
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + retentionDays * 86_400_000).toISOString(),
  };
  const persisted: PersistedBackup = {
    metadata,
    encryption: {
      schema_version: 1,
      algorithm: "aes-256-gcm+scrypt",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      auth_tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
  };
  getJsonStorageBackend().writeJson(backupPath(targetWorkspaceId, backupId), persisted);
  return metadata;
}

export function listMemoryBackups(targetWorkspaceId = workspaceId()): MemoryBackupMetadata[] {
  return workspaceFiles(MEMORY_BACKUPS_DIR, targetWorkspaceId)
    .map((file) => getJsonStorageBackend().readJson<PersistedBackup>(file).metadata)
    .filter((item) => item.workspace_id === targetWorkspaceId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function decryptBackup(backupId: string, passphraseValue: unknown): LogicalBackup {
  const targetWorkspaceId = workspaceId();
  const file = backupPath(targetWorkspaceId, backupId);
  const storage = getJsonStorageBackend();
  if (!storage.exists(file)) throw new MemoryStoreError("memory_backup_not_found", "Memory backup was not found.", 404);
  const persisted = storage.readJson<PersistedBackup>(file);
  const passphrase = requirePassphrase(passphraseValue);
  try {
    const encryption = persisted.encryption;
    const key = crypto.scryptSync(passphrase, Buffer.from(encryption.salt, "base64"), 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encryption.iv, "base64"));
    decipher.setAAD(Buffer.from(`my-mate:memory-backup:${targetWorkspaceId}:${backupId}`, "utf8"));
    decipher.setAuthTag(Buffer.from(encryption.auth_tag, "base64"));
    const backup = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(encryption.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")) as LogicalBackup;
    if (backup.schema_version !== 1 || backup.workspace_id !== targetWorkspaceId || digest(backup) !== persisted.metadata.manifest_digest) {
      throw new Error("digest mismatch");
    }
    return backup;
  } catch {
    throw new MemoryStoreError("memory_backup_decrypt_failed", "Backup passphrase or integrity verification failed.", 422);
  }
}

function restoreRecord(record: LogicalBackup["records"][number], targetWorkspaceId: string): void {
  const storage = getJsonStorageBackend();
  if (record.type === "memory") {
    const value = record.value as MemoryRecord;
    storage.writeJson(path.join(workspaceDir(MEMORIES_DIR, targetWorkspaceId), `${encodeURIComponent(value.memory_id)}.json`), serializeMemoryRecord(value));
  } else if (record.type === "candidate") {
    const value = record.value as MemoryCandidateRecord;
    storage.writeJson(path.join(workspaceDir(MEMORY_CANDIDATES_DIR, targetWorkspaceId), `${encodeURIComponent(value.candidate_id)}.json`), serializeMemoryCandidate(value));
  } else if (record.type === "snapshot") {
    const value = record.value as CoreMemorySnapshot;
    storage.writeJson(path.join(workspaceDir(MEMORY_SNAPSHOTS_DIR, targetWorkspaceId), `${encodeURIComponent(value.session_id)}.json`), serializeCoreMemorySnapshot(value));
  } else if (record.type === "context") {
    const value = record.value as TurnMemoryContextSnapshot;
    storage.writeJson(path.join(workspaceDir(MEMORY_TURN_CONTEXTS_DIR, targetWorkspaceId), encodeURIComponent(value.session_id), `${encodeURIComponent(value.context_id)}.json`), serializeTurnMemoryContext(value));
  } else if (record.type === "overlay") {
    const value = record.value as MemoryOverlayRecord;
    storage.writeJson(path.join(workspaceDir(MEMORY_OVERLAYS_DIR, targetWorkspaceId), encodeURIComponent(value.session_id), `${encodeURIComponent(value.overlay_id)}.json`), serializeMemoryOverlay(value));
  } else if (record.type === "feedback") {
    const value = record.value as MemoryRecommendationFeedback;
    storage.writeJson(path.join(workspaceDir(MEMORY_FEEDBACK_DIR, targetWorkspaceId), encodeURIComponent(value.session_id), `${encodeURIComponent(value.feedback_id)}.json`), value);
  } else if (record.type === "onboarding") {
    const value = record.value as MemoryOnboardingRecord;
    storage.writeJson(path.join(workspaceDir(MEMORY_ONBOARDING_DIR, targetWorkspaceId), `${encodeURIComponent(value.principal_id)}.json`), serializeMemoryOnboarding(value));
  } else if (record.type === "settings") {
    storage.writeJson(path.join(MEMORY_SETTINGS_DIR, `${encodeURIComponent(targetWorkspaceId)}.json`), record.value);
  } else if (record.type === "collection") {
    const value = record.value as MemoryCollection;
    storage.writeJson(path.join(MEMORY_COLLECTIONS_DIR, `${encodeURIComponent(value.collection_id)}.json`), value);
  } else if (record.type === "share") {
    const value = record.value as MemoryShareGrant;
    storage.writeJson(path.join(workspaceDir(MEMORY_SHARES_DIR, targetWorkspaceId), `${encodeURIComponent(value.share_id)}.json`), value);
  } else if (record.type === "conflict") {
    const value = record.value as MemoryConflictRecord;
    storage.writeJson(path.join(workspaceDir(MEMORY_CONFLICTS_DIR, targetWorkspaceId), `${encodeURIComponent(value.conflict_id)}.json`), value);
  } else if (record.type === "external_source") {
    const value = record.value as MemoryExternalSource;
    storage.writeJson(path.join(workspaceDir(MEMORY_EXTERNAL_SOURCES_DIR, targetWorkspaceId), `${encodeURIComponent(value.source_id)}.json`), value);
  } else if (record.type === "external_binding") {
    const value = record.value as { source_id: string; external_id: string };
    storage.writeJson(path.join(workspaceDir(MEMORY_EXTERNAL_BINDINGS_DIR, targetWorkspaceId), encodeURIComponent(value.source_id), `${encodeURIComponent(value.external_id)}.json`), value);
  } else if (record.type === "sync_run") {
    const value = record.value as MemorySyncRun;
    storage.writeJson(path.join(workspaceDir(MEMORY_SYNC_RUNS_DIR, targetWorkspaceId), `${encodeURIComponent(value.sync_id)}.json`), value);
  }
}

export function restoreEncryptedMemoryBackup(input: {
  backupId: string;
  passphrase: unknown;
  dryRun?: boolean;
}): MemoryRestoreResult {
  const targetWorkspaceId = workspaceId();
  const backup = decryptBackup(input.backupId, input.passphrase);
  if (!input.dryRun) {
    for (const record of backup.records) restoreRecord(record, targetWorkspaceId);
    rebuildMemoryRetrievalIndex();
    rebuildMemoryKnowledgeGraph(listAllMemories({ status: "all" }));
  }
  return {
    schema_version: 1,
    backup_id: input.backupId,
    workspace_id: targetWorkspaceId,
    dry_run: input.dryRun === true,
    restored_records: input.dryRun ? 0 : backup.records.length,
    skipped_records: input.dryRun ? backup.records.length : 0,
    verified_digest: true,
    completed_at: nowIso(),
  };
}

export function scanMemoryIntegrity(targetWorkspaceId = workspaceId()): MemoryIntegrityReport {
  const storage = getJsonStorageBackend();
  const issues: MemoryIntegrityReport["issues"] = [];
  let checked = 0;
  let encrypted = 0;
  const canonicalIds = new Set<string>();
  const inspect = (type: string, files: string[], decode: (raw: unknown) => { value: unknown; id: string | null; workspace: string; encrypted: boolean }) => {
    for (const file of files) {
      checked += 1;
      try {
        const result = decode(storage.readJson<unknown>(file));
        if (result.encrypted) encrypted += 1;
        if (result.workspace !== targetWorkspaceId) issues.push({ code: "workspace_mismatch", record_type: type, record_id: result.id });
      } catch {
        issues.push({ code: "decrypt_or_schema_failed", record_type: type, record_id: null });
      }
    }
  };
  inspect("memory", workspaceFiles(MEMORIES_DIR, targetWorkspaceId), (raw) => {
    const value = deserializeMemoryRecord(raw).record;
    canonicalIds.add(value.memory_id);
    return { value, id: value.memory_id, workspace: value.workspace_id, encrypted: value.sensitivity === "private" };
  });
  inspect("candidate", workspaceFiles(MEMORY_CANDIDATES_DIR, targetWorkspaceId), (raw) => {
    const value = deserializeMemoryCandidate(raw).record;
    for (const memoryId of [value.target_memory_id, value.committed_memory_id].filter(Boolean) as string[]) {
      if (!canonicalIds.has(memoryId)) issues.push({ code: "orphan_memory_reference", record_type: "candidate", record_id: value.candidate_id });
    }
    return { value, id: value.candidate_id, workspace: value.workspace_id, encrypted: value.proposed_memory?.sensitivity === "private" };
  });
  inspect("snapshot", workspaceFiles(MEMORY_SNAPSHOTS_DIR, targetWorkspaceId), (raw) => {
    const value = deserializeCoreMemorySnapshot(raw).snapshot;
    for (const entry of [...value.entries, ...value.project_entries]) if (!canonicalIds.has(entry.memory_id)) issues.push({ code: "orphan_memory_reference", record_type: "snapshot", record_id: value.snapshot_id });
    return { value, id: value.snapshot_id, workspace: value.workspace_id, encrypted: [...value.entries, ...value.project_entries].some((entry) => entry.sensitivity === "private") };
  });
  inspect("turn_context", workspaceFiles(MEMORY_TURN_CONTEXTS_DIR, targetWorkspaceId), (raw) => {
    const value = deserializeTurnMemoryContext(raw).snapshot;
    for (const entry of value.entries) if (!canonicalIds.has(entry.memory_id)) issues.push({ code: "orphan_memory_reference", record_type: "turn_context", record_id: value.context_id });
    return { value, id: value.context_id, workspace: value.workspace_id, encrypted: value.entries.some((entry) => entry.sensitivity === "private") };
  });
  inspect("overlay", workspaceFiles(MEMORY_OVERLAYS_DIR, targetWorkspaceId), (raw) => {
    const value = deserializeMemoryOverlay(raw).overlay;
    if (!canonicalIds.has(value.memory_id)) issues.push({ code: "orphan_memory_reference", record_type: "overlay", record_id: value.overlay_id });
    return { value, id: value.overlay_id, workspace: value.workspace_id, encrypted: value.entry.sensitivity === "private" };
  });
  inspect("feedback", workspaceFiles(MEMORY_FEEDBACK_DIR, targetWorkspaceId), (raw) => {
    const value = raw as Partial<MemoryRecommendationFeedback>;
    if (!value.feedback_id) return { value, id: null, workspace: targetWorkspaceId, encrypted: false };
    if (!value.memory_id || !canonicalIds.has(value.memory_id)) issues.push({ code: "orphan_memory_reference", record_type: "feedback", record_id: value.feedback_id });
    return { value, id: value.feedback_id, workspace: value.workspace_id || "", encrypted: false };
  });
  inspect("onboarding", workspaceFiles(MEMORY_ONBOARDING_DIR, targetWorkspaceId), (raw) => {
    const value = deserializeMemoryOnboarding(raw).record;
    for (const memoryId of value.committed_memory_ids) if (!canonicalIds.has(memoryId)) issues.push({ code: "orphan_memory_reference", record_type: "onboarding", record_id: value.principal_id });
    return { value, id: value.principal_id, workspace: value.workspace_id, encrypted: value.draft_entries.some((entry) => entry.sensitivity === "private") };
  });
  for (const file of storage.listJsonFiles(MEMORY_COLLECTIONS_DIR)) {
    const value = storage.readJson<MemoryCollection>(file);
    if (value.owner_workspace_id !== targetWorkspaceId) continue;
    checked += 1;
    if (!value.member_workspace_ids.includes(targetWorkspaceId)) issues.push({ code: "collection_owner_not_member", record_type: "collection", record_id: value.collection_id });
  }
  inspect("share", workspaceFiles(MEMORY_SHARES_DIR, targetWorkspaceId), (raw) => {
    const value = raw as MemoryShareGrant;
    if (!canonicalIds.has(value.source_memory_id)) issues.push({ code: "orphan_memory_reference", record_type: "share", record_id: value.share_id });
    return { value, id: value.share_id, workspace: value.source_workspace_id, encrypted: false };
  });
  inspect("conflict", workspaceFiles(MEMORY_CONFLICTS_DIR, targetWorkspaceId), (raw) => {
    const value = raw as MemoryConflictRecord;
    if (!canonicalIds.has(value.target_memory_id)) issues.push({ code: "orphan_memory_reference", record_type: "conflict", record_id: value.conflict_id });
    return { value, id: value.conflict_id, workspace: value.workspace_id, encrypted: false };
  });
  inspect("external_source", workspaceFiles(MEMORY_EXTERNAL_SOURCES_DIR, targetWorkspaceId), (raw) => {
    const value = raw as MemoryExternalSource;
    return { value, id: value.source_id, workspace: value.workspace_id, encrypted: false };
  });
  inspect("external_binding", workspaceFiles(MEMORY_EXTERNAL_BINDINGS_DIR, targetWorkspaceId), (raw) => {
    const value = raw as { memory_id?: string; workspace_id?: string; external_id?: string };
    if (!value.memory_id || !canonicalIds.has(value.memory_id)) issues.push({ code: "orphan_memory_reference", record_type: "external_binding", record_id: value.external_id || null });
    return { value, id: value.external_id || null, workspace: value.workspace_id || "", encrypted: false };
  });
  const report: MemoryIntegrityReport = {
    schema_version: 1,
    report_id: `memint_${randomUUID()}`,
    workspace_id: targetWorkspaceId,
    status: issues.length ? "degraded" : "healthy",
    checked_records: checked,
    encrypted_records: encrypted,
    invalid_records: issues.filter((item) => item.code !== "orphan_memory_reference").length,
    orphan_references: issues.filter((item) => item.code === "orphan_memory_reference").length,
    issues: issues.slice(0, 100),
    scanned_at: nowIso(),
  };
  storage.writeJson(operationPath(targetWorkspaceId, "last-integrity"), report);
  return report;
}

export function runMemoryRetention(targetWorkspaceId = workspaceId()): MemoryRetentionRunResult {
  if (targetWorkspaceId !== workspaceId()) throw new MemoryStoreError("memory_scope_mismatch", "Retention must run in the active Workspace.", 403);
  const settings = getMemorySettings(targetWorkspaceId).retention;
  const now = Date.now();
  let purged = 0;
  for (const memory of [...listAllMemories({ status: "all" })]) {
    const ageDays = (now - Date.parse(memory.updated_at)) / 86_400_000;
    if ((memory.status === "deleted" && ageDays >= settings.soft_deleted_memory_days) ||
        (memory.status === "expired" && ageDays >= settings.expired_memory_days)) {
      hardPurgeMemory(memory.memory_id);
      purged += 1;
    }
  }
  const storage = getJsonStorageBackend();
  let contexts = 0;
  for (const file of workspaceFiles(MEMORY_TURN_CONTEXTS_DIR, targetWorkspaceId)) {
    try {
      const value = deserializeTurnMemoryContext(storage.readJson(file)).snapshot;
      if (now - Date.parse(value.created_at) < settings.turn_context_days * 86_400_000) continue;
      storage.removeJson(file);
      contexts += 1;
    } catch {
      // Integrity scan reports unreadable records; retention does not delete them implicitly.
    }
  }
  let feedback = 0;
  for (const file of workspaceFiles(MEMORY_FEEDBACK_DIR, targetWorkspaceId)) {
    try {
      const value = storage.readJson<MemoryRecommendationFeedback>(file);
      if (!value.created_at || now - Date.parse(value.created_at) < settings.feedback_days * 86_400_000) continue;
      storage.removeJson(file);
      feedback += 1;
    } catch {
      // Keep malformed evidence for integrity review.
    }
  }
  let backups = 0;
  for (const file of workspaceFiles(MEMORY_BACKUPS_DIR, targetWorkspaceId)) {
    const value = storage.readJson<PersistedBackup>(file);
    if (!value.metadata.expires_at || Date.parse(value.metadata.expires_at) > now) continue;
    storage.removeJson(file);
    backups += 1;
  }
  const result: MemoryRetentionRunResult = {
    schema_version: 1,
    workspace_id: targetWorkspaceId,
    purged_memories: purged,
    pruned_contexts: contexts,
    pruned_feedback: feedback,
    pruned_backups: backups,
    completed_at: nowIso(),
  };
  storage.writeJson(operationPath(targetWorkspaceId, "last-retention"), result);
  return result;
}

export function getMemoryOperationsStatus(targetWorkspaceId = workspaceId()): MemoryOperationsStatus {
  const storage = getJsonStorageBackend();
  const integrityFile = operationPath(targetWorkspaceId, "last-integrity");
  return {
    schema_version: 1,
    workspace_id: targetWorkspaceId,
    key: getMemoryKeyStatus(targetWorkspaceId),
    retention: getMemorySettings(targetWorkspaceId).retention,
    backups: listMemoryBackups(targetWorkspaceId),
    last_integrity: storage.exists(integrityFile) ? storage.readJson<MemoryIntegrityReport>(integrityFile) : null,
  };
}
