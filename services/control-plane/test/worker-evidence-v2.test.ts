import assert from "node:assert/strict";
import test from "node:test";
import { classifyUsageCompleteness } from "../src/evaluation/run-evidence-snapshot.js";
import type { WorkerEvidence } from "../src/runtime-protocol.js";
import {
  listWorkerEvidence,
  saveWorkerEvidence,
} from "../src/runtime/worker-evidence-store.js";
import { resetTestRoot } from "./helpers.js";

function evidence(overrides: Partial<WorkerEvidence> = {}): WorkerEvidence {
  return {
    evidence_id: "legacy-evidence-1",
    run_id: "run-evidence-v2",
    node_run_id: "node-evidence-v2",
    job_id: "job-evidence-v2",
    worker_id: "worker-evidence-v2",
    kind: "log",
    summary: "legacy evidence",
    storage_uri: null,
    inline_payload: {},
    redaction_status: "not_required",
    created_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

test("legacy Worker evidence is normalized and redacted before persistence", () => {
  resetTestRoot();
  const saved = saveWorkerEvidence(evidence({
    summary: "Bearer legacy-secret-token",
    inline_payload: {
      api_key: "sk-abcdefghijklmnopqrstuvwxyz",
      nested: { password: "do-not-store" },
    },
  }));

  assert.equal(saved.evidence_schema_version, 1);
  assert.equal(saved.sequence, undefined);
  assert.equal(saved.source?.provider, null);
  assert.equal(saved.source?.synthetic, true);
  assert.match(saved.summary, /\[REDACTED\]/);
  assert.deepEqual(saved.inline_payload, {
    api_key: "[REDACTED]",
    nested: { password: "[REDACTED]" },
  });
  assert.equal(saved.redaction_status, "redacted");
  assert.ok(saved.trace?.trace_id);
});

test("Worker evidence deduplicates native provider events independently of evidence id", () => {
  resetTestRoot();
  const first = saveWorkerEvidence(evidence({
    evidence_schema_version: 2,
    evidence_id: "v2-native-first",
    sequence: 1,
    kind: "tool_call",
    source: {
      provider: "codex",
      model: "model-1",
      native_event_id: "native-event-1",
      synthetic: false,
    },
    trace: {
      trace_id: "trace-1",
      span_id: "span-1",
      parent_span_id: null,
      tool_call_id: "tool-1",
    },
  }));
  const duplicate = saveWorkerEvidence(evidence({
    evidence_schema_version: 2,
    evidence_id: "v2-native-duplicate",
    sequence: 2,
    kind: "tool_call",
    source: {
      provider: "codex",
      model: "model-1",
      native_event_id: "native-event-1",
      synthetic: false,
    },
  }));

  assert.equal(duplicate.evidence_id, first.evidence_id);
  assert.equal(listWorkerEvidence("run-evidence-v2").length, 1);
});

test("usage completeness does not treat synthetic unavailable usage as complete", () => {
  const unavailable = evidence({
    evidence_schema_version: 2,
    sequence: 1,
    kind: "usage",
    usage: {
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
    },
  });
  const available = evidence({
    ...unavailable,
    evidence_id: "usage-available",
    job_id: "job-available",
    usage: {
      ...unavailable.usage!,
      availability: "available",
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    },
  });

  assert.equal(classifyUsageCompleteness(["job-evidence-v2"], [unavailable]), "unavailable");
  assert.equal(classifyUsageCompleteness(["job-available"], [available]), "complete");
  assert.equal(
    classifyUsageCompleteness(["job-evidence-v2", "job-available"], [unavailable, available]),
    "partial",
  );
});
