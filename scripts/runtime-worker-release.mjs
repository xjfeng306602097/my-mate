import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readPackageVersion(relativePath) {
  const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf-8"));
  if (typeof parsed.version !== "string" || !parsed.version.trim()) {
    throw new Error(`${relativePath} does not declare a package version.`);
  }
  return parsed.version.trim();
}

const rootVersion = readPackageVersion("package.json");
const workerVersion = readPackageVersion("services/runtime-worker/package.json");

if (rootVersion !== workerVersion) {
  throw new Error(
    `Runtime Worker version ${workerVersion} must match repository version ${rootVersion}.`,
  );
}

export const runtimeWorkerReleaseVersion = workerVersion;
export const defaultRuntimeWorkerRepository = "my-mate-runtime-worker";
export const defaultRuntimeWorkerImage =
  `${defaultRuntimeWorkerRepository}:${runtimeWorkerReleaseVersion}`;

export function resolveRuntimeWorkerImage(env = process.env) {
  const explicit = env.MY_MATE_RUNTIME_WORKER_IMAGE?.trim();
  if (explicit) return explicit;
  const repository =
    env.MY_MATE_RUNTIME_WORKER_IMAGE_REPOSITORY?.trim() ||
    defaultRuntimeWorkerRepository;
  return `${repository}:${runtimeWorkerReleaseVersion}`;
}

export function describeRuntimeWorkerImage(reference) {
  const value = String(reference || "").trim();
  const digestMatch = value.match(/@sha256:([0-9a-f]{64})$/i);
  if (digestMatch) {
    return {
      reference: value,
      kind: "digest",
      tag: null,
      digest: `sha256:${digestMatch[1].toLowerCase()}`,
      release_ready: true,
    };
  }

  const tail = value.slice(value.lastIndexOf("/") + 1);
  const separator = tail.lastIndexOf(":");
  const tag = separator >= 0 ? tail.slice(separator + 1) : null;
  const versioned = !!tag && /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag);
  const kind = !tag
    ? "untagged"
    : tag.toLowerCase() === "latest"
      ? "latest"
      : versioned
        ? "version_tag"
        : "custom_tag";
  return {
    reference: value,
    kind,
    tag,
    digest: null,
    release_ready: kind === "version_tag",
  };
}

export function assertRuntimeWorkerReleaseImage(reference, options = {}) {
  const identity = describeRuntimeWorkerImage(reference);
  if (identity.release_ready || options.allowMutable === true) return identity;
  throw new Error(
    `Runtime Worker image ${identity.reference || "<empty>"} is not release-ready; ` +
      "use a semantic version tag or sha256 digest, or set MY_MATE_ALLOW_MUTABLE_WORKER_IMAGE=true for local-only builds.",
  );
}
