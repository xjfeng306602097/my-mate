import path from "node:path";
import { RUNTIME_EVENT_CURSORS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import type { WorkerEvent } from "../runtime-protocol.js";
import { isTerminalWorkerEventKind } from "../runtime-protocol.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";

export interface RuntimeEventCursorRecord {
  job_id: string;
  run_id: string;
  node_run_id: string;
  last_sequence: number;
  terminal_event_id: string | null;
  applied_idempotency_keys: string[];
  ignored_event_count: number;
  updated_at: string;
}

export type RuntimeEventDecision =
  | { apply: true; reason: "new_event" }
  | { apply: false; reason: "duplicate" | "out_of_order" | "terminal_closed" };

function cursorPath(jobId: string): string {
  return path.join(RUNTIME_EVENT_CURSORS_DIR, `${encodeURIComponent(jobId)}.json`);
}

export function getRuntimeEventCursor(jobId: string): RuntimeEventCursorRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = cursorPath(jobId);
  return storage.exists(filePath) ? storage.readJson<RuntimeEventCursorRecord>(filePath) : null;
}

export function decideRuntimeEvent(event: WorkerEvent): RuntimeEventDecision {
  const cursor = getRuntimeEventCursor(event.job_id);
  if (!cursor) {
    return { apply: true, reason: "new_event" };
  }
  if (cursor.applied_idempotency_keys.includes(event.idempotency_key)) {
    return { apply: false, reason: "duplicate" };
  }
  if (cursor.terminal_event_id) {
    return { apply: false, reason: "terminal_closed" };
  }
  if (event.sequence <= cursor.last_sequence) {
    return { apply: false, reason: "out_of_order" };
  }
  return { apply: true, reason: "new_event" };
}

export function recordRuntimeEventDecision(
  event: WorkerEvent,
  decision: RuntimeEventDecision,
): RuntimeEventCursorRecord {
  const current = getRuntimeEventCursor(event.job_id);
  const keys = current?.applied_idempotency_keys || [];
  const next: RuntimeEventCursorRecord = {
    job_id: event.job_id,
    run_id: event.run_id,
    node_run_id: event.node_run_id,
    last_sequence: decision.apply
      ? Math.max(current?.last_sequence || 0, event.sequence)
      : current?.last_sequence || 0,
    terminal_event_id:
      decision.apply && isTerminalWorkerEventKind(event.kind)
        ? event.event_id
        : current?.terminal_event_id || null,
    applied_idempotency_keys: decision.apply
      ? [...new Set([...keys, event.idempotency_key])].slice(-256)
      : keys,
    ignored_event_count:
      (current?.ignored_event_count || 0) + (decision.apply ? 0 : 1),
    updated_at: event.created_at,
  };
  ensureDir(RUNTIME_EVENT_CURSORS_DIR);
  writeJsonAtomic(cursorPath(event.job_id), next);
  return next;
}

export function listRuntimeEventCursors(runId?: string): RuntimeEventCursorRecord[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(RUNTIME_EVENT_CURSORS_DIR)
    .map((file) => storage.readJson<RuntimeEventCursorRecord>(file))
    .filter((record) => !runId || record.run_id === runId);
}
