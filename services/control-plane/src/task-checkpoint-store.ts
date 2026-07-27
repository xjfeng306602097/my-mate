import { randomUUID } from "node:crypto";
import path from "node:path";
import { TASK_CHECKPOINTS_DIR } from "./config.js";
import type { ConversationProviderEvidence } from "./conversation-provider.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  AutopilotMode,
  LongTaskRuntimeState,
  SessionRecord,
  TaskCheckpointReason,
  TaskCheckpointRecord,
  TaskCheckpointStatus,
} from "./types.js";
import { nowIso } from "./utils.js";
import {
  TASK_CHECKPOINT_LIFECYCLE,
  assertLifecycleTransition,
  parseLifecycleStatus,
} from "@my-mate/shared-types/domain-lifecycle";
import { assertSchemaValid, validateTaskCheckpoint } from "./validators.js";

const DEFAULT_MAX_RESUME_ATTEMPTS = 8;
const DEFAULT_LONG_TASK_MAX_WALL_TIME_MS = 2 * 60 * 60 * 1_000;
const DEFAULT_LONG_TASK_MAX_TURN_ATTEMPTS = 12;
const DEFAULT_LONG_TASK_MAX_TOTAL_TOKENS = 4_000_000;

function sessionDir(workspaceId: string, sessionId: string): string {
  return path.join(TASK_CHECKPOINTS_DIR, encodeURIComponent(workspaceId), encodeURIComponent(sessionId));
}

function checkpointPath(workspaceId: string, sessionId: string, checkpointId: string): string {
  return path.join(sessionDir(workspaceId, sessionId), `${encodeURIComponent(checkpointId)}.json`);
}

function sessionMode(session: SessionRecord): AutopilotMode {
  const mode = session.metadata?.autonomy_mode;
  return mode === "review_first" || mode === "autopilot" ? mode : "assisted";
}

function boundedText(value: string | null | undefined, maxLength = 2_000): string | null {
  const normalized = value?.trim() || "";
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
}

export function taskCheckpointContextSummary(session: SessionRecord): string | null {
  const rolling = typeof session.metadata?.conversation_context_summary === "string"
    ? session.metadata.conversation_context_summary.trim()
    : "";
  const snapshot = session.metadata?.conversation_loop_context_snapshot;
  const loop = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) &&
    typeof (snapshot as Record<string, unknown>).summary === "string"
    ? String((snapshot as Record<string, unknown>).summary).trim()
    : "";
  return boundedText([rolling, loop && loop !== rolling ? loop : null].filter(Boolean).join("\n\n"), 8_000);
}

function saveCheckpoint(checkpoint: TaskCheckpointRecord): TaskCheckpointRecord {
  const storage = getJsonStorageBackend();
  const normalized = {
    ...checkpoint,
    status: parseLifecycleStatus(TASK_CHECKPOINT_LIFECYCLE, checkpoint.status),
  };
  const target = checkpointPath(checkpoint.workspace_id, checkpoint.session_id, checkpoint.checkpoint_id);
  if (storage.exists(target)) {
    const previous = storage.readJson<TaskCheckpointRecord>(target);
    assertLifecycleTransition(
      TASK_CHECKPOINT_LIFECYCLE,
      parseLifecycleStatus(TASK_CHECKPOINT_LIFECYCLE, previous.status),
      normalized.status,
    );
  }
  assertSchemaValid(validateTaskCheckpoint, normalized, "TaskCheckpoint");
  storage.writeJson(target, normalized);
  return normalized;
}

