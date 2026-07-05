import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { startManagedNodeService } from "./lib/node-service-launcher.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const studioBaseUrl = "http://127.0.0.1:5174";
const gatewayHealthUrl = "http://127.0.0.1:4030/health";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) continue;
    const [key, inlineValue] = raw.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/main-openclaw-studio-acceptance.mjs [options]

Options:
  --skip-stack-start   Do not call scripts/start-main-openclaw.mjs --all.
  --skip-e2e           Reuse --summary or the latest E2E summary instead of running E2E.
  --summary <path>     Existing main-openclaw-proposal-e2e summary.json.
  --keep-studio        Keep Studio running if this script started it.
  --cdp-port <port>    Chrome remote debugging port. Defaults to CHROME_CDP_PORT or 9223.
`);
}

function resolveMaybeRepoPath(input) {
  if (!input) return null;
  if (path.isAbsolute(input)) return input;
  const cwdPath = path.resolve(process.cwd(), input);
  if (existsSync(cwdPath)) return cwdPath;
  return path.resolve(repoRoot, input);
}

async function isHealthy(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
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

function runNodeScript(scriptPath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: "inherit",
      windowsHide: true,
    });
    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          reject(new Error(`${path.relative(repoRoot, scriptPath)} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : null;
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.relative(repoRoot, scriptPath)} failed with code=${code} signal=${signal || ""}`));
    });
  });
}

async function findLatestSummaryPath({ sinceMs = 0 } = {}) {
  const root = path.join(repoRoot, "tmp", "main-openclaw-proposal-e2e");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const summaryPath = path.join(root, entry.name, "summary.json");
    if (!existsSync(summaryPath)) continue;
    const stats = await stat(summaryPath);
    if (stats.mtimeMs + 1000 < sinceMs) continue;
    candidates.push({ summaryPath, mtimeMs: stats.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!candidates.length) {
    throw new Error(`No E2E summary.json found under ${root}.`);
  }
  return candidates[0].summaryPath;
}

async function ensureStudio(logDir) {
  if (await isHealthy(studioBaseUrl)) {
    return {
      started: false,
      async stop() {},
    };
  }

  const service = startManagedNodeService({
    name: "studio",
    workdir: path.join(repoRoot, "apps", "studio"),
    serverPath: path.join(repoRoot, "apps", "studio", "server.mjs"),
    logDir,
    logPrefix: "studio-5174",
    env: {
      PORT: "5174",
      MY_MATE_API_GATEWAY_BASE_URL: "http://127.0.0.1:4030",
    },
  });
  await waitForHealth(studioBaseUrl, "Studio");
  return {
    started: true,
    pid: service.pid,
    outPath: service.outPath,
    errPath: service.errPath,
    stop: service.stop,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const startedAt = Date.now();
  let studio = null;
  let summaryPath = resolveMaybeRepoPath(args.summary);
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "");
  const outDir = path.join(repoRoot, "tmp", "main-openclaw-studio-acceptance", stamp);

  try {
    if (!args["skip-stack-start"]) {
      await runNodeScript(path.join(repoRoot, "scripts", "start-main-openclaw.mjs"), ["--all"], {
        timeoutMs: 60000,
      });
    }

    if (!(await isHealthy(gatewayHealthUrl))) {
      throw new Error(
        `API Gateway is not healthy at ${gatewayHealthUrl}. Start services/api-gateway on port 4030 before running acceptance.`,
      );
    }

    studio = await ensureStudio(path.join(outDir, "logs"));

    if (!args["skip-e2e"]) {
      await runNodeScript(path.join(repoRoot, "scripts", "main-openclaw-proposal-e2e.mjs"), [], {
        timeoutMs: 1200000,
      });
      summaryPath = await findLatestSummaryPath({ sinceMs: startedAt });
    }

    if (!summaryPath) {
      summaryPath = await findLatestSummaryPath();
    }

    const visualOutDir = path.join(outDir, "studio-visual");
    await runNodeScript(
      path.join(repoRoot, "apps", "studio", "scripts", "openclaw-visual-acceptance.mjs"),
      [
        "--summary",
        summaryPath,
        "--out-dir",
        visualOutDir,
        "--studio-url",
        studioBaseUrl,
        "--cdp-port",
        String(args["cdp-port"] || process.env.CHROME_CDP_PORT || 9223),
        "--close-existing-studio-tabs",
      ],
      {
        timeoutMs: 180000,
      },
    );

    await mkdir(outDir, { recursive: true });
    const acceptanceSummary = {
      ok: true,
      verified_at: new Date().toISOString(),
      e2e_summary_path: summaryPath,
      visual_summary_path: path.join(visualOutDir, "visual-summary.json"),
      studio_started_by_script: Boolean(studio?.started),
      studio: {
        base_url: studioBaseUrl,
        pid: studio?.pid || null,
        out_log: studio?.outPath || null,
        err_log: studio?.errPath || null,
      },
    };
    const acceptanceSummaryPath = path.join(outDir, "summary.json");
    await writeFile(acceptanceSummaryPath, `${JSON.stringify(acceptanceSummary, null, 2)}\n`);
    console.log(JSON.stringify({ ...acceptanceSummary, acceptance_summary_path: acceptanceSummaryPath }, null, 2));
  } finally {
    if (studio?.started && !args["keep-studio"]) {
      await studio.stop();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
