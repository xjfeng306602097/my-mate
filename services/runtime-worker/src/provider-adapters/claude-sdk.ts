import type { HarnessEvidenceEvent } from "../types.js";
import { BaseProviderSession } from "./base-session.js";
import { asRecord, asString, normalizeUsage, textFromContent } from "./utils.js";

export class ClaudeSdkProviderSession extends BaseProviderSession {
  private readonly blockKinds = new Map<number, string>();
  private readonly toolInputs = new Map<number, string>();
  private readonly toolIds = new Map<number, string>();
  private readonly toolNames = new Map<number, string>();

  constructor(model?: string | null, provider = "claude-sdk") {
    super(provider, model);
  }

  ingest(value: unknown): HarnessEvidenceEvent[] {
    const record = asRecord(value);
    if (!record) return [];
    const type = asString(record.type) || "";

    if (type === "assistant" || type === "user") {
      this.begin(value);
      const message = asRecord(record.message) || record;
      const blocks = Array.isArray(message.content) ? message.content : [];
      const events = blocks.flatMap((block) => this.completeBlock(asRecord(block) || {}));
      if (type === "assistant" && asRecord(message.usage)) {
        const usage = normalizeUsage(message.usage);
        events.push(this.emit("usage", "Claude provider usage reported.", { usage, payload: usage }));
      }
      return events;
    }

    if (type === "stream_event") {
      const event = asRecord(record.event);
      if (!event) return [];
      this.begin(value);
      return this.ingestStreamEvent(event);
    }

    if (type === "result") {
      this.begin(value);
      const events = [...this.flushTextBuffers(), ...this.flushThinkingBuffers()];
      const usageValue = record.usage ?? asRecord(record.message)?.usage;
      const usage = normalizeUsage(usageValue, {
        durationMs: record.duration_ms,
        turnCount: record.num_turns,
        providerCostUsd: record.total_cost_usd,
      });
      if (usage.availability !== "unavailable") {
        events.push(this.emit("usage", "Claude provider usage reported.", { usage, payload: usage }));
      }
      if (record.is_error === true || record.subtype === "error") {
        events.push(this.emit("error", asString(record.result) || "Claude provider error.", { payload: record }));
      }
      events.push(this.emit("model_turn", "Claude model turn completed.", {
        payload: { phase: "completed", subtype: record.subtype ?? null },
      }));
      return events;
    }

    return [];
  }

  private completeBlock(block: Record<string, unknown>): HarnessEvidenceEvent[] {
    const type = asString(block.type) || "";
    if (type === "text") {
      const text = asString(block.text) || "";
      return text ? [this.emit("model_text", text, { payload: { text } })] : [];
    }
    if (type === "thinking") {
      const text = asString(block.thinking) || asString(block.text) || "";
      return text ? [this.emit("thinking", text, { payload: { text } })] : [];
    }
    if (type === "tool_use") {
      const id = asString(block.id) || `claude-tool-${this.toolIds.size + 1}`;
      const name = asString(block.name) || "tool";
      return [this.emit("tool_call", name, {
        toolCallId: id,
        payload: { id, name, input: block.input ?? {} },
      })];
    }
    if (type === "tool_result") {
      const id = asString(block.tool_use_id) || asString(block.id) || "unknown-tool-call";
      return [this.emit("tool_result", `Tool result for ${id}.`, {
        toolCallId: id,
        payload: {
          id,
          output: block.content ?? "",
          is_error: block.is_error === true,
        },
      })];
    }
    return [];
  }

  private ingestStreamEvent(event: Record<string, unknown>): HarnessEvidenceEvent[] {
    const type = asString(event.type) || "";
    const index = typeof event.index === "number" ? event.index : 0;
    const key = `block:${index}`;
    if (type === "message_start") {
      const message = asRecord(event.message);
      this.model = asString(message?.model) || this.model;
      return [this.emit("model_turn", "Claude model turn started.", {
        payload: { phase: "started" },
      })];
    }
    if (type === "content_block_start") {
      const block = asRecord(event.content_block) || {};
      const blockType = asString(block.type) || "";
      this.blockKinds.set(index, blockType);
      if (blockType === "tool_use") {
        const id = asString(block.id) || `claude-tool-${index}`;
        this.toolIds.set(index, id);
        this.toolNames.set(index, asString(block.name) || "tool");
        this.toolInputs.set(index, block.input ? JSON.stringify(block.input) : "");
        return [];
      }
      const text = textFromContent(block);
      if (blockType === "thinking") this.appendThinking(key, text);
      if (blockType === "text") this.appendText(key, text);
      return [];
    }
    if (type === "content_block_delta") {
      const delta = asRecord(event.delta) || {};
      const deltaType = asString(delta.type) || this.blockKinds.get(index) || "";
      if (deltaType === "text_delta" || deltaType === "text") {
        this.appendText(key, asString(delta.text) || "");
      } else if (deltaType === "thinking_delta" || deltaType === "thinking") {
        this.appendThinking(key, asString(delta.thinking) || asString(delta.text) || "");
      } else if (deltaType === "input_json_delta") {
        this.toolInputs.set(index, `${this.toolInputs.get(index) || ""}${asString(delta.partial_json) || ""}`);
      }
      return [];
    }
    if (type === "content_block_stop") {
      const blockType = this.blockKinds.get(index);
      if (blockType === "text") return this.flushText(key);
      if (blockType === "thinking") return this.flushThinking(key);
      if (blockType === "tool_use") {
        const id = this.toolIds.get(index) || `claude-tool-${index}`;
        const name = this.toolNames.get(index) || "tool";
        const rawInput = this.toolInputs.get(index) || "";
        let input: unknown = {};
        try {
          input = rawInput ? JSON.parse(rawInput) : {};
        } catch {
          input = { unparsed_json: rawInput };
        }
        return [this.emit("tool_call", name, {
          toolCallId: id,
          payload: { id, name, input },
        })];
      }
      return [];
    }
    if (type === "message_delta") {
      const usage = normalizeUsage(event.usage);
      return usage.availability === "unavailable" ? [] : [
        this.emit("usage", "Claude provider usage reported.", { usage, payload: usage }),
      ];
    }
    if (type === "error") {
      const error = asRecord(event.error);
      return [this.emit("error", asString(error?.message) || "Claude provider error.", {
        payload: error || event,
      })];
    }
    return [];
  }
}
