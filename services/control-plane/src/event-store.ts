import fs from "node:fs";
import path from "node:path";
import { EVENTS_DIR } from "./config.js";
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
}): EventRecord {
  const event: EventRecord = {
    event_id: generateEventId(),
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
  return event;
}

export function listRunEvents(runId: string): EventRecord[] {
  const dir = runEventsDir(runId);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name));

  const events = files.map((file) =>
    JSON.parse(fs.readFileSync(file, "utf-8")) as EventRecord,
  );

  events.sort((a, b) => {
    const byTime = a.created_at.localeCompare(b.created_at);
    if (byTime !== 0) {
      return byTime;
    }
    return a.event_id.localeCompare(b.event_id);
  });

  return events;
}
