import type {
  CompiledNodeRecord,
  RegistryProvenance,
  RunPlanRecord,
  RunRecord,
  WorkflowTemplateRecord,
} from "./types.js";
import { createEmptyExecutionRef } from "./execution-ref.js";
import { getSkill } from "./registry-store.js";
import { snapshotProviderConnection } from "./provider-connection-store.js";
import { generateNodeRunId, isPlainObject, slugify } from "./utils.js";
import { compileWorkPackage } from "./work-package.js";
import { createAgentBindingSnapshot, getAgentDefinition } from "./agent-runtime-store.js";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.trim()).map((item) => item.trim()))];
}

function getRegistrySkill(skillId: string) {
  return getSkill(skillId) || getSkill(slugify(skillId));
}

function resolveNodeAllowedTools(nodeConfig: Record<string, unknown>): string[] {
  const allowedTools = nodeConfig.allowed_tools;
  if (!Array.isArray(allowedTools)) {
    return [];
  }

  return uniqueStrings(allowedTools.filter((item): item is string => typeof item === "string"));
}

function buildBindingProvenance(input: {
  requestedAgentId: string | null;
  resolvedAgentId: string | null;
  agentStatus: RegistryProvenance["agent_status"];
  allowedSkills: string[];
  allowedTools: string[];
}): RegistryProvenance {
  return {
    agent_id_requested: input.requestedAgentId,
    agent_id_resolved: input.resolvedAgentId,
    agent_status: input.agentStatus,
    agent_source: input.resolvedAgentId ? "registry" : "none",
    runtime_agent_ref_source: input.resolvedAgentId ? "registry" : "none",
    skill_bindings: input.allowedSkills.map((skillId) => ({
      skill_id: skillId,
      sources: ["node_allowed"],
      registry_status: getRegistrySkill(skillId)?.status || "missing",
      included: true,
      excluded_reason: null,
    })),
    tool_bindings: input.allowedTools.map((toolId) => ({ tool_id: toolId, sources: ["node_allowed"] })),
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

  const compiledNodes: CompiledNodeRecord[] = template.nodes.map((node, index) => {
    const nodeRunId = generateNodeRunId(node.id);
    const initialStatus = (incomingCount.get(node.id) || 0) === 0 ? "ready" : "pending";
    let agentBindingSnapshot = node.agent_binding_snapshot || null;
    if (!agentBindingSnapshot && node.agent_id) {
      try {
        agentBindingSnapshot = createAgentBindingSnapshot({
          workspaceId: run.workspace_id,
          agentId: node.agent_id,
          agentVersion: node.agent_version || null,
          bindingMode: "pinned",
        });
      } catch {
        // The runtime surfaces unavailable Agent bindings through normal evidence.
      }
    }
    let providerConnection = agentBindingSnapshot
      ? snapshotProviderConnection(agentBindingSnapshot.provider_connection_id, agentBindingSnapshot.model)
      : null;
    if (agentBindingSnapshot && !providerConnection && (node.agent_id || agentBindingSnapshot.agent_id)) {
      try {
        agentBindingSnapshot = createAgentBindingSnapshot({
          workspaceId: run.workspace_id,
          agentId: node.agent_id || agentBindingSnapshot.agent_id,
          bindingMode: "follow_latest",
        });
        providerConnection = snapshotProviderConnection(
          agentBindingSnapshot.provider_connection_id,
          agentBindingSnapshot.model,
        );
      } catch {
        // Preserve the pinned evidence; runtime validation will explain why no current binding is available.
      }
    }
    const runtimeAgentRef = agentBindingSnapshot?.agent_id || node.agent_id || null;
    const snapshotSkills = agentBindingSnapshot?.skill_policy.locked_skills.map((item) => item.skill_id) || [];
    const snapshotTools = agentBindingSnapshot?.tool_policy.allowed_tools || [];
    const deniedSnapshotTools = new Set(agentBindingSnapshot?.tool_policy.denied_tools || []);
    const requestedSkills = uniqueStrings(node.allowed_skills);
    const requestedTools = resolveNodeAllowedTools(node.config);
    const allowedSkills = agentBindingSnapshot
      ? requestedSkills.length
        ? requestedSkills.filter((skill) => snapshotSkills.includes(skill))
        : snapshotSkills
      : requestedSkills;
    const allowedTools = (agentBindingSnapshot
      ? requestedTools.length
        ? requestedTools.filter((tool) => snapshotTools.includes(tool))
        : snapshotTools
      : requestedTools)
      .filter((tool) => !deniedSnapshotTools.has(tool));
    const requestedAgentId = node.agent_id || null;
    const requestedDefinition = requestedAgentId
      ? getAgentDefinition(requestedAgentId, run.workspace_id)
      : null;
    const registryProvenance = buildBindingProvenance({
      requestedAgentId,
      resolvedAgentId: agentBindingSnapshot?.agent_id || null,
      agentStatus: requestedDefinition?.status || (requestedAgentId ? "missing" : null),
      allowedSkills,
      allowedTools,
    });

    return {
      node_run_id: nodeRunId,
      node_id: node.id,
      name: node.name,
      type: node.type,
      agent_id: agentBindingSnapshot?.agent_id || node.agent_id || null,
      agent_version: agentBindingSnapshot?.agent_version || null,
      agent_binding_snapshot: agentBindingSnapshot,
      runtime_agent_ref: runtimeAgentRef,
      agent_runtime: providerConnection?.agent_runtime || "local",
      harness_profile: null,
      provider_connection: providerConnection,
      allowed_skills: allowedSkills,
      allowed_tools: allowedTools,
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
      execution_ref: createEmptyExecutionRef(),
      registry_provenance: registryProvenance,
      work_package: compileWorkPackage(node, index),
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
      agent_binding_schema_version: 2,
      legacy_profile_fallback_reads: 0,
    },
    status: run.status,
    created_at: run.created_at,
  };
}
