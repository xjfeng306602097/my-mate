const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "provisioning", "dispatching"]);
const TERMINAL_SUCCESS_STATUSES = new Set(["completed", "succeeded", "success"]);
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "cancelled", "timed_out", "timeout"]);

function normalizedStatus(value, fallback = "idle") {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : fallback;
}

function latestTransitionFailure(messages) {
  const items = Array.isArray(messages) ? messages : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const content = items[index]?.content;
    if (content && typeof content === "object" && content.failed_transition) {
      return {
        transition: String(content.failed_transition),
        code: typeof content.error_code === "string" ? content.error_code : null,
      };
    }
  }
  return null;
}

function resultCount(detail) {
  const outputs = Array.isArray(detail?.mission_snapshot?.outputs) ? detail.mission_snapshot.outputs : [];
  const returnedOutputs = outputs.filter((item) => item?.status === "returned" || item?.status === "completed").length;
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts.length : 0;
  return Math.max(returnedOutputs, artifacts);
}

function routeIsStale(detail) {
  return Boolean(
    detail?.mission_spec?.route?.stale ||
      detail?.mission_snapshot?.spec?.route?.stale ||
      detail?.session?.metadata?.route_stale,
  );
}

function buildSignals(runStatus, decisionCount, results) {
  return [
    {
      label: "Progress",
      value: runStatus === "idle" ? "Ready" : runStatus.replaceAll("_", " "),
      tone: ACTIVE_RUN_STATUSES.has(runStatus)
        ? "info"
        : TERMINAL_SUCCESS_STATUSES.has(runStatus)
          ? "success"
          : TERMINAL_FAILURE_STATUSES.has(runStatus)
            ? "danger"
            : "neutral",
    },
    {
      label: "Decisions",
      value: decisionCount ? String(decisionCount) : "None",
      tone: decisionCount ? "warn" : "success",
    },
    {
      label: "Results",
      value: results ? String(results) : "Pending",
      tone: results ? "success" : "neutral",
    },
  ];
}

