import fs from "node:fs";
import path from "node:path";
import { NODE_RUNS_DIR } from "./config.js";
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
  const dir = runNodeRunsDir(runId);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name));

  const nodeRuns = files.map((file) =>
    JSON.parse(fs.readFileSync(file, "utf-8")) as NodeRunRecord,
  );

  nodeRuns.sort((a, b) => a.node_run_id.localeCompare(b.node_run_id));
  return nodeRuns;
}

export function getNodeRun(runId: string, nodeRunId: string): NodeRunRecord | null {
  const filePath = nodeRunPath(runId, nodeRunId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as NodeRunRecord;
}
