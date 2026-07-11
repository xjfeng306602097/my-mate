import path from "node:path";
import { NODE_RUNS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { NodeRunRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";
import { validateNodeRun } from "./validators.js";

function runNodeRunsDir(runId: string): string {
  return path.join(NODE_RUNS_DIR, runId);
}

function nodeRunPath(runId: string, nodeRunId: string): string {
  return path.join(runNodeRunsDir(runId), `${nodeRunId}.json`);
}

function assertValidNodeRun(nodeRun: NodeRunRecord): void {
  const ok = validateNodeRun(nodeRun);
  if (!ok) {
    const errorText =
      validateNodeRun.errors
        ?.map((e) => `${e.instancePath} ${e.message}`)
        .join("; ") || "unknown schema error";
    throw new Error(`NodeRun validation failed: ${errorText}`);
  }
}

export function saveNodeRuns(runId: string, nodeRuns: NodeRunRecord[]): NodeRunRecord[] {
  ensureDir(runNodeRunsDir(runId));
  for (const nodeRun of nodeRuns) {
    assertValidNodeRun(nodeRun);
    writeJsonAtomic(nodeRunPath(runId, nodeRun.node_run_id), nodeRun);
  }
  return nodeRuns;
}

export function listNodeRuns(runId: string): NodeRunRecord[] {
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(runNodeRunsDir(runId));
  const nodeRuns = files.map((file) => storage.readJson<NodeRunRecord>(file));

  nodeRuns.sort((a, b) => a.node_run_id.localeCompare(b.node_run_id));
  return nodeRuns;
}

export function getNodeRun(runId: string, nodeRunId: string): NodeRunRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = nodeRunPath(runId, nodeRunId);
  if (!storage.exists(filePath)) {
    return null;
  }

  return storage.readJson<NodeRunRecord>(filePath);
}
