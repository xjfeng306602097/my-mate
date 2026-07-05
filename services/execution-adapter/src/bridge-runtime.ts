import {
  BRIDGE_EXECUTION_MODE,
  MOCK_STEP_DELAY_MS,
  OPENCLAW_APPROVAL_CONSOLE_BASE_URL,
  OPENCLAW_CONTAINER_NAME,
  OPENCLAW_GATEWAY_BASE_URL,
} from "./config.js";
import { postReport } from "./callback-client.js";
import {
  OpenClawContainerAuthError,
  exportContainerTrajectory,
  evaluateDirectAgentOutcome,
  getContainerTaskSnapshot,
  runContainerOpenClawPreparation,
} from "./container-openclaw.js";
import {
  evaluateAsyncDispatchStaleness,
  shouldResumeAsyncDispatch,
} from "./async-dispatch-guard.js";
import { evaluateAsyncDispatchRecovery } from "./dispatch-recovery.js";
import {
  evaluateDispatchMaintenance,
  normalizeDispatchSessionKey,
} from "./dispatch-maintenance.js";
import { findDispatchByNode, getDispatch, listDispatches, saveDispatch } from "./dispatch-store.js";
import { runNativeOpenClawPreparation } from "./native-openclaw.js";
import type {
  ArtifactRecord,
  BridgeExecutionMode,
  ControlAction,
  DirectAgentReference,
  DispatchRepairAction,
  DispatchRecord,
  DispatchRequest,
  DispatchResponse,
  DispatchStatus,
  ReportPayload,
} from "./types.js";
import { generateDispatchId, normalizeSummaryText, nowIso, sleep } from "./utils.js";

const activeMockRuns = new Set<string>();
const activeContainerPolls = new Set<string>();

function isTerminalDispatchStatus(status: DispatchRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function buildRawRef(record: DispatchRecord): NonNullable<ReportPayload["raw_ref"]> {
  return {
    dispatch_id: record.dispatch_id,
    openclaw_task_id: record.openclaw_task_id,
    openclaw_session_id: record.openclaw_result_session_id || record.openclaw_session_id,
  };
}

async function sendReport(record: DispatchRecord, payload: ReportPayload): Promise<void> {
  await postReport(record.callback_url, record.callback_bearer_token, payload);
}

function buildDirectAgentArtifacts(record: DispatchRecord, reportText: string | null): ArtifactRecord[] {
  const items: ArtifactRecord[] = [];
  if (record.native_handoff_file) {
    items.push({
      artifact_id: `artifact_${record.dispatch_id}_handoff`,
      type: "report",
      name: `${record.dispatch_id}-handoff.json`,
      storage_uri: `file://${record.native_handoff_file.replace(/\\/g, "/")}`,
      mime_type: "application/json",
      size_bytes: 0,
    });
  }

  if (reportText) {
    items.push({
      artifact_id: `artifact_${record.dispatch_id}_agent-report`,
      type: "summary",
      name: `${record.dispatch_id}-agent-report.txt`,
      storage_uri: `bridge://dispatches/${record.dispatch_id}/agent-report`,
      mime_type: "text/plain",
      size_bytes: Buffer.byteLength(reportText, "utf-8"),
    });
  }

  return items;
}

function inferReportStatus(reportText: string | null): "completed" | "failed" | "waiting_human" {
  if (!reportText) {
    return "completed";
  }
  const normalized = reportText.toLowerCase();
  if (normalized.includes("status: blocked")) {
    return "waiting_human";
  }
  if (normalized.includes("status: failed")) {
    return "failed";
  }
  return "completed";
}

function extractReportField(reportText: string, field: string): string | null {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "im");
  const match = reportText.match(pattern);
  return match?.[1]?.trim() || null;
}

function extractReportSummary(reportText: string): string | null {
  const match = reportText.match(/summary:\s*\|([\s\S]*)$/i);
  if (!match) {
    return normalizeSummaryText(extractReportField(reportText, "summary"));
  }

  const lines = match[1]
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("[/AGENT_REPORT]"));
  return normalizeSummaryText(lines.length > 0 ? lines.join("\n").trim() : null);
}

function extractAgentReport(text: string | null): string | null {
  if (!text) {
    return null;
  }
  const start = text.indexOf("[AGENT_REPORT]");
  if (start < 0) {
    return null;
  }
  return text.slice(start).trim();
}

function clearDispatchExecutionRefs(record: DispatchRecord): DispatchRecord {
  return {
    ...record,
    openclaw_task_id: null,
    openclaw_session_id: null,
    openclaw_result_session_id: null,
    openclaw_result_session_key: null,
    openclaw_result_session_file: null,
    openclaw_result_run_id: null,
    openclaw_result_trajectory_dir: null,
    poll_started_at: null,
    last_polled_at: null,
    direct_agent: null,
  };
}

