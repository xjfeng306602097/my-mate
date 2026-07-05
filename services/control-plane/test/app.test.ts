import test from "node:test";
import assert from "node:assert/strict";
import { listApprovals } from "../src/approval-store.js";
import { listArtifacts } from "../src/artifact-store.js";
import { listRunEvents } from "../src/event-store.js";
import { listHumanInputs } from "../src/human-input-store.js";
import { listNodeRuns } from "../src/node-run-store.js";
import { getRunPlan } from "../src/run-plan-store.js";
import { getRun } from "../src/run-store.js";
import { getSession } from "../src/session-store.js";
import { buildDispatchEnvelope } from "../src/adapter-contracts.js";
import {
  cleanupTestArtifacts,
  createStubExecutionAdapter,
  getJson,
  postJson,
  putJson,
  resetTestRoot,
  seedAgentProfile,
  seedSkill,
  seedTemplate,
  startTestServer,
  buildPublishedTemplate,
} from "./helpers.js";

function configureEnv(overrides: Record<string, string> = {}) {
  process.env.MY_MATE_ENABLE_LOCAL_EXECUTION = "true";
  process.env.MY_MATE_EXECUTION_ADAPTER = "local";
  process.env.MY_MATE_AUTO_APPROVE_HUMAN_GATES = "false";
  process.env.MY_MATE_OPENCLAW_CALLBACK_TOKEN = "test-callback-token";
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

async function createRunForTest(serverBaseUrl: string, input?: {
  intent?: string;
  templateId?: string;
  goal?: string;
}) {
  return await postJson(`${serverBaseUrl}/api/runs`, {
    intent: input?.intent || "Test run",
    template_id: input?.templateId || "mobile-test-template",
    inputs: {
      goal: input?.goal || "Verify control-plane behavior",
    },
    validation_mode: "warn",
  });
}

function seedCompareTemplates() {
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
  });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    openclaw_agent_id: "backend",
    default_skills: ["coding-agent"],
  });
  seedAgentProfile({
    profile_id: "review-agent",
    name: "Review Agent",
    openclaw_agent_id: "review-agent",
    default_skills: ["coding-agent"],
  });
  seedTemplate();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "mobile-test-template-alt",
      name: "Review Gate Alternative",
      description: "Alternative workflow with an explicit review gate",
      agent_profile_bindings: {
        backend: "backend",
        "review-agent": "review-agent",
      },
      nodes: [
        {
          id: "node_backend",
          name: "Backend Task",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "review_gate",
          name: "Review Gate",
          type: "approval",
          agent_profile: "review-agent",
          allowed_skills: ["coding-agent"],
          config: {
            output_contract: {
              expected_artifacts: ["review-notes"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 600,
          parallelism: 1,
          approval_kind: "human_review",
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_backend",
          to: "review_gate",
          condition: null,
          label: "review",
        },
      ],
    }),
  );
}

function runtimeGraphNode(input: {
  id: string;
  name: string;
  type?: string;
  approvalKind?: string | null;
  humanInputSchema?: Record<string, unknown> | null;
  expectedArtifacts?: string[];
}) {
  return {
    id: input.id,
    name: input.name,
    type: input.type || "agent_task",
    agent_profile: "backend",
    allowed_skills: ["coding-agent"],
    config: {
      allowed_tools: ["read", "write", "shell"],
      output_contract: {
        expected_artifacts: input.expectedArtifacts || ["agent-report"],
      },
    },
    retry_policy: {
      max_attempts: 1,
      backoff_seconds: 5,
    },
    timeout_seconds: 900,
    parallelism: 1,
    approval_kind: input.approvalKind ?? null,
    human_input_schema: input.humanInputSchema ?? null,
  };
}

function seedRuntimeGraphTemplate(input?: {
  templateId?: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
}) {
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
  });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    openclaw_agent_id: "backend",
    default_skills: ["coding-agent"],
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: input?.templateId || "runtime-graph-template",
      name: "Runtime Graph Template",
      nodes:
        input?.nodes || [
          runtimeGraphNode({
            id: "collect_context",
            name: "Collect Context",
            expectedArtifacts: ["research-notes"],
          }),
          runtimeGraphNode({
            id: "deliver_summary",
            name: "Final Delivery",
            expectedArtifacts: ["final-report"],
          }),
        ],
      edges:
        input?.edges || [
          {
            from: "collect_context",
            to: "deliver_summary",
            condition: null,
            label: "then",
          },
        ],
    }),
  );
}

test("create run seeds scheduler state and mobile summary endpoint", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Mobile summary run",
      template_id: "mobile-test-template",
      inputs: {
        goal: "Verify mobile run summary",
      },
      validation_mode: "warn",
    });

    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;
    assert.equal(createRun.body.status, "queued");

    const run = getRun(runId);
    assert.ok(run);
    assert.equal(run?.status, "queued");
    assert.match(run?.current_summary || "", /ready for dispatch/i);

    const plan = getRunPlan(runId);
    assert.ok(plan);
    assert.equal(plan?.compiled_nodes.length, 1);
    assert.equal(plan?.compiled_nodes[0]?.status, "ready");

    const mobileRuns = await getJson(`${server.baseUrl}/api/mobile/runs`);
    assert.equal(mobileRuns.status, 200);
    const createdSummary = mobileRuns.body.items.find((item: { run_id: string }) => item.run_id === runId);
    assert.ok(createdSummary);
    assert.equal(createdSummary.active_task.status, "ready");
    assert.deepEqual(createdSummary.next_actions, []);

    const mobileDetail = await getJson(`${server.baseUrl}/api/mobile/runs/${runId}`);
    assert.equal(mobileDetail.status, 200);
    assert.equal(mobileDetail.body.run.run_id, runId);
    assert.equal(mobileDetail.body.tasks.length, 1);
    assert.equal(mobileDetail.body.tasks[0].status, "ready");
    assert.equal(mobileDetail.body.timeline[0].type, "run.created");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("run graph projects initial topology frontier and work package mapping", async () => {
  resetTestRoot();
  configureEnv();
  seedRuntimeGraphTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Runtime graph projection",
      template_id: "runtime-graph-template",
      inputs: {
        goal: "Runtime graph projection",
      },
      validation_mode: "warn",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const graph = await getJson(`${server.baseUrl}/api/runs/${runId}/graph`);
    assert.equal(graph.status, 200);
    assert.equal(graph.body.runId, runId);
    assert.equal(graph.body.nodes.length, 2);
    assert.equal(graph.body.edges.length, 1);
    assert.equal(graph.body.statusCounts.ready, 1);
    assert.equal(graph.body.statusCounts.pending, 1);
    assert.equal(graph.body.frontier.length, 1);
    assert.equal(graph.body.nodes[0].markers.includes("active_frontier"), true);
    assert.equal(graph.body.nodes[0].workPackageKey, "research");
    assert.equal(graph.body.nodes[1].workPackageKey, "deliver");
    assert.equal(graph.body.edges[0].status, "pending");
    assert.ok(
      graph.body.summaryLines.some((line: string) => /2 node\(s\), 1 edge\(s\)/.test(line)),
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "runtime-graph-template",
      runId,
      agentProfileId: "backend",
      skillId: "coding-agent",
    });
  }
});

test("run graph marks skipped nodes and the unlocked frontier", async () => {
  resetTestRoot();
  configureEnv();
  seedRuntimeGraphTemplate({
    templateId: "runtime-graph-skip-template",
  });
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Runtime graph skip",
      template_id: "runtime-graph-skip-template",
      inputs: {
        goal: "Runtime graph skip",
      },
      validation_mode: "warn",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const firstNodeRunId = plan?.compiled_nodes.find((node) => node.node_id === "collect_context")?.node_run_id;
    const secondNodeRunId = plan?.compiled_nodes.find((node) => node.node_id === "deliver_summary")?.node_run_id;
    assert.ok(firstNodeRunId);
    assert.ok(secondNodeRunId);

    const skipped = await postJson(`${server.baseUrl}/api/runs/${runId}/nodes/${firstNodeRunId}/actions/skip`, {});
    assert.equal(skipped.status, 200);

    const graph = await getJson(`${server.baseUrl}/api/runs/${runId}/graph`);
    assert.equal(graph.status, 200);
    const skippedNode = graph.body.nodes.find((node: { nodeRunId: string }) => node.nodeRunId === firstNodeRunId);
    assert.ok(skippedNode);
    assert.equal(skippedNode.status, "skipped");
    assert.equal(skippedNode.markers.includes("skipped"), true);
    assert.equal(graph.body.frontier.includes(secondNodeRunId), true);
    assert.equal(graph.body.markers.skipped.includes(firstNodeRunId), true);
    assert.equal(graph.body.edges[0].status, "satisfied");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "runtime-graph-skip-template",
      runId,
      agentProfileId: "backend",
      skillId: "coding-agent",
    });
  }
});

test("run graph marks approval and human-input waiting gates", async () => {
  resetTestRoot();
  configureEnv();
  seedRuntimeGraphTemplate({
    templateId: "runtime-graph-gates-template",
    nodes: [
      runtimeGraphNode({
        id: "approval_gate",
        name: "Approval Gate",
        approvalKind: "human_review",
      }),
      runtimeGraphNode({
        id: "human_input_gate",
        name: "Human Input Gate",
        type: "human_input",
        humanInputSchema: {
          type: "object",
          properties: {
            note: { type: "string" },
          },
          required: ["note"],
        },
      }),
    ],
    edges: [],
  });
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Runtime graph gates",
      template_id: "runtime-graph-gates-template",
      inputs: {
        goal: "Runtime graph gates",
      },
      validation_mode: "warn",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const approvalNodeRunId = plan?.compiled_nodes.find((node) => node.node_id === "approval_gate")?.node_run_id;
    const inputNodeRunId = plan?.compiled_nodes.find((node) => node.node_id === "human_input_gate")?.node_run_id;
    assert.ok(approvalNodeRunId);
    assert.ok(inputNodeRunId);

    const headers = { authorization: "Bearer test-callback-token" };
    const approvalWait = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: approvalNodeRunId,
        status: "waiting_human",
        progress: {
          percent: 50,
          message: "Need approval",
        },
      },
      headers,
    );
    assert.equal(approvalWait.status, 202);

    const inputWait = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: inputNodeRunId,
        status: "waiting_human",
        progress: {
          percent: 50,
          message: "Need structured input",
        },
      },
      headers,
    );
    assert.equal(inputWait.status, 202);

    const graph = await getJson(`${server.baseUrl}/api/runs/${runId}/graph`);
    assert.equal(graph.status, 200);
    assert.equal(graph.body.statusCounts.waiting_human, 2);
    assert.equal(graph.body.markers.waitingHuman.length, 2);
    const approvalNode = graph.body.nodes.find((node: { nodeRunId: string }) => node.nodeRunId === approvalNodeRunId);
    const inputNode = graph.body.nodes.find((node: { nodeRunId: string }) => node.nodeRunId === inputNodeRunId);
    assert.ok(approvalNode);
    assert.ok(inputNode);
    assert.equal(approvalNode.markers.includes("approval_gate"), true);
    assert.equal(approvalNode.markers.includes("waiting_human"), true);
    assert.equal(inputNode.markers.includes("human_input_gate"), true);
    assert.equal(inputNode.humanInputRequired, true);
    assert.ok(
      graph.body.workPackages.some(
        (pkg: { key: string; status: string }) => pkg.key === "review" && pkg.status === "blocked",
      ),
    );
    assert.ok(
      graph.body.workPackages.some(
        (pkg: { key: string; status: string }) => pkg.key === "human-input" && pkg.status === "blocked",
      ),
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "runtime-graph-gates-template",
      runId,
      agentProfileId: "backend",
      skillId: "coding-agent",
    });
  }
});

