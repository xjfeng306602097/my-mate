import { createHash } from "node:crypto";
import { appendRunEvent } from "../event-store.js";
import {
  EVALUATION_MAX_ATTEMPTS,
  EVALUATION_STALE_AFTER_MS,
} from "../config.js";
import { nowIso } from "../utils.js";
import { createOrGetPipelineScorecard } from "./scorecard-engine.js";
import { buildEvaluationEvidenceView } from "./evaluator-view.js";
import {
  getEvaluatorProvider,
  registerEvaluatorProvider,
  type EvaluatorDescriptor,
  type EvaluatorOutput,
} from "./evaluator-registry.js";
import { anthropicEvaluator } from "./evaluators/anthropic.js";
import { deterministicEvaluator, noneEvaluator } from "./evaluators/builtin.js";
import {
  findEvaluationByKey,
  getEvaluation,
  listAllEvaluations,
  saveEvaluation,
} from "./evaluation-store.js";
import { getOrCreateRunEvidenceSnapshot } from "./run-evidence-snapshot.js";
import type {
  EvaluationFinding,
  EvaluationResult,
  RunEvidenceSnapshot,
  ScorecardResult,
} from "./types.js";

export interface CreateEvaluationOptions {
  evaluatorId?: string;
  allowIncomplete?: boolean;
}

const activeEvaluations = new Set<string>();

function ensureBuiltins(): void {
  for (const provider of [noneEvaluator, deterministicEvaluator, anthropicEvaluator]) {
    if (!getEvaluatorProvider(provider.descriptor().id)) registerEvaluatorProvider(provider);
  }
}

function evaluationId(input: {
  runId: string;
  evidenceDigest: string;
  evaluator: EvaluatorDescriptor;
}): string {
  const digest = createHash("sha256").update([
    input.evidenceDigest,
    input.evaluator.id,
    input.evaluator.version,
    input.evaluator.provider || "",
    input.evaluator.model || "",
    input.evaluator.prompt_version || "",
  ].join("\n"), "utf-8").digest("hex").slice(0, 20);
  return `evaluation:${input.runId}:${digest}`;
}

function scorecardFindings(scorecard: ScorecardResult): EvaluationFinding[] {
  return scorecard.findings.map((finding) => ({
    ...finding,
    dimension: finding.check_id.startsWith("contract.") ? "contract" as const : "pipeline" as const,
  }));
}

function completenessFindings(snapshot: RunEvidenceSnapshot): EvaluationFinding[] {
  const modelJobs = snapshot.runtime_jobs.filter((job) => job.agent_runtime !== "local");
  const evidencePassed = snapshot.completeness.evidence === "complete";
  const usagePassed = modelJobs.length === 0 || snapshot.completeness.usage === "complete";
  return [
    {
      check_id: "evaluation.evidence_completeness",
      dimension: "evidence",
      severity: evidencePassed ? "info" : "blind_spot",
      passed: evidencePassed,
      summary: evidencePassed ? "Runtime evidence is complete." : "Runtime evidence is incomplete or unavailable.",
      detail: `evidence=${snapshot.completeness.evidence}; blocked_redactions=${snapshot.completeness.redaction_blocked_count}`,
      evidence_refs: snapshot.evidence.map((item) => `evidence:${item.evidence_id}`),
    },
    {
      check_id: "evaluation.usage_completeness",
      dimension: "usage",
      severity: usagePassed ? "info" : "blind_spot",
      passed: usagePassed,
      summary: modelJobs.length === 0
        ? "Usage is not required for deterministic-only jobs."
        : usagePassed
          ? "Provider usage is complete."
          : "Provider usage is incomplete or unavailable.",
      detail: `model_jobs=${modelJobs.length}; usage=${snapshot.completeness.usage}; cost=${snapshot.completeness.cost}`,
      evidence_refs: snapshot.evidence.filter((item) => item.kind === "usage").map((item) => `evidence:${item.evidence_id}`),
    },
  ];
}

function baseResult(input: {
  snapshot: RunEvidenceSnapshot;
  scorecard: ScorecardResult;
  evaluator: EvaluatorDescriptor;
  status: EvaluationResult["status"];
}): EvaluationResult {
  return {
    schema_version: 1,
    evaluation_id: evaluationId({
      runId: input.snapshot.run.run_id,
      evidenceDigest: input.snapshot.evidence_digest,
      evaluator: input.evaluator,
    }),
    run_id: input.snapshot.run.run_id,
    snapshot_id: input.snapshot.snapshot_id,
    evidence_digest: input.snapshot.evidence_digest,
    scorecard_id: input.scorecard.scorecard_id,
    evaluator: input.evaluator,
    pipeline_verdict: input.scorecard.pipeline_verdict,
    contract_verdict: input.scorecard.contract_verdict,
    evidence_verdict: input.snapshot.completeness.evidence,
    usage_verdict: input.snapshot.completeness.usage,
    quality_verdict: "not_evaluated",
    gate_verdict: input.scorecard.gate_verdict,
    findings: [
      ...scorecardFindings(input.scorecard),
      ...completenessFindings(input.snapshot),
    ],
    evaluator_usage: null,
    status: input.status,
    attempt: 0,
    created_at: nowIso(),
    started_at: null,
    completed_at: null,
    error: null,
  };
}

function journal(result: EvaluationResult): void {
  appendRunEvent({
    run_id: result.run_id,
    type: "evaluation.completed",
    actor_type: "system",
    actor_id: "evaluation-engine",
    payload: {
      evaluation_id: result.evaluation_id,
      evaluator_id: result.evaluator.id,
      evaluator_kind: result.evaluator.kind,
      status: result.status,
      pipeline_verdict: result.pipeline_verdict,
      contract_verdict: result.contract_verdict,
      evidence_verdict: result.evidence_verdict,
      usage_verdict: result.usage_verdict,
      quality_verdict: result.quality_verdict,
      gate_verdict: result.gate_verdict,
    },
    idempotency_key: `evaluation.completed:${result.evaluation_id}`,
  });
}

