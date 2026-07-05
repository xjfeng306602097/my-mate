import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { Request, Response } from "express";
import { getJson, patchJson, postJson, putJson, startTestServer } from "./helpers.js";

async function loadControlPlaneTestHelpers(): Promise<{
  resetTestRoot: () => void;
  buildPublishedTemplate: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  seedTemplate: (template: Record<string, unknown>) => void;
  cleanupTestArtifacts: (input: { templateId?: string; runId?: string }) => void;
  createStubExecutionAdapter: () => unknown;
  startTestServer: (input?: { executionAdapter?: unknown }) => Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }>;
}> {
  const moduleUrl = new URL("../../control-plane/test/helpers.ts", import.meta.url);
  return (await import(moduleUrl.href)) as {
    resetTestRoot: () => void;
    buildPublishedTemplate: (overrides?: Record<string, unknown>) => Record<string, unknown>;
    seedTemplate: (template: Record<string, unknown>) => void;
    cleanupTestArtifacts: (input: { templateId?: string; runId?: string }) => void;
    createStubExecutionAdapter: () => unknown;
    startTestServer: (input?: { executionAdapter?: unknown }) => Promise<{
      baseUrl: string;
      close: () => Promise<void>;
    }>;
  };
}

function buildGatewayMissionSpec() {
  return {
    objective: "Plan a gateway task",
    sourceBrief: "Plan a gateway task",
    constraints: [],
    requestedOutputs: [],
    openQuestions: [],
    decisionFocus: null,
    route: {
      activeRevision: 1,
      activeOption: "primary",
      latestRevision: 1,
      confirmedRevision: null,
      confirmedOption: null,
      selectedTemplateId: "gateway-template",
      selectedTemplateName: "Gateway Template",
      alternativeAvailable: true,
      stale: false,
      staleReason: null,
    },
    pipelineSummary: {
      total: 0,
      ready: 0,
      active: 0,
      blocked: 0,
      completed: 0,
      primaryAgentLabels: [],
    },
    checkpointSummary: {
      total: 0,
      completed: 0,
      active: 0,
      pending: 0,
      labels: [],
    },
    revisionLineage: {
      sourceRevision: null,
      sourceOption: null,
      latestRevision: 1,
      confirmedRevision: null,
      confirmedOption: null,
    },
  };
}

