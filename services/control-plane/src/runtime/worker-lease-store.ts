import path from "node:path";
import { WORKER_LEASES_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import type { WorkerLease } from "../runtime-protocol.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";

export type WorkerLeaseStatus =
  | "provisioning"
  | "ready"
  | "active"
  | "stale"
  | "cleanup_pending"
  | "cleanup_failed"
  | "released"
  | "failed";

export interface WorkerLeaseCleanupRecord {
  attempt_id: string;
  attempt: number;
  status: "pending" | "succeeded" | "failed";
  reason: string;
  container_ref: string | null;
  started_at: string;
  completed_at: string | null;
  last_error: string | null;
}

export interface WorkerLeaseRecord extends WorkerLease {
  job_id: string;
  status: WorkerLeaseStatus;
  last_heartbeat_at: string | null;
  released_at: string | null;
  release_reason: string | null;
  last_error: string | null;
  cleanup?: WorkerLeaseCleanupRecord | null;
}

function runLeasesDir(runId: string): string {
  return path.join(WORKER_LEASES_DIR, encodeURIComponent(runId));
}

function leasePath(runId: string, leaseId: string): string {
  return path.join(runLeasesDir(runId), `${encodeURIComponent(leaseId)}.json`);
}

export function saveWorkerLeaseRecord(record: WorkerLeaseRecord): WorkerLeaseRecord {
  ensureDir(runLeasesDir(record.run_id));
  writeJsonAtomic(leasePath(record.run_id, record.lease_id), record);
  return record;
}

export function getWorkerLeaseRecord(runId: string, leaseId: string): WorkerLeaseRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = leasePath(runId, leaseId);
  return storage.exists(filePath) ? storage.readJson<WorkerLeaseRecord>(filePath) : null;
}

export function listWorkerLeaseRecords(runId?: string): WorkerLeaseRecord[] {
  const storage = getJsonStorageBackend();
  const files = runId
    ? storage.listJsonFiles(runLeasesDir(runId))
    : storage
        .listDirs(WORKER_LEASES_DIR)
        .flatMap((dir) => storage.listJsonFiles(dir));
  return files
    .map((file) => storage.readJson<WorkerLeaseRecord>(file))
    .sort((a, b) => a.acquired_at.localeCompare(b.acquired_at));
}

export function findActiveWorkerLeaseForJob(jobId: string): WorkerLeaseRecord | null {
  return (
    listWorkerLeaseRecords().find(
      (record) =>
        record.job_id === jobId &&
        ["provisioning", "ready", "active"].includes(record.status),
    ) || null
  );
}

export function findActiveWorkerLeaseForWorker(workerId: string): WorkerLeaseRecord | null {
  return (
    listWorkerLeaseRecords().find(
      (record) =>
        record.worker_id === workerId &&
        ["provisioning", "ready", "active", "stale"].includes(record.status),
    ) || null
  );
}
