import path from "node:path";
import { RUNTIME_HUMAN_GATES_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import type { RuntimeHumanGateRecord } from "../types.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";

function runGateDir(runId: string): string {
  return path.join(RUNTIME_HUMAN_GATES_DIR, encodeURIComponent(runId));
}

function gatePath(runId: string, gateId: string): string {
  return path.join(runGateDir(runId), `${encodeURIComponent(gateId)}.json`);
}

export function saveRuntimeHumanGate(record: RuntimeHumanGateRecord): RuntimeHumanGateRecord {
  ensureDir(runGateDir(record.run_id));
  writeJsonAtomic(gatePath(record.run_id, record.gate_id), record);
  return record;
}

export function getRuntimeHumanGate(runId: string, gateId: string): RuntimeHumanGateRecord | null {
  const storage = getJsonStorageBackend();
  const file = gatePath(runId, gateId);
  return storage.exists(file) ? storage.readJson<RuntimeHumanGateRecord>(file) : null;
}

export function listRuntimeHumanGates(runId: string): RuntimeHumanGateRecord[] {
  const storage = getJsonStorageBackend();
  const records = storage
    .listJsonFiles(runGateDir(runId))
    .map((file) => storage.readJson<RuntimeHumanGateRecord>(file));
  return records.sort((a, b) => a.requested_at.localeCompare(b.requested_at));
}

export function findActiveRuntimeHumanGate(
  runId: string,
  nodeRunId: string,
): RuntimeHumanGateRecord | null {
  return [...listRuntimeHumanGates(runId)].reverse().find(
    (gate: RuntimeHumanGateRecord) =>
      gate.node_run_id === nodeRunId &&
      ["requested", "suspended", "resuming"].includes(gate.status),
  ) || null;
}