function pollDelayMs(record: DispatchRecord): number {
  const startedAt = record.poll_started_at || record.updated_at || record.created_at;
  const elapsedMs = Date.now() - Date.parse(startedAt);
  return elapsedMs >= 60_000 ? 15_000 : 5_000;
}

function resolveExecutionMode(request: DispatchRequest): BridgeExecutionMode {
  const requested = request.openclaw_runtime.execution_mode;
  if (
    requested === "mock" ||
    requested === "native-agent" ||
    requested === "container-exec"
  ) {
    return requested;
  }
  return BRIDGE_EXECUTION_MODE;
}

async function finalizeDispatchAsFailed(input: {
  record: DispatchRecord;
  code: string;
  message: string;
}): Promise<void> {
  const failed: DispatchRecord = {
    ...input.record,
    status: "failed",
    updated_at: nowIso(),
    last_error: input.message,
    last_reported_status: "failed",
  };
  saveDispatch(failed);
  await sendReport(failed, {
    run_id: failed.run_id,
    node_run_id: failed.node_run_id,
    status: "failed",
    progress: {
      percent: 100,
      message: input.message,
    },
    error: {
      code: input.code,
      message: input.message,
    },
    raw_ref: buildRawRef(failed),
    created_at: failed.updated_at,
  });
}

async function finalizeDispatchAsCancelled(input: {
  record: DispatchRecord;
  message: string;
}): Promise<void> {
  const cancelled: DispatchRecord = {
    ...input.record,
    status: "cancelled",
    updated_at: nowIso(),
    last_error: input.message,
    last_reported_status: "cancelled",
  };
  saveDispatch(cancelled);
  await sendReport(cancelled, {
    run_id: cancelled.run_id,
    node_run_id: cancelled.node_run_id,
    status: "cancelled",
    progress: {
      percent: 100,
      message: input.message,
    },
    raw_ref: buildRawRef(cancelled),
    created_at: cancelled.updated_at,
  });
}

async function finalizeDispatchTerminal(input: {
  record: DispatchRecord;
  status: Extract<DispatchStatus, "failed" | "cancelled">;
  code?: string | null;
  message: string;
}): Promise<void> {
  if (input.status === "cancelled") {
    await finalizeDispatchAsCancelled({
      record: input.record,
      message: input.message,
    });
    return;
  }

  await finalizeDispatchAsFailed({
    record: input.record,
    code: input.code || "OPENCLAW_DIRECT_AGENT_STALE_DISPATCH",
    message: input.message,
  });
}

