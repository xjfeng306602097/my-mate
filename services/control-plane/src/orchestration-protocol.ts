import { randomUUID } from "node:crypto";
import {
  addAgentDagTask,
  createAgentDag,
  getAgentDag,
  removeAgentDagDraft,
  saveAgentDag,
} from "./agent-orchestration-store.js";
import { createAgentBindingSnapshot, getAgentDefinition, getAgentVersion } from "./agent-runtime-store.js";
import type {
  AgentAutonomyMode,
  AgentBindingSnapshot,
  AgentDagCondition,
  AgentDagJoinPolicy,
  AgentDagStateMapping,
  AgentHumanGateConfig,
  AgentDagRecord,
  AgentRole,
  DagDefinition,
  DagDefinitionNode,
  DagProposalAssignment,
  DagProposalRecord,
  MissionSpecContract,
  OrchestrationDecision,
  OrchestrationDecisionMode,
  WorkflowTemplateRecord,
} from "./types.js";
import { isPlainObject, nowIso } from "./utils.js";
import { assertContractValue, compileContractSchema } from "./dag-state-contract.js";

const AGENT_ROLES = new Set<AgentRole>(["orchestrator", "supervisor", "worker", "reviewer", "specialist"]);
const AUTONOMY_MODES = new Set<AgentAutonomyMode>(["review_first", "assisted", "autopilot"]);
const LEGACY_TOOL_ALIASES: Record<string, string> = {
  read: "workspace_read_text",
  write: "workspace_apply_operations",
  shell: "workspace_run_command",
  list: "workspace_list",
  search: "workspace_search",
};

function normalizeToolName(value: string): string {
  return LEGACY_TOOL_ALIASES[value.trim()] || value.trim();
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()))]
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function retryPolicy(value: unknown) {
  const candidate = record(value);
  return {
    max_attempts: Number.isInteger(candidate.max_attempts) && Number(candidate.max_attempts) > 0
      ? Math.min(10, Number(candidate.max_attempts))
      : 1,
    backoff_seconds: Number.isInteger(candidate.backoff_seconds) && Number(candidate.backoff_seconds) >= 0
      ? Math.min(300, Number(candidate.backoff_seconds))
      : 0,
  };
}

function parseContract(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : { description: value.trim() };
  } catch {
    return { description: value.trim() };
  }
}

function nodeKind(value: unknown, role: AgentRole | null): DagDefinitionNode["kind"] {
  if (value === "end" || value === "start") return "end";
  if (value === "approval" || value === "human_input") return "human_gate";
  if (value === "condition") return "condition";
  if (value === "fanout") return "fanout";
  if (value === "reducer") return "combine";
  if (role === "reviewer") return "reviewer";
  return "agent_task";
}

function role(value: unknown): AgentRole | null {
  return typeof value === "string" && AGENT_ROLES.has(value as AgentRole) ? value as AgentRole : null;
}

function autonomy(value: unknown): AgentAutonomyMode {
  return typeof value === "string" && AUTONOMY_MODES.has(value as AgentAutonomyMode)
    ? value as AgentAutonomyMode
    : "assisted";
}

function joinPolicy(value: unknown): AgentDagJoinPolicy {
  return value === "any" || value === "quorum" ? value : "all";
}

function condition(value: unknown): AgentDagCondition | null {
  const item = record(value);
  const operator = item.operator;
  if (typeof item.path !== "string" || !item.path.trim()) return null;
  if (!['exists', 'truthy', 'equals', 'not_equals', 'contains'].includes(String(operator))) return null;
  return { path: item.path.trim(), operator: operator as AgentDagCondition["operator"], ...(Object.hasOwn(item, "value") ? { value: item.value } : {}) };
}

