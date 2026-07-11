import { createHash } from "node:crypto";
import { getEvaluation, listEvaluations } from "./evaluation-store.js";
import { getScorecard, listScorecards } from "./scorecard-store.js";
import { nowIso } from "../utils.js";
import { createOrGetReplay } from "./replay-engine.js";
import {
  findReplayPlanByKey,
  saveReplayPlan,
} from "./replay-plan-store.js";
import { projectTraceSpans } from "./trace-projector.js";
import type {
  EvaluationResult,
  ReplayPlanCategory,
  ReplayPlanRecommendation,
  ReplayPlanResult,
  ReplayResult,
  ScorecardFinding,
  ScorecardResult,
} from "./types.js";

function recommendationId(input: {
  runId: string;
  category: ReplayPlanCategory;
  summary: string;
}): string {
  const digest = createHash("sha256")
    .update(`${input.runId}\n${input.category}\n${input.summary}`, "utf-8")
    .digest("hex")
    .slice(0, 16);
  return `recommendation:${digest}`;
}

function replayPlanId(input: {
  runId: string;
  replayId: string;
  scorecardId: string | null;
  evaluationId: string | null;
}): string {
  const digest = createHash("sha256")
    .update([input.replayId, input.scorecardId || "", input.evaluationId || ""].join("\n"), "utf-8")
    .digest("hex")
    .slice(0, 20);
  return `replay-plan:${input.runId}:${digest}`;
}

function categoryForDifference(category: ReplayResult["projection_differences"][number]["category"]): ReplayPlanCategory {
  if (category === "job" || category === "worker" || category === "lease") return "scheduler_dispatch";
  if (category === "handoff") return "handoff_contract";
  if (category === "artifact") return "artifact_contract";
  if (category === "evidence") return "evidence_completeness";
  if (category === "gate") return "human_gate";
  return "runtime_environment";
}

function categoryForFinding(finding: ScorecardFinding): ReplayPlanCategory {
  const id = finding.check_id.toLowerCase();
  if (id.includes("handoff")) return "handoff_contract";
  if (id.includes("artifact")) return "artifact_contract";
  if (id.includes("evidence") || finding.severity === "blind_spot") return "evidence_completeness";
  if (id.includes("tool") || id.includes("provider")) return "provider_harness";
  if (id.includes("approval") || id.includes("human")) return "human_gate";
  if (id.includes("usage") || id.includes("budget") || id.includes("cost")) return "budget_usage";
  if (id.startsWith("quality.")) return "prompt_agent_assignment";
  return "policy_evaluator";
}

function addRecommendation(
  target: ReplayPlanRecommendation[],
  input: Omit<ReplayPlanRecommendation, "recommendation_id"> & { runId: string },
): void {
  if (target.some((item) => item.category === input.category && item.summary === input.summary)) return;
  target.push({
    recommendation_id: recommendationId(input),
    category: input.category,
    priority: input.priority,
    summary: input.summary,
    rationale: input.rationale,
    change_target: input.change_target,
    references: [...new Set(input.references)],
  });
}

function selectScorecard(runId: string, scorecardId?: string | null): ScorecardResult | null {
  return scorecardId ? getScorecard(runId, scorecardId) : listScorecards(runId)[0] || null;
}

function selectEvaluation(runId: string, evaluationId?: string | null): EvaluationResult | null {
  return evaluationId ? getEvaluation(runId, evaluationId) : listEvaluations(runId)[0] || null;
}

