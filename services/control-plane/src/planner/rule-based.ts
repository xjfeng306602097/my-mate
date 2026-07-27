import { compileRunPlan } from "../run-plan-compiler.js";
import { getSkill, listSkills } from "../registry-store.js";
import { getAgentDefinition, getAgentVersion, listAgentDefinitions } from "../agent-runtime-store.js";
import { getActiveWorkspaceId } from "../request-security.js";
import { getTemplate, listCurrentPublishedTemplates } from "../template-store.js";
import type {
  AgentDefinitionRecord,
  AgentVersionRecord,
  PlannerDagDraftRequest,
  PlannerDagDraftResponse,
  PlannerRegistryRecommendation,
  PlannerCandidatePlanRequest,
  PlannerCandidatePlanResponse,
  PlannerValidationDetail,
  PlannerValidationResult,
  PlannerTemplateCandidate,
  PlannerTemplateSelectionResponse,
  RunRecord,
  SkillRecord,
  WorkflowNode,
  WorkflowTemplateRecord,
  CreateTemplateRequest,
} from "../types.js";
import { isPlainObject, nowIso, slugify } from "../utils.js";
import type { PlannerInvocationOptions, PlannerProvider } from "./provider.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "me",
  "my",
  "i",
  "we",
  "our",
  "please",
  "help",
]);

function normalizeEnglishToken(token: string): string {
  if (!/^[a-z]+$/.test(token) || token.length <= 3) {
    return token;
  }
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (/(sses|xes|zes|ches|shes)$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !/(ss|us|is)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenize(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const matches = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return matches
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    .map(normalizeEnglishToken);
}

function uniqueTokens(values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => tokenize(value)))];
}

function uniqueStringValues(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.trim()).map((item) => item.trim()))];
}

function buildPreferredProfileRankMap(preferredProfileIds: string[] = []): Map<string, number> {
  const result = new Map<string, number>();
  preferredProfileIds.forEach((value, index) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (!result.has(trimmed)) {
      result.set(trimmed, index);
    }
    const slug = slugify(trimmed);
    if (slug && !result.has(slug)) {
      result.set(slug, index);
    }
  });
  return result;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function overlapScore(targetTokens: string[], candidateTokens: string[]): number {
  if (targetTokens.length === 0) {
    return 0;
  }
  const candidateSet = new Set(candidateTokens);
  const matched = targetTokens.filter((token) => candidateSet.has(token));
  return matched.length / targetTokens.length;
}

function collectSchemaKeys(schema: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  const properties = schema.properties;
  if (isPlainObject(properties)) {
    for (const key of Object.keys(properties)) {
      keys.add(key);
    }
  }

  const required = schema.required;
  if (Array.isArray(required)) {
    for (const item of required) {
      if (typeof item === "string") {
        keys.add(item);
      }
    }
  }

  return [...keys];
}

function collectMetadataText(metadata: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    values.push(key);
    if (typeof value === "string") {
      values.push(value);
    }
    if (Array.isArray(value)) {
      values.push(...value.filter((item): item is string => typeof item === "string"));
    }
  }
  return values;
}

function collectNodeText(nodes: WorkflowNode[]): string[] {
  return nodes.flatMap((node) => [
    node.id,
    node.name,
    node.type,
    node.agent_binding_snapshot?.agent_id || node.agent_id || node.agent_profile || "",
    ...node.allowed_skills,
  ]);
}

export interface PlannerAgentRecord {
  agent_id: string;
  name: string;
  description: string;
  status: AgentDefinitionRecord["status"];
  skill_ids: string[];
  allowed_tools: string[];
  denied_skills: string[];
  capability_tags: string[];
  metadata: Record<string, unknown>;
  provider_connection_id: string | null;
  model: string | null;
}

function plannerAgentFromVersion(definition: AgentDefinitionRecord, version: AgentVersionRecord): PlannerAgentRecord {
  return {
    agent_id: definition.agent_id,
    name: definition.name,
    description: definition.description || version.responsibility || "",
    status: definition.status,
    skill_ids: version.skill_policy.locked_skills.map((item) => item.skill_id),
    allowed_tools: version.tool_policy.allowed_tools,
    denied_skills: version.skill_policy.denied_skills || [],
    capability_tags: version.capability_policy?.capability_tags || [],
    metadata: { ...definition.metadata, ...version.metadata, role: version.role },
    provider_connection_id: version.model_policy.provider_connection_id,
    model: version.model_policy.model,
  };
}

function getRegistryAgent(agentId: string | null): PlannerAgentRecord | null {
  if (!agentId) {
    return null;
  }
  const workspaceId = getActiveWorkspaceId() || "default";
  const definition = getAgentDefinition(agentId, workspaceId) || getAgentDefinition(slugify(agentId), workspaceId);
  if (!definition?.published_version) return null;
  const version = getAgentVersion(definition.agent_id, definition.published_version, workspaceId);
  return version ? plannerAgentFromVersion(definition, version) : null;
}