async function finalizeAsyncDirectAgent(record: DispatchRecord): Promise<boolean> {
  const recoveryDecision = evaluateAsyncDispatchRecovery(record);
  if (recoveryDecision.action === "finalize") {
    if (recoveryDecision.status === "cancelled") {
      const cancelled: DispatchRecord = {
        ...record,
        status: "cancelled",
        updated_at: nowIso(),
        last_error: recoveryDecision.message,
        last_reported_status: "cancelled",
      };
      saveDispatch(cancelled);
      await sendReport(cancelled, {
        run_id: cancelled.run_id,
        node_run_id: cancelled.node_run_id,
        status: "cancelled",
        progress: {
          percent: 100,
          message: recoveryDecision.message,
        },
        raw_ref: buildRawRef(cancelled),
        created_at: cancelled.updated_at,
      });
      return true;
    }

    await finalizeDispatchAsFailed({
      record,
      code: recoveryDecision.errorCode,
      message: recoveryDecision.message,
    });
    return true;
  }

  const staleDecision = evaluateAsyncDispatchStaleness(record);
  if (staleDecision.shouldFinalizeAsFailed && staleDecision.code && staleDecision.message) {
    await finalizeDispatchAsFailed({
      record,
      code: staleDecision.code,
      message: staleDecision.message,
    });
    return true;
  }

  const sessionKey = record.openclaw_result_session_key;
  if (!sessionKey) {
    await finalizeDispatchAsFailed({
      record,
      code: "OPENCLAW_DIRECT_AGENT_SESSION_MISSING",
      message: "OpenClaw async direct-agent dispatch is missing its session reference.",
    });
    return true;
  }

  const task = await getContainerTaskSnapshot(sessionKey);
  const now = nowIso();
  let current = getDispatch(record.dispatch_id) || record;
  if (!task) {
    current = {
      ...current,
      updated_at: now,
      last_polled_at: now,
    };
    saveDispatch(current);
    return false;
  }

  current = {
    ...current,
    updated_at: now,
    last_polled_at: now,
    openclaw_task_id: task.taskId || current.openclaw_task_id,
    openclaw_result_run_id: task.runId || current.openclaw_result_run_id,
    openclaw_result_session_key:
      task?.childSessionKey || task?.requesterSessionKey || sessionKey,
  };

  const taskStatus = task.status || "unknown";
  const taskFailureMessage =
    task.error || task.terminalSummary || `OpenClaw task ended with status: ${taskStatus}`;
  if (taskStatus === "queued" || taskStatus === "running" || taskStatus === "pending") {
    if (current.last_reported_status !== "running") {
      current.status = "running";
      current.last_reported_status = "running";
      saveDispatch(current);
      await sendReport(current, {
        run_id: current.run_id,
        node_run_id: current.node_run_id,
        status: "running",
        progress: {
          percent: 40,
          message: "OpenClaw direct-agent task is running in the Docker runtime.",
        },
        raw_ref: buildRawRef(current),
        created_at: now,
      });
    } else {
      saveDispatch(current);
    }
    return false;
  }

  if (taskStatus === "succeeded") {
    const trajectory = await exportContainerTrajectory(
      current.openclaw_result_session_key || sessionKey,
    );
    const reportText = trajectory.reportText;
    const artifacts = buildDirectAgentArtifacts(current, reportText);
    current = {
      ...current,
      updated_at: nowIso(),
      openclaw_result_trajectory_dir: trajectory.outputDir,
    };

    if (!reportText) {
      const failed: DispatchRecord = {
        ...current,
        status: "failed",
        last_error:
          trajectory.promptError ||
          "OpenClaw direct-agent task completed but did not emit [AGENT_REPORT].",
        last_reported_status: "failed",
      };
      saveDispatch(failed);
      await sendReport(failed, {
        run_id: failed.run_id,
        node_run_id: failed.node_run_id,
        status: "failed",
        progress: {
          percent: 100,
          message:
            trajectory.promptError ||
            "OpenClaw direct-agent task completed without a normalized agent report.",
        },
        artifacts,
        error: {
          code: "OPENCLAW_DIRECT_AGENT_REPORT_MISSING",
          message:
            failed.last_error ||
            "OpenClaw direct-agent task completed without [AGENT_REPORT].",
        },
        raw_ref: buildRawRef(failed),
        created_at: failed.updated_at,
      });
      return true;
    }

    const status = inferReportStatus(reportText);
    const summary =
      extractReportSummary(reportText) || normalizeSummaryText(extractReportField(reportText, "status"));
    const completed: DispatchRecord = {
      ...current,
      status,
      last_error: null,
      last_reported_status: status,
    };
    saveDispatch(completed);

    if (status === "waiting_human") {
      await sendReport(completed, {
        run_id: completed.run_id,
        node_run_id: completed.node_run_id,
        status: "waiting_human",
        progress: {
          percent: 85,
          message:
            summary || "OpenClaw direct-agent reported blocked and is waiting for human input.",
        },
        artifacts,
        raw_ref: buildRawRef(completed),
        created_at: completed.updated_at,
      });
      return true;
    }

    if (status === "failed") {
      await sendReport(completed, {
        run_id: completed.run_id,
        node_run_id: completed.node_run_id,
        status: "failed",
        progress: {
          percent: 100,
          message: summary || "OpenClaw direct-agent reported failure.",
        },
        artifacts,
        error: {
          code: "OPENCLAW_DIRECT_AGENT_REPORTED_FAILURE",
          message: summary || "Direct agent returned failed status.",
        },
        raw_ref: buildRawRef(completed),
        created_at: completed.updated_at,
      });
      return true;
    }

    await sendReport(completed, {
      run_id: completed.run_id,
      node_run_id: completed.node_run_id,
      status: "completed",
      progress: {
        percent: 100,
        message:
          summary || "OpenClaw direct-agent execution completed and returned an AGENT_REPORT.",
      },
      artifacts,
      raw_ref: buildRawRef(completed),
      created_at: completed.updated_at,
    });
    return true;
  }

  const failed: DispatchRecord = {
    ...current,
    status: taskStatus === "cancelled" ? "cancelled" : "failed",
    updated_at: nowIso(),
    last_error: taskFailureMessage,
    last_reported_status: taskStatus === "cancelled" ? "cancelled" : "failed",
  };
  saveDispatch(failed);
  await sendReport(failed, {
    run_id: failed.run_id,
    node_run_id: failed.node_run_id,
    status: failed.status === "cancelled" ? "cancelled" : "failed",
    progress: {
      percent: 100,
          message: normalizeSummaryText(taskFailureMessage) || "OpenClaw task failed.",
    },
    error:
      failed.status === "failed"
        ? {
            code: "OPENCLAW_DIRECT_AGENT_TASK_FAILED",
            message:
              normalizeSummaryText(failed.last_error) ||
              `OpenClaw task ended with status: ${taskStatus}`,
          }
        : null,
    raw_ref: buildRawRef(failed),
    created_at: failed.updated_at,
  });
  return true;
}

