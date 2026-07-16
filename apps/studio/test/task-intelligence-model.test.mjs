import test from "node:test";
import assert from "node:assert/strict";

import {
  autonomyModeCopy,
  deriveRepairGuidance,
  deriveResultQuality,
  normalizeAutonomyMode,
} from "../src/task-intelligence-model.js";

test("autonomy mode defaults to assisted and uses human policy copy", () => {
  assert.equal(normalizeAutonomyMode("unknown"), "assisted");
  assert.match(autonomyModeCopy("autopilot").detail, /strict validation/);
});

test("repair guidance sends unverified model setup to Settings", () => {
  const repair = deriveRepairGuidance({ session: { status: "draft" }, messages: [] }, { modelVerified: false });
  assert.equal(repair.action, "open-task-settings");
  assert.match(repair.title, /Verify a model/);
});

test("repair guidance maps missing published templates to Library", () => {
  const repair = deriveRepairGuidance(
    {
      messages: [{ content: { failed_transition: "run", error_code: "no_published_templates" } }],
    },
    { modelVerified: true, templatesAvailable: false },
  );
  assert.equal(repair.action, "open-task-library");
  assert.equal(repair.actionLabel, "Add workflow");
});

test("repair guidance maps stopped runs to the existing recovery scan", () => {
  const repair = deriveRepairGuidance({ latest_run: { status: "failed" }, messages: [] }, { modelVerified: true });
  assert.equal(repair.action, "scan-task-recovery");
});

test("result quality remains unchecked without persisted evaluation evidence", () => {
  const quality = deriveResultQuality({ runtime_scorecards: [], runtime_evaluations: [] });
  assert.equal(quality.state, "unchecked");
  assert.equal(quality.label, "Not checked");
});

test("result quality requires scorecard and independent evaluation for trust", () => {
  const partial = deriveResultQuality({
    runtime_scorecards: [{ pipeline_verdict: "pass", contract_verdict: "pass" }],
    runtime_evaluations: [],
  });
  assert.equal(partial.state, "partial");

  const trusted = deriveResultQuality({
    runtime_scorecards: [{ pipeline_verdict: "pass", contract_verdict: "pass", findings: [] }],
    runtime_evaluations: [
      {
        status: "completed",
        quality_verdict: "pass",
        evidence_verdict: "pass",
        pipeline_verdict: "pass",
        contract_verdict: "pass",
        gate_verdict: "pass",
        findings: [],
      },
    ],
  });
  assert.equal(trusted.state, "trusted");
});

test("result quality never hides failed checks", () => {
  const quality = deriveResultQuality({
    runtime_scorecards: [{ pipeline_verdict: "pass", contract_verdict: "fail", findings: [] }],
    runtime_evaluations: [],
  });
  assert.equal(quality.state, "review");
  assert.equal(quality.tone, "danger");
});
