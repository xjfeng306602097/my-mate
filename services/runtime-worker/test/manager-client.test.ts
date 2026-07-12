import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeWorkerManagerClient } from "../src/manager-client.js";
import type { WorkerEvidence, WorkerEvent } from "../src/types.js";
import { buildJob } from "./worker-runtime.test.js";

test("manager hub and runtime worker client complete the websocket job lifecycle", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-worker-hub-"));
  const previousDataDir = process.env.MY_MATE_DATA_DIR;
  process.env.MY_MATE_DATA_DIR = dataDir;
  const hubModuleUrl = new URL(
    "../../control-plane/src/runtime-worker-hub.ts",
    import.meta.url,
  ).href;
  const hubModule = await import(hubModuleUrl);
  const hub = new hubModule.RuntimeWorkerHub();
  const server = http.createServer((_req, res) => res.end("ok"));
  hub.attach(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const workerId = "worker-integration-001";
  const token = "worker-integration-token";
  hub.expectWorker({ workerId, token });
  const managerUrl = hubModule.runtimeWorkerWebSocketUrl(
    `http://127.0.0.1:${address.port}`,
    workerId,
  );
  const events: WorkerEvent[] = [];
  const evidence: WorkerEvidence[] = [];
  const observedMessages: string[] = [];
  let resolveCompleted: (() => void) | null = null;
  let resolveArtifactEvidence: (() => void) | null = null;
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve;
  });
  const artifactEvidence = new Promise<void>((resolve) => {
    resolveArtifactEvidence = resolve;
  });
  hub.setEventHandler(async (event: WorkerEvent) => {
    events.push(event);
    observedMessages.push(`event:${event.kind}`);
    if (event.kind === "worker.completed") {
      resolveCompleted?.();
    }
  });
  hub.setEvidenceHandler(async (item: WorkerEvidence) => {
    evidence.push(item);
    observedMessages.push(`evidence:${item.kind}`);
    if (item.kind === "artifact_ref") {
      resolveArtifactEvidence?.();
    }
  });
  const client = new RuntimeWorkerManagerClient({
    managerUrl,
    workerId,
    token,
    reconnectDelayMs: 50,
    exitOnRelease: false,
  });

  try {
    client.start();
    const worker = await hub.waitForWorker(workerId, 3000);
    assert.equal(worker.status, "connected");
    assert.equal(worker.version, "0.1.0");
    assert.deepEqual(worker.metadata.build, {
      version: "0.1.0",
      image_reference: null,
      revision: null,
      built_at: null,
      source: null,
    });
    assert.ok(worker.supported_harnesses.includes("local"));

    const job = buildJob();
    const ack = await hub.dispatchJob(workerId, job, 3000);
    assert.equal(ack.status, "accepted");
    await Promise.race([
      Promise.all([completed, artifactEvidence]),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("Worker did not complete websocket job.")), 5000),
      ),
    ]);

    assert.deepEqual(
      events.map((event) => event.kind),
      ["worker.accepted", "worker.progress", "worker.handoff", "worker.completed"],
    );
    assert.ok(evidence.some((item) => item.kind === "prompt"));
    assert.ok(evidence.some((item) => item.kind === "handoff"));
    assert.ok(evidence.some((item) => item.kind === "artifact_ref"));
    assert.ok(evidence.every((item) => item.evidence_schema_version === 2));
    assert.deepEqual(evidence.map((item) => item.sequence), evidence.map((_item, index) => index + 1));
    assert.equal(evidence.find((item) => item.kind === "usage")?.usage?.availability, "unavailable");
    assert.ok(
      observedMessages.lastIndexOf("evidence:usage") < observedMessages.indexOf("event:worker.completed"),
      "all evidence must arrive before the terminal Worker event",
    );

    hub.releaseWorker(workerId, "test_complete");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(hub.getSummary().connected_workers, 0);
  } finally {
    client.stop();
    hub.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousDataDir === undefined) {
      delete process.env.MY_MATE_DATA_DIR;
    } else {
      process.env.MY_MATE_DATA_DIR = previousDataDir;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
