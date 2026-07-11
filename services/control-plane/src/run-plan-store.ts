import path from "node:path";
import { normalizeExecutionRef } from "./execution-ref.js";
import { RUN_PLANS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { RunPlanRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";
import { validateRunPlan } from "./validators.js";
import { normalizeCompiledWorkPackage } from "./work-package.js";

function runPlanPath(runId: string): string {
  return path.join(RUN_PLANS_DIR, `${runId}.json`);
}

function assertValidRunPlan(plan: RunPlanRecord): void {
  const ok = validateRunPlan(plan);
  if (!ok) {
    const errorText =
      validateRunPlan.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ") ||
      "unknown schema error";
    throw new Error(`RunPlan validation failed: ${errorText}`);
  }
}

function normalizeRunPlanRecord(plan: RunPlanRecord): RunPlanRecord {
  return {
    ...plan,
    compiled_nodes: plan.compiled_nodes.map((node, index) => ({
      ...node,
      execution_ref: normalizeExecutionRef(node.execution_ref),
      work_package: normalizeCompiledWorkPackage(node, index),
    })),
  };
}

export function saveRunPlan(plan: RunPlanRecord): RunPlanRecord {
  ensureDir(RUN_PLANS_DIR);
  const normalized = normalizeRunPlanRecord(plan);
  assertValidRunPlan(normalized);
  writeJsonAtomic(runPlanPath(normalized.run_id), normalized);
  return normalized;
}

export function getRunPlan(runId: string): RunPlanRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = runPlanPath(runId);
  if (!storage.exists(filePath)) {
    return null;
  }
  return normalizeRunPlanRecord(storage.readJson<RunPlanRecord>(filePath));
}