test("session APIs create thread append messages plan and create linked run", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare today's account follow-up",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;
    assert.ok(created.body.messages.length >= 5);
    assert.equal(created.body.messages[0].role, "user");
    assert.equal(created.body.messages[0].content.text, "Prepare today's account follow-up");
    assert.equal(created.body.messages[1].role, "orchestrator");
    assert.match(
      created.body.messages[1].content.text,
      /active mission|captured the mission brief|updated the active mission|anchored the mission/i,
    );
    assert.ok(
      created.body.messages.some((message: { kind: string }) => message.kind === "orchestrator_turn"),
    );
    assert.ok(
      created.body.messages.some((message: { kind: string }) => message.kind === "workspace_snapshot_card"),
    );

    const list = await getJson(`${server.baseUrl}/api/sessions`);
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].session_id, sessionId);
    assert.ok(list.body.items[0].message_count >= 5);
    assert.equal(list.body.items[0].working_goal, "Prepare today's account follow-up");
    assert.equal(list.body.items[0].mission_snapshot.missionTitle, "Prepare today's account follow-up");
    assert.equal(list.body.items[0].mission_spec.objective, "Prepare today's account follow-up");

    const followUp = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Use a practical tone and include next actions",
    });
    assert.equal(followUp.status, 201);
    assert.equal(followUp.body.user_message.role, "user");
    assert.equal(followUp.body.user_message.content.text, "Use a practical tone and include next actions");
    assert.ok(Array.isArray(followUp.body.messages));
    assert.ok(
      followUp.body.messages.some(
        (message: { role: string; kind: string }) =>
          message.role === "orchestrator" && message.kind === "text",
      ),
    );
    assert.ok(
      followUp.body.messages.some((message: { kind: string }) => message.kind === "workspace_snapshot_card"),
    );

    const detailAfterMessage = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detailAfterMessage.status, 200);
    assert.equal(detailAfterMessage.body.session.current_goal, "Prepare today's account follow-up");
    assert.equal(detailAfterMessage.body.session.constraints_summary, "Use a practical tone and include next actions");
    assert.match(detailAfterMessage.body.session.pending_decision, /tightened|ready|constraint/i);
    assert.equal(detailAfterMessage.body.mission_spec.objective, "Prepare today's account follow-up");
    assert.equal(detailAfterMessage.body.mission_spec_contract.objective, "Prepare today's account follow-up");
    assert.equal(detailAfterMessage.body.mission_spec_contract.schemaVersion, 1);
    assert.equal(detailAfterMessage.body.session.metadata.mission_spec_contract.objective, "Prepare today's account follow-up");
    assert.ok(Array.isArray(detailAfterMessage.body.mission_snapshot.stages));
    assert.ok(detailAfterMessage.body.mission_snapshot.stages.some((stage: { key: string }) => stage.key === "briefing"));
    assert.equal(detailAfterMessage.body.mission_snapshot.spec.constraints[0], "Use a practical tone and include next actions");
    assert.ok(
      detailAfterMessage.body.messages.some(
        (message: { kind: string; content: { working_goal?: string } }) =>
          message.kind === "goal_update_card" &&
          message.content.working_goal === "Prepare today's account follow-up",
      ),
    );
    assert.ok(
      detailAfterMessage.body.messages.some(
        (message: { kind: string; content: { constraints_summary?: string } }) =>
          message.kind === "goal_update_card" &&
          message.content.constraints_summary === "Use a practical tone and include next actions",
      ),
    );

    const attachmentPayload = {
      name: "account-notes.md",
      storage_uri: "file:///workspace/account-notes.md",
      mime_type: "text/markdown",
      size_bytes: 2048,
      kind: "brief",
      summary: "Account history and prior commitments.",
      created_by: "tester",
      metadata: {
        source: "unit-test",
      },
    };
    const attachment = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/attachments`,
      attachmentPayload,
    );
    assert.equal(attachment.status, 201);
    assert.equal(attachment.body.attachment.session_id, sessionId);
    assert.equal(attachment.body.attachment.name, "account-notes.md");
    assert.equal(attachment.body.attachment.storage_uri, "file:///workspace/account-notes.md");
    assert.equal(attachment.body.attachment.kind, "brief");
    assert.equal(attachment.body.attachment.created_by, "tester");
    assert.equal(attachment.body.items.length, 1);

    const attachments = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`);
    assert.equal(attachments.status, 200);
    assert.equal(attachments.body.items[0].attachment_id, attachment.body.attachment.attachment_id);

    const detailAfterAttachment = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detailAfterAttachment.status, 200);
    assert.equal(detailAfterAttachment.body.attachments.length, 1);
    assert.equal(detailAfterAttachment.body.attachments[0].storage_uri, "file:///workspace/account-notes.md");
    assert.equal(detailAfterAttachment.body.session.metadata.attachment_count, 1);

    const missionAfterAttachment = await getJson(`${server.baseUrl}/api/missions/${sessionId}`);
    assert.equal(missionAfterAttachment.status, 200);
    assert.equal(missionAfterAttachment.body.attachments.length, 1);
    assert.equal(missionAfterAttachment.body.attachments[0].name, "account-notes.md");

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      inputs: {
        audience: "key accounts",
      },
    });
    assert.equal(planned.status, 200);
    assert.equal(planned.body.session.session_id, sessionId);
    assert.ok(["planning", "ready_to_run"].includes(planned.body.session.status));
    assert.ok(planned.body.messages.some((message: { kind: string }) => message.kind === "plan_card"));
    assert.ok(planned.body.messages.some((message: { kind: string }) => message.kind === "plan_options_card"));
    assert.equal(planned.body.candidate_plan.template_id, "mobile-test-template");
    assert.ok(Array.isArray(planned.body.messages[1].content.recommendation?.candidates) || planned.body.messages[1].content.recommendation === null);
    assert.equal(planned.body.session.confirmed_plan_revision, null);
    assert.equal(planned.body.session.confirmed_plan_option, null);

    const detailAfterPlan = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detailAfterPlan.status, 200);
    assert.ok(detailAfterPlan.body.messages.length >= 4);
    assert.equal(detailAfterPlan.body.mission_spec.route.activeRevision, 1);
    assert.equal(detailAfterPlan.body.mission_spec.route.activeOption, "primary");
    assert.equal(detailAfterPlan.body.mission_spec.route.latestRevision, 1);
    assert.equal(detailAfterPlan.body.mission_spec.route.selectedTemplateId, "mobile-test-template");
    assert.equal(detailAfterPlan.body.mission_spec_contract.route.activeRevision, 1);
    assert.equal(detailAfterPlan.body.mission_spec_contract.route.selectedTemplateId, "mobile-test-template");
    assert.equal(typeof detailAfterPlan.body.mission_spec.route.alternativeAvailable, "boolean");
    assert.ok(detailAfterPlan.body.mission_spec.pipelineSummary.total >= 1);
    assert.ok(
      detailAfterPlan.body.mission_spec.checkpointSummary.labels.includes("Route comparison"),
    );
    assert.equal(detailAfterPlan.body.mission_spec.revisionLineage.latestRevision, 1);
    assert.ok(detailAfterPlan.body.mission_spec.requestedOutputs.includes("agent-report"));
    assert.equal(detailAfterPlan.body.session.metadata.mission_route_state.active_revision, 1);
    assert.equal(detailAfterPlan.body.session.metadata.mission_route_state.active_option, "primary");
    assert.ok(
      detailAfterPlan.body.session.metadata.mission_requested_outputs.includes("agent-report"),
    );
    assert.equal(detailAfterPlan.body.session.metadata.mission_revision_lineage.latest_revision, 1);
    assert.equal(detailAfterPlan.body.session.metadata.mission_spec_contract.route.activeRevision, 1);

    const storedAfterPlan = getSession(sessionId);
    assert.ok(storedAfterPlan);
    assert.equal(storedAfterPlan?.mission_spec?.route.activeRevision, 1);
    assert.equal(storedAfterPlan?.mission_spec_contract?.route.activeRevision, 1);
    assert.equal(
      (storedAfterPlan?.metadata.mission_spec_contract as { route?: { activeRevision?: number } })?.route?.activeRevision,
      1,
    );
    assert.equal(storedAfterPlan?.mission_snapshot?.spec.route.latestRevision, 1);
    assert.equal(
      (storedAfterPlan?.metadata.mission_route_state as { active_revision?: number })?.active_revision,
      1,
    );
    assert.ok(
      Array.isArray(storedAfterPlan?.metadata.mission_requested_outputs) &&
        storedAfterPlan.metadata.mission_requested_outputs.includes("agent-report"),
    );

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
    });
    assert.equal(runCreated.status, 201);
    runId = runCreated.body.run_id;
    assert.equal(runCreated.body.session.latest_run_id, runId);
    assert.equal(runCreated.body.session.confirmed_plan_revision, 1);
    assert.equal(runCreated.body.session.confirmed_plan_option, "primary");
    assert.ok(runCreated.body.messages.some((message: { kind: string }) => message.kind === "run_card"));
    assert.ok(
      runCreated.body.messages.some(
        (message: { kind: string; content: { plan_revision?: number; plan_option?: string } }) =>
          message.kind === "run_card" &&
          message.content.plan_revision === 1 &&
          message.content.plan_option === "primary",
      ),
    );
    assert.ok(getRun(runId));

    const sessionAfterRun = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(sessionAfterRun.status, 200);
    assert.equal(sessionAfterRun.body.session.latest_run_id, runId);
    assert.equal(sessionAfterRun.body.session.confirmed_plan_revision, 1);
    assert.equal(sessionAfterRun.body.session.confirmed_plan_option, "primary");
    assert.equal(sessionAfterRun.body.session.workspace_state.needs_confirmation, false);
    assert.equal(sessionAfterRun.body.mission_spec.route.confirmedRevision, 1);
    assert.equal(sessionAfterRun.body.mission_spec_contract.route.confirmedRevision, 1);
    assert.equal(sessionAfterRun.body.mission_spec_contract.activeRunId, runId);
    assert.equal(sessionAfterRun.body.mission_spec.route.confirmedOption, "primary");
    assert.equal(sessionAfterRun.body.mission_spec.revisionLineage.confirmedRevision, 1);
    assert.equal(sessionAfterRun.body.latest_run.run_id, runId);

    const storedAfterRun = getSession(sessionId);
    assert.ok(storedAfterRun);
    assert.equal(storedAfterRun?.mission_spec?.route.confirmedRevision, 1);
    assert.equal(storedAfterRun?.mission_snapshot?.spec.revisionLineage.confirmedRevision, 1);
    assert.equal(
      (storedAfterRun?.metadata.mission_route_state as { confirmed_revision?: number })?.confirmed_revision,
      1,
    );
    assert.equal(
      (storedAfterRun?.metadata.mission_revision_lineage as { confirmed_option?: string })?.confirmed_option,
      "primary",
    );

    const messageList = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`);
    assert.equal(messageList.status, 200);
    assert.ok(
      messageList.body.items.some(
        (message: { kind: string; linked_run_id: string | null }) =>
          message.kind === "run_card" && message.linked_run_id === runId,
      ),
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
      runId,
    });
  }
});

test("session summary derives completed status from linked run projection", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "session-status-template",
      name: "Session Status Template",
      description: "Template for session status projection",
      nodes: [
        {
          id: "node_backend",
          name: "Backend Task",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {},
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 1,
          },
          timeout_seconds: 300,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_end",
          name: "End",
          type: "end",
          agent_profile: null,
          allowed_skills: [],
          config: {},
          retry_policy: {
            max_attempts: 0,
            backoff_seconds: 0,
          },
          timeout_seconds: 60,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [{ from: "node_backend", to: "node_end", condition: null, label: null }],
    }),
  );
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    openclaw_agent_id: "backend",
    default_skills: ["coding-agent"],
  });
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
  });
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "status projection test",
    });
    sessionId = created.body.session.session_id;

    await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      inputs: {
        goal: "status projection test",
      },
    });

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
    });
    runId = runCreated.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const firstNode = plan?.compiled_nodes[0];
    const secondNode = plan?.compiled_nodes[1];
    assert.ok(firstNode);
    assert.ok(secondNode);

    const acceptedAt = "2026-06-09T08:45:00.000Z";
    const completedAt = "2026-06-09T08:45:01.000Z";
    const endCompletedAt = "2026-06-09T08:45:02.000Z";

    const callbackHeaders = {
      authorization: "Bearer test-callback-token",
    };

    const accepted = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: firstNode?.node_run_id,
        status: "accepted",
        created_at: acceptedAt,
      },
      callbackHeaders,
    );
    assert.equal(accepted.status, 202);

    const completed = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: firstNode?.node_run_id,
        status: "completed",
        created_at: completedAt,
        progress: {
          percent: 100,
          message: "Node completed",
        },
      },
      callbackHeaders,
    );
    assert.equal(completed.status, 202);

    const endCompleted = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: secondNode?.node_run_id,
        status: "completed",
        created_at: endCompletedAt,
        progress: {
          percent: 100,
          message: "Node completed",
        },
      },
      callbackHeaders,
    );
    assert.equal(endCompleted.status, 202);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.latest_run.status, "completed");
    assert.equal(detail.body.session.status, "completed");
    assert.equal(detail.body.session.latest_run_id, runId);
    assert.deepEqual(detail.body.session.active_run_ids, []);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "session-status-template",
      sessionId,
      runId,
    });
  }
});

test("session plan stores alternative template candidates for thread-side replanning", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "mobile-test-template-alt",
      name: "Account Follow-up Alternative",
      description: "Alternative follow-up workflow",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare account follow-up",
    });
    sessionId = created.body.session.session_id;

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      inputs: {
        goal: "Prepare account follow-up",
      },
    });
    assert.equal(planned.status, 200);
    const planCard = planned.body.messages.find((message: { kind: string }) => message.kind === "plan_card");
    const optionsCard = planned.body.messages.find((message: { kind: string }) => message.kind === "plan_options_card");
    assert.ok(planCard);
    assert.ok(optionsCard);
    assert.ok(Array.isArray(planCard.content.recommendation?.candidates));
    assert.ok(planCard.content.recommendation.candidates.length >= 2);
    const optionTemplateIds = [
      optionsCard.content.primary.template_id,
      optionsCard.content.alternative.template_id,
    ].sort();
    assert.deepEqual(optionTemplateIds, [
      "mobile-test-template",
      "mobile-test-template-alt",
    ]);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
    });
  }
});

test("session can revise a plan with natural-language instructions and append a new revision", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "mobile-test-template-alt",
      name: "Alternative Review Workflow",
      description: "Alternative workflow for revision requests",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare account follow-up plan",
    });
    sessionId = created.body.session.session_id;

    const firstPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare account follow-up plan",
      },
    });
    assert.equal(firstPlan.status, 200);
    assert.equal(firstPlan.body.messages[1].content.revision, 1);

    const revised = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/revise`, {
      revision: 1,
      instructions: "Use a different approach and switch to an alternative template",
    });
    assert.equal(revised.status, 200);
    assert.equal(revised.body.messages[0].role, "user");
    assert.match(revised.body.messages[0].content.text, /Revise plan:/);
    assert.equal(revised.body.messages[2].kind, "plan_card");
    assert.equal(revised.body.messages[2].content.revision, 2);
    assert.equal(
      revised.body.messages[2].content.template_id,
      "mobile-test-template-alt",
    );
    assert.match(
      revised.body.messages[1].content.text,
      /switched to Alternative Review Workflow/i,
    );
    assert.match(
      revised.body.messages[1].content.text,
      /Alternative templates: Mobile Test Template\./i,
    );

    const thread = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`);
    assert.equal(thread.status, 200);
    const planCards = thread.body.items.filter((message: { kind: string }) => message.kind === "plan_card");
    assert.equal(planCards.length, 2);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.mission_spec.route.activeRevision, 2);
    assert.equal(detail.body.mission_spec.revisionLineage.sourceRevision, 1);
    assert.equal(detail.body.mission_spec.revisionLineage.sourceOption, "primary");
    assert.equal(detail.body.session.metadata.mission_revision_lineage.source_revision, 1);
    assert.equal(detail.body.session.metadata.mission_revision_lineage.source_option, "primary");

    const storedAfterRevise = getSession(sessionId);
    assert.ok(storedAfterRevise);
    assert.equal(storedAfterRevise?.mission_spec?.route.activeRevision, 2);
    assert.equal(storedAfterRevise?.mission_spec?.revisionLineage.sourceRevision, 1);
    assert.equal(
      (storedAfterRevise?.metadata.mission_revision_lineage as { source_revision?: number })?.source_revision,
      1,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
    });
  }
});

test("session compare summarizes primary versus alternative route options", async () => {
  resetTestRoot();
  configureEnv();
  seedCompareTemplates();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare route compare options",
    });
    sessionId = created.body.session.session_id;

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare route compare options",
      },
    });
    assert.equal(planned.status, 200);

    const compare = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/compare`);
    assert.equal(compare.status, 200);
    assert.equal(compare.body.sessionId, sessionId);
    assert.equal(compare.body.comparisonKind, "option");
    assert.equal(compare.body.left.revision, 1);
    assert.equal(compare.body.left.option, "primary");
    assert.equal(compare.body.right.option, "alternative");
    assert.ok(
      compare.body.changedNodes.added.some((label: string) => /Review Gate/.test(label)),
    );
    assert.ok(
      compare.body.changedEdges.added.some((label: string) => /node_backend -> review_gate/.test(label)),
    );
    assert.ok(
      compare.body.changedApprovals.added.some((label: string) => /human_review/.test(label)),
    );
    assert.ok(compare.body.changedOutputs.added.includes("review-notes"));
    assert.match(compare.body.summaryLines.join(" "), /Approval and human gates/i);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
      agentProfileId: "backend",
      skillId: "coding-agent",
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
      agentProfileId: "review-agent",
    });
  }
});

test("session compare supports explicit revision-to-revision diff after revise", async () => {
  resetTestRoot();
  configureEnv();
  seedCompareTemplates();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare route revision compare",
    });
    sessionId = created.body.session.session_id;

    await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare route revision compare",
      },
    });
    const revised = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/revise`, {
      revision: 1,
      instructions: "Use a different approach and switch to an alternative template",
    });
    assert.equal(revised.status, 200);

    const compare = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/compare?left_revision=1&left_option=primary&right_revision=2&right_option=primary`,
    );
    assert.equal(compare.status, 200);
    assert.equal(compare.body.comparisonKind, "revision");
    assert.equal(compare.body.left.revision, 1);
    assert.equal(compare.body.right.revision, 2);
    assert.notEqual(compare.body.left.templateId, compare.body.right.templateId);
    assert.ok(
      compare.body.changedNodes.added.some((label: string) => /Review Gate/.test(label)),
    );
    assert.match(compare.body.summaryLines.join(" "), /Template changed/i);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
      agentProfileId: "backend",
      skillId: "coding-agent",
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
      agentProfileId: "review-agent",
    });
  }
});

