import path from "node:path";
import { MEMORY_OBSERVABILITY_DIR } from "./config.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { MemoryObservability, MemoryRetrievalResult } from "./types.js";
import { nowIso } from "./utils.js";

function recordPath(workspaceId: string): string {
  return path.join(MEMORY_OBSERVABILITY_DIR, `${encodeURIComponent(workspaceId)}.json`);
}

function emptyRecord(workspaceId: string): MemoryObservability {
  return {
    schema_version: 1,
    workspace_id: workspaceId,
    retrieval_queries: 0,
    retrieval_failures: 0,
    retrieval_total_latency_ms: 0,
    retrieval_last_latency_ms: null,
    lexical_hits: 0,
    ngram_hits: 0,
    embedding_hits: 0,
    embedding_fallbacks: 0,
    index_rebuilds: 0,
    background_reviews: 0,
    background_candidates: 0,
    background_commits: 0,
    model_extraction_attempts: 0,
    model_extraction_successes: 0,
    model_extraction_fallbacks: 0,
    model_proposed_creates: 0,
    model_proposed_updates: 0,
    model_proposed_supersedes: 0,
    model_proposed_deletes: 0,
    automatic_recall_queries: 0,
    automatic_recall_hits: 0,
    automatic_recall_failures: 0,
    automatic_recall_cache_hits: 0,
    automatic_recall_cache_misses: 0,
    automatic_recall_total_latency_ms: 0,
    automatic_recall_last_latency_ms: null,
    intent_model_attempts: 0,
    intent_model_successes: 0,
    intent_model_fallbacks: 0,
    candidates_approved: 0,
    candidates_rejected: 0,
    imported_memories: 0,
    exported_memories: 0,
    maintenance_runs: 0,
    maintenance_sweeps: 0,
    maintenance_workspace_failures: 0,
    private_memory_migrations: 0,
    private_candidate_migrations: 0,
    last_query_at: null,
    last_review_at: null,
    last_maintenance_at: null,
    updated_at: nowIso(),
  };
}

export function getMemoryObservability(workspaceId = getActiveWorkspaceId() || "default"): MemoryObservability {
  const file = recordPath(workspaceId);
  const storage = getJsonStorageBackend();
  return storage.exists(file)
    ? { ...emptyRecord(workspaceId), ...storage.readJson<MemoryObservability>(file) }
    : emptyRecord(workspaceId);
}

function update(mutator: (record: MemoryObservability) => void, workspaceId = getActiveWorkspaceId() || "default"): void {
  const record = getMemoryObservability(workspaceId);
  mutator(record);
  record.updated_at = nowIso();
  getJsonStorageBackend().writeJson(recordPath(workspaceId), record);
}

export function recordMemoryRetrieval(result: MemoryRetrievalResult | null, latencyMs: number, failed = false): void {
  update((record) => {
    record.retrieval_queries += 1;
    record.retrieval_total_latency_ms += Math.max(0, Math.round(latencyMs));
    record.retrieval_last_latency_ms = Math.max(0, Math.round(latencyMs));
    record.last_query_at = nowIso();
    if (failed) record.retrieval_failures += 1;
    if (!result) return;
    if (result.embedding_fallback) record.embedding_fallbacks += 1;
    if (result.index_rebuilt) record.index_rebuilds += 1;
    for (const hit of result.hits) {
      if (hit.evidence.matched_by.includes("lexical")) record.lexical_hits += 1;
      if (hit.evidence.matched_by.includes("ngram")) record.ngram_hits += 1;
      if (hit.evidence.matched_by.includes("embedding")) record.embedding_hits += 1;
    }
  });
}

export function recordMemoryCandidateDecision(decision: "approved" | "rejected"): void {
  update((record) => {
    if (decision === "approved") record.candidates_approved += 1;
    else record.candidates_rejected += 1;
  });
}

export function recordMemoryBackgroundReview(candidates: number, commits: number): void {
  update((record) => {
    record.background_reviews += 1;
    record.background_candidates += candidates;
    record.background_commits += commits;
    record.last_review_at = nowIso();
  });
}

export function recordMemoryModelExtraction(input: {
  outcome: "success" | "fallback";
  operations?: Partial<Record<"create" | "update" | "supersede" | "delete", number>>;
}): void {
  update((record) => {
    record.model_extraction_attempts += 1;
    if (input.outcome === "success") record.model_extraction_successes += 1;
    else record.model_extraction_fallbacks += 1;
    record.model_proposed_creates += input.operations?.create || 0;
    record.model_proposed_updates += input.operations?.update || 0;
    record.model_proposed_supersedes += input.operations?.supersede || 0;
    record.model_proposed_deletes += input.operations?.delete || 0;
  });
}

export function recordAutomaticMemoryRecall(
  hits: number,
  failed = false,
  options: { cacheHit?: boolean; latencyMs?: number } = {},
): void {
  update((record) => {
    record.automatic_recall_queries += 1;
    record.automatic_recall_hits += Math.max(0, hits);
    if (failed) record.automatic_recall_failures += 1;
    if (options.cacheHit === true) record.automatic_recall_cache_hits += 1;
    if (options.cacheHit === false) record.automatic_recall_cache_misses += 1;
    if (options.latencyMs !== undefined) {
      const latency = Math.max(0, Math.round(options.latencyMs));
      record.automatic_recall_total_latency_ms += latency;
      record.automatic_recall_last_latency_ms = latency;
    }
  });
}

export function recordIntentModel(outcome: "success" | "fallback"): void {
  update((record) => {
    record.intent_model_attempts += 1;
    if (outcome === "success") record.intent_model_successes += 1;
    else record.intent_model_fallbacks += 1;
  });
}

export function recordMemoryTransfer(kind: "import" | "export", count: number): void {
  update((record) => {
    if (kind === "import") record.imported_memories += count;
    else record.exported_memories += count;
  });
}

export function recordMemoryMaintenance(
  rebuilt: boolean,
  migrations: { memories?: number; candidates?: number } = {},
): void {
  update((record) => {
    record.maintenance_runs += 1;
    if (rebuilt) record.index_rebuilds += 1;
    record.private_memory_migrations += migrations.memories || 0;
    record.private_candidate_migrations += migrations.candidates || 0;
    record.last_maintenance_at = nowIso();
  });
}

export function recordMemoryMaintenanceSweep(workspaceFailures: number): void {
  update((record) => {
    record.maintenance_sweeps += 1;
    record.maintenance_workspace_failures += Math.max(0, workspaceFailures);
  });
}
