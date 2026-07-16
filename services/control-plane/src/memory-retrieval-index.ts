import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  MEMORY_RETRIEVAL_INDEX_DIR,
  MEMORIES_DIR,
  SERVICE_ROOT,
} from "./config.js";
import {
  getMemoryEmbeddingProvider,
  memoryEmbeddingProviderStatus,
} from "./memory-embedding-provider.js";
import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  MemoryKind,
  MemoryRecord,
  MemoryRetrievalHit,
  MemoryRetrievalIndexStatus,
  MemoryRetrievalResult,
  MemoryScopeKind,
} from "./types.js";
import { nowIso } from "./utils.js";
import { recordMemoryRetrieval } from "./memory-observability.js";
import { deserializeMemoryRecord } from "./memory-encryption.js";

interface MemoryJournalRecord {
  schema_version: 1;
  memory_id: string;
  version: number;
  workspace_id: string;
  scope_kind: MemoryRecord["scope_kind"];
  scope_id: string;
  kind: MemoryRecord["kind"];
  sensitivity: MemoryRecord["sensitivity"];
  status: MemoryRecord["status"];
  content: string;
  tags: string[];
  importance: number;
  confidence: number;
  updated_at: string;
  digest: string;
}

interface LocalIndexHit {
  memory_id: string;
  version: number;
  digest: string;
  lexical_score: number;
  semantic_score: number;
  fused_score: number;
  lexical_rank: number | null;
  semantic_rank: number | null;
  matched_by: Array<"lexical" | "ngram">;
}

interface LocalIndexResponse {
  ok?: boolean;
  error?: string;
  hits?: LocalIndexHit[];
  journal_records?: number;
  indexed_records?: number;
  active_records?: number;
}

interface EmbeddingCache {
  schema_version: 1;
  fingerprint: string;
  entries: Record<string, { version: number; digest: string; vector: number[] }>;
}

export interface MemoryRetrievalSearchInput {
  query: string;
  principalId?: string;
  scopeKind?: MemoryScopeKind;
  scopeId?: string;
  kind?: MemoryKind;
  limit?: number;
}

const retrievalCache = new Map<string, {
  generation: number;
  expiresAt: number;
  result: MemoryRetrievalResult;
}>();
let retrievalGeneration = 0;

function invalidateRetrievalCache(): void {
  retrievalGeneration += 1;
  retrievalCache.clear();
}

function journalPath(): string {
  return path.join(MEMORY_RETRIEVAL_INDEX_DIR, "journal.jsonl");
}

function databasePath(): string {
  return path.join(MEMORY_RETRIEVAL_INDEX_DIR, "memory-retrieval.sqlite3");
}

function embeddingCachePath(): string {
  return path.join(MEMORY_RETRIEVAL_INDEX_DIR, "embedding-cache.json");
}

function rebuildMarkerPath(): string {
  return path.join(MEMORY_RETRIEVAL_INDEX_DIR, "last-rebuild.json");
}

function helperPath(): string {
  return path.join(SERVICE_ROOT, "src", "memory-retrieval-sqlite.py");
}

function canonicalDigest(record: MemoryRecord): string {
  return createHash("sha256")
    .update(JSON.stringify([
      record.memory_id,
      record.version,
      record.workspace_id,
      record.scope_kind,
      record.scope_id,
      record.kind,
      record.sensitivity,
      record.status,
      record.content,
      record.tags,
      record.updated_at,
      "journal-v2-private-redaction",
    ]))
    .digest("hex");
}

function journalRecord(record: MemoryRecord): MemoryJournalRecord {
  return {
    schema_version: 1,
    memory_id: record.memory_id,
    version: record.version,
    workspace_id: record.workspace_id,
    scope_kind: record.scope_kind,
    scope_id: record.scope_id,
    kind: record.kind,
    sensitivity: record.sensitivity,
    status: record.status,
    content: record.sensitivity === "private" ? "" : record.content,
    tags: record.sensitivity === "private" ? [] : [...record.tags],
    importance: record.importance,
    confidence: record.confidence,
    updated_at: record.updated_at,
    digest: canonicalDigest(record),
  };
}

function rawMemories(): MemoryRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listDirs(MEMORIES_DIR).flatMap((workspaceDirectory) =>
    storage.listJsonFiles(workspaceDirectory).map((file) =>
      deserializeMemoryRecord(storage.readJson<unknown>(file)).record,
    ),
  );
}

export function appendMemoryRetrievalJournal(record: MemoryRecord): void {
  invalidateRetrievalCache();
  fs.mkdirSync(MEMORY_RETRIEVAL_INDEX_DIR, { recursive: true });
  fs.appendFileSync(journalPath(), `${JSON.stringify(journalRecord(record))}\n`, "utf-8");
}

