import path from "node:path";
import { AGENT_PROFILES_DIR } from "./config.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { LegacyAgentProfileRecord, RegistryStatus } from "./types.js";

function normalizeStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
    : [];
}

function normalizeLegacyProfile(value: LegacyAgentProfileRecord): LegacyAgentProfileRecord {
  return {
    ...value,
    workspace_id: value.workspace_id || "default",
    description: value.description || "",
    provider_connection_id: value.provider_connection_id || null,
    default_skills: normalizeStrings(value.default_skills),
    allowed_tools: normalizeStrings(value.allowed_tools),
    disallowed_skills: normalizeStrings(value.disallowed_skills),
    policy_tags: normalizeStrings(value.policy_tags),
    status: value.status === "disabled" ? "disabled" : "active",
    metadata: value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata : {},
  };
}

/** Historical Agent Profile input for one-way migration into AgentDefinition. */
export function listLegacyAgentProfiles(status?: RegistryStatus): LegacyAgentProfileRecord[] {
  const storage = getJsonStorageBackend();
  const activeWorkspaceId = getActiveWorkspaceId();
  const profiles = storage.listJsonFiles(AGENT_PROFILES_DIR)
    .map((file) => normalizeLegacyProfile(storage.readJson<LegacyAgentProfileRecord>(file)))
    .filter((profile) => !activeWorkspaceId || profile.workspace_id === activeWorkspaceId)
    .sort((left, right) => left.profile_id.localeCompare(right.profile_id));
  return status ? profiles.filter((profile) => profile.status === status) : profiles;
}

export function getLegacyAgentProfile(profileId: string): LegacyAgentProfileRecord | null {
  const storage = getJsonStorageBackend();
  const target = path.join(AGENT_PROFILES_DIR, `${profileId}.json`);
  if (!storage.exists(target)) return null;
  const profile = normalizeLegacyProfile(storage.readJson<LegacyAgentProfileRecord>(target));
  const activeWorkspaceId = getActiveWorkspaceId();
  return activeWorkspaceId && profile.workspace_id !== activeWorkspaceId ? null : profile;
}
