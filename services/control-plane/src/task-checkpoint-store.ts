import { randomUUID } from "node:crypto";
import path from "node:path";
import { TASK_CHECKPOINTS_DIR } from "./config.js";
import type { ConversationProviderEvidence } from "./conversation-provider.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  AutopilotMode,
  SessionRecord,
  TaskCheckpointReason,
  TaskCheckpointRecord,
  TaskCheckpointStatus,
} from "./types.js";
import { nowIso } from "./utils.js";

const DEFAULT_MAX_RESUME_ATTEMPTS = 3;

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

function saveCheckpoint(checkpoint: TaskCheckpointRecord): TaskCheckpointRecord {
  getJsonStorageBackend().writeJson(
    checkpointPath(checkpoint.workspace_id, checkpoint.session_id, checkpoint.checkpoint_id),
    checkpoint,
  );
  return checkpoint;
}

export function listTaskCheckpoints(sessionId: string, workspaceId?: string): TaskCheckpointRecord[] {
  const targetWorkspaceId = workspaceId || getActiveWorkspaceId() || "default";
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(sessionDir(targetWorkspaceId, sessionId))
    .map((file) => storage.readJson<TaskCheckpointRecord>(file))
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
  const record = storage.readJson<TaskCheckpointRecord>(file);
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
  },
): TaskCheckpointRecord {
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
          tool_rounds: provider.tool_rounds,
          tool_round_limit_reached: provider.tool_round_limit_reached,
          action_ids: [...provider.action_ids],
        }
      : checkpoint.provider_state,
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
    auto_resume_eligible: mode === "autopilot",
    progress_summary: "Conversation turn started.",
    context_summary: boundedText(
      typeof input.session.metadata?.conversation_context_summary === "string"
        ? input.session.metadata.conversation_context_summary
        : null,
      8_000,
    ),
    next_action: "Complete the current model turn.",
    provider_state: null,
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
            ? "Automatically resume the interrupted turn."
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
