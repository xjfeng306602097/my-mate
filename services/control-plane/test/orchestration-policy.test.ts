import assert from "node:assert/strict";
import test from "node:test";
import { evaluateOrchestrationPolicy } from "../src/orchestration-policy.js";

test("Orchestration Policy keeps a focused request on the direct Conversation path", () => {
  const decision = evaluateOrchestrationPolicy({ missionSpec: null, userText: "What is the current system date?" });
  assert.equal(decision.mode, "direct");
  assert.equal(decision.requires_dag, false);
  assert.equal(decision.approval_required, false);
  assert.equal(decision.policy_version, "orchestration-policy-v1");
  assert.deepEqual(decision.evidence?.signals, []);
});

test("Orchestration Policy records deterministic evidence for a dynamic multi-Agent DAG", () => {
  const decision = evaluateOrchestrationPolicy({
    missionSpec: null,
    userText: "Create a multi-agent DAG: run two research workers in parallel, then have an independent reviewer verify the report.",
  });
  assert.equal(decision.mode, "dynamic");
  assert.equal(decision.requires_dag, true);
  assert.equal(decision.approval_required, true);
  assert.ok(decision.evidence?.signals.includes("explicit_orchestration_request"));
  assert.ok(decision.evidence?.signals.includes("parallel_or_multi_role"));
  assert.ok(decision.evidence?.signals.includes("review_or_human_gate"));
  assert.ok((decision.evidence?.scores.dynamic || 0) >= 40);
});

test("Orchestration Policy gives explicit template and manual choices precedence", () => {
  const template = evaluateOrchestrationPolicy({ missionSpec: null, userText: "Prepare a report", selectedTemplateId: "research-report" });
  assert.equal(template.mode, "template");
  assert.equal(template.evidence?.matched_template_id, "research-report");
  const manual = evaluateOrchestrationPolicy({ missionSpec: null, userText: "Prepare a report", forcedMode: "manual" });
  assert.equal(manual.mode, "manual");
  assert.ok(manual.evidence?.signals.includes("manual_graph_submitted"));
});
