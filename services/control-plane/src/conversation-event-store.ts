import { createHash } from "node:crypto";
import path from "node:path";
import { CONVERSATION_EVENTS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { generateEventId, nowIso } from "./utils.js";

export interface ConversationEventRecord {
  event_id: string;
  workspace_id: string;
  session_id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  idempotency_key: string | null;
  created_at: string;
}

type ConversationEventListener = (event: ConversationEventRecord) => void;

interface ConversationEventCursor {
  workspace_id: string;
  session_id: string;
  last_sequence: number;
  updated_at: string;
}

interface ConversationEventIdempotencyRecord {
  workspace_id: string;
  session_id: string;
  idempotency_key: string;
  event: ConversationEventRecord;
}

const listeners = new Map<string, Set<ConversationEventListener>>();

function sessionDir(sessionId: string): string {
  return path.join(CONVERSATION_EVENTS_DIR, encodeURIComponent(sessionId));
}

function eventPath(sessionId: string, sequence: number, eventId: string): string {
  return path.join(sessionDir(sessionId), `${String(sequence).padStart(10, "0")}-${encodeURIComponent(eventId)}.json`);
}

function cursorPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), "_cursor.json");
}

function idempotencyPath(sessionId: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(sessionDir(sessionId), "_idempotency", `${digest}.json`);
}

function isEvent(value: unknown): value is ConversationEventRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<ConversationEventRecord>;
  return typeof event.event_id === "string" &&
    typeof event.session_id === "string" &&
    Number.isInteger(event.sequence) && Number(event.sequence) > 0 &&
    typeof event.type === "string" &&
    !!event.payload && typeof event.payload === "object" && !Array.isArray(event.payload);
}

function storedEvents(sessionId: string): ConversationEventRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(sessionDir(sessionId))
    .filter((file) => path.basename(file) !== "_cursor.json")
    .map((file) => storage.readJson<unknown>(file))
    .filter(isEvent)
    .sort((left, right) => (left.sequence || 0) - (right.sequence || 0));
}

function loadCursor(workspaceId: string, sessionId: string): ConversationEventCursor {
  const storage = getJsonStorageBackend();
  const file = cursorPath(sessionId);
  if (storage.exists(file)) {
    const cursor = storage.readJson<ConversationEventCursor>(file);
    if (cursor.workspace_id === workspaceId && cursor.session_id === sessionId && Number.isInteger(cursor.last_sequence) && cursor.last_sequence >= 0) return cursor;
  }
  const events = storedEvents(sessionId).filter((event) => event.workspace_id === workspaceId && event.session_id === sessionId);
  const cursor = { workspace_id: workspaceId, session_id: sessionId, last_sequence: events.at(-1)?.sequence || 0, updated_at: nowIso() };
  storage.writeJson(file, cursor);
  return cursor;
}

export function listConversationEvents(input: { workspaceId: string; sessionId: string; afterSequence?: number; limit?: number }): ConversationEventRecord[] {
  const after = Number.isInteger(input.afterSequence) ? Math.max(0, input.afterSequence || 0) : 0;
  const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(1_000, input.limit || 1)) : 250;
  return storedEvents(input.sessionId)
    .filter((event) => event.workspace_id === input.workspaceId && event.session_id === input.sessionId && event.sequence > after)
    .slice(0, limit);
}

export function latestConversationEventSequence(sessionId: string, workspaceId = "default"): number {
  return loadCursor(workspaceId, sessionId).last_sequence;
}

export function appendConversationEvent(input: {
  workspaceId: string;
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
}): ConversationEventRecord {
  const storage = getJsonStorageBackend();
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const indexedPath = idempotencyPath(input.sessionId, idempotencyKey);
    if (storage.exists(indexedPath)) {
      const indexed = storage.readJson<ConversationEventIdempotencyRecord>(indexedPath);
      if (indexed.workspace_id === input.workspaceId && indexed.session_id === input.sessionId && indexed.idempotency_key === idempotencyKey && isEvent(indexed.event)) return indexed.event;
      storage.removeJson(indexedPath);
    }
  }
  const cursor = loadCursor(input.workspaceId, input.sessionId);
  const event: ConversationEventRecord = {
    event_id: generateEventId(),
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    sequence: cursor.last_sequence + 1,
    type: input.type,
    payload: structuredClone(input.payload),
    idempotency_key: idempotencyKey,
    created_at: nowIso(),
  };
  storage.writeJson(cursorPath(input.sessionId), { ...cursor, last_sequence: event.sequence, updated_at: event.created_at });
  if (idempotencyKey) storage.writeJson(idempotencyPath(input.sessionId, idempotencyKey), { workspace_id: input.workspaceId, session_id: input.sessionId, idempotency_key: idempotencyKey, event } satisfies ConversationEventIdempotencyRecord);
  storage.writeJson(eventPath(input.sessionId, event.sequence, event.event_id), event);
  for (const listener of listeners.get(input.sessionId) || []) {
    try { listener(event); } catch { /* Event observers cannot change persistence. */ }
  }
  return event;
}

export function subscribeConversationEvents(sessionId: string, listener: ConversationEventListener): () => void {
  const sessionListeners = listeners.get(sessionId) || new Set<ConversationEventListener>();
  sessionListeners.add(listener);
  listeners.set(sessionId, sessionListeners);
  return () => {
    sessionListeners.delete(listener);
    if (!sessionListeners.size) listeners.delete(sessionId);
  };
}
