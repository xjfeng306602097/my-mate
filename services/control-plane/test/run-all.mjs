// Parallel test runner for the Control Plane suite.
//
// The previous single-process aggregate (test/all.test.ts) serialized every
// test in one process and no longer finished within the six-minute process
// limit. This runner executes each *.test.ts file in its own process through
// the Node test runner with bounded concurrency, then reruns perf-sensitive
// files serially so timing assertions are not measured under parallel CPU
// contention.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";

// Files containing wall-clock performance assertions (release evidence).
// They must run without parallel CPU contention to stay meaningful.
const SERIAL_FILES = new Set(["memory-m9.test.ts"]);

// Legacy single-process aggregate kept for reference. Running it inside the
// parallel lane would re-execute every imported suite in one process.
const EXCLUDED_FILES = new Set(["all.test.ts"]);

const testDir = new URL(".", import.meta.url);
const packageRoot = new URL("..", testDir);

const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts") && !EXCLUDED_FILES.has(name))
  .sort();

const parallelFiles = files
  .filter((name) => !SERIAL_FILES.has(name))
  .map((name) => `test/${name}`);
const serialFiles = files
  .filter((name) => SERIAL_FILES.has(name))
  .map((name) => `test/${name}`);

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      cwd: packageRoot,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const baseArgs = ["--import", "tsx", "--test", "--test-force-exit"];

const parallelExit = await runNode([
  ...baseArgs,
  "--test-concurrency=8",
  ...parallelFiles,
]);

const serialExit = serialFiles.length
  ? await runNode([...baseArgs, ...serialFiles])
  : 0;

process.exit(parallelExit !== 0 || serialExit !== 0 ? 1 : 0);
