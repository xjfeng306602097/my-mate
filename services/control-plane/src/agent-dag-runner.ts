import type { ConversationStreamTurnInput, ConversationStreamTurnResult } from "./app.js";
import {
  appendAgentMessage,
  cancelAgentDag,
  createAgentDagGate,
  getAgentDag,
  getAgentTask,
  listAgentDagGates,
  listAgentResults,
  saveAgentDag,
  saveAgentResult,
  saveAgentTask,
  retryAgentDag,
  verifyAgentTaskResult,
} from "./agent-orchestration-store.js";
import { createAgentRun, listAgentRuns, saveAgentRun } from "./agent-runtime-store.js";
import { listConversationActions } from "./conversation-action-store.js";
import { appendAgentRunEvent } from "./agent-run-event-store.js";
import { getConversationToolDefinitions } from "./conversation-tools.js";
import { listSessionAttachments } from "./session-attachment-store.js";
import { createSession, getSession, saveSession } from "./session-store.js";
import { runJsonStorageTransaction } from "./storage-backend.js";
import type { AgentArtifactReference, AgentDagCondition, AgentDagNode, AgentDagRecord, AgentReviewerVerdict, AgentRunRecord, AgentTaskRecord } from "./types.js";
import { isPlainObject, nowIso } from "./utils.js";
import { assertContractValue, expectedContractArtifacts, normalizeContractSchema } from "./dag-state-contract.js";
import {
  acquireAgentDagLease,
  releaseAgentDagLease,
  renewAgentDagLease,
  type AgentDagExecutionLease,
} from "./agent-dag-lease-store.js";

type TurnHandler = (input: ConversationStreamTurnInput) => Promise<ConversationStreamTurnResult>;

const ALWAYS_BLOCKED_CHILD_TOOLS = new Set([
  "schedule_create", "schedule_update", "schedule_delete",
  "memory_remember", "memory_forget",
  "desktop_application_open",
]);
const DELEGATION_TOOLS = new Set(["dag_create", "dag_add_task", "dag_run", "dag_cancel", "delegate_task"]);
const WRITE_TOOLS = new Set(["workspace_apply_operations", "workspace_run_command"]);

function resultText(result: ConversationStreamTurnResult): string {
  const content = result.assistantMessage.content || {};
  return String(content.text || content.narrative_reply || content.summary || "Sub Agent completed without a textual summary.").trim();
}

function updateSubAgentSessionLifecycle(input: {
  sessionId: string;
  status: "running" | "waiting_human" | "completed" | "failed" | "cancelled";
  objective: string;
  summary?: string;
  taskStatus: AgentTaskRecord["status"];
}): void {
  const session = getSession(input.sessionId);
  if (!session) return;
  const timestamp = nowIso();
  session.status = input.status;
  session.current_goal = session.current_goal || input.objective;
  session.current_plan_summary = input.summary?.trim().slice(0, 2_000) || session.current_plan_summary;
  session.updated_at = timestamp;
  session.metadata = {
    ...(session.metadata || {}),
    working_goal: session.current_goal,
    pending_decision: input.status === "waiting_human" ? "Review the Agent result and provide the requested revision." : null,
    latest_orchestrator_intent: input.status === "running" ? "execute_delegated_task" : "report_delegated_task_result",
    agent_task_status: input.taskStatus,
    agent_task_status_updated_at: timestamp,
  };
  saveSession(session);
}

function artifactReferences(sessionId: string, producerAgentRunId: string): AgentArtifactReference[] {
  return listSessionAttachments(sessionId).filter((item) => {
    const source = item.metadata?.source;
    return source === "conversation_generated_output" || source === "runtime_artifact";
  }).map((item) => ({
    artifact_id: item.attachment_id,
    kind: item.kind,
    name: item.name,
    uri: item.storage_uri || null,
    mime_type: item.mime_type || null,
    sha256: typeof item.metadata?.sha256 === "string" ? item.metadata.sha256 : null,
    size_bytes: item.size_bytes,
    producer_agent_run_id: producerAgentRunId,
    metadata: item.metadata || {},
  }));
}

function allowedTools(dag: AgentDagRecord, task: AgentTaskRecord, node: AgentDagNode): string[] {
  const registered = new Set(getConversationToolDefinitions(task.workspace_id).map((tool) => tool.name));
  const declared = task.permission_ceiling.allowed_tools;
  return [...new Set(declared)].filter((tool) => {
    if (!registered.has(tool)) return false;
    if (ALWAYS_BLOCKED_CHILD_TOOLS.has(tool)) return false;
    if (!task.permission_ceiling.workspace_write && WRITE_TOOLS.has(tool)) return false;
    if (DELEGATION_TOOLS.has(tool)) {
      return node.role === "orchestrator" && task.depth < dag.policy.max_delegation_depth;
    }
    return true;
  });
}

