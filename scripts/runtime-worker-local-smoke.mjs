import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controlPlaneDir = path.join(repoRoot, "services", "control-plane");
const gatewayDir = path.join(repoRoot, "services", "api-gateway");
const port = Number(process.env.MY_MATE_LOCAL_SMOKE_PORT || 4211);
const gatewayPort = Number(process.env.MY_MATE_LOCAL_SMOKE_GATEWAY_PORT || 4231);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-local-runtime-"));
const baseUrl = `http://127.0.0.1:${port}`;
const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function seedRuntimeData() {
  const timestamp = new Date().toISOString();
  writeJson(path.join(dataDir, "skills", "local-smoke.json"), {
    skill_id: "local-smoke",
    name: "Local Smoke",
    description: "Deterministic low-risk local runtime smoke skill.",
    category: "runtime",
    allowed_tools: ["read"],
    input_schema: { type: "object" },
    output_contract: { type: "object" },
    tags: ["smoke", "local"],
    status: "active",
    metadata: {},
    created_at: timestamp,
    updated_at: timestamp,
    workspace_id: "default",
  });
  writeJson(path.join(dataDir, "agent-profiles", "local-smoke-agent.json"), {
    profile_id: "local-smoke-agent",
    name: "Local Smoke Agent",
    description: "In-process deterministic Runtime Worker profile.",
    runtime_agent_ref: "local:smoke",
    agent_runtime: "local",
    harness_profile: null,
    provider_connection_id: null,
    model: null,
    default_skills: ["local-smoke"],
    allowed_tools: ["read"],
    disallowed_skills: [],
    policy_tags: ["low-risk"],
    status: "active",
    metadata: {},
    created_at: timestamp,
    updated_at: timestamp,
    workspace_id: "default",
  });
  writeJson(path.join(dataDir, "templates", "local-runtime-smoke.json"), {
    template_id: "local-runtime-smoke",
    version: 1,
    name: "Local Runtime Smoke",
    status: "published",
    description: "One deterministic low-risk task executed in process.",
    workspace_scope: "default",
    input_schema: {
      type: "object",
      properties: { goal: { type: "string" } },
      required: ["goal"],
    },
    policy: {
      max_parallel_nodes: 1,
      default_timeout_seconds: 60,
      budget_policy: {},
      approval_policy: {},
    },
    agent_profile_bindings: { local: "local-smoke-agent" },
    nodes: [{
      id: "local_task",
      name: "Local deterministic task",
      type: "agent_task",
      agent_profile: "local-smoke-agent",
      allowed_skills: ["local-smoke"],
      config: {
        worker_target_kind: "local",
        allowed_tools: ["read"],
        deterministic_output: "LOCAL_SMOKE_OK: summarized low-risk input without Docker.",
        output_contract: { expected_artifacts: ["local-summary"] },
      },
      retry_policy: { max_attempts: 1, backoff_seconds: 0 },
      timeout_seconds: 60,
      parallelism: 1,
      approval_kind: null,
      human_input_schema: null,
    }],
    edges: [],
    metadata: {},
    created_at: timestamp,
    updated_at: timestamp,
    published_at: timestamp,
  });
}