export function rebuildMemoryRetrievalIndex(): number {
  invalidateRetrievalCache();
  fs.mkdirSync(MEMORY_RETRIEVAL_INDEX_DIR, { recursive: true });
  const records = rawMemories().map(journalRecord);
  const temporary = `${journalPath()}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(
    temporary,
    records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""),
    "utf-8",
  );
  fs.renameSync(temporary, journalPath());
  fs.rmSync(databasePath(), { force: true });
  fs.rmSync(embeddingCachePath(), { force: true });
  fs.writeFileSync(rebuildMarkerPath(), `${JSON.stringify({ rebuilt_at: nowIso(), records: records.length })}\n`, "utf-8");
  return records.length;
}

function detectPython(): string {
  const configured = process.env.MY_MATE_STORAGE_PYTHON?.trim();
  if (configured) return configured;
  const candidates = process.platform === "win32"
    ? [
        ...["Python313", "Python312", "Python311", "Python310"].map((version) =>
          path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", version, "python.exe"),
        ),
        "py",
        "python",
        "python3",
      ]
    : ["python3", "python"];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf-8", windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  throw new Error("Memory retrieval requires Python 3 with SQLite FTS5 support.");
}

function ensureJournal(): boolean {
  if (fs.existsSync(journalPath())) return false;
  rebuildMemoryRetrievalIndex();
  return true;
}

function runLocalIndex(request: Record<string, unknown>): LocalIndexResponse {
  const result = spawnSync(detectPython(), ["-X", "utf8", helperPath()], {
    encoding: "utf-8",
    input: JSON.stringify({
      ...request,
      db_path: databasePath(),
      journal_path: journalPath(),
    }),
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim() || "Memory retrieval index failed.");
  }
  const response = JSON.parse(result.stdout) as LocalIndexResponse;
  if (!response.ok) throw new Error(response.error || "Memory retrieval index failed.");
  return response;
}

function executeLocalIndex(request: Record<string, unknown>): { response: LocalIndexResponse; rebuilt: boolean } {
  let rebuilt = ensureJournal();
  try {
    return { response: runLocalIndex(request), rebuilt };
  } catch {
    rebuildMemoryRetrievalIndex();
    rebuilt = true;
    return { response: runLocalIndex(request), rebuilt };
  }
}

function currentlyValid(record: MemoryRecord, timestamp: string): boolean {
  if (record.status !== "active") return false;
  if (record.valid_from && record.valid_from > timestamp) return false;
  if (record.valid_until && record.valid_until <= timestamp) return false;
  if (record.expires_at && record.expires_at <= timestamp) return false;
  return true;
}

function visibleRecords(input: MemoryRetrievalSearchInput, workspaceId: string, principalId: string): MemoryRecord[] {
  const timestamp = nowIso();
  return rawMemories()
    .filter((record) => record.workspace_id === workspaceId)
    .filter((record) => currentlyValid(record, timestamp))
    .filter((record) => record.sensitivity !== "restricted")
    .filter((record) => record.scope_kind !== "user" || record.scope_id === principalId)
    .filter((record) => record.sensitivity !== "private" || (record.scope_kind === "user" && record.scope_id === principalId))
    .filter((record) => !input.scopeKind || record.scope_kind === input.scopeKind)
    .filter((record) => !input.scopeId || record.scope_id === input.scopeId)
    .filter((record) => !input.kind || record.kind === input.kind);
}

function readEmbeddingCache(fingerprint: string): EmbeddingCache {
  try {
    const cache = JSON.parse(fs.readFileSync(embeddingCachePath(), "utf-8")) as EmbeddingCache;
    if (cache.schema_version === 1 && cache.fingerprint === fingerprint && cache.entries) return cache;
  } catch {
    // Derived cache is rebuilt lazily.
  }
  return { schema_version: 1, fingerprint, entries: {} };
}

function writeEmbeddingCache(cache: EmbeddingCache): void {
  fs.mkdirSync(MEMORY_RETRIEVAL_INDEX_DIR, { recursive: true });
  const target = embeddingCachePath();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(cache)}\n`, "utf-8");
  fs.renameSync(temporary, target);
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

