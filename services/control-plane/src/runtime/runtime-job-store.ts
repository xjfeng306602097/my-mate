import path from "node:path";
import { RUNTIME_JOBS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { markObservabilityRunDirty } from "../observability-index-dirty.js";
import type { RuntimeDispatchResult } from "../runtime-dispatcher.js";
import type {
  RuntimeAgentRuntime,
  RuntimeWorkerJob,
  WorkerTargetKind,
} from "../runtime-protocol.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";

export type RuntimeJobStatus =
  | "created"
  | "queued"
  | "dispatching"
  | "accepted"
  | "deferred"
  | "rejected"
  | "running"
  | "waiting_human"
  | "completed"
  | "failed"
  | "cancelled";

export interface RuntimeJobRecord {
  job_id: string;
  run_id: string;
  node_run_id: string;
  attempt: number;
  dispatch_sequence: number;
  status: RuntimeJobStatus;
  worker_id: string | null;
  lease_id: string | null;
  target_kind: WorkerTargetKind;
  agent_runtime: RuntimeAgentRuntime;
  runtime_agent_ref: string | null;
  created_at: string;
  accepted_at: string | null;
  finished_at: string | null;
  last_event_id: string | null;
  last_error: string | null;
  compatibility: {
    adapter_kind: string | null;
    dispatch_id: string | null;
    openclaw_task_id: string | null;
    openclaw_session_id: string | null;
  };
  job: RuntimeWorkerJob;
}

function runRuntimeJobsDir(runId: string): string {
  return path.join(RUNTIME_JOBS_DIR, runId);
}

function runtimeJobPath(runId: string, jobId: string): string {
  return path.join(runRuntimeJobsDir(runId), `${encodeURIComponent(jobId)}.json`);
}

export function createRuntimeJobRecord(input: {
  job: RuntimeWorkerJob;
  status?: RuntimeJobStatus;
  lastEventId?: string | null;
}): RuntimeJobRecord {
  return {
    job_id: input.job.job_id,
    run_id: input.job.run_id,
    node_run_id: input.job.node_run_id,
    attempt: input.job.attempt,
    dispatch_sequence: input.job.dispatch_sequence,
    status: input.status || "created",
    worker_id: null,
    lease_id: null,
    target_kind: input.job.provision.target_kind,
    agent_runtime: input.job.harness.agent_runtime,
    runtime_agent_ref: input.job.harness.runtime_agent_ref,
    created_at: input.job.created_at,
    accepted_at: null,
    finished_at: null,
    last_event_id: input.lastEventId ?? null,
    last_error: null,
    compatibility: {
      adapter_kind: null,
      dispatch_id: null,
      openclaw_task_id: null,
      openclaw_session_id: null,
    },
    job: input.job,
  };
}

export function saveRuntimeJobRecord(record: RuntimeJobRecord): RuntimeJobRecord {
  ensureDir(runRuntimeJobsDir(record.run_id));
  writeJsonAtomic(runtimeJobPath(record.run_id, record.job_id), record);
  markObservabilityRunDirty(record.run_id);
  return record;
}

export function getRuntimeJobRecord(
  runId: string,
  jobId: string,
): RuntimeJobRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = runtimeJobPath(runId, jobId);
  if (!storage.exists(filePath)) {
    return null;
  }
  return storage.readJson<RuntimeJobRecord>(filePath);
}

export function listRuntimeJobRecords(runId: string): RuntimeJobRecord[] {
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(runRuntimeJobsDir(runId));
  const records = files.map((file) => storage.readJson<RuntimeJobRecord>(file));
  records.sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at.localeCompare(b.created_at);
    }
    return a.dispatch_sequence - b.dispatch_sequence;
  });
  return records;
}

export function listRuntimeJobRecordsForNode(
  runId: string,
  nodeRunId: string,
): RuntimeJobRecord[] {
  return listRuntimeJobRecords(runId).filter((record) => record.node_run_id === nodeRunId);
}

export function nextRuntimeDispatchSequence(runId: string, nodeRunId: string): number {
  const existing = listRuntimeJobRecordsForNode(runId, nodeRunId);
  const maxSequence = existing.reduce(
    (max, record) => Math.max(max, record.dispatch_sequence),
    0,
  );
  return maxSequence + 1;
}

export function findLatestRuntimeJobRecordForNode(
  runId: string,
  nodeRunId: string,
): RuntimeJobRecord | null {
  const records = listRuntimeJobRecordsForNode(runId, nodeRunId);
  return records.at(-1) || null;
}

export function applyRuntimeDispatchResultToJobRecord(
  record: RuntimeJobRecord,
  result: RuntimeDispatchResult,
): RuntimeJobRecord {
  record.status = result.status;
  record.worker_id = result.worker_id;
  record.lease_id = result.lease_id;
  record.target_kind = result.target_kind;
  record.accepted_at = result.accepted_at || record.accepted_at;
  record.compatibility = {
    adapter_kind: result.compatibility.adapter_kind,
    dispatch_id: result.compatibility.raw_ref.dispatch_id,
    openclaw_task_id: result.compatibility.raw_ref.openclaw_task_id,
    openclaw_session_id: result.compatibility.raw_ref.openclaw_session_id,
  };
  return saveRuntimeJobRecord(record);
}
