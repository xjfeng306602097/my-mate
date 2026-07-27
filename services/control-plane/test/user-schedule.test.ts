import assert from "node:assert/strict";
import test from "node:test";
import { createNotification, listNotifications } from "../src/notification-store.js";
import { getSession, saveSession } from "../src/session-store.js";
import { createSessionMessage } from "../src/session-message-store.js";
import {
  createUserSchedule,
  listUserScheduleRuns,
  nextScheduleRunAt,
  saveUserSchedule,
} from "../src/user-schedule-store.js";
import { UserScheduleRunner } from "../src/user-schedule-runner.js";
import {
  executeConversationTool,
  getConversationToolDefinitions,
  scheduledConversationToolNames,
} from "../src/conversation-tools.js";
import { createSession } from "../src/session-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

test("timezone-aware cron and interval schedules calculate bounded next runs", () => {
  assert.equal(
    nextScheduleRunAt({
      recurrence: { kind: "cron", expression: "0 9 * * *" },
      timezone: "Asia/Shanghai",
      after: new Date("2026-07-17T00:00:00.000Z"),
    }),
    "2026-07-17T01:00:00.000Z",
  );
  assert.equal(
    nextScheduleRunAt({
      recurrence: { kind: "interval", interval_minutes: 30 },
      timezone: "UTC",
      after: new Date("2026-07-17T00:00:00.000Z"),
    }),
    "2026-07-17T00:30:00.000Z",
  );
  assert.throws(() => nextScheduleRunAt({
    recurrence: { kind: "cron", expression: "not cron" },
    timezone: "UTC",
    after: new Date(),
  }), /SCHEDULE_CRON_INVALID/u);
});

test("Conversation Agent creates and manages a real cron schedule with bounded preauthorization", async () => {
  resetTestRoot();
  const session = createSession({
    initial_message: "Every day at 9 AM review the project",
    created_by: "schedule-user",
    autonomy_mode: "assisted",
    provider_connection_id: "provider-test",
    model: "model-test",
  });
  const created = await executeConversationTool({
    session,
    call: {
      id: "schedule-create-tool",
      name: "schedule_create",
      arguments: {
        name: "Daily project review",
        prompt: "Review the project and summarize blockers.",
        cron_expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
        autonomy_mode: "assisted",
      },
    },
  });
  assert.equal(created.is_error, false);
  const schedule = (created.content.schedule || {}) as { schedule_id?: string; next_run_at?: string; provider_connection_id?: string; model?: string };
  assert.ok(schedule.schedule_id);
  assert.ok(schedule.next_run_at);
  assert.equal(schedule.provider_connection_id, "provider-test");
  assert.equal(schedule.model, "model-test");

  const listed = await executeConversationTool({
    session,
    call: { id: "schedule-list-tool", name: "schedule_list", arguments: {} },
  });
  assert.equal(listed.content.count, 1);

  const updated = await executeConversationTool({
    session,
    call: {
      id: "schedule-update-tool",
      name: "schedule_update",
      arguments: { schedule_id: schedule.schedule_id, cron_expression: "30 9 * * 1-5" },
    },
  });
  assert.equal(updated.is_error, false);
  assert.equal(((updated.content.schedule as { recurrence?: { expression?: string } }).recurrence?.expression), "30 9 * * 1-5");

  const invalid = await executeConversationTool({
    session,
    call: {
      id: "schedule-invalid-tool",
      name: "schedule_update",
      arguments: { schedule_id: schedule.schedule_id, cron_expression: "not cron" },
    },
  });
  assert.equal(invalid.is_error, true);
  assert.equal(invalid.content.code, "schedule_cron_invalid");

  assert.equal(getConversationToolDefinitions().some((tool) => tool.name === "schedule_create"), true);
  assert.equal(scheduledConversationToolNames("default", "review_first").includes("workspace_apply_operations"), false);
  assert.equal(scheduledConversationToolNames("default", "assisted").includes("workspace_apply_operations"), false);
  assert.equal(scheduledConversationToolNames("default", "autopilot").includes("workspace_apply_operations"), true);
  assert.equal(scheduledConversationToolNames("default", "autopilot").includes("schedule_create"), false);
});

