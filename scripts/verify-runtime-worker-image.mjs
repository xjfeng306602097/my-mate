import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveRuntimeWorkerImage,
  runtimeWorkerReleaseVersion,
} from "./runtime-worker-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
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

const codexEntrypoint = "/app/services/runtime-worker/node_modules/.bin/codex";
const codexVersion = run(dockerBin, [
  "run", "--rm", "--entrypoint", codexEntrypoint, image, "--version",
]);
if (!/^codex-cli \d+\.\d+\.\d+/.test(codexVersion)) {
  failures.push(`Codex Agent Harness binary is invalid: ${codexVersion || "<empty>"}`);
}

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    clientInfo: {
      name: "my_mate_runtime_worker_image_verify",
      title: "My Mate Runtime Worker Image Verify",
      version: runtimeWorkerReleaseVersion,
    },
    capabilities: { experimentalApi: true },
  },
};
let initializeResponse = null;
let initializeOutput = "";
for (let attempt = 1; attempt <= 3 && !initializeResponse; attempt += 1) {
  initializeOutput = run(dockerBin, [
    "run", "--rm", "-i", "--entrypoint", codexEntrypoint,
    image, "app-server", "--stdio",
  ], {
    input: `${JSON.stringify(initializeRequest)}\n`,
    timeout: 30_000,
  });
  for (const line of initializeOutput.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line);
      if (value?.id === 1) initializeResponse = value;
    } catch {}
  }
}
if (!initializeResponse?.result || initializeResponse.error) {
  failures.push(
    "Codex app-server did not complete the image verification JSON-RPC handshake: " +
      (initializeOutput.slice(-500) || "<no stdout>"),
  );
}

const created = labels["org.opencontainers.image.created"];
if (!created || Number.isNaN(Date.parse(created))) failures.push("OCI created label is missing or invalid.");
const source = labels["org.opencontainers.image.source"];
if (!source || source === "unknown") failures.push("OCI source label is missing.");
if (!inspected?.Id?.startsWith("sha256:")) failures.push("Docker image content ID is missing.");

if (failures.length > 0) {
  throw new Error(`Runtime Worker image verification failed:\n- ${failures.join("\n- ")}`);
}

process.stdout.write(
  `${JSON.stringify({
    image,
    image_id: inspected.Id,
    version: runtimeWorkerReleaseVersion,
    revision: expectedRevision,
    created,
    source,
    agent_harness: {
      codex_version: codexVersion,
      app_server_initialize: initializeResponse?.result ? "passed" : "failed",
    },
  })}\n`,
);
