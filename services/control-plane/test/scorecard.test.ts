import assert from "node:assert/strict";
import test from "node:test";
import { saveArtifact } from "../src/artifact-store.js";
import { appendRunEvent, listRunEvents } from "../src/event-store.js";
import { listNodeRuns, saveNodeRuns } from "../src/node-run-store.js";
import { getRunPlan, saveRunPlan } from "../src/run-plan-store.js";
import { getRun, saveRun } from "../src/run-store.js";
import {
  buildPublishedTemplate,
  createStubExecutionAdapter,
  getJson,
  postJson,
  resetTestRoot,
  seedTemplate,
  startTestServer,
} from "./helpers.js";

async function createScorecardRun(baseUrl: string, templateId: string) {
  return postJson(`${baseUrl}/api/runs`, {
    intent: "Verify the P0 pipeline scorecard",
    template_id: templateId,
    inputs: { goal: "Produce a reproducible operational verdict" },
    validation_mode: "warn",
  });
}

function completeRun(runId: string, options?: { persistArtifact?: boolean; strict?: boolean }) {
  const plan = getRunPlan(runId)!;
  const nodeRuns = listNodeRuns(runId);
  assert.equal(nodeRuns.length, 1);
  const nodeRun = nodeRuns[0]!;
  nodeRun.status = "completed";
  nodeRun.attempt = 1;
  nodeRun.progress = {
    percent: 100,
    message: "Completed for scorecard verification",
    updated_at: "2026-07-10T04:00:02.000Z",
  };
  nodeRun.started_at = "2026-07-10T04:00:01.000Z";
  nodeRun.finished_at = "2026-07-10T04:00:02.000Z";
  saveNodeRuns(runId, nodeRuns);

  plan.compiled_nodes[0]!.status = "completed";
  plan.status = "completed";
  if (options?.strict) {
    plan.policy_snapshot.scorecard = {
      profile: "pipeline-v1",
      version: 1,
      enforcement: "strict",
    };
  }
  saveRunPlan(plan);

  const run = getRun(runId)!;
  run.status = "completed";
  run.current_summary = "Completed for scorecard verification";
  run.started_at = "2026-07-10T04:00:01.000Z";
  run.finished_at = "2026-07-10T04:00:02.000Z";
  run.updated_at = run.finished_at;
  saveRun(run);

  appendRunEvent({
    run_id: runId,
    node_run_id: nodeRun.node_run_id,
    type: "node.started",
    actor_type: "system",
    actor_id: "scorecard-test",
    created_at: "2026-07-10T04:00:01.000Z",
  });
  appendRunEvent({
    run_id: runId,
    node_run_id: nodeRun.node_run_id,
    type: "node.completed",
    actor_type: "system",
    actor_id: "scorecard-test",
    created_at: "2026-07-10T04:00:02.000Z",
  });
  appendRunEvent({
    run_id: runId,
    type: "run.completed",
    actor_type: "system",
    actor_id: "scorecard-test",
    created_at: "2026-07-10T04:00:02.000Z",
  });

  if (options?.persistArtifact !== false) {
    saveArtifact({
      artifact_id: `artifact_${nodeRun.node_run_id}`,
      run_id: runId,
      node_run_id: nodeRun.node_run_id,
      type: "report",
      name: "agent-report.txt",
      storage_uri: `workspace://artifacts/${runId}/${nodeRun.node_run_id}/agent-report.txt`,
      mime_type: "text/plain",
      size_bytes: 42,
      created_at: "2026-07-10T04:00:02.000Z",
    });
  }
}

test("pipeline scorecard persists a reproducible pass and deduplicates by evidence digest", async () => {
  resetTestRoot();
  const templateId = "scorecard-pass-template";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });

  try {
    const createdRun = await createScorecardRun(server.baseUrl, templateId);
    assert.equal(createdRun.status, 201);
    const runId = createdRun.body.run_id as string;
    completeRun(runId);

    const first = await postJson(`${server.baseUrl}/api/runs/${runId}/scorecards`, {
      profile: "pipeline-v1",
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.pipeline_verdict, "pass");
    assert.equal(first.body.gate_verdict, "not_enforced");
    assert.equal(first.body.total_checks, 14);
    assert.equal(first.body.passed_checks, 14);
    assert.equal(first.body.hard_error_count, 0);

    const second = await postJson(`${server.baseUrl}/api/runs/${runId}/scorecards`, {
      profile: "pipeline-v1",
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.scorecard_id, first.body.scorecard_id);
    assert.equal(second.body.evidence_digest, first.body.evidence_digest);

    const listed = await getJson(`${server.baseUrl}/api/runs/${runId}/scorecards`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 1);
    const detail = await getJson(
      `${server.baseUrl}/api/runs/${runId}/scorecards/${encodeURIComponent(first.body.scorecard_id)}`,
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.snapshot_id, first.body.snapshot_id);
    assert.equal(
      listRunEvents(runId).filter((event) => event.type === "scorecard.completed").length,
      1,
    );
  } finally {
    await server.close();
  }
});

test("scorecard rejects active runs by default and can explicitly report incomplete", async () => {
  resetTestRoot();
  const templateId = "scorecard-incomplete-template";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });

  try {
    const createdRun = await createScorecardRun(server.baseUrl, templateId);
    const runId = createdRun.body.run_id as string;
    const rejected = await postJson(`${server.baseUrl}/api/runs/${runId}/scorecards`, {});
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, "run_not_terminal");

    const incomplete = await postJson(`${server.baseUrl}/api/runs/${runId}/scorecards`, {
      allow_incomplete: true,
    });
    assert.equal(incomplete.status, 201);
    assert.equal(incomplete.body.pipeline_verdict, "incomplete");
    assert.equal(incomplete.body.findings.length, 14);
  } finally {
    await server.close();
  }
});

test("strict scorecard rejects a terminal run with missing required artifacts", async () => {
  resetTestRoot();
  const templateId = "scorecard-strict-template";
  seedTemplate(buildPublishedTemplate({ template_id: templateId }));
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });

  try {
    const createdRun = await createScorecardRun(server.baseUrl, templateId);
    const runId = createdRun.body.run_id as string;
    completeRun(runId, { persistArtifact: false, strict: true });
    const scorecard = await postJson(`${server.baseUrl}/api/runs/${runId}/scorecards`, {});
    assert.equal(scorecard.status, 201);
    assert.equal(scorecard.body.pipeline_verdict, "fail");
    assert.equal(scorecard.body.gate_verdict, "reject");
    assert.equal(
      scorecard.body.findings.find(
        (finding: { check_id: string }) => finding.check_id === "pipeline.required_artifacts",
      ).passed,
      false,
    );
  } finally {
    await server.close();
  }
});
