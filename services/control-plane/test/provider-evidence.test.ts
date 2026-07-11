import assert from "node:assert/strict";
import test from "node:test";
import type { UsageSummary, WorkerEvidence } from "@my-mate/shared-types/runtime-protocol";
import { enrichUsageWithEstimatedCost, estimateUsageCost } from "../src/evaluation/pricing/estimator.js";
import type { PricingCatalog } from "../src/evaluation/pricing/catalog.js";
import {
  buildProviderEvidenceProjection,
  classifyEvidenceCostCompleteness,
} from "../src/runtime/provider-evidence-projection.js";
import type { RuntimeJobRecord } from "../src/runtime/runtime-job-store.js";

const usage: UsageSummary = {
  availability: "available",
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_tokens: 200,
  cache_write_tokens: null,
  reasoning_tokens: null,
  total_tokens: 1500,
  duration_ms: 100,
  turn_count: 1,
  provider_reported_cost: null,
  estimated_cost: null,
};

const catalog: PricingCatalog = {
  catalog_id: "test-catalog",
  catalog_version: "fixture-v1",
  entries: [{
    provider: "codex",
    model: "exact-model",
    currency: "USD",
    input_per_million_tokens: "2",
    output_per_million_tokens: "4",
    cache_read_per_million_tokens: "0.5",
  }],
};

function evidence(overrides: Partial<WorkerEvidence>): WorkerEvidence {
  return {
    evidence_schema_version: 2,
    evidence_id: "evidence-1",
    run_id: "run-provider-evidence",
    node_run_id: "node-provider-evidence",
    job_id: "job-provider-evidence",
    worker_id: "worker-provider-evidence",
    sequence: 1,
    kind: "usage",
    source: { provider: "codex", model: "exact-model", native_event_id: "native-1", synthetic: false },
    trace: { trace_id: "trace-1", span_id: "span-1", parent_span_id: null, tool_call_id: null },
    summary: "usage",
    input_ref: null,
    output_ref: null,
    storage_uri: null,
    inline_payload: {},
    usage,
    redaction_status: "not_required",
    created_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

test("pricing uses exact provider and model matching with decimal arithmetic", () => {
  const estimated = estimateUsageCost(usage, "codex", "exact-model", catalog);
  assert.deepEqual(estimated, {
    currency: "USD",
    amount_decimal: "0.0037",
    catalog_id: "test-catalog",
    catalog_version: "fixture-v1",
  });
  assert.equal(estimateUsageCost(usage, "codex", "unknown-model", catalog), null);
  assert.equal(estimateUsageCost(usage, "Codex", "exact-model", catalog), null);
});

test("estimated cost stays separate from provider-reported cost", () => {
  const reported = { currency: "USD", amount_decimal: "0.0042" };
  const enriched = enrichUsageWithEstimatedCost(
    { ...usage, provider_reported_cost: reported },
    "codex",
    "exact-model",
    catalog,
  );
  assert.deepEqual(enriched?.provider_reported_cost, reported);
  assert.equal(enriched?.estimated_cost?.amount_decimal, "0.0037");
});

test("runtime provider projection exposes latest usage, costs, and open tool calls", () => {
  const job = {
    job_id: "job-provider-evidence",
    agent_runtime: "codex",
  } as RuntimeJobRecord;
  const olderUsage = evidence({
    evidence_id: "usage-old",
    sequence: 1,
    usage: { ...usage, input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  });
  const latestUsage = evidence({
    evidence_id: "usage-latest",
    sequence: 4,
    usage: enrichUsageWithEstimatedCost(
      { ...usage, provider_reported_cost: { currency: "USD", amount_decimal: "0.0042" } },
      "codex",
      "exact-model",
      catalog,
    ),
    created_at: "2026-07-10T00:00:03.000Z",
  });
  const call = evidence({
    evidence_id: "call-1",
    sequence: 2,
    kind: "tool_call",
    usage: null,
    trace: { trace_id: "trace-1", span_id: "span-call", parent_span_id: null, tool_call_id: "call-1" },
    created_at: "2026-07-10T00:00:01.000Z",
  });
  const openCall = evidence({
    evidence_id: "call-open",
    sequence: 3,
    kind: "tool_call",
    usage: null,
    trace: { trace_id: "trace-1", span_id: "span-open", parent_span_id: null, tool_call_id: "call-open" },
    created_at: "2026-07-10T00:00:02.000Z",
  });
  const result = evidence({
    evidence_id: "result-1",
    sequence: 5,
    kind: "tool_result",
    usage: null,
    trace: { trace_id: "trace-1", span_id: "span-result", parent_span_id: null, tool_call_id: "call-1" },
    created_at: "2026-07-10T00:00:04.000Z",
  });
  const projection = buildProviderEvidenceProjection(
    [job],
    [olderUsage, call, openCall, latestUsage, result],
  );
  assert.equal(projection.usage.latest_by_job[0]?.evidence_id, "usage-latest");
  assert.equal(projection.usage.token_completeness, "complete");
  assert.equal(projection.usage.provider_reported_cost_completeness, "complete");
  assert.equal(projection.usage.estimated_cost_completeness, "complete");
  assert.deepEqual(projection.usage.provider_reported_costs, { USD: "0.0042" });
  assert.deepEqual(projection.usage.estimated_costs, { USD: "0.0037" });
  assert.deepEqual(projection.tools.open_tool_call_ids, ["call-open"]);
  assert.equal(projection.native_evidence_count, 5);
  assert.equal(classifyEvidenceCostCompleteness([job.job_id], [latestUsage]), "complete");
  assert.equal(classifyEvidenceCostCompleteness([job.job_id], [olderUsage]), "unavailable");
});
