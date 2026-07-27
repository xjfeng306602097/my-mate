import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AgentDagRunner } from "../src/agent-dag-runner.js";
import { addAgentDagTask, createAgentDag, ensureDefaultExecutionPolicy, getAgentDag, getAgentTask, listAgentDagGates, listAgentDags, listAgentMessages, listAgentResults, listAgentTeams, recoverInterruptedAgentDags, resolveAgentDagGate, retryAgentDag, saveAgentDag, saveAgentTask, upsertAgentTeam } from "../src/agent-orchestration-store.js";
import { createAgentBindingSnapshot, createAgentRun, listAgentRuns, saveAgentRun, upsertAgentDefinition } from "../src/agent-runtime-store.js";
import { recordProviderConnectionVerification, upsertProviderConnection } from "../src/provider-connection-store.js";
import { createSessionMessage, listSessionMessages } from "../src/session-message-store.js";
import { createSession, getSession, saveSession } from "../src/session-store.js";
import { buildPublishedTemplate, getJson, postJson, resetTestRoot, seedAgentProfile, seedTemplate, startTestServer, TEST_ROOT } from "./helpers.js";
import { configureAgentDagExecutionHandler, executeConversationTool, getConversationToolDefinitions } from "../src/conversation-tools.js";
import { getDagProposal, listSessionDagProposals } from "../src/dag-proposal-store.js";
import { compileDagProposalToAgentDag, dagDefinitionFromWorkflowTemplate } from "../src/orchestration-protocol.js";
import { listRuns } from "../src/run-store.js";
import { acquireAgentDagLease, getAgentDagLease } from "../src/agent-dag-lease-store.js";
import { applyConversationWorkspaceOperations, finalizeConversationCodingTransaction, searchConversationWorkspace } from "../src/conversation-coding-workspace.js";
import { registerWorkspaceBinding } from "../src/workspace-binding-store.js";
import { completeConversationAction, createConversationAction } from "../src/conversation-action-store.js";
import { listAgentRunEvents } from "../src/agent-run-event-store.js";
import { createSessionAttachment } from "../src/session-attachment-store.js";
import { AGENT_TASKS_DIR } from "../src/config.js";

function configureAgents() {
  const connection = upsertProviderConnection({ connection_id: "orchestration-provider", name: "Orchestration Provider", agent_runtime: "glm", provider: "glm", protocol: "openai-compatible", base_url: "https://provider.example", models: ["orchestration-model"], default_model: "orchestration-model", api_key: "orchestration-secret", credential_source: "managed", credential_env: "GLM_API_KEY", status: "active", metadata: {} });
  recordProviderConnectionVerification(connection.connection_id, { status: "verified", tested_at: new Date().toISOString(), detail: "test", duration_ms: 1, model: "orchestration-model" });
  seedAgentProfile({ profile_id: "default-agent", name: "Main Agent", description: "Main", provider_connection_id: connection.connection_id, agent_runtime: "glm", default_skills: [], allowed_tools: ["workspace_read_text", "workspace_search", "dag_status", "delegate_task"], policy_tags: ["autopilot"], status: "active", metadata: {} });
  upsertAgentDefinition({ agentId: "worker-agent", name: "Worker Agent", createdBy: "test", version: { role: "worker", model_policy: { deployment_id: null, provider_connection_id: connection.connection_id, model: "orchestration-model", allow_runtime_override: false }, tool_policy: { allowed_tools: ["workspace_read_text", "workspace_search"], denied_tools: [], max_tool_rounds: 8 }, workspace_policy: { read: true, write: false, allowed_project_ids: [] } } });
  upsertAgentDefinition({ agentId: "reviewer-agent", name: "Reviewer Agent", createdBy: "test", version: { role: "reviewer", model_policy: { deployment_id: null, provider_connection_id: connection.connection_id, model: "orchestration-model", allow_runtime_override: false }, tool_policy: { allowed_tools: ["workspace_read_text"], denied_tools: [], max_tool_rounds: 4 }, workspace_policy: { read: true, write: false, allowed_project_ids: [] } } });
}

test("Agent Team and DAG enforce role, depth, budget, and permission inheritance", () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const team = upsertAgentTeam({ workspaceId: "default", name: "Delivery Team", orchestratorMemberId: "main", reviewerMemberIds: ["review"], members: [{ member_id: "main", agent_id: "default-agent", agent_version: 1, role: "orchestrator", capability_tags: ["planning"], required: true }, { member_id: "worker", agent_id: "worker-agent", agent_version: 1, role: "worker", capability_tags: ["execution"], required: true }, { member_id: "review", agent_id: "reviewer-agent", agent_version: 1, role: "reviewer", capability_tags: ["quality"], required: true }], policy: { max_concurrency: 2, max_delegation_depth: 2, require_reviewer: true } });
  const dag = createAgentDag({ workspaceId: "default", sessionId: "session-team", idempotencyKey: "team-dag", teamId: team.team_id, title: "Team DAG", objective: "Deliver verified work", orchestratorBinding: main, createdBy: "test" });
  const added = addAgentDagTask({ dag, name: "Read project", objective: "Inspect project", binding: worker, allowedTools: ["workspace_read_text", "workspace_apply_operations"], requestedAutonomy: "autopilot", idempotencyKey: "read-project" });
  assert.deepEqual(added.task.permission_ceiling.allowed_tools, ["workspace_read_text"]);
  assert.equal(added.task.permission_ceiling.workspace_write, false);
  assert.equal(added.task.depth, 1);
  assert.equal(listAgentMessages("default", dag.dag_id)[0]?.message_type, "task.request");
});

test("Agent DAG persistence rejects a corrupted AgentTask cross-reference", () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const dag = createAgentDag({ workspaceId: "default", sessionId: "cross-reference", idempotencyKey: "cross-reference", title: "Cross-reference", objective: "Reject corruption", orchestratorBinding: main, createdBy: "test" });
  const added = addAgentDagTask({ dag, name: "Worker", objective: "Produce output", binding: worker, idempotencyKey: "cross-reference-worker" });
  fs.rmSync(path.join(AGENT_TASKS_DIR, "default", `${added.task.task_id}.json`), { force: true });
  assert.throws(
    () => saveAgentDag(dag),
    (error: unknown) => (error as { code?: string }).code === "agent_dag_task_reference_mismatch",
  );
});

test("Agent DAG narrows Workspace write permission to the node tool allowlist", () => {
  resetTestRoot();
  configureAgents();
  upsertAgentDefinition({
    agentId: "write-capable-agent",
    name: "Write Capable Agent",
    createdBy: "test",
    version: {
      role: "specialist",
      model_policy: { deployment_id: null, provider_connection_id: "orchestration-provider", model: "orchestration-model", allow_runtime_override: false },
      tool_policy: { allowed_tools: ["workspace_read_text", "workspace_apply_operations"], denied_tools: [], max_tool_rounds: 8 },
      workspace_policy: { read: true, write: true, allowed_project_ids: [] },
    },
  });
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  main.tool_policy.allowed_tools = [...new Set([...main.tool_policy.allowed_tools, "workspace_apply_operations"])];
  main.workspace_policy.write = true;
  const binding = createAgentBindingSnapshot({ agentId: "write-capable-agent" });
  const dag = createAgentDag({ workspaceId: "default", sessionId: "permission-narrowing", idempotencyKey: "permission-narrowing", title: "Permission narrowing", objective: "Verify least privilege", orchestratorBinding: main, createdBy: "test" });
  const inherited = addAgentDagTask({ dag, name: "Inherited", objective: "Use the Agent defaults", binding, idempotencyKey: "inherited" });
  const noTools = addAgentDagTask({ dag, name: "No tools", objective: "Reason without tools", binding, allowedTools: [], idempotencyKey: "no-tools" });
  const readOnly = addAgentDagTask({ dag, name: "Read only", objective: "Inspect evidence", binding, allowedTools: ["workspace_read_text"], idempotencyKey: "read-only" });
  const writer = addAgentDagTask({ dag, name: "Writer", objective: "Prepare a change", binding, allowedTools: ["workspace_apply_operations"], idempotencyKey: "writer" });
  assert.deepEqual(inherited.task.permission_ceiling.allowed_tools, ["workspace_read_text", "workspace_apply_operations"]);
  assert.equal(inherited.task.permission_ceiling.workspace_write, true);
  assert.deepEqual(noTools.task.permission_ceiling.allowed_tools, []);
  assert.equal(noTools.task.permission_ceiling.workspace_write, false);
  assert.equal(readOnly.task.permission_ceiling.workspace_write, false);
  assert.equal(writer.task.permission_ceiling.workspace_write, true);
});

test("default execution policy is created once and never replaces a user policy", () => {
  resetTestRoot();
  configureAgents();
  const created = ensureDefaultExecutionPolicy("default", { isVersionReady: () => true });
  assert.equal(created?.team_id, "default-execution-policy");
  assert.equal(created?.policy.max_concurrency, 3);
  assert.equal(created?.policy.max_delegation_depth, 2);
  assert.equal(ensureDefaultExecutionPolicy("default", { isVersionReady: () => false })?.team_id, created?.team_id);
  assert.equal(listAgentTeams("default").length, 1);

  resetTestRoot();
  configureAgents();
  const custom = upsertAgentTeam({
    workspaceId: "default",
    teamId: "user-policy",
    name: "User policy",
    orchestratorMemberId: "main",
    members: [
      { member_id: "main", agent_id: "default-agent", agent_version: 1, role: "orchestrator", capability_tags: [], required: true },
      { member_id: "worker", agent_id: "worker-agent", agent_version: 1, role: "worker", capability_tags: [], required: true },
    ],
    policy: { max_concurrency: 1, max_delegation_depth: 1 },
  });
  assert.equal(ensureDefaultExecutionPolicy("default", { isVersionReady: () => true }), null);
  assert.deepEqual(listAgentTeams("default").map((item) => item.team_id), [custom.team_id]);
});