export function listRegistryAgents(status?: "active" | "disabled"): PlannerAgentRecord[] {
  const workspaceId = getActiveWorkspaceId() || "default";
  return listAgentDefinitions(workspaceId).flatMap((definition) => {
    if ((status && definition.status !== status) || !definition.published_version) return [];
    const version = getAgentVersion(definition.agent_id, definition.published_version, workspaceId);
    return version ? [plannerAgentFromVersion(definition, version)] : [];
  });
}

function getRegistrySkill(skillId: string): SkillRecord | null {
  return getSkill(skillId) || getSkill(slugify(skillId));
}

function getConfiguredAllowedTools(config: Record<string, unknown>): string[] {
  if (!Array.isArray(config.allowed_tools)) {
    return [];
  }
  return uniqueStringValues(
    config.allowed_tools.filter((item): item is string => typeof item === "string"),
  );
}

function stringAndSlugSet(values: string[]): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    result.add(trimmed);
    const slug = slugify(trimmed);
    if (slug) {
      result.add(slug);
    }
  }
  return result;
}

function isExecutableNode(node: WorkflowNode): boolean {
  return node.type === "agent_task" || node.type === "tool_task";
}

function appendValidationDetail(
  target: PlannerValidationDetail[],
  seen: Set<string>,
  detail: PlannerValidationDetail,
): void {
  const key = [
    detail.code,
    detail.message,
    detail.field || "",
    detail.node_id || "",
    detail.agent_id || "",
    detail.skill_id || "",
  ].join("|");
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push(detail);
}

export function collectRegistryValidation(template: WorkflowTemplateRecord): {
  warnings: string[];
  details: PlannerValidationDetail[];
  stats: {
    executable_node_count: number;
    registry_bound_node_count: number;
    skill_reference_count: number;
    registry_bound_skill_count: number;
    missing_agent_count: number;
    disabled_agent_count: number;
    missing_skill_count: number;
    disabled_skill_count: number;
    disallowed_skill_count: number;
  };
} {
  const details: PlannerValidationDetail[] = [];
  const seenDetails = new Set<string>();
  const warn = (detail: PlannerValidationDetail) => {
    appendValidationDetail(details, seenDetails, detail);
  };
  const stats = {
    executable_node_count: 0,
    registry_bound_node_count: 0,
    skill_reference_count: 0,
    registry_bound_skill_count: 0,
    missing_agent_count: 0,
    disabled_agent_count: 0,
    missing_skill_count: 0,
    disabled_skill_count: 0,
    disallowed_skill_count: 0,
  };

  for (const node of template.nodes) {
    if (!isExecutableNode(node)) {
      continue;
    }

    stats.executable_node_count += 1;
    const nodeLabel = `${node.id} (${node.name})`;
    const agentId = node.agent_binding_snapshot?.agent_id || node.agent_id || node.agent_profile || "";
    if (!agentId) {
      stats.missing_agent_count += 1;
      warn({
        code: "missing_agent",
        category: "registry",
        message: `Node ${nodeLabel} has no Agent binding.`,
        field: null,
        node_id: node.id,
        node_name: node.name,
        agent_id: null,
        skill_id: null,
      });
      continue;
    }

    const agent = getRegistryAgent(agentId);
    if (!agent) {
      stats.missing_agent_count += 1;
      warn({
        code: "unknown_agent",
        category: "registry",
        message: `Node ${nodeLabel} uses unknown Agent: ${agentId}`,
        field: null,
        node_id: node.id,
        node_name: node.name,
        agent_id: agentId,
        skill_id: null,
      });
    } else if (agent.status !== "active") {
      stats.disabled_agent_count += 1;
      warn({
        code: "disabled_agent",
        category: "registry",
        message: `Node ${nodeLabel} uses disabled Agent: ${agent.agent_id}`,
        field: null,
        node_id: node.id,
        node_name: node.name,
        agent_id: agent.agent_id,
        skill_id: null,
      });
    } else {
      stats.registry_bound_node_count += 1;
    }

    const disallowedSkills = stringAndSlugSet(agent?.denied_skills || []);
    const skillsToValidate = uniqueStringValues([
      ...(agent?.status === "active" ? agent.skill_ids : []),
      ...node.allowed_skills,
    ]);
    for (const skillId of skillsToValidate) {
      const normalizedSkillId = skillId.trim();
      if (!normalizedSkillId) {
        continue;
      }
      stats.skill_reference_count += 1;

      const skill = getRegistrySkill(normalizedSkillId);
      if (!skill) {
        stats.missing_skill_count += 1;
        warn({
          code: "unknown_skill",
          category: "registry",
          message: `Node ${nodeLabel} uses unknown skill: ${normalizedSkillId}`,
          field: null,
          node_id: node.id,
          node_name: node.name,
          agent_id: agent?.agent_id || agentId,
          skill_id: normalizedSkillId,
        });
        continue;
      }
      if (skill.status !== "active") {
        stats.disabled_skill_count += 1;
        warn({
          code: "disabled_skill",
          category: "registry",
          message: `Node ${nodeLabel} uses disabled skill: ${skill.skill_id}`,
          field: null,
          node_id: node.id,
          node_name: node.name,
          agent_id: agent?.agent_id || agentId,
          skill_id: skill.skill_id,
        });
      }
      const skillDisallowed =
        disallowedSkills.has(normalizedSkillId) || disallowedSkills.has(slugify(normalizedSkillId));
      if (agent?.status === "active" && skillDisallowed) {
        stats.disallowed_skill_count += 1;
        warn({
          code: "disallowed_skill",
          category: "registry",
          message: `Node ${nodeLabel} Skill ${normalizedSkillId} is denied by Agent ${agent.agent_id}.`,
          field: null,
          node_id: node.id,
          node_name: node.name,
          agent_id: agent.agent_id,
          skill_id: normalizedSkillId,
        });
      }
      if (
        skill.status === "active" &&
        !(agent?.status === "active" && skillDisallowed)
      ) {
        stats.registry_bound_skill_count += 1;
      }
    }
  }

  return {
    warnings: details.map((detail) => detail.message),
    details,
    stats,
  };
}

