import path from "node:path";
import { MEMORY_ONBOARDING_DIR } from "./config.js";
import {
  deserializeMemoryOnboarding,
  serializeMemoryOnboarding,
} from "./memory-encryption.js";
import { createMemory, createMemoryCandidate } from "./memory-store.js";
import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { MemoryKind, MemoryOnboardingRecord, MemorySensitivity } from "./types.js";
import { nowIso } from "./utils.js";

type DraftEntry = MemoryOnboardingRecord["draft_entries"][number];
const KINDS = new Set<MemoryKind>(["preference", "fact", "convention", "decision", "lesson"]);
const SCOPES = new Set<DraftEntry["scope_kind"]>(["user", "workspace", "project"]);
const SENSITIVITIES = new Set<Exclude<MemorySensitivity, "restricted">>(["normal", "private"]);

function identity(): { workspaceId: string; principalId: string } {
  return {
    workspaceId: getActiveWorkspaceId() || "default",
    principalId: getActivePrincipalId() || "development-user",
  };
}

function recordPath(workspaceId: string, principalId: string): string {
  return path.join(
    MEMORY_ONBOARDING_DIR,
    encodeURIComponent(workspaceId),
    `${encodeURIComponent(principalId)}.json`,
  );
}

function emptyRecord(workspaceId: string, principalId: string): MemoryOnboardingRecord {
  return {
    schema_version: 1,
    workspace_id: workspaceId,
    principal_id: principalId,
    status: "not_started",
    step: 0,
    draft_entries: [],
    committed_memory_ids: [],
    candidate_ids: [],
    started_at: null,
    completed_at: null,
    dismissed_at: null,
    updated_at: nowIso(),
  };
}

function save(record: MemoryOnboardingRecord): MemoryOnboardingRecord {
  getJsonStorageBackend().writeJson(
    recordPath(record.workspace_id, record.principal_id),
    serializeMemoryOnboarding(record),
  );
  return record;
}

export function getMemoryOnboarding(): MemoryOnboardingRecord {
  const { workspaceId, principalId } = identity();
  const storage = getJsonStorageBackend();
  const file = recordPath(workspaceId, principalId);
  if (!storage.exists(file)) return emptyRecord(workspaceId, principalId);
  const decoded = deserializeMemoryOnboarding(storage.readJson<unknown>(file));
  if (decoded.legacyPlaintext) storage.writeJson(file, serializeMemoryOnboarding(decoded.record));
  return decoded.record;
}

export function startMemoryOnboarding(): MemoryOnboardingRecord {
  const current = getMemoryOnboarding();
  const timestamp = nowIso();
  return save({
    ...current,
    status: "in_progress",
    step: current.status === "in_progress" ? current.step : 1,
    started_at: current.status === "in_progress" ? current.started_at : timestamp,
    completed_at: null,
    dismissed_at: null,
    updated_at: timestamp,
  });
}

function normalizeEntry(value: unknown, record: MemoryOnboardingRecord): DraftEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid onboarding entry.");
  const raw = value as Record<string, unknown>;
  const content = typeof raw.content === "string" ? raw.content.trim() : "";
  if (content.length < 2 || content.length > 4_000) throw new Error("Onboarding content must be 2-4000 characters.");
  const kind = KINDS.has(raw.kind as MemoryKind) ? raw.kind as MemoryKind : "preference";
  const scopeKind = SCOPES.has(raw.scope_kind as DraftEntry["scope_kind"])
    ? raw.scope_kind as DraftEntry["scope_kind"]
    : "user";
  const sensitivity = SENSITIVITIES.has(raw.sensitivity as Exclude<MemorySensitivity, "restricted">)
    ? raw.sensitivity as Exclude<MemorySensitivity, "restricted">
    : "normal";
  const scopeId = typeof raw.scope_id === "string" && raw.scope_id.trim() ? raw.scope_id.trim() : null;
  if (scopeKind === "project" && !scopeId) throw new Error("Project onboarding entries require scope_id.");
  return {
    content,
    kind,
    scope_kind: scopeKind,
    scope_id: scopeId || (scopeKind === "workspace" ? record.workspace_id : scopeKind === "user" ? record.principal_id : null),
    sensitivity,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20)
      : [],
    origin: raw.origin === "inferred" ? "inferred" : "explicit",
  };
}

export function previewMemoryOnboarding(input: { step?: unknown; entries?: unknown }): MemoryOnboardingRecord {
  const current = startMemoryOnboarding();
  const entries = Array.isArray(input.entries) ? input.entries.map((item) => normalizeEntry(item, current)) : current.draft_entries;
  const requestedStep = typeof input.step === "number" && Number.isFinite(input.step) ? Math.floor(input.step) : current.step;
  return save({
    ...current,
    step: Math.min(4, Math.max(1, requestedStep)),
    draft_entries: entries,
    updated_at: nowIso(),
  });
}

export function completeMemoryOnboarding(): MemoryOnboardingRecord {
  const current = getMemoryOnboarding();
  if (current.status !== "in_progress") throw new Error("Memory onboarding is not in progress.");
  const committed = [...current.committed_memory_ids];
  const candidates = [...current.candidate_ids];
  for (const entry of current.draft_entries) {
    const proposal = {
      content: entry.content,
      kind: entry.kind,
      scope_kind: entry.scope_kind,
      scope_id: entry.scope_id || undefined,
      sensitivity: entry.sensitivity,
      tags: entry.tags,
    };
    if (entry.origin === "explicit") {
      committed.push(createMemory(proposal, { origin: "explicit_user" }).memory_id);
    } else {
      candidates.push(createMemoryCandidate({
        proposed_memory: proposal,
        rationale: "Suggested during guided Memory onboarding.",
        risk: entry.sensitivity === "private" ? "high" : "medium",
        autonomy_mode: "assisted",
        proposed_by: current.principal_id,
      }).candidate_id);
    }
  }
  const timestamp = nowIso();
  return save({
    ...current,
    status: "completed",
    step: 4,
    committed_memory_ids: [...new Set(committed)],
    candidate_ids: [...new Set(candidates)],
    completed_at: timestamp,
    dismissed_at: null,
    updated_at: timestamp,
  });
}

export function dismissMemoryOnboarding(): MemoryOnboardingRecord {
  const current = getMemoryOnboarding();
  const timestamp = nowIso();
  return save({ ...current, status: "dismissed", dismissed_at: timestamp, updated_at: timestamp });
}