async function embeddingRanks(
  query: string,
  records: MemoryRecord[],
): Promise<{ ranks: Map<string, number>; scores: Map<string, number>; fallback: boolean }> {
  records = records.filter((record) => record.sensitivity !== "private");
  const provider = getMemoryEmbeddingProvider();
  if (!provider || !query.trim() || !records.length) {
    return { ranks: new Map(), scores: new Map(), fallback: false };
  }
  try {
    const cache = readEmbeddingCache(provider.fingerprint);
    const missing = records.filter((record) => {
      const entry = cache.entries[record.memory_id];
      return !entry || entry.version !== record.version || entry.digest !== canonicalDigest(record);
    });
    for (let offset = 0; offset < missing.length; offset += 32) {
      const batch = missing.slice(offset, offset + 32);
      const vectors = await provider.embed(batch.map((record) => `${record.kind}: ${record.content}\nTags: ${record.tags.join(", ")}`));
      batch.forEach((record, index) => {
        cache.entries[record.memory_id] = {
          version: record.version,
          digest: canonicalDigest(record),
          vector: vectors[index]!,
        };
      });
    }
    const [queryVector] = await provider.embed([query]);
    const ordered = records
      .map((record) => [record.memory_id, cosine(queryVector!, cache.entries[record.memory_id]!.vector)] as const)
      .filter(([, score]) => score > 0)
      .sort((left, right) => right[1] - left[1]);
    writeEmbeddingCache(cache);
    return {
      ranks: new Map(ordered.map(([memoryId], index) => [memoryId, index + 1])),
      scores: new Map(ordered),
      fallback: false,
    };
  } catch {
    return { ranks: new Map(), scores: new Map(), fallback: true };
  }
}

function searchTerms(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/\s+/gu, " ").trim();
  const terms = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 2));
  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, "");
  for (let index = 0; index < compact.length - 1; index += 1) terms.add(compact.slice(index, index + 2));
  return terms;
}

function privateMemoryRanks(query: string, records: MemoryRecord[]): {
  ranks: Map<string, number>;
  scores: Map<string, number>;
} {
  const queryTerms = searchTerms(query);
  if (!queryTerms.size) return { ranks: new Map(), scores: new Map() };
  const ordered = records
    .filter((record) => record.sensitivity === "private")
    .map((record) => {
      const terms = searchTerms(`${record.content} ${record.tags.join(" ")}`);
      let matches = 0;
      for (const term of queryTerms) if (terms.has(term)) matches += 1;
      return [record.memory_id, matches / queryTerms.size] as const;
    })
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1]);
  return {
    ranks: new Map(ordered.map(([memoryId], index) => [memoryId, index + 1])),
    scores: new Map(ordered),
  };
}

async function searchMemoryRetrievalInternal(input: MemoryRetrievalSearchInput): Promise<MemoryRetrievalResult> {
  const workspaceId = getActiveWorkspaceId() || "default";
  const principalId = input.principalId || getActivePrincipalId() || "dev-user";
  const limit = Math.min(20, Math.max(1, Math.floor(input.limit || 8)));
  const request = {
    action: "search",
    query: input.query.trim(),
    workspace_id: workspaceId,
    principal_id: principalId,
    scope_kind: input.scopeKind || null,
    scope_id: input.scopeId || null,
    kind: input.kind || null,
    limit: 500,
  };
  let indexed = executeLocalIndex(request);
  let records = visibleRecords(input, workspaceId, principalId);
  let recordMap = new Map(records.map((record) => [record.memory_id, record]));
  const stale = (indexed.response.hits || []).some((hit) => {
    const record = recordMap.get(hit.memory_id);
    return !record || record.version !== hit.version || canonicalDigest(record) !== hit.digest;
  });
  if (stale) {
    rebuildMemoryRetrievalIndex();
    indexed = { response: runLocalIndex(request), rebuilt: true };
    records = visibleRecords(input, workspaceId, principalId);
    recordMap = new Map(records.map((record) => [record.memory_id, record]));
  }
  const embedding = await embeddingRanks(input.query, records);
  const privateMemory = privateMemoryRanks(input.query, records);
  const embeddingEnabled = Boolean(getMemoryEmbeddingProvider()) && !embedding.fallback;
  const localHits = new Map((indexed.response.hits || []).map((hit) => [hit.memory_id, hit]));
  const candidateIds = new Set([
    ...localHits.keys(),
    ...(embeddingEnabled ? embedding.ranks.keys() : []),
    ...privateMemory.ranks.keys(),
  ]);
  const hits: MemoryRetrievalHit[] = [...candidateIds].flatMap((memoryId) => {
    const memory = recordMap.get(memoryId);
    if (!memory) return [];
    const local = localHits.get(memoryId);
    const embeddingRank = embedding.ranks.get(memoryId) || null;
    const privateRank = privateMemory.ranks.get(memoryId) || null;
    const privateScore = privateMemory.scores.get(memoryId) || 0;
    const fused = (local?.fused_score || 0) +
      (embeddingRank ? 1 / (60 + embeddingRank) : 0) +
      (privateRank ? privateScore + 1 / (60 + privateRank) : 0);
    return [{
      memory,
      evidence: {
        lexical_score: local?.lexical_score || privateScore,
        semantic_score: embeddingEnabled
          ? Number((embedding.scores.get(memoryId) || 0).toFixed(8))
          : local?.semantic_score || 0,
        fused_score: Number(fused.toFixed(8)),
        lexical_rank: local?.lexical_rank || null,
        semantic_rank: embeddingEnabled ? embeddingRank : local?.semantic_rank || privateRank,
        matched_by: [
          ...(local?.matched_by || []),
          ...(embeddingRank ? ["embedding" as const] : []),
          ...(privateRank ? ["ngram" as const] : []),
        ].filter((value, index, values) => values.indexOf(value) === index),
      },
    }];
  }).sort((left, right) => right.evidence.fused_score - left.evidence.fused_score).slice(0, limit);
  return {
    query: input.query.trim(),
    workspace_id: workspaceId,
    count: hits.length,
    retrieval: embeddingEnabled ? "hybrid_lexical_embedding_v1" : "hybrid_lexical_ngram_v1",
    index_rebuilt: indexed.rebuilt,
    embedding_fallback: embedding.fallback,
    hits,
  };
}