test("session compare defaults to confirmed route versus latest route when confirmed exists", async () => {
  resetTestRoot();
  configureEnv();
  seedCompareTemplates();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare confirmed route compare",
    });
    sessionId = created.body.session.session_id;

    await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare confirmed route compare",
      },
    });
    const confirmed = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/confirm`, {
      revision: 1,
      option: "primary",
    });
    assert.equal(confirmed.status, 200);

    await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/revise`, {
      revision: 1,
      option: "primary",
      instructions: "Use a different approach and switch to an alternative template",
    });

    const compare = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/compare`);
    assert.equal(compare.status, 200);
    assert.equal(compare.body.comparisonKind, "confirmed_vs_latest");
    assert.equal(compare.body.left.revision, 1);
    assert.equal(compare.body.left.option, "primary");
    assert.equal(compare.body.right.revision, 2);
    assert.equal(compare.body.changedOutputs.added.includes("review-notes"), true);
    assert.match(compare.body.recommendation.label, /review/i);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
      agentProfileId: "backend",
      skillId: "coding-agent",
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
      agentProfileId: "review-agent",
    });
  }
});

test("session note messages seed a conversational reply and do not overwrite the task goal after creation", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a launch retrospective",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const note = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Keep the tone candid and list the main risks.",
    });
    assert.equal(note.status, 201);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.session.current_goal, "Prepare a launch retrospective");
    assert.equal(detail.body.session.working_goal, "Prepare a launch retrospective");
    assert.equal(
      detail.body.session.constraints_summary,
      "Keep the tone candid and list the main risks.",
    );
    assert.match(detail.body.session.pending_decision, /tightened|constraint|ready/i);
    const latestOrchestratorTurn = [...detail.body.messages]
      .reverse()
      .find((message: { kind: string }) => message.kind === "orchestrator_turn");
    assert.ok(latestOrchestratorTurn);
    assert.match(
      latestOrchestratorTurn.content.summary,
      /constraint|brief|draft|absorbed/i,
    );
    assert.match(
      latestOrchestratorTurn.content.user_read,
      /You added a constraint set|You added a new constraint/i,
    );
    assert.match(
      latestOrchestratorTurn.content.workspace_impact,
      /mission brief changed|updated constraints|tightened/i,
    );
    assert.ok(Array.isArray(latestOrchestratorTurn.content.generated_outputs));
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session creation treats the initial message as the task goal even when it includes constraints", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message:
        "Prepare a partner recovery plan for this week, keep it concise, and show me the safest execution route first.",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;
    assert.equal(
      created.body.session.current_goal,
      "Prepare a partner recovery plan for this week, keep it concise, and show me the safest execution route first.",
    );
    assert.equal(created.body.session.latest_orchestrator_intent, "draft_ready");
    assert.equal(created.body.session.workspace_state.stage, "draft");
    assert.ok(
      created.body.messages.some((message: { kind: string }) => message.kind === "draft_card"),
    );

    const latestOrchestratorTurn = [...created.body.messages]
      .reverse()
      .find((message: { kind: string }) => message.kind === "orchestrator_turn");
    assert.ok(latestOrchestratorTurn);
    assert.match(latestOrchestratorTurn.content.summary, /anchored|active mission|captured/i);
    assert.match(latestOrchestratorTurn.content.user_read, /working goal|defined the task/i);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session creation auto-generates a draft when the initial brief is already actionable", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message:
        "Prepare a concise partner recovery plan for this week, compare the safest route first, and keep the brief practical.",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;
    assert.equal(created.body.session.workspace_state.stage, "draft");
    assert.equal(created.body.session.latest_orchestrator_intent, "draft_ready");
    assert.ok(
      created.body.messages.some((message: { kind: string }) => message.kind === "draft_card"),
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session short constraint messages are treated as constraints and trigger orchestrator narrative replies", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a partner follow-up plan for today",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Keep it direct and practical, and surface the top 3 next actions.",
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.session.latest_orchestrator_intent, "add_constraint");
    assert.equal(
      response.body.session.constraints_summary,
      "Keep it direct and practical, and surface the top 3 next actions.",
    );

    const textReply = response.body.messages.find(
      (message: { role: string; kind: string; content: { text?: string } }) =>
        message.role === "orchestrator" &&
        message.kind === "text" &&
        typeof message.content.text === "string",
    );
    assert.ok(textReply);
    assert.match(
      textReply.content.text,
      /mission brief|draft the workflow|compare full route options|Next I recommend:/i,
    );

    const orchestratorTurn = response.body.messages.find(
      (message: { kind: string; content: { summary?: string } }) =>
        message.kind === "orchestrator_turn" && typeof message.content.summary === "string",
    );
    assert.ok(orchestratorTurn);
    assert.match(
      orchestratorTurn.content.summary,
      /constraint|brief|absorbed/i,
    );
    assert.match(
      orchestratorTurn.content.user_read,
      /You added a constraint set|You added a new constraint/i,
    );
    assert.match(
      orchestratorTurn.content.workspace_impact,
      /mission brief changed|updated constraints|tightened/i,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session progress questions return a status-style orchestrator reply without stale-route mutation", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a partner follow-up plan for today",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "what is the progress now",
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.session.latest_orchestrator_intent, "ask_status");
    assert.match(
      response.body.messages.find(
        (message: { role: string; kind: string; content: { text?: string } }) =>
          message.role === "orchestrator" &&
          message.kind === "text" &&
          typeof message.content.text === "string",
      )?.content.text || "",
      /Right now,|Next I recommend:|mission is anchored/i,
    );
    assert.equal(response.body.session.metadata?.route_stale, false);
    assert.equal(response.body.session.constraints_summary, null);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session follow-up questions after planning do not pollute constraints or stale the route", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a partner follow-up plan for today",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Create plan options for this mission",
    });
    assert.equal(planned.status, 201);

    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "What changed and what is the next best move?",
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.session.latest_orchestrator_intent, "ask_status");
    assert.equal(response.body.session.metadata?.route_stale, false);
    assert.equal(response.body.session.constraints_summary, null);
    assert.match(
      response.body.messages.find(
        (message: { role: string; kind: string; content: { text?: string } }) =>
          message.role === "orchestrator" &&
          message.kind === "text" &&
          typeof message.content.text === "string",
      )?.content.text || "",
      /Right now,|Next I recommend:/i,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session explicit draft message auto-generates a draft card and workspace state", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a launch retrospective",
    });
    sessionId = created.body.session.session_id;

    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Draft DAG for this task",
    });
    assert.equal(response.status, 201);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.session.workspace_state.stage, "draft");
    assert.equal(detail.body.session.latest_orchestrator_intent, "draft_ready");
    assert.ok(
      detail.body.messages.some((message: { kind: string }) => message.kind === "draft_card"),
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session draft projection clears the draft-vs-plan meta question once a draft exists", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message:
        "Prepare a concise partner recovery plan for this week, compare the safest route first, and keep the brief practical.",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.session.workspace_state.stage, "draft");
    assert.equal(
      Array.isArray(detail.body.session.workspace_state.open_questions)
        ? detail.body.session.workspace_state.open_questions.some((question: string) =>
            /draft a DAG first|go straight to full plan options/i.test(question),
          )
        : false,
      false,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session constraint follow-up auto-generates a draft once the brief becomes actionable", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a partner recovery plan for this week",
    });
    sessionId = created.body.session.session_id;

    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Add a review checkpoint before final delivery and keep the output practical.",
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.session.workspace_state.stage, "draft");
    assert.equal(response.body.session.latest_orchestrator_intent, "draft_ready");
    assert.ok(
      response.body.messages.some((message: { kind: string }) => message.kind === "draft_card"),
    );

    const orchestratorTurn = response.body.messages.find(
      (message: { kind: string; content: { summary?: string; workspace_impact?: string } }) =>
        message.kind === "orchestrator_turn" &&
        typeof message.content.summary === "string",
    );
    assert.ok(orchestratorTurn);
    assert.match(
      orchestratorTurn.content.summary,
      /review checkpoint|practical|draft the first workflow shape/i,
    );
    assert.match(
      orchestratorTurn.content.workspace_impact,
      /move directly into DAG drafting|review checkpoint|execution-focused/i,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session explicit plan message auto-generates plan options and compare workspace state", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a launch retrospective",
    });
    sessionId = created.body.session.session_id;

    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Create plan options for this task",
    });
    assert.equal(response.status, 201);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.ok(["planning", "ready_to_run"].includes(detail.body.session.status));
    assert.equal(detail.body.session.workspace_state.stage, "compare");
    assert.equal(detail.body.session.latest_orchestrator_intent, "plan_ready");
    assert.equal(detail.body.mission_snapshot.activeRouteRevision, 1);
    assert.ok(
      detail.body.mission_snapshot.checkpoints.some(
        (checkpoint: { label: string }) => checkpoint.label === "Route comparison",
      ),
    );
    assert.ok(
      detail.body.messages.some((message: { kind: string }) => message.kind === "plan_options_card"),
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session explicit plan message keeps orchestrator state coherent when planning cannot proceed", async () => {
  resetTestRoot();
  configureEnv();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a launch retrospective",
    });
    sessionId = created.body.session.session_id;

    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Create plan options for this task",
    });
    assert.equal(response.status, 201);
    assert.ok(
      response.body.messages.some((message: { kind: string }) => message.kind === "workspace_snapshot_card"),
    );

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.session.latest_orchestrator_intent, "ask_plan");
    assert.match(
      String(detail.body.session.pending_decision || ""),
      /tighten the brief|draft the workflow|next plan options/i,
    );
    const latestReply = [...detail.body.messages]
      .reverse()
      .find(
        (message: { message_id: string; role: string; kind: string; content: { text?: string } }) =>
          message.role === "orchestrator" &&
          message.kind === "text" &&
          typeof message.content.text === "string" &&
          /could not compile a plan yet/i.test(message.content.text),
      );
    assert.ok(latestReply);
    assert.equal(detail.body.session.last_orchestrator_message_id, latestReply.message_id);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      sessionId,
    });
  }
});

test("session note after planning marks the current route stale and blocks confirmation", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a launch retrospective",
    });
    sessionId = created.body.session.session_id;

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare a launch retrospective",
      },
    });
    assert.equal(planned.status, 200);

    const note = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Also make this suitable for VP review and keep the delivery tighter.",
    });
    assert.equal(note.status, 201);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.session.workspace_state.plan_stale, true);
    assert.equal(detail.body.session.workspace_state.needs_replan, true);
    assert.match(
      String(detail.body.session.workspace_state.next_recommended_action || ""),
      /revise|draft/i,
    );

    const confirmAttempt = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/confirm`, {
      revision: 1,
      option: "primary",
    });
    assert.equal(confirmAttempt.status, 409);
    assert.equal(confirmAttempt.body.code, "plan_stale");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session explicit confirm message locks the latest route when confirmation target is unambiguous", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a launch retrospective",
    });
    sessionId = created.body.session.session_id;

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare a launch retrospective",
      },
    });
    assert.equal(planned.status, 200);

    const confirmMessage = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Confirm this plan",
    });
    assert.equal(confirmMessage.status, 201);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.session.confirmed_plan_revision, 1);
    assert.equal(detail.body.session.confirmed_plan_option, "primary");
    assert.equal(detail.body.session.workspace_state.needs_confirmation, false);
    const latestReply = [...detail.body.messages]
      .reverse()
      .find(
        (message: { role: string; kind: string; content: { text?: string } }) =>
          message.role === "orchestrator" &&
          message.kind === "text" &&
          typeof message.content.text === "string" &&
          /execution source is now locked|already confirmed/i.test(message.content.text),
      );
    assert.ok(latestReply);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session explicit run message reports strict validation block back into the conversation", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "session-run-block-template",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Run a risky task",
    });
    sessionId = created.body.session.session_id;

    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Run this now",
    });
    assert.equal(response.status, 201);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    const latestConversationReply = [...detail.body.messages]
      .reverse()
      .find(
        (message: { message_id: string; role: string; kind: string; content: { text?: string } }) =>
          message.role === "orchestrator" &&
          message.kind === "text" &&
          typeof message.content.text === "string" &&
          /did not open the run|could not open the run/i.test(message.content.text),
      );
    assert.ok(latestConversationReply);
    assert.match(
      String(detail.body.session.pending_decision || ""),
      /warnings|strict run|opening a strict run|execution/i,
    );
    assert.equal(detail.body.session.last_orchestrator_message_id, latestConversationReply.message_id);
    assert.equal(detail.body.session.latest_run_id, null);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "session-run-block-template",
      sessionId,
    });
  }
});

test("session auto revise keeps the original user turn without injecting a synthetic revise request", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare account follow-up plan",
    });
    sessionId = created.body.session.session_id;

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare account follow-up plan",
      },
    });
    assert.equal(planned.status, 200);

    const revised = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Revise the plan to add a review step and keep the work parallel first.",
    });
    assert.equal(revised.status, 201);
    assert.equal(
      revised.body.user_message.content.text,
      "Revise the plan to add a review step and keep the work parallel first.",
    );
    assert.equal(
      revised.body.messages.filter(
        (message: { role: string; kind: string; content: { text?: string } }) =>
          message.role === "user" &&
          message.kind === "text" &&
          typeof message.content.text === "string" &&
          /^Revise plan:/i.test(message.content.text),
      ).length,
      0,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session planning narrative uses the visible draft-derived template name instead of an internal draft id", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Final acceptance validation for conversation-first orchestrator flow",
    });
    sessionId = created.body.session.session_id;

    const drafted = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/dag-draft`, {});
    assert.equal(drafted.status, 200);
    const draftCard = drafted.body.messages.find((message: { kind: string }) => message.kind === "draft_card");
    assert.ok(draftCard);

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      draft_message_id: draftCard.message_id,
    });
    assert.equal(planned.status, 200);
    const primaryTemplateName = planned.body.messages[1].content.template_name;
    assert.equal(typeof primaryTemplateName, "string");
    assert.match(planned.body.messages[0].content.text, new RegExp(primaryTemplateName));
    assert.doesNotMatch(
      planned.body.messages[0].content.text,
      /planner-final-acceptance-validation-for-conversation-draft/,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session revise directives can mutate plan structure deterministically", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare account follow-up plan",
    });
    sessionId = created.body.session.session_id;

    const firstPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare account follow-up plan",
      },
    });
    assert.equal(firstPlan.status, 200);
    assert.equal(firstPlan.body.messages[1].content.candidate_plan.compiled_nodes.length, 1);

    const revised = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/revise`, {
      revision: 1,
      instructions: "Add a final review summary step before finishing",
    });
    assert.equal(revised.status, 200);
    assert.equal(revised.body.messages[2].content.candidate_plan.compiled_nodes.length, 2);
    assert.match(revised.body.messages[1].content.text, /review or summary step/i);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session revise can target approval to a specific step", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_a",
          name: "Step A",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["a-note"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_b",
          name: "Step B",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write"],
            output_contract: {
              expected_artifacts: ["b-note"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_a",
          to: "node_b",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare multi-step plan",
    });
    sessionId = created.body.session.session_id;

    const firstPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare multi-step plan",
      },
    });
    assert.equal(firstPlan.status, 200);

    const revised = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/revise`, {
      revision: 1,
      instructions: "Add approval to step 2 before it runs",
    });
    assert.equal(revised.status, 200);
    assert.match(revised.body.messages[1].content.text, /step 2/i);
    const planCard = revised.body.messages[2];
    assert.equal(planCard.kind, "plan_card");
    const compiledNodes = planCard.content.candidate_plan.compiled_nodes;
    assert.equal(compiledNodes.length, 2);
    assert.equal(compiledNodes[1].approval_kind, "human_review");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session revise can build a parallel then review shape", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_a",
          name: "Step A",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["a-note"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_b",
          name: "Step B",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write"],
            output_contract: {
              expected_artifacts: ["b-note"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare parallel collection plan",
    });
    sessionId = created.body.session.session_id;

    const firstPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare parallel collection plan",
      },
    });
    assert.equal(firstPlan.status, 200);

    const revised = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/revise`, {
      revision: 1,
      instructions: "Run the work in parallel and then add a final review summary step",
    });
    assert.equal(revised.status, 200);
    const compiledNodes = revised.body.messages[2].content.candidate_plan.compiled_nodes;
    assert.equal(compiledNodes.length, 3);
    assert.match(revised.body.messages[1].content.text, /fan-out stage/i);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
  }
});

test("session replan increments plan revision and preserves history", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "mobile-test-template-alt",
      name: "Mobile Test Template Alt",
      nodes: [
        {
          id: "node_backend",
          name: "Backend Task",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_review",
          name: "Review Plan",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write"],
            output_contract: {
              expected_artifacts: ["review-note"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_backend",
          to: "node_review",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a second opinion plan",
    });
    sessionId = created.body.session.session_id;

    const firstPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare a second opinion plan",
      },
    });
    assert.equal(firstPlan.status, 200);
    assert.equal(firstPlan.body.messages[1].content.revision, 1);

    const secondPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template-alt",
      inputs: {
        goal: "Prepare a second opinion plan",
      },
    });
    assert.equal(secondPlan.status, 200);
    assert.equal(secondPlan.body.messages[1].content.revision, 2);
    assert.deepEqual(secondPlan.body.messages[1].content.diff?.summary_lines, [
      "Template changed from mobile-test-template to mobile-test-template-alt.",
      "Node count increased by 1.",
      "Added: Review Plan (node_review).",
      "Validation warnings increased by 2.",
    ]);
    assert.equal(secondPlan.body.messages[1].content.diff?.previous_revision, 1);
    assert.equal(secondPlan.body.messages[1].content.diff?.template_changed, true);
    assert.equal(secondPlan.body.messages[1].content.diff?.node_count_delta, 1);
    assert.equal(secondPlan.body.messages[1].content.diff?.frontier_count_delta, 0);
    assert.equal(secondPlan.body.messages[1].content.diff?.warning_count_delta, 2);
    assert.deepEqual(secondPlan.body.messages[1].content.diff?.added_nodes, [
      "Review Plan (node_review)",
    ]);
    assert.deepEqual(secondPlan.body.messages[1].content.diff?.removed_nodes, []);

    const thread = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`);
    assert.equal(thread.status, 200);
    const planCards = thread.body.items.filter((message: { kind: string }) => message.kind === "plan_card");
    assert.equal(planCards.length, 2);
    assert.deepEqual(
      planCards.map((message: { content: { revision?: number } }) => message.content.revision),
      [1, 2],
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
    });
  }
});

test("session can confirm a plan revision and create a run from that confirmed revision", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "mobile-test-template-alt",
      name: "Mobile Test Template Alt",
      nodes: [
        {
          id: "node_backend",
          name: "Backend Task",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_review",
          name: "Review Plan",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write"],
            output_contract: {
              expected_artifacts: ["review-note"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_backend",
          to: "node_review",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a confirmed plan run",
    });
    sessionId = created.body.session.session_id;

    const firstPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare a confirmed plan run",
      },
    });
    assert.equal(firstPlan.status, 200);

    const secondPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template-alt",
      inputs: {
        goal: "Prepare a confirmed plan run",
      },
    });
    assert.equal(secondPlan.status, 200);

    const confirmed = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/confirm`, {
      revision: 1,
      option: "primary",
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.revision, 1);
    assert.equal(confirmed.body.session.confirmed_plan_revision, 1);
    assert.equal(confirmed.body.session.confirmed_plan_option, "primary");

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
    });
    assert.equal(runCreated.status, 201);
    runId = runCreated.body.run_id;
    assert.equal(runCreated.body.session.confirmed_plan_revision, 1);
    assert.equal(runCreated.body.messages[1].content.plan_revision, 1);
    assert.equal(runCreated.body.messages[1].content.plan_option, "primary");

    const run = getRun(runId);
    assert.ok(run);
    assert.equal(runCreated.body.messages[1].content.template_id, run?.template_id);
    assert.ok(["mobile-test-template", "mobile-test-template-alt"].includes(run?.template_id || ""));
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
      sessionId,
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
    });
  }
});

test("session DAG proposal can be confirmed and used as run source", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const createdSession = await postJson(`${server.baseUrl}/api/sessions`, {
      title: "Proposal Session",
      initial_message: "Build and review a proposal-backed workflow",
    });
    assert.equal(createdSession.status, 201);
    const sessionId = createdSession.body.session.session_id;

    const createdProposal = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/dag-proposals`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Build and review a proposal-backed workflow",
      },
    });
    assert.equal(createdProposal.status, 201);
    assert.equal(createdProposal.body.proposal.status, "review_ready");
    assert.equal(createdProposal.body.proposal.metadata.execution_template_id, "mobile-test-template");
    assert.equal(createdProposal.body.proposal.assignments.length > 0, true);

    const proposalId = createdProposal.body.proposal.proposal_id;
    const updatedAssignments = await fetch(
      `${server.baseUrl}/api/sessions/${sessionId}/dag-proposals/${proposalId}/assignments`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          assignments: [
            {
              ...createdProposal.body.proposal.assignments[0],
              model: "proposal-model",
              output_contract: "Return a reviewed implementation summary.",
            },
          ],
        }),
      },
    );
    assert.equal(updatedAssignments.status, 200);
    const updatedAssignmentBody = await updatedAssignments.json();
    assert.equal(updatedAssignmentBody.proposal.assignments[0].model, "proposal-model");

    const confirmed = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/dag-proposals/${proposalId}/confirm`,
      {
        confirmed_by: "tester",
      },
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.proposal.status, "confirmed");
    assert.equal(confirmed.body.session.confirmed_proposal_id, proposalId);

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      proposal_id: proposalId,
      validation_mode: "warn",
    });
    assert.equal(runCreated.status, 201);
    assert.equal(runCreated.body.status, "queued");
    assert.equal(runCreated.body.session.confirmed_proposal_id, proposalId);

    const run = getRun(runCreated.body.run_id);
    assert.ok(run);
    assert.equal(run.proposal_id, proposalId);

    const mobileRuns = await getJson(`${server.baseUrl}/api/mobile/runs`);
    assert.equal(mobileRuns.status, 200);
    const mobileRun = mobileRuns.body.items.find(
      (item: { run_id: string }) => item.run_id === runCreated.body.run_id,
    );
    assert.ok(mobileRun);
    assert.equal(mobileRun.proposal_id, proposalId);

    const mobileFollowUp = await getJson(
      `${server.baseUrl}/api/mobile/runs/${runCreated.body.run_id}/follow-up`,
    );
    assert.equal(mobileFollowUp.status, 200);
    assert.equal(mobileFollowUp.body.run.proposal_id, proposalId);

    const proposals = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/dag-proposals`);
    assert.equal(proposals.status, 200);
    assert.equal(proposals.body.confirmed_proposal_id, proposalId);
    assert.equal(proposals.body.items[0].proposal_id, proposalId);
  } finally {
    await server.close();
  }
});

test("session draft API returns draft_card and can be used to create a planned revision", async () => {
  resetTestRoot();
  configureEnv();
  seedSkill({
    skill_id: "research-skill",
    name: "Research Skill",
    tags: ["market", "research"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    openclaw_agent_id: "openclaw-research-agent",
    default_skills: ["research-skill"],
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "session-draft-template",
      name: "Market Research Workflow",
      description: "Research market signals and summarize findings",
      agent_profile_bindings: {
        "research-agent": "legacy-research-agent",
      },
      nodes: [
        {
          id: "node_research",
          name: "Research Market",
          type: "agent_task",
          agent_profile: "research-agent",
          allowed_skills: ["research-skill"],
          config: {
            allowed_tools: ["read", "write"],
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_end",
          name: "End",
          type: "end",
          agent_profile: null,
          allowed_skills: [],
          config: {},
          retry_policy: {
            max_attempts: 0,
            backoff_seconds: 0,
          },
          timeout_seconds: 60,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_research",
          to: "node_end",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Research market expansion opportunities",
    });
    sessionId = created.body.session.session_id;

    const drafted = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/dag-draft`, {
      inputs: {
        goal: "Assess the market",
      },
    });
    assert.equal(drafted.status, 200);
    const draftCard = drafted.body.messages.find((message: { kind: string }) => message.kind === "draft_card");
    assert.ok(draftCard);
    assert.equal(draftCard.content.planner_context.draft_strategy, "template_variant");

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      draft_message_id: draftCard.message_id,
      inputs: {
        goal: "Assess the market",
      },
    });
    assert.equal(planned.status, 200);
    const planOptionsCard = planned.body.messages.find(
      (message: { kind: string }) => message.kind === "plan_options_card",
    );
    assert.ok(planOptionsCard);
    assert.equal(planOptionsCard.content.primary.template_id, draftCard.content.draft_template.template_id);
    assert.equal(
      planOptionsCard.content.primary.candidate_plan.compiled_nodes.length,
      draftCard.content.draft_template.nodes.length,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "session-draft-template",
      agentProfileId: "research-agent",
      skillId: "research-skill",
      sessionId,
    });
  }
});

