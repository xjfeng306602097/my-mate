import test from "node:test";
import assert from "node:assert/strict";

import { buildMissionWorkspaceProjection } from "../src/mission-workspace.js";
import type { SessionMessageRecord, SessionRecord } from "../src/types.js";

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
