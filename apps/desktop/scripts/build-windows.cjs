const { spawnSync } = require("node:child_process");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const builderCli = path.join(desktopRoot, "node_modules", "electron-builder", "cli.js");
const signingRequired = process.env.MY_MATE_REQUIRE_DESKTOP_SIGNING === "true";
const args = [builderCli, "--win", "nsis", "--x64", "--publish", "never"];

if (!signingRequired) {
  args.push("--config.win.signAndEditExecutable=false");
}

const result = spawnSync(process.execPath, args, {
  cwd: desktopRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
