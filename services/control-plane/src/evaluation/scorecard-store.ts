import path from "node:path";
import { SCORECARDS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { markObservabilityRunDirty } from "../observability-index-dirty.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";
import type { ScorecardResult } from "./types.js";
import { validateScorecardResult } from "../validators.js";

function runScorecardsDir(runId: string): string {
  return path.join(SCORECARDS_DIR, encodeURIComponent(runId));
}

function scorecardPath(runId: string, scorecardId: string): string {
  return path.join(runScorecardsDir(runId), `${encodeURIComponent(scorecardId)}.json`);
}

function normalizeScorecard(result: ScorecardResult): ScorecardResult {
  return {
    ...result,
    contract_verdict: result.contract_verdict || "not_applicable",
  };
}

export function saveScorecard(result: ScorecardResult): ScorecardResult {
  if (!validateScorecardResult(result)) {
    const detail = validateScorecardResult.errors
      ?.map((error) => `${error.instancePath} ${error.message}`)
      .join("; ");
    throw new Error(`Scorecard validation failed: ${detail || "unknown schema error"}`);
  }
  ensureDir(runScorecardsDir(result.run_id));
  writeJsonAtomic(scorecardPath(result.run_id, result.scorecard_id), result);
  markObservabilityRunDirty(result.run_id);
  return result;
}

export function getScorecard(runId: string, scorecardId: string): ScorecardResult | null {
  const storage = getJsonStorageBackend();
  const filePath = scorecardPath(runId, scorecardId);
  return storage.exists(filePath) ? normalizeScorecard(storage.readJson<ScorecardResult>(filePath)) : null;
}

export function listScorecards(runId: string): ScorecardResult[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(runScorecardsDir(runId))
    .map((file) => normalizeScorecard(storage.readJson<ScorecardResult>(file)))
    .sort((left, right) =>
      right.created_at.localeCompare(left.created_at) ||
      left.scorecard_id.localeCompare(right.scorecard_id),
    );
}

export function findScorecardByEvaluationKey(input: {
  runId: string;
  evidenceDigest: string;
  profile: string;
  policyVersion: number;
}): ScorecardResult | null {
  return (
    listScorecards(input.runId).find(
      (result) =>
        result.evidence_digest === input.evidenceDigest &&
        result.profile === input.profile &&
        result.policy_version === input.policyVersion,
    ) || null
  );
}
