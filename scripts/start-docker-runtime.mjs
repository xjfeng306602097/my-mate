import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const command = process.execPath;
const args = [
  path.join(repoRoot, "services", "control-plane", "node_modules", "tsx", "dist", "cli.mjs"),
  path.join(repoRoot, "services", "control-plane", "src", "server.ts"),
];

const child = spawn(command, args, {
  cwd: path.join(repoRoot, "services", "control-plane"),
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    MY_MATE_RUNTIME_DISPATCHER: "docker-worker",
    MY_MATE_RUNTIME_DEFAULT_TARGET_KIND: "docker-worker",
    MY_MATE_RUNTIME_WORKER_IMAGE:
      process.env.MY_MATE_RUNTIME_WORKER_IMAGE || "my-mate-runtime-worker:latest",
  },
});

child.on("exit", (code) => process.exit(code ?? 1));
