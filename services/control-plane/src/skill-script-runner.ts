import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RUNTIME_WORKER_IMAGE } from "./config.js";
import { CapabilityToolError } from "./capability-registry.js";
import { getSkillHost } from "./skill-host.js";
import { getActiveSessionWorkspaceBinding } from "./workspace-binding-store.js";
import {
  conversationWorkspaceRoot,
  ensureConversationCodingTransaction,
} from "./conversation-coding-workspace.js";
import type { SessionRecord } from "./types.js";

const execFileAsync = promisify(execFile);

type DockerExec = (
  executable: string,
  args: string[],
  options: Record<string, unknown>,
) => Promise<{ stdout: string; stderr: string }>;

function containerEntrypoint(runtime: "node" | "python" | "shell"): string {
  return runtime === "python" ? "python3" : runtime === "shell" ? "/bin/sh" : "node";
}

export async function runSkillScript(input: {
  session: SessionRecord;
  skillId: string;
  scriptId: string;
  arguments: Record<string, unknown>;
  idempotencyKey: string;
}, dependencies: { execDocker?: DockerExec } = {}): Promise<Record<string, unknown>> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 160) {
    throw new CapabilityToolError("idempotency_key_required", "Skill scripts require a bounded stable idempotency key.");
  }
  const workspaceId = input.session.workspace_id || "default";
  const resolved = getSkillHost().resolveActiveScript(workspaceId, input.session.session_id, input.skillId, input.scriptId);
  const binding = getActiveSessionWorkspaceBinding(input.session.session_id);
  if (!binding || binding.status !== "active") {
    throw new CapabilityToolError("skill_script_workspace_unavailable", "The active Session has no authorized Task Workspace.");
  }
  if (resolved.script.workspace_access === "write" && binding.access !== "sandbox-write") {
    throw new CapabilityToolError("skill_script_workspace_write_not_authorized", "The Task Workspace is not authorized for sandboxed writes.");
  }
  const inputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-skill-input-"));
  const inputPath = path.join(inputRoot, "input.json");
  fs.writeFileSync(inputPath, JSON.stringify(input.arguments), { encoding: "utf-8", mode: 0o600 });
  const mountMode = resolved.script.workspace_access === "write" ? "rw" : "ro";
  const workspaceRoot = resolved.script.workspace_access === "write"
    ? ensureConversationCodingTransaction(input.session).sandbox_root
    : conversationWorkspaceRoot(input.session.session_id, binding);
  const network = resolved.script.network === "public" ? "bridge" : "none";
  const args = [
    "run", "--rm", "--read-only", "--network", network,
    "--memory", "512m", "--cpus", "1", "--pids-limit", "128",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
    "--mount", `type=bind,source=${resolved.packageRoot},target=/skill,readonly`,
    "--mount", `type=bind,source=${workspaceRoot},target=/workspace,${mountMode}`,
    "--mount", `type=bind,source=${inputPath},target=/input.json,readonly`,
    "--env", "MY_MATE_SKILL_INPUT_FILE=/input.json",
    "--env", "MY_MATE_SKILL_WORKSPACE=/workspace",
    "--env", `MY_MATE_IDEMPOTENCY_KEY=${idempotencyKey}`,
    "--workdir", "/workspace", "--entrypoint", containerEntrypoint(resolved.script.runtime),
    RUNTIME_WORKER_IMAGE, `/skill/${resolved.script.entrypoint}`,
  ];
  try {
    const executeDocker = dependencies.execDocker || execFileAsync as DockerExec;
    const result = await executeDocker("docker", args, {
      timeout: resolved.script.timeout_seconds * 1000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    const stdout = result.stdout.trim();
    let output: unknown = stdout;
    try { output = stdout ? JSON.parse(stdout) : {}; } catch {}
    return {
      ok: true,
      skill_id: input.skillId,
      script_id: input.scriptId,
      runtime: resolved.script.runtime,
      network: resolved.script.network,
      workspace_access: resolved.script.workspace_access,
      output: output && typeof output === "object" ? output : { text: String(output).slice(0, 100_000) },
      stderr_present: !!result.stderr.trim(),
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "skill_script_failed";
    throw new CapabilityToolError(
      code === "ENOENT" ? "skill_script_docker_unavailable" : "skill_script_execution_failed",
      code === "ENOENT"
        ? "Docker is unavailable, so the Skill script was not executed."
        : "The sandboxed Skill script failed without exposing private output.",
    );
  } finally {
    fs.rmSync(inputRoot, { recursive: true, force: true });
  }
}
