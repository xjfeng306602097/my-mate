import type { DispatchRecord, DispatchStatus } from "./types.js";

export interface AsyncDispatchGuardDecision {
  shouldFinalizeAsFailed: boolean;
  code: string | null;
  message: string | null;
}

const TERMINAL_STATUSES = new Set<DispatchStatus | "queued">([
  "completed",
  "failed",
  "cancelled",
]);

function isIsoTimestamp(value: string | null): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function minutesBetween(startIso: string, endMs: number): number {
  return Math.max(0, (endMs - Date.parse(startIso)) / 60_000);
}

export function isAsyncDirectAgentDispatch(record: DispatchRecord): boolean {
  return (
    record.mode === "container-exec" &&
    record.direct_agent?.mode === "async-task" &&
    !!record.openclaw_result_session_key
  );
}

export function shouldResumeAsyncDispatch(record: DispatchRecord): boolean {
  return isAsyncDirectAgentDispatch(record) && !TERMINAL_STATUSES.has(record.status);
}

export function evaluateAsyncDispatchStaleness(
  record: DispatchRecord,
  nowMs: number = Date.now(),
): AsyncDispatchGuardDecision {
  if (!isAsyncDirectAgentDispatch(record)) {
    return {
      shouldFinalizeAsFailed: false,
      code: null,
      message: null,
    };
  }

  const directAgent = record.direct_agent;
  if (directAgent && directAgent.exitCode !== null && directAgent.exitCode !== 0) {
    const stderr = directAgent.stderr.trim();
    const stdout = directAgent.stdout.trim();
    return {
      shouldFinalizeAsFailed: true,
      code: "OPENCLAW_DIRECT_AGENT_START_FAILED",
      message:
        stderr ||
        stdout ||
        `OpenClaw direct-agent task launcher exited with code ${directAgent.exitCode}.`,
    };
  }

  const pollStart = isIsoTimestamp(record.poll_started_at)
    ? record.poll_started_at
    : isIsoTimestamp(record.created_at)
      ? record.created_at
      : null;
  const lastPoll = isIsoTimestamp(record.last_polled_at) ? record.last_polled_at : null;

  if (pollStart && lastPoll) {
    const pollAgeMinutes = minutesBetween(lastPoll, nowMs);
    const runAgeMinutes = minutesBetween(pollStart, nowMs);
    if (pollAgeMinutes >= 20 && runAgeMinutes >= 20) {
      return {
        shouldFinalizeAsFailed: true,
        code: "OPENCLAW_DIRECT_AGENT_POLL_STALE",
        message:
          `OpenClaw async poller has not updated for ${Math.floor(pollAgeMinutes)} minute(s). ` +
          "Marking dispatch as stale.",
      };
    }
  }

  return {
    shouldFinalizeAsFailed: false,
    code: null,
    message: null,
  };
}
