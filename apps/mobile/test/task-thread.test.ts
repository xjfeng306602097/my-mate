import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComposerDirectiveChips,
  buildComposerDirectiveChipsV2,
  buildDagPatchReviewSummary,
  buildExecutionNarrative,
  buildExecutionNarrativeV2,
  buildMissionPipelines,
  buildMissionSnapshot,
  buildMissionSpecSummary,
  buildNarrativeSteps,
  buildOrchestratorBriefing,
  buildOrchestratorTurns,
  buildPlanOptionsNarrative,
  buildRouteCompareNarrative,
  buildRuntimeGraphNarrative,
  buildWorkspaceArtifactSurfaces,
  buildWorkPackages,
  deriveThreadOverview,
  extractPlanOptionContent,
  getConversationMessageText,
  projectThreadMessages,
  projectConversationMessages,
  summarizeValidationState,
} from "@/lib/task-thread";
import type {
  PlannerValidationResult,
  RunStatus,
  RuntimeGraphSummary,
  SessionDetailResponse,
  SessionMessageRecord,
  SessionStatus,
} from "@/lib/types";

const ISO = "2026-06-09T12:00:00.000Z";

function buildValidation(input: Partial<PlannerValidationResult>): PlannerValidationResult {
  return {
    passed: input.passed ?? true,
    warnings: input.warnings ?? [],
    details: input.details ?? [],
  };
}

function buildMessage(input: Partial<SessionMessageRecord> & Pick<SessionMessageRecord, "kind">): SessionMessageRecord {
  return {
    message_id: input.message_id || `${input.kind}-1`,
    session_id: input.session_id || "session-1",
    role: input.role || "orchestrator",
    kind: input.kind,
    content: input.content || {},
    created_at: input.created_at || "2026-06-09T12:00:00.000Z",
    linked_run_id: input.linked_run_id || null,
    linked_node_run_id: input.linked_node_run_id || null,
  };
}

function buildDetail(messages: SessionMessageRecord[]): SessionDetailResponse {
  return {
    session: {
      session_id: "session-1",
      title: "Thread",
      status: "planning",
      created_by: "tester",
      created_at: "2026-06-09T12:00:00.000Z",
      updated_at: "2026-06-09T12:01:00.000Z",
      current_goal: "Plan the task",
      current_plan_summary: null,
      latest_run_id: null,
      active_run_ids: [],
      archived: false,
      archived_at: null,
      archived_by: null,
      hidden: false,
      hidden_at: null,
      hidden_by: null,
      confirmed_plan_revision: null,
      confirmed_plan_option: null,
      message_count: messages.length,
    },
    messages,
    latest_run: null,
  };
}

test("summarizeValidationState detects strict-ready plans", () => {
  const summary = summarizeValidationState(
    buildValidation({
      passed: true,
      warnings: [],
    }),
  );

  assert.equal(summary.label, "Launch-ready");
  assert.equal(summary.tone, "success");
  assert.equal(summary.isReadyForStrictRun, true);
});

test("summarizeValidationState distinguishes registry blockers", () => {
  const summary = summarizeValidationState(
    buildValidation({
      passed: false,
      warnings: ["Node Research uses unknown skill: web.search"],
      details: [
        {
          code: "unknown_skill",
          category: "registry",
          message: "Node Research uses unknown skill: web.search",
          field: null,
          node_id: "node_research",
          node_name: "Research",
          agent_profile_id: "research-agent",
          skill_id: "web.search",
        },
      ],
    }),
  );

  assert.equal(summary.label, "Agent binding risk");
  assert.equal(summary.tone, "warn");
  assert.equal(summary.hasRegistryRisk, true);
  assert.equal(summary.isReadyForStrictRun, false);
});

test("deriveThreadOverview prioritizes pending approvals", () => {
  const messages = [
    buildMessage({
      kind: "approval_card",
      content: {
        approval_id: "approval-1",
        summary: "Approve the outbound message",
      },
    }),
  ];
  const detail = buildDetail(messages);

  const overview = deriveThreadOverview(detail, messages);
  assert.equal(overview.stageLabel, "Waiting on you");
  assert.match(overview.headline, /approval/i);
  assert.equal(overview.pendingApprovalCount, 1);
  assert.equal(overview.autoRefreshRecommended, true);
});

test("deriveThreadOverview marks confirmed risky plans as not ready", () => {
  const planMessage = buildMessage({
    kind: "plan_options_card",
    content: {
      revision: 2,
      primary: {
        template_id: "template-1",
        validation: buildValidation({
          passed: false,
          warnings: ["Missing required input: owner"],
          details: [
            {
              code: "missing_required_input",
              category: "required_input",
              message: "Missing required input: owner",
              field: "owner",
              node_id: null,
              node_name: null,
              agent_profile_id: null,
              skill_id: null,
            },
          ],
        }),
      },
    },
  });

  const detail = {
    ...buildDetail([planMessage]),
    session: {
      ...buildDetail([planMessage]).session,
      status: "ready_to_run" as SessionStatus,
      confirmed_plan_revision: 2,
      confirmed_plan_option: "primary" as const,
    },
  };

  const overview = deriveThreadOverview(detail, [planMessage]);
  assert.equal(overview.stageLabel, "Route confirmed");
  assert.match(overview.headline, /execution risk/i);
  assert.match(overview.detail, /missing inputs/i);
  assert.equal(overview.autoRefreshRecommended, false);
});

test("deriveThreadOverview keeps auto refresh on while a queued or paused run is still linked", () => {
  const base = buildDetail([]);
  const detail = {
    ...base,
    session: {
      ...base.session,
      status: "failed" as SessionStatus,
      latest_run_id: "run-live",
      workspace_state: {
        ...(base.session.workspace_state || {}),
        run_status: "queued",
      },
    },
    latest_run: {
      ...(base.latest_run || {
        run_id: "run-live",
        template_id: "template-live",
        template_version: 1,
        workspace_id: "default",
        requested_by: "demo-user",
        intent: "Queued run",
        status: "queued" as RunStatus,
        current_summary: "Queued",
        waiting_reason: null,
        blocked_reason: null,
        started_at: null,
        finished_at: null,
        last_event_id: null,
        created_at: ISO,
        updated_at: ISO,
        inputs: {},
      }),
      run_id: "run-live",
      status: "queued" as RunStatus,
    },
  };

  const overview = deriveThreadOverview(detail, []);
  assert.equal(overview.autoRefreshRecommended, true);
});

