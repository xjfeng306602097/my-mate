import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(repoRoot, "apps", "desktop", "runtime");

function copy(source, destination, options = {}) {
  if (!fs.existsSync(source)) throw new Error(`Desktop runtime source is missing: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true, ...options });
}

function copyFile(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Desktop runtime source is missing: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function installProductionDependencies(directory) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) {
    throw new Error("npm CLI path is unavailable; run Desktop preparation through npm.");
  }
  execFileSync(process.execPath, [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: directory,
    stdio: "inherit",
    windowsHide: true,
  });
}

const resolvedRuntimeRoot = path.resolve(runtimeRoot);
if (!resolvedRuntimeRoot.startsWith(path.resolve(repoRoot) + path.sep)) {
  throw new Error("Desktop runtime staging must stay inside the repository.");
}
fs.rmSync(resolvedRuntimeRoot, { recursive: true, force: true });
fs.mkdirSync(resolvedRuntimeRoot, { recursive: true });

copyFile(
  path.join(repoRoot, "packages", "shared-types", "package.json"),
  path.join(runtimeRoot, "packages", "shared-types", "package.json"),
);
for (const fileName of ["package-lock.json", "tsconfig.json"]) {
  copyFile(
    path.join(repoRoot, "packages", "shared-types", fileName),
    path.join(runtimeRoot, "packages", "shared-types", fileName),
  );
}
copy(
  path.join(repoRoot, "packages", "shared-types", "src"),
  path.join(runtimeRoot, "packages", "shared-types", "src"),
);
copy(
  path.join(repoRoot, "packages", "shared-types", "dist"),
  path.join(runtimeRoot, "packages", "shared-types", "dist"),
);

for (const service of ["control-plane", "api-gateway"]) {
  const sourceRoot = path.join(repoRoot, "services", service);
  const targetRoot = path.join(runtimeRoot, "services", service);
  copyFile(path.join(sourceRoot, "package.json"), path.join(targetRoot, "package.json"));
  copyFile(path.join(sourceRoot, "package-lock.json"), path.join(targetRoot, "package-lock.json"));
  copy(path.join(sourceRoot, "dist", "src"), path.join(targetRoot, "dist", "src"));
}

const controlPlaneSourceRoot = path.join(repoRoot, "services", "control-plane", "src");
const packagedControlPlaneSourceRoot = path.join(runtimeRoot, "services", "control-plane", "src");
for (const entry of fs.readdirSync(controlPlaneSourceRoot, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.endsWith(".py") || entry.name.endsWith(".mjs"))) {
    copyFile(path.join(controlPlaneSourceRoot, entry.name), path.join(packagedControlPlaneSourceRoot, entry.name));
  }
}

const studioSourceRoot = path.join(repoRoot, "apps", "studio");
const packagedStudioRoot = path.join(runtimeRoot, "apps", "studio");
for (const fileName of ["package.json", "package-lock.json", "server.mjs", "index.html"]) {
  copyFile(path.join(studioSourceRoot, fileName), path.join(packagedStudioRoot, fileName));
}
copy(path.join(studioSourceRoot, "src"), path.join(packagedStudioRoot, "src"));

copy(path.join(repoRoot, "schemas"), path.join(runtimeRoot, "schemas"));
copy(path.join(repoRoot, "openapi"), path.join(runtimeRoot, "openapi"));
copy(path.join(repoRoot, "plugins"), path.join(runtimeRoot, "plugins"));
copy(path.join(repoRoot, "skills"), path.join(runtimeRoot, "skills"));
for (const worker of ["runtime-worker", "artifact-worker"]) {
  const sourceRoot = path.join(repoRoot, "services", worker);
  const targetRoot = path.join(runtimeRoot, "services", worker);
  copy(sourceRoot, targetRoot, {
    filter: (entry) => {
      const normalized = entry.split(path.sep).join("/");
      return !/(?:^|\/)node_modules(?:\/|$)/u.test(normalized) && !/(?:^|\/)dist(?:\/|$)/u.test(normalized);
    },
  });
}

installProductionDependencies(path.join(runtimeRoot, "services", "control-plane"));
installProductionDependencies(path.join(runtimeRoot, "services", "api-gateway"));
installProductionDependencies(path.join(runtimeRoot, "apps", "studio"));

const manifest = {
  schema_version: 1,
  version: JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version,
  generated_at: new Date().toISOString(),
  services: {
    control_plane: "services/control-plane/dist/src/server.js",
    api_gateway: "services/api-gateway/dist/src/server.js",
    studio: "apps/studio/server.mjs",
  },
};
fs.writeFileSync(path.join(runtimeRoot, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Prepared packaged Desktop runtime at ${runtimeRoot}`);
