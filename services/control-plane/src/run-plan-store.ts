import fs from "node:fs";
import path from "node:path";
import { RUN_PLANS_DIR } from "./config.js";
import type { RunPlanRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";
import { validateRunPlan } from "./validators.js";

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

export function saveRunPlan(plan: RunPlanRecord): RunPlanRecord {
  ensureDir(RUN_PLANS_DIR);
  assertValidRunPlan(plan);
  writeJsonAtomic(runPlanPath(plan.run_id), plan);
  return plan;
}

export function getRunPlan(runId: string): RunPlanRecord | null {
  const filePath = runPlanPath(runId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as RunPlanRecord;
}
