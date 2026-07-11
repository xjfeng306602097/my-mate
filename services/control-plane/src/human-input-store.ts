import path from "node:path";
import { HUMAN_INPUTS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getRun } from "./run-store.js";
import type { HumanInputRecord } from "./types.js";
import { ensureDir, generateHumanInputId, nowIso, writeJsonAtomic } from "./utils.js";

function humanInputPath(inputRequestId: string): string {
  return path.join(HUMAN_INPUTS_DIR, `${inputRequestId}.json`);
}

export function createHumanInputRecord(input: {
  runId: string;
  nodeRunId: string | null;
  summary: string;
  inputSchema: Record<string, unknown>;
  requestedAt?: string;
}): HumanInputRecord {
  return {
    input_request_id: generateHumanInputId(),
    run_id: input.runId,
    node_run_id: input.nodeRunId,
    status: "pending",
    summary: input.summary,
    input_schema: input.inputSchema,
    requested_at: input.requestedAt || nowIso(),
    submitted_at: null,
  };
}

export function saveHumanInput(record: HumanInputRecord): HumanInputRecord {
  ensureDir(HUMAN_INPUTS_DIR);
  writeJsonAtomic(humanInputPath(record.input_request_id), record);
  return record;
}

export function listHumanInputs(status?: HumanInputRecord["status"]): HumanInputRecord[] {
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(HUMAN_INPUTS_DIR);

  const items = files.map((filePath) =>
    storage.readJson<HumanInputRecord>(filePath),
  );
  const scoped = items.filter((item) => getRun(item.run_id) !== null);
  const filtered = status ? scoped.filter((item) => item.status === status) : scoped;
  filtered.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  return filtered;
}

export function getHumanInput(inputRequestId: string): HumanInputRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = humanInputPath(inputRequestId);
  if (!storage.exists(filePath)) {
    return null;
  }
  const record = storage.readJson<HumanInputRecord>(filePath);
  return getRun(record.run_id) ? record : null;
}

export function findPendingHumanInputForNode(
  runId: string,
  nodeRunId: string,
): HumanInputRecord | null {
  return (
    listHumanInputs("pending").find(
      (item) => item.run_id === runId && item.node_run_id === nodeRunId,
    ) || null
  );
}
