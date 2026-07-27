import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, "services", "api-gateway", "node_modules", "ws"));
const baseUrl = process.env.MY_MATE_LIVE_GATEWAY_URL || "http://127.0.0.1:6373";
const wsBaseUrl = baseUrl.replace(/^http/u, "ws");
const workspaceId = process.env.MY_MATE_LIVE_WORKSPACE_ID || "default";

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || `${options.method || "GET"} ${pathname} failed (${response.status})`);
  return body;
}

async function waitFor(check, timeoutMs, intervalMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs} ms.`);
}

async function conversation(sessionId, connectionId, model) {
  const socket = new WebSocket(`${wsBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/conversation`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Conversation did not complete in 180 seconds.")), 180_000);
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.type === "conversation.completed") {
          clearTimeout(timer);
          resolve(event);
        } else if (event.type === "conversation.error") {
          clearTimeout(timer);
          reject(new Error(String(event.message || event.code || "Conversation failed.")));
        }
      });
      socket.send(JSON.stringify({
        type: "conversation.send",
        request_id: `schedule-live-${Date.now()}`,
        resume_latest_user: true,
        provider_connection_id: connectionId,
        model,
        auth: { workspace_id: workspaceId },
      }));
    });
  } finally {
    socket.close();
  }
}

const connections = await request("/api/registry/provider-connections");
const connection = (connections.items || []).find((item) => item.status === "active" && item.verification?.status === "verified");
if (!connection) throw new Error("A verified Provider Connection is required for the User Schedule live smoke test.");
const model = connection.default_model || connection.models?.[0];
if (!model) throw new Error("The verified Provider Connection has no model.");

const target = new Date(Math.ceil((Date.now() + 90_000) / 60_000) * 60_000);
const cronExpression = `${target.getUTCMinutes()} ${target.getUTCHours()} ${target.getUTCDate()} ${target.getUTCMonth() + 1} *`;
const marker = `Cron live smoke ${Date.now()}`;
let scheduleId = "";

try {
  const created = await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      initial_message: `Create a real enabled cron schedule named "${marker}". Use timezone UTC and cron expression "${cronExpression}". Each run must create a new Task using ${connection.connection_id} / ${model} in Assisted mode. The scheduled instruction is: Reply exactly CRON_E2E_TRIGGERED. Create it now with the schedule tool and report its real schedule id and next run time.`,
      provider_connection_id: connection.connection_id,
      model,
      autonomy_mode: "assisted",
      defer_conversation_reply: true,
    }),
  });
  const sessionId = created.session?.session_id;
  if (!sessionId) throw new Error("Live smoke session was not created.");
  await conversation(sessionId, connection.connection_id, model);

  const schedule = await waitFor(async () => {
    const schedules = await request("/api/schedules");
    return (schedules.items || []).find((item) => item.name === marker) || null;
  }, 15_000, 1_000);
  scheduleId = schedule.schedule_id;
  if (schedule.recurrence?.expression !== cronExpression || schedule.timezone !== "UTC" || !schedule.enabled) {
    throw new Error("Conversation created a schedule with the wrong cron, timezone, or enabled state.");
  }

  const waitMs = Math.max(180_000, target.getTime() - Date.now() + 180_000);
  const run = await waitFor(async () => {
    const runs = await request(`/api/schedules/${encodeURIComponent(scheduleId)}/runs?limit=10`);
    return (runs.items || []).find((item) => ["completed", "waiting_human", "failed"].includes(item.status)) || null;
  }, waitMs);
  if (run.status !== "completed" || !run.session_id || !run.assistant_message_id) {
    throw new Error(`Scheduled model turn did not complete: ${JSON.stringify(run)}`);
  }
  const task = await request(`/api/sessions/${encodeURIComponent(run.session_id)}`);
  const assistantText = (task.messages || []).filter((item) => item.role === "orchestrator").map((item) => item.content?.text || "").join("\n");
  if (!assistantText.includes("CRON_E2E_TRIGGERED")) throw new Error("Scheduled Task did not contain the expected model result.");
  const notifications = await request("/api/notifications?status=all");
  if (!(notifications.items || []).some((item) => item.schedule_run_id === run.run_id)) {
    throw new Error("Scheduled Task completed without a durable notification.");
  }
  console.log(JSON.stringify({ ok: true, schedule_id: scheduleId, run_id: run.run_id, session_id: run.session_id, cron_expression: cronExpression }, null, 2));
} finally {
  if (scheduleId) await fetch(`${baseUrl}/api/schedules/${encodeURIComponent(scheduleId)}`, { method: "DELETE" }).catch(() => undefined);
}
