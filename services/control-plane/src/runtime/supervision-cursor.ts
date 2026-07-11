import type { ArtifactRecord, EventRecord } from "../types.js";
import type { WorkerEvidence } from "../runtime-protocol.js";
import type { NodeHandoffRecord } from "./node-handoff-store.js";

export interface SupervisionCursorPosition {
  version: 1;
  run_id: string;
  event_sequence: number;
  event_id: string | null;
  evidence_created_at: string | null;
  evidence_id: string | null;
  handoff_created_at: string | null;
  handoff_id: string | null;
  artifact_created_at: string | null;
  artifact_id: string | null;
  graph_revision: number;
}

export function encodeSupervisionCursor(position: SupervisionCursorPosition): string {
  return Buffer.from(JSON.stringify(position), "utf-8").toString("base64url");
}

export function decodeSupervisionCursor(
  cursor: string,
  runId: string,
): SupervisionCursorPosition {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_CURSOR");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.run_id !== runId ||
    typeof record.event_sequence !== "number" ||
    typeof record.graph_revision !== "number"
  ) {
    throw new Error("INVALID_CURSOR");
  }
  return record as unknown as SupervisionCursorPosition;
}

export function initialSupervisionCursor(runId: string): SupervisionCursorPosition {
  return {
    version: 1,
    run_id: runId,
    event_sequence: 0,
    event_id: null,
    evidence_created_at: null,
    evidence_id: null,
    handoff_created_at: null,
    handoff_id: null,
    artifact_created_at: null,
    artifact_id: null,
    graph_revision: 0,
  };
}

export function buildSupervisionCursorPosition(input: {
  runId: string;
  events: EventRecord[];
  evidence: WorkerEvidence[];
  handoffs: NodeHandoffRecord[];
  artifacts: ArtifactRecord[];
}): SupervisionCursorPosition {
  const event = input.events.at(-1) || null;
  const evidence = input.evidence.at(-1) || null;
  const handoff = input.handoffs.at(-1) || null;
  const artifact = input.artifacts.at(-1) || null;
  const sequence = event?.run_sequence || input.events.length;
  return {
    version: 1,
    run_id: input.runId,
    event_sequence: sequence,
    event_id: event?.event_id || null,
    evidence_created_at: evidence?.created_at || null,
    evidence_id: evidence?.evidence_id || null,
    handoff_created_at: handoff?.created_at || null,
    handoff_id: handoff?.handoff_id || null,
    artifact_created_at: artifact?.created_at || null,
    artifact_id: artifact?.artifact_id || null,
    graph_revision: sequence,
  };
}
