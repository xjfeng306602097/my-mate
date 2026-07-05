import test from "node:test";
import assert from "node:assert/strict";

import {
  MISSION_WORKSPACE_CONTRACT_VERSION,
  buildMissionWorkspaceProjection,
} from "../src/mission-workspace.js";
import type {
  MissionWorkspaceSectionKey,
  MissionWorkspaceStageKey,
  SessionMessageRecord,
  SessionRecord,
} from "../src/types.js";

const ISO = "2026-06-27T12:00:00.000Z";

function buildSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    session_id: "session-1",
    title: "Mission",
    status: "planning",
    created_by: "tester",
    created_at: ISO,
    updated_at: ISO,
    current_goal: "Plan the mission",
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
    metadata: {},
    ...overrides,
  };
}

function buildMessage(
  input: Partial<SessionMessageRecord> & Pick<SessionMessageRecord, "kind">,
): SessionMessageRecord {
  return {
    message_id: input.message_id || `${input.kind}-1`,
    session_id: input.session_id || "session-1",
    role: input.role || "orchestrator",
    kind: input.kind,
    content: input.content || {},
    created_at: input.created_at || ISO,
    linked_run_id: input.linked_run_id || null,
    linked_node_run_id: input.linked_node_run_id || null,
  };
}

const EXPECTED_STAGE_KEYS: MissionWorkspaceStageKey[] = [
  "briefing",
  "work",
  "plan",
  "execution",
  "thread",
];

const EXPECTED_WORKSPACE_SECTION_KEYS: MissionWorkspaceSectionKey[] = [
  "brief",
  "work",
  "checkpoints",
  "outputs",
  "runtime",
];

function buildRouteMessage(overrides: Partial<SessionMessageRecord> = {}): SessionMessageRecord {
  return buildMessage({
    message_id: "plan-1",
    kind: "plan_options_card",
    content: {
      revision: 1,
      selected_option: "primary",
      primary: {
        template_id: "route-primary",
        template_name: "Primary Route",
        candidate_plan: {
          compiled_nodes: [
            {
              node_id: "draft_summary",
              name: "Draft Summary",
              status: "ready",
              agent_profile: "writer",
              output_contract: {
                expected_artifacts: ["summary-draft"],
              },
            },
          ],
        },
      },
      alternative: {
        template_id: "route-alternative",
        template_name: "Alternative Route",
        candidate_plan: {
          compiled_nodes: [
            {
              node_id: "draft_summary_alt",
              name: "Draft Summary Alt",
              status: "ready",
            },
          ],
        },
      },
    },
    created_at: "2026-06-27T12:01:00.000Z",
    ...overrides,
  });
}