async function startUpstreamServer() {
  const app = express();
  app.use(express.json());

  const requests: Array<{
    method: string;
    path: string;
    body: unknown;
    gatewayHeader: string | undefined;
  }> = [];

  app.get("/api/mobile/home", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({ overview: { total_runs: 0 }, recent_runs: [] });
  });

  app.post("/api/runs", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({ run_id: "run_gateway_test", status: "queued" });
  });

  app.get("/api/runs/run_gateway_test/graph", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      runId: "run_gateway_test",
      templateId: "gateway-template",
      templateVersion: 1,
      runStatus: "running",
      intent: "Gateway graph",
      generatedAt: "2026-06-11T00:00:00.000Z",
      nodes: [
        {
          nodeRunId: "node_run_gateway",
          nodeId: "node_gateway",
          name: "Gateway Node",
          type: "agent_task",
          status: "ready",
          progress: {
            percent: 0,
            message: "Ready",
            updated_at: "2026-06-11T00:00:00.000Z",
          },
          attempt: 0,
          startedAt: null,
          finishedAt: null,
          agentProfile: "backend",
          openclawAgentId: "backend",
          approvalKind: null,
          humanInputRequired: false,
          expectedArtifacts: ["agent-report"],
          workPackageKey: "other",
          workPackageLabel: "Execution",
          markers: ["active_frontier", "ready"],
        },
      ],
      edges: [],
      frontier: ["node_run_gateway"],
      statusCounts: {
        pending: 0,
        ready: 1,
        running: 0,
        waiting_human: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
      },
      markers: {
        activeFrontier: ["node_run_gateway"],
        waitingHuman: [],
        blocked: [],
        skipped: [],
      },
      workPackages: [
        {
          key: "other",
          label: "Execution",
          nodeRunIds: ["node_run_gateway"],
          status: "active",
          readyCount: 1,
          activeCount: 0,
          completedCount: 0,
          blockedCount: 0,
        },
      ],
      summaryLines: ["1 node(s), 0 edge(s), 1 work package(s)."],
    });
  });

  app.post("/api/planner/candidate-plan", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      candidate_plan: {
        run_id: "candidate_run",
      },
      validation: {
        passed: true,
        warnings: [],
      },
    });
  });

  app.post("/api/sessions", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      session: {
        session_id: "sess_gateway_test",
        title: req.body?.title || "New Task",
      },
      messages: [],
    });
  });

  app.get("/api/missions", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      items: [
        {
          mission_id: "sess_gateway_test",
          session_id: "sess_gateway_test",
          title: "Gateway Session",
          status: "planning",
          created_at: "2026-06-11T00:00:00.000Z",
          updated_at: "2026-06-11T00:05:00.000Z",
          latest_run_id: null,
          active_run_ids: [],
          message_count: 3,
          mission_spec: buildGatewayMissionSpec(),
          mission_snapshot: {
            missionTitle: "Gateway Session",
            missionSummary: "Route comparison is still in progress.",
            missionStatusLabel: "Planning",
            missionStatusTone: "warn",
            objective: "Plan a gateway task",
            spec: buildGatewayMissionSpec(),
            stages: [],
            pipelines: [],
            checkpoints: [],
            artifactSurfaces: [],
            nextActionLabel: "Compare routes",
            nextActionDetail: "Review the primary and fallback plan options.",
            latestUserInstruction: null,
            orchestratorReadback: null,
            latestOrchestratorReply: null,
            activeRouteRevision: 1,
            activeRouteOption: "primary",
            activeRunId: null,
            conversationTurns: 2,
            evidenceCount: 1,
          },
        },
      ],
    });
  });

  app.get("/api/missions/sess_gateway_test", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      mission: {
        mission_id: "sess_gateway_test",
        session_id: "sess_gateway_test",
        title: "Gateway Session",
        status: "planning",
        created_at: "2026-06-11T00:00:00.000Z",
        updated_at: "2026-06-11T00:05:00.000Z",
        latest_run_id: null,
        active_run_ids: [],
        message_count: 3,
        mission_spec: null,
        mission_snapshot: {
          missionTitle: "Gateway Session",
          missionSummary: "Route comparison is still in progress.",
          missionStatusLabel: "Planning",
          missionStatusTone: "warn",
          objective: "Plan a gateway task",
          spec: buildGatewayMissionSpec(),
          stages: [],
          pipelines: [],
          checkpoints: [],
          artifactSurfaces: [],
          nextActionLabel: "Compare routes",
          nextActionDetail: "Review the primary and fallback plan options.",
          latestUserInstruction: null,
          orchestratorReadback: null,
          latestOrchestratorReply: null,
          activeRouteRevision: 1,
          activeRouteOption: "primary",
          activeRunId: null,
          conversationTurns: 2,
          evidenceCount: 1,
        },
      },
      session: {
        session_id: "sess_gateway_test",
        title: "Gateway Session",
        status: "planning",
        created_at: "2026-06-11T00:00:00.000Z",
        updated_at: "2026-06-11T00:05:00.000Z",
        current_goal: "Plan a gateway task",
        current_plan_summary: null,
        latest_run_id: null,
        active_run_ids: [],
        last_orchestrator_message_id: null,
        confirmed_plan_revision: null,
        confirmed_plan_option: null,
        metadata: {},
      },
      messages: [],
      latest_run: null,
      mission_spec: buildGatewayMissionSpec(),
      mission_snapshot: {
        missionTitle: "Gateway Session",
        missionSummary: "Route comparison is still in progress.",
        missionStatusLabel: "Planning",
        missionStatusTone: "warn",
        objective: "Plan a gateway task",
        spec: buildGatewayMissionSpec(),
        stages: [],
        pipelines: [],
        checkpoints: [],
        artifactSurfaces: [],
        nextActionLabel: "Compare routes",
        nextActionDetail: "Review the primary and fallback plan options.",
        latestUserInstruction: null,
        orchestratorReadback: null,
        latestOrchestratorReply: null,
        activeRouteRevision: 1,
        activeRouteOption: "primary",
        activeRunId: null,
        conversationTurns: 2,
        evidenceCount: 1,
      },
    });
  });

  app.get("/api/sessions/sess_gateway_test", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      session: {
        session_id: "sess_gateway_test",
        title: "Gateway Session",
        status: "planning",
        created_at: "2026-06-11T00:00:00.000Z",
        updated_at: "2026-06-11T00:05:00.000Z",
        current_goal: "Plan a gateway task",
        current_plan_summary: null,
        latest_run_id: null,
        active_run_ids: [],
        last_orchestrator_message_id: null,
        confirmed_plan_revision: null,
        confirmed_plan_option: null,
        metadata: {
          mission_route_state: {
            active_revision: 1,
            active_option: "primary",
            latest_revision: 1,
            latest_option: "primary",
            confirmed_revision: null,
            confirmed_option: null,
            selected_template_id: "gateway-template",
            selected_template_name: "Gateway Template",
            alternative_available: true,
            stale: false,
            stale_reason: null,
          },
          mission_requested_outputs: [],
          mission_revision_lineage: {
            source_revision: null,
            source_option: null,
            latest_revision: 1,
            confirmed_revision: null,
            confirmed_option: null,
          },
        },
        mission_spec: buildGatewayMissionSpec(),
        mission_snapshot: {
          missionTitle: "Gateway Session",
          missionSummary: "Route comparison is still in progress.",
          missionStatusLabel: "Planning",
          missionStatusTone: "warn",
          objective: "Plan a gateway task",
          spec: buildGatewayMissionSpec(),
          stages: [],
          pipelines: [],
          checkpoints: [],
          artifactSurfaces: [],
          nextActionLabel: "Compare routes",
          nextActionDetail: "Review the primary and fallback plan options.",
          latestUserInstruction: null,
          orchestratorReadback: null,
          latestOrchestratorReply: null,
          activeRouteRevision: 1,
          activeRouteOption: "primary",
          activeRunId: null,
          conversationTurns: 2,
          evidenceCount: 1,
        },
      },
      messages: [],
      latest_run: null,
      workspace_state: {
        stage: "compare",
      },
      next_actions: ["confirm"],
      mission_spec: buildGatewayMissionSpec(),
      mission_snapshot: {
        missionTitle: "Gateway Session",
        missionSummary: "Route comparison is still in progress.",
        missionStatusLabel: "Planning",
        missionStatusTone: "warn",
        objective: "Plan a gateway task",
        spec: buildGatewayMissionSpec(),
        stages: [],
        pipelines: [],
        checkpoints: [],
        artifactSurfaces: [],
        nextActionLabel: "Compare routes",
        nextActionDetail: "Review the primary and fallback plan options.",
        latestUserInstruction: null,
        orchestratorReadback: null,
        latestOrchestratorReply: null,
        activeRouteRevision: 1,
        activeRouteOption: "primary",
        activeRunId: null,
        conversationTurns: 2,
        evidenceCount: 1,
      },
    });
  });

  function handleSessionVisibilityAction(req: Request, res: Response, archived: boolean) {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      session: {
        session_id: "sess_gateway_test",
        title: "Gateway Session",
        status: "planning",
        archived,
        archived_at: archived ? "2026-06-11T00:10:00.000Z" : null,
        archived_by: archived ? req.body?.requested_by || "user" : null,
        hidden: false,
        hidden_at: null,
        hidden_by: null,
      },
    });
  }

  app.post("/api/sessions/sess_gateway_test/archive", (req, res) =>
    handleSessionVisibilityAction(req, res, true),
  );

  app.post("/api/sessions/sess_gateway_test/unarchive", (req, res) =>
    handleSessionVisibilityAction(req, res, false),
  );

  app.get("/api/sessions/sess_gateway_test/attachments", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      items: [
        {
          attachment_id: "att_gateway_test",
          session_id: "sess_gateway_test",
          name: "brief.md",
          storage_uri: "file:///workspace/brief.md",
          mime_type: "text/markdown",
          size_bytes: 120,
          kind: "context",
          summary: "Gateway attachment.",
          created_by: "gateway-user",
          created_at: "2026-06-11T00:20:00.000Z",
          metadata: {},
        },
      ],
    });
  });

  app.post("/api/sessions/sess_gateway_test/attachments", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      attachment: {
        attachment_id: "att_gateway_created",
        session_id: "sess_gateway_test",
        ...req.body,
        created_by: req.body?.created_by || "gateway-user",
        created_at: "2026-06-11T00:21:00.000Z",
        metadata: req.body?.metadata || {},
      },
      items: [],
    });
  });

  app.get("/api/sessions/sess_gateway_test/compare", (req, res) => {
    requests.push({
      method: req.method,
      path: req.originalUrl,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      sessionId: "sess_gateway_test",
      comparisonKind: "option",
      left: {
        revision: 1,
        option: "primary",
        messageId: "msg_plan_options",
        templateId: "gateway-template",
        templateName: "Gateway Template",
        nodeCount: 1,
        edgeCount: 0,
        approvalGateCount: 0,
        outputCount: 1,
        warningCount: 0,
        label: "v1 / primary",
      },
      right: {
        revision: 1,
        option: "alternative",
        messageId: "msg_plan_options",
        templateId: "gateway-template-alt",
        templateName: "Gateway Alt",
        nodeCount: 2,
        edgeCount: 1,
        approvalGateCount: 1,
        outputCount: 1,
        warningCount: 1,
        label: "v1 / alternative",
      },
      changedNodes: {
        added: ["Review Gate (review_gate)"],
        removed: [],
        changed: [],
        unchangedCount: 1,
      },
      changedEdges: {
        added: ["node_backend -> review_gate"],
        removed: [],
        changed: [],
        unchangedCount: 0,
      },
      changedApprovals: {
        added: ["Review Gate (review_gate): human_review"],
        removed: [],
        changed: [],
        unchangedCount: 0,
      },
      changedOutputs: {
        added: [],
        removed: [],
        changed: [],
        unchangedCount: 1,
      },
      changedRisks: {
        added: ["Review required."],
        removed: [],
        changed: [],
        unchangedCount: 0,
      },
      summaryLines: ["Comparing v1 / primary against v1 / alternative."],
      recommendation: {
        label: "Review gate changes",
        detail: "The route changes human approval or input gates.",
        tone: "warn",
      },
    });
  });

  app.get("/api/runtime/summary", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      execution_runtime: {
        adapter_kind: "openclaw",
        runtime_health: {
          status: "ok",
          detail: "Configured",
        },
      },
      agent_hosting: {
        ownership: {
          execution_runtime: "openclaw",
          orchestration_binding: "my_mate",
        },
        profiles: [
          {
            profile_id: "backend",
            name: "Backend",
            status: "active",
            openclaw_agent_id: "openclaw-backend",
            default_skills: ["coding-agent"],
            provider: "anthropic",
            model: "claude-opus",
            runtime_mode: "native-agent",
            managed_by: "my_mate_registry",
            health: {
              status: "ready",
              detail: "Profile is bound.",
            },
          },
        ],
      },
      planner: {
        provider_id: "rule_based_v1",
        provider_name: "Rule-based planner v1",
        fallback_provider_id: "rule_based_v1",
        fallback_provider_name: "Rule-based planner v1",
        registered_provider_ids: ["rule_based_v1", "local_semantic_v1"],
        llm_model: "claude-haiku-4-5",
        llm_max_tokens: 1024,
        llm_timeout_ms: 8000,
      },
      registry: {
        agent_profile_count: 1,
        active_agent_profile_count: 1,
        skill_count: 0,
        active_skill_count: 0,
        template_count: 1,
        published_template_count: 1,
        draft_template_count: 0,
      },
    });
  });

  app.get("/api/agents/hosting", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      ownership: {
        execution_runtime: "openclaw",
        orchestration_binding: "my_mate",
      },
      profiles: [
        {
          profile_id: "backend",
          name: "Backend",
          status: "active",
          openclaw_agent_id: "openclaw-backend",
          default_skills: ["coding-agent"],
          provider: "anthropic",
          model: "claude-opus",
          runtime_mode: "native-agent",
          managed_by: "my_mate_registry",
          health: {
            status: "ready",
            detail: "Profile is bound.",
          },
        },
      ],
    });
  });

  app.put("/api/agents/backend/hosting", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      profile: {
        profile_id: "backend",
        openclaw_agent_id: req.body?.openclaw_agent_id || "openclaw-backend",
      },
      agent_hosting: {
        ownership: {
          execution_runtime: "openclaw",
          orchestration_binding: "my_mate",
        },
        profiles: [],
      },
    });
  });

  app.get("/api/sessions/sess_gateway_test/stream", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("id: evt_1\n");
    res.write("event: snapshot\n");
    res.write(
      `data: ${JSON.stringify({
        event_id: "evt_1",
        type: "snapshot",
        session_id: "sess_gateway_test",
        occurred_at: "2026-06-11T00:00:00.000Z",
        data: {
          session: {
            session_id: "sess_gateway_test",
            title: "Gateway Session",
            status: "planning",
          },
          messages: [],
          latest_run: null,
          workspace_state: {
            stage: "compare",
          },
          next_actions: ["confirm"],
          mission_snapshot: null,
          mission_spec: null,
          artifacts: [],
          pending_approvals: [],
          pending_human_inputs: [],
          interventions: [],
          dag_patches: [],
        },
      })}\n\n`,
    );
    res.end();
  });

  app.post("/api/sessions/sess_gateway_test/messages", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      session: {
        session_id: "sess_gateway_test",
        title: "Gateway Session",
        status: "planning",
      },
      user_message: {
        message_id: "msg_gateway_test",
        session_id: "sess_gateway_test",
        role: "user",
        kind: "text",
        content: {
          text: req.body?.content || "",
        },
      },
      messages: [
        {
          message_id: "msg_gateway_test",
          session_id: "sess_gateway_test",
          role: "user",
          kind: "text",
          content: {
            text: req.body?.content || "",
          },
        },
        {
          message_id: "msg_gateway_orchestrator",
          session_id: "sess_gateway_test",
          role: "orchestrator",
          kind: "text",
          content: {
            text: "Logged your note. The task brief stays open for the next orchestration step.",
          },
        },
      ],
    });
  });

  app.post("/api/sessions/sess_gateway_test/interventions", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      session: {
        session_id: "sess_gateway_test",
        title: "Gateway Session",
        status: "running",
      },
      intervention: {
        intervention_id: "int_gateway_test",
        session_id: "sess_gateway_test",
        run_id: "run_from_session_gateway",
        node_run_id: null,
        requested_by: "demo-user",
        kind: "change_request",
        status: "needs_review",
        content: req.body?.content || "",
        summary: req.body?.content || "",
        interpreted_intent: "User wants to change active execution behavior.",
        patch_preview: {
          supported: false,
          reason: "Captured for review.",
          operations: [],
        },
        metadata: {},
        created_at: "2026-06-11T00:00:00.000Z",
        updated_at: "2026-06-11T00:00:00.000Z",
      },
      messages: [
        {
          message_id: "msg_intervention",
          session_id: "sess_gateway_test",
          role: "system",
          kind: "intervention_card",
          content: {
            intervention_id: "int_gateway_test",
          },
        },
      ],
    });
  });

  app.post("/api/sessions/sess_gateway_test/patches/patch_gateway_test/confirm", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(200).json({
      session: { session_id: "sess_gateway_test", status: "running" },
      patch: {
        patch_id: "patch_gateway_test",
        status: "applied",
      },
      operation_outcomes: [{ op: "pause_for_replan", applied: true, error: null }],
    });
  });

  app.post("/api/sessions/sess_gateway_test/patches/patch_gateway_test/reject", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(200).json({
      session: { session_id: "sess_gateway_test", status: "running" },
      patch: {
        patch_id: "patch_gateway_test",
        status: "rejected",
        reason: req.body?.reason || "default",
      },
    });
  });

  app.post("/api/sessions/sess_gateway_test/dag-proposals", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      session: { session_id: "sess_gateway_test" },
      proposal: {
        proposal_id: "prop_gateway_test",
        status: "review_ready",
        title: "Gateway Proposal",
        summary: "Proposal created",
      },
    });
  });

  app.get("/api/sessions/sess_gateway_test/dag-proposals", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      items: [{ proposal_id: "prop_gateway_test", status: "review_ready" }],
      confirmed_proposal_id: null,
    });
  });

  app.get("/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      proposal: {
        proposal_id: "prop_gateway_test",
        status: "review_ready",
      },
    });
  });

  app.patch("/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/assignments", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      proposal: {
        proposal_id: "prop_gateway_test",
        assignments: req.body?.assignments || [],
      },
    });
  });

  app.post("/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/confirm", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      proposal: { proposal_id: "prop_gateway_test", status: "confirmed" },
      session: { session_id: "sess_gateway_test", confirmed_proposal_id: "prop_gateway_test" },
    });
  });

  app.post("/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/reject", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      proposal: { proposal_id: "prop_gateway_test", status: "rejected" },
    });
  });

  app.post("/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/supersede", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      proposal: { proposal_id: "prop_gateway_replacement", status: "review_ready" },
      superseded_proposal: { proposal_id: "prop_gateway_test", status: "superseded" },
    });
  });

  app.post("/api/sessions/sess_gateway_test/plan", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      session: {
        session_id: "sess_gateway_test",
        status: "ready_to_run",
      },
      recommendation: {
        selected_template: {
          template_id: "gateway-template",
          version: 1,
          name: "Gateway Template",
          description: "Gateway",
          workspace_scope: "default",
          score: 0.9,
          matched_terms: ["gateway"],
          reason: "Matched gateway intent.",
        },
        candidates: [],
        planner_context: {
          planner_model: "rule_based_v1",
          intent_tokens: ["gateway"],
        },
      },
      candidate_plan: {
        run_id: "candidate_run",
        compiled_nodes: [],
      },
      validation: {
        passed: true,
        warnings: [],
      },
      messages: [
        {
          message_id: "msg_plan_orchestrator",
          session_id: "sess_gateway_test",
          role: "orchestrator",
          kind: "text",
          content: {
            text: "Planned",
          },
        },
        {
          message_id: "msg_plan_card",
          session_id: "sess_gateway_test",
          role: "system",
          kind: "plan_card",
          content: {
            revision: 1,
          },
        },
        {
          message_id: "msg_plan_options",
          session_id: "sess_gateway_test",
          role: "system",
          kind: "plan_options_card",
          content: {
            revision: 1,
            selected_option: "primary",
            primary: {
              template_id: "gateway-template",
            },
            alternative: {
              template_id: "gateway-template-alt",
            },
          },
        },
      ],
    });
  });

  app.post("/api/sessions/sess_gateway_test/dag-draft", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      session: {
        session_id: "sess_gateway_test",
        status: "planning",
      },
      draft_template: {
        template_id: "session-draft-template",
        name: "Session Draft Template",
        description: "Draft",
        input_schema: {},
        policy: {},
        nodes: [],
        edges: [],
      },
      template_recommendation: null,
      registry_recommendations: [],
      validation: {
        passed: true,
        warnings: [],
      },
      planner_context: {
        planner_model: "rule_based_v1",
        intent_tokens: ["draft"],
        source_template_id: null,
        draft_strategy: "registry_synthesis",
        human_confirmation_required: true,
      },
      messages: [
        {
          message_id: "msg_draft_text",
          session_id: "sess_gateway_test",
          role: "orchestrator",
          kind: "text",
          content: {
            text: "Drafted",
          },
        },
        {
          message_id: "msg_draft_card",
          session_id: "sess_gateway_test",
          role: "system",
          kind: "draft_card",
          content: {
            planner_context: {
              draft_strategy: "registry_synthesis",
            },
          },
        },
      ],
    });
  });

  app.post("/api/sessions/sess_gateway_test/plan/revise", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      session: {
        session_id: "sess_gateway_test",
        status: "ready_to_run",
      },
      recommendation: null,
      candidate_plan: {
        run_id: "candidate_run_revised",
        compiled_nodes: [],
      },
      validation: {
        passed: true,
        warnings: [],
      },
      messages: [
        {
          message_id: "msg_revise_user",
          session_id: "sess_gateway_test",
          role: "user",
          kind: "text",
          content: {
            text: "Revise plan: use a different template",
          },
        },
        {
          message_id: "msg_revise_orchestrator",
          session_id: "sess_gateway_test",
          role: "orchestrator",
          kind: "text",
          content: {
            text: "Revised plan",
          },
        },
        {
          message_id: "msg_revise_plan",
          session_id: "sess_gateway_test",
          role: "system",
          kind: "plan_card",
          content: {
            revision: 2,
          },
        },
        {
          message_id: "msg_revise_options",
          session_id: "sess_gateway_test",
          role: "system",
          kind: "plan_options_card",
          content: {
            revision: 2,
            source_revision: 1,
            source_option: req.body?.option || "primary",
            selected_option: req.body?.option || "primary",
            primary: {
              template_id: "gateway-template",
            },
            alternative: {
              template_id: "gateway-template-alt",
            },
          },
        },
      ],
    });
  });

  app.post("/api/sessions/sess_gateway_test/plan/confirm", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      session: {
        session_id: "sess_gateway_test",
        confirmed_plan_revision: req.body?.revision || 1,
        confirmed_plan_option: req.body?.option || "primary",
      },
      revision: req.body?.revision || 1,
      option: req.body?.option || "primary",
      message: {
        message_id: "msg_confirm_gateway",
        session_id: "sess_gateway_test",
        role: "orchestrator",
        kind: "text",
        content: {
          text: "Confirmed",
        },
      },
    });
  });

  app.post("/api/sessions/sess_gateway_test/runs", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      run_id: "run_from_session_gateway",
      status: "queued",
      validation: {
        passed: true,
        warnings: [],
      },
      session: {
        session_id: "sess_gateway_test",
        latest_run_id: "run_from_session_gateway",
      },
      messages: [],
    });
  });

  app.post("/api/planner/dag-draft", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      draft_template: {
        template_id: "planner-draft",
        name: "Planner Draft",
        description: "Draft",
        input_schema: {},
        policy: {},
        nodes: [],
        edges: [],
      },
      template_recommendation: null,
      registry_recommendations: [],
      validation: {
        passed: true,
        warnings: [],
      },
      planner_context: {
        planner_model: "rule_based_v1",
        intent_tokens: ["draft"],
        source_template_id: null,
        draft_strategy: "registry_synthesis",
        human_confirmation_required: true,
      },
    });
  });

  app.post("/api/templates/template-source/derive", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      template_id: "template-derived",
      status: "draft",
    });
  });

  app.get("/api/registry/agent-profiles", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      items: [
        {
          profile_id: "backend",
          status: "active",
        },
      ],
    });
  });

  app.get("/api/orchestrator-profiles", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: null,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.json({
      items: [
        {
          orchestrator_id: "studio-orchestrator",
          name: "Studio Orchestrator",
        },
      ],
    });
  });

  app.post("/api/orchestrator-profiles", (req, res) => {
    requests.push({
      method: req.method,
      path: req.path,
      body: req.body,
      gatewayHeader: req.header("x-my-mate-gateway"),
    });
    res.status(201).json({
      orchestrator_id: req.body?.orchestrator_id || "studio-orchestrator",
      name: req.body?.name || "Studio Orchestrator",
    });
  });

  return await new Promise<{
    baseUrl: string;
    requests: typeof requests;
    close: () => Promise<void>;
  }>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Upstream server did not expose an address.");
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise<void>((done, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              done();
            });
          }),
      });
    });
  });
}