test("Agent DAG Runner executes isolated worker and reviewer sessions with protocol results", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const reviewer = createAgentBindingSnapshot({ agentId: "reviewer-agent" });
  const mainSession = createSession({ title: "Main Task", provider_connection_id: main.provider_connection_id, model: main.model });
  createAgentRun({ workspaceId: "default", kind: "conversation", bindingSnapshot: main, sessionId: mainSession.session_id });
  const dag = createAgentDag({ workspaceId: "default", sessionId: mainSession.session_id, idempotencyKey: "runner-dag", title: "Runner DAG", objective: "Execute and review", orchestratorBinding: main, policy: { require_reviewer: true, max_delegation_depth: 2 }, createdBy: "test" });
  const work = addAgentDagTask({ dag, name: "Worker", objective: "Produce evidence", binding: worker, idempotencyKey: "worker" });
  addAgentDagTask({ dag, name: "Reviewer", objective: "Verify evidence", binding: reviewer, role: "reviewer", dependsOn: [work.node.node_id], context: { review_task_id: work.task.task_id }, idempotencyKey: "reviewer" });
  const activities: Array<{ status: string; childSessionId: string | null }> = [];
  const runner = new AgentDagRunner({
    turnHandler: async (input) => {
      const session = getSession(input.sessionId)!;
      assert.equal(session.metadata.subagent, true);
      assert.equal(session.hidden, true);
      assert.equal(input.allowedToolNames?.includes("delegate_task"), false);
      const isWorker = session.metadata.agent_task_id === work.task.task_id;
      const responseText = isWorker
        ? "Worker evidence produced."
        : '{"verdict":"accepted","criteria":[{"name":"evidence","passed":true,"detail":"Evidence is complete."}],"issues":[],"required_revisions":[]}';
      const startedMessage = createSessionMessage({ session_id: session.session_id, role: "user", kind: "text", content: { text: "Begin delegated work." } });
      await input.onStarted?.({
        userMessage: startedMessage,
        providerConnectionId: "orchestration-provider",
        model: "orchestration-model",
        checkpointId: `checkpoint_${session.session_id}`,
      });
      await input.onDelta(responseText);
      if (isWorker) {
        await input.onToolProgress?.({
          action_id: "action_worker_read",
          tool_call_id: "tool_call_worker_read",
          tool_name: "workspace_read_text",
          risk_level: "T0",
          status: "running",
          summary: "Reading workspace evidence.",
        });
        await input.onToolProgress?.({
          action_id: "action_worker_read",
          tool_call_id: "tool_call_worker_read",
          tool_name: "workspace_read_text",
          risk_level: "T0",
          status: "succeeded",
          summary: "Workspace evidence read.",
        });
        createSessionAttachment({
          sessionId: session.session_id,
          request: {
            name: "worker-evidence.md",
            storage_uri: "/api/test-artifacts/worker-evidence.md",
            mime_type: "text/markdown",
            size_bytes: 24,
            kind: "document",
            summary: "Worker evidence",
            metadata: { source: "conversation_generated_output" },
          },
        });
      }
      const assistantMessage = createSessionMessage({ session_id: session.session_id, role: "orchestrator", kind: "text", content: { text: responseText } });
      return { session, assistantMessage };
    },
    onNodeActivity: (event) => { activities.push({ status: event.status, childSessionId: event.childSessionId }); },
  });
  const outcome = await runner.run({ workspaceId: "default", dagId: dag.dag_id });
  assert.equal(outcome.status, "completed");
  assert.equal((outcome.budget_usage as { tool_rounds: number }).tool_rounds, 0);
  assert.equal(getAgentDag("default", dag.dag_id)?.nodes.every((node) => node.status === "completed"), true);
  assert.equal(listAgentResults(work.task.task_id)[0]?.verification.status, "verified");
  const runs = listAgentRuns("default");
  const dagRuns = runs.filter((run) => run.workflow_run_id === dag.dag_id);
  assert.equal(dagRuns.length, 3);
  const rootRun = dagRuns.find((run) => run.node_run_id === null)!;
  const childRuns = dagRuns.filter((run) => run.node_run_id !== null);
  assert.equal(childRuns.every((run) => Boolean(run.session_id)), true, "child Session ids must be durable while the DAG is running");
  assert.equal(childRuns.every((run) => getSession(run.session_id!)?.hidden === true), true);
  assert.equal(childRuns.every((run) => getSession(run.session_id!)?.status === "completed"), true);
  assert.equal(childRuns.every((run) => getSession(run.session_id!)?.metadata.agent_task_status === "completed"), true);
  assert.equal(childRuns.every((run) => run.parent_agent_run_id === rootRun.agent_run_id), true);
  const workerRun = childRuns.find((run) => run.node_run_id === work.node.node_id)!;
  const workerEvents = listAgentRunEvents({ workspaceId: "default", agentRunId: workerRun.agent_run_id, limit: 100 });
  const workerEventTypes = workerEvents.map((event) => event.type);
  assert.ok(workerEventTypes.includes("task.assigned"));
  assert.ok(workerEventTypes.includes("agent.started"));
  assert.ok(workerEventTypes.includes("checkpoint.saved"));
  assert.ok(workerEventTypes.includes("agent.message.delta"));
  const workerCompletedMessage = workerEvents.find((event) => event.type === "agent.message.completed");
  assert.equal(workerCompletedMessage?.payload.text, "Worker evidence produced.");
  assert.ok(workerEventTypes.includes("tool.started"));
  assert.ok(workerEventTypes.includes("tool.completed"));
  assert.ok(workerEventTypes.includes("artifact.created"));
  assert.ok(workerEventTypes.includes("handoff.returned"));
  assert.ok(workerEventTypes.includes("agent.completed"));
  assert.deepEqual(workerEvents.map((event) => event.sequence), workerEvents.map((_event, index) => index + 1));
  const reviewerRun = childRuns.find((run) => run.node_run_id !== work.node.node_id)!;
  const reviewerEvents = listAgentRunEvents({ workspaceId: "default", agentRunId: reviewerRun.agent_run_id, limit: 100 });
  assert.ok(reviewerEvents.some((event) => event.type === "agent.progress"));
  assert.equal(reviewerEvents.some((event) => event.type === "agent.message.delta"), false, "Reviewer wire JSON must not be exposed as live conversation text.");
  const reviewerCompletedMessage = reviewerEvents.find((event) => event.type === "agent.message.completed");
  assert.equal(typeof reviewerCompletedMessage?.payload.result, "object");
  assert.equal(Object.hasOwn(reviewerCompletedMessage?.payload || {}, "text"), false, "Reviewer wire JSON must not be copied into a text event payload.");
  assert.equal(activities.filter((event) => event.status === "started" && event.childSessionId).length, 2);
  assert.equal(activities.filter((event) => event.status === "completed" && event.childSessionId).length, 2);
  const parent = getSession(mainSession.session_id)!;
  parent.metadata = { ...parent.metadata, latest_agent_dag_id: dag.dag_id };
  saveSession(parent);
  const projectionServer = await startTestServer();
  try {
    const projection = await getJson(`${projectionServer.baseUrl}/api/sessions/${encodeURIComponent(mainSession.session_id)}`);
    assert.equal(projection.status, 200);
    assert.equal(projection.body.agent_delegations.length, 2);
    assert.equal(projection.body.agent_delegations.every((item: { child_session_id?: string }) => Boolean(item.child_session_id)), true);
    assert.equal(projection.body.agent_delegations.every((item: { messages?: unknown[] }) => Array.isArray(item.messages) && item.messages.length > 0), true);
    assert.equal(projection.body.agent_delegations.every((item: { events?: unknown[] }) => Array.isArray(item.events) && item.events.length > 0), true);
    assert.equal(projection.body.agent_delegations.find((item: { node_id?: string }) => item.node_id === work.node.node_id).artifacts.length, 1);
  } finally {
    await projectionServer.close();
  }
  const messageTypes = listAgentMessages("default", dag.dag_id).map((message) => message.message_type);
  assert.ok(messageTypes.includes("task.accepted"));
  assert.ok(messageTypes.includes("task.result"));
});

test("Agent DAG Runner treats expected artifacts as deliverable metadata, not required JSON fields", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const mainSession = createSession({ title: "Deliverable metadata", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: mainSession.session_id, idempotencyKey: "deliverable-metadata", title: "Deliverable metadata", objective: "Produce an auditable report", orchestratorBinding: main, createdBy: "test" });
  const work = addAgentDagTask({
    dag,
    name: "Prepare report",
    objective: "Prepare the report and attach it.",
    binding: worker,
    expectedOutput: { expected_artifacts: ["agent-report"] },
    idempotencyKey: "prepare-report",
  });
  const runner = new AgentDagRunner({
    turnHandler: async (input) => {
      const prompt = String(input.content || "");
      assert.match(prompt, /Expected deliverables: agent-report/);
      assert.doesNotMatch(prompt, /Return a JSON object matching this output schema/);
      const session = getSession(input.sessionId)!;
      createSessionAttachment({
        sessionId: session.session_id,
        request: {
          name: "agent-report.md",
          storage_uri: "/api/test-artifacts/agent-report.md",
          mime_type: "text/markdown",
          size_bytes: 32,
          kind: "document",
          summary: "Agent report",
          metadata: { source: "conversation_generated_output" },
        },
      });
      const assistantMessage = createSessionMessage({ session_id: session.session_id, role: "orchestrator", kind: "text", content: { text: '{"summary":"Report complete."}' } });
      return { session, assistantMessage };
    },
  });
  const outcome = await runner.run({ workspaceId: "default", dagId: dag.dag_id });
  assert.equal(outcome.status, "completed");
  const result = listAgentResults(work.task.task_id)[0]!;
  assert.equal(result.output.summary, "Report complete.");
  assert.equal(result.artifact_refs.length, 1);
  assert.equal(result.artifact_refs[0]?.name, "agent-report.md");
});

test("multi-Agent coding DAG shares one authorized sandbox and finalizes one parent Change Set", async () => {
  resetTestRoot();
  configureAgents();
  upsertAgentDefinition({ agentId: "frontend-agent", name: "Frontend Agent", createdBy: "test", version: { role: "specialist", model_policy: { deployment_id: null, provider_connection_id: "orchestration-provider", model: "orchestration-model", allow_runtime_override: false }, tool_policy: { allowed_tools: ["workspace_read_text", "workspace_search", "workspace_apply_operations"], denied_tools: [], max_tool_rounds: 8 }, workspace_policy: { read: true, write: true, allowed_project_ids: [] }, autonomy_ceiling: "autopilot" } });
  upsertAgentDefinition({ agentId: "backend-agent", name: "Backend Agent", createdBy: "test", version: { role: "specialist", model_policy: { deployment_id: null, provider_connection_id: "orchestration-provider", model: "orchestration-model", allow_runtime_override: false }, tool_policy: { allowed_tools: ["workspace_read_text", "workspace_search", "workspace_apply_operations"], denied_tools: [], max_tool_rounds: 8 }, workspace_policy: { read: true, write: true, allowed_project_ids: [] }, autonomy_ceiling: "autopilot" } });
  upsertAgentDefinition({ agentId: "test-agent", name: "Test Agent", createdBy: "test", version: { role: "specialist", model_policy: { deployment_id: null, provider_connection_id: "orchestration-provider", model: "orchestration-model", allow_runtime_override: false }, tool_policy: { allowed_tools: ["workspace_read_text", "workspace_search", "workspace_apply_operations"], denied_tools: [], max_tool_rounds: 8 }, workspace_policy: { read: true, write: true, allowed_project_ids: [] }, autonomy_ceiling: "autopilot" } });
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const session = createSession({ title: "Shared coding DAG", provider_connection_id: main.provider_connection_id, model: main.model, agent_id: "default-agent" });
  const workspaceRoot = fs.mkdtempSync(path.join(TEST_ROOT, "shared-agent-workspace-"));
  registerWorkspaceBinding({ workspaceId: "default", sessionId: session.session_id, desktopInstanceId: "test-desktop", capabilityId: "test-capability", rootPath: workspaceRoot, access: "sandbox-write", scope: "session" });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "proposal:shared-coding", title: "Medium system", objective: "Build and review a medium system", orchestratorBinding: main, policy: { max_concurrency: 2, require_reviewer: true }, createdBy: "test" });
  const backend = addAgentDagTask({ dag, name: "Backend", objective: "Create backend", binding: createAgentBindingSnapshot({ agentId: "backend-agent" }), requestedAutonomy: "autopilot", allowedTools: ["workspace_apply_operations"], idempotencyKey: "shared-backend" });
  const frontend = addAgentDagTask({ dag, name: "Frontend", objective: "Create frontend", binding: createAgentBindingSnapshot({ agentId: "frontend-agent" }), requestedAutonomy: "autopilot", allowedTools: ["workspace_apply_operations"], idempotencyKey: "shared-frontend" });
  const tests = addAgentDagTask({ dag, name: "Tests", objective: "Inspect both implementations and create tests", binding: createAgentBindingSnapshot({ agentId: "test-agent" }), requestedAutonomy: "autopilot", allowedTools: ["workspace_search", "workspace_apply_operations"], dependsOn: [backend.node.node_id, frontend.node.node_id], idempotencyKey: "shared-tests" });
  addAgentDagTask({ dag, name: "Review", objective: "Review the complete shared workspace", binding: createAgentBindingSnapshot({ agentId: "reviewer-agent" }), role: "reviewer", allowedTools: ["workspace_search"], dependsOn: [tests.node.node_id], context: { review_task_id: tests.task.task_id }, idempotencyKey: "shared-review" });
  let finalizedChanges = 0;
  const runner = new AgentDagRunner({
    turnHandler: async (input) => {
      const child = getSession(input.sessionId)!;
      assert.equal(child.metadata.coding_workspace_owner_session_id, session.session_id);
      const taskId = String(child.metadata.agent_task_id || "");
      if (taskId === backend.task.task_id) {
        applyConversationWorkspaceOperations({ session: child, idempotencyKey: "backend-v1", operations: [{ kind: "write", path: "server/api.js", content: "export const api = 'ready';\n" }] });
      } else if (taskId === frontend.task.task_id) {
        applyConversationWorkspaceOperations({ session: child, idempotencyKey: "frontend-v1", operations: [{ kind: "write", path: "web/app.js", content: "export const ui = 'ready';\n" }] });
      } else {
        if (taskId === tests.task.task_id) {
          const prompt = String(input.content || "");
          assert.match(prompt, /Direct dependency results \(durable Control Plane records\)/);
          assert.match(prompt, /backend_status/);
          assert.match(prompt, /frontend_status/);
        }
        const visible = searchConversationWorkspace({ session: child, query: "ready" });
        assert.equal((visible.results as unknown[]).length >= 2, true);
        if (taskId === tests.task.task_id) {
          applyConversationWorkspaceOperations({ session: child, idempotencyKey: "tests-v1", operations: [{ kind: "write", path: "test/system.test.js", content: "// backend and frontend contract test\n" }] });
        }
      }
      const text = taskId === tests.task.task_id
        ? '{"test_status":"passed"}'
        : taskId === backend.task.task_id
          ? '{"backend_status":"ready"}'
          : taskId === frontend.task.task_id
            ? '{"frontend_status":"ready"}'
            : '{"verdict":"accepted","criteria":[{"name":"shared workspace","passed":true,"detail":"All files visible"}],"issues":[],"required_revisions":[]}';
      return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text } }) };
    },
    onDagFinished: ({ sessionId }) => {
      const changeSet = finalizeConversationCodingTransaction(getSession(sessionId)!);
      finalizedChanges = changeSet?.changes.length || 0;
    },
  });
  const outcome = await runner.run({ workspaceId: "default", dagId: dag.dag_id });
  assert.equal(outcome.status, "completed");
  assert.equal(finalizedChanges, 3);
  assert.equal(fs.readdirSync(workspaceRoot).length, 0, "Source Workspace must remain unchanged until Change Set approval.");
  const server = await startTestServer();
  try {
    const visibleSessions = await getJson(`${server.baseUrl}/api/sessions`);
    assert.equal(visibleSessions.body.items.some((item: { title?: string }) => item.title?.startsWith("[Sub Agent]")), false);
  } finally {
    await server.close();
  }
});

