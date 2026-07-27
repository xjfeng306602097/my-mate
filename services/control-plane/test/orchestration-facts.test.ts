import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentCapabilities } from "../src/agent-capability-resolver.js";
import { buildProposalAgentRequirements } from "../src/dag-proposal-store.js";
import { getPublishedAgentVersion, upsertAgentDefinition } from "../src/agent-runtime-store.js";
import {
  answerMissionInterviewQuestion,
  evaluateInterviewPolicy,
  synchronizeMissionInterview,
} from "../src/interview-policy.js";
import { synchronizeMissionEvolution } from "../src/mission-evolution.js";
import {
  listExecutionShapeDecisions,
  listMissionDeltas,
  listMissionSpecRevisions,
} from "../src/orchestration-fact-store.js";
import {
  evaluateExecutionShapePolicy,
  synchronizeExecutionShapeDecision,
} from "../src/orchestration-policy.js";
import { recordProviderConnectionVerification, upsertProviderConnection } from "../src/provider-connection-store.js";
import { upsertSkill } from "../src/registry-store.js";
import type {
  AgentRequirement,
  InterviewDecisionRecord,
  MissionSpecContract,
  MissionSpecRevisionRecord,
} from "../src/types.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

function missionSpec(overrides: Partial<MissionSpecContract> = {}): MissionSpecContract {
  return {
    specId: "mission_spec:session-p0",
    missionId: "session-p0",
    sessionId: "session-p0",
    schemaVersion: 1,
    title: "Build a product",
    status: "draft",
    objective: "Build a small product",
    sourceBrief: "Build a small product",
    constraints: [],
    requestedOutputs: [],
    openQuestions: [],
    decisionFocus: null,
    route: { activeRevision: null, activeOption: null, latestRevision: null, confirmedRevision: null, confirmedOption: null, selectedTemplateId: null, selectedTemplateName: null, alternativeAvailable: false, stale: false, staleReason: null },
    pipelineSummary: { total: 0, ready: 0, active: 0, blocked: 0, completed: 0, primaryAgentLabels: [] },
    checkpointSummary: { total: 0, completed: 0, active: 0, pending: 0, labels: [] },
    revisionLineage: { sourceRevision: null, sourceOption: null, latestRevision: null, confirmedRevision: null, confirmedOption: null },
    activeRunId: null,
    latestMessageId: "message-1",
    latestUserMessageId: "message-1",
    latestPlanMessageId: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function skipInterview(revision: MissionSpecRevisionRecord): InterviewDecisionRecord {
  return evaluateInterviewPolicy({
    revision,
    delta: {
      schema_version: 1,
      delta_id: "delta-skip",
      mission_id: revision.mission_id,
      session_id: revision.session_id,
      from_revision_id: revision.parent_revision_id,
      to_revision_id: revision.revision_id,
      source_message_id: revision.source_message_id,
      classification: "material",
      changed_fields: ["objective"],
      changes: [],
      requires_interview_reassessment: true,
      requires_orchestration_reassessment: true,
      invalidates_confirmed_proposal: false,
      evidence: [],
      created_at: revision.created_at,
    },
  }).decision;
}

test("Mission Evolution stores semantic revisions and deduplicates operational refreshes", () => {
  resetTestRoot();
  const first = synchronizeMissionEvolution({ missionSpec: missionSpec(), createdAt: "2026-07-19T00:00:00.000Z" });
  assert.equal(first.delta.classification, "baseline");
  const duplicate = synchronizeMissionEvolution({
    missionSpec: missionSpec({ status: "running", updatedAt: "2026-07-19T00:01:00.000Z" }),
    createdAt: "2026-07-19T00:01:00.000Z",
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.revision.revision, 1);
  const changed = synchronizeMissionEvolution({
    missionSpec: missionSpec({ objective: "Build and test a product", requestedOutputs: ["application", "test report"] }),
    createdAt: "2026-07-19T00:02:00.000Z",
  });
  assert.equal(changed.delta.classification, "material");
  assert.ok(changed.delta.changed_fields.includes("objective"));
  assert.equal(listMissionSpecRevisions("session-p0").length, 2);
  assert.equal(listMissionDeltas("session-p0").length, 2);
});

test("Interview Policy skips complete briefs and asks one recommended question at a time", () => {
  resetTestRoot();
  const baseline = synchronizeMissionEvolution({ missionSpec: missionSpec() });
  const skipped = synchronizeMissionInterview({ revision: baseline.revision, delta: baseline.delta });
  assert.equal(skipped.decision.mode, "skip");
  assert.equal(skipped.interview.status, "ready");

  const changed = synchronizeMissionEvolution({
    missionSpec: missionSpec({ openQuestions: ["What acceptance criteria should be used?"] }),
  });
  const focused = synchronizeMissionInterview({ revision: changed.revision, delta: changed.delta });
  assert.equal(focused.decision.mode, "focused");
  assert.equal(focused.interview.questions.length, 1);
  assert.ok(focused.interview.questions[0]?.recommended_answer);
  const answered = answerMissionInterviewQuestion({
    sessionId: "session-p0",
    questionId: focused.interview.questions[0]!.question_id,
    answer: "All automated tests must pass.",
    answerSource: "user",
  });
  assert.equal(answered.status, "ready");
  assert.equal(answered.readiness_score, 100);
});

test("Execution Shape separates temporary delegation from a durable DAG and preserves DAG hysteresis", () => {
  resetTestRoot();
  const directRevision = synchronizeMissionEvolution({ missionSpec: missionSpec({ sourceBrief: "Change the button color to green." }) }).revision;
  const direct = evaluateExecutionShapePolicy({ revision: directRevision, interviewDecision: skipInterview(directRevision) });
  assert.equal(direct.recommended_shape, "direct");
  assert.equal(direct.selected_shape, "direct");

  const delegatedRevision = synchronizeMissionEvolution({ missionSpec: missionSpec({ sourceBrief: "Run two research agents in parallel and summarize their findings." }) }).revision;
  const delegated = evaluateExecutionShapePolicy({ revision: delegatedRevision, interviewDecision: skipInterview(delegatedRevision), autonomyMode: "assisted" });
  assert.equal(delegated.recommended_shape, "delegated");
  assert.equal(delegated.selected_shape, "delegated");

  const dagRevision = synchronizeMissionEvolution({ missionSpec: missionSpec({ sourceBrief: "Build a long-running multi-agent workflow with checkpoints, reviewer acceptance, and recovery." }) }).revision;
  const dag = synchronizeExecutionShapeDecision({ revision: dagRevision, interviewDecision: skipInterview(dagRevision), autonomyMode: "assisted" });
  assert.equal(dag.decision.recommended_shape, "durable_dag");
  assert.equal(dag.decision.selected_shape, null);
  assert.equal(dag.decision.selection_status, "recommended");

  const smallerRevision = synchronizeMissionEvolution({ missionSpec: missionSpec({ sourceBrief: "Finish the remaining work." }) }).revision;
  const retained = synchronizeExecutionShapeDecision({ revision: smallerRevision, interviewDecision: skipInterview(smallerRevision), autonomyMode: "assisted" });
  assert.equal(retained.decision.recommended_shape, "durable_dag");
  assert.ok(retained.decision.reason_codes.includes("durable_dag_hysteresis"));
  assert.equal(listExecutionShapeDecisions("session-p0").length, 2);
});

test("Agent Capability Resolver binds only a ready Agent and exposes real capability gaps", () => {
  resetTestRoot();
  const connection = upsertProviderConnection({ connection_id: "p0-provider", name: "P0 Provider", agent_runtime: "glm", provider: "glm", protocol: "openai-compatible", base_url: "https://provider.example", models: ["p0-model"], default_model: "p0-model", api_key: "test-secret", credential_source: "managed", credential_env: "GLM_API_KEY", status: "active", metadata: {} });
  recordProviderConnectionVerification(connection.connection_id, { status: "verified", tested_at: new Date().toISOString(), detail: "test", duration_ms: 1, model: "p0-model" });
  upsertAgentDefinition({
    agentId: "spreadsheet-specialist",
    name: "Spreadsheet Specialist",
    createdBy: "test",
    version: {
      role: "specialist",
      model_policy: { deployment_id: null, provider_connection_id: connection.connection_id, model: "p0-model", allow_runtime_override: false },
      tool_policy: { allowed_tools: ["workspace_read_text"], denied_tools: [], max_tool_rounds: 8 },
      workspace_policy: { read: true, write: false, allowed_project_ids: [] },
      metadata: { capability_tags: ["spreadsheet"] },
    },
  });
  upsertSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
    description: "Dynamically activatable coding workflow.",
    category: "general",
    allowed_tools: ["workspace_read_text"],
    input_schema: {},
    output_contract: {},
    tags: ["coding"],
    status: "active",
    metadata: {},
  });
  const requirement: AgentRequirement = {
    requirement_id: "spreadsheet-node",
    node_id: "spreadsheet-node",
    preferred_agent_id: null,
    preferred_agent_version: null,
    role: "specialist",
    capability_tags: ["spreadsheet"],
    required_skills: [],
    required_tools: ["workspace_read_text"],
    model_constraints: { provider_connection_id: null, model: null, minimum_context_window: null },
    memory_policy: {},
    permission_policy: { workspace_read: true, workspace_write: false, autonomy_ceiling: null },
    isolation_requirement: "auto",
    input_contract: {},
    output_contract: {},
  };
  const ready = resolveAgentCapabilities({ workspaceId: "default", missionId: "session-p0", sessionId: "session-p0", missionRevisionId: "revision-1", requirements: [requirement], availableToolNames: ["workspace_read_text"] });
  assert.equal(ready.status, "ready", JSON.stringify({ candidates: ready.candidates, gaps: ready.gaps }, null, 2));
  assert.equal(ready.selected_bindings[requirement.requirement_id]?.agent_id, "spreadsheet-specialist");

  const dynamicSkill = resolveAgentCapabilities({ workspaceId: "default", missionId: "session-p0", sessionId: "session-p0", missionRevisionId: "revision-dynamic-skill", requirements: [{ ...requirement, requirement_id: "coding-node", required_skills: ["coding-agent"] }], availableToolNames: ["workspace_read_text"] });
  assert.equal(dynamicSkill.status, "ready", JSON.stringify({ candidates: dynamicSkill.candidates, gaps: dynamicSkill.gaps }, null, 2));

  const blocked = resolveAgentCapabilities({ workspaceId: "default", missionId: "session-p0", sessionId: "session-p0", missionRevisionId: "revision-2", requirements: [{ ...requirement, requirement_id: "pdf-node", required_skills: ["artifact-pdf"] }], availableToolNames: ["workspace_read_text"] });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.gaps.some((gap) => gap.kind === "skill" && gap.value === "artifact-pdf"));

  const roleBlocked = resolveAgentCapabilities({
    workspaceId: "default",
    missionId: "session-p0",
    sessionId: "session-p0",
    missionRevisionId: "revision-3",
    requirements: [{ ...requirement, requirement_id: "worker-role-node", role: "worker", preferred_agent_id: "spreadsheet-specialist" }],
    availableToolNames: ["workspace_read_text"],
  });
  assert.equal(roleBlocked.status, "blocked");
  assert.equal(roleBlocked.selected_bindings["worker-role-node"], null);
  assert.ok(roleBlocked.gaps.some((gap) =>
    gap.kind === "agent" && gap.value === "Required role worker, but spreadsheet-specialist is specialist.",
  ));

  const pinnedV1 = getPublishedAgentVersion("spreadsheet-specialist")!;
  const publishedV2 = upsertAgentDefinition({
    agentId: "spreadsheet-specialist",
    name: "Spreadsheet Specialist",
    createdBy: "test",
    version: {
      role: "specialist",
      model_policy: { deployment_id: null, provider_connection_id: connection.connection_id, model: "p0-model", allow_runtime_override: false },
      tool_policy: { allowed_tools: ["workspace_read_text", "workspace_run_command"], denied_tools: [], max_tool_rounds: 8 },
      workspace_policy: { read: true, write: true, allowed_project_ids: [] },
      metadata: { capability_tags: ["spreadsheet"] },
    },
  });
  assert.ok(publishedV2.version.version > pinnedV1.version);
  const pinnedBlocked = resolveAgentCapabilities({
    workspaceId: "default",
    missionId: "session-p0",
    sessionId: "session-p0",
    missionRevisionId: "revision-4",
    requirements: [{
      ...requirement,
      requirement_id: "pinned-v1-node",
      preferred_agent_id: "spreadsheet-specialist",
      preferred_agent_version: pinnedV1.version,
      required_tools: ["workspace_run_command"],
      permission_policy: { workspace_read: true, workspace_write: true, autonomy_ceiling: "assisted" },
    }],
    availableToolNames: ["workspace_read_text", "workspace_run_command"],
  });
  assert.equal(pinnedBlocked.status, "blocked");
  assert.equal(pinnedBlocked.selected_bindings["pinned-v1-node"], null);
  assert.ok(pinnedBlocked.gaps.some((gap) => gap.kind === "tool" && gap.value === "workspace_run_command"));
});

