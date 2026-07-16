import { randomUUID } from "node:crypto";
import path from "node:path";
import { MEMORIES_DIR, MEMORY_CANDIDATES_DIR } from "./config.js";
import { getActivePrincipalId, getActiveWorkspaceId, hasPermission } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { appendMemoryRetrievalJournal } from "./memory-retrieval-index.js";
import { syncMemoryKnowledgeProvider } from "./memory-knowledge-provider.js";
import { recordMemoryCandidateDecision } from "./memory-observability.js";
import {
  deserializeMemoryCandidate,
  deserializeMemoryRecord,
  serializeMemoryCandidate,
  serializeMemoryRecord,
} from "./memory-encryption.js";
import type {
  AutopilotMode,
  MemoryCandidateRecord,
  MemoryCandidateOperation,
  MemoryCandidateRisk,
  MemoryKind,
  MemoryProposal,
  MemoryRecord,
  MemoryScopeKind,
  MemorySensitivity,
  MemorySource,
  MemorySourceOrigin,
  MemoryStatus,
} from "./types.js";
import { nowIso } from "./utils.js";

const MEMORY_KINDS = new Set<MemoryKind>(["preference", "fact", "convention", "decision", "lesson"]);
const MEMORY_SCOPE_KINDS = new Set<MemoryScopeKind>(["user", "workspace", "project", "agent"]);
const MEMORY_SENSITIVITIES = new Set<MemorySensitivity>(["normal", "private", "restricted"]);
const MEMORY_SOURCE_ORIGINS = new Set<MemorySourceOrigin>([
  "explicit_user",
  "inferred",
  "background_review",
  "imported",
  "system",
]);
const MEMORY_CANDIDATE_RISKS = new Set<MemoryCandidateRisk>(["low", "medium", "high"]);
const MEMORY_CANDIDATE_OPERATIONS = new Set<MemoryCandidateOperation>(["create", "update", "delete"]);
const AUTOPILOT_MODES = new Set<AutopilotMode>(["review_first", "assisted", "autopilot"]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*[^\s]{8,}/iu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
];

export class MemoryStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface MemoryProposalInput {
  scope_kind?: unknown;
  scope_id?: unknown;
  kind?: unknown;
  content?: unknown;
  confidence?: unknown;
  importance?: unknown;
  sensitivity?: unknown;
  tags?: unknown;
  source?: unknown;
  valid_from?: unknown;
  valid_until?: unknown;
  expires_at?: unknown;
  supersedes_memory_id?: unknown;
}

export interface MemoryListFilters {
  status?: MemoryStatus | "all";
  scopeKind?: MemoryScopeKind;
  scopeId?: string;
  kind?: MemoryKind;
  query?: string;
  limit?: number;
}

function workspaceId(): string {
  return getActiveWorkspaceId() || "default";
}

function actorId(fallback = "system"): string {
  return getActivePrincipalId() || fallback;
}

function workspaceDir(root: string, targetWorkspaceId = workspaceId()): string {
  return path.join(root, encodeURIComponent(targetWorkspaceId));
}

function memoryPath(memoryId: string, targetWorkspaceId = workspaceId()): string {
  return path.join(workspaceDir(MEMORIES_DIR, targetWorkspaceId), `${encodeURIComponent(memoryId)}.json`);
}

