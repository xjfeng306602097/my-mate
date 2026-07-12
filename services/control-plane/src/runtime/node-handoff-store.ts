import path from "node:path";
import { NODE_HANDOFFS_DIR } from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import type { NodeHandoff } from "../runtime-protocol.js";
import type { EdgeOutcomeStatus } from "./edge-condition.js";
import { ensureDir, writeJsonAtomic } from "../utils.js";

export interface NodeHandoffRoutingDecision {
  edge_key: string;
  from_node_id: string;
  to_node_id: string;
  from_port: string | null;
  to_port: string | null;
  port_matched: boolean;
  condition_matched: boolean;
  condition_valid: boolean;
  matched: boolean;
  reason: string;
}

export interface NodeHandoffRecord extends NodeHandoff {
  handoff_id: string;
  job_id: string;
  routed_node_run_ids: string[];
  skipped_node_run_ids: string[];
  source_outcome?: EdgeOutcomeStatus;
  synthetic?: boolean;
  routing_decisions?: NodeHandoffRoutingDecision[];
}

function runHandoffsDir(runId: string): string {
  return path.join(NODE_HANDOFFS_DIR, encodeURIComponent(runId));
}

function handoffPath(record: NodeHandoffRecord): string {
  return path.join(runHandoffsDir(record.run_id), `${encodeURIComponent(record.handoff_id)}.json`);
}

export function saveNodeHandoffRecord(record: NodeHandoffRecord): NodeHandoffRecord {
  ensureDir(runHandoffsDir(record.run_id));
  writeJsonAtomic(handoffPath(record), record);
  return record;
}

export function listNodeHandoffRecords(runId: string): NodeHandoffRecord[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(runHandoffsDir(runId))
    .map((file) => storage.readJson<NodeHandoffRecord>(file))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function findLatestNodeHandoff(
  runId: string,
  nodeRunId: string,
): NodeHandoffRecord | null {
  return listNodeHandoffRecords(runId)
    .filter((record) => record.node_run_id === nodeRunId)
    .at(-1) || null;
}
