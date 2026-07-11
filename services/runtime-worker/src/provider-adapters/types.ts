import type { HarnessEvidenceEvent } from "../types.js";

export interface ProviderAdapterSession {
  ingest(value: unknown): HarnessEvidenceEvent[];
  finish(): HarnessEvidenceEvent[];
  getOutputText(): string | null;
  recognizedEventCount(): number;
  usageEventCount(): number;
}

export interface ProviderAdapterOptions {
  model?: string | null;
}
