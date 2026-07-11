import path from "node:path";
import { REPLAYS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { validateReplayResult } from "../validators.js";
import type { ReplayResult } from "./types.js";

function runReplaysDir(runId: string): string {
  return path.join(REPLAYS_DIR, encodeURIComponent(runId));
}

function replayPath(runId: string, replayId: string): string {
  return path.join(runReplaysDir(runId), `${encodeURIComponent(replayId)}.json`);
}

export function saveReplay(result: ReplayResult): ReplayResult {
  if (!validateReplayResult(result)) {
    const detail = validateReplayResult.errors
      ?.map((error) => `${error.instancePath} ${error.message}`)
      .join("; ");
    throw new Error(`Replay validation failed: ${detail || "unknown schema error"}`);
  }
  getJsonStorageBackend().writeJson(replayPath(result.run_id, result.replay_id), result);
  return result;
}

export function getReplay(runId: string, replayId: string): ReplayResult | null {
  const storage = getJsonStorageBackend();
  const filePath = replayPath(runId, replayId);
  return storage.exists(filePath) ? storage.readJson<ReplayResult>(filePath) : null;
}

export function listReplays(runId: string): ReplayResult[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(runReplaysDir(runId))
    .map((file) => storage.readJson<ReplayResult>(file))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function findReplayByEventDigest(runId: string, eventDigest: string): ReplayResult | null {
  return listReplays(runId).find((result) => result.event_digest === eventDigest) || null;
}