async function pollContainerDispatch(dispatchId: string): Promise<void> {
  if (activeContainerPolls.has(dispatchId)) {
    return;
  }

  activeContainerPolls.add(dispatchId);
  try {
    for (;;) {
      const record = getDispatch(dispatchId);
      if (!record) {
        return;
      }
      if (record.status === "cancelled" || record.status === "completed" || record.status === "failed") {
        return;
      }

      try {
        const finished = await finalizeAsyncDirectAgent(record);
        if (finished) {
          return;
        }
      } catch (error) {
        const latest = getDispatch(dispatchId) || record;
        const errored: DispatchRecord = {
          ...latest,
          updated_at: nowIso(),
          last_polled_at: nowIso(),
          last_error: error instanceof Error ? error.message : "OpenClaw poller failed",
        };
        saveDispatch(errored);
      }

      await sleep(pollDelayMs(getDispatch(dispatchId) || record));
    }
  } finally {
    activeContainerPolls.delete(dispatchId);
  }
}

function startContainerPoller(dispatchId: string): void {
  void pollContainerDispatch(dispatchId);
}

function runStartupMaintenanceTask(task: Promise<void>, dispatchId: string): void {
  void task.catch((error) => {
    console.warn("[execution-adapter] startup dispatch maintenance failed.", {
      dispatchId,
      error: error instanceof Error ? error.message : "unknown error",
    });
  });
}

async function runMockDispatch(dispatchId: string): Promise<void> {
  if (activeMockRuns.has(dispatchId)) {
    return;
  }

  activeMockRuns.add(dispatchId);
  try {
    let record = getDispatch(dispatchId);
    if (!record) {
      return;
    }

    record.status = "running";
    record.updated_at = nowIso();
    saveDispatch(record);
    await sendReport(record, {
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      status: "running",
      progress: {
        percent: 25,
        message: `OpenClaw bridge mock running: ${record.node_name}`,
      },
      raw_ref: buildRawRef(record),
      created_at: record.updated_at,
    });

    await sleep(MOCK_STEP_DELAY_MS);
    record = getDispatch(dispatchId);
    if (!record || record.status === "cancelled") {
      return;
    }

    await sendReport(record, {
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      status: "running",
      progress: {
        percent: 70,
        message: `OpenClaw bridge mock progressing: ${record.node_name}`,
      },
      raw_ref: buildRawRef(record),
      created_at: nowIso(),
    });

    await sleep(MOCK_STEP_DELAY_MS);
    record = getDispatch(dispatchId);
    if (!record || record.status === "cancelled") {
      return;
    }

    record.status = "completed";
    record.updated_at = nowIso();
    saveDispatch(record);
    await sendReport(record, {
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      status: "completed",
      progress: {
        percent: 100,
        message: `OpenClaw bridge mock completed: ${record.node_name}`,
      },
      artifacts: [
        {
          artifact_id: `artifact_${record.dispatch_id}`,
          type: "report",
          name: `${record.node_name}-summary.txt`,
          storage_uri: `bridge://dispatches/${record.dispatch_id}/summary`,
          mime_type: "text/plain",
          size_bytes: 128,
        },
      ],
      raw_ref: buildRawRef(record),
      created_at: record.updated_at,
    });
  } finally {
    activeMockRuns.delete(dispatchId);
  }
}