test("session draft-backed route can confirm and launch using published execution template", async () => {
  resetTestRoot();
  configureEnv();
  seedSkill({
    skill_id: "research-skill",
    name: "Research Skill",
    tags: ["market", "research"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    openclaw_agent_id: "openclaw-research-agent",
    default_skills: ["research-skill"],
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "session-draft-template",
      name: "Market Research Workflow",
      description: "Research market signals and summarize findings",
      agent_profile_bindings: {
        "research-agent": "legacy-research-agent",
      },
      nodes: [
        {
          id: "node_research",
          name: "Research Market",
          type: "agent_task",
          agent_profile: "research-agent",
          allowed_skills: ["research-skill"],
          config: {
            allowed_tools: ["read", "write", "web"],
            output_contract: {
              expected_artifacts: ["research-notes"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_report",
          name: "Write Report",
          type: "agent_task",
          agent_profile: "research-agent",
          allowed_skills: ["research-skill"],
          config: {
            allowed_tools: ["read", "write"],
            output_contract: {
              expected_artifacts: ["research-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_research",
          to: "node_report",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Research market expansion opportunities",
    });
    sessionId = created.body.session.session_id;

    const drafted = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/dag-draft`, {
      inputs: {
        goal: "Assess the market",
      },
    });
    assert.equal(drafted.status, 200);
    const draftCard = drafted.body.messages.find((message: { kind: string }) => message.kind === "draft_card");
    assert.ok(draftCard);

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      draft_message_id: draftCard.message_id,
      inputs: {
        goal: "Assess the market",
      },
    });
    assert.equal(planned.status, 200);
    const planOptionsCard = planned.body.messages.find(
      (message: { kind: string }) => message.kind === "plan_options_card",
    );
    assert.ok(planOptionsCard);
    assert.equal(planOptionsCard.content.primary.template_id, draftCard.content.draft_template.template_id);
    assert.equal(planOptionsCard.content.primary.execution_template_id, "session-draft-template");

    const confirmed = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/confirm`, {
      revision: 1,
      option: "primary",
    });
    assert.equal(confirmed.status, 200);

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
    });
    assert.equal(runCreated.status, 201);
    runId = runCreated.body.run_id;
    assert.equal(runCreated.body.messages[1].content.plan_revision, 1);
    assert.equal(runCreated.body.messages[1].content.plan_option, "primary");
    assert.equal(runCreated.body.messages[1].content.template_id, "session-draft-template");

    const run = getRun(runId);
    assert.ok(run);
    assert.equal(run?.template_id, "session-draft-template");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "session-draft-template",
      agentProfileId: "research-agent",
      skillId: "research-skill",
      runId,
      sessionId,
    });
  }
});

test("session confirm and run can target alternative plan option", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "mobile-test-template-alt",
      name: "Mobile Test Template Alt",
      nodes: [
        {
          id: "node_backend",
          name: "Backend Task",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_review",
          name: "Review Plan",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write"],
            output_contract: {
              expected_artifacts: ["review-note"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_backend",
          to: "node_review",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare an alternative confirmed plan run",
    });
    sessionId = created.body.session.session_id;

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      inputs: {
        goal: "Prepare an alternative confirmed plan run",
      },
    });
    assert.equal(planned.status, 200);

    const confirmed = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/confirm`, {
      revision: 1,
      option: "alternative",
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.session.confirmed_plan_revision, 1);
    assert.equal(confirmed.body.session.confirmed_plan_option, "alternative");

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
    });
    assert.equal(runCreated.status, 201);
    runId = runCreated.body.run_id;
    assert.equal(runCreated.body.messages[1].content.plan_revision, 1);
    assert.equal(runCreated.body.messages[1].content.plan_option, "alternative");
    const selectedPlanTemplateId =
      runCreated.body.messages[1].content.template_id;
    const plannedOptionsCard = planned.body.messages.find(
      (message: { kind: string }) => message.kind === "plan_options_card",
    );
    assert.ok(plannedOptionsCard);
    assert.equal(
      selectedPlanTemplateId,
      plannedOptionsCard.content.alternative.template_id,
    );

    const run = getRun(runId);
    assert.ok(run);
    assert.equal(run?.template_id, selectedPlanTemplateId);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
      sessionId,
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
    });
  }
});

test("session revise can target alternative option and records revision source", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "mobile-test-template-alt",
      name: "Alternative Review Workflow",
      description: "Alternative workflow for revision requests",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare account follow-up plan",
    });
    sessionId = created.body.session.session_id;

    const firstPlan = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "mobile-test-template",
      inputs: {
        goal: "Prepare account follow-up plan",
      },
    });
    assert.equal(firstPlan.status, 200);

    const revised = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan/revise`, {
      revision: 1,
      option: "alternative",
      instructions: "Add a final review summary step before finishing",
    });
    assert.equal(revised.status, 200);
    assert.equal(revised.body.messages[0].content.source_revision, 1);
    assert.equal(revised.body.messages[0].content.source_option, "alternative");
    const optionsCard = revised.body.messages.find((message: { kind: string }) => message.kind === "plan_options_card");
    assert.ok(optionsCard);
    assert.equal(optionsCard.content.source_revision, 1);
    assert.equal(optionsCard.content.source_option, "alternative");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
    });
    cleanupTestArtifacts({
      templateId: "mobile-test-template-alt",
    });
  }
});

test("session thread projects waiting approval execution state from linked run", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_gate",
          name: "Approval Gate",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: "human_review",
          human_input_schema: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Review a risky outbound message",
    });
    sessionId = created.body.session.session_id;

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
      inputs: {
        goal: "Review a risky outbound message",
      },
      template_id: "mobile-test-template",
    });
    assert.equal(runCreated.status, 201);
    runId = runCreated.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    const callback = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "waiting_human",
        progress: {
          percent: 55,
          message: "Need manager approval before sending",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );
    assert.equal(callback.status, 202);

    const sessionDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(sessionDetail.status, 200);
    assert.ok(
      sessionDetail.body.messages.some(
        (message: { kind: string; content: { status?: string } }) =>
          message.kind === "summary_card" && message.content.status === "waiting_human",
      ),
    );
    assert.ok(
      sessionDetail.body.messages.some(
        (message: { kind: string; content: { node_name?: string } }) =>
          message.kind === "subtask_card" && message.content.node_name === "Approval Gate",
      ),
    );
    assert.ok(
      sessionDetail.body.messages.some(
        (message: { kind: string; content: { summary?: string } }) =>
          message.kind === "approval_card" &&
          message.content.summary === "Need manager approval before sending",
      ),
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
      runId,
    });
  }
});

test("session intervention API records runtime intent and projects intervention card", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a runtime steering demo",
    });
    sessionId = created.body.session.session_id;

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
      inputs: {
        goal: "Prepare a runtime steering demo",
      },
      template_id: "mobile-test-template",
    });
    assert.equal(runCreated.status, 201);
    runId = runCreated.body.run_id;

    const intervention = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/interventions`, {
      content: "Pause before final delivery and add one review step",
      target_run_id: runId,
    });
    assert.equal(intervention.status, 201);
    assert.equal(intervention.body.intervention.run_id, runId);
    assert.equal(intervention.body.intervention.kind, "pause_request");
    assert.equal(intervention.body.intervention.status, "needs_review");
    assert.equal(intervention.body.intervention.patch_preview.supported, true);
    assert.equal(intervention.body.intervention.patch_preview.operations[0].op, "pause_for_replan");
    assert.ok(
      intervention.body.messages.some(
        (message: { kind: string; content: { intervention_id?: string } }) =>
          message.kind === "intervention_card" &&
          message.content.intervention_id === intervention.body.intervention.intervention_id,
      ),
    );
    assert.ok(
      intervention.body.messages.some(
        (message: {
          kind: string;
          content: {
            intervention_id?: string;
            status?: string;
            apply_supported?: boolean;
            operations?: Array<{ op?: string }>;
          };
        }) =>
          message.kind === "dag_patch_card" &&
          message.content.intervention_id === intervention.body.intervention.intervention_id &&
          message.content.status === "needs_confirmation" &&
          message.content.apply_supported === true &&
          message.content.operations?.[0]?.op === "pause_for_replan",
      ),
    );
    assert.ok(
      intervention.body.messages.some(
        (message: { role: string; kind: string; content: { text?: string } }) =>
          message.role === "orchestrator" &&
          message.kind === "text" &&
          /runtime intervention intent/i.test(message.content.text || ""),
      ),
    );

    const sessionDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(sessionDetail.status, 200);
    assert.equal(sessionDetail.body.session.latest_orchestrator_intent, "runtime_intervention");
    assert.equal(sessionDetail.body.session.workspace_state.pending_intervention_count, 1);
    assert.equal(sessionDetail.body.session.workspace_state.pending_dag_patch_count, 1);
    assert.equal(sessionDetail.body.session.workspace_state.latest_dag_patch_status, "needs_confirmation");
    assert.equal(
      sessionDetail.body.session.workspace_state.latest_intervention_summary,
      "Pause before final delivery and add one review step",
    );
    assert.ok(
      sessionDetail.body.messages.some(
        (message: { kind: string; content: { kind?: string; status?: string } }) =>
          message.kind === "intervention_card" &&
          message.content.kind === "pause_request" &&
          message.content.status === "needs_review",
      ),
    );
    assert.ok(
      sessionDetail.body.messages.some(
        (message: { kind: string; content: { status?: string; operations?: Array<{ op?: string }> } }) =>
          message.kind === "dag_patch_card" &&
          message.content.status === "needs_confirmation" &&
          message.content.operations?.[0]?.op === "pause_for_replan",
      ),
    );

    const chineseIntervention = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/interventions`, {
      content: "\u5148\u6682\u505c\u6700\u7ec8\u4ea4\u4ed8\uff0c\u518d\u52a0\u4e00\u4e2a\u7ade\u54c1\u5bf9\u7167\u6b65\u9aa4",
      target_run_id: runId,
    });
    assert.equal(chineseIntervention.status, 201);
    assert.equal(chineseIntervention.body.intervention.kind, "pause_request");
    assert.equal(chineseIntervention.body.intervention.patch_preview.operations[0].op, "pause_for_replan");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
      runId,
    });
  }
});

