import path from "node:path";
import { WORKER_EVIDENCE_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { markObservabilityRunDirty } from "../observability-index-dirty.js";
import type { WorkerEvidence } from "../runtime-protocol.js";
import { validateWorkerEvidence } from "../validators.js";
import { normalizeWorkerEvidence } from "./worker-evidence-normalizer.js";

function runEvidenceDir(runId: string): string {
  return path.join(WORKER_EVIDENCE_DIR, encodeURIComponent(runId));
}

function evidencePath(record: WorkerEvidence): string {
  return path.join(runEvidenceDir(record.run_id), `${encodeURIComponent(record.evidence_id)}.json`);
}

export function saveWorkerEvidence(record: WorkerEvidence): WorkerEvidence {
  const storage = getJsonStorageBackend();
  const normalized = normalizeWorkerEvidence(record);
  if (!validateWorkerEvidence(normalized)) {
    const detail = validateWorkerEvidence.errors
      ?.map((error) => `${error.instancePath} ${error.message}`)
      .join("; ");
    throw new Error(`Worker evidence validation failed: ${detail || "unknown schema error"}`);
  }
  const filePath = evidencePath(normalized);
  storage.ensureDir(runEvidenceDir(normalized.run_id));
  if (storage.exists(filePath)) {
    return normalizeWorkerEvidence(storage.readJson<WorkerEvidence>(filePath));
  }
  const nativeEventId = normalized.source?.native_event_id;
  if (nativeEventId) {
    const duplicate = listWorkerEvidence(normalized.run_id).find(
      (item) => item.job_id === normalized.job_id && item.source?.native_event_id === nativeEventId,
    );
    if (duplicate) return duplicate;
  }
  storage.writeJson(filePath, normalized);
  markObservabilityRunDirty(normalized.run_id);
  return normalized;
}

export function listWorkerEvidence(runId: string, nodeRunId?: string): WorkerEvidence[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(runEvidenceDir(runId))
    .map((file) => normalizeWorkerEvidence(storage.readJson<WorkerEvidence>(file)))
    .filter((record) => !nodeRunId || record.node_run_id === nodeRunId)
    .sort((a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      (a.job_id === b.job_id ? (a.sequence || 0) - (b.sequence || 0) : a.job_id.localeCompare(b.job_id)) ||
      a.evidence_id.localeCompare(b.evidence_id),
    );
}
