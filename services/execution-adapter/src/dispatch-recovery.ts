import type { DispatchRecord, DispatchStatus } from "./types.js";

export interface RecoveryDecisionContinue {
  action: "continue";
}

export interface RecoveryDecisionFinalize {
  action: "finalize";
  status: Extract<DispatchStatus, "failed" | "cancelled">;
  errorCode: string;
  message: string;
}

export type RecoveryDecision = RecoveryDecisionContinue | RecoveryDecisionFinalize;

const STALE_DISPATCH_MS = 30 * 60 * 1000;
const FAILED_EXIT_STALE_MS = 5 * 60 * 1000;

function parseTime(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function elapsedMs(sinceIso: string | null, nowMs: number): number | null {
  const since = parseTime(sinceIso);
  if (since === null) {
    return null;
  }
  return Math.max(0, nowMs - since);
}

function hasMeaningfulLaunchFailure(record: DispatchRecord): boolean {
  const direct = record.direct_agent;
  if (!direct || direct.mode !== "async-task") {
    return false;
  }

  if ((direct.exitCode ?? 0) !== 0) {
    return true;
  }

  const stderr = direct.stderr.trim().toLowerCase();
  if (!stderr) {
    return false;
  }

  return (
    stderr.includes("fallbacksummaryerror") ||
    stderr.includes("token is expired") ||
    stderr.includes("gateway agent timed out") ||
    stderr.includes("llm request timed out") ||
    stderr.includes("failovererror") ||
    stderr.includes("embedded run agent end")
  );
}

export function evaluateAsyncDispatchRecovery(
  record: DispatchRecord,
  nowMs = Date.now(),
): RecoveryDecision {
  if (
    record.mode !== "container-exec" ||
    record.status !== "running" ||
    record.direct_agent?.mode !== "async-task"
  ) {
    return { action: "continue" };
  }

  const sinceLastPoll =
    elapsedMs(record.last_polled_at || record.poll_started_at || record.updated_at, nowMs) ??
    0;
  const sincePollStart =
    elapsedMs(record.poll_started_at || record.updated_at || record.created_at, nowMs) ?? 0;

  if (hasMeaningfulLaunchFailure(record) && sinceLastPoll >= FAILED_EXIT_STALE_MS) {
    return {
      action: "finalize",
      status: "failed",
      errorCode: "OPENCLAW_DIRECT_AGENT_STALE_FAILED_LAUNCH",
      message:
        record.direct_agent?.stderr.trim() ||
        "OpenClaw direct-agent launch failed earlier and the async dispatch never recovered.",
    };
  }

  if (sincePollStart >= STALE_DISPATCH_MS && sinceLastPoll >= STALE_DISPATCH_MS) {
    return {
      action: "finalize",
      status: "failed",
      errorCode: "OPENCLAW_DIRECT_AGENT_STALE_DISPATCH",
      message:
        "OpenClaw async direct-agent dispatch remained running without terminal progress for over 30 minutes.",
    };
  }

  return { action: "continue" };
}