function normalizeCheckpoint(record: TaskCheckpointRecord): TaskCheckpointRecord {
  const status = parseLifecycleStatus(TASK_CHECKPOINT_LIFECYCLE, record.status);
  if (record.long_task_runtime?.schema_version === 1) {
    const runtime = record.long_task_runtime;
    const reported = runtime.cumulative_reported_input_tokens ?? 0;
    const estimated = runtime.cumulative_estimated_input_tokens ?? Math.max(0, runtime.cumulative_input_tokens - reported);
    const normalized: TaskCheckpointRecord = {
      ...record,
      status,
      long_task_runtime: {
        ...runtime,
        cumulative_reported_input_tokens: reported,
        cumulative_estimated_input_tokens: estimated,
        input_token_accounting: runtime.input_token_accounting || (
          estimated > 0 ? reported > 0 ? "mixed" : "estimated" : reported > 0 ? "reported" : "unavailable"
        ),
      },
    };
    assertSchemaValid(validateTaskCheckpoint, normalized, "TaskCheckpoint");
    return normalized;
  }
  const startedAt = record.created_at || nowIso();
  const elapsed = Math.max(0, Date.now() - Date.parse(startedAt));
  const normalized: TaskCheckpointRecord = {
    ...record,
    status,
    max_resume_attempts: Math.max(record.max_resume_attempts || 0, DEFAULT_MAX_RESUME_ATTEMPTS),
    long_task_runtime: {
      schema_version: 1,
      started_at: startedAt,
      updated_at: record.updated_at || startedAt,
      elapsed_ms: Number.isFinite(elapsed) ? elapsed : 0,
      turn_attempts: Math.max(1, (record.resume_attempts || 0) + 1),
      resume_attempts: record.resume_attempts || 0,
      cumulative_input_tokens: 0,
      cumulative_reported_input_tokens: 0,
      cumulative_estimated_input_tokens: 0,
      input_token_accounting: "unavailable",
      cumulative_output_tokens: 0,
      cumulative_total_tokens: 0,
      max_wall_time_ms: DEFAULT_LONG_TASK_MAX_WALL_TIME_MS,
      max_turn_attempts: DEFAULT_LONG_TASK_MAX_TURN_ATTEMPTS,
      max_total_tokens: DEFAULT_LONG_TASK_MAX_TOTAL_TOKENS,
      cost_status: "unavailable",
      cumulative_costs: {},
      exhausted: false,
      exhausted_reason: null,
    },
  };
  assertSchemaValid(validateTaskCheckpoint, normalized, "TaskCheckpoint");
  return normalized;
}

export function listTaskCheckpoints(sessionId: string, workspaceId?: string): TaskCheckpointRecord[] {
  const targetWorkspaceId = workspaceId || getActiveWorkspaceId() || "default";
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(sessionDir(targetWorkspaceId, sessionId))
    .map((file) => normalizeCheckpoint(storage.readJson<TaskCheckpointRecord>(file)))
    .filter((record) => record.workspace_id === targetWorkspaceId && record.session_id === sessionId)
    .sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at) || right.checkpoint_id.localeCompare(left.checkpoint_id),
    );
}

export function getTaskCheckpoint(
  sessionId: string,
  checkpointId: string,
  workspaceId?: string,
): TaskCheckpointRecord | null {
  const targetWorkspaceId = workspaceId || getActiveWorkspaceId() || "default";
  const storage = getJsonStorageBackend();
  const file = checkpointPath(targetWorkspaceId, sessionId, checkpointId);
  if (!storage.exists(file)) return null;
  const record = normalizeCheckpoint(storage.readJson<TaskCheckpointRecord>(file));
  return record.workspace_id === targetWorkspaceId && record.session_id === sessionId ? record : null;
}

export function getLatestTaskCheckpoint(sessionId: string, workspaceId?: string): TaskCheckpointRecord | null {
  return listTaskCheckpoints(sessionId, workspaceId)[0] || null;
}

