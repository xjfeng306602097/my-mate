import fs from "node:fs";
import path from "node:path";
import { APPROVALS_DIR } from "./config.js";
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
  };
}

export function saveApproval(record: ApprovalRecord): ApprovalRecord {
  ensureDir(APPROVALS_DIR);
  writeJsonAtomic(approvalPath(record.approval_id), record);
  return record;
}

export function listApprovals(status?: ApprovalRecord["status"]): ApprovalRecord[] {
  ensureDir(APPROVALS_DIR);
  const files = fs
    .readdirSync(APPROVALS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(APPROVALS_DIR, entry.name));

  const items = files.map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, "utf-8")) as ApprovalRecord,
  );
  const filtered = status ? items.filter((item) => item.status === status) : items;
  filtered.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  return filtered;
}

export function getApproval(approvalId: string): ApprovalRecord | null {
  const filePath = approvalPath(approvalId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ApprovalRecord;
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
