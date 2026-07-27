import type { ExecutionAdapter } from "./execution-adapter.js";
import {
  getExecutionAdapterFactory,
  hasExecutionAdapter,
  listRegisteredExecutionAdapterKinds,
  registerExecutionAdapter,
} from "./execution-adapter-registry.js";
import { LocalExecutionAdapter } from "./local-execution-engine.js";

let adapterInstance: ExecutionAdapter | null = null;
let builtInAdaptersRegistered = false;

function registerBuiltInExecutionAdapters(): void {
  if (builtInAdaptersRegistered) {
    return;
  }
  registerExecutionAdapter("local", () => new LocalExecutionAdapter());
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

  adapterInstance = resolveExecutionAdapterFactory("local")();
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