test("write-capable Agent DAG nodes cannot complete from a claim without workspace evidence", async () => {
  resetTestRoot();
  configureAgents();
  upsertAgentDefinition({
    agentId: "evidence-writer",
    name: "Evidence Writer",
    createdBy: "test",
    version: {
      role: "specialist",
      model_policy: { deployment_id: null, provider_connection_id: "orchestration-provider", model: "orchestration-model", allow_runtime_override: false },
      tool_policy: { allowed_tools: ["workspace_apply_operations"], denied_tools: [], max_tool_rounds: 4 },
      workspace_policy: { read: true, write: true, allowed_project_ids: [] },
      autonomy_ceiling: "assisted",
    },
  });
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  main.tool_policy.allowed_tools = [...new Set([...main.tool_policy.allowed_tools, "workspace_apply_operations"])];
  main.workspace_policy.write = true;
  const session = createSession({ title: "Evidence guard", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "evidence-guard", title: "Evidence guard", objective: "Create a real file", orchestratorBinding: main, createdBy: "test" });
  const added = addAgentDagTask({
    dag,
    name: "Write output",
    objective: "Create output.txt",
    binding: createAgentBindingSnapshot({ agentId: "evidence-writer" }),
    requestedAutonomy: "assisted",
    allowedTools: ["workspace_apply_operations"],
    expectedOutput: { type: "object", properties: { files: { type: "array", items: { type: "string" } }, summary: { type: "string" } }, required: ["files", "summary"] },
    acceptanceCriteria: ["Creates real file output.txt"],
    idempotencyKey: "evidence-write",
  });
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    const child = getSession(input.sessionId)!;
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: '{"files":[],"summary":"The file was created."}' } }) };
  } });

  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "failed");
  const failedRun = listAgentRuns("default").find((run) => run.node_run_id === added.node.node_id);
  assert.equal(failedRun?.error_code, "agent_execution_evidence_missing");
  assert.match(failedRun?.error_message || "", /returned no files/u);
});

test("persistent Agent DAG lease prevents duplicate execution across Runner instances", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Lease test", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "lease-dag", title: "Lease DAG", objective: "Run once", orchestratorBinding: main, createdBy: "test" });
  addAgentDagTask({ dag, name: "Worker", objective: "Execute once", binding: worker, idempotencyKey: "lease-worker" });
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const handler = async (input: Parameters<ConstructorParameters<typeof AgentDagRunner>[0]["turnHandler"]>[0]) => {
    calls += 1;
    started();
    await gate;
    const child = getSession(input.sessionId)!;
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: "Completed once." } }) };
  };
  const firstRunner = new AgentDagRunner({ turnHandler: handler, ownerId: "instance-a", leaseTtlMs: 5_000 });
  const secondRunner = new AgentDagRunner({ turnHandler: handler, ownerId: "instance-b", leaseTtlMs: 5_000 });
  const first = firstRunner.run({ workspaceId: "default", dagId: dag.dag_id });
  await startedPromise;
  const duplicate = await secondRunner.run({ workspaceId: "default", dagId: dag.dag_id });
  assert.equal(duplicate.already_running, true);
  assert.equal(duplicate.lease_held, true);
  assert.equal(calls, 1);
  assert.equal(getAgentDagLease("default", dag.dag_id)?.owner_id, "instance-a");
  release();
  assert.equal((await first).status, "completed");
  assert.equal(calls, 1);
  assert.equal(getAgentDagLease("default", dag.dag_id)?.status, "released");
  assert.equal(listAgentRuns("default").filter((run) => run.workflow_run_id === dag.dag_id).length, 2);
});

test("legacy WorkflowTemplate compiles into the canonical AgentDag definition shape", () => {
  resetTestRoot();
  const definition = dagDefinitionFromWorkflowTemplate({
    template: {
      template_id: "legacy-template",
      version: 3,
      name: "Legacy workflow",
      status: "published",
      description: "Convert this workflow once",
      workspace_scope: "default",
      input_schema: {},
      policy: { max_parallel_nodes: 2, default_timeout_seconds: 300, budget_policy: {}, approval_policy: {} },
      agent_profile_bindings: {},
      nodes: [
        { id: "research", name: "Research", type: "agent_task", agent_profile: "worker-agent", allowed_skills: [], config: {}, retry_policy: { max_attempts: 3, backoff_seconds: 7 }, timeout_seconds: 300, parallelism: 1, approval_kind: null, human_input_schema: null },
        { id: "review", name: "Review", type: "approval", agent_profile: "reviewer-agent", allowed_skills: [], config: {}, retry_policy: { max_attempts: 1, backoff_seconds: 0 }, timeout_seconds: 300, parallelism: 1, approval_kind: "human_review", human_input_schema: null },
      ],
      edges: [{ from: "research", to: "review", condition: null, label: null }],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
    },
  });
  assert.equal(definition.source.kind, "template");
  assert.equal(definition.source.template_id, "legacy-template");
  assert.deepEqual(definition.nodes.map((node) => node.depends_on), [[], ["research"]]);
  assert.deepEqual(definition.nodes[0]?.retry_policy, { max_attempts: 3, backoff_seconds: 7 });
  assert.equal(definition.nodes[1]?.kind, "human_gate");
});

test("WorkflowTemplate preserves the published Agent role in its canonical selector", () => {
  resetTestRoot();
  configureAgents();
  const connectionId = createAgentBindingSnapshot({ agentId: "worker-agent" }).provider_connection_id;
  upsertAgentDefinition({
    agentId: "specialist-agent",
    name: "Specialist Agent",
    createdBy: "test",
    version: {
      role: "specialist",
      model_policy: { deployment_id: null, provider_connection_id: connectionId, model: "orchestration-model", allow_runtime_override: false },
      tool_policy: { allowed_tools: ["workspace_read_text"], denied_tools: [], max_tool_rounds: 4 },
      workspace_policy: { read: true, write: false, allowed_project_ids: [] },
    },
  });
  const definition = dagDefinitionFromWorkflowTemplate({
    template: {
      template_id: "specialist-template",
      version: 1,
      name: "Specialist workflow",
      status: "published",
      description: "Execute a specialist step",
      workspace_scope: "default",
      input_schema: {},
      policy: { max_parallel_nodes: 1, default_timeout_seconds: 300, budget_policy: {}, approval_policy: {} },
      agent_profile_bindings: {},
      nodes: [
        { id: "specialist", name: "Specialist", type: "agent_task", agent_id: "specialist-agent", agent_binding_snapshot: null, allowed_skills: [], config: {}, retry_policy: { max_attempts: 1, backoff_seconds: 0 }, timeout_seconds: 300, parallelism: 1, approval_kind: null, human_input_schema: null },
      ],
      edges: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
    },
  });

  assert.equal(definition.nodes[0]?.agent_selector?.agent_id, "specialist-agent");
  assert.equal(definition.nodes[0]?.agent_selector?.role, "specialist");
});