test("mission workspace contract remains stable across core mission stages", () => {
  const routeMessage = buildRouteMessage();
  const confirmedRouteMessage = buildRouteMessage({
    message_id: "plan-confirmed",
    content: {
      revision: 2,
      template_id: "confirmed-route",
      template_name: "Confirmed Route",
      candidate_plan: {
        compiled_nodes: [
          {
            node_id: "confirmed_summary",
            name: "Confirmed Summary",
            status: "ready",
            output_contract: {
              expected_artifacts: ["confirmed-summary"],
            },
          },
        ],
      },
    },
    kind: "plan_card",
  });
  const scenarios: Array<{
    name: string;
    session: SessionRecord;
    messages: SessionMessageRecord[];
    workspaceState: Record<string, unknown>;
    activeStage: MissionWorkspaceStageKey;
  }> = [
    {
      name: "draft",
      session: buildSession({
        status: "draft",
        title: "Draft Stage Mission",
        current_goal: "Shape a draft route",
      }),
      messages: [
        buildMessage({
          message_id: "user-draft",
          role: "user",
          kind: "text",
          content: { text: "Shape a draft route." },
        }),
        buildMessage({
          message_id: "draft-stage-card",
          kind: "draft_card",
          content: {
            draft_template: {
              template_id: "draft-route",
              name: "Draft Route",
              nodes: [{ node_id: "draft_node" }],
            },
          },
          created_at: "2026-06-27T12:01:00.000Z",
        }),
      ],
      workspaceState: {
        working_goal: "Shape a draft route",
        draft_node_count: 1,
      },
      activeStage: "plan",
    },
    {
      name: "planned",
      session: buildSession({
        status: "planning",
        title: "Planned Stage Mission",
      }),
      messages: [routeMessage],
      workspaceState: {
        working_goal: "Choose a planned route",
        active_plan_revision: 1,
        active_plan_option: "primary",
        latest_plan_revision: 1,
      },
      activeStage: "plan",
    },
    {
      name: "confirmed",
      session: buildSession({
        status: "ready_to_run",
        title: "Confirmed Stage Mission",
        confirmed_plan_revision: 2,
        confirmed_plan_option: "primary",
      }),
      messages: [confirmedRouteMessage],
      workspaceState: {
        working_goal: "Run the confirmed route",
        active_plan_revision: 2,
        active_plan_option: "primary",
        latest_plan_revision: 2,
        confirmed_plan_revision: 2,
        confirmed_plan_option: "primary",
      },
      activeStage: "plan",
    },
    {
      name: "running",
      session: buildSession({
        status: "running",
        title: "Running Stage Mission",
        latest_run_id: "run-running",
        confirmed_plan_revision: 2,
        confirmed_plan_option: "primary",
      }),
      messages: [
        confirmedRouteMessage,
        buildMessage({
          message_id: "summary-running",
          kind: "summary_card",
          content: {
            status: "running",
            current_summary: "Runtime is producing the confirmed summary.",
          },
          linked_run_id: "run-running",
        }),
      ],
      workspaceState: {
        working_goal: "Run the confirmed route",
        latest_run_id: "run-running",
        run_status: "running",
        latest_run_summary: "Runtime is producing the confirmed summary.",
        latest_subtask: { node_name: "Confirmed Summary" },
        confirmed_plan_revision: 2,
        confirmed_plan_option: "primary",
      },
      activeStage: "execution",
    },
    {
      name: "waiting_human",
      session: buildSession({
        status: "waiting_human",
        title: "Waiting Stage Mission",
        latest_run_id: "run-waiting",
        confirmed_plan_revision: 2,
        confirmed_plan_option: "primary",
      }),
      messages: [
        confirmedRouteMessage,
        buildMessage({
          message_id: "approval-waiting",
          kind: "approval_card",
          content: {
            approval_id: "approval-1",
            summary: "Review the generated summary before continuing.",
          },
          linked_run_id: "run-waiting",
        }),
      ],
      workspaceState: {
        working_goal: "Review before continuing",
        latest_run_id: "run-waiting",
        run_status: "waiting_human",
        latest_run_summary: "Runtime is waiting for human review.",
        pending_approval_count: 1,
        confirmed_plan_revision: 2,
        confirmed_plan_option: "primary",
      },
      activeStage: "execution",
    },
    {
      name: "completed",
      session: buildSession({
        status: "completed",
        title: "Completed Stage Mission",
        latest_run_id: "run-completed",
        confirmed_plan_revision: 2,
        confirmed_plan_option: "primary",
      }),
      messages: [
        confirmedRouteMessage,
        buildMessage({
          message_id: "artifact-completed",
          kind: "artifact_card",
          content: {
            name: "confirmed-summary",
            storage_uri: "file://confirmed-summary.md",
          },
          linked_run_id: "run-completed",
        }),
        buildMessage({
          message_id: "summary-completed",
          kind: "summary_card",
          content: {
            status: "completed",
            current_summary: "The confirmed summary is complete.",
          },
          linked_run_id: "run-completed",
        }),
      ],
      workspaceState: {
        working_goal: "Deliver the confirmed summary",
        latest_run_id: "run-completed",
        run_status: "completed",
        latest_run_summary: "The confirmed summary is complete.",
        confirmed_plan_revision: 2,
        confirmed_plan_option: "primary",
      },
      activeStage: "execution",
    },
  ];

  for (const scenario of scenarios) {
    const projection = buildMissionWorkspaceProjection({
      session: scenario.session,
      messages: scenario.messages,
      workspaceState: scenario.workspaceState,
    });
    const { missionSnapshot } = projection;
    const activeStages = missionSnapshot.stages.filter((stage) => stage.status === "active");

    assert.equal(
      missionSnapshot.workspace_contract_version,
      MISSION_WORKSPACE_CONTRACT_VERSION,
      scenario.name,
    );
    assert.deepEqual(missionSnapshot.spec, projection.missionSpec, scenario.name);
    assert.deepEqual(
      missionSnapshot.stages.map((stage) => stage.key),
      EXPECTED_STAGE_KEYS,
      scenario.name,
    );
    assert.deepEqual(
      missionSnapshot.workspaceSections.map((section) => section.key),
      EXPECTED_WORKSPACE_SECTION_KEYS,
      scenario.name,
    );
    assert.equal(activeStages.length, 1, scenario.name);
    assert.equal(activeStages[0]?.key, scenario.activeStage, scenario.name);
    for (const section of missionSnapshot.workspaceSections) {
      assert.ok(section.title.trim(), `${scenario.name}:${section.key}:title`);
      assert.ok(section.summary.trim(), `${scenario.name}:${section.key}:summary`);
    }
  }
});

