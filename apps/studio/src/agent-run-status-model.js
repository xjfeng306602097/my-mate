const RUNNING_EVENT_TYPES = new Set([
  "agent.started",
  "agent.progress",
  "agent.message.delta",
  "agent.message.completed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "checkpoint.saved",
  "artifact.created",
  "handoff.returned",
]);

export function isAgentDelegationRunning(status) {
  return String(status || "").toLowerCase() === "running";
}

export function agentDelegationStatusFromEvent(currentStatus, event = {}) {
  const type = String(event.type || "");
  if (type === "agent.completed") return event.status === "waiting" ? "blocked" : "completed";
  if (type === "agent.failed") return "failed";
  if (type === "agent.cancelled") return "cancelled";
  if (type === "tool.waiting_approval") return "waiting_human";
  if (RUNNING_EVENT_TYPES.has(type)) return "running";
  if (type === "task.assigned" && ["", "draft", "queued"].includes(String(currentStatus || ""))) return "accepted";
  return String(currentStatus || "queued");
}