export async function searchMemoryRetrieval(input: MemoryRetrievalSearchInput): Promise<MemoryRetrievalResult> {
  const startedAt = Date.now();
  try {
    const result = await searchMemoryRetrievalInternal(input);
    recordMemoryRetrieval(result, Date.now() - startedAt);
    return result;
  } catch (error) {
    recordMemoryRetrieval(null, Date.now() - startedAt, true);
    throw error;
  }
}

export async function searchMemoryRetrievalCached(
  input: MemoryRetrievalSearchInput,
  ttlSeconds = 60,
): Promise<{ result: MemoryRetrievalResult; cache_hit: boolean }> {
  const workspaceId = getActiveWorkspaceId() || "default";
  const principalId = input.principalId || getActivePrincipalId() || "dev-user";
  const key = JSON.stringify([
    workspaceId,
    principalId,
    input.query.trim().toLowerCase(),
    input.scopeKind || null,
    input.scopeId || null,
    input.kind || null,
    input.limit || 8,
  ]);
  const cached = retrievalCache.get(key);
  if (ttlSeconds > 0 && cached && cached.generation === retrievalGeneration && cached.expiresAt > Date.now()) {
    return { result: cached.result, cache_hit: true };
  }
  const result = await searchMemoryRetrieval(input);
  if (ttlSeconds > 0) {
    retrievalCache.set(key, {
      generation: retrievalGeneration,
      expiresAt: Date.now() + ttlSeconds * 1_000,
      result,
    });
  }
  return { result, cache_hit: false };
}

function embeddingCacheCount(): number {
  try {
    const cache = JSON.parse(fs.readFileSync(embeddingCachePath(), "utf-8")) as EmbeddingCache;
    return Object.keys(cache.entries || {}).length;
  } catch {
    return 0;
  }
}

function lastRebuiltAt(): string | null {
  try {
    const marker = JSON.parse(fs.readFileSync(rebuildMarkerPath(), "utf-8")) as { rebuilt_at?: unknown };
    return typeof marker.rebuilt_at === "string" ? marker.rebuilt_at : null;
  } catch {
    return null;
  }
}

export function getMemoryRetrievalIndexStatus(): MemoryRetrievalIndexStatus {
  const workspaceId = getActiveWorkspaceId() || "default";
  const indexed = executeLocalIndex({
    action: "status",
    workspace_id: workspaceId,
    principal_id: getActivePrincipalId() || "dev-user",
  });
  const embedding = memoryEmbeddingProviderStatus(embeddingCacheCount());
  return {
    schema_version: 1,
    retrieval: embedding.state === "ready" ? "hybrid_lexical_embedding_v1" : "hybrid_lexical_ngram_v1",
    workspace_id: workspaceId,
    journal_records: indexed.response.journal_records || 0,
    indexed_records: indexed.response.indexed_records || 0,
    active_records: indexed.response.active_records || 0,
    database_bytes: fs.existsSync(databasePath()) ? fs.statSync(databasePath()).size : 0,
    last_rebuilt_at: lastRebuiltAt(),
    embedding,
  };
}

export function memoryRetrievalPathsForTests(): {
  journal: string;
  database: string;
  embeddingCache: string;
} {
  return { journal: journalPath(), database: databasePath(), embeddingCache: embeddingCachePath() };
}
