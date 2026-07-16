import { createHash } from "node:crypto";
import path from "node:path";
import {
  MISSION_MATERIALIZER_CHECKPOINTS_DIR,
  MISSION_MATERIALIZER_EVENTS_DIR,
  MISSION_MATERIALIZER_PROJECTIONS_DIR,
} from "./config.js";
import {
  buildMissionWorkspaceProjection,
  type MissionWorkspaceProjection,
} from "./mission-workspace.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  RunRouteSnapshot,
  SessionMessageRecord,
  SessionRecord,
} from "./types.js";
import { ensureDir, nowIso, writeJsonAtomic } from "./utils.js";

export const MISSION_MATERIALIZER_VERSION = 1;
const DEFAULT_CHECKPOINT_INTERVAL = 25;

export type MissionMaterializerEventKind =
  | "session.replaced"
  | "message.upserted"
  | "workspace_state.replaced"
  | "run_route.replaced";

export interface MissionMaterializerEvent {
  schema_version: 1;
  event_id: string;
  session_id: string;
  sequence: number;
  kind: MissionMaterializerEventKind;
  source_key: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  appended_at: string;
}

export interface MissionMaterializerReducerState {
  session: SessionRecord | null;
  messages: Record<string, SessionMessageRecord>;
  workspace_state: Record<string, unknown>;
  run_route: RunRouteSnapshot | null;
}

export interface MissionMaterializerCheckpoint {
  schema_version: 1;
  materializer_version: 1;
  session_id: string;
  last_sequence: number;
  event_count: number;
  source_digest: string;
  projection_digest: string;
  reducer_state: MissionMaterializerReducerState;
  projection: MissionWorkspaceProjection;
  created_at: string;
}

export interface MissionMaterializerProjectionRecord {
  schema_version: 1;
  materializer_version: 1;
  session_id: string;
  last_sequence: number;
  event_count: number;
  source_digest: string;
  projection_digest: string;
  projection: MissionWorkspaceProjection;
  checkpoint_sequence: number | null;
  materialized_at: string;
}

export interface MissionMaterializerSource {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  workspaceState: Record<string, unknown>;
  runRoute?: RunRouteSnapshot | null;
}

export interface MissionMaterializerConsistencyReport {
  session_id: string;
  status: "consistent" | "drifted";
  source_digest: string;
  direct_projection_digest: string;
  materialized_projection_digest: string;
  last_sequence: number;
  event_count: number;
  checkpoint_sequence: number | null;
  differing_sections: string[];
  verified_at: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

function sessionEventDir(sessionId: string): string {
  return path.join(MISSION_MATERIALIZER_EVENTS_DIR, encodeURIComponent(sessionId));
}

function eventPath(sessionId: string, sequence: number): string {
  return path.join(sessionEventDir(sessionId), `${String(sequence).padStart(12, "0")}.json`);
}

function checkpointPath(sessionId: string): string {
  return path.join(MISSION_MATERIALIZER_CHECKPOINTS_DIR, `${encodeURIComponent(sessionId)}.json`);
}

function projectionPath(sessionId: string): string {
  return path.join(MISSION_MATERIALIZER_PROJECTIONS_DIR, `${encodeURIComponent(sessionId)}.json`);
}

export function listMissionMaterializerEvents(sessionId: string): MissionMaterializerEvent[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(sessionEventDir(sessionId))
    .map((file) => storage.readJson<MissionMaterializerEvent>(file))
    .sort((left, right) => left.sequence - right.sequence);
}

export function getMissionMaterializerCheckpoint(
  sessionId: string,
): MissionMaterializerCheckpoint | null {
  const storage = getJsonStorageBackend();
  const file = checkpointPath(sessionId);
  return storage.exists(file) ? storage.readJson<MissionMaterializerCheckpoint>(file) : null;
}

export function getMissionMaterializerProjection(
  sessionId: string,
): MissionMaterializerProjectionRecord | null {
  const storage = getJsonStorageBackend();
  const file = projectionPath(sessionId);
  return storage.exists(file)
    ? storage.readJson<MissionMaterializerProjectionRecord>(file)
    : null;
}

function emptyState(): MissionMaterializerReducerState {
  return { session: null, messages: {}, workspace_state: {}, run_route: null };
}

function applyEvent(
  state: MissionMaterializerReducerState,
  event: MissionMaterializerEvent,
): MissionMaterializerReducerState {
  if (event.kind === "session.replaced") {
    return { ...state, session: event.payload.session as unknown as SessionRecord };
  }
  if (event.kind === "message.upserted") {
    const message = event.payload.message as unknown as SessionMessageRecord;
    return { ...state, messages: { ...state.messages, [message.message_id]: message } };
  }
  if (event.kind === "workspace_state.replaced") {
    return {
      ...state,
      workspace_state: event.payload.workspace_state as Record<string, unknown>,
    };
  }
  return {
    ...state,
    run_route: (event.payload.run_route || null) as RunRouteSnapshot | null,
  };
}

function sortedMessages(state: MissionMaterializerReducerState): SessionMessageRecord[] {
  return Object.values(state.messages).sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.message_id.localeCompare(right.message_id),
  );
}