test("mission workspace projection covers draft-only missions", () => {
  const session = buildSession({
    title: "Draft Mission",
    current_goal: "Shape a workflow draft",
  });
  const messages = [
    buildMessage({
      message_id: "user-1",
      role: "user",
      kind: "text",
      content: {
        text: "Shape a workflow draft for a recovery mission.",
      },
    }),
    buildMessage({
      message_id: "draft-1",
      kind: "draft_card",
      content: {
        draft_template: {
          template_id: "draft-template",
          name: "Recovery Draft",
          nodes: [{ node_id: "n1" }, { node_id: "n2" }],
        },
      },
      created_at: "2026-06-27T12:01:00.000Z",
    }),
  ];

  const projection = buildMissionWorkspaceProjection({
    session,
    messages,
    workspaceState: {
      working_goal: "Shape a workflow draft",
      draft_node_count: 2,
    },
  });

  assert.equal(projection.missionSpec.objective, "Shape a workflow draft");
  assert.equal(projection.missionSpecContract.specId, "mission_spec:session-1");
  assert.equal(projection.missionSpecContract.schemaVersion, 1);
  assert.equal(projection.missionSnapshot.workspace_contract_version, 1);
  assert.equal(projection.missionSpecContract.objective, "Shape a workflow draft");
  assert.equal(projection.missionSpecContract.latestUserMessageId, "user-1");
  assert.equal(projection.missionSpec.route.activeRevision, null);
  assert.equal(projection.missionSpec.pipelineSummary.total, 0);
  assert.equal(projection.missionSpec.checkpointSummary.labels[1], "Workflow draft");
  assert.equal(projection.missionSnapshot.activeRouteRevision, null);
  assert.equal(
    projection.missionSnapshot.stages.find((stage) => stage.key === "plan")?.title,
    "Draft workflow shape is ready",
  );
});