async function queueNativeAgentPreparation(record: DispatchRecord): Promise<void> {
  try {
    const materialized = await runNativeOpenClawPreparation(record);
    const updated: DispatchRecord = {
      ...record,
      status: "running",
      updated_at: nowIso(),
      openclaw_task_id: materialized.taskId || record.openclaw_task_id,
      native_handoff_file: materialized.handoffFile,
      openclaw_state_path: materialized.statePath,
      openclaw_dispatch_file: materialized.dispatchFile,
    };
    saveDispatch(updated);
    await sendReport(updated, {
      run_id: updated.run_id,
      node_run_id: updated.node_run_id,
      status: "running",
      progress: {
        percent: 15,
        message:
          "OpenClaw host-runtime dispatch materialized and registered; waiting for the downstream runtime worker to consume it.",
      },
      raw_ref: buildRawRef(updated),
      created_at: updated.updated_at,
    });
  } catch (error) {
    const failed: DispatchRecord = {
      ...record,
      status: "failed",
      updated_at: nowIso(),
      last_error:
        error instanceof Error ? error.message : "Native OpenClaw preparation failed",
    };
    saveDispatch(failed);
    await sendReport(failed, {
      run_id: failed.run_id,
      node_run_id: failed.node_run_id,
      status: "failed",
      progress: {
        percent: 100,
        message: "OpenClaw native preparation failed",
      },
      error: {
        code: "OPENCLAW_NATIVE_PREPARATION_FAILED",
        message:
          error instanceof Error ? error.message : "Native OpenClaw preparation failed",
      },
      raw_ref: buildRawRef(failed),
      created_at: failed.updated_at,
    });
  }
}

async function queueContainerExecPreparation(record: DispatchRecord): Promise<void> {
  try {
    console.info("[execution-adapter] container preparation starting", {
      dispatchId: record.dispatch_id,
      runId: record.run_id,
      nodeRunId: record.node_run_id,
      nodeId: record.node_id,
    });
    const materialized = await runContainerOpenClawPreparation(record);
    console.info("[execution-adapter] container preparation finished", {
      dispatchId: record.dispatch_id,
      taskId: materialized.taskId,
      dispatchFile: materialized.dispatchFile,
    });
    const directOutcome = evaluateDirectAgentOutcome(materialized);
    const directAgent: DirectAgentReference | null = materialized.directAgent || null;
    const updated: DispatchRecord = {
      ...record,
      status: directOutcome.enabled && directOutcome.succeeded ? directOutcome.status : "running",
      updated_at: nowIso(),
      openclaw_task_id: materialized.taskId || record.openclaw_task_id,
      openclaw_session_id: directOutcome.sessionId || record.openclaw_session_id,
      native_handoff_file: materialized.handoffFile,
      openclaw_state_path: materialized.statePath,
      openclaw_dispatch_file: materialized.dispatchFile,
      openclaw_result_session_id: directOutcome.sessionId,
      openclaw_result_session_key: directAgent?.sessionKey || null,
      openclaw_result_session_file: directAgent?.sessionFile || null,
      openclaw_result_run_id: directAgent?.runId || null,
      openclaw_result_trajectory_dir: null,
      poll_started_at: directAgent?.mode === "async-task" ? nowIso() : null,
      last_polled_at: null,
      last_reported_status: directOutcome.enabled && directOutcome.succeeded ? directOutcome.status : null,
      direct_agent: directAgent,
    };
    saveDispatch(updated);

    if (directOutcome.enabled) {
      if (!directOutcome.succeeded) {
        const failed: DispatchRecord = {
          ...updated,
          status: "failed",
          updated_at: nowIso(),
          last_error: directOutcome.error,
        };
        saveDispatch(failed);
        await sendReport(failed, {
          run_id: failed.run_id,
          node_run_id: failed.node_run_id,
          status: "failed",
          progress: {
            percent: 100,
            message: "OpenClaw direct agent execution failed",
          },
          error: {
            code: "OPENCLAW_DIRECT_AGENT_FAILED",
            message: directOutcome.error || "Direct agent execution failed.",
          },
          raw_ref: buildRawRef(failed),
          created_at: failed.updated_at,
        });
        return;
      }

      if (directOutcome.status === "waiting_human") {
        await sendReport(updated, {
          run_id: updated.run_id,
          node_run_id: updated.node_run_id,
          status: "waiting_human",
          progress: {
            percent: 85,
            message:
              directOutcome.summary || "OpenClaw direct agent reported blocked and is waiting for human input.",
          },
          artifacts: directOutcome.artifacts,
          raw_ref: buildRawRef(updated),
          created_at: updated.updated_at,
        });
        return;
      }

      if (directOutcome.status === "failed") {
        await sendReport(updated, {
          run_id: updated.run_id,
          node_run_id: updated.node_run_id,
          status: "failed",
          progress: {
            percent: 100,
            message: directOutcome.summary || "OpenClaw direct agent reported failure.",
          },
          artifacts: directOutcome.artifacts,
          error: {
            code: "OPENCLAW_DIRECT_AGENT_REPORTED_FAILURE",
            message: directOutcome.summary || "Direct agent returned failed status.",
          },
          raw_ref: buildRawRef(updated),
          created_at: updated.updated_at,
        });
        return;
      }

      await sendReport(updated, {
        run_id: updated.run_id,
        node_run_id: updated.node_run_id,
        status: "completed",
        progress: {
          percent: 100,
          message:
            directOutcome.summary || "OpenClaw direct agent execution completed and returned an AGENT_REPORT.",
        },
        artifacts: directOutcome.artifacts,
        raw_ref: buildRawRef(updated),
        created_at: updated.updated_at,
      });
      return;
    }

    if (directAgent?.mode === "async-task") {
      const asyncTaskRecord: DispatchRecord = {
        ...updated,
        status: "running",
        updated_at: nowIso(),
        last_reported_status: "running",
      };
      saveDispatch(asyncTaskRecord);
      await sendReport(asyncTaskRecord, {
        run_id: asyncTaskRecord.run_id,
        node_run_id: asyncTaskRecord.node_run_id,
        status: "running",
        progress: {
          percent: 20,
          message:
            "OpenClaw direct-agent task has been started in the Docker runtime; waiting for async completion.",
        },
        raw_ref: buildRawRef(asyncTaskRecord),
        created_at: asyncTaskRecord.updated_at,
      });
      startContainerPoller(asyncTaskRecord.dispatch_id);
      return;
    }

    await sendReport(updated, {
      run_id: updated.run_id,
      node_run_id: updated.node_run_id,
      status: "running",
      progress: {
        percent: 20,
        message:
          "OpenClaw container dispatch has been registered in the live Docker runtime; subagent spawn remains a separate runtime step.",
      },
      raw_ref: buildRawRef(updated),
      created_at: updated.updated_at,
    });
  } catch (error) {
    console.warn("[execution-adapter] container preparation failed", {
      dispatchId: record.dispatch_id,
      error: error instanceof Error ? error.message : "unknown error",
    });
    const authProbeError = error instanceof OpenClawContainerAuthError ? error : null;
    const failed: DispatchRecord = {
      ...record,
      status: "failed",
      updated_at: nowIso(),
      last_error:
        error instanceof Error ? error.message : "Container OpenClaw preparation failed",
    };
    saveDispatch(failed);
    await sendReport(failed, {
      run_id: failed.run_id,
      node_run_id: failed.node_run_id,
      status: "failed",
      progress: {
        percent: 100,
        message:
          authProbeError?.message || "OpenClaw container preparation failed",
      },
      error: {
        code: authProbeError?.code || "OPENCLAW_CONTAINER_PREPARATION_FAILED",
        message:
          error instanceof Error ? error.message : "Container OpenClaw preparation failed",
      },
      raw_ref: buildRawRef(failed),
      created_at: failed.updated_at,
    });
  }
}