test("DAG proposal derives Workspace permissions only from declared Workspace tools", () => {
  const baseNode = {
    node_id: "state-only",
    name: "State-only analysis",
    kind: "agent_task",
    role: "specialist",
    agent_selector: { agent_id: "analyst", agent_version: 1, role: "specialist", capability_tags: [] },
    allowed_skills: [],
    allowed_tools: [],
    autonomy_mode: "assisted",
    input_contract: {},
    output_contract: {},
    metadata: {},
  };
  const definition = {
    definition_id: "permission-shape",
    nodes: [
      baseNode,
      { ...baseNode, node_id: "workspace-reader", allowed_tools: ["workspace_read_text"] },
      { ...baseNode, node_id: "workspace-writer", allowed_tools: ["workspace_apply_operations"] },
    ],
  };
  const requirements = buildProposalAgentRequirements({ definition: definition as any, assignments: [] });
  assert.deepEqual(requirements[0].permission_policy, {
    workspace_read: false,
    workspace_write: false,
    autonomy_ceiling: "assisted",
  });
  assert.deepEqual(requirements[1].permission_policy, {
    workspace_read: true,
    workspace_write: false,
    autonomy_ceiling: "assisted",
  });
  assert.deepEqual(requirements[2].permission_policy, {
    workspace_read: true,
    workspace_write: true,
    autonomy_ceiling: "assisted",
  });
});

test("Orchestration State API exposes current facts and optional decision history", async () => {
  resetTestRoot();
  const server = await startTestServer();
  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Build a small product with a clear acceptance report.",
    });
    assert.equal(created.status, 201);
    const sessionId = created.body.session.session_id;
    const state = await getJson(`${server.baseUrl}/api/missions/${sessionId}/orchestration-state?history=true`);
    assert.equal(state.status, 200);
    assert.equal(state.body.current.mission_revision.revision, 1);
    assert.equal(state.body.current.mission_delta.classification, "baseline");
    assert.ok(state.body.current.interview_decision);
    assert.ok(state.body.current.execution_shape_decision);
    assert.equal(state.body.history.mission_revisions.length, 1);
    assert.equal(state.body.history.execution_shape_decisions.length, 1);
  } finally {
    await server.close();
  }
});