export function transitionTaskCheckpoint(
  checkpoint: TaskCheckpointRecord,
  input: {
    status: TaskCheckpointStatus;
    reason: TaskCheckpointReason;
    detail?: string | null;
    sourceAssistantMessageId?: string | null;
    progressSummary?: string | null;
    contextSummary?: string | null;
    nextAction?: string | null;
    providerEvidence?: ConversationProviderEvidence | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    longTaskRuntime?: LongTaskRuntimeState;
  },
): TaskCheckpointRecord {
  assertLifecycleTransition(TASK_CHECKPOINT_LIFECYCLE, checkpoint.status, input.status);
  const timestamp = nowIso();
  const version = checkpoint.version + 1;
  const provider = input.providerEvidence;
  return saveCheckpoint({
    ...checkpoint,
    status: input.status,
    reason: input.reason,
    version,
    source_assistant_message_id: input.sourceAssistantMessageId ?? checkpoint.source_assistant_message_id,
    progress_summary: input.progressSummary === undefined
      ? checkpoint.progress_summary
      : boundedText(input.progressSummary),
    context_summary: input.contextSummary === undefined
      ? checkpoint.context_summary
      : boundedText(input.contextSummary, 8_000),
    next_action: input.nextAction === undefined ? checkpoint.next_action : boundedText(input.nextAction, 1_000),
    provider_state: provider
      ? {
          finish_reason: provider.finish_reason,
          continuation_rounds: provider.continuation_rounds,
          continuation_limit_reached: provider.continuation_limit_reached,
          context_compacted: provider.context_compacted,
          compaction_count: provider.compaction_count,
          in_loop_compaction_count: provider.in_loop_compaction_count,
          context_snapshot_id: provider.context_snapshot_id,
          context_pressure_peak_tokens: provider.context_pressure_peak_tokens,
          pruned_tool_result_count: provider.pruned_tool_result_count,
          repeated_tool_call_limit_reached: provider.repeated_tool_call_limit_reached,
          tool_rounds: provider.tool_rounds,
          tool_round_limit_reached: provider.tool_round_limit_reached,
          action_ids: [...provider.action_ids],
          completion_contract: structuredClone(provider.completion_contract),
        }
      : checkpoint.provider_state,
    long_task_runtime: input.longTaskRuntime || checkpoint.long_task_runtime,
    last_error_code: input.errorCode === undefined ? checkpoint.last_error_code : input.errorCode,
    last_error_message: input.errorMessage === undefined
      ? checkpoint.last_error_message
      : boundedText(input.errorMessage, 2_000),
    transitions: [
      ...checkpoint.transitions,
      {
        version,
        status: input.status,
        reason: input.reason,
        detail: boundedText(input.detail, 1_000),
        created_at: timestamp,
      },
    ].slice(-50),
    updated_at: timestamp,
    completed_at: input.status === "completed" || input.status === "failed" ? timestamp : null,
  });
}

export function beginTaskCheckpoint(input: {
  session: SessionRecord;
  sourceUserMessageId: string;
  resumeFrom?: TaskCheckpointRecord | null;
  automaticResume?: boolean;
}): TaskCheckpointRecord {
  const workspaceId = input.session.workspace_id || "default";
  const mode = sessionMode(input.session);
  const previous = input.resumeFrom || null;
  if (previous) {
    if (previous.status !== "resumable") throw new Error("TASK_CHECKPOINT_NOT_RESUMABLE");
    if (previous.resume_attempts >= previous.max_resume_attempts) {
      return transitionTaskCheckpoint(previous, {
        status: "failed",
        reason: "resume_limit",
        detail: "The bounded automatic resume budget was exhausted.",
        nextAction: "Review the checkpoint and explicitly retry with new guidance.",
      });
    }
    if (input.automaticResume && !previous.auto_resume_eligible) {
      throw new Error("TASK_CHECKPOINT_AUTO_RESUME_FORBIDDEN");
    }
    const timestamp = nowIso();
    const version = previous.version + 1;
    const resumeReason: TaskCheckpointReason = input.automaticResume
      ? "automatic_resume"
      : "manual_resume";
    return saveCheckpoint({
      ...previous,
      status: "in_progress",
      reason: resumeReason,
      version,
      resume_attempts: previous.resume_attempts + 1,
      last_error_code: null,
      last_error_message: null,
      transitions: [
        ...previous.transitions,
        {
          version,
          status: "in_progress" as const,
          reason: resumeReason,
          detail: "Resuming from the persisted task checkpoint.",
          created_at: timestamp,
        },
      ].slice(-50),
      updated_at: timestamp,
      completed_at: null,
    });
  }

  const latest = getLatestTaskCheckpoint(input.session.session_id, workspaceId);
  if (latest && (latest.status === "resumable" || latest.status === "in_progress")) {
    transitionTaskCheckpoint(latest, {
      status: "superseded",
      reason: "new_user_turn",
      detail: "A new user turn replaced the previous continuation path.",
    });
  }
  const timestamp = nowIso();
  const checkpoint: TaskCheckpointRecord = {
    schema_version: 1,
    checkpoint_id: `taskcp_${randomUUID()}`,
    workspace_id: workspaceId,
    session_id: input.session.session_id,
    autonomy_mode: mode,
    status: "in_progress",
    reason: "turn_started",
    version: 1,
    goal: boundedText(input.session.current_goal, 4_000),
    source_user_message_id: input.sourceUserMessageId,
    source_assistant_message_id: null,
    resume_from_checkpoint_id: null,
    resume_attempts: 0,
    max_resume_attempts: DEFAULT_MAX_RESUME_ATTEMPTS,
    auto_resume_eligible: mode !== "review_first",
    progress_summary: "Conversation turn started.",
    context_summary: taskCheckpointContextSummary(input.session),
    next_action: "Complete the current model turn.",
    provider_state: null,
    long_task_runtime: {
      schema_version: 1,
      started_at: timestamp,
      updated_at: timestamp,
      elapsed_ms: 0,
      turn_attempts: 1,
      resume_attempts: 0,
      cumulative_input_tokens: 0,
      cumulative_reported_input_tokens: 0,
      cumulative_estimated_input_tokens: 0,
      input_token_accounting: "unavailable",
      cumulative_output_tokens: 0,
      cumulative_total_tokens: 0,
      max_wall_time_ms: DEFAULT_LONG_TASK_MAX_WALL_TIME_MS,
      max_turn_attempts: DEFAULT_LONG_TASK_MAX_TURN_ATTEMPTS,
      max_total_tokens: DEFAULT_LONG_TASK_MAX_TOTAL_TOKENS,
      cost_status: "unavailable",
      cumulative_costs: {},
      exhausted: false,
      exhausted_reason: null,
    },
    last_error_code: null,
    last_error_message: null,
    transitions: [{
      version: 1,
      status: "in_progress",
      reason: "turn_started",
      detail: "Checkpoint persisted before model execution.",
      created_at: timestamp,
    }],
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
  };
  return saveCheckpoint(checkpoint);
}

