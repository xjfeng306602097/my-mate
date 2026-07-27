import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveSession,
  createSession,
  deleteSession,
  getSession,
  saveSession,
} from "../src/session-store.js";
import { getRun, saveRun } from "../src/run-store.js";
import { resetTestRoot, startTestServer } from "./helpers.js";

async function deleteJson(url: string) {
  const response = await fetch(url, { method: "DELETE" });
  return { status: response.status, body: await response.json() };
}

function seedRun(runId: string, status: "queued" | "completed") {
  const timestamp = new Date().toISOString();
  saveRun({
    run_id: runId,
    template_id: "session-delete-template",
    template_version: 1,
    workspace_id: "default",
    requested_by: "test-user",
    intent: "Session delete gate fixture",
    status,
    current_summary: "Session delete gate fixture",
    waiting_reason: null,
    blocked_reason: null,
    started_at: status === "completed" ? timestamp : null,
    finished_at: status === "completed" ? timestamp : null,
    last_event_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    inputs: {},
    proposal_id: null,
    source_run_id: null,
    rerun_reason: null,
    rerun_idempotency_key: null,
  });
}

test("deleteSession removes the session record and per-session conversation data", () => {
  resetTestRoot();
  const session = createSession({ title: "Delete me" });
  archiveSession(session.session_id, "test");

  const result = deleteSession(session.session_id);

  assert.ok(result);
  assert.equal(result.session_id, session.session_id);
  assert.ok(result.deleted_records >= 1);
  assert.equal(getSession(session.session_id), null);
});

test("DELETE /api/sessions/:sessionId requires an archived session", async () => {
  resetTestRoot();
  const session = createSession({ title: "Active task" });
  const server = await startTestServer();
  try {
    const active = await deleteJson(`${server.baseUrl}/api/sessions/${session.session_id}`);
    assert.equal(active.status, 409);
    assert.equal(active.body.code, "session_not_archived");
    assert.ok(getSession(session.session_id));

    archiveSession(session.session_id, "test");
    const deleted = await deleteJson(`${server.baseUrl}/api/sessions/${session.session_id}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);
    assert.equal(deleted.body.session_id, session.session_id);
    assert.equal(getSession(session.session_id), null);

    const missing = await deleteJson(`${server.baseUrl}/api/sessions/${session.session_id}`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test("DELETE /api/sessions/:sessionId blocks while a linked Run is active", async () => {
  resetTestRoot();
  const session = createSession({ title: "Running task" });
  archiveSession(session.session_id, "test");
  seedRun("run-delete-gate", "queued");
  const stored = getSession(session.session_id);
  assert.ok(stored);
  saveSession({ ...stored, active_run_ids: ["run-delete-gate"] });

  const server = await startTestServer();
  try {
    const blocked = await deleteJson(`${server.baseUrl}/api/sessions/${session.session_id}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "session_has_active_run");
    assert.equal(blocked.body.run_id, "run-delete-gate");
    assert.ok(getSession(session.session_id));

    const run = getRun("run-delete-gate");
    assert.ok(run);
    saveRun({ ...run, status: "completed", finished_at: new Date().toISOString() });

    const deleted = await deleteJson(`${server.baseUrl}/api/sessions/${session.session_id}`);
    assert.equal(deleted.status, 200);
    assert.equal(getSession(session.session_id), null);
    // Run history is retained after the task is deleted.
    assert.ok(getRun("run-delete-gate"));
  } finally {
    await server.close();
  }
});
