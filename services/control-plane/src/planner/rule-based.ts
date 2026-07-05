import { compileRunPlan } from "../run-plan-compiler.js";
import { getAgentProfile, getSkill } from "../registry-store.js";
import { listAgentProfiles, listSkills } from "../registry-store.js";
import { getTemplate, listTemplates } from "../template-store.js";
import type {
  AgentProfileRecord,
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
import type { PlannerProvider } from "./provider.js";

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

function tokenize(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const matches = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return matches.filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function uniqueTokens(values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => tokenize(value)))];
}

function uniqueStringValues(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.trim()).map((item) => item.trim()))];
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
    node.agent_profile || "",
    ...node.allowed_skills,
  ]);
}

function getRegistryProfile(agentProfile: string | null): AgentProfileRecord | null {
  if (!agentProfile) {
    return null;
  }
  return getAgentProfile(agentProfile) || getAgentProfile(slugify(agentProfile));
}

function getRegistrySkill(skillId: string): SkillRecord | null {
  return getSkill(skillId) || getSkill(slugify(skillId));
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
    detail.agent_profile_id || "",
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
    missing_agent_profile_count: number;
    disabled_agent_profile_count: number;
    missing_skill_count: number;
    disabled_skill_count: number;
    disallowed_skill_count: number;
    missing_openclaw_agent_count: number;
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
    missing_agent_profile_count: 0,
    disabled_agent_profile_count: 0,
    missing_skill_count: 0,
    disabled_skill_count: 0,
    disallowed_skill_count: 0,
    missing_openclaw_agent_count: 0,
  };

  for (const node of template.nodes) {
    if (!isExecutableNode(node)) {
      continue;
    }

    stats.executable_node_count += 1;
    const nodeLabel = `${node.id} (${node.name})`;
    const agentProfile = typeof node.agent_profile === "string" ? node.agent_profile.trim() : "";
    if (!agentProfile) {
      stats.missing_agent_profile_count += 1;
      stats.missing_openclaw_agent_count += 1;
      warn({
        code: "missing_agent_profile",
        category: "registry",
        message: `Node ${nodeLabel} has no agent profile.`,
        field: null,
        node_id: node.id,
        node_name: node.name,
        agent_profile_id: null,
        skill_id: null,
      });
      warn({
        code: "missing_openclaw_agent",
        category: "registry",
        message: `Node ${nodeLabel} has no OpenClaw agent id.`,
        field: null,
        node_id: node.id,
        node_name: node.name,
        agent_profile_id: null,
        skill_id: null,
      });
      continue;
    }

    const profile = getRegistryProfile(agentProfile);
    if (!profile) {
      stats.missing_agent_profile_count += 1;
      warn({
        code: "unknown_agent_profile",
        category: "registry",
        message: `Node ${nodeLabel} uses unknown agent profile: ${agentProfile}`,
        field: null,
        node_id: node.id,
        node_name: node.name,
        agent_profile_id: agentProfile,
        skill_id: null,
      });
    } else if (profile.status !== "active") {
      stats.disabled_agent_profile_count += 1;
      warn({
        code: "disabled_agent_profile",
        category: "registry",
        message: `Node ${nodeLabel} uses disabled agent profile: ${profile.profile_id}`,
        field: null,
        node_id: node.id,
        node_name: node.name,
        agent_profile_id: profile.profile_id,
        skill_id: null,
      });
    } else {
      stats.registry_bound_node_count += 1;
      if (!profile.openclaw_agent_id.trim()) {
        stats.missing_openclaw_agent_count += 1;
        warn({
          code: "missing_openclaw_agent",
          category: "registry",
          message: `Node ${nodeLabel} active profile ${profile.profile_id} has no OpenClaw agent id.`,
          field: null,
          node_id: node.id,
          node_name: node.name,
          agent_profile_id: profile.profile_id,
          skill_id: null,
        });
      }
    }

    const disallowedSkills = stringAndSlugSet(profile?.disallowed_skills || []);
    const skillsToValidate = uniqueStringValues([
      ...(profile?.status === "active" ? profile.default_skills : []),
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
          agent_profile_id: profile?.profile_id || agentProfile,
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
          agent_profile_id: profile?.profile_id || agentProfile,
          skill_id: skill.skill_id,
        });
      }
      const skillDisallowed =
        disallowedSkills.has(normalizedSkillId) || disallowedSkills.has(slugify(normalizedSkillId));
      if (profile?.status === "active" && skillDisallowed) {
        stats.disallowed_skill_count += 1;
        warn({
          code: "disallowed_skill",
          category: "registry",
          message: `Node ${nodeLabel} skill ${normalizedSkillId} is disallowed by agent profile ${profile.profile_id}.`,
          field: null,
          node_id: node.id,
          node_name: node.name,
          agent_profile_id: profile.profile_id,
          skill_id: normalizedSkillId,
        });
      }
      if (
        skill.status === "active" &&
        !(profile?.status === "active" && skillDisallowed)
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
  const openclawScore =
    (executableCount - validation.stats.missing_openclaw_agent_count) / executableCount;
  const disallowedPenalty =
    validation.stats.skill_reference_count > 0
      ? validation.stats.disallowed_skill_count / validation.stats.skill_reference_count
      : 0;
  const raw =
    agentScore * 0.45 + skillScore * 0.3 + openclawScore * 0.2 - disallowedPenalty * 0.15;
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

function getAgentProfileSearchTokens(profile: AgentProfileRecord): string[] {
  return uniqueTokens([
    profile.profile_id,
    profile.name,
    profile.description,
    profile.openclaw_agent_id,
    ...profile.default_skills,
    ...profile.allowed_tools,
    ...profile.policy_tags,
    ...collectMetadataText(profile.metadata),
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

function getPolicyTagTokens(profile: AgentProfileRecord): string[] {
  return uniqueTokens(profile.policy_tags);
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

interface ProfileScoreBreakdown {
  profile: AgentProfileRecord;
  score: number;
  policyScore: number;
  profileTokenScore: number;
  skillMaxScore: number;
  skillMeanScore: number;
  readinessScore: number;
  defaultSkillHealth: number;
  disallowedHitCount: number;
  openclawReady: boolean;
  reason: string;
}

function scoreAgentProfile(
  profile: AgentProfileRecord,
  intentTokens: string[],
): ProfileScoreBreakdown {
  const policyScore = overlapScore(intentTokens, getPolicyTagTokens(profile));
  const profileTokenScore = overlapScore(intentTokens, getAgentProfileSearchTokens(profile));

  const defaultSkills = profile.default_skills
    .map((skillId) => ({ skillId, skill: getRegistrySkill(skillId) }))
    .filter((entry) => Boolean(entry.skill));
  const activeDefaultSkills = defaultSkills.filter(
    (entry) => entry.skill?.status === "active",
  );
  const defaultSkillHealth =
    defaultSkills.length === 0
      ? 1
      : activeDefaultSkills.length / defaultSkills.length;

  const skillTokenLists = activeDefaultSkills.map((entry) =>
    entry.skill ? getSkillSearchTokens(entry.skill) : [],
  );
  const skillMaxScore = skillTokenLists.length
    ? Math.max(...skillTokenLists.map((tokens) => overlapScore(intentTokens, tokens)))
    : 0;
  const skillMeanScore = meanOverlap(intentTokens, skillTokenLists);

  const disallowedSet = stringAndSlugSet(profile.disallowed_skills);
  const disallowedHitCount = intentTokens.filter((token) => disallowedSet.has(token)).length;
  const disallowedPenalty =
    intentTokens.length > 0 ? Math.min(0.3, (disallowedHitCount / intentTokens.length) * 0.3) : 0;

  const openclawReady = profile.openclaw_agent_id.trim().length > 0;
  const readinessScore =
    (openclawReady ? 0.6 : 0) + defaultSkillHealth * 0.4;

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
    profile,
    score,
    policyScore,
    profileTokenScore,
    skillMaxScore,
    skillMeanScore,
    readinessScore,
    defaultSkillHealth,
    disallowedHitCount,
    openclawReady,
    reason,
  };
}

function buildRegistryRecommendations(
  intentTokens: string[],
  maxAgentNodes: number,
): PlannerRegistryRecommendation[] {
  const activeSkills = listSkills("active");
  const activeProfiles = listAgentProfiles("active");
  const scoredProfiles = activeProfiles
    .map((profile) => scoreAgentProfile(profile, intentTokens))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.profile.profile_id.localeCompare(b.profile.profile_id);
    });

  const selectedProfiles =
    scoredProfiles.length > 0
      ? scoredProfiles.slice(0, maxAgentNodes)
      : [];

  if (selectedProfiles.length === 0) {
    return [
      {
        node_id: "node_task_1",
        node_name: "Task 1",
        agent_profile_id: null,
        agent_profile_name: null,
        openclaw_agent_id: null,
        skill_ids: activeSkills.slice(0, 3).map((skill) => skill.skill_id),
        score: 0,
        reason: "No active agent profile is available; human assignment is required.",
        warnings: ["No active agent profile found."],
      },
    ];
  }

  return selectedProfiles.map((breakdown, index) => {
    const { profile, score } = breakdown;
    const disallowedSet = stringAndSlugSet(profile.disallowed_skills);
    const defaultActiveSkills = profile.default_skills.filter((skillId) => {
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
    const warnings = [];
    if (!breakdown.openclawReady) {
      warnings.push(`Agent profile ${profile.profile_id} has no OpenClaw agent id.`);
    }
    if (breakdown.defaultSkillHealth < 1 && profile.default_skills.length > 0) {
      warnings.push(
        `Agent profile ${profile.profile_id} has disabled default skills; ${(breakdown.defaultSkillHealth * 100).toFixed(0)}% of defaults are active.`,
      );
    }
    if (breakdown.disallowedHitCount > 0) {
      warnings.push(
        `Intent terms overlap with disallowed skills on agent profile ${profile.profile_id}.`,
      );
    }
    if (skillIds.length === 0) {
      warnings.push(`Agent profile ${profile.profile_id} has no active recommended skill.`);
    }

    return {
      node_id: `node_task_${index + 1}`,
      node_name: selectedProfiles.length === 1 ? "Execute Task" : `Execute Task ${index + 1}`,
      agent_profile_id: profile.profile_id,
      agent_profile_name: profile.name,
      openclaw_agent_id: profile.openclaw_agent_id || null,
      skill_ids: skillIds,
      score,
      reason: breakdown.reason,
      warnings,
    };
  });
}

function buildTemplateRegistryRecommendations(
  template: WorkflowTemplateRecord,
): PlannerRegistryRecommendation[] {
  return template.nodes
    .filter(isExecutableNode)
    .map((node) => {
      const profile = getRegistryProfile(node.agent_profile);
      const skillIds = uniqueStringValues([
        ...(profile?.status === "active" ? profile.default_skills : []),
        ...node.allowed_skills,
      ]);
      const warnings = [];
      if (!node.agent_profile) {
        warnings.push(`Node ${node.id} has no agent profile.`);
      } else if (!profile) {
        warnings.push(`Node ${node.id} uses unknown agent profile: ${node.agent_profile}`);
      } else if (profile.status !== "active") {
        warnings.push(`Node ${node.id} uses disabled agent profile: ${profile.profile_id}`);
      }
      if (profile?.status === "active" && !profile.openclaw_agent_id.trim()) {
        warnings.push(`Agent profile ${profile.profile_id} has no OpenClaw agent id.`);
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
        agent_profile_id: profile?.profile_id || node.agent_profile,
        agent_profile_name: profile?.name || null,
        openclaw_agent_id: profile?.openclaw_agent_id || null,
        skill_ids: skillIds,
        score: warnings.length === 0 ? 1 : 0.35,
        reason: profile
          ? "Kept template node binding and checked it against the active registry."
          : "Kept template node binding; human registry assignment is required.",
        warnings,
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
    agent_profile: recommendation.agent_profile_id,
    allowed_skills: recommendation.skill_ids,
    config: {
      allowed_tools: ["read", "write", "shell"],
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
    agent_profile: null,
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
}): CreateTemplateRequest & { template_id: string } {
  return {
    template_id: buildDraftTemplateId(input.intent),
    name: `${input.template.name} Planned Variant`,
    description: `Planner draft for: ${input.intent.trim()}`,
    workspace_scope: input.template.workspace_scope,
    input_schema: input.template.input_schema,
    policy: input.template.policy,
    agent_profile_bindings: input.template.agent_profile_bindings,
    nodes: input.template.nodes,
    edges: input.template.edges,
    metadata: {
      ...input.template.metadata,
      planner_source_template_id: input.template.template_id,
      planner_source_template_version: input.template.version,
      planner_source_template_selected_by: input.source ? "template_selection" : "explicit_request",
      planner_intent: input.intent.trim(),
      planner_human_confirmation_required: true,
    },
  };
}

function buildDraftFromRegistry(input: {
  intent: string;
  inputs: Record<string, unknown>;
  recommendations: PlannerRegistryRecommendation[];
}): CreateTemplateRequest & { template_id: string } {
  const taskNodes = input.recommendations.map(nodeFromRegistryRecommendation);
  const nodes = [...taskNodes, endNode()];
  const edges = taskNodes.map((node) => ({
    from: node.id,
    to: "node_end",
    condition: null,
    label: null,
  }));
  const agentProfileBindings: Record<string, string> = {};
  for (const recommendation of input.recommendations) {
    if (recommendation.agent_profile_id && recommendation.openclaw_agent_id) {
      agentProfileBindings[recommendation.agent_profile_id] = recommendation.openclaw_agent_id;
    }
  }

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
    agent_profile_bindings: agentProfileBindings,
    nodes,
    edges,
    metadata: {
      planner_intent: input.intent.trim(),
      planner_strategy: "registry_synthesis",
      planner_human_confirmation_required: true,
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
    agent_profile_bindings: draft.agent_profile_bindings || {},
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
        detail.agent_profile_id || "",
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
        agent_profile_id: null,
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
      agent_profile_id: null,
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
      agent_profile_id: null,
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
  const publishedTemplates = listTemplates().filter((template) => template.status === "published");
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

function generateDagDraftImpl(request: PlannerDagDraftRequest): PlannerDagDraftResponse {
  const intent = request.intent.trim();
  const intentTokens = uniqueTokens([intent]);
  const inputs = isPlainObject(request.inputs) ? request.inputs : {};
  const maxAgentNodes = clampInteger(request.max_agent_nodes, 1, 1, 6);
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
    sourceTemplate = recommendation
      ? getTemplate(recommendation.selected_template.template_id)
      : null;
  }

  if (sourceTemplate) {
    const draftTemplate = buildDraftFromTemplate({
      intent,
      template: sourceTemplate,
      source: recommendation,
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
      },
    };
  }

  const registryRecommendations = buildRegistryRecommendations(intentTokens, maxAgentNodes);
  const draftTemplate = buildDraftFromRegistry({
    intent,
    inputs,
    recommendations: registryRecommendations,
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
  async generateDagDraft(request) {
    return generateDagDraftImpl(request);
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