test("Workflow condition and reducer nodes compile as local control steps without Agent selectors", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const session = createSession({ title: "Control nodes", provider_connection_id: main.provider_connection_id, model: main.model });
  const definition = dagDefinitionFromWorkflowTemplate({
    template: {
      template_id: "control-node-template",
      version: 1,
      name: "Control node workflow",
      status: "published",
      description: "Run condition and combine without delegating them to a model.",
      workspace_scope: "default",
      input_schema: {},
      policy: { max_parallel_nodes: 2, default_timeout_seconds: 300, budget_policy: {}, approval_policy: {} },
      agent_profile_bindings: {},
      nodes: [
        { id: "work", name: "Work", type: "agent_task", agent_profile: "worker-agent", allowed_skills: [], config: { allowed_tools: ["read"], state_output: [{ source_path: "output.approved", target_path: "result.approved", reducer: "replace" }] }, retry_policy: { max_attempts: 1, backoff_seconds: 0 }, timeout_seconds: 300, parallelism: 1, approval_kind: null, human_input_schema: null },
        { id: "check", name: "Approved?", type: "condition", agent_profile: null, allowed_skills: [], config: { condition: { path: "result.approved", operator: "truthy" } }, retry_policy: { max_attempts: 1, backoff_seconds: 0 }, timeout_seconds: 60, parallelism: 1, approval_kind: null, human_input_schema: null },
        { id: "combine", name: "Combine", type: "reducer", agent_profile: null, allowed_skills: [], config: {}, retry_policy: { max_attempts: 1, backoff_seconds: 0 }, timeout_seconds: 60, parallelism: 1, approval_kind: null, human_input_schema: null },
      ],
      edges: [
        { from: "work", to: "check", condition: null, label: null },
        { from: "check", to: "combine", condition: null, label: null },
      ],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
    },
  });
  assert.deepEqual(definition.nodes.map((node) => node.kind), ["agent_task", "condition", "combine"]);
  assert.deepEqual(definition.nodes[0]?.allowed_tools, ["workspace_read_text"]);
  assert.equal(definition.nodes[1]?.agent_selector, null);
  assert.equal(definition.nodes[2]?.agent_selector, null);
  const proposal = {
    protocol_version: 1 as const,
    proposal_id: "control-node-proposal",
    mission_id: "control-node-mission",
    session_id: session.session_id,
    orchestrator_agent_id: main.agent_id,
    source_message_id: null,
    source_revision: null,
    source_option: null,
    title: definition.title,
    summary: definition.objective,
    status: "confirmed" as const,
    mission_spec_contract: null,
    planner_context: { provider_id: null, model: null, orchestrator_agent_id: main.agent_id, system_prompt_summary: null, fallback_used: false, fallback_reason: null },
    orchestration_decision: null,
    dag_definition: definition,
    dag_draft: {},
    route_compare: null,
    assignments: [],
    compiled_agent_dag_id: null,
    compiled_at: null,
    warnings: [],
    checklist: [],
    metadata: { inputs: { incident: { severity: "SEV-1", environment: "synthetic" } } },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    confirmed_by: "test",
    rejected_at: null,
    rejected_by: null,
    superseded_at: null,
    superseded_by_proposal_id: null,
    supersedes_proposal_id: null,
  };
  const dag = compileDagProposalToAgentDag({ workspaceId: "default", proposal, orchestratorBinding: main, createdBy: "test" });
  const executableTask = getAgentTask("default", dag.nodes.find((node) => node.kind === "agent_task")!.task_id)!;
  assert.deepEqual(executableTask.context.mission_inputs, { incident: { severity: "SEV-1", environment: "synthetic" } });
  let modelCalls = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    modelCalls += 1;
    const prompt = String(input.content || "");
    assert.match(prompt, /Mission inputs \(authoritative user-supplied workflow inputs\)/);
    assert.match(prompt, /SEV-1/);
    const child = getSession(input.sessionId)!;
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: '{"approved":true}' } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  assert.equal(modelCalls, 1);
  const completed = getAgentDag("default", dag.dag_id)!;
  assert.equal(completed.nodes.find((node) => node.kind === "condition")?.status, "completed");
  assert.equal(completed.nodes.find((node) => node.kind === "combine")?.status, "completed");
  assert.equal(completed.budget_usage.agent_runs, 1);
});

test("Agent DAG Loop materializes bounded downstream tasks and honors loop concurrency", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Fanout DAG", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({
    workspaceId: "default",
    sessionId: session.session_id,
    idempotencyKey: "fanout-dag",
    title: "Fanout DAG",
    objective: "Process every item",
    orchestratorBinding: main,
    initialState: { items: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    policy: { max_concurrency: 3, max_total_agent_runs: 8 },
    createdBy: "test",
  });
  const loop = addAgentDagTask({ dag, name: "Loop", objective: "Fan out items", binding: main, role: "orchestrator", kind: "fanout", idempotencyKey: "fanout-loop" });
  loop.node.metadata = { workflow_config: { loop: { items_path: "items", item_key: "work_item", index_key: "work_index", max_iterations: 4, concurrency: 1 } }, definition_node_id: "loop" };
  const branch = addAgentDagTask({ dag, name: "Process item", objective: "Process one item", binding: worker, dependsOn: [loop.node.node_id], idempotencyKey: "fanout-worker" });
  const combine = addAgentDagTask({ dag, name: "Combine", objective: "Combine every result", binding: main, role: "orchestrator", kind: "combine", dependsOn: [branch.node.node_id], idempotencyKey: "fanout-combine" });
  saveAgentDag(dag);
  let active = 0;
  let peakActive = 0;
  const seenItems: string[] = [];
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    const child = getSession(input.sessionId)!;
    const task = getAgentTask("default", String(child.metadata.agent_task_id || ""))!;
    seenItems.push(String((task.context.fanout_item as { id?: string })?.id || ""));
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: '{"processed":true}' } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  const completed = getAgentDag("default", dag.dag_id)!;
  const branches = completed.nodes.filter((node) => (node.metadata.dynamic_fanout as { source_node_id?: string } | undefined)?.source_node_id === loop.node.node_id);
  assert.equal(branches.length, 3);
  assert.equal(branches.every((node) => node.status === "completed"), true);
  assert.equal(completed.nodes.find((node) => node.node_id === combine.node.node_id)?.depends_on.length, 3);
  assert.deepEqual(seenItems.sort(), ["a", "b", "c"]);
  assert.equal(peakActive, 1);
  assert.equal(completed.budget_usage.agent_runs, 3);
  assert.equal(listAgentMessages("default", dag.dag_id).filter((message) => message.message_type === "task.request").length, 5);
});

test("Agent DAG Loop skips its branch for zero items and reconnects the downstream join", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Empty fanout", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "empty-fanout", title: "Empty fanout", objective: "Skip empty work", orchestratorBinding: main, initialState: { items: [] }, createdBy: "test" });
  const loop = addAgentDagTask({ dag, name: "Loop", objective: "Fan out items", binding: main, role: "orchestrator", kind: "fanout", idempotencyKey: "empty-loop" });
  loop.node.metadata = { workflow_config: { loop: { items_path: "items", max_iterations: 4, concurrency: 2 } } };
  const branch = addAgentDagTask({ dag, name: "Process item", objective: "Must not run", binding: worker, dependsOn: [loop.node.node_id], idempotencyKey: "empty-worker" });
  const combine = addAgentDagTask({ dag, name: "Combine", objective: "Finish empty work", binding: main, role: "orchestrator", kind: "combine", dependsOn: [branch.node.node_id], idempotencyKey: "empty-combine" });
  saveAgentDag(dag);
  let modelCalls = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    modelCalls += 1;
    const child = getSession(input.sessionId)!;
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: "unexpected" } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  const completed = getAgentDag("default", dag.dag_id)!;
  assert.equal(modelCalls, 0);
  assert.equal(completed.nodes.find((node) => node.node_id === branch.node.node_id)?.status, "skipped");
  assert.deepEqual(completed.nodes.find((node) => node.node_id === combine.node.node_id)?.depends_on, [loop.node.node_id]);
  assert.equal(completed.nodes.find((node) => node.node_id === combine.node.node_id)?.status, "completed");
});

test("Agent DAG Loop rejects cardinality overflow before invoking a model", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Fanout overflow", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "fanout-overflow", title: "Fanout overflow", objective: "Reject excess work", orchestratorBinding: main, initialState: { items: [1, 2, 3] }, createdBy: "test" });
  const loop = addAgentDagTask({ dag, name: "Loop", objective: "Fan out items", binding: main, role: "orchestrator", kind: "fanout", idempotencyKey: "overflow-loop" });
  loop.node.metadata = { workflow_config: { loop: { items_path: "items", max_iterations: 2, concurrency: 1 } } };
  addAgentDagTask({ dag, name: "Process item", objective: "Must not run", binding: worker, dependsOn: [loop.node.node_id], idempotencyKey: "overflow-worker" });
  saveAgentDag(dag);
  let modelCalls = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    modelCalls += 1;
    const child = getSession(input.sessionId)!;
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: "unexpected" } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "failed");
  assert.equal(modelCalls, 0);
  assert.equal(getAgentDag("default", dag.dag_id)?.nodes.find((node) => node.node_id === loop.node.node_id)?.metadata.error_code, "agent_dag_fanout_limit_exceeded");
  assert.equal(listAgentMessages("default", dag.dag_id).some((message) => message.payload.error_code === "agent_dag_fanout_limit_exceeded"), true);
});

test("expired Agent DAG lease can be taken over after a crashed owner", async () => {
  resetTestRoot();
  const first = acquireAgentDagLease({ workspaceId: "default", dagId: "expired-dag", ownerId: "crashed-owner", ttlMs: 100 });
  assert.ok(first);
  await new Promise((resolve) => setTimeout(resolve, 140));
  const second = acquireAgentDagLease({ workspaceId: "default", dagId: "expired-dag", ownerId: "recovery-owner", ttlMs: 100 });
  assert.ok(second);
  assert.equal(second?.owner_id, "recovery-owner");
});

test("Agent DAG charges actual tool rounds instead of reserving each node maximum", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Tool budget", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "tool-budget", title: "Tool budget", objective: "Charge real usage", orchestratorBinding: main, policy: { max_total_tool_rounds: 10 }, createdBy: "test" });
  addAgentDagTask({ dag, name: "Worker", objective: "Use a bounded number of tools", binding: worker, maxToolRounds: 8, idempotencyKey: "tool-budget-worker" });
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    const child = getSession(input.sessionId)!;
    return {
      session: child,
      assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: "Done." } }),
      toolRoundsUsed: 3,
    };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  assert.equal(getAgentDag("default", dag.dag_id)?.budget_usage.tool_rounds, 3);
});

test("Agent DAG Runner evaluates conditions, joins branches, and reduces structured output into durable state", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Stateful DAG", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "stateful-dag", title: "Stateful DAG", objective: "Route structured work", orchestratorBinding: main, initialState: { request: { mode: "publish" } }, createdBy: "test" });
  const producer = addAgentDagTask({ dag, name: "Produce route", objective: "Return route JSON", binding: worker, expectedOutput: { route: "string", items: "array" }, stateOutput: [{ source_path: "output.route", target_path: "route", reducer: "replace" }, { source_path: "output.items", target_path: "items", reducer: "append" }], idempotencyKey: "state-producer" });
  const publish = addAgentDagTask({ dag, name: "Publish", objective: "Publish selected work", binding: worker, dependsOn: [producer.node.node_id], condition: { path: "route", operator: "equals", value: "publish" }, stateInput: { route: "route" }, idempotencyKey: "publish-branch" });
  const archive = addAgentDagTask({ dag, name: "Archive", objective: "Archive selected work", binding: worker, dependsOn: [producer.node.node_id], condition: { path: "route", operator: "equals", value: "archive" }, idempotencyKey: "archive-branch" });
  addAgentDagTask({ dag, name: "Finalize", objective: "Finalize either branch", binding: worker, dependsOn: [publish.node.node_id, archive.node.node_id], joinPolicy: "any", idempotencyKey: "state-finalize" });
  const allBranches = addAgentDagTask({ dag, name: "Finalize all branches", objective: "Do not run when one branch is skipped", binding: worker, dependsOn: [publish.node.node_id, archive.node.node_id], joinPolicy: "all", idempotencyKey: "state-finalize-all" });
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    const child = getSession(input.sessionId)!;
    const taskId = String(child.metadata.agent_task_id || "");
    const text = taskId === producer.task.task_id ? '{"route":"publish","items":["report"]}' : taskId === publish.task.task_id ? '{"published":true}' : '{"finalized":true}';
    const assistantMessage = createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text } });
    return { session: child, assistantMessage };
  } });
  const outcome = await runner.run({ workspaceId: "default", dagId: dag.dag_id });
  assert.equal(outcome.status, "completed");
  const completed = getAgentDag("default", dag.dag_id)!;
  assert.equal(completed.state.route, "publish");
  assert.deepEqual(completed.state.items, ["report"]);
  assert.equal(completed.nodes.find((node) => node.node_id === archive.node.node_id)?.status, "skipped");
  assert.equal(completed.nodes.find((node) => node.node_id === publish.node.node_id)?.status, "completed");
  assert.equal(completed.nodes.find((node) => node.node_id === allBranches.node.node_id)?.status, "skipped");
  assert.equal(completed.nodes.find((node) => node.node_id === allBranches.node.node_id)?.metadata.skipped_reason, "dependency_not_satisfied");
  assert.ok(completed.state_revision >= 3);
});

