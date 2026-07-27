import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerBin = process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";
const image = process.env.MY_MATE_ARTIFACT_WORKER_IMAGE || "my-mate-artifact-worker:0.1.0";
const baseImage = process.env.MY_MATE_ARTIFACT_WORKER_BASE_IMAGE || "python:3.12.11-slim-bookworm";
const debianMirror = process.env.MY_MATE_ARTIFACT_WORKER_DEBIAN_MIRROR?.trim() || "";
const debianSecurityMirror = process.env.MY_MATE_ARTIFACT_WORKER_DEBIAN_SECURITY_MIRROR?.trim() || "";
const pipIndexUrl = process.env.MY_MATE_ARTIFACT_WORKER_PIP_INDEX_URL?.trim() || "";
const pipTrustedHost = process.env.MY_MATE_ARTIFACT_WORKER_PIP_TRUSTED_HOST?.trim() || "";

const args = [
  "build",
  "--file",
  "services/artifact-worker/Dockerfile",
  "--tag",
  image,
  "--build-arg",
  `MY_MATE_ARTIFACT_WORKER_VERSION=0.1.0`,
  "--build-arg",
  `MY_MATE_ARTIFACT_WORKER_BASE_IMAGE=${baseImage}`,
];
if (debianMirror) {
  args.push("--build-arg", `MY_MATE_ARTIFACT_WORKER_DEBIAN_MIRROR=${debianMirror}`);
}
if (debianSecurityMirror) {
  args.push("--build-arg", `MY_MATE_ARTIFACT_WORKER_DEBIAN_SECURITY_MIRROR=${debianSecurityMirror}`);
}
if (pipIndexUrl) {
  args.push("--build-arg", `MY_MATE_ARTIFACT_WORKER_PIP_INDEX_URL=${pipIndexUrl}`);
}
if (pipTrustedHost) {
  args.push("--build-arg", `MY_MATE_ARTIFACT_WORKER_PIP_TRUSTED_HOST=${pipTrustedHost}`);
}
args.push(".");

const result = spawnSync(dockerBin, args, {
  cwd: repoRoot,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
process.stdout.write(`${JSON.stringify({ image, base_image: baseImage })}\n`);
