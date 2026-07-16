import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLiveAcceptance } from "./live-acceptance-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "config", "live-acceptance.json"), "utf-8"),
);
const effectiveEnv = { ...process.env };

function commandAvailable(command) {
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], {
    encoding: "utf-8",
    windowsHide: true,
  });
  return probe.status === 0;
}

function quoteCommandValue(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

for (const provider of manifest.providers) {
  if (
    provider.execution !== "openai_compatible" &&
    provider.harness_env &&
    !effectiveEnv[provider.harness_env] &&
    provider.command_probe &&
    provider.default_command &&
    commandAvailable(provider.command_probe)
  ) {
    const model = provider.model_env ? effectiveEnv[provider.model_env]?.trim() : "";
    const modelArg = model ? ` --model ${quoteCommandValue(model)}` : "";
    effectiveEnv[provider.harness_env] = provider.default_command.replace("{model_arg}", modelArg);
  }
}

const requireConfigured = process.argv.includes("--require-configured");
const outputArg = process.argv.find((value) => value.startsWith("--output="));
const outputPath = path.resolve(
  repoRoot,
  outputArg?.slice("--output=".length) ||
    process.env.MY_MATE_LIVE_ACCEPTANCE_OUTPUT ||
    "tmp/live-acceptance/result.json",
);
const timeoutMs = Math.max(5_000, Number(effectiveEnv.MY_MATE_LIVE_TIMEOUT_MS) || 90_000);
const maxAttempts = Math.max(1, Math.min(3, Number(effectiveEnv.MY_MATE_LIVE_ATTEMPTS) || 1));

function parseEvidence(stdout) {
  const matches = [...String(stdout || "").matchAll(/LIVE_ACCEPTANCE_EVIDENCE\s+(\{[^\r\n]+\})/g)];
  if (matches.length === 0) return null;
  try {
    return JSON.parse(matches.at(-1)[1]);
  } catch {
    return null;
  }
}

function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGTERM");
}

function executeTestLaneOnce(lane) {
  const isProvider = lane.kind === "provider";
  const cwd = path.join(repoRoot, isProvider ? "services/runtime-worker" : "services/control-plane");
  const pattern = isProvider
    ? "opt-in live provider completes the workspace tool and usage scenario"
    : "opt-in Anthropic evaluator returns a structured quality verdict";
  const env = {
    ...effectiveEnv,
    ...(isProvider
      ? {
          MY_MATE_RUN_LIVE_PROVIDER_TESTS: "true",
          MY_MATE_LIVE_PROVIDER: lane.provider,
          MY_MATE_LIVE_MODEL: lane.model || "",
          MY_MATE_LIVE_REQUIRE_TOOLS: lane.require_tools ? "true" : "false",
        }
      : { MY_MATE_RUN_LIVE_EVALUATOR_TESTS: "true" }),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--test", `--test-name-pattern=${pattern}`, "test/all.test.ts"],
      { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString("utf-8");
      const stderrText = Buffer.concat(stderr).toString("utf-8");
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout: stdoutText,
        stderr: timedOut ? `Lane timed out after ${timeoutMs}ms.\n${stderrText}` : stderrText,
        evidence: parseEvidence(stdoutText),
      });
    });
  });
}

async function execute(lane) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await executeTestLaneOnce(lane);
    if (last.exitCode === 0) return { ...last, attemptCount: attempt };
  }
  return { ...last, attemptCount: maxAttempts };
}

const result = await runLiveAcceptance({ manifest, env: effectiveEnv, execute });
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
console.log(JSON.stringify({
  status: result.status,
  output: path.relative(repoRoot, outputPath),
  lanes: result.lanes.map((lane) => ({
    id: lane.id,
    status: lane.status,
    attempts: lane.attempt_count,
    evidence: lane.evidence,
    error: lane.error,
  })),
}, null, 2));

const configuredCount = result.lanes.filter((lane) => lane.status !== "skipped").length;
if (result.status === "failed" || (requireConfigured && configuredCount === 0)) process.exitCode = 1;