function complete(result: EvaluationResult, output: EvaluatorOutput): EvaluationResult {
  const completed: EvaluationResult = {
    ...result,
    quality_verdict: output.quality_verdict,
    findings: [...result.findings.filter((finding) => finding.dimension !== "quality"), ...output.findings],
    evaluator_usage: output.usage,
    status: "completed",
    completed_at: nowIso(),
    error: null,
  };
  saveEvaluation(completed);
  journal(completed);
  return completed;
}

async function processModelEvaluation(runId: string, id: string): Promise<void> {
  const key = `${runId}:${id}`;
  if (activeEvaluations.has(key)) return;
  activeEvaluations.add(key);
  try {
    const stored = getEvaluation(runId, id);
    if (!stored || !["queued", "running"].includes(stored.status)) return;
    const provider = getEvaluatorProvider(stored.evaluator.id);
    if (!provider || provider.descriptor().kind !== "model") throw new Error("Configured model evaluator is unavailable.");
    const snapshot = getOrCreateRunEvidenceSnapshot(runId);
    const running: EvaluationResult = {
      ...stored,
      status: "running",
      attempt: stored.attempt + 1,
      started_at: nowIso(),
      completed_at: null,
      error: null,
    };
    saveEvaluation(running);
    try {
      const output = await provider.evaluate({ snapshot, view: buildEvaluationEvidenceView(snapshot) });
      complete(running, output);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model evaluator failed.";
      if (running.attempt < EVALUATION_MAX_ATTEMPTS) {
        saveEvaluation({ ...running, status: "queued", error: message });
        const timer = setTimeout(() => scheduleModelEvaluation(runId, id), 100);
        timer.unref?.();
      } else {
        const failed: EvaluationResult = {
          ...running,
          quality_verdict: "error",
          status: "failed",
          completed_at: nowIso(),
          error: message,
          findings: [
            ...running.findings.filter((finding) => finding.dimension !== "quality"),
            {
              check_id: "quality.model_evaluator",
              dimension: "quality",
              severity: "blind_spot",
              passed: false,
              summary: "Model evaluator did not produce a valid quality verdict.",
              detail: message,
              evidence_refs: [],
            },
          ],
        };
        saveEvaluation(failed);
        journal(failed);
      }
    }
  } finally {
    activeEvaluations.delete(key);
  }
}

export function scheduleModelEvaluation(runId: string, evaluationIdValue: string): void {
  queueMicrotask(() => void processModelEvaluation(runId, evaluationIdValue));
}

export async function createOrGetEvaluation(
  runId: string,
  options: CreateEvaluationOptions = {},
): Promise<{ result: EvaluationResult; created: boolean; asynchronous: boolean }> {
  ensureBuiltins();
  const snapshot = getOrCreateRunEvidenceSnapshot(runId, { allowIncomplete: options.allowIncomplete === true });
  const scorecard = createOrGetPipelineScorecard(runId, { allowIncomplete: options.allowIncomplete === true }).result;
  const provider = getEvaluatorProvider(options.evaluatorId || "none");
  if (!provider) throw new Error("UNSUPPORTED_EVALUATOR");
  const descriptor = provider.descriptor();
  const existing = findEvaluationByKey({
    runId,
    evidenceDigest: snapshot.evidence_digest,
    evaluatorId: descriptor.id,
    evaluatorVersion: descriptor.version,
    promptVersion: descriptor.prompt_version,
    provider: descriptor.provider,
    model: descriptor.model,
  });
  if (existing) {
    if (existing.status === "queued") scheduleModelEvaluation(runId, existing.evaluation_id);
    return { result: existing, created: false, asynchronous: descriptor.kind === "model" };
  }
  const result = baseResult({
    snapshot,
    scorecard,
    evaluator: descriptor,
    status: descriptor.kind === "model" ? "queued" : "running",
  });
  saveEvaluation(result);
  if (descriptor.kind === "model") {
    scheduleModelEvaluation(runId, result.evaluation_id);
    return { result, created: true, asynchronous: true };
  }
  const running = { ...result, attempt: 1, started_at: nowIso() };
  saveEvaluation(running);
  const output = await provider.evaluate({ snapshot, view: buildEvaluationEvidenceView(snapshot) });
  return { result: complete(running, output), created: true, asynchronous: false };
}

export function recoverPendingEvaluations(now = Date.now()): {
  queued: number;
  recovered: number;
  failed: number;
} {
  ensureBuiltins();
  let queued = 0;
  let recovered = 0;
  let failed = 0;
  for (const result of listAllEvaluations()) {
    if (result.status === "queued") {
      queued += 1;
      scheduleModelEvaluation(result.run_id, result.evaluation_id);
      continue;
    }
    if (result.status !== "running") continue;
    const started = Date.parse(result.started_at || result.created_at);
    if (Number.isFinite(started) && now - started < EVALUATION_STALE_AFTER_MS) continue;
    if (result.attempt >= EVALUATION_MAX_ATTEMPTS) {
      const terminal: EvaluationResult = {
        ...result,
        quality_verdict: "error",
        status: "failed",
        completed_at: nowIso(),
        error: "Stale model evaluation exhausted its retry budget during recovery.",
      };
      saveEvaluation(terminal);
      journal(terminal);
      failed += 1;
    } else {
      saveEvaluation({ ...result, status: "queued", error: "Recovered stale model evaluation." });
      scheduleModelEvaluation(result.run_id, result.evaluation_id);
      recovered += 1;
    }
  }
  return { queued, recovered, failed };
}