test("mission workspace projection covers route-compare missions", () => {
  const session = buildSession({
    title: "Compare Mission",
  });
  const messages = [
    buildMessage({
      message_id: "user-1",
      role: "user",
      kind: "text",
      content: {
        text: "Prepare route options for a customer recovery mission.",
      },
    }),
    buildMessage({
      message_id: "goal-1",
      kind: "goal_update_card",
      content: {
        working_goal: "Prepare route options for a customer recovery mission",
        constraints_summary: "Keep the first pass concise",
        open_questions: ["Should legal review be included?"],
      },
      created_at: "2026-06-27T12:01:00.000Z",
    }),
    buildMessage({
      message_id: "decision-1",
      kind: "decision_card",
      content: {
        pending_decision: "Choose the best route before confirming execution.",
      },
      created_at: "2026-06-27T12:02:00.000Z",
    }),
    buildMessage({
      message_id: "plan-3",
      kind: "plan_options_card",
      content: {
        revision: 3,
        source_revision: 2,
        source_option: "primary",
        selected_option: "primary",
        primary: {
          template_id: "route-primary",
          template_name: "Primary Route",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "collect_context",
                name: "Collect Context",
                status: "ready",
                agent_profile: "research-agent",
                allowed_skills: ["research"],
                output_contract: {
                  expected_artifacts: ["research-notes"],
                },
              },
            ],
          },
        },
        alternative: {
          template_id: "route-alt",
          template_name: "Alternative Route",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "collect_context_alt",
                name: "Collect Context Alt",
                status: "pending",
                agent_profile: "backup-agent",
              },
            ],
          },
        },
      },
      created_at: "2026-06-27T12:03:00.000Z",
    }),
  ];

  const projection = buildMissionWorkspaceProjection({
    session,
    messages,
    workspaceState: {
      working_goal: "Prepare route options for a customer recovery mission",
      active_plan_revision: 3,
      active_plan_option: "primary",
      latest_plan_revision: 3,
      active_plan_template_name: "Primary Route",
    },
  });

  assert.equal(projection.missionSpec.route.activeRevision, 3);
  assert.equal(projection.missionSpecContract.route.activeRevision, 3);
  assert.equal(projection.missionSnapshot.workspace_contract_version, 1);
  assert.equal(projection.missionSpecContract.latestPlanMessageId, "plan-3");
  assert.deepEqual(projection.missionSpecContract.requestedOutputs, ["research-notes"]);
  assert.equal(projection.missionSpec.route.activeOption, "primary");
  assert.equal(projection.missionSpec.route.latestRevision, 3);
  assert.equal(projection.missionSpec.route.alternativeAvailable, true);
  assert.equal(projection.missionSpec.revisionLineage.sourceRevision, 2);
  assert.deepEqual(projection.missionSpec.requestedOutputs, ["research-notes"]);
  assert.equal(projection.missionSpec.pipelineSummary.total, 1);
  assert.equal(projection.missionSnapshot.activeRouteRevision, 3);
  assert.ok(
    projection.missionSnapshot.checkpoints.some((checkpoint) => checkpoint.label === "Route comparison"),
  );
});

test("mission workspace projection promotes outputs checkpoints and pipelines into primary sections", () => {
  const session = buildSession({
    title: "Output Mission",
    status: "running",
    latest_run_id: "run-output",
  });
  const messages = [
    buildMessage({
      message_id: "plan-1",
      kind: "plan_options_card",
      content: {
        revision: 1,
        selected_option: "primary",
        primary: {
          template_id: "route-output",
          template_name: "Output Route",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "collect_context",
                name: "Collect Context",
                status: "ready",
                agent_profile: "research-agent",
                allowed_skills: ["research"],
                output_contract: {
                  expected_artifacts: ["research-notes"],
                },
              },
            ],
          },
        },
      },
    }),
    buildMessage({
      message_id: "run-1",
      kind: "run_card",
      content: {
        run_id: "run-output",
        status: "running",
      },
      linked_run_id: "run-output",
      created_at: "2026-06-27T12:02:00.000Z",
    }),
    buildMessage({
      message_id: "artifact-1",
      kind: "artifact_card",
      content: {
        name: "research-notes",
        storage_uri: "file://research-notes.md",
        mime_type: "text/markdown",
      },
      linked_run_id: "run-output",
      created_at: "2026-06-27T12:03:00.000Z",
    }),
  ];

  const projection = buildMissionWorkspaceProjection({
    session,
    messages,
    workspaceState: {
      working_goal: "Return research notes",
      active_plan_revision: 1,
      active_plan_option: "primary",
      latest_run_id: "run-output",
      run_status: "running",
      latest_run_summary: "Collecting and returning research notes.",
    },
  });

  assert.deepEqual(
    projection.missionSnapshot.workspaceSections.map((section) => section.key),
    ["brief", "work", "checkpoints", "outputs", "runtime"],
  );
  assert.equal(projection.missionSnapshot.workspaceSections[1]?.key, "work");
  assert.equal(projection.missionSnapshot.workspaceSections[3]?.key, "outputs");
  assert.equal(projection.missionSnapshot.outputs[0]?.title, "research-notes");
  assert.equal(projection.missionSnapshot.outputs[0]?.status, "returned");
  assert.deepEqual(projection.missionSnapshot.outputs[0]?.pipelineKeys, ["collect_context"]);
  assert.deepEqual(projection.missionSnapshot.outputs[0]?.artifactMessageIds, ["artifact-1"]);
  assert.ok(
    projection.missionSnapshot.workspaceSections
      .find((section) => section.key === "outputs")
      ?.summary.includes("returned"),
  );
});

