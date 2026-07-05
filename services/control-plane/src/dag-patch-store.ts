import fs from "node:fs";
import path from "node:path";
import { DAG_PATCHES_DIR } from "./config.js";
import type { DagPatchRecord } from "./types.js";
import { ensureDir, generateDagPatchId, nowIso, writeJsonAtomic } from "./utils.js";

function sessionDagPatchDir(sessionId: string): string {
  return path.join(DAG_PATCHES_DIR, sessionId);
}

function dagPatchPath(sessionId: string, patchId: string): string {
  return path.join(sessionDagPatchDir(sessionId), `${patchId}.json`);
}

export function saveDagPatch(patch: DagPatchRecord): DagPatchRecord {
  ensureDir(sessionDagPatchDir(patch.session_id));
  const normalized = normalizeDagPatchRecord(patch);
  writeJsonAtomic(dagPatchPath(normalized.session_id, normalized.patch_id), normalized);
  return normalized;
}

function normalizeDagPatchRecord(record: DagPatchRecord): DagPatchRecord {
  return {
    ...record,
    operation_outcomes: Array.isArray(record.operation_outcomes) ? record.operation_outcomes : [],
    application_errors: Array.isArray(record.application_errors) ? record.application_errors : [],
    resumed_topology: record.resumed_topology || null,
    graph_preview:
      record.graph_preview ||
      (record.metadata && typeof record.metadata.graph_preview === "object"
        ? (record.metadata.graph_preview as DagPatchRecord["graph_preview"])
        : null),
    metadata: record.metadata || {},
  };
}

export function createDagPatch(input: {
  sessionId: string;
  runId: string | null;
  interventionId: string | null;
  requestedBy: string;
  status: DagPatchRecord["status"];
  reason: string;
  summary: string;
  operations: DagPatchRecord["operations"];
  requiresConfirmation: boolean;
  applySupported: boolean;
  unsupportedReason: string | null;
  graphPreview?: DagPatchRecord["graph_preview"];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): DagPatchRecord {
  const timestamp = input.createdAt || nowIso();
  return saveDagPatch({
    patch_id: generateDagPatchId(),
    session_id: input.sessionId,
    run_id: input.runId,
    intervention_id: input.interventionId,
    requested_by: input.requestedBy,
    status: input.status,
    reason: input.reason,
    summary: input.summary,
    operations: input.operations,
    requires_confirmation: input.requiresConfirmation,
    apply_supported: input.applySupported,
    unsupported_reason: input.unsupportedReason,
    created_at: timestamp,
    updated_at: timestamp,
    applied_at: null,
    applied_by: null,
    rejected_at: null,
    rejected_by: null,
    operation_outcomes: [],
    application_errors: [],
    resumed_topology: null,
    graph_preview: input.graphPreview || null,
    metadata: input.metadata || {},
  });
}

export function getDagPatch(sessionId: string, patchId: string): DagPatchRecord | null {
  const filePath = dagPatchPath(sessionId, patchId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return normalizeDagPatchRecord(JSON.parse(fs.readFileSync(filePath, "utf-8")) as DagPatchRecord);
}

export function updateDagPatch(
  sessionId: string,
  patchId: string,
  updater: (current: DagPatchRecord) => DagPatchRecord,
): DagPatchRecord | null {
  const current = getDagPatch(sessionId, patchId);
  if (!current) {
    return null;
  }
  const next = updater(current);
  next.updated_at = nowIso();
  return saveDagPatch(next);
}

export function listSessionDagPatches(sessionId: string): DagPatchRecord[] {
  const dirPath = sessionDagPatchDir(sessionId);
  ensureDir(dirPath);
  const files = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));

  const patches = files.map((filePath) =>
    normalizeDagPatchRecord(JSON.parse(fs.readFileSync(filePath, "utf-8")) as DagPatchRecord),
  );

  patches.sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.patch_id.localeCompare(b.patch_id);
    }
    return a.created_at.localeCompare(b.created_at);
  });
  return patches;
}
