export const LIFECYCLE_STATUSES = Object.freeze({
  run: ["draft", "queued", "running", "waiting_human", "paused", "blocked", "completed", "failed", "cancelled"],
  node: ["pending", "ready", "running", "waiting_human", "completed", "failed", "skipped", "cancelled"],
  session: ["draft", "planning", "ready_to_run", "running", "waiting_human", "completed", "failed", "cancelled"],
  agent_dag: ["draft", "ready", "running", "waiting_human", "completed", "failed", "cancelled"],
  agent_task: ["queued", "accepted", "running", "blocked", "completed", "skipped", "failed", "cancelled"],
  agent_run: ["queued", "running", "waiting_human", "completed", "failed", "cancelled"],
  task_checkpoint: ["in_progress", "resumable", "waiting_human", "completed", "failed", "superseded"],
});

const PROJECTIONS = Object.freeze({
  run: { active: ["queued", "running"], waiting: ["waiting_human", "paused", "blocked"], successful: ["completed"], unsuccessful: ["failed", "cancelled"] },
  node: { active: ["ready", "running"], waiting: ["waiting_human"], successful: ["completed", "skipped"], unsuccessful: ["failed", "cancelled"] },
  session: { active: ["planning", "ready_to_run", "running"], waiting: ["waiting_human"], successful: ["completed"], unsuccessful: ["failed", "cancelled"] },
  agent_dag: { active: ["ready", "running"], waiting: ["waiting_human"], successful: ["completed"], unsuccessful: ["failed", "cancelled"] },
  agent_task: { active: ["queued", "accepted", "running"], waiting: ["blocked"], successful: ["completed", "skipped"], unsuccessful: ["failed", "cancelled"] },
  agent_run: { active: ["queued", "running"], waiting: ["waiting_human"], successful: ["completed"], unsuccessful: ["failed", "cancelled"] },
  task_checkpoint: { active: ["in_progress", "resumable"], waiting: ["waiting_human"], successful: ["completed", "superseded"], unsuccessful: ["failed"] },
});

export function lifecycleExecutionState(domain, status) {
  const projection = PROJECTIONS[domain];
  const normalized = String(status || "");
  if (!projection || !LIFECYCLE_STATUSES[domain]?.includes(normalized)) return "not_started";
  if (projection.successful.includes(normalized)) return "successful";
  if (projection.unsuccessful.includes(normalized)) return "unsuccessful";
  if (projection.waiting.includes(normalized)) return "waiting";
  if (projection.active.includes(normalized)) return "active";
  return "not_started";
}

export function lifecycleStatusTone(domain, status) {
  const state = lifecycleExecutionState(domain, status);
  if (state === "successful") return "success";
  if (state === "unsuccessful") return "danger";
  if (state === "active" || state === "waiting") return "warn";
  return "neutral";
}

export function genericStatusTone(status) {
  const normalized = String(status || "");
  if (["published", "completed", "done", "returned", "satisfied", "confirmed", "succeeded", "verified", "approved"].includes(normalized)) return "success";
  if (["failed", "cancelled", "blocked", "rejected", "error"].includes(normalized)) return "danger";
  if (["draft", "new", "queued", "accepted", "ready", "running", "waiting_human", "paused", "prepared", "in_progress", "resumable", "review_ready", "pending"].includes(normalized)) return "warn";
  return "neutral";
}
