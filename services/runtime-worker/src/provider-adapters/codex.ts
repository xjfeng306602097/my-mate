import type { HarnessEvidenceEvent } from "../types.js";
import { BaseProviderSession } from "./base-session.js";
import { asRecord, asString, normalizeUsage, textFromContent } from "./utils.js";

function eventType(record: Record<string, unknown>): string {
  return asString(record.method) || asString(record.type) || "";
}

function itemFrom(record: Record<string, unknown>): Record<string, unknown> {
  const params = asRecord(record.params);
  const item = asRecord(params?.item) || asRecord(record.item) || asRecord(record.data) || {};
  return asRecord(item.root) || item;
}

function payloadFrom(record: Record<string, unknown>): Record<string, unknown> {
  return asRecord(record.params) || record;
}

function itemKey(item: Record<string, unknown>, payload: Record<string, unknown>): string {
  return asString(item.id) || asString(payload.item_id) || asString(payload.itemId) || "assistant";
}

function toolName(item: Record<string, unknown>): string {
  const itemType = asString(item.type);
  if (itemType === "commandExecution" || itemType === "command_execution") return "bash";
  if (itemType === "mcpToolCall" || itemType === "mcp_tool_call") {
    const server = asString(item.server) || asString(item.server_name);
    const tool = asString(item.tool) || asString(item.name) || "mcp_tool";
    return server ? `${server}/${tool}` : tool;
  }
  return asString(item.name) || asString(item.tool) || itemType || "tool";
}

function toolInput(item: Record<string, unknown>): unknown {
  return item.arguments ?? item.input ?? item.command ?? {};
}

export class CodexProviderSession extends BaseProviderSession {
  private readonly toolCalls = new Map<string, string>();

  constructor(model?: string | null) {
    super("codex", model);
  }

  ingest(value: unknown): HarnessEvidenceEvent[] {
    const record = asRecord(value);
    if (!record) return [];
    const type = eventType(record);
    const payload = payloadFrom(record);
    const item = itemFrom(record);
    const normalized = type.replaceAll("/", ".");

    if (normalized === "turn.started" || normalized === "thread.started") {
      this.begin(value);
      return [this.emit("model_turn", "Codex model turn started.", {
        payload: { phase: "started", turn_id: payload.turn_id ?? payload.turnId ?? null },
      })];
    }

    if (normalized === "item.agentMessage.delta" || normalized === "item.agent_message.delta") {
      this.begin(value);
      const text = asString(payload.delta) || asString(item.delta) || "";
      this.appendText(itemKey(item, payload), text);
      return [];
    }

    if (
      normalized === "item.reasoning.textDelta" ||
      normalized === "item.reasoning.summaryTextDelta" ||
      normalized === "item.reasoning.delta"
    ) {
      this.begin(value);
      const text = asString(payload.delta) || asString(item.delta) || "";
      this.appendThinking(itemKey(item, payload), text);
      return [];
    }

    if (normalized === "item.started" || normalized === "item.tool.call") {
      this.begin(value);
      if (normalized === "item.tool.call") {
        const callId = asString(payload.callId) || asString(payload.call_id) || itemKey(item, payload);
        const name = asString(payload.tool) || asString(payload.name) || "tool";
        this.toolCalls.set(callId, name);
        return [this.emit("tool_call", name, {
          toolCallId: callId,
          payload: { id: callId, name, input: payload.arguments ?? payload.input ?? {} },
        })];
      }
      const itemType = asString(item.type);
      if (
        itemType === "commandExecution" ||
        itemType === "command_execution" ||
        itemType === "mcpToolCall" ||
        itemType === "mcp_tool_call" ||
        itemType === "toolCall" ||
        itemType === "functionCall"
      ) {
        const callId = itemKey(item, payload);
        const name = toolName(item);
        this.toolCalls.set(callId, name);
        return [this.emit("tool_call", name, {
          toolCallId: callId,
          payload: { id: callId, name, input: toolInput(item) },
        })];
      }
      return [];
    }

    if (normalized === "item.completed") {
      this.begin(value);
      const key = itemKey(item, payload);
      const itemType = asString(item.type) || "";
      if (itemType === "agentMessage" || itemType === "agent_message" || itemType === "message") {
        const text = textFromContent(item.text ?? item.content ?? payload.text);
        if (text) this.replaceText(key, text);
        return this.flushText(key);
      }
      if (itemType === "reasoning") {
        const text = textFromContent(item.text ?? item.summary ?? item.content);
        if (text) this.replaceThinking(key, text);
        return this.flushThinking(key);
      }
      if (
        this.toolCalls.has(key) || itemType === "commandExecution" || itemType === "command_execution" ||
        itemType === "mcpToolCall" || itemType === "mcp_tool_call"
      ) {
        const error = asRecord(item.error);
        const result = item.aggregatedOutput ?? item.aggregated_output ?? item.output ??
          error?.message ?? item.result ?? item.content ?? "";
        const exitCode = typeof item.exitCode === "number" ? item.exitCode : item.exit_code;
        const isError = item.status === "failed" || item.is_error === true || item.isError === true ||
          error !== null || (typeof exitCode === "number" && exitCode !== 0);
        return [this.emit("tool_result", `${this.toolCalls.get(key) || toolName(item)} completed.`, {
          toolCallId: key,
          payload: { id: key, output: result, is_error: isError },
        })];
      }
      return [];
    }

    if (normalized === "turn.completed") {
      this.begin(value);
      const events = [...this.flushTextBuffers(), ...this.flushThinkingBuffers()];
      const turn = asRecord(payload.turn);
      const usageValue = payload.usage ?? turn?.usage;
      if (asRecord(usageValue)) {
        const usage = normalizeUsage(usageValue, {
          durationMs: payload.duration_ms ?? payload.durationMs,
          turnCount: payload.num_turns ?? payload.turn_count ?? 1,
        });
        events.push(this.emit("usage", "Codex provider usage reported.", { usage, payload: usage }));
      }
      events.push(this.emit("model_turn", "Codex model turn completed.", {
        payload: { phase: "completed", status: turn?.status ?? payload.status ?? "completed" },
      }));
      return events;
    }

    if (normalized === "thread.tokenUsage.updated" || normalized === "thread.token_usage.updated") {
      this.begin(value);
      const tokenUsage = asRecord(payload.tokenUsage) || asRecord(payload.token_usage);
      const usageValue = tokenUsage?.total || tokenUsage?.last || tokenUsage;
      const usage = normalizeUsage(usageValue);
      return usage.availability === "unavailable" ? [] : [
        this.emit("usage", "Codex provider usage reported.", { usage, payload: usage }),
      ];
    }

    if (normalized === "error" || normalized.endsWith(".error")) {
      this.begin(value);
      const error = asRecord(payload.error);
      const message = asString(error?.message) || asString(payload.message) || "Codex provider error.";
      return [this.emit("error", message, { payload: error || payload })];
    }

    return [];
  }
}
