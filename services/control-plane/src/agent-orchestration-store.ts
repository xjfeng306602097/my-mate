import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  AGENT_DAG_GATES_DIR,
  AGENT_DAGS_DIR,
  AGENT_MESSAGES_DIR,
  AGENT_RESULTS_DIR,
  AGENT_TASKS_DIR,
  AGENT_TEAMS_DIR,
} from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  AgentArtifactReference,
  AgentAutonomyMode,
  AgentBindingSnapshot,
  AgentDagCondition,
  AgentDagGateRecord,
  AgentDagJoinPolicy,
  AgentDagNode,
  AgentDagRecord,
  AgentDagStateMapping,
  AgentHumanGateConfig,
  AgentMessageEnvelope,
  AgentMessageType,
  AgentResultRecord,
  RetryPolicy,
  AgentRole,
  AgentTaskRecord,
  AgentTeamMember,
  AgentTeamRecord,
  AgentVersionRecord,
} from "./types.js";
import { nowIso, slugify } from "./utils.js";
import { getAgentRun, getAgentVersion, getPublishedAgentVersion, listAgentDefinitions, listAgentRuns, normalizeAgentBindingSnapshot, saveAgentRun } from "./agent-runtime-store.js";
import { getAgentDagLease, reclaimExpiredAgentDagLease } from "./agent-dag-lease-store.js";
import {
  AGENT_DAG_LIFECYCLE,
  AGENT_TASK_LIFECYCLE,
  assertLifecycleTransition,
  parseLifecycleStatus,
} from "@my-mate/shared-types/domain-lifecycle";
import { assertSchemaValid, validateAgentDag, validateAgentTask } from "./validators.js";

