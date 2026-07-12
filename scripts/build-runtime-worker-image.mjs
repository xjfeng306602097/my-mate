import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRuntimeWorkerReleaseImage,
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
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed.`);
  }
  return (result.stdout || "").trim();
}

function gitValue(args, fallback) {
  try {
    return run("git", args) || fallback;
  } catch {
    return fallback;
  }
}

const image = resolveRuntimeWorkerImage();
const allowMutable =
  String(process.env.MY_MATE_ALLOW_MUTABLE_WORKER_IMAGE || "").toLowerCase() === "true";
const identity = assertRuntimeWorkerReleaseImage(image, { allowMutable });
const revision =
  process.env.MY_MATE_BUILD_REVISION?.trim() ||
  gitValue(["rev-parse", "--verify", "HEAD"], "unknown");
const source =
  process.env.MY_MATE_BUILD_SOURCE?.trim() ||
  gitValue(["config", "--get", "remote.origin.url"], "unknown");
const builtAt =
  process.env.MY_MATE_BUILD_DATE?.trim() ||
  (process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString());
const dockerBin = process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";

const args = [
  "build",
  "--file",
  "services/runtime-worker/Dockerfile",
  "--tag",
  image,
  "--build-arg",
  `MY_MATE_RUNTIME_WORKER_VERSION=${runtimeWorkerReleaseVersion}`,
  "--build-arg",
  `MY_MATE_RUNTIME_WORKER_IMAGE=${image}`,
  "--build-arg",
  `MY_MATE_BUILD_REVISION=${revision}`,
  "--build-arg",
  `MY_MATE_BUILD_DATE=${builtAt}`,
  "--build-arg",
  `MY_MATE_BUILD_SOURCE=${source}`,
  ".",
];

run(dockerBin, args, { stdio: "inherit" });
process.stdout.write(
  `${JSON.stringify({ image, identity: identity.kind, version: runtimeWorkerReleaseVersion, revision, built_at: builtAt, source })}\n`,
);