test("mission workspace projection covers confirmed missions before launch", () => {
  const session = buildSession({
    title: "Confirmed Mission",
    status: "ready_to_run",
    confirmed_plan_revision: 4,
    confirmed_plan_option: "alternative",
  });
  const messages = [
    buildMessage({
      message_id: "user-1",
      role: "user",
      kind: "text",
      content: {
        text: "Confirm the safer route for executive review.",
      },
    }),
    buildMessage({
      message_id: "plan-4",
      kind: "plan_options_card",
      content: {
        revision: 4,
        selected_option: "alternative",
        primary: {
          template_id: "route-primary",
          template_name: "Primary Route",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "draft_primary",
                name: "Draft Primary",
                status: "ready",
              },
            ],
          },
        },
        alternative: {
          template_id: "route-safer",
          template_name: "Safer Route",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "draft_safer",
                name: "Draft Safer",
                status: "ready",
                output_contract: {
                  expected_artifacts: ["safe-brief"],
                },
              },
            ],
          },
        },
      },
      created_at: "2026-06-27T12:01:00.000Z",
    }),
  ];

  const projection = buildMissionWorkspaceProjection({
    session,
    messages,
    workspaceState: {
      working_goal: "Confirm the safer route for executive review",
      confirmed_plan_revision: 4,
      confirmed_plan_option: "alternative",
      active_plan_revision: 4,
      active_plan_option: "alternative",
      latest_plan_revision: 4,
    },
  });

  assert.equal(projection.missionSpec.route.confirmedRevision, 4);
  assert.equal(projection.missionSpec.route.confirmedOption, "alternative");
  assert.equal(projection.missionSpec.route.activeOption, "alternative");
  assert.equal(projection.missionSpec.route.selectedTemplateId, "route-safer");
  assert.equal(projection.missionSpec.revisionLineage.confirmedRevision, 4);
  assert.equal(
    projection.missionSnapshot.checkpoints.find((checkpoint) => checkpoint.key === "launch-gate")?.status,
    "done",
  );
});

test("mission workspace projection keeps running missions anchored to the confirmed route", () => {
  const session = buildSession({
    title: "Running Mission",
    status: "running",
    latest_run_id: "run-1",
    confirmed_plan_revision: 2,
    confirmed_plan_option: "primary",
  });
  const messages = [
    buildMessage({
      message_id: "plan-2",
      kind: "plan_card",
      content: {
        revision: 2,
        template_id: "confirmed-route",
        template_name: "Confirmed Route",
        candidate_plan: {
          compiled_nodes: [
            {
              node_id: "node_confirmed",
              name: "Confirmed Step",
              status: "ready",
              output_contract: {
                expected_artifacts: ["confirmed-output"],
              },
            },
          ],
        },
      },
      created_at: "2026-06-27T12:01:00.000Z",
    }),
    buildMessage({
      message_id: "plan-3",
      kind: "plan_options_card",
      content: {
        revision: 3,
        selected_option: "alternative",
        primary: {
          template_id: "latest-primary",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "node_latest_primary",
                name: "Latest Primary",
                status: "ready",
              },
            ],
          },
        },
        alternative: {
          template_id: "latest-alt",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "node_latest_alt",
                name: "Latest Alt",
                status: "ready",
              },
            ],
          },
        },
      },
      created_at: "2026-06-27T12:02:00.000Z",
    }),
    buildMessage({
      message_id: "summary-1",
      kind: "summary_card",
      content: {
        status: "running",
        current_summary: "Runtime is progressing through the confirmed route.",
      },
      linked_run_id: "run-1",
      created_at: "2026-06-27T12:03:00.000Z",
    }),
  ];

  const projection = buildMissionWorkspaceProjection({
    session,
    messages,
    workspaceState: {
      latest_run_id: "run-1",
      run_status: "running",
      latest_run_summary: "Runtime is progressing through the confirmed route.",
      latest_subtask: {
        node_name: "Confirmed Step",
      },
      latest_plan_revision: 3,
      confirmed_plan_revision: 2,
      confirmed_plan_option: "primary",
      next_recommended_label: "Monitor runtime",
    },
  });

  assert.equal(projection.missionSpec.route.activeRevision, 2);
  assert.equal(projection.missionSpec.route.latestRevision, 3);
  assert.equal(projection.missionSpec.route.confirmedRevision, 2);
  assert.equal(projection.missionSpec.route.selectedTemplateId, "confirmed-route");
  assert.equal(projection.missionSnapshot.activeRunId, "run-1");
  assert.equal(
    projection.missionSnapshot.stages.find((stage) => stage.key === "execution")?.status,
    "active",
  );
});