const storage = () => getJsonStorageBackend();
const target = (dir: string, id: string) => path.join(dir, `${encodeURIComponent(id)}.json`);
const scopedTarget = (dir: string, workspaceId: string, id: string) => path.join(dir, encodeURIComponent(workspaceId), `${encodeURIComponent(id)}.json`);
const unique = (items: unknown): string[] => Array.isArray(items)
  ? [...new Set(items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
  : [];

function write<T>(file: string, value: T): T { storage().writeJson(file, value); return value; }
function read<T>(file: string): T | null { return storage().exists(file) ? storage().readJson<T>(file) : null; }
function autonomyRank(mode: AgentAutonomyMode): number { return mode === "review_first" ? 0 : mode === "assisted" ? 1 : 2; }
function lowerAutonomy(left: AgentAutonomyMode, right: AgentAutonomyMode): AgentAutonomyMode { return autonomyRank(left) <= autonomyRank(right) ? left : right; }

function normalizeDagNode(node: AgentDagNode): AgentDagNode {
  return {
    ...node,
    status: parseLifecycleStatus(AGENT_TASK_LIFECYCLE, node.status),
    binding_snapshot: normalizeAgentBindingSnapshot(node.binding_snapshot),
    kind: node.kind || (node.role === "reviewer" ? "reviewer" : "agent_task"),
    join_policy: node.join_policy || "all",
    join_quorum: Number.isInteger(node.join_quorum) && Number(node.join_quorum) > 0 ? Number(node.join_quorum) : null,
    condition: node.condition || null,
    state_input: node.state_input || {},
    state_output: Array.isArray(node.state_output) ? node.state_output : [],
    human_gate: node.human_gate || null,
    retry_policy: {
      max_attempts: Number.isInteger(node.retry_policy?.max_attempts) && node.retry_policy.max_attempts > 0
        ? Math.min(10, node.retry_policy.max_attempts)
        : 1,
      backoff_seconds: Number.isInteger(node.retry_policy?.backoff_seconds) && node.retry_policy.backoff_seconds >= 0
        ? Math.min(300, node.retry_policy.backoff_seconds)
        : 0,
    },
  };
}

function normalizeDagRecord(dag: AgentDagRecord): AgentDagRecord {
  const normalized = {
    ...dag,
    status: parseLifecycleStatus(AGENT_DAG_LIFECYCLE, dag.status),
    orchestrator_binding: normalizeAgentBindingSnapshot(dag.orchestrator_binding),
    nodes: (dag.nodes || []).map(normalizeDagNode),
    state_schema: dag.state_schema || {},
    state: dag.state || {},
    state_revision: Number.isInteger(dag.state_revision) ? dag.state_revision : 0,
  };
  assertSchemaValid(validateAgentDag, normalized, "AgentDag");
  return normalized;
}

export const DEFAULT_AGENT_TEAM_POLICY: AgentTeamRecord["policy"] = {
  max_concurrency: 3,
  max_delegation_depth: 1,
  max_total_agent_runs: 24,
  max_total_tool_rounds: 256,
  max_runtime_seconds: 7_200,
  require_reviewer: false,
  cancel_children_on_parent_cancel: true,
};

function normalizeMember(value: AgentTeamMember): AgentTeamMember {
  const roles: AgentRole[] = ["orchestrator", "supervisor", "worker", "reviewer", "specialist"];
  return {
    member_id: value.member_id?.trim() || `member_${randomUUID()}`,
    agent_id: value.agent_id.trim(),
    agent_version: Number.isInteger(value.agent_version) && Number(value.agent_version) > 0 ? value.agent_version : null,
    role: roles.includes(value.role) ? value.role : "worker",
    capability_tags: unique(value.capability_tags),
    required: value.required === true,
  };
}

export function upsertAgentTeam(input: {
  workspaceId: string;
  teamId?: string;
  name: string;
  description?: string;
  orchestratorMemberId: string;
  reviewerMemberIds?: string[];
  members: AgentTeamMember[];
  policy?: Partial<AgentTeamRecord["policy"]>;
  metadata?: Record<string, unknown>;
}): AgentTeamRecord {
  const teamId = slugify(input.teamId || input.name) || `team_${randomUUID()}`;
  const file = scopedTarget(AGENT_TEAMS_DIR, input.workspaceId, teamId);
  const current = read<AgentTeamRecord>(file);
  const members = input.members.map(normalizeMember);
  if (new Set(members.map((item) => item.member_id)).size !== members.length) {
    throw Object.assign(new Error("Agent Team member ids must be unique."), { code: "agent_team_member_duplicate" });
  }
  const orchestrators = members.filter((item) => item.role === "orchestrator");
  if (!members.length || orchestrators.length !== 1 || orchestrators[0]?.member_id !== input.orchestratorMemberId) {
    throw Object.assign(new Error("Agent Team requires one declared orchestrator member."), { code: "agent_team_orchestrator_required" });
  }
  for (const member of members) {
    const version = member.agent_version
      ? getAgentVersion(member.agent_id, member.agent_version, input.workspaceId)
      : getPublishedAgentVersion(member.agent_id, input.workspaceId);
    if (!version) throw Object.assign(new Error(`Agent Team member ${member.agent_id} has no usable published version.`), { code: "agent_team_member_unavailable" });
    if (version.role !== member.role) {
      throw Object.assign(new Error(`Agent Team member ${member.agent_id} is ${version.role}, not ${member.role}.`), { code: "agent_team_member_role_mismatch" });
    }
    member.agent_version = version.version;
  }
  const reviewerIds = unique(input.reviewerMemberIds).filter((id) => members.some((item) => item.member_id === id && item.role === "reviewer"));
  if (unique(input.reviewerMemberIds).length !== reviewerIds.length) {
    throw Object.assign(new Error("Every declared reviewer must reference a reviewer Team member."), { code: "agent_team_reviewer_invalid" });
  }
  const policy = { ...DEFAULT_AGENT_TEAM_POLICY, ...(input.policy || {}) };
  policy.max_concurrency = Math.max(1, Math.min(32, Math.floor(policy.max_concurrency)));
  policy.max_delegation_depth = Math.max(0, Math.min(8, Math.floor(policy.max_delegation_depth)));
  policy.max_total_agent_runs = Math.max(1, Math.min(1_000, Math.floor(policy.max_total_agent_runs)));
  policy.max_total_tool_rounds = Math.max(1, Math.min(100_000, Math.floor(policy.max_total_tool_rounds)));
  policy.max_runtime_seconds = Math.max(60, Math.min(604_800, Math.floor(policy.max_runtime_seconds)));
  const timestamp = nowIso();
  return write(file, {
    team_id: teamId,
    workspace_id: input.workspaceId,
    name: input.name.trim().slice(0, 160),
    description: input.description?.trim().slice(0, 2_000) || "",
    orchestrator_member_id: input.orchestratorMemberId,
    reviewer_member_ids: reviewerIds,
    members,
    policy,
    status: "active",
    metadata: input.metadata || current?.metadata || {},
    created_at: current?.created_at || timestamp,
    updated_at: timestamp,
  });
}

export function listAgentTeams(workspaceId: string): AgentTeamRecord[] {
  return storage().listJsonFiles(path.join(AGENT_TEAMS_DIR, encodeURIComponent(workspaceId)))
    .map((file) => storage().readJson<AgentTeamRecord>(file))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function ensureDefaultExecutionPolicy(
  workspaceId: string,
  options: { isVersionReady?: (version: AgentVersionRecord) => boolean } = {},
): AgentTeamRecord | null {
  const existing = listAgentTeams(workspaceId);
  if (existing.length) return existing.find((item) => item.team_id === "default-execution-policy") || null;
  const definitions = listAgentDefinitions(workspaceId).filter((item) => item.status === "active");
  const versions = definitions.flatMap((definition) => {
    const version = getPublishedAgentVersion(definition.agent_id, workspaceId);
    return version && (!options.isVersionReady || options.isVersionReady(version)) ? [{ definition, version }] : [];
  });
  const orchestrator = versions.find((item) => item.version.role === "orchestrator") || null;
  const worker = ["backend", "research-analyst", "content-writer"].map((id) => versions.find((item) => item.definition.agent_id === id)).find(Boolean)
    || versions.find((item) => item.version.role === "worker" || item.version.role === "specialist")
    || null;
  const reviewer = versions.find((item) => item.version.role === "reviewer") || null;
  if (!orchestrator || !worker) return null;
  const members: AgentTeamMember[] = [
    { member_id: "main", agent_id: orchestrator.definition.agent_id, agent_version: orchestrator.version.version, role: "orchestrator", capability_tags: ["planning", "delegation", "synthesis"], required: true },
    { member_id: "worker", agent_id: worker.definition.agent_id, agent_version: worker.version.version, role: worker.version.role, capability_tags: ["execution"], required: true },
  ];
  if (reviewer) members.push({ member_id: "reviewer", agent_id: reviewer.definition.agent_id, agent_version: reviewer.version.version, role: "reviewer", capability_tags: ["quality", "verification"], required: true });
  return upsertAgentTeam({
    workspaceId,
    teamId: "default-execution-policy",
    name: "Default execution policy",
    description: "Recommended bounded policy for Main Agent delegation, parallel execution, and optional Reviewer verification.",
    orchestratorMemberId: "main",
    reviewerMemberIds: reviewer ? ["reviewer"] : [],
    members,
    policy: { max_concurrency: 3, max_delegation_depth: 2, max_total_agent_runs: 24, max_total_tool_rounds: 256, max_runtime_seconds: 7_200, require_reviewer: Boolean(reviewer), cancel_children_on_parent_cancel: true },
    metadata: { bundled: true, auto_created: true },
  });
}
export function getAgentTeam(workspaceId: string, teamId: string): AgentTeamRecord | null { return read(scopedTarget(AGENT_TEAMS_DIR, workspaceId, teamId)); }

export function createAgentDag(input: {
  workspaceId: string;
  sessionId: string;
  sourceMessageId?: string | null;
  idempotencyKey: string;
  teamId?: string | null;
  title: string;
  objective: string;
  executionContract?: AgentDagRecord["execution_contract"];
  orchestratorBinding: AgentBindingSnapshot;
  parentDagId?: string | null;
  delegationDepth?: number;
  policy?: Partial<AgentTeamRecord["policy"]>;
  stateSchema?: Record<string, unknown>;
  initialState?: Record<string, unknown>;
  createdBy: string;
}): AgentDagRecord {
  const duplicate = listAgentDags(input.workspaceId, input.sessionId).find((item) => item.idempotency_key === input.idempotencyKey);
  if (duplicate) return duplicate;
  const team = input.teamId ? getAgentTeam(input.workspaceId, input.teamId) : null;
  const depth = Math.max(0, Math.floor(input.delegationDepth || 0));
  const policy = { ...(team?.policy || DEFAULT_AGENT_TEAM_POLICY), ...(input.policy || {}) };
  if (depth > policy.max_delegation_depth) throw Object.assign(new Error("Maximum Agent delegation depth exceeded."), { code: "agent_delegation_depth_exceeded" });
  const timestamp = nowIso();
  const dag: AgentDagRecord = {
    schema_version: 1,
    dag_id: `agent_dag_${randomUUID()}`,
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    source_message_id: input.sourceMessageId || null,
    idempotency_key: input.idempotencyKey,
    team_id: team?.team_id || null,
    title: input.title.trim().slice(0, 160),
    objective: input.objective.trim().slice(0, 32_000),
    execution_contract: input.executionContract || null,
    status: "draft",
    orchestrator_binding: input.orchestratorBinding,
    parent_dag_id: input.parentDagId || null,
    delegation_depth: depth,
    nodes: [],
    state_schema: input.stateSchema || {},
    state: input.initialState || {},
    state_revision: 0,
    policy,
    budget_usage: { agent_runs: 0, tool_rounds: 0, runtime_seconds: 0 },
    revision: 1,
    created_by: input.createdBy,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return saveAgentDag(dag);
}

export function saveAgentDag(dag: AgentDagRecord, options: { recovery?: boolean } = {}): AgentDagRecord {
  const normalized = normalizeDagRecord(dag);
  const targetFile = scopedTarget(AGENT_DAGS_DIR, normalized.workspace_id, normalized.dag_id);
  const previousRaw = read<AgentDagRecord>(targetFile);
  if (previousRaw) {
    const previous = normalizeDagRecord(previousRaw);
    assertLifecycleTransition(AGENT_DAG_LIFECYCLE, previous.status, normalized.status, options);
    const previousNodes = new Map(previous.nodes.map((node) => [node.node_id, node]));
    for (const node of normalized.nodes) {
      const previousNode = previousNodes.get(node.node_id);
      if (previousNode) assertLifecycleTransition(AGENT_TASK_LIFECYCLE, previousNode.status, node.status, options);
    }
  }
  for (const node of normalized.nodes) {
    const task = getAgentTask(normalized.workspace_id, node.task_id);
    if (!task || task.dag_id !== normalized.dag_id || task.node_id !== node.node_id) {
      throw Object.assign(new Error(`Agent DAG node ${node.node_id} has no matching AgentTask.`), {
        code: "agent_dag_task_reference_mismatch",
      });
    }
    if (task.status !== node.status) {
      throw Object.assign(new Error(`Agent DAG node ${node.node_id} and AgentTask status differ.`), {
        code: "agent_dag_task_status_mismatch",
      });
    }
    if (task.assigned_agent_run_id) {
      const agentRun = getAgentRun(task.assigned_agent_run_id);
      if (!agentRun || agentRun.workspace_id !== normalized.workspace_id || agentRun.workflow_run_id !== normalized.dag_id || agentRun.node_run_id !== node.node_id) {
        throw Object.assign(new Error(`AgentTask ${task.task_id} has an invalid AgentRun assignment.`), {
          code: "agent_task_run_reference_mismatch",
        });
      }
    }
  }
  return write(targetFile, normalized);
}
export function getAgentDag(workspaceId: string, dagId: string): AgentDagRecord | null {
  const dag = read<AgentDagRecord>(scopedTarget(AGENT_DAGS_DIR, workspaceId, dagId));
  return dag ? normalizeDagRecord(dag) : null;
}
export function listAgentDags(workspaceId: string, sessionId?: string): AgentDagRecord[] {
  return storage().listJsonFiles(path.join(AGENT_DAGS_DIR, encodeURIComponent(workspaceId)))
    .map((file) => normalizeDagRecord(storage().readJson<AgentDagRecord>(file)))
    .filter((item) => !sessionId || item.session_id === sessionId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function removeAgentDagDraft(workspaceId: string, dagId: string): void {
  const dag = getAgentDag(workspaceId, dagId);
  if (!dag) return;
  if (dag.status === "running" || dag.status === "completed") {
    throw Object.assign(new Error("A running or completed Agent DAG cannot be rolled back."), { code: "agent_dag_rollback_forbidden" });
  }
  for (const node of dag.nodes) {
    storage().removeJson(scopedTarget(AGENT_TASKS_DIR, workspaceId, node.task_id));
  }
  const messageDir = path.join(AGENT_MESSAGES_DIR, encodeURIComponent(workspaceId), encodeURIComponent(dagId));
  for (const file of storage().listJsonFiles(messageDir)) storage().removeJson(file);
  storage().removeJson(scopedTarget(AGENT_DAGS_DIR, workspaceId, dagId));
}

export function addAgentDagTask(input: {
  dag: AgentDagRecord;
  name: string;
  objective: string;
  binding: AgentBindingSnapshot;
  role?: AgentRole;
  dependsOn?: string[];
  parentTaskId?: string | null;
  expectedOutput?: Record<string, unknown>;
  acceptanceCriteria?: string[];
  verificationSteps?: string[];
  context?: Record<string, unknown>;
  requestedAutonomy?: AgentAutonomyMode;
  allowedTools?: string[];
  maxToolRounds?: number;
  maxRuntimeSeconds?: number;
  idempotencyKey: string;
  reviewerNodeId?: string | null;
  kind?: AgentDagNode["kind"];
  joinPolicy?: AgentDagJoinPolicy;
  joinQuorum?: number | null;
  condition?: AgentDagCondition | null;
  stateInput?: Record<string, string>;
  stateOutput?: AgentDagStateMapping[];
  humanGate?: AgentHumanGateConfig | null;
  retryPolicy?: RetryPolicy;
}): { dag: AgentDagRecord; task: AgentTaskRecord; node: AgentDagNode } {
  const existing = input.dag.nodes.find((node) => {
    const task = getAgentTask(input.dag.workspace_id, node.task_id);
    return task?.idempotency_key === input.idempotencyKey;
  });
  if (existing) return { dag: input.dag, task: getAgentTask(input.dag.workspace_id, existing.task_id)!, node: existing };
  if (["running", "completed", "cancelled"].includes(input.dag.status)) {
    throw Object.assign(new Error("Agent DAG nodes can only be edited before execution or during recovery."), { code: "agent_dag_not_editable" });
  }
  if (input.dag.nodes.length >= input.dag.policy.max_total_agent_runs) throw Object.assign(new Error("Agent DAG run budget exceeded."), { code: "agent_run_budget_exceeded" });
  const parentTask = input.parentTaskId ? getAgentTask(input.dag.workspace_id, input.parentTaskId) : null;
  if (input.parentTaskId && (!parentTask || parentTask.dag_id !== input.dag.dag_id)) {
    throw Object.assign(new Error("Parent Agent Task must belong to the same DAG."), { code: "agent_parent_task_invalid" });
  }
  const dependencies = unique(input.dependsOn);
  const knownNodeIds = new Set(input.dag.nodes.map((node) => node.node_id));
  if (dependencies.some((nodeId) => !knownNodeIds.has(nodeId))) {
    throw Object.assign(new Error("Every Agent DAG dependency must reference an existing node."), { code: "agent_dag_dependency_invalid" });
  }
  const role = input.role || input.binding.agent_role;
  if (role !== input.binding.agent_role) {
    throw Object.assign(new Error(`DAG role ${role} does not match bound Agent role ${input.binding.agent_role}.`), { code: "agent_role_binding_mismatch" });
  }
  const depth = parentTask ? parentTask.depth + 1 : input.dag.delegation_depth + 1;
  if (depth > input.dag.policy.max_delegation_depth) throw Object.assign(new Error("Maximum Agent delegation depth exceeded."), { code: "agent_delegation_depth_exceeded" });
  const bindingTools = input.binding.tool_policy.allowed_tools;
  const parentTools = parentTask?.permission_ceiling.allowed_tools || input.dag.orchestrator_binding.tool_policy.allowed_tools;
  // `undefined` means inherit the Agent allowlist. An explicit empty array is
  // a least-privilege declaration from the Workflow node and must stay empty.
  const allowed = input.allowedTools === undefined ? bindingTools : unique(input.allowedTools);
  const effectiveTools = allowed.filter((tool) => (!bindingTools.length || bindingTools.includes(tool)) && (!parentTools.length || parentTools.includes(tool)));
  const requestsWorkspaceWrite = effectiveTools.some((tool) => tool === "workspace_apply_operations" || tool === "workspace_run_command");
  const requestedAutonomy = input.requestedAutonomy || "assisted";
  const autonomy = lowerAutonomy(lowerAutonomy(requestedAutonomy, input.binding.autonomy_ceiling), parentTask?.permission_ceiling.autonomy_mode || input.dag.orchestrator_binding.autonomy_ceiling);
  const timestamp = nowIso();
  const previousDagStatus = input.dag.status;
  const nodeId = `node_${randomUUID()}`;
  const task: AgentTaskRecord = {
    task_id: `agent_task_${randomUUID()}`,
    workspace_id: input.dag.workspace_id,
    dag_id: input.dag.dag_id,
    dag_run_id: null,
    node_id: nodeId,
    parent_task_id: parentTask?.task_id || null,
    depth,
    status: "queued",
    title: input.name.trim().slice(0, 160),
    objective: input.objective.trim().slice(0, 32_000),
    context: input.context || {},
    expected_output: input.expectedOutput || {},
    acceptance_criteria: unique(input.acceptanceCriteria?.length ? input.acceptanceCriteria : input.binding.capability_policy?.acceptance_criteria),
    verification_steps: unique(input.verificationSteps?.length ? input.verificationSteps : input.binding.capability_policy?.verification_steps),
    binding_snapshot: input.binding,
    permission_ceiling: {
      autonomy_mode: autonomy,
      allowed_tools: effectiveTools,
      workspace_read: input.binding.workspace_policy.read,
      workspace_write: requestsWorkspaceWrite
        && input.binding.workspace_policy.write
        && (parentTask?.permission_ceiling.workspace_write ?? input.dag.orchestrator_binding.workspace_policy.write),
    },
    budget: { max_tool_rounds: Math.max(1, Math.min(input.maxToolRounds || input.binding.tool_policy.max_tool_rounds || 32, input.dag.policy.max_total_tool_rounds)), max_runtime_seconds: Math.max(30, Math.min(input.maxRuntimeSeconds || input.binding.runtime_policy.timeout_seconds, input.dag.policy.max_runtime_seconds)), max_output_tokens: null },
    assigned_agent_run_id: null,
    idempotency_key: input.idempotencyKey,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const node: AgentDagNode = {
    node_id: nodeId,
    name: task.title,
    task_id: task.task_id,
    binding_snapshot: input.binding,
    role,
    kind: input.kind || (role === "reviewer" ? "reviewer" : "agent_task"),
    depends_on: dependencies,
    join_policy: input.joinPolicy || "all",
    join_quorum: input.joinPolicy === "quorum" ? Math.max(1, Math.min(input.joinQuorum || dependencies.length || 1, dependencies.length || 1)) : null,
    condition: input.condition || null,
    state_input: input.stateInput || {},
    state_output: input.stateOutput || [],
    human_gate: input.humanGate || null,
    retry_policy: {
      max_attempts: Number.isInteger(input.retryPolicy?.max_attempts) && Number(input.retryPolicy?.max_attempts) > 0
        ? Math.min(10, Number(input.retryPolicy?.max_attempts))
        : 1,
      backoff_seconds: Number.isInteger(input.retryPolicy?.backoff_seconds) && Number(input.retryPolicy?.backoff_seconds) >= 0
        ? Math.min(300, Number(input.retryPolicy?.backoff_seconds))
        : 0,
    },
    status: "queued",
    reviewer_node_id: input.reviewerNodeId || null,
    acceptance_criteria: task.acceptance_criteria,
    verification_steps: task.verification_steps,
    metadata: {},
  };
  saveAgentTask(task);
  input.dag.nodes.push(node);
  input.dag.revision += 1;
  input.dag.status = "ready";
  input.dag.updated_at = timestamp;
  saveAgentDag(input.dag, { recovery: previousDagStatus === "failed" || previousDagStatus === "waiting_human" });
  appendAgentMessage({ workspaceId: task.workspace_id, dagId: task.dag_id, taskId: task.task_id, messageType: "task.request", fromAgentRunId: null, toAgentRunId: null, correlationId: task.task_id, causationId: null, idempotencyKey: `task.request:${task.idempotency_key}`, payload: { title: task.title, objective: task.objective, node_id: task.node_id }, artifactRefs: [] });
  return { dag: input.dag, task, node };
}

function normalizeAgentTask(task: AgentTaskRecord): AgentTaskRecord {
  const normalized = {
    ...task,
    status: parseLifecycleStatus(AGENT_TASK_LIFECYCLE, task.status),
    binding_snapshot: normalizeAgentBindingSnapshot(task.binding_snapshot),
  };
  assertSchemaValid(validateAgentTask, normalized, "AgentTask");
  return normalized;
}
export function saveAgentTask(task: AgentTaskRecord, options: { recovery?: boolean } = {}): AgentTaskRecord {
  task.updated_at = nowIso();
  const normalized = normalizeAgentTask(task);
  const targetFile = scopedTarget(AGENT_TASKS_DIR, normalized.workspace_id, normalized.task_id);
  const previousRaw = read<AgentTaskRecord>(targetFile);
  if (previousRaw) {
    const previous = normalizeAgentTask(previousRaw);
    assertLifecycleTransition(AGENT_TASK_LIFECYCLE, previous.status, normalized.status, options);
  }
  return write(targetFile, normalized);
}
export function getAgentTask(workspaceId: string, taskId: string): AgentTaskRecord | null { const task = read<AgentTaskRecord>(scopedTarget(AGENT_TASKS_DIR, workspaceId, taskId)); return task ? normalizeAgentTask(task) : null; }
export function listAgentTasks(workspaceId: string, dagId?: string): AgentTaskRecord[] { return storage().listJsonFiles(path.join(AGENT_TASKS_DIR, encodeURIComponent(workspaceId))).map((file) => normalizeAgentTask(storage().readJson<AgentTaskRecord>(file))).filter((item) => !dagId || item.dag_id === dagId); }

export function appendAgentMessage(input: { workspaceId: string; dagId: string; dagRunId?: string | null; taskId: string; messageType: AgentMessageType; fromAgentRunId?: string | null; toAgentRunId?: string | null; correlationId: string; causationId?: string | null; idempotencyKey: string; payload?: Record<string, unknown>; artifactRefs?: AgentArtifactReference[] }): AgentMessageEnvelope {
  const dir = path.join(AGENT_MESSAGES_DIR, encodeURIComponent(input.workspaceId), encodeURIComponent(input.dagId));
  const duplicate = storage().listJsonFiles(dir).map((file) => storage().readJson<AgentMessageEnvelope>(file)).find((item) => item.idempotency_key === input.idempotencyKey);
  if (duplicate) return duplicate;
  const message: AgentMessageEnvelope = { schema_version: 1, message_id: `agent_message_${randomUUID()}`, message_type: input.messageType, workspace_id: input.workspaceId, dag_id: input.dagId, dag_run_id: input.dagRunId || null, task_id: input.taskId, from_agent_run_id: input.fromAgentRunId || null, to_agent_run_id: input.toAgentRunId || null, correlation_id: input.correlationId, causation_id: input.causationId || null, idempotency_key: input.idempotencyKey, payload: input.payload || {}, artifact_refs: input.artifactRefs || [], created_at: nowIso() };
  return write(target(dir, message.message_id), message);
}
export function listAgentMessages(workspaceId: string, dagId: string): AgentMessageEnvelope[] { return storage().listJsonFiles(path.join(AGENT_MESSAGES_DIR, encodeURIComponent(workspaceId), encodeURIComponent(dagId))).map((file) => storage().readJson<AgentMessageEnvelope>(file)).sort((a, b) => a.created_at.localeCompare(b.created_at)); }

export function createAgentDagGate(input: {
  dag: AgentDagRecord;
  node: AgentDagNode;
  task: AgentTaskRecord;
}): AgentDagGateRecord {
  const existing = listAgentDagGates(input.dag.workspace_id, input.dag.dag_id)
    .find((gate) => gate.node_id === input.node.node_id && gate.status === "pending");
  if (existing) return existing;
  const config = input.node.human_gate;
  if (!config) throw Object.assign(new Error("Human Gate configuration is missing."), { code: "agent_dag_gate_invalid" });
  const gate: AgentDagGateRecord = {
    gate_id: `agent_gate_${randomUUID()}`,
    workspace_id: input.dag.workspace_id,
    dag_id: input.dag.dag_id,
    node_id: input.node.node_id,
    task_id: input.task.task_id,
    gate_type: config.gate_type,
    status: "pending",
    prompt: config.prompt,
    input_schema: config.input_schema,
    response: null,
    auto_resume: config.auto_resume,
    created_at: nowIso(),
    resolved_at: null,
    resolved_by: null,
  };
  write(scopedTarget(AGENT_DAG_GATES_DIR, gate.workspace_id, gate.gate_id), gate);
  appendAgentMessage({ workspaceId: gate.workspace_id, dagId: gate.dag_id, taskId: gate.task_id, messageType: "gate.requested", correlationId: gate.gate_id, idempotencyKey: `gate.requested:${gate.gate_id}`, payload: { gate_id: gate.gate_id, gate_type: gate.gate_type, prompt: gate.prompt }, artifactRefs: [] });
  return gate;
}

export function getAgentDagGate(workspaceId: string, gateId: string): AgentDagGateRecord | null {
  return read(scopedTarget(AGENT_DAG_GATES_DIR, workspaceId, gateId));
}

export function listAgentDagGates(workspaceId: string, dagId?: string): AgentDagGateRecord[] {
  return storage().listJsonFiles(path.join(AGENT_DAG_GATES_DIR, encodeURIComponent(workspaceId)))
    .map((file) => storage().readJson<AgentDagGateRecord>(file))
    .filter((gate) => !dagId || gate.dag_id === dagId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function resolveAgentDagGate(input: {
  workspaceId: string;
  gateId: string;
  approved: boolean;
  response?: Record<string, unknown>;
  resolvedBy: string;
}): AgentDagGateRecord {
  const gate = getAgentDagGate(input.workspaceId, input.gateId);
  if (!gate) throw Object.assign(new Error("Agent DAG Gate not found."), { code: "agent_dag_gate_not_found" });
  if (gate.status !== "pending") throw Object.assign(new Error("Agent DAG Gate is not pending."), { code: "agent_dag_gate_not_pending" });
  gate.status = input.approved ? (gate.gate_type === "input" ? "submitted" : "approved") : "rejected";
  gate.response = input.response || {};
  gate.resolved_at = nowIso();
  gate.resolved_by = input.resolvedBy;
  write(scopedTarget(AGENT_DAG_GATES_DIR, gate.workspace_id, gate.gate_id), gate);
  appendAgentMessage({ workspaceId: gate.workspace_id, dagId: gate.dag_id, taskId: gate.task_id, messageType: "gate.resolved", correlationId: gate.gate_id, idempotencyKey: `gate.resolved:${gate.gate_id}`, payload: { gate_id: gate.gate_id, status: gate.status, response: gate.response || {} }, artifactRefs: [] });
  return gate;
}

export function saveAgentResult(input: Omit<AgentResultRecord, "result_id" | "created_at">): AgentResultRecord {
  const current = storage().listJsonFiles(path.join(AGENT_RESULTS_DIR, encodeURIComponent(input.task_id))).map((file) => storage().readJson<AgentResultRecord>(file)).find((item) => item.agent_run_id === input.agent_run_id);
  if (current) return current;
  const result: AgentResultRecord = { ...input, result_id: `agent_result_${randomUUID()}`, created_at: nowIso() };
  return write(path.join(AGENT_RESULTS_DIR, encodeURIComponent(input.task_id), `${encodeURIComponent(result.result_id)}.json`), result);
}
export function listAgentResults(taskId: string): AgentResultRecord[] {
  return storage().listJsonFiles(path.join(AGENT_RESULTS_DIR, encodeURIComponent(taskId)))
    .map((file) => storage().readJson<AgentResultRecord>(file))
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.result_id.localeCompare(right.result_id));
}
export function verifyAgentTaskResult(taskId: string, reviewerAgentRunId: string, evidence: Record<string, unknown>, accepted = true): AgentResultRecord | null {
  const result = listAgentResults(taskId).at(-1) || null;
  if (!result) return null;
  result.verification = {
    status: accepted ? "verified" : "rejected",
    reviewer_agent_run_id: reviewerAgentRunId,
    evidence: { ...(result.verification.evidence || {}), ...evidence },
  };
  return write(path.join(AGENT_RESULTS_DIR, encodeURIComponent(taskId), `${encodeURIComponent(result.result_id)}.json`), result);
}

export function cancelAgentDag(workspaceId: string, dagId: string, reason: string): AgentDagRecord {
  return cancelAgentDagInternal(workspaceId, dagId, reason, new Set());
}

function cancelAgentDagInternal(workspaceId: string, dagId: string, reason: string, visited: Set<string>): AgentDagRecord {
  const dag = getAgentDag(workspaceId, dagId);
  if (!dag) throw Object.assign(new Error("Agent DAG not found."), { code: "agent_dag_not_found" });
  if (visited.has(dagId)) return dag;
  visited.add(dagId);
  dag.status = "cancelled";
  dag.updated_at = nowIso();
  for (const node of dag.nodes) {
    if (["completed", "failed", "cancelled"].includes(node.status)) continue;
    node.status = "cancelled";
    const task = getAgentTask(workspaceId, node.task_id);
    if (task) { task.status = "cancelled"; saveAgentTask(task); appendAgentMessage({ workspaceId, dagId, taskId: task.task_id, messageType: "task.cancel", correlationId: task.task_id, idempotencyKey: `task.cancel:${task.task_id}`, payload: { reason }, artifactRefs: [] }); }
  }
  for (const run of listAgentRuns(workspaceId).filter((item) => item.workflow_run_id === dagId && !["completed", "failed", "cancelled"].includes(item.status))) {
    run.status = "cancelled";
    run.error_code = "agent_dag_cancelled";
    run.error_message = reason.slice(0, 2_000);
    run.finished_at = nowIso();
    saveAgentRun(run);
  }
  if (dag.policy.cancel_children_on_parent_cancel) {
    for (const child of listAgentDags(workspaceId).filter((item) => item.parent_dag_id === dagId && !["completed", "failed", "cancelled"].includes(item.status))) {
      cancelAgentDagInternal(workspaceId, child.dag_id, `Parent DAG ${dagId} was cancelled: ${reason}`, visited);
    }
  }
  return saveAgentDag(dag);
}

export function retryAgentDag(workspaceId: string, dagId: string, reason: string): AgentDagRecord {
  const dag = getAgentDag(workspaceId, dagId);
  if (!dag) throw Object.assign(new Error("Agent DAG not found."), { code: "agent_dag_not_found" });
  if (dag.status !== "failed" && dag.status !== "waiting_human") {
    throw Object.assign(new Error("Only failed or waiting Agent DAGs can enter recovery."), { code: "agent_dag_not_retryable" });
  }
  const retryable = dag.nodes.filter((node) => node.status === "failed" || node.status === "blocked");
  if (!retryable.length) {
    throw Object.assign(new Error("Agent DAG has no failed or blocked nodes to retry."), { code: "agent_dag_not_retryable" });
  }
  const recoveryNodeIds = new Set(retryable.map((node) => node.node_id));
  let discoveredDownstream = true;
  while (discoveredDownstream) {
    discoveredDownstream = false;
    for (const node of dag.nodes) {
      if (
        recoveryNodeIds.has(node.node_id) ||
        node.status !== "skipped" ||
        node.metadata.skipped_reason !== "dependency_not_satisfied" ||
        !node.depends_on.some((dependency) => recoveryNodeIds.has(dependency))
      ) continue;
      recoveryNodeIds.add(node.node_id);
      discoveredDownstream = true;
    }
  }
  const timestamp = nowIso();
  for (const node of dag.nodes.filter((item) => recoveryNodeIds.has(item.node_id))) {
    const dependencyRecovery = node.status === "skipped";
    node.status = "queued";
    const metadata = { ...node.metadata };
    delete metadata.skipped_reason;
    delete metadata.skipped_at;
    delete metadata.retry_not_before;
    node.metadata = {
      ...metadata,
      recovery_reason: reason,
      retried_at: timestamp,
      ...(dependencyRecovery ? { recovered_downstream: true } : {}),
    };
    const task = getAgentTask(workspaceId, node.task_id);
    if (!task) continue;
    task.status = "queued";
    task.assigned_agent_run_id = null;
    saveAgentTask(task, { recovery: true });
    appendAgentMessage({ workspaceId, dagId, taskId: task.task_id, messageType: "task.progress", correlationId: task.task_id, idempotencyKey: `task.retry:${task.task_id}:${dag.revision + 1}`, payload: { state: dependencyRecovery ? "queued_after_dependency_recovery" : "queued_for_retry", reason }, artifactRefs: [] });
  }
  dag.status = "ready";
  dag.revision += 1;
  dag.updated_at = timestamp;
  return saveAgentDag(dag, { recovery: true });
}

export function recoverInterruptedAgentDags(workspaceId?: string): AgentDagRecord[] {
  const workspaceIds = workspaceId
    ? [workspaceId]
    : storage().listJsonFiles(AGENT_DAGS_DIR).map((file) => path.basename(path.dirname(file))).filter(Boolean);
  const recovered: AgentDagRecord[] = [];
  for (const currentWorkspaceId of [...new Set(workspaceIds)]) {
    for (const dag of listAgentDags(currentWorkspaceId).filter((item) => item.status === "running")) {
      const lease = getAgentDagLease(currentWorkspaceId, dag.dag_id);
      if (lease && Date.parse(lease.expires_at) > Date.now() && lease.status === "active") continue;
      reclaimExpiredAgentDagLease(currentWorkspaceId, dag.dag_id);
      const timestamp = nowIso();
      let changed = false;
      for (const node of dag.nodes) {
        if (node.status !== "running" && node.status !== "accepted") continue;
        node.status = "queued";
        node.metadata = { ...node.metadata, recovered_after_restart: true, recovered_at: timestamp };
        const task = getAgentTask(currentWorkspaceId, node.task_id);
        if (task) {
          task.status = "queued";
          task.assigned_agent_run_id = null;
          saveAgentTask(task, { recovery: true });
          appendAgentMessage({ workspaceId: currentWorkspaceId, dagId: dag.dag_id, taskId: task.task_id, messageType: "task.progress", correlationId: task.task_id, idempotencyKey: `task.restart-recovery:${task.task_id}:${dag.revision + 1}`, payload: { state: "queued_after_restart" }, artifactRefs: [] });
        }
        changed = true;
      }
      const pendingGate = listAgentDagGates(currentWorkspaceId, dag.dag_id).some((gate) => gate.status === "pending");
      dag.status = pendingGate ? "waiting_human" : "ready";
      if (changed) dag.revision += 1;
      dag.updated_at = timestamp;
      recovered.push(saveAgentDag(dag, { recovery: true }));
    }
  }
  return recovered;
}
