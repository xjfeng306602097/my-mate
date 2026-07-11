import path from "node:path";
import { EVALUATIONS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { markObservabilityRunDirty } from "../observability-index-dirty.js";
import { validateEvaluationResult } from "../validators.js";
import type { EvaluationResult } from "./types.js";

function runEvaluationsDir(runId: string): string {
  return path.join(EVALUATIONS_DIR, encodeURIComponent(runId));
}

function evaluationPath(runId: string, evaluationId: string): string {
  return path.join(runEvaluationsDir(runId), `${encodeURIComponent(evaluationId)}.json`);
}

export function saveEvaluation(result: EvaluationResult): EvaluationResult {
  if (!validateEvaluationResult(result)) {
    const detail = validateEvaluationResult.errors?.map((error) => `${error.instancePath} ${error.message}`).join("; ");
    throw new Error(`Evaluation validation failed: ${detail || "unknown schema error"}`);
  }
  getJsonStorageBackend().writeJson(evaluationPath(result.run_id, result.evaluation_id), result);
  markObservabilityRunDirty(result.run_id);
  return result;
}

export function getEvaluation(runId: string, evaluationId: string): EvaluationResult | null {
  const storage = getJsonStorageBackend();
  const filePath = evaluationPath(runId, evaluationId);
  return storage.exists(filePath) ? storage.readJson<EvaluationResult>(filePath) : null;
}

export function listEvaluations(runId: string): EvaluationResult[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(runEvaluationsDir(runId))
    .map((file) => storage.readJson<EvaluationResult>(file))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function listAllEvaluations(): EvaluationResult[] {
  const storage = getJsonStorageBackend();
  return storage.listDirs(EVALUATIONS_DIR).flatMap((dir) =>
    storage.listJsonFiles(dir).map((file) => storage.readJson<EvaluationResult>(file)),
  );
}

export function findEvaluationByKey(input: {
  runId: string;
  evidenceDigest: string;
  evaluatorId: string;
  evaluatorVersion: string;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
}): EvaluationResult | null {
  return listEvaluations(input.runId).find((result) =>
    result.evidence_digest === input.evidenceDigest &&
    result.evaluator.id === input.evaluatorId &&
    result.evaluator.version === input.evaluatorVersion &&
    result.evaluator.prompt_version === input.promptVersion &&
    result.evaluator.provider === input.provider &&
    result.evaluator.model === input.model,
  ) || null;
}
