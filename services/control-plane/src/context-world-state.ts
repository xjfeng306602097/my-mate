import { listAgentDags, listAgentTasks } from "./agent-orchestration-store.js";
import { listAgentRuns } from "./agent-runtime-store.js";
import { getLatestTaskCheckpoint } from "./task-checkpoint-store.js";
import type { SessionRecord } from "./types.js";

function compactJson(value: unknown, maxCharacters: number): string {
  const encoded = JSON.stringify(value);
  if (encoded.length <= maxCharacters) return encoded;
  return `${encoded.slice(0, Math.max(0, maxCharacters - 64))}...[truncated authoritative field]`;
}

function metadataString(session: SessionRecord, key: string): string | null {
  const value = session.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export interface ConversationWorldState {
  text: string;
  dag_id: string | null;
  checkpoint_id: string | null;
}

export function buildConversationWorldState(session: SessionRecord): ConversationWorldState {
  const workspaceId = session.workspace_id || "default";
  const requestedDagId = metadataString(session, "agent_dag_id")
    || metadataString(session, "latest_agent_dag_id");
  const dags = requestedDagId
    ? listAgentDags(workspaceId)
    : listAgentDags(workspaceId, session.session_id);
  const dag = (requestedDagId ? dags.find((item) => item.dag_id === requestedDagId) : null)
    || dags.find((item) => item.status === "running" || item.status === "waiting_human")
    || dags[0]
    || null;
  const checkpoint = getLatestTaskCheckpoint(session.session_id, workspaceId);
  const taskById = dag
    ? new Map(listAgentTasks(workspaceId, dag.dag_id).map((task) => [task.task_id, task]))
    : new Map();
  const assignedTaskId = metadataString(session, "agent_task_id");
  const assignedTask = assignedTaskId ? taskById.get(assignedTaskId) || null : null;
  const runs = dag
    ? listAgentRuns(workspaceId).filter((run) => run.workflow_run_id === dag.dag_id)
    : [];
  const runByTask = new Map<string, typeof runs[number]>();
  for (const run of runs) {
    const taskId = typeof run.metadata?.task_id === "string" ? run.metadata.task_id : null;
    if (taskId && !runByTask.has(taskId)) runByTask.set(taskId, run);
  }
  const payload = {
    schema_version: 1,
    session: {
      session_id: session.session_id,
      status: session.status,
      goal: session.current_goal,
      plan_summary: session.current_plan_summary,
      pending_decision: metadataString(session, "pending_decision"),
      autonomy_mode: metadataString(session, "autonomy_mode"),
    },
    mission: session.mission_spec_contract || session.mission_spec || null,
    checkpoint: checkpoint ? {
      checkpoint_id: checkpoint.checkpoint_id,
      status: checkpoint.status,
      reason: checkpoint.reason,
      version: checkpoint.version,
      progress_summary: checkpoint.progress_summary,
      context_summary: checkpoint.context_summary,
      next_action: checkpoint.next_action,
      resume_attempts: checkpoint.resume_attempts,
      max_resume_attempts: checkpoint.max_resume_attempts,
      long_task_runtime: checkpoint.long_task_runtime,
      last_error_code: checkpoint.last_error_code,
      last_error_message: checkpoint.last_error_message,
    } : null,
    agent_task: assignedTask ? {
      task_id: assignedTask.task_id,
      node_id: assignedTask.node_id,
      title: assignedTask.title,
      objective: assignedTask.objective,
      status: assignedTask.status,
      context: assignedTask.context,
      expected_output: assignedTask.expected_output,
      acceptance_criteria: assignedTask.acceptance_criteria || [],
      verification_steps: assignedTask.verification_steps || [],
      permission_ceiling: assignedTask.permission_ceiling,
      budget: assignedTask.budget,
    } : null,
    agent_dag: dag ? {
      dag_id: dag.dag_id,
      title: dag.title,
      objective: dag.objective,
      status: dag.status,
      state_revision: dag.state_revision,
      state: dag.state,
      budget_usage: dag.budget_usage,
      nodes: dag.nodes.map((node) => {
        const task = taskById.get(node.task_id);
        const run = runByTask.get(node.task_id);
        return {
          node_id: node.node_id,
          name: node.name,
          kind: node.kind,
          role: node.role,
          status: node.status,
          agent_id: node.binding_snapshot.agent_id,
          depends_on: node.depends_on,
          task_status: task?.status || null,
          agent_run_id: run?.agent_run_id || task?.assigned_agent_run_id || null,
          run_status: run?.status || null,
        };
      }),
    } : null,
  };
  return {
    text: [
      "Authoritative World State for the current Task. This state is server-owned and takes precedence over conversational summaries. Do not infer completed work that is not recorded here:",
      compactJson(payload, 24_000),
    ].join("\n"),
    dag_id: dag?.dag_id || null,
    checkpoint_id: checkpoint?.checkpoint_id || null,
  };
}
