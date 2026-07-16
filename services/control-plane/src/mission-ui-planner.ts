import type {
  AutopilotControllerRecord,
  MissionUiBlock,
  MissionUiPlan,
  RunRecord,
  SessionRecord,
  SupervisionAlertRecord,
} from "./types.js";
import { nowIso } from "./utils.js";

export function buildMissionUiPlan(input: {
  session: SessionRecord;
  run: RunRecord | null;
  pendingApprovals: number;
  pendingHumanInputs: number;
  resultCount: number;
  qualityState: string;
  alerts: SupervisionAlertRecord[];
  autopilot: AutopilotControllerRecord | null;
}): MissionUiPlan {
  const decisions = input.pendingApprovals + input.pendingHumanInputs;
  const runStatus = input.run?.status || "idle";
  const failed = ["failed", "cancelled"].includes(runStatus);
  const completed = runStatus === "completed";
  const active = ["queued", "running", "paused", "waiting_human"].includes(runStatus);
  const workspaceState = input.session.metadata.workspace_state;
  const clarifying =
    !input.run &&
    typeof workspaceState === "object" &&
    workspaceState !== null &&
    (("stage" in workspaceState && workspaceState.stage === "understand") ||
      ("next_recommended_action" in workspaceState && workspaceState.next_recommended_action === "clarify"));
  const phase = decisions
    ? "decision"
    : failed
      ? "recovery"
      : completed
        ? "result"
        : active
          ? "running"
          : clarifying
            ? "clarify"
            : "ready";
  const blocks: MissionUiBlock[] = [];
  const add = (block: MissionUiBlock) => blocks.push(block);

  add({
    block_id: "guidance",
    component: "task_guidance",
    priority: 0,
    visibility: "primary",
    title: "Current focus",
    data: { phase, run_status: runStatus, autopilot_status: input.autopilot?.status || "disabled" },
  });
  if (decisions) {
    add({ block_id: "decisions", component: "decision_queue", priority: 10, visibility: "primary", title: "Needs you", data: { count: decisions } });
  }
  if (active) {
    add({ block_id: "progress", component: "progress_summary", priority: 20, visibility: "primary", title: "Progress", data: { run_status: runStatus } });
  }
  if (input.resultCount) {
    add({ block_id: "results", component: "result_gallery", priority: 10, visibility: "primary", title: "Results", data: { count: input.resultCount } });
  }
  if (completed) {
    add({ block_id: "quality", component: "quality_summary", priority: 20, visibility: "primary", title: "Result quality", data: { state: input.qualityState } });
  }
  if (input.alerts.length) {
    add({ block_id: "repair", component: "repair_recommendation", priority: 5, visibility: "primary", title: "Recommended repair", data: { alert_id: input.alerts[0].alert_id, severity: input.alerts[0].severity } });
  }
  add({
    block_id: "conversation",
    component: "conversation",
    priority: clarifying ? 10 : 80,
    visibility: clarifying ? "primary" : "secondary",
    title: "Task conversation",
    data: {},
  });
  add({ block_id: "technical", component: "technical_details", priority: 90, visibility: "advanced", title: "Technical details", data: {} });

  return {
    version: 1,
    phase,
    generated_at: nowIso(),
    primary_action:
      input.alerts[0]?.recommended_action ||
      (phase === "clarify" ? "review-task-conversation" : phase === "ready" ? "start-task-work" : null),
    blocks: blocks.sort((left, right) => left.priority - right.priority),
    fallback_component: "task_guidance",
  };
}
