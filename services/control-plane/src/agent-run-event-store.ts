import { createHash } from "node:crypto";
import path from "node:path";
import { AGENT_RUN_EVENTS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  AgentRunEventRecord,
  AgentRunEventStatus,
  AgentRunEventType,
} from "./types.js";
import { generateEventId, nowIso } from "./utils.js";

function runDir(agentRunId: string): string {
  return path.join(AGENT_RUN_EVENTS_DIR, encodeURIComponent(agentRunId));
}

function eventPath(agentRunId: string, sequence: number, eventId: string): string {
  return path.join(
    runDir(agentRunId),
    `${String(sequence).padStart(10, "0")}-${encodeURIComponent(eventId)}.json`,
  );
}

interface AgentRunEventCursor {
  workspace_id: string;
  agent_run_id: string;
  last_sequence: number;
  updated_at: string;
}

interface AgentRunEventIdempotencyRecord {
  workspace_id: string;
  agent_run_id: string;
  idempotency_key: string;
  event: AgentRunEventRecord;
}

function cursorPath(agentRunId: string): string {
  return path.join(runDir(agentRunId), "_cursor.json");
}

function idempotencyPath(agentRunId: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return path.join(runDir(agentRunId), "_idempotency", `${digest}.json`);
}

function isAgentRunEvent(value: unknown): value is AgentRunEventRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<AgentRunEventRecord>;
  return typeof event.event_id === "string" &&
    typeof event.agent_run_id === "string" &&
    Number.isInteger(event.sequence) &&
    Number(event.sequence) > 0;
}

function listStoredAgentRunEvents(agentRunId: string): AgentRunEventRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(runDir(agentRunId))
    .filter((file) => path.basename(file) !== "_cursor.json")
    .map((file) => storage.readJson<unknown>(file))
    .filter(isAgentRunEvent)
    .sort((left, right) => left.sequence - right.sequence);
}

function loadOrRebuildCursor(workspaceId: string, agentRunId: string): AgentRunEventCursor {
  const storage = getJsonStorageBackend();
  const target = cursorPath(agentRunId);
  if (storage.exists(target)) {
    const cursor = storage.readJson<AgentRunEventCursor>(target);
    if (
      cursor.workspace_id === workspaceId &&
      cursor.agent_run_id === agentRunId &&
      Number.isInteger(cursor.last_sequence) &&
      cursor.last_sequence >= 0
    ) {
      return cursor;
    }
  }

  const events = listStoredAgentRunEvents(agentRunId)
    .filter((event) => event.workspace_id === workspaceId && event.agent_run_id === agentRunId);
  const cursor: AgentRunEventCursor = {
    workspace_id: workspaceId,
    agent_run_id: agentRunId,
    last_sequence: events.at(-1)?.sequence || 0,
    updated_at: nowIso(),
  };
  storage.writeJson(target, cursor);
  for (const event of events) {
    if (!event.idempotency_key) continue;
    storage.writeJson(idempotencyPath(agentRunId, event.idempotency_key), {
      workspace_id: workspaceId,
      agent_run_id: agentRunId,
      idempotency_key: event.idempotency_key,
      event,
    } satisfies AgentRunEventIdempotencyRecord);
  }
  return cursor;
}

export function listAgentRunEvents(input: {
  workspaceId: string;
  agentRunId: string;
  afterSequence?: number;
  limit?: number;
}): AgentRunEventRecord[] {
  const afterSequence = Number.isInteger(input.afterSequence) ? Math.max(0, input.afterSequence!) : 0;
  const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(1_000, input.limit!)) : 250;
  return listStoredAgentRunEvents(input.agentRunId)
    .filter((event) => event.workspace_id === input.workspaceId && event.agent_run_id === input.agentRunId)
    .filter((event) => event.sequence > afterSequence)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, limit);
}

export function appendAgentRunEvent(input: {
  workspaceId: string;
  dagId: string;
  nodeId: string;
  taskId: string;
  agentRunId: string;
  childSessionId?: string | null;
  type: AgentRunEventType;
  status: AgentRunEventStatus;
  summary: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}): AgentRunEventRecord {
  const storage = getJsonStorageBackend();
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const indexPath = idempotencyPath(input.agentRunId, idempotencyKey);
    if (storage.exists(indexPath)) {
      const indexed = storage.readJson<AgentRunEventIdempotencyRecord>(indexPath);
      if (
        indexed.workspace_id === input.workspaceId &&
        indexed.agent_run_id === input.agentRunId &&
        indexed.idempotency_key === idempotencyKey &&
        isAgentRunEvent(indexed.event)
      ) {
        const indexedEventPath = eventPath(input.agentRunId, indexed.event.sequence, indexed.event.event_id);
        if (!storage.exists(indexedEventPath)) storage.writeJson(indexedEventPath, indexed.event);
        return indexed.event;
      }
      storage.removeJson(indexPath);
    }
  }
  const cursor = loadOrRebuildCursor(input.workspaceId, input.agentRunId);
  const sequence = cursor.last_sequence + 1;
  const event: AgentRunEventRecord = {
    event_id: generateEventId(),
    workspace_id: input.workspaceId,
    dag_id: input.dagId,
    node_id: input.nodeId,
    task_id: input.taskId,
    agent_run_id: input.agentRunId,
    child_session_id: input.childSessionId || null,
    sequence,
    type: input.type,
    status: input.status,
    summary: input.summary.trim().slice(0, 4_000) || "Agent activity recorded.",
    payload: input.payload || {},
    idempotency_key: idempotencyKey,
    created_at: nowIso(),
  };

  // Persist the reservation before the event. A process crash may leave a gap,
  // but can never reuse an SSE sequence and replay an event under the same id.
  storage.writeJson(cursorPath(input.agentRunId), {
    ...cursor,
    last_sequence: sequence,
    updated_at: event.created_at,
  } satisfies AgentRunEventCursor);
  if (idempotencyKey) {
    storage.writeJson(idempotencyPath(input.agentRunId, idempotencyKey), {
      workspace_id: input.workspaceId,
      agent_run_id: input.agentRunId,
      idempotency_key: idempotencyKey,
      event,
    } satisfies AgentRunEventIdempotencyRecord);
  }
  storage.writeJson(eventPath(input.agentRunId, sequence, event.event_id), event);
  return event;
}
