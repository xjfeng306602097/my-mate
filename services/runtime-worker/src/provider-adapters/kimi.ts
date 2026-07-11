import type { HarnessEvidenceEvent } from "../types.js";
import { BaseProviderSession } from "./base-session.js";
import { asRecord, asString, normalizeUsage, textFromContent } from "./utils.js";

export class KimiProviderSession extends BaseProviderSession {
  constructor(model?: string | null) {
    super("kimi", model);
  }

  ingest(value: unknown): HarnessEvidenceEvent[] {
    const record = asRecord(value);
    if (!record) return [];
    const type = asString(record.type) || asString(record.method) || "";

    if (type === "session/update") {
      const update = asRecord(asRecord(record.params)?.update);
      if (!update) return [];
      this.begin(value);
      return this.ingestAcpUpdate(update);
    }

    if (type === "text" || type === "thinking") {
      this.begin(value);
      const text = asString(record.text) || asString(record.thinking) || textFromContent(record.content);
      if (type === "text") this.appendText("kimi-turn", text);
      else this.appendThinking("kimi-turn", text);
      return [];
    }

    if (type === "tool_use" || type === "ToolCall") {
      this.begin(value);
      const id = asString(record.id) || asString(record.tool_call_id) || "kimi-tool";
      const name = asString(record.name) || "tool";
      return [this.emit("tool_call", name, {
        toolCallId: id,
        payload: { id, name, input: record.input ?? record.arguments ?? {} },
      })];
    }

    if (type === "tool_result" || type === "ToolResult") {
      this.begin(value);
      const id = asString(record.tool_use_id) || asString(record.tool_call_id) || asString(record.id) || "kimi-tool";
      return [this.emit("tool_result", `Tool result for ${id}.`, {
        toolCallId: id,
        payload: { id, output: record.content ?? record.output ?? "", is_error: record.is_error === true },
      })];
    }

    if (type === "ContentPart") {
      this.begin(value);
      const part = asRecord(record.part) || asRecord(record.content) || record;
      const partType = asString(part.type) || "text";
      const text = asString(part.text) || asString(part.think) || textFromContent(part.content);
      if (partType === "think" || partType === "thinking") this.appendThinking("kimi-turn", text);
      else this.appendText("kimi-turn", text);
      return [];
    }

    if (type === "turn_complete" || type === "done" || type === "TurnEnd") {
      this.begin(value);
      const events = [...this.flushTextBuffers(), ...this.flushThinkingBuffers()];
      const usage = normalizeUsage(record.usage, {
        durationMs: record.duration_ms,
        turnCount: record.num_turns ?? 1,
        providerCostUsd: record.total_cost_usd,
      });
      if (usage.availability !== "unavailable") {
        events.push(this.emit("usage", "Kimi provider usage reported.", { usage, payload: usage }));
      }
      events.push(this.emit("model_turn", "Kimi model turn completed.", {
        payload: { phase: "completed" },
      }));
      return events;
    }

    if (type === "error") {
      this.begin(value);
      return [this.emit("error", asString(record.message) || "Kimi provider error.", { payload: record })];
    }

    return [];
  }

  private ingestAcpUpdate(update: Record<string, unknown>): HarnessEvidenceEvent[] {
    const type = asString(update.sessionUpdate) || asString(update.type) || "";
    if (type === "agent_message_chunk" || type === "agent_thought_chunk") {
      const text = textFromContent(update.content);
      if (type === "agent_message_chunk") this.appendText("kimi-acp", text);
      else this.appendThinking("kimi-acp", text);
      return [];
    }
    if (type === "tool_call") {
      const id = asString(update.toolCallId) || asString(update.id) || "kimi-acp-tool";
      const name = asString(update.title) || asString(update.name) || "tool";
      return [this.emit("tool_call", name, {
        toolCallId: id,
        payload: { id, name, input: update.rawInput ?? update.input ?? {} },
      })];
    }
    if (type === "tool_call_update") {
      const id = asString(update.toolCallId) || asString(update.id) || "kimi-acp-tool";
      const status = asString(update.status) || "updated";
      if (!["completed", "failed", "error"].includes(status)) return [];
      return [this.emit("tool_result", `Tool ${id} ${status}.`, {
        toolCallId: id,
        payload: {
          id,
          output: update.content ?? update.rawOutput ?? "",
          is_error: status !== "completed",
        },
      })];
    }
    return [];
  }
}