test("session thread projects artifact cards after run completion", async () => {
  resetTestRoot();
  configureEnv({
    MY_MATE_AUTO_APPROVE_HUMAN_GATES: "true",
  });
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Generate a final artifact",
    });
    sessionId = created.body.session.session_id;

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
      template_id: "mobile-test-template",
    });
    assert.equal(runCreated.status, 201);
    runId = runCreated.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    const callback = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "completed",
        progress: {
          percent: 100,
          message: "Draft package ready",
        },
        artifacts: [
          {
            artifact_id: "artifact_session_test",
            type: "report",
            name: "draft.md",
            storage_uri: "file:///tmp/draft.md",
            mime_type: "text/markdown",
            size_bytes: 256,
          },
        ],
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );
    assert.equal(callback.status, 202);

    const sessionMessages = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`);
    assert.equal(sessionMessages.status, 200);
    assert.ok(
      sessionMessages.body.items.some(
        (message: { kind: string; content: { name?: string } }) =>
          message.kind === "artifact_card" && message.content.name === "draft.md",
      ),
    );
    assert.ok(
      sessionMessages.body.items.some(
        (message: { kind: string; content: { status?: string } }) =>
          message.kind === "summary_card" && message.content.status === "completed",
      ),
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId,
      runId,
    });
  }
});

test("create run defaults to strict validation when mode is omitted", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "run-validation-default-template",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const response = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Default strict validation run",
      template_id: "run-validation-default-template",
      inputs: {
        goal: "Block invalid registry config by default",
      },
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, "run_validation_failed");
    assert.equal(response.body.validation.passed, false);
    assert.ok(
      response.body.validation.warnings.includes(
        "Node node_backend (Backend Task) uses unknown agent profile: backend",
      ),
    );
    assert.ok(
      response.body.validation.details.some(
        (detail: { code: string; category: string; node_id: string | null }) =>
          detail.code === "unknown_agent_profile" &&
          detail.category === "registry" &&
          detail.node_id === "node_backend",
      ),
    );

    const runs = await getJson(`${server.baseUrl}/api/runs`);
    assert.equal(runs.status, 200);
    assert.equal(runs.body.items.length, 0);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "run-validation-default-template",
    });
  }
});

test("create run strict validation blocks invalid registry bindings before persistence", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "run-validation-strict-template",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const response = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Strict validation run",
      template_id: "run-validation-strict-template",
      inputs: {
        goal: "Block invalid registry config",
      },
      validation_mode: "strict",
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, "run_validation_failed");
    assert.equal(response.body.validation.passed, false);
    assert.ok(
      response.body.validation.warnings.includes(
        "Node node_backend (Backend Task) uses unknown agent profile: backend",
      ),
    );

    const runs = await getJson(`${server.baseUrl}/api/runs`);
    assert.equal(runs.status, 200);
    assert.equal(runs.body.items.length, 0);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "run-validation-strict-template",
    });
  }
});

test("create run warn validation returns warnings but allows execution", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "run-validation-warn-template",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const response = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Warn validation run",
      template_id: "run-validation-warn-template",
      inputs: {
        goal: "Allow invalid registry config with warnings",
      },
      validation_mode: "warn",
    });

    assert.equal(response.status, 201);
    runId = response.body.run_id;
    assert.equal(response.body.status, "queued");
    assert.equal(response.body.validation.passed, false);
    assert.ok(
      response.body.validation.warnings.includes(
        "Node node_backend (Backend Task) uses unknown agent profile: backend",
      ),
    );
    assert.ok(getRun(runId));
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "run-validation-warn-template",
      runId,
    });
  }
});

test("create run bypass validation skips gate warnings", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "run-validation-bypass-template",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const response = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Bypass validation run",
      template_id: "run-validation-bypass-template",
      inputs: {
        goal: "Skip validation gate",
      },
      validation_mode: "bypass",
    });

    assert.equal(response.status, 201);
    runId = response.body.run_id;
    assert.equal(response.body.validation.passed, true);
    assert.deepEqual(response.body.validation.warnings, []);
    assert.ok(getRun(runId));
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "run-validation-bypass-template",
      runId,
    });
  }
});

test("list templates exposes mobile create-run metadata", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "template-mobile-create",
      name: "Mobile Create Template",
      description: "Template for mobile create form",
      input_schema: {
        type: "object",
        properties: {
          goal: { type: "string" },
          priority: { type: "string" },
        },
        required: ["goal"],
      },
      metadata: {
        domain: "mobile",
      },
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const templates = await getJson(`${server.baseUrl}/api/templates`);
    assert.equal(templates.status, 200);
    const target = templates.body.items.find(
      (item: { template_id: string }) => item.template_id === "template-mobile-create",
    );
    assert.ok(target);
    assert.equal(target.name, "Mobile Create Template");
    assert.equal(target.description, "Template for mobile create form");
    assert.equal(target.input_schema.required[0], "goal");
    assert.equal(target.metadata.domain, "mobile");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "template-mobile-create",
    });
  }
});

test("template derivation new version archive and lineage APIs", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "version-source-template",
      name: "Version Source Template",
      description: "Published template for versioning",
      metadata: {
        domain: "versioning",
      },
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const derived = await postJson(
      `${server.baseUrl}/api/templates/version-source-template/derive`,
      {
        template_id: "version-derived-template",
        name: "Derived Template",
        metadata: {
          purpose: "variant",
        },
      },
    );
    assert.equal(derived.status, 201);
    assert.equal(derived.body.template_id, "version-derived-template");
    assert.equal(derived.body.status, "draft");
    assert.equal(derived.body.version, 1);
    assert.equal(
      derived.body.metadata.versioning.source_template_id,
      "version-source-template",
    );
    assert.equal(derived.body.metadata.versioning.derivation_kind, "derive");
    assert.equal(derived.body.metadata.versioning.family_id, "version-derived-template");

    const nextVersion = await postJson(
      `${server.baseUrl}/api/templates/version-source-template/new-version`,
      {
        template_id: "version-source-template-v2",
      },
    );
    assert.equal(nextVersion.status, 201);
    assert.equal(nextVersion.body.version, 2);
    assert.equal(nextVersion.body.status, "draft");
    assert.equal(nextVersion.body.metadata.versioning.derivation_kind, "version");
    assert.equal(
      nextVersion.body.metadata.versioning.family_id,
      "version-source-template",
    );

    const lineage = await getJson(
      `${server.baseUrl}/api/templates/version-source-template-v2/lineage`,
    );
    assert.equal(lineage.status, 200);
    assert.equal(lineage.body.family_id, "version-source-template");
    assert.deepEqual(
      lineage.body.items.map((item: { template_id: string }) => item.template_id),
      ["version-source-template", "version-source-template-v2"],
    );

    const archive = await postJson(
      `${server.baseUrl}/api/templates/version-source-template-v2/archive`,
      {},
    );
    assert.equal(archive.status, 200);
    assert.equal(archive.body.status, "archived");

    const archived = await getJson(
      `${server.baseUrl}/api/templates/version-source-template-v2`,
    );
    assert.equal(archived.body.status, "archived");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "version-source-template",
    });
    cleanupTestArtifacts({
      templateId: "version-derived-template",
    });
    cleanupTestArtifacts({
      templateId: "version-source-template-v2",
    });
  }
});

test("agent and skill registry APIs upsert list get and disable records", async () => {
  resetTestRoot();
  configureEnv();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const skill = await postJson(`${server.baseUrl}/api/registry/skills`, {
      skill_id: "registry-test-skill",
      name: "Registry Test Skill",
      description: "Skill for registry API testing",
      category: "test",
      allowed_tools: ["read", "write"],
      input_schema: {
        type: "object",
      },
      output_contract: {
        expected_artifacts: ["summary"],
      },
      tags: ["test"],
    });
    assert.equal(skill.status, 201);
    assert.equal(skill.body.skill_id, "registry-test-skill");
    assert.equal(skill.body.status, "active");

    const profile = await postJson(`${server.baseUrl}/api/registry/agent-profiles`, {
      profile_id: "registry-test-agent",
      name: "Registry Test Agent",
      description: "Agent for registry API testing",
      openclaw_agent_id: "backend",
      default_skills: ["registry-test-skill"],
      allowed_tools: ["read", "write", "shell"],
      policy_tags: ["safe-local"],
    });
    assert.equal(profile.status, 201);
    assert.equal(profile.body.profile_id, "registry-test-agent");
    assert.deepEqual(profile.body.default_skills, ["registry-test-skill"]);

    const profiles = await getJson(`${server.baseUrl}/api/registry/agent-profiles`);
    assert.equal(profiles.status, 200);
    assert.ok(
      profiles.body.items.some(
        (item: { profile_id: string }) => item.profile_id === "registry-test-agent",
      ),
    );

    const loadedSkill = await getJson(
      `${server.baseUrl}/api/registry/skills/registry-test-skill`,
    );
    assert.equal(loadedSkill.status, 200);
    assert.equal(loadedSkill.body.name, "Registry Test Skill");

    const disabledProfile = await postJson(
      `${server.baseUrl}/api/registry/agent-profiles/registry-test-agent/disable`,
      {},
    );
    assert.equal(disabledProfile.status, 200);
    assert.equal(disabledProfile.body.status, "disabled");

    const disabledSkill = await postJson(
      `${server.baseUrl}/api/registry/skills/registry-test-skill/disable`,
      {},
    );
    assert.equal(disabledSkill.status, 200);
    assert.equal(disabledSkill.body.status, "disabled");

    const activeProfiles = await getJson(
      `${server.baseUrl}/api/registry/agent-profiles?status=active`,
    );
    assert.equal(activeProfiles.status, 200);
    assert.equal(activeProfiles.body.items.length, 0);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      agentProfileId: "registry-test-agent",
      skillId: "registry-test-skill",
    });
  }
});

test("agent hosting APIs expose and update OpenClaw binding settings", async () => {
  resetTestRoot();
  configureEnv();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const profile = await postJson(`${server.baseUrl}/api/registry/agent-profiles`, {
      profile_id: "hosting-unbound-agent",
      name: "Hosting Unbound Agent",
      description: "Profile can be created before an OpenClaw binding exists",
      openclaw_agent_id: "",
      default_skills: ["coding-agent"],
      allowed_tools: ["read"],
      policy_tags: ["safe-local"],
    });
    assert.equal(profile.status, 201);
    assert.equal(profile.body.openclaw_agent_id, "");

    const hosting = await getJson(`${server.baseUrl}/api/agents/hosting`);
    assert.equal(hosting.status, 200);
    const unbound = hosting.body.profiles.find(
      (item: { profile_id: string }) => item.profile_id === "hosting-unbound-agent",
    );
    assert.ok(unbound);
    assert.equal(unbound.health.status, "needs_binding");

    const updated = await putJson(`${server.baseUrl}/api/agents/hosting-unbound-agent/hosting`, {
      openclaw_agent_id: "openclaw-hosted-agent",
      provider: "anthropic",
      model: "claude-opus",
      runtime_mode: "native-agent",
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.profile.openclaw_agent_id, "openclaw-hosted-agent");
    assert.equal(updated.body.profile.metadata.openclaw.provider, "anthropic");
    const hosted = updated.body.agent_hosting.profiles.find(
      (item: { profile_id: string }) => item.profile_id === "hosting-unbound-agent",
    );
    assert.equal(hosted.health.status, "ready");
    assert.equal(hosted.model, "claude-opus");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      agentProfileId: "hosting-unbound-agent",
    });
  }
});

test("orchestrator profiles persist and drive planner invocation context", async () => {
  resetTestRoot();
  configureEnv({
    MY_MATE_PLANNER_PROVIDER: "rule_based_v1",
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "orchestrator-profile-planner-template",
      name: "Backend Repair Template",
      description: "Fix backend bugs and validate TypeScript services",
      metadata: {
        domain: "coding",
      },
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const saved = await postJson(`${server.baseUrl}/api/orchestrator-profiles`, {
      orchestrator_id: "studio-coding-orchestrator",
      name: "Studio Coding Orchestrator",
      provider: "local_semantic_v1",
      model: "semantic-planner-test",
      system_prompt: "Prefer coding-domain templates and review assignments before execution.",
      default_tools: ["read", "write"],
      default_subagent_profile_ids: ["backend"],
      planning_policy: {
        prefer_domain_match: true,
      },
      handoff_policy: {
        require_review: true,
      },
    });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.orchestrator_id, "studio-coding-orchestrator");

    const profiles = await getJson(`${server.baseUrl}/api/orchestrator-profiles`);
    assert.equal(profiles.status, 200);
    assert.equal(profiles.body.items.length, 1);

    const draft = await postJson(`${server.baseUrl}/api/planner/dag-draft`, {
      intent: "Fix backend bug and run tests",
      inputs: {
        goal: "Fix backend bug and run tests",
      },
      orchestrator_profile_id: "studio-coding-orchestrator",
    });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.planner_context.provider_id, "local_semantic_v1");
    assert.equal(draft.body.planner_context.requested_provider_id, "local_semantic_v1");
    assert.equal(draft.body.planner_context.requested_model, "semantic-planner-test");
    assert.equal(draft.body.planner_context.orchestrator_profile_id, "studio-coding-orchestrator");
    assert.equal(
      draft.body.planner_context.orchestrator_system_prompt,
      "Prefer coding-domain templates and review assignments before execution.",
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "orchestrator-profile-planner-template",
    });
  }
});

test("session-native planning inherits orchestrator profile planner context", async () => {
  resetTestRoot();
  configureEnv({
    MY_MATE_PLANNER_PROVIDER: "rule_based_v1",
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "orchestrator-profile-session-template",
      name: "Session Planner Template",
      description: "Drive session-native DAG and plan generation",
      metadata: {
        domain: "coding",
      },
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const saved = await postJson(`${server.baseUrl}/api/orchestrator-profiles`, {
      orchestrator_id: "studio-session-orchestrator",
      name: "Studio Session Orchestrator",
      provider: "local_semantic_v1",
      model: "semantic-session-model",
      system_prompt: "Bias session-native planning toward coding templates and explicit review.",
      default_tools: ["read", "write"],
      default_subagent_profile_ids: ["backend"],
    });
    assert.equal(saved.status, 201);

    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Fix backend bug and run tests",
      orchestrator_profile_id: "studio-session-orchestrator",
      created_by: "test-user",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;
    const stored = getSession(sessionId);
    assert.ok(stored);
    assert.equal(stored?.metadata.orchestrator_profile_id, "studio-session-orchestrator");

    const draft = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/dag-draft`, {
      template_id: "orchestrator-profile-session-template",
      inputs: {
        goal: "Fix backend bug and run tests",
      },
    });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.planner_context.provider_id, "local_semantic_v1");
    assert.equal(draft.body.planner_context.requested_provider_id, "local_semantic_v1");
    assert.equal(draft.body.planner_context.requested_model, "semantic-session-model");
    assert.equal(draft.body.planner_context.orchestrator_profile_id, "studio-session-orchestrator");
    assert.equal(
      draft.body.planner_context.orchestrator_system_prompt,
      "Bias session-native planning toward coding templates and explicit review.",
    );

    const planned = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/plan`, {
      template_id: "orchestrator-profile-session-template",
      inputs: {
        goal: "Fix backend bug and run tests",
      },
    });
    assert.equal(planned.status, 200);
    assert.equal(planned.body.recommendation?.planner_context?.provider_id, "local_semantic_v1");
    assert.equal(
      planned.body.recommendation?.planner_context?.requested_provider_id,
      "local_semantic_v1",
    );
    assert.equal(planned.body.recommendation?.planner_context?.requested_model, "semantic-session-model");
    assert.equal(
      planned.body.recommendation?.planner_context?.orchestrator_profile_id,
      "studio-session-orchestrator",
    );
    assert.equal(
      planned.body.messages[1].content.recommendation?.planner_context?.orchestrator_system_prompt,
      "Bias session-native planning toward coding templates and explicit review.",
    );
    assert.equal(
      planned.body.candidate_plan.planner_context.requested_provider_id,
      "local_semantic_v1",
    );
    assert.equal(planned.body.candidate_plan.planner_context.requested_model, "semantic-session-model");
    assert.equal(
      planned.body.candidate_plan.planner_context.orchestrator_profile_id,
      "studio-session-orchestrator",
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "orchestrator-profile-session-template",
      sessionId,
    });
  }
});

test("run plan compiler resolves active agent registry profile defaults", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "registry-compile-template",
      agent_profile_bindings: {
        registry_agent: "legacy-openclaw-agent",
      },
      nodes: [
        {
          id: "node_registry",
          name: "Registry Bound Node",
          type: "agent_task",
          agent_profile: "registry_agent",
          allowed_skills: ["node-skill", "blocked-skill"],
          config: {
            allowed_tools: ["node-tool"],
            output_contract: {
              expected_artifacts: ["registry-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const profile = await postJson(`${server.baseUrl}/api/registry/agent-profiles`, {
      profile_id: "registry_agent",
      name: "Registry Agent",
      openclaw_agent_id: "registry-openclaw-agent",
      default_skills: ["default-skill", "node-skill"],
      allowed_tools: ["profile-tool", "node-tool"],
      disallowed_skills: ["blocked-skill"],
    });
    assert.equal(profile.status, 201);

    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Registry compile",
      templateId: "registry-compile-template",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const compiled = plan?.compiled_nodes[0];
    assert.equal(compiled?.openclaw_agent_id, "registry-openclaw-agent");
    assert.deepEqual(compiled?.allowed_skills, ["default-skill", "node-skill"]);
    assert.deepEqual(compiled?.allowed_tools, ["profile-tool", "node-tool"]);
    assert.equal(compiled?.registry_provenance.agent_profile_requested, "registry_agent");
    assert.equal(compiled?.registry_provenance.agent_profile_resolved, "registry-agent");
    assert.equal(compiled?.registry_provenance.agent_profile_source, "registry");
    assert.equal(compiled?.registry_provenance.openclaw_agent_id_source, "registry");
    assert.deepEqual(compiled?.registry_provenance.skill_bindings, [
      {
        skill_id: "default-skill",
        sources: ["agent_profile_default"],
        registry_status: "missing",
        included: true,
        excluded_reason: null,
      },
      {
        skill_id: "node-skill",
        sources: ["agent_profile_default", "node_allowed"],
        registry_status: "missing",
        included: true,
        excluded_reason: null,
      },
      {
        skill_id: "blocked-skill",
        sources: ["node_allowed"],
        registry_status: "missing",
        included: false,
        excluded_reason: "disallowed_by_agent_profile",
      },
    ]);
    assert.deepEqual(compiled?.registry_provenance.tool_bindings, [
      {
        tool_id: "profile-tool",
        sources: ["agent_profile_allowed"],
      },
      {
        tool_id: "node-tool",
        sources: ["agent_profile_allowed", "node_allowed"],
      },
    ]);

    const run = getRun(runId);
    assert.ok(run);
    assert.ok(plan);
    assert.ok(compiled);
    const envelope = buildDispatchEnvelope(run!, plan!, compiled);
    assert.deepEqual(envelope.registry_provenance, compiled.registry_provenance);
    const enrichedEnvelope = buildDispatchEnvelope(run!, plan!, compiled, {
      extraInputPayload: {
        upstream_context: {
          nodes: [
            {
              node_id: "node_research",
              node_name: "Gather Research",
              summary: "Collected research context",
              artifacts: [
                {
                  name: "research-summary.txt",
                  storage_uri: "bridge://dispatches/disp_research/agent-report",
                },
              ],
            },
          ],
        },
      },
    });
    assert.equal(
      (
        enrichedEnvelope.input_payload.upstream_context as {
          nodes: Array<{ node_id: string; artifacts: Array<{ name: string }> }>;
        }
      ).nodes[0]?.node_id,
      "node_research",
    );
    assert.equal(
      (
        enrichedEnvelope.input_payload.upstream_context as {
          nodes: Array<{ node_id: string; artifacts: Array<{ name: string }> }>;
        }
      ).nodes[0]?.artifacts[0]?.name,
      "research-summary.txt",
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "registry-compile-template",
      runId,
      agentProfileId: "registry-agent",
    });
  }
});

test("run plan compiler ignores disabled registry profile and falls back to template binding", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "registry-disabled-compile-template",
      agent_profile_bindings: {
        disabled_agent: "legacy-openclaw-agent",
      },
      nodes: [
        {
          id: "node_disabled",
          name: "Disabled Registry Node",
          type: "agent_task",
          agent_profile: "disabled_agent",
          allowed_skills: ["node-skill"],
          config: {
            allowed_tools: ["node-tool"],
            output_contract: {},
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    await postJson(`${server.baseUrl}/api/registry/agent-profiles`, {
      profile_id: "disabled_agent",
      name: "Disabled Agent",
      openclaw_agent_id: "registry-openclaw-agent",
      default_skills: ["default-skill"],
      allowed_tools: ["profile-tool"],
      status: "disabled",
    });

    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Disabled registry compile",
      templateId: "registry-disabled-compile-template",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.equal(plan?.compiled_nodes[0]?.openclaw_agent_id, "legacy-openclaw-agent");
    assert.deepEqual(plan?.compiled_nodes[0]?.allowed_skills, ["node-skill"]);
    assert.deepEqual(plan?.compiled_nodes[0]?.allowed_tools, ["node-tool"]);
    assert.equal(plan?.compiled_nodes[0]?.registry_provenance.agent_profile_requested, "disabled_agent");
    assert.equal(plan?.compiled_nodes[0]?.registry_provenance.agent_profile_resolved, "disabled-agent");
    assert.equal(plan?.compiled_nodes[0]?.registry_provenance.agent_profile_status, "disabled");
    assert.equal(plan?.compiled_nodes[0]?.registry_provenance.agent_profile_source, "template_binding");
    assert.equal(plan?.compiled_nodes[0]?.registry_provenance.openclaw_agent_id_source, "template_binding");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "registry-disabled-compile-template",
      runId,
      agentProfileId: "disabled-agent",
    });
  }
});

test("planner template selection recommends a published template by intent", async () => {
  resetTestRoot();
  configureEnv();
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
  });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    openclaw_agent_id: "backend",
    default_skills: [],
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "research-summary-template",
      name: "Research Summary Template",
      description: "Collect competitor research and write a summary",
      metadata: {
        domain: "research",
      },
    }),
  );
  seedTemplate(
    buildPublishedTemplate({
      template_id: "invoice-template",
      name: "Invoice Processing Template",
      description: "Parse invoices and extract payment fields",
      metadata: {
        domain: "finance",
      },
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const response = await postJson(`${server.baseUrl}/api/planner/template-selection`, {
      intent: "Please help me collect competitor research and produce a summary",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.selected_template.template_id, "research-summary-template");
    assert.ok(response.body.selected_template.score > 0);
    assert.ok(response.body.selected_template.matched_terms.includes("research"));
    assert.equal(response.body.planner_context.planner_model, "rule_based_v1");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "research-summary-template",
    });
    cleanupTestArtifacts({
      templateId: "invoice-template",
    });
    cleanupTestArtifacts({
      agentProfileId: "backend",
      skillId: "coding-agent",
    });
  }
});

test("planner candidate plan compiles frontier without creating a run", async () => {
  resetTestRoot();
  configureEnv();
  for (const skillId of ["research", "coding-agent", "writing"]) {
    seedSkill({
      skill_id: skillId,
      name: skillId,
    });
  }
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    openclaw_agent_id: "backend",
    default_skills: [],
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "planner-frontier-template",
      nodes: [
        {
          id: "node_collect",
          name: "Collect Research",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["research", "coding-agent"],
          config: {
            allowed_tools: ["read", "shell"],
            output_contract: {
              expected_artifacts: ["research-notes"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_write",
          name: "Write Summary",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["writing"],
          config: {
            allowed_tools: ["write"],
            output_contract: {
              expected_artifacts: ["summary"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_collect",
          to: "node_write",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const response = await postJson(`${server.baseUrl}/api/planner/candidate-plan`, {
      intent: "Research competitors and write a summary",
      template_id: "planner-frontier-template",
      inputs: {
        goal: "Research competitors",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.validation.passed, true);
    assert.deepEqual(response.body.validation.warnings, []);
    assert.equal(response.body.candidate_plan.run_id, "candidate_run");
    assert.equal(response.body.candidate_plan.status, "draft");
    assert.equal(response.body.candidate_plan.compiled_nodes.length, 2);
    assert.equal(response.body.candidate_plan.frontier.length, 1);
    const firstNode = response.body.candidate_plan.compiled_nodes.find(
      (node: { node_id: string }) => node.node_id === "node_collect",
    );
    assert.equal(response.body.candidate_plan.frontier[0], firstNode.node_run_id);
    assert.equal(response.body.candidate_plan.planner_context.template_selected_by, "planner");
    assert.equal(getRun("candidate_run"), null);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "planner-frontier-template",
      agentProfileId: "backend",
    });
    for (const skillId of ["research", "coding-agent", "writing"]) {
      cleanupTestArtifacts({
        skillId,
      });
    }
  }
});

test("planner candidate plan validates registry-bound agents and skills", async () => {
  resetTestRoot();
  configureEnv();
  seedSkill({
    skill_id: "known-active",
    name: "Known Active",
  });
  seedSkill({
    skill_id: "disabled-skill",
    name: "Disabled Skill",
    status: "disabled",
  });
  seedSkill({
    skill_id: "blocked-skill",
    name: "Blocked Skill",
  });
  seedAgentProfile({
    profile_id: "active-agent",
    name: "Active Agent",
    openclaw_agent_id: "active-openclaw",
    default_skills: ["known-active"],
    disallowed_skills: ["blocked-skill"],
  });
  seedAgentProfile({
    profile_id: "disabled-agent",
    name: "Disabled Agent",
    openclaw_agent_id: "disabled-openclaw",
    status: "disabled",
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "planner-registry-validation-template",
      agent_profile_bindings: {
        "active-agent": "legacy-active",
        "disabled-agent": "legacy-disabled",
        missing_agent: "legacy-missing",
      },
      nodes: [
        {
          id: "node_active",
          name: "Active Node",
          type: "agent_task",
          agent_profile: "active-agent",
          allowed_skills: ["unknown-skill", "disabled-skill", "blocked-skill"],
          config: {},
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_disabled",
          name: "Disabled Node",
          type: "agent_task",
          agent_profile: "disabled-agent",
          allowed_skills: [],
          config: {},
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_missing",
          name: "Missing Node",
          type: "agent_task",
          agent_profile: "missing_agent",
          allowed_skills: [],
          config: {},
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const response = await postJson(`${server.baseUrl}/api/planner/candidate-plan`, {
      intent: "Validate registry warnings",
      template_id: "planner-registry-validation-template",
      inputs: {
        goal: "Check registry",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.validation.passed, false);
    assert.ok(
      response.body.validation.warnings.includes(
        "Node node_missing (Missing Node) uses unknown agent profile: missing_agent",
      ),
    );
    assert.ok(
      response.body.validation.warnings.includes(
        "Node node_disabled (Disabled Node) uses disabled agent profile: disabled-agent",
      ),
    );
    assert.ok(
      response.body.validation.warnings.includes(
        "Node node_active (Active Node) uses unknown skill: unknown-skill",
      ),
    );
    assert.ok(
      response.body.validation.warnings.includes(
        "Node node_active (Active Node) uses disabled skill: disabled-skill",
      ),
    );
    assert.ok(
      response.body.validation.warnings.includes(
        "Node node_active (Active Node) skill blocked-skill is disallowed by agent profile active-agent.",
      ),
    );
    assert.equal(
      response.body.candidate_plan.planner_context.registry_validation.executable_node_count,
      3,
    );
    assert.equal(
      response.body.candidate_plan.planner_context.registry_validation.registry_bound_node_count,
      1,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "planner-registry-validation-template",
      agentProfileId: "active-agent",
      skillId: "known-active",
    });
    cleanupTestArtifacts({
      agentProfileId: "disabled-agent",
      skillId: "disabled-skill",
    });
    cleanupTestArtifacts({
      skillId: "blocked-skill",
    });
  }
});

test("planner candidate plan warns about missing required inputs", async () => {
  resetTestRoot();
  configureEnv();
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
  });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    openclaw_agent_id: "backend",
    default_skills: [],
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "planner-required-input-template",
      input_schema: {
        type: "object",
        properties: {
          goal: { type: "string" },
          audience: { type: "string" },
        },
        required: ["goal", "audience"],
      },
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const response = await postJson(`${server.baseUrl}/api/planner/candidate-plan`, {
      intent: "Build a plan",
      template_id: "planner-required-input-template",
      inputs: {
        goal: "Plan the task",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.validation.passed, false);
    assert.ok(response.body.validation.warnings.includes("Missing required input: audience"));
    assert.ok(
      response.body.validation.details.some(
        (detail: { code: string; category: string; field: string | null }) =>
          detail.code === "missing_required_input" &&
          detail.category === "required_input" &&
          detail.field === "audience",
      ),
    );
    assert.equal(response.body.candidate_plan.planner_context.validation_passed, false);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "planner-required-input-template",
      agentProfileId: "backend",
      skillId: "coding-agent",
    });
  }
});

test("planner preview smoke covers strict block and explicit warn override run creation", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "planner-strict-override-smoke-template",
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const plannerPreview = await postJson(`${server.baseUrl}/api/planner/candidate-plan`, {
      intent: "Smoke preview before run creation",
      template_id: "planner-strict-override-smoke-template",
      inputs: {
        goal: "Preview validation before explicit override",
      },
    });

    assert.equal(plannerPreview.status, 200);
    assert.equal(plannerPreview.body.validation.passed, false);
    assert.ok(
      plannerPreview.body.validation.details.some(
        (detail: { code: string; category: string; node_id: string | null }) =>
          detail.code === "unknown_agent_profile" &&
          detail.category === "registry" &&
          detail.node_id === "node_backend",
      ),
    );
    assert.equal(plannerPreview.body.candidate_plan.run_id, "candidate_run");
    assert.equal(getRun("candidate_run"), null);

    const strictCreate = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Smoke strict block",
      template_id: "planner-strict-override-smoke-template",
      inputs: {
        goal: "Preview validation before explicit override",
      },
    });

    assert.equal(strictCreate.status, 409);
    assert.equal(strictCreate.body.code, "run_validation_failed");
    assert.equal(strictCreate.body.validation.passed, false);
    assert.ok(
      strictCreate.body.validation.details.some(
        (detail: { code: string; category: string; node_id: string | null }) =>
          detail.code === "unknown_agent_profile" &&
          detail.category === "registry" &&
          detail.node_id === "node_backend",
      ),
    );

    const runsAfterStrictBlock = await getJson(`${server.baseUrl}/api/runs`);
    assert.equal(runsAfterStrictBlock.status, 200);
    assert.equal(runsAfterStrictBlock.body.items.length, 0);

    const warnCreate = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Smoke warn override",
      template_id: "planner-strict-override-smoke-template",
      inputs: {
        goal: "Preview validation before explicit override",
      },
      validation_mode: "warn",
    });

    assert.equal(warnCreate.status, 201);
    runId = warnCreate.body.run_id;
    assert.equal(warnCreate.body.status, "queued");
    assert.equal(warnCreate.body.validation.passed, false);
    assert.ok(
      warnCreate.body.validation.details.some(
        (detail: { code: string; category: string; node_id: string | null }) =>
          detail.code === "unknown_agent_profile" &&
          detail.category === "registry" &&
          detail.node_id === "node_backend",
      ),
    );

    const createdRun = getRun(runId);
    assert.ok(createdRun);
    assert.equal(createdRun?.template_id, "planner-strict-override-smoke-template");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "planner-strict-override-smoke-template",
      runId,
    });
  }
});

test("planner dag draft derives editable template draft from intent and registry-aware template selection", async () => {
  resetTestRoot();
  configureEnv();
  seedSkill({
    skill_id: "research-skill",
    name: "Research Skill",
    tags: ["market", "research"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    description: "Handles market research analysis",
    openclaw_agent_id: "openclaw-research-agent",
    default_skills: ["research-skill"],
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "planner-dag-draft-template",
      name: "Market Research Workflow",
      description: "Research market signals and summarize findings",
      agent_profile_bindings: {
        "research-agent": "legacy-research-agent",
      },
      nodes: [
        {
          id: "node_research",
          name: "Research Market",
          type: "agent_task",
          agent_profile: "research-agent",
          allowed_skills: ["research-skill"],
          config: {
            allowed_tools: ["read", "write"],
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_end",
          name: "End",
          type: "end",
          agent_profile: null,
          allowed_skills: [],
          config: {},
          retry_policy: {
            max_attempts: 0,
            backoff_seconds: 0,
          },
          timeout_seconds: 60,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_research",
          to: "node_end",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const response = await postJson(`${server.baseUrl}/api/planner/dag-draft`, {
      intent: "Research market expansion opportunities",
      inputs: {
        goal: "Assess the market",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.planner_context.draft_strategy, "template_variant");
    assert.equal(response.body.planner_context.human_confirmation_required, true);
    assert.equal(response.body.planner_context.source_template_id, "planner-dag-draft-template");
    assert.equal(response.body.draft_template.status, undefined);
    assert.equal(response.body.draft_template.nodes.length, 2);
    assert.equal(response.body.validation.passed, true);
    assert.equal(response.body.registry_recommendations[0].agent_profile_id, "research-agent");
    assert.equal(response.body.registry_recommendations[0].openclaw_agent_id, "openclaw-research-agent");

    const templates = await getJson(`${server.baseUrl}/api/templates`);
    assert.equal(templates.status, 200);
    assert.equal(
      templates.body.items.some(
        (item: { template_id: string }) => item.template_id === response.body.draft_template.template_id,
      ),
      false,
    );
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "planner-dag-draft-template",
      agentProfileId: "research-agent",
      skillId: "research-skill",
    });
  }
});

test("planner dag draft synthesizes a registry-backed DAG when no template is published", async () => {
  resetTestRoot();
  configureEnv();
  seedSkill({
    skill_id: "writing-skill",
    name: "Writing Skill",
    tags: ["write", "draft"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Drafts customer-facing content",
    openclaw_agent_id: "openclaw-writer-agent",
    default_skills: ["writing-skill"],
  });
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });

  try {
    const response = await postJson(`${server.baseUrl}/api/planner/dag-draft`, {
      intent: "Write a customer update",
      inputs: {
        goal: "Create the update",
      },
      max_agent_nodes: 1,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.planner_context.draft_strategy, "registry_synthesis");
    assert.equal(response.body.template_recommendation, null);
    assert.equal(response.body.draft_template.nodes.length, 2);
    assert.equal(response.body.draft_template.nodes[0].agent_profile, "writer-agent");
    assert.deepEqual(response.body.draft_template.nodes[0].allowed_skills, ["writing-skill"]);
    assert.equal(response.body.draft_template.edges[0].from, "node_task_1");
    assert.equal(response.body.draft_template.edges[0].to, "node_end");
    assert.equal(response.body.validation.passed, true);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      agentProfileId: "writer-agent",
      skillId: "writing-skill",
    });
  }
});

test("callback waiting_human creates approval and mobile detail exposes next actions", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_backend",
          name: "Backend Task",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: "human_review",
          human_input_schema: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Approval required run",
      template_id: "mobile-test-template",
      inputs: {
        goal: "Verify approval gating",
      },
      validation_mode: "warn",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;
    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    const callback = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "waiting_human",
        progress: {
          percent: 60,
          message: "Need approval before continuing",
        },
        raw_ref: {
          dispatch_id: "disp_wait_001",
          openclaw_task_id: "task_wait_001",
          openclaw_session_id: "sess_wait_001",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );
    assert.equal(callback.status, 202);

    const approvals = listApprovals("pending");
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].run_id, runId);

    const mobileDetail = await getJson(`${server.baseUrl}/api/mobile/runs/${runId}`);
    assert.equal(mobileDetail.status, 200);
    assert.equal(mobileDetail.body.run.status, "waiting_human");
    assert.equal(mobileDetail.body.pending_approvals.length, 1);
    assert.equal(mobileDetail.body.pending_human_inputs.length, 0);
    assert.ok(mobileDetail.body.next_actions.includes("approve"));
    assert.ok(mobileDetail.body.next_actions.includes("reject"));

    const events = listRunEvents(runId);
    assert.ok(events.some((event) => event.type === "approval.requested"));
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("callback waiting_human auto-approves when configured and completed callback persists artifact", async () => {
  resetTestRoot();
  configureEnv({
    MY_MATE_AUTO_APPROVE_HUMAN_GATES: "true",
  });
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_backend",
          name: "Backend Task",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: {
            type: "object",
            properties: {
              answer: { type: "string" },
            },
          },
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Auto approve run",
      template_id: "mobile-test-template",
      inputs: {
        goal: "Verify auto approval",
      },
      validation_mode: "warn",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;
    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    const waitingCallback = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "waiting_human",
        progress: {
          percent: 80,
          message: "Need extra input before continuing",
        },
        raw_ref: {
          dispatch_id: "disp_auto_001",
          openclaw_task_id: "task_auto_001",
          openclaw_session_id: "sess_auto_001",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );
    assert.equal(waitingCallback.status, 202);
    assert.equal(listApprovals("pending").length, 0);
    assert.equal(listHumanInputs("pending").length, 0);

    const detailAfterAutoApprove = await getJson(`${server.baseUrl}/api/mobile/runs/${runId}`);
    assert.equal(detailAfterAutoApprove.status, 200);
    assert.equal(detailAfterAutoApprove.body.run.status, "running");
    assert.equal(detailAfterAutoApprove.body.pending_approvals.length, 0);
    assert.equal(detailAfterAutoApprove.body.pending_human_inputs.length, 0);

    const completedCallback = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "completed",
        progress: {
          percent: 100,
          message: "Backend task completed",
        },
        artifacts: [
          {
            artifact_id: "artifact_backend_001",
            type: "summary",
            name: "backend-report.txt",
            storage_uri: "bridge://dispatches/disp_auto_001/report",
            mime_type: "text/plain",
            size_bytes: 42,
          },
        ],
        raw_ref: {
          dispatch_id: "disp_auto_001",
          openclaw_task_id: "task_auto_001",
          openclaw_session_id: "sess_auto_001",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );
    assert.equal(completedCallback.status, 202);

    const run = getRun(runId);
    assert.equal(run?.status, "completed");

    const artifacts = listArtifacts(runId);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].artifact_id, "artifact_backend_001");

    const mobileDetail = await getJson(`${server.baseUrl}/api/mobile/runs/${runId}`);
    assert.equal(mobileDetail.status, 200);
    assert.equal(mobileDetail.body.run.status, "completed");
    assert.equal(mobileDetail.body.artifacts.length, 1);
    assert.equal(mobileDetail.body.timeline.at(-1).type, "run.completed");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("mobile home inbox and follow-up aggregate pending work", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_gate",
          name: "Approval Gate",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: "human_review",
          human_input_schema: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Inbox approval run",
      goal: "Aggregate pending approval",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    const callback = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "waiting_human",
        progress: {
          percent: 55,
          message: "Need approval on phone",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );
    assert.equal(callback.status, 202);

    const home = await getJson(`${server.baseUrl}/api/mobile/home`);
    assert.equal(home.status, 200);
    assert.equal(home.body.overview.total_runs, 1);
    assert.equal(home.body.overview.waiting_runs, 1);
    assert.equal(home.body.overview.pending_approval_count, 1);
    assert.equal(home.body.overview.pending_human_input_count, 0);
    assert.equal(home.body.inbox.pending_count, 1);
    assert.equal(home.body.missions.total_missions, 0);
    assert.equal(home.body.missions.missions_needing_attention, 0);
    assert.equal(home.body.focus_session, null);
    assert.deepEqual(home.body.recent_sessions, []);
    assert.equal(home.body.focus_run.run_id, runId);
    assert.ok(home.body.recent_runs.some((item: { run_id: string }) => item.run_id === runId));

    const inbox = await getJson(`${server.baseUrl}/api/mobile/inbox`);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.items.length, 1);
    assert.equal(inbox.body.items[0].kind, "approval");
    assert.equal(inbox.body.items[0].run_id, runId);
    assert.equal(inbox.body.items[0].task.node_run_id, nodeRunId);
    assert.deepEqual(inbox.body.items[0].next_actions, ["approve", "reject"]);

    const followUp = await getJson(`${server.baseUrl}/api/mobile/runs/${runId}/follow-up`);
    assert.equal(followUp.status, 200);
    assert.equal(followUp.body.run.run_id, runId);
    assert.equal(followUp.body.blocker, "Need approval on phone");
    assert.equal(followUp.body.pending_approvals.length, 1);
    assert.equal(followUp.body.pending_human_inputs.length, 0);
    assert.equal(followUp.body.active_task.node_run_id, nodeRunId);
    assert.equal(followUp.body.latest_timeline[0].type, "approval.requested");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("mobile home projects focus mission and recent mission summaries", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare today's account follow-up",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const followUp = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Use a practical tone and include next actions",
    });
    assert.equal(followUp.status, 201);

    const home = await getJson(`${server.baseUrl}/api/mobile/home`);
    assert.equal(home.status, 200);
    assert.equal(home.body.missions.total_missions, 1);
    assert.equal(home.body.missions.active_missions, 0);
    assert.equal(home.body.missions.waiting_missions, 0);
    assert.equal(home.body.missions.missions_needing_attention, 1);
    assert.equal(home.body.focus_session.session_id, sessionId);
    assert.equal(home.body.focus_session.mission_snapshot.missionTitle, "Prepare today's account follow-up");
    assert.equal(home.body.focus_session.mission_view.title, "Prepare today's account follow-up");
    assert.equal(typeof home.body.focus_session.mission_view.routeLabel, "string");
    assert.equal(home.body.focus_session.mission_snapshot.spec.constraints[0], "Use a practical tone and include next actions");
    assert.equal(home.body.recent_sessions.length, 1);
    assert.equal(home.body.recent_sessions[0].session_id, sessionId);
    assert.equal(home.body.recent_sessions[0].mission_snapshot.nextActionLabel, "Draft a workflow");
    assert.equal(home.body.recent_sessions[0].mission_view.nextActionLabel, "Draft a workflow");
    assert.equal(home.body.focus_run, null);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
    });
  }
});

test("missions list returns mission-first items projected from sessions", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare today's account follow-up",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const list = await getJson(`${server.baseUrl}/api/missions`);
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].mission_id, sessionId);
    assert.equal(list.body.items[0].session_id, sessionId);
    assert.equal(list.body.items[0].mission_snapshot.missionTitle, "Prepare today's account follow-up");
    assert.equal(list.body.items[0].mission_spec.objective, "Prepare today's account follow-up");
    assert.equal(list.body.items[0].mission_view.title, "Prepare today's account follow-up");
    assert.equal(typeof list.body.items[0].mission_view.statusLabel, "string");
    assert.equal(typeof list.body.items[0].mission_view.routeLabel, "string");
    assert.equal(typeof list.body.items[0].mission_view.workLabel, "string");
    assert.equal(typeof list.body.items[0].mission_view.checkpointLabel, "string");
    assert.ok(Array.isArray(list.body.items[0].active_run_ids));
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
    });
  }
});

test("session and mission lists support search archive and direct open", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let alphaSessionId = "";
  let betaSessionId = "";

  try {
    const alpha = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare alpha account handoff",
    });
    const beta = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Build beta archive candidate",
    });
    assert.equal(alpha.status, 201);
    assert.equal(beta.status, 201);
    alphaSessionId = alpha.body.session.session_id;
    betaSessionId = beta.body.session.session_id;

    const search = await getJson(`${server.baseUrl}/api/missions?q=alpha`);
    assert.equal(search.status, 200);
    assert.equal(search.body.items.length, 1);
    assert.equal(search.body.items[0].session_id, alphaSessionId);

    const archive = await postJson(`${server.baseUrl}/api/sessions/${betaSessionId}/archive`, {
      requested_by: "tester",
      reason: "Covered by another mission.",
    });
    assert.equal(archive.status, 200);
    assert.equal(archive.body.session.archived, true);
    assert.equal(archive.body.session.archived_by, "tester");

    const defaultMissions = await getJson(`${server.baseUrl}/api/missions`);
    assert.equal(defaultMissions.status, 200);
    assert.ok(defaultMissions.body.items.some((item: { session_id: string }) => item.session_id === alphaSessionId));
    assert.ok(!defaultMissions.body.items.some((item: { session_id: string }) => item.session_id === betaSessionId));

    const archivedMissions = await getJson(`${server.baseUrl}/api/missions?visibility=archived`);
    assert.equal(archivedMissions.status, 200);
    assert.equal(archivedMissions.body.items.length, 1);
    assert.equal(archivedMissions.body.items[0].session_id, betaSessionId);
    assert.equal(archivedMissions.body.items[0].archived, true);

    const archivedSessions = await getJson(`${server.baseUrl}/api/sessions?visibility=archived&q=beta`);
    assert.equal(archivedSessions.status, 200);
    assert.equal(archivedSessions.body.items.length, 1);
    assert.equal(archivedSessions.body.items[0].session_id, betaSessionId);

    const direct = await getJson(`${server.baseUrl}/api/sessions/${betaSessionId}`);
    assert.equal(direct.status, 200);
    assert.equal(direct.body.session.session_id, betaSessionId);
    assert.equal(direct.body.session.archived, true);

    const unarchive = await postJson(`${server.baseUrl}/api/sessions/${betaSessionId}/unarchive`, {
      requested_by: "tester",
    });
    assert.equal(unarchive.status, 200);
    assert.equal(unarchive.body.session.archived, false);

    const restored = await getJson(`${server.baseUrl}/api/missions?q=beta`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.items.length, 1);
    assert.equal(restored.body.items[0].session_id, betaSessionId);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      sessionId: alphaSessionId,
    });
    if (betaSessionId) {
      cleanupTestArtifacts({
        sessionId: betaSessionId,
      });
    }
  }
});

test("mission detail returns mission-first top-level payload with session rail intact", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare today's account follow-up",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const detail = await getJson(`${server.baseUrl}/api/missions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.mission.mission_id, sessionId);
    assert.equal(detail.body.session.session_id, sessionId);
    assert.equal(detail.body.mission_snapshot.missionTitle, "Prepare today's account follow-up");
    assert.equal(detail.body.workspace_contract_version, 1);
    assert.equal(detail.body.mission_snapshot.workspace_contract_version, 1);
    assert.equal(detail.body.mission_spec.objective, "Prepare today's account follow-up");
    assert.equal(detail.body.mission.mission_view.title, "Prepare today's account follow-up");
    assert.equal(detail.body.mission_view.title, "Prepare today's account follow-up");
    assert.equal(detail.body.mission_view.summary, detail.body.mission_snapshot.missionSummary);
    assert.equal(detail.body.mission_view.routeLabel, "Unrouted");
    assert.ok(Array.isArray(detail.body.messages));
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
    });
  }
});