function registryHealthScore(template: WorkflowTemplateRecord): number {
  const validation = collectRegistryValidation(template);
  const executableCount = validation.stats.executable_node_count;
  if (executableCount === 0) {
    return 1;
  }

  const agentScore = validation.stats.registry_bound_node_count / executableCount;
  const skillScore =
    validation.stats.skill_reference_count > 0
      ? validation.stats.registry_bound_skill_count / validation.stats.skill_reference_count
      : 1;
  const disallowedPenalty =
    validation.stats.skill_reference_count > 0
      ? validation.stats.disallowed_skill_count / validation.stats.skill_reference_count
      : 0;
  const raw =
    agentScore * 0.6 + skillScore * 0.35 - disallowedPenalty * 0.15;
  return Math.max(0, Math.min(1, raw + 0.05));
}

function getTemplateSearchTokens(template: WorkflowTemplateRecord): string[] {
  return uniqueTokens([
    template.template_id,
    template.name,
    template.description,
    template.workspace_scope,
    ...collectSchemaKeys(template.input_schema),
    ...collectMetadataText(template.metadata),
    ...collectNodeText(template.nodes),
  ]);
}

function getSkillSearchTokens(skill: SkillRecord): string[] {
  return uniqueTokens([
    skill.skill_id,
    skill.name,
    skill.description,
    skill.category,
    ...skill.allowed_tools,
    ...skill.tags,
    ...collectMetadataText(skill.metadata),
  ]);
}

function getAgentSearchTokens(agent: PlannerAgentRecord): string[] {
  return uniqueTokens([
    agent.agent_id,
    agent.name,
    agent.description,
    ...agent.skill_ids,
    ...agent.allowed_tools,
    ...agent.capability_tags,
    ...collectMetadataText(agent.metadata),
  ]);
}

function scoreTemplate(
  template: WorkflowTemplateRecord,
  intentTokens: string[],
): PlannerTemplateCandidate {
  const templateTokens = getTemplateSearchTokens(template);
  const templateTokenSet = new Set(templateTokens);
  const matchedTerms = intentTokens.filter((token) => templateTokenSet.has(token));
  const coverageScore =
    intentTokens.length > 0 ? matchedTerms.length / intentTokens.length : 0;
  const densityScore =
    templateTokens.length > 0 ? matchedTerms.length / templateTokens.length : 0;
  const registryScore = registryHealthScore(template);
  const score = Number(
    (coverageScore * 0.72 + densityScore * 0.18 + registryScore * 0.1).toFixed(4),
  );

  const matchReason =
    matchedTerms.length > 0
      ? `Matched intent terms: ${matchedTerms.join(", ")}.`
      : "No direct token match; ranked by deterministic fallback order.";
  const reason = `${matchReason} Registry readiness: ${registryScore.toFixed(2)}.`;

  return {
    template_id: template.template_id,
    version: template.version,
    name: template.name,
    description: template.description,
    workspace_scope: template.workspace_scope,
    score,
    matched_terms: matchedTerms,
    reason,
    evidence: {
      coverage_score: Number(coverageScore.toFixed(4)),
      density_score: Number(densityScore.toFixed(4)),
      registry_readiness_score: Number(registryScore.toFixed(4)),
    },
  };
}

function sortCandidates(
  a: PlannerTemplateCandidate,
  b: PlannerTemplateCandidate,
): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return a.template_id.localeCompare(b.template_id);
}

function getCapabilityTagTokens(agent: PlannerAgentRecord): string[] {
  return uniqueTokens(agent.capability_tags);
}

function meanOverlap(intentTokens: string[], skillTokenLists: string[][]): number {
  if (skillTokenLists.length === 0) {
    return 0;
  }
  const sum = skillTokenLists.reduce(
    (acc, tokens) => acc + overlapScore(intentTokens, tokens),
    0,
  );
  return sum / skillTokenLists.length;
}

interface AgentScoreBreakdown {
  agent: PlannerAgentRecord;
  score: number;
  policyScore: number;
  profileTokenScore: number;
  skillMaxScore: number;
  skillMeanScore: number;
  readinessScore: number;
  defaultSkillHealth: number;
  disallowedHitCount: number;
  disallowedPenalty: number;
  runtimeReady: boolean;
  reason: string;
}

