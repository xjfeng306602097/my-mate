import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "apps", "desktop", "package.json"), "utf8"));
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
if (desktopPackage.version !== rootPackage.version) {
  throw new Error(`Desktop version ${desktopPackage.version} does not match repository version ${rootPackage.version}.`);
}

const runtimeRoot = path.join(repoRoot, "apps", "desktop", "runtime");
const required = [
  "runtime-manifest.json",
  "services/control-plane/dist/src/server.js",
  "services/api-gateway/dist/src/server.js",
  "apps/studio/server.mjs",
  "apps/studio/index.html",
  "schemas",
  "plugins",
  "skills",
];
for (const relativePath of required) {
  if (!fs.existsSync(path.join(runtimeRoot, ...relativePath.split("/")))) {
    throw new Error(`Packaged Desktop runtime is incomplete: ${relativePath}`);
  }
}

const retiredRuntimePaths = [
  "services/execution-adapter",
  "services/runtime-worker/src/harness/openclaw.ts",
  "services/runtime-worker/src/provider-adapters/openclaw.ts",
  "services/runtime-worker/test/fixtures/providers/openclaw.jsonl",
  "schemas/agent/agent-profile.schema.json",
];
for (const relativePath of retiredRuntimePaths) {
  if (fs.existsSync(path.join(runtimeRoot, ...relativePath.split("/")))) {
    throw new Error(`Packaged Desktop runtime contains retired compatibility code: ${relativePath}`);
  }
}

if (process.env.MY_MATE_REQUIRE_DESKTOP_SIGNING === "true") {
  if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD) {
    throw new Error("Desktop signing is required but CSC_LINK or CSC_KEY_PASSWORD is missing.");
  }
}
console.log(`Desktop release inputs verified for ${rootPackage.version}.`);
