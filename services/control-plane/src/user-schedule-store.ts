import { randomUUID } from "node:crypto";
import path from "node:path";
import cronParser from "cron-parser";
import { USER_SCHEDULES_DIR, USER_SCHEDULE_RUNS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { nowIso } from "./utils.js";
import { createAgentBindingSnapshot, normalizeAgentBindingSnapshot, rebindAgentBindingSnapshot } from "./agent-runtime-store.js";
import type { AgentBindingSnapshot } from "./types.js";
import type { AutonomyMode } from "@my-mate/shared-types/domain-lifecycle";

export type ScheduleAutonomyMode = AutonomyMode;
export type ScheduleRecurrence =
  | { kind: "once"; run_at: string }
  | { kind: "interval"; interval_minutes: number }
  | { kind: "cron"; expression: string };
export type TriggerSpec =
  | { kind: "once_after"; delay_seconds: number }
  | { kind: "once_at"; run_at: string; timezone: string }
  | { kind: "interval"; interval_seconds: number }
  | { kind: "cron"; expression: string; timezone: string };

export interface UserScheduleRecord {
  schema_version: 2;
  schedule_id: string;
  workspace_id: string;
  name: string;
  prompt: string;
  task_mode: "new_task" | "resume_task";
  session_id: string | null;
  task_title: string | null;
  autonomy_mode: ScheduleAutonomyMode;
  provider_connection_id: string | null;
  model: string | null;
  timezone: string;
  recurrence: ScheduleRecurrence;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: UserScheduleRunRecord["status"] | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  trigger_spec: TriggerSpec;
  agent_binding_snapshot: AgentBindingSnapshot | null;
  permission_snapshot: { autonomy_mode: ScheduleAutonomyMode; preauthorized_tools: string[]; captured_at: string };
  source_session_id: string | null;
  source_message_id: string | null;
  retry_policy: { max_attempts: number; backoff_seconds: number };
  concurrency_policy: { mode: "skip_if_running" | "queue_one"; max_runtime_seconds: number };
}

export interface UserScheduleRunRecord {
  run_id: string;
  schedule_id: string;
  workspace_id: string;
  scheduled_for: string;
  status: "running" | "completed" | "waiting_human" | "failed";
  session_id: string | null;
  assistant_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

function scheduleDir(workspaceId: string): string {
  return path.join(USER_SCHEDULES_DIR, workspaceId);
}

function triggerFromRecurrence(recurrence: ScheduleRecurrence, timezone: string): TriggerSpec {
  if (recurrence.kind === "once") return { kind: "once_at", run_at: recurrence.run_at, timezone };
  if (recurrence.kind === "interval") return { kind: "interval", interval_seconds: recurrence.interval_minutes * 60 };
  return { kind: "cron", expression: recurrence.expression, timezone };
}

function schedulePath(workspaceId: string, scheduleId: string): string {
  return path.join(scheduleDir(workspaceId), `${scheduleId}.json`);
}

function scheduleRunDir(workspaceId: string, scheduleId: string): string {
  return path.join(USER_SCHEDULE_RUNS_DIR, workspaceId, scheduleId);
}

function scheduleRunPath(workspaceId: string, scheduleId: string, runId: string): string {
  return path.join(scheduleRunDir(workspaceId, scheduleId), `${runId}.json`);
}

function normalizeSchedule(record: UserScheduleRecord): UserScheduleRecord {
  const timestamp = record.updated_at || record.created_at || nowIso();
  const autonomy = record.autonomy_mode === "review_first" || record.autonomy_mode === "autopilot" ? record.autonomy_mode : "assisted";
  return {
    ...record,
    schema_version: 2,
    trigger_spec: record.trigger_spec || triggerFromRecurrence(record.recurrence, record.timezone || "UTC"),
    agent_binding_snapshot: record.agent_binding_snapshot ? normalizeAgentBindingSnapshot(record.agent_binding_snapshot) : null,
    permission_snapshot: record.permission_snapshot || { autonomy_mode: autonomy, preauthorized_tools: [], captured_at: timestamp },
    source_session_id: record.source_session_id || null,
    source_message_id: record.source_message_id || null,
    retry_policy: record.retry_policy || { max_attempts: 1, backoff_seconds: 30 },
    concurrency_policy: record.concurrency_policy || { mode: "skip_if_running", max_runtime_seconds: 1800 },
  };
}

export function assertTimeZone(timezone: string): string {
  const normalized = timezone.trim();
  if (!normalized) throw new Error("SCHEDULE_TIMEZONE_REQUIRED");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
  } catch {
    throw new Error("SCHEDULE_TIMEZONE_INVALID");
  }
  return normalized;
}

function validDate(value: string, code: string): Date {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(code);
  return date;
}

export function validateScheduleRecurrence(recurrence: ScheduleRecurrence, timezone: string): ScheduleRecurrence {
  assertTimeZone(timezone);
  if (recurrence.kind === "once") {
    return { kind: "once", run_at: validDate(recurrence.run_at, "SCHEDULE_RUN_AT_INVALID").toISOString() };
  }
  if (recurrence.kind === "interval") {
    const interval = Math.floor(recurrence.interval_minutes);
    if (!Number.isFinite(interval) || interval < 1 || interval > 525_600) {
      throw new Error("SCHEDULE_INTERVAL_INVALID");
    }
    return { kind: "interval", interval_minutes: interval };
  }
  if (recurrence.kind === "cron") {
    const expression = recurrence.expression.trim();
    if (!expression || expression.length > 160) throw new Error("SCHEDULE_CRON_INVALID");
    try {
      cronParser.parseExpression(expression, { tz: timezone, currentDate: new Date() }).next();
    } catch {
      throw new Error("SCHEDULE_CRON_INVALID");
    }
    return { kind: "cron", expression };
  }
  throw new Error("SCHEDULE_RECURRENCE_INVALID");
}

export function nextScheduleRunAt(input: {
  recurrence: ScheduleRecurrence;
  timezone: string;
  after: Date;
}): string | null {
  const recurrence = validateScheduleRecurrence(input.recurrence, input.timezone);
  const horizon = new Date(input.after.getTime() + 5 * 366 * 24 * 60 * 60 * 1000);
  if (recurrence.kind === "once") {
    const runAt = validDate(recurrence.run_at, "SCHEDULE_RUN_AT_INVALID");
    return runAt > input.after && runAt <= horizon ? runAt.toISOString() : null;
  }
  if (recurrence.kind === "interval") {
    const next = new Date(input.after.getTime() + recurrence.interval_minutes * 60_000);
    return next <= horizon ? next.toISOString() : null;
  }
  try {
    return cronParser.parseExpression(recurrence.expression, {
      tz: input.timezone,
      currentDate: input.after,
      endDate: horizon,
    }).next().toDate().toISOString();
  } catch {
    return null;
  }
}

export function createUserSchedule(input: {
  workspaceId: string;
  name: string;
  prompt: string;
  taskMode?: "new_task" | "resume_task";
  sessionId?: string | null;
  taskTitle?: string | null;
  autonomyMode?: ScheduleAutonomyMode;
  providerConnectionId?: string | null;
  model?: string | null;
  agentId?: string | null;
  agentVersion?: number | null;
  timezone: string;
  recurrence: ScheduleRecurrence;
  enabled?: boolean;
  createdBy: string;
  now?: Date;
}): UserScheduleRecord {
  const timestamp = (input.now || new Date()).toISOString();
  const timezone = assertTimeZone(input.timezone);
  const recurrence = validateScheduleRecurrence(input.recurrence, timezone);
  const taskMode = input.taskMode === "resume_task" ? "resume_task" : "new_task";
  if (taskMode === "resume_task" && !input.sessionId?.trim()) throw new Error("SCHEDULE_SESSION_REQUIRED");
  if (!input.name.trim() || !input.prompt.trim()) throw new Error("SCHEDULE_NAME_AND_PROMPT_REQUIRED");
  const enabled = input.enabled !== false;
  const nextRunAt = enabled ? nextScheduleRunAt({ recurrence, timezone, after: new Date(timestamp) }) : null;
  if (enabled && !nextRunAt) throw new Error("SCHEDULE_HAS_NO_FUTURE_RUN");
  let agentBindingSnapshot: AgentBindingSnapshot | null = null;
  try {
    agentBindingSnapshot = createAgentBindingSnapshot({
      workspaceId: input.workspaceId,
      agentId: input.agentId || null,
      agentVersion: input.agentVersion || null,
      providerConnectionId: input.providerConnectionId || null,
      model: input.model || null,
      autonomyMode: input.autonomyMode,
    });
  } catch {
    // A schedule can be created before provider setup; runner will report a durable failure.
  }
  const schedule: UserScheduleRecord = {
    schema_version: 2,
    schedule_id: `schedule_${randomUUID()}`,
    workspace_id: input.workspaceId,
    name: input.name.trim().slice(0, 160),
    prompt: input.prompt.trim().slice(0, 32_000),
    task_mode: taskMode,
    session_id: input.sessionId?.trim() || null,
    task_title: input.taskTitle?.trim().slice(0, 160) || null,
    autonomy_mode: input.autonomyMode === "review_first" || input.autonomyMode === "autopilot"
      ? input.autonomyMode
      : "assisted",
    provider_connection_id: input.providerConnectionId?.trim() || null,
    model: input.model?.trim() || null,
    timezone,
    recurrence,
    enabled,
    next_run_at: nextRunAt,
    last_run_at: null,
    last_run_status: null,
    created_by: input.createdBy,
    created_at: timestamp,
    updated_at: timestamp,
    trigger_spec: triggerFromRecurrence(recurrence, timezone),
    agent_binding_snapshot: agentBindingSnapshot,
    permission_snapshot: { autonomy_mode: input.autonomyMode === "review_first" || input.autonomyMode === "autopilot" ? input.autonomyMode : "assisted", preauthorized_tools: [], captured_at: timestamp },
    source_session_id: null,
    source_message_id: null,
    retry_policy: { max_attempts: 1, backoff_seconds: 30 },
    concurrency_policy: { mode: "skip_if_running", max_runtime_seconds: 1800 },
  };
  return saveUserSchedule(schedule);
}

export function saveUserSchedule(schedule: UserScheduleRecord): UserScheduleRecord {
  getJsonStorageBackend().writeJson(schedulePath(schedule.workspace_id, schedule.schedule_id), schedule);
  return schedule;
}

export function getUserSchedule(workspaceId: string, scheduleId: string): UserScheduleRecord | null {
  const storage = getJsonStorageBackend();
  const file = schedulePath(workspaceId, scheduleId);
  return storage.exists(file) ? normalizeSchedule(storage.readJson<UserScheduleRecord>(file)) : null;
}

export function listUserSchedules(workspaceId: string): UserScheduleRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(scheduleDir(workspaceId))
    .map((file) => normalizeSchedule(storage.readJson<UserScheduleRecord>(file)))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function updateUserSchedule(
  current: UserScheduleRecord,
  patch: Partial<Pick<UserScheduleRecord, "name" | "prompt" | "task_mode" | "session_id" | "task_title" | "autonomy_mode" | "provider_connection_id" | "model" | "timezone" | "recurrence" | "enabled">>,
  now = new Date(),
): UserScheduleRecord {
  const timezone = assertTimeZone(patch.timezone ?? current.timezone);
  const recurrence = validateScheduleRecurrence(patch.recurrence ?? current.recurrence, timezone);
  const taskMode = patch.task_mode ?? current.task_mode;
  const sessionId = patch.session_id === undefined ? current.session_id : patch.session_id?.trim() || null;
  if (taskMode === "resume_task" && !sessionId) throw new Error("SCHEDULE_SESSION_REQUIRED");
  const enabled = patch.enabled ?? current.enabled;
  const nextRunAt = enabled ? nextScheduleRunAt({ recurrence, timezone, after: now }) : null;
  if (enabled && !nextRunAt) throw new Error("SCHEDULE_HAS_NO_FUTURE_RUN");
  const next: UserScheduleRecord = {
    ...current,
    name: patch.name?.trim().slice(0, 160) || current.name,
    prompt: patch.prompt?.trim().slice(0, 32_000) || current.prompt,
    task_mode: taskMode,
    session_id: sessionId,
    task_title: patch.task_title === undefined ? current.task_title : patch.task_title?.trim().slice(0, 160) || null,
    autonomy_mode: patch.autonomy_mode ?? current.autonomy_mode,
    provider_connection_id: patch.provider_connection_id === undefined ? current.provider_connection_id : patch.provider_connection_id?.trim() || null,
    model: patch.model === undefined ? current.model : patch.model?.trim() || null,
    timezone,
    recurrence,
    enabled,
    next_run_at: nextRunAt,
    updated_at: now.toISOString(),
    schema_version: 2,
    trigger_spec: triggerFromRecurrence(recurrence, timezone),
  };
  return saveUserSchedule(next);
}

export function rebindUserScheduleProviderConnection(
  current: UserScheduleRecord,
  providerConnectionId: string,
  model: string,
  agentVersion?: number | null,
): UserScheduleRecord {
  const binding = current.agent_binding_snapshot
    ? rebindAgentBindingSnapshot(current.agent_binding_snapshot, {
        providerConnectionId,
        model,
        agentVersion,
      })
    : null;
  return saveUserSchedule({
    ...current,
    provider_connection_id: providerConnectionId,
    model,
    agent_binding_snapshot: binding,
    updated_at: nowIso(),
  });
}

export function deleteUserSchedule(workspaceId: string, scheduleId: string): boolean {
  const storage = getJsonStorageBackend();
  const file = schedulePath(workspaceId, scheduleId);
  if (!storage.exists(file)) return false;
  storage.removeJson(file);
  return true;
}

export function dueUserSchedules(now = new Date(), limit = 10): UserScheduleRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listDirs(USER_SCHEDULES_DIR)
    .flatMap((workspaceDir) => storage.listJsonFiles(workspaceDir))
    .map((file) => normalizeSchedule(storage.readJson<UserScheduleRecord>(file)))
    .filter((schedule) => schedule.enabled && schedule.next_run_at && new Date(schedule.next_run_at) <= now)
    .sort((left, right) => String(left.next_run_at).localeCompare(String(right.next_run_at)))
    .slice(0, Math.max(1, Math.min(50, limit)));
}

export function createUserScheduleRun(schedule: UserScheduleRecord, scheduledFor: string): UserScheduleRunRecord {
  const record: UserScheduleRunRecord = {
    run_id: `schedule_run_${randomUUID()}`,
    schedule_id: schedule.schedule_id,
    workspace_id: schedule.workspace_id,
    scheduled_for: scheduledFor,
    status: "running",
    session_id: null,
    assistant_message_id: null,
    error_code: null,
    error_message: null,
    started_at: nowIso(),
    finished_at: null,
  };
  return saveUserScheduleRun(record);
}

export function saveUserScheduleRun(record: UserScheduleRunRecord): UserScheduleRunRecord {
  getJsonStorageBackend().writeJson(scheduleRunPath(record.workspace_id, record.schedule_id, record.run_id), record);
  return record;
}

export function listUserScheduleRuns(workspaceId: string, scheduleId: string, limit = 100): UserScheduleRunRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(scheduleRunDir(workspaceId, scheduleId))
    .map((file) => storage.readJson<UserScheduleRunRecord>(file))
    .sort((left, right) => right.started_at.localeCompare(left.started_at))
    .slice(0, Math.max(1, Math.min(500, limit)));
}
