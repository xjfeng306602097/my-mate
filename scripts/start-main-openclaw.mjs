import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { startPersistentNodeService } from "./lib/node-service-launcher.mjs";

const repoRoot = path.resolve("C:/project/my-mate");
const runtimeRoot = path.join(repoRoot, "tmp", "main-openclaw-runtime");
const logsDir = path.join(runtimeRoot, "logs");
const pidsPath = path.join(runtimeRoot, "pids.json");

const bridgePort = 4020;
const controlPlanePort = 4010;
const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
const controlPlaneBaseUrl = `http://127.0.0.1:${controlPlanePort}`;
const bridgeApiKey = "local-dev-openclaw";
const callbackToken = "local-dev-openclaw-callback";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readPids() {
  if (!fs.existsSync(pidsPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(pidsPath, "utf-8"));
  } catch {
    return {};
  }
}

function writePids(pids) {
  ensureDir(path.dirname(pidsPath));
  fs.writeFileSync(pidsPath, `${JSON.stringify(pids, null, 2)}\n`, "utf-8");
}

async function waitForHealth(url, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError}`);
}

async function isHealthy(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function findListeningPids(port) {
  try {
    const output = execFileSync("netstat", ["-ano"], { encoding: "utf-8" });
    return [
      ...new Set(
        output
          .split(/\r?\n/)
          .filter((line) => line.includes(`:${port}`) && /\bLISTENING\b/i.test(line))
          .map((line) => {
            const parts = line.trim().split(/\s+/);
            const pid = Number(parts[parts.length - 1]);
            return Number.isInteger(pid) && pid > 0 ? pid : null;
          })
          .filter((pid) => pid !== null),
      ),
    ];
  } catch {
    return [];
  }
}

async function waitForPortReleased(port, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findListeningPids(port).length === 0) {
      return;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${label} port ${port} to be released.`);
}

async function stopListeningService({ label, port, recordedPid }) {
  const pids = new Set(findListeningPids(port));
  if (Number.isInteger(recordedPid) && recordedPid > 0) {
    pids.add(recordedPid);
  }
  if (pids.size === 0) {
    return [];
  }

  const stopped = [];
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      stopped.push(pid);
    } catch {
      // The PID may already be gone or belong to another inaccessible process.
    }
  }
  await sleep(1000);
  for (const pid of pids) {
    if (!findListeningPids(port).includes(pid)) {
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Leave final diagnosis to waitForPortReleased.
    }
  }
  await waitForPortReleased(port, label);
  return stopped;
}

async function startBridge({ restart = false } = {}) {
  const pids = readPids();
  if (restart) {
    await stopListeningService({
      label: "execution-adapter",
      port: bridgePort,
      recordedPid: pids.execution_adapter?.pid,
    });
  }
  if (await isHealthy(`${bridgeBaseUrl}/health`)) {
    const listeningPid = findListeningPids(bridgePort)[0] || null;
    return {
      already_running: true,
      pid: listeningPid || pids.execution_adapter?.pid || null,
      base_url: bridgeBaseUrl,
    };
  }

  const service = startPersistentNodeService({
    name: "execution-adapter",
    workdir: path.join(repoRoot, "services", "execution-adapter"),
    logDir: logsDir,
    logPrefix: "execution-adapter-4020",
    env: {
      PORT: String(bridgePort),
      MY_MATE_EXECUTION_ADAPTER_MODE: "container-exec",
      MY_MATE_EXECUTION_ADAPTER_API_KEY: bridgeApiKey,
      MY_MATE_OPENCLAW_GATEWAY_BASE_URL: "http://127.0.0.1:18789",
      MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL: "http://127.0.0.1:4315",
      MY_MATE_OPENCLAW_CONTAINER_NAME: "openclaw-local",
      MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY: "direct-agent",
      MY_MATE_OPENCLAW_CONTAINER_AUTH_PROBE: "aws-sts-auto",
      MY_MATE_OPENCLAW_DIRECT_AGENT_MODEL: "deepseek/deepseek-v4-pro",
    },
  });
  await waitForHealth(`${bridgeBaseUrl}/health`, "execution-adapter");
  const listeningPid = findListeningPids(bridgePort)[0] || service.pid;
  const nextPids = readPids();
  nextPids.execution_adapter = {
    pid: listeningPid,
    base_url: bridgeBaseUrl,
    out_log: service.outPath,
    err_log: service.errPath,
    started_at: new Date().toISOString(),
  };
  writePids(nextPids);
  return nextPids.execution_adapter;
}

async function startControlPlane({ restart = false } = {}) {
  const pids = readPids();
  if (restart) {
    await stopListeningService({
      label: "control-plane",
      port: controlPlanePort,
      recordedPid: pids.control_plane?.pid,
    });
  }
  if (await isHealthy(`${controlPlaneBaseUrl}/health`)) {
    const listeningPid = findListeningPids(controlPlanePort)[0] || null;
    return {
      already_running: true,
      pid: listeningPid || pids.control_plane?.pid || null,
      base_url: controlPlaneBaseUrl,
    };
  }

  const service = startPersistentNodeService({
    name: "control-plane",
    workdir: path.join(repoRoot, "services", "control-plane"),
    logDir: logsDir,
    logPrefix: "control-plane-4010-openclaw",
    env: {
      PORT: String(controlPlanePort),
      MY_MATE_ENABLE_LOCAL_EXECUTION: "false",
      MY_MATE_EXECUTION_ADAPTER: "openclaw",
      MY_MATE_PUBLIC_BASE_URL: controlPlaneBaseUrl,
      MY_MATE_OPENCLAW_BRIDGE_BASE_URL: bridgeBaseUrl,
      MY_MATE_OPENCLAW_BRIDGE_API_KEY: bridgeApiKey,
      MY_MATE_OPENCLAW_CALLBACK_TOKEN: callbackToken,
      MY_MATE_OPENCLAW_BRIDGE_EXECUTION_MODE: "container-exec",
      MY_MATE_OPENCLAW_GATEWAY_BASE_URL: "http://127.0.0.1:18789",
      MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL: "http://127.0.0.1:4315",
      MY_MATE_OPENCLAW_CONTAINER_NAME: "openclaw-local",
    },
  });
  await waitForHealth(`${controlPlaneBaseUrl}/health`, "control-plane");
  const listeningPid = findListeningPids(controlPlanePort)[0] || service.pid;
  const nextPids = readPids();
  nextPids.control_plane = {
    pid: listeningPid,
    base_url: controlPlaneBaseUrl,
    out_log: service.outPath,
    err_log: service.errPath,
    started_at: new Date().toISOString(),
  };
  writePids(nextPids);
  return nextPids.control_plane;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.find((arg) => ["--all", "--bridge", "--control-plane"].includes(arg)) || "--all";
  const restart = args.includes("--restart");
  if (!["--all", "--bridge", "--control-plane"].includes(mode)) {
    throw new Error(`Unknown mode ${mode}. Use --all, --bridge, or --control-plane.`);
  }

  const summary = {};
  if (mode === "--all" || mode === "--bridge") {
    summary.execution_adapter = await startBridge({ restart });
  }
  if (mode === "--all" || mode === "--control-plane") {
    summary.control_plane = await startControlPlane({ restart });
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
