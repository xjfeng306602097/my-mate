import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildAgentHarnessResult } from "./agent-result.js";
import { ClaudeSdkProviderSession } from "../provider-adapters/claude-sdk.js";
import type { HarnessClient, RuntimeWorkerJob } from "../types.js";
import { workspaceContextPrompt } from "../workspace-context.js";
import { artifactOutputPrompt } from "../artifact-collector.js";

type ClaudeQuery = (params: Parameters<typeof query>[0]) => AsyncIterable<unknown>;
let claudeQuery: ClaudeQuery = query;

export function setClaudeAgentSdkQueryForTest(next: ClaudeQuery | null): void {
  claudeQuery = next || query;
}

const TOOL_MAP: Record<string, string[]> = {
  read: ["Read", "Grep", "Glob", "LS"],
  shell: ["Bash"],
  write: ["Write", "Edit", "MultiEdit"],
};

function promptFrom(job: RuntimeWorkerJob): string {
  const envelope = job.envelope as Record<string, unknown>;
  const intent = typeof envelope.intent === "string" && envelope.intent.trim()
    ? envelope.intent
    : `Execute ${job.node_name}`;
  return [intent, workspaceContextPrompt(job), artifactOutputPrompt(job)].filter(Boolean).join("\n\n");
}

function allowedTools(job: RuntimeWorkerJob): string[] {
  const tools = new Set<string>();
  for (const requested of job.harness.allowed_tools) {
    for (const tool of TOOL_MAP[requested.toLowerCase()] || []) tools.add(tool);
    if (/^[A-Z][A-Za-z]+$/.test(requested)) tools.add(requested);
  }
  return [...tools];
}

function providerEnv(job: RuntimeWorkerJob, model: string): NodeJS.ProcessEnv {
  const env = { ...process.env, ...job.provision.env };
  const runtime = job.harness.agent_runtime;
  const apiKey = runtime === "glm"
    ? env.GLM_API_KEY || env.ZAI_API_KEY || env.ZHIPU_API_KEY
    : env.ANTHROPIC_API_KEY;
  const baseUrl = runtime === "glm"
    ? env.MY_MATE_GLM_ANTHROPIC_BASE_URL
    : env.ANTHROPIC_BASE_URL;
  if (runtime === "glm" && !baseUrl) {
    throw new Error("GLM Agent Harness requires MY_MATE_GLM_ANTHROPIC_BASE_URL.");
  }
  if (runtime === "glm" && !apiKey) {
    throw new Error("GLM Agent Harness requires GLM_API_KEY, ZAI_API_KEY, or ZHIPU_API_KEY.");
  }
  if (runtime === "glm") {
    delete env.CLAUDE_CODE_USE_BEDROCK;
    delete env.CLAUDE_CODE_USE_VERTEX;
    delete env.CLAUDE_CODE_USE_FOUNDRY;
    env.ANTHROPIC_MODEL = model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
    env.ANTHROPIC_SMALL_FAST_MODEL = model;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    env.DISABLE_TELEMETRY = "1";
    env.DISABLE_ERROR_REPORTING = "1";
  }
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl.replace(/\/+$/, "");
  return env;
}

export function createClaudeAgentSdkHarness(): HarnessClient {
  return {
    async execute(job, emit, signal) {
      const configuredEnv = { ...process.env, ...job.provision.env };
      const model = job.harness.runtime_agent_ref ||
        (job.harness.agent_runtime === "glm"
          ? configuredEnv.MY_MATE_GLM_MODEL || "glm-5.2"
          : configuredEnv.MY_MATE_CLAUDE_MODEL || "sonnet");
      const env = providerEnv(job, model);
      const adapter = new ClaudeSdkProviderSession(model, job.harness.agent_runtime);
      const tools = allowedTools(job);
      const abortController = new AbortController();
      const timeoutMs = Math.max(5_000, Number(env.MY_MATE_AGENT_SDK_TIMEOUT_MS) || 120_000);
      let timedOut = false;
      let stderrTail = "";
      let rejectInterruption: (error: Error) => void = () => {};
      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = reject;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        abortController.abort();
        rejectInterruption(new Error(`Claude Agent SDK timed out after ${timeoutMs}ms${stderrTail ? `: ${stderrTail.slice(-1500)}` : "."}`));
      }, timeoutMs);
      const abort = () => {
        abortController.abort();
        rejectInterruption(new Error("Claude Agent SDK execution was aborted."));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
      let iterator: AsyncIterator<unknown> | null = null;
      try {
        const stream = claudeQuery({
          prompt: promptFrom(job),
          options: {
            model,
            settingSources: [],
            cwd: env.MY_MATE_WORKSPACE || process.cwd(),
            tools,
            allowedTools: tools,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            maxTurns: Math.max(1, Number(env.MY_MATE_AGENT_MAX_TURNS) || 8),
            abortController,
            env,
            stderr: (chunk: string) => {
              stderrTail = `${stderrTail}${chunk}`.slice(-4000);
            },
          },
        });
        iterator = stream[Symbol.asyncIterator]();
        let providerError: string | null = null;
        while (true) {
          const next = await Promise.race([iterator.next(), interruption]);
          if (next.done) break;
          const message = next.value;
          for (const event of adapter.ingest(message)) {
            if (event.kind === "error") providerError = event.summary;
            await emit(event);
          }
        }
        for (const event of adapter.finish()) await emit(event);
        if (timedOut) {
          throw new Error(`Claude Agent SDK timed out after ${timeoutMs}ms${stderrTail ? `: ${stderrTail.slice(-1500)}` : "."}`);
        }
        if (providerError) throw new Error(providerError);
        const output = adapter.getOutputText();
        if (!output) throw new Error("Claude Agent SDK completed without model text.");
        return buildAgentHarnessResult({
          job,
          output,
          backend: job.harness.agent_runtime === "glm" ? "glm-claude-agent-sdk" : "claude-agent-sdk",
        });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (iterator?.return) {
          try {
            await Promise.race([
              Promise.resolve(iterator.return()),
              new Promise((resolve) => setTimeout(resolve, 2_000)),
            ]);
          } catch {}
        }
      }
    },
  };
}
