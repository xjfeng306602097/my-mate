import type {
  HarnessEvidenceEvent,
  UsageSummary,
  WorkerEvidenceKind,
} from "../types.js";
import type { ProviderAdapterSession } from "./types.js";
import { eventIdFrom, modelFrom } from "./utils.js";

interface EventOptions {
  nativeId?: string | null;
  toolCallId?: string | null;
  payload?: unknown;
  usage?: UsageSummary | null;
  createdAt?: string;
}

export abstract class BaseProviderSession implements ProviderAdapterSession {
  protected readonly textBuffers = new Map<string, string>();
  protected readonly thinkingBuffers = new Map<string, string>();
  protected model: string | null;
  private currentNativeId = "event:0";
  private currentEmission = 0;
  private inputSequence = 0;
  private recognized = 0;
  private usageEvents = 0;
  private readonly outputParts: string[] = [];

  constructor(
    protected readonly provider: string,
    model?: string | null,
  ) {
    this.model = model || null;
  }

  abstract ingest(value: unknown): HarnessEvidenceEvent[];

  finish(): HarnessEvidenceEvent[] {
    this.beginSyntheticFlush();
    return [
      ...this.flushTextBuffers(),
      ...this.flushThinkingBuffers(),
    ];
  }

  getOutputText(): string | null {
    const output = this.outputParts.join("").trim();
    return output || null;
  }

  recognizedEventCount(): number {
    return this.recognized;
  }

  usageEventCount(): number {
    return this.usageEvents;
  }

  protected begin(value: unknown): void {
    this.recognized += 1;
    this.inputSequence += 1;
    this.currentEmission = 0;
    const providerEventId = eventIdFrom(value);
    this.currentNativeId = providerEventId
      ? `${providerEventId}:${this.provider}:event:${this.inputSequence}`
      : `${this.provider}:event:${this.inputSequence}`;
    this.model = modelFrom(value) || this.model;
  }

  protected beginSyntheticFlush(): void {
    this.inputSequence += 1;
    this.currentEmission = 0;
    this.currentNativeId = `${this.provider}:finish:${this.inputSequence}`;
  }

  protected appendText(key: string, text: string): void {
    if (text) this.textBuffers.set(key, `${this.textBuffers.get(key) || ""}${text}`);
  }

  protected appendThinking(key: string, text: string): void {
    if (text) this.thinkingBuffers.set(key, `${this.thinkingBuffers.get(key) || ""}${text}`);
  }

  protected replaceText(key: string, text: string): void {
    if (text) this.textBuffers.set(key, text);
  }

  protected replaceThinking(key: string, text: string): void {
    if (text) this.thinkingBuffers.set(key, text);
  }

  protected emit(
    kind: WorkerEvidenceKind,
    summary: string,
    options: EventOptions = {},
  ): HarnessEvidenceEvent {
    const nativeBase = options.nativeId || this.currentNativeId;
    const nativeId = `${nativeBase}:${++this.currentEmission}`;
    if (kind === "model_text") this.outputParts.push(summary);
    if (kind === "usage") this.usageEvents += 1;
    return {
      kind,
      summary,
      source: {
        provider: this.provider,
        model: this.model,
        native_event_id: nativeId,
        synthetic: false,
      },
      trace: options.toolCallId ? { tool_call_id: options.toolCallId } : undefined,
      inline_payload: options.payload,
      usage: options.usage,
      created_at: options.createdAt,
    };
  }

  protected flushText(key: string): HarnessEvidenceEvent[] {
    const text = this.textBuffers.get(key) || "";
    this.textBuffers.delete(key);
    return text ? [this.emit("model_text", text, { payload: { text } })] : [];
  }

  protected flushThinking(key: string): HarnessEvidenceEvent[] {
    const text = this.thinkingBuffers.get(key) || "";
    this.thinkingBuffers.delete(key);
    return text ? [this.emit("thinking", text, { payload: { text } })] : [];
  }

  protected flushTextBuffers(): HarnessEvidenceEvent[] {
    return [...this.textBuffers.keys()].flatMap((key) => this.flushText(key));
  }

  protected flushThinkingBuffers(): HarnessEvidenceEvent[] {
    return [...this.thinkingBuffers.keys()].flatMap((key) => this.flushThinking(key));
  }
}
