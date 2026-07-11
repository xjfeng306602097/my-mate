import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  RuntimeWorkerHub,
  matchesEvidenceDispatchIdentity,
} from "../src/runtime-worker-hub.js";
import type { RuntimeWorkerJob, WorkerEvidence } from "../src/runtime-protocol.js";
import {
  getRuntimeWorkerRecord,
  saveRuntimeWorkerRecord,
} from "../src/runtime/runtime-worker-store.js";
import { resetTestRoot } from "./helpers.js";

test("RuntimeWorkerHub resets persisted live connection states on attach", async () => {
  resetTestRoot();
  saveRuntimeWorkerRecord({
    worker_id: "worker-before-restart",
    status: "busy",
    version: "0.1.0",
    capabilities: [],
    supported_harnesses: ["local"],
    active_job_id: "job-before-restart",
    expected_at: null,
    registered_at: "2026-07-10T00:00:00.000Z",
    last_heartbeat_at: "2026-07-10T00:00:00.000Z",
    disconnected_at: null,
    released_at: null,
    metadata: {},
  });
  const hub = new RuntimeWorkerHub();
  const server = http.createServer();
  hub.attach(server);

  try {
    const worker = getRuntimeWorkerRecord("worker-before-restart");
    assert.equal(worker?.status, "disconnected");
    assert.equal(worker?.active_job_id, null);
    assert.ok(worker?.disconnected_at);
  } finally {
    hub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("RuntimeWorkerHub marks heartbeat-expired workers stale and invokes cleanup", async () => {
  resetTestRoot();
  saveRuntimeWorkerRecord({
    worker_id: "worker-stale",
    status: "connected",
    version: "0.1.0",
    capabilities: [],
    supported_harnesses: ["local"],
    active_job_id: null,
    expected_at: null,
    registered_at: "2026-07-10T00:00:00.000Z",
    last_heartbeat_at: "2026-07-10T00:00:00.000Z",
    disconnected_at: null,
    released_at: null,
    metadata: {},
  });
  const cleaned: string[] = [];
  const hub = new RuntimeWorkerHub();
  hub.setStaleHandler(async (worker) => {
    cleaned.push(worker.worker_id);
  });

  const stale = hub.sweepStaleWorkers(Date.parse("2026-07-10T00:01:00.000Z"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(stale, ["worker-stale"]);
  assert.deepEqual(cleaned, ["worker-stale"]);
  assert.equal(getRuntimeWorkerRecord("worker-stale")?.status, "stale");
  hub.close();
});

test("RuntimeWorkerHub binds evidence identity to the active dispatch", () => {
  const activeJob = {
    job_id: "job-identity",
    run_id: "run-identity",
    node_run_id: "node-identity",
  } as RuntimeWorkerJob;
  const evidence = {
    evidence_id: "evidence-identity",
    job_id: activeJob.job_id,
    run_id: activeJob.run_id,
    node_run_id: activeJob.node_run_id,
    worker_id: "worker-identity",
  } as WorkerEvidence;

  assert.equal(matchesEvidenceDispatchIdentity({
    connectionWorkerId: "worker-identity",
    messageWorkerId: "worker-identity",
    activeJob,
    evidence,
  }), true);
  assert.equal(matchesEvidenceDispatchIdentity({
    connectionWorkerId: "worker-identity",
    messageWorkerId: "worker-identity",
    activeJob,
    evidence: { ...evidence, run_id: "spoofed-run" },
  }), false);
  assert.equal(matchesEvidenceDispatchIdentity({
    connectionWorkerId: "worker-identity",
    messageWorkerId: "spoofed-worker",
    activeJob,
    evidence,
  }), false);
});
