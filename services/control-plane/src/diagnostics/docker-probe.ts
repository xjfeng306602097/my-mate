import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { RUNTIME_PROTOCOL_VERSION } from "../runtime-protocol.js";
import { deriveRuntimeWorkerToken } from "../runtime-worker-auth.js";
import { runtimeWorkerWebSocketUrl } from "../runtime-worker-hub.js";
import type {
  DoctorCommandResult,
  DoctorCommandRunner,
  DoctorWorkerHub,
} from "./types.js";

export const defaultDoctorCommandRunner: DoctorCommandRunner = (
  command,
  args,
  timeoutMs,
) =>
  new Promise<DoctorCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf-8").trim(),
        stderr: Buffer.concat(stderr).toString("utf-8").trim(),
      });
    });
  });

export async function requireSuccessfulCommand(input: {
  runner: DoctorCommandRunner;
  command: string;
  args: string[];
  timeoutMs?: number;
}): Promise<DoctorCommandResult> {
  const result = await input.runner(
    input.command,
    input.args,
    input.timeoutMs || 15_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Command exited with ${result.exitCode}.`);
  }
  return result;
}

export function dockerManagerUrl(publicBaseUrl: string, workerId: string): string {
  const base = new URL(publicBaseUrl);
  if (base.hostname === "127.0.0.1" || base.hostname === "localhost") {
    base.hostname = "host.docker.internal";
  }
  return runtimeWorkerWebSocketUrl(base.toString(), workerId);
}

export async function runDockerMountProbe(input: {
  runner: DoctorCommandRunner;
  dockerBin: string;
  image: string;
  workspaceRoot: string;
}): Promise<void> {
  fs.mkdirSync(input.workspaceRoot, { recursive: true });
  const probeDir = fs.mkdtempSync(path.join(input.workspaceRoot, "doctor-mount-"));
  try {
    fs.chmodSync(probeDir, 0o777);
    await requireSuccessfulCommand({
      runner: input.runner,
      command: input.dockerBin,
      args: [
        "run",
        "--rm",
        "--mount",
        `type=bind,source=${probeDir},target=/workspace`,
        "--entrypoint",
        "node",
        input.image,
        "-e",
        "const fs=require('node:fs');const p='/workspace/doctor.txt';fs.writeFileSync(p,'ok');if(fs.readFileSync(p,'utf8')!=='ok')process.exit(2);",
      ],
      timeoutMs: 30_000,
    });
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

export async function runDockerWorkerRegistrationProbe(input: {
  runner: DoctorCommandRunner;
  dockerBin: string;
  image: string;
  publicBaseUrl: string;
  workerHub: DoctorWorkerHub;
  timeoutMs?: number;
}): Promise<void> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const workerId = `doctor-${suffix}`;
  const containerName = `my-mate-doctor-${suffix}`;
  const token = deriveRuntimeWorkerToken(workerId);
  input.workerHub.expectWorker({
    workerId,
    token,
    metadata: { diagnostics: true },
  });
  let started = false;
  try {
    await requireSuccessfulCommand({
      runner: input.runner,
      command: input.dockerBin,
      args: [
        "run",
        "-d",
        "--rm",
        "--name",
        containerName,
        "-e",
        `MY_MATE_MANAGER_WS_URL=${dockerManagerUrl(input.publicBaseUrl, workerId)}`,
        "-e",
        `MY_MATE_WORKER_ID=${workerId}`,
        "-e",
        `MY_MATE_WORKER_TOKEN=${token}`,
        input.image,
      ],
      timeoutMs: 30_000,
    });
    started = true;
    await input.workerHub.waitForWorker(workerId, input.timeoutMs || 15_000);
  } finally {
    input.workerHub.releaseWorker(workerId, "doctor_probe_complete");
    if (started) {
      await input.runner(input.dockerBin, ["rm", "-f", containerName], 10_000).catch(
        () => ({ exitCode: 1, stdout: "", stderr: "cleanup failed" }),
      );
    }
  }
}

export function expectedRuntimeProtocol(): string {
  return RUNTIME_PROTOCOL_VERSION;
}
