import { createHash } from "node:crypto";
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
const outputPath = path.join(releaseRoot, "sbom.cdx.json");
const digestPath = `${outputPath}.sha256`;
const archivePath = path.join(releaseRoot, "runtime-worker-image.tar");
const dockerBin = process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";
const image = resolveRuntimeWorkerImage();
const scannerImage =
  process.env.MY_MATE_SYFT_IMAGE ||
  "anchore/syft@sha256:473a60e3a58e29aca3aedb3e99e787bb4ef273917e44d10fcbea4330a07320bb";

fs.mkdirSync(releaseRoot, { recursive: true });
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

  const result = spawnSync(
    dockerBin,
    [
      "run",
      "--rm",
      "--mount",
      `type=bind,source=${releaseRoot},target=/scan`,
      scannerImage,
      "scan",
      "docker-archive:/scan/runtime-worker-image.tar",
      "--output",
      "cyclonedx-json=/scan/sbom.cdx.json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || "Syft SBOM failed.");
  }
} finally {
  fs.rmSync(archivePath, { force: true });
}

const serialized = fs.readFileSync(outputPath, "utf-8");
const sbom = JSON.parse(serialized);
if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components)) {
  throw new Error("Syft did not return a valid CycloneDX JSON BOM document.");
}
const digest = createHash("sha256").update(serialized).digest("hex");
fs.writeFileSync(digestPath, `${digest}  ${path.basename(outputPath)}\n`, "utf-8");

process.stdout.write(
  `${JSON.stringify({ image, version: runtimeWorkerReleaseVersion, format: "CycloneDX JSON", components: sbom.components.length, output: outputPath, sha256: digest })}\n`,
);