function scoreAgent(
  agent: PlannerAgentRecord,
  intentTokens: string[],
): AgentScoreBreakdown {
  const policyScore = overlapScore(intentTokens, getCapabilityTagTokens(agent));
  const profileTokenScore = overlapScore(intentTokens, getAgentSearchTokens(agent));

  const defaultSkills = agent.skill_ids
    .map((skillId) => ({ skillId, skill: getRegistrySkill(skillId) }))
    .filter((entry) => Boolean(entry.skill));
  const activeDefaultSkills = defaultSkills.filter(
    (entry) => entry.skill?.status === "active",
  );
  const defaultSkillHealth =
    agent.skill_ids.length === 0
      ? 1
      : activeDefaultSkills.length / agent.skill_ids.length;

  const skillTokenLists = activeDefaultSkills.map((entry) =>
    entry.skill ? getSkillSearchTokens(entry.skill) : [],
  );
  const skillMaxScore = skillTokenLists.length
    ? Math.max(...skillTokenLists.map((tokens) => overlapScore(intentTokens, tokens)))
    : 0;
  const skillMeanScore = meanOverlap(intentTokens, skillTokenLists);

  const disallowedSet = stringAndSlugSet(agent.denied_skills);
  const disallowedHitCount = intentTokens.filter((token) => disallowedSet.has(token)).length;
  const disallowedPenalty =
    intentTokens.length > 0 ? Math.min(0.3, (disallowedHitCount / intentTokens.length) * 0.3) : 0;

  const runtimeReady = Boolean(agent.agent_id);
  const readinessScore =
    (runtimeReady ? 0.6 : 0) + defaultSkillHealth * 0.4;

  const combinedSkillScore = skillMaxScore * 0.7 + skillMeanScore * 0.3;
  const rawScore =
    policyScore * 0.35 +
    profileTokenScore * 0.3 +
    combinedSkillScore * 0.2 +
    readinessScore * 0.15 -
    disallowedPenalty;
  const score = Number(Math.max(0, Math.min(1, rawScore)).toFixed(4));

  const reasonParts: string[] = [];
  if (policyScore > 0) {
    reasonParts.push(`policy ${policyScore.toFixed(2)}`);
  }
  if (profileTokenScore > 0) {
    reasonParts.push(`profile ${profileTokenScore.toFixed(2)}`);
  }
  if (combinedSkillScore > 0) {
    reasonParts.push(`skill ${combinedSkillScore.toFixed(2)}`);
  }
  reasonParts.push(`readiness ${readinessScore.toFixed(2)}`);
  if (disallowedHitCount > 0) {
    reasonParts.push(`disallowed -${disallowedPenalty.toFixed(2)}`);
  }
  const reason =
    score > 0
      ? `Matched on ${reasonParts.join(", ")}.`
      : `Selected by deterministic fallback (${reasonParts.join(", ")}).`;

  return {
    agent,
    score,
    policyScore,
    profileTokenScore,
    skillMaxScore,
    skillMeanScore,
    readinessScore,
    defaultSkillHealth,
    disallowedHitCount,
    disallowedPenalty: Number(disallowedPenalty.toFixed(4)),
    runtimeReady,
    reason,
  };
}

