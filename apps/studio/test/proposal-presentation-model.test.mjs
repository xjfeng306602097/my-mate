import test from "node:test";
import assert from "node:assert/strict";
import {
  proposalNodeKindLabel,
  proposalNodeNeedsAgent,
  proposalStatusLabel,
  proposalStepContractSummary,
  proposalStepObjective,
} from "../src/proposal-presentation-model.js";

test("proposal presentation separates Agent work from system control steps", () => {
  assert.equal(proposalNodeNeedsAgent("agent_task"), true);
  assert.equal(proposalNodeNeedsAgent("reviewer"), true);
  assert.equal(proposalNodeNeedsAgent("condition"), false);
  assert.equal(proposalNodeNeedsAgent("human_gate"), false);
  assert.equal(proposalNodeKindLabel("fanout"), "Parallel / loop");
});

test("proposal presentation summarizes business contracts without JSON editing", () => {
  assert.equal(proposalStepObjective({ objective: "Build the API." }, {}), "Build the API.");
  assert.deepEqual(
    proposalStepContractSummary(
      JSON.stringify({ type: "object", required: ["brief"] }),
      JSON.stringify({ expected_artifacts: ["api-spec", "test-report"] }),
    ),
    { receives: ["brief"], delivers: ["api-spec", "test-report"] },
  );
  assert.equal(proposalStatusLabel("review_ready"), "Ready for approval");
});
