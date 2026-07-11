import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  ExecutionArtifactRecord,
  NodeHandoff,
  NormalizedExecutionReport,
  RuntimeWorkerJob,
} from "../types.js";
import type { LocalHarnessResult } from "./local.js";

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function safePathSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function buildPrompt(job: RuntimeWorkerJob): string {
  const envelope = job.envelope as Record<string, unknown>;
  const intent = typeof envelope.intent === "string" ? envelope.intent : `Execute ${job.node_name}`;
  const outputContract =
    envelope.output_contract && typeof envelope.output_contract === "object"
      ? JSON.stringify(envelope.output_contract, null, 2)
      : "{}";
  return [
    intent,
    "",
    `Node: ${job.node_name} (${job.node_id})`,
    `Runtime agent: ${job.harness.runtime_agent_ref || job.harness.agent_runtime}`,
    `Allowed skills: ${job.harness.allowed_skills.join(", ") || "none declared"}`,
    `Allowed tools: ${job.harness.allowed_tools.join(", ") || "none declared"}`,
    "Output contract:",
    outputContract,
  ].join("\n");
}

function buildRawRef(job: RuntimeWorkerJob, command: string) {
  return {
    job_id: job.job_id,
    worker_id: process.env.MY_MATE_WORKER_ID || null,
    lease_id: process.env.MY_MATE_WORKER_LEASE_ID || null,
    target_kind: job.provision.target_kind,
    dispatch_id: `command-harness:${job.job_id}`,
    provider_refs: {
      runtime: job.harness.agent_runtime,
      command,
    },
    openclaw_task_id: null,
    openclaw_session_id: null,
  };
}

async function executeCommand(input: {
  command: string;
  cwd: string;
  prompt: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => Promise<void> | void;
}): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      env: input.env,
      shell: true,
      windowsHide: true,
      signal: input.signal,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let stdoutLineBuffer = "";
    let lineProcessing = Promise.resolve();

    const capture = (target: Buffer[], chunk: Buffer) => {
      capturedBytes += chunk.length;
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        child.kill();
        reject(new Error(`Harness output exceeded ${MAX_CAPTURE_BYTES} bytes.`));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      capture(stdoutChunks, chunk);
      if (!input.onStdoutLine) return;
      stdoutLineBuffer += chunk.toString("utf-8");
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        lineProcessing = lineProcessing.then(() => input.onStdoutLine?.(line));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => capture(stderrChunks, chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (input.onStdoutLine && stdoutLineBuffer.trim()) {
        const line = stdoutLineBuffer;
        lineProcessing = lineProcessing.then(() => input.onStdoutLine?.(line));
      }
      void lineProcessing.then(() => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      if (code !== 0) {
        const detail = stderr || stdout || `terminated by ${signal || "unknown signal"}`;
        reject(new Error(`Harness command exited with code ${code}: ${detail.slice(-2000)}`));
        return;
      }
      resolve({ stdout, stderr });
      }, reject);
    });
    child.stdin.end(input.prompt);
  });
}

export async function runCommandHarness(
  job: RuntimeWorkerJob,
  command: string,
  options?: {
    signal?: AbortSignal;
    onStdoutLine?: (line: string) => Promise<void> | void;
    afterStdout?: () => Promise<void> | void;
    selectOutput?: (rawOutput: string) => string | null;
  },
): Promise<LocalHarnessResult> {
  const workspace = process.env.MY_MATE_WORKSPACE || "/workspace";
  const jobDir = path.join(workspace, ".my-mate", "jobs");
  const artifactDir = path.join(workspace, "artifacts", job.run_id, job.node_run_id);
  const jobPath = path.join(jobDir, `${safePathSegment(job.job_id)}.json`);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf-8");

  const acceptedAt = nowIso();
  const runningAt = nowIso();
  const result = await executeCommand({
    command,
    cwd: workspace,
    prompt: buildPrompt(job),
    signal: options?.signal,
    onStdoutLine: options?.onStdoutLine,
    env: {
      ...process.env,
      ...job.provision.env,
      MY_MATE_RUNTIME_JOB_PATH: jobPath,
      MY_MATE_JOB_ID: job.job_id,
      MY_MATE_RUN_ID: job.run_id,
      MY_MATE_NODE_RUN_ID: job.node_run_id,
      MY_MATE_AGENT_RUNTIME: job.harness.agent_runtime,
      MY_MATE_RUNTIME_AGENT_REF: job.harness.runtime_agent_ref || "",
    },
  });
  await options?.afterStdout?.();
  const completedAt = nowIso();
  const rawOutput = result.stdout || result.stderr;
  const output = options?.selectOutput?.(rawOutput) || rawOutput ||
    `${job.node_name} completed without textual output.`;
  const artifactPath = path.join(artifactDir, "harness-output.txt");
  fs.writeFileSync(artifactPath, `${output}\n`, "utf-8");
  const artifact: ExecutionArtifactRecord = {
    artifact_id: `artifact_${job.node_run_id}_${job.dispatch_sequence}`,
    type: "harness_output",
    name: `${job.node_name}.harness-output.txt`,
    storage_uri: `workspace://artifacts/${job.run_id}/${job.node_run_id}/harness-output.txt`,
    mime_type: "text/plain",
    size_bytes: Buffer.byteLength(`${output}\n`, "utf-8"),
  };
  const rawRef = buildRawRef(job, command);
  const reports: NormalizedExecutionReport[] = [
    {
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      status: "accepted",
      progress: { percent: 0, message: `${job.harness.agent_runtime} harness accepted the job` },
      artifacts: [],
      error: null,
      raw_ref: rawRef,
      created_at: acceptedAt,
    },
    {
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      status: "running",
      progress: { percent: 50, message: `Running ${job.harness.agent_runtime} command harness` },
      artifacts: [],
      error: null,
      raw_ref: rawRef,
      created_at: runningAt,
    },
    {
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      status: "completed",
      progress: { percent: 100, message: output.slice(0, 500) },
      artifacts: [artifact],
      error: null,
      raw_ref: rawRef,
      created_at: completedAt,
    },
  ];
  const handoff: NodeHandoff = {
    type: "node_handoff",
    handoff_id: `handoff:${job.job_id}:success`,
    job_id: job.job_id,
    run_id: job.run_id,
    node_run_id: job.node_run_id,
    node_id: job.node_id,
    port: "success",
    content: { summary: output.slice(0, 2000), artifacts: [artifact] },
    content_ref: artifact.storage_uri,
    summary: `${job.node_name} completed through ${job.harness.agent_runtime}.`,
    created_at: completedAt,
  };
  return { reports, handoffs: [handoff] };
}
