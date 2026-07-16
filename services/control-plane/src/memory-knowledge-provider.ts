import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MEMORY_KNOWLEDGE_INDEX_DIR, SERVICE_ROOT } from "./config.js";
import { getActivePrincipalId, getActiveWorkspaceId } from "./request-security.js";
import type {
  MemoryKnowledgeProviderStatus,
  MemoryKnowledgeQueryResult,
  MemoryKnowledgeRelation,
  MemoryRecord,
} from "./types.js";
import { getMemorySettings } from "./memory-settings-store.js";

interface DerivedTriple {
  subject: string;
  predicate: string;
  object: string;
  valid_from: string | null;
  valid_until: string | null;
  memory_id: string;
  memory_version: number;
  workspace_id: string;
  scope_kind: MemoryRecord["scope_kind"];
  scope_id: string;
  sensitivity: MemoryRecord["sensitivity"];
}

interface ProvenanceFile {
  schema_version: 1;
  triples: Record<string, DerivedTriple>;
}

let lastError: string | null = null;

function providerId(): "disabled" | "mempalace" {
  if (getMemorySettings().knowledge_graph.provider === "mempalace") return "mempalace";
  return (process.env.MY_MATE_MEMORY_KG_PROVIDER || "").trim().toLowerCase() === "mempalace"
    ? "mempalace"
    : "disabled";
}

function palacePath(): string | null {
  const configured = (getMemorySettings().knowledge_graph.palace_path || process.env.MY_MATE_MEMPALACE_PATH || "").trim();
  return configured ? path.resolve(configured) : null;
}

function syncEnabled(): boolean {
  const persisted = getMemorySettings().knowledge_graph;
  if (persisted.provider === "mempalace") return persisted.sync_canonical;
  return (process.env.MY_MATE_MEMPALACE_SYNC_CANONICAL || "false").trim().toLowerCase() === "true";
}

function detectPython(): string {
  const configured = (getMemorySettings().knowledge_graph.python_bin || process.env.MY_MATE_MEMPALACE_PYTHON || process.env.MY_MATE_STORAGE_PYTHON || "").trim();
  if (configured) return configured;
  const candidates = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf-8", windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  throw new Error("MemPalace requires a Python 3 interpreter.");
}

function helperPath(): string {
  return path.join(SERVICE_ROOT, "src", "mempalace-kg-helper.py");
}

function runHelper(input: Record<string, unknown>): Record<string, unknown> {
  const targetPath = palacePath();
  if (!targetPath) throw new Error("MY_MATE_MEMPALACE_PATH is required when the MemPalace provider is enabled.");
  const result = spawnSync(detectPython(), ["-X", "utf8", helperPath()], {
    encoding: "utf-8",
    input: JSON.stringify({ ...input, palace_path: targetPath }),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    timeout: Math.max(1_000, Number(process.env.MY_MATE_MEMPALACE_TIMEOUT_MS || 20_000)),
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim() || "MemPalace provider failed.");
  }
  const response = JSON.parse(result.stdout) as Record<string, unknown>;
  if (response.ok !== true) throw new Error(String(response.error || "MemPalace provider failed."));
  lastError = null;
  return response;
}

function provenancePath(): string {
  return path.join(MEMORY_KNOWLEDGE_INDEX_DIR, "mempalace-provenance.json");
}

function readProvenance(): ProvenanceFile {
  try {
    const value = JSON.parse(fs.readFileSync(provenancePath(), "utf-8")) as ProvenanceFile;
    if (value.schema_version === 1 && value.triples) return value;
  } catch {
    // Derived provenance is recreated by sync or rebuild.
  }
  return { schema_version: 1, triples: {} };
}

function writeProvenance(value: ProvenanceFile): void {
  fs.mkdirSync(MEMORY_KNOWLEDGE_INDEX_DIR, { recursive: true });
  const target = provenancePath();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  fs.renameSync(temporary, target);
}

function tripleKey(triple: Pick<DerivedTriple, "subject" | "predicate" | "object">): string {
  return JSON.stringify([triple.subject, triple.predicate, triple.object]);
}

function derivedTriple(record: MemoryRecord): DerivedTriple {
  return {
    subject: `${record.scope_kind}:${record.scope_id}`,
    predicate: `remembers:${record.kind}`,
    object: record.content,
    valid_from: record.valid_from || record.updated_at,
    valid_until: record.valid_until || record.expires_at,
    memory_id: record.memory_id,
    memory_version: record.version,
    workspace_id: record.workspace_id,
    scope_kind: record.scope_kind,
    scope_id: record.scope_id,
    sensitivity: record.sensitivity,
  };
}

function publicStatus(state: MemoryKnowledgeProviderStatus["state"]): MemoryKnowledgeProviderStatus {
  return {
    provider_id: providerId(),
    state,
    read_only: !syncEnabled(),
    palace_path: palacePath(),
    canonical_source: "my_mate_memory_records",
    last_error: lastError,
  };
}

