import type {
  AgentProfileRecord,
  CompiledNodeRecord,
  RegistryProvenance,
  RegistrySkillProvenance,
  RegistryToolProvenance,
  RunPlanRecord,
  RunRecord,
  SkillRecord,
  WorkflowTemplateRecord,
} from "./types.js";
import { getAgentProfile, getSkill } from "./registry-store.js";
import { generateNodeRunId, isPlainObject, slugify } from "./utils.js";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.trim()).map((item) => item.trim()))];
}

function getActiveAgentProfile(agentProfile: string | null): AgentProfileRecord | null {
  if (!agentProfile) {
    return null;
  }
  const profile = getAgentProfile(agentProfile) || getAgentProfile(slugify(agentProfile));
  if (!profile || profile.status !== "active") {
    return null;
  }
  return profile;
}

function getAnyAgentProfile(agentProfile: string | null): AgentProfileRecord | null {
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

function pushSource<T extends string>(sources: T[], source: T): void {
  if (!sources.includes(source)) {
    sources.push(source);
  }
}

function resolveOpenClawAgentId(input: {
  template: WorkflowTemplateRecord;
  agentProfile: string | null;
  registryProfile: AgentProfileRecord | null;
}): string | null {
  if (!input.agentProfile) {
    return null;
  }

  if (input.registryProfile) {
    return input.registryProfile.openclaw_agent_id;
  }

  const binding = input.template.agent_profile_bindings[input.agentProfile];
  if (typeof binding === "string" && binding.trim()) {
    return binding;
  }
  if (isPlainObject(binding) && typeof binding.openclaw_agent_id === "string") {
    return binding.openclaw_agent_id;
  }

  return input.agentProfile;
}

function resolveOpenClawAgentIdSource(input: {
  template: WorkflowTemplateRecord;
  agentProfile: string | null;
  registryProfile: AgentProfileRecord | null;
}): RegistryProvenance["openclaw_agent_id_source"] {
  if (!input.agentProfile) {
    return "none";
  }
  if (input.registryProfile) {
    return "registry";
  }
  const binding = input.template.agent_profile_bindings[input.agentProfile];
  if (
    (typeof binding === "string" && binding.trim()) ||
    (isPlainObject(binding) && typeof binding.openclaw_agent_id === "string")
  ) {
    return "template_binding";
  }
  return "fallback";
}

function resolveNodeAllowedTools(nodeConfig: Record<string, unknown>): string[] {
  const allowedTools = nodeConfig.allowed_tools;
  if (!Array.isArray(allowedTools)) {
    return [];
  }

  return uniqueStrings(allowedTools.filter((item): item is string => typeof item === "string"));
}

function resolveAllowedTools(input: {
  nodeConfig: Record<string, unknown>;
  registryProfile: AgentProfileRecord | null;
}): string[] {
  return uniqueStrings([
    ...(input.registryProfile?.allowed_tools || []),
    ...resolveNodeAllowedTools(input.nodeConfig),
  ]);
}

function resolveAllowedSkills(input: {
  nodeSkills: string[];
  registryProfile: AgentProfileRecord | null;
}): string[] {
  const combined = uniqueStrings([
    ...(input.registryProfile?.default_skills || []),
    ...input.nodeSkills,
  ]);
  const disallowed = stringAndSlugSet(input.registryProfile?.disallowed_skills || []);
  return combined.filter((skill) => !disallowed.has(skill) && !disallowed.has(slugify(skill)));
}

function resolveSkillProvenance(input: {
  nodeSkills: string[];
  registryProfile: AgentProfileRecord | null;
}): RegistrySkillProvenance[] {
  const bindings = new Map<string, RegistrySkillProvenance>();
  const disallowed = stringAndSlugSet(input.registryProfile?.disallowed_skills || []);

  function ensure(skillId: string): RegistrySkillProvenance {
    const trimmed = skillId.trim();
    const existing = bindings.get(trimmed);
    if (existing) {
      return existing;
    }

    const skill = getRegistrySkill(trimmed);
    const skillDisallowed = disallowed.has(trimmed) || disallowed.has(slugify(trimmed));
    const registryStatus = skill?.status || "missing";
    const excludedReason =
      input.registryProfile?.status === "active" && skillDisallowed
        ? "disallowed_by_agent_profile"
        : null;
    const item: RegistrySkillProvenance = {
      skill_id: skill?.skill_id || trimmed,
      sources: [],
      registry_status: registryStatus,
      included: excludedReason === null,
      excluded_reason: excludedReason,
    };
    bindings.set(trimmed, item);
    return item;
  }

  for (const skillId of input.registryProfile?.default_skills || []) {
    if (!skillId.trim()) {
      continue;
    }
    pushSource(ensure(skillId).sources, "agent_profile_default");
  }
  for (const skillId of input.nodeSkills) {
    if (!skillId.trim()) {
      continue;
    }
    pushSource(ensure(skillId).sources, "node_allowed");
  }

  return [...bindings.values()];
}

function resolveToolProvenance(input: {
  nodeConfig: Record<string, unknown>;
  registryProfile: AgentProfileRecord | null;
}): RegistryToolProvenance[] {
  const bindings = new Map<string, RegistryToolProvenance>();
  function ensure(toolId: string): RegistryToolProvenance {
    const trimmed = toolId.trim();
    const existing = bindings.get(trimmed);
    if (existing) {
      return existing;
    }
    const item: RegistryToolProvenance = {
      tool_id: trimmed,
      sources: [],
    };
    bindings.set(trimmed, item);
    return item;
  }

  for (const toolId of input.registryProfile?.allowed_tools || []) {
    if (!toolId.trim()) {
      continue;
    }
    pushSource(ensure(toolId).sources, "agent_profile_allowed");
  }
  for (const toolId of resolveNodeAllowedTools(input.nodeConfig)) {
    if (!toolId.trim()) {
      continue;
    }
    pushSource(ensure(toolId).sources, "node_allowed");
  }

  return [...bindings.values()];
}

function resolveRegistryProvenance(input: {
  template: WorkflowTemplateRecord;
  agentProfile: string | null;
  registryProfile: AgentProfileRecord | null;
  anyRegistryProfile: AgentProfileRecord | null;
  nodeSkills: string[];
  nodeConfig: Record<string, unknown>;
}): RegistryProvenance {
  const requested = input.agentProfile?.trim() || null;
  const hasTemplateBinding =
    !!requested && Object.prototype.hasOwnProperty.call(input.template.agent_profile_bindings, requested);

  return {
    agent_profile_requested: requested,
    agent_profile_resolved: input.anyRegistryProfile?.profile_id || null,
    agent_profile_status: input.anyRegistryProfile?.status || (requested ? "missing" : null),
    agent_profile_source: input.registryProfile
      ? "registry"
      : hasTemplateBinding
        ? "template_binding"
        : requested
          ? "fallback"
          : "none",
    openclaw_agent_id_source: resolveOpenClawAgentIdSource({
      template: input.template,
      agentProfile: input.agentProfile,
      registryProfile: input.registryProfile,
    }),
    skill_bindings: resolveSkillProvenance({
      nodeSkills: input.nodeSkills,
      registryProfile: input.registryProfile,
    }),
    tool_bindings: resolveToolProvenance({
      nodeConfig: input.nodeConfig,
      registryProfile: input.registryProfile,
    }),
  };
}

function resolveOutputContract(nodeConfig: Record<string, unknown>): Record<string, unknown> {
  const outputContract = nodeConfig.output_contract;
  if (!isPlainObject(outputContract)) {
    return {};
  }
  return outputContract;
}

export function compileRunPlan(
  run: RunRecord,
  template: WorkflowTemplateRecord,
): RunPlanRecord {
  const incomingCount = new Map<string, number>();
  for (const node of template.nodes) {
    incomingCount.set(node.id, 0);
  }
  for (const edge of template.edges) {
    incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
  }

  const compiledNodes: CompiledNodeRecord[] = template.nodes.map((node) => {
    const nodeRunId = generateNodeRunId(node.id);
    const initialStatus = (incomingCount.get(node.id) || 0) === 0 ? "ready" : "pending";
    const anyRegistryProfile = getAnyAgentProfile(node.agent_profile);
    const registryProfile =
      anyRegistryProfile?.status === "active"
        ? anyRegistryProfile
        : getActiveAgentProfile(node.agent_profile);

    return {
      node_run_id: nodeRunId,
      node_id: node.id,
      name: node.name,
      type: node.type,
      agent_profile: node.agent_profile,
      openclaw_agent_id: resolveOpenClawAgentId({
        template,
        agentProfile: node.agent_profile,
        registryProfile,
      }),
      allowed_skills: resolveAllowedSkills({
        nodeSkills: node.allowed_skills,
        registryProfile,
      }),
      allowed_tools: resolveAllowedTools({
        nodeConfig: node.config,
        registryProfile,
      }),
      approval_kind: node.approval_kind,
      human_input_schema: node.human_input_schema,
      status: initialStatus,
      retry_policy: {
        max_attempts: node.retry_policy.max_attempts,
        attempt: 0,
      },
      timeout_seconds: node.timeout_seconds,
      parallelism_budget: node.parallelism,
      input_payload: {
        run_inputs: run.inputs,
        node_config: node.config,
      },
      output_contract: resolveOutputContract(node.config),
      execution_ref: {
        openclaw_task_id: null,
        openclaw_session_id: null,
      },
      registry_provenance: resolveRegistryProvenance({
        template,
        agentProfile: node.agent_profile,
        registryProfile,
        anyRegistryProfile,
        nodeSkills: node.allowed_skills,
        nodeConfig: node.config,
      }),
    };
  });

  const frontier = compiledNodes
    .filter((node) => node.status === "ready")
    .map((node) => node.node_run_id);

  return {
    run_id: run.run_id,
    template_id: run.template_id,
    template_version: run.template_version,
    workspace_id: run.workspace_id,
    requested_by: run.requested_by,
    intent: run.intent,
    inputs: run.inputs,
    compiled_nodes: compiledNodes,
    edges: template.edges,
    frontier,
    policy_snapshot: {
      ...template.policy,
    },
    planner_context: {
      template_selected_by: "explicit_request",
      validation_passed: true,
    },
    status: run.status,
    created_at: run.created_at,
  };
}