function buildRegistryRecommendations(
  intentTokens: string[],
  maxAgentNodes: number,
  preferredProfileIds: string[] = [],
): PlannerRegistryRecommendation[] {
  const activeSkills = listSkills("active");
  const activeAgents = listRegistryAgents("active").filter(
    (agent) => agent.metadata.role !== "orchestrator",
  );
  const preferredRanks = buildPreferredProfileRankMap(preferredProfileIds);
  const scoredProfiles = activeAgents
    .map((agent) => {
      const breakdown = scoreAgent(agent, intentTokens);
      const preferredRank = preferredRanks.get(agent.agent_id) ?? preferredRanks.get(slugify(agent.agent_id)) ?? null;
      return {
        ...breakdown,
        preferredRank,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.agent.agent_id.localeCompare(b.agent.agent_id);
    })
    .filter((entry) => entry.defaultSkillHealth === 1);

  const relevantProfiles = scoredProfiles.filter(
    (entry) =>
      entry.preferredRank !== null ||
      entry.policyScore > 0 ||
      entry.profileTokenScore > 0 ||
      entry.skillMaxScore > 0 ||
      entry.skillMeanScore > 0,
  );
  const relevantIds = new Set(relevantProfiles.map((entry) => entry.agent.agent_id));
  const selectionPool = relevantProfiles.length > 0
    ? [
        ...relevantProfiles,
        ...scoredProfiles.filter((entry) => !relevantIds.has(entry.agent.agent_id)),
      ]
    : scoredProfiles;
  const preferredSelected = [...selectionPool]
    .filter((entry) => entry.preferredRank !== null)
    .sort((a, b) => (a.preferredRank ?? Number.MAX_SAFE_INTEGER) - (b.preferredRank ?? Number.MAX_SAFE_INTEGER));
  const remainingSelected = selectionPool.filter((entry) => entry.preferredRank === null);
  const selectedProfiles =
    selectionPool.length > 0
      ? [...preferredSelected, ...remainingSelected].slice(0, maxAgentNodes)
      : [];

  if (selectedProfiles.length === 0) {
    return [
      {
        node_id: "node_task_1",
        node_name: "Task 1",
        agent_id: null,
        agent_name: null,
        runtime_agent_ref: null,
        skill_ids: activeSkills.slice(0, 3).map((skill) => skill.skill_id),
        allowed_tools: [],
        score: 0,
        reason: "No active agent profile is available; human assignment is required.",
        warnings: ["No active agent profile found."],
      },
    ];
  }

  return selectedProfiles.map((breakdown, index) => {
    const { agent, preferredRank } = breakdown;
    const disallowedSet = stringAndSlugSet(agent.denied_skills);
    const defaultActiveSkills = agent.skill_ids.filter((skillId) => {
      const skill = getRegistrySkill(skillId);
      return skill?.status === "active";
    });
    const fallbackSkills = activeSkills
      .filter((skill) => !disallowedSet.has(skill.skill_id) && !disallowedSet.has(slugify(skill.skill_id)))
      .map((skill) => ({
        skill,
        score: overlapScore(intentTokens, getSkillSearchTokens(skill)),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.skill.skill_id.localeCompare(b.skill.skill_id);
      })
      .slice(0, 3)
      .map(({ skill }) => skill.skill_id);
    const skillIds = uniqueStringValues([...defaultActiveSkills, ...fallbackSkills]).filter(
      (skillId) => !disallowedSet.has(skillId) && !disallowedSet.has(slugify(skillId)),
    );
    const allowedTools = uniqueStringValues(agent.allowed_tools);
    const warnings = [];
    if (!breakdown.runtimeReady) {
      warnings.push(`Agent ${agent.agent_id} is not available in the Native Runtime.`);
    }
    if (breakdown.defaultSkillHealth < 1 && agent.skill_ids.length > 0) {
      warnings.push(
        `Agent ${agent.agent_id} has unavailable locked Skills; ${(breakdown.defaultSkillHealth * 100).toFixed(0)}% are active.`,
      );
    }
    if (breakdown.disallowedHitCount > 0) {
      warnings.push(
        `Intent terms overlap with denied Skills on Agent ${agent.agent_id}.`,
      );
    }
    if (skillIds.length === 0) {
      warnings.push(`Agent ${agent.agent_id} has no active recommended Skill.`);
    }
    const score = preferredRank !== null ? Number(Math.max(breakdown.score, 0.1).toFixed(4)) : breakdown.score;
    const reason = preferredRank !== null
      ? `${breakdown.reason} Selected from orchestrator default subagent order.`
      : breakdown.reason;

    return {
      node_id: `node_task_${index + 1}`,
      node_name: agent.name || (selectedProfiles.length === 1 ? "Execute Task" : `Execute Task ${index + 1}`),
      agent_id: agent.agent_id,
      agent_name: agent.name,
      runtime_agent_ref: agent.agent_id,
      skill_ids: skillIds,
      allowed_tools: allowedTools,
      score,
      reason,
      warnings,
      evidence: {
        preferred_rank: preferredRank,
        policy_score: Number(breakdown.policyScore.toFixed(4)),
        profile_token_score: Number(breakdown.profileTokenScore.toFixed(4)),
        skill_score: Number((breakdown.skillMaxScore * 0.7 + breakdown.skillMeanScore * 0.3).toFixed(4)),
        readiness_score: Number(breakdown.readinessScore.toFixed(4)),
        disallowed_penalty: breakdown.disallowedPenalty,
      },
    };
  });
}

function buildTemplateRegistryRecommendations(
  template: WorkflowTemplateRecord,
): PlannerRegistryRecommendation[] {
  return template.nodes
    .filter(isExecutableNode)
    .map((node) => {
      const agentId = node.agent_binding_snapshot?.agent_id || node.agent_id || node.agent_profile;
      const agent = getRegistryAgent(agentId || null);
      const config = isPlainObject(node.config) ? node.config : {};
      const skillIds = uniqueStringValues([
        ...(agent?.status === "active" ? agent.skill_ids : []),
        ...node.allowed_skills,
      ]);
      const allowedTools = uniqueStringValues([
        ...(agent?.status === "active" ? agent.allowed_tools : []),
        ...getConfiguredAllowedTools(config),
      ]);
      const warnings = [];
      if (!agentId) {
        warnings.push(`Node ${node.id} has no Agent binding.`);
      } else if (!agent) {
        warnings.push(`Node ${node.id} uses unknown Agent: ${agentId}`);
      } else if (agent.status !== "active") {
        warnings.push(`Node ${node.id} uses disabled Agent: ${agent.agent_id}`);
      }
      if (agent?.status === "active" && !agent.provider_connection_id) {
        warnings.push(`Agent ${agent.agent_id} has no Provider Connection.`);
      }
      for (const skillId of skillIds) {
        const skill = getRegistrySkill(skillId);
        if (!skill) {
          warnings.push(`Node ${node.id} uses unknown skill: ${skillId}`);
        } else if (skill.status !== "active") {
          warnings.push(`Node ${node.id} uses disabled skill: ${skill.skill_id}`);
        }
      }

      return {
        node_id: node.id,
        node_name: node.name,
        agent_id: agent?.agent_id || agentId || null,
        agent_name: agent?.name || null,
        runtime_agent_ref: agent?.agent_id || null,
        skill_ids: skillIds,
        allowed_tools: allowedTools,
        score: warnings.length === 0 ? 1 : 0.35,
        reason: agent
          ? "Kept template node binding and checked it against the active registry."
          : "Kept template node binding; human registry assignment is required.",
        warnings,
        evidence: {
          readiness_score:
            agent?.status === "active"
              ? Number((agent.provider_connection_id ? 1 : 0.4).toFixed(4))
              : undefined,
        },
      };
    });
}

function nodeFromRegistryRecommendation(
  recommendation: PlannerRegistryRecommendation,
  index: number,
): WorkflowNode {
  return {
    id: recommendation.node_id,
    name: recommendation.node_name,
    type: "agent_task",
    agent_id: recommendation.agent_id,
    allowed_skills: recommendation.skill_ids,
    config: {
      allowed_tools: recommendation.allowed_tools.length
        ? recommendation.allowed_tools
        : ["read", "write", "shell"],
      output_contract: {
        expected_artifacts: [`task-${index + 1}-report`],
      },
      planner_recommendation: {
        score: recommendation.score,
        reason: recommendation.reason,
      },
    },
    retry_policy: {
      max_attempts: 1,
      backoff_seconds: 5,
    },
    timeout_seconds: 900,
    parallelism: 1,
    approval_kind: null,
    human_input_schema: null,
  };
}

function endNode(): WorkflowNode {
  return {
    id: "node_end",
    name: "End",
    type: "end",
    agent_id: null,
    allowed_skills: [],
    config: {},
    retry_policy: {
      max_attempts: 0,
      backoff_seconds: 0,
    },
    timeout_seconds: 60,
    parallelism: 1,
    approval_kind: null,
    human_input_schema: null,
  };
}

function buildInputSchemaFromInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    goal: {
      type: "string",
      title: "Goal",
    },
  };
  for (const [key, value] of Object.entries(inputs)) {
    if (key === "goal") {
      continue;
    }
    const valueType =
      typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : isPlainObject(value)
            ? "object"
            : Array.isArray(value)
              ? "array"
              : "string";
    properties[key] = {
      type: valueType,
      title: key,
    };
  }

  return {
    type: "object",
    properties,
    required: ["goal"],
  };
}

