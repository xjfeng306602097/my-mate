import test from "node:test";
import assert from "node:assert/strict";

import { buildMissionUiPlan } from "../src/mission-ui-planner.js";
import { recordProviderConnectionVerification, upsertProviderConnection } from "../src/provider-connection-store.js";
import { runProactiveSupervisionScan } from "../src/proactive-supervisor.js";
import { listSupervisionAlerts } from "../src/supervision-store.js";
import {
  createStubExecutionAdapter,
  postJson,
  putJson,
  resetTestRoot,
  seedAgentProfile,
  seedSkill,
  seedTemplate,
  startTestServer,
} from "./helpers.js";

test("SUP-01 supervision scans persist and deduplicate actionable configuration alerts", async () => {
  resetTestRoot();
  const server = await startTestServer();
  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a supervised task",
      created_by: "test",
    });
    assert.equal(created.status, 201);
    const first = runProactiveSupervisionScan({ now: "2026-07-13T10:00:00.000Z" });
    const second = runProactiveSupervisionScan({ now: "2026-07-13T10:01:00.000Z" });
    assert.equal(first.open_alerts.length, 1);
    assert.equal(second.open_alerts.length, 1);
    assert.equal(first.open_alerts[0].alert_id, second.open_alerts[0].alert_id);
    assert.equal(second.open_alerts[0].occurrence_count, 2);
    assert.equal(listSupervisionAlerts({ status: "open" })[0].recommended_action, "open-task-settings");

    const response = await fetch(`${server.baseUrl}/api/supervision/alerts?status=open`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
  } finally {
    await server.close();
  }
});

test("AI-01 Autopilot persists policy, opens a strict Run, and returns controller truth", async () => {
  resetTestRoot();
  seedSkill({ skill_id: "coding-agent", name: "Coding Agent" });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    runtime_agent_ref: "backend",
    default_skills: ["coding-agent"],
  });
  const connection = upsertProviderConnection({
    connection_id: "autopilot-provider",
    name: "Autopilot Provider",
    agent_runtime: "codex",
    provider: "openai",
    protocol: "codex-appserver",
    base_url: null,
    models: ["gpt-test"],
    default_model: "gpt-test",
    credential_source: "environment",
    credential_env: "OPENAI_API_KEY",
    status: "active",
    metadata: {},
  });
  recordProviderConnectionVerification(connection.connection_id, {
    status: "verified",
    tested_at: "2026-07-13T10:00:00.000Z",
    detail: "verified for test",
    duration_ms: 1,
    model: "gpt-test",
  });
  seedAgentProfile({
    profile_id: "default-agent",
    name: "Default Agent",
    runtime_agent_ref: "default",
    agent_runtime: "codex",
    provider_connection_id: connection.connection_id,
    metadata: { product_autonomy_mode: "autopilot" },
  });
  seedTemplate();
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Build and verify a small change",
      created_by: "test",
    });
    const sessionId = created.body.session.session_id;
    const configured = await putJson(`${server.baseUrl}/api/sessions/${sessionId}/autopilot`, {
      mode: "autopilot",
      max_iterations: 6,
      max_runtime_minutes: 30,
    });
    assert.equal(configured.status, 200);
    const resumed = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/autopilot/resume`, {});
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.status, "running");
    assert.equal(resumed.body.phase, "execution");
    assert.equal(resumed.body.last_action, "start_run");

    const workspaceResponse = await fetch(`${server.baseUrl}/api/sessions/${sessionId}`);
    const workspace = await workspaceResponse.json();
    assert.ok(workspace.latest_run?.run_id);
    assert.equal(workspace.autopilot.mode, "autopilot");
    assert.equal(workspace.ui_plan.version, 1);
    assert.ok(workspace.ui_plan.blocks.some((block: { component: string }) => block.component === "progress_summary"));
  } finally {
    await server.close();
  }
});

test("GENUI-01 emits only registered components and keeps technical details advanced", () => {
  const plan = buildMissionUiPlan({
    session: {
      session_id: "session-ui",
      title: "Adaptive workspace",
      status: "running",
      created_by: "test",
      created_at: "2026-07-13T10:00:00.000Z",
      updated_at: "2026-07-13T10:00:00.000Z",
      current_goal: "Show the right workspace",
      current_plan_summary: null,
      latest_run_id: "run-ui",
      active_run_ids: ["run-ui"],
      last_orchestrator_message_id: null,
      confirmed_plan_revision: null,
      confirmed_plan_option: null,
      confirmed_proposal_id: null,
      archived: false,
      archived_at: null,
      archived_by: null,
      hidden: false,
      hidden_at: null,
      hidden_by: null,
      metadata: {},
    },
    run: {
      run_id: "run-ui",
      template_id: "template-ui",
      template_version: 1,
      workspace_id: "default",
      requested_by: "test",
      intent: "Show the right workspace",
      status: "running",
      current_summary: "Working",
      waiting_reason: null,
      blocked_reason: null,
      started_at: "2026-07-13T10:00:00.000Z",
      finished_at: null,
      last_event_id: null,
      created_at: "2026-07-13T10:00:00.000Z",
      updated_at: "2026-07-13T10:00:00.000Z",
      inputs: {},
      proposal_id: null,
    },
    pendingApprovals: 0,
    pendingHumanInputs: 0,
    resultCount: 0,
    qualityState: "unchecked",
    alerts: [],
    autopilot: null,
  });
  const allowed = new Set([
    "task_guidance",
    "decision_queue",
    "progress_summary",
    "result_gallery",
    "quality_summary",
    "repair_recommendation",
    "conversation",
    "technical_details",
  ]);
  assert.ok(plan.blocks.every((block) => allowed.has(block.component)));
  assert.equal(plan.blocks.find((block) => block.component === "technical_details")?.visibility, "advanced");
  assert.equal(plan.phase, "running");
});

test("GENUI-01 keeps an unplanned task in conversation-first clarification", () => {
  const plan = buildMissionUiPlan({
    session: {
      session_id: "session-clarify",
      title: "Clarify before planning",
      status: "draft",
      created_by: "test",
      created_at: "2026-07-13T10:00:00.000Z",
      updated_at: "2026-07-13T10:00:00.000Z",
      current_goal: "Plan a short trip",
      current_plan_summary: null,
      latest_run_id: null,
      active_run_ids: [],
      last_orchestrator_message_id: null,
      confirmed_plan_revision: null,
      confirmed_plan_option: null,
      confirmed_proposal_id: null,
      archived: false,
      archived_at: null,
      archived_by: null,
      hidden: false,
      hidden_at: null,
      hidden_by: null,
      metadata: {
        workspace_state: {
          stage: "understand",
          next_recommended_action: "clarify",
        },
      },
    },
    run: null,
    pendingApprovals: 0,
    pendingHumanInputs: 0,
    resultCount: 0,
    qualityState: "unchecked",
    alerts: [],
    autopilot: null,
  });

  assert.equal(plan.phase, "clarify");
  assert.equal(plan.primary_action, "review-task-conversation");
  const conversation = plan.blocks.find((block) => block.component === "conversation");
  assert.equal(conversation?.visibility, "primary");
  assert.equal(conversation?.priority, 10);
});
