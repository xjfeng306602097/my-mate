import path from "node:path";
import { RUNTIME_WORKERS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";

export type RuntimeWorkerStatus =
  | "expected"
  | "connected"
  | "busy"
  | "stale"
  | "disconnected"
  | "released";

export interface RuntimeWorkerRecord {
  worker_id: string;
  status: RuntimeWorkerStatus;
  version: string;
  capabilities: string[];
  supported_harnesses: string[];
  harness_capabilities?: Record<string, {
    controls: Array<"pause" | "resume" | "cancel">;
    native_human_gate: boolean;
  }>;
  active_job_id: string | null;
  expected_at: string | null;
  registered_at: string | null;
  last_heartbeat_at: string | null;
  disconnected_at: string | null;
  released_at: string | null;
  metadata: Record<string, unknown>;
}

function workerPath(workerId: string): string {
  return path.join(RUNTIME_WORKERS_DIR, `${encodeURIComponent(workerId)}.json`);
}

export function saveRuntimeWorkerRecord(record: RuntimeWorkerRecord): RuntimeWorkerRecord {
  ensureDir(RUNTIME_WORKERS_DIR);
  writeJsonAtomic(workerPath(record.worker_id), record);
  return record;
}

export function getRuntimeWorkerRecord(workerId: string): RuntimeWorkerRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = workerPath(workerId);
  return storage.exists(filePath) ? storage.readJson<RuntimeWorkerRecord>(filePath) : null;
}

export function listRuntimeWorkerRecords(): RuntimeWorkerRecord[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(RUNTIME_WORKERS_DIR)
    .map((file) => storage.readJson<RuntimeWorkerRecord>(file))
    .sort((a, b) =>
      (b.last_heartbeat_at || b.registered_at || b.expected_at || "").localeCompare(
        a.last_heartbeat_at || a.registered_at || a.expected_at || "",
      ),
    );
}
