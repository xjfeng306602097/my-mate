import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type {
  RequestAuthContext,
  SecurityAuditEvent,
  WorkspacePermission,
} from "@my-mate/shared-types/identity";
import { AUDIT_EVENTS_DIR } from "./config.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { nowIso } from "./utils.js";

function workspaceAuditDir(workspaceId: string): string {
  return path.join(AUDIT_EVENTS_DIR, encodeURIComponent(workspaceId));
}

function auditPath(workspaceId: string, createdAt: string, auditId: string): string {
  return path.join(workspaceAuditDir(workspaceId), `${createdAt.replace(/[:.]/g, "-")}_${auditId}.json`);
}

function digest(event: Omit<SecurityAuditEvent, "hash">): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function readWorkspaceAuditEvents(workspaceId: string): SecurityAuditEvent[] {
  const storage = getJsonStorageBackend();
  return storage
    .listJsonFiles(workspaceAuditDir(workspaceId))
    .map((file) => storage.readJson<SecurityAuditEvent>(file));
}

function chainHead(events: readonly SecurityAuditEvent[]): SecurityAuditEvent | null {
  const referenced = new Set(events.map((event) => event.previous_hash).filter(Boolean));
  return [...events]
    .filter((event) => !referenced.has(event.hash))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] || null;
}

export function listAuditEvents(input: {
  workspaceId?: string;
  principalId?: string;
  action?: string;
  resourceType?: string;
  outcome?: SecurityAuditEvent["outcome"];
  since?: string;
  limit?: number;
} = {}): SecurityAuditEvent[] {
  const workspaceId = input.workspaceId || getActiveWorkspaceId();
  if (!workspaceId) return [];
  const limit = Math.min(500, Math.max(1, Math.floor(input.limit || 100)));
  return readWorkspaceAuditEvents(workspaceId)
    .filter((event) => !input.principalId || event.principal_id === input.principalId)
    .filter((event) => !input.action || event.action === input.action)
    .filter((event) => !input.resourceType || event.resource_type === input.resourceType)
    .filter((event) => !input.outcome || event.outcome === input.outcome)
    .filter((event) => !input.since || event.created_at >= input.since)
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.audit_id.localeCompare(left.audit_id))
    .slice(0, limit);
}

export function appendAuditEvent(input: {
  context?: RequestAuthContext | null;
  workspaceId?: string;
  principalId?: string;
  principalType?: SecurityAuditEvent["principal_type"];
  action: string;
  permission?: WorkspacePermission | null;
  method: string;
  path: string;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome: SecurityAuditEvent["outcome"];
  statusCode: number;
  requestId?: string;
  metadata?: SecurityAuditEvent["metadata"];
}): SecurityAuditEvent {
  const workspaceId = input.context?.selected_workspace.workspace_id || input.workspaceId || "default";
  const previous = chainHead(readWorkspaceAuditEvents(workspaceId));
  const withoutHash: Omit<SecurityAuditEvent, "hash"> = {
    schema_version: 1,
    audit_id: `audit_${randomUUID()}`,
    workspace_id: workspaceId,
    principal_id: input.context?.principal.principal_id || input.principalId || "unknown",
    principal_type: input.context?.principal.principal_type || input.principalType || "unknown",
    action: input.action,
    permission: input.permission || null,
    method: input.method,
    path: input.path,
    resource_type: input.resourceType || null,
    resource_id: input.resourceId || null,
    outcome: input.outcome,
    status_code: input.statusCode,
    request_id: input.context?.request_id || input.requestId || "unknown",
    metadata: input.metadata || {},
    previous_hash: previous?.hash || null,
    created_at: nowIso(),
  };
  const event: SecurityAuditEvent = { ...withoutHash, hash: digest(withoutHash) };
  getJsonStorageBackend().writeJson(auditPath(workspaceId, event.created_at, event.audit_id), event);
  return event;
}

export function verifyAuditChain(events: readonly SecurityAuditEvent[]): boolean {
  if (events.length === 0) return true;
  const byHash = new Map(events.map((event) => [event.hash, event]));
  const referencedCounts = new Map<string, number>();
  for (const event of events) {
    const { hash, ...withoutHash } = event;
    if (hash !== digest(withoutHash)) return false;
    if (event.previous_hash) {
      if (!byHash.has(event.previous_hash)) return false;
      referencedCounts.set(event.previous_hash, (referencedCounts.get(event.previous_hash) || 0) + 1);
      if ((referencedCounts.get(event.previous_hash) || 0) > 1) return false;
    }
  }
  const roots = events.filter((event) => event.previous_hash === null);
  const head = chainHead(events);
  if (roots.length !== 1 || !head) return false;
  let visited = 0;
  let current: SecurityAuditEvent | undefined = head;
  const seen = new Set<string>();
  while (current && !seen.has(current.hash)) {
    seen.add(current.hash);
    visited += 1;
    current = current.previous_hash ? byHash.get(current.previous_hash) : undefined;
  }
  return visited === events.length;
}

export function verifyWorkspaceAuditChain(workspaceId: string): boolean {
  return verifyAuditChain(readWorkspaceAuditEvents(workspaceId));
}
