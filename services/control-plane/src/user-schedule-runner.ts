import { ROLE_PERMISSIONS } from "@my-mate/shared-types/identity";
import { createNotification } from "./notification-store.js";
import type { ConversationStreamTurnInput, ConversationStreamTurnResult } from "./app.js";
import type { AgentRunRecord } from "./types.js";
import { runWithRequestContext } from "./request-security.js";
import { createSession, getSession, saveSession } from "./session-store.js";
import {
  createUserScheduleRun,
  dueUserSchedules,
  nextScheduleRunAt,
  saveUserSchedule,
  saveUserScheduleRun,
  type ScheduleAutonomyMode,
  type UserScheduleRecord,
  type UserScheduleRunRecord,
} from "./user-schedule-store.js";
import { nowIso } from "./utils.js";
import { scheduledConversationToolNames } from "./conversation-tools.js";
import { createAgentRun, saveAgentRun } from "./agent-runtime-store.js";
import { getProviderConnection } from "./provider-connection-store.js";

type TurnHandler = (input: ConversationStreamTurnInput) => Promise<ConversationStreamTurnResult>;

function boundedError(error: unknown): { code: string; message: string } {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "schedule_execution_failed")
    : "schedule_execution_failed";
  const message = error instanceof Error ? error.message : "Scheduled Task failed.";
  return { code: code.slice(0, 160), message: message.slice(0, 2_000) };
}

function autonomyRank(mode: ScheduleAutonomyMode): number {
  return mode === "review_first" ? 0 : mode === "assisted" ? 1 : 2;
}

function effectiveAutonomy(current: unknown, requested: ScheduleAutonomyMode): ScheduleAutonomyMode {
  const currentMode: ScheduleAutonomyMode = current === "review_first" || current === "autopilot"
    ? current
    : "assisted";
  return autonomyRank(currentMode) <= autonomyRank(requested) ? currentMode : requested;
}

export class UserScheduleRunner {
  private readonly running = new Set<string>();

  constructor(private readonly options: { turnHandler: TurnHandler; now?: () => Date }) {}

  async runDue(limit = 10): Promise<UserScheduleRunRecord[]> {
    const now = (this.options.now || (() => new Date()))();
    const due = dueUserSchedules(now, limit).filter((schedule) => !this.running.has(schedule.schedule_id));
    const results: UserScheduleRunRecord[] = [];
    for (const schedule of due) {
      results.push(await this.execute(schedule, schedule.next_run_at || now.toISOString(), true));
    }
    return results;
  }

  async runNow(schedule: UserScheduleRecord): Promise<UserScheduleRunRecord> {
    if (this.running.has(schedule.schedule_id)) throw new Error("SCHEDULE_ALREADY_RUNNING");
    return await this.execute(schedule, (this.options.now || (() => new Date()))().toISOString(), false);
  }