export function updateTaskCheckpointLongTaskRuntime(
  checkpoint: TaskCheckpointRecord,
  runtime: LongTaskRuntimeState,
): TaskCheckpointRecord {
  return saveCheckpoint({
    ...checkpoint,
    long_task_runtime: runtime,
    updated_at: nowIso(),
  });
}

export function markInterruptedCheckpointsForRecovery(): TaskCheckpointRecord[] {
  const storage = getJsonStorageBackend();
  const recovered: TaskCheckpointRecord[] = [];
  for (const workspaceDir of storage.listDirs(TASK_CHECKPOINTS_DIR)) {
    for (const checkpointSessionDir of storage.listDirs(workspaceDir)) {
      const records = storage.listJsonFiles(checkpointSessionDir)
        .map((file) => storage.readJson<TaskCheckpointRecord>(file));
      const latest = records.sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
      if (!latest) continue;
      if (latest.status === "resumable") {
        recovered.push(latest);
        continue;
      }
      if (latest.status === "in_progress") {
        recovered.push(transitionTaskCheckpoint(latest, {
          status: "resumable",
          reason: "server_restart",
          detail: "The Control Plane restarted before this turn reached a terminal checkpoint state.",
          nextAction: latest.auto_resume_eligible
            ? "Automatically resume the interrupted turn from persisted progress."
            : "Resume the interrupted turn after user authorization.",
        }));
      }
    }
  }
  return recovered;
}

export function taskCheckpointResumePrompt(checkpoint: TaskCheckpointRecord): string {
  return [
    "TASK_CHECKPOINT_RESUME: Continue the interrupted task from the persisted checkpoint.",
    "Do not restart completed work and do not claim success without evidence.",
    checkpoint.goal ? `Goal: ${checkpoint.goal}` : null,
    checkpoint.progress_summary ? `Progress so far: ${checkpoint.progress_summary}` : null,
    checkpoint.context_summary ? `Compacted task context: ${checkpoint.context_summary}` : null,
    checkpoint.next_action ? `Required next action: ${checkpoint.next_action}` : null,
  ].filter(Boolean).join("\n");
}