test("deriveThreadOverview surfaces stale route after the brief changes", () => {
  const planMessage = buildMessage({
    kind: "plan_options_card",
    content: {
      revision: 2,
      primary: {
        template_id: "template-1",
        validation: buildValidation({
          passed: true,
          warnings: [],
        }),
      },
    },
  });

  const detail = {
    ...buildDetail([planMessage]),
    session: {
      ...buildDetail([planMessage]).session,
      workspace_state: {
        plan_stale: true,
        has_active_plan: true,
        stale_reason: "The latest note changed the brief after the plan was generated.",
        next_recommended_label: "Revise the route",
        next_recommended_detail: "Refresh the plan so it matches the updated brief.",
      },
    },
  };

  const overview = deriveThreadOverview(detail, [planMessage]);
  assert.equal(overview.stageLabel, "Route stale");
  assert.match(overview.headline, /no longer matches|stale/i);
  assert.match(overview.nextStepLabel, /revise/i);
});

test("extractPlanOptionContent returns alternative option payload", () => {
  const message = buildMessage({
    kind: "plan_options_card",
    content: {
      revision: 1,
      primary: {
        template_id: "template-primary",
      },
      alternative: {
        template_id: "template-alt",
      },
    },
  });

  const content = extractPlanOptionContent(message, "alternative");
  assert.equal(content?.template_id, "template-alt");
});

test("buildNarrativeSteps summarizes completed execution as a narrative", () => {
  const messages = [
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 1,
        primary: {
          template_id: "template-primary",
        },
      },
    }),
    buildMessage({
      kind: "run_card",
      content: {
        run_id: "run-1",
        status: "queued",
        plan_revision: 1,
      },
    }),
    buildMessage({
      kind: "summary_card",
      content: {
        run_id: "run-1",
        status: "completed",
        current_summary: "Run completed",
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      status: "completed" as SessionStatus,
      latest_run_id: "run-1",
    },
  };

  const steps = buildNarrativeSteps(detail, messages);
  assert.equal(steps.length, 4);
  assert.match(steps[2].detail, /finished successfully/i);
  assert.equal(steps[2].tone, "success");
  assert.equal(steps[3].status, "done");
});

test("buildOrchestratorBriefing explains confirmed ready-to-run state", () => {
  const messages = [
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 3,
        selected_option: "primary",
        primary: {
          template_id: "template-primary",
          template_name: "Primary template",
          recommendation_reason: "Best match for the task intent.",
          validation: buildValidation({
            passed: true,
            warnings: [],
          }),
        },
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      status: "ready_to_run" as SessionStatus,
      confirmed_plan_revision: 3,
      confirmed_plan_option: "primary" as const,
    },
  };

  const briefing = buildOrchestratorBriefing(detail, messages);
  assert.match(briefing.title, /confirmed execution path/i);
  assert.equal(briefing.tone, "success");
  assert.match(briefing.items[0].detail, /primary template/i);
});

test("buildOrchestratorBriefing prioritizes stale route guidance", () => {
  const planMessage = buildMessage({
    kind: "plan_options_card",
    content: {
      revision: 1,
      primary: {
        template_id: "template-primary",
        template_name: "Primary template",
        validation: buildValidation({
          passed: true,
          warnings: [],
        }),
      },
    },
  });
  const detail = {
    ...buildDetail([planMessage]),
    session: {
      ...buildDetail([planMessage]).session,
      workspace_state: {
        working_goal: "Plan the task",
        plan_stale: true,
        has_active_plan: true,
        stale_reason: "The task framing changed after the route was generated.",
        next_recommended_detail: "Revise the route before confirming it.",
      },
    },
  };

  const briefing = buildOrchestratorBriefing(detail, [planMessage]);
  assert.match(briefing.title, /stale/i);
  assert.equal(briefing.tone, "warn");
  assert.match(briefing.items[2].detail, /revise/i);
});

test("buildExecutionNarrative compresses live run and completion beats", () => {
  const messages = [
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 2,
        primary: {
          template_id: "template-primary",
        },
      },
    }),
    buildMessage({
      kind: "run_card",
      content: {
        run_id: "run-2",
        status: "running",
        plan_revision: 2,
        plan_option: "primary",
      },
    }),
    buildMessage({
      kind: "subtask_card",
      content: {
        node_name: "Research",
        status: "running",
        progress: {
          percent: 60,
          message: "Collecting references",
          updated_at: "2026-06-09T12:05:00.000Z",
        },
      },
    }),
    buildMessage({
      kind: "summary_card",
      content: {
        run_id: "run-2",
        status: "completed",
        current_summary: "Run completed with a final report.",
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      status: "completed" as SessionStatus,
      latest_run_id: "run-2",
      confirmed_plan_revision: 2,
      confirmed_plan_option: "primary" as const,
    },
  };

  const beats = buildExecutionNarrative(detail, messages);
  assert.ok(beats.length >= 3);
  assert.match(beats[0].title, /locked the execution source/i);
  assert.match(beats[1].detail, /run-2/i);
  assert.match(beats[beats.length - 1].title, /closed the run successfully/i);
});

test("buildPlanOptionsNarrative summarizes primary and alternative plans", () => {
  const message = buildMessage({
    kind: "plan_options_card",
    content: {
      revision: 5,
      selected_option: "primary",
      primary: {
        template_id: "template-primary",
        template_name: "Primary route",
        recommendation_reason: "Best fit for the main objective.",
        candidate_plan: {
          compiled_nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
          frontier: ["a"],
        },
        confirmation_checklist: {
          revision: 5,
          ready_frontier_count: 1,
          node_count: 3,
        },
        validation: buildValidation({
          passed: true,
          warnings: [],
        }),
      },
      alternative: {
        template_id: "template-alt",
        template_name: "Alternative route",
        recommendation_reason: "Backup if the main route is too heavy.",
        candidate_plan: {
          compiled_nodes: [{ id: "x" }],
          frontier: ["x"],
        },
        confirmation_checklist: {
          revision: 5,
          ready_frontier_count: 1,
          node_count: 1,
        },
        validation: buildValidation({
          passed: false,
          warnings: ["Missing required input: audience"],
          details: [
            {
              code: "missing_required_input",
              category: "required_input",
              message: "Missing required input: audience",
              field: "audience",
              node_id: null,
              node_name: null,
              agent_profile_id: null,
              skill_id: null,
            },
          ],
        }),
      },
    },
  });

  const narrative = buildPlanOptionsNarrative({
    message,
    confirmedPlanRevision: 5,
    confirmedPlanOption: "primary",
    activeReviseTarget: null,
  });

  assert.equal(narrative?.revision, 5);
  assert.match(narrative?.comparisonSummary || "", /Primary route/i);
  assert.equal(narrative?.summaries.length, 2);
  assert.equal(narrative?.summaries[0].nodeCount, 3);
});

