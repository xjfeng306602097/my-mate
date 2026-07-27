import { spawnSync } from "node:child_process";
import { runLocalHarness } from "./local.js";
import { runCommandHarness } from "./command.js";
import { createClaudeAgentSdkHarness } from "./claude-agent-sdk.js";
import { createCodexAppServerHarness } from "./codex-appserver.js";
import {
  emitSyntheticResultEvidence,
  emitUnavailableNativeUsage,
} from "./synthetic-evidence.js";
import { createProviderAdapterSession } from "../provider-adapters/registry.js";
import type { HarnessClient, HarnessResult, RuntimeWorkerJob } from "../types.js";

export type RuntimeWorkerHarness = HarnessClient;

function commandAvailable(command: string): boolean {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], {
    windowsHide: true,
    stdio: "ignore",
  });
  return result.status === 0;
}

const COMMAND_ENV_BY_RUNTIME: Record<string, string> = {
  codex: "MY_MATE_CODEX_COMMAND",
  "claude-sdk": "MY_MATE_CLAUDE_SDK_COMMAND",
  kimi: "MY_MATE_KIMI_COMMAND",
  glm: "MY_MATE_GLM_COMMAND",
};

export function getSupportedHarnesses(): string[] {
  const supported = ["local", "claude-sdk", "glm"];
  if (process.env.MY_MATE_CODEX_BIN || process.env.MY_MATE_CODEX_COMMAND || commandAvailable("codex")) {
    supported.push("codex");
  }
  if (process.env.MY_MATE_KIMI_COMMAND) {
    supported.push("kimi");
  }
  return supported;
}

export function getHarnessCapabilities(): Record<string, {
  controls: Array<"pause" | "resume" | "cancel">;
  native_human_gate: boolean;
}> {
  return Object.fromEntries(getSupportedHarnesses().map((runtime) => [runtime, {
    controls: runtime === "local" ? ["resume", "cancel"] : ["cancel"],
    native_human_gate: runtime === "local",
  }]));
}

function aggregateHarness(
  run: (job: RuntimeWorkerJob, options?: { signal?: AbortSignal }) => Promise<HarnessResult>,
): RuntimeWorkerHarness {
  return {
    async execute(job, emit, signal) {
      const result = await run(job, { signal });
      await emitSyntheticResultEvidence(job, result, emit);
      return result;
    },
  };
}

function nativeCommandHarness(command: string): RuntimeWorkerHarness {
  return {
    async execute(job, emit, signal) {
      const adapter = createProviderAdapterSession(job.harness.agent_runtime);
      if (!adapter) {
        const result = await runCommandHarness(job, command, { signal });
        await emitSyntheticResultEvidence(job, result, emit);
        return result;
      }
      const ingestLine = async (line: string) => {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          return;
        }
        for (const event of adapter.ingest(value)) await emit(event);
      };
      const result = await runCommandHarness(job, command, {
        signal,
        onStdoutLine: ingestLine,
        afterStdout: async () => {
          for (const event of adapter.finish()) await emit(event);
        },
        selectOutput: () => adapter.getOutputText(),
      });
      if (adapter.recognizedEventCount() === 0) {
        await emitSyntheticResultEvidence(job, result, emit);
        return result;
      }
      await emitSyntheticResultEvidence(job, result, emit, {
        includeTerminal: false,
        includeUsage: false,
      });
      if (adapter.usageEventCount() === 0) await emitUnavailableNativeUsage(job, emit);
      return result;
    },
  };
}

export function getHarness(job: RuntimeWorkerJob): RuntimeWorkerHarness {
  if (job.harness.agent_runtime === "local") {
    return aggregateHarness(runLocalHarness);
  }

  if (
    job.harness.agent_runtime === "codex" &&
    (process.env.MY_MATE_CODEX_HARNESS || "app-server") !== "command"
  ) {
    return createCodexAppServerHarness();
  }

  if (job.harness.agent_runtime === "claude-sdk" || job.harness.agent_runtime === "glm") {
    const mode = job.harness.agent_runtime === "glm"
      ? process.env.MY_MATE_GLM_HARNESS
      : process.env.MY_MATE_CLAUDE_HARNESS;
    if ((mode || "agent-sdk") !== "command") return createClaudeAgentSdkHarness();
  }

  const commandEnv = COMMAND_ENV_BY_RUNTIME[job.harness.agent_runtime];
  const command = commandEnv ? process.env[commandEnv] : null;
  if (command) {
    return nativeCommandHarness(command);
  }

  return {
    async execute() {
      throw new Error(`Unsupported runtime worker harness: ${job.harness.agent_runtime}`);
    },
  };
}
