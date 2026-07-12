import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeWorkerImage } from "./runtime-worker-release.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const port = Number(process.env.MY_MATE_DOCKER_SMOKE_PORT || 4210);
const gatewayPort = Number(process.env.MY_MATE_DOCKER_SMOKE_GATEWAY_PORT || 4230);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-docker-runtime-"));
const baseUrl = `http://127.0.0.1:${port}`;
const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
const image = resolveRuntimeWorkerImage();
const keepData = process.env.MY_MATE_DOCKER_SMOKE_KEEP_DATA === "true";
const superviseTimeoutSeconds = Number(process.env.MY_MATE_DOCKER_SMOKE_TIMEOUT_SECONDS || 90);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result.stdout.trim();
}

async function waitForHealth(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${url} did not become healthy.`);
}

async function waitForRuntimeSettled(runId) {
  const deadline = Date.now() + 10000;
  let projection = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/runs/${runId}/runtime`);
      if (!response.ok) throw new Error(`Runtime projection failed with ${response.status}.`);
      projection = await response.json();
      if (
        projection.summary.active_jobs === 0 &&
        projection.summary.connected_workers === 0 &&
        projection.summary.active_leases === 0
      ) {
        return projection;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Docker runtime resources did not settle: ${JSON.stringify(projection?.summary || {})}; ` +
      `last_error=${lastError instanceof Error ? lastError.message : "none"}`,
  );
}

function captureOutput(process) {
  const chunks = { stdout: [], stderr: [] };
  const capture = (target) => (chunk) => {
    target.push(Buffer.from(chunk));
    while (target.reduce((total, item) => total + item.length, 0) > 128 * 1024) target.shift();
  };
  process.stdout?.on("data", capture(chunks.stdout));
  process.stderr?.on("data", capture(chunks.stderr));
  return () => ({
    stdout: Buffer.concat(chunks.stdout).toString("utf-8"),
    stderr: Buffer.concat(chunks.stderr).toString("utf-8"),
  });
}

async function stopProcess(process) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exited = new Promise((resolve) => process.once("exit", resolve));
  process.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

run("docker", ["version", "--format", "{{.Server.Version}}"]);
if (process.env.MY_MATE_RUNTIME_WORKER_BUILD_BEFORE_SMOKE === "true") {
  run(process.execPath, [path.join(repoRoot, "scripts", "build-runtime-worker-image.mjs")]);
}
run("docker", ["image", "inspect", image, "--format", "{{.Id}}"]);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required to build the CLI for smoke testing.");
run(process.execPath, [npmCli, "--prefix", "apps/cli", "run", "build"]);

const tsx = path.join(repoRoot, "services", "control-plane", "node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(process.execPath, [tsx, path.join(repoRoot, "services/control-plane/src/server.ts")], {
  cwd: path.join(repoRoot, "services", "control-plane"),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    MY_MATE_PUBLIC_BASE_URL: baseUrl,
    MY_MATE_DATA_DIR: dataDir,
    MY_MATE_RUNTIME_DISPATCHER: "docker-worker",
    MY_MATE_RUNTIME_DEFAULT_TARGET_KIND: "docker-worker",
    MY_MATE_RUNTIME_WORKER_IMAGE: image,
    MY_MATE_EXECUTION_ADAPTER: "local",
  },
});
const gatewayTsx = path.join(repoRoot, "services", "api-gateway", "node_modules", "tsx", "dist", "cli.mjs");
const gatewayChild = spawn(
  process.execPath,
  [gatewayTsx, path.join(repoRoot, "services/api-gateway/src/server.ts")],
  {
    cwd: path.join(repoRoot, "services", "api-gateway"),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(gatewayPort),
      MY_MATE_CONTROL_PLANE_BASE_URL: baseUrl,
      MY_MATE_API_GATEWAY_REQUEST_TIMEOUT_MS: "120000",
    },
  },
);
const controlPlaneOutput = captureOutput(child);
const gatewayOutput = captureOutput(gatewayChild);
const cli = path.join(repoRoot, "apps", "cli", "dist", "src", "index.js");

function runCli(args) {
  const stdout = run(process.execPath, [cli, "--base-url", gatewayBaseUrl, ...args]);
  return stdout ? JSON.parse(stdout) : null;
}

async function getGatewayJson(pathname) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${gatewayBaseUrl}${pathname}`);
      if (!response.ok) {
        throw new Error(`Gateway ${pathname} failed with ${response.status}: ${await response.text()}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.startsWith(`Gateway ${pathname} failed with`)) {
        throw error;
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      }
    }
  }
  throw lastError || new Error(`Gateway ${pathname} failed.`);
}

try {
  await waitForHealth(baseUrl);
  await waitForHealth(gatewayBaseUrl);
  const doctor = runCli(["doctor", "--mode", "docker", "--json"]);
  if (!doctor.runtime_ready || !doctor.deterministic_ready) {
    throw new Error(`Docker doctor failed: ${JSON.stringify(doctor)}`);
  }
  if (doctor.model_ready !== false || doctor.model_verified !== null) {
    throw new Error("Docker doctor did not keep model readiness independent.");
  }
  const doctorChecks = new Map(doctor.checks.map((check) => [check.id, check]));
  if (doctorChecks.get("worker.capacity")?.status !== "pass") {
    throw new Error(`Docker doctor did not verify Worker capacity: ${JSON.stringify(doctorChecks.get("worker.capacity"))}`);
  }
  if (doctorChecks.get("docker.image_healthcheck")?.status !== "pass") {
    throw new Error(`Docker doctor did not verify the image healthcheck: ${JSON.stringify(doctorChecks.get("docker.image_healthcheck"))}`);
  }
  const templateResponse = await fetch(`${gatewayBaseUrl}/api/templates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      template_id: "docker-worker-smoke",
      name: "Docker Worker Smoke",
      description: "Two-node Docker runtime smoke with a real handoff.",
      domain: "runtime",
      status: "draft",
      version: 1,
      workspace_scope: "isolated",
      input_schema: {
        type: "object",
        properties: { goal: { type: "string" } },
        required: ["goal"],
      },
      policy: {
        max_parallel_nodes: 1,
        default_timeout_seconds: 120,
        budget_policy: {},
        approval_policy: {},
      },
      nodes: [
        {
          id: "draft",
          name: "Draft Summary",
          type: "agent_task",
          agent_profile: null,
          allowed_skills: [],
          config: {
            worker_target_kind: "docker-worker",
            deterministic_output:
              "Release checklist:\n1. Confirm scope.\n2. Build the backend.\n3. Run smoke tests.\n4. Verify rollback.\n5. Publish release notes.",
            output_contract: { expected_artifacts: ["draft-summary"] },
          },
          retry_policy: { max_attempts: 1, backoff_seconds: 0 },
          timeout_seconds: 120,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
          work_package: { key: "draft", label: "Draft", order: 10 },
        },
        {
          id: "review",
          name: "Review Summary",
          type: "agent_task",
          agent_profile: null,
          allowed_skills: [],
          config: {
            worker_target_kind: "docker-worker",
            deterministic_output: "Review passed for upstream output: {{upstream}}",
            output_contract: { expected_artifacts: ["review-summary"] },
          },
          retry_policy: { max_attempts: 1, backoff_seconds: 0 },
          timeout_seconds: 120,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
          work_package: { key: "review", label: "Review", order: 20 },
        },
      ],
      edges: [{ from: "draft", to: "review", condition: null, label: "then" }],
      output_contract: {},
      metadata: {},
    }),
  });
  if (!templateResponse.ok) throw new Error(await templateResponse.text());
  const publishResponse = await fetch(`${gatewayBaseUrl}/api/templates/docker-worker-smoke/publish`, { method: "POST" });
  if (!publishResponse.ok) throw new Error(await publishResponse.text());
  const created = runCli([
    "run",
    "--template-id",
    "docker-worker-smoke",
    "--intent",
    "Verify Docker worker execution",
    "--input",
    "goal=Write a runtime smoke summary",
    "--validation-mode",
    "bypass",
    "--json",
  ]);
  if (created.route?.route_id !== "template:docker-worker-smoke@1") {
    throw new Error(`Direct run route identity is invalid: ${JSON.stringify(created.route)}`);
  }
  if (created.route?.work_packages?.length !== 2) {
    throw new Error("Direct run did not preserve both explicit work packages.");
  }
  const supervised = runCli([
    "supervise",
    created.run_id,
    "--follow",
    "--timeout",
    String(superviseTimeoutSeconds),
    "--json",
  ]);
  if (supervised.status !== "completed" || !supervised.settled) {
    throw new Error(`Docker runtime smoke did not settle: ${JSON.stringify(supervised)}`);
  }
  const scorecard = runCli(["scorecard", created.run_id, "--json"]);
  if (scorecard.pipeline_verdict !== "pass") {
    throw new Error(`Docker scorecard did not pass: ${JSON.stringify(scorecard)}`);
  }
  const evaluation = runCli(["eval", created.run_id, "--evaluator", "none", "--json"]);
  if (
    evaluation.status !== "completed" ||
    evaluation.pipeline_verdict !== "pass" ||
    evaluation.contract_verdict !== "not_applicable" ||
    evaluation.quality_verdict !== "not_evaluated"
  ) {
    throw new Error(`Deterministic evaluation conflated verdict dimensions: ${JSON.stringify(evaluation)}`);
  }
  const trace = runCli(["trace", created.run_id, "--json"]);
  if (
    trace.completeness !== "complete" ||
    !trace.spans.some((span) => span.kind === "run") ||
    trace.spans.filter((span) => span.kind === "node").length !== 2 ||
    trace.spans.filter((span) => span.kind === "job").length !== 2 ||
    trace.spans.filter((span) => span.kind === "handoff").length !== 2 ||
    trace.spans.filter((span) => span.kind === "artifact").length !== 2
  ) {
    throw new Error(`Docker trace projection is incomplete: ${JSON.stringify(trace)}`);
  }
  const replay = runCli(["replay", created.run_id, "--json"]);
  if (
    replay.event_completeness !== "complete" ||
    replay.verification !== "pass" ||
    replay.projection_differences.length !== 0 ||
    replay.missing_references.length !== 0
  ) {
    throw new Error(`Docker audit replay did not match persisted projections: ${JSON.stringify(replay)}`);
  }
  const replayPlan = runCli(["replay-plan", created.run_id, "--json"]);
  if (replayPlan.replay_id !== replay.replay_id || replayPlan.recommendations.length !== 0) {
    throw new Error(`Docker replay plan invented remediation for an aligned run: ${JSON.stringify(replayPlan)}`);
  }
  const surfaceRuntime = await getGatewayJson(`/api/runs/${encodeURIComponent(created.run_id)}/runtime`);
  const surfaceScorecards = await getGatewayJson(`/api/runs/${encodeURIComponent(created.run_id)}/scorecards`);
  const surfaceEvaluations = await getGatewayJson(`/api/runs/${encodeURIComponent(created.run_id)}/evaluations`);
  const surfaceTrace = await getGatewayJson(`/api/runs/${encodeURIComponent(created.run_id)}/trace?limit=500`);
  const surfaceReplay = await getGatewayJson(`/api/runs/${encodeURIComponent(created.run_id)}/replays/${encodeURIComponent(replay.replay_id)}`);
  if (
    surfaceRuntime.projection_version !== 2 ||
    surfaceRuntime.run_id !== created.run_id ||
    surfaceRuntime.route?.route_id !== created.route.route_id ||
    !Array.isArray(surfaceRuntime.graph?.nodes) ||
    surfaceRuntime.graph.nodes.length !== 2 ||
    !Array.isArray(surfaceRuntime.evidence) ||
    surfaceRuntime.evidence.some((item) => item.evidence_schema_version !== 2) ||
    !surfaceRuntime.provider_evidence?.usage
  ) {
    throw new Error(`Studio/Mobile runtime projection contract is invalid: ${JSON.stringify(surfaceRuntime)}`);
  }
  if (
    surfaceScorecards.items?.at(-1)?.scorecard_id !== scorecard.scorecard_id ||
    surfaceScorecards.items?.at(-1)?.pipeline_verdict !== "pass"
  ) {
    throw new Error(`Studio/Mobile scorecard list contract is invalid: ${JSON.stringify(surfaceScorecards)}`);
  }
  if (
    surfaceEvaluations.items?.at(-1)?.evaluation_id !== evaluation.evaluation_id ||
    surfaceEvaluations.items?.at(-1)?.quality_verdict !== "not_evaluated"
  ) {
    throw new Error(`Studio/Mobile evaluation list contract is invalid: ${JSON.stringify(surfaceEvaluations)}`);
  }
  if (
    surfaceTrace.trace_id !== trace.trace_id ||
    surfaceTrace.completeness !== "complete" ||
    !surfaceTrace.spans.some((span) => span.kind === "handoff")
  ) {
    throw new Error(`Studio/Mobile trace contract is invalid: ${JSON.stringify(surfaceTrace)}`);
  }
  if (surfaceReplay.replay_id !== replay.replay_id || surfaceReplay.verification !== "pass") {
    throw new Error(`Studio/Mobile replay contract is invalid: ${JSON.stringify(surfaceReplay)}`);
  }
  const projection = await waitForRuntimeSettled(created.run_id);
  if (projection.jobs.length !== 2 || projection.jobs.some((job) => job.status !== "completed")) {
    throw new Error("Docker runtime smoke did not complete both worker jobs.");
  }
  if (projection.summary.handoffs < 2 || projection.summary.artifacts < 2) {
    throw new Error("Docker runtime smoke did not preserve both handoffs and artifacts.");
  }
  if (
    projection.evidence.length !== 10 ||
    projection.evidence.some((item) =>
      item.evidence_schema_version !== 2 || item.source?.synthetic !== true
    )
  ) {
    throw new Error("Docker runtime smoke did not persist ten synthetic Evidence V2 records.");
  }
  for (const job of projection.jobs) {
    const sequences = projection.evidence
      .filter((item) => item.job_id === job.job_id)
      .map((item) => item.sequence);
    if (JSON.stringify(sequences) !== JSON.stringify([1, 2, 3, 4, 5])) {
      throw new Error(`Docker Worker evidence is not monotonically sequenced: ${JSON.stringify(sequences)}`);
    }
  }
  if (
    projection.evidence.some((item) => item.kind === "tool_call" || item.kind === "tool_result") ||
    projection.evidence
      .filter((item) => item.kind === "usage")
      .some((item) => item.usage?.availability !== "unavailable")
  ) {
    throw new Error("Synthetic Docker harness claimed provider-native tools or usage.");
  }
  const reviewJob = projection.jobs.find((job) => job.job?.node_id === "review")?.job;
  if (!JSON.stringify(reviewJob?.envelope?.input_payload || {}).includes("Confirm scope")) {
    throw new Error("Docker runtime smoke did not deliver the draft handoff to the review job.");
  }
  if (!JSON.stringify(projection.handoffs).includes("Verify rollback")) {
    throw new Error("Docker runtime smoke did not preserve task-specific handoff content.");
  }
  console.log(JSON.stringify({
    doctor,
    run: supervised,
    scorecard,
    evaluation,
    trace,
    replay,
    replay_plan: replayPlan,
    runtime: projection.summary,
    surface_contract: {
      projection_version: surfaceRuntime.projection_version,
      nodes: surfaceRuntime.graph.nodes.length,
      evidence: surfaceRuntime.evidence.length,
      scorecards: surfaceScorecards.items.length,
      evaluations: surfaceEvaluations.items.length,
      trace_spans: surfaceTrace.spans.length,
      replay_verification: surfaceReplay.verification,
    },
  }, null, 2));
} catch (error) {
  const control = controlPlaneOutput();
  const gateway = gatewayOutput();
  throw new Error([
    error instanceof Error ? error.stack || error.message : String(error),
    `Control Plane process: exit=${child.exitCode ?? "running"}; signal=${child.signalCode || "none"}`,
    `Gateway process: exit=${gatewayChild.exitCode ?? "running"}; signal=${gatewayChild.signalCode || "none"}`,
    `Smoke data: ${dataDir}`,
    "--- Control Plane stdout ---",
    control.stdout,
    "--- Control Plane stderr ---",
    control.stderr,
    "--- Gateway stdout ---",
    gateway.stdout,
    "--- Gateway stderr ---",
    gateway.stderr,
  ].join("\n"));
} finally {
  await Promise.all([stopProcess(gatewayChild), stopProcess(child)]);
  if (!keepData) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
