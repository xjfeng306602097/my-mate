import fs from "node:fs";
import path from "node:path";
import { SESSION_INTERVENTIONS_DIR } from "./config.js";
import type {
  SessionInterventionKind,
  SessionInterventionRecord,
  SessionInterventionStatus,
} from "./types.js";
import {
  ensureDir,
  generateSessionInterventionId,
  nowIso,
  writeJsonAtomic,
} from "./utils.js";

function sessionInterventionDir(sessionId: string): string {
  return path.join(SESSION_INTERVENTIONS_DIR, sessionId);
}

function sessionInterventionPath(sessionId: string, interventionId: string): string {
  return path.join(sessionInterventionDir(sessionId), `${interventionId}.json`);
}

export function saveSessionIntervention(
  intervention: SessionInterventionRecord,
): SessionInterventionRecord {
  ensureDir(sessionInterventionDir(intervention.session_id));
  writeJsonAtomic(
    sessionInterventionPath(intervention.session_id, intervention.intervention_id),
    intervention,
  );
  return intervention;
}

export function createSessionIntervention(input: {
  sessionId: string;
  runId: string | null;
  nodeRunId: string | null;
  requestedBy: string;
  kind: SessionInterventionKind;
  status: SessionInterventionStatus;
  content: string;
  summary: string;
  interpretedIntent: string;
  patchPreview: SessionInterventionRecord["patch_preview"];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): SessionInterventionRecord {
  const timestamp = input.createdAt || nowIso();
  return saveSessionIntervention({
    intervention_id: generateSessionInterventionId(),
    session_id: input.sessionId,
    run_id: input.runId,
    node_run_id: input.nodeRunId,
    requested_by: input.requestedBy,
    kind: input.kind,
    status: input.status,
    content: input.content,
    summary: input.summary,
    interpreted_intent: input.interpretedIntent,
    patch_preview: input.patchPreview,
    metadata: input.metadata || {},
    created_at: timestamp,
    updated_at: timestamp,
  });
}

export function listSessionInterventions(sessionId: string): SessionInterventionRecord[] {
  const dirPath = sessionInterventionDir(sessionId);
  ensureDir(dirPath);
  const files = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));

  const interventions = files.map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, "utf-8")) as SessionInterventionRecord,
  );

  interventions.sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.intervention_id.localeCompare(b.intervention_id);
    }
    return a.created_at.localeCompare(b.created_at);
  });
  return interventions;
}