function stateMappings(value: unknown): AgentDagStateMapping[] {
  return Array.isArray(value) ? value.filter(isPlainObject).flatMap((item) => {
    const sourcePath = typeof item.source_path === "string" ? item.source_path.trim() : "";
    const targetPath = typeof item.target_path === "string" ? item.target_path.trim() : "";
    if (!sourcePath || !targetPath) return [];
    const reducer = item.reducer === "merge" || item.reducer === "append" ? item.reducer : "replace";
    return [{ source_path: sourcePath, target_path: targetPath, reducer }];
  }) : [];
}

function humanGate(value: unknown, objective: string): AgentHumanGateConfig | null {
  const item = record(value);
  if (!Object.keys(item).length) return null;
  return {
    gate_type: item.gate_type === "input" ? "input" : "approval",
    prompt: typeof item.prompt === "string" && item.prompt.trim() ? item.prompt.trim().slice(0, 4_000) : objective,
    input_schema: record(item.input_schema),
    auto_resume: item.auto_resume !== false,
  };
}

export function createOrchestrationDecision(input: {
  missionSpec: MissionSpecContract | null;
  mode: OrchestrationDecisionMode;
  selectedTemplateId?: string | null;
  requiredCapabilities?: string[];
  reason?: string;
  requiresDag?: boolean;
  riskLevel?: OrchestrationDecision["risk_level"];
  approvalRequired?: boolean;
  evidence?: OrchestrationDecision["evidence"];
}): OrchestrationDecision {
  return {
    schema_version: 1,
    decision_id: `orch_decision_${randomUUID()}`,
    mission_spec_id: input.missionSpec?.specId || null,
    mode: input.mode,
    requires_dag: input.requiresDag !== false,
    reason: input.reason?.trim() || "The task requires explicit orchestration before execution.",
    selected_template_id: input.selectedTemplateId?.trim() || null,
    required_capabilities: strings(input.requiredCapabilities),
    risk_level: input.riskLevel || "medium",
    approval_required: input.approvalRequired !== false,
    ...(input.evidence ? { policy_version: "orchestration-policy-v1", evidence: input.evidence } : {}),
    created_at: nowIso(),
  };
}