  private async execute(
    schedule: UserScheduleRecord,
    scheduledFor: string,
    advanceSchedule: boolean,
  ): Promise<UserScheduleRunRecord> {
    this.running.add(schedule.schedule_id);
    const history = createUserScheduleRun(schedule, scheduledFor);
    let agentRun: AgentRunRecord | undefined;
    const executionAutonomy = schedule.agent_binding_snapshot
      ? effectiveAutonomy(schedule.agent_binding_snapshot.autonomy_ceiling, schedule.autonomy_mode)
      : schedule.autonomy_mode;
    const workspace = {
      workspace_id: schedule.workspace_id,
      workspace_name: schedule.workspace_id,
      role: "operator" as const,
    };
    try {
      const result = await runWithRequestContext({
        schema_version: 1,
        principal: {
          principal_id: schedule.created_by || "user-scheduler",
          display_name: "User Scheduler",
          principal_type: "service",
        },
        memberships: [workspace],
        selected_workspace: workspace,
        permissions: ROLE_PERMISSIONS.operator,
        auth_method: "development",
        issued_at: nowIso(),
        request_id: `schedule:${schedule.schedule_id}:${history.run_id}`,
      }, async () => {
        if (schedule.agent_binding_snapshot) {
          const pinnedConnection = getProviderConnection(schedule.agent_binding_snapshot.provider_connection_id);
          if (!pinnedConnection || pinnedConnection.status !== "active" || pinnedConnection.verification?.status !== "verified") {
            throw Object.assign(new Error("The pinned Agent Provider Connection is no longer verified."), { code: "agent_binding_drift" });
          }
        }
        let session = schedule.task_mode === "resume_task" && schedule.session_id
          ? getSession(schedule.session_id)
          : null;
        if (schedule.task_mode === "resume_task" && !session) throw new Error("SCHEDULE_SESSION_NOT_FOUND");
        if (!session) {
          session = createSession({
            title: schedule.task_title || schedule.name,
            created_by: schedule.created_by || "user-scheduler",
            autonomy_mode: executionAutonomy,
            provider_connection_id: schedule.provider_connection_id || undefined,
            model: schedule.model || undefined,
            agent_id: schedule.agent_binding_snapshot?.agent_id,
            agent_version: schedule.agent_binding_snapshot?.agent_version,
            agent_binding_mode: "pinned",
          });
        } else {
          session.metadata = {
            ...(session.metadata || {}),
            autonomy_mode: effectiveAutonomy(session.metadata?.autonomy_mode, executionAutonomy),
            ...(schedule.agent_binding_snapshot ? { agent_binding_snapshot: schedule.agent_binding_snapshot } : {}),
            ...(schedule.agent_binding_snapshot ? {
              conversation_provider_connection_id: schedule.agent_binding_snapshot.provider_connection_id,
              conversation_model: schedule.agent_binding_snapshot.model,
            } : {}),
            schedule_invocation: true,
            schedule_id: schedule.schedule_id,
            schedule_run_id: history.run_id,
          };
          saveSession(session);
        }
        session.metadata = {
          ...(session.metadata || {}),
          schedule_invocation: true,
          schedule_id: schedule.schedule_id,
          schedule_run_id: history.run_id,
        };
        saveSession(session);
        if (schedule.agent_binding_snapshot) {
          session.metadata = {
            ...(session.metadata || {}),
            agent_binding_snapshot: schedule.agent_binding_snapshot,
            conversation_provider_connection_id: schedule.agent_binding_snapshot.provider_connection_id,
            conversation_model: schedule.agent_binding_snapshot.model,
          };
          saveSession(session);
        }
        if (schedule.agent_binding_snapshot) {
          agentRun = createAgentRun({
            workspaceId: schedule.workspace_id,
            kind: "schedule",
            bindingSnapshot: schedule.agent_binding_snapshot,
            sessionId: session.session_id,
            scheduleId: schedule.schedule_id,
            scheduleRunId: history.run_id,
          });
        }
        const turn = await this.options.turnHandler({
          sessionId: session.session_id,
          content: schedule.prompt,
          providerConnectionId: schedule.agent_binding_snapshot ? undefined : schedule.provider_connection_id || undefined,
          model: schedule.agent_binding_snapshot ? undefined : schedule.model || undefined,
          allowedToolNames: scheduledConversationToolNames(schedule.workspace_id, executionAutonomy),
          onDelta: () => {},
        });
        return turn;
      });

      history.session_id = result.session.session_id;
      history.assistant_message_id = result.assistantMessage.message_id;
      history.status = executionAutonomy === "review_first" || result.session.status === "waiting_human"
        ? "waiting_human"
        : "completed";
      history.finished_at = (this.options.now || (() => new Date()))().toISOString();
      saveUserScheduleRun(history);
      const completedAgentRun = agentRun as AgentRunRecord | undefined;
      if (completedAgentRun) {
        completedAgentRun.status = history.status === "waiting_human" ? "waiting_human" : "completed";
        completedAgentRun.finished_at = history.finished_at;
        saveAgentRun(completedAgentRun);
      }
      createNotification({
        workspace_id: schedule.workspace_id,
        kind: history.status === "waiting_human" ? "human_input_required" : "schedule_completed",
        title: history.status === "waiting_human" ? `${schedule.name} needs attention` : `${schedule.name} completed`,
        body: history.status === "waiting_human"
          ? String(result.session.metadata?.pending_decision || "The scheduled Task requires approval or input.").slice(0, 1_000)
          : "The scheduled Task completed its Conversation turn.",
        severity: history.status === "waiting_human" ? "warning" : "success",
        schedule_id: schedule.schedule_id,
        schedule_run_id: history.run_id,
        session_id: result.session.session_id,
        resource_type: "schedule_run",
        resource_id: history.run_id,
      });
    } catch (error) {
      const failure = boundedError(error);
      history.status = "failed";
      history.error_code = failure.code;
      history.error_message = failure.message;
      history.finished_at = (this.options.now || (() => new Date()))().toISOString();
      saveUserScheduleRun(history);
      const failedAgentRun = agentRun as AgentRunRecord | undefined;
      if (failedAgentRun) {
        failedAgentRun.status = "failed";
        failedAgentRun.error_code = failure.code;
        failedAgentRun.error_message = failure.message;
        failedAgentRun.finished_at = history.finished_at;
        saveAgentRun(failedAgentRun);
      }
      createNotification({
        workspace_id: schedule.workspace_id,
        kind: "schedule_failed",
        title: `${schedule.name} failed`,
        body: failure.message,
        severity: "error",
        schedule_id: schedule.schedule_id,
        schedule_run_id: history.run_id,
        session_id: history.session_id,
        resource_type: "schedule_run",
        resource_id: history.run_id,
      });
    } finally {
      if (advanceSchedule) {
        const finishedAt = new Date(history.finished_at || (this.options.now || (() => new Date()))());
        schedule.last_run_at = history.finished_at;
        schedule.last_run_status = history.status;
        schedule.enabled = schedule.recurrence.kind === "once" ? false : schedule.enabled;
        schedule.next_run_at = schedule.enabled
          ? nextScheduleRunAt({ recurrence: schedule.recurrence, timezone: schedule.timezone, after: finishedAt })
          : null;
        schedule.updated_at = finishedAt.toISOString();
        saveUserSchedule(schedule);
      }
      this.running.delete(schedule.schedule_id);
    }
    return history;
  }
}
