import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { overrideDataDir } from "../src/config.js";
import {
  getMissionMaterializerCheckpoint,
  listMissionMaterializerEvents,
  materializeMissionFromEvents,
  synchronizeAndMaterializeMission,
  synchronizeMissionMaterializerEvents,
  verifyMissionMaterialization,
  type MissionMaterializerSource,
} from "../src/mission-materializer.js";
import type { SessionMessageRecord, SessionRecord } from "../src/types.js";

const timestamp = "2026-07-12T08:00:00.000Z";

function source(): MissionMaterializerSource {
  const session: SessionRecord = {
    session_id: "session-materializer",
    workspace_id: "default",
    title: "Materialized mission",
    status: "planning",
    created_by: "tester",
    created_at: timestamp,
    updated_at: timestamp,
    current_goal: "Build an evented mission projection",
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
  };
  const message: SessionMessageRecord = {
    message_id: "message-materializer-1",
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "Build an evented mission projection" },
    created_at: timestamp,
    linked_run_id: null,
    linked_node_run_id: null,
  };
  return {
    session,
    messages: [message],
    workspaceState: {
      working_goal: session.current_goal,
      next_recommended_label: "Draft route",
      next_recommended_detail: "Create a route from the mission brief.",
    },
    runRoute: null,
  };
}

test("mission materializer is incremental, idempotent, checkpointed, and rebuildable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-mission-materializer-"));
  overrideDataDir(root);
  try {
    const input = source();
    const first = synchronizeAndMaterializeMission(input, {
      checkpointInterval: 100,
      timestamp,
    });
    assert.equal(first.event_count, 4);
    assert.equal(first.last_sequence, 4);
    assert.equal(first.projection.missionSnapshot.missionTitle, "Materialized mission");
    assert.equal(getMissionMaterializerCheckpoint(input.session.session_id)?.last_sequence, 4);

    synchronizeMissionMaterializerEvents(input, timestamp);
    assert.equal(listMissionMaterializerEvents(input.session.session_id).length, 4);

    input.messages.push({
      ...input.messages[0]!,
      message_id: "message-materializer-2",
      role: "orchestrator",
      kind: "orchestrator_turn",
      content: { narrative_reply: "The route is ready for review." },
      created_at: "2026-07-12T08:01:00.000Z",
    });
    const incremental = synchronizeAndMaterializeMission(input, {
      checkpointInterval: 100,
      timestamp: "2026-07-12T08:01:00.000Z",
    });
    assert.equal(incremental.event_count, 5);
    assert.equal(incremental.checkpoint_sequence, 4);
    assert.equal(
      incremental.projection.missionSnapshot.latestOrchestratorReply,
      "The route is ready for review.",
    );

    const rebuilt = materializeMissionFromEvents({
      sessionId: input.session.session_id,
      forceRebuild: true,
      materializedAt: "2026-07-12T08:02:00.000Z",
    });
    assert.equal(rebuilt.projection_digest, incremental.projection_digest);
    assert.equal(rebuilt.checkpoint_sequence, 5);
    assert.equal(verifyMissionMaterialization(input).status, "consistent");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mission materializer consistency verification reports event-log drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-mission-drift-"));
  overrideDataDir(root);
  try {
    const input = source();
    synchronizeAndMaterializeMission(input, { timestamp });
    const sessionEvent = listMissionMaterializerEvents(input.session.session_id).find(
      (event) => event.kind === "session.replaced",
    );
    assert.ok(sessionEvent);
    (sessionEvent.payload.session as SessionRecord).title = "Tampered mission";
    const eventFile = path.join(
      root,
      "mission-materializer-events",
      input.session.session_id,
      `${String(sessionEvent.sequence).padStart(12, "0")}.json`,
    );
    fs.writeFileSync(eventFile, JSON.stringify(sessionEvent, null, 2));
    const report = verifyMissionMaterialization(input);
    assert.equal(report.status, "drifted");
    assert.deepEqual(report.differing_sections, ["missionSpecContract", "missionSnapshot"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
