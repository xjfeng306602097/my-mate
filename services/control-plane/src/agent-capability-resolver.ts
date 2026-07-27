import {
  evaluateAgentVersionReadiness,
  getAgentVersion,
  getPublishedAgentVersion,
  listAgentDefinitions,
  listModelDeployments,
} from "./agent-runtime-store.js";
import {
  orchestrationFactId,
  saveAgentCapabilityPlan,
} from "./orchestration-fact-store.js";
import { listSkills } from "./registry-store.js";
import type {
  AgentCapabilityCandidate,
  AgentCapabilityGap,
  AgentCapabilityPlanRecord,
  AgentRequirement,
  AgentVersionRecord,
} from "./types.js";
import { nowIso } from "./utils.js";

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function normalized(values: string[]): string[] {
  return strings(values).map((value) => value.toLocaleLowerCase());
}

function agentCapabilities(
  definitionMetadata: Record<string, unknown>,
  version: AgentVersionRecord,
): string[] {
  return strings([
    version.role,
    ...strings(version.capability_policy?.capability_tags),
    ...strings(definitionMetadata.capability_tags),
    ...strings(version.metadata.capability_tags),
  ]);
}

function candidateFor(input: {
  requirement: AgentRequirement;
  agentId: string;
  agentName: string;
  definitionMetadata: Record<string, unknown>;
  version: AgentVersionRecord;
  availableToolNames?: Iterable<string>;
}): AgentCapabilityCandidate {
  const readiness = evaluateAgentVersionReadiness(input.version, {
    workspaceId: input.version.workspace_id,
    availableToolNames: input.availableToolNames,
  });
  const availableCapabilities = normalized(agentCapabilities(input.definitionMetadata, input.version));
  const requiredCapabilities = normalized(input.requirement.capability_tags);
  const matchedCapabilities = input.requirement.capability_tags.filter((capability) =>
    availableCapabilities.includes(capability.toLocaleLowerCase()),
  );
  const missingCapabilities = input.requirement.capability_tags.filter((capability) =>
    !availableCapabilities.includes(capability.toLocaleLowerCase()),
  );
  const deniedSkills = new Set(input.version.skill_policy.denied_skills.map((skill) => skill.toLocaleLowerCase()));
  const availableSkills = new Set([
    ...input.version.skill_policy.locked_skills.map((skill) => skill.skill_id.toLocaleLowerCase()),
    ...(input.version.skill_policy.dynamic_activation
      ? listSkills("active")
        .map((skill) => skill.skill_id.toLocaleLowerCase())
        .filter((skillId) => !deniedSkills.has(skillId))
      : []),
  ]);
  const availableTools = new Set(input.version.tool_policy.allowed_tools.map((tool) => tool.toLocaleLowerCase()));
  const missingSkills = input.requirement.required_skills.filter(
    (skill) => !availableSkills.has(skill.toLocaleLowerCase()),
  );
  const missingTools = input.requirement.required_tools.filter(
    (tool) => !availableTools.has(tool.toLocaleLowerCase()),
  );
  const issues = [...readiness.issues];
  if (input.requirement.permission_policy.workspace_read && !input.version.workspace_policy.read) {
    issues.push("Workspace read permission is unavailable.");
  }
  if (input.requirement.permission_policy.workspace_write && !input.version.workspace_policy.write) {
    issues.push("Workspace write permission is unavailable.");
  }
  if (
    input.requirement.isolation_requirement !== "auto" &&
    input.version.runtime_policy.sandbox !== input.requirement.isolation_requirement
  ) {
    issues.push(`Required ${input.requirement.isolation_requirement} isolation is unavailable.`);
  }
  if (
    input.requirement.model_constraints.provider_connection_id &&
    input.version.model_policy.provider_connection_id !== input.requirement.model_constraints.provider_connection_id
  ) {
    issues.push("The required Provider Connection is not bound to this Agent.");
  }
  if (
    input.requirement.model_constraints.model &&
    input.version.model_policy.model !== input.requirement.model_constraints.model
  ) {
    issues.push("The required model is not bound to this Agent.");
  }
  if (input.requirement.model_constraints.minimum_context_window) {
    const deployment = listModelDeployments(input.version.workspace_id).find(
      (item) =>
        item.connection_id === input.version.model_policy.provider_connection_id &&
        (!input.version.model_policy.model || item.model === input.version.model_policy.model),
    );
    if (!deployment || deployment.context_window < input.requirement.model_constraints.minimum_context_window) {
      issues.push(`The model context window is below ${input.requirement.model_constraints.minimum_context_window}.`);
    }
  }

  const roleMatches = !input.requirement.role || input.version.role === input.requirement.role;
  const score = Math.max(
    0,
    100
      - (roleMatches ? 0 : 25)
      - missingCapabilities.length * 15
      - missingSkills.length * 20
      - missingTools.length * 15
      - issues.length * 10,
  );
  return {
    agent_id: input.agentId,
    agent_version: input.version.version,
    agent_name: input.agentName,
    role: input.version.role,
    score,
    readiness:
      readiness.state === "ready" &&
      roleMatches &&
      missingCapabilities.length === 0 &&
      missingSkills.length === 0 &&
      missingTools.length === 0 &&
      issues.length === 0
        ? "ready"
        : "blocked",
    matched_capabilities: matchedCapabilities,
    missing_capabilities: missingCapabilities,
    missing_skills: [...new Set([...missingSkills, ...readiness.missing_skills])],
    missing_tools: [...new Set([...missingTools, ...readiness.missing_tools])],
    issues: [...new Set(issues)],
  };
}

