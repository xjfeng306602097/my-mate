import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { saveArtifact } from "../src/artifact-store.js";
import { EVALUATION_SNAPSHOTS_DIR, RUN_ROUTES_DIR } from "../src/config.js";
import { evidenceDigest } from "../src/evaluation/canonical-json.js";
import {
  buildRunEvidenceSnapshot,
  getOrCreateRunEvidenceSnapshot,
} from "../src/evaluation/run-evidence-snapshot.js";
import { appendRunEvent, listRunEvents } from "../src/event-store.js";
import { getInitialRunPlan } from "../src/run-initial-plan-store.js";
import { getRunInitialization } from "../src/run-initialization-store.js";
import { getRunPlan } from "../src/run-plan-store.js";
import { buildRunRouteSnapshot } from "../src/run-route.js";
import { getRunRouteOrLegacy } from "../src/run-route-store.js";
import { getRun, saveRun } from "../src/run-store.js";
import { getTemplate } from "../src/template-store.js";
import {
  buildPublishedTemplate,
  createStubExecutionAdapter,
  getJson,
  postJson,
  resetTestRoot,
  seedTemplate,
  startTestServer,
} from "./helpers.js";

function p0Template() {
  return buildPublishedTemplate({
    template_id: "p0-foundation-template",
    version: 3,
    nodes: [
      {
        ...buildPublishedTemplate().nodes[0],
        id: "collect_context",
        name: "Collect Context",
        work_package: {
          key: "research",
          label: "Research",
          order: 10,
        },
      },
    ],
  });
}

async function createP0Run(baseUrl: string) {
  return postJson(`${baseUrl}/api/runs`, {
    intent: "Verify the P0 operator foundation",
    template_id: "p0-foundation-template",
    inputs: {
      goal: "Build an auditable run",
      api_key: "must-not-be-persisted-in-cleartext-snapshots",
    },
    validation_mode: "warn",
  });
}

test("P0 run creation persists canonical route, work packages, and a ready bundle", async () => {
  resetTestRoot();
  seedTemplate(p0Template());
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });

  try {
    const created = await createP0Run(server.baseUrl);
    assert.equal(created.status, 201);
    const runId = created.body.run_id as string;
    const persistedPlan = getRunPlan(runId)!;
    assert.equal(created.body.route.route_id, "template:p0-foundation-template@3");
    assert.equal(created.body.route.source_kind, "direct_template");
    assert.deepEqual(created.body.route.work_packages, [
      {
        key: "research",
        label: "Research",
        order: 10,
        node_run_ids: [persistedPlan.compiled_nodes[0]!.node_run_id],
        identity_source: "declared",
      },
    ]);

    const initialization = getRunInitialization(runId);
    assert.equal(initialization?.state, "ready");
    assert.deepEqual(initialization?.completed_records, initialization?.required_records);
    assert.ok(getInitialRunPlan(runId));

    const routeResponse = await getJson(`${server.baseUrl}/api/runs/${runId}/route`);
    assert.equal(routeResponse.status, 200);
    assert.equal(routeResponse.body.route_id, created.body.route.route_id);

    const run = getRun(runId)!;
    const plan = persistedPlan;
    const template = getTemplate(run.template_id)!;
    assert.equal(
      buildRunRouteSnapshot({
        run,
        plan,
        template,
        source: {
          kind: "session_plan",
          session_id: "session-42",
          plan_revision: 7,
          plan_option: "alternative",
        },
      }).route_id,
      "session:session-42:r7:alternative",
    );
    assert.equal(
      buildRunRouteSnapshot({
        run,
        plan,
        template,
        source: { kind: "proposal", proposal_id: "proposal-42" },
      }).route_id,
      "proposal:proposal-42",
    );

    fs.rmSync(path.join(RUN_ROUTES_DIR, `${encodeURIComponent(runId)}.json`));
    const legacy = getRunRouteOrLegacy(runId);
    assert.equal(legacy?.route_id, `legacy:${runId}`);
    assert.equal(legacy?.source_kind, "legacy");
    assert.equal(legacy?.work_packages[0]?.identity_source, "declared");
  } finally {
    await server.close();
  }
});

