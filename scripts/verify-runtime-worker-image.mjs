import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveRuntimeWorkerImage,
  runtimeWorkerReleaseVersion,
} from "./runtime-worker-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed.`);
  }
  return result.stdout.trim();
}

const dockerBin = process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";
const image = resolveRuntimeWorkerImage();
const inspected = JSON.parse(run(dockerBin, ["image", "inspect", image]))[0];
const labels = inspected?.Config?.Labels || {};
const environment = new Map(
  (inspected?.Config?.Env || []).map((entry) => {
    const separator = entry.indexOf("=");
    return separator < 0
      ? [entry, ""]
      : [entry.slice(0, separator), entry.slice(separator + 1)];
  }),
);
const expectedRevision = run("git", ["rev-parse", "--verify", "HEAD"]);
const failures = [];

function expect(label, actual, expected) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, received ${actual ?? "<missing>"}`);
}

expect("OCI version", labels["org.opencontainers.image.version"], runtimeWorkerReleaseVersion);
expect("My Mate Worker version", labels["io.my-mate.runtime-worker.version"], runtimeWorkerReleaseVersion);
expect("OCI revision", labels["org.opencontainers.image.revision"], expectedRevision);
expect("Worker protocol", labels["io.my-mate.runtime-protocol"], "my_mate_runtime_v1");
expect("Worker version env", environment.get("MY_MATE_RUNTIME_WORKER_VERSION"), runtimeWorkerReleaseVersion);
expect("Worker image env", environment.get("MY_MATE_RUNTIME_WORKER_IMAGE"), image);

const created = labels["org.opencontainers.image.created"];
if (!created || Number.isNaN(Date.parse(created))) failures.push("OCI created label is missing or invalid.");
const source = labels["org.opencontainers.image.source"];
if (!source || source === "unknown") failures.push("OCI source label is missing.");
if (!inspected?.Id?.startsWith("sha256:")) failures.push("Docker image content ID is missing.");

if (failures.length > 0) {
  throw new Error(`Runtime Worker image verification failed:\n- ${failures.join("\n- ")}`);
}

process.stdout.write(
  `${JSON.stringify({ image, image_id: inspected.Id, version: runtimeWorkerReleaseVersion, revision: expectedRevision, created, source })}\n`,
);