test("health returns gateway metadata", async () => {
  const server = await startTestServer();
  try {
    const response = await getJson(`${server.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
    assert.equal(response.body.auth_required, false);
  } finally {
    await server.close();
  }
});

test("proxies allowed mobile GET requests to control-plane", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const response = await getJson(`${server.baseUrl}/api/mobile/home`);
    assert.equal(response.status, 200);
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].path, "/api/mobile/home");
    assert.equal(upstream.requests[0].gatewayHeader, "api-gateway");
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("proxies allowed POST requests with body", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const payload = {
      intent: "gateway smoke",
      template_id: "template",
      inputs: { goal: "test" },
    };
    const response = await postJson(`${server.baseUrl}/api/runs`, payload);
    assert.equal(response.status, 201);
    assert.equal(response.body.run_id, "run_gateway_test");
    assert.deepEqual(upstream.requests[0].body, payload);
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("proxies runtime graph GET requests", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const response = await getJson(`${server.baseUrl}/api/runs/run_gateway_test/graph`);
    assert.equal(response.status, 200);
    assert.equal(response.body.runId, "run_gateway_test");
    assert.equal(response.body.nodes[0].markers.includes("active_frontier"), true);
    assert.equal(upstream.requests[0].path, "/api/runs/run_gateway_test/graph");
    assert.equal(upstream.requests[0].gatewayHeader, "api-gateway");
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("proxies planner candidate plan requests", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const payload = {
      intent: "draft plan",
      template_id: "template",
      inputs: { goal: "test" },
    };
    const response = await postJson(`${server.baseUrl}/api/planner/candidate-plan`, payload);
    assert.equal(response.status, 200);
    assert.equal(response.body.candidate_plan.run_id, "candidate_run");
    assert.equal(upstream.requests[0].path, "/api/planner/candidate-plan");
    assert.equal(upstream.requests[0].gatewayHeader, "api-gateway");
    assert.deepEqual(upstream.requests[0].body, payload);
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("proxies session routes with body payloads", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const createSessionPayload = {
      title: "Gateway Session",
      initial_message: "Plan a gateway task",
    };
    const created = await postJson(`${server.baseUrl}/api/sessions`, createSessionPayload);
    assert.equal(created.status, 201);
    assert.equal(created.body.session.session_id, "sess_gateway_test");

    const missions = await getJson(`${server.baseUrl}/api/missions`);
    assert.equal(missions.status, 200);
    assert.equal(missions.body.items[0].mission_id, "sess_gateway_test");
    assert.equal(missions.body.items[0].mission_spec.route.activeRevision, 1);
    assert.equal(missions.body.items[0].mission_spec.route.activeOption, "primary");
    assert.equal(missions.body.items[0].mission_snapshot.nextActionLabel, "Compare routes");

    const missionDetail = await getJson(`${server.baseUrl}/api/missions/sess_gateway_test`);
    assert.equal(missionDetail.status, 200);
    assert.equal(missionDetail.body.mission.mission_id, "sess_gateway_test");
    assert.equal(missionDetail.body.session.session_id, "sess_gateway_test");
    assert.equal(missionDetail.body.mission_spec.revisionLineage.latestRevision, 1);
    assert.equal(missionDetail.body.mission_snapshot.spec.pipelineSummary.total, 0);

    const archivePayload = {
      requested_by: "gateway-user",
      reason: "Keep the active list focused.",
    };
    const archived = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/archive`,
      archivePayload,
    );
    assert.equal(archived.status, 200);
    assert.equal(archived.body.session.archived, true);
    assert.equal(archived.body.session.archived_by, "gateway-user");

    const unarchivePayload = {
      requested_by: "gateway-user",
    };
    const unarchived = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/unarchive`,
      unarchivePayload,
    );
    assert.equal(unarchived.status, 200);
    assert.equal(unarchived.body.session.archived, false);

    const attachmentPayload = {
      name: "brief.md",
      storage_uri: "file:///workspace/brief.md",
      mime_type: "text/markdown",
      size_bytes: 120,
      kind: "context",
      summary: "Gateway attachment.",
      created_by: "gateway-user",
    };
    const attachment = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/attachments`,
      attachmentPayload,
    );
    assert.equal(attachment.status, 201);
    assert.equal(attachment.body.attachment.attachment_id, "att_gateway_created");
    assert.equal(attachment.body.attachment.storage_uri, "file:///workspace/brief.md");

    const attachments = await getJson(`${server.baseUrl}/api/sessions/sess_gateway_test/attachments`);
    assert.equal(attachments.status, 200);
    assert.equal(attachments.body.items[0].attachment_id, "att_gateway_test");

    const compare = await getJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/compare?left_revision=1&right_option=alternative`,
    );
    assert.equal(compare.status, 200);
    assert.equal(compare.body.sessionId, "sess_gateway_test");
    assert.equal(compare.body.comparisonKind, "option");
    assert.equal(compare.body.changedApprovals.added[0], "Review Gate (review_gate): human_review");

    const addMessagePayload = {
      content: "Need a follow-up message",
    };
    const message = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/messages`,
      addMessagePayload,
    );
    assert.equal(message.status, 201);
    assert.equal(message.body.user_message.message_id, "msg_gateway_test");
    assert.ok(
      message.body.messages.some(
        (item: { role: string; kind: string }) =>
          item.role === "orchestrator" && item.kind === "text",
      ),
    );

    const interventionPayload = {
      content: "Pause before the final step and add a review note",
      kind: "change_request",
      target_run_id: "run_from_session_gateway",
    };
    const intervention = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/interventions`,
      interventionPayload,
    );
    assert.equal(intervention.status, 201);
    assert.equal(intervention.body.intervention.intervention_id, "int_gateway_test");

    const draftPayload = {
      inputs: {
        goal: "Draft a gateway task",
      },
      max_agent_nodes: 2,
    };
    const drafted = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-draft`,
      draftPayload,
    );
    assert.equal(drafted.status, 200);
    assert.equal(drafted.body.messages[1].kind, "draft_card");

    const planPayload = {
      draft_message_id: "msg_draft_card",
      inputs: {
        goal: "Plan a gateway task",
      },
    };
    const plan = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/plan`,
      planPayload,
    );
    assert.equal(plan.status, 200);
    assert.equal(plan.body.session.status, "ready_to_run");
    assert.equal(plan.body.messages[2].kind, "plan_options_card");

    const revisePayload = {
      revision: 1,
      option: "alternative",
      instructions: "Use a different template",
    };
    const revised = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/plan/revise`,
      revisePayload,
    );
    assert.equal(revised.status, 200);
    assert.equal(revised.body.messages[3].content.revision, 2);

    const confirmPayload = {
      revision: 2,
      option: "alternative",
    };
    const confirmed = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/plan/confirm`,
      confirmPayload,
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.revision, 2);

    const createRunPayload = {
      validation_mode: "strict",
      plan_option: "alternative",
    };
    const run = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/runs`,
      createRunPayload,
    );
    assert.equal(run.status, 201);
    assert.equal(run.body.run_id, "run_from_session_gateway");

    const confirmPatchPayload = { requested_by: "demo-user" };
    const confirmPatch = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/patches/patch_gateway_test/confirm`,
      confirmPatchPayload,
    );
    assert.equal(confirmPatch.status, 200);
    assert.equal(confirmPatch.body.patch.status, "applied");

    const rejectPatchPayload = { reason: "Wait for next pass." };
    const rejectPatch = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/patches/patch_gateway_test/reject`,
      rejectPatchPayload,
    );
    assert.equal(rejectPatch.status, 200);
    assert.equal(rejectPatch.body.patch.status, "rejected");

    const proposalPayload = {
      template_id: "gateway-template",
      inputs: {
        goal: "Draft proposal",
      },
    };
    const proposal = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals`,
      proposalPayload,
    );
    assert.equal(proposal.status, 201);
    assert.equal(proposal.body.proposal.proposal_id, "prop_gateway_test");

    const proposalList = await getJson(`${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals`);
    assert.equal(proposalList.status, 200);
    assert.equal(proposalList.body.items[0].proposal_id, "prop_gateway_test");

    const proposalDetail = await getJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test`,
    );
    assert.equal(proposalDetail.status, 200);
    assert.equal(proposalDetail.body.proposal.proposal_id, "prop_gateway_test");

    const assignmentPayload = {
      assignments: [
        {
          node_id: "node_backend",
          node_name: "Backend",
          subagent_profile_id: "backend",
          provider: null,
          model: "gateway-model",
          allowed_tools: [],
          allowed_skills: ["coding-agent"],
          input_context: null,
          output_contract: "Return a summary.",
          metadata: {},
        },
      ],
    };
    const assignmentUpdate = await patchJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/assignments`,
      assignmentPayload,
    );
    assert.equal(assignmentUpdate.status, 200);
    assert.equal(assignmentUpdate.body.proposal.assignments[0].model, "gateway-model");

    const proposalConfirmPayload = { confirmed_by: "tester" };
    const proposalConfirm = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/confirm`,
      proposalConfirmPayload,
    );
    assert.equal(proposalConfirm.status, 200);
    assert.equal(proposalConfirm.body.proposal.status, "confirmed");

    const proposalRejectPayload = { reason: "Need another route." };
    const proposalReject = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/reject`,
      proposalRejectPayload,
    );
    assert.equal(proposalReject.status, 200);
    assert.equal(proposalReject.body.proposal.status, "rejected");

    const proposalSupersedePayload = { reason: "Brief changed." };
    const proposalSupersede = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/supersede`,
      proposalSupersedePayload,
    );
    assert.equal(proposalSupersede.status, 201);
    assert.equal(proposalSupersede.body.superseded_proposal.status, "superseded");

    assert.equal(upstream.requests[0].path, "/api/sessions");
    assert.deepEqual(upstream.requests[0].body, createSessionPayload);
    assert.equal(upstream.requests[1].path, "/api/missions");
    assert.equal(upstream.requests[2].path, "/api/missions/sess_gateway_test");
    assert.equal(upstream.requests[3].path, "/api/sessions/sess_gateway_test/archive");
    assert.deepEqual(upstream.requests[3].body, archivePayload);
    assert.equal(upstream.requests[4].path, "/api/sessions/sess_gateway_test/unarchive");
    assert.deepEqual(upstream.requests[4].body, unarchivePayload);
    assert.equal(upstream.requests[5].path, "/api/sessions/sess_gateway_test/attachments");
    assert.deepEqual(upstream.requests[5].body, attachmentPayload);
    assert.equal(upstream.requests[6].path, "/api/sessions/sess_gateway_test/attachments");
    assert.equal(
      upstream.requests[7].path,
      "/api/sessions/sess_gateway_test/compare?left_revision=1&right_option=alternative",
    );
    assert.equal(upstream.requests[8].path, "/api/sessions/sess_gateway_test/messages");
    assert.deepEqual(upstream.requests[8].body, addMessagePayload);
    assert.equal(upstream.requests[9].path, "/api/sessions/sess_gateway_test/interventions");
    assert.deepEqual(upstream.requests[9].body, interventionPayload);
    assert.equal(upstream.requests[10].path, "/api/sessions/sess_gateway_test/dag-draft");
    assert.deepEqual(upstream.requests[10].body, draftPayload);
    assert.equal(upstream.requests[11].path, "/api/sessions/sess_gateway_test/plan");
    assert.deepEqual(upstream.requests[11].body, planPayload);
    assert.equal(upstream.requests[12].path, "/api/sessions/sess_gateway_test/plan/revise");
    assert.deepEqual(upstream.requests[12].body, revisePayload);
    assert.equal(upstream.requests[13].path, "/api/sessions/sess_gateway_test/plan/confirm");
    assert.deepEqual(upstream.requests[13].body, confirmPayload);
    assert.equal(upstream.requests[14].path, "/api/sessions/sess_gateway_test/runs");
    assert.deepEqual(upstream.requests[14].body, createRunPayload);
    assert.equal(
      upstream.requests[15].path,
      "/api/sessions/sess_gateway_test/patches/patch_gateway_test/confirm",
    );
    assert.deepEqual(upstream.requests[15].body, confirmPatchPayload);
    assert.equal(
      upstream.requests[16].path,
      "/api/sessions/sess_gateway_test/patches/patch_gateway_test/reject",
    );
    assert.deepEqual(upstream.requests[16].body, rejectPatchPayload);
    assert.equal(upstream.requests[17].path, "/api/sessions/sess_gateway_test/dag-proposals");
    assert.deepEqual(upstream.requests[17].body, proposalPayload);
    assert.equal(upstream.requests[18].path, "/api/sessions/sess_gateway_test/dag-proposals");
    assert.equal(
      upstream.requests[19].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test",
    );
    assert.equal(
      upstream.requests[20].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/assignments",
    );
    assert.deepEqual(upstream.requests[20].body, assignmentPayload);
    assert.equal(
      upstream.requests[21].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/confirm",
    );
    assert.deepEqual(upstream.requests[21].body, proposalConfirmPayload);
    assert.equal(
      upstream.requests[22].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/reject",
    );
    assert.deepEqual(upstream.requests[22].body, proposalRejectPayload);
    assert.equal(
      upstream.requests[23].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/supersede",
    );
    assert.deepEqual(upstream.requests[23].body, proposalSupersedePayload);
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("proxies session detail with stable MissionSpec contract metadata", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const detail = await getJson(`${server.baseUrl}/api/sessions/sess_gateway_test`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.session.session_id, "sess_gateway_test");
    assert.equal(detail.body.mission_spec.route.activeRevision, 1);
    assert.equal(detail.body.mission_snapshot.spec.revisionLineage.latestRevision, 1);
    assert.equal(detail.body.session.metadata.mission_route_state.active_revision, 1);
    assert.equal(
      detail.body.session.metadata.mission_revision_lineage.latest_revision,
      1,
    );
    assert.equal(upstream.requests[0].path, "/api/sessions/sess_gateway_test");
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("proxies session DAG proposal routes", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({
    controlPlaneBaseUrl: upstream.baseUrl,
  });

  try {
    const createPayload = {
      template_id: "gateway-template",
      inputs: {
        goal: "Plan through gateway",
      },
    };
    const created = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals`,
      createPayload,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.proposal.proposal_id, "prop_gateway_test");

    const listed = await getJson(`${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items[0].proposal_id, "prop_gateway_test");

    const fetched = await getJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test`,
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.proposal.status, "review_ready");

    const assignmentPayload = {
      assignments: [
        {
          node_id: "node_backend",
          node_name: "Backend",
          subagent_profile_id: "backend",
          provider: null,
          model: "claude-haiku-4-5",
          allowed_tools: ["read"],
          allowed_skills: ["coding-agent"],
          input_context: null,
          output_contract: null,
          metadata: {},
        },
      ],
    };
    const assignment = await patchJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/assignments`,
      assignmentPayload,
    );
    assert.equal(assignment.status, 200);
    assert.equal(assignment.body.proposal.assignments[0].model, "claude-haiku-4-5");

    const confirmPayload = { confirmed_by: "tester" };
    const confirmed = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/confirm`,
      confirmPayload,
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.proposal.status, "confirmed");

    const rejectPayload = { reason: "Needs a narrower route." };
    const rejected = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/reject`,
      rejectPayload,
    );
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.proposal.status, "rejected");

    const supersedePayload = { reason: "Updated brief", template_id: "gateway-template" };
    const superseded = await postJson(
      `${server.baseUrl}/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/supersede`,
      supersedePayload,
    );
    assert.equal(superseded.status, 201);
    assert.equal(superseded.body.proposal.proposal_id, "prop_gateway_replacement");

    assert.equal(upstream.requests[0].path, "/api/sessions/sess_gateway_test/dag-proposals");
    assert.deepEqual(upstream.requests[0].body, createPayload);
    assert.equal(upstream.requests[1].path, "/api/sessions/sess_gateway_test/dag-proposals");
    assert.equal(upstream.requests[2].path, "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test");
    assert.equal(
      upstream.requests[3].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/assignments",
    );
    assert.deepEqual(upstream.requests[3].body, assignmentPayload);
    assert.equal(
      upstream.requests[4].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/confirm",
    );
    assert.deepEqual(upstream.requests[4].body, confirmPayload);
    assert.equal(
      upstream.requests[5].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/reject",
    );
    assert.deepEqual(upstream.requests[5].body, rejectPayload);
    assert.equal(
      upstream.requests[6].path,
      "/api/sessions/sess_gateway_test/dag-proposals/prop_gateway_test/supersede",
    );
    assert.deepEqual(upstream.requests[6].body, supersedePayload);
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("gateway smoke covers planner preview strict block and explicit warn override", async () => {
  const controlPlaneHelpers = await loadControlPlaneTestHelpers();
  controlPlaneHelpers.resetTestRoot();
  process.env.MY_MATE_ENABLE_LOCAL_EXECUTION = "true";
  process.env.MY_MATE_EXECUTION_ADAPTER = "local";
  process.env.MY_MATE_AUTO_APPROVE_HUMAN_GATES = "false";
  process.env.MY_MATE_OPENCLAW_CALLBACK_TOKEN = "test-callback-token";

  controlPlaneHelpers.seedTemplate(
    controlPlaneHelpers.buildPublishedTemplate({
      template_id: "gateway-p0-smoke-template",
    }),
  );

  const controlPlane = await controlPlaneHelpers.startTestServer({
    executionAdapter: controlPlaneHelpers.createStubExecutionAdapter(),
  });
  const gateway = await startTestServer({
    controlPlaneBaseUrl: controlPlane.baseUrl,
  });
  let runId = "";

  try {
    const preview = await postJson(`${gateway.baseUrl}/api/planner/candidate-plan`, {
      intent: "Gateway smoke preview",
      template_id: "gateway-p0-smoke-template",
      inputs: {
        goal: "Verify strict block and warn override through gateway",
      },
    });

    assert.equal(preview.status, 200);
    assert.equal(preview.body.validation.passed, false);
    assert.ok(
      preview.body.validation.details.some(
        (detail: { code: string; category: string; node_id: string | null }) =>
          detail.code === "unknown_agent_profile" &&
          detail.category === "registry" &&
          detail.node_id === "node_backend",
      ),
    );
    assert.equal(preview.body.candidate_plan.run_id, "candidate_run");

    const strictCreate = await postJson(`${gateway.baseUrl}/api/runs`, {
      intent: "Gateway strict block",
      template_id: "gateway-p0-smoke-template",
      inputs: {
        goal: "Verify strict block and warn override through gateway",
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

    const warnCreate = await postJson(`${gateway.baseUrl}/api/runs`, {
      intent: "Gateway warn override",
      template_id: "gateway-p0-smoke-template",
      inputs: {
        goal: "Verify strict block and warn override through gateway",
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

    const createdRun = await getJson(`${gateway.baseUrl}/api/runs/${runId}`);
    assert.equal(createdRun.status, 200);
    assert.equal(createdRun.body.run_id, runId);
    assert.equal(createdRun.body.template_id, "gateway-p0-smoke-template");
  } finally {
    await gateway.close();
    await controlPlane.close();
    controlPlaneHelpers.cleanupTestArtifacts({
      templateId: "gateway-p0-smoke-template",
      runId,
    });
  }
});

test("proxies planner DAG draft requests", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const payload = {
      intent: "draft dag",
      inputs: { goal: "test" },
      max_agent_nodes: 2,
    };
    const response = await postJson(`${server.baseUrl}/api/planner/dag-draft`, payload);
    assert.equal(response.status, 200);
    assert.equal(response.body.draft_template.template_id, "planner-draft");
    assert.equal(upstream.requests[0].path, "/api/planner/dag-draft");
    assert.equal(upstream.requests[0].gatewayHeader, "api-gateway");
    assert.deepEqual(upstream.requests[0].body, payload);
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("proxies template versioning registry and orchestrator profile requests", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const derivePayload = {
      template_id: "template-derived",
      name: "Derived Template",
    };
    const derived = await postJson(
      `${server.baseUrl}/api/templates/template-source/derive`,
      derivePayload,
    );
    assert.equal(derived.status, 201);
    assert.equal(derived.body.template_id, "template-derived");

    const profiles = await getJson(`${server.baseUrl}/api/registry/agent-profiles`);
    assert.equal(profiles.status, 200);
    assert.equal(profiles.body.items[0].profile_id, "backend");

    const orchestrators = await getJson(`${server.baseUrl}/api/orchestrator-profiles`);
    assert.equal(orchestrators.status, 200);
    assert.equal(orchestrators.body.items[0].orchestrator_id, "studio-orchestrator");

    const orchestratorPayload = {
      orchestrator_id: "studio-coding-orchestrator",
      name: "Studio Coding Orchestrator",
    };
    const savedOrchestrator = await postJson(
      `${server.baseUrl}/api/orchestrator-profiles`,
      orchestratorPayload,
    );
    assert.equal(savedOrchestrator.status, 201);

    assert.equal(upstream.requests.at(-4)?.path, "/api/templates/template-source/derive");
    assert.deepEqual(upstream.requests.at(-4)?.body, derivePayload);
    assert.equal(upstream.requests.at(-3)?.path, "/api/registry/agent-profiles");
    assert.equal(upstream.requests.at(-2)?.path, "/api/orchestrator-profiles");
    assert.equal(upstream.requests.at(-1)?.path, "/api/orchestrator-profiles");
    assert.deepEqual(upstream.requests.at(-1)?.body, orchestratorPayload);
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("proxies runtime summary and session stream requests", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({ controlPlaneBaseUrl: upstream.baseUrl });

  try {
    const runtime = await getJson(`${server.baseUrl}/api/runtime/summary`);
    assert.equal(runtime.status, 200);
    assert.equal(runtime.body.execution_runtime.adapter_kind, "openclaw");

    const hosting = await getJson(`${server.baseUrl}/api/agents/hosting`);
    assert.equal(hosting.status, 200);
    assert.equal(hosting.body.profiles[0].profile_id, "backend");

    const update = await putJson(`${server.baseUrl}/api/agents/backend/hosting`, {
      openclaw_agent_id: "openclaw-backend-v2",
      provider: "openai",
      model: "gpt-5",
      runtime_mode: "bridge",
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.profile.openclaw_agent_id, "openclaw-backend-v2");

    const response = await fetch(`${server.baseUrl}/api/sessions/sess_gateway_test/stream`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    const text = await response.text();
    assert.match(text, /event: snapshot/);
    assert.match(text, /"session_id":"sess_gateway_test"/);

    assert.equal(upstream.requests.some((item) => item.path === "/api/runtime/summary"), true);
    assert.equal(upstream.requests.some((item) => item.path === "/api/agents/hosting"), true);
    assert.deepEqual(
      upstream.requests.find((item) => item.path === "/api/agents/backend/hosting")?.body,
      {
        openclaw_agent_id: "openclaw-backend-v2",
        provider: "openai",
        model: "gpt-5",
        runtime_mode: "bridge",
      },
    );
    assert.equal(
      upstream.requests.some((item) => item.path === "/api/sessions/sess_gateway_test/stream"),
      true,
    );
  } finally {
    await server.close();
    await upstream.close();
  }
});

test("blocks routes outside the gateway allowlist", async () => {
  const server = await startTestServer();
  try {
    const response = await getJson(`${server.baseUrl}/api/internal/openclaw/reports`);
    assert.equal(response.status, 404);
    assert.equal(response.body.code, "route_not_found");
  } finally {
    await server.close();
  }
});

test("enforces optional bearer token auth", async () => {
  const upstream = await startUpstreamServer();
  const server = await startTestServer({
    apiKey: "gateway-secret",
    controlPlaneBaseUrl: upstream.baseUrl,
  });

  try {
    const unauthorized = await getJson(`${server.baseUrl}/api/mobile/home`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.code, "unauthorized");

    const authorized = await getJson(`${server.baseUrl}/api/mobile/home`, {
      authorization: "Bearer gateway-secret",
    });
    assert.equal(authorized.status, 200);
    assert.equal(upstream.requests.length, 1);
  } finally {
    await server.close();
    await upstream.close();
  }
});