test("buildRouteCompareNarrative summarizes compare recommendation and changed groups", () => {
  const narrative = buildRouteCompareNarrative({
    sessionId: "session-1",
    comparisonKind: "option",
    left: {
      revision: 1,
      option: "primary",
      messageId: "plan-1",
      templateId: "template-primary",
      templateName: "Primary route",
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
      messageId: "plan-1",
      templateId: "template-alt",
      templateName: "Alternative route",
      nodeCount: 2,
      edgeCount: 1,
      approvalGateCount: 1,
      outputCount: 2,
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
      added: ["review-notes"],
      removed: [],
      changed: [],
      unchangedCount: 1,
    },
    changedRisks: {
      added: ["Review required before launch."],
      removed: [],
      changed: [],
      unchangedCount: 0,
    },
    summaryLines: [
      "Comparing v1 / primary against v1 / alternative.",
      "Approval and human gates: 1 added.",
    ],
    recommendation: {
      label: "Review gate changes",
      detail: "The route changes human approval or input gates.",
      tone: "warn",
    },
  });

  assert.equal(narrative?.title, "Primary versus alternative route");
  assert.equal(narrative?.tone, "warn");
  assert.equal(narrative?.leftLabel, "v1 / primary");
  assert.equal(narrative?.rightLabel, "v1 / alternative");
  assert.ok(narrative?.groups.some((group) => group.key === "approvals" && group.count === 1));
  assert.ok(narrative?.groups.some((group) => group.key === "outputs" && group.items[0] === "Added review-notes"));
});

test("buildRuntimeGraphNarrative summarizes live frontier and human gates", () => {
  const graph: RuntimeGraphSummary = {
    runId: "run-graph",
    templateId: "template-graph",
    templateVersion: 1,
    runStatus: "running",
    intent: "Write launch plan",
    generatedAt: ISO,
    nodes: [
      {
        nodeRunId: "node-research-run",
        nodeId: "node_research",
        name: "Research context",
        type: "task",
        status: "running",
        progress: {
          percent: 45,
          message: "Collecting constraints",
          updated_at: ISO,
        },
        attempt: 1,
        startedAt: ISO,
        finishedAt: null,
        agentProfile: "research-agent",
        openclawAgentId: null,
        approvalKind: null,
        humanInputRequired: false,
        expectedArtifacts: [],
        workPackageKey: "research",
        workPackageLabel: "Context collection",
        markers: ["active_frontier"],
      },
      {
        nodeRunId: "node-review-run",
        nodeId: "node_review",
        name: "Review plan",
        type: "approval",
        status: "waiting_human",
        progress: {
          percent: 0,
          message: "Waiting for approval",
          updated_at: ISO,
        },
        attempt: 1,
        startedAt: null,
        finishedAt: null,
        agentProfile: null,
        openclawAgentId: null,
        approvalKind: "human_review",
        humanInputRequired: false,
        expectedArtifacts: [],
        workPackageKey: "review",
        workPackageLabel: "Review and approval",
        markers: ["waiting_human", "approval_gate"],
      },
    ],
    edges: [
      {
        fromNodeId: "node_research",
        toNodeId: "node_review",
        fromNodeRunId: "node-research-run",
        toNodeRunId: "node-review-run",
        label: null,
        condition: null,
        status: "active",
      },
    ],
    frontier: ["node-research-run"],
    statusCounts: {
      pending: 0,
      ready: 0,
      running: 1,
      waiting_human: 1,
      completed: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    },
    markers: {
      activeFrontier: ["node-research-run"],
      waitingHuman: ["node-review-run"],
      blocked: [],
      skipped: [],
    },
    workPackages: [
      {
        key: "research",
        label: "Context collection",
        nodeRunIds: ["node-research-run"],
        status: "active",
        readyCount: 0,
        activeCount: 1,
        completedCount: 0,
        blockedCount: 0,
      },
      {
        key: "review",
        label: "Review and approval",
        nodeRunIds: ["node-review-run"],
        status: "blocked",
        readyCount: 0,
        activeCount: 1,
        completedCount: 0,
        blockedCount: 1,
      },
    ],
    summaryLines: [
      "2 node(s), 1 edge(s), 2 work package(s).",
      "1 node(s) are currently in the active frontier.",
      "1 node(s) are waiting on human approval or input.",
    ],
  };

  const narrative = buildRuntimeGraphNarrative(graph);

  assert.equal(narrative?.tone, "warn");
  assert.match(narrative?.title || "", /attention/i);
  assert.deepEqual(narrative?.activeNodeLabels, ["Research context", "Review plan"]);
  assert.deepEqual(narrative?.blockedNodeLabels, ["Review plan"]);
  assert.deepEqual(narrative?.packageLabels, ["Context collection", "Review and approval"]);
});

test("buildExecutionNarrativeV2 emits ordered run events", () => {
  const messages = [
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 2,
        primary: {
          template_id: "template-primary",
        },
      },
    }),
    buildMessage({
      kind: "run_card",
      content: {
        run_id: "run-2",
        status: "running",
        plan_revision: 2,
        plan_option: "primary",
      },
    }),
    buildMessage({
      kind: "subtask_card",
      content: {
        node_run_id: "node-1",
        node_name: "Collect Context",
        status: "running",
        progress: {
          percent: 40,
          message: "Gathering inputs",
          updated_at: "2026-06-09T12:05:00.000Z",
        },
      },
    }),
    buildMessage({
      kind: "approval_card",
      content: {
        approval_id: "approval-1",
        summary: "Approve this step",
      },
    }),
    buildMessage({
      kind: "summary_card",
      content: {
        run_id: "run-2",
        status: "completed",
        current_summary: "Run completed",
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      status: "completed" as SessionStatus,
      latest_run_id: "run-2",
      confirmed_plan_revision: 2,
      confirmed_plan_option: "primary" as const,
    },
  };

  const beats = buildExecutionNarrativeV2(detail, messages);
  assert.ok(beats.some((beat) => beat.title.includes("Opened a real run")));
  assert.ok(beats.some((beat) => beat.title.includes("Collect Context")));
  assert.ok(beats.some((beat) => beat.title.includes("Paused at an approval gate")));
  assert.match(beats[beats.length - 1].title, /Closed the run successfully/i);
});

