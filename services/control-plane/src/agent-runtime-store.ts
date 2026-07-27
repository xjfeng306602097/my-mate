import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  AGENT_BINDING_SNAPSHOTS_DIR,
  AGENT_DEFINITIONS_DIR,
  AGENT_PROFILES_DIR,
  AGENT_RUNS_DIR,
  AGENT_VERSIONS_DIR,
  MODEL_DEPLOYMENTS_DIR,
  PROVIDER_DEFINITIONS_DIR,
} from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getLegacyAgentProfile, listLegacyAgentProfiles } from "./legacy-agent-profile-store.js";
import { getProviderConnection, listProviderConnections, providerConnectionStatus } from "./provider-connection-store.js";
import { getSkillHost } from "./skill-host.js";
import type {
  AgentAutonomyMode,
  AgentBindingMode,
  AgentBindingSnapshot,
  AgentDefinitionRecord,
  AgentRunRecord,
  AgentRunKind,
  AgentRunStatus,
  AgentVersionRecord,
  ModelDeploymentRecord,
  ProviderDefinitionRecord,
  ProviderConnectionRecord,
} from "./types.js";
import { nowIso, slugify } from "./utils.js";
import {
  AGENT_RUN_LIFECYCLE,
  assertLifecycleTransition,
  parseLifecycleStatus,
} from "@my-mate/shared-types/domain-lifecycle";
import { assertSchemaValid, validateAgentRun } from "./validators.js";

const storage = () => getJsonStorageBackend();
const file = (dir: string, id: string) => path.join(dir, `${encodeURIComponent(id)}.json`);
const versionFile = (agentId: string, version: number) => path.join(AGENT_VERSIONS_DIR, encodeURIComponent(agentId), `${version}.json`);
const legacyRegistryMigrationsInProgress = new Set<string>();
const normalizeStrings = (items: unknown): string[] => Array.isArray(items)
  ? [...new Set(items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
  : [];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function providerConnectionModels(connection: ProviderConnectionRecord): string[] {
  return normalizeStrings([connection.default_model, ...connection.models]);
}

function validateAgentProviderBinding(
  connection: ProviderConnectionRecord | null,
  workspaceId: string,
  model: string | null | undefined,
): asserts connection is ProviderConnectionRecord {
  if (!connection || connection.status !== "active" || (connection.workspace_id || "default") !== workspaceId) {
    throw Object.assign(new Error("The selected Provider Connection is unavailable for this Workspace."), {
      code: "agent_provider_unavailable",
    });
  }
  if (connection.verification?.status !== "verified") {
    throw Object.assign(new Error(`Provider Connection ${connection.connection_id} must be verified before it can be assigned to an Agent.`), {
      code: "agent_provider_unverified",
    });
  }
  if (!providerConnectionStatus(connection).credential_configured) {
    throw Object.assign(new Error(`Provider Connection ${connection.connection_id} has no configured credential.`), {
      code: "agent_provider_credential_missing",
    });
  }
  if (!model) {
    throw Object.assign(new Error(`Select a model from Provider Connection ${connection.connection_id}.`), {
      code: "agent_model_required",
    });
  }
  if (!providerConnectionModels(connection).includes(model)) {
    throw Object.assign(new Error(`Model ${model} is not available from Provider Connection ${connection.connection_id}.`), {
      code: "agent_model_unavailable",
    });
  }
}

function normalizeAgentMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const legacy = metadata as Record<string, unknown>;
  const { default_subagent_profile_ids: legacyPreferredAgentIds, ...canonical } = legacy;
  const hasCanonicalPreferredAgents = Array.isArray(canonical.preferred_agent_ids);
  const hasLegacyPreferredAgents = Array.isArray(legacyPreferredAgentIds);
  return {
    ...canonical,
    ...(hasCanonicalPreferredAgents || hasLegacyPreferredAgents
      ? {
          preferred_agent_ids: hasCanonicalPreferredAgents
            ? normalizeStrings(canonical.preferred_agent_ids)
            : normalizeStrings(legacyPreferredAgentIds),
        }
      : {}),
  };
}

export function normalizeAgentBindingSnapshot(snapshot: AgentBindingSnapshot): AgentBindingSnapshot {
  const { snapshot_digest: _legacyDigest, ...source } = snapshot;
  const runtimePolicy = snapshot.runtime_policy as AgentBindingSnapshot["runtime_policy"] & { runtime?: unknown; sandbox?: unknown; timeout_seconds?: unknown };
  const normalized = {
    ...source,
    agent_role: snapshot.agent_role || (snapshot.agent_id === "default-agent" ? "orchestrator" : "worker"),
    runtime_policy: {
      runtime: "native" as const,
      sandbox: runtimePolicy?.sandbox === "local" || runtimePolicy?.sandbox === "docker" || runtimePolicy?.sandbox === "isolated" || runtimePolicy?.sandbox === "auto"
        ? runtimePolicy.sandbox
        : "auto",
      timeout_seconds: typeof runtimePolicy?.timeout_seconds === "number" && Number.isFinite(runtimePolicy.timeout_seconds)
        ? runtimePolicy.timeout_seconds
        : 1800,
    },
  } satisfies Omit<AgentBindingSnapshot, "snapshot_digest">;
  return { ...normalized, snapshot_digest: digest(normalized) };
}

function normalizeAgentRun(run: AgentRunRecord): AgentRunRecord {
  const normalized = {
    ...run,
    status: parseLifecycleStatus(AGENT_RUN_LIFECYCLE, run.status),
    binding_snapshot: normalizeAgentBindingSnapshot(run.binding_snapshot),
  };
  assertSchemaValid(validateAgentRun, normalized, "AgentRun");
  return normalized;
}

const LEGACY_SKILL_ALIASES: Record<string, string[]> = {
  "acceptance-research": ["web-research"],
  "acceptance-review": ["code-review"],
  "acceptance-writing": ["artifact-document"],
  "coding-agent": ["artifact-code", "test-driven-development"],
  "copy-writing": ["artifact-document"],
  "visual-design": ["artifact-presentation"],
  "customer-followup": ["artifact-document"],
  "ops-runbook": ["systematic-debugging", "desktop-diagnostics"],
  "release-approval": ["code-review"],
  "competitive-research": ["web-research"],
  web: ["web-research"],
};

const LEGACY_TOOL_ALIASES: Record<string, string[]> = {
  read: ["workspace_list", "workspace_read_text", "workspace_search"],
  write: ["workspace_apply_operations"],
  shell: ["workspace_run_command"],
  web: ["web_search", "web_fetch"],
};

function normalizedAgentTools(items: unknown): string[] {
  return [...new Set(normalizeStrings(items).flatMap((item) => LEGACY_TOOL_ALIASES[item] || [item]))];
}

function normalizedAgentSkills(items: unknown): AgentVersionRecord["skill_policy"]["locked_skills"] {
  const normalized = Array.isArray(items) ? items.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ skill_id: item.trim(), version: null }];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return typeof record.skill_id === "string" && record.skill_id.trim()
      ? [{ skill_id: record.skill_id.trim(), version: typeof record.version === "string" && record.version.trim() ? record.version.trim() : null }]
      : [];
  }) : [];
  const expanded = normalized.flatMap((item) => (LEGACY_SKILL_ALIASES[item.skill_id] || [item.skill_id]).map((skillId) => ({
    skill_id: skillId,
    version: item.version,
  })));
  return [...new Map(expanded.map((item) => [`${item.skill_id}@${item.version || "latest"}`, item])).values()];
}

