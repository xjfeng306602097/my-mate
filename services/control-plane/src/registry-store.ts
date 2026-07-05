import fs from "node:fs";
import path from "node:path";
import { AGENT_PROFILES_DIR, SKILLS_DIR } from "./config.js";
import type {
  AgentProfileRecord,
  RegistryStatus,
  SkillRecord,
  UpsertAgentProfileRequest,
  UpsertSkillRequest,
} from "./types.js";
import { ensureDir, isPlainObject, nowIso, slugify, writeJsonAtomic } from "./utils.js";
import { validateAgentProfile, validateSkill } from "./validators.js";

function profilePath(profileId: string): string {
  return path.join(AGENT_PROFILES_DIR, `${profileId}.json`);
}

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
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function listJsonFiles(dirPath: string): string[] {
  ensureDir(dirPath);
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));
}

function assertValidProfile(profile: AgentProfileRecord): void {
  const ok = validateAgentProfile(profile);
  if (!ok) {
    const errorText =
      validateAgentProfile.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ") ||
      "unknown schema error";
    throw new Error(`Agent profile validation failed: ${errorText}`);
  }
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

export function listAgentProfiles(status?: RegistryStatus): AgentProfileRecord[] {
  const profiles = listJsonFiles(AGENT_PROFILES_DIR).map((file) =>
    readJsonFile<AgentProfileRecord>(file),
  );
  profiles.sort((a, b) => a.profile_id.localeCompare(b.profile_id));
  return status ? profiles.filter((profile) => profile.status === status) : profiles;
}

export function getAgentProfile(profileId: string): AgentProfileRecord | null {
  const filePath = profilePath(profileId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJsonFile<AgentProfileRecord>(filePath);
}

export function upsertAgentProfile(input: UpsertAgentProfileRequest): AgentProfileRecord {
  ensureDir(AGENT_PROFILES_DIR);
  const profileId = resolveId({
    explicitId: input.profile_id,
    name: input.name,
    fallback: "agent-profile",
  });
  const current = getAgentProfile(profileId);
  const timestamp = nowIso();
  const profile: AgentProfileRecord = {
    profile_id: profileId,
    name: input.name,
    description: input.description || current?.description || "",
    openclaw_agent_id: input.openclaw_agent_id.trim(),
    default_skills: uniqueStrings(input.default_skills),
    allowed_tools: uniqueStrings(input.allowed_tools),
    disallowed_skills: uniqueStrings(input.disallowed_skills),
    policy_tags: uniqueStrings(input.policy_tags),
    status: normalizeStatus(input.status || current?.status),
    metadata: input.metadata || current?.metadata || {},
    created_at: current?.created_at || timestamp,
    updated_at: timestamp,
  };

  assertValidProfile(profile);
  writeJsonAtomic(profilePath(profile.profile_id), profile);
  return profile;
}

export function disableAgentProfile(profileId: string): AgentProfileRecord {
  const current = getAgentProfile(profileId);
  if (!current) {
    throw new Error("AGENT_PROFILE_NOT_FOUND");
  }
  const next: AgentProfileRecord = {
    ...current,
    status: "disabled",
    updated_at: nowIso(),
  };
  assertValidProfile(next);
  writeJsonAtomic(profilePath(next.profile_id), next);
  return next;
}

export function listSkills(status?: RegistryStatus): SkillRecord[] {
  const skills = listJsonFiles(SKILLS_DIR).map((file) => readJsonFile<SkillRecord>(file));
  skills.sort((a, b) => a.skill_id.localeCompare(b.skill_id));
  return status ? skills.filter((skill) => skill.status === status) : skills;
}

export function getSkill(skillId: string): SkillRecord | null {
  const filePath = skillPath(skillId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJsonFile<SkillRecord>(filePath);
}

export function upsertSkill(input: UpsertSkillRequest): SkillRecord {
  ensureDir(SKILLS_DIR);
  const skillId = resolveId({
    explicitId: input.skill_id,
    name: input.name,
    fallback: "skill",
  });
  const current = getSkill(skillId);
  const timestamp = nowIso();
  const skill: SkillRecord = {
    skill_id: skillId,
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
