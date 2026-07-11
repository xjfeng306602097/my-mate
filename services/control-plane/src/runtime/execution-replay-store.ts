import path from "node:path";
import { EXECUTION_REPLAYS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";
import type { ExecutionReplayRecord, ExecutionReplayView } from "./recovery-contracts.js";

function runDir(runId: string): string {
  return path.join(EXECUTION_REPLAYS_DIR, encodeURIComponent(runId));
}

function recordPath(runId: string, replayId: string): string {
  return path.join(runDir(runId), `${encodeURIComponent(replayId)}.json`);
}

export function saveExecutionReplay(record: ExecutionReplayRecord): ExecutionReplayRecord {
  ensureDir(runDir(record.run_id));
  writeJsonAtomic(recordPath(record.run_id, record.replay_id), record);
  return record;
}

export function getExecutionReplay(runId: string, replayId: string): ExecutionReplayRecord | null {
  const storage = getJsonStorageBackend();
  const file = recordPath(runId, replayId);
  return storage.exists(file) ? storage.readJson<ExecutionReplayRecord>(file) : null;
}

export function listExecutionReplays(runId?: string): ExecutionReplayRecord[] {
  const storage = getJsonStorageBackend();
  const files = runId
    ? storage.listJsonFiles(runDir(runId))
    : storage.listDirs(EXECUTION_REPLAYS_DIR).flatMap((dir) => storage.listJsonFiles(dir));
  return files
    .map((file) => storage.readJson<ExecutionReplayRecord>(file))
    .sort((left, right) => left.requested_at.localeCompare(right.requested_at));
}

export function findExecutionReplayByIdempotencyKey(runId: string, key: string): ExecutionReplayRecord | null {
  return listExecutionReplays(runId).find((record) => record.idempotency_key === key) || null;
}

export function findDispatchableExecutionReplayForNode(runId: string, nodeRunId: string): ExecutionReplayRecord | null {
  return listExecutionReplays(runId).find((record) =>
    record.node_run_id === nodeRunId && record.status === "requested" && !record.replay_job_id,
  ) || null;
}

export function findExecutionReplayByJobId(runId: string, jobId: string): ExecutionReplayRecord | null {
  return listExecutionReplays(runId).find((record) => record.replay_job_id === jobId) || null;
}

export function executionReplayView(record: ExecutionReplayRecord): ExecutionReplayView {
  const { frozen_job: frozenJob, ...view } = record;
  return {
    ...view,
    frozen_input: {
      intent: frozenJob.envelope.intent,
      input_keys: Object.keys(frozenJob.envelope.input_payload || {}).sort(),
      allowed_skills: [...frozenJob.harness.allowed_skills],
      allowed_tools: [...frozenJob.harness.allowed_tools],
    },
  };
}