test("buildOrchestratorTurns produces a continuous orchestration storyline", () => {
  const messages = [
    buildMessage({
      kind: "draft_card",
      content: {
        intent: "Research and summarize a topic",
        planner_context: {
          draft_strategy: "intent_to_template",
        },
        draft_template: {
          template_id: "draft-template",
          name: "Draft route",
          nodes: [{ id: "n1" }, { id: "n2" }],
        },
      },
    }),
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 3,
        selected_option: "primary",
        primary: {
          template_id: "template-primary",
        },
      },
    }),
    buildMessage({
      kind: "run_card",
      content: {
        run_id: "run-3",
        status: "running",
        plan_revision: 3,
      },
    }),
    buildMessage({
      kind: "subtask_card",
      content: {
        node_name: "Collect Context",
        status: "running",
        progress: {
          percent: 50,
          message: "Collecting source references",
          updated_at: "2026-06-09T12:05:00.000Z",
        },
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      status: "running" as SessionStatus,
      confirmed_plan_revision: 3,
      confirmed_plan_option: "primary" as const,
    },
  };

  const turns = buildOrchestratorTurns(detail, messages);
  assert.ok(turns.length >= 4);
  assert.equal(turns[0].phase, "understand");
  assert.ok(turns.some((turn) => turn.phase === "compare"));
  assert.ok(turns.some((turn) => turn.phase === "execute"));
});

test("buildOrchestratorTurns uses intent-aware titles for structured turns", () => {
  const messages = [
    buildMessage({
      message_id: "turn-1",
      kind: "orchestrator_turn",
      role: "orchestrator",
      content: {
        intent: "add_constraint",
        summary: "I absorbed this as a task constraint and updated the current working brief.",
      },
    }),
    buildMessage({
      message_id: "turn-2",
      kind: "orchestrator_turn",
      role: "orchestrator",
      created_at: "2026-06-09T12:01:00.000Z",
      content: {
        intent: "ask_plan",
        auto_transition: "plan",
        summary: "I understood this as a request to turn the current task into full plan options.",
      },
    }),
  ];
  const detail = buildDetail(messages);

  const turns = buildOrchestratorTurns(detail, messages);
  assert.equal(turns[0]?.title, "Tightened the working brief");
  assert.equal(turns[1]?.title, "Shifted the mission into route comparison");
  assert.equal(turns[1]?.phase, "compare");
});

test("buildOrchestratorTurns keeps structured readback and generated outputs", () => {
  const messages = [
    buildMessage({
      message_id: "turn-rich",
      kind: "orchestrator_turn",
      role: "orchestrator",
      content: {
        intent: "ask_plan",
        auto_transition: "plan",
        summary: 'I read this as a request to compile full plan options from "Turn this into an execution plan".',
        user_read: "You want the current brief compiled into comparable route options.",
        workspace_impact: "The workspace is moving from task framing into plan comparison.",
        next_action_label: "Create plan options",
        next_action_detail: "Compile a primary route and a backup route from the current brief.",
        generated_outputs: [
          "Working goal: Turn this into an execution plan",
          "Workspace stage: briefing",
          "Requested output: plan options",
        ],
      },
    }),
  ];
  const detail = buildDetail(messages);

  const turns = buildOrchestratorTurns(detail, messages);
  assert.equal(turns[0]?.userRead, "You want the current brief compiled into comparable route options.");
  assert.equal(turns[0]?.workspaceImpact, "The workspace is moving from mission framing into route comparison.");
  assert.equal(turns[0]?.nextActionLabel, "Create route options");
  assert.equal(turns[0]?.generatedOutputs[0], "Working goal: Turn this into an execution plan");
  assert.equal(turns[0]?.generatedOutputs[2], "Requested output: plan options");
});

test("buildWorkspaceArtifactSurfaces exposes brief route decision and outputs layers", () => {
  const messages = [
    buildMessage({
      kind: "goal_update_card",
      content: {
        working_goal: "Prepare a partner recovery plan",
        constraints_summary: "Keep it concise",
        open_questions: ["Should the route draft first?"],
      },
    }),
    buildMessage({
      kind: "decision_card",
      content: {
        pending_decision: "Turn the current brief into an initial DAG before comparing full plan options.",
      },
    }),
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 2,
        selected_option: "primary",
        primary: {
          template_id: "template-primary",
          template_name: "Primary route",
          recommendation_reason: "Safest route for the current task.",
          validation: {
            ready_for_strict_run: true,
            warning_count: 0,
            warnings: [],
          },
          candidate_plan: {
            compiled_nodes: [
              { node_id: "n1", name: "Collect Context", status: "ready", agent_profile: "research-agent" },
            ],
            ready_frontier: [{ node_id: "n1" }],
          },
        },
      },
    }),
    buildMessage({
      kind: "summary_card",
      content: {
        status: "running",
        current_summary: "Runtime state is being written back into the thread.",
      },
    }),
  ];
  const detail = buildDetail(messages);

  const surfaces = buildWorkspaceArtifactSurfaces(detail, messages);
  assert.equal(surfaces.length, 4);
  assert.equal(surfaces[0]?.title, "Working brief");
  assert.match(surfaces[0]?.summary || "", /Prepare a partner recovery plan/i);
  assert.equal(surfaces[1]?.title, "Route model");
  assert.match(surfaces[2]?.summary || "", /current recommended route|decision surface|comparison/i);
  assert.equal(surfaces[3]?.title, "Generated outputs");
});

test("buildMissionSpecSummary projects objective constraints outputs and questions", () => {
  const messages = [
    buildMessage({
      kind: "goal_update_card",
      content: {
        working_goal: "Prepare a recovery mission for the partner account",
        constraints_summary: "Keep the first pass concise",
        open_questions: ["Should legal review be included?"],
      },
    }),
    buildMessage({
      kind: "decision_card",
      content: {
        pending_decision: "Decide whether to draft first or go straight into route comparison.",
      },
    }),
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 1,
        primary: {
          template_id: "template-primary",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "n1",
                name: "Collect Context",
                status: "ready",
                output_contract: {
                  expected_artifacts: ["research-notes", "summary-draft"],
                },
              },
            ],
          },
        },
      },
    }),
  ];
  const detail = buildDetail(messages);

  const spec = buildMissionSpecSummary(detail, messages);

  assert.equal(spec.objective, "Prepare a recovery mission for the partner account");
  assert.deepEqual(spec.constraints, ["Keep the first pass concise"]);
  assert.deepEqual(spec.requestedOutputs, ["research-notes", "summary-draft"]);
  assert.deepEqual(spec.openQuestions, ["Should legal review be included?"]);
  assert.match(spec.decisionFocus || "", /draft first|route comparison/i);
  assert.equal(spec.route.activeRevision, 1);
  assert.equal(spec.route.activeOption, "primary");
  assert.equal(spec.route.latestRevision, 1);
  assert.equal(spec.route.selectedTemplateId, "template-primary");
  assert.equal(spec.route.alternativeAvailable, false);
  assert.equal(spec.pipelineSummary.total, 1);
  assert.equal(spec.pipelineSummary.ready, 1);
  assert.ok(spec.checkpointSummary.labels.includes("Route comparison"));
  assert.equal(spec.revisionLineage.latestRevision, 1);
  assert.equal(spec.revisionLineage.sourceRevision, null);
});

