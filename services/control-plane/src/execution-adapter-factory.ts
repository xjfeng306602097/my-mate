import { EXECUTION_ADAPTER_KIND } from "./config.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import {
  getExecutionAdapterFactory,
  hasExecutionAdapter,
  listRegisteredExecutionAdapterKinds,
  registerExecutionAdapter,
} from "./execution-adapter-registry.js";
import { DeferredHarnessExecutionAdapter } from "./harness-execution-adapter.js";
import { LocalExecutionAdapter } from "./local-execution-engine.js";
import { OpenClawExecutionAdapter } from "./openclaw-execution-adapter.js";

let adapterInstance: ExecutionAdapter | null = null;
let builtInAdaptersRegistered = false;

function registerBuiltInExecutionAdapters(): void {
  if (builtInAdaptersRegistered) {
    return;
  }
  registerExecutionAdapter("local", () => new LocalExecutionAdapter());
  registerExecutionAdapter("openclaw", () => new OpenClawExecutionAdapter());
  registerExecutionAdapter("codex", () => new DeferredHarnessExecutionAdapter("codex"));
  registerExecutionAdapter("claude-sdk", () => new DeferredHarnessExecutionAdapter("claude-sdk"));
  registerExecutionAdapter("kimi", () => new DeferredHarnessExecutionAdapter("kimi"));
  builtInAdaptersRegistered = true;
}

function resolveExecutionAdapterFactory(kind: string) {
  registerBuiltInExecutionAdapters();
  const factory = getExecutionAdapterFactory(kind);
  if (factory) {
    return factory;
  }
  console.warn(
    `[execution-adapter-factory] Unknown adapter "${kind}", falling back to local.`,
  );
  return getExecutionAdapterFactory("local") || (() => new LocalExecutionAdapter());
}

export function getExecutionAdapter(): ExecutionAdapter {
  if (adapterInstance) {
    return adapterInstance;
  }

  adapterInstance = resolveExecutionAdapterFactory(EXECUTION_ADAPTER_KIND)();
  return adapterInstance;
}

export function listAvailableExecutionAdapterKinds(): string[] {
  registerBuiltInExecutionAdapters();
  return listRegisteredExecutionAdapterKinds();
}

export function isExecutionAdapterKindRegistered(kind: string): boolean {
  registerBuiltInExecutionAdapters();
  return hasExecutionAdapter(kind);
}

export { registerExecutionAdapter };