function captureOutput(child) {
  const chunks = { stdout: [], stderr: [] };
  child.stdout?.on("data", (chunk) => chunks.stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => chunks.stderr.push(Buffer.from(chunk)));
  return () => ({
    stdout: Buffer.concat(chunks.stdout).toString("utf8"),
    stderr: Buffer.concat(chunks.stderr).toString("utf8"),
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

async function waitForHealth(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not become healthy.`);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${options?.method || "GET"} ${url} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function waitForRun(runId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const run = await requestJson(`${gatewayBaseUrl}/api/runs/${encodeURIComponent(runId)}`);
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local smoke run ${runId} did not settle.`);
}

seedRuntimeData();
const node = process.execPath;
const controlPlaneTsx = path.join(controlPlaneDir, "node_modules", "tsx", "dist", "cli.mjs");
const gatewayTsx = path.join(gatewayDir, "node_modules", "tsx", "dist", "cli.mjs");
const controlPlane = spawn(node, [controlPlaneTsx, path.join(controlPlaneDir, "src", "server.ts")], {
  cwd: controlPlaneDir,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    MY_MATE_DATA_DIR: dataDir,
    MY_MATE_PUBLIC_BASE_URL: baseUrl,
    MY_MATE_RUNTIME_DISPATCHER: "worker",
    MY_MATE_RUNTIME_DEFAULT_TARGET_KIND: "local",
    MY_MATE_EXECUTION_ADAPTER: "local",
  },
});
const gateway = spawn(node, [gatewayTsx, path.join(gatewayDir, "src", "server.ts")], {
  cwd: gatewayDir,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(gatewayPort),
    MY_MATE_CONTROL_PLANE_BASE_URL: baseUrl,
  },
});
const controlOutput = captureOutput(controlPlane);
const gatewayOutput = captureOutput(gateway);

try {
  await Promise.all([waitForHealth(baseUrl), waitForHealth(gatewayBaseUrl)]);
  const created = await requestJson(`${gatewayBaseUrl}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: "Verify the low-risk local execution path",
      template_id: "local-runtime-smoke",
      validation_mode: "strict",
      inputs: { goal: "Summarize this deterministic local smoke input" },
    }),
  });
  const run = await waitForRun(created.run_id);
  const [runtime, plan, artifacts] = await Promise.all([
    requestJson(`${gatewayBaseUrl}/api/runs/${encodeURIComponent(created.run_id)}/runtime`),
    requestJson(`${gatewayBaseUrl}/api/runs/${encodeURIComponent(created.run_id)}/plan`),
    requestJson(`${gatewayBaseUrl}/api/runs/${encodeURIComponent(created.run_id)}/artifacts`),
  ]);
  const job = runtime.jobs?.[0];
  const nodeProjection = plan.compiled_nodes?.[0];
  if (run.status !== "completed") throw new Error(`Local run ended as ${run.status}: ${run.current_summary}`);
  if (job?.target_kind !== "local" || job?.status !== "completed") {
    throw new Error(`Expected completed local job, received ${JSON.stringify(job)}`);
  }
  if (nodeProjection?.execution_ref?.target_kind !== "local") {
    throw new Error(`Compiled node did not retain local execution: ${JSON.stringify(nodeProjection?.execution_ref)}`);
  }
  if (runtime.summary.active_leases !== 0 || runtime.summary.connected_workers !== 0) {
    throw new Error(`Local mode unexpectedly retained Worker resources: ${JSON.stringify(runtime.summary)}`);
  }
  if (!Array.isArray(artifacts.items) || artifacts.items.length !== 1) {
    throw new Error(`Local mode did not return one artifact: ${JSON.stringify(artifacts)}`);
  }
  console.log(JSON.stringify({
    mode: "local",
    operation: "Create a low-risk deterministic task through Gateway",
    run_id: created.run_id,
    run_status: run.status,
    target_kind: job.target_kind,
    job_status: job.status,
    artifact_count: artifacts.items.length,
    evidence_count: runtime.evidence.length,
    active_jobs: runtime.summary.active_jobs,
    connected_workers: runtime.summary.connected_workers,
    active_leases: runtime.summary.active_leases,
  }, null, 2));
} catch (error) {
  const control = controlOutput();
  const gatewayLog = gatewayOutput();
  throw new Error([
    error instanceof Error ? error.stack || error.message : String(error),
    "--- Control Plane stdout ---",
    control.stdout,
    "--- Control Plane stderr ---",
    control.stderr,
    "--- Gateway stdout ---",
    gatewayLog.stdout,
    "--- Gateway stderr ---",
    gatewayLog.stderr,
  ].join("\n"));
} finally {
  await Promise.all([stopProcess(gateway), stopProcess(controlPlane)]);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