test("buildMissionPipelines reuses compiled work packages as mission pipelines", () => {
  const messages = [
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 2,
        selected_option: "primary",
        primary: {
          template_id: "template-primary",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "node_research",
                name: "Collect Context",
                status: "ready",
                agent_profile: "research-agent",
                allowed_tools: ["web"],
                output_contract: {
                  expected_artifacts: ["research-notes"],
                },
              },
              {
                node_id: "node_review",
                name: "Review Gate",
                status: "pending",
                approval_kind: "human_review",
                agent_profile: "review-agent",
              },
            ],
          },
        },
      },
    }),
  ];
  const detail = buildDetail(messages);

  const pipelines = buildMissionPipelines(detail, messages);

  assert.ok(pipelines.length >= 2);
  assert.equal(pipelines[0]?.title, "Context collection");
  assert.ok(pipelines.some((item) => item.title === "Review and approval"));
});

test("buildMissionSnapshot assembles mission-first workspace state", () => {
  const messages = [
    buildMessage({
      kind: "text",
      role: "user",
      content: {
        text: "Create a partner recovery mission and keep the first pass concise.",
      },
    }),
    buildMessage({
      kind: "orchestrator_turn",
      role: "orchestrator",
      content: {
        intent: "ask_plan",
        auto_transition: "plan",
        summary: "I mapped the mission into comparable route options.",
        user_read: "You want a recovery mission with a concise first pass.",
        next_action_label: "Compare routes",
        next_action_detail: "Review the primary route against the alternate route.",
      },
    }),
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 4,
        selected_option: "primary",
        primary: {
          template_id: "template-primary",
          template_name: "Primary route",
          validation: buildValidation({
            passed: true,
            warnings: [],
          }),
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "n1",
                name: "Collect Context",
                status: "ready",
                agent_profile: "research-agent",
                allowed_tools: ["web"],
                output_contract: {
                  expected_artifacts: ["research-notes"],
                },
              },
            ],
            frontier: ["n1"],
          },
        },
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      title: "Partner Recovery Mission",
      workspace_state: {
        working_goal: "Prepare a partner recovery mission",
        next_recommended_label: "Compare routes",
        next_recommended_detail: "Review the primary route and confirm the launch path.",
        active_plan_revision: 4,
        active_plan_option: "primary",
      },
    },
  };

  const mission = buildMissionSnapshot(detail, messages);

  assert.equal(mission.missionTitle, "Partner Recovery Mission");
  assert.equal(mission.workspace_contract_version, 0);
  assert.equal(mission.objective, "Prepare a partner recovery mission");
  assert.equal(mission.nextActionLabel, "Compare routes");
  assert.equal(mission.activeRouteRevision, 4);
  assert.equal(mission.activeRouteOption, "primary");
  assert.ok(mission.stages.some((stage) => stage.key === "plan" && /Route revision v4/i.test(stage.title)));
  assert.ok(mission.pipelines.some((pipeline) => pipeline.title === "Context collection"));
  assert.ok(mission.checkpoints.some((checkpoint) => checkpoint.label === "Route comparison"));
  assert.deepEqual(mission.pipelines[0]?.outputKeys, ["research-notes"]);
  assert.ok(mission.pipelines[0]?.checkpointKeys.includes("route-compiled"));
  assert.equal(mission.pipelines[0]?.nextActionLabel, "Track execution");
  assert.equal(
    mission.checkpoints.find((checkpoint) => checkpoint.key === "route-compiled")?.type,
    "route",
  );
  assert.deepEqual(
    mission.workspaceSections.map((section) => section.key),
    [
      "objective",
      "route",
      "work_packages",
      "checkpoints",
      "outputs",
      "pending_decisions",
      "execution_summary",
      "evidence_summary",
    ],
  );
  assert.equal(mission.outputs[0]?.title, "research-notes");
  assert.equal(mission.outputs[0]?.status, "prepared");
  assert.equal(mission.outputs[0]?.stageKey, "execution");
  assert.deepEqual(mission.outputs[0]?.relatedCheckpointKeys, ["route-compiled", "runtime-state"]);
  assert.equal(mission.outputs[0]?.currentActionLabel, "Track output");
  assert.ok((mission.outputs[0]?.history.length || 0) >= 2);
  assert.deepEqual(mission.conversationRail.responsibilities, [
    "intent_record",
    "orchestrator_explanation",
    "decision_record",
    "audit_trail",
  ]);
  assert.equal(mission.evidenceSummary.defaultState, "collapsed");
  assert.equal(mission.rawCardPolicy.role, "secondary_audit");
  assert.equal(mission.rawCardPolicy.defaultState, "collapsed");
  assert.equal(mission.workspaceSections.find((section) => section.key === "outputs")?.itemCount, 1);
});

test("buildMissionSnapshot keeps draft stage mission-first instead of foregrounding template names", () => {
  const messages = [
    buildMessage({
      kind: "text",
      role: "user",
      content: {
        text: "Prepare a concise partner recovery mission.",
      },
    }),
    buildMessage({
      kind: "draft_card",
      content: {
        intent: "Prepare a concise partner recovery mission.",
        draft_template: {
          template_id: "draft-template",
          name: "Acceptance Phone Collaboration Demo Planned Variant",
          nodes: [{ node_id: "n1" }, { node_id: "n2" }],
        },
        planner_context: {
          draft_strategy: "registry_synthesis",
        },
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      workspace_state: {
        draft_template_name: "Acceptance Phone Collaboration Demo Planned Variant",
        draft_node_count: 2,
      },
    },
  };

  const mission = buildMissionSnapshot(detail, messages);
  assert.equal(mission.workspace_contract_version, 0);
  const planStage = mission.stages.find((stage) => stage.key === "plan");

  assert.equal(planStage?.title, "Draft workflow shape is ready");
  assert.doesNotMatch(planStage?.title || "", /Acceptance Phone Collaboration Demo/i);
});

test("buildOrchestratorTurns surfaces an unanswered user instruction", () => {
  const messages = [
    buildMessage({
      message_id: "plan-1",
      kind: "plan_options_card",
      created_at: "2026-06-09T12:00:00.000Z",
      content: {
        revision: 1,
        selected_option: "primary",
        primary: {
          template_id: "template-primary",
        },
      },
    }),
    buildMessage({
      message_id: "user-latest",
      kind: "text",
      role: "user",
      created_at: "2026-06-09T12:01:00.000Z",
      content: {
        text: "Make this plan parallel and add a review gate.",
      },
    }),
  ];
  const detail = buildDetail(messages);

  const turns = buildOrchestratorTurns(detail, messages);
  const latestInstruction = turns.find((turn) => turn.key === "latest-instruction-user-latest");

  assert.equal(latestInstruction?.status, "active");
  assert.equal(latestInstruction?.phase, "compare");
  assert.match(latestInstruction?.detail || "", /revision guidance/i);
});

test("buildWorkPackages derives grouped work surfaces from compiled nodes", () => {
  const messages = [
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 2,
        selected_option: "primary",
        primary: {
          template_id: "template-primary",
          template_name: "Primary route",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "node_research",
                name: "Collect Context",
                status: "ready",
                agent_profile: "research-agent",
                allowed_tools: ["web", "read"],
                output_contract: {
                  expected_artifacts: ["research-notes"],
                },
              },
              {
                node_id: "node_write",
                name: "Draft Summary",
                status: "pending",
                agent_profile: "writer-agent",
                allowed_tools: ["read", "write"],
                output_contract: {
                  expected_artifacts: ["summary-draft"],
                },
              },
              {
                node_id: "node_review",
                name: "Phone Review Gate",
                status: "pending",
                agent_profile: "review-agent",
                approval_kind: "human_review",
                allowed_tools: ["read"],
              },
            ],
          },
        },
      },
    }),
  ];
  const detail = buildDetail(messages);

  const packages = buildWorkPackages(detail, messages);
  assert.ok(packages.length >= 3);
  assert.equal(packages[0].title, "Context collection");
  assert.ok(packages.some((item) => item.title === "Draft assembly"));
  assert.ok(packages.some((item) => item.title === "Review and approval"));
});

