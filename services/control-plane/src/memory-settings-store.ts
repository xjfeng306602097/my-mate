import path from "node:path";
import { MEMORY_SETTINGS_DIR } from "./config.js";
import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { MemorySettings } from "./types.js";
import { nowIso } from "./utils.js";
import { getProviderConnection } from "./provider-connection-store.js";

export class MemorySettingsError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function settingsPath(workspaceId: string): string {
  return path.join(MEMORY_SETTINGS_DIR, `${encodeURIComponent(workspaceId)}.json`);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new MemorySettingsError("memory_settings_invalid", `Expected an integer between ${minimum} and ${maximum}.`);
  }
  return Math.floor(parsed);
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new MemorySettingsError("memory_settings_invalid", `Expected a number between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum || /[\r\n\0]/u.test(value)) {
    throw new MemorySettingsError("memory_settings_invalid", `Expected text with at most ${maximum} characters.`);
  }
  return value.trim();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function defaultMemorySettings(workspaceId = getActiveWorkspaceId() || "default"): MemorySettings {
  return {
    schema_version: 1,
    workspace_id: workspaceId,
    background_review: {
      enabled: true,
      min_user_characters: 24,
      max_candidates_per_review: 3,
    },
    automatic_recall: {
      enabled: true,
      max_results: 4,
      character_budget: 4_000,
      cache_ttl_seconds: 60,
    },
    intelligence: {
      extraction_mode: "deterministic",
      intent_model_enabled: false,
      provider_connection_id: null,
      model: null,
      max_turn_characters: 12_000,
      min_confidence: 0.72,
      model_timeout_ms: 45_000,
    },
    scope_policy: {
      project_memory_enabled: true,
      agent_memory_enabled: false,
    },
    retention: {
      resolved_candidate_days: 90,
      journal_max_records: 20_000,
      maintenance_interval_minutes: 60,
      soft_deleted_memory_days: 30,
      expired_memory_days: 90,
      turn_context_days: 90,
      feedback_days: 180,
      backup_days: 30,
    },
    embedding: {
      provider: "disabled",
      provider_connection_id: null,
      model: null,
      dimensions: null,
    },
    knowledge_graph: {
      provider: "disabled",
      palace_path: null,
      python_bin: null,
      sync_canonical: false,
    },
    updated_by: "system",
    updated_at: nowIso(),
  };
}

function normalizeSettings(input: unknown, current: MemorySettings): MemorySettings {
  const value = objectValue(input);
  const background = objectValue(value.background_review);
  const recall = objectValue(value.automatic_recall);
  const intelligence = objectValue(value.intelligence);
  const scope = objectValue(value.scope_policy);
  const retention = objectValue(value.retention);
  const embedding = objectValue(value.embedding);
  const knowledge = objectValue(value.knowledge_graph);
  const embeddingProvider = embedding.provider ?? current.embedding.provider;
  const knowledgeProvider = knowledge.provider ?? current.knowledge_graph.provider;
  const extractionMode = intelligence.extraction_mode ?? current.intelligence.extraction_mode;
  if (!new Set(["disabled", "openai-compatible"]).has(String(embeddingProvider))) {
    throw new MemorySettingsError("memory_settings_invalid", "Unsupported embedding provider.");
  }
  if (!new Set(["disabled", "mempalace"]).has(String(knowledgeProvider))) {
    throw new MemorySettingsError("memory_settings_invalid", "Unsupported knowledge graph provider.");
  }
  if (!new Set(["deterministic", "hybrid"]).has(String(extractionMode))) {
    throw new MemorySettingsError("memory_settings_invalid", "Unsupported memory extraction mode.");
  }
  const dimensionsValue = embedding.dimensions === undefined
    ? current.embedding.dimensions
    : embedding.dimensions;
  const dimensions = dimensionsValue === null || dimensionsValue === ""
    ? null
    : boundedInteger(dimensionsValue, 1_536, 1, 65_536);
  const next: MemorySettings = {
    schema_version: 1,
    workspace_id: current.workspace_id,
    background_review: {
      enabled: typeof background.enabled === "boolean" ? background.enabled : current.background_review.enabled,
      min_user_characters: boundedInteger(
        background.min_user_characters,
        current.background_review.min_user_characters,
        1,
        10_000,
      ),
      max_candidates_per_review: boundedInteger(
        background.max_candidates_per_review,
        current.background_review.max_candidates_per_review,
        1,
        20,
      ),
    },
    automatic_recall: {
      enabled: typeof recall.enabled === "boolean" ? recall.enabled : current.automatic_recall.enabled,
      max_results: boundedInteger(recall.max_results, current.automatic_recall.max_results, 1, 20),
      character_budget: boundedInteger(recall.character_budget, current.automatic_recall.character_budget, 500, 20_000),
      cache_ttl_seconds: boundedInteger(recall.cache_ttl_seconds, current.automatic_recall.cache_ttl_seconds, 0, 3_600),
    },
    intelligence: {
      extraction_mode: extractionMode as MemorySettings["intelligence"]["extraction_mode"],
      intent_model_enabled: typeof intelligence.intent_model_enabled === "boolean"
        ? intelligence.intent_model_enabled
        : current.intelligence.intent_model_enabled,
      provider_connection_id: optionalText(
        intelligence.provider_connection_id === undefined
          ? current.intelligence.provider_connection_id
          : intelligence.provider_connection_id,
        160,
      ),
      model: optionalText(intelligence.model === undefined ? current.intelligence.model : intelligence.model, 200),
      max_turn_characters: boundedInteger(
        intelligence.max_turn_characters,
        current.intelligence.max_turn_characters,
        1_000,
        100_000,
      ),
      min_confidence: boundedNumber(
        intelligence.min_confidence,
        current.intelligence.min_confidence,
        0.5,
        1,
      ),
      model_timeout_ms: boundedInteger(
        intelligence.model_timeout_ms,
        current.intelligence.model_timeout_ms,
        1_000,
        180_000,
      ),
    },
    scope_policy: {
      project_memory_enabled: typeof scope.project_memory_enabled === "boolean"
        ? scope.project_memory_enabled
        : current.scope_policy.project_memory_enabled,
      agent_memory_enabled: typeof scope.agent_memory_enabled === "boolean"
        ? scope.agent_memory_enabled
        : current.scope_policy.agent_memory_enabled,
    },
    retention: {
      resolved_candidate_days: boundedInteger(
        retention.resolved_candidate_days,
        current.retention.resolved_candidate_days,
        1,
        3_650,
      ),
      journal_max_records: boundedInteger(
        retention.journal_max_records,
        current.retention.journal_max_records,
        100,
        1_000_000,
      ),
      maintenance_interval_minutes: boundedInteger(
        retention.maintenance_interval_minutes,
        current.retention.maintenance_interval_minutes,
        1,
        10_080,
      ),
      soft_deleted_memory_days: boundedInteger(
        retention.soft_deleted_memory_days,
        current.retention.soft_deleted_memory_days,
        1,
        3_650,
      ),
      expired_memory_days: boundedInteger(
        retention.expired_memory_days,
        current.retention.expired_memory_days,
        1,
        3_650,
      ),
      turn_context_days: boundedInteger(
        retention.turn_context_days,
        current.retention.turn_context_days,
        1,
        3_650,
      ),
      feedback_days: boundedInteger(
        retention.feedback_days,
        current.retention.feedback_days,
        1,
        3_650,
      ),
      backup_days: boundedInteger(
        retention.backup_days,
        current.retention.backup_days,
        1,
        3_650,
      ),
    },
    embedding: {
      provider: embeddingProvider as MemorySettings["embedding"]["provider"],
      provider_connection_id: optionalText(
        embedding.provider_connection_id === undefined
          ? current.embedding.provider_connection_id
          : embedding.provider_connection_id,
        160,
      ),
      model: optionalText(embedding.model === undefined ? current.embedding.model : embedding.model, 200),
      dimensions,
    },
    knowledge_graph: {
      provider: knowledgeProvider as MemorySettings["knowledge_graph"]["provider"],
      palace_path: optionalText(
        knowledge.palace_path === undefined ? current.knowledge_graph.palace_path : knowledge.palace_path,
        1_000,
      ),
      python_bin: optionalText(
        knowledge.python_bin === undefined ? current.knowledge_graph.python_bin : knowledge.python_bin,
        1_000,
      ),
      sync_canonical: typeof knowledge.sync_canonical === "boolean"
        ? knowledge.sync_canonical
        : current.knowledge_graph.sync_canonical,
    },
    updated_by: getActivePrincipalId() || "system",
    updated_at: nowIso(),
  };
  if (next.embedding.provider !== "disabled" && !next.embedding.provider_connection_id) {
    throw new MemorySettingsError("memory_settings_invalid", "Embedding requires a Provider Connection.");
  }
  if (next.intelligence.provider_connection_id) {
    const connection = getProviderConnection(next.intelligence.provider_connection_id);
    if (!connection || connection.status !== "active" || connection.verification?.status !== "verified" || !connection.base_url) {
      throw new MemorySettingsError(
        "memory_settings_invalid",
        "Memory Intelligence requires a verified Provider Connection with an HTTP endpoint.",
      );
    }
  }
  if (next.embedding.provider !== "disabled") {
    const connection = getProviderConnection(next.embedding.provider_connection_id!);
    if (!connection || connection.status !== "active" || !connection.base_url) {
      throw new MemorySettingsError(
        "memory_settings_invalid",
        "Embedding requires an active Provider Connection with an HTTP endpoint.",
      );
    }
  }
  if (next.knowledge_graph.provider === "mempalace" && !next.knowledge_graph.palace_path) {
    throw new MemorySettingsError("memory_settings_invalid", "MemPalace requires a palace path.");
  }
  return next;
}

export function getMemorySettings(workspaceId = getActiveWorkspaceId() || "default"): MemorySettings {
  const storage = getJsonStorageBackend();
  const file = settingsPath(workspaceId);
  if (!storage.exists(file)) return defaultMemorySettings(workspaceId);
  const record = storage.readJson<MemorySettings>(file);
  if (record.workspace_id !== workspaceId) return defaultMemorySettings(workspaceId);
  const defaults = defaultMemorySettings(workspaceId);
  return {
    ...defaults,
    ...record,
    background_review: { ...defaults.background_review, ...(record.background_review || {}) },
    automatic_recall: { ...defaults.automatic_recall, ...(record.automatic_recall || {}) },
    intelligence: { ...defaults.intelligence, ...(record.intelligence || {}) },
    scope_policy: { ...defaults.scope_policy, ...(record.scope_policy || {}) },
    retention: { ...defaults.retention, ...(record.retention || {}) },
    embedding: { ...defaults.embedding, ...(record.embedding || {}) },
    knowledge_graph: { ...defaults.knowledge_graph, ...(record.knowledge_graph || {}) },
  };
}

export function updateMemorySettings(input: unknown): MemorySettings {
  const workspaceId = getActiveWorkspaceId() || "default";
  const next = normalizeSettings(input, getMemorySettings(workspaceId));
  getJsonStorageBackend().writeJson(settingsPath(workspaceId), next);
  return next;
}