function buildDraftTemplateId(intent: string): string {
  const base = slugify(intent).slice(0, 44) || "planned-workflow";
  return `planner-${base}-draft`;
}

function buildDraftFromTemplate(input: {
  intent: string;
  template: WorkflowTemplateRecord;
  source: PlannerTemplateSelectionResponse | null;
  requireReview: boolean;
}): CreateTemplateRequest & { template_id: string } {
  return {
    template_id: buildDraftTemplateId(input.intent),
    name: `${input.template.name} Planned Variant`,
    description: `Planner draft for: ${input.intent.trim()}`,
    workspace_scope: input.template.workspace_scope,
    input_schema: input.template.input_schema,
    policy: input.template.policy,
    nodes: input.template.nodes,
    edges: input.template.edges,
    metadata: {
      ...input.template.metadata,
      planner_source_template_id: input.template.template_id,
      planner_source_template_version: input.template.version,
      planner_source_template_selected_by: input.source ? "template_selection" : "explicit_request",
      planner_intent: input.intent.trim(),
      planner_human_confirmation_required: true,
      planner_require_review: input.requireReview,
    },
  };
}

function buildDraftFromRegistry(input: {
  intent: string;
  inputs: Record<string, unknown>;
  recommendations: PlannerRegistryRecommendation[];
  requireReview: boolean;
}): CreateTemplateRequest & { template_id: string } {
  const taskNodes = input.recommendations.map(nodeFromRegistryRecommendation);
  const nodes = [...taskNodes, endNode()];
  const edges = taskNodes.map((node) => ({
    from: node.id,
    to: "node_end",
    condition: null,
    label: null,
  }));
  return {
    template_id: buildDraftTemplateId(input.intent),
    name: `${input.intent.trim().slice(0, 72) || "Planned"} Workflow`,
    description: `Registry-synthesized planner draft for: ${input.intent.trim()}`,
    workspace_scope: "default",
    input_schema: buildInputSchemaFromInputs(input.inputs),
    policy: {
      max_parallel_nodes: Math.max(1, taskNodes.length),
      default_timeout_seconds: 900,
      budget_policy: {},
      approval_policy: {},
    },
    nodes,
    edges,
    metadata: {
      planner_intent: input.intent.trim(),
      planner_strategy: "registry_synthesis",
      planner_human_confirmation_required: true,
      planner_require_review: input.requireReview,
    },
  };
}