test("buildComposerDirectiveChips recommends compare plans before confirmation", () => {
  const messages = [
    buildMessage({
      kind: "draft_card",
      content: {
        intent: "Research and summarize a market",
      },
    }),
  ];
  const detail = buildDetail(messages);

  const chips = buildComposerDirectiveChips(detail, messages);
  const recommended = chips.find((chip) => chip.recommended);
  assert.equal(recommended?.key, "compare-plans");
  assert.ok(chips.some((chip) => chip.key === "parallelize"));
});

test("buildComposerDirectiveChipsV2 returns readable orchestration directives", () => {
  const messages = [
    buildMessage({
      kind: "draft_card",
      content: {
        intent: "Research and summarize a market",
      },
    }),
  ];
  const detail = buildDetail(messages);

  const chips = buildComposerDirectiveChipsV2(detail, messages);

  assert.equal(chips.find((chip) => chip.recommended)?.key, "compare-plans");
  assert.ok(chips.some((chip) => chip.label === "Draft DAG"));
  assert.ok(chips.some((chip) => chip.instruction.includes("complete route options")));
});

test("buildComposerDirectiveChipsV2 recommends next-pass capture during live execution", () => {
  const detail = {
    ...buildDetail([]),
    session: {
      ...buildDetail([]).session,
      status: "running" as SessionStatus,
    },
  };

  const chips = buildComposerDirectiveChipsV2(detail, []);
  const recommended = chips.find((chip) => chip.recommended);
  assert.equal(recommended?.key, "capture-next-pass");
});

