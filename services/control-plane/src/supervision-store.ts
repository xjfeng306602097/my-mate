import path from "node:path";
import { SUPERVISION_ALERTS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { SupervisionAlertRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";
import { getActiveWorkspaceId } from "./request-security.js";

function alertPath(alertId: string): string {
  return path.join(SUPERVISION_ALERTS_DIR, `${encodeURIComponent(alertId)}.json`);
}

export function saveSupervisionAlert(alert: SupervisionAlertRecord): SupervisionAlertRecord {
  ensureDir(SUPERVISION_ALERTS_DIR);
  writeJsonAtomic(alertPath(alert.alert_id), alert);
  return alert;
}

export function getSupervisionAlert(alertId: string): SupervisionAlertRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = alertPath(alertId);
  return storage.exists(filePath) ? storage.readJson<SupervisionAlertRecord>(filePath) : null;
}

export function listSupervisionAlerts(input: {
  sessionId?: string;
  status?: "open" | "resolved";
} = {}): SupervisionAlertRecord[] {
  const workspaceId = getActiveWorkspaceId();
  return getJsonStorageBackend()
    .listJsonFiles(SUPERVISION_ALERTS_DIR)
    .map((file) => {
      const alert = getJsonStorageBackend().readJson<SupervisionAlertRecord>(file);
      alert.workspace_id ||= "default";
      return alert;
    })
    .filter((alert) => !workspaceId || alert.workspace_id === workspaceId)
    .filter((alert) => !input.sessionId || alert.session_id === input.sessionId)
    .filter((alert) => !input.status || alert.status === input.status)
    .sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at));
}

export function findOpenSupervisionAlert(fingerprint: string): SupervisionAlertRecord | null {
  return listSupervisionAlerts({ status: "open" }).find((alert) => alert.fingerprint === fingerprint) || null;
}
