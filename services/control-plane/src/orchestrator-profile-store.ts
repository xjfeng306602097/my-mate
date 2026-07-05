import fs from "node:fs";
import path from "node:path";
import { ORCHESTRATOR_PROFILES_DIR } from "./config.js";
import type {
  OrchestratorProfileRecord,
  UpsertOrchestratorProfileRequest,
} from "./types.js";
import { ensureDir, isPlainObject, nowIso, slugify, writeJsonAtomic } from "./utils.js";

function profilePath(orchestratorId: string): string {
  return path.join(ORCHESTRATOR_PROFILES_DIR, `${orchestratorId}.json`);
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

function resolveId(input: { explicitId?: string; name: string; fallback: string }): string {
  const explicit =
    typeof input.explicitId === "string" && input.explicitId.trim()
      ? slugify(input.explicitId)
      : "";
  return explicit || slugify(input.name) || input.fallback;
}

export function listOrchestratorProfiles(): OrchestratorProfileRecord[] {
  const profiles = listJsonFiles(ORCHESTRATOR_PROFILES_DIR).map((file) =>
    readJsonFile<OrchestratorProfileRecord>(file),
  );
  profiles.sort((a, b) => a.orchestrator_id.localeCompare(b.orchestrator_id));
  return profiles;
}

export function getOrchestratorProfile(orchestratorId: string): OrchestratorProfileRecord | null {
  const filePath = profilePath(orchestratorId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJsonFile<OrchestratorProfileRecord>(filePath);
}

export function upsertOrchestratorProfile(
  input: UpsertOrchestratorProfileRequest,
): OrchestratorProfileRecord {
  ensureDir(ORCHESTRATOR_PROFILES_DIR);
  const orchestratorId = resolveId({
    explicitId: input.orchestrator_id,
    name: input.name,
    fallback: "orchestrator",
  });
  const current = getOrchestratorProfile(orchestratorId);
  const timestamp = nowIso();
  const profile: OrchestratorProfileRecord = {
    orchestrator_id: orchestratorId,
    name: input.name.trim(),
    provider: input.provider?.trim() || current?.provider || "",
    model: input.model?.trim() || current?.model || "",
    system_prompt: input.system_prompt?.trim() || current?.system_prompt || "",
    default_tools: uniqueStrings(input.default_tools ?? current?.default_tools),
    default_subagent_profile_ids: uniqueStrings(
      input.default_subagent_profile_ids ?? current?.default_subagent_profile_ids,
    ),
    planning_policy: isPlainObject(input.planning_policy)
      ? input.planning_policy
      : current?.planning_policy || {},
    handoff_policy: isPlainObject(input.handoff_policy)
      ? input.handoff_policy
      : current?.handoff_policy || {},
    metadata: isPlainObject(input.metadata) ? input.metadata : current?.metadata || {},
    created_at: current?.created_at || timestamp,
    updated_at: timestamp,
  };

  writeJsonAtomic(profilePath(profile.orchestrator_id), profile);
  return profile;
}