test("buildExecutionNarrativeV2 surfaces recorded runtime interventions", () => {
  const messages = [
    buildMessage({
      kind: "intervention_card",
      content: {
        intervention_id: "int-1",
        kind: "pause_request",
        status: "needs_review",
        summary: "Pause before final delivery and add one review step",
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      status: "running" as SessionStatus,
      latest_run_id: "run-1",
    },
  };

  const beats = buildExecutionNarrativeV2(detail, messages);

  assert.ok(beats.some((beat) => beat.key === "intervention-int-1"));
  assert.ok(beats.some((beat) => /runtime intervention/i.test(beat.title)));
  assert.ok(beats.some((beat) => /auditable runtime patch/i.test(beat.detail)));
});

test("buildExecutionNarrativeV2 surfaces DAG patch proposals separately from intervention records", () => {
  const messages = [
    buildMessage({
      kind: "dag_patch_card",
      content: {
        patch_id: "patch-1",
        status: "needs_confirmation",
        summary: "Proposed patch for runtime intervention: add a review step",
        operations: [
          {
            op: "add_node",
            node_name: "Draft Summary",
            reason: "Insert a new work step that captures the requested additional work.",
            supported: true,
          },
        ],
        apply_supported: true,
        unsupported_reason: null,
      },
    }),
  ];
  const detail = buildDetail(messages);

  const beats = buildExecutionNarrativeV2(detail, messages);

  assert.ok(beats.some((beat) => beat.key === "dag-patch-patch-1"));
  assert.ok(beats.some((beat) => /runtime DAG change/i.test(beat.title)));
  assert.ok(beats.some((beat) => /add node/i.test(beat.detail)));
  assert.ok(beats.some((beat) => /apply-ready after human confirmation/i.test(beat.detail)));
});

test("buildExecutionNarrativeV2 summarizes applied DAG patch outcomes", () => {
  const messages = [
    buildMessage({
      kind: "dag_patch_card",
      content: {
        patch_id: "patch-applied-1",
        status: "applied",
        summary: "Proposed patch for runtime intervention: add a benchmark step",
        operations: [
          {
            op: "add_node",
            supported: true,
          },
          {
            op: "resume_with_patch",
            supported: true,
          },
        ],
        apply_supported: true,
        operation_outcomes: [
          {
            op: "add_node",
            applied: true,
            error: null,
            node_name: "Benchmark step",
          },
          {
            op: "resume_with_patch",
            applied: true,
            error: null,
          },
        ],
      },
    }),
  ];
  const detail = buildDetail(messages);

  const beats = buildExecutionNarrativeV2(detail, messages);
  const patchBeat = beats.find((beat) => beat.key === "dag-patch-patch-applied-1");

  assert.ok(patchBeat);
  assert.match(patchBeat.title, /Applied a runtime DAG patch/i);
  assert.match(patchBeat.detail, /Outcomes: 2 applied/i);
  assert.match(patchBeat.detail, /runtime audit trail/i);
  assert.equal(patchBeat.tone, "success");
  assert.equal(patchBeat.status, "done");
});

test("buildDagPatchReviewSummary explains graph impact and topology snapshots", () => {
  const review = buildDagPatchReviewSummary({
    status: "needs_confirmation",
    operations: [
      {
        op: "add_node",
        node_name: "QA Review",
        supported: true,
      },
      {
        op: "resume_with_patch",
        supported: true,
      },
    ],
    apply_supported: true,
    graph_preview: {
      summary_lines: [
        "2 operation(s): add node: QA Review, resume with patch.",
        "Predicted graph delta: +1 node(s), +1 edge(s).",
      ],
      operation_labels: ["add node: QA Review", "resume with patch"],
      before_topology: {
        node_count: 2,
        edge_count: 1,
        ready_node_run_ids: ["node-a"],
        running_node_run_ids: [],
        waiting_node_run_ids: [],
        max_parallel_nodes: 1,
      },
      predicted_topology: {
        node_count: 3,
        edge_count: 2,
        ready_node_run_ids: ["node-a"],
        running_node_run_ids: [],
        waiting_node_run_ids: [],
        max_parallel_nodes: 1,
      },
      actual_topology: null,
      node_delta: 1,
      edge_delta: 1,
      parallelism_delta: null,
    },
  });

  assert.equal(review.statusLabel, "Needs confirmation");
  assert.equal(review.operationSummary, "Operations: add node: QA Review, resume with patch");
  assert.equal(review.graphImpactSummary, "Graph impact: nodes +1, edges +1");
  assert.equal(review.topologySnapshots.length, 2);
  assert.match(review.topologySnapshots[0].line, /2 nodes \/ 1 edges/);
  assert.match(review.confirmationSummary, /apply-ready/i);
});

test("buildOrchestratorBriefing ignores confirm echo messages when resolving confirmed plan context", () => {
  const messages = [
    buildMessage({
      kind: "plan_options_card",
      content: {
        revision: 4,
        selected_option: "primary",
        primary: {
          template_id: "template-primary",
          template_name: "Acceptance Phone Collaboration Demo",
          validation: buildValidation({
            passed: false,
            warnings: ["Missing required input: audience"],
            details: [
              {
                code: "missing_required_input",
                category: "required_input",
                message: "Missing required input: audience",
                field: "audience",
                node_id: null,
                node_name: null,
                agent_profile_id: null,
                skill_id: null,
              },
            ],
          }),
        },
        alternative: {
          template_id: "template-alt",
          template_name: "E2E Backend Single Node",
          validation: buildValidation({
            passed: false,
            warnings: ["Missing required input: project_slug"],
            details: [
              {
                code: "missing_required_input",
                category: "required_input",
                message: "Missing required input: project_slug",
                field: "project_slug",
                node_id: null,
                node_name: null,
                agent_profile_id: null,
                skill_id: null,
              },
            ],
          }),
        },
      },
    }),
    buildMessage({
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Confirmed plan v4 for execution.",
        revision: 4,
        option: "alternative",
        template_id: "template-alt",
      },
    }),
  ];
  const detail = {
    ...buildDetail(messages),
    session: {
      ...buildDetail(messages).session,
      status: "ready_to_run" as SessionStatus,
      confirmed_plan_revision: 4,
      confirmed_plan_option: "alternative" as const,
      current_plan_summary: "Confirmed plan v4 (alternative) using template-alt.",
    },
  };

  const briefing = buildOrchestratorBriefing(detail, messages);
  assert.match(briefing.items[0].detail, /E2E Backend Single Node/i);
  assert.match(briefing.summary, /launch/i);
});

test("projectThreadMessages folds older planning revisions and filters confirm echoes", () => {
  const messages = [
    buildMessage({
      message_id: "planner-1",
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Recommended template A",
        recommendation: { selected_template: { template_id: "template-a" } },
      },
    }),
    buildMessage({
      message_id: "plan-1",
      kind: "plan_options_card",
      content: {
        revision: 1,
        primary: { template_id: "template-a" },
      },
    }),
    buildMessage({
      message_id: "planner-2",
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Recommended template B",
        recommendation: { selected_template: { template_id: "template-b" } },
      },
    }),
    buildMessage({
      message_id: "plan-2",
      kind: "plan_options_card",
      content: {
        revision: 2,
        primary: { template_id: "template-b" },
      },
    }),
    buildMessage({
      message_id: "confirm-echo",
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Confirmed plan v2 for execution.",
        revision: 2,
        option: "primary",
      },
    }),
  ];

  const projection = projectThreadMessages({
    messages,
    confirmedPlanRevision: 2,
    showPlanningHistory: false,
  });

  assert.equal(projection.hiddenPlanningRevisionCount, 1);
  assert.equal(projection.hiddenPlannerMessageCount, 1);
  assert.equal(
    projection.visibleMessages.some((message) => message.message_id === "plan-1"),
    false,
  );
  assert.equal(
    projection.visibleMessages.some((message) => message.message_id === "confirm-echo"),
    false,
  );
  assert.equal(
    projection.visibleMessages.some((message) => message.message_id === "plan-2"),
    true,
  );
});

test("projectConversationMessages keeps user and orchestrator replies out of raw card noise", () => {
  const messages = [
    buildMessage({
      message_id: "user-1",
      kind: "text",
      role: "user",
      content: {
        text: "Make the plan shorter.",
      },
    }),
    buildMessage({
      message_id: "plan-1",
      kind: "plan_options_card",
      role: "system",
      content: {
        revision: 1,
      },
    }),
    buildMessage({
      message_id: "confirm-echo",
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Confirmed plan v1 for execution.",
        revision: 1,
        option: "primary",
      },
    }),
    buildMessage({
      message_id: "run-1",
      kind: "run_card",
      role: "system",
      content: {
        run_id: "run-1",
      },
    }),
  ];

  const projection = projectConversationMessages({ messages });

  assert.deepEqual(
    projection.conversationMessages.map((message) => message.message_id),
    ["user-1", "confirm-echo"],
  );
  assert.equal(projection.hiddenNonConversationMessageCount, 2);
  assert.equal(
    getConversationMessageText(projection.conversationMessages[1]),
    "Confirmed route v1 / primary. Execution source is locked; run it when ready.",
  );
});

test("projectConversationMessages keeps conversational acknowledgements in the thread", () => {
  const messages = [
    buildMessage({
      message_id: "user-1",
      kind: "text",
      role: "user",
      content: {
        text: "Keep the tone practical.",
      },
    }),
    buildMessage({
      message_id: "orch-1",
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Logged your note. I kept plan v2 / primary unchanged. Use Revise to turn this note into a new revision.",
      },
    }),
    buildMessage({
      message_id: "plan-2",
      kind: "plan_options_card",
      role: "system",
      content: {
        revision: 2,
      },
    }),
  ];

  const projection = projectConversationMessages({ messages });

  assert.deepEqual(
    projection.conversationMessages.map((message) => message.message_id),
    ["user-1", "orch-1"],
  );
  assert.equal(projection.hiddenNonConversationMessageCount, 1);
  assert.equal(
    getConversationMessageText(projection.conversationMessages[1]),
    "Logged your note. I kept route v2 / primary unchanged. Use Revise to turn this note into a new revision.",
  );
});

