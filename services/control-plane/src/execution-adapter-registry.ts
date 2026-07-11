import type { ExecutionAdapter } from "./execution-adapter.js";

export type ExecutionAdapterFactory = () => ExecutionAdapter;

const adapterFactories = new Map<string, ExecutionAdapterFactory>();

function normalizeAdapterKind(kind: string): string {
  return kind.trim().toLowerCase();
}

export function registerExecutionAdapter(
  kind: string,
  factory: ExecutionAdapterFactory,
): void {
  const normalized = normalizeAdapterKind(kind);
  if (!normalized) {
    throw new Error("Execution adapter kind is required.");
  }
  adapterFactories.set(normalized, factory);
}

export function getExecutionAdapterFactory(kind: string): ExecutionAdapterFactory | null {
  return adapterFactories.get(normalizeAdapterKind(kind)) || null;
}

export function hasExecutionAdapter(kind: string): boolean {
  return adapterFactories.has(normalizeAdapterKind(kind));
}

export function listRegisteredExecutionAdapterKinds(): string[] {
  return [...adapterFactories.keys()].sort();
}
