import path from "node:path";
import { APPROVALS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getRun } from "./run-store.js";
import type { ApprovalRecord } from "./types.js";
import { ensureDir, generateApprovalId, nowIso, writeJsonAtomic } from "./utils.js";

function approvalPath(approvalId: string): string {
  return path.join(APPROVALS_DIR, `${approvalId}.json`);
}

export function createApprovalRecord(input: {
  runId: string;
  nodeRunId: string | null;
  kind: string;
  summary: string;
  requestedAt?: string;
  gateId?: string | null;
}): ApprovalRecord {
  return {
    approval_id: generateApprovalId(),
    run_id: input.runId,
    node_run_id: input.nodeRunId,
    kind: input.kind,
    status: "pending",
    summary: input.summary,
    requested_at: input.requestedAt || nowIso(),
    resolved_at: null,
    gate_id: input.gateId ?? null,
  };
}

export function saveApproval(record: ApprovalRecord): ApprovalRecord {
  ensureDir(APPROVALS_DIR);
  writeJsonAtomic(approvalPath(record.approval_id), record);
  return record;
}

export function listApprovals(status?: ApprovalRecord["status"]): ApprovalRecord[] {
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(APPROVALS_DIR);

  const items = files.map((filePath) =>
    storage.readJson<ApprovalRecord>(filePath),
  );
  const scoped = items.filter((item) => getRun(item.run_id) !== null);
  const filtered = status ? scoped.filter((item) => item.status === status) : scoped;
  filtered.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  return filtered;
}

export function getApproval(approvalId: string): ApprovalRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = approvalPath(approvalId);
  if (!storage.exists(filePath)) {
    return null;
  }
  const record = storage.readJson<ApprovalRecord>(filePath);
  return getRun(record.run_id) ? record : null;
}

export function findPendingApprovalForNode(
  runId: string,
  nodeRunId: string,
): ApprovalRecord | null {
  return (
    listApprovals("pending").find(
      (item) => item.run_id === runId && item.node_run_id === nodeRunId,
    ) || null
  );
}
