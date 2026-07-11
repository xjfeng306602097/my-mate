import type { ScorecardCheckDefinition } from "../../types.js";
import { evaluateDeterministicAssertion } from "../checks/declarative.js";
import type { EvaluatorProvider } from "../evaluator-registry.js";

function policyChecks(value: unknown): ScorecardCheckDefinition[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const scorecard = (value as Record<string, unknown>).scorecard;
  if (!scorecard || typeof scorecard !== "object" || Array.isArray(scorecard)) return [];
  const checks = (scorecard as Record<string, unknown>).checks;
  return Array.isArray(checks) ? checks as ScorecardCheckDefinition[] : [];
}

export const noneEvaluator: EvaluatorProvider = {
  descriptor: () => ({
    id: "none",
    kind: "none",
    version: "1",
    provider: null,
    model: null,
    prompt_version: null,
  }),
  async evaluate() {
    return { quality_verdict: "not_evaluated", findings: [], usage: null };
  },
};

export const deterministicEvaluator: EvaluatorProvider = {
  descriptor: () => ({
    id: "deterministic-v1",
    kind: "deterministic",
    version: "1",
    provider: null,
    model: null,
    prompt_version: null,
  }),
  async evaluate(context) {
    const checks = policyChecks(context.snapshot.effective_plan.policy_snapshot)
      .filter((check): check is Extract<ScorecardCheckDefinition, { type: "deterministic_assertion" }> =>
        check.type === "deterministic_assertion" && check.quality === true,
      );
    if (checks.length === 0) {
      return { quality_verdict: "not_evaluated", findings: [], usage: null };
    }
    const findings = checks.map((check) => {
      const result = evaluateDeterministicAssertion(context.snapshot, check);
      return {
        ...result,
        check_id: `quality.${check.id}`,
        dimension: "quality" as const,
      };
    });
    return {
      quality_verdict: findings.some((finding) => !finding.passed && finding.severity === "error")
        ? "fail"
        : "pass",
      findings,
      usage: null,
    };
  },
};
