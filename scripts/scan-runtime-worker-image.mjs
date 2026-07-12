import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  resolveRuntimeWorkerImage,
  runtimeWorkerReleaseVersion,
} from "./runtime-worker-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.resolve(
  repoRoot,
  process.env.MY_MATE_RELEASE_DIR || path.join("tmp", "release"),
  "runtime-worker",
  runtimeWorkerReleaseVersion,
);
const reportPath = path.join(releaseRoot, "vulnerabilities.sarif.json");
const archivePath = path.join(releaseRoot, "runtime-worker-image.tar");
const dockerBin = process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";
const image = resolveRuntimeWorkerImage();
const scannerImage =
  process.env.MY_MATE_GRYPE_IMAGE ||
  "anchore/grype@sha256:decd87500a90c1e4faa1706f77b0b2cbc1d2f9364e976f1898ce9037de09cc3a";

fs.mkdirSync(releaseRoot, { recursive: true });
let gate;
try {
  const saved = spawnSync(dockerBin, ["image", "save", "--output", archivePath, image], {
    cwd: repoRoot,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (saved.status !== 0) {
    throw new Error(
      saved.error?.message || saved.stderr || saved.stdout || "Docker image export failed.",
    );
  }

  gate = spawnSync(
    dockerBin,
    [
      "run",
      "--rm",
      "--mount",
      `type=bind,source=${releaseRoot},target=/scan`,
      scannerImage,
      "docker-archive:/scan/runtime-worker-image.tar",
      "--output",
      "sarif",
      "--file",
      "/scan/vulnerabilities.sarif.json",
      "--fail-on",
      "critical",
    ],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
} finally {
  fs.rmSync(archivePath, { force: true });
}

if (gate.status === 2) {
  throw new Error(`Critical vulnerabilities were found in ${image}. See ${reportPath}.`);
}
if (gate.status !== 0) {
  throw new Error(
    gate.error?.message || gate.stderr || gate.stdout || "Grype critical vulnerability gate failed.",
  );
}

process.stdout.write(`${JSON.stringify({ image, policy: "block-critical", report: reportPath })}\n`);
