import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeWorkerImage } from "./runtime-worker-release.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const port = Number(process.env.MY_MATE_DOCKER_RECOVERY_SMOKE_PORT || 4311);
const baseUrl = `http://127.0.0.1:${port}`;
const image = resolveRuntimeWorkerImage();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-worker-recovery-"));
const suffix = `${process.pid}-${Date.now()}`;
const matchedContainerName = `my-mate-recovery-matched-${suffix}`;
const orphanContainerName = `my-mate-recovery-orphan-${suffix}`;
const runId = `run-recovery-smoke-${suffix}`;
const jobId = `job-recovery-smoke-${suffix}`;
const leaseId = `lease:${jobId}`;
const workerId = `worker-${jobId}`;
const managerId = `recovery-smoke-${suffix}`;

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

function startControlPlane() {
  const tsx = path.join(
    repoRoot,
    "services",
    "control-plane",
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  return spawn(
    process.execPath,
    [tsx, path.join(repoRoot, "services/control-plane/src/server.ts")],
    {
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
        MY_MATE_RUNTIME_MANAGER_ID: managerId,
        MY_MATE_EXECUTION_ADAPTER: "local",
      },
    },
  );
}

function captureOutput(child) {
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  return () => ({
    stdout: Buffer.concat(stdout).toString("utf-8"),
    stderr: Buffer.concat(stderr).toString("utf-8"),
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${baseUrl} did not become healthy.`);
}

async function stopProcess(child, abrupt = false) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill(abrupt ? "SIGKILL" : "SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

function writeActiveLease(containerId) {
  const leaseDir = path.join(dataDir, "worker-leases", encodeURIComponent(runId));
  fs.mkdirSync(leaseDir, { recursive: true });
  fs.writeFileSync(
    path.join(leaseDir, `${encodeURIComponent(leaseId)}.json`),
    JSON.stringify({
      lease_id: leaseId,
      worker_id: workerId,
      job_id: jobId,
      target_kind: "docker-worker",
      run_id: runId,
      node_run_id: `node-${jobId}`,
      container_id: containerId,
      execution_ref: null,
      acquired_at: new Date().toISOString(),
      last_heartbeat_at: null,
      expires_at: null,
      released_at: null,
      release_reason: null,
      status: "active",
      last_error: null,
      metadata: {
        container_name: matchedContainerName,
        capacity_state: "allocated",
      },
    }, null, 2),
    "utf-8",
  );
}

function startLabeledContainer(name, labels) {
  const args = ["run", "-d", "--name", name];
  for (const [key, value] of Object.entries(labels)) {
    args.push("--label", `${key}=${value}`);
  }
  args.push(image, "node", "-e", "setInterval(() => {}, 1000)");
  return run("docker", args);
}

run("docker", ["version", "--format", "{{.Server.Version}}"]).trim();
if (process.env.MY_MATE_RUNTIME_WORKER_BUILD_BEFORE_SMOKE === "true") {
  run(process.execPath, [path.join(repoRoot, "scripts", "build-runtime-worker-image.mjs")]);
}
run("docker", ["image", "inspect", image, "--format", "{{.Id}}"]).trim();

let first = null;
let second = null;
let firstOutput = null;
let secondOutput = null;
let matchedContainerId = null;
let orphanContainerId = null;

try {
  first = startControlPlane();
  firstOutput = captureOutput(first);
  await waitForHealth();

  matchedContainerId = startLabeledContainer(matchedContainerName, {
    "my-mate.runtime-worker": "true",
    "my-mate.manager-id": managerId,
    "my-mate.run-id": runId,
    "my-mate.job-id": jobId,
  });
  orphanContainerId = startLabeledContainer(orphanContainerName, {
    "my-mate.runtime-worker": "true",
    "my-mate.manager-id": managerId,
    "my-mate.run-id": `missing-${runId}`,
    "my-mate.job-id": `missing-${jobId}`,
  });
  writeActiveLease(matchedContainerId);

  await stopProcess(first, true);
  first = null;

  second = startControlPlane();
  secondOutput = captureOutput(second);
  await waitForHealth();

  const runtimeResponse = await fetch(`${baseUrl}/api/runtime/summary`);
  if (!runtimeResponse.ok) throw new Error(await runtimeResponse.text());
  const runtime = await runtimeResponse.json();
  const recovery = runtime.execution_runtime?.node_provisioner?.recovery;
  if (
    recovery?.last_reconciliation_status !== "healthy" ||
    recovery?.discovered_containers !== 2 ||
    recovery?.orphan_containers !== 1 ||
    recovery?.removed_containers !== 2 ||
    recovery?.cleanup_failed !== 0
  ) {
    throw new Error(`Unexpected recovery posture: ${JSON.stringify(recovery)}`);
  }

  const leasePath = path.join(
    dataDir,
    "worker-leases",
    encodeURIComponent(runId),
    `${encodeURIComponent(leaseId)}.json`,
  );
  const lease = JSON.parse(fs.readFileSync(leasePath, "utf-8"));
  if (
    lease.status !== "released" ||
    lease.cleanup?.status !== "succeeded" ||
    lease.metadata?.capacity_state !== "released"
  ) {
    throw new Error(`Matched lease was not compensated: ${JSON.stringify(lease)}`);
  }

  const remaining = run("docker", [
    "ps",
    "-aq",
    "--filter",
    `id=${matchedContainerId}`,
    "--filter",
    `id=${orphanContainerId}`,
  ]);
  if (remaining) {
    throw new Error(`Recovery retained Runtime Worker containers: ${remaining}`);
  }

  console.log(JSON.stringify({
    recovery,
    matched_lease: {
      lease_id: lease.lease_id,
      status: lease.status,
      cleanup_status: lease.cleanup.status,
      cleanup_attempt: lease.cleanup.attempt,
      capacity_state: lease.metadata.capacity_state,
    },
    remaining_containers: 0,
  }, null, 2));
} catch (error) {
  const firstLogs = firstOutput?.() || { stdout: "", stderr: "" };
  const secondLogs = secondOutput?.() || { stdout: "", stderr: "" };
  throw new Error([
    error instanceof Error ? error.stack || error.message : String(error),
    "--- first Control Plane stdout ---",
    firstLogs.stdout,
    "--- first Control Plane stderr ---",
    firstLogs.stderr,
    "--- second Control Plane stdout ---",
    secondLogs.stdout,
    "--- second Control Plane stderr ---",
    secondLogs.stderr,
  ].join("\n"));
} finally {
  await Promise.all([stopProcess(first), stopProcess(second)]);
  for (const name of [matchedContainerName, orphanContainerName]) {
    spawnSync("docker", ["rm", "-f", name], { cwd: repoRoot, windowsHide: true });
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}