test("Agent DAG recovers a declared single-field output when model JSON contains unescaped quotes", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Lenient output", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "lenient-output", title: "Lenient output", objective: "Recover declared output", orchestratorBinding: main, createdBy: "test" });
  addAgentDagTask({ dag, name: "Worker", objective: "Return one declared field", binding: worker, expectedOutput: { answer: "string" }, stateOutput: [{ source_path: "output.answer", target_path: "answer", reducer: "replace" }], idempotencyKey: "lenient-output-worker" });
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    const child = getSession(input.sessionId)!;
    return {
      session: child,
      assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: '```json\n{"answer":"value with "unescaped" quote"}\n```' } }),
    };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  assert.equal(getAgentDag("default", dag.dag_id)?.state.answer, 'value with "unescaped" quote');
});

test("Agent DAG Human Gate pauses without invoking a model and resumes from a durable decision", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Human Gate DAG", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "human-gate-dag", title: "Human Gate DAG", objective: "Wait for approval", orchestratorBinding: main, createdBy: "test" });
  const gateNode = addAgentDagTask({ dag, name: "Approve release", objective: "Approve the release", binding: main, role: "orchestrator", kind: "human_gate", humanGate: { gate_type: "approval", prompt: "Approve release?", input_schema: {}, auto_resume: true }, stateOutput: [{ source_path: "$.human_gate.output", target_path: "$.user_approval", reducer: "replace" }], idempotencyKey: "release-gate" });
  gateNode.node.metadata = { ...gateNode.node.metadata, definition_node_id: "release-gate" };
  saveAgentDag(dag);
  addAgentDagTask({ dag, name: "Release", objective: "Release after approval", binding: worker, dependsOn: [gateNode.node.node_id], condition: { path: "$.release-gate.approved", operator: "equals", value: true }, idempotencyKey: "release-worker" });
  let modelCalls = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    modelCalls += 1;
    const child = getSession(input.sessionId)!;
    const assistantMessage = createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: '{"released":true}' } });
    return { session: child, assistantMessage };
  } });
  const waiting = await runner.run({ workspaceId: "default", dagId: dag.dag_id });
  assert.equal(waiting.status, "waiting_human");
  assert.equal(modelCalls, 0);
  const gate = listAgentDagGates("default", dag.dag_id)[0]!;
  assert.equal(gate.status, "pending");
  resolveAgentDagGate({ workspaceId: "default", gateId: gate.gate_id, approved: true, response: { approved: true, note: "ship it" }, resolvedBy: "test" });
  const resumed = await runner.run({ workspaceId: "default", dagId: dag.dag_id });
  assert.equal(resumed.status, "completed");
  assert.equal(modelCalls, 1);
  assert.deepEqual((getAgentDag("default", dag.dag_id)?.state.gates as Record<string, unknown>)[gateNode.node.node_id], { approved: true, note: "ship it" });
  assert.deepEqual(getAgentDag("default", dag.dag_id)?.state["release-gate"], { approved: true, note: "ship it" });
  assert.deepEqual(getAgentDag("default", dag.dag_id)?.state.user_approval, { approved: true, note: "ship it" });
});

test("Reviewer persists a structured verdict and verifies the reviewed result", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const reviewer = createAgentBindingSnapshot({ agentId: "reviewer-agent" });
  const session = createSession({ title: "Structured review", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "structured-review", title: "Structured review", objective: "Verify output", orchestratorBinding: main, policy: { require_reviewer: true }, createdBy: "test" });
  const work = addAgentDagTask({ dag, name: "Work", objective: "Produce output", binding: worker, idempotencyKey: "structured-work" });
  const combined = addAgentDagTask({ dag, name: "Combine", objective: "Combine output", binding: worker, kind: "combine", dependsOn: [work.node.node_id], idempotencyKey: "structured-combine" });
  const review = addAgentDagTask({ dag, name: "Review", objective: "Review output", binding: reviewer, role: "reviewer", kind: "reviewer", dependsOn: [combined.node.node_id], context: { review_task_id: work.task.task_id }, expectedOutput: { verdict: "string", consolidated_summary: "string" }, stateOutput: [{ source_path: "consolidated_summary", target_path: "review.summary", reducer: "replace" }], idempotencyKey: "structured-reviewer" });
  let reviewPrompt = "";
  let correctionPrompt = "";
  let reviewerCalls = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    const child = getSession(input.sessionId)!;
    const isReview = child.metadata.agent_task_id === review.task.task_id;
    if (isReview) {
      reviewerCalls += 1;
      if (reviewerCalls === 1) {
        reviewPrompt = String(input.content || "");
        assert.match(reviewPrompt, /consolidated_summary/u);
      } else {
        correctionPrompt = String(input.content || "");
        assert.deepEqual(input.allowedToolNames, []);
      }
    } else {
      const action = createConversationAction({ workspaceId: "default", sessionId: child.session_id, toolCallId: "test-command", toolName: "workspace_run_command", arguments: { command: "node", args: ["tests.js"] }, riskLevel: "T2", executor: "runtime-worker" });
      completeConversationAction({ action, result: { ok: true, command: "node", exit_code: 0, stdout: "PASS contract\nSUMMARY {\"passed\":1,\"failed\":0}\n", stderr: "" } });
    }
    const cleanReview = '{"verdict":"accepted","consolidated_summary":"Verified synthesis","criteria":[{"name":"complete","passed":true,"detail":"All sections present"}],"issues":[],"required_revisions":[]}';
    const text = isReview && reviewerCalls === 1 ? `${cleanReview}\nCreated a one-time scheduled Task to generate an Excel later.` : isReview ? cleanReview : '{"report":"complete"}';
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  assert.equal(reviewerCalls, 2);
  assert.match(correctionPrompt, /raw JSON object/u);
  const reviewResult = listAgentResults(review.task.task_id)[0]!;
  assert.equal((reviewResult.output.review as { verdict?: string }).verdict, "accepted");
  assert.equal(getAgentDag("default", dag.dag_id)?.state.review && (getAgentDag("default", dag.dag_id)?.state.review as { summary?: string }).summary, "Verified synthesis");
  assert.equal(listAgentResults(work.task.task_id)[0]?.verification.status, "verified");
  assert.match(reviewPrompt, /Upstream execution evidence/u);
  assert.match(reviewPrompt, /workspace_run_command/u);
  assert.match(reviewPrompt, /PASS contract/u);
  assert.match(reviewPrompt, /control_plane_verified/u);
  assert.match(reviewPrompt, /evidence_snapshot_revision/u);
  assert.equal(((listAgentResults(work.task.task_id)[0]?.verification.evidence.execution as { action_count?: number })?.action_count), 1);
});

test("Main Agent exposes only canonical Proposal and delegation tools", async () => {
  resetTestRoot();
  configureAgents();
  const session = createSession({ title: "Main Agent tools", provider_connection_id: "orchestration-provider", model: "orchestration-model" });
  configureAgentDagExecutionHandler(async ({ dagId }) => ({ ok: true, dag_id: dagId, queued: true }));
  try {
    const definitions = getConversationToolDefinitions();
    assert.equal(definitions.some((tool) => tool.name === "dag_create"), false);
    assert.equal(definitions.some((tool) => tool.name === "dag_add_task"), false);
    assert.equal(definitions.some((tool) => tool.name === "dag_propose"), true);
    const retired = await executeConversationTool({ session, call: { id: "dag-create", name: "dag_create", arguments: { title: "Tool DAG", objective: "Build durable result", idempotency_key: "tool-dag" } } });
    assert.equal(retired.is_error, true);
    assert.equal(retired.content.code, "dag_incremental_tools_retired");
    const catalog = await executeConversationTool({ session, call: { id: "agent-list", name: "agent_list", arguments: {} } });
    assert.equal(catalog.is_error, false, JSON.stringify(catalog.content));
    assert.equal((catalog.content.agents as unknown[]).length >= 3, true);
    assert.equal(getConversationToolDefinitions().some((tool) => tool.name === "delegate_task"), true);
  } finally {
    configureAgentDagExecutionHandler(null);
  }
});

test("runtime ownership rejects arbitrary DAGs while preserving confirmed and delegated execution paths", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const session = createSession({ title: "Ownership boundary", provider_connection_id: "orchestration-provider", model: "orchestration-model", agent_id: "default-agent" });
  const arbitrary = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "direct:arbitrary", title: "Arbitrary DAG", objective: "Must not run", orchestratorBinding: main, createdBy: "test" });
  const delegated = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "delegate:ownership-test", title: "Delegated DAG", objective: "May run", orchestratorBinding: main, createdBy: "test" });
  const server = await startTestServer();
  try {
    const retiredCreate = await postJson(`${server.baseUrl}/api/agent-dags`, {
      session_id: session.session_id,
      title: "Bypass",
      objective: "Bypass Proposal",
    });
    assert.equal(retiredCreate.status, 410);
    assert.equal(retiredCreate.body.code, "direct_agent_dag_creation_retired");

    const retiredMutation = await postJson(`${server.baseUrl}/api/agent-dags/${arbitrary.dag_id}/tasks`, {
      name: "Injected node",
      objective: "Mutate runtime graph",
    });
    assert.equal(retiredMutation.status, 410);
    assert.equal(retiredMutation.body.code, "direct_agent_dag_mutation_retired");

    const rejectedApiRun = await postJson(`${server.baseUrl}/api/agent-dags/${arbitrary.dag_id}/run`, {});
    assert.equal(rejectedApiRun.status, 409);
    assert.equal(rejectedApiRun.body.code, "agent_dag_proposal_required");

    const rejectedToolRun = await executeConversationTool({
      session,
      call: { id: "run-arbitrary", name: "dag_run", arguments: { dag_id: arbitrary.dag_id } },
    });
    assert.equal(rejectedToolRun.is_error, true);
    assert.equal(rejectedToolRun.content.code, "agent_dag_proposal_required");

    const delegatedApiRun = await postJson(`${server.baseUrl}/api/agent-dags/${delegated.dag_id}/run`, {});
    assert.equal(delegatedApiRun.status, 202);
    assert.equal(delegatedApiRun.body.dag_id, delegated.dag_id);
    assert.equal(delegatedApiRun.body.proposal_id, null);
  } finally {
    await server.close();
  }
});

test("an unmigrated template fails closed and records its rejected canonical Proposal", async () => {
  resetTestRoot();
  configureAgents();
  seedTemplate(buildPublishedTemplate({
    template_id: "unmigrated-template",
    name: "Unmigrated template",
    agent_profile_bindings: { missing: "missing-agent" },
    nodes: [{
      id: "missing-worker",
      name: "Missing worker",
      type: "agent_task",
      agent_profile: "missing-agent",
      allowed_skills: [],
      config: { allowed_tools: [] },
      retry_policy: { max_attempts: 1, backoff_seconds: 0 },
      timeout_seconds: 60,
      parallelism: 1,
      approval_kind: null,
      human_input_schema: null,
    }],
    edges: [],
    metadata: {},
  }));
  const session = createSession({ title: "Fail closed", provider_connection_id: "orchestration-provider", model: "orchestration-model", agent_id: "default-agent" });
  session.current_goal = "Run an unmigrated template";
  saveSession(session);
  const server = await startTestServer();
  try {
    const run = await postJson(`${server.baseUrl}/api/sessions/${session.session_id}/runs`, {
      template_id: "unmigrated-template",
      validation_mode: "warn",
      inputs: { goal: session.current_goal },
    });
    assert.equal(run.status, 409);
    assert.equal(run.body.code, "canonical_agent_dag_compilation_failed");
    assert.equal(listRuns().length, 0);
    const proposals = listSessionDagProposals(session.session_id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]?.status, "rejected");
    assert.equal((proposals[0]?.metadata.compilation_failure as { code?: string })?.code, "agent_not_found");
  } finally {
    await server.close();
  }
});

