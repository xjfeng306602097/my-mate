import path from "node:path";
import { RUN_PLAN_INITIAL_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { RunPlanRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";

function initialPlanPath(runId: string): string {
  return path.join(RUN_PLAN_INITIAL_DIR, `${encodeURIComponent(runId)}.json`);
}

export function saveInitialRunPlan(plan: RunPlanRecord): RunPlanRecord {
  ensureDir(RUN_PLAN_INITIAL_DIR);
  const snapshot = structuredClone(plan);
  writeJsonAtomic(initialPlanPath(plan.run_id), snapshot);
  return snapshot;
}

export function getInitialRunPlan(runId: string): RunPlanRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = initialPlanPath(runId);
  return storage.exists(filePath)
    ? storage.readJson<RunPlanRecord>(filePath)
    : null;
}
