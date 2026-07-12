import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildWorkerEvidenceV2 } from "../src/evidence-normalizer.js";
import { createRuntimeWorkerServer } from "../src/server.js";
import { runRuntimeWorkerJob } from "../src/worker-runtime.js";
import type { RuntimeWorkerJob, WorkerEvent } from "../src/types.js";

export function buildJob(): RuntimeWorkerJob {
  return {
    job_id: "run-worker-001:node-worker-001:attempt-1:dispatch-1",
    run_id: "run-worker-001",
    node_run_id: "node-worker-001",
    node_id: "node_worker",
    node_name: "Worker Node",
    node_type: "agent_task",
    attempt: 1,
    dispatch_sequence: 1,
    envelope: {
      run_id: "run-worker-001",
      node_run_id: "node-worker-001",
      template_id: "template-worker",
      template_version: 1,
      workspace_id: "workspace-worker",
      requested_by: "tester",
      intent: "Run local worker",
      node_id: "node_worker",
      node_name: "Worker Node",
      node_type: "agent_task",
      agent_profile: "local-agent",
      runtime_agent_ref: null,
      agent_runtime: "local",
      harness_profile: null,
      openclaw_agent_id: null,
      allowed_skills: [],
      allowed_tools: [],
      registry_provenance: {
        agent_profile_requested: "local-agent",
        agent_profile_resolved: "local-agent",
        agent_profile_status: "active",
        agent_profile_source: "registry",
        runtime_agent_ref_source: "registry",
        openclaw_agent_id_source: "registry",
        skill_bindings: [],
        tool_bindings: [],
      },
      timeout_seconds: 900,
      parallelism_budget: 1,
      retry_policy: {
        max_attempts: 1,
        attempt: 1,
      },
      input_payload: {
        node_config: {},
      },
      output_contract: {},
      trace_context: {
        run_id: "run-worker-001",
        node_run_id: "node-worker-001",
        requested_by: "tester",
      },
    },
    harness: {
      agent_runtime: "local",
      runtime_agent_ref: null,
      harness_profile: null,
      allowed_skills: [],
      allowed_tools: [],
    },
    provision: {
      required: false,
      target_kind: "local",
      image: null,
      container_group: null,
      required_capabilities: [],
      env: {},
      workspace: {
        workspace_id: "workspace-worker",
        mode: "shared",
        project_slug: null,
        project_local_repo: null,
        metadata: {},
      },
    },
    trace_context: {
      run_id: "run-worker-001",
      node_run_id: "node-worker-001",
      requested_by: "tester",
    },
    created_at: "2026-07-10T00:00:00.000Z",
  };
}