function projectState(state: MissionMaterializerReducerState): MissionWorkspaceProjection {
  if (!state.session) throw new Error("MISSION_MATERIALIZER_SESSION_MISSING");
  return buildMissionWorkspaceProjection({
    session: state.session,
    messages: sortedMessages(state),
    workspaceState: state.workspace_state,
    runRoute: state.run_route,
  });
}

function sourceCandidates(source: MissionMaterializerSource): Array<{
  kind: MissionMaterializerEventKind;
  sourceKey: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}> {
  const sessionPayload = { session: source.session };
  const workspacePayload = { workspace_state: source.workspaceState };
  const routePayload = { run_route: source.runRoute || null };
  return [
    {
      kind: "session.replaced",
      sourceKey: `session:${digest(sessionPayload)}`,
      payload: sessionPayload,
      occurredAt: source.session.updated_at,
    },
    ...source.messages.map((message) => ({
      kind: "message.upserted" as const,
      sourceKey: `message:${message.message_id}:${digest(message)}`,
      payload: { message },
      occurredAt: message.created_at,
    })),
    {
      kind: "workspace_state.replaced",
      sourceKey: `workspace:${digest(workspacePayload)}`,
      payload: workspacePayload,
      occurredAt: source.session.updated_at,
    },
    {
      kind: "run_route.replaced",
      sourceKey: `route:${digest(routePayload)}`,
      payload: routePayload,
      occurredAt: source.runRoute?.created_at || source.session.updated_at,
    },
  ];
}

export function synchronizeMissionMaterializerEvents(
  source: MissionMaterializerSource,
  appendedAt = nowIso(),
): MissionMaterializerEvent[] {
  const existing = listMissionMaterializerEvents(source.session.session_id);
  const existingKeys = new Set(existing.map((event) => event.source_key));
  let sequence = existing.at(-1)?.sequence || 0;
  ensureDir(sessionEventDir(source.session.session_id));
  for (const candidate of sourceCandidates(source)) {
    if (existingKeys.has(candidate.sourceKey)) continue;
    const next: MissionMaterializerEvent = {
      schema_version: 1,
      event_id: `mission_evt_${digest(candidate.sourceKey).slice(7, 23)}`,
      session_id: source.session.session_id,
      sequence: ++sequence,
      kind: candidate.kind,
      source_key: candidate.sourceKey,
      payload: candidate.payload,
      occurred_at: candidate.occurredAt,
      appended_at: appendedAt,
    };
    writeJsonAtomic(eventPath(next.session_id, next.sequence), next);
    existing.push(next);
    existingKeys.add(next.source_key);
  }
  return existing;
}

