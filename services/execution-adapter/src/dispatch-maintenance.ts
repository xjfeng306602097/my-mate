import {
  evaluateAsyncDispatchStaleness,
  isAsyncDirectAgentDispatch,
  shouldResumeAsyncDispatch,
} from "./async-dispatch-guard.js";
import { evaluateAsyncDispatchRecovery } from "./dispatch-recovery.js";
import type { DispatchRecord, DispatchStatus } from "./types.js";

type TerminalDispatchStatus = Extract<DispatchStatus, "completed" | "failed" | "cancelled">;

const TERMINAL_STATUSES = new Set<TerminalDispatchStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export interface DispatchMaintenanceDecision {
  normalizedSessionKey: string | null;
  action: "none" | "resume" | "align_terminal" | "finalize";
  terminalStatus: TerminalDispatchStatus | null;
  errorCode: string | null;
  message: string | null;
  reason: string;
}

function isTerminalStatus(
  status: DispatchRecord["status"] | DispatchRecord["last_reported_status"] | null,
): status is TerminalDispatchStatus {
  return !!status && TERMINAL_STATUSES.has(status as TerminalDispatchStatus);
}

export function normalizeDispatchSessionKey(record: DispatchRecord): string | null {
  const sessionKey = record.direct_agent?.sessionKey || record.openclaw_result_session_key;
  if (!sessionKey) {
    return null;
  }

  const marker = "bridge-disp_";
  const index = sessionKey.indexOf(marker);
  if (index < 0) {
    return sessionKey;
  }

  const prefix = sessionKey.slice(0, index + marker.length);
  const suffix = sessionKey.slice(index + marker.length).toLowerCase();
  return `${prefix}${suffix}`;
}

export function evaluateDispatchMaintenance(
  record: DispatchRecord,
  nowMs = Date.now(),
): DispatchMaintenanceDecision {
  const normalizedSessionKey = normalizeDispatchSessionKey(record);
  const normalizedChanged =
    !!normalizedSessionKey && normalizedSessionKey !== record.openclaw_result_session_key;

  if (
    !isTerminalStatus(record.status) &&
    isTerminalStatus(record.last_reported_status)
  ) {
    return {
      normalizedSessionKey: normalizedChanged ? normalizedSessionKey : null,
      action: "align_terminal",
      terminalStatus: record.last_reported_status,
      errorCode: null,
      message:
        record.last_error ||
        `Dispatch state drifted after reporting terminal status ${record.last_reported_status}.`,
      reason: "repair local dispatch state from the last reported terminal status",
    };
  }

  if (isAsyncDirectAgentDispatch(record) && !isTerminalStatus(record.status)) {
    const recovery = evaluateAsyncDispatchRecovery(record, nowMs);
    if (recovery.action === "finalize") {
      return {
        normalizedSessionKey: normalizedChanged ? normalizedSessionKey : null,
        action: "finalize",
        terminalStatus: recovery.status,
        errorCode: recovery.errorCode,
        message: recovery.message,
        reason: "async dispatch recovery detected a stale unfinished record",
      };
    }

    const stale = evaluateAsyncDispatchStaleness(record, nowMs);
    if (stale.shouldFinalizeAsFailed && stale.code && stale.message) {
      return {
        normalizedSessionKey: normalizedChanged ? normalizedSessionKey : null,
        action: "finalize",
        terminalStatus: "failed",
        errorCode: stale.code,
        message: stale.message,
        reason: "async dispatch staleness guard marked the poller as unhealthy",
      };
    }

    if (shouldResumeAsyncDispatch(record)) {
      return {
        normalizedSessionKey: normalizedChanged ? normalizedSessionKey : null,
        action: "resume",
        terminalStatus: null,
        errorCode: null,
        message: null,
        reason: normalizedChanged
          ? "normalize session key and resume async dispatch polling"
          : "resume unfinished async dispatch polling",
      };
    }
  }

  if (normalizedChanged) {
    return {
      normalizedSessionKey,
      action: "none",
      terminalStatus: null,
      errorCode: null,
      message: null,
      reason: "normalize stored async session key",
    };
  }

  return {
    normalizedSessionKey: null,
    action: "none",
    terminalStatus: null,
    errorCode: null,
    message: null,
    reason: "no maintenance action required",
  };
}
