import path from "node:path";
import { ORCHESTRATOR_PROFILES_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getActiveWorkspaceId } from "./request-security.js";
import type {
  OrchestratorProfileRecord,
} from "./types.js";
import { getPublishedAgentVersion, upsertAgentDefinition } from "./agent-runtime-store.js";

function profilePath(orchestratorId: string): string {
  return path.join(ORCHESTRATOR_PROFILES_DIR, `${orchestratorId}.json`);
}

function readJsonFile<T>(filePath: string): T {
  return getJsonStorageBackend().readJson<T>(filePath);
}

function listJsonFiles(dirPath: string): string[] {
  return getJsonStorageBackend().listJsonFiles(dirPath);
}

function ensureOrchestratorAgent(profile: OrchestratorProfileRecord): void {
  const published = getPublishedAgentVersion(profile.orchestrator_id, profile.workspace_id || "default");
  if (published?.metadata?.orchestrator_profile_updated_at === profile.updated_at) return;
  const providerConnectionId = typeof profile.metadata.provider_connection_id === "string" ? profile.metadata.provider_connection_id : null;
  upsertAgentDefinition({ workspaceId: profile.workspace_id || "default", agentId: profile.orchestrator_id, name: profile.name, description: "Main Agent migrated from OrchestratorProfile.", createdBy: "orchestrator-profile-migration", version: { role: "orchestrator", system_prompt: profile.system_prompt, model_policy: { deployment_id: null, provider_connection_id: providerConnectionId, model: profile.model || null, allow_runtime_override: true }, tool_policy: { allowed_tools: profile.default_tools, denied_tools: [], max_tool_rounds: null }, metadata: { migrated_from: "orchestrator_profile", orchestrator_id: profile.orchestrator_id, orchestrator_profile_updated_at: profile.updated_at, preferred_agent_ids: profile.default_subagent_profile_ids, planning_policy: profile.planning_policy, handoff_policy: profile.handoff_policy } } });
}

export function listOrchestratorProfiles(): OrchestratorProfileRecord[] {
  const activeWorkspaceId = getActiveWorkspaceId();
  const profiles = listJsonFiles(ORCHESTRATOR_PROFILES_DIR)
    .map((file) => readJsonFile<OrchestratorProfileRecord>(file))
    .map((profile) => ({ ...profile, workspace_id: profile.workspace_id || "default" }))
    .filter((profile) => !activeWorkspaceId || profile.workspace_id === activeWorkspaceId);
  profiles.sort((a, b) => a.orchestrator_id.localeCompare(b.orchestrator_id));
  for (const profile of profiles) ensureOrchestratorAgent(profile);
  return profiles;
}

export function getOrchestratorProfile(orchestratorId: string): OrchestratorProfileRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = profilePath(orchestratorId);
  if (!storage.exists(filePath)) {
    return null;
  }
  const profile = readJsonFile<OrchestratorProfileRecord>(filePath);
  const normalized = { ...profile, workspace_id: profile.workspace_id || "default" };
  const activeWorkspaceId = getActiveWorkspaceId();
  if (activeWorkspaceId && normalized.workspace_id !== activeWorkspaceId) return null;
  ensureOrchestratorAgent(normalized);
  return normalized;
}
