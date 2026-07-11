import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  HarnessEvidenceEvent,
  RuntimeWorkerJob,
  UsageSummary,
  WorkerEvidence,
  WorkerEvidenceSource,
  WorkerEvidenceTrace,
} from "./types.js";

export const MAX_INLINE_EVIDENCE_BYTES = 32 * 1024;

const SECRET_KEY = /(^|_)(api_?key|token|secret|password|authorization|cookie|credential)(_|$)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PROVIDER_KEY = /\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g;
const ASSIGNED_SECRET = /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)["']?[^\s,"'}]+/gi;

function safePathSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

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

function redactValue(
  value: unknown,
  sensitivePaths: Set<string>,
  currentPath = "",
): { value: unknown; changed: boolean } {
  if (sensitivePaths.has(currentPath)) {
    return { value: "[REDACTED]", changed: true };
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const redacted = value.map((item, index) => {
      const result = redactValue(item, sensitivePaths, currentPath ? `${currentPath}.${index}` : String(index));
      changed ||= result.changed;
      return result.value;
    });
    return { value: redacted, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      if (isSecretKey(key) || sensitivePaths.has(childPath)) {
        redacted[key] = "[REDACTED]";
        changed = true;
        continue;
      }
      const result = redactValue(item, sensitivePaths, childPath);
      redacted[key] = result.value;
      changed ||= result.changed;
    }
    return { value: redacted, changed };
  }
  return { value, changed: false };
}

function writeLargePayload(
  job: RuntimeWorkerJob,
  sequence: number,
  payload: unknown,
): { storageUri: string; digest: string; sizeBytes: number } {
  const serialized = JSON.stringify(payload);
  const digest = `sha256:${createHash("sha256").update(serialized, "utf-8").digest("hex")}`;
  const workspace = process.env.MY_MATE_WORKSPACE || "/workspace";
  const relativeParts = [
    ".my-mate",
    "evidence",
    safePathSegment(job.run_id),
    safePathSegment(job.node_run_id),
    `${String(sequence).padStart(6, "0")}.json`,
  ];
  const filePath = path.join(workspace, ...relativeParts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${serialized}\n`, "utf-8");
  return {
    storageUri: `workspace://${relativeParts.join("/")}`,
    digest,
    sizeBytes: Buffer.byteLength(serialized, "utf-8"),
  };
}

export function unavailableUsage(): UsageSummary {
  return {
    availability: "unavailable",
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
    total_tokens: null,
    duration_ms: null,
    turn_count: null,
    provider_reported_cost: null,
    estimated_cost: null,
  };
}

export function buildWorkerEvidenceV2(input: {
  job: RuntimeWorkerJob;
  workerId: string;
  sequence: number;
  event: HarnessEvidenceEvent;
}): WorkerEvidence {
  const { job, workerId, sequence, event } = input;
  const sensitivePaths = new Set(event.sensitive_paths || []);
  const summary = redactString(event.summary);
  const payload = redactValue(event.inline_payload ?? null, sensitivePaths);
  const source: WorkerEvidenceSource = {
    provider: event.source && "provider" in event.source
      ? event.source.provider ?? null
      : job.harness.agent_runtime || null,
    model: event.source && "model" in event.source ? event.source.model ?? null : null,
    native_event_id: event.source && "native_event_id" in event.source
      ? event.source.native_event_id ?? null
      : null,
    synthetic: event.source && "synthetic" in event.source
      ? event.source.synthetic ?? true
      : true,
  };
  const trace: WorkerEvidenceTrace = {
    trace_id: event.trace?.trace_id || `trace:${job.run_id}`,
    span_id: event.trace?.span_id || `evidence:${job.job_id}:${sequence}`,
    parent_span_id: event.trace && "parent_span_id" in event.trace
      ? event.trace.parent_span_id ?? null
      : `node:${job.node_run_id}`,
    tool_call_id: event.trace && "tool_call_id" in event.trace
      ? event.trace.tool_call_id ?? null
      : null,
  };
  const inputRef = event.input_ref ? redactString(event.input_ref) : { value: null, changed: false };
  const outputRefRedaction = event.output_ref ? redactString(event.output_ref) : { value: null, changed: false };
  const storageUriRedaction = event.storage_uri ? redactString(event.storage_uri) : { value: null, changed: false };
  let inlinePayload = payload.value;
  let storageUri = storageUriRedaction.value;
  let outputRef = outputRefRedaction.value;
  let redactionStatus = event.redaction_status || (
    summary.changed || payload.changed || inputRef.changed || outputRefRedaction.changed || storageUriRedaction.changed
      ? "redacted"
      : "not_required"
  );

  try {
    const serialized = JSON.stringify(inlinePayload);
    if (Buffer.byteLength(serialized, "utf-8") > MAX_INLINE_EVIDENCE_BYTES) {
      const external = writeLargePayload(job, sequence, inlinePayload);
      storageUri ||= external.storageUri;
      outputRef ||= external.storageUri;
      inlinePayload = {
        externalized: true,
        content_digest: external.digest,
        size_bytes: external.sizeBytes,
        reference: external.storageUri,
      };
    }
  } catch (error) {
    inlinePayload = {
      blocked: true,
      reason: error instanceof Error ? error.message : "Evidence payload could not be serialized safely.",
    };
    redactionStatus = "blocked";
  }

  const nativeId = source.native_event_id
    ? `native:${safePathSegment(source.native_event_id)}`
    : `evidence:${sequence}:${event.kind}`;
  return {
    evidence_schema_version: 2,
    evidence_id: `${job.job_id}:${nativeId}`,
    run_id: job.run_id,
    node_run_id: job.node_run_id,
    job_id: job.job_id,
    worker_id: workerId,
    sequence,
    kind: event.kind,
    source,
    trace,
    summary: summary.value,
    input_ref: inputRef.value,
    output_ref: outputRef,
    storage_uri: storageUri,
    inline_payload: inlinePayload,
    usage: event.usage ?? null,
    redaction_status: redactionStatus,
    created_at: event.created_at || new Date().toISOString(),
  };
}