test("session detail and runtime summary expose desktop workspace projections", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  seedAgentProfile({
    profile_id: "hosted-backend",
    name: "Hosted Backend",
    description: "Hosted OpenClaw backend agent",
    openclaw_agent_id: "openclaw-backend-agent",
    default_skills: ["coding-agent"],
    metadata: {
      openclaw: {
        provider: "anthropic",
        model: "claude-opus",
        runtime_mode: "native-agent",
      },
    },
  });
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let sessionId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare today's account follow-up",
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.workspace_state);
    assert.ok(Array.isArray(detail.body.next_actions));
    assert.equal(detail.body.workspace_contract_version, 1);
    assert.ok(detail.body.mission_snapshot);
    assert.equal(detail.body.mission_snapshot.workspace_contract_version, 1);

    const runtime = await getJson(`${server.baseUrl}/api/runtime/summary`);
    assert.equal(runtime.status, 200);
    assert.equal(runtime.body.execution_runtime.adapter_kind, "stub");
    const hosted = runtime.body.agent_hosting.profiles.find(
      (item: { profile_id: string }) => item.profile_id === "hosted-backend",
    );
    assert.ok(hosted);
    assert.equal(hosted.openclaw_agent_id, "openclaw-backend-agent");
    assert.equal(hosted.provider, "anthropic");
    assert.equal(hosted.model, "claude-opus");
    assert.equal(hosted.runtime_mode, "native-agent");
    assert.equal(runtime.body.planner.fallback_provider_id, "rule_based_v1");
    assert.ok(typeof runtime.body.registry.template_count === "number");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      agentProfileId: "hosted-backend",
      sessionId,
    });
  }
});

