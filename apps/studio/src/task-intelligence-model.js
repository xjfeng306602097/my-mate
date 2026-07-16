export const AUTONOMY_MODES = ["review_first", "assisted", "autopilot"];

export function normalizeAutonomyMode(value) {
  return AUTONOMY_MODES.includes(value) ? value : "assisted";
}

export function autonomyModeCopy(mode) {
  const normalized = normalizeAutonomyMode(mode);
  if (normalized === "review_first") {
    return {
      label: "Review first",
      detail: "Review the recommended plan before execution starts.",
    };
  }
  if (normalized === "autopilot") {
    return {
      label: "Autopilot",
      detail: "Proceed automatically inside strict validation, permission, decision, and budget boundaries.",
    };
  }
  return {
    label: "Assisted",
    detail: "Proceed with routine work and stop for risk, cost, permission, ambiguity, or quality concerns.",
  };
}

function latestTransitionFailure(messages) {
  const items = Array.isArray(messages) ? messages : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const content = items[index]?.content;
    if (content && typeof content === "object" && content.failed_transition) {
      return {
        transition: String(content.failed_transition),
        code: typeof content.error_code === "string" ? content.error_code : "",
      };
    }
  }
  return null;
}

export function deriveRepairGuidance(detail, context = {}) {
  const failure = latestTransitionFailure(detail?.messages);
  const runStatus = String(detail?.latest_run?.status || detail?.workspace_state?.run_status || "").toLowerCase();
  const routeStale = Boolean(
    detail?.mission_spec?.route?.stale ||
      detail?.mission_snapshot?.spec?.route?.stale ||
      detail?.session?.metadata?.route_stale,
  );

  if (context.modelVerified === false && !detail?.latest_run) {
    return {
      kind: "model",
      title: "Verify a model before starting work",
      detail: "The task is preserved. Verify one model connection, then return here to continue.",
      action: "open-task-settings",
      actionLabel: "Verify model",
    };
  }

  if (failure?.code === "no_published_templates") {
    return {
      kind: "workflow",
      title: "This task needs a reusable workflow",
      detail: context.templatesAvailable
        ? "Choose a published workflow or adjust the task so My Mate can select one."
        : "No published workflow is available. Add one in Library, then start the task again.",
      action: "open-task-library",
      actionLabel: context.templatesAvailable ? "Choose workflow" : "Add workflow",
    };
  }

  if (failure?.code && /provider|credential|model|fetch|connection/.test(failure.code)) {
    return {
      kind: "model",
      title: "The model connection needs attention",
      detail: "Test the configured connection and repair its endpoint, model, or credential before retrying.",
      action: "open-task-settings",
      actionLabel: "Check model",
    };
  }

  if (routeStale || failure?.code === "plan_stale") {
    return {
      kind: "plan",
      title: "Refresh the recommendation",
      detail: "The task changed after its route was prepared. Rebuild the recommendation from the latest brief.",
      action: "refresh-task-plan",
      actionLabel: "Update plan",
    };
  }

  if (failure?.code === "run_validation_failed") {
    return {
      kind: "validation",
      title: "Execution validation needs review",
      detail: "The task was not started because the recommended route still has blocking validation findings.",
      action: "review-task-plan",
      actionLabel: "Review plan",
    };
  }

  if (["failed", "cancelled", "timed_out", "timeout"].includes(runStatus)) {
    return {
      kind: "runtime",
      title: "Check available recovery",
      detail: "Scan the preserved failure state for retryable work and recovery evidence before changing the task.",
      action: "scan-task-recovery",
      actionLabel: "Check recovery",
    };
  }

  if (failure) {
    return {
      kind: "transition",
      title: "Review the last task step",
      detail: failure.code
        ? `The ${failure.transition} step stopped with ${failure.code.replaceAll("_", " ")}.`
        : `The ${failure.transition} step did not complete.`,
      action: "review-task-conversation",
      actionLabel: "Review details",
    };
  }

  return null;
}

function verdictFailed(value) {
  return ["fail", "failed", "reject", "rejected", "error"].includes(String(value || "").toLowerCase());
}

function verdictPassed(value) {
  return ["pass", "passed", "complete", "completed", "success", "not_applicable", "not_enforced"].includes(
    String(value || "").toLowerCase(),
  );
}

function latest(items) {
  return Array.isArray(items) && items.length ? items[items.length - 1] : null;
}

export function deriveResultQuality(detail) {
  const scorecard = latest(detail?.runtime_scorecards);
  const evaluation = latest(detail?.runtime_evaluations);
  const evaluationStatus = String(evaluation?.status || "").toLowerCase();
  const findings = [...(scorecard?.findings || []), ...(evaluation?.findings || [])]
    .filter((item) => item?.passed === false || ["warning", "error"].includes(item?.severity))
    .slice(0, 3)
    .map((item) => item.summary || item.detail || item.check_id || item.dimension || "Quality finding");
  const failed = [
    scorecard?.pipeline_verdict,
    scorecard?.contract_verdict,
    scorecard?.gate_verdict,
    evaluation?.pipeline_verdict,
    evaluation?.contract_verdict,
    evaluation?.evidence_verdict,
    evaluation?.quality_verdict,
    evaluation?.gate_verdict,
  ].some(verdictFailed) || findings.length > 0;

  if (["queued", "running"].includes(evaluationStatus)) {
    return {
      state: "checking",
      tone: "info",
      label: "Checking",
      title: "Quality check is running",
      detail: "Independent evaluation is still working. The result is not trusted yet.",
      findings,
      checked: false,
    };
  }

  if (failed) {
    return {
      state: "review",
      tone: "danger",
      label: "Review needed",
      title: "The result needs review",
      detail: "At least one quality, evidence, contract, or gate check did not pass.",
      findings,
      checked: true,
    };
  }

  if (!scorecard && !evaluation) {
    return {
      state: "unchecked",
      tone: "warn",
      label: "Not checked",
      title: "Quality has not been checked",
      detail: "Run deterministic checks before treating this result as trusted.",
      findings: [],
      checked: false,
    };
  }

  const scorecardPassed = Boolean(scorecard) && verdictPassed(scorecard.pipeline_verdict) && verdictPassed(scorecard.contract_verdict);
  const evaluationPassed =
    Boolean(evaluation) &&
    verdictPassed(evaluationStatus) &&
    verdictPassed(evaluation.quality_verdict) &&
    verdictPassed(evaluation.evidence_verdict);

  if (scorecardPassed && evaluationPassed) {
    return {
      state: "trusted",
      tone: "success",
      label: "Trusted",
      title: "The result passed independent checks",
      detail: "Pipeline, contract, evidence, and quality checks support this result.",
      findings: [],
      checked: true,
    };
  }

  return {
    state: "partial",
    tone: "warn",
    label: "Partially checked",
    title: "Some checks are still missing",
    detail: "Available checks did not fail, but both pipeline scorecard and independent quality evidence are required for trust.",
    findings,
    checked: true,
  };
}