export function materializeMissionFromEvents(input: {
  sessionId: string;
  forceRebuild?: boolean;
  checkpointInterval?: number;
  materializedAt?: string;
}): MissionMaterializerProjectionRecord {
  const events = listMissionMaterializerEvents(input.sessionId);
  if (events.length === 0) throw new Error("MISSION_MATERIALIZER_EVENTS_MISSING");
  const checkpoint = input.forceRebuild ? null : getMissionMaterializerCheckpoint(input.sessionId);
  let state = checkpoint?.reducer_state || emptyState();
  const startSequence = checkpoint?.last_sequence || 0;
  for (const event of events) {
    if (event.sequence > startSequence) state = applyEvent(state, event);
  }
  const projection = projectState(state);
  const materializedAt = input.materializedAt || nowIso();
  const sourceDigest = digest({
    session: state.session,
    messages: sortedMessages(state),
    workspaceState: state.workspace_state,
    runRoute: state.run_route,
  });
  const projectionDigest = digest(projection);
  const lastSequence = events.at(-1)?.sequence || 0;
  const interval = Math.max(1, input.checkpointInterval || DEFAULT_CHECKPOINT_INTERVAL);
  const shouldCheckpoint =
    input.forceRebuild ||
    !checkpoint ||
    lastSequence - checkpoint.last_sequence >= interval;
  let checkpointSequence = checkpoint?.last_sequence || null;
  if (shouldCheckpoint) {
    const nextCheckpoint: MissionMaterializerCheckpoint = {
      schema_version: 1,
      materializer_version: MISSION_MATERIALIZER_VERSION,
      session_id: input.sessionId,
      last_sequence: lastSequence,
      event_count: events.length,
      source_digest: sourceDigest,
      projection_digest: projectionDigest,
      reducer_state: state,
      projection,
      created_at: materializedAt,
    };
    ensureDir(MISSION_MATERIALIZER_CHECKPOINTS_DIR);
    writeJsonAtomic(checkpointPath(input.sessionId), nextCheckpoint);
    checkpointSequence = lastSequence;
  }
  const record: MissionMaterializerProjectionRecord = {
    schema_version: 1,
    materializer_version: MISSION_MATERIALIZER_VERSION,
    session_id: input.sessionId,
    last_sequence: lastSequence,
    event_count: events.length,
    source_digest: sourceDigest,
    projection_digest: projectionDigest,
    projection,
    checkpoint_sequence: checkpointSequence,
    materialized_at: materializedAt,
  };
  ensureDir(MISSION_MATERIALIZER_PROJECTIONS_DIR);
  writeJsonAtomic(projectionPath(input.sessionId), record);
  return record;
}

export function synchronizeAndMaterializeMission(
  source: MissionMaterializerSource,
  options?: { forceRebuild?: boolean; checkpointInterval?: number; timestamp?: string },
): MissionMaterializerProjectionRecord {
  synchronizeMissionMaterializerEvents(source, options?.timestamp);
  return materializeMissionFromEvents({
    sessionId: source.session.session_id,
    forceRebuild: options?.forceRebuild,
    checkpointInterval: options?.checkpointInterval,
    materializedAt: options?.timestamp,
  });
}

function differingSections(
  direct: MissionWorkspaceProjection,
  materialized: MissionWorkspaceProjection,
): string[] {
  return (["missionSpec", "missionSpecContract", "missionSnapshot"] as const).filter(
    (key) => digest(direct[key]) !== digest(materialized[key]),
  );
}

export function verifyMissionMaterialization(
  source: MissionMaterializerSource,
  verifiedAt = nowIso(),
): MissionMaterializerConsistencyReport {
  synchronizeMissionMaterializerEvents(source, verifiedAt);
  const record = materializeMissionFromEvents({
    sessionId: source.session.session_id,
    forceRebuild: true,
    materializedAt: verifiedAt,
  });
  const direct = buildMissionWorkspaceProjection({
    session: source.session,
    messages: source.messages,
    workspaceState: source.workspaceState,
    runRoute: source.runRoute || null,
  });
  const directDigest = digest(direct);
  const sections = differingSections(direct, record.projection);
  return {
    session_id: source.session.session_id,
    status: sections.length === 0 ? "consistent" : "drifted",
    source_digest: record.source_digest,
    direct_projection_digest: directDigest,
    materialized_projection_digest: record.projection_digest,
    last_sequence: record.last_sequence,
    event_count: record.event_count,
    checkpoint_sequence: record.checkpoint_sequence,
    differing_sections: sections,
    verified_at: verifiedAt,
  };
}