test("Sub Agent delegation projects a child AgentDag with inherited depth and cancellation lineage", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const rootSession = createSession({ title: "Root delegation", provider_connection_id: main.provider_connection_id, model: main.model, agent_id: "default-agent" });
  const parent = createAgentDag({ workspaceId: "default", sessionId: rootSession.session_id, idempotencyKey: "hierarchy-parent", title: "Parent", objective: "Delegate nested work", orchestratorBinding: main, policy: { max_delegation_depth: 3 }, createdBy: "test" });
  rootSession.metadata = { ...rootSession.metadata, latest_agent_dag_id: parent.dag_id, active_agent_dag_ids: [parent.dag_id] };
  saveSession(rootSession);
  const childSession = createSession({ title: "Nested orchestrator", provider_connection_id: main.provider_connection_id, model: main.model, agent_id: "default-agent" });
  childSession.metadata = { ...(childSession.metadata || {}), agent_dag_id: parent.dag_id, delegation_depth: 0, agent_binding_snapshot: main, subagent: true, coding_workspace_owner_session_id: rootSession.session_id };
  saveSession(childSession);
  configureAgentDagExecutionHandler(async ({ dagId }) => ({ ok: true, dag_id: dagId, queued: true }));
  try {
    const delegated = await executeConversationTool({ session: childSession, call: { id: "nested-delegate", name: "delegate_task", arguments: { name: "Nested work", objective: "Complete nested work", agent_id: "worker-agent", idempotency_key: "nested-work" } } });
    assert.equal(delegated.is_error, false, JSON.stringify(delegated.content));
    const child = getAgentDag("default", String(delegated.content.dag_id))!;
    assert.equal(child.parent_dag_id, parent.dag_id);
    assert.equal(child.delegation_depth, 1);
    assert.equal(child.policy.max_delegation_depth, 3);
    assert.equal(getSession(rootSession.session_id)?.metadata.latest_agent_dag_id, parent.dag_id);
    assert.deepEqual(getSession(rootSession.session_id)?.metadata.active_agent_dag_ids, [parent.dag_id, child.dag_id]);
    const projectionServer = await startTestServer();
    try {
      const projection = await getJson(`${projectionServer.baseUrl}/api/sessions/${encodeURIComponent(rootSession.session_id)}`);
      assert.equal(projection.status, 200);
      assert.equal(projection.body.agent_delegations.some((item: { dag_id?: string }) => item.dag_id === child.dag_id), true);
    } finally {
      await projectionServer.close();
    }
  } finally {
    configureAgentDagExecutionHandler(null);
  }
});

test("Main Agent proposes a complete DAG atomically and confirmation compilation pins every Agent", async () => {
  resetTestRoot();
  configureAgents();
  const session = createSession({ title: "Unified orchestration", provider_connection_id: "orchestration-provider", model: "orchestration-model", agent_id: "default-agent" });
  const call = {
    id: "dag-propose",
    name: "dag_propose",
    arguments: {
      title: "Research and review",
      objective: "Produce independently reviewed evidence",
      idempotency_key: "unified-proposal",
      nodes: [
        { node_id: "research", name: "Research", kind: "agent_task", objective: "Produce evidence", agent_id: "worker-agent", role: "worker", depends_on: [], allowed_tools: ["workspace_read_text"] },
        { node_id: "review", name: "Review", kind: "reviewer", objective: "Verify evidence", agent_id: "reviewer-agent", role: "reviewer", depends_on: ["research"], allowed_tools: ["workspace_read_text"] },
      ],
    },
  };
  const proposed = await executeConversationTool({ session, call });
  assert.equal(proposed.is_error, false);
  const proposalId = String((proposed.content.proposal as { proposal_id?: string })?.proposal_id || "");
  const proposal = getDagProposal(session.session_id, proposalId)!;
  assert.equal(proposal.protocol_version, 1);
  assert.equal(proposal.orchestration_decision?.mode, "dynamic");
  assert.equal(proposal.dag_definition?.nodes.length, 2);
  assert.equal(listAgentDags("default", session.session_id).length, 0);

  const duplicate = await executeConversationTool({ session, call: { ...call, id: "dag-propose-duplicate" } });
  assert.equal((duplicate.content.proposal as { proposal_id?: string })?.proposal_id, proposalId);
  assert.equal(listSessionDagProposals(session.session_id).length, 1);
  const converged = await executeConversationTool({ session, call: { ...call, id: "dag-propose-converged", arguments: { ...call.arguments, idempotency_key: "unified-proposal-retry" } } });
  assert.equal(converged.content.converged, true);
  assert.equal((converged.content.proposal as { proposal_id?: string })?.proposal_id, proposalId);
  assert.equal(listSessionDagProposals(session.session_id).length, 1);
  assert.equal("dag_definition" in (proposed.content.proposal as Record<string, unknown>), false);
  const invalidDefinitionRun = await executeConversationTool({ session, call: { id: "definition-status", name: "dag_status", arguments: { dag_id: proposal.dag_definition!.definition_id } } });
  assert.equal(invalidDefinitionRun.is_error, true);
  assert.equal(invalidDefinitionRun.content.code, "agent_dag_not_confirmed");

  assert.throws(
    () => compileDagProposalToAgentDag({ workspaceId: "default", proposal, orchestratorBinding: createAgentBindingSnapshot({ agentId: "default-agent" }), createdBy: "test", availableToolNames: ["dag_status"] }),
    (error: unknown) => (error as { code?: string }).code === "agent_tool_unavailable",
  );
  assert.equal(listAgentDags("default", session.session_id).length, 0);

  proposal.metadata.inputs = { project: "gomoku", locale: "zh-CN" };
  proposal.dag_definition!.initial_state = { project: "template-default", stage: "draft" };
  const compiled = compileDagProposalToAgentDag({ workspaceId: "default", proposal, orchestratorBinding: createAgentBindingSnapshot({ agentId: "default-agent" }), createdBy: "test" });
  assert.equal(compiled.nodes.length, 2);
  assert.deepEqual(compiled.state, { project: "gomoku", stage: "draft", locale: "zh-CN" });
  assert.equal(compiled.nodes[0]?.binding_snapshot.agent_id, "worker-agent");
  assert.equal(compiled.nodes[1]?.binding_snapshot.agent_id, "reviewer-agent");
  assert.deepEqual(compiled.nodes[1]?.depends_on, [compiled.nodes[0]?.node_id]);
  assert.equal(compiled.nodes[0]?.reviewer_node_id, compiled.nodes[1]?.node_id);
  assert.equal(getAgentTask("default", compiled.nodes[1]!.task_id)?.context.review_task_id, compiled.nodes[0]?.task_id);
  assert.equal(getConversationToolDefinitions().some((tool) => tool.name === "dag_propose"), true);
});

test("invalid atomic DAG proposal leaves no Proposal or AgentDag partial state", async () => {
  resetTestRoot();
  configureAgents();
  const session = createSession({ title: "Invalid orchestration", provider_connection_id: "orchestration-provider", model: "orchestration-model", agent_id: "default-agent" });
  const result = await executeConversationTool({ session, call: { id: "invalid-dag-propose", name: "dag_propose", arguments: { title: "Invalid DAG", objective: "Must fail atomically", idempotency_key: "invalid-proposal", nodes: [{ node_id: "worker", name: "Worker", kind: "agent_task", objective: "Work", agent_id: "worker-agent", role: "worker", depends_on: ["missing"] }] } } });
  assert.equal(result.is_error, true);
  assert.equal(listSessionDagProposals(session.session_id).length, 0);
  assert.equal(listAgentDags("default", session.session_id).length, 0);
});