function templateRecordFromDraft(
  draft: CreateTemplateRequest & { template_id: string },
  base?: WorkflowTemplateRecord,
): WorkflowTemplateRecord {
  const timestamp = nowIso();
  return {
    template_id: draft.template_id,
    version: base?.version || 1,
    name: draft.name,
    status: "draft",
    description: draft.description,
    workspace_scope: draft.workspace_scope || base?.workspace_scope || "default",
    input_schema: draft.input_schema,
    policy: draft.policy,
    nodes: draft.nodes,
    edges: draft.edges,
    metadata: draft.metadata || {},
    created_at: base?.created_at || timestamp,
    updated_at: timestamp,
    published_at: null,
  };
}

function getRequiredInputKeys(template: WorkflowTemplateRecord): string[] {
  const required = template.input_schema.required;
  if (!Array.isArray(required)) {
    return [];
  }
  return required.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function hasTerminalNode(template: WorkflowTemplateRecord): boolean {
  const nodesWithOutgoingEdges = new Set(template.edges.map((edge) => edge.from));
  return template.nodes.some((node) => !nodesWithOutgoingEdges.has(node.id));
}

export function validateRunRequestForTemplate(
  request: PlannerCandidatePlanRequest,
  template: WorkflowTemplateRecord,
  candidatePlan?: ReturnType<typeof compileRunPlan>,
): PlannerValidationResult {
  const plan = candidatePlan || compileRunPlan(buildCandidateRun(request, template), template);
  const registryValidation = collectRegistryValidation(template);
  const details: PlannerValidationDetail[] = [...registryValidation.details];
  const seenDetails = new Set(
    details.map((detail) =>
      [
        detail.code,
        detail.message,
        detail.field || "",
        detail.node_id || "",
        detail.agent_id || "",
        detail.skill_id || "",
      ].join("|"),
    ),
  );

  for (const key of getRequiredInputKeys(template)) {
    if (!(key in request.inputs)) {
      appendValidationDetail(details, seenDetails, {
        code: "missing_required_input",
        category: "required_input",
        message: `Missing required input: ${key}`,
        field: key,
        node_id: null,
        node_name: null,
        agent_id: null,
        skill_id: null,
      });
    }
  }

  if (plan.frontier.length === 0 && plan.compiled_nodes.length > 0) {
    appendValidationDetail(details, seenDetails, {
      code: "no_ready_frontier",
      category: "graph",
      message: "No ready frontier node found.",
      field: null,
      node_id: null,
      node_name: null,
      agent_id: null,
      skill_id: null,
    });
  }

  if (!hasTerminalNode(template)) {
    appendValidationDetail(details, seenDetails, {
      code: "no_terminal_node",
      category: "graph",
      message: "No terminal node found.",
      field: null,
      node_id: null,
      node_name: null,
      agent_id: null,
      skill_id: null,
    });
  }

  return {
    passed: details.length === 0,
    warnings: details.map((detail) => detail.message),
    details,
  };
}

function buildCandidateRun(
  request: PlannerCandidatePlanRequest,
  template: WorkflowTemplateRecord,
): RunRecord {
  const timestamp = nowIso();
  return {
    run_id: "candidate_run",
    template_id: template.template_id,
    template_version: template.version,
    workspace_id: template.workspace_scope,
    requested_by: "planner",
    intent: request.intent.trim(),
    status: "draft",
    current_summary: "Candidate run plan generated",
    waiting_reason: null,
    blocked_reason: null,
    started_at: null,
    finished_at: null,
    last_event_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    inputs: request.inputs,
    proposal_id: null,
  };
}

function recommendTemplateImpl(intent: string): PlannerTemplateSelectionResponse | null {
  const intentTokens = uniqueTokens([intent]);
  const publishedTemplates = listCurrentPublishedTemplates();
  if (publishedTemplates.length === 0) {
    return null;
  }

  const candidates = publishedTemplates
    .map((template) => scoreTemplate(template, intentTokens))
    .sort(sortCandidates)
    .slice(0, 5);

  const selectedTemplate = candidates[0];
  if (!selectedTemplate) {
    return null;
  }

  return {
    selected_template: selectedTemplate,
    candidates,
    planner_context: {
      planner_model: "rule_based_v1",
      intent_tokens: intentTokens,
    },
  };
}

function isConfidentAutomaticTemplateMatch(
  recommendation: PlannerTemplateSelectionResponse | null,
): boolean {
  const selected = recommendation?.selected_template;
  if (!selected) {
    return false;
  }

  const coverage = Number(selected.evidence?.coverage_score || 0);
  const matchedTerms = Array.isArray(selected.matched_terms) ? selected.matched_terms.length : 0;

  // A low-density candidate is still useful as a suggestion, but it must not
  // replace a distinct user intent. Short, exact intents remain eligible.
  return coverage >= 0.35 && (matchedTerms >= 2 || coverage >= 0.66);
}

function generateDagDraftImpl(
  request: PlannerDagDraftRequest,
  options?: PlannerInvocationOptions,
): PlannerDagDraftResponse {
  const intent = request.intent.trim();
  const intentTokens = uniqueTokens([intent]);
  const inputs = isPlainObject(request.inputs) ? request.inputs : {};
  const requestedMaxAgentNodes =
    typeof request.max_agent_nodes === "number" && Number.isFinite(request.max_agent_nodes)
      ? request.max_agent_nodes
      : options?.defaultMaxAgentNodes ?? undefined;
  const maxAgentNodes = clampInteger(requestedMaxAgentNodes, 1, 1, 12);
  const requireReview = options?.requireReview === true;
  let recommendation: PlannerTemplateSelectionResponse | null = null;
  let sourceTemplate: WorkflowTemplateRecord | null = null;

  if (request.template_id?.trim()) {
    sourceTemplate = getTemplate(request.template_id.trim());
    if (!sourceTemplate) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }
    if (sourceTemplate.status !== "published") {
      throw new Error("TEMPLATE_NOT_PUBLISHED");
    }
  } else {
    recommendation = recommendTemplateImpl(intent);
    const automaticallySelectedTemplateId = isConfidentAutomaticTemplateMatch(recommendation)
      ? recommendation?.selected_template.template_id || null
      : null;
    sourceTemplate = automaticallySelectedTemplateId
      ? getTemplate(automaticallySelectedTemplateId)
      : null;
    if (!sourceTemplate) {
      recommendation = null;
    }
  }

  if (sourceTemplate) {
    const draftTemplate = buildDraftFromTemplate({
      intent,
      template: sourceTemplate,
      source: recommendation,
      requireReview,
    });
    const draftTemplateRecord = templateRecordFromDraft(draftTemplate, sourceTemplate);
    const candidateRun = buildCandidateRun(
      {
        intent,
        template_id: draftTemplate.template_id,
        inputs,
      },
      draftTemplateRecord,
    );
    const draftPlan = compileRunPlan(candidateRun, draftTemplateRecord);
    const validation = validateRunRequestForTemplate(
      {
        intent,
        template_id: draftTemplate.template_id,
        inputs,
      },
      draftTemplateRecord,
      draftPlan,
    );

    return {
      draft_template: draftTemplate,
      template_recommendation: recommendation,
      registry_recommendations: buildTemplateRegistryRecommendations(sourceTemplate),
      validation,
      planner_context: {
        planner_model: "rule_based_v1",
        intent_tokens: intentTokens,
        source_template_id: sourceTemplate.template_id,
        draft_strategy: "template_variant",
        human_confirmation_required: true,
        require_review: requireReview,
      },
    };
  }

  const registryRecommendations = buildRegistryRecommendations(
    intentTokens,
    maxAgentNodes,
    options?.preferredAgentIds || [],
  );
  const draftTemplate = buildDraftFromRegistry({
    intent,
    inputs,
    recommendations: registryRecommendations,
    requireReview,
  });
  const syntheticTemplate = templateRecordFromDraft(draftTemplate);
  const validation = validateRunRequestForTemplate(
    {
      intent,
      template_id: draftTemplate.template_id,
      inputs,
    },
    syntheticTemplate,
  );

  return {
    draft_template: draftTemplate,
    template_recommendation: null,
    registry_recommendations: registryRecommendations,
    validation,
    planner_context: {
      planner_model: "rule_based_v1",
      intent_tokens: intentTokens,
      source_template_id: null,
      draft_strategy: "registry_synthesis",
      human_confirmation_required: true,
      require_review: requireReview,
    },
  };
}

