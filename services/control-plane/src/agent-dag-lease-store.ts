import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AGENT_DAG_LEASES_DIR } from "./config.js";
import { nowIso } from "./utils.js";

export interface AgentDagExecutionLease {
  schema_version: 1;
  lease_id: string;
  workspace_id: string;
  dag_id: string;
  owner_id: string;
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
  status: "active" | "released";
}

const leasePath = (workspaceId: string, dagId: string): string =>
  path.join(AGENT_DAG_LEASES_DIR, encodeURIComponent(workspaceId), `${encodeURIComponent(dagId)}.json`);

function readLease(filePath: string): AgentDagExecutionLease | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentDagExecutionLease;
  } catch {
    return null;
  }
}

function writeLease(filePath: string, lease: AgentDagExecutionLease): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve original error */ }
  }
}

function isActive(lease: AgentDagExecutionLease | null, now = Date.now()): boolean {
  return !!lease && lease.status === "active" && Date.parse(lease.expires_at) > now;
}

export function getAgentDagLease(workspaceId: string, dagId: string): AgentDagExecutionLease | null {
  return readLease(leasePath(workspaceId, dagId));
}

export function acquireAgentDagLease(input: {
  workspaceId: string;
  dagId: string;
  ownerId?: string;
  ttlMs?: number;
}): AgentDagExecutionLease | null {
  const filePath = leasePath(input.workspaceId, input.dagId);
  const ttlMs = Math.max(100, input.ttlMs || Number(process.env.MY_MATE_AGENT_DAG_LEASE_TTL_MS || 30_000));
  const ownerId = input.ownerId || `${os.hostname()}:${process.pid}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = readLease(filePath);
    if (isActive(current)) return null;
    if (current && !isActive(current)) {
      try { fs.rmSync(filePath, { force: true }); } catch { /* retry below */ }
    }
    const timestamp = nowIso();
    const lease: AgentDagExecutionLease = {
      schema_version: 1,
      lease_id: randomUUID(),
      workspace_id: input.workspaceId,
      dag_id: input.dagId,
      owner_id: ownerId,
      acquired_at: timestamp,
      heartbeat_at: timestamp,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      status: "active",
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      const fd = fs.openSync(filePath, "wx");
      try { fs.writeFileSync(fd, `${JSON.stringify(lease, null, 2)}\n`, "utf8"); } finally { fs.closeSync(fd); }
      return lease;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "EEXIST")) throw error;
      const winner = readLease(filePath);
      if (isActive(winner)) return null;
    }
  }
  return null;
}

export function renewAgentDagLease(lease: AgentDagExecutionLease, ttlMs?: number): AgentDagExecutionLease | null {
  const filePath = leasePath(lease.workspace_id, lease.dag_id);
  const current = readLease(filePath);
  if (!current || current.lease_id !== lease.lease_id || current.status !== "active") return null;
  const duration = Math.max(100, ttlMs || Number(process.env.MY_MATE_AGENT_DAG_LEASE_TTL_MS || 30_000));
  const renewed = { ...current, heartbeat_at: nowIso(), expires_at: new Date(Date.now() + duration).toISOString() };
  writeLease(filePath, renewed);
  return renewed;
}

export function releaseAgentDagLease(lease: AgentDagExecutionLease): boolean {
  const filePath = leasePath(lease.workspace_id, lease.dag_id);
  const current = readLease(filePath);
  if (!current || current.lease_id !== lease.lease_id) return false;
  writeLease(filePath, { ...current, status: "released", heartbeat_at: nowIso(), expires_at: nowIso() });
  return true;
}

export function reclaimExpiredAgentDagLease(workspaceId: string, dagId: string): boolean {
  const current = getAgentDagLease(workspaceId, dagId);
  if (!current || isActive(current)) return false;
  try { fs.rmSync(leasePath(workspaceId, dagId), { force: true }); return true; } catch { return false; }
}