test("confirmed Proposal execution uses its compiled AgentDag and locks the reviewed revision", async () => {
  resetTestRoot();
  configureAgents();
  const session = createSession({ title: "Canonical execution", provider_connection_id: "orchestration-provider", model: "orchestration-model", agent_id: "default-agent" });
  session.current_goal = "Execute the reviewed multi-Agent graph";
  saveSession(session);
  const proposed = await executeConversationTool({
    session,
    call: {
      id: "canonical-run-proposal",
      name: "dag_propose",
      arguments: {
        title: "Canonical execution",
        objective: "Produce and review one result",
        idempotency_key: "canonical-run-proposal",
        nodes: [
          { node_id: "work", name: "Work", kind: "agent_task", objective: "Produce the result", agent_id: "worker-agent", role: "worker", depends_on: [], allowed_tools: [] },
          { node_id: "review", name: "Review", kind: "reviewer", objective: "Review the result", agent_id: "reviewer-agent", role: "reviewer", depends_on: ["work"], allowed_tools: [] },
        ],
      },
    },
  });
  const proposalId = String((proposed.content.proposal as { proposal_id?: string })?.proposal_id || "");
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    const responseContent = JSON.stringify(body).includes("required_revisions")
      ? '{"verdict":"accepted","criteria":[{"name":"result","passed":true,"detail":"Result is complete."}],"issues":[],"required_revisions":[]}'
      : "Agent result complete.";
    if (body.stream === true) {
      return new Response([
        `data: ${JSON.stringify({ model: "orchestration-model", choices: [{ delta: { content: responseContent }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 8 } })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({
      id: "chatcmpl_agent_dag",
      model: "orchestration-model",
      choices: [{ index: 0, message: { role: "assistant", content: responseContent }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 8 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({ conversation: { fetchImpl: providerFetch } });
  try {
    const confirmed = await postJson(`${server.baseUrl}/api/sessions/${session.session_id}/dag-proposals/${proposalId}/confirm`, { confirmed_by: "test", start: true });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const dagId = String(confirmed.body.proposal.compiled_agent_dag_id || "");
    assert.ok(dagId.startsWith("agent_dag_"));
    assert.equal(confirmed.body.execution.execution_kind, "agent_dag");
    assert.equal(confirmed.body.execution.agent_dag_id, dagId);

    const locked = await fetch(`${server.baseUrl}/api/sessions/${session.session_id}/dag-proposals/${proposalId}/assignments`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignments: [] }),
    });
    assert.equal(locked.status, 409);
    assert.equal((await locked.json() as { code: string }).code, "proposal_locked");

    assert.equal(listRuns().length, 0);

    const deadline = Date.now() + 5_000;
    while (!getAgentDag("default", dagId) || !["completed", "failed", "waiting_human"].includes(getAgentDag("default", dagId)!.status)) {
      if (Date.now() > deadline) throw new Error("Agent DAG did not reach a terminal state.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(
      getAgentDag("default", dagId)?.status,
      "completed",
      JSON.stringify({
        dag: getAgentDag("default", dagId),
        results: getAgentDag("default", dagId)?.nodes.flatMap((node) => listAgentResults(node.task_id)),
      }),
    );
    assert.equal(getSession(session.session_id)?.metadata.latest_agent_dag_id, dagId);
    const agentRuns = listAgentRuns("default").filter((run) => run.workflow_run_id === dagId);
    const rootRuns = agentRuns.filter((run) => run.node_run_id === null && run.binding_snapshot.agent_role === "orchestrator");
    assert.equal(rootRuns.length, 1);
    assert.equal(agentRuns.filter((run) => run.node_run_id !== null).every((run) => run.parent_agent_run_id === rootRuns[0]?.agent_run_id), true);
    assert.equal(listSessionMessages(session.session_id).filter((message) => message.kind === "run_card" && message.content.event === "started" && message.content.agent_dag_id === dagId).length, 1);
    const activityMessages = listSessionMessages(session.session_id).filter((message) => message.kind === "agent_activity" && message.content.agent_dag_id === dagId);
    assert.equal(activityMessages.filter((message) => message.content.event === "started" && message.content.child_session_id).length, 2);
    assert.equal(activityMessages.filter((message) => message.content.event === "completed" && message.content.child_session_id).length, 2);
    const aggregationDeadline = Date.now() + 5_000;
    while (getSession(session.session_id)?.metadata.latest_aggregated_agent_dag_id !== dagId) {
      if (Date.now() > aggregationDeadline) throw new Error("Main Agent did not aggregate the terminal DAG result.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const summary = listSessionMessages(session.session_id).find((message) => message.content.orchestration_summary === true);
    assert.ok(summary);
    assert.equal(summary?.content.agent_dag_id, dagId);
    assert.deepEqual(summary?.content.active_skills, [], "Internal DAG synthesis must not auto-activate a user-facing Skill.");
    const terminal = await postJson(`${server.baseUrl}/api/agent-dags/${dagId}/run`, {});
    assert.equal(terminal.status, 200);
    assert.equal(terminal.body.terminal, true);
    assert.equal(listSessionMessages(session.session_id).filter((message) => message.content.orchestration_summary === true).length, 1);
  } finally {
    await server.close();
  }
});

test("terminal Agent DAG retries only the failed Main Agent summary", async () => {
  resetTestRoot();
  configureAgents();
  const session = createSession({
    title: "Aggregation recovery",
    provider_connection_id: "orchestration-provider",
    model: "orchestration-model",
    agent_id: "default-agent",
  });
  const proposed = await executeConversationTool({
    session,
    call: {
      id: "aggregation-recovery-proposal",
      name: "dag_propose",
      arguments: {
        title: "Aggregation recovery",
        objective: "Preserve completed node work while recovering the final summary",
        idempotency_key: "aggregation-recovery-proposal",
        nodes: [{
          node_id: "work",
          name: "Completed work",
          kind: "agent_task",
          objective: "Produce durable work",
          agent_id: "worker-agent",
          role: "worker",
          depends_on: [],
          allowed_tools: [],
        }],
      },
    },
  });
  const proposalId = String((proposed.content.proposal as { proposal_id?: string })?.proposal_id || "");
  let synthesisAttempts = 0;
  let allowSynthesis = false;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ content?: string }> };
    assert.match(String(body.messages?.at(-1)?.content || ""), /Act as the Main Agent completing a multi-Agent task/u);
    synthesisAttempts += 1;
    if (!allowSynthesis) {
      return new Response(JSON.stringify({ error: { message: "temporary synthesis failure" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response([
      'data: {"model":"orchestration-model","choices":[{"delta":{"content":"已完成最终汇总，所有持久节点结果均已保留。"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":8}}\n\n',
      "data: [DONE]\n\n",
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({ conversation: { fetchImpl: providerFetch } });
  try {
    const confirmed = await postJson(
      `${server.baseUrl}/api/sessions/${session.session_id}/dag-proposals/${proposalId}/confirm`,
      { confirmed_by: "test" },
    );
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const dagId = String(confirmed.body.proposal.compiled_agent_dag_id || "");
    const dag = getAgentDag("default", dagId)!;
    dag.status = "running";
    dag.nodes.forEach((node) => {
      node.status = "running";
      const task = getAgentTask("default", node.task_id)!;
      task.status = "running";
      saveAgentTask(task);
    });
    saveAgentDag(dag);
    dag.status = "completed";
    dag.nodes.forEach((node) => {
      node.status = "completed";
      const task = getAgentTask("default", node.task_id)!;
      task.status = "completed";
      saveAgentTask(task);
    });
    saveAgentDag(dag);

    const failed = await postJson(`${server.baseUrl}/api/agent-dags/${dagId}/aggregate`, {});
    assert.equal(failed.status, 502, JSON.stringify(failed.body));
    assert.equal(failed.body.aggregation.status, "failed");
    assert.equal(failed.body.aggregation.can_retry, true);
    assert.equal(getSession(session.session_id)?.status, "completed");
    assert.equal(listAgentRuns("default").filter((run) => run.metadata.orchestration_phase === "reduce").length, 1);

    const failedProviderAttempts = synthesisAttempts;
    allowSynthesis = true;
    const recovered = await postJson(`${server.baseUrl}/api/agent-dags/${dagId}/aggregate`, {});
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.aggregation.status, "completed");
    assert.equal(recovered.body.aggregation.attempt_count, 2);
    assert.ok(synthesisAttempts > failedProviderAttempts);
    assert.equal(listSessionMessages(session.session_id).filter((message) => message.content.orchestration_summary === true).length, 1);
    assert.equal(listAgentRuns("default").filter((run) => run.metadata.orchestration_phase === "reduce").length, 2);

    const alreadyCompleted = await postJson(`${server.baseUrl}/api/agent-dags/${dagId}/aggregate`, {});
    assert.equal(alreadyCompleted.status, 200);
    assert.equal(alreadyCompleted.body.already_completed, true);
    assert.equal(listAgentRuns("default").filter((run) => run.metadata.orchestration_phase === "reduce").length, 2);
    assert.equal(listSessionMessages(session.session_id).filter((message) => message.content.orchestration_summary === true).length, 1);
  } finally {
    await server.close();
  }
});

test("Agent DAG recovery retries only failed nodes and increments AgentRun attempts", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Recovery", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "recovery-dag", title: "Recovery DAG", objective: "Recover failed work", orchestratorBinding: main, policy: { max_total_agent_runs: 4 }, createdBy: "test" });
  const added = addAgentDagTask({ dag, name: "Retry worker", objective: "Eventually succeed", binding: worker, idempotencyKey: "retry-worker" });
  let calls = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    calls += 1;
    if (calls === 1) throw new Error("Transient failure");
    const child = getSession(input.sessionId)!;
    const assistantMessage = createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: "Recovered output." } });
    return { session: child, assistantMessage };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "failed");
  assert.equal(getAgentDag("default", dag.dag_id)?.nodes[0]?.status, "failed");
  retryAgentDag("default", dag.dag_id, "Retry transient failure");
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  const attempts = listAgentRuns("default").filter((run) => run.workflow_run_id === dag.dag_id && run.node_run_id === added.node.node_id).map((run) => run.attempt).sort();
  assert.deepEqual(attempts, [1, 2]);
});

test("Agent DAG recovery requeues descendants skipped by an upstream failure", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Dependency recovery", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "dependency-recovery", title: "Dependency recovery", objective: "Recover the complete chain", orchestratorBinding: main, policy: { max_total_agent_runs: 8 }, createdBy: "test" });
  const first = addAgentDagTask({ dag, name: "First", objective: "Fail once", binding: worker, idempotencyKey: "dependency-first" });
  const second = addAgentDagTask({ dag, name: "Second", objective: "Run after First", binding: worker, dependsOn: [first.node.node_id], idempotencyKey: "dependency-second" });
  const third = addAgentDagTask({ dag, name: "Third", objective: "Run after Second", binding: worker, dependsOn: [second.node.node_id], idempotencyKey: "dependency-third" });
  const calls: string[] = [];
  let firstAttempts = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    const child = getSession(input.sessionId)!;
    const taskId = String(child.metadata.agent_task_id || "");
    calls.push(taskId);
    if (taskId === first.task.task_id && firstAttempts++ === 0) throw new Error("First attempt failed");
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: `${taskId} complete` } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "failed");
  assert.deepEqual(getAgentDag("default", dag.dag_id)?.nodes.map((node) => node.status), ["failed", "skipped", "skipped"]);
  const recovered = retryAgentDag("default", dag.dag_id, "Retry the complete dependency chain");
  assert.deepEqual(recovered.nodes.map((node) => node.status), ["queued", "queued", "queued"]);
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  assert.deepEqual(getAgentDag("default", dag.dag_id)?.nodes.map((node) => node.status), ["completed", "completed", "completed"]);
  assert.deepEqual(calls, [first.task.task_id, first.task.task_id, second.task.task_id, third.task.task_id]);
});

test("Agent DAG automatically retries a transient node failure within its durable policy", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Automatic retry", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "automatic-retry", title: "Automatic retry", objective: "Retry transient work", orchestratorBinding: main, createdBy: "test" });
  const added = addAgentDagTask({ dag, name: "Transient worker", objective: "Eventually succeed", binding: worker, retryPolicy: { max_attempts: 2, backoff_seconds: 0 }, idempotencyKey: "automatic-retry-worker" });
  let calls = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("Provider connection reset"), { code: "provider_network_error" });
    const child = getSession(input.sessionId)!;
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: "Recovered automatically." } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  assert.equal(calls, 2);
  assert.deepEqual(listAgentRuns("default").filter((run) => run.node_run_id === added.node.node_id).map((run) => run.attempt).sort(), [1, 2]);
  assert.ok(listAgentMessages("default", dag.dag_id).some((message) => message.idempotency_key === `task.auto-retry:${added.node.node_id}:2`));
});

test("Agent DAG stops automatic retry after max attempts", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Retry exhaustion", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "retry-exhaustion", title: "Retry exhaustion", objective: "Stop after policy", orchestratorBinding: main, createdBy: "test" });
  const added = addAgentDagTask({ dag, name: "Failing worker", objective: "Fail twice", binding: worker, retryPolicy: { max_attempts: 2, backoff_seconds: 0 }, idempotencyKey: "retry-exhaustion-worker" });
  let calls = 0;
  const runner = new AgentDagRunner({ turnHandler: async () => {
    calls += 1;
    throw Object.assign(new Error("Temporary upstream failure"), { code: "provider_503" });
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "failed");
  assert.equal(calls, 2);
  assert.equal(getAgentDag("default", dag.dag_id)?.nodes[0]?.status, "failed");
  assert.equal(listAgentRuns("default").filter((run) => run.node_run_id === added.node.node_id).length, 2);
});

test("Agent DAG does not retry deterministic contract failures", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Permanent failure", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "permanent-failure", title: "Permanent failure", objective: "Fail closed", orchestratorBinding: main, createdBy: "test" });
  addAgentDagTask({ dag, name: "Invalid output", objective: "Return invalid data", binding: worker, retryPolicy: { max_attempts: 3, backoff_seconds: 0 }, idempotencyKey: "permanent-failure-worker" });
  let calls = 0;
  const runner = new AgentDagRunner({ turnHandler: async () => {
    calls += 1;
    throw Object.assign(new Error("Output contract mismatch"), { code: "agent_contract_validation_failed" });
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "failed");
  assert.equal(calls, 1);
});

test("Agent DAG cancellation interrupts automatic retry backoff", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Cancel retry", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "cancel-retry", title: "Cancel retry", objective: "Cancel during wait", orchestratorBinding: main, createdBy: "test" });
  addAgentDagTask({ dag, name: "Waiting retry", objective: "Wait before retry", binding: worker, retryPolicy: { max_attempts: 3, backoff_seconds: 2 }, idempotencyKey: "cancel-retry-worker" });
  let calls = 0;
  const runner = new AgentDagRunner({ turnHandler: async () => {
    calls += 1;
    throw Object.assign(new Error("Network unavailable"), { code: "provider_network_error" });
  } });
  const running = runner.run({ workspaceId: "default", dagId: dag.dag_id });
  while (!getAgentDag("default", dag.dag_id)?.nodes[0]?.metadata.retry_not_before) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  runner.cancel({ workspaceId: "default", dagId: dag.dag_id, reason: "User cancelled during retry backoff." });
  assert.equal((await running).status, "cancelled");
  assert.equal(calls, 1);
});

test("Agent DAG restart recovery preserves retry attempt count and retry window", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Persisted retry", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "persisted-retry", title: "Persisted retry", objective: "Resume retry", orchestratorBinding: main, createdBy: "test" });
  const added = addAgentDagTask({ dag, name: "Persisted worker", objective: "Resume at attempt two", binding: worker, retryPolicy: { max_attempts: 2, backoff_seconds: 0 }, idempotencyKey: "persisted-retry-worker" });
  const failedRun = createAgentRun({ workspaceId: "default", kind: "delegation", bindingSnapshot: worker, workflowRunId: dag.dag_id, nodeRunId: added.node.node_id, parentAgentRunId: null, attempt: 1 });
  failedRun.status = "failed";
  failedRun.error_code = "provider_network_error";
  failedRun.error_message = "Connection reset before restart.";
  failedRun.finished_at = new Date().toISOString();
  saveAgentRun(failedRun);
  dag.status = "running";
  dag.budget_usage.agent_runs = 1;
  added.node.status = "queued";
  added.node.metadata = { retry_not_before: new Date(Date.now() + 25).toISOString(), retry_attempts_completed: 1 };
  saveAgentDag(dag);
  recoverInterruptedAgentDags("default");
  let calls = 0;
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    calls += 1;
    const child = getSession(input.sessionId)!;
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: "Resumed once." } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  assert.equal(calls, 1);
  assert.deepEqual(listAgentRuns("default").filter((run) => run.node_run_id === added.node.node_id).map((run) => run.attempt).sort(), [1, 2]);
});

test("Control Plane restart recovery requeues interrupted Agent DAG nodes without bypassing gates", () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Restart recovery", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "restart-recovery", title: "Restart recovery", objective: "Resume interrupted node", orchestratorBinding: main, createdBy: "test" });
  const added = addAgentDagTask({ dag, name: "Interrupted", objective: "Resume me", binding: worker, idempotencyKey: "interrupted" });
  dag.status = "running";
  added.node.status = "running";
  added.task.status = "running";
  const interruptedRun = createAgentRun({ workspaceId: "default", kind: "delegation", bindingSnapshot: worker, workflowRunId: dag.dag_id, nodeRunId: added.node.node_id });
  added.task.assigned_agent_run_id = interruptedRun.agent_run_id;
  saveAgentTask(added.task);
  saveAgentDag(dag);
  const recovered = recoverInterruptedAgentDags("default");
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.status, "ready");
  assert.equal(recovered[0]?.nodes[0]?.status, "queued");
  assert.equal(getAgentTask("default", added.task.task_id)?.assigned_agent_run_id, null);
  assert.ok(listAgentMessages("default", dag.dag_id).some((message) => message.idempotency_key.startsWith("task.restart-recovery:")));
});

test("Agent DAG cancellation aborts running work and cascades to child DAGs", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "Cancellation", provider_connection_id: main.provider_connection_id, model: main.model });
  const parent = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "cancel-parent", title: "Parent", objective: "Cancel work", orchestratorBinding: main, policy: { max_delegation_depth: 2 }, createdBy: "test" });
  addAgentDagTask({ dag: parent, name: "Long worker", objective: "Wait", binding: worker, idempotencyKey: "long-worker" });
  const child = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "cancel-child", title: "Child", objective: "Child work", orchestratorBinding: main, parentDagId: parent.dag_id, delegationDepth: 1, policy: { max_delegation_depth: 2 }, createdBy: "test" });
  addAgentDagTask({ dag: child, name: "Child worker", objective: "Wait", binding: worker, idempotencyKey: "child-worker" });
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    started();
    await new Promise<void>((resolve, reject) => {
      input.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" })), { once: true });
    });
    throw new Error("unreachable");
  } });
  const running = runner.run({ workspaceId: "default", dagId: parent.dag_id });
  await startedPromise;
  runner.cancel({ workspaceId: "default", dagId: parent.dag_id, reason: "User cancelled." });
  assert.equal((await running).status, "cancelled");
  assert.equal(getAgentDag("default", child.dag_id)?.status, "cancelled");
  assert.equal(listAgentRuns("default").find((run) => run.workflow_run_id === parent.dag_id)?.status, "cancelled");
});

test("Reviewer rejection leaves the DAG waiting for recovery and rejects worker evidence", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const reviewer = createAgentBindingSnapshot({ agentId: "reviewer-agent" });
  const session = createSession({ title: "Review rejection", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "reject-dag", title: "Reject DAG", objective: "Require independent acceptance", orchestratorBinding: main, policy: { require_reviewer: true, max_delegation_depth: 2 }, createdBy: "test" });
  const work = addAgentDagTask({ dag, name: "Worker", objective: "Produce result", binding: worker, idempotencyKey: "reject-worker" });
  addAgentDagTask({ dag, name: "Reviewer", objective: "Review result", binding: reviewer, role: "reviewer", dependsOn: [work.node.node_id], context: { review_task_id: work.task.task_id }, idempotencyKey: "reject-reviewer" });
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    const child = getSession(input.sessionId)!;
    const review = child.metadata.agent_task_id !== work.task.task_id;
    const assistantMessage = createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text: review ? '{"verdict":"rejected","criteria":[{"name":"evidence","passed":false,"detail":"Evidence is incomplete."}],"issues":["missing evidence"],"required_revisions":["add evidence"]}' : "Worker result." } });
    return { session: child, assistantMessage };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "waiting_human");
  assert.equal(listAgentResults(work.task.task_id)[0]?.verification.status, "rejected");
});

test("Assisted DAG automatically repairs one rejected result against the execution contract", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const reviewer = createAgentBindingSnapshot({ agentId: "reviewer-agent" });
  const session = createSession({ title: "Review repair", provider_connection_id: main.provider_connection_id, model: main.model });
  const dag = createAgentDag({ workspaceId: "default", sessionId: session.session_id, idempotencyKey: "repair-dag", title: "Repair DAG", objective: "Repair until accepted", orchestratorBinding: main, policy: { require_reviewer: true, max_delegation_depth: 2 }, createdBy: "test" });
  const work = addAgentDagTask({ dag, name: "Worker", objective: "Produce result", binding: worker, acceptanceCriteria: ["The answer contains verified evidence."], verificationSteps: ["Inspect the evidence field."], idempotencyKey: "repair-worker" });
  const review = addAgentDagTask({ dag, name: "Reviewer", objective: "Review result", binding: reviewer, role: "reviewer", dependsOn: [work.node.node_id], context: { review_task_id: work.task.task_id }, idempotencyKey: "repair-reviewer" });
  let workerCalls = 0;
  let reviewerCalls = 0;
  let repairPrompt = "";
  const runner = new AgentDagRunner({ turnHandler: async (input) => {
    const child = getSession(input.sessionId)!;
    const isReviewer = child.metadata.agent_task_id === review.task.task_id;
    if (isReviewer) reviewerCalls += 1;
    else {
      workerCalls += 1;
      if (workerCalls === 2) repairPrompt = String(input.content || "");
    }
    const text = isReviewer
      ? reviewerCalls === 1
        ? '{"verdict":"rejected","criteria":[{"name":"evidence","passed":false,"detail":"missing"}],"issues":["missing evidence"],"required_revisions":["add evidence"]}'
        : '{"verdict":"accepted","criteria":[{"name":"evidence","passed":true,"detail":"present"}],"issues":[],"required_revisions":[]}'
      : workerCalls === 1 ? '{"answer":"draft"}' : '{"answer":"repaired","evidence":"checked"}';
    return { session: child, assistantMessage: createSessionMessage({ session_id: child.session_id, role: "orchestrator", kind: "text", content: { text } }) };
  } });
  assert.equal((await runner.run({ workspaceId: "default", dagId: dag.dag_id })).status, "completed");
  assert.equal(workerCalls, 2);
  assert.equal(reviewerCalls, 2);
  assert.match(repairPrompt, /Reviewer feedback from the previous attempt/u);
  assert.match(repairPrompt, /add evidence/u);
  assert.ok(listAgentMessages("default", dag.dag_id).some((message) => message.message_type === "task.steer"));
  assert.equal(listAgentResults(work.task.task_id).at(-1)?.verification.status, "verified");
});

test("Agent Team and DAG APIs persist protocol state and expose retry recovery", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const worker = createAgentBindingSnapshot({ agentId: "worker-agent" });
  const session = createSession({ title: "API DAG", provider_connection_id: main.provider_connection_id, model: main.model });
  const server = await startTestServer();
  try {
    const proposed = await executeConversationTool({ session, call: { id: "api-dag-proposal", name: "dag_propose", arguments: { title: "API DAG", objective: "Exercise API", idempotency_key: "api-dag", nodes: [{ node_id: "api-worker", name: "API worker", kind: "agent_task", objective: "Fail then recover", agent_id: "worker-agent", role: "worker", depends_on: [] }] } } });
    assert.equal(proposed.is_error, false, JSON.stringify(proposed.content));
    const proposalId = String((proposed.content.proposal as { proposal_id?: string })?.proposal_id || "");
    const confirmed = await postJson(`${server.baseUrl}/api/sessions/${session.session_id}/dag-proposals/${proposalId}/confirm`, { confirmed_by: "test" });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const dagId = String(confirmed.body.proposal.compiled_agent_dag_id);
    const dag = getAgentDag("default", dagId)!;
    dag.status = "failed";
    dag.nodes[0]!.status = "failed";
    const task = getAgentTask("default", dag.nodes[0]!.task_id)!;
    task.status = "failed";
    saveAgentTask(task);
    saveAgentDag(dag);
    const retried = await postJson(`${server.baseUrl}/api/agent-dags/${dagId}/retry`, { reason: "API recovery" });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.status, "ready");
    const detail = await getJson(`${server.baseUrl}/api/agent-dags/${dagId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.tasks[0].status, "queued");
    assert.ok(detail.body.messages.some((message: { message_type: string }) => message.message_type === "task.progress"));
    assert.equal(worker.agent_role, "worker");
  } finally {
    await server.close();
  }
});

test("Agent DAG Gate API exposes pending approval and auto-resumes the durable graph", async () => {
  resetTestRoot();
  configureAgents();
  const main = createAgentBindingSnapshot({ agentId: "default-agent" });
  const session = createSession({ title: "Gate API", provider_connection_id: main.provider_connection_id, model: main.model });
  const server = await startTestServer();
  try {
    const proposed = await executeConversationTool({ session, call: { id: "gate-api-proposal", name: "dag_propose", arguments: { title: "Gate API", objective: "Require approval", idempotency_key: "gate-api", nodes: [{ node_id: "gate-api-node", name: "Approval", objective: "Approve API flow", kind: "human_gate", depends_on: [], human_gate: { gate_type: "approval", prompt: "Approve API flow?", input_schema: {}, auto_resume: true } }] } } });
    assert.equal(proposed.is_error, false, JSON.stringify(proposed.content));
    const proposalId = String((proposed.content.proposal as { proposal_id?: string })?.proposal_id || "");
    const confirmed = await postJson(`${server.baseUrl}/api/sessions/${session.session_id}/dag-proposals/${proposalId}/confirm`, { confirmed_by: "test" });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const dagId = String(confirmed.body.proposal.compiled_agent_dag_id);
    const waiting = await postJson(`${server.baseUrl}/api/agent-dags/${dagId}/run`, {});
    assert.equal(waiting.status, 202);
    assert.equal(waiting.body.status, "queued");
    const waitingDeadline = Date.now() + 2_000;
    while (getAgentDag("default", dagId)?.status !== "waiting_human") {
      if (Date.now() > waitingDeadline) throw new Error("Gate DAG did not reach its durable Human Gate.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const gates = await getJson(`${server.baseUrl}/api/agent-dags/${dagId}/gates`);
    assert.equal(gates.body.items.length, 1);
    const gateId = String(gates.body.items[0].gate_id);
    const resolved = await postJson(`${server.baseUrl}/api/agent-dags/${dagId}/gates/${gateId}/resolve`, { approved: true, response: { approved: true } });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    const deadline = Date.now() + 2_000;
    while (getAgentDag("default", dagId)?.status !== "completed") {
      if (Date.now() > deadline) throw new Error("Gate DAG did not auto-resume.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(getAgentDag("default", dagId)?.state_revision, 1);
  } finally {
    await server.close();
  }
});
