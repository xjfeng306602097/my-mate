import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { buildAgentHarnessResult } from "./agent-result.js";
import { CodexProviderSession } from "../provider-adapters/codex.js";
import type { HarnessClient, RuntimeWorkerJob } from "../types.js";
import { workspaceContextPrompt } from "../workspace-context.js";
import { artifactOutputPrompt } from "../artifact-collector.js";

const MUTABLE_TOOL_PATTERN = /(?:^|[-_.])(write|edit|patch|apply_patch|save|delete|remove|rename|move|shell|terminal|exec|command|bash|powershell|cmd|git)(?:$|[-_.])/i;

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class CodexAppServerSession {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private notifications: Record<string, unknown>[] = [];
  private waiters: Array<() => void> = [];
  private stderr = "";
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly job: RuntimeWorkerJob) {
    this.env = { ...process.env, ...job.provision.env };
    if (!this.env.OPENAI_API_KEY && this.env.CODEX_API_KEY) {
      this.env.OPENAI_API_KEY = this.env.CODEX_API_KEY;
    }
  }

  async run(emit: Parameters<HarnessClient["execute"]>[1], signal: AbortSignal) {
    const adapter = new CodexProviderSession(this.job.harness.runtime_agent_ref);
    this.start();
    const abort = () => { void this.stop(); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    try {
      await this.request("initialize", {
        clientInfo: { name: "my_mate_runtime_worker", title: "My Mate Runtime Worker", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      const thread = await this.request("thread/start", {
        cwd: this.env.MY_MATE_WORKSPACE || process.cwd(),
        model: this.job.harness.runtime_agent_ref || null,
        approvalPolicy: "never",
        sandbox: this.job.harness.allowed_tools.some((tool) => MUTABLE_TOOL_PATTERN.test(tool))
          ? "workspace-write"
          : "read-only",
        ephemeral: true,
        dynamicTools: [],
      });
      const threadId = typeof thread.threadId === "string"
        ? thread.threadId
        : typeof thread.thread_id === "string"
          ? thread.thread_id
          : (thread.thread as Record<string, unknown> | undefined)?.id;
      if (typeof threadId !== "string") throw new Error("Codex thread/start returned no thread id.");
      const envelope = this.job.envelope as Record<string, unknown>;
      const intent = typeof envelope.intent === "string" ? envelope.intent : `Execute ${this.job.node_name}`;
      const prompt = [
        intent,
        workspaceContextPrompt(this.job),
        artifactOutputPrompt(this.job),
      ].filter(Boolean).join("\n\n");
      await this.request("turn/start", {
        threadId,
        cwd: this.env.MY_MATE_WORKSPACE || process.cwd(),
        model: this.job.harness.runtime_agent_ref || null,
        input: [{ type: "text", text: prompt, text_elements: [] }],
      });
      let completed = false;
      let providerError: string | null = null;
      while (!completed && !signal.aborted) {
        const notification = await this.nextNotification();
        const method = String(notification.method || "");
        for (const event of adapter.ingest(notification)) {
          if (event.kind === "error") providerError = event.summary;
          await emit(event);
        }
        completed = method.replaceAll("/", ".") === "turn.completed";
      }
      for (const event of adapter.finish()) await emit(event);
      if (signal.aborted) throw new Error("Codex app-server execution was aborted.");
      if (providerError) throw new Error(providerError);
      const output = adapter.getOutputText();
      if (!output) throw new Error("Codex app-server completed without model text.");
      return buildAgentHarnessResult({ job: this.job, output, backend: "codex-appserver" });
    } catch (error) {
      const detail = this.stderr.trim();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(detail ? `${message}: ${detail.slice(-1500)}` : message);
    } finally {
      signal.removeEventListener("abort", abort);
      await this.stop();
    }
  }

  private start(): void {
    const binary = this.env.MY_MATE_CODEX_BIN || "codex";
    let args = ["app-server", "--stdio"];
    if (this.env.MY_MATE_CODEX_APP_SERVER_ARGS_JSON) {
      const configured = JSON.parse(this.env.MY_MATE_CODEX_APP_SERVER_ARGS_JSON) as unknown;
      if (!Array.isArray(configured) || !configured.every((item) => typeof item === "string")) {
        throw new Error("MY_MATE_CODEX_APP_SERVER_ARGS_JSON must be a JSON string array.");
      }
      args = configured;
    }
    this.process = spawn(binary, args, {
      cwd: this.env.MY_MATE_WORKSPACE || process.cwd(),
      env: this.env,
      shell:
        process.platform === "win32" &&
        (!path.isAbsolute(binary) || /\.(?:cmd|bat|ps1)$/i.test(binary)),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf-8")}`.slice(-4000);
    });
    this.process.once("error", (error) => this.rejectAll(error));
    this.process.once("exit", (code) => this.rejectAll(new Error(`Codex app-server exited with code ${code}.`)));
    if (!this.process.stdout) throw new Error("Codex app-server stdout is unavailable.");
    this.readline = createInterface({ input: this.process.stdout });
    this.readline.on("line", (line) => this.handleLine(line));
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message.method === "string") {
      this.notifications.push(message);
      for (const waiter of this.waiters.splice(0)) waiter();
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    const rpcError = message.error as { code?: number; message?: string } | undefined;
    if (rpcError) pending.reject(new Error(`Codex JSON-RPC ${rpcError.code}: ${rpcError.message}`));
    else pending.resolve((message.result as Record<string, unknown>) || {});
  }

  private request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.process?.stdin) return Promise.reject(new Error("Codex app-server is not running."));
    const id = ++this.requestId;
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex JSON-RPC request ${method} timed out.`));
      }, Math.max(5_000, Number(this.env.MY_MATE_AGENT_REQUEST_TIMEOUT_MS) || 60_000));
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private nextNotification(): Promise<Record<string, unknown>> {
    if (this.notifications.length > 0) return Promise.resolve(this.notifications.shift()!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Codex app-server notification timed out.")),
        Math.max(5_000, Number(this.env.MY_MATE_AGENT_TURN_TIMEOUT_MS) || 120_000));
      const waiter = () => {
        clearTimeout(timer);
        const next = this.notifications.shift();
        if (next) resolve(next);
      };
      this.waiters.push(waiter);
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async stop(): Promise<void> {
    this.rejectAll(new Error("Codex app-server stopped."));
    this.readline?.close();
    this.readline = null;
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null) return;
    child.stdin?.end();
    child.kill();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export function createCodexAppServerHarness(): HarnessClient {
  return {
    async execute(job, emit, signal) {
      return await new CodexAppServerSession(job).run(emit, signal);
    },
  };
}
