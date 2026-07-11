import type { RuntimeAgentRuntime } from "../types.js";
import { ClaudeSdkProviderSession } from "./claude-sdk.js";
import { CodexProviderSession } from "./codex.js";
import { KimiProviderSession } from "./kimi.js";
import { OpenClawProviderSession } from "./openclaw.js";
import type { ProviderAdapterOptions, ProviderAdapterSession } from "./types.js";

export function createProviderAdapterSession(
  runtime: RuntimeAgentRuntime,
  options: ProviderAdapterOptions = {},
): ProviderAdapterSession | null {
  if (runtime === "codex") return new CodexProviderSession(options.model);
  if (runtime === "claude-sdk") return new ClaudeSdkProviderSession(options.model);
  if (runtime === "kimi") return new KimiProviderSession(options.model);
  if (runtime === "openclaw") return new OpenClawProviderSession(options.model);
  return null;
}