function migratedAgentRole(agentId: string, current: AgentVersionRecord["role"]): AgentVersionRecord["role"] {
  if (agentId === "default-agent") return "orchestrator";
  if (["acceptance-review-agent", "release-approver"].includes(agentId)) return "reviewer";
  if (["research-analyst", "ops-runner"].includes(agentId)) return "specialist";
  return current || "worker";
}

function unavailableLockedSkills(workspaceId: string, skills: AgentVersionRecord["skill_policy"]["locked_skills"]): string[] {
  const ready = new Set(getSkillHost().listPackages(workspaceId).filter((item) => item.enabled && item.status === "ready").map((item) => item.skill_id));
  return skills.map((item) => item.skill_id).filter((skillId) => !ready.has(skillId));
}

function validateLockedSkills(workspaceId: string, skills: AgentVersionRecord["skill_policy"]["locked_skills"]): void {
  const missing = unavailableLockedSkills(workspaceId, skills);
  if (missing.length) {
    throw Object.assign(new Error(`Locked Skills are unavailable: ${missing.join(", ")}.`), {
      code: "agent_skill_unavailable",
      missing_skills: missing,
    });
  }
}

function read<T>(target: string): T | null {
  return storage().exists(target) ? storage().readJson<T>(target) : null;
}
function write<T>(target: string, value: T): T {
  storage().writeJson(target, value);
  return value;
}

function providerDefinitionFromConnection(connection: ProviderConnectionRecord): ProviderDefinitionRecord {
  return {
    provider_id: `provider_${slugify(connection.provider || connection.name || connection.connection_id)}`,
    workspace_id: connection.workspace_id || "default",
    name: connection.provider || connection.name,
    protocol: connection.protocol,
    provider_family: connection.provider || "custom",
    capabilities: ["chat", "streaming", ...(connection.max_tool_rounds > 0 ? ["tools"] : [])],
    status: connection.status,
    metadata: { source: "provider-connection", connection_id: connection.connection_id },
    created_at: connection.created_at,
    updated_at: connection.updated_at,
  };
}

function deploymentFromConnection(connection: ProviderConnectionRecord, provider: ProviderDefinitionRecord, model: string): ModelDeploymentRecord {
  const revision = digest({ updated_at: connection.updated_at, status: connection.status, model, max_input_tokens: connection.max_input_tokens, max_output_tokens: connection.max_output_tokens });
  return {
    deployment_id: `deployment_${connection.connection_id}_${slugify(model)}`,
    workspace_id: connection.workspace_id || "default",
    provider_id: provider.provider_id,
    connection_id: connection.connection_id,
    model,
    display_name: `${connection.name} / ${model}`,
    modalities: ["text"],
    context_window: connection.max_input_tokens,
    max_output_tokens: connection.max_output_tokens,
    supports_tools: connection.max_tool_rounds > 0,
    supports_streaming: true,
    status: connection.status,
    connection_revision: revision,
    metadata: { source: "provider-connection" },
    created_at: connection.created_at,
    updated_at: connection.updated_at,
  };
}

