import path from "node:path";
import { RUNTIME_COMPENSATIONS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";
import type { RuntimeCompensationRecord } from "./recovery-contracts.js";

function runDir(runId: string): string {
  return path.join(RUNTIME_COMPENSATIONS_DIR, encodeURIComponent(runId));
}

function recordPath(runId: string, compensationId: string): string {
  return path.join(runDir(runId), `${encodeURIComponent(compensationId)}.json`);
}

export function saveRuntimeCompensation(record: RuntimeCompensationRecord): RuntimeCompensationRecord {
  ensureDir(runDir(record.run_id));
  writeJsonAtomic(recordPath(record.run_id, record.compensation_id), record);
  return record;
}

export function getRuntimeCompensation(runId: string, compensationId: string): RuntimeCompensationRecord | null {
  const storage = getJsonStorageBackend();
  const file = recordPath(runId, compensationId);
  return storage.exists(file) ? storage.readJson<RuntimeCompensationRecord>(file) : null;
}

export function listRuntimeCompensations(runId?: string): RuntimeCompensationRecord[] {
  const storage = getJsonStorageBackend();
  const files = runId
    ? storage.listJsonFiles(runDir(runId))
    : storage.listDirs(RUNTIME_COMPENSATIONS_DIR).flatMap((dir) => storage.listJsonFiles(dir));
  return files
    .map((file) => storage.readJson<RuntimeCompensationRecord>(file))
    .sort((left, right) => left.detected_at.localeCompare(right.detected_at));
}

export function findRuntimeCompensationForJob(jobId: string): RuntimeCompensationRecord | null {
  return listRuntimeCompensations().find((record) => record.job_id === jobId) || null;
}
