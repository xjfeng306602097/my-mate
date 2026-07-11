import path from "node:path";
import { EVALUATION_SNAPSHOTS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";
import type { RunEvidenceSnapshot } from "./types.js";
import { validateRunEvidenceSnapshot } from "../validators.js";

function runSnapshotDir(runId: string): string {
  return path.join(EVALUATION_SNAPSHOTS_DIR, encodeURIComponent(runId));
}

function digestHex(digest: string): string {
  const value = digest.startsWith("sha256:") ? digest.slice(7) : digest;
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Invalid evidence digest.");
  }
  return value.toLowerCase();
}

function snapshotPath(runId: string, digest: string): string {
  return path.join(runSnapshotDir(runId), `${digestHex(digest)}.json`);
}

export function saveRunEvidenceSnapshot(
  snapshot: RunEvidenceSnapshot,
): RunEvidenceSnapshot {
  if (!validateRunEvidenceSnapshot(snapshot)) {
    const detail = validateRunEvidenceSnapshot.errors
      ?.map((error) => `${error.instancePath} ${error.message}`)
      .join("; ");
    throw new Error(`Run evidence snapshot validation failed: ${detail || "unknown schema error"}`);
  }
  ensureDir(runSnapshotDir(snapshot.run.run_id));
  writeJsonAtomic(
    snapshotPath(snapshot.run.run_id, snapshot.evidence_digest),
    snapshot,
  );
  return snapshot;
}

export function getRunEvidenceSnapshot(
  runId: string,
  digest: string,
): RunEvidenceSnapshot | null {
  const storage = getJsonStorageBackend();
  const filePath = snapshotPath(runId, digest);
  return storage.exists(filePath)
    ? storage.readJson<RunEvidenceSnapshot>(filePath)
    : null;
}

export function listRunEvidenceSnapshots(runId: string): RunEvidenceSnapshot[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(runSnapshotDir(runId))
    .map((file) => storage.readJson<RunEvidenceSnapshot>(file))
    .sort((left, right) => left.generated_at.localeCompare(right.generated_at));
}
