import path from "node:path";
import { AUTOPILOT_CONTROLLERS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { AutopilotControllerRecord } from "./types.js";
import { ensureDir, nowIso, writeJsonAtomic } from "./utils.js";
import { getActiveWorkspaceId } from "./request-security.js";

function controllerPath(sessionId: string): string {
  return path.join(AUTOPILOT_CONTROLLERS_DIR, `${encodeURIComponent(sessionId)}.json`);
}

export function saveAutopilotController(controller: AutopilotControllerRecord): AutopilotControllerRecord {
  ensureDir(AUTOPILOT_CONTROLLERS_DIR);
  writeJsonAtomic(controllerPath(controller.session_id), controller);
  return controller;
}

export function getAutopilotController(sessionId: string): AutopilotControllerRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = controllerPath(sessionId);
  if (!storage.exists(filePath)) return null;
  const controller = storage.readJson<AutopilotControllerRecord>(filePath);
  controller.workspace_id ||= "default";
  const workspaceId = getActiveWorkspaceId();
  return workspaceId && controller.workspace_id !== workspaceId ? null : controller;
}

export function listAutopilotControllers(): AutopilotControllerRecord[] {
  const storage = getJsonStorageBackend();
  const workspaceId = getActiveWorkspaceId();
  return storage
    .listJsonFiles(AUTOPILOT_CONTROLLERS_DIR)
    .map((file) => {
      const controller = storage.readJson<AutopilotControllerRecord>(file);
      controller.workspace_id ||= "default";
      return controller;
    })
    .filter((controller) => !workspaceId || controller.workspace_id === workspaceId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function ensureAutopilotController(input: {
  sessionId: string;
  workspaceId?: string;
  mode?: AutopilotControllerRecord["mode"];
  maxIterations?: number;
  maxRuntimeMinutes?: number;
}): AutopilotControllerRecord {
  const existing = getAutopilotController(input.sessionId);
  if (existing) return existing;
  const timestamp = nowIso();
  return saveAutopilotController({
    session_id: input.sessionId,
    workspace_id: input.workspaceId || "default",
    mode: input.mode || "assisted",
    status: "ready",
    phase: "intake",
    iteration: 0,
    max_iterations: Math.max(1, input.maxIterations || 12),
    max_runtime_minutes: Math.max(1, input.maxRuntimeMinutes || 120),
    started_at: null,
    paused_at: null,
    completed_at: null,
    last_tick_at: null,
    next_tick_at: null,
    last_action: null,
    last_detail: null,
    handoff_reason: null,
    pending_gate: null,
    created_at: timestamp,
    updated_at: timestamp,
    metadata: {},
  });
}