test("runtime worker local harness emits accepted progress handoff completed events", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-local-harness-"));
  const previousWorkspace = process.env.MY_MATE_WORKSPACE;
  process.env.MY_MATE_WORKSPACE = tempRoot;

  try {
    const job = buildJob();
    job.envelope.input_payload = {
      node_config: {
        deterministic_output: "Checklist for {{intent}} with {{upstream}}",
      },
      upstream_handoffs: [
        {
          content: { summary: "upstream context" },
        },
      ],
    };
    const result = await runRuntimeWorkerJob(job, {
      workerId: "runtime-worker-local",
    });

    assert.equal(result.events.length, 4);
    assert.equal(result.events[0]?.kind, "worker.accepted");
    assert.equal(result.events[1]?.kind, "worker.progress");
    assert.equal(result.events[2]?.kind, "worker.handoff");
    assert.equal(result.events[3]?.kind, "worker.completed");
    const completedEvent = result.events[3] as WorkerEvent;
    assert.ok("report" in completedEvent);
    assert.equal(completedEvent.report.artifacts.length, 1);
    assert.equal(completedEvent.sequence, 4);
    assert.match(completedEvent.idempotency_key, /worker\.completed$/);
    const handoffEvent = result.events[2];
    assert.ok(handoffEvent?.kind === "worker.handoff");
    const handoffContent = handoffEvent.handoff.content as { summary?: string };
    assert.equal(
      handoffContent.summary,
      "Checklist for Run local worker with upstream context",
    );
    const artifactPath = path.join(
      tempRoot,
      "artifacts",
      job.run_id,
      job.node_run_id,
      "summary.txt",
    );
    assert.match(fs.readFileSync(artifactPath, "utf-8"), /Checklist for Run local worker/);
    assert.deepEqual(result.evidence.map((item) => item.sequence), [1, 2, 3, 4, 5]);
    assert.ok(result.evidence.every((item) => item.evidence_schema_version === 2));
    assert.ok(result.evidence.every((item) => item.source?.synthetic === true));
    assert.equal(result.evidence.find((item) => item.kind === "usage")?.usage?.availability, "unavailable");
    assert.equal(result.evidence.some((item) => item.kind === "tool_call"), false);
  } finally {
    if (previousWorkspace === undefined) {
      delete process.env.MY_MATE_WORKSPACE;
    } else {
      process.env.MY_MATE_WORKSPACE = previousWorkspace;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runtime worker server runs a RuntimeWorkerJob over HTTP", async () => {
  const app = createRuntimeWorkerServer();
  const server = await new Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }>((resolve) => {
    app.listen(0, "127.0.0.1", () => {
      const address = app.address();
      if (!address || typeof address === "string") {
        throw new Error("Worker test server address missing.");
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done, reject) => {
            app.close((error?: Error | undefined) => {
              if (error) {
                reject(error);
                return;
              }
              done();
            });
          }),
      });
    });
  });

  try {
    const healthResponse = await fetch(`${server.baseUrl}/health`);
    const health = (await healthResponse.json()) as {
      status: string;
      build: {
        version: string;
        image_reference: string | null;
        revision: string | null;
      };
    };
    assert.equal(healthResponse.status, 200);
    assert.equal(health.status, "ok");
    assert.equal(health.build.version, "0.1.0");
    assert.equal(health.build.image_reference, null);
    assert.equal(health.build.revision, null);

    const response = await fetch(`${server.baseUrl}/api/runtime-worker/jobs/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(buildJob()),
    });
    assert.equal(response.status, 202);
    const body = (await response.json()) as {
      worker_id: string;
      events: Array<{ kind: string }>;
    };
    assert.equal(body.worker_id, "runtime-worker-local");
    assert.equal(body.events.length, 4);
    assert.equal(body.events[2]?.kind, "worker.handoff");
    assert.equal(body.events[3]?.kind, "worker.completed");
  } finally {
    await server.close();
  }
});

test("runtime worker command harness executes configured backend and writes output artifact", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-command-harness-"));
  const scriptPath = path.join(tempRoot, "backend.mjs");
  fs.writeFileSync(
    scriptPath,
    [
      "let prompt = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { prompt += chunk; });",
      "process.stdin.on('end', () => {",
      "  process.stdout.write(`backend received ${prompt.length} chars for ${process.env.MY_MATE_JOB_ID}`);",
      "});",
    ].join("\n"),
    "utf-8",
  );
  const previousWorkspace = process.env.MY_MATE_WORKSPACE;
  const previousCommand = process.env.MY_MATE_CODEX_COMMAND;
  process.env.MY_MATE_WORKSPACE = tempRoot;
  process.env.MY_MATE_CODEX_COMMAND = `"${process.execPath}" "${scriptPath}"`;

  try {
    const job = buildJob();
    job.harness.agent_runtime = "codex";
    job.harness.runtime_agent_ref = "codex-test";
    job.provision.target_kind = "docker-worker";
    job.provision.required = true;
    const result = await runRuntimeWorkerJob(job, { workerId: "worker-command" });

    assert.deepEqual(
      result.events.map((event) => event.kind),
      ["worker.accepted", "worker.progress", "worker.handoff", "worker.completed"],
    );
    const completed = result.events[3];
    assert.ok(completed && "report" in completed);
    assert.match(completed.report.progress.message, /backend received \d+ chars/);
    const artifactPath = path.join(
      tempRoot,
      "artifacts",
      job.run_id,
      job.node_run_id,
      "harness-output.txt",
    );
    assert.match(fs.readFileSync(artifactPath, "utf-8"), /backend received/);
    assert.ok(
      fs.existsSync(path.join(tempRoot, ".my-mate", "jobs")),
      "command harness should persist the complete job envelope",
    );
    const textEvidence = result.evidence.find((item) => item.kind === "model_text");
    assert.equal(textEvidence?.source?.provider, "codex");
    assert.equal(textEvidence?.source?.synthetic, true);
    assert.equal(result.evidence.find((item) => item.kind === "usage")?.usage?.availability, "unavailable");
  } finally {
    if (previousWorkspace === undefined) {
      delete process.env.MY_MATE_WORKSPACE;
    } else {
      process.env.MY_MATE_WORKSPACE = previousWorkspace;
    }
    if (previousCommand === undefined) {
      delete process.env.MY_MATE_CODEX_COMMAND;
    } else {
      process.env.MY_MATE_CODEX_COMMAND = previousCommand;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runtime worker command harness streams recognized provider JSONL as native evidence", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-native-command-"));
  const scriptPath = path.join(tempRoot, "native-backend.mjs");
  fs.writeFileSync(
    scriptPath,
    [
      "process.stdin.resume();",
      "process.stdin.on('end', () => {",
      "  console.log(JSON.stringify({ type: 'turn.started', id: 'turn-native', model: 'codex-native-test' }));",
      "  console.log(JSON.stringify({ type: 'item.agentMessage.delta', params: { item_id: 'message-native', delta: 'native output' } }));",
      "  console.log(JSON.stringify({ type: 'turn.completed', id: 'turn-native-done', params: { usage: { input_tokens: 12, output_tokens: 3 } } }));",
      "});",
    ].join("\n"),
    "utf-8",
  );
  const previousWorkspace = process.env.MY_MATE_WORKSPACE;
  const previousCommand = process.env.MY_MATE_CODEX_COMMAND;
  process.env.MY_MATE_WORKSPACE = tempRoot;
  process.env.MY_MATE_CODEX_COMMAND = `"${process.execPath}" "${scriptPath}"`;

  try {
    const job = buildJob();
    job.harness.agent_runtime = "codex";
    const result = await runRuntimeWorkerJob(job, { workerId: "worker-native-command" });
    const native = result.evidence.filter((item) => item.source?.synthetic === false);
    assert.deepEqual(native.map((item) => item.kind), ["model_turn", "model_text", "usage", "model_turn"]);
    assert.equal(native.find((item) => item.kind === "model_text")?.summary, "native output");
    assert.equal(native.find((item) => item.kind === "usage")?.usage?.total_tokens, 15);
    assert.equal(native.every((item) => item.source?.model === "codex-native-test"), true);
    assert.equal(
      result.evidence.some((item) => item.kind === "usage" && item.source?.synthetic === true),
      false,
    );
  } finally {
    if (previousWorkspace === undefined) delete process.env.MY_MATE_WORKSPACE;
    else process.env.MY_MATE_WORKSPACE = previousWorkspace;
    if (previousCommand === undefined) delete process.env.MY_MATE_CODEX_COMMAND;
    else process.env.MY_MATE_CODEX_COMMAND = previousCommand;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("worker evidence V2 redacts secrets and externalizes oversized payloads", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-evidence-v2-"));
  const previousWorkspace = process.env.MY_MATE_WORKSPACE;
  process.env.MY_MATE_WORKSPACE = tempRoot;
  try {
    const record = buildWorkerEvidenceV2({
      job: buildJob(),
      workerId: "worker-evidence-v2",
      sequence: 7,
      event: {
        kind: "tool_call",
        summary: "Authorization: Bearer secret-bearer-token",
        source: {
          provider: "codex",
          model: "provider-model",
          native_event_id: "native-tool-7",
          synthetic: false,
        },
        trace: { tool_call_id: "tool-call-7" },
        sensitive_paths: ["arguments.private_value"],
        inline_payload: {
          api_key: "sk-abcdefghijklmnopqrstuvwxyz",
          arguments: {
            private_value: "private",
            content: "x".repeat(40 * 1024),
          },
        },
      },
    });

    assert.equal(record.evidence_schema_version, 2);
    assert.equal(record.sequence, 7);
    assert.equal(record.source?.synthetic, false);
    assert.equal(record.trace?.tool_call_id, "tool-call-7");
    assert.equal(record.redaction_status, "redacted");
    assert.match(record.summary, /\[REDACTED\]/);
    assert.match(record.output_ref || "", /^workspace:\/\//);
    const inline = record.inline_payload as { externalized?: boolean; reference?: string };
    assert.equal(inline.externalized, true);
    const relativePath = String(inline.reference).replace("workspace://", "").split("/");
    const externalized = fs.readFileSync(path.join(tempRoot, ...relativePath), "utf-8");
    assert.doesNotMatch(externalized, /abcdefghijklmnopqrstuvwxyz|private"/);
    assert.match(externalized, /\[REDACTED\]/);
  } finally {
    if (previousWorkspace === undefined) delete process.env.MY_MATE_WORKSPACE;
    else process.env.MY_MATE_WORKSPACE = previousWorkspace;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
