import { createHash } from "node:crypto";
import type { MemoryEmbeddingProviderStatus } from "./types.js";
import { getMemorySettings } from "./memory-settings-store.js";
import { getProviderConnection } from "./provider-connection-store.js";
import { getManagedProviderCredential } from "./provider-secret-store.js";

export interface MemoryEmbeddingProvider {
  readonly providerId: string;
  readonly model: string;
  readonly dimensions: number | null;
  readonly fingerprint: string;
  embed(texts: string[]): Promise<number[][]>;
}

let lastError: string | null = null;

function configuredProvider(): string {
  const persisted = getMemorySettings().embedding.provider;
  return persisted !== "disabled"
    ? persisted
    : (process.env.MY_MATE_MEMORY_EMBEDDING_PROVIDER || "").trim().toLowerCase();
}

function configuredDimensions(): number | null {
  const persisted = getMemorySettings().embedding.dimensions;
  if (persisted) return persisted;
  const value = Number(process.env.MY_MATE_MEMORY_EMBEDDING_DIMENSIONS || "");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function embeddingsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, "");
  if (/\/embeddings$/u.test(normalized)) return normalized;
  return /\/v1$/u.test(normalized) ? `${normalized}/embeddings` : `${normalized}/v1/embeddings`;
}

function openAiCompatibleProvider(): MemoryEmbeddingProvider | null {
  if (configuredProvider() !== "openai-compatible") return null;
  const settings = getMemorySettings().embedding;
  const connection = settings.provider_connection_id ? getProviderConnection(settings.provider_connection_id) : null;
  const baseUrl = (connection?.base_url || process.env.MY_MATE_MEMORY_EMBEDDING_BASE_URL || "").trim();
  const model = (settings.model || connection?.default_model || process.env.MY_MATE_MEMORY_EMBEDDING_MODEL || "text-embedding-3-small").trim();
  if (!baseUrl || !model) return null;
  const dimensions = configuredDimensions();
  const endpoint = embeddingsEndpoint(baseUrl);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ provider: "openai-compatible", endpoint, model, dimensions }))
    .digest("hex");
  return {
    providerId: "openai-compatible",
    model,
    dimensions,
    fingerprint,
    async embed(texts: string[]): Promise<number[][]> {
      if (!texts.length) return [];
      const controller = new AbortController();
      const timeoutMs = Math.max(1_000, Number(process.env.MY_MATE_MEMORY_EMBEDDING_TIMEOUT_MS || 30_000));
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        const apiKey = connection
          ? connection.credential_source === "managed"
            ? getManagedProviderCredential(connection.connection_id) || ""
            : process.env[connection.credential_env]?.trim() || ""
          : (process.env.MY_MATE_MEMORY_EMBEDDING_API_KEY || "").trim();
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            input: texts,
            ...(dimensions ? { dimensions } : {}),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Embedding provider returned HTTP ${response.status}.`);
        }
        const payload = await response.json() as {
          data?: Array<{ index?: number; embedding?: unknown }>;
        };
        const ordered = [...(payload.data || [])].sort((left, right) => Number(left.index || 0) - Number(right.index || 0));
        const vectors = ordered.map((item) =>
          Array.isArray(item.embedding)
            ? item.embedding.map(Number).filter(Number.isFinite)
            : [],
        );
        if (vectors.length !== texts.length || vectors.some((vector) => vector.length === 0)) {
          throw new Error("Embedding provider returned an invalid vector batch.");
        }
        lastError = null;
        return vectors;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Embedding provider failed.";
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function getMemoryEmbeddingProvider(): MemoryEmbeddingProvider | null {
  return openAiCompatibleProvider();
}

export function memoryEmbeddingProviderStatus(cachedVectors = 0): MemoryEmbeddingProviderStatus {
  const provider = getMemoryEmbeddingProvider();
  if (!configuredProvider()) {
    return {
      provider_id: "disabled",
      state: "disabled",
      model: null,
      dimensions: null,
      fingerprint: null,
      cached_vectors: 0,
      last_error: null,
    };
  }
  if (!provider) {
    const settings = getMemorySettings().embedding;
    return {
      provider_id: configuredProvider(),
      state: "degraded",
      model: settings.model || (process.env.MY_MATE_MEMORY_EMBEDDING_MODEL || "").trim() || null,
      dimensions: configuredDimensions(),
      fingerprint: null,
      cached_vectors: cachedVectors,
      last_error: "Embedding provider configuration is incomplete or unsupported.",
    };
  }
  return {
    provider_id: provider.providerId,
    state: lastError ? "degraded" : "ready",
    model: provider.model,
    dimensions: provider.dimensions,
    fingerprint: provider.fingerprint,
    cached_vectors: cachedVectors,
    last_error: lastError,
  };
}

export function resetMemoryEmbeddingProviderStateForTests(): void {
  lastError = null;
}