function queuePreparation(record: DispatchRecord): void {
  console.info("[execution-adapter] queue preparation", {
    dispatchId: record.dispatch_id,
    mode: record.mode,
    nodeId: record.node_id,
  });
  if (record.mode === "container-exec") {
    void queueContainerExecPreparation(record);
    return;
  }
  void queueNativeAgentPreparation(record);
}

export function resumeBackgroundWork(): void {
  for (const record of listDispatches()) {
    const decision = evaluateDispatchMaintenance(record);
    let current = record;

    if (decision.normalizedSessionKey) {
      current = {
        ...current,
        updated_at: nowIso(),
        openclaw_result_session_key: decision.normalizedSessionKey,
        direct_agent:
          current.direct_agent && current.direct_agent.sessionKey !== decision.normalizedSessionKey
            ? {
                ...current.direct_agent,
                sessionKey: decision.normalizedSessionKey,
              }
            : current.direct_agent,
      };
      saveDispatch(current);
    }

    if (decision.action === "align_terminal" && decision.terminalStatus) {
      const aligned: DispatchRecord = {
        ...current,
        status: decision.terminalStatus,
        updated_at: nowIso(),
        last_error: decision.message || current.last_error,
      };
      saveDispatch(aligned);
      continue;
    }

    if (decision.action === "finalize" && decision.terminalStatus && decision.message) {
      runStartupMaintenanceTask(
        finalizeDispatchTerminal({
          record: current,
          status: decision.terminalStatus === "cancelled" ? "cancelled" : "failed",
          code: decision.errorCode,
          message: decision.message,
        }),
        current.dispatch_id,
      );
      continue;
    }

    if (decision.action === "resume" && shouldResumeAsyncDispatch(current)) {
      startContainerPoller(current.dispatch_id);
    }
  }
}

