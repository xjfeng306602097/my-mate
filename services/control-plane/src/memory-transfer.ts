import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import {
  createMemory,
  deleteMemory,
  listAllMemories,
  MemoryStoreError,
  updateMemory,
  type MemoryProposalInput,
} from "./memory-store.js";
import { recordMemoryTransfer } from "./memory-observability.js";
import type {
  MemoryExportBundle,
  MemoryImportResult,
  MemoryRecord,
  MemoryScopeKind,
} from "./types.js";
import { nowIso } from "./utils.js";

export type MemoryImportStrategy = MemoryImportResult["strategy"];

function portable(record: MemoryRecord): MemoryRecord {
  return structuredClone(record);
}

export function exportMemories(status: MemoryRecord["status"] | "all" = "all"): MemoryExportBundle {
  const memories = listAllMemories({ status }).map(portable);
  recordMemoryTransfer("export", memories.length);
  return {
    schema_version: 1,
    exported_at: nowIso(),
    workspace_id: getActiveWorkspaceId() || "default",
    count: memories.length,
    memories,
  };
}

export function serializeMemoryExport(bundle: MemoryExportBundle, format: "json" | "jsonl"): string {
  if (format === "jsonl") return bundle.memories.map((memory) => JSON.stringify(memory)).join("\n") + (bundle.count ? "\n" : "");
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function parsePayload(input: unknown): unknown[] {
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) return [];
    try {
      return parsePayload(JSON.parse(value));
    } catch {
      return value.split(/\r?\n/u).filter(Boolean).map((line, index) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          throw new MemoryStoreError("memory_import_invalid", `Invalid JSONL at line ${index + 1}.`);
        }
      });
    }
  }
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (Array.isArray(record.memories)) return record.memories;
  }
  throw new MemoryStoreError("memory_import_invalid", "Import payload must be a memory bundle, array, JSON, or JSONL.");
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new MemoryStoreError("memory_import_invalid", `${field} is required.`);
  return value.trim();
}

function proposal(raw: unknown, workspaceId: string, principalId: string): { input: MemoryProposalInput; foreignId: string | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MemoryStoreError("memory_import_invalid", "Memory entry must be an object.");
  const value = raw as Record<string, unknown>;
  const scopeKind = text(value.scope_kind, "scope_kind") as MemoryScopeKind;
  if (!new Set(["workspace", "user", "project", "agent"]).has(scopeKind)) {
    throw new MemoryStoreError("memory_import_invalid", "scope_kind is unsupported.");
  }
  const scopeId = scopeKind === "workspace"
    ? workspaceId
    : scopeKind === "user"
      ? principalId
      : text(value.scope_id, "scope_id");
  const foreignId = typeof value.memory_id === "string" && value.memory_id.trim() ? value.memory_id.trim() : null;
  const source = value.source && typeof value.source === "object" && !Array.isArray(value.source)
    ? value.source as Record<string, unknown>
    : {};
  return {
    foreignId,
    input: {
      scope_kind: scopeKind,
      scope_id: scopeId,
      kind: value.kind,
      content: value.content,
      confidence: value.confidence,
      importance: value.importance,
      sensitivity: value.sensitivity,
      tags: value.tags,
      valid_from: value.valid_from,
      valid_until: value.valid_until,
      expires_at: value.expires_at,
      source: {
        origin: "imported",
        session_id: null,
        message_ids: [],
        action_id: null,
        provider_id: null,
        note: foreignId ? `Imported from ${foreignId}` : typeof source.note === "string" ? source.note : "Imported memory",
      },
    },
  };
}

function importedMatch(foreignId: string | null): MemoryRecord | null {
  if (!foreignId) return null;
  const note = `Imported from ${foreignId}`;
  return listAllMemories({ status: "all" }).find((memory) => memory.source.origin === "imported" && memory.source.note === note) || null;
}

export function importMemories(input: unknown, options: { dryRun?: boolean; strategy?: MemoryImportStrategy } = {}): MemoryImportResult {
  const strategy = options.strategy || "skip";
  if (!new Set(["skip", "merge", "replace"]).has(strategy)) {
    throw new MemoryStoreError("memory_import_invalid", "Import strategy must be skip, merge, or replace.");
  }
  const entries = parsePayload(input);
  const workspaceId = getActiveWorkspaceId() || "default";
  const principalId = getActivePrincipalId() || "dev-user";
  const result: MemoryImportResult = {
    dry_run: options.dryRun === true,
    strategy,
    total: entries.length,
    created: 0,
    updated: 0,
    skipped: 0,
    rejected: 0,
    errors: [],
    memory_ids: [],
  };
  entries.forEach((entry, index) => {
    try {
      const normalized = proposal(entry, workspaceId, principalId);
      const existing = importedMatch(normalized.foreignId);
      if (existing && strategy === "skip") {
        result.skipped += 1;
        result.memory_ids.push(existing.memory_id);
        return;
      }
      if (existing) {
        result.updated += 1;
        result.memory_ids.push(existing.memory_id);
        if (!result.dry_run) {
          if (strategy === "replace") deleteMemory(existing.memory_id, "system:memory-import");
          const updated = strategy === "replace"
            ? createMemory(normalized.input, { origin: "imported", createdBy: "system:memory-import" })
            : updateMemory(existing.memory_id, normalized.input, "system:memory-import");
          if (updated && strategy === "replace") result.memory_ids[result.memory_ids.length - 1] = updated.memory_id;
        }
        return;
      }
      result.created += 1;
      if (!result.dry_run) {
        const memory = createMemory(normalized.input, { origin: "imported", createdBy: "system:memory-import" });
        result.memory_ids.push(memory.memory_id);
      }
    } catch (error) {
      result.rejected += 1;
      result.errors.push({ index, message: error instanceof Error ? error.message : "Memory import failed." });
    }
  });
  if (!result.dry_run) recordMemoryTransfer("import", result.created + result.updated);
  return result;
}
