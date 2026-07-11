import path from "node:path";
import { RUN_INITIALIZATION_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { RunInitializationRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";

function initializationPath(runId: string): string {
  return path.join(RUN_INITIALIZATION_DIR, `${encodeURIComponent(runId)}.json`);
}

export function saveRunInitialization(
  record: RunInitializationRecord,
): RunInitializationRecord {
  ensureDir(RUN_INITIALIZATION_DIR);
  writeJsonAtomic(initializationPath(record.run_id), record);
  return record;
}

export function getRunInitialization(runId: string): RunInitializationRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = initializationPath(runId);
  return storage.exists(filePath)
    ? storage.readJson<RunInitializationRecord>(filePath)
    : null;
}