test("projectConversationMessages hides raw orchestrator ack when a structured orchestrator turn follows", () => {
  const messages = [
    buildMessage({
      message_id: "user-1",
      kind: "text",
      role: "user",
      content: {
        text: "What changed and what is the next best move?",
      },
    }),
    buildMessage({
      message_id: "orch-1",
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Right now, the mission is still being shaped and does not have an active route yet. Next I recommend: Turn the current brief into an initial DAG before comparing full plan options.",
      },
    }),
    buildMessage({
      message_id: "turn-1",
      kind: "orchestrator_turn",
      role: "orchestrator",
      content: {
        summary: "You asked for a live readback, so I summarized the current mission state and the next best move.",
        user_read: "You want a live readback of mission progress, route state, and the next best move.",
        user_text: "What changed and what is the next best move?",
      },
    }),
  ];

  const projection = projectConversationMessages({ messages });

  assert.deepEqual(
    projection.conversationMessages.map((message) => message.message_id),
    ["user-1", "turn-1"],
  );
  assert.equal(projection.hiddenNonConversationMessageCount, 1);
});

test("getConversationMessageText normalizes legacy mission/thread phrasing for orchestrator replies", () => {
  const message = buildMessage({
    kind: "text",
    role: "orchestrator",
    content: {
      text: "Logged your note. It changes the task framing, so plan v1 is now stale. The task brief stays unchanged until the thread is revised from the current thread context.",
    },
  });

  const text = getConversationMessageText(message);

  assert.equal(
    text,
    "Logged your note. It changes the mission framing, so route v1 is now stale. The mission brief stays unchanged until the mission is revised from the current mission context.",
  );
});

test("getConversationMessageText prefers orchestrator narrative_reply on structured turns", () => {
  const message = buildMessage({
    kind: "orchestrator_turn",
    role: "orchestrator",
    content: {
      summary: "I absorbed the new constraint and updated the brief.",
      narrative_reply:
        "I folded that into the mission brief. In the next workflow pass, I will reflect it by inserting a review checkpoint before final delivery.",
      workspace_impact:
        "The mission brief changed, and the next draft or route will use the updated constraints.",
    },
  });

  const text = getConversationMessageText(message);

  assert.equal(
    text,
    "I folded that into the mission brief. In the next workflow pass, I will reflect it by inserting a review checkpoint before final delivery.",
  );
});

test("getConversationMessageText rewrites raw planner recommendation text into orchestrator narrative", () => {
  const message = buildMessage({
    kind: "text",
    role: "orchestrator",
    content: {
      text: "Matched intent terms: final, acceptance. Registry readiness: 1.00. Recommended template planner-final-acceptance-validation-for-conversation-draft with 1 warning(s). Alternative templates: E2E Backend Single Node.",
      template_id: "planner-final-acceptance-validation-for-conversation-draft",
      recommendation: {
        selected_template: {
          template_id: "planner-final-acceptance-validation-for-conversation-draft",
          name: "Acceptance Phone Collaboration Demo",
          reason: "Best fit for the acceptance flow.",
        },
        candidates: [
          {
            template_id: "planner-final-acceptance-validation-for-conversation-draft",
            name: "Acceptance Phone Collaboration Demo",
            reason: "Best fit for the acceptance flow.",
          },
          {
            template_id: "template-alt",
            name: "E2E Backend Single Node",
            reason: "Simpler fallback path.",
          },
        ],
      },
    },
  });

  const text = getConversationMessageText(message);

  assert.match(text || "", /Acceptance Phone Collaboration Demo/);
  assert.match(text || "", /warning/i);
  assert.match(text || "", /E2E Backend Single Node/);
  assert.doesNotMatch(text || "", /Matched intent terms/i);
  assert.doesNotMatch(text || "", /planner-final-acceptance/i);
});

test("buildOrchestratorTurns treats a conversational acknowledgement as a handled user note", () => {
  const messages = [
    buildMessage({
      message_id: "user-1",
      kind: "text",
      role: "user",
      content: {
        text: "Validate orchestrator chat and explicit planning flow",
      },
      created_at: "2026-06-09T17:13:26.177Z",
    }),
    buildMessage({
      message_id: "user-2",
      kind: "text",
      role: "user",
      content: {
        text: "Keep the thread conversational first.",
      },
      created_at: "2026-06-09T17:13:55.572Z",
    }),
    buildMessage({
      message_id: "orch-1",
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Logged your note. The task brief stays unchanged. Use Draft DAG, Create plan, or Revise explicitly when you want orchestration to move.",
      },
      created_at: "2026-06-09T17:13:55.659Z",
    }),
  ];
  const detail = buildDetail(messages);
  detail.session.current_goal = "Validate orchestrator chat and explicit planning flow";

  const turns = buildOrchestratorTurns(detail, messages);
  const briefing = buildOrchestratorBriefing(detail, messages);

  assert.equal(
    turns.some((turn) => turn.title === "Accepted the latest instruction"),
    false,
  );
  assert.equal(turns[0]?.detail, "Validate orchestrator chat and explicit planning flow");
  assert.match(
    briefing.items[0]?.detail || "",
    /Validate orchestrator chat and explicit planning flow/,
  );
});

test("buildOrchestratorTurns and briefing avoid leaking planner-style current plan summaries", () => {
  const messages = [
    buildMessage({
      message_id: "user-1",
      kind: "text",
      role: "user",
      content: {
        text: "Validate a cleaner orchestrator narrative",
      },
      created_at: "2026-06-09T17:13:26.177Z",
    }),
    buildMessage({
      message_id: "planner-1",
      kind: "text",
      role: "orchestrator",
      content: {
        text: "Matched intent terms: final. Recommended template planner-final-demo with 1 warning(s). Alternative templates: Retry Demo.",
        template_id: "planner-final-demo",
        recommendation: {
          selected_template: {
            template_id: "planner-final-demo",
            name: "Acceptance Phone Collaboration Demo",
            reason: "Best fit for the current task.",
          },
          candidates: [
            {
              template_id: "planner-final-demo",
              name: "Acceptance Phone Collaboration Demo",
              reason: "Best fit for the current task.",
            },
            {
              template_id: "retry-demo",
              name: "Retry Demo",
              reason: "Fallback route.",
            },
          ],
        },
      },
      created_at: "2026-06-09T17:13:30.000Z",
    }),
  ];
  const detail = buildDetail(messages);
  detail.session.current_plan_summary =
    "Matched intent terms: final. Recommended template planner-final-demo with 1 warning(s).";

  const turns = buildOrchestratorTurns(detail, messages);
  const briefing = buildOrchestratorBriefing(detail, messages);

  assert.match(turns[0]?.detail || "", /Acceptance Phone Collaboration Demo/);
  assert.doesNotMatch(turns[0]?.detail || "", /planner-final-demo/);
  assert.match(briefing.items[0]?.detail || "", /Validate a cleaner orchestrator narrative/);
  assert.doesNotMatch(briefing.items[0]?.detail || "", /Matched intent terms/i);
  assert.doesNotMatch(briefing.items[0]?.detail || "", /planner-final-demo/);
});
