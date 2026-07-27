import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  SkillCatalogSourceRecord,
  SkillEvaluationRecord,
  SkillLockfileRecord,
  SkillPackageStatus,
  SkillWorkspaceProfile,
} from "./types.js";
import { nowIso } from "./utils.js";

function encoded(value: string): string { return encodeURIComponent(value); }
function profilePath(workspaceId: string): string { return path.join(DATA_DIR, "skill-platform", "profiles", `${encoded(workspaceId)}.json`); }
function lockPath(workspaceId: string): string { return path.join(DATA_DIR, "skill-platform", "locks", `${encoded(workspaceId)}.json`); }
function sourcesDir(): string { return path.join(DATA_DIR, "skill-platform", "sources"); }
function evaluationsDir(workspaceId: string): string { return path.join(DATA_DIR, "skill-platform", "evaluations", encoded(workspaceId)); }

function readJson<T>(target: string): T | null {
  try { return getJsonStorageBackend().readJson<T>(target); } catch { return null; }
}

export function getSkillWorkspaceProfile(workspaceId: string): SkillWorkspaceProfile {
  const stored = readJson<SkillWorkspaceProfile>(profilePath(workspaceId));
  if (stored?.schema_version === 1 && stored.workspace_id === workspaceId) return stored;
  const timestamp = nowIso();
  return {
    schema_version: 1,
    workspace_id: workspaceId,
    auto_activation: true,
    enabled_categories: [],
    trusted_sources: ["bundled", "official", "workspace"],
    update_policy: "notify",
    pinned_versions: {},
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function updateSkillWorkspaceProfile(workspaceId: string, patch: Partial<SkillWorkspaceProfile>): SkillWorkspaceProfile {
  const current = getSkillWorkspaceProfile(workspaceId);
  const next: SkillWorkspaceProfile = {
    ...current,
    auto_activation: typeof patch.auto_activation === "boolean" ? patch.auto_activation : current.auto_activation,
    enabled_categories: Array.isArray(patch.enabled_categories) ? [...new Set(patch.enabled_categories.filter((item): item is string => typeof item === "string" && !!item.trim()))] : current.enabled_categories,
    trusted_sources: Array.isArray(patch.trusted_sources) ? [...new Set(patch.trusted_sources.filter((item) => ["bundled", "official", "workspace", "community", "unverified"].includes(String(item))))] as SkillWorkspaceProfile["trusted_sources"] : current.trusted_sources,
    update_policy: ["manual", "notify", "automatic_official"].includes(String(patch.update_policy)) ? patch.update_policy! : current.update_policy,
    pinned_versions: patch.pinned_versions && typeof patch.pinned_versions === "object" ? { ...patch.pinned_versions } : current.pinned_versions,
    updated_at: nowIso(),
  };
  getJsonStorageBackend().writeJson(profilePath(workspaceId), next);
  return next;
}

export function syncSkillLockfile(workspaceId: string, packages: SkillPackageStatus[]): SkillLockfileRecord {
  const current = readJson<SkillLockfileRecord>(lockPath(workspaceId));
  const timestamp = nowIso();
  const prior = new Map((current?.entries || []).map((item) => [item.skill_id, item]));
  const entries = packages.filter((item) => item.status === "ready").map((item) => {
    const manifestContent = fs.existsSync(item.manifest_path) ? fs.readFileSync(item.manifest_path) : Buffer.from("");
    const previous = prior.get(item.skill_id);
    return {
      skill_id: item.skill_id,
      version: item.version,
      source: item.source,
      trust_level: item.trust_level,
      instructions_digest: item.instructions_digest,
      manifest_digest: createHash("sha256").update(manifestContent).digest("hex"),
      locked_at: previous?.version === item.version && previous.instructions_digest === item.instructions_digest ? previous.locked_at : timestamp,
    };
  }).sort((left, right) => left.skill_id.localeCompare(right.skill_id));
  const record: SkillLockfileRecord = { schema_version: 1, workspace_id: workspaceId, entries, updated_at: timestamp };
  getJsonStorageBackend().writeJson(lockPath(workspaceId), record);
  return record;
}

export function getSkillLockfile(workspaceId: string): SkillLockfileRecord {
  return readJson<SkillLockfileRecord>(lockPath(workspaceId)) || { schema_version: 1, workspace_id: workspaceId, entries: [], updated_at: nowIso() };
}

export function listSkillCatalogSources(): SkillCatalogSourceRecord[] {
  return getJsonStorageBackend().listJsonFiles(sourcesDir()).map((file) => readJson<SkillCatalogSourceRecord>(file)).filter((item): item is SkillCatalogSourceRecord => !!item)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function upsertSkillCatalogSource(input: Partial<SkillCatalogSourceRecord> & { source_id: string; name: string; kind: SkillCatalogSourceRecord["kind"]; location: string }): SkillCatalogSourceRecord {
  const target = path.join(sourcesDir(), `${encoded(input.source_id)}.json`);
  const current = readJson<SkillCatalogSourceRecord>(target);
  const timestamp = nowIso();
  const record: SkillCatalogSourceRecord = {
    source_id: input.source_id,
    name: input.name,
    kind: input.kind,
    location: input.location,
    enabled: input.enabled !== false,
    trust_level: input.trust_level || "unverified",
    public_key: input.public_key || null,
    created_at: current?.created_at || timestamp,
    updated_at: timestamp,
  };
  getJsonStorageBackend().writeJson(target, record);
  return record;
}

export function recordSkillEvaluation(input: Omit<SkillEvaluationRecord, "evaluation_id" | "created_at">): SkillEvaluationRecord {
  const existingFile = input.invocation_id
    ? getJsonStorageBackend().listJsonFiles(evaluationsDir(input.workspace_id)).find((file) => {
        const existing = readJson<SkillEvaluationRecord>(file);
        return existing?.invocation_id === input.invocation_id;
      })
    : null;
  const existing = existingFile ? readJson<SkillEvaluationRecord>(existingFile) : null;
  const record: SkillEvaluationRecord = {
    ...input,
    evaluation_id: existing?.evaluation_id || `skilleval_${randomUUID()}`,
    created_at: existing?.created_at || nowIso(),
  };
  getJsonStorageBackend().writeJson(
    existingFile || path.join(evaluationsDir(input.workspace_id), `${record.evaluation_id}.json`),
    record,
  );
  return record;
}

export function listSkillEvaluations(workspaceId: string, skillId?: string): SkillEvaluationRecord[] {
  return getJsonStorageBackend().listJsonFiles(evaluationsDir(workspaceId)).map((file) => readJson<SkillEvaluationRecord>(file))
    .filter((item): item is SkillEvaluationRecord => !!item && (!skillId || item.skill_id === skillId))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function skillObservability(workspaceId: string, packages: SkillPackageStatus[]) {
  const evaluations = listSkillEvaluations(workspaceId);
  const bySkill = packages.map((item) => {
    const records = evaluations.filter((record) => record.skill_id === item.skill_id);
    const passed = records.filter((record) => record.verdict === "passed").length;
    const latencies = records.map((record) => record.latency_ms).filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
    return {
      skill_id: item.skill_id,
      version: item.version,
      status: item.status,
      evaluations: records.length,
      success_rate: records.length ? passed / records.length : null,
      p95_latency_ms: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null,
      recommendation: item.status !== "ready" ? "repair_requirements" : records.length === 0 ? "add_acceptance_fixture" : passed / records.length < 0.8 ? "review_skill_instructions" : "healthy",
    };
  });
  return { workspace_id: workspaceId, package_count: packages.length, evaluation_count: evaluations.length, skills: bySkill };
}
