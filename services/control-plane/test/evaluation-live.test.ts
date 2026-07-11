import assert from "node:assert/strict";
import test from "node:test";
import { anthropicEvaluator } from "../src/evaluation/evaluators/anthropic.js";
import type { EvaluationEvidenceView } from "../src/evaluation/evaluator-view.js";
import type { RunEvidenceSnapshot } from "../src/evaluation/types.js";

const runLive = process.env.MY_MATE_RUN_LIVE_EVALUATOR_TESTS === "true";

test("opt-in Anthropic evaluator returns a structured quality verdict", { skip: !runLive }, async () => {
  assert.ok(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is required for live evaluator verification.");
  const view: EvaluationEvidenceView = {
    schema_version: 1,
    run: { run_id: "live-evaluator", intent: "Produce the exact text MY_MATE_EVALUATOR_OK", status: "completed", current_summary: "MY_MATE_EVALUATOR_OK" },
    route: { route_id: "route-live", template_name: "Live evaluator fixture", work_packages: [] },
    nodes: [],
    artifacts: [{ artifact_id: "artifact-live", node_run_id: null, type: "report", name: "result.txt", mime_type: "text/plain", storage_uri: "workspace://result.txt", size_bytes: 20 }],
    handoffs: [],
    evidence: [{ evidence_id: "evidence-live", node_run_id: "node-live", kind: "model_text", summary: "MY_MATE_EVALUATOR_OK", provider: "fixture", model: "fixture", synthetic: false, input_ref: null, output_ref: null, usage: null, redaction_status: "not_required" }],
    completeness: { route: "complete", events: "complete", evidence: "complete", usage: "unavailable", cost: "unavailable", redaction_blocked_count: 0, late_record_count: 0, blind_spots: [] },
  };
  const result = await anthropicEvaluator.evaluate({ snapshot: {} as RunEvidenceSnapshot, view });
  assert.ok(result.quality_verdict === "pass" || result.quality_verdict === "fail");
  assert.equal(result.usage?.availability, "available");
});
