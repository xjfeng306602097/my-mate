import { createHash } from "node:crypto";
import type { WorkerEvidence } from "../runtime-protocol.js";
import { enrichUsageWithEstimatedCost } from "../evaluation/pricing/estimator.js";

export const MAX_PERSISTED_INLINE_EVIDENCE_BYTES = 32 * 1024;

const SECRET_KEY = /(^|_)(api_?key|token|secret|password|authorization|cookie|credential)(_|$)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PROVIDER_KEY = /\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g;
const ASSIGNED_SECRET = /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)["']?[^\s,"'}]+/gi;

function isSecretKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll("-", "_");
  return SECRET_KEY.test(normalized);
}

function redactString(value: string): { value: string; changed: boolean } {
  const redacted = value
    .replace(BEARER_VALUE, "Bearer [REDACTED]")
    .replace(PROVIDER_KEY, "$1-[REDACTED]")
    .replace(ASSIGNED_SECRET, "$1[REDACTED]");
  return { value: redacted, changed: redacted !== value };
}

function redactValue(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const redacted = redactValue(item);
      changed ||= redacted.changed;
      return redacted.value;
    });
    return { value: result, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        result[key] = "[REDACTED]";
        changed = true;
        continue;
      }
      const redacted = redactValue(item);
      result[key] = redacted.value;
      changed ||= redacted.changed;
    }
    return { value: result, changed };
  }
  return { value, changed: false };
}

export function normalizeWorkerEvidence(input: WorkerEvidence): WorkerEvidence {
  const summary = redactString(String(input.summary || "Evidence recorded."));
  const payload = redactValue(input.inline_payload ?? null);
  const sequence = Number.isInteger(input.sequence) && Number(input.sequence) > 0
    ? Number(input.sequence)
    : undefined;
  const schemaVersion = input.evidence_schema_version === 2 && sequence ? 2 : 1;
  let inlinePayload = payload.value;
  const inputRefRedaction = input.input_ref ? redactString(input.input_ref) : { value: null, changed: false };
  const outputRefRedaction = input.output_ref ? redactString(input.output_ref) : { value: null, changed: false };
  const storageUriRedaction = input.storage_uri ? redactString(input.storage_uri) : { value: null, changed: false };
  let redactionStatus = input.redaction_status === "blocked"
    ? "blocked" as const
    : summary.changed || payload.changed || inputRefRedaction.changed || outputRefRedaction.changed ||
        storageUriRedaction.changed || input.redaction_status === "redacted"
      ? "redacted" as const
      : "not_required" as const;
  const inputRef = inputRefRedaction.value;
  const outputRef = outputRefRedaction.value;
  const storageUri = storageUriRedaction.value;

  try {
    const serialized = JSON.stringify(inlinePayload);
    const sizeBytes = Buffer.byteLength(serialized, "utf-8");
    if (sizeBytes > MAX_PERSISTED_INLINE_EVIDENCE_BYTES) {
      inlinePayload = {
        externalized: Boolean(storageUri || outputRef),
        content_digest: `sha256:${createHash("sha256").update(serialized, "utf-8").digest("hex")}`,
        size_bytes: sizeBytes,
        reference: outputRef || storageUri || null,
      };
      redactionStatus = outputRef || storageUri ? "redacted" : "blocked";
    }
  } catch {
    inlinePayload = { blocked: true, reason: "Evidence payload was not serializable." };
    redactionStatus = "blocked";
  }

  const source = {
    provider: input.source?.provider ?? null,
    model: input.source?.model ?? null,
    native_event_id: input.source?.native_event_id ?? null,
    synthetic: input.source?.synthetic ?? true,
  };
  const trace = {
    trace_id: input.trace?.trace_id || `trace:${input.run_id}`,
    span_id: input.trace?.span_id || `evidence:${input.evidence_id}`,
    parent_span_id: input.trace?.parent_span_id ?? `node:${input.node_run_id}`,
    tool_call_id: input.trace?.tool_call_id ?? null,
  };
  return {
    ...input,
    evidence_schema_version: schemaVersion,
    sequence,
    source,
    trace,
    summary: summary.value,
    input_ref: inputRef,
    output_ref: outputRef,
    storage_uri: storageUri,
    inline_payload: inlinePayload,
    usage: enrichUsageWithEstimatedCost(input.usage, source.provider, source.model),
    redaction_status: redactionStatus,
  };
}
