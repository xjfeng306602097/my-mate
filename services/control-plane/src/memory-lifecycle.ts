import path from "node:path";
import { MEMORIES_DIR, MEMORY_CANDIDATES_DIR, MEMORY_MAINTENANCE_DIR, MEMORY_SETTINGS_DIR } from "./config.js";
import { expireMemory, listAllMemories, migratePrivateMemoryRecordsAtRest } from "./memory-store.js";
import { recordMemoryMaintenance, recordMemoryMaintenanceSweep } from "./memory-observability.js";
import { invalidatePrivateMemoryKnowledgeTriples } from "./memory-knowledge-provider.js";
import { getMemoryRetrievalIndexStatus, rebuildMemoryRetrievalIndex } from "./memory-retrieval-index.js";
import { getMemorySettings } from "./memory-settings-store.js";
import { getActiveWorkspaceId, runWithSystemWorkspaceContext } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { MemoryCandidateRecord, MemoryMaintenanceResult, MemoryMaintenanceSweepResult } from "./types.js";
import { nowIso } from "./utils.js";
import { listWorkspaceRecords } from "./workspace-store.js";

function maintenancePath(workspaceId: string): string {
  return path.join(MEMORY_MAINTENANCE_DIR, `${encodeURIComponent(workspaceId)}.json`);
}

export function getLastMemoryMaintenance(workspaceId = getActiveWorkspaceId() || "default"): MemoryMaintenanceResult | null {
  const file = maintenancePath(workspaceId);
  const storage = getJsonStorageBackend();
  return storage.exists(file) ? storage.readJson<MemoryMaintenanceResult>(file) : null;
}

function runCurrentWorkspaceMemoryMaintenance(): MemoryMaintenanceResult {
  const startedAt = Date.now();
  const workspaceId = getActiveWorkspaceId() || "default";
  const settings = getMemorySettings(workspaceId);
  const storage = getJsonStorageBackend();
  const migration = migratePrivateMemoryRecordsAtRest(workspaceId);
  invalidatePrivateMemoryKnowledgeTriples();
  const now = nowIso();
  let expiredMemories = 0;
  for (const memory of listAllMemories({ status: "active" })) {
    const expired = (memory.expires_at && memory.expires_at <= now) || (memory.valid_until && memory.valid_until <= now);
    if (expired && expireMemory(memory.memory_id)) expiredMemories += 1;
  }
  const cutoff = Date.now() - settings.retention.resolved_candidate_days * 86_400_000;
  let prunedCandidates = 0;
  const candidateDir = path.join(MEMORY_CANDIDATES_DIR, encodeURIComponent(workspaceId));
  for (const file of storage.listJsonFiles(candidateDir)) {
    const candidate = storage.readJson<MemoryCandidateRecord>(file);
    if (candidate.status === "pending" || !candidate.resolved_at || Date.parse(candidate.resolved_at) > cutoff) continue;
    storage.removeJson(file);
    prunedCandidates += 1;
  }
  let retrievalRebuilt = false;
  try {
    const status = getMemoryRetrievalIndexStatus();
    if (status.journal_records > settings.retention.journal_max_records || expiredMemories > 0) {
      rebuildMemoryRetrievalIndex();
      retrievalRebuilt = true;
    }
  } catch {
    rebuildMemoryRetrievalIndex();
    retrievalRebuilt = true;
  }
  const result: MemoryMaintenanceResult = {
    schema_version: 1,
    workspace_id: workspaceId,
    expired_memories: expiredMemories,
    pruned_candidates: prunedCandidates,
    retrieval_rebuilt: retrievalRebuilt,
    canonical_memories: listAllMemories({ status: "all" }).length,
    private_memories_migrated: migration.memories,
    private_candidates_migrated: migration.candidates,
    duration_ms: Date.now() - startedAt,
    completed_at: nowIso(),
  };
  storage.writeJson(maintenancePath(workspaceId), result);
  recordMemoryMaintenance(retrievalRebuilt, migration);
  return result;
}

export function runMemoryMaintenance(workspaceId?: string): MemoryMaintenanceResult {
  const targetWorkspaceId = workspaceId || getActiveWorkspaceId() || "default";
  if ((getActiveWorkspaceId() || "default") === targetWorkspaceId) {
    return runCurrentWorkspaceMemoryMaintenance();
  }
  return runWithSystemWorkspaceContext(targetWorkspaceId, runCurrentWorkspaceMemoryMaintenance);
}

export function listMemoryWorkspaceIds(): string[] {
  const storage = getJsonStorageBackend();
  const ids = new Set(["default", ...listWorkspaceRecords().map((workspace) => workspace.workspace_id)]);
  for (const directory of storage.listDirs(MEMORIES_DIR)) {
    try {
      ids.add(decodeURIComponent(path.basename(directory)));
    } catch {
      // Ignore malformed legacy directory names.
    }
  }
  for (const file of storage.listJsonFiles(MEMORY_SETTINGS_DIR)) {
    try {
      ids.add(decodeURIComponent(path.basename(file, ".json")));
    } catch {
      // Ignore malformed legacy settings names.
    }
  }
  return [...ids].filter(Boolean).sort();
}

export function runMemoryMaintenanceSweep(input: { dueOnly?: boolean; now?: number } = {}): MemoryMaintenanceSweepResult {
  const workspaceIds = listMemoryWorkspaceIds();
  const now = input.now ?? Date.now();
  const results: MemoryMaintenanceResult[] = [];
  const failedWorkspaces: MemoryMaintenanceSweepResult["failed_workspaces"] = [];
  let skippedWorkspaces = 0;
  for (const workspaceId of workspaceIds) {
    try {
      const shouldRun = runWithSystemWorkspaceContext(workspaceId, () => {
        if (input.dueOnly === false) return true;
        const settings = getMemorySettings(workspaceId);
        const lastRun = getLastMemoryMaintenance(workspaceId);
        const elapsed = lastRun ? now - Date.parse(lastRun.completed_at) : Number.POSITIVE_INFINITY;
        return elapsed >= settings.retention.maintenance_interval_minutes * 60_000;
      });
      if (!shouldRun) {
        skippedWorkspaces += 1;
        continue;
      }
      results.push(runMemoryMaintenance(workspaceId));
    } catch (error) {
      failedWorkspaces.push({
        workspace_id: workspaceId,
        error: error instanceof Error ? error.message : "Memory maintenance failed.",
      });
    }
  }
  const sweep: MemoryMaintenanceSweepResult = {
    schema_version: 1,
    workspace_count: workspaceIds.length,
    maintained_workspaces: results.length,
    skipped_workspaces: skippedWorkspaces,
    failed_workspaces: failedWorkspaces,
    results,
    completed_at: nowIso(),
  };
  recordMemoryMaintenanceSweep(failedWorkspaces.length);
  return sweep;
}