export async function sweepDispatchMaintenance(): Promise<{
  scanned: number;
  normalized: number;
  resumed: number;
  aligned: number;
  finalized: number;
}> {
  const summary = {
    scanned: 0,
    normalized: 0,
    resumed: 0,
    aligned: 0,
    finalized: 0,
  };

  for (const record of listDispatches()) {
    summary.scanned += 1;
    const decision = evaluateDispatchMaintenance(record);
    let current = record;

    if (decision.normalizedSessionKey) {
      current = {
        ...current,
        updated_at: nowIso(),
        openclaw_result_session_key: decision.normalizedSessionKey,
        direct_agent:
          current.direct_agent && current.direct_agent.sessionKey !== decision.normalizedSessionKey
            ? {
                ...current.direct_agent,
                sessionKey: decision.normalizedSessionKey,
              }
            : current.direct_agent,
      };
      saveDispatch(current);
      summary.normalized += 1;
    }

    if (decision.action === "align_terminal" && decision.terminalStatus) {
      const aligned: DispatchRecord = {
        ...current,
        status: decision.terminalStatus,
        updated_at: nowIso(),
        last_error: decision.message || current.last_error,
      };
      saveDispatch(aligned);
      summary.aligned += 1;
      continue;
    }

    if (decision.action === "finalize" && decision.terminalStatus && decision.message) {
      await finalizeDispatchTerminal({
        record: current,
        status: decision.terminalStatus === "cancelled" ? "cancelled" : "failed",
        code: decision.errorCode,
        message: decision.message,
      });
      summary.finalized += 1;
      continue;
    }

    if (decision.action === "resume" && shouldResumeAsyncDispatch(current)) {
      startContainerPoller(current.dispatch_id);
      summary.resumed += 1;
    }
  }

  return summary;
}

export async function repairDispatch(input: {
  dispatchId: string;
  action: DispatchRepairAction;
  reason?: string;
}): Promise<DispatchRecord> {
  const record = getDispatch(input.dispatchId);
  if (!record) {
    throw new Error("DISPATCH_NOT_FOUND");
  }

  const reason = input.reason?.trim();
  if (input.action === "normalize_session_key") {
    const normalizedKey = normalizeDispatchSessionKey(record);
    if (!normalizedKey) {
      throw new Error("DISPATCH_SESSION_KEY_MISSING");
    }
    const nextDirectAgent =
      record.direct_agent && record.direct_agent.sessionKey !== normalizedKey
        ? {
            ...record.direct_agent,
            sessionKey: normalizedKey,
          }
        : record.direct_agent;
    if (
      record.openclaw_result_session_key === normalizedKey &&
      nextDirectAgent === record.direct_agent
    ) {
      return record;
    }
    const updated: DispatchRecord = {
      ...record,
      updated_at: nowIso(),
      openclaw_result_session_key: normalizedKey,
      direct_agent: nextDirectAgent,
    };
    saveDispatch(updated);
    if (!isTerminalDispatchStatus(updated.status) && shouldResumeAsyncDispatch(updated)) {
      startContainerPoller(updated.dispatch_id);
    }
    return updated;
  }

  if (input.action === "mark_cancelled") {
    const updated: DispatchRecord = {
      ...record,
      status: "cancelled",
      updated_at: nowIso(),
      last_error: reason || record.last_error,
      last_reported_status: "cancelled",
    };
    saveDispatch(updated);
    await sendReport(updated, {
      run_id: updated.run_id,
      node_run_id: updated.node_run_id,
      status: "cancelled",
      progress: {
        percent: 100,
        message: reason || "Dispatch cancelled by repair action.",
      },
      raw_ref: buildRawRef(updated),
      created_at: updated.updated_at,
    });
    return updated;
  }

  const updated: DispatchRecord = {
    ...record,
    status: "failed",
    updated_at: nowIso(),
    last_error: reason || "Dispatch marked failed by repair action.",
    last_reported_status: "failed",
  };
  saveDispatch(updated);
  await sendReport(updated, {
    run_id: updated.run_id,
    node_run_id: updated.node_run_id,
    status: "failed",
    progress: {
      percent: 100,
      message: updated.last_error || "Dispatch marked failed by repair action.",
    },
    error: {
      code: "OPENCLAW_DISPATCH_REPAIRED_FAILED",
      message: updated.last_error || "Dispatch marked failed by repair action.",
    },
    raw_ref: buildRawRef(updated),
    created_at: updated.updated_at,
  });
  return updated;
}

