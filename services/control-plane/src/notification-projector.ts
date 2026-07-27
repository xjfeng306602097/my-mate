import { listApprovals } from "./approval-store.js";
import { listHumanInputs } from "./human-input-store.js";
import { createNotification } from "./notification-store.js";
import { getRunRoute } from "./run-route-store.js";

export function materializeAttentionNotifications(workspaceId: string): void {
  for (const approval of listApprovals("pending")) {
    createNotification({
      notificationId: `notification:approval:${approval.approval_id}`,
      workspace_id: workspaceId,
      kind: "approval_required",
      title: "Approval required",
      body: approval.summary.slice(0, 1_000),
      severity: "warning",
      schedule_id: null,
      schedule_run_id: null,
      session_id: getRunRoute(approval.run_id)?.session_id || null,
      resource_type: "approval",
      resource_id: approval.approval_id,
    });
  }
  for (const input of listHumanInputs("pending")) {
    createNotification({
      notificationId: `notification:human-input:${input.input_request_id}`,
      workspace_id: workspaceId,
      kind: "human_input_required",
      title: "Input required",
      body: input.summary.slice(0, 1_000),
      severity: "warning",
      schedule_id: null,
      schedule_run_id: null,
      session_id: getRunRoute(input.run_id)?.session_id || null,
      resource_type: "human_input",
      resource_id: input.input_request_id,
    });
  }
}
