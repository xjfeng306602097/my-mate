import fs from "node:fs";
import path from "node:path";
import { RUNS_DIR } from "./config.js";
import type { CreateRunRequest, RunRecord } from "./types.js";
import { ensureDir, generateRunId, nowIso, writeJsonAtomic } from "./utils.js";
import { validateRunState } from "./validators.js";

function runPath(runId: string): string {
  return path.join(RUNS_DIR, `${runId}.json`);
}

export function saveRun(run: RunRecord): RunRecord {
  const normalized = normalizeRunRecord(run);
  assertValidRun(run);
  writeJsonAtomic(runPath(normalized.run_id), normalized);
  return normalized;
}

function normalizeRunRecord(record: RunRecord): RunRecord {
  return {
    ...record,
    proposal_id:
      typeof record.proposal_id === "string" && record.proposal_id.trim()
        ? record.proposal_id.trim()
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

export function createRun(
  input: CreateRunRequest,
  options?: { requestedBy?: string; workspaceId?: string; templateVersion?: number },
): RunRecord {
  ensureDir(RUNS_DIR);

  const timestamp = nowIso();
  const run: RunRecord = {
    run_id: generateRunId(),
    template_id: input.template_id,
    template_version: options?.templateVersion ?? 1,
    workspace_id: options?.workspaceId || "default",
    requested_by: options?.requestedBy || "demo-user",
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
    proposal_id: input.proposal_id || null,
  };

  return saveRun(run);
}

export function listRuns(): RunRecord[] {
  ensureDir(RUNS_DIR);
  const files = fs
    .readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(RUNS_DIR, entry.name));

  const runs = files.map((file) =>
    normalizeRunRecord(JSON.parse(fs.readFileSync(file, "utf-8")) as RunRecord),
  );

  runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return runs;
}

export function getRun(runId: string): RunRecord | null {
  const filePath = runPath(runId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return normalizeRunRecord(JSON.parse(fs.readFileSync(filePath, "utf-8")) as RunRecord);
}