function candidatePath(candidateId: string, targetWorkspaceId = workspaceId()): string {
  return path.join(workspaceDir(MEMORY_CANDIDATES_DIR, targetWorkspaceId), `${encodeURIComponent(candidateId)}.json`);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryStoreError("memory_invalid", `${field} is required.`);
  }
  const normalized = value.trim().replace(/\r\n/g, "\n");
  if (normalized.length > maxLength) {
    throw new MemoryStoreError("memory_invalid", `${field} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, field, maxLength);
}

function boundedNumber(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new MemoryStoreError("memory_invalid", `${field} must be between 0 and 1.`);
  }
  return parsed;
}

function optionalDate(value: unknown, field: string): string | null {
  const normalized = optionalText(value, field, 64);
  if (!normalized) return null;
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new MemoryStoreError("memory_invalid", `${field} must be an ISO date-time.`);
  }
  return new Date(normalized).toISOString();
}

function tags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new MemoryStoreError("memory_invalid", "tags must be an array of strings.");
  }
  return [...new Set(value.map((item) => requiredText(item, "tag", 64).toLowerCase()))].slice(0, 20);
}

function ensureNoSecrets(content: string): void {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    throw new MemoryStoreError(
      "memory_sensitive_content",
      "Credentials and secrets cannot be stored as long-term memory.",
      422,
    );
  }
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: Set<T>,
  fallback?: T,
): T {
  if ((value === undefined || value === null || value === "") && fallback) return fallback;
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new MemoryStoreError("memory_invalid", `${field} has an unsupported value.`);
  }
  return value as T;
}

function normalizeSource(value: unknown, fallbackOrigin: MemorySourceOrigin): MemorySource {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawMessageIds = source.message_ids;
  return {
    origin: enumValue(source.origin, "source.origin", MEMORY_SOURCE_ORIGINS, fallbackOrigin),
    session_id: optionalText(source.session_id, "source.session_id", 160),
    message_ids: Array.isArray(rawMessageIds)
      ? [...new Set(rawMessageIds.map((item) => requiredText(item, "source.message_id", 160)))].slice(0, 50)
      : [],
    action_id: optionalText(source.action_id, "source.action_id", 160),
    provider_id: optionalText(source.provider_id, "source.provider_id", 160),
    note: optionalText(source.note, "source.note", 500),
  };
}

function normalizeProposal(
  input: MemoryProposalInput,
  targetWorkspaceId: string,
  fallbackOrigin: MemorySourceOrigin,
): MemoryProposal {
  const scopeKind = enumValue(input.scope_kind, "scope_kind", MEMORY_SCOPE_KINDS, "workspace");
  const requestedScopeId = optionalText(input.scope_id, "scope_id", 160);
  if (scopeKind === "workspace" && requestedScopeId && requestedScopeId !== targetWorkspaceId) {
    throw new MemoryStoreError("memory_scope_mismatch", "Workspace memory must use the active Workspace id.", 403);
  }
  if ((scopeKind === "project" || scopeKind === "agent") && !requestedScopeId) {
    throw new MemoryStoreError("memory_invalid", `scope_id is required for ${scopeKind} memory.`);
  }
  const principalId = getActivePrincipalId();
  if (
    scopeKind === "user" &&
    principalId &&
    requestedScopeId &&
    requestedScopeId !== principalId &&
    !hasPermission("memory.manage")
  ) {
    throw new MemoryStoreError("memory_scope_mismatch", "User memory cannot target another user.", 403);
  }
  const defaultScopeId = scopeKind === "workspace"
    ? targetWorkspaceId
    : scopeKind === "user"
      ? principalId || actorId("unknown")
      : requestedScopeId!;
  const content = requiredText(input.content, "content", 4_000);
  ensureNoSecrets(content);
  const validFrom = optionalDate(input.valid_from, "valid_from");
  const validUntil = optionalDate(input.valid_until, "valid_until");
  if (validFrom && validUntil && validUntil <= validFrom) {
    throw new MemoryStoreError("memory_invalid", "valid_until must be later than valid_from.");
  }
  return {
    scope_kind: scopeKind,
    scope_id: requestedScopeId || defaultScopeId,
    kind: enumValue(input.kind, "kind", MEMORY_KINDS, "fact"),
    content,
    confidence: boundedNumber(input.confidence, "confidence", fallbackOrigin === "explicit_user" ? 1 : 0.7),
    importance: boundedNumber(input.importance, "importance", 0.5),
    sensitivity: enumValue(input.sensitivity, "sensitivity", MEMORY_SENSITIVITIES, "normal"),
    tags: tags(input.tags),
    source: normalizeSource(input.source, fallbackOrigin),
    valid_from: validFrom,
    valid_until: validUntil,
    expires_at: optionalDate(input.expires_at, "expires_at"),
    supersedes_memory_id: optionalText(input.supersedes_memory_id, "supersedes_memory_id", 160),
  };
}

function hasOwn(input: MemoryProposalInput, key: keyof MemoryProposalInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function saveMemoryRecord(record: MemoryRecord): MemoryRecord {
  getJsonStorageBackend().writeJson(
    memoryPath(record.memory_id, record.workspace_id),
    serializeMemoryRecord(record),
  );
  try {
    appendMemoryRetrievalJournal(record);
  } catch {
    // The derived retrieval index is rebuilt from canonical memory on demand.
  }
  syncMemoryKnowledgeProvider(record);
  return record;
}

function saveCandidateRecord(record: MemoryCandidateRecord): MemoryCandidateRecord {
  getJsonStorageBackend().writeJson(
    candidatePath(record.candidate_id, record.workspace_id),
    serializeMemoryCandidate(record),
  );
  return record;
}

function readMemoryFile(file: string): MemoryRecord {
  const storage = getJsonStorageBackend();
  const decoded = deserializeMemoryRecord(storage.readJson<unknown>(file));
  if (decoded.legacyPlaintext) storage.writeJson(file, serializeMemoryRecord(decoded.record));
  return decoded.record;
}

function readCandidateFile(file: string): MemoryCandidateRecord {
  const storage = getJsonStorageBackend();
  const decoded = deserializeMemoryCandidate(storage.readJson<unknown>(file));
  if (decoded.legacyPlaintext) storage.writeJson(file, serializeMemoryCandidate(decoded.record));
  return decoded.record;
}

function normalizeCandidateRecord(record: MemoryCandidateRecord): MemoryCandidateRecord {
  return {
    ...record,
    operation: record.operation || "create",
    target_memory_id: record.target_memory_id || null,
    source: record.source || record.proposed_memory?.source || normalizeSource(undefined, "inferred"),
  };
}

export function createMemory(
  input: MemoryProposalInput,
  options: { origin?: MemorySourceOrigin; createdBy?: string; workspaceId?: string } = {},
): MemoryRecord {
  const targetWorkspaceId = options.workspaceId || workspaceId();
  if (targetWorkspaceId !== workspaceId()) throw new MemoryStoreError("memory_workspace_mismatch", "Memory belongs to another Workspace.", 404);
  const proposal = normalizeProposal(input, targetWorkspaceId, options.origin || "explicit_user");
  const superseded = proposal.supersedes_memory_id ? getMemory(proposal.supersedes_memory_id) : null;
  if (proposal.supersedes_memory_id && !superseded) {
    throw new MemoryStoreError("memory_not_found", "Superseded memory was not found in this Workspace.", 404);
  }
  if (superseded && (
    superseded.status !== "active" ||
    superseded.scope_kind !== proposal.scope_kind ||
    superseded.scope_id !== proposal.scope_id
  )) {
    throw new MemoryStoreError("memory_invalid", "Superseding memory must replace an active memory in the same scope.", 409);
  }
  const timestamp = nowIso();
  const createdBy = options.createdBy || actorId("user");
  const created = saveMemoryRecord({
    schema_version: 1,
    memory_id: `mem_${randomUUID()}`,
    workspace_id: targetWorkspaceId,
    ...proposal,
    status: "active",
    version: 1,
    created_by: createdBy,
    created_at: timestamp,
    updated_by: createdBy,
    updated_at: timestamp,
  });
  if (superseded) {
    try {
      saveMemoryRecord({
        ...superseded,
        status: "superseded",
        version: superseded.version + 1,
        updated_by: createdBy,
        updated_at: timestamp,
      });
    } catch (error) {
      getJsonStorageBackend().removeJson(memoryPath(created.memory_id, created.workspace_id));
      throw error;
    }
  }
  return created;
}

export function listMemories(filters: MemoryListFilters = {}): MemoryRecord[] {
  return listAllMemories(filters).slice(0, Math.min(500, Math.max(1, filters.limit || 100)));
}

export function listAllMemories(filters: Omit<MemoryListFilters, "limit"> = {}): MemoryRecord[] {
  const storage = getJsonStorageBackend();
  const records = storage.listJsonFiles(workspaceDir(MEMORIES_DIR)).map(readMemoryFile);
  const query = filters.query?.trim().toLowerCase();
  return records
    .filter((record) => record.workspace_id === workspaceId())
    .filter((record) => filters.status === "all" || record.status === (filters.status || "active"))
    .filter((record) => !filters.scopeKind || record.scope_kind === filters.scopeKind)
    .filter((record) => !filters.scopeId || record.scope_id === filters.scopeId)
    .filter((record) => !filters.kind || record.kind === filters.kind)
    .filter((record) => !query || record.content.toLowerCase().includes(query) || record.tags.some((tag) => tag.includes(query)))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function getMemory(memoryId: string): MemoryRecord | null {
  const storage = getJsonStorageBackend();
  const file = memoryPath(memoryId);
  if (!storage.exists(file)) return null;
  const record = readMemoryFile(file);
  return record.workspace_id === workspaceId() ? record : null;
}

export function findExactMemory(input: {
  content: string;
  scopeKind?: MemoryScopeKind;
  scopeId?: string;
  kind?: MemoryKind;
}): MemoryRecord | null {
  const normalized = input.content.trim().replace(/\s+/gu, " ").toLowerCase();
  return listMemories({
    status: "active",
    scopeKind: input.scopeKind,
    scopeId: input.scopeId,
    kind: input.kind,
    limit: 500,
  }).find((record) =>
    record.content.trim().replace(/\s+/gu, " ").toLowerCase() === normalized,
  ) || null;
}

export function updateMemory(
  memoryId: string,
  input: MemoryProposalInput,
  updatedBy = actorId("user"),
): MemoryRecord | null {
  const existing = getMemory(memoryId);
  if (!existing) return null;
  if (existing.status === "deleted") {
    throw new MemoryStoreError("memory_deleted", "Deleted memory cannot be updated.", 409);
  }
  const proposal = normalizeProposal({
    scope_kind: input.scope_kind ?? existing.scope_kind,
    scope_id: input.scope_id ?? existing.scope_id,
    kind: input.kind ?? existing.kind,
    content: input.content ?? existing.content,
    confidence: input.confidence ?? existing.confidence,
    importance: input.importance ?? existing.importance,
    sensitivity: input.sensitivity ?? existing.sensitivity,
    tags: input.tags ?? existing.tags,
    source: input.source ?? existing.source,
    valid_from: hasOwn(input, "valid_from") ? input.valid_from : existing.valid_from,
    valid_until: hasOwn(input, "valid_until") ? input.valid_until : existing.valid_until,
    expires_at: hasOwn(input, "expires_at") ? input.expires_at : existing.expires_at,
    supersedes_memory_id: hasOwn(input, "supersedes_memory_id")
      ? input.supersedes_memory_id
      : existing.supersedes_memory_id,
  }, existing.workspace_id, existing.source.origin);
  return saveMemoryRecord({
    ...existing,
    ...proposal,
    version: existing.version + 1,
    updated_by: updatedBy,
    updated_at: nowIso(),
  });
}

export function deleteMemory(memoryId: string, deletedBy = actorId("user")): MemoryRecord | null {
  const existing = getMemory(memoryId);
  if (!existing) return null;
  if (existing.status === "deleted") return existing;
  return saveMemoryRecord({
    ...existing,
    status: "deleted",
    version: existing.version + 1,
    updated_by: deletedBy,
    updated_at: nowIso(),
  });
}

export function restoreMemory(memoryId: string, restoredBy = actorId("user")): MemoryRecord | null {
  const existing = getMemory(memoryId);
  if (!existing) return null;
  if (existing.status === "active") return existing;
  return saveMemoryRecord({
    ...existing,
    status: "active",
    expires_at: null,
    valid_until: null,
    version: existing.version + 1,
    updated_by: restoredBy,
    updated_at: nowIso(),
  });
}

export function expireMemory(memoryId: string, expiredBy = "system:memory-maintenance"): MemoryRecord | null {
  const existing = getMemory(memoryId);
  if (!existing || existing.status !== "active") return existing;
  return saveMemoryRecord({
    ...existing,
    status: "expired",
    version: existing.version + 1,
    updated_by: expiredBy,
    updated_at: nowIso(),
  });
}

export function createMemoryCandidate(input: {
  operation?: unknown;
  target_memory_id?: unknown;
  proposed_memory?: MemoryProposalInput;
  source?: unknown;
  rationale?: unknown;
  risk?: unknown;
  autonomy_mode?: unknown;
  proposed_by?: string;
}): MemoryCandidateRecord {
  const targetWorkspaceId = workspaceId();
  const timestamp = nowIso();
  const operation = enumValue(input.operation, "operation", MEMORY_CANDIDATE_OPERATIONS, "create");
  const targetMemoryId = optionalText(input.target_memory_id, "target_memory_id", 160);
  if (operation !== "create" && !targetMemoryId) {
    throw new MemoryStoreError("memory_invalid", `target_memory_id is required for ${operation} candidates.`);
  }
  if (targetMemoryId && !getMemory(targetMemoryId)) {
    throw new MemoryStoreError("memory_not_found", "Target memory was not found in this Workspace.", 404);
  }
  if (operation !== "delete" && !input.proposed_memory) {
    throw new MemoryStoreError("memory_invalid", "proposed_memory is required for this candidate operation.");
  }
  const proposedMemory = operation === "delete"
    ? null
    : normalizeProposal(input.proposed_memory || {}, targetWorkspaceId, "inferred");
  return saveCandidateRecord({
    schema_version: 1,
    candidate_id: `memcand_${randomUUID()}`,
    workspace_id: targetWorkspaceId,
    operation,
    target_memory_id: targetMemoryId,
    proposed_memory: proposedMemory,
    source: normalizeSource(input.source || proposedMemory?.source, "inferred"),
    rationale: optionalText(input.rationale, "rationale", 1_000) || "Proposed as durable memory.",
    risk: enumValue(input.risk, "risk", MEMORY_CANDIDATE_RISKS, "medium"),
    autonomy_mode: enumValue(input.autonomy_mode, "autonomy_mode", AUTOPILOT_MODES, "assisted"),
    status: "pending",
    proposed_by: input.proposed_by || actorId("agent"),
    proposed_at: timestamp,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    committed_memory_id: null,
  });
}

export function listMemoryCandidates(status: MemoryCandidateRecord["status"] | "all" = "pending"): MemoryCandidateRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(workspaceDir(MEMORY_CANDIDATES_DIR))
    .map((file) => normalizeCandidateRecord(readCandidateFile(file)))
    .filter((record) => record.workspace_id === workspaceId())
    .filter((record) => status === "all" || record.status === status)
    .sort((left, right) => right.proposed_at.localeCompare(left.proposed_at));
}

export function getMemoryCandidate(candidateId: string): MemoryCandidateRecord | null {
  const storage = getJsonStorageBackend();
  const file = candidatePath(candidateId);
  if (!storage.exists(file)) return null;
  const record = normalizeCandidateRecord(readCandidateFile(file));
  return record.workspace_id === workspaceId() ? record : null;
}

export function migratePrivateMemoryRecordsAtRest(targetWorkspaceId = workspaceId()): {
  memories: number;
  candidates: number;
} {
  const storage = getJsonStorageBackend();
  let memories = 0;
  let candidates = 0;
  for (const file of storage.listJsonFiles(workspaceDir(MEMORIES_DIR, targetWorkspaceId))) {
    const decoded = deserializeMemoryRecord(storage.readJson<unknown>(file));
    if (!decoded.legacyPlaintext) continue;
    storage.writeJson(file, serializeMemoryRecord(decoded.record));
    memories += 1;
  }
  for (const file of storage.listJsonFiles(workspaceDir(MEMORY_CANDIDATES_DIR, targetWorkspaceId))) {
    const decoded = deserializeMemoryCandidate(storage.readJson<unknown>(file));
    if (!decoded.legacyPlaintext) continue;
    storage.writeJson(file, serializeMemoryCandidate(decoded.record));
    candidates += 1;
  }
  return { memories, candidates };
}

export function approveMemoryCandidate(
  candidateId: string,
  input: { note?: unknown } = {},
): { candidate: MemoryCandidateRecord; memory: MemoryRecord } | null {
  const candidate = getMemoryCandidate(candidateId);
  if (!candidate) return null;
  if (candidate.status !== "pending") {
    throw new MemoryStoreError("memory_candidate_resolved", "Memory candidate has already been resolved.", 409);
  }
  const resolver = actorId("reviewer");
  const previous = candidate.target_memory_id ? getMemory(candidate.target_memory_id) : null;
  let memory: MemoryRecord;
  if (candidate.operation === "delete") {
    const deleted = candidate.target_memory_id
      ? deleteMemory(candidate.target_memory_id, resolver)
      : null;
    if (!deleted) {
      throw new MemoryStoreError("memory_not_found", "Target memory was not found in this Workspace.", 404);
    }
    memory = deleted;
  } else if (candidate.operation === "update") {
    const updated = candidate.target_memory_id
      ? updateMemory(candidate.target_memory_id, candidate.proposed_memory || {}, resolver)
      : null;
    if (!updated) {
      throw new MemoryStoreError("memory_not_found", "Target memory was not found in this Workspace.", 404);
    }
    memory = updated;
  } else {
    memory = createMemory(candidate.proposed_memory || {}, {
      origin: candidate.proposed_memory?.source.origin || "inferred",
      createdBy: resolver,
      workspaceId: candidate.workspace_id,
    });
  }
  try {
    const resolved = saveCandidateRecord({
      ...candidate,
      status: "approved",
      resolved_by: resolver,
      resolved_at: nowIso(),
      resolution_note: optionalText(input.note, "note", 500),
      committed_memory_id: memory.memory_id,
    });
    recordMemoryCandidateDecision("approved");
    return { candidate: resolved, memory };
  } catch (error) {
    if (candidate.operation === "create") {
      getJsonStorageBackend().removeJson(memoryPath(memory.memory_id, memory.workspace_id));
      if (previous) saveMemoryRecord(previous);
    } else if (previous) {
      saveMemoryRecord(previous);
    }
    throw error;
  }
}

export function rejectMemoryCandidate(
  candidateId: string,
  input: { note?: unknown } = {},
): MemoryCandidateRecord | null {
  const candidate = getMemoryCandidate(candidateId);
  if (!candidate) return null;
  if (candidate.status !== "pending") {
    throw new MemoryStoreError("memory_candidate_resolved", "Memory candidate has already been resolved.", 409);
  }
  const resolved = saveCandidateRecord({
    ...candidate,
    status: "rejected",
    resolved_by: actorId("reviewer"),
    resolved_at: nowIso(),
    resolution_note: optionalText(input.note, "note", 500),
  });
  recordMemoryCandidateDecision("rejected");
  return resolved;
}