function pathParts(path: string): string[] {
  return path
    .trim()
    .replace(/^\$\.?/u, "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of pathParts(path)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function assignAtPath(target: Record<string, unknown>, path: string, value: unknown, reducer: "replace" | "merge" | "append" = "replace"): void {
  const parts = pathParts(path);
  if (!parts.length) return;
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const key = parts.at(-1)!;
  if (reducer === "append") {
    const existing = Array.isArray(current[key]) ? current[key] as unknown[] : [];
    current[key] = [...existing, ...(Array.isArray(value) ? value : [value])];
  } else if (reducer === "merge" && value && typeof value === "object" && !Array.isArray(value)) {
    const existing = current[key] && typeof current[key] === "object" && !Array.isArray(current[key]) ? current[key] as Record<string, unknown> : {};
    current[key] = { ...existing, ...(value as Record<string, unknown>) };
  } else {
    current[key] = value;
  }
}

function stateOutputValue(output: Record<string, unknown>, sourcePath: string): unknown {
  const direct = valueAtPath(output, sourcePath);
  if (direct !== undefined) return direct;
  const parts = pathParts(sourcePath);
  const outputIndex = parts.indexOf("output");
  if (outputIndex < 0) return undefined;
  const relativePath = parts.slice(outputIndex + 1).join(".");
  return relativePath ? valueAtPath(output, relativePath) : output;
}

function projectNodeStateOutput(dag: AgentDagRecord, node: AgentDagNode, output: Record<string, unknown>, missingOnly = false): boolean {
  let changed = false;
  for (const mapping of node.state_output) {
    if (missingOnly && valueAtPath(dag.state, mapping.target_path) !== undefined) continue;
    const value = stateOutputValue(output, mapping.source_path);
    if (value === undefined) continue;
    assignAtPath(dag.state, mapping.target_path, value, mapping.reducer);
    changed = true;
  }
  return changed;
}

function reconcileCompletedNodeState(dag: AgentDagRecord): boolean {
  let changed = false;
  for (const node of dag.nodes.filter((item) => item.status === "completed" && item.state_output.length)) {
    const task = getAgentTask(dag.workspace_id, node.task_id);
    let output = valueAtPath(dag.state, `nodes.${node.node_id}.output`);
    const hasMissingTarget = node.state_output.some((mapping) => valueAtPath(dag.state, mapping.target_path) === undefined);
    if (hasMissingTarget && task) {
      const result = listAgentResults(task.task_id).at(-1) || null;
      const repaired = result ? parseJsonObject(result.summary) || parseExpectedOutput(result.summary, task.expected_output) : null;
      if (repaired) {
        const current = output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : {};
        output = { ...current, ...repaired };
        assignAtPath(dag.state, `nodes.${node.node_id}.output`, output);
        changed = true;
      }
    }
    if (!output || typeof output !== "object" || Array.isArray(output)) continue;
    changed = projectNodeStateOutput(dag, node, output as Record<string, unknown>, true) || changed;
  }
  if (changed) dag.state_revision += 1;
  return changed;
}

function evaluateCondition(condition: AgentDagCondition | null, state: Record<string, unknown>): boolean {
  if (!condition) return true;
  const actual = valueAtPath(state, condition.path);
  if (condition.operator === "exists") return actual !== undefined && actual !== null;
  if (condition.operator === "truthy") return Boolean(actual);
  if (condition.operator === "equals") return JSON.stringify(actual) === JSON.stringify(condition.value);
  if (condition.operator === "not_equals") return JSON.stringify(actual) !== JSON.stringify(condition.value);
  if (condition.operator === "contains") {
    if (Array.isArray(actual)) return actual.some((item) => JSON.stringify(item) === JSON.stringify(condition.value));
    return typeof actual === "string" && actual.includes(String(condition.value ?? ""));
  }
  return false;
}

function retryNotBefore(node: AgentDagNode): number {
  const value = typeof node.metadata.retry_not_before === "string"
    ? Date.parse(node.metadata.retry_not_before)
    : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

function isRetryableNodeFailure(errorCode: string): boolean {
  if (!errorCode) return true;
  if (/cancel|abort|rejected/iu.test(errorCode)) return false;
  if (/contract|schema|permission|unauthori[sz]ed|forbidden|invalid|missing|not_found|unavailable_tool|role_binding/iu.test(errorCode)) return false;
  return true;
}

async function waitForRetryWindow(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason || new Error("Agent DAG was cancelled."));
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason || new Error("Agent DAG was cancelled."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const candidates = [text.trim(), ...(text.match(/```(?:json)?\s*([\s\S]*?)```/giu) || []).map((block) => block.replace(/^```(?:json)?\s*/iu, "").replace(/```$/u, "").trim())];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Continue to the next structured candidate.
    }
  }
  const objectMatch = text.match(/\{[\s\S]*\}/u)?.[0];
  if (!objectMatch) return null;
  try {
    const parsed = JSON.parse(objectMatch) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseStrictJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseExpectedOutput(text: string, expectedOutput: Record<string, unknown>): Record<string, unknown> | null {
  const keys = Object.keys(expectedOutput);
  if (keys.length !== 1) return null;
  const key = keys[0]!;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const candidates = [
    ...(text.match(/```(?:json)?\s*([\s\S]*?)```/giu) || []).map((block) => block.replace(/^```(?:json)?\s*/iu, "").replace(/```$/u, "").trim()),
    text.trim(),
  ];
  const pattern = new RegExp(`"${escapedKey}"\\s*:\\s*"([\\s\\S]*)"\\s*\\}\\s*$`, "u");
  for (const candidate of candidates) {
    const match = candidate.match(pattern);
    if (!match) continue;
    const value = match[1]!
      .replace(/\\n/gu, "\n")
      .replace(/\\r/gu, "\r")
      .replace(/\\t/gu, "\t")
      .replace(/\\"/gu, '"')
      .replace(/\\\\/gu, "\\");
    if (value.trim()) return { [key]: value };
  }
  return null;
}

function parseReviewerOutput(summary: string): { output: Record<string, unknown>; verdict: AgentReviewerVerdict } | null {
  const parsed = parseStrictJsonObject(summary);
  if (!parsed || (parsed.verdict !== "accepted" && parsed.verdict !== "rejected")) return null;
  if (!Array.isArray(parsed.criteria) || !Array.isArray(parsed.issues) || !Array.isArray(parsed.required_revisions)) return null;
  const criteria = parsed.criteria.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string" || typeof row.passed !== "boolean" || typeof row.detail !== "string") return [];
    return [{ name: row.name, passed: row.passed, detail: row.detail }];
  });
  if (criteria.length !== parsed.criteria.length || parsed.issues.some((item) => typeof item !== "string") || parsed.required_revisions.some((item) => typeof item !== "string")) return null;
  return {
    output: parsed,
    verdict: {
      verdict: parsed.verdict,
      criteria,
      issues: parsed.issues as string[],
      required_revisions: parsed.required_revisions as string[],
    },
  };
}

function successfulDependencyStatus(status: AgentDagNode["status"]): boolean {
  return status === "completed";
}

function assertExecutionEvidence(task: AgentTaskRecord, sessionId: string, output: Record<string, unknown>): void {
  const allowed = new Set(task.permission_ceiling.allowed_tools);
  const actions = listConversationActions(sessionId);
  const fail = (message: string): never => {
    throw Object.assign(new Error(message), { code: "agent_execution_evidence_missing" });
  };

  if (allowed.has("workspace_apply_operations") && Array.isArray(output.files)) {
    if (!output.files.length) {
      fail(`Node ${task.title} declared file output but returned no files.`);
    }
    const wroteWorkspace = actions.some((action) => action.tool_name === "workspace_apply_operations" && action.status === "succeeded");
    if (!wroteWorkspace) {
      fail(`Node ${task.title} reported files without a successful workspace_apply_operations action.`);
    }
  }

  const requiresCommandEvidence = allowed.has("workspace_run_command")
    && [...(task.acceptance_criteria || []), ...(task.verification_steps || [])].some((item) => /\b(?:run|command|execute)\b/iu.test(item));
  if (requiresCommandEvidence) {
    const ranCommand = actions.some((action) => action.tool_name === "workspace_run_command" && action.status === "succeeded");
    if (!ranCommand) {
      fail(`Node ${task.title} requires command evidence but no workspace_run_command action succeeded.`);
    }
  }
}

function compactEvidenceValue(value: unknown, depth = 0): unknown {
  if (depth >= 6) return "[depth limit]";
  if (typeof value === "string") return value.length > 8_000 ? `${value.slice(0, 8_000)}\n...[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => compactEvidenceValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, child]) => [key, compactEvidenceValue(child, depth + 1)]));
}

function actionArgumentsForEvidence(action: ReturnType<typeof listConversationActions>[number]): Record<string, unknown> {
  if (action.tool_name === "workspace_apply_operations") {
    const operations = Array.isArray(action.arguments.operations) ? action.arguments.operations : [];
    return {
      idempotency_key: action.arguments.idempotency_key || null,
      operations: operations.map((operation) => {
        if (!operation || typeof operation !== "object" || Array.isArray(operation)) return operation;
        const row = operation as Record<string, unknown>;
        return {
          kind: row.kind || null,
          path: row.path || null,
          from: row.from || null,
          to: row.to || null,
          content_bytes: typeof row.content === "string" ? Buffer.byteLength(row.content, "utf8") : null,
        };
      }),
    };
  }
  if (action.tool_name === "workspace_run_command") {
    return {
      idempotency_key: action.arguments.idempotency_key || null,
      command: action.arguments.command || null,
      args: action.arguments.args || [],
      cwd: action.arguments.cwd || ".",
      timeout_seconds: action.arguments.timeout_seconds || null,
      network: action.arguments.network || null,
    };
  }
  return compactEvidenceValue(action.arguments) as Record<string, unknown>;
}

function executionEvidenceForSession(sessionId: string): Record<string, unknown> {
  const actions = listConversationActions(sessionId);
  return {
    session_id: sessionId,
    action_count: actions.length,
    actions: actions.map((action) => ({
      action_id: action.action_id,
      tool_name: action.tool_name,
      status: action.status,
      executor: action.executor,
      risk_level: action.risk_level,
      arguments: actionArgumentsForEvidence(action),
      result: compactEvidenceValue(action.result),
      error_code: action.error_code,
      completed_at: action.completed_at,
    })),
  };
}

function upstreamNodes(dag: AgentDagRecord, node: AgentDagNode): AgentDagNode[] {
  const collected = new Map<string, AgentDagNode>();
  const visit = (candidate: AgentDagNode): void => {
    for (const dependencyId of candidate.depends_on) {
      const dependency = dag.nodes.find((item) => item.node_id === dependencyId);
      if (!dependency || collected.has(dependency.node_id)) continue;
      visit(dependency);
      collected.set(dependency.node_id, dependency);
    }
  };
  visit(node);
  return [...collected.values()];
}

function reviewerEvidenceBundle(dag: AgentDagRecord, node: AgentDagNode): Record<string, unknown> {
  return {
    dag_id: dag.dag_id,
    evidence_snapshot_revision: dag.state_revision,
    revision_semantics: "This revision identifies when the evidence bundle was assembled. It naturally advances after upstream nodes complete; an upstream result may cite an earlier revision without being stale or invalid.",
    upstream_nodes: upstreamNodes(dag, node).map((upstream) => {
      const upstreamTask = getAgentTask(dag.workspace_id, upstream.task_id);
      const result = upstreamTask ? listAgentResults(upstreamTask.task_id).at(-1) || null : null;
      const sessionId = typeof result?.output.session_id === "string" ? result.output.session_id : null;
      const controlResult = upstream.metadata.control_output
        ? {
            result_id: `control:${upstream.node_id}`,
            status: upstream.status,
            summary: `${upstream.kind} control step completed.`,
            output: compactEvidenceValue(upstream.metadata.control_output),
            artifact_refs: [],
            verification: { status: "control_plane_verified" },
          }
        : null;
      return {
        node_id: upstream.node_id,
        node_name: upstream.name,
        node_status: upstream.status,
        task_id: upstream.task_id,
        task_status: upstreamTask?.status || null,
        acceptance_criteria: upstreamTask?.acceptance_criteria || [],
        verification_steps: upstreamTask?.verification_steps || [],
        result: result ? {
          result_id: result.result_id,
          status: result.status,
          summary: compactEvidenceValue(result.summary),
          output: compactEvidenceValue(result.output),
          artifact_refs: compactEvidenceValue(result.artifact_refs),
          verification: compactEvidenceValue(result.verification),
        } : controlResult,
        execution: sessionId ? executionEvidenceForSession(sessionId) : null,
      };
    }),
  };
}

function dependencyResultBundle(dag: AgentDagRecord, node: AgentDagNode): Record<string, unknown> {
  return {
    dag_id: dag.dag_id,
    state_revision: dag.state_revision,
    dependencies: node.depends_on.map((dependencyId) => {
      const dependency = dag.nodes.find((candidate) => candidate.node_id === dependencyId) || null;
      const task = dependency ? getAgentTask(dag.workspace_id, dependency.task_id) : null;
      const result = task ? listAgentResults(task.task_id).at(-1) || null : null;
      return {
        node_id: dependencyId,
        node_name: dependency?.name || null,
        node_status: dependency?.status || null,
        result: result ? {
          result_id: result.result_id,
          status: result.status,
          summary: compactEvidenceValue(result.summary),
          output: compactEvidenceValue(result.output),
          artifact_refs: compactEvidenceValue(result.artifact_refs),
        } : dependency?.metadata.control_output
          ? { status: dependency.status, output: compactEvidenceValue(dependency.metadata.control_output) }
          : null,
      };
    }),
  };
}

function resolvedDependencyStatus(status: AgentDagNode["status"]): boolean {
  return status === "completed" || status === "skipped" || status === "failed" || status === "cancelled";
}

function dependenciesSatisfied(dag: AgentDagRecord, node: AgentDagNode): boolean {
  if (!node.depends_on.length) return true;
  const dependencies = node.depends_on.map((dependency) => dag.nodes.find((candidate) => candidate.node_id === dependency)).filter(Boolean) as AgentDagNode[];
  const completed = dependencies.filter((dependency) => successfulDependencyStatus(dependency.status)).length;
  if (node.join_policy === "any") return completed >= 1;
  if (node.join_policy === "quorum") return completed >= (node.join_quorum || dependencies.length);
  return completed === dependencies.length;
}

function dependenciesResolved(dag: AgentDagRecord, node: AgentDagNode): boolean {
  if (!node.depends_on.length) return true;
  const dependencies = node.depends_on
    .map((dependency) => dag.nodes.find((candidate) => candidate.node_id === dependency))
    .filter(Boolean) as AgentDagNode[];
  return dependencies.length === node.depends_on.length
    && dependencies.every((dependency) => resolvedDependencyStatus(dependency.status));
}

function requiresAgentExecution(node: AgentDagNode): boolean {
  return node.kind === "agent_task" || node.kind === "reviewer";
}

interface AgentDagFanoutConfig {
  itemsPath: string;
  itemKey: string;
  indexKey: string;
  maxIterations: number;
  concurrency: number;
}

function fanoutConfig(node: AgentDagNode): AgentDagFanoutConfig | null {
  const workflowConfig = node.metadata.workflow_config && typeof node.metadata.workflow_config === "object"
    ? node.metadata.workflow_config as Record<string, unknown>
    : {};
  const loop = workflowConfig.loop && typeof workflowConfig.loop === "object" && !Array.isArray(workflowConfig.loop)
    ? workflowConfig.loop as Record<string, unknown>
    : null;
  if (!loop) return null;
  const positiveInteger = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  return {
    itemsPath: typeof loop.items_path === "string" && loop.items_path.trim() ? loop.items_path.trim() : "items",
    itemKey: typeof loop.item_key === "string" && loop.item_key.trim() ? loop.item_key.trim() : "item",
    indexKey: typeof loop.index_key === "string" && loop.index_key.trim() ? loop.index_key.trim() : "index",
    maxIterations: positiveInteger(loop.max_iterations, 10),
    concurrency: positiveInteger(loop.concurrency, 1),
  };
}

function materializeAgentDagFanout(input: {
  dag: AgentDagRecord;
  sourceNode: AgentDagNode;
  sourceTask: AgentTaskRecord;
  config: AgentDagFanoutConfig;
}): { itemCount: number; generatedNodeCount: number; branchCount: number } {
  const { dag, sourceNode, sourceTask, config } = input;
  const alreadyMaterialized = sourceNode.metadata.dynamic_fanout;
  if (alreadyMaterialized && typeof alreadyMaterialized === "object" && !Array.isArray(alreadyMaterialized)) {
    const record = alreadyMaterialized as Record<string, unknown>;
    return {
      itemCount: Number(record.item_count || 0),
      generatedNodeCount: Number(record.generated_node_count || 0),
      branchCount: Number(record.branch_count || 0),
    };
  }
  const items = valueAtPath(dag.state, config.itemsPath);
  if (!Array.isArray(items)) {
    throw Object.assign(
      new Error(`Loop items path ${config.itemsPath} did not resolve to an array.`),
      { code: "agent_dag_fanout_items_invalid" },
    );
  }
  if (items.length > config.maxIterations) {
    throw Object.assign(
      new Error(`Loop produced ${items.length} items, exceeding max_iterations ${config.maxIterations}.`),
      { code: "agent_dag_fanout_limit_exceeded" },
    );
  }
  const branchRoots = dag.nodes.filter((candidate) => candidate.depends_on.includes(sourceNode.node_id));
  const rootIds = new Set(branchRoots.map((candidate) => candidate.node_id));
  if (branchRoots.some((root) => root.depends_on.some((dependency) => rootIds.has(dependency)))) {
    throw Object.assign(
      new Error("Loop downstream branch roots cannot depend on one another."),
      { code: "agent_dag_fanout_branch_ambiguous" },
    );
  }
  const branchTasks = new Map(branchRoots.map((root) => [root.node_id, getAgentTask(dag.workspace_id, root.task_id)]));
  const missingBranch = branchRoots.find((root) => !branchTasks.get(root.node_id));
  if (missingBranch) {
    throw Object.assign(new Error(`Loop branch task ${missingBranch.task_id} was not found.`), { code: "agent_dag_fanout_task_missing" });
  }
  const additionalAgentRuns = Math.max(0, items.length - 1) * branchRoots.filter(requiresAgentExecution).length;
  const existingAgentRuns = dag.nodes.filter(requiresAgentExecution).length;
  if (existingAgentRuns + additionalAgentRuns > dag.policy.max_total_agent_runs) {
    throw Object.assign(
      new Error(`Loop requires ${existingAgentRuns + additionalAgentRuns} Agent runs, exceeding max_total_agent_runs ${dag.policy.max_total_agent_runs}.`),
      { code: "agent_dag_fanout_budget_exceeded" },
    );
  }

  const fanoutStateBase = `fanout.${sourceNode.node_id}`;
  assignAtPath(dag.state, `${fanoutStateBase}.items`, Object.fromEntries(items.map((item, index) => [`item_${String(index + 1).padStart(3, "0")}`, item])));
  assignAtPath(dag.state, `${fanoutStateBase}.indexes`, Object.fromEntries(items.map((_item, index) => [`index_${String(index + 1).padStart(3, "0")}`, index])));
  const createdAt = nowIso();
  let generatedNodeCount = 0;

  for (const root of branchRoots) {
    const templateTask = branchTasks.get(root.node_id)!;
    const downstream = dag.nodes.filter((candidate) => !rootIds.has(candidate.node_id) && candidate.depends_on.includes(root.node_id));
    if (items.length === 0) {
      root.status = "skipped";
      root.metadata = {
        ...root.metadata,
        skipped_reason: "fanout_empty",
        skipped_at: createdAt,
        dynamic_fanout: { source_node_id: sourceNode.node_id, item_count: 0, item_index: null, concurrency: config.concurrency },
      };
      templateTask.status = "skipped";
      templateTask.context = { ...templateTask.context, fanout_source_node_id: sourceNode.node_id, fanout_item_count: 0 };
      saveAgentTask(templateTask);
      appendAgentMessage({
        workspaceId: dag.workspace_id,
        dagId: dag.dag_id,
        taskId: templateTask.task_id,
        messageType: "task.progress",
        correlationId: templateTask.task_id,
        idempotencyKey: `task.skipped:${root.node_id}:fanout-empty`,
        payload: { state: "skipped", reason: "fanout_empty", source_node_id: sourceNode.node_id },
        artifactRefs: [],
      });
      for (const candidate of downstream) {
        candidate.depends_on = [...new Set(candidate.depends_on.flatMap((dependency) => dependency === root.node_id ? [sourceNode.node_id] : [dependency]))];
      }
      continue;
    }

    const materializedNodeIds: string[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const suffix = String(index + 1).padStart(3, "0");
      const itemPath = `${fanoutStateBase}.items.item_${suffix}`;
      const indexPath = `${fanoutStateBase}.indexes.index_${suffix}`;
      if (index === 0) {
        root.name = `${templateTask.title} 1/${items.length}`;
        root.state_input = { ...root.state_input, [config.itemKey]: itemPath, [config.indexKey]: indexPath };
        root.metadata = {
          ...root.metadata,
          dynamic_fanout: {
            source_node_id: sourceNode.node_id,
            template_node_id: root.node_id,
            item_index: index,
            item_count: items.length,
            concurrency: config.concurrency,
          },
        };
        templateTask.title = root.name;
        templateTask.context = {
          ...templateTask.context,
          fanout_source_node_id: sourceNode.node_id,
          fanout_item: items[index],
          fanout_index: index,
          fanout_item_count: items.length,
        };
        saveAgentTask(templateTask);
        materializedNodeIds.push(root.node_id);
        generatedNodeCount += 1;
        continue;
      }
      const cloneNodeId = `${root.node_id}__fanout_${suffix}`;
      const cloneTaskId = `${templateTask.task_id}__fanout_${suffix}`;
      const cloneTask: AgentTaskRecord = {
        ...structuredClone(templateTask),
        task_id: cloneTaskId,
        node_id: cloneNodeId,
        status: "queued",
        title: `${templateTask.title.replace(/ 1\/\d+$/u, "")} ${index + 1}/${items.length}`,
        context: {
          ...templateTask.context,
          fanout_source_node_id: sourceNode.node_id,
          fanout_item: items[index],
          fanout_index: index,
          fanout_item_count: items.length,
        },
        assigned_agent_run_id: null,
        idempotency_key: `${templateTask.idempotency_key}:fanout:${suffix}`,
        created_at: createdAt,
        updated_at: createdAt,
      };
      const cloneNode: AgentDagNode = {
        ...structuredClone(root),
        node_id: cloneNodeId,
        task_id: cloneTaskId,
        name: cloneTask.title,
        status: "queued",
        state_input: { ...root.state_input, [config.itemKey]: itemPath, [config.indexKey]: indexPath },
        metadata: {
          ...root.metadata,
          dynamic_fanout: {
            source_node_id: sourceNode.node_id,
            template_node_id: root.node_id,
            item_index: index,
            item_count: items.length,
            concurrency: config.concurrency,
          },
        },
      };
      saveAgentTask(cloneTask);
      appendAgentMessage({
        workspaceId: dag.workspace_id,
        dagId: dag.dag_id,
        taskId: cloneTask.task_id,
        messageType: "task.request",
        correlationId: cloneTask.task_id,
        idempotencyKey: `task.request:${cloneTask.idempotency_key}`,
        payload: { title: cloneTask.title, objective: cloneTask.objective, node_id: cloneNode.node_id, fanout_index: index },
        artifactRefs: [],
      });
      dag.nodes.push(cloneNode);
      materializedNodeIds.push(cloneNodeId);
      generatedNodeCount += 1;
    }
    for (const candidate of downstream) {
      candidate.depends_on = [...new Set(candidate.depends_on.flatMap((dependency) => dependency === root.node_id ? materializedNodeIds : [dependency]))];
      if (candidate.join_policy === "quorum" && candidate.join_quorum) {
        candidate.join_quorum = Math.min(candidate.depends_on.length, Math.max(candidate.join_quorum, materializedNodeIds.length));
      }
    }
  }
  sourceNode.metadata = {
    ...sourceNode.metadata,
    dynamic_fanout: {
      items_path: config.itemsPath,
      item_count: items.length,
      generated_node_count: generatedNodeCount,
      branch_count: branchRoots.length,
      concurrency: config.concurrency,
      materialized_at: createdAt,
    },
  };
  sourceTask.context = {
    ...sourceTask.context,
    fanout_items_path: config.itemsPath,
    fanout_item_count: items.length,
    fanout_generated_node_count: generatedNodeCount,
  };
  dag.revision += 1;
  return { itemCount: items.length, generatedNodeCount, branchCount: branchRoots.length };
}

function fanoutConcurrency(node: AgentDagNode): { sourceNodeId: string; limit: number } | null {
  const raw = node.metadata.dynamic_fanout;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.source_node_id !== "string") return null;
  const limit = typeof record.concurrency === "number" && Number.isFinite(record.concurrency)
    ? Math.max(1, Math.floor(record.concurrency))
    : 1;
  return { sourceNodeId: record.source_node_id, limit };
}

function latestMainAgentRun(dag: AgentDagRecord): AgentRunRecord | null {
  return listAgentRuns(dag.workspace_id).find((run) =>
    run.session_id === dag.session_id &&
    run.workflow_run_id === dag.dag_id &&
    run.node_run_id === null &&
    run.binding_snapshot.agent_role === "orchestrator",
  ) || null;
}

function rootSessionIdForDag(dag: AgentDagRecord): string {
  const owner = getSession(dag.session_id);
  return typeof owner?.metadata?.coding_workspace_owner_session_id === "string"
    ? owner.metadata.coding_workspace_owner_session_id
    : dag.session_id;
}

export class AgentDagRunner {
  private readonly running = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly ownerId: string;
  private readonly leaseTtlMs: number;

  constructor(private readonly options: {
    turnHandler: TurnHandler;
    onNodeCompleted?: (input: { sessionId: string; dagId: string; nodeId: string; summary: string; reviewerAccepted: boolean }) => void | Promise<void>;
    onNodeActivity?: (input: {
      parentSessionId: string;
      dagId: string;
      parentDagId: string | null;
      nodeId: string;
      taskId: string;
      agentRunId: string | null;
      childSessionId: string | null;
      status: "started" | "waiting_human" | "completed" | "failed" | "cancelled";
      summary: string;
      agentName: string;
      role: string;
      model: string;
    }) => void | Promise<void>;
    onDagFinished?: (input: { workspaceId: string; sessionId: string; dagId: string; status: AgentDagRecord["status"] }) => void | Promise<void>;
    ownerId?: string;
    leaseTtlMs?: number;
  }) {
    this.ownerId = options.ownerId || `agent-dag-runner:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
    this.leaseTtlMs = Math.max(100, options.leaseTtlMs || Number(process.env.MY_MATE_AGENT_DAG_LEASE_TTL_MS || 30_000));
  }

  private async emitNodeActivity(
    dag: AgentDagRecord,
    node: AgentDagNode,
    task: AgentTaskRecord,
    input: {
      agentRunId?: string | null;
      childSessionId?: string | null;
      status: "started" | "waiting_human" | "completed" | "failed" | "cancelled";
      summary: string;
    },
  ): Promise<void> {
    try {
      await this.options.onNodeActivity?.({
        parentSessionId: rootSessionIdForDag(dag),
        dagId: dag.dag_id,
        parentDagId: dag.parent_dag_id,
        nodeId: node.node_id,
        taskId: task.task_id,
        agentRunId: input.agentRunId || null,
        childSessionId: input.childSessionId || null,
        status: input.status,
        summary: input.summary,
        agentName: task.binding_snapshot.agent_name,
        role: node.role,
        model: task.binding_snapshot.model,
      });
    } catch {
      // Activity projection is observational and must not change DAG execution.
    }
  }

  cancel(input: { workspaceId: string; dagId: string; reason: string }): AgentDagRecord {
    this.controllers.get(input.dagId)?.abort(new Error(input.reason));
    return cancelAgentDag(input.workspaceId, input.dagId, input.reason);
  }

  retry(input: { workspaceId: string; dagId: string; reason: string }): AgentDagRecord {
    return retryAgentDag(input.workspaceId, input.dagId, input.reason);
  }

  async run(input: { workspaceId: string; dagId: string }): Promise<Record<string, unknown>> {
    const dag = getAgentDag(input.workspaceId, input.dagId);
    if (!dag) throw Object.assign(new Error("Agent DAG not found."), { code: "agent_dag_not_found" });
    if (this.running.has(dag.dag_id)) return { ok: true, dag_id: dag.dag_id, status: dag.status, already_running: true };
    if (["completed", "failed", "cancelled"].includes(dag.status)) return { ok: true, dag_id: dag.dag_id, status: dag.status, terminal: true };
    const lease = acquireAgentDagLease({ workspaceId: input.workspaceId, dagId: input.dagId, ownerId: this.ownerId, ttlMs: this.leaseTtlMs });
    if (!lease) {
      return { ok: true, dag_id: dag.dag_id, status: "running", already_running: true, lease_held: true };
    }
    this.running.add(dag.dag_id);
    const controller = new AbortController();
    this.controllers.set(dag.dag_id, controller);
    let activeLease: AgentDagExecutionLease | null = lease;
    const heartbeat = setInterval(() => {
      if (!activeLease) return;
      activeLease = renewAgentDagLease(activeLease, this.leaseTtlMs);
      if (!activeLease && !controller.signal.aborted) {
        controller.abort(new Error("Agent DAG execution lease was lost."));
      }
    }, Math.max(50, Math.floor(this.leaseTtlMs / 3)));
    heartbeat.unref?.();
    try {
      reconcileCompletedNodeState(dag);
      assertContractValue(dag.state, dag.state_schema, "AgentDag state", true);
      runJsonStorageTransaction(() => {
        let mainAgentRun = latestMainAgentRun(dag);
        if (!mainAgentRun) {
          mainAgentRun = createAgentRun({
            workspaceId: dag.workspace_id,
            kind: "conversation",
            bindingSnapshot: dag.orchestrator_binding,
            sessionId: dag.session_id,
            workflowRunId: dag.dag_id,
            nodeRunId: null,
            parentAgentRunId: null,
            metadata: {
              agent_dag_id: dag.dag_id,
              root_orchestrator: true,
              delegation_depth: dag.delegation_depth,
            },
          });
        } else if (mainAgentRun.status === "waiting_human" || mainAgentRun.status === "failed") {
          const recovery = mainAgentRun.status === "failed";
          mainAgentRun.status = "running";
          mainAgentRun.finished_at = null;
          mainAgentRun.error_code = null;
          mainAgentRun.error_message = null;
          saveAgentRun(mainAgentRun, { recovery });
        }
        dag.status = "running";
        dag.updated_at = nowIso();
        saveAgentDag(dag);
      });
      while (true) {
        this.applyResolvedHumanGates(dag);
        const dependencySkipped = dag.nodes.filter((node) =>
          node.status === "queued"
          && dependenciesResolved(dag, node)
          && !dependenciesSatisfied(dag, node));
        for (const node of dependencySkipped) {
          const task = getAgentTask(dag.workspace_id, node.task_id);
          node.status = "skipped";
          node.metadata = { ...node.metadata, skipped_reason: "dependency_not_satisfied", skipped_at: nowIso() };
          if (task) { task.status = "skipped"; saveAgentTask(task); }
          appendAgentMessage({ workspaceId: dag.workspace_id, dagId: dag.dag_id, taskId: node.task_id, messageType: "task.progress", correlationId: node.task_id, idempotencyKey: `task.skipped:${node.node_id}`, payload: { state: "skipped", reason: "dependency_not_satisfied" }, artifactRefs: [] });
        }
        const candidates = dag.nodes.filter((node) => node.status === "queued" && dependenciesSatisfied(dag, node));
        const now = Date.now();
        const waitingForRetry = candidates.filter((candidate) => retryNotBefore(candidate) > now);
        const availableCandidates = candidates.filter((candidate) => retryNotBefore(candidate) <= now);
        const skipped = availableCandidates.filter((candidate) => !evaluateCondition(candidate.condition, dag.state));
        for (const node of skipped) {
          const task = getAgentTask(dag.workspace_id, node.task_id);
          node.status = "skipped";
          node.metadata = { ...node.metadata, skipped_reason: "condition_false", skipped_at: nowIso() };
          if (task) { task.status = "skipped"; saveAgentTask(task); }
          appendAgentMessage({ workspaceId: dag.workspace_id, dagId: dag.dag_id, taskId: node.task_id, messageType: "task.progress", correlationId: node.task_id, idempotencyKey: `task.skipped:${node.node_id}`, payload: { state: "skipped", reason: "condition_false" }, artifactRefs: [] });
        }
        const ready = availableCandidates.filter((node) => node.status === "queued");
        if (!ready.length) {
          if (skipped.length || dependencySkipped.length) continue;
          if (waitingForRetry.length) {
            const nextRetryAt = Math.min(...waitingForRetry.map(retryNotBefore));
            try {
              await waitForRetryWindow(Math.max(0, nextRetryAt - Date.now()), controller.signal);
            } catch (error) {
              const refreshed = getAgentDag(dag.workspace_id, dag.dag_id);
              if (refreshed?.status === "cancelled") {
                Object.assign(dag, refreshed);
                break;
              }
              throw error;
            }
            continue;
          }
          break;
        }
        const remainingRuns = dag.policy.max_total_agent_runs - dag.budget_usage.agent_runs;
        const remainingToolRounds = dag.policy.max_total_tool_rounds - dag.budget_usage.tool_rounds;
        const batch: AgentDagNode[] = [];
        const fanoutBatchCounts = new Map<string, number>();
        let batchToolRounds = remainingToolRounds;
        for (const node of ready) {
          const requiresAgent = requiresAgentExecution(node);
          if (requiresAgent && batch.filter(requiresAgentExecution).length >= Math.max(0, Math.min(dag.policy.max_concurrency, remainingRuns))) break;
          const fanout = fanoutConcurrency(node);
          if (fanout && (fanoutBatchCounts.get(fanout.sourceNodeId) || 0) >= fanout.limit) continue;
          const reserved = requiresAgent ? getAgentTask(dag.workspace_id, node.task_id)?.budget.max_tool_rounds || 0 : 0;
          if (reserved > batchToolRounds) continue;
          batch.push(node);
          if (fanout) fanoutBatchCounts.set(fanout.sourceNodeId, (fanoutBatchCounts.get(fanout.sourceNodeId) || 0) + 1);
          batchToolRounds -= reserved;
        }
        if (!batch.length) {
          dag.status = "failed";
          break;
        }
        await Promise.all(batch.map((node) => this.executeNode(dag, node, controller.signal)));
        const retried = runJsonStorageTransaction(() => {
          const changed = this.requeueRetryableFailures(dag);
          if (changed) {
            dag.updated_at = nowIso();
            saveAgentDag(dag, { recovery: true });
          }
          return changed;
        });
        if (retried) continue;
        const reworked = runJsonStorageTransaction(() => {
          const changed = this.requeueRejectedReviews(dag);
          if (changed) {
            dag.updated_at = nowIso();
            saveAgentDag(dag, { recovery: true });
          }
          return changed;
        });
        if (reworked) continue;
        const refreshed = getAgentDag(dag.workspace_id, dag.dag_id);
        if (refreshed?.status === "cancelled") { Object.assign(dag, refreshed); break; }
        if (dag.budget_usage.agent_runs >= dag.policy.max_total_agent_runs || dag.budget_usage.tool_rounds >= dag.policy.max_total_tool_rounds || dag.budget_usage.runtime_seconds >= dag.policy.max_runtime_seconds) {
          dag.status = "failed";
          break;
        }
      }
      const hasFailed = dag.nodes.some((node) => node.status === "failed");
      const allTerminal = dag.nodes.length > 0 && dag.nodes.every((node) => ["completed", "skipped", "failed", "cancelled", "blocked"].includes(node.status));
      const hasBlocked = dag.nodes.some((node) => node.status === "blocked");
      const hasPendingHumanGate = listAgentDagGates(dag.workspace_id, dag.dag_id).some((gate) => gate.status === "pending");
      const reviewerNodes = dag.nodes.filter((node) => node.role === "reviewer");
      const reviewerSatisfied = !dag.policy.require_reviewer || (reviewerNodes.length > 0 && reviewerNodes.every((node) => node.status === "completed" && node.metadata.review_verdict === "accepted"));
      let stateContractFailure: Error | null = null;
      if (allTerminal && !hasFailed && !hasBlocked && !hasPendingHumanGate) {
        try {
          assertContractValue(dag.state, dag.state_schema, "AgentDag final state");
        } catch (error) {
          stateContractFailure = error instanceof Error ? error : new Error("AgentDag final state failed validation.");
          appendAgentMessage({
            workspaceId: dag.workspace_id,
            dagId: dag.dag_id,
            taskId: dag.dag_id,
            messageType: "task.failed",
            correlationId: dag.dag_id,
            idempotencyKey: `dag.state_contract_failed:${dag.state_revision}`,
            payload: { code: "agent_contract_validation_failed", message: stateContractFailure.message },
            artifactRefs: [],
          });
        }
      }
      if ((dag.status as AgentDagRecord["status"]) !== "cancelled") {
        dag.status = hasFailed || stateContractFailure ? "failed" : hasPendingHumanGate || hasBlocked ? "waiting_human" : allTerminal && reviewerSatisfied ? "completed" : "running";
      }
      runJsonStorageTransaction(() => {
        dag.updated_at = nowIso();
        saveAgentDag(dag);
        const terminalMainAgentRun = latestMainAgentRun(dag);
        if (terminalMainAgentRun) {
          const finalDagStatus = dag.status as AgentDagRecord["status"];
          terminalMainAgentRun.status = finalDagStatus === "waiting_human"
            ? "waiting_human"
            : finalDagStatus === "completed"
              ? "completed"
              : finalDagStatus === "cancelled"
                ? "cancelled"
                : finalDagStatus === "failed"
                  ? "failed"
                  : "running";
          terminalMainAgentRun.finished_at = ["completed", "failed", "cancelled"].includes(terminalMainAgentRun.status)
            ? nowIso()
            : null;
          saveAgentRun(terminalMainAgentRun);
        }
      });
      if (["completed", "failed", "cancelled"].includes(dag.status)) {
        await this.options.onDagFinished?.({
          workspaceId: dag.workspace_id,
          sessionId: rootSessionIdForDag(dag),
          dagId: dag.dag_id,
          status: dag.status,
        });
      }
      return { ok: true, dag_id: dag.dag_id, status: dag.status, nodes: dag.nodes, state: dag.state, state_revision: dag.state_revision, budget_usage: dag.budget_usage };
    } finally {
      clearInterval(heartbeat);
      if (activeLease) releaseAgentDagLease(activeLease);
      this.running.delete(dag.dag_id);
      this.controllers.delete(dag.dag_id);
    }
  }

  private applyResolvedHumanGates(dag: AgentDagRecord): void {
    const gates = listAgentDagGates(dag.workspace_id, dag.dag_id);
    for (const node of dag.nodes.filter((candidate) => candidate.kind === "human_gate" && candidate.status === "blocked")) {
      const gate = gates.find((candidate) => candidate.node_id === node.node_id);
      if (!gate || gate.status === "pending") continue;
      const task = getAgentTask(dag.workspace_id, node.task_id);
      if (gate.status === "approved" || gate.status === "submitted") {
        node.status = "completed";
        node.metadata = { ...node.metadata, gate_id: gate.gate_id, gate_status: gate.status, gate_response: gate.response || {} };
        if (task) { task.status = "completed"; saveAgentTask(task); }
        const gateResponse = {
          ...(gate.response || {}),
          ...(gate.status === "approved" && gate.response?.approved === undefined ? { approved: true } : {}),
        };
        assignAtPath(dag.state, `gates.${node.node_id}`, gateResponse);
        assignAtPath(dag.state, `nodes.${node.node_id}.output`, gateResponse);
        const definitionNodeId = typeof node.metadata.definition_node_id === "string" ? node.metadata.definition_node_id : "";
        if (definitionNodeId) assignAtPath(dag.state, definitionNodeId, gateResponse);
        projectNodeStateOutput(dag, node, gateResponse);
        dag.state_revision += 1;
      } else if (gate.status === "rejected") {
        node.status = "failed";
        node.metadata = { ...node.metadata, gate_id: gate.gate_id, gate_status: gate.status };
        if (task) { task.status = "failed"; saveAgentTask(task); }
      }
    }
  }

  private requeueRetryableFailures(dag: AgentDagRecord): boolean {
    let requeued = false;
    for (const node of dag.nodes.filter((candidate) => candidate.status === "failed" && requiresAgentExecution(candidate))) {
      const attempts = listAgentRuns(dag.workspace_id)
        .filter((run) => run.workflow_run_id === dag.dag_id && run.node_run_id === node.node_id);
      const latest = attempts.at(-1) || null;
      const errorCode = latest?.error_code || String(node.metadata.error_code || "subagent_execution_failed");
      if (attempts.length >= node.retry_policy.max_attempts || !isRetryableNodeFailure(errorCode)) continue;
      const backoffSeconds = Math.min(300, node.retry_policy.backoff_seconds * (2 ** Math.max(0, attempts.length - 1)));
      const retryAt = new Date(Date.now() + backoffSeconds * 1_000).toISOString();
      const task = getAgentTask(dag.workspace_id, node.task_id);
      node.status = "queued";
      node.metadata = {
        ...node.metadata,
        retry_attempts_completed: attempts.length,
        retry_next_attempt: attempts.length + 1,
        retry_reason: errorCode,
        retry_not_before: retryAt,
        retry_scheduled_at: nowIso(),
      };
      if (task) {
        task.status = "queued";
        task.assigned_agent_run_id = null;
        saveAgentTask(task, { recovery: true });
        appendAgentMessage({
          workspaceId: dag.workspace_id,
          dagId: dag.dag_id,
          taskId: task.task_id,
          messageType: "task.progress",
          correlationId: task.task_id,
          idempotencyKey: `task.auto-retry:${node.node_id}:${attempts.length + 1}`,
          payload: {
            state: "queued_for_automatic_retry",
            attempt: attempts.length + 1,
            max_attempts: node.retry_policy.max_attempts,
            retry_at: retryAt,
            error_code: errorCode,
          },
          artifactRefs: [],
        });
      }
      requeued = true;
    }
    return requeued;
  }

  private requeueRejectedReviews(dag: AgentDagRecord): boolean {
    let requeued = false;
    for (const reviewerNode of dag.nodes.filter((node) => node.role === "reviewer" && node.status === "blocked" && node.metadata.review_verdict === "rejected")) {
      const reviewerTask = getAgentTask(dag.workspace_id, reviewerNode.task_id);
      const reviewedTaskId = typeof reviewerTask?.context.review_task_id === "string" ? reviewerTask.context.review_task_id : null;
      const reviewedTask = reviewedTaskId ? getAgentTask(dag.workspace_id, reviewedTaskId) : null;
      const reviewedNode = reviewedTask ? dag.nodes.find((node) => node.task_id === reviewedTask.task_id) || null : null;
      if (!reviewerTask || !reviewedTask || !reviewedNode || reviewedTask.permission_ceiling.autonomy_mode === "review_first") continue;
      const completedAttempts = listAgentRuns(dag.workspace_id).filter((run) => run.workflow_run_id === dag.dag_id && run.node_run_id === reviewedNode.node_id).length;
      const maxAutoReworkRounds = Math.max(0, Math.min(3, Number(reviewerNode.metadata.max_auto_rework_rounds ?? 1)));
      if (completedAttempts > maxAutoReworkRounds) continue;
      const review = reviewerNode.metadata.review && typeof reviewerNode.metadata.review === "object"
        ? reviewerNode.metadata.review as AgentReviewerVerdict
        : null;
      reviewedTask.context = {
        ...reviewedTask.context,
        review_feedback: {
          issues: review?.issues || [],
          required_revisions: review?.required_revisions || [],
          reviewer_node_id: reviewerNode.node_id,
          previous_attempt: completedAttempts,
        },
      };
      reviewedTask.status = "queued";
      reviewedTask.assigned_agent_run_id = null;
      reviewerTask.status = "queued";
      reviewerTask.assigned_agent_run_id = null;
      reviewedNode.status = "queued";
      reviewerNode.status = "queued";
      reviewerNode.metadata = {
        ...reviewerNode.metadata,
        review_history: [
          ...(Array.isArray(reviewerNode.metadata.review_history) ? reviewerNode.metadata.review_history : []),
          { review: reviewerNode.metadata.review || null, recorded_at: nowIso() },
        ],
        review_verdict: "rework",
        auto_rework_round: completedAttempts,
      };
      saveAgentTask(reviewedTask, { recovery: true });
      saveAgentTask(reviewerTask, { recovery: true });
      appendAgentMessage({
        workspaceId: dag.workspace_id,
        dagId: dag.dag_id,
        taskId: reviewedTask.task_id,
        messageType: "task.steer",
        correlationId: reviewedTask.task_id,
        idempotencyKey: `review.rework:${reviewerNode.node_id}:${completedAttempts}`,
        payload: { reason: "reviewer_rejected", feedback: reviewedTask.context.review_feedback },
        artifactRefs: [],
      });
      requeued = true;
    }
    return requeued;
  }

  private async executeNode(dag: AgentDagRecord, node: AgentDagNode, dagSignal: AbortSignal): Promise<void> {
    const task = getAgentTask(dag.workspace_id, node.task_id);
    if (!task || task.status === "cancelled") return;
    if (node.kind === "human_gate") {
      const gate = runJsonStorageTransaction(() => {
        const createdGate = createAgentDagGate({ dag, node, task });
        node.status = "blocked";
        task.status = "blocked";
        node.metadata = { ...node.metadata, gate_id: createdGate.gate_id };
        saveAgentTask(task);
        saveAgentDag(dag);
        return createdGate;
      });
      await this.emitNodeActivity(dag, node, task, {
        status: "waiting_human",
        summary: gate.prompt,
      });
      return;
    }
    if (!requiresAgentExecution(node)) {
      return runJsonStorageTransaction(() => {
      node.status = "running";
      task.status = "running";
      node.metadata = { ...node.metadata, control_started_at: nowIso() };
      saveAgentTask(task);
      saveAgentDag(dag);
      let materialized: { itemCount: number; generatedNodeCount: number; branchCount: number } | null = null;
      try {
        const config = node.kind === "fanout" ? fanoutConfig(node) : null;
        if (config) materialized = materializeAgentDagFanout({ dag, sourceNode: node, sourceTask: task, config });
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const errorCode = typeof (cause as { code?: unknown })?.code === "string"
          ? String((cause as { code: string }).code)
          : "agent_dag_fanout_materialization_failed";
        task.status = "failed";
        node.status = "failed";
        node.metadata = { ...node.metadata, error_code: errorCode, error_message: error.message, failed_at: nowIso() };
        saveAgentTask(task);
        appendAgentMessage({ workspaceId: dag.workspace_id, dagId: dag.dag_id, taskId: task.task_id, messageType: "task.failed", correlationId: task.task_id, idempotencyKey: `task.failed:${node.node_id}:fanout`, payload: { error_code: errorCode, message: error.message }, artifactRefs: [] });
        saveAgentDag(dag);
        return;
      }
      const output = node.kind === "condition"
        ? { passed: true, evaluated_condition: node.condition }
        : node.kind === "combine"
          ? { combined: true, dependency_count: node.depends_on.length }
          : node.kind === "fanout"
            ? {
                fanout_ready: true,
                item_count: materialized?.itemCount ?? 0,
                generated_node_count: materialized?.generatedNodeCount ?? 0,
                branch_count: materialized?.branchCount ?? dag.nodes.filter((candidate) => candidate.depends_on.includes(node.node_id)).length,
              }
            : { finished: true };
      node.status = "completed";
      task.status = "completed";
      node.metadata = { ...node.metadata, control_completed_at: nowIso(), control_output: output };
      assignAtPath(dag.state, `nodes.${node.node_id}`, { output });
      projectNodeStateOutput(dag, node, output);
      assertContractValue(dag.state, dag.state_schema, "AgentDag state", true);
      dag.state_revision += 1;
      saveAgentTask(task);
      appendAgentMessage({ workspaceId: dag.workspace_id, dagId: dag.dag_id, taskId: task.task_id, messageType: "task.result", correlationId: task.task_id, idempotencyKey: `task.result:${node.node_id}:control`, payload: { summary: `${node.kind} control step completed.`, output }, artifactRefs: [] });
      saveAgentDag(dag);
      return;
      });
    }
    node.status = "running";
    const { retry_not_before: _retryNotBefore, ...nodeMetadata } = node.metadata;
    node.metadata = { ...nodeMetadata, attempt_started_at: nowIso() };
    task.status = "running";
    const parentRun = task.parent_task_id
      ? (() => { const parentTask = getAgentTask(dag.workspace_id, task.parent_task_id!); return parentTask?.assigned_agent_run_id ? listAgentRuns(dag.workspace_id).find((run) => run.agent_run_id === parentTask.assigned_agent_run_id) || null : null; })()
      : latestMainAgentRun(dag);
    const attempt = listAgentRuns(dag.workspace_id).filter((run) => run.workflow_run_id === dag.dag_id && run.node_run_id === node.node_id).length + 1;
    const agentRun = runJsonStorageTransaction(() => {
      const createdRun = createAgentRun({ workspaceId: dag.workspace_id, kind: node.role === "reviewer" ? "review" : "delegation", bindingSnapshot: task.binding_snapshot, workflowRunId: dag.dag_id, nodeRunId: node.node_id, parentAgentRunId: parentRun?.agent_run_id || null, attempt, metadata: { agent_task_id: task.task_id, dag_id: dag.dag_id, agent_dag_id: dag.dag_id, depth: task.depth, node_id: node.node_id, node_name: node.name, agent_role: node.role } });
      task.assigned_agent_run_id = createdRun.agent_run_id;
      saveAgentTask(task);
      dag.budget_usage.agent_runs += 1;
      saveAgentDag(dag);
      appendAgentMessage({ workspaceId: dag.workspace_id, dagId: dag.dag_id, taskId: task.task_id, messageType: "task.accepted", fromAgentRunId: createdRun.agent_run_id, toAgentRunId: parentRun?.agent_run_id || null, correlationId: task.task_id, causationId: null, idempotencyKey: `task.accepted:${createdRun.agent_run_id}`, payload: { node_id: node.node_id }, artifactRefs: [] });
      return createdRun;
    });
    const startedAt = Date.now();
    let usedToolRounds = 0;
    let subAgentSessionId: string | null = null;
    let deltaBuffer = "";
    let lastDeltaFlushAt = Date.now();
    let structuredProgressRecorded = false;
    const nodeController = new AbortController();
    const cancelNode = () => nodeController.abort(dagSignal.reason);
    dagSignal.addEventListener("abort", cancelNode, { once: true });
    const timeout = setTimeout(() => nodeController.abort(new Error("Agent Task runtime budget exceeded.")), task.budget.max_runtime_seconds * 1_000);
    const recordRunEvent = (
      type: Parameters<typeof appendAgentRunEvent>[0]["type"],
      status: Parameters<typeof appendAgentRunEvent>[0]["status"],
      summary: string,
      payload: Record<string, unknown> = {},
      idempotencyKey: string | null = null,
    ) => appendAgentRunEvent({
      workspaceId: dag.workspace_id,
      dagId: dag.dag_id,
      nodeId: node.node_id,
      taskId: task.task_id,
      agentRunId: agentRun.agent_run_id,
      childSessionId: subAgentSessionId,
      type,
      status,
      summary,
      payload,
      idempotencyKey,
    });
    const flushNarrativeDelta = () => {
      const text = deltaBuffer;
      if (!text) return;
      deltaBuffer = "";
      lastDeltaFlushAt = Date.now();
      recordRunEvent("agent.message.delta", "running", "Agent response updated.", { text });
    };
    try {
      const session = createSession({ title: `[Sub Agent] ${task.title}`, created_by: dag.created_by, autonomy_mode: task.permission_ceiling.autonomy_mode, provider_connection_id: task.binding_snapshot.provider_connection_id, model: task.binding_snapshot.model, agent_id: task.binding_snapshot.agent_id, agent_version: task.binding_snapshot.agent_version, agent_binding_mode: "pinned" });
      subAgentSessionId = session.session_id;
      // Persist the child Session as soon as the Agent starts. The parent Task UI
      // must be able to open a running Agent conversation, not only a completed one.
      agentRun.session_id = subAgentSessionId;
      agentRun.metadata = { ...agentRun.metadata, child_session_id: subAgentSessionId };
      saveAgentRun(agentRun);
      session.hidden = true;
      session.hidden_at = nowIso();
      session.hidden_by = "agent-dag-runner";
      const dagOwnerSession = getSession(dag.session_id);
      const codingWorkspaceOwnerSessionId = typeof dagOwnerSession?.metadata?.coding_workspace_owner_session_id === "string"
        ? dagOwnerSession.metadata.coding_workspace_owner_session_id
        : dag.session_id;
      session.metadata = { ...(session.metadata || {}), agent_binding_snapshot: task.binding_snapshot, parent_agent_run_id: agentRun.agent_run_id, parent_session_id: dag.session_id, agent_dag_id: dag.dag_id, agent_task_id: task.task_id, subagent: true, hidden_from_task_list: true, delegation_depth: task.depth, coding_workspace_owner_session_id: codingWorkspaceOwnerSessionId, defer_workspace_finalization: true };
      saveSession(session);
      updateSubAgentSessionLifecycle({
        sessionId: session.session_id,
        status: "running",
        objective: task.objective,
        taskStatus: task.status,
      });
      recordRunEvent(
        "task.assigned",
        "info",
        task.objective,
        { agent_name: task.binding_snapshot.agent_name, role: node.role },
        `task.assigned:${task.task_id}`,
      );
      recordRunEvent(
        "agent.started",
        "running",
        `${task.binding_snapshot.agent_name} started ${task.title}.`,
        { agent_name: task.binding_snapshot.agent_name, model: task.binding_snapshot.model },
        `agent.started:${agentRun.agent_run_id}`,
      );
      await this.emitNodeActivity(dag, node, task, {
        agentRunId: agentRun.agent_run_id,
        childSessionId: session.session_id,
        status: "started",
        summary: `${task.binding_snapshot.agent_name} started ${task.title}.`,
      });
      const stateInput = Object.fromEntries(Object.entries(node.state_input).map(([name, path]) => [name, valueAtPath(dag.state, path)]));
      assertContractValue(stateInput, task.context.input_contract, `Node ${node.name} input`);
      const missionInputs = isPlainObject(task.context.mission_inputs) ? task.context.mission_inputs : {};
      const missionContext = Object.keys(missionInputs).length
        ? `\n\nMission inputs (authoritative user-supplied workflow inputs):\n${JSON.stringify(missionInputs, null, 2)}`
        : "";
      const stateContext = Object.keys(stateInput).length ? `\n\nDAG state input:\n${JSON.stringify(stateInput, null, 2)}` : "";
      const dependencyContext = node.role !== "reviewer" && node.depends_on.length
        ? `\n\nDirect dependency results (durable Control Plane records):\n${JSON.stringify(dependencyResultBundle(dag, node), null, 2)}`
        : "";
      const executableOutputContract = normalizeContractSchema(task.expected_output);
      const expectedArtifacts = expectedContractArtifacts(task.expected_output);
      const outputContract = executableOutputContract
        ? `\n\nReturn a JSON object matching this output schema:\n${JSON.stringify(executableOutputContract, null, 2)}`
        : "";
      const deliverableContract = expectedArtifacts.length
        ? `\n\nExpected deliverables: ${expectedArtifacts.join(", ")}. Create real artifacts when the task and available tools require files; otherwise return auditable result evidence without inventing attachment references.`
        : "";
      const reviewedTaskId = typeof task.context.review_task_id === "string" ? task.context.review_task_id : null;
      const reviewedTask = reviewedTaskId ? getAgentTask(dag.workspace_id, reviewedTaskId) : null;
      const acceptanceCriteria = node.role === "reviewer" ? reviewedTask?.acceptance_criteria || task.acceptance_criteria || [] : task.acceptance_criteria || [];
      const verificationSteps = node.role === "reviewer" ? reviewedTask?.verification_steps || task.verification_steps || [] : task.verification_steps || [];
      const acceptanceContract = acceptanceCriteria.length || verificationSteps.length
        ? `\n\nAcceptance criteria:\n${acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n\nVerification steps:\n${verificationSteps.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
        : "";
      const reviewFeedback = task.context.review_feedback
        ? `\n\nReviewer feedback from the previous attempt:\n${JSON.stringify(task.context.review_feedback, null, 2)}\nResolve every required revision before returning.`
        : "";
      const upstreamEvidence = node.role === "reviewer"
        ? `\n\nUpstream execution evidence (durable Control Plane records, not model claims):\n${JSON.stringify(reviewerEvidenceBundle(dag, node), null, 2)}`
        : "";
      const content = node.role === "reviewer"
        ? `${task.objective}${missionContext}${stateContext}${outputContract}${deliverableContract}${acceptanceContract}${upstreamEvidence}\n\nReturn exactly one raw JSON object with: verdict ('accepted' or 'rejected'), criteria [{name, passed, detail}], issues (an array of strings), and required_revisions (an array of strings). Include every field declared by the output schema using its exact field name. Treat the upstream execution evidence above as authoritative Control Plane evidence. The evidence_snapshot_revision is the bundle assembly version and naturally advances after node completion; do not reject solely because an upstream result cites an earlier revision. Do not use Markdown or add prose before or after the JSON.`
        : `${task.objective}${missionContext}${stateContext}${dependencyContext}${outputContract}${deliverableContract}${acceptanceContract}${reviewFeedback}`;
      const structuredResultExpected = node.role === "reviewer" || Boolean(executableOutputContract);
      const result = await this.options.turnHandler({
        sessionId: session.session_id,
        content,
        allowedToolNames: allowedTools(dag, task, node),
        signal: nodeController.signal,
        onStarted: ({ checkpointId }) => {
          recordRunEvent(
            "checkpoint.saved",
            "info",
            "Execution checkpoint saved.",
            { checkpoint_available: Boolean(checkpointId) },
            `checkpoint.saved:${checkpointId}`,
          );
        },
        onDelta: (text) => {
          if (!text) return;
          if (structuredResultExpected) {
            if (!structuredProgressRecorded) {
              structuredProgressRecorded = true;
              recordRunEvent(
                "agent.progress",
                "running",
                "Agent is preparing the requested result.",
                {},
                `agent.progress:structured-result:${agentRun.agent_run_id}`,
              );
            }
            return;
          }
          deltaBuffer += text;
          if (deltaBuffer.length >= 240 || Date.now() - lastDeltaFlushAt >= 300) flushNarrativeDelta();
        },
        onToolProgress: (progress) => {
          flushNarrativeDelta();
          const eventType = progress.status === "running"
            ? "tool.started"
            : progress.status === "pending_approval"
              ? "tool.waiting_approval"
              : progress.status === "succeeded"
                ? "tool.completed"
                : "tool.failed";
          const eventStatus = progress.status === "running"
            ? "running"
            : progress.status === "pending_approval"
              ? "waiting"
              : progress.status === "succeeded"
                ? "succeeded"
                : "failed";
          recordRunEvent(
            eventType,
            eventStatus,
            progress.summary || `${progress.tool_name} ${progress.status}.`,
            {
              action_id: progress.action_id,
              tool_name: progress.tool_name,
              risk_level: progress.risk_level,
              tool_status: progress.status,
            },
            `tool:${progress.action_id}:${progress.status}`,
          );
        },
      });
      flushNarrativeDelta();
      usedToolRounds = result.toolRoundsUsed || 0;
      if (nodeController.signal.aborted || getAgentDag(dag.workspace_id, dag.dag_id)?.status === "cancelled") {
        throw Object.assign(new Error("Agent DAG was cancelled."), { code: "agent_dag_cancelled" });
      }
      let summary = resultText(result);
      let reviewerOutput = node.role === "reviewer" ? parseReviewerOutput(summary) : null;
      if (node.role === "reviewer" && !reviewerOutput) {
        const correction = await this.options.turnHandler({
          sessionId: session.session_id,
          content: "Your previous Reviewer response did not match the required wire format. Return the same verdict again as exactly one raw JSON object, with no Markdown fence, introduction, explanation, tool request, or trailing text. Use this shape exactly: {\"verdict\":\"accepted\",\"criteria\":[{\"name\":\"criterion\",\"passed\":true,\"detail\":\"evidence\"}],\"issues\":[\"issue text\"],\"required_revisions\":[\"revision text\"]}. Every issues and required_revisions item must be a JSON string, never an object.",
          allowedToolNames: [],
          signal: nodeController.signal,
          onDelta: () => {},
        });
        usedToolRounds += correction.toolRoundsUsed || 0;
        summary = resultText(correction);
        reviewerOutput = parseReviewerOutput(summary);
        if (!reviewerOutput) {
          throw Object.assign(new Error("Reviewer must return exactly one valid JSON object without Markdown or trailing text."), { code: "reviewer_output_invalid" });
        }
      }
      const parsedSummary = parseJsonObject(summary);
      const eventResult = reviewerOutput?.output || parsedSummary;
      recordRunEvent(
        "agent.message.completed",
        "succeeded",
        "Agent returned its result.",
        {
          structured_result: Boolean(eventResult),
          ...(eventResult ? { result: eventResult } : { text: summary }),
        },
        `agent.message.completed:${agentRun.agent_run_id}`,
      );
      const artifacts = artifactReferences(session.session_id, agentRun.agent_run_id);
      const structuredOutput = reviewerOutput?.output || parsedSummary || (executableOutputContract ? parseExpectedOutput(summary, task.expected_output) : null) || { text: summary };
      assertContractValue(structuredOutput, task.expected_output, `Node ${node.name} output`);
      assertExecutionEvidence(task, session.session_id, structuredOutput);
      const verdict = reviewerOutput?.verdict || null;
      const accepted = verdict?.verdict !== "rejected";
      runJsonStorageTransaction(() => {
      task.status = accepted ? "completed" : "blocked";
      node.status = accepted ? "completed" : "blocked";
      if (node.role === "reviewer") node.metadata = { ...node.metadata, review_verdict: verdict!.verdict, review: verdict };
      agentRun.status = "completed";
      agentRun.session_id = session.session_id;
      agentRun.finished_at = nowIso();
      saveAgentRun(agentRun);
      saveAgentTask(task);
      updateSubAgentSessionLifecycle({
        sessionId: session.session_id,
        status: accepted ? "completed" : "waiting_human",
        objective: task.objective,
        summary,
        taskStatus: task.status,
      });
      const output = { session_id: session.session_id, ...structuredOutput, ...(verdict ? { review: verdict } : {}) };
      const executionEvidence = executionEvidenceForSession(session.session_id);
      const savedResult = saveAgentResult({ task_id: task.task_id, agent_run_id: agentRun.agent_run_id, status: "completed", summary, output, artifact_refs: artifacts, verification: { status: node.role === "reviewer" ? "verified" : "unverified", reviewer_agent_run_id: node.role === "reviewer" ? agentRun.agent_run_id : null, evidence: node.role === "reviewer" ? { review: verdict, execution: executionEvidence } : { execution: executionEvidence } }, error_code: null });
      for (const artifact of artifacts) {
        recordRunEvent(
          "artifact.created",
          "succeeded",
          `${artifact.name || "Artifact"} is ready.`,
          { artifact_id: artifact.artifact_id, name: artifact.name, kind: artifact.kind, uri: artifact.uri },
          `artifact.created:${artifact.artifact_id}`,
        );
      }
      const nextState = structuredClone(dag.state);
      const nextDag = { ...dag, state: nextState };
      assignAtPath(nextState, `nodes.${node.node_id}`, { summary, output, artifact_refs: artifacts });
      projectNodeStateOutput(nextDag, node, output);
      assertContractValue(nextState, dag.state_schema, "AgentDag state", true);
      dag.state = nextState;
      dag.state_revision += 1;
      const reviewTaskId = reviewedTaskId;
      if (node.role === "reviewer" && reviewTaskId) verifyAgentTaskResult(reviewTaskId, agentRun.agent_run_id, { review: verdict, result_id: savedResult.result_id }, accepted);
      appendAgentMessage({ workspaceId: dag.workspace_id, dagId: dag.dag_id, taskId: task.task_id, messageType: "task.result", fromAgentRunId: agentRun.agent_run_id, toAgentRunId: parentRun?.agent_run_id || null, correlationId: task.task_id, causationId: null, idempotencyKey: `task.result:${agentRun.agent_run_id}`, payload: { summary, result_id: savedResult.result_id }, artifactRefs: artifacts });
      recordRunEvent(
        "handoff.returned",
        accepted ? "succeeded" : "waiting",
        accepted
          ? `${task.binding_snapshot.agent_name} returned the result to the Orchestrator.`
          : `${task.binding_snapshot.agent_name} returned a result that needs revision.`,
        { artifact_count: artifacts.length, accepted },
        `handoff.returned:${agentRun.agent_run_id}`,
      );
      recordRunEvent(
        "agent.completed",
        accepted ? "succeeded" : "waiting",
        accepted ? `${task.title} completed.` : `${task.title} needs revision.`,
        { artifact_count: artifacts.length, accepted },
        `agent.completed:${agentRun.agent_run_id}`,
      );
      saveAgentDag(dag);
      });
      await this.emitNodeActivity(dag, node, task, {
        agentRunId: agentRun.agent_run_id,
        childSessionId: session.session_id,
        status: "completed",
        summary,
      });
      await this.options.onNodeCompleted?.({
        sessionId: session.session_id,
        dagId: dag.dag_id,
        nodeId: node.node_id,
        summary,
        reviewerAccepted: node.role === "reviewer" && accepted,
      });
    } catch (error) {
      flushNarrativeDelta();
      const message = error instanceof Error ? error.message : "Sub Agent execution failed.";
      const cancelled = dagSignal.aborted || (error as { code?: string })?.code === "agent_dag_cancelled" || getAgentDag(dag.workspace_id, dag.dag_id)?.status === "cancelled";
      if (cancelled) {
        const cancelledDag = getAgentDag(dag.workspace_id, dag.dag_id);
        if (cancelledDag?.status === "cancelled") Object.assign(dag, cancelledDag);
      }
      runJsonStorageTransaction(() => {
      task.status = cancelled ? "cancelled" : "failed";
      node.status = cancelled ? "cancelled" : "failed";
      agentRun.status = cancelled ? "cancelled" : "failed";
      agentRun.error_code = cancelled ? "agent_dag_cancelled" : nodeController.signal.aborted ? "agent_task_timeout" : (error as { code?: string })?.code || "subagent_execution_failed";
      agentRun.error_message = message.slice(0, 2_000);
      agentRun.finished_at = nowIso();
      saveAgentRun(agentRun);
      saveAgentTask(task);
      if (subAgentSessionId) {
        updateSubAgentSessionLifecycle({
          sessionId: subAgentSessionId,
          status: cancelled ? "cancelled" : "failed",
          objective: task.objective,
          summary: message,
          taskStatus: task.status,
        });
      }
      recordRunEvent(
        cancelled ? "agent.cancelled" : "agent.failed",
        cancelled ? "cancelled" : "failed",
        cancelled ? `${task.title} was cancelled.` : message,
        { error_code: agentRun.error_code },
        `${cancelled ? "agent.cancelled" : "agent.failed"}:${agentRun.agent_run_id}`,
      );
      saveAgentResult({ task_id: task.task_id, agent_run_id: agentRun.agent_run_id, status: cancelled ? "cancelled" : "failed", summary: message, output: {}, artifact_refs: [], verification: { status: "unverified", reviewer_agent_run_id: null, evidence: {} }, error_code: agentRun.error_code });
      appendAgentMessage({ workspaceId: dag.workspace_id, dagId: dag.dag_id, taskId: task.task_id, messageType: cancelled ? "task.cancel" : "task.failed", fromAgentRunId: agentRun.agent_run_id, toAgentRunId: parentRun?.agent_run_id || null, correlationId: task.task_id, causationId: null, idempotencyKey: `${cancelled ? "task.cancel" : "task.failed"}:${agentRun.agent_run_id}`, payload: { error_code: agentRun.error_code, message }, artifactRefs: [] });
      saveAgentDag(dag);
      });
      await this.emitNodeActivity(dag, node, task, {
        agentRunId: agentRun.agent_run_id,
        childSessionId: subAgentSessionId,
        status: cancelled ? "cancelled" : "failed",
        summary: message,
      });
    } finally {
      clearTimeout(timeout);
      dagSignal.removeEventListener("abort", cancelNode);
      dag.budget_usage.runtime_seconds += Math.ceil((Date.now() - startedAt) / 1000);
      const persistedActionCount = subAgentSessionId ? listConversationActions(subAgentSessionId).length : 0;
      dag.budget_usage.tool_rounds += Math.max(usedToolRounds, persistedActionCount);
      dag.updated_at = nowIso();
      const persisted = getAgentDag(dag.workspace_id, dag.dag_id);
      if (persisted?.status === "cancelled") {
        persisted.budget_usage = dag.budget_usage;
        persisted.updated_at = dag.updated_at;
        Object.assign(dag, persisted);
      }
      saveAgentDag(dag);
    }
  }
}