function gapsFor(requirement: AgentRequirement, candidates: AgentCapabilityCandidate[]): AgentCapabilityGap[] {
  const best = candidates[0] || null;
  if (!best) {
    const pinnedAgent = requirement.preferred_agent_id
      ? `${requirement.preferred_agent_id}${requirement.preferred_agent_version ? `@${requirement.preferred_agent_version}` : ""}`
      : null;
    return [{
      gap_id: orchestrationFactId("capability_gap"),
      requirement_id: requirement.requirement_id,
      kind: "agent",
      value: pinnedAgent || requirement.role || requirement.capability_tags.join(", ") || "general worker",
      blocking: true,
      resolution_hint: pinnedAgent
        ? "Publish or select an available version of this Agent, then revise the Proposal before confirmation."
        : "Create or enable an Agent before confirming the DAG proposal.",
    }];
  }
  const gaps: AgentCapabilityGap[] = [];
  if (requirement.role && best.role !== requirement.role) {
    gaps.push({
      gap_id: orchestrationFactId("capability_gap"),
      requirement_id: requirement.requirement_id,
      kind: "agent",
      value: `Required role ${requirement.role}, but ${best.agent_id} is ${best.role}.`,
      blocking: true,
      resolution_hint: "Bind an Agent with the required role or revise the node role before confirmation.",
    });
  }
  for (const value of best.missing_capabilities) gaps.push({ gap_id: orchestrationFactId("capability_gap"), requirement_id: requirement.requirement_id, kind: "capability", value, blocking: true, resolution_hint: "Bind a better matching Agent or revise the node requirement." });
  for (const value of best.missing_skills) gaps.push({ gap_id: orchestrationFactId("capability_gap"), requirement_id: requirement.requirement_id, kind: "skill", value, blocking: true, resolution_hint: "Install and enable the Skill before execution." });
  for (const value of best.missing_tools) gaps.push({ gap_id: orchestrationFactId("capability_gap"), requirement_id: requirement.requirement_id, kind: "tool", value, blocking: true, resolution_hint: "Enable the Tool through the Capability Registry." });
  for (const issue of best.issues) {
    const kind: AgentCapabilityGap["kind"] = /provider|model|credential/iu.test(issue)
      ? "provider"
      : /permission/iu.test(issue)
        ? "permission"
        : /isolation|runtime/iu.test(issue)
          ? "runtime"
          : "agent";
    gaps.push({ gap_id: orchestrationFactId("capability_gap"), requirement_id: requirement.requirement_id, kind, value: issue, blocking: true, resolution_hint: "Resolve the Agent readiness issue before execution." });
  }
  return gaps;
}

export function resolveAgentCapabilities(input: {
  workspaceId?: string;
  missionId: string;
  sessionId: string;
  missionRevisionId: string;
  requirements: AgentRequirement[];
  availableToolNames?: Iterable<string>;
  createdAt?: string;
}): AgentCapabilityPlanRecord {
  const workspaceId = input.workspaceId || "default";
  const definitions = listAgentDefinitions(workspaceId).filter((definition) => definition.status === "active");
  const candidates: AgentCapabilityPlanRecord["candidates"] = {};
  const selectedBindings: AgentCapabilityPlanRecord["selected_bindings"] = {};
  const gaps: AgentCapabilityGap[] = [];
  for (const requirement of input.requirements) {
    const ranked = definitions
      .filter((definition) => !requirement.preferred_agent_id || definition.agent_id === requirement.preferred_agent_id)
      .map((definition) => {
        const version = requirement.preferred_agent_version
          ? getAgentVersion(definition.agent_id, requirement.preferred_agent_version, workspaceId)
          : getPublishedAgentVersion(definition.agent_id, workspaceId);
        return version
          ? candidateFor({ requirement, agentId: definition.agent_id, agentName: definition.name, definitionMetadata: definition.metadata, version, availableToolNames: input.availableToolNames })
          : null;
      })
      .filter((candidate): candidate is AgentCapabilityCandidate => !!candidate)
      .sort((left, right) => right.score - left.score || left.agent_name.localeCompare(right.agent_name));
    candidates[requirement.requirement_id] = ranked;
    const selected = ranked.find((candidate) => candidate.readiness === "ready") || null;
    selectedBindings[requirement.requirement_id] = selected
      ? { agent_id: selected.agent_id, agent_version: selected.agent_version }
      : null;
    if (!selected) gaps.push(...gapsFor(requirement, ranked));
  }
  const timestamp = input.createdAt || nowIso();
  const readyCount = Object.values(selectedBindings).filter(Boolean).length;
  const status: AgentCapabilityPlanRecord["status"] = gaps.some((gap) => gap.blocking)
    ? readyCount > 0 ? "partial" : "blocked"
    : "ready";
  const taskScopedAgentRecommended = gaps.length > 0 && gaps.every((gap) => gap.kind === "agent" || gap.kind === "capability");
  return saveAgentCapabilityPlan({
    schema_version: 1,
    plan_id: orchestrationFactId("agent_capability_plan"),
    mission_id: input.missionId,
    session_id: input.sessionId,
    mission_revision_id: input.missionRevisionId,
    requirements: input.requirements,
    candidates,
    selected_bindings: selectedBindings,
    gaps,
    status,
    task_scoped_agent_recommended: taskScopedAgentRecommended,
    created_at: timestamp,
    updated_at: timestamp,
  });
}
