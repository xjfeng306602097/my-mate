import path from "node:path";
import { spawn } from "node:child_process";
import { OPENCLAW_RUNTIME_PYTHON, OPENCLAW_RUNTIME_ROOT } from "./config.js";
import {
  materializeRequirementBundle,
  parseRegisterTaskOutput,
  writeOpenClawHandoff,
} from "./openclaw-materialization.js";
import type { DispatchRecord } from "./types.js";
import { nowIso } from "./utils.js";

export interface NativeMaterialization {
  handoffFile: string;
  statePath: string;
  requirementDir: string;
  dispatchFile: string | null;
  shortTask: string | null;
  taskId: string | null;
  taskRegisterStdout: string;
  taskRegisterStderr: string;
}

function runPython(args: string[], cwd: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(OPENCLAW_RUNTIME_PYTHON, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function materializeRuntimeArtifacts(
  record: DispatchRecord,
): Promise<NativeMaterialization> {
  if (!OPENCLAW_RUNTIME_ROOT.trim()) {
    throw new Error("MY_MATE_OPENCLAW_RUNTIME_ROOT is required for native-agent mode.");
  }

  const runtimeRoot = path.resolve(OPENCLAW_RUNTIME_ROOT);
  const scriptsRoot = path.join(runtimeRoot, "workspace-architect", "scripts");
  const requestProjectSlug =
    typeof record.request_snapshot.input_payload.project_slug === "string" &&
    record.request_snapshot.input_payload.project_slug.trim()
      ? record.request_snapshot.input_payload.project_slug.trim()
      : process.env.MY_MATE_OPENCLAW_DEFAULT_PROJECT_SLUG || "my-mate";
  const requirementsRoot = path.join(
    runtimeRoot,
    "workspace-architect",
    "projects",
    requestProjectSlug,
    "requirements",
  );

  const bundle = materializeRequirementBundle({
    record,
    localRequirementsRoot: requirementsRoot,
    runtimeRequirementsRoot: requirementsRoot,
    runtimePathJoin: path.join,
    projectSlugFallback: requestProjectSlug,
    projectRepoFallback:
      typeof process.env.MY_MATE_OPENCLAW_DEFAULT_PROJECT_REPO === "string"
        ? process.env.MY_MATE_OPENCLAW_DEFAULT_PROJECT_REPO
        : null,
  });

  const registerArgs = [
    path.join(scriptsRoot, "register_task.py"),
    "--state-path",
    bundle.runtimeStatePath,
    "--stage",
    bundle.stage,
    "--owner",
    `workspace-${bundle.stage}`,
    "--description",
    record.request_snapshot.intent,
    "--run-timeout-seconds",
    String(record.request_snapshot.timeout_seconds || 600),
  ];

  const result = await runPython(registerArgs, scriptsRoot);
  if (result.code !== 0) {
    throw new Error(
      `register_task.py failed (${result.code}): ${result.stderr || result.stdout}`,
    );
  }

  const parsed = parseRegisterTaskOutput(result.stdout);
  const handoffFile = writeOpenClawHandoff(record.dispatch_id, {
    generated_at: nowIso(),
    mode: "native-agent",
    dispatch_id: record.dispatch_id,
    run_id: record.run_id,
    node_run_id: record.node_run_id,
    stage: bundle.stage,
    project_slug: bundle.projectSlug,
    project_local_repo: bundle.projectRepo,
    requirement_id: bundle.requirementId,
    state_path: bundle.runtimeStatePath,
    requirement_dir: bundle.runtimeRequirementDir,
    task_id: parsed.taskId,
    dispatch_file: parsed.dispatchFile,
    short_task: parsed.shortTask,
    register_stdout: result.stdout,
    register_stderr: result.stderr,
    note:
      "Native-agent mode has materialized a valid OpenClaw requirement bundle under the host-visible runtime root and registered a real task.",
  });

  return {
    handoffFile,
    statePath: bundle.runtimeStatePath,
    requirementDir: bundle.runtimeRequirementDir,
    dispatchFile: parsed.dispatchFile,
    shortTask: parsed.shortTask,
    taskId: parsed.taskId,
    taskRegisterStdout: result.stdout,
    taskRegisterStderr: result.stderr,
  };
}

export async function runNativeOpenClawPreparation(
  record: DispatchRecord,
): Promise<NativeMaterialization> {
  return materializeRuntimeArtifacts(record);
}
