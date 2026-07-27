import { randomUUID } from "node:crypto";
import path from "node:path";
import { NOTIFICATIONS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { nowIso } from "./utils.js";

export type NotificationKind = "schedule_completed" | "schedule_failed" | "approval_required" | "human_input_required";

export interface NotificationRecord {
  notification_id: string;
  workspace_id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "error";
  schedule_id: string | null;
  schedule_run_id: string | null;
  session_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

function notificationDir(workspaceId: string): string {
  return path.join(NOTIFICATIONS_DIR, workspaceId);
}

function notificationPath(workspaceId: string, notificationId: string): string {
  return path.join(notificationDir(workspaceId), `${notificationId.replace(/[^A-Za-z0-9_.:-]/gu, "_")}.json`);
}

export function createNotification(input: Omit<NotificationRecord, "notification_id" | "read_at" | "dismissed_at" | "created_at"> & { notificationId?: string }): NotificationRecord {
  const record: NotificationRecord = {
    ...input,
    notification_id: input.notificationId || `notification_${randomUUID()}`,
    read_at: null,
    dismissed_at: null,
    created_at: nowIso(),
  };
  const existing = getNotification(record.workspace_id, record.notification_id);
  if (existing) return existing;
  getJsonStorageBackend().writeJson(notificationPath(record.workspace_id, record.notification_id), record);
  return record;
}

export function getNotification(workspaceId: string, notificationId: string): NotificationRecord | null {
  const storage = getJsonStorageBackend();
  const file = notificationPath(workspaceId, notificationId);
  return storage.exists(file) ? storage.readJson<NotificationRecord>(file) : null;
}

export function listNotifications(workspaceId: string, status: "active" | "unread" | "all" = "active"): NotificationRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(notificationDir(workspaceId))
    .map((file) => storage.readJson<NotificationRecord>(file))
    .filter((item) => status === "all" || (!item.dismissed_at && (status !== "unread" || !item.read_at)))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function updateNotificationState(
  workspaceId: string,
  notificationId: string,
  action: "read" | "dismiss",
): NotificationRecord | null {
  const record = getNotification(workspaceId, notificationId);
  if (!record) return null;
  const timestamp = nowIso();
  if (action === "read") record.read_at = record.read_at || timestamp;
  else record.dismissed_at = record.dismissed_at || timestamp;
  getJsonStorageBackend().writeJson(notificationPath(workspaceId, notificationId), record);
  return record;
}
