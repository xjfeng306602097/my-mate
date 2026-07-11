import path from "node:path";
import { OBSERVABILITY_DIRTY_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { nowIso } from "./utils.js";

interface ObservabilityDirtyMarker {
  schema_version: 1;
  run_id: string;
  dirty: boolean;
  marked_at: string;
}

function markerPath(runId: string): string {
  return path.join(OBSERVABILITY_DIRTY_DIR, `${encodeURIComponent(runId)}.json`);
}

export function markObservabilityRunDirty(runId: string): void {
  if (!runId) return;
  getJsonStorageBackend().writeJson(markerPath(runId), {
    schema_version: 1,
    run_id: runId,
    dirty: true,
    marked_at: nowIso(),
  } satisfies ObservabilityDirtyMarker);
}

export function clearObservabilityRunDirty(runId: string): void {
  if (!runId) return;
  getJsonStorageBackend().removeJson(markerPath(runId));
}

export function listDirtyObservabilityRunIds(): Set<string> {
  const storage = getJsonStorageBackend();
  return new Set(
    storage.listJsonFiles(OBSERVABILITY_DIRTY_DIR).map((filePath) =>
      decodeURIComponent(path.basename(filePath, ".json")),
    ),
  );
}