export function dagDefinitionFromPlannerDraft(input: {
  plannerDraft: Record<string, unknown>;
  assignments: DagProposalAssignment[];
  missionSpec: MissionSpecContract | null;
  sourceKind: "template" | "model";
  templateId?: string | null;
  sourceMessageId?: string | null;
  title: string;
  objective: string;
}): DagDefinition {
  const draftTemplate = record(input.plannerDraft.draft_template);
  const rawNodes = Array.isArray(draftTemplate.nodes) ? draftTemplate.nodes.filter(isPlainObject) : [];
  const rawEdges = Array.isArray(draftTemplate.edges) ? draftTemplate.edges.filter(isPlainObject) : [];
  const assignments = new Map(input.assignments.map((item) => [item.node_id, item]));
  const retainedIds = new Set(rawNodes.map((item) => String(item.id || "").trim()).filter(Boolean));
  const dependencies = new Map<string, string[]>();
  for (const edge of rawEdges) {
    const from = String(edge.from || "").trim();
    const to = String(edge.to || "").trim();
    if (!from || !to || !retainedIds.has(from) || !retainedIds.has(to)) continue;
    dependencies.set(to, [...(dependencies.get(to) || []), from]);
  }
  const nodes = rawNodes.map((item): DagDefinitionNode => {
    const nodeId = String(item.id || "").trim();
    const assignment = assignments.get(nodeId);
    const config = record(item.config);
    const selectedRole = role(record(item.agent_binding_snapshot).agent_role)
      || role(assignment?.metadata?.agent_role)
      || (assignment?.metadata?.node_type === "reviewer" ? "reviewer" : null);
    const agentId = assignment?.agent_id
      || (typeof item.agent_id === "string" ? item.agent_id : null)
      || (typeof item.agent_profile === "string" ? item.agent_profile : null);
    const kind = nodeKind(item.type, selectedRole);
    const objective = String(config.objective || config.instruction || config.prompt || `${input.objective}\n\nComplete stage: ${String(item.name || nodeId)}.`).trim().slice(0, 32_000);
    return {
      node_id: nodeId,
      name: String(item.name || nodeId || "DAG node").trim().slice(0, 160),
      kind,
      objective,
      agent_selector: kind === "agent_task" || kind === "reviewer" ? {
        agent_id: agentId?.trim() || null,
        agent_version: Number.isInteger(item.agent_version) ? Number(item.agent_version) : null,
        role: selectedRole,
        capability_tags: strings(assignment?.metadata?.capability_tags),
      } : null,
      depends_on: strings(dependencies.get(nodeId)),
      join_policy: joinPolicy(config.join_policy),
      join_quorum: Number.isInteger(config.join_quorum) && Number(config.join_quorum) > 0 ? Number(config.join_quorum) : null,
      condition: condition(config.condition),
      state_input: Object.fromEntries(Object.entries(record(config.state_input)).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      state_output: stateMappings(config.state_output),
      human_gate: kind === "human_gate" ? humanGate(config.human_gate || config, objective) : null,
      retry_policy: retryPolicy(item.retry_policy),
      allowed_tools: (assignment?.allowed_tools || strings(config.allowed_tools)).map(normalizeToolName),
      allowed_skills: assignment?.allowed_skills || strings(item.allowed_skills),
      input_contract: parseContract(assignment?.input_context || config.input_contract),
      output_contract: parseContract(assignment?.output_contract || config.output_contract),
      acceptance_criteria: strings(config.acceptance_criteria),
      verification_steps: strings(config.verification_steps),
      autonomy_mode: autonomy(config.autonomy_mode),
      max_tool_rounds: Number.isInteger(config.max_tool_rounds) ? Number(config.max_tool_rounds) : null,
      max_runtime_seconds: Number.isInteger(item.timeout_seconds) ? Number(item.timeout_seconds) : null,
      reviewer_node_id: typeof config.reviewer_node_id === "string" ? config.reviewer_node_id : null,
      metadata: {
        ...record(assignment?.metadata),
        workflow_node_type: item.type || null,
        workflow_config: config,
      },
    };
  });
  return normalizeDagDefinition({
    schema_version: 1,
    definition_id: `dag_definition_${randomUUID()}`,
    revision: 1,
    source: { kind: input.sourceKind, template_id: input.templateId?.trim() || null, message_id: input.sourceMessageId?.trim() || null },
    title: input.title,
    objective: input.objective,
    nodes,
    state_schema: record(draftTemplate.state_schema),
    initial_state: record(draftTemplate.initial_state),
    policy: record(draftTemplate.policy) as DagDefinition["policy"],
    metadata: { mission_spec_id: input.missionSpec?.specId || null },
    created_at: nowIso(),
  });
}

/** Normalize a legacy WorkflowTemplate into the same canonical proposal input used by model/manual DAGs. */
export function dagDefinitionFromWorkflowTemplate(input: {
  template: WorkflowTemplateRecord;
  missionSpec?: MissionSpecContract | null;
  objective?: string;
  sourceMessageId?: string | null;
  assignments?: DagProposalAssignment[];
}): DagDefinition {
  const template = input.template;
  const assignments = input.assignments || template.nodes.map((node) => {
    const agentId = node.agent_id || node.agent_profile || null;
    const definition = agentId ? getAgentDefinition(agentId, template.workspace_scope) : null;
    const versionNumber = node.agent_version || definition?.published_version || definition?.latest_version || null;
    const version = agentId && versionNumber ? getAgentVersion(agentId, versionNumber, template.workspace_scope) : null;
    return {
      node_id: node.id,
      node_name: node.name,
      agent_id: agentId,
      provider: null,
      model: null,
      allowed_tools: Array.isArray(node.config?.allowed_tools) ? node.config.allowed_tools.filter((item): item is string => typeof item === "string") : [],
      allowed_skills: node.allowed_skills || [],
      input_context: typeof node.config?.input_contract === "string" ? node.config.input_contract : node.config?.input_contract ? JSON.stringify(node.config.input_contract) : null,
      output_contract: node.config?.output_contract ? JSON.stringify(node.config.output_contract) : null,
      metadata: {
        workflow_node_type: node.type,
        agent_role:
          node.agent_binding_snapshot?.agent_role ||
          version?.role ||
          (node.type === "approval" ? "reviewer" : "worker"),
      },
    };
  });
  return dagDefinitionFromPlannerDraft({
    plannerDraft: {
      draft_template: {
        name: template.name,
        description: template.description,
        nodes: template.nodes.map((node) => ({
          ...node,
          config: {
            ...node.config,
            ...(node.type === "approval" || node.approval_kind
              ? { human_gate: { gate_type: "approval", prompt: node.name, input_schema: node.human_input_schema || {}, auto_resume: true } }
              : {}),
          },
        })),
        edges: template.edges,
        state_schema: (template.metadata.state_schema && isPlainObject(template.metadata.state_schema)) ? template.metadata.state_schema : {},
        initial_state: (template.metadata.initial_state && isPlainObject(template.metadata.initial_state)) ? template.metadata.initial_state : {},
        policy: template.policy,
      },
    },
    assignments,
    missionSpec: input.missionSpec || null,
    sourceKind: "template",
    templateId: template.template_id,
    sourceMessageId: input.sourceMessageId || null,
    title: template.name,
    objective: input.objective || template.description,
  });
}

export function upgradeLegacyDagProposal(proposal: DagProposalRecord): DagProposalRecord {
  if (proposal.dag_definition && proposal.orchestration_decision) return proposal;
  const templateId = typeof proposal.metadata.execution_template_id === "string"
    ? proposal.metadata.execution_template_id
    : null;
  const definition = proposal.dag_definition || dagDefinitionFromPlannerDraft({
    plannerDraft: proposal.dag_draft,
    assignments: proposal.assignments,
    missionSpec: proposal.mission_spec_contract,
    sourceKind: templateId ? "template" : "model",
    templateId,
    sourceMessageId: proposal.source_message_id,
    title: proposal.title,
    objective: proposal.mission_spec_contract?.objective || proposal.summary,
  });
  const decision = proposal.orchestration_decision || createOrchestrationDecision({
    missionSpec: proposal.mission_spec_contract,
    mode: templateId ? "template" : "dynamic",
    selectedTemplateId: templateId,
    requiredCapabilities: proposal.assignments.flatMap((assignment) => assignment.allowed_skills),
    reason: "A legacy DAG proposal was normalized into the unified orchestration protocol.",
    requiresDag: true,
    approvalRequired: true,
  });
  return { ...proposal, protocol_version: 1, orchestration_decision: decision, dag_definition: definition };
}

export function normalizeDagDefinition(value: DagDefinition): DagDefinition {
  if (!value || value.schema_version !== 1 || !Array.isArray(value.nodes)) {
    throw Object.assign(new Error("DagDefinition schema_version=1 and nodes are required."), { code: "dag_definition_invalid" });
  }
  const normalized: DagDefinition = {
    schema_version: 1,
    definition_id: value.definition_id?.trim() || `dag_definition_${randomUUID()}`,
    revision: Number.isInteger(value.revision) && value.revision > 0 ? value.revision : 1,
    source: {
      kind: value.source?.kind === "template" || value.source?.kind === "manual" ? value.source.kind : "model",
      template_id: value.source?.template_id?.trim() || null,
      message_id: value.source?.message_id?.trim() || null,
    },
    title: value.title?.trim().slice(0, 160) || "Untitled DAG",
    objective: value.objective?.trim().slice(0, 32_000) || "",
    nodes: value.nodes.map((node) => ({
      node_id: node.node_id?.trim() || "",
      name: node.name?.trim().slice(0, 160) || node.node_id,
      kind: ["agent_task", "reviewer", "human_gate", "condition", "fanout", "combine", "end"].includes(node.kind)
        ? node.kind
        : "agent_task",
      objective: node.objective?.trim().slice(0, 32_000) || node.name,
      agent_selector: node.agent_selector ? {
        agent_id: node.agent_selector.agent_id?.trim() || null,
        agent_version: Number.isInteger(node.agent_selector.agent_version) && Number(node.agent_selector.agent_version) > 0 ? node.agent_selector.agent_version : null,
        role: role(node.agent_selector.role),
        capability_tags: strings(node.agent_selector.capability_tags),
      } : null,
      depends_on: strings(node.depends_on),
      join_policy: joinPolicy(node.join_policy),
      join_quorum: Number.isInteger(node.join_quorum) && Number(node.join_quorum) > 0 ? Number(node.join_quorum) : null,
      condition: condition(node.condition),
      state_input: Object.fromEntries(Object.entries(record(node.state_input)).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      state_output: stateMappings(node.state_output),
      human_gate: node.kind === "human_gate" ? humanGate(node.human_gate, node.objective || node.name) : null,
      retry_policy: retryPolicy(node.retry_policy),
      allowed_tools: strings(node.allowed_tools),
      allowed_skills: strings(node.allowed_skills),
      input_contract: record(node.input_contract),
      output_contract: record(node.output_contract),
      acceptance_criteria: strings(node.acceptance_criteria),
      verification_steps: strings(node.verification_steps),
      autonomy_mode: autonomy(node.autonomy_mode),
      max_tool_rounds: Number.isInteger(node.max_tool_rounds) && Number(node.max_tool_rounds) > 0 ? node.max_tool_rounds : null,
      max_runtime_seconds: Number.isInteger(node.max_runtime_seconds) && Number(node.max_runtime_seconds) >= 30 ? node.max_runtime_seconds : null,
      reviewer_node_id: node.reviewer_node_id?.trim() || null,
      metadata: record(node.metadata),
    })),
    state_schema: record(value.state_schema),
    initial_state: record(value.initial_state),
    policy: record(value.policy) as DagDefinition["policy"],
    metadata: record(value.metadata),
    created_at: value.created_at || nowIso(),
  };
  validateDagDefinition(normalized);
  return normalized;
}

export function validateDagDefinition(definition: DagDefinition): void {
  if (!definition.objective) throw Object.assign(new Error("DagDefinition objective is required."), { code: "dag_definition_objective_missing" });
  const ids = definition.nodes.map((node) => node.node_id);
  if (ids.some((id) => !id)) throw Object.assign(new Error("Every DAG node requires node_id."), { code: "dag_definition_node_id_missing" });
  if (new Set(ids).size !== ids.length) throw Object.assign(new Error("DAG node ids must be unique."), { code: "dag_definition_node_duplicate" });
  const known = new Set(ids);
  for (const node of definition.nodes) {
    if (node.depends_on.some((dependency) => !known.has(dependency) || dependency === node.node_id)) {
      throw Object.assign(new Error(`Node ${node.node_id} has an invalid dependency.`), { code: "dag_definition_dependency_invalid" });
    }
    if ((node.kind === "agent_task" || node.kind === "reviewer") && !node.agent_selector?.agent_id) {
      throw Object.assign(new Error(`Node ${node.node_id} requires an Agent selector.`), { code: "dag_definition_agent_missing" });
    }
    if (node.join_policy === "quorum" && (!node.join_quorum || node.join_quorum > Math.max(1, node.depends_on.length))) {
      throw Object.assign(new Error(`Node ${node.node_id} has an invalid join quorum.`), { code: "dag_definition_join_quorum_invalid" });
    }
    if (node.kind === "human_gate" && !node.human_gate) {
      throw Object.assign(new Error(`Human Gate ${node.node_id} requires configuration.`), { code: "dag_definition_human_gate_invalid" });
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(definition.nodes.map((node) => [node.node_id, node]));
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw Object.assign(new Error("DagDefinition must be acyclic."), { code: "dag_definition_cycle" });
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependency of byId.get(nodeId)?.depends_on || []) visit(dependency);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of ids) visit(nodeId);
}

function topologicalNodes(definition: DagDefinition): DagDefinitionNode[] {
  const result: DagDefinitionNode[] = [];
  const visited = new Set<string>();
  const byId = new Map(definition.nodes.map((node) => [node.node_id, node]));
  const visit = (node: DagDefinitionNode): void => {
    if (visited.has(node.node_id)) return;
    for (const dependency of node.depends_on) {
      const target = byId.get(dependency);
      if (target) visit(target);
    }
    visited.add(node.node_id);
    result.push(node);
  };
  for (const node of definition.nodes) visit(node);
  return result;
}

export function compileDagProposalToAgentDag(input: {
  workspaceId: string;
  proposal: DagProposalRecord;
  orchestratorBinding: AgentBindingSnapshot;
  createdBy: string;
  availableToolNames?: Iterable<string>;
}): AgentDagRecord {
  if (input.proposal.compiled_agent_dag_id) {
    const existing = getAgentDag(input.workspaceId, input.proposal.compiled_agent_dag_id);
    if (existing) return existing;
  }
  if (!input.proposal.dag_definition) {
    throw Object.assign(new Error("The proposal has no canonical DagDefinition."), { code: "dag_definition_missing" });
  }
  const definition = normalizeDagDefinition(input.proposal.dag_definition);
  compileContractSchema(definition.state_schema, "DagDefinition.state_schema");
  assertContractValue(definition.initial_state, definition.state_schema, "DagDefinition.initial_state", true);
  for (const node of definition.nodes) {
    compileContractSchema(node.input_contract, `Node ${node.node_id} input_contract`);
    compileContractSchema(node.output_contract, `Node ${node.node_id} output_contract`);
  }
  const availableTools = input.availableToolNames ? new Set(input.availableToolNames) : null;
  const executable = topologicalNodes(definition).filter((node) => node.kind !== "end");
  if (!executable.length) throw Object.assign(new Error("DagDefinition has no executable Agent nodes."), { code: "dag_definition_empty" });
  const executableIds = new Set(executable.map((node) => node.node_id));
  const planned = executable.map((node) => {
    if (node.depends_on.some((dependency) => !executableIds.has(dependency))) {
      throw Object.assign(new Error(`Node ${node.node_id} depends on a non-executable node.`), { code: "agent_dag_dependency_unsupported" });
    }
    const selector = node.agent_selector;
    const requiresAgent = node.kind === "agent_task" || node.kind === "reviewer";
    const binding = requiresAgent ? createAgentBindingSnapshot({
      workspaceId: input.workspaceId,
      agentId: selector!.agent_id,
      agentVersion: selector!.agent_version,
      bindingMode: "pinned",
    }) : input.orchestratorBinding;
    if (selector?.role && selector.role !== binding.agent_role) {
      throw Object.assign(new Error(`Node ${node.node_id} requires role ${selector.role}, but ${binding.agent_id} is ${binding.agent_role}.`), { code: "agent_role_binding_mismatch" });
    }
    const requestedTools = node.allowed_tools.map(normalizeToolName);
    const missingTools = availableTools ? requestedTools.filter((tool) => !availableTools.has(tool)) : [];
    if (missingTools.length) {
      throw Object.assign(new Error(`Node ${node.node_id} references unavailable tools: ${missingTools.join(", ")}.`), {
        code: "agent_tool_unavailable",
        missing_tools: missingTools,
      });
    }
    return { node, binding };
  });
  let dag: AgentDagRecord | null = null;
  try {
    const proposalInputs = isPlainObject(input.proposal.metadata.inputs)
      ? structuredClone(input.proposal.metadata.inputs)
      : {};
    dag = createAgentDag({
      workspaceId: input.workspaceId,
      sessionId: input.proposal.session_id,
      sourceMessageId: input.proposal.source_message_id,
      idempotencyKey: `proposal:${input.proposal.proposal_id}`,
      teamId: typeof input.proposal.metadata.team_id === "string" ? input.proposal.metadata.team_id : null,
      title: definition.title,
      objective: definition.objective,
      executionContract: input.proposal.mission_spec_contract?.executionContract || null,
      orchestratorBinding: input.orchestratorBinding,
      policy: definition.policy,
      stateSchema: definition.state_schema,
      // Reusable definitions provide defaults; explicit Mission inputs are the
      // authoritative root values consumed by node state_input mappings.
      initialState: { ...structuredClone(definition.initial_state), ...proposalInputs },
      createdBy: input.createdBy,
    });
    const runtimeNodeIds = new Map<string, string>();
    const runtimeTaskIds = new Map<string, string>();
    for (const { node, binding } of planned) {
      const reviewedTaskId = node.kind === "reviewer" && node.depends_on.length
        ? runtimeTaskIds.get(node.depends_on[0]!) || null
        : null;
      const added = addAgentDagTask({
        dag,
        name: node.name,
        objective: node.objective,
        binding,
        role: node.kind === "reviewer" ? "reviewer" : binding.agent_role,
        kind: node.kind,
        dependsOn: node.depends_on.map((dependency) => runtimeNodeIds.get(dependency)!),
        expectedOutput: node.output_contract,
        acceptanceCriteria: node.acceptance_criteria?.length
          ? node.acceptance_criteria
          : binding.capability_policy?.acceptance_criteria || [],
        verificationSteps: node.verification_steps?.length
          ? node.verification_steps
          : binding.capability_policy?.verification_steps || [],
        context: {
          input_contract: node.input_contract,
          allowed_skills: node.allowed_skills,
          definition_node_id: node.node_id,
          proposal_id: input.proposal.proposal_id,
          mission_inputs: isPlainObject(input.proposal.metadata.inputs)
            ? structuredClone(input.proposal.metadata.inputs)
            : {},
          ...(reviewedTaskId ? { review_task_id: reviewedTaskId } : {}),
        },
        requestedAutonomy: node.autonomy_mode,
        allowedTools: node.allowed_tools,
        joinPolicy: node.join_policy,
        joinQuorum: node.join_quorum,
        condition: node.condition,
        stateInput: node.state_input,
        stateOutput: node.state_output,
        humanGate: node.human_gate,
        retryPolicy: node.retry_policy,
        maxToolRounds: node.max_tool_rounds || undefined,
        maxRuntimeSeconds: node.max_runtime_seconds || undefined,
        idempotencyKey: `proposal:${input.proposal.proposal_id}:${node.node_id}`,
      });
      added.node.metadata = {
        ...added.node.metadata,
        ...node.metadata,
        definition_node_id: node.node_id,
        proposal_id: input.proposal.proposal_id,
      };
      runtimeNodeIds.set(node.node_id, added.node.node_id);
      runtimeTaskIds.set(node.node_id, added.task.task_id);
    }
    for (const { node } of planned) {
      const runtimeNode = dag.nodes.find((item) => item.node_id === runtimeNodeIds.get(node.node_id));
      if (runtimeNode && node.reviewer_node_id) runtimeNode.reviewer_node_id = runtimeNodeIds.get(node.reviewer_node_id) || null;
      if (node.kind === "reviewer") {
        for (const dependency of node.depends_on) {
          const reviewedNode = dag.nodes.find((item) => item.node_id === runtimeNodeIds.get(dependency));
          if (reviewedNode) reviewedNode.reviewer_node_id = runtimeNodeIds.get(node.node_id) || null;
        }
      }
    }
    dag.revision = Math.max(dag.revision, definition.revision);
    dag.updated_at = nowIso();
    saveAgentDag(dag);
    return dag;
  } catch (error) {
    if (dag) removeAgentDagDraft(input.workspaceId, dag.dag_id);
    throw error;
  }
}
