import { createHash } from "node:crypto";
import { appendRunEvent } from "../event-store.js";
import { nowIso } from "../utils.js";
import { evaluatePipelineChecks } from "./checks/pipeline.js";
import { evaluateDeclarativeChecks } from "./checks/declarative.js";
import { getOrCreateRunEvidenceSnapshot } from "./run-evidence-snapshot.js";
import {
  findScorecardByEvaluationKey,
  saveScorecard,
} from "./scorecard-store.js";
import type { ScorecardResult } from "./types.js";
import type { ScorecardCheckDefinition } from "../types.js";

export interface CreateScorecardOptions {
  profile?: string;
  allowIncomplete?: boolean;
}

function policyFromSnapshot(
  snapshot: ReturnType<typeof getOrCreateRunEvidenceSnapshot>,
  requestedProfile?: string,
) {
  const raw = snapshot.effective_plan.policy_snapshot.scorecard;
  const policy = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const profile = requestedProfile?.trim() ||
    (typeof policy.profile === "string" && policy.profile.trim() ? policy.profile.trim() : "pipeline-v1");
  if (profile !== "pipeline-v1") {
    throw new Error("UNSUPPORTED_SCORECARD_PROFILE");
  }
  const policyVersion =
    typeof policy.version === "number" && Number.isInteger(policy.version) && policy.version > 0
      ? policy.version
      : 1;
  const enforcement = ["off", "advisory", "strict"].includes(String(policy.enforcement))
    ? policy.enforcement as ScorecardResult["enforcement"]
    : "advisory";
  const checks = Array.isArray(policy.checks)
    ? policy.checks as ScorecardCheckDefinition[]
    : [];
  return { profile, policyVersion, enforcement, checks };
}

function scorecardId(input: {
  runId: string;
  evidenceDigest: string;
  profile: string;
  policyVersion: number;
}): string {
  const digest = createHash("sha256")
    .update(`${input.evidenceDigest}\n${input.profile}\n${input.policyVersion}`, "utf-8")
    .digest("hex")
    .slice(0, 20);
  return `scorecard:${input.runId}:${digest}`;
}

function journalScorecard(result: ScorecardResult): void {
  appendRunEvent({
    run_id: result.run_id,
    type: "scorecard.completed",
    actor_type: "system",
    actor_id: "scorecard-engine",
    payload: {
      scorecard_id: result.scorecard_id,
      snapshot_id: result.snapshot_id,
      evidence_digest: result.evidence_digest,
      profile: result.profile,
      policy_version: result.policy_version,
      pipeline_verdict: result.pipeline_verdict,
      contract_verdict: result.contract_verdict,
      gate_verdict: result.gate_verdict,
      hard_error_count: result.hard_error_count,
      warning_count: result.warning_count,
      blind_spot_count: result.blind_spot_count,
    },
    idempotency_key: `scorecard.completed:${result.scorecard_id}`,
  });
}

export function createOrGetPipelineScorecard(
  runId: string,
  options: CreateScorecardOptions = {},
): { result: ScorecardResult; created: boolean } {
  const snapshot = getOrCreateRunEvidenceSnapshot(runId, {
    allowIncomplete: options.allowIncomplete === true,
  });
  const { profile, policyVersion, enforcement, checks } = policyFromSnapshot(
    snapshot,
    options.profile,
  );
  const existing = findScorecardByEvaluationKey({
    runId,
    evidenceDigest: snapshot.evidence_digest,
    profile,
    policyVersion,
  });
  if (existing) {
    journalScorecard(existing);
    return { result: existing, created: false };
  }

  const pipelineFindings = evaluatePipelineChecks(snapshot);
  const contractFindings = evaluateDeclarativeChecks(snapshot, checks);
  const findings = [...pipelineFindings, ...contractFindings];
  const hardErrorCount = findings.filter(
    (finding) => !finding.passed && finding.severity === "error",
  ).length;
  const warningCount = findings.filter(
    (finding) => !finding.passed && finding.severity === "warning",
  ).length;
  const blindSpotCount = findings.filter(
    (finding) => !finding.passed && finding.severity === "blind_spot",
  ).length;
  const pipelineVerdict: ScorecardResult["pipeline_verdict"] =
    pipelineFindings.some((finding) => !finding.passed && finding.severity === "error")
      ? "fail"
      : snapshot.snapshot_state === "incomplete" ||
          pipelineFindings.some((finding) => !finding.passed && finding.severity === "blind_spot")
        ? "incomplete"
        : "pass";
  const contractVerdict: ScorecardResult["contract_verdict"] =
    contractFindings.length === 0
      ? "not_applicable"
      : contractFindings.some((finding) => !finding.passed && finding.severity === "error")
        ? "fail"
        : snapshot.snapshot_state === "incomplete"
          ? "incomplete"
          : "pass";
  const gateVerdict: ScorecardResult["gate_verdict"] =
    enforcement === "strict"
      ? pipelineVerdict === "pass" && ["pass", "not_applicable"].includes(contractVerdict)
        ? "pass"
        : "reject"
      : "not_enforced";
  const result: ScorecardResult = {
    schema_version: 1,
    scorecard_id: scorecardId({
      runId,
      evidenceDigest: snapshot.evidence_digest,
      profile,
      policyVersion,
    }),
    run_id: runId,
    snapshot_id: snapshot.snapshot_id,
    evidence_digest: snapshot.evidence_digest,
    profile,
    policy_version: policyVersion,
    enforcement,
    pipeline_verdict: pipelineVerdict,
    contract_verdict: contractVerdict,
    gate_verdict: gateVerdict,
    passed_checks: findings.filter((finding) => finding.passed).length,
    total_checks: findings.length,
    hard_error_count: hardErrorCount,
    warning_count: warningCount,
    blind_spot_count: blindSpotCount,
    findings,
    created_at: nowIso(),
  };
  saveScorecard(result);
  journalScorecard(result);
  return { result, created: true };
}