test("approve resumes waiting node and forwards retry action to adapter", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_gate",
          name: "Approval Gate",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: "human_review",
          human_input_schema: null,
        },
      ],
    }),
  );
  const adapter = {
    ...createStubExecutionAdapter(),
    kind: "openclaw",
  };
  const server = await startTestServer({ executionAdapter: adapter });
  let runId = "";

  try {
    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Approve waiting node",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "waiting_human",
        progress: {
          percent: 40,
          message: "Need manager approval",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );

    const approval = listApprovals("pending")[0];
    assert.ok(approval);

    const approve = await postJson(
      `${server.baseUrl}/api/approvals/${approval.approval_id}/approve`,
      {
        comment: "Proceed",
      },
    );
    assert.equal(approve.status, 200);
    assert.equal(approve.body.status, "approved");

    const run = getRun(runId);
    assert.equal(run?.status, "running");

    const refreshedPlan = getRunPlan(runId);
    assert.equal(refreshedPlan?.compiled_nodes[0]?.status, "ready");

    const nodeRuns = listNodeRuns(runId);
    assert.equal(nodeRuns[0]?.status, "ready");
    assert.equal(nodeRuns[0]?.progress.message, "Approval granted; ready for dispatch");

    assert.deepEqual(adapter.nodeActions, [
      { runId, nodeRunId, action: "retry" },
    ]);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("reject marks run failed and persists approval event", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_gate",
          name: "Approval Gate",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: "human_review",
          human_input_schema: null,
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Reject waiting node",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "waiting_human",
        progress: {
          percent: 30,
          message: "Need reviewer decision",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );

    const approval = listApprovals("pending")[0];
    assert.ok(approval);

    const reject = await postJson(
      `${server.baseUrl}/api/approvals/${approval.approval_id}/reject`,
      {
        comment: "Risk too high",
      },
    );
    assert.equal(reject.status, 200);
    assert.equal(reject.body.status, "rejected");

    const run = getRun(runId);
    assert.equal(run?.status, "failed");
    assert.equal(run?.blocked_reason, "Approval rejected");

    const events = listRunEvents(runId);
    assert.ok(events.some((event) => event.type === "approval.rejected"));
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("submit human input re-queues node and stores payload in compiled node input", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_input",
          name: "Human Input Gate",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: {
            type: "object",
            properties: {
              answer: { type: "string" },
            },
            required: ["answer"],
          },
        },
      ],
    }),
  );
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({ executionAdapter: adapter });
  let runId = "";

  try {
    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Submit human input",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "waiting_human",
        progress: {
          percent: 65,
          message: "Need a human answer",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );

    const inputRequest = listHumanInputs("pending")[0];
    assert.ok(inputRequest);

    const submit = await postJson(
      `${server.baseUrl}/api/human-inputs/${inputRequest.input_request_id}/submit`,
      {
        payload: {
          answer: "Option B",
        },
      },
    );
    assert.equal(submit.status, 200);
    assert.equal(submit.body.status, "submitted");

    const run = getRun(runId);
    assert.equal(run?.status, "running");

    const refreshedPlan = getRunPlan(runId);
    assert.deepEqual(
      refreshedPlan?.compiled_nodes[0]?.input_payload.run_inputs,
      {
        goal: "Verify control-plane behavior",
        human_input_submission: {
          answer: "Option B",
        },
      },
    );
    assert.equal(refreshedPlan?.compiled_nodes[0]?.status, "ready");

    assert.deepEqual(adapter.nodeActions, [
      { runId, nodeRunId, action: "retry" },
    ]);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("mobile inbox returns human input schema for schema-driven form rendering", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_input",
          name: "Structured Input Gate",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: {
            type: "object",
            properties: {
              answer: { type: "string", title: "Answer" },
              priority: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["answer"],
          },
        },
      ],
    }),
  );
  const server = await startTestServer({
    executionAdapter: createStubExecutionAdapter(),
  });
  let runId = "";

  try {
    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Inbox schema run",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "waiting_human",
        progress: {
          percent: 50,
          message: "Need structured input",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );

    const inbox = await getJson(`${server.baseUrl}/api/mobile/inbox`);
    assert.equal(inbox.status, 200);
    const item = inbox.body.items.find(
      (entry: { run_id: string; kind: string }) =>
        entry.run_id === runId && entry.kind === "human_input",
    );
    assert.ok(item);
    assert.equal(item.input_schema.required[0], "answer");
    assert.equal(item.input_schema.properties.priority.enum[2], "high");
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("end nodes complete in scheduler without dispatching to execution adapter", async () => {
  resetTestRoot();
  configureEnv({
    MY_MATE_ENABLE_LOCAL_EXECUTION: "false",
    MY_MATE_EXECUTION_ADAPTER: "openclaw",
  });
  const adapter = createStubExecutionAdapter();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "end-node-template",
      nodes: [
        {
          id: "node_backend",
          name: "Backend Task",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_end",
          name: "End",
          type: "end",
          agent_profile: null,
          allowed_skills: [],
          config: {},
          retry_policy: {
            max_attempts: 0,
            backoff_seconds: 0,
          },
          timeout_seconds: 60,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [{ from: "node_backend", to: "node_end", condition: null, label: null }],
    }),
  );
  const server = await startTestServer({
    executionAdapter: adapter,
  });
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Verify end node scheduler behavior",
      template_id: "end-node-template",
      inputs: {
        goal: "Verify end node scheduler behavior",
      },
      validation_mode: "warn",
    });
    assert.equal(created.status, 201);
    runId = created.body.run_id;

    const plan = getRunPlan(runId);
    const backendNodeRunId = plan?.compiled_nodes.find((item) => item.node_id === "node_backend")?.node_run_id;
    assert.ok(backendNodeRunId);

    const callback = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: backendNodeRunId,
        status: "completed",
        progress: {
          percent: 100,
          message: "Backend task finished",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );
    assert.equal(callback.status, 202);

    const refreshedRun = getRun(runId);
    assert.equal(refreshedRun?.status, "completed");
    assert.equal(refreshedRun?.current_summary, "Run completed");

    const refreshedPlan = getRunPlan(runId);
    const endNode = refreshedPlan?.compiled_nodes.find((item) => item.node_id === "node_end");
    assert.equal(endNode?.status, "completed");
    assert.equal(adapter.dispatchEnvelopes.length, 0);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "end-node-template",
      runId,
    });
  }
});

test("pause resume and cancel run mutate state and notify adapter", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({ executionAdapter: adapter });
  let runId = "";

  try {
    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Run actions",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;

    const running = await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "running",
        progress: {
          percent: 20,
          message: "Node is running",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );
    assert.equal(running.status, 202);

    const pause = await postJson(`${server.baseUrl}/api/runs/${runId}/actions/pause`, {});
    assert.equal(pause.status, 200);
    assert.equal(pause.body.status, "paused");
    assert.equal(getRun(runId)?.status, "paused");

    const resume = await postJson(`${server.baseUrl}/api/runs/${runId}/actions/resume`, {});
    assert.equal(resume.status, 200);
    assert.equal(resume.body.status, "running");
    assert.equal(getRun(runId)?.status, "running");

    const cancel = await postJson(`${server.baseUrl}/api/runs/${runId}/actions/cancel`, {});
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.status, "cancelled");
    assert.equal(getRun(runId)?.status, "cancelled");

    assert.deepEqual(adapter.runActions, [
      { runId, action: "pause" },
      { runId, action: "resume" },
      { runId, action: "cancel" },
    ]);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("retry failed node and skip pending downstream node", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate(
    buildPublishedTemplate({
      nodes: [
        {
          id: "node_a",
          name: "Node A",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_b",
          name: "Node B",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: {
              expected_artifacts: ["agent-report"],
            },
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 5,
          },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [
        {
          from: "node_a",
          to: "node_b",
          condition: null,
          label: null,
        },
      ],
    }),
  );
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({ executionAdapter: adapter });
  let runId = "";

  try {
    const createRun = await createRunForTest(server.baseUrl, {
      intent: "Node actions",
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    const initialPlan = getRunPlan(runId);
    assert.ok(initialPlan);
    const firstNodeRunId = initialPlan!.compiled_nodes.find((node) => node.node_id === "node_a")!.node_run_id;
    const secondNodeRunId = initialPlan!.compiled_nodes.find((node) => node.node_id === "node_b")!.node_run_id;

    await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: firstNodeRunId,
        status: "failed",
        progress: {
          percent: 100,
          message: "Node A failed",
        },
        error: {
          code: "FAILED",
          message: "Node A failed",
        },
      },
      {
        authorization: "Bearer test-callback-token",
      },
    );

    const retry = await postJson(
      `${server.baseUrl}/api/runs/${runId}/nodes/${firstNodeRunId}/actions/retry`,
      {},
    );
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, "ready");

    let refreshedPlan = getRunPlan(runId);
    assert.equal(
      refreshedPlan?.compiled_nodes.find((node) => node.node_run_id === firstNodeRunId)?.status,
      "ready",
    );

    const skip = await postJson(
      `${server.baseUrl}/api/runs/${runId}/nodes/${secondNodeRunId}/actions/skip`,
      {},
    );
    assert.equal(skip.status, 200);
    assert.equal(skip.body.status, "skipped");

    refreshedPlan = getRunPlan(runId);
    assert.equal(
      refreshedPlan?.compiled_nodes.find((node) => node.node_run_id === secondNodeRunId)?.status,
      "skipped",
    );

    assert.deepEqual(adapter.nodeActions, [
      { runId, nodeRunId: firstNodeRunId, action: "retry" },
      { runId, nodeRunId: secondNodeRunId, action: "skip" },
    ]);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
      runId,
    });
  }
});

test("dispatch sweep proxies adapter maintenance result", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const adapter = createStubExecutionAdapter({
    maintenanceResult: {
      action: "dispatch_sweep",
      adapter_kind: "openclaw",
      supported: true,
      message: "Maintenance completed",
      summary: {
        scanned: 3,
        normalized: 1,
        resumed: 1,
        aligned: 0,
        finalized: 1,
      },
    },
  });
  const server = await startTestServer({ executionAdapter: adapter });

  try {
    const response = await postJson(
      `${server.baseUrl}/api/internal/ops/execution/dispatch-sweep`,
      {},
    );
    assert.equal(response.status, 202);
    assert.equal(response.body.adapter_kind, "openclaw");
    assert.equal(response.body.summary.scanned, 3);
    assert.deepEqual(adapter.maintenanceActions, ["dispatch_sweep"]);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "mobile-test-template",
    });
  }
});

async function setupSessionWithRunningPatch(serverBaseUrl: string): Promise<{
  sessionId: string;
  runId: string;
  patchId: string;
}> {
  const created = await postJson(`${serverBaseUrl}/api/sessions`, {
    initial_message: "Prepare a runtime steering demo",
  });
  const sessionId = created.body.session.session_id;

  const runCreated = await postJson(`${serverBaseUrl}/api/sessions/${sessionId}/runs`, {
    validation_mode: "warn",
    inputs: { goal: "Prepare a runtime steering demo" },
    template_id: "mobile-test-template",
  });
  const runId = runCreated.body.run_id;

  // Push the run into 'running' via a callback report so the pause patch
  // can validly transition it. Stub adapter's enqueueRun is a no-op, so
  // without this the run sits in 'queued' and pause would 409.
  const plan = getRunPlan(runId);
  const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;
  if (!nodeRunId) {
    throw new Error("node_run_id not found");
  }
  await postJson(
    `${serverBaseUrl}/api/internal/openclaw/reports`,
    {
      run_id: runId,
      node_run_id: nodeRunId,
      status: "running",
      progress: { percent: 20, message: "Running" },
    },
    { authorization: "Bearer test-callback-token" },
  );

  const intervention = await postJson(`${serverBaseUrl}/api/sessions/${sessionId}/interventions`, {
    content: "Pause before final delivery",
    target_run_id: runId,
  });
  const patchCard = intervention.body.messages.find(
    (message: { kind: string }) => message.kind === "dag_patch_card",
  );
  const patchId = patchCard?.content?.patch_id;
  if (!patchId) {
    throw new Error("patch_id not found in intervention response");
  }
  return { sessionId, runId, patchId };
}

