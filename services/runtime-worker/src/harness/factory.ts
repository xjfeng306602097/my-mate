import { runLocalHarness } from "./local.js";
import { runOpenClawHarness } from "./openclaw.js";
import { runCommandHarness } from "./command.js";
import {
  emitSyntheticResultEvidence,
  emitUnavailableNativeUsage,
} from "./synthetic-evidence.js";
import { createProviderAdapterSession } from "../provider-adapters/registry.js";
import type { HarnessClient, HarnessResult, RuntimeWorkerJob } from "../types.js";

export type RuntimeWorkerHarness = HarnessClient;

const COMMAND_ENV_BY_RUNTIME: Record<string, string> = {
  codex: "MY_MATE_CODEX_COMMAND",
  "claude-sdk": "MY_MATE_CLAUDE_SDK_COMMAND",
  kimi: "MY_MATE_KIMI_COMMAND",
};

export function getSupportedHarnesses(): string[] {
  const supported = ["local"];
  if (process.env.MY_MATE_OPENCLAW_WORKER_BRIDGE_URL) {
    supported.push("openclaw");
  }
  if (process.env.MY_MATE_CODEX_COMMAND) {
    supported.push("codex");
  }
  if (process.env.MY_MATE_CLAUDE_SDK_COMMAND) {
    supported.push("claude-sdk");
  }
  if (process.env.MY_MATE_KIMI_COMMAND) {
    supported.push("kimi");
  }
  return supported;
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

function nativeOpenClawHarness(): RuntimeWorkerHarness {
  return {
    async execute(job, emit, signal) {
      const result = await runOpenClawHarness(job, { signal });
      const adapter = createProviderAdapterSession("openclaw");
      if (!adapter) throw new Error("OpenClaw provider adapter is unavailable.");
      for (const value of result.native_events) {
        for (const event of adapter.ingest(value)) await emit(event);
      }
      for (const event of adapter.finish()) await emit(event);
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

  if (job.harness.agent_runtime === "openclaw") {
    return nativeOpenClawHarness();
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
