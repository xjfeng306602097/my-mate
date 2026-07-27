import path from "node:path";
import { RUNS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import { markObservabilityRunDirty } from "./observability-index-dirty.js";
import type { CreateRunRequest, RunRecord } from "./types.js";
import { ensureDir, generateRunId, nowIso, writeJsonAtomic } from "./utils.js";
import { validateRunState } from "./validators.js";
import {
  RUN_LIFECYCLE,
  assertLifecycleTransition,
  parseLifecycleStatus,
} from "@my-mate/shared-types/domain-lifecycle";

function runPath(runId: string): string {
  return path.join(RUNS_DIR, `${runId}.json`);
}

export function saveRun(run: RunRecord, options: { recovery?: boolean } = {}): RunRecord {
  const normalized = normalizeRunRecord(run);
  const activeWorkspaceId = getActiveWorkspaceId();
  if (activeWorkspaceId && normalized.workspace_id !== activeWorkspaceId) {
    throw new Error("WORKSPACE_SCOPE_MISMATCH");
  }
  const storage = getJsonStorageBackend();
  const target = runPath(normalized.run_id);
  if (storage.exists(target)) {
    const previous = normalizeRunRecord(storage.readJson<RunRecord>(target));
    assertLifecycleTransition(RUN_LIFECYCLE, previous.status, normalized.status, options);
  }
  assertValidRun(normalized);
  writeJsonAtomic(runPath(normalized.run_id), normalized);
  markObservabilityRunDirty(normalized.run_id);
  return normalized;
}

function normalizeRunRecord(record: RunRecord): RunRecord {
  return {
    ...record,
    status: parseLifecycleStatus(RUN_LIFECYCLE, record.status),
    workspace_id:
      typeof record.workspace_id === "string" && record.workspace_id.trim()
        ? record.workspace_id.trim()
        : "default",
    proposal_id:
      typeof record.proposal_id === "string" && record.proposal_id.trim()
        ? record.proposal_id.trim()
        : null,
    source_run_id:
      typeof record.source_run_id === "string" && record.source_run_id.trim()
        ? record.source_run_id.trim()
        : null,
    rerun_reason:
      typeof record.rerun_reason === "string" && record.rerun_reason.trim()
        ? record.rerun_reason.trim()
        : null,
    rerun_idempotency_key:
      typeof record.rerun_idempotency_key === "string" && record.rerun_idempotency_key.trim()
        ? record.rerun_idempotency_key.trim()
        : null,
    workspace_binding_id:
      typeof record.workspace_binding_id === "string" && record.workspace_binding_id.trim()
        ? record.workspace_binding_id.trim()
        : null,
  };
}

function assertValidRun(run: RunRecord): void {
  const runState = {
    run_id: run.run_id,
    status: run.status,
    current_summary: run.current_summary,
    waiting_reason: run.waiting_reason,
    blocked_reason: run.blocked_reason,
    started_at: run.started_at,
    finished_at: run.finished_at,
    last_event_id: run.last_event_id,
  };

  const ok = validateRunState(runState);
  if (!ok) {
    const errorText =
      validateRunState.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ") ||
      "unknown schema error";
    throw new Error(`Run validation failed: ${errorText}`);
  }
}

export function buildRunRecord(
  input: CreateRunRequest,
  options?: { requestedBy?: string; workspaceId?: string; templateVersion?: number },
): RunRecord {
  const timestamp = nowIso();
  return {
    run_id: generateRunId(),
    template_id: input.template_id,
    template_version: options?.templateVersion ?? 1,
    workspace_id: getActiveWorkspaceId() || options?.workspaceId || "default",
    requested_by: getActivePrincipalId() || options?.requestedBy || "demo-user",
    intent: input.intent,
    status: "queued",
    current_summary: "Run created and queued",
    waiting_reason: null,
    blocked_reason: null,
    started_at: null,
    finished_at: null,
    last_event_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    inputs: input.inputs,
    workspace_binding_id: null,
    proposal_id: input.proposal_id || null,
    source_run_id: null,
    rerun_reason: null,
    rerun_idempotency_key: null,
  };
}

export function createRun(
  input: CreateRunRequest,
  options?: { requestedBy?: string; workspaceId?: string; templateVersion?: number },
): RunRecord {
  ensureDir(RUNS_DIR);
  const run = buildRunRecord(input, options);

  return saveRun(run);
}

export function listRuns(): RunRecord[] {
  ensureDir(RUNS_DIR);
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(RUNS_DIR);

  const activeWorkspaceId = getActiveWorkspaceId();
  const runs = files.map((file) =>
    normalizeRunRecord(storage.readJson<RunRecord>(file)),
  ).filter((run) => !activeWorkspaceId || run.workspace_id === activeWorkspaceId);

  runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return runs;
}

export function getRun(runId: string): RunRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = runPath(runId);
  if (!storage.exists(filePath)) {
    return null;
  }
  const run = normalizeRunRecord(storage.readJson<RunRecord>(filePath));
  const activeWorkspaceId = getActiveWorkspaceId();
  return activeWorkspaceId && run.workspace_id !== activeWorkspaceId ? null : run;
}
