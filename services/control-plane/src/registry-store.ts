import path from "node:path";
import { SKILLS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getActiveWorkspaceId } from "./request-security.js";
import type {
  RegistryStatus,
  SkillRecord,
  UpsertSkillRequest,
} from "./types.js";
import { ensureDir, isPlainObject, nowIso, slugify, writeJsonAtomic } from "./utils.js";
import { validateSkill } from "./validators.js";

function skillPath(skillId: string): string {
  return path.join(SKILLS_DIR, `${skillId}.json`);
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim()),
    ),
  ];
}

function normalizeStatus(value: unknown): RegistryStatus {
  return value === "disabled" ? "disabled" : "active";
}

function readJsonFile<T>(filePath: string): T {
  return getJsonStorageBackend().readJson<T>(filePath);
}

function listJsonFiles(dirPath: string): string[] {
  return getJsonStorageBackend().listJsonFiles(dirPath);
}

function assertValidSkill(skill: SkillRecord): void {
  const ok = validateSkill(skill);
  if (!ok) {
    const errorText =
      validateSkill.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ") ||
      "unknown schema error";
    throw new Error(`Skill validation failed: ${errorText}`);
  }
}

function resolveId(input: { explicitId?: string; name: string; fallback: string }): string {
  const explicit =
    typeof input.explicitId === "string" && input.explicitId.trim()
      ? slugify(input.explicitId)
      : "";
  return explicit || slugify(input.name) || input.fallback;
}

export function listSkills(status?: RegistryStatus): SkillRecord[] {
  const activeWorkspaceId = getActiveWorkspaceId();
  const skills = listJsonFiles(SKILLS_DIR)
    .map((file) => readJsonFile<SkillRecord>(file))
    .map((skill) => ({ ...skill, workspace_id: skill.workspace_id || "default" }))
    .filter((skill) => !activeWorkspaceId || skill.workspace_id === activeWorkspaceId);
  skills.sort((a, b) => a.skill_id.localeCompare(b.skill_id));
  return status ? skills.filter((skill) => skill.status === status) : skills;
}

export function getSkill(skillId: string): SkillRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = skillPath(skillId);
  if (!storage.exists(filePath)) {
    return null;
  }
  const skill = readJsonFile<SkillRecord>(filePath);
  const normalized = { ...skill, workspace_id: skill.workspace_id || "default" };
  const activeWorkspaceId = getActiveWorkspaceId();
  return activeWorkspaceId && normalized.workspace_id !== activeWorkspaceId ? null : normalized;
}

export function upsertSkill(input: UpsertSkillRequest): SkillRecord {
  ensureDir(SKILLS_DIR);
  const skillId = resolveId({
    explicitId: input.skill_id,
    name: input.name,
    fallback: "skill",
  });
  const existingSkillPath = skillPath(skillId);
  const activeWorkspaceId = getActiveWorkspaceId();
  if (getJsonStorageBackend().exists(existingSkillPath)) {
    const existing = readJsonFile<SkillRecord>(existingSkillPath);
    if (activeWorkspaceId && (existing.workspace_id || "default") !== activeWorkspaceId) {
      throw new Error("SKILL_ID_CONFLICT");
    }
  }
  const current = getSkill(skillId);
  const timestamp = nowIso();
  const skill: SkillRecord = {
    skill_id: skillId,
    workspace_id: getActiveWorkspaceId() || current?.workspace_id || "default",
    name: input.name,
    description: input.description || current?.description || "",
    category: input.category || current?.category || "general",
    allowed_tools: uniqueStrings(input.allowed_tools),
    input_schema: isPlainObject(input.input_schema) ? input.input_schema : current?.input_schema || {},
    output_contract: isPlainObject(input.output_contract)
      ? input.output_contract
      : current?.output_contract || {},
    tags: uniqueStrings(input.tags),
    status: normalizeStatus(input.status || current?.status),
    metadata: input.metadata || current?.metadata || {},
    created_at: current?.created_at || timestamp,
    updated_at: timestamp,
  };

  assertValidSkill(skill);
  writeJsonAtomic(skillPath(skill.skill_id), skill);
  return skill;
}

export function disableSkill(skillId: string): SkillRecord {
  const current = getSkill(skillId);
  if (!current) {
    throw new Error("SKILL_NOT_FOUND");
  }
  const next: SkillRecord = {
    ...current,
    status: "disabled",
    updated_at: nowIso(),
  };
  assertValidSkill(next);
  writeJsonAtomic(skillPath(next.skill_id), next);
  return next;
}
