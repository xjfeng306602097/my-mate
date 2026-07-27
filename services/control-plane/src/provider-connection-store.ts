import path from "node:path";
import { PROVIDER_CONNECTIONS_DIR } from "./config.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  ProviderConnectionRecord,
  ProviderConnectionSnapshot,
  ProviderConnectionVerification,
  RegistryStatus,
  UpsertProviderConnectionRequest,
} from "./types.js";
import { ensureDir, nowIso, slugify, writeJsonAtomic } from "./utils.js";
import { validateProviderConnection } from "./validators.js";
import {
  hasManagedProviderCredential,
  setManagedProviderCredential,
} from "./provider-secret-store.js";

const CREDENTIAL_ENVS: Record<string, readonly string[]> = {
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  "claude-sdk": ["ANTHROPIC_API_KEY"],
  glm: ["GLM_API_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
  kimi: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
};

const DEFAULT_PROTOCOLS: Record<string, ProviderConnectionRecord["protocol"]> = {
  codex: "codex-appserver",
  "claude-sdk": "anthropic-messages",
  glm: "anthropic-messages",
  kimi: "openai-compatible",
};

export const DEFAULT_PROVIDER_MAX_INPUT_TOKENS = 524_288;
export const DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS = 65_536;
export const DEFAULT_CONTEXT_COMPRESSION_ENABLED = true;
export const DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT = 75;
export const DEFAULT_MAX_CONTINUATION_ROUNDS = 8;
export const DEFAULT_MAX_TOOL_ROUNDS = 32;
export const MAX_PROVIDER_INPUT_TOKENS = 1_048_576;
export const MAX_PROVIDER_OUTPUT_TOKENS = 131_072;
export const MAX_PROVIDER_TOOL_ROUNDS = 128;

function normalizeTokenLimit(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function uniqueModels(values: unknown, defaultModel?: string | null): string[] {
  const candidates = Array.isArray(values) ? values : [];
  return [...new Set([
    ...candidates.filter((item): item is string => typeof item === "string").map((item) => item.trim()),
    defaultModel?.trim() || "",
  ].filter(Boolean))];
}

function normalizeRecord(record: ProviderConnectionRecord): ProviderConnectionRecord {
  const defaultModel = record.default_model?.trim() || null;
  return {
    ...record,
    protocol: record.protocol || DEFAULT_PROTOCOLS[record.agent_runtime] || "openai-compatible",
    models: uniqueModels(record.models, defaultModel),
    default_model: defaultModel,
    max_input_tokens: normalizeTokenLimit(
      record.max_input_tokens,
      DEFAULT_PROVIDER_MAX_INPUT_TOKENS,
      4_096,
      MAX_PROVIDER_INPUT_TOKENS,
    ),
    max_output_tokens: normalizeTokenLimit(
      record.max_output_tokens,
      DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS,
      1_024,
      MAX_PROVIDER_OUTPUT_TOKENS,
    ),
    context_compression_enabled:
      typeof record.context_compression_enabled === "boolean"
        ? record.context_compression_enabled
        : DEFAULT_CONTEXT_COMPRESSION_ENABLED,
    context_compression_threshold_percent: normalizeTokenLimit(
      record.context_compression_threshold_percent,
      DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
      50,
      95,
    ),
    max_continuation_rounds: normalizeTokenLimit(
      record.max_continuation_rounds,
      DEFAULT_MAX_CONTINUATION_ROUNDS,
      0,
      32,
    ),
    max_tool_rounds: normalizeTokenLimit(
      record.max_tool_rounds,
      DEFAULT_MAX_TOOL_ROUNDS,
      1,
      MAX_PROVIDER_TOOL_ROUNDS,
    ),
    credential_source: record.credential_source || "environment",
    verification: record.verification || null,
  };
}

function connectionPath(connectionId: string): string {
  return path.join(PROVIDER_CONNECTIONS_DIR, `${connectionId}.json`);
}

function normalizeStatus(value: unknown): RegistryStatus {
  return value === "disabled" ? "disabled" : "active";
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
    throw new Error("Provider base_url must use HTTPS, except for localhost development.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Provider base_url must not contain credentials, query parameters, or fragments.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function assertSecretFreeMetadata(value: unknown, path = "metadata"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFreeMetadata(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:secret|token|password|api[_-]?key|authorization|credential)/i.test(key)) {
      throw new Error(`Provider Connection ${path}.${key} cannot store secret material.`);
    }
    assertSecretFreeMetadata(nested, `${path}.${key}`);
  }
}

function assertValid(record: ProviderConnectionRecord): void {
  const allowed = CREDENTIAL_ENVS[record.agent_runtime];
  if (!allowed?.includes(record.credential_env)) {
    throw new Error(`Credential env ${record.credential_env} is not allowed for ${record.agent_runtime}.`);
  }
  if (record.agent_runtime === "glm" && !record.base_url) {
    throw new Error("GLM Provider Connection requires an Anthropic-compatible base_url.");
  }
  assertSecretFreeMetadata(record.metadata);
  if (!validateProviderConnection(record)) {
    const detail = validateProviderConnection.errors?.map((item) => `${item.instancePath} ${item.message}`).join("; ");
    throw new Error(`Provider Connection validation failed: ${detail || "unknown error"}`);
  }
}

export function listProviderConnections(status?: RegistryStatus): ProviderConnectionRecord[] {
  const workspaceId = getActiveWorkspaceId();
  return getJsonStorageBackend().listJsonFiles(PROVIDER_CONNECTIONS_DIR)
    .map((file) => normalizeRecord(getJsonStorageBackend().readJson<ProviderConnectionRecord>(file)))
    .filter((item) => !workspaceId || item.workspace_id === workspaceId)
    .filter((item) => !status || item.status === status)
    .sort((left, right) => left.connection_id.localeCompare(right.connection_id));
}

export function getProviderConnection(connectionId: string): ProviderConnectionRecord | null {
  const file = connectionPath(connectionId);
  if (!getJsonStorageBackend().exists(file)) return null;
  const record = normalizeRecord(getJsonStorageBackend().readJson<ProviderConnectionRecord>(file));
  const workspaceId = getActiveWorkspaceId();
  return workspaceId && record.workspace_id !== workspaceId ? null : record;
}

export function upsertProviderConnection(input: UpsertProviderConnectionRequest): ProviderConnectionRecord {
  ensureDir(PROVIDER_CONNECTIONS_DIR);
  const connectionId = slugify(input.connection_id || input.name) || "provider-connection";
  const existingPath = connectionPath(connectionId);
  const activeWorkspaceId = getActiveWorkspaceId();
  if (getJsonStorageBackend().exists(existingPath)) {
    const existing = getJsonStorageBackend().readJson<ProviderConnectionRecord>(existingPath);
    if (activeWorkspaceId && existing.workspace_id !== activeWorkspaceId) {
      throw new Error("PROVIDER_CONNECTION_ID_CONFLICT");
    }
  }
  const current = getProviderConnection(connectionId);
  const timestamp = nowIso();
  const agentRuntime = input.agent_runtime.trim();
  if (agentRuntime === "openclaw") {
    throw new Error("OpenClaw Provider Connections are retired. Configure the model provider directly.");
  }
  const defaultModel = input.default_model?.trim() || null;
  const models = uniqueModels(input.models ?? current?.models, defaultModel);
  const credentialSource = input.api_key?.trim()
    ? "managed"
    : input.credential_source || current?.credential_source || "environment";
  const credentialEnv = input.credential_env?.trim() || current?.credential_env || CREDENTIAL_ENVS[agentRuntime]?.[0] || "PROVIDER_API_KEY";
  const record: ProviderConnectionRecord = {
    connection_id: connectionId,
    workspace_id: getActiveWorkspaceId() || current?.workspace_id || "default",
    name: input.name.trim(),
    agent_runtime: agentRuntime,
    provider: input.provider?.trim() || agentRuntime,
    protocol: input.protocol || current?.protocol || DEFAULT_PROTOCOLS[agentRuntime] || "openai-compatible",
    base_url: normalizeUrl(input.base_url),
    models,
    default_model: defaultModel || models[0] || null,
    max_input_tokens: normalizeTokenLimit(
      input.max_input_tokens,
      current?.max_input_tokens || DEFAULT_PROVIDER_MAX_INPUT_TOKENS,
      4_096,
      MAX_PROVIDER_INPUT_TOKENS,
    ),
    max_output_tokens: normalizeTokenLimit(
      input.max_output_tokens,
      current?.max_output_tokens || DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS,
      1_024,
      MAX_PROVIDER_OUTPUT_TOKENS,
    ),
    context_compression_enabled:
      typeof input.context_compression_enabled === "boolean"
        ? input.context_compression_enabled
        : current?.context_compression_enabled ?? DEFAULT_CONTEXT_COMPRESSION_ENABLED,
    context_compression_threshold_percent: normalizeTokenLimit(
      input.context_compression_threshold_percent,
      current?.context_compression_threshold_percent || DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
      50,
      95,
    ),
    max_continuation_rounds: normalizeTokenLimit(
      input.max_continuation_rounds,
      current?.max_continuation_rounds ?? DEFAULT_MAX_CONTINUATION_ROUNDS,
      0,
      32,
    ),
    max_tool_rounds: normalizeTokenLimit(
      input.max_tool_rounds,
      current?.max_tool_rounds ?? DEFAULT_MAX_TOOL_ROUNDS,
      1,
      MAX_PROVIDER_TOOL_ROUNDS,
    ),
    credential_source: credentialSource,
    credential_env: credentialEnv,
    verification: null,
    status: normalizeStatus(input.status || current?.status),
    metadata: input.metadata || current?.metadata || {},
    created_at: current?.created_at || timestamp,
    updated_at: timestamp,
  };
  assertValid(record);
  if (input.api_key?.trim()) {
    setManagedProviderCredential({
      connectionId,
      workspaceId: record.workspace_id,
      apiKey: input.api_key,
    });
  }
  writeJsonAtomic(connectionPath(connectionId), record);
  return record;
}

export function recordProviderConnectionVerification(
  connectionId: string,
  verification: ProviderConnectionVerification,
): ProviderConnectionRecord {
  const current = getProviderConnection(connectionId);
  if (!current) throw new Error("PROVIDER_CONNECTION_NOT_FOUND");
  const next = { ...current, verification };
  assertValid(next);
  writeJsonAtomic(connectionPath(connectionId), next);
  return next;
}

export function disableProviderConnection(connectionId: string): ProviderConnectionRecord {
  const current = getProviderConnection(connectionId);
  if (!current) throw new Error("PROVIDER_CONNECTION_NOT_FOUND");
  const next = { ...current, status: "disabled" as const, updated_at: nowIso() };
  assertValid(next);
  writeJsonAtomic(connectionPath(connectionId), next);
  return next;
}

export function snapshotProviderConnection(
  connectionId: string | null | undefined,
  modelOverride?: string | null,
): ProviderConnectionSnapshot | null {
  if (!connectionId) return null;
  const record = getProviderConnection(connectionId);
  if (!record || record.status !== "active") return null;
  return {
    connection_id: record.connection_id,
    agent_runtime: record.agent_runtime,
    provider: record.provider,
    protocol: record.protocol,
    base_url: record.base_url,
    model: modelOverride?.trim() || record.default_model,
    credential_source: record.credential_source,
    credential_env: record.credential_env,
  };
}

export function providerConnectionStatus(record: ProviderConnectionRecord): {
  credential_configured: boolean;
} {
  return {
    credential_configured: record.credential_source === "managed"
      ? hasManagedProviderCredential(record.connection_id)
      : typeof process.env[record.credential_env] === "string" && !!process.env[record.credential_env]?.trim(),
  };
}