function generateCandidatePlanImpl(
  request: PlannerCandidatePlanRequest,
): PlannerCandidatePlanResponse {
  const template = getTemplate(request.template_id.trim());
  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }
  if (template.status !== "published") {
    throw new Error("TEMPLATE_NOT_PUBLISHED");
  }

  const candidateRun = buildCandidateRun(request, template);
  const candidatePlan = compileRunPlan(candidateRun, template);
  const registryValidation = collectRegistryValidation(template);
  const validation = validateRunRequestForTemplate(request, template, candidatePlan);

  candidatePlan.planner_context = {
    template_selected_by: "planner",
    planner_model: "rule_based_v1",
    registry_validation: registryValidation.stats,
    validation_passed: validation.passed,
  };

  return {
    candidate_plan: candidatePlan,
    validation,
  };
}

export const ruleBasedPlannerProvider: PlannerProvider = {
  id: "rule_based_v1",
  displayName: "Rule-based planner v1",
  async recommendTemplate(intent: string) {
    return recommendTemplateImpl(intent);
  },
  async generateDagDraft(request, options) {
    return generateDagDraftImpl(request, options);
  },
  async generateCandidatePlan(request) {
    return generateCandidatePlanImpl(request);
  },
};

// Synchronous helpers for callers that don't need provider routing
// (e.g. internal candidate-plan compilation that bypasses the registry).
export const ruleBasedRecommendTemplateSync = recommendTemplateImpl;
export const ruleBasedGenerateDagDraftSync = generateDagDraftImpl;
export const ruleBasedGenerateCandidatePlanSync = generateCandidatePlanImpl;

// Internal scoring helpers exposed for layered providers (e.g. local_semantic)
// that need to reach into the per-template scorer without going through the
// top-5 truncation that the public selector applies.
export const ruleBasedScoreTemplate = scoreTemplate;
export const ruleBasedTokenizeIntent = (intent: string): string[] => uniqueTokens([intent]);