test("mission workspace projection can rebuild route contract from persisted metadata", () => {
  const session = buildSession({
    title: "Persisted Mission",
    status: "ready_to_run",
    current_goal: "Recover a mission without card archaeology",
    confirmed_plan_revision: 7,
    confirmed_plan_option: "alternative",
    metadata: {
      mission_route_state: {
        active_revision: 7,
        active_option: "alternative",
        latest_revision: 8,
        latest_option: "primary",
        confirmed_revision: 7,
        confirmed_option: "alternative",
        selected_template_id: "persisted-template",
        selected_template_name: "Persisted Template",
        alternative_available: true,
        stale: false,
        stale_reason: null,
      },
      mission_requested_outputs: ["brief", "handoff"],
      mission_revision_lineage: {
        source_revision: 6,
        source_option: "primary",
        latest_revision: 8,
        confirmed_revision: 7,
        confirmed_option: "alternative",
      },
    },
  });

  const projection = buildMissionWorkspaceProjection({
    session,
    messages: [],
    workspaceState: {},
  });

  assert.equal(projection.missionSpec.route.activeRevision, 7);
  assert.equal(projection.missionSpec.route.activeOption, "alternative");
  assert.equal(projection.missionSpec.route.latestRevision, 8);
  assert.equal(projection.missionSpec.route.confirmedRevision, 7);
  assert.equal(projection.missionSpec.route.selectedTemplateId, "persisted-template");
  assert.deepEqual(projection.missionSpec.requestedOutputs, ["brief", "handoff"]);
  assert.equal(projection.missionSpec.revisionLineage.sourceRevision, 6);
  assert.equal(projection.missionSpec.revisionLineage.confirmedOption, "alternative");
});

test("mission workspace projection marks stale missions explicitly", () => {
  const session = buildSession({
    title: "Stale Mission",
  });
  const messages = [
    buildMessage({
      message_id: "user-1",
      role: "user",
      kind: "text",
      content: {
        text: "Prepare a retrospective route.",
      },
    }),
    buildMessage({
      message_id: "plan-1",
      kind: "plan_options_card",
      content: {
        revision: 1,
        selected_option: "primary",
        primary: {
          template_id: "route-v1",
          candidate_plan: {
            compiled_nodes: [
              {
                node_id: "node_v1",
                name: "Route V1",
                status: "ready",
              },
            ],
          },
        },
      },
      created_at: "2026-06-27T12:01:00.000Z",
    }),
  ];

  const projection = buildMissionWorkspaceProjection({
    session,
    messages,
    workspaceState: {
      working_goal: "Prepare a retrospective route",
      active_plan_revision: 1,
      active_plan_option: "primary",
      latest_plan_revision: 1,
      plan_stale: true,
      stale_reason: "The brief changed after route v1 was compiled.",
      next_recommended_detail: "Revise the route before confirmation.",
    },
  });

  assert.equal(projection.missionSpec.route.stale, true);
  assert.equal(projection.missionSpec.route.staleReason, "The brief changed after route v1 was compiled.");
  assert.equal(
    projection.missionSnapshot.stages.find((stage) => stage.key === "plan")?.tone,
    "warn",
  );
  assert.match(projection.missionSnapshot.missionSummary, /revise|brief/i);
});