type LegacyAgentSeed = Pick<NonNullable<ReturnType<typeof getLegacyAgentProfile>>,
  "profile_id" | "description" | "provider_connection_id" | "default_skills" | "allowed_tools" |
  "disallowed_skills" | "policy_tags" | "created_at" | "updated_at">;

function defaultVersion(profile: LegacyAgentSeed | null, workspaceId: string, version = 1, agentId = "default-agent"): AgentVersionRecord {
  const profileValue = profile || {
    profile_id: agentId,
    description: "",
    provider_connection_id: null,
    default_skills: [],
    allowed_tools: [],
    disallowed_skills: [],
    policy_tags: [],
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  return {
    agent_id: profileValue.profile_id,
    workspace_id: workspaceId,
    version,
    status: "published",
    role: profileValue.profile_id === "default-agent" ? "orchestrator" : "worker",
    responsibility: profileValue.description || "Complete focused delegated work and return verifiable results.",
    system_prompt: "You are a reliable My Mate task agent. Complete the user's objective using available tools and report verified results.",
    model_policy: { deployment_id: null, provider_connection_id: profileValue.provider_connection_id || null, model: null, allow_runtime_override: true, routing_preference: "balanced", fallback_models: [], allow_model_escalation: true },
    capability_policy: { capability_tags: [], allow_delegation: profileValue.profile_id === "default-agent", input_contract: {}, output_contract: {}, acceptance_criteria: ["Return a complete result with verifiable evidence."], verification_steps: [] },
    tool_policy: { allowed_tools: normalizedAgentTools(profileValue.allowed_tools), denied_tools: [], max_tool_rounds: null },
    skill_policy: {
      locked_skills: normalizedAgentSkills(normalizeStrings(profileValue.default_skills).map((skill_id) => ({ skill_id, version: null }))),
      denied_skills: normalizeStrings(profileValue.disallowed_skills),
      dynamic_activation: true,
    },
    memory_policy: { enabled: true, automatic_recall: true, write_mode: "review" },
    context_policy: { compression_enabled: true, compression_threshold_percent: 80, max_continuation_rounds: null },
    runtime_policy: { runtime: "native", sandbox: "auto", timeout_seconds: 1800 },
    workspace_policy: { read: true, write: true, allowed_project_ids: [] },
    autonomy_ceiling: profileValue.policy_tags.includes("autopilot") ? "autopilot" : "assisted",
    artifact_policy: {},
    delivery_policy: {},
    metadata: profile
      ? { migrated_from: "agent_profile", profile_id: profileValue.profile_id, capability_policy_migration: "canonical_v1" }
      : { runtime: "native", capability_policy_migration: "canonical_v1" },
    created_by: profile ? "migration" : "system",
    created_at: profileValue.created_at,
    published_at: profileValue.updated_at,
  };
}

/** Project legacy Connections/Profiles into the versioned runtime registry. Idempotent by design. */
export function migrateLegacyAgentRegistry(workspaceId = "default"): { providers: number; deployments: number; agents: number } {
  const migrationKey = `${path.resolve(AGENT_DEFINITIONS_DIR)}\0${workspaceId}`;
  if (legacyRegistryMigrationsInProgress.has(migrationKey)) {
    return { providers: 0, deployments: 0, agents: 0 };
  }
  legacyRegistryMigrationsInProgress.add(migrationKey);
  try {
    let providers = 0; let deployments = 0; let agents = 0;
    for (const connection of listProviderConnections("active")) {
      if ((connection.workspace_id || "default") !== workspaceId) continue;
      const provider = providerDefinitionFromConnection(connection);
      if (!read<ProviderDefinitionRecord>(file(PROVIDER_DEFINITIONS_DIR, provider.provider_id))) { write(file(PROVIDER_DEFINITIONS_DIR, provider.provider_id), provider); providers += 1; }
      for (const model of normalizeStrings(connection.models.length ? connection.models : [connection.default_model])) {
        const deployment = deploymentFromConnection(connection, provider, model);
        if (!read<ModelDeploymentRecord>(file(MODEL_DEPLOYMENTS_DIR, deployment.deployment_id))) { write(file(MODEL_DEPLOYMENTS_DIR, deployment.deployment_id), deployment); deployments += 1; }
      }
    }
    for (const profile of listLegacyAgentProfiles()) {
      if ((profile.workspace_id || "default") !== workspaceId) continue;
      const definitionPath = file(AGENT_DEFINITIONS_DIR, profile.profile_id);
      const current = read<AgentDefinitionRecord>(definitionPath);
      if (!current) {
        const timestamp = profile.created_at || nowIso();
        const definition: AgentDefinitionRecord = { agent_id: profile.profile_id, workspace_id: workspaceId, name: profile.name, description: profile.description, latest_version: 1, published_version: 1, status: profile.status, metadata: { migrated_from: "agent_profile" }, created_at: timestamp, updated_at: profile.updated_at || timestamp };
        write(definitionPath, definition);
        write(versionFile(profile.profile_id, 1), defaultVersion(profile, workspaceId));
        agents += 1;
      } else {
        const published = current.published_version ? read<AgentVersionRecord>(versionFile(current.agent_id, current.published_version)) : null;
        if (published?.metadata?.migrated_from === "agent_profile" && published.metadata.capability_policy_migration !== "canonical_v1") {
          published.tool_policy = {
            ...published.tool_policy,
            allowed_tools: normalizedAgentTools(published.tool_policy.allowed_tools),
            denied_tools: normalizedAgentTools(published.tool_policy.denied_tools),
          };
        published.skill_policy = {
          ...published.skill_policy,
          locked_skills: normalizedAgentSkills(published.skill_policy.locked_skills),
          denied_skills: normalizeStrings(published.skill_policy.denied_skills),
          };
          published.role = migratedAgentRole(published.agent_id, published.role);
          published.metadata = { ...published.metadata, capability_policy_migration: "canonical_v1" };
          write(versionFile(published.agent_id, published.version), published);
        }
      }
    }
    return { providers, deployments, agents };
  } finally {
    legacyRegistryMigrationsInProgress.delete(migrationKey);
  }
}

export function getAgentDefinition(agentId: string, workspaceId = "default"): AgentDefinitionRecord | null {
  migrateLegacyAgentRegistry(workspaceId);
  const item = read<AgentDefinitionRecord>(file(AGENT_DEFINITIONS_DIR, agentId));
  return item && item.workspace_id === workspaceId ? item : null;
}
export function listAgentDefinitions(workspaceId = "default"): AgentDefinitionRecord[] {
  migrateLegacyAgentRegistry(workspaceId);
  return storage().listJsonFiles(AGENT_DEFINITIONS_DIR).map((item) => read<AgentDefinitionRecord>(item)).filter((item): item is AgentDefinitionRecord => !!item && item.workspace_id === workspaceId).sort((a, b) => a.name.localeCompare(b.name));
}
export function getAgentVersion(agentId: string, version: number, workspaceId = "default"): AgentVersionRecord | null {
  const item = read<AgentVersionRecord>(versionFile(agentId, version));
  return item && item.workspace_id === workspaceId
    ? {
        ...item,
        role: item.role || (item.agent_id === "default-agent" ? "orchestrator" : "worker"),
        responsibility: item.responsibility || "Complete focused delegated work and return verifiable results.",
        model_policy: {
          ...item.model_policy,
          routing_preference: item.model_policy.routing_preference || "balanced",
          fallback_models: normalizeStrings(item.model_policy.fallback_models),
          allow_model_escalation: item.model_policy.allow_model_escalation !== false,
        },
        capability_policy: item.capability_policy || {
          capability_tags: normalizeStrings(item.metadata?.capability_tags),
          allow_delegation: item.agent_id === "default-agent",
          input_contract: {},
          output_contract: {},
          acceptance_criteria: [],
          verification_steps: [],
        },
        skill_policy: {
          ...item.skill_policy,
          locked_skills: normalizedAgentSkills(item.skill_policy.locked_skills),
          denied_skills: normalizeStrings(item.skill_policy.denied_skills),
        },
        runtime_policy: {
          runtime: "native",
          sandbox: item.runtime_policy?.sandbox === "local" || item.runtime_policy?.sandbox === "docker" || item.runtime_policy?.sandbox === "isolated" || item.runtime_policy?.sandbox === "auto"
            ? item.runtime_policy.sandbox
            : "auto",
          timeout_seconds: typeof item.runtime_policy?.timeout_seconds === "number"
            ? item.runtime_policy.timeout_seconds
            : 1800,
        },
        metadata: normalizeAgentMetadata(item.metadata),
      }
    : null;
}
export function getPublishedAgentVersion(agentId: string, workspaceId = "default"): AgentVersionRecord | null {
  const definition = getAgentDefinition(agentId, workspaceId);
  return definition?.published_version ? getAgentVersion(agentId, definition.published_version, workspaceId) : null;
}

export interface AgentVersionReadiness {
  state: "ready" | "blocked";
  issues: string[];
  missing_skills: string[];
  missing_tools: string[];
  provider_connection_id: string | null;
  model: string | null;
}

export function evaluateAgentVersionReadiness(
  version: AgentVersionRecord,
  options: { workspaceId?: string; availableToolNames?: Iterable<string> } = {},
): AgentVersionReadiness {
  const workspaceId = options.workspaceId || version.workspace_id || "default";
  const missingSkills = unavailableLockedSkills(workspaceId, version.skill_policy.locked_skills);
  const availableTools = options.availableToolNames ? new Set(options.availableToolNames) : null;
  const missingTools = availableTools
    ? version.tool_policy.allowed_tools.filter((tool) => !availableTools.has(tool))
    : [];
  const activeConnections = listProviderConnections("active")
    .filter((connection) => (connection.workspace_id || "default") === workspaceId);
  const connection = version.model_policy.provider_connection_id
    ? activeConnections.find((item) => item.connection_id === version.model_policy.provider_connection_id) || null
    : activeConnections[0] || null;
  const model = version.model_policy.model || connection?.default_model || connection?.models[0] || null;
  const credentialConfigured = connection ? providerConnectionStatus(connection).credential_configured : false;
  const issues = [
    ...missingSkills.map((skillId) => `Missing Skill: ${skillId}`),
    ...missingTools.map((tool) => `Missing tool: ${tool}`),
    ...(!connection ? ["No active Provider Connection"] : []),
    ...(connection && connection.verification?.status !== "verified" ? ["Provider Connection is not verified"] : []),
    ...(connection && !credentialConfigured ? ["Provider credential is not configured"] : []),
    ...(connection && !model ? ["No model is available"] : []),
    ...(connection && model && !providerConnectionModels(connection).includes(model) ? [`Configured model is unavailable: ${model}`] : []),
  ];
  return {
    state: issues.length ? "blocked" : "ready",
    issues,
    missing_skills: missingSkills,
    missing_tools: missingTools,
    provider_connection_id: connection?.connection_id || null,
    model,
  };
}

export function upsertAgentDefinition(input: {
  workspaceId?: string;
  agentId?: string;
  name: string;
  description?: string;
  version?: Partial<AgentVersionRecord>;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}): { definition: AgentDefinitionRecord; version: AgentVersionRecord } {
  const workspaceId = input.workspaceId || "default";
  const agentId = slugify(input.agentId || input.name) || `agent_${randomUUID()}`;
  const timestamp = nowIso();
  const storedDefinition = read<AgentDefinitionRecord>(file(AGENT_DEFINITIONS_DIR, agentId));
  if (storedDefinition && storedDefinition.workspace_id !== workspaceId) {
    throw Object.assign(new Error(`Agent ID ${agentId} belongs to another Workspace.`), {
      code: "agent_id_conflict",
    });
  }
  const current = getAgentDefinition(agentId, workspaceId);
  const versionNumber = current ? current.latest_version + 1 : 1;
  const previousVersion = current?.published_version
    ? getAgentVersion(agentId, current.published_version, workspaceId)
    : null;
  const base = previousVersion
    ? { ...previousVersion, version: versionNumber, status: "published" as const, published_at: timestamp }
    : defaultVersion(null, workspaceId, versionNumber, agentId);
  const requested = input.version || {};
  const requestedModelPolicy = requested.model_policy && typeof requested.model_policy === "object" ? requested.model_policy as Record<string, unknown> : {};
  const requestedCapabilityPolicy = requested.capability_policy && typeof requested.capability_policy === "object" ? requested.capability_policy as Record<string, unknown> : {};
  const requestedToolPolicy = requested.tool_policy && typeof requested.tool_policy === "object" ? requested.tool_policy as Record<string, unknown> : {};
  const requestedSkillPolicy = requested.skill_policy && typeof requested.skill_policy === "object" ? requested.skill_policy as Record<string, unknown> : {};
  const requestedMemoryPolicy = requested.memory_policy && typeof requested.memory_policy === "object" ? requested.memory_policy as Record<string, unknown> : {};
  const requestedContextPolicy = requested.context_policy && typeof requested.context_policy === "object" ? requested.context_policy as Record<string, unknown> : {};
  const requestedRuntimePolicy = requested.runtime_policy && typeof requested.runtime_policy === "object" ? requested.runtime_policy as Record<string, unknown> : {};
  const requestedWorkspacePolicy = requested.workspace_policy && typeof requested.workspace_policy === "object" ? requested.workspace_policy as Record<string, unknown> : {};
  const version: AgentVersionRecord = {
    ...base,
    responsibility: typeof requested.responsibility === "string" ? requested.responsibility.trim().slice(0, 4_000) : base.responsibility,
    system_prompt: typeof requested.system_prompt === "string" ? requested.system_prompt.slice(0, 64_000) : base.system_prompt,
    model_policy: {
      ...base.model_policy,
      ...requestedModelPolicy,
      routing_preference: ["quality", "balanced", "cost", "latency"].includes(String(requestedModelPolicy.routing_preference))
        ? requestedModelPolicy.routing_preference as NonNullable<AgentVersionRecord["model_policy"]["routing_preference"]>
        : base.model_policy.routing_preference,
      fallback_models: normalizeStrings(requestedModelPolicy.fallback_models),
      allow_model_escalation: requestedModelPolicy.allow_model_escalation !== false,
    },
    capability_policy: {
      ...(base.capability_policy || { capability_tags: [], allow_delegation: false, input_contract: {}, output_contract: {}, acceptance_criteria: [], verification_steps: [] }),
      ...requestedCapabilityPolicy,
      capability_tags: normalizeStrings(requestedCapabilityPolicy.capability_tags),
      allow_delegation: requestedCapabilityPolicy.allow_delegation === true,
      input_contract: requestedCapabilityPolicy.input_contract && typeof requestedCapabilityPolicy.input_contract === "object" && !Array.isArray(requestedCapabilityPolicy.input_contract) ? requestedCapabilityPolicy.input_contract as Record<string, unknown> : {},
      output_contract: requestedCapabilityPolicy.output_contract && typeof requestedCapabilityPolicy.output_contract === "object" && !Array.isArray(requestedCapabilityPolicy.output_contract) ? requestedCapabilityPolicy.output_contract as Record<string, unknown> : {},
      acceptance_criteria: normalizeStrings(requestedCapabilityPolicy.acceptance_criteria),
      verification_steps: normalizeStrings(requestedCapabilityPolicy.verification_steps),
    },
    tool_policy: { ...base.tool_policy, ...requestedToolPolicy, allowed_tools: normalizedAgentTools(requestedToolPolicy.allowed_tools), denied_tools: normalizedAgentTools(requestedToolPolicy.denied_tools) },
    skill_policy: {
      ...base.skill_policy,
      ...requestedSkillPolicy,
      locked_skills: normalizedAgentSkills(Array.isArray(requestedSkillPolicy.locked_skills) ? requestedSkillPolicy.locked_skills as AgentVersionRecord["skill_policy"]["locked_skills"] : base.skill_policy.locked_skills),
      denied_skills: normalizeStrings(requestedSkillPolicy.denied_skills ?? base.skill_policy.denied_skills),
    },
    memory_policy: { ...base.memory_policy, ...requestedMemoryPolicy },
    context_policy: { ...base.context_policy, ...requestedContextPolicy },
    runtime_policy: {
      runtime: "native",
      sandbox: requestedRuntimePolicy.sandbox === "local" || requestedRuntimePolicy.sandbox === "docker" || requestedRuntimePolicy.sandbox === "isolated" || requestedRuntimePolicy.sandbox === "auto"
        ? requestedRuntimePolicy.sandbox
        : base.runtime_policy.sandbox,
      timeout_seconds: typeof requestedRuntimePolicy.timeout_seconds === "number"
        ? requestedRuntimePolicy.timeout_seconds
        : base.runtime_policy.timeout_seconds,
    },
    workspace_policy: { ...base.workspace_policy, ...requestedWorkspacePolicy, allowed_project_ids: normalizeStrings(requestedWorkspacePolicy.allowed_project_ids) },
    autonomy_ceiling: requested.autonomy_ceiling === "review_first" || requested.autonomy_ceiling === "assisted" || requested.autonomy_ceiling === "autopilot" ? requested.autonomy_ceiling : base.autonomy_ceiling,
    metadata: requested.metadata && typeof requested.metadata === "object" && !Array.isArray(requested.metadata)
      ? { ...normalizeAgentMetadata(base.metadata), ...normalizeAgentMetadata(requested.metadata) }
      : normalizeAgentMetadata(base.metadata),
    agent_id: agentId,
    workspace_id: workspaceId,
    version: versionNumber,
    status: "published",
    role: requested.role === "orchestrator" || requested.role === "supervisor" || requested.role === "reviewer" || requested.role === "specialist" ? requested.role : requested.role === "worker" ? "worker" : base.role,
    created_by: input.createdBy || "user",
    created_at: timestamp,
    published_at: timestamp,
  };
  const definition: AgentDefinitionRecord = {
    agent_id: agentId,
    workspace_id: workspaceId,
    name: input.name.trim().slice(0, 160),
    description: input.description?.trim().slice(0, 2_000) || "",
    latest_version: versionNumber,
    published_version: versionNumber,
    status: "active",
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? { ...(current?.metadata || {}), ...input.metadata }
      : current?.metadata || {},
    created_at: current?.created_at || timestamp,
    updated_at: timestamp,
  };
  validateLockedSkills(workspaceId, version.skill_policy.locked_skills);
  if (version.model_policy.provider_connection_id) {
    const connection = getProviderConnection(version.model_policy.provider_connection_id);
    if (connection && !version.model_policy.model) {
      version.model_policy.model = connection.default_model || connection.models[0] || null;
    }
    version.model_policy.allow_runtime_override = false;
    validateAgentProviderBinding(connection, workspaceId, version.model_policy.model);
  }
  write(file(AGENT_DEFINITIONS_DIR, agentId), definition);
  write(versionFile(agentId, versionNumber), version);
  return { definition, version };
}

export function disableAgentDefinition(
  agentId: string,
  workspaceId = "default",
): AgentDefinitionRecord {
  const current = getAgentDefinition(agentId, workspaceId);
  if (!current) {
    throw Object.assign(new Error(`Agent ${agentId} was not found.`), {
      code: "agent_not_found",
    });
  }
  const next: AgentDefinitionRecord = {
    ...current,
    status: "disabled",
    updated_at: nowIso(),
  };
  write(file(AGENT_DEFINITIONS_DIR, agentId), next);
  return next;
}

export function listModelDeployments(workspaceId = "default"): ModelDeploymentRecord[] {
  migrateLegacyAgentRegistry(workspaceId);
  return storage().listJsonFiles(MODEL_DEPLOYMENTS_DIR).map((item) => read<ModelDeploymentRecord>(item)).filter((item): item is ModelDeploymentRecord => !!item && item.workspace_id === workspaceId);
}

export function createAgentBindingSnapshot(input: {
  workspaceId?: string;
  agentId?: string | null;
  agentVersion?: number | null;
  bindingMode?: AgentBindingMode;
  providerConnectionId?: string | null;
  model?: string | null;
  autonomyMode?: AgentAutonomyMode;
}): AgentBindingSnapshot {
  const workspaceId = input.workspaceId || "default";
  migrateLegacyAgentRegistry(workspaceId);
  const explicitAgentId = typeof input.agentId === "string" && input.agentId.trim().length > 0;
  const agentId = input.agentId || "default-agent";
  let definition = getAgentDefinition(agentId, workspaceId);
  // Legacy tests and installations may only have a verified Connection. Materialize
  // a compatibility Agent so the new binding contract does not make those Sessions unusable.
  if (!definition) {
    if (explicitAgentId && agentId !== "default-agent") {
      throw Object.assign(new Error(`Agent ${agentId} is not configured.`), { code: "agent_not_found" });
    }
    const connection = input.providerConnectionId
      ? getProviderConnection(input.providerConnectionId)
      : listProviderConnections("active").find((item) => (item.workspace_id || "default") === workspaceId);
    if (!connection) throw Object.assign(new Error(`Agent ${agentId} is not configured.`), { code: "agent_not_found" });
    const timestamp = nowIso();
    definition = { agent_id: agentId, workspace_id: workspaceId, name: "My Mate Agent", description: "Compatibility Agent generated from the existing Provider Connection.", latest_version: 1, published_version: 1, status: "active", metadata: { migrated_from: "connection" }, created_at: timestamp, updated_at: timestamp };
    write(file(AGENT_DEFINITIONS_DIR, agentId), definition);
    const compatibilityVersion = defaultVersion(null, workspaceId, 1, agentId);
    compatibilityVersion.model_policy.provider_connection_id = connection.connection_id;
    compatibilityVersion.metadata = { migrated_from: "connection", capability_policy_migration: "canonical_v1" };
    write(versionFile(agentId, 1), compatibilityVersion);
  }
  if (definition.status !== "active") {
    throw Object.assign(new Error(`Agent ${definition.agent_id} is disabled.`), {
      code: "agent_unavailable",
    });
  }
  const version = input.agentVersion || definition.published_version || definition.latest_version;
  const agent = getAgentVersion(definition.agent_id, version, workspaceId);
  if (!agent || agent.status === "retired") throw Object.assign(new Error(`Agent version ${definition.agent_id}@${version} is unavailable.`), { code: "agent_version_not_found" });
  validateLockedSkills(workspaceId, agent.skill_policy.locked_skills);
  const pinnedConnectionId = agent.model_policy.provider_connection_id;
  const pinnedModel = agent.model_policy.model;
  const runtimeOverrideAllowed = agent.model_policy.allow_runtime_override === true;
  if (!runtimeOverrideAllowed && input.providerConnectionId && pinnedConnectionId && input.providerConnectionId !== pinnedConnectionId) {
    throw Object.assign(new Error(`Agent ${definition.agent_id}@${agent.version} is pinned to Provider Connection ${pinnedConnectionId}.`), {
      code: "agent_provider_override_forbidden",
    });
  }
  if (!runtimeOverrideAllowed && input.model && pinnedModel && input.model !== pinnedModel) {
    throw Object.assign(new Error(`Agent ${definition.agent_id}@${agent.version} is pinned to model ${pinnedModel}.`), {
      code: "agent_model_override_forbidden",
    });
  }
  const connectionId = runtimeOverrideAllowed || !pinnedConnectionId
    ? input.providerConnectionId || pinnedConnectionId
    : pinnedConnectionId;
  const connection = connectionId ? getProviderConnection(connectionId) : listProviderConnections("active").find((item) => (item.workspace_id || "default") === workspaceId);
  if (!connection) throw Object.assign(new Error("No Provider Connection is available for the Agent."), { code: "agent_provider_unavailable" });
  const model = runtimeOverrideAllowed || !pinnedModel
    ? input.model || pinnedModel || connection.default_model || connection.models[0]
    : pinnedModel;
  validateAgentProviderBinding(connection, workspaceId, model);
  const provider = providerDefinitionFromConnection(connection);
  const deployment = deploymentFromConnection(connection, provider, model);
  const snapshotBase = {
    schema_version: 2 as const,
    binding_id: `binding_${randomUUID()}`,
    binding_mode: input.bindingMode || "pinned" as AgentBindingMode,
    agent_id: definition.agent_id,
    agent_version: agent.version,
    agent_name: definition.name,
    agent_role: agent.role,
    responsibility: agent.responsibility || definition.description,
    provider_id: provider.provider_id,
    provider_connection_id: connection.connection_id,
    connection_revision: deployment.connection_revision,
    model_deployment_id: deployment.deployment_id,
    model: deployment.model,
    model_routing_policy: {
      routing_preference: agent.model_policy.routing_preference || "balanced",
      fallback_models: normalizeStrings(agent.model_policy.fallback_models),
      allow_model_escalation: agent.model_policy.allow_model_escalation !== false,
    },
    system_prompt: agent.system_prompt,
    tool_policy: agent.tool_policy,
    skill_policy: agent.skill_policy,
    capability_policy: agent.capability_policy || { capability_tags: [], allow_delegation: false, input_contract: {}, output_contract: {}, acceptance_criteria: [], verification_steps: [] },
    memory_policy: agent.memory_policy,
    context_policy: agent.context_policy,
    runtime_policy: agent.runtime_policy,
    workspace_policy: agent.workspace_policy,
    autonomy_ceiling: agent.autonomy_ceiling,
    artifact_policy: agent.artifact_policy,
    delivery_policy: agent.delivery_policy,
    created_at: nowIso(),
  } satisfies Omit<AgentBindingSnapshot, "snapshot_digest">;
  const snapshot = normalizeAgentBindingSnapshot({ ...snapshotBase, snapshot_digest: digest(snapshotBase) });
  write(file(AGENT_BINDING_SNAPSHOTS_DIR, snapshot.binding_id), snapshot);
  return snapshot;
}

export function resolveSessionAgentBinding(session: { workspace_id?: string; metadata?: Record<string, unknown> }): AgentBindingSnapshot {
  const metadata = session.metadata || {};
  const existing = metadata.agent_binding_snapshot;
  const requestedConnection = typeof metadata.conversation_provider_connection_id === "string" ? metadata.conversation_provider_connection_id : null;
  const requestedModel = typeof metadata.conversation_model === "string" ? metadata.conversation_model : null;
  if (existing && typeof existing === "object" && (existing as AgentBindingSnapshot).schema_version === 2 &&
      (!requestedConnection || (existing as AgentBindingSnapshot).provider_connection_id === requestedConnection) &&
      (!requestedModel || (existing as AgentBindingSnapshot).model === requestedModel)) {
    return normalizeAgentBindingSnapshot(existing as AgentBindingSnapshot);
  }
  const snapshot = createAgentBindingSnapshot({
    workspaceId: session.workspace_id || "default",
    agentId: typeof metadata.agent_id === "string" ? metadata.agent_id : null,
    agentVersion: typeof metadata.agent_version === "number" ? metadata.agent_version : null,
    bindingMode: metadata.agent_binding_mode === "follow_latest" ? "follow_latest" : "pinned",
    providerConnectionId: typeof metadata.conversation_provider_connection_id === "string" ? metadata.conversation_provider_connection_id : null,
    model: typeof metadata.conversation_model === "string" ? metadata.conversation_model : null,
  });
  return snapshot;
}

export function createAgentRun(input: { workspaceId: string; kind: AgentRunKind; bindingSnapshot: AgentBindingSnapshot; sessionId?: string | null; workflowRunId?: string | null; nodeRunId?: string | null; scheduleId?: string | null; scheduleRunId?: string | null; parentAgentRunId?: string | null; attempt?: number; metadata?: Record<string, unknown> }): AgentRunRecord {
  const timestamp = nowIso();
  const run: AgentRunRecord = { agent_run_id: `agent_run_${randomUUID()}`, workspace_id: input.workspaceId, kind: input.kind, status: "running", binding_snapshot: normalizeAgentBindingSnapshot(input.bindingSnapshot), session_id: input.sessionId || null, workflow_run_id: input.workflowRunId || null, node_run_id: input.nodeRunId || null, schedule_id: input.scheduleId || null, schedule_run_id: input.scheduleRunId || null, parent_agent_run_id: input.parentAgentRunId || null, attempt: Math.max(1, Math.floor(input.attempt || 1)), input_digest: null, output_digest: null, error_code: null, error_message: null, created_at: timestamp, started_at: timestamp, finished_at: null, metadata: input.metadata || {} };
  return write(file(AGENT_RUNS_DIR, run.agent_run_id), normalizeAgentRun(run));
}
export function saveAgentRun(run: AgentRunRecord, options: { recovery?: boolean } = {}): AgentRunRecord {
  const normalized = normalizeAgentRun(run);
  const targetFile = file(AGENT_RUNS_DIR, normalized.agent_run_id);
  const previousRaw = read<AgentRunRecord>(targetFile);
  if (previousRaw) {
    const previous = normalizeAgentRun(previousRaw);
    assertLifecycleTransition(AGENT_RUN_LIFECYCLE, previous.status, normalized.status, options);
  }
  return write(targetFile, normalized);
}
export function getAgentRun(agentRunId: string): AgentRunRecord | null { const run = read<AgentRunRecord>(file(AGENT_RUNS_DIR, agentRunId)); return run ? normalizeAgentRun(run) : null; }
export function listAgentRuns(workspaceId = "default", status?: AgentRunStatus): AgentRunRecord[] { return storage().listJsonFiles(AGENT_RUNS_DIR).map((item) => read<AgentRunRecord>(item)).filter((item): item is AgentRunRecord => !!item && item.workspace_id === workspaceId && (!status || item.status === status)).map(normalizeAgentRun).sort((a, b) => b.created_at.localeCompare(a.created_at)); }

export function findWorkflowAgentRun(workflowRunId: string, nodeRunId: string, jobId?: string | null): AgentRunRecord | null {
  return storage().listJsonFiles(AGENT_RUNS_DIR)
    .map((item) => read<AgentRunRecord>(item))
    .filter((item): item is AgentRunRecord => !!item && item.kind === "workflow_node" && item.workflow_run_id === workflowRunId && item.node_run_id === nodeRunId)
    .filter((item) => !jobId || item.metadata.job_id === jobId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
}

export function completeWorkflowAgentRun(input: { workflowRunId: string; nodeRunId: string; jobId?: string | null; status: "completed" | "failed" | "cancelled" | "waiting_human"; errorCode?: string | null; errorMessage?: string | null; outputDigest?: string | null }): AgentRunRecord | null {
  const run = findWorkflowAgentRun(input.workflowRunId, input.nodeRunId, input.jobId);
  if (!run) return null;
  run.status = input.status;
  run.error_code = input.errorCode || null;
  run.error_message = input.errorMessage?.slice(0, 2_000) || null;
  run.output_digest = input.outputDigest || run.output_digest;
  if (input.status !== "waiting_human") run.finished_at = nowIso();
  return saveAgentRun(run);
}
