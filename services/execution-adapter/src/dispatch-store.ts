import fs from "node:fs";
import path from "node:path";
import { DISPATCHES_DIR } from "./config.js";
import type { DispatchRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";

function dispatchPath(dispatchId: string): string {
  return path.join(DISPATCHES_DIR, `${dispatchId}.json`);
}

export function saveDispatch(record: DispatchRecord): DispatchRecord {
  ensureDir(DISPATCHES_DIR);
  writeJsonAtomic(dispatchPath(record.dispatch_id), record);
  return record;
}

export function getDispatch(dispatchId: string): DispatchRecord | null {
  const filePath = dispatchPath(dispatchId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as DispatchRecord;
}

export function listDispatches(): DispatchRecord[] {
  ensureDir(DISPATCHES_DIR);
  const files = fs
    .readdirSync(DISPATCHES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(DISPATCHES_DIR, entry.name));

  const items = files.map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, "utf-8")) as DispatchRecord,
  );
  items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return items;
}

export function findDispatchByNode(runId: string, nodeRunId: string): DispatchRecord | null {
  return (
    listDispatches().find(
      (item) => item.run_id === runId && item.node_run_id === nodeRunId,
    ) || null
  );
}