test("P0 events are monotonically sequenced and idempotent", () => {
  resetTestRoot();
  const runId = "run-p0-event-contract";
  const first = appendRunEvent({
    run_id: runId,
    type: "run.created",
    actor_type: "system",
    actor_id: "test",
    idempotency_key: "run-created-once",
    created_at: "2026-07-10T01:00:01.000Z",
  });
  const replay = appendRunEvent({
    run_id: runId,
    type: "run.created",
    actor_type: "system",
    actor_id: "test",
    idempotency_key: "run-created-once",
    created_at: "2026-07-10T01:00:02.000Z",
  });
  const second = appendRunEvent({
    run_id: runId,
    type: "run.queued",
    actor_type: "system",
    actor_id: "test",
    created_at: "2026-07-10T01:00:00.000Z",
  });

  assert.equal(replay.event_id, first.event_id);
  assert.equal(first.run_sequence, 1);
  assert.equal(second.run_sequence, 2);
  assert.deepEqual(listRunEvents(runId).map((event) => event.run_sequence), [1, 2]);
});

test("P0 evidence snapshots have stable digests and redact secret fields", async () => {
  resetTestRoot();
  seedTemplate(p0Template());
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });

  try {
    const created = await createP0Run(server.baseUrl);
    const runId = created.body.run_id as string;
    const run = getRun(runId)!;
    run.status = "completed";
    run.current_summary = "Completed for snapshot verification";
    run.started_at = run.created_at;
    run.finished_at = "2026-07-10T02:00:00.000Z";
    run.updated_at = run.finished_at;
    saveRun(run);
    saveArtifact({
      artifact_id: `artifact-${runId}`,
      run_id: runId,
      node_run_id: null,
      type: "report",
      name: "p0-report.txt",
      storage_uri: `workspace://artifacts/${runId}/p0-report.txt`,
      mime_type: "text/plain",
      size_bytes: 64,
      created_at: "2026-07-10T02:00:00.000Z",
      publication_status: "published",
      published_relative_path: "reports/p0-report.txt",
      publication_error: null,
    });

    assert.throws(
      () =>
        buildRunEvidenceSnapshot(runId, {
          generatedAt: "2026-07-10T02:00:00.100Z",
        }),
      /RUN_NOT_SETTLED/,
    );

    const first = buildRunEvidenceSnapshot(runId, {
      generatedAt: "2026-07-10T02:00:01.000Z",
    });
    const second = buildRunEvidenceSnapshot(runId, {
      generatedAt: "2026-07-10T02:00:02.000Z",
    });
    assert.equal(first.snapshot_state, "terminal");
    assert.equal(first.evidence_digest, second.evidence_digest);
    assert.equal(first.run.inputs.api_key, "[REDACTED]");
    assert.deepEqual(Object.keys(first.artifacts[0]!).sort(), [
      "artifact_id",
      "created_at",
      "mime_type",
      "name",
      "node_run_id",
      "run_id",
      "size_bytes",
      "storage_uri",
      "type",
    ]);
    assert.equal(
      evidenceDigest({ z: 1, nested: { token: "one", a: 2 } }),
      evidenceDigest({ nested: { a: 2, token: "two" }, z: 1 }),
    );

    const stored = getOrCreateRunEvidenceSnapshot(runId);
    const deduplicated = getOrCreateRunEvidenceSnapshot(runId);
    assert.equal(stored.snapshot_id, deduplicated.snapshot_id);
    assert.equal(
      fs.readdirSync(path.join(EVALUATION_SNAPSHOTS_DIR, encodeURIComponent(runId))).length,
      1,
    );
  } finally {
    await server.close();
  }
});

test("P0 supervise uses a bounded opaque cursor and rejects invalid cursors", async () => {
  resetTestRoot();
  seedTemplate(p0Template());
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });

  try {
    const created = await createP0Run(server.baseUrl);
    const runId = created.body.run_id as string;
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    let hasMore = true;
    while (hasMore) {
      const suffix = cursor
        ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "?limit=1";
      const page = await getJson(`${server.baseUrl}/api/runs/${runId}/supervise${suffix}`);
      assert.equal(page.status, 200);
      assert.equal(page.body.schema_version, 1);
      assert.ok(typeof page.body.cursor === "string" && page.body.cursor.length > 10);
      assert.ok(page.body.deltas.events.length <= 1);
      for (const event of page.body.deltas.events) {
        assert.equal(seen.has(event.event_id), false);
        seen.add(event.event_id);
      }
      cursor = page.body.cursor;
      hasMore = page.body.has_more;
      pages += 1;
      assert.ok(pages < 20);
    }
    assert.deepEqual([...seen], listRunEvents(runId).map((event) => event.event_id));

    const invalid = await getJson(
      `${server.baseUrl}/api/runs/${runId}/supervise?cursor=not-a-valid-cursor`,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "invalid_cursor");
  } finally {
    await server.close();
  }
});
