import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS_DIR } from "./config.js";
import type { ArtifactRecord, ExecutionArtifactRecord } from "./types.js";
import { ensureDir, generateArtifactId, nowIso, writeJsonAtomic } from "./utils.js";

function runArtifactsDir(runId: string): string {
  return path.join(ARTIFACTS_DIR, runId);
}

function artifactPath(runId: string, artifactId: string): string {
  return path.join(runArtifactsDir(runId), `${artifactId}.json`);
}

export function createArtifactRecord(input: {
  runId: string;
  nodeRunId: string | null;
  artifact: ExecutionArtifactRecord;
  createdAt?: string;
}): ArtifactRecord {
  return {
    artifact_id: input.artifact.artifact_id || generateArtifactId(),
    run_id: input.runId,
    node_run_id: input.nodeRunId,
    type: input.artifact.type,
    name: input.artifact.name,
    storage_uri: input.artifact.storage_uri,
    mime_type: input.artifact.mime_type,
    size_bytes: input.artifact.size_bytes,
    created_at: input.createdAt || nowIso(),
  };
}

export function saveArtifact(record: ArtifactRecord): ArtifactRecord {
  ensureDir(runArtifactsDir(record.run_id));
  writeJsonAtomic(artifactPath(record.run_id, record.artifact_id), record);
  return record;
}

export function upsertArtifacts(records: ArtifactRecord[]): ArtifactRecord[] {
  for (const record of records) {
    saveArtifact(record);
  }
  return records;
}

export function listArtifacts(runId: string): ArtifactRecord[] {
  const dir = runArtifactsDir(runId);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name));

  const items = files.map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, "utf-8")) as ArtifactRecord,
  );
  items.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return items;
}
