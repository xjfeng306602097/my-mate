import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { saveArtifact } from "../src/artifact-store.js";
import { saveWorkerLeaseRecord } from "../src/runtime/worker-lease-store.js";
import { saveRun } from "../src/run-store.js";
import { resetTestRoot, startTestServer, TEST_ROOT } from "./helpers.js";

test("runtime artifacts support safe preview and binary download from a Worker workspace", async () => {
  resetTestRoot();
  const runId = `run-artifact-${Date.now()}`;
  const nodeRunId = "node-artifact-1";
  const workspace = path.join(TEST_ROOT, `${runId}-workspace`);
  const relativePath = path.join(".my-mate", "outputs", nodeRunId, "report.pdf");
  const filePath = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
  fs.writeFileSync(filePath, bytes);
  saveRun({
    run_id: runId,
    template_id: "artifact-test",
    template_version: 1,
    workspace_id: "default",
    requested_by: "tester",
    intent: "Generate report.pdf",
    status: "completed",
    current_summary: "Completed",
    waiting_reason: null,
    blocked_reason: null,
    started_at: "2026-07-14T00:00:00.000Z",
    finished_at: "2026-07-14T00:01:00.000Z",
    last_event_id: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:01:00.000Z",
    inputs: {},
    proposal_id: null,
  });
  saveArtifact({
    artifact_id: "artifact-runtime-pdf",
    run_id: runId,
    node_run_id: nodeRunId,
    type: "deliverable",
    name: "report.pdf",
    storage_uri: `workspace://.my-mate/outputs/${nodeRunId}/report.pdf`,
    mime_type: "application/pdf",
    size_bytes: bytes.length,
    created_at: "2026-07-14T00:01:00.000Z",
  });
  saveWorkerLeaseRecord({
    lease_id: "lease-artifact-test",
    worker_id: "worker-artifact-test",
    job_id: "job-artifact-test",
    target_kind: "docker-worker",
    run_id: runId,
    node_run_id: nodeRunId,
    container_id: null,
    execution_ref: null,
    acquired_at: "2026-07-14T00:00:00.000Z",
    last_heartbeat_at: null,
    expires_at: null,
    released_at: "2026-07-14T00:01:00.000Z",
    release_reason: "completed",
    status: "released",
    last_error: null,
    metadata: { workspace_host_path: workspace },
  });
  const server = await startTestServer();
  try {
    const preview = await fetch(`${server.baseUrl}/api/runs/${runId}/artifacts/artifact-runtime-pdf`);
    assert.equal(preview.status, 200);
    const previewBody = await preview.json();
    assert.equal(previewBody.preview_kind, "pdf");
    assert.match(previewBody.preview_uri, /inline=1$/);

    const download = await fetch(`${server.baseUrl}/api/runs/${runId}/artifacts/artifact-runtime-pdf/download`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  } finally {
    await server.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime artifact routes reject workspace traversal", async () => {
  resetTestRoot();
  const runId = `run-artifact-traversal-${Date.now()}`;
  saveRun({
    run_id: runId,
    template_id: "artifact-test",
    template_version: 1,
    workspace_id: "default",
    requested_by: "tester",
    intent: "Traversal test",
    status: "completed",
    current_summary: "Completed",
    waiting_reason: null,
    blocked_reason: null,
    started_at: null,
    finished_at: null,
    last_event_id: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
    inputs: {},
    proposal_id: null,
  });
  saveArtifact({
    artifact_id: "artifact-traversal",
    run_id: runId,
    node_run_id: null,
    type: "deliverable",
    name: "secret.txt",
    storage_uri: "workspace://../secret.txt",
    mime_type: "text/plain",
    size_bytes: 6,
    created_at: "2026-07-14T00:00:00.000Z",
  });
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/runs/${runId}/artifacts/artifact-traversal/download`);
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});
