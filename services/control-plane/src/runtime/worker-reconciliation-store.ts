import path from "node:path";
import { DIAGNOSTICS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";
import type { WorkerCleanupResult, WorkerContainerInventoryRecord } from "../node-provisioner.js";

export interface WorkerReconciliationRecord {
  schema_version: 1;
  reconciliation_id: string;
  reason: string;
  status: "healthy" | "degraded" | "failed";
  started_at: string;
  completed_at: string;
  discovered_containers: WorkerContainerInventoryRecord[];
  matched_lease_ids: string[];
  orphan_container_ids: string[];
  removed_container_ids: string[];
  retained_container_ids: string[];
  cleanup_results: WorkerCleanupResult[];
  inventory_error: string | null;
}

function reconciliationPath(): string {
  return path.join(DIAGNOSTICS_DIR, "worker-reconciliation.json");
}

export function saveWorkerReconciliationRecord(
  record: WorkerReconciliationRecord,
): WorkerReconciliationRecord {
  ensureDir(DIAGNOSTICS_DIR);
  writeJsonAtomic(reconciliationPath(), record);
  return record;
}

export function getWorkerReconciliationRecord(): WorkerReconciliationRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = reconciliationPath();
  return storage.exists(filePath)
    ? storage.readJson<WorkerReconciliationRecord>(filePath)
    : null;
}
