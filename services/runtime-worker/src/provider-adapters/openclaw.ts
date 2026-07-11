import type { HarnessEvidenceEvent } from "../types.js";
import { BaseProviderSession } from "./base-session.js";
import { asRecord, asString, normalizeUsage, textFromContent } from "./utils.js";

export class OpenClawProviderSession extends BaseProviderSession {
  constructor(model?: string | null) {
    super("openclaw", model);
  }

  ingest(value: unknown): HarnessEvidenceEvent[] {
    const record = asRecord(value);
    if (!record) return [];
    const type = asString(record.type) || asString(record.kind) || "";
    if (!type) return [];

    if (type === "text" || type === "model_text") {
      this.begin(value);
      this.appendText("openclaw-turn", asString(record.text) || asString(record.summary) || textFromContent(record.content));
      return [];
    }
    if (type === "thinking") {
      this.begin(value);
      this.appendThinking("openclaw-turn", asString(record.text) || asString(record.summary) || textFromContent(record.content));
      return [];
    }
    if (type === "tool_use" || type === "tool_call") {
      this.begin(value);
      const trace = asRecord(record.trace);
      const id = asString(record.id) || asString(record.tool_call_id) || asString(trace?.tool_call_id) || "openclaw-tool";
      const name = asString(record.name) || asString(record.summary) || "tool";
      return [this.emit("tool_call", name, {
        toolCallId: id,
        payload: record.inline_payload ?? { id, name, input: record.input ?? {} },
      })];
    }
    if (type === "tool_result") {
      this.begin(value);
      const trace = asRecord(record.trace);
      const id = asString(record.tool_use_id) || asString(record.tool_call_id) || asString(trace?.tool_call_id) || "openclaw-tool";
      return [this.emit("tool_result", asString(record.summary) || `Tool result for ${id}.`, {
        toolCallId: id,
        payload: record.inline_payload ?? { id, output: record.content ?? record.output ?? "", is_error: record.is_error === true },
      })];
    }
    if (type === "usage") {
      this.begin(value);
      const usage = normalizeUsage(record.usage ?? record.inline_payload ?? record);
      return usage.availability === "unavailable" ? [] : [
        this.emit("usage", asString(record.summary) || "OpenClaw provider usage reported.", { usage, payload: usage }),
      ];
    }
    if (type === "turn_complete" || type === "done" || type === "model_turn") {
      this.begin(value);
      const events = [...this.flushTextBuffers(), ...this.flushThinkingBuffers()];
      events.push(this.emit("model_turn", asString(record.summary) || "OpenClaw model turn completed.", {
        payload: { phase: "completed" },
      }));
      return events;
    }
    if (type === "error") {
      this.begin(value);
      return [this.emit("error", asString(record.message) || asString(record.summary) || "OpenClaw provider error.", {
        payload: record.inline_payload ?? record,
      })];
    }
    return [];
  }
}