export async function createDispatch(request: DispatchRequest): Promise<DispatchResponse> {
  const dispatchId = generateDispatchId();
  const createdAt = nowIso();
  const mode = resolveExecutionMode(request);

  const record: DispatchRecord = {
    dispatch_id: dispatchId,
    run_id: request.run_id,
    node_run_id: request.node_run_id,
    node_id: request.node_id,
    node_name: request.node_name,
    openclaw_agent_id: request.openclaw_agent_id,
    status: "queued",
    mode,
    callback_url: request.callback.report_url,
    callback_bearer_token: request.callback.bearer_token,
    openclaw_task_id: mode === "mock" ? `mock-task-${request.node_run_id}` : null,
    openclaw_session_id: mode === "mock" ? `mock-session-${request.node_run_id}` : null,
    created_at: createdAt,
    updated_at: createdAt,
    last_error: null,
    native_handoff_file: null,
    openclaw_state_path: null,
    openclaw_dispatch_file: null,
    openclaw_result_session_id: null,
    openclaw_result_session_key: null,
    openclaw_result_session_file: null,
    openclaw_result_run_id: null,
    openclaw_result_trajectory_dir: null,
    poll_started_at: null,
    last_polled_at: null,
    last_reported_status: null,
    direct_agent: null,
    request_snapshot: request,
  };
  saveDispatch(record);

  await sendReport(record, {
    run_id: record.run_id,
    node_run_id: record.node_run_id,
    status: "accepted",
    progress: {
      percent: 0,
      message: "Dispatch accepted by OpenClaw bridge",
    },
    raw_ref: buildRawRef(record),
    created_at: createdAt,
  });

  if (mode === "mock") {
    void runMockDispatch(dispatchId);
  } else {
    queuePreparation(record);
  }

  return {
    dispatch_id: record.dispatch_id,
    openclaw_task_id: record.openclaw_task_id,
    openclaw_session_id: record.openclaw_session_id,
    status: "accepted",
  };
}

export async function applyControlAction(input: {
  runId: string;
  nodeRunId: string | null;
  action: ControlAction;
}): Promise<{ accepted: true }> {
  if (!input.nodeRunId) {
    return { accepted: true };
  }

  const record = getDispatchByNodeOrThrow(input.runId, input.nodeRunId);
  if (input.action === "cancel") {
    record.status = "cancelled";
    record.updated_at = nowIso();
    saveDispatch(record);
    await sendReport(record, {
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      status: "cancelled",
      progress: {
        percent: 100,
        message: "Dispatch cancelled by control action",
      },
      raw_ref: buildRawRef(record),
      created_at: record.updated_at,
    });
    return { accepted: true };
  }

  if (input.action === "retry") {
    const retried: DispatchRecord = {
      ...clearDispatchExecutionRefs(record),
      status: "queued",
      updated_at: nowIso(),
      last_error: null,
      last_reported_status: null,
    };
    saveDispatch(retried);
    await sendReport(retried, {
      run_id: retried.run_id,
      node_run_id: retried.node_run_id,
      status: "accepted",
      progress: {
        percent: 0,
        message: "Retry accepted by OpenClaw bridge",
      },
      raw_ref: buildRawRef(retried),
      created_at: retried.updated_at,
    });
    if (retried.mode === "mock") {
      void runMockDispatch(retried.dispatch_id);
    } else {
      queuePreparation(retried);
    }
    return { accepted: true };
  }

  if (input.action === "skip") {
    record.status = "completed";
    record.updated_at = nowIso();
    saveDispatch(record);
    await sendReport(record, {
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      status: "completed",
      progress: {
        percent: 100,
        message: "Dispatch skipped by control action",
      },
      raw_ref: buildRawRef(record),
      created_at: record.updated_at,
    });
    return { accepted: true };
  }

  if (input.action === "pause") {
    await sendReport(record, {
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      status: "waiting_human",
      progress: {
        percent: 50,
        message: "Dispatch paused; waiting for resume",
      },
      raw_ref: buildRawRef(record),
      created_at: nowIso(),
    });
    return { accepted: true };
  }

  if (input.action === "resume") {
    await sendReport(record, {
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      status: "running",
      progress: {
        percent: 55,
        message: "Dispatch resumed",
      },
      raw_ref: buildRawRef(record),
      created_at: nowIso(),
    });
    return { accepted: true };
  }

  return { accepted: true };
}

function getDispatchByNodeOrThrow(runId: string, nodeRunId: string): DispatchRecord {
  const all = [
    OPENCLAW_GATEWAY_BASE_URL,
    OPENCLAW_APPROVAL_CONSOLE_BASE_URL,
    OPENCLAW_CONTAINER_NAME,
  ];
  void all;
  const record = findDispatchByNode(runId, nodeRunId);
  if (!record) {
    throw new Error("DISPATCH_NOT_FOUND");
  }
  return record;
}