export function createOrGetReplayPlan(
  runId: string,
  options: { scorecardId?: string | null; evaluationId?: string | null } = {},
): { result: ReplayPlanResult; created: boolean } {
  const replay = createOrGetReplay(runId).result;
  const scorecard = selectScorecard(runId, options.scorecardId);
  const evaluation = selectEvaluation(runId, options.evaluationId);
  if (options.scorecardId && !scorecard) throw new Error("SCORECARD_NOT_FOUND");
  if (options.evaluationId && !evaluation) throw new Error("EVALUATION_NOT_FOUND");
  const key = {
    runId,
    replayId: replay.replay_id,
    scorecardId: scorecard?.scorecard_id || null,
    evaluationId: evaluation?.evaluation_id || null,
  };
  const existing = findReplayPlanByKey(key);
  if (existing) return { result: existing, created: false };

  const trace = projectTraceSpans(runId);
  const recommendations: ReplayPlanRecommendation[] = [];
  if (replay.event_completeness === "legacy_partial") {
    addRecommendation(recommendations, {
      runId,
      category: "evidence_completeness",
      priority: "high",
      summary: "Preserve a complete V2 lifecycle journal before relying on replay verification.",
      rationale: "The source run lacks a complete immutable event sequence, so replay can only report partial truth.",
      change_target: "event journal and run initialization",
      references: [replay.replay_id, ...replay.missing_references],
    });
  }
  for (const item of replay.projection_differences) {
    addRecommendation(recommendations, {
      runId,
      category: categoryForDifference(item.category),
      priority: item.severity === "error" ? "high" : "medium",
      summary: `Reconcile ${item.category} projection ${item.record_id}.${item.field}.`,
      rationale: item.summary,
      change_target: `${item.category} projector/reducer contract`,
      references: [replay.replay_id, `${item.category}:${item.record_id}`],
    });
  }
  if (replay.missing_references.length > 0) {
    addRecommendation(recommendations, {
      runId,
      category: "evidence_completeness",
      priority: "high",
      summary: "Restore missing replay references or emit their lifecycle events.",
      rationale: `${replay.missing_references.length} event reference(s) could not be resolved against persisted projections.`,
      change_target: "runtime event emission and projection persistence",
      references: [replay.replay_id, ...replay.missing_references],
    });
  }
  for (const finding of scorecard?.findings.filter((item) => !item.passed) || []) {
    addRecommendation(recommendations, {
      runId,
      category: categoryForFinding(finding),
      priority: finding.severity === "error" ? "high" : "medium",
      summary: finding.summary,
      rationale: finding.detail,
      change_target: finding.check_id.startsWith("contract.") ? "template scorecard policy" : "runtime pipeline",
      references: [scorecard!.scorecard_id, `finding:${finding.check_id}`, ...finding.evidence_refs],
    });
  }
  for (const finding of evaluation?.findings.filter((item) => !item.passed) || []) {
    addRecommendation(recommendations, {
      runId,
      category: categoryForFinding(finding),
      priority: finding.severity === "error" ? "high" : "medium",
      summary: finding.summary,
      rationale: finding.detail,
      change_target: finding.dimension === "quality" ? "prompt or agent assignment" : "evaluation policy",
      references: [evaluation!.evaluation_id, `finding:${finding.check_id}`, ...finding.evidence_refs],
    });
  }
  const usageFinding = evaluation?.findings.find(
    (finding) => finding.check_id === "evaluation.usage_completeness",
  );
  if (
    evaluation &&
    ["partial", "unavailable"].includes(evaluation.usage_verdict) &&
    usageFinding?.passed === false
  ) {
    addRecommendation(recommendations, {
      runId,
      category: "budget_usage",
      priority: "medium",
      summary: "Capture complete provider usage before making budget or cost decisions.",
      rationale: `Evaluation usage verdict is ${evaluation.usage_verdict}.`,
      change_target: "provider usage adapter and pricing catalog",
      references: [evaluation.evaluation_id],
    });
  }
  const errorSpans = trace.spans.filter((span) => span.status === "error");
  const openTools = trace.spans.filter((span) => span.kind === "tool" && span.status === "unknown");
  if (errorSpans.length > 0) {
    addRecommendation(recommendations, {
      runId,
      category: "provider_harness",
      priority: "high",
      summary: "Inspect error spans before changing prompts or rerunning the workflow.",
      rationale: `${errorSpans.length} trace span(s) ended in an error state.`,
      change_target: "provider/harness execution path",
      references: errorSpans.map((span) => `span:${span.span_id}`),
    });
  }
  if (openTools.length > 0) {
    addRecommendation(recommendations, {
      runId,
      category: "provider_harness",
      priority: "medium",
      summary: "Close unmatched tool calls with provider-native result evidence.",
      rationale: `${openTools.length} tool call span(s) have no matching result.`,
      change_target: "provider tool-call normalization",
      references: openTools.map((span) => `span:${span.span_id}`),
    });
  }

  const result: ReplayPlanResult = {
    schema_version: 1,
    replay_plan_id: replayPlanId(key),
    run_id: runId,
    replay_id: replay.replay_id,
    scorecard_id: scorecard?.scorecard_id || null,
    evaluation_id: evaluation?.evaluation_id || null,
    trace_completeness: trace.completeness,
    recommendations,
    summary: recommendations.length === 0
      ? "Replay, persisted projections, and available evaluation evidence are aligned; no remediation is proposed."
      : `${recommendations.length} categorized remediation recommendation(s) were generated without modifying runtime configuration.`,
    created_at: nowIso(),
  };
  return { result: saveReplayPlan(result), created: true };
}