export function deriveTaskGuidance(detail, options = {}) {
  const session = detail?.session || null;
  if (!session) {
    return {
      phase: "intake",
      tone: "neutral",
      statusLabel: "New task",
      title: "What do you want to get done?",
      detail: "Describe the outcome. My Mate will choose the workflow, model, and agents.",
      primaryAction: null,
      primaryLabel: null,
      signals: [],
    };
  }

  const approvals = Array.isArray(detail?.pending_approvals) ? detail.pending_approvals : [];
  const humanInputs = Array.isArray(detail?.pending_human_inputs) ? detail.pending_human_inputs : [];
  const decisionCount = approvals.length + humanInputs.length;
  const runStatus = normalizedStatus(
    detail?.latest_run?.status ||
      detail?.workspace_state?.run_status ||
      session?.workspace_state?.run_status,
  );
  const sessionStatus = normalizedStatus(session?.status, "draft");
  const results = resultCount(detail);
  const transitionFailure = latestTransitionFailure(detail?.messages);
  const signals = buildSignals(runStatus, decisionCount, results);
  const repair = options.repair || null;
  const quality = options.quality || null;
  const autonomyMode = options.autonomyMode || "assisted";

  if (decisionCount || runStatus === "waiting_human" || sessionStatus === "blocked") {
    return {
      phase: "decision",
      tone: "warn",
      statusLabel: "Needs you",
      title: decisionCount === 1 ? "One decision is blocking this task" : `${Math.max(1, decisionCount)} decisions need you`,
      detail: "My Mate paused the affected work and collected only the decisions that can change risk, cost, permission, or the result.",
      primaryAction: "open-task-inbox",
      primaryLabel: "Review decision",
      signals,
    };
  }

  if (TERMINAL_FAILURE_STATUSES.has(runStatus) || TERMINAL_FAILURE_STATUSES.has(sessionStatus)) {
    return {
      phase: "recovery",
      tone: "danger",
      statusLabel: "Needs recovery",
      title: repair?.title || "The task stopped before completion",
      detail: repair?.detail || "Failure evidence and available recovery actions are preserved. Review the failure before retrying or changing the task.",
      primaryAction: repair?.action || "review-task-recovery",
      primaryLabel: repair?.actionLabel || "Review recovery",
      signals,
    };
  }

  if (TERMINAL_SUCCESS_STATUSES.has(runStatus) || TERMINAL_SUCCESS_STATUSES.has(sessionStatus)) {
    const qualityNeedsCheck = quality?.state === "unchecked";
    const qualityNeedsReview = quality?.state === "review" || quality?.state === "partial";
    return {
      phase: "result",
      tone: "success",
      statusLabel: "Complete",
      title: results ? `${results} result${results === 1 ? " is" : "s are"} ready` : "The task is complete",
      detail: results
        ? "Review the returned deliverables first. Quality, evidence, and technical history remain available below."
        : "Execution completed. Review the evidence before treating the outcome as delivered.",
      primaryAction: qualityNeedsCheck
        ? "check-task-quality"
        : qualityNeedsReview
          ? "review-task-evidence"
          : results
            ? "review-task-results"
            : "review-task-evidence",
      primaryLabel: qualityNeedsCheck
        ? "Check quality"
        : qualityNeedsReview
          ? "Review quality"
          : results
            ? "Review results"
            : "Review evidence",
      signals,
    };
  }

  if (ACTIVE_RUN_STATUSES.has(runStatus)) {
    return {
      phase: "running",
      tone: "info",
      statusLabel: "In progress",
      title: "My Mate is working on it",
      detail:
        detail?.workspace_state?.latest_run_summary ||
        detail?.workspace_state?.next_recommended_detail ||
        "Execution is being supervised. My Mate will interrupt only for a material decision or exception.",
      primaryAction: "view-task-progress",
      primaryLabel: "View progress",
      signals,
    };
  }

  if (runStatus === "paused") {
    return {
      phase: "paused",
      tone: "warn",
      statusLabel: "Paused",
      title: "Execution is paused",
      detail: "Review the current run state and resume only when the reason for pausing has been addressed.",
      primaryAction: "view-task-progress",
      primaryLabel: "Review pause",
      signals,
    };
  }

  if (routeIsStale(detail)) {
    return {
      phase: "prepare",
      tone: "warn",
      statusLabel: "Update needed",
      title: repair?.title || "The task changed after its plan was prepared",
      detail: repair?.detail || "My Mate can refresh the recommended route using the latest task brief without exposing planner internals.",
      primaryAction: repair?.action || "refresh-task-plan",
      primaryLabel: repair?.actionLabel || "Update plan",
      signals,
    };
  }

  if (transitionFailure) {
    return {
      phase: "prepare",
      tone: "warn",
      statusLabel: "Needs attention",
      title: repair?.title || "My Mate could not advance the task",
      detail: repair?.detail || (transitionFailure.code
        ? `The last ${transitionFailure.transition} step stopped with ${transitionFailure.code.replaceAll("_", " ")}. Review the conversation before trying again.`
        : `The last ${transitionFailure.transition} step did not complete. Review the conversation before trying again.`),
      primaryAction: repair?.action || "review-task-conversation",
      primaryLabel: repair?.actionLabel || "Review details",
      signals,
    };
  }

  if (repair) {
    return {
      phase: "prepare",
      tone: "warn",
      statusLabel: "Setup needed",
      title: repair.title,
      detail: repair.detail,
      primaryAction: repair.action,
      primaryLabel: repair.actionLabel,
      signals,
    };
  }

  if (detail?.workspace_state?.stage === "understand") {
    return {
      phase: "clarify",
      tone: "info",
      statusLabel: "Clarifying",
      title: "Continue the conversation with My Mate",
      detail: "Confirm the outcome and important constraints before My Mate chooses the internal route, model, and agents.",
      primaryAction: "review-task-conversation",
      primaryLabel: "Continue conversation",
      signals: signals.map((signal, index) =>
        index === 0 ? { ...signal, value: "Clarifying", tone: "info" } : signal,
      ),
    };
  }

  if (autonomyMode === "review_first") {
    return {
      phase: "ready",
      tone: "info",
      statusLabel: "Ready to review",
      title: "The recommendation is ready",
      detail: "Review the proposed plan before allowing execution to start.",
      primaryAction: "review-task-plan",
      primaryLabel: "Review plan",
      signals,
    };
  }

  return {
    phase: "ready",
    tone: "success",
    statusLabel: "Ready",
    title: autonomyMode === "autopilot" ? "Autopilot is ready" : "The task is ready to start",
    detail: autonomyMode === "autopilot"
      ? "My Mate will start routine work automatically after strict validation and will stop for policy boundaries or decisions."
      : "My Mate has enough context to choose the route and agents. Starting work uses the current task brief and verified model setup.",
    primaryAction: "start-task-work",
    primaryLabel: "Start work",
    signals,
  };
}

export function taskGuidanceDirective(action) {
  if (action === "start-task-work") return "Run this task now using the recommended route.";
  if (action === "refresh-task-plan") return "Revise the plan to reflect the latest task brief.";
  return null;
}
