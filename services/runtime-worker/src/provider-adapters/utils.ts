import type { MoneyAmount, UsageSummary } from "../types.js";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

export function firstNumber(
  records: Array<Record<string, unknown> | null>,
  names: string[],
): number | null {
  for (const record of records) {
    if (!record) continue;
    for (const name of names) {
      const value = asNumber(record[name]);
      if (value !== null) return value;
    }
  }
  return null;
}

export function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => textFromContent(item)).filter(Boolean).join("");
  }
  const record = asRecord(value);
  if (!record) return "";
  return asString(record.text) || asString(record.thinking) || asString(record.content) || "";
}

function decimalMoney(value: unknown, currency = "USD"): MoneyAmount | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const amount = String(value);
  return /^\d+(?:\.\d+)?$/.test(amount)
    ? { currency, amount_decimal: amount }
    : null;
}

export function normalizeUsage(
  value: unknown,
  extras?: { durationMs?: unknown; turnCount?: unknown; providerCostUsd?: unknown },
): UsageSummary {
  const root = asRecord(value) || {};
  const inputDetails = asRecord(root.input_tokens_details) || asRecord(root.inputTokensDetails);
  const outputDetails = asRecord(root.output_tokens_details) || asRecord(root.outputTokensDetails);
  const records = [root];
  const inputTokens = firstNumber(records, [
    "input_tokens", "inputTokens", "prompt_tokens", "promptTokens", "inputTokenCount",
  ]);
  const outputTokens = firstNumber(records, [
    "output_tokens", "outputTokens", "completion_tokens", "completionTokens", "outputTokenCount",
  ]);
  const cacheReadTokens = firstNumber([root, inputDetails], [
    "cache_read_tokens", "cacheReadTokens", "cached_tokens", "cachedTokens", "cache_read_input_tokens",
  ]);
  const cacheWriteTokens = firstNumber([root, inputDetails], [
    "cache_write_tokens", "cacheWriteTokens", "cache_creation_input_tokens",
  ]);
  const reasoningTokens = firstNumber([root, outputDetails], [
    "reasoning_tokens", "reasoningTokens", "reasoningOutputTokens",
  ]);
  const suppliedTotal = firstNumber(records, ["total_tokens", "totalTokens", "totalTokenCount"]);
  const totalTokens = suppliedTotal ?? (
    inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  );
  const durationMs = asNumber(extras?.durationMs ?? root.duration_ms ?? root.durationMs);
  const turnCount = asNumber(extras?.turnCount ?? root.turn_count ?? root.turnCount ?? root.num_turns);
  const reportedCost = asRecord(root.provider_reported_cost) || asRecord(root.providerReportedCost);
  const providerCost = reportedCost
    ? decimalMoney(reportedCost.amount_decimal ?? reportedCost.amountDecimal, asString(reportedCost.currency) || "USD")
    : decimalMoney(extras?.providerCostUsd ?? root.total_cost_usd ?? root.totalCostUsd ?? root.cost_usd);
  const availableCount = [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens]
    .filter((item) => item !== null).length;
  return {
    availability: inputTokens !== null && outputTokens !== null
      ? "available"
      : availableCount > 0 || providerCost !== null
        ? "partial"
        : "unavailable",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    duration_ms: durationMs,
    turn_count: turnCount,
    provider_reported_cost: providerCost,
    estimated_cost: null,
  };
}

export function modelFrom(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  return asString(record.model) || asString(asRecord(record.message)?.model) ||
    asString(asRecord(record.result)?.model);
}

export function eventIdFrom(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const params = asRecord(record.params);
  const item = asRecord(params?.item) || asRecord(record.item);
  return asString(record.event_id) || asString(record.eventId) || asString(record.id) ||
    asString(params?.event_id) || asString(params?.eventId) || asString(item?.id);
}