export function getMemoryKnowledgeProviderStatus(probe = true): MemoryKnowledgeProviderStatus {
  if (providerId() === "disabled") return publicStatus("disabled");
  if (!palacePath()) {
    lastError = "MY_MATE_MEMPALACE_PATH is required when the MemPalace provider is enabled.";
    return publicStatus("unavailable");
  }
  if (!probe) return publicStatus(lastError ? "degraded" : "ready");
  try {
    runHelper({ action: "status" });
    return publicStatus("ready");
  } catch (error) {
    lastError = error instanceof Error ? error.message : "MemPalace provider is unavailable.";
    return publicStatus("unavailable");
  }
}

export function syncMemoryKnowledgeProvider(record: MemoryRecord): boolean {
  if (providerId() !== "mempalace" || !syncEnabled()) return false;
  try {
    const provenance = readProvenance();
    for (const [key, previous] of Object.entries(provenance.triples)) {
      if (previous.memory_id !== record.memory_id) continue;
      if (record.status !== "active" || previous.memory_version !== record.version) {
        runHelper({ action: "invalidate", triple: previous });
        delete provenance.triples[key];
      }
    }
    if (record.status === "active" && record.sensitivity === "normal") {
      const triple = derivedTriple(record);
      runHelper({ action: "sync", triple });
      provenance.triples[tripleKey(triple)] = triple;
    }
    writeProvenance(provenance);
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : "MemPalace synchronization failed.";
    return false;
  }
}

export function invalidatePrivateMemoryKnowledgeTriples(): number {
  if (providerId() !== "mempalace" || !palacePath()) return 0;
  const provenance = readProvenance();
  let invalidated = 0;
  try {
    for (const [key, triple] of Object.entries(provenance.triples)) {
      if (triple.sensitivity === "normal") continue;
      runHelper({ action: "invalidate", triple });
      delete provenance.triples[key];
      invalidated += 1;
    }
    writeProvenance(provenance);
    return invalidated;
  } catch (error) {
    lastError = error instanceof Error ? error.message : "MemPalace Private Memory invalidation failed.";
    return invalidated;
  }
}

function relationCandidates(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(relationCandidates);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = ["subject", "predicate", "object"].every((key) => typeof record[key] === "string")
    ? [record]
    : [];
  return [
    ...direct,
    ...Object.values(record).flatMap(relationCandidates),
  ];
}

export function queryMemoryKnowledgeGraph(input: { entity: string; asOf?: string | null; limit?: number }): MemoryKnowledgeQueryResult {
  const entity = input.entity.trim();
  const status = getMemoryKnowledgeProviderStatus(true);
  if (!entity || status.state === "disabled" || status.state === "unavailable") {
    return { provider: status, entity, count: 0, relations: [] };
  }
  try {
    const response = runHelper({ action: "query", entity, as_of: input.asOf || null });
    const provenance = readProvenance().triples;
    const workspaceId = getActiveWorkspaceId() || "default";
    const principalId = getActivePrincipalId() || "dev-user";
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit || 25)));
    const relations: MemoryKnowledgeRelation[] = relationCandidates(response.result)
      .map((record) => {
        const candidate = {
          subject: String(record.subject),
          predicate: String(record.predicate),
          object: String(record.object),
        };
        const source = provenance[tripleKey(candidate)];
        if (!source || source.workspace_id !== workspaceId) return null;
        if (source.scope_kind === "user" && source.scope_id !== principalId) return null;
        if (source.sensitivity === "restricted") return null;
        if (source.sensitivity === "private" && (source.scope_kind !== "user" || source.scope_id !== principalId)) return null;
        return {
          ...candidate,
          valid_from: typeof record.valid_from === "string" ? record.valid_from : source?.valid_from || null,
          valid_until: typeof record.valid_until === "string" ? record.valid_until : source?.valid_until || null,
          memory_id: source?.memory_id || null,
        };
      })
      .filter((relation): relation is MemoryKnowledgeRelation => Boolean(relation))
      .slice(0, limit);
    return { provider: getMemoryKnowledgeProviderStatus(false), entity, count: relations.length, relations };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "MemPalace query failed.";
    return { provider: publicStatus("degraded"), entity, count: 0, relations: [] };
  }
}

export function rebuildMemoryKnowledgeGraph(records: MemoryRecord[]): { attempted: number; synced: number; status: MemoryKnowledgeProviderStatus } {
  if (providerId() !== "mempalace" || !syncEnabled()) {
    return { attempted: 0, synced: 0, status: getMemoryKnowledgeProviderStatus(false) };
  }
  const previous = readProvenance();
  for (const triple of Object.values(previous.triples)) {
    try {
      runHelper({ action: "invalidate", triple });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "MemPalace rebuild invalidation failed.";
      return { attempted: 0, synced: 0, status: getMemoryKnowledgeProviderStatus(false) };
    }
  }
  fs.rmSync(provenancePath(), { force: true });
  let synced = 0;
  const eligible = records.filter((record) => record.status === "active" && record.sensitivity === "normal");
  for (const record of eligible) if (syncMemoryKnowledgeProvider(record)) synced += 1;
  return { attempted: eligible.length, synced, status: getMemoryKnowledgeProviderStatus(false) };
}

export function resetMemoryKnowledgeProviderStateForTests(): void {
  lastError = null;
}
