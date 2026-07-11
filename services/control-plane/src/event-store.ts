import path from "node:path";
import { EVENTS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { markObservabilityRunDirty } from "./observability-index-dirty.js";
import type { ActorType, EventRecord, EventType } from "./types.js";
import { ensureDir, generateEventId, nowIso, writeJsonAtomic } from "./utils.js";
import { validateEvent } from "./validators.js";

function runEventsDir(runId: string): string {
  return path.join(EVENTS_DIR, runId);
}

function eventPath(runId: string, eventId: string): string {
  return path.join(runEventsDir(runId), `${eventId}.json`);
}

function assertValidEventRecord(event: EventRecord): void {
  const ok = validateEvent(event);
  if (!ok) {
    const errorText =
      validateEvent.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ") ||
      "unknown schema error";
    throw new Error(`Event validation failed: ${errorText}`);
  }
}

export function appendRunEvent(input: {
  run_id: string;
  node_run_id?: string | null;
  type: EventType;
  actor_type: ActorType;
  actor_id: string;
  payload?: Record<string, unknown>;
  created_at?: string;
  correlation_id?: string | null;
  causation_id?: string | null;
  idempotency_key?: string | null;
}): EventRecord {
  const storage = getJsonStorageBackend();
  const existingEvents = storage
    .listJsonFiles(runEventsDir(input.run_id))
    .map((file) => storage.readJson<EventRecord>(file));
  if (input.idempotency_key) {
    const existing = existingEvents.find(
      (event) => event.idempotency_key === input.idempotency_key,
    );
    if (existing) {
      return existing;
    }
  }
  const nextSequence = existingEvents
    .map((event) => event.run_sequence || 0)
    .reduce((maximum, sequence) => Math.max(maximum, sequence), 0) + 1;
  const eventId = generateEventId();
  const event: EventRecord = {
    schema_version: 2,
    event_id: eventId,
    run_sequence: nextSequence,
    correlation_id: input.correlation_id ?? null,
    causation_id: input.causation_id ?? null,
    idempotency_key: input.idempotency_key ?? eventId,
    run_id: input.run_id,
    node_run_id: input.node_run_id ?? null,
    type: input.type,
    actor_type: input.actor_type,
    actor_id: input.actor_id,
    payload: input.payload ?? {},
    created_at: input.created_at ?? nowIso(),
  };

  assertValidEventRecord(event);
  ensureDir(runEventsDir(event.run_id));
  writeJsonAtomic(eventPath(event.run_id, event.event_id), event);
  markObservabilityRunDirty(event.run_id);
  return event;
}

export function listRunEvents(runId: string): EventRecord[] {
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(runEventsDir(runId));
  const events = files.map((file) => storage.readJson<EventRecord>(file));

  events.sort((a, b) => {
    if (a.run_sequence && b.run_sequence && a.run_sequence !== b.run_sequence) {
      return a.run_sequence - b.run_sequence;
    }
    const byTime = a.created_at.localeCompare(b.created_at);
    if (byTime !== 0) {
      return byTime;
    }
    return a.event_id.localeCompare(b.event_id);
  });

  return events;
}
