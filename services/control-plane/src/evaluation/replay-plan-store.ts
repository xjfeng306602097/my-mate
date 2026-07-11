import path from "node:path";
import { REPLAY_PLANS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { validateReplayPlanResult } from "../validators.js";
import type { ReplayPlanResult } from "./types.js";

function runReplayPlansDir(runId: string): string {
  return path.join(REPLAY_PLANS_DIR, encodeURIComponent(runId));
}

function replayPlanPath(runId: string, replayPlanId: string): string {
  return path.join(runReplayPlansDir(runId), `${encodeURIComponent(replayPlanId)}.json`);
}

export function saveReplayPlan(result: ReplayPlanResult): ReplayPlanResult {
  if (!validateReplayPlanResult(result)) {
    const detail = validateReplayPlanResult.errors
      ?.map((error) => `${error.instancePath} ${error.message}`)
      .join("; ");
    throw new Error(`Replay plan validation failed: ${detail || "unknown schema error"}`);
  }
  getJsonStorageBackend().writeJson(
    replayPlanPath(result.run_id, result.replay_plan_id),
    result,
  );
  return result;
}

export function getReplayPlan(runId: string, replayPlanId: string): ReplayPlanResult | null {
  const storage = getJsonStorageBackend();
  const filePath = replayPlanPath(runId, replayPlanId);
  return storage.exists(filePath) ? storage.readJson<ReplayPlanResult>(filePath) : null;
}

export function listReplayPlans(runId: string): ReplayPlanResult[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(runReplayPlansDir(runId))
    .map((file) => storage.readJson<ReplayPlanResult>(file))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function findReplayPlanByKey(input: {
  runId: string;
  replayId: string;
  scorecardId: string | null;
  evaluationId: string | null;
}): ReplayPlanResult | null {
  return listReplayPlans(input.runId).find((result) =>
    result.replay_id === input.replayId &&
    result.scorecard_id === input.scorecardId &&
    result.evaluation_id === input.evaluationId,
  ) || null;
}