test("due schedules execute through Conversation without a Desktop approval channel", async () => {
  resetTestRoot();
  const clock = new Date("2026-07-17T08:00:00.000Z");
  const schedule = createUserSchedule({
    workspaceId: "default",
    name: "Morning review",
    prompt: "Review the current plan and stop for approval.",
    autonomyMode: "review_first",
    timezone: "Asia/Shanghai",
    recurrence: { kind: "interval", interval_minutes: 60 },
    createdBy: "schedule-owner",
    now: new Date("2026-07-17T06:00:00.000Z"),
  });
  schedule.next_run_at = "2026-07-17T07:00:00.000Z";
  saveUserSchedule(schedule);
  const runner = new UserScheduleRunner({
    now: () => clock,
    turnHandler: async (input) => {
      assert.equal(input.onDesktopCapability, undefined);
      const session = getSession(input.sessionId)!;
      assert.equal(session.metadata.autonomy_mode, "review_first");
      assert.equal(session.metadata.schedule_invocation, true);
      assert.equal(session.metadata.schedule_id, schedule.schedule_id);
      assert.equal(typeof session.metadata.schedule_run_id, "string");
      session.status = "waiting_human";
      session.metadata = { ...session.metadata, pending_decision: "Approve the reviewed plan." };
      saveSession(session);
      const assistantMessage = createSessionMessage({
        session_id: session.session_id,
        role: "orchestrator",
        kind: "text",
        content: { text: "Plan prepared for review." },
      });
      return { session, assistantMessage };
    },
  });

  const runs = await runner.runDue();
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, "waiting_human");
  assert.equal(listUserScheduleRuns("default", schedule.schedule_id).length, 1);
  const notifications = listNotifications("default", "unread");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.kind, "human_input_required");
  assert.equal(notifications[0]?.session_id, runs[0]?.session_id);
});

test("a real clock-driven scan fires a due one-time schedule without runNow", async () => {
  resetTestRoot();
  let modelTurns = 0;
  const schedule = createUserSchedule({
    workspaceId: "default",
    name: "Clock driven review",
    prompt: "Return CLOCK_TRIGGERED.",
    autonomyMode: "assisted",
    timezone: "UTC",
    recurrence: { kind: "once", run_at: new Date(Date.now() + 120).toISOString() },
    createdBy: "timer-test",
  });
  const runner = new UserScheduleRunner({
    turnHandler: async (input) => {
      modelTurns += 1;
      const session = getSession(input.sessionId)!;
      const assistantMessage = createSessionMessage({
        session_id: session.session_id,
        role: "orchestrator",
        kind: "text",
        content: { text: "CLOCK_TRIGGERED" },
      });
      return { session, assistantMessage };
    },
  });
  const fired = await new Promise<boolean>((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(timer);
      reject(new Error("Clock-driven schedule did not fire."));
    }, 2_000);
    const timer = setInterval(() => {
      void runner.runDue().then((runs) => {
        if (!runs.length) return;
        clearTimeout(deadline);
        clearInterval(timer);
        resolve(true);
      }).catch(reject);
    }, 25);
  });
  assert.equal(fired, true);
  assert.equal(modelTurns, 1);
  assert.equal(listUserScheduleRuns("default", schedule.schedule_id)[0]?.status, "completed");
});

test("schedule and notification APIs expose durable lifecycle operations", async () => {
  resetTestRoot();
  const server = await startTestServer();
  try {
    const created = await postJson(`${server.baseUrl}/api/schedules`, {
      name: "One-time review",
      prompt: "Review the release notes.",
      timezone: "Asia/Shanghai",
      recurrence: { kind: "once", run_at: "2027-07-17T09:00:00.000Z" },
      autonomy_mode: "assisted",
    });
    assert.equal(created.status, 201);
    const scheduleId = created.body.schedule_id;
    const listed = await getJson(`${server.baseUrl}/api/schedules`);
    assert.equal(listed.body.items.length, 1);

    const patchedResponse = await fetch(`${server.baseUrl}/api/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(patchedResponse.status, 200);
    assert.equal((await patchedResponse.json()).enabled, false);

    const notification = createNotification({
      workspace_id: "default",
      kind: "schedule_completed",
      title: "Review completed",
      body: "The scheduled review completed.",
      severity: "success",
      schedule_id: scheduleId,
      schedule_run_id: null,
      session_id: null,
      resource_type: "schedule",
      resource_id: scheduleId,
    });
    const notifications = await getJson(`${server.baseUrl}/api/notifications?status=unread`);
    assert.equal(notifications.body.items[0].notification_id, notification.notification_id);
    const read = await postJson(`${server.baseUrl}/api/notifications/${notification.notification_id}/read`, {});
    assert.equal(read.status, 200);
    assert.ok(read.body.read_at);
    const dismissed = await postJson(`${server.baseUrl}/api/notifications/${notification.notification_id}/dismiss`, {});
    assert.equal(dismissed.status, 200);
    assert.ok(dismissed.body.dismissed_at);

    const deleted = await fetch(`${server.baseUrl}/api/schedules/${scheduleId}`, { method: "DELETE" });
    assert.equal(deleted.status, 204);
  } finally {
    await server.close();
  }
});