test("confirm patch pauses run and marks patch applied", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({ executionAdapter: adapter });
  let sessionId = "";
  let runId = "";

  try {
    const setup = await setupSessionWithRunningPatch(server.baseUrl);
    sessionId = setup.sessionId;
    runId = setup.runId;
    const patchId = setup.patchId;

    // Confirm the patch.
    const confirmResponse = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/patches/${patchId}/confirm`,
      {},
    );
    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmResponse.body.patch.status, "applied");
    assert.equal(confirmResponse.body.operation_outcomes[0].applied, true);
    assert.equal(confirmResponse.body.operation_outcomes[0].op, "pause_for_replan");
    assert.equal(confirmResponse.body.patch.operation_outcomes[0].op, "pause_for_replan");
    assert.equal(confirmResponse.body.patch.operation_outcomes[0].details.next_run_status, "paused");
    assert.ok(confirmResponse.body.patch.applied_at);
    assert.ok(confirmResponse.body.patch.resumed_topology);

    const messageList = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`);
    const appliedPatchCard = messageList.body.items.find(
      (message: { kind: string; content: { patch_id?: string } }) =>
        message.kind === "dag_patch_card" && message.content.patch_id === patchId,
    );
    assert.ok(appliedPatchCard);
    assert.equal(appliedPatchCard.content.operation_outcomes[0].op, "pause_for_replan");
    assert.equal(appliedPatchCard.content.operation_outcomes[0].applied, true);

    // Run should now be paused.
    const runDetail = await getJson(`${server.baseUrl}/api/runs/${runId}`);
    assert.equal(runDetail.body.status, "paused");

    // Adapter should have received the pause notification.
    assert.ok(
      adapter.runActions.some(
        (entry) => entry.runId === runId && entry.action === "pause",
      ),
    );

    // Re-confirming the same patch returns 409.
    const reConfirm = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/patches/${patchId}/confirm`,
      {},
    );
    assert.equal(reConfirm.status, 409);
    assert.equal(reConfirm.body.code, "patch_already_resolved");
  } finally {
    if (sessionId && runId) {
      cleanupTestArtifacts({
        templateId: "mobile-test-template",
        sessionId,
        runId,
      });
    }
    await server.close();
  }
});

test("reject patch transitions to rejected without changing run state", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({ executionAdapter: adapter });
  let sessionId = "";
  let runId = "";

  try {
    const setup = await setupSessionWithRunningPatch(server.baseUrl);
    sessionId = setup.sessionId;
    runId = setup.runId;
    const patchId = setup.patchId;

    const rejectResponse = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/patches/${patchId}/reject`,
      { reason: "Wait for next pass." },
    );
    assert.equal(rejectResponse.status, 200);
    assert.equal(rejectResponse.body.patch.status, "rejected");
    assert.equal(rejectResponse.body.patch.reason, "Wait for next pass.");

    // Run state must not have changed.
    const runDetail = await getJson(`${server.baseUrl}/api/runs/${runId}`);
    assert.notEqual(runDetail.body.status, "paused");

    // No pause action should have been forwarded to the adapter.
    assert.equal(
      adapter.runActions.filter((entry) => entry.action === "pause").length,
      0,
    );

    // Re-rejecting returns 409.
    const reReject = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/patches/${patchId}/reject`,
      {},
    );
    assert.equal(reReject.status, 409);
  } finally {
    if (sessionId && runId) {
      cleanupTestArtifacts({
        templateId: "mobile-test-template",
        sessionId,
        runId,
      });
    }
    await server.close();
  }
});

test("confirming add_node patch inserts a runtime step and keeps the run resumable", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({ executionAdapter: adapter });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Add an extra benchmarking step",
    });
    sessionId = created.body.session.session_id;

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
      inputs: { goal: "Add an extra benchmarking step" },
      template_id: "mobile-test-template",
    });
    runId = runCreated.body.run_id;

    const intervention = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/interventions`, {
      content: "Add a benchmark step before final delivery",
      target_run_id: runId,
    });
    const patchCard = intervention.body.messages.find(
      (message: { kind: string }) => message.kind === "dag_patch_card",
    );
    assert.equal(patchCard.content.apply_supported, true);
    assert.equal(
      patchCard.content.operations.find((operation: { op: string }) => operation.op === "add_node")?.value
        ?.requested_step,
      "benchmark step",
    );
    assert.ok(
      patchCard.content.operations.some((operation: { op: string }) => operation.op === "add_node"),
    );
    assert.ok(
      patchCard.content.operations.some((operation: { op: string }) => operation.op === "resume_with_patch"),
    );
    assert.ok(patchCard.content.graph_preview);
    assert.ok(patchCard.content.graph_preview.summary_lines.length >= 2);
    assert.equal(patchCard.content.graph_preview.node_delta, 1);
    assert.equal(patchCard.content.graph_preview.actual_topology, null);
    const patchId = patchCard.content.patch_id;

    const confirmResponse = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/patches/${patchId}/confirm`,
      {},
    );
    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmResponse.body.patch.status, "applied");
    assert.ok(
      confirmResponse.body.operation_outcomes.some(
        (outcome: { op: string; applied: boolean }) =>
          outcome.op === "add_node" && outcome.applied === true,
      ),
    );
    assert.ok(
      confirmResponse.body.operation_outcomes.some(
        (outcome: { op: string; applied: boolean }) =>
          outcome.op === "resume_with_patch" && outcome.applied === true,
      ),
    );
    const addNodeOutcome = confirmResponse.body.patch.operation_outcomes.find(
      (outcome: { op: string }) => outcome.op === "add_node",
    );
    assert.ok(addNodeOutcome);
    assert.match(addNodeOutcome.node_name, /benchmark step/i);
    assert.equal(addNodeOutcome.details.inserted_node_run_id, addNodeOutcome.node_run_id);
    assert.ok(confirmResponse.body.patch.resumed_topology.node_count >= 2);
    assert.ok(confirmResponse.body.patch.graph_preview);
    assert.ok(confirmResponse.body.patch.graph_preview.actual_topology);
    assert.equal(
      confirmResponse.body.patch.graph_preview.actual_topology.node_count,
      confirmResponse.body.patch.resumed_topology.node_count,
    );
    assert.deepEqual(
      confirmResponse.body.patch.metadata.graph_preview,
      confirmResponse.body.patch.graph_preview,
    );
    assert.deepEqual(
      confirmResponse.body.patch.metadata.operation_outcomes,
      confirmResponse.body.patch.operation_outcomes,
    );

    const plan = getRunPlan(runId);
    assert.ok(plan);
    assert.ok(plan!.compiled_nodes.length >= 2);
    assert.ok(
      plan!.compiled_nodes.some((node) => /benchmark step/i.test(node.name)),
    );

    const runDetail = await getJson(`${server.baseUrl}/api/runs/${runId}`);
    assert.equal(runDetail.body.status, "running");
  } finally {
    if (sessionId && runId) {
      cleanupTestArtifacts({
        templateId: "mobile-test-template",
        sessionId,
        runId,
      });
    }
    await server.close();
  }
});

test("scheduler respects max_parallel_nodes when dispatching ready nodes", async () => {
  resetTestRoot();
  configureEnv({
    MY_MATE_ENABLE_LOCAL_EXECUTION: "false",
    MY_MATE_EXECUTION_ADAPTER: "openclaw",
  });
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
    description: "Coding helper",
    status: "active",
  });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    description: "Backend agent",
    openclaw_agent_id: "backend",
    default_skills: ["coding-agent"],
    allowed_tools: ["read", "write", "shell"],
    disallowed_skills: [],
    policy_tags: [],
    status: "active",
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "parallel-cap-template-001",
      policy: {
        max_parallel_nodes: 1,
        default_timeout_seconds: 900,
        budget_policy: {},
        approval_policy: {},
      },
      nodes: [
        {
          id: "node_a",
          name: "Node A",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: { expected_artifacts: ["agent-report"] },
          },
          retry_policy: { max_attempts: 1, backoff_seconds: 5 },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_b",
          name: "Node B",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: { expected_artifacts: ["agent-report"] },
          },
          retry_policy: { max_attempts: 1, backoff_seconds: 5 },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [],
    }),
  );
  const adapter = {
    ...createStubExecutionAdapter(),
    kind: "openclaw" as const,
  };
  const server = await startTestServer({ executionAdapter: adapter });
  let runId = "";

  try {
    const createRun = await postJson(`${server.baseUrl}/api/runs`, {
      intent: "Parallel cap test",
      template_id: "parallel-cap-template-001",
      validation_mode: "strict",
      inputs: { goal: "Parallel cap test" },
    });
    assert.equal(createRun.status, 201);
    runId = createRun.body.run_id;

    assert.equal(adapter.dispatchEnvelopes.length, 1);

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const runningNodes = plan!.compiled_nodes.filter((node) => node.status === "running");
    const readyNodes = plan!.compiled_nodes.filter((node) => node.status === "ready");
    assert.equal(runningNodes.length, 1);
    assert.equal(readyNodes.length, 1);
    assert.equal(plan!.policy_snapshot.max_parallel_nodes, 1);
  } finally {
    await server.close();
    cleanupTestArtifacts({
      templateId: "parallel-cap-template-001",
      agentProfileId: "backend",
      skillId: "coding-agent",
      runId,
    });
  }
});

test("runtime skip intervention targets a node mentioned in natural language", async () => {
  resetTestRoot();
  configureEnv({
    MY_MATE_ENABLE_LOCAL_EXECUTION: "false",
    MY_MATE_EXECUTION_ADAPTER: "openclaw",
  });
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
    description: "Coding helper",
    status: "active",
  });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    description: "Backend agent",
    openclaw_agent_id: "backend",
    default_skills: ["coding-agent"],
    allowed_tools: ["read", "write", "shell"],
    disallowed_skills: [],
    policy_tags: [],
    status: "active",
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "skip-target-template-001",
      policy: {
        max_parallel_nodes: 1,
        default_timeout_seconds: 900,
        budget_policy: {},
        approval_policy: {},
      },
      nodes: [
        {
          id: "node_a",
          name: "Node A",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: { expected_artifacts: ["agent-report"] },
          },
          retry_policy: { max_attempts: 1, backoff_seconds: 5 },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_b",
          name: "Node B",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: { expected_artifacts: ["agent-report"] },
          },
          retry_policy: { max_attempts: 1, backoff_seconds: 5 },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [],
    }),
  );
  const adapter = {
    ...createStubExecutionAdapter(),
    kind: "openclaw" as const,
  };
  const server = await startTestServer({ executionAdapter: adapter });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Skip a named node on the active run",
    });
    sessionId = created.body.session.session_id;

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
      inputs: { goal: "Skip a named node on the active run" },
      template_id: "skip-target-template-001",
    });
    runId = runCreated.body.run_id;

    const intervention = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/interventions`, {
      content: "Skip Node B",
      target_run_id: runId,
    });
    const patchCard = intervention.body.messages.find(
      (message: { kind: string }) => message.kind === "dag_patch_card",
    );
    assert.ok(patchCard);
    assert.equal(patchCard.content.operations[0].op, "skip_node");
    assert.equal(patchCard.content.operations[0].node_id, "node_b");
    assert.equal(patchCard.content.operations[0].node_name, "Node B");

    const confirmResponse = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/patches/${patchCard.content.patch_id}/confirm`,
      {},
    );
    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmResponse.body.patch.status, "applied");
    assert.equal(confirmResponse.body.operation_outcomes[0].node_id, "node_b");

    const plan = getRunPlan(runId);
    assert.ok(plan);
    const nodeB = plan!.compiled_nodes.find((node) => node.node_id === "node_b");
    assert.equal(nodeB?.status, "skipped");
  } finally {
    if (sessionId || runId) {
      cleanupTestArtifacts({
        templateId: "skip-target-template-001",
        agentProfileId: "backend",
        skillId: "coding-agent",
        sessionId,
        runId,
      });
    }
    await server.close();
  }
});

test("runtime resume intervention maps to resume_with_patch and resumes a paused run", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const adapter = createStubExecutionAdapter();
  const server = await startTestServer({ executionAdapter: adapter });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Resume a paused run",
    });
    sessionId = created.body.session.session_id;

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
      inputs: { goal: "Resume a paused run" },
      template_id: "mobile-test-template",
    });
    runId = runCreated.body.run_id;

    const plan = getRunPlan(runId);
    const nodeRunId = plan?.compiled_nodes[0]?.node_run_id;
    assert.ok(nodeRunId);
    await postJson(
      `${server.baseUrl}/api/internal/openclaw/reports`,
      {
        run_id: runId,
        node_run_id: nodeRunId,
        status: "running",
        progress: { percent: 20, message: "Running" },
      },
      { authorization: "Bearer test-callback-token" },
    );

    const pauseResponse = await postJson(`${server.baseUrl}/api/runs/${runId}/actions/pause`, {});
    assert.equal(pauseResponse.status, 200);
    assert.equal(pauseResponse.body.status, "paused");

    const intervention = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/interventions`, {
      content: "Continue execution now",
      target_run_id: runId,
    });
    const patchCard = intervention.body.messages.find(
      (message: { kind: string }) => message.kind === "dag_patch_card",
    );
    assert.ok(patchCard);
    assert.equal(intervention.body.intervention.kind, "resume_request");
    assert.equal(patchCard.content.apply_supported, true);
    assert.equal(patchCard.content.operations[0].op, "resume_with_patch");

    const confirmResponse = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/patches/${patchCard.content.patch_id}/confirm`,
      {},
    );
    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmResponse.body.patch.status, "applied");
    assert.equal(confirmResponse.body.operation_outcomes[0].op, "resume_with_patch");
    assert.equal(confirmResponse.body.operation_outcomes[0].applied, true);

    const runDetail = await getJson(`${server.baseUrl}/api/runs/${runId}`);
    assert.equal(runDetail.body.status, "running");
    assert.ok(adapter.runActions.some((entry) => entry.runId === runId && entry.action === "resume"));
  } finally {
    if (sessionId || runId) {
      cleanupTestArtifacts({
        templateId: "mobile-test-template",
        sessionId,
        runId,
      });
    }
    await server.close();
  }
});

test("runtime change intervention preserves replacement intent for later replanning", async () => {
  resetTestRoot();
  configureEnv();
  seedTemplate();
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Capture replacement steering intent",
    });
    sessionId = created.body.session.session_id;

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
      inputs: { goal: "Capture replacement steering intent" },
      template_id: "mobile-test-template",
    });
    runId = runCreated.body.run_id;

    const intervention = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/interventions`, {
      content: "Replace Backend Task with QA pass",
      target_run_id: runId,
    });
    const patchCard = intervention.body.messages.find(
      (message: { kind: string }) => message.kind === "dag_patch_card",
    );
    assert.ok(patchCard);
    assert.equal(intervention.body.intervention.kind, "change_request");
    assert.equal(patchCard.content.operations[0].op, "pause_for_replan");
    assert.equal(patchCard.content.operations[0].node_id, "node_backend");
    assert.deepEqual(patchCard.content.operations[0].value, {
      requested_change: "Replace Backend Task with QA pass",
      replace_from: "Backend Task",
      replace_to: "QA pass",
    });
  } finally {
    if (sessionId || runId) {
      cleanupTestArtifacts({
        templateId: "mobile-test-template",
        sessionId,
        runId,
      });
    }
    await server.close();
  }
});

test("confirming parallelism patch raises scheduler capacity and dispatches next ready node", async () => {
  resetTestRoot();
  configureEnv({
    MY_MATE_ENABLE_LOCAL_EXECUTION: "false",
    MY_MATE_EXECUTION_ADAPTER: "openclaw",
  });
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
    description: "Coding helper",
    status: "active",
  });
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend",
    description: "Backend agent",
    openclaw_agent_id: "backend",
    default_skills: ["coding-agent"],
    allowed_tools: ["read", "write", "shell"],
    disallowed_skills: [],
    policy_tags: [],
    status: "active",
  });
  seedTemplate(
    buildPublishedTemplate({
      template_id: "parallel-patch-template-001",
      policy: {
        max_parallel_nodes: 1,
        default_timeout_seconds: 900,
        budget_policy: {},
        approval_policy: {},
      },
      nodes: [
        {
          id: "node_a",
          name: "Node A",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: { expected_artifacts: ["agent-report"] },
          },
          retry_policy: { max_attempts: 1, backoff_seconds: 5 },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
        {
          id: "node_b",
          name: "Node B",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read", "write", "shell"],
            output_contract: { expected_artifacts: ["agent-report"] },
          },
          retry_policy: { max_attempts: 1, backoff_seconds: 5 },
          timeout_seconds: 900,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [],
    }),
  );
  const adapter = {
    ...createStubExecutionAdapter(),
    kind: "openclaw" as const,
  };
  const server = await startTestServer({ executionAdapter: adapter });
  let sessionId = "";
  let runId = "";

  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Increase parallelism on the active run",
    });
    sessionId = created.body.session.session_id;

    const runCreated = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/runs`, {
      validation_mode: "warn",
      inputs: { goal: "Increase parallelism on the active run" },
      template_id: "parallel-patch-template-001",
    });
    runId = runCreated.body.run_id;

    assert.equal(adapter.dispatchEnvelopes.length, 1);

    const intervention = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/interventions`, {
      content: "Set concurrency to 2",
      target_run_id: runId,
    });
    const patchCard = intervention.body.messages.find(
      (message: { kind: string }) => message.kind === "dag_patch_card",
    );
    assert.ok(patchCard);
    assert.equal(patchCard.content.apply_supported, true);
    assert.equal(
      patchCard.content.operations.find((operation: { op: string }) => operation.op === "change_parallelism")?.value
        ?.requested_parallelism,
      2,
    );

    const patchId = patchCard.content.patch_id;
    const confirmResponse = await postJson(
      `${server.baseUrl}/api/sessions/${sessionId}/patches/${patchId}/confirm`,
      {},
    );
    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmResponse.body.patch.status, "applied");
    assert.equal(confirmResponse.body.operation_outcomes[0].op, "change_parallelism");
    assert.equal(confirmResponse.body.operation_outcomes[0].applied, true);
    assert.equal(confirmResponse.body.patch.operation_outcomes[0].details.previous_parallelism, 1);
    assert.equal(confirmResponse.body.patch.operation_outcomes[0].details.next_parallelism, 2);
    assert.ok(
      confirmResponse.body.operation_outcomes.some(
        (outcome: { op: string; applied: boolean }) =>
          outcome.op === "resume_with_patch" && outcome.applied === true,
      ),
    );
    assert.equal(confirmResponse.body.patch.resumed_topology.max_parallel_nodes, 2);
    assert.equal(confirmResponse.body.patch.resumed_topology.running_node_run_ids.length, 2);

    assert.equal(adapter.dispatchEnvelopes.length, 2);

    const plan = getRunPlan(runId);
    assert.ok(plan);
    assert.equal(plan!.policy_snapshot.max_parallel_nodes, 2);
    assert.equal(
      plan!.compiled_nodes.filter((node) => node.status === "running").length,
      2,
    );
  } finally {
    if (sessionId || runId) {
      cleanupTestArtifacts({
        templateId: "parallel-patch-template-001",
        agentProfileId: "backend",
        skillId: "coding-agent",
        sessionId,
        runId,
      });
    }
    await server.close();
  }
});
