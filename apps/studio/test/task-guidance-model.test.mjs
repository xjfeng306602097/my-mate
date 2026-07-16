import test from "node:test";
import assert from "node:assert/strict";

import { deriveTaskGuidance, taskGuidanceDirective } from "../src/task-guidance-model.js";

function detail(input = {}) {
  return {
    session: { status: "draft", metadata: {}, ...(input.session || {}) },
    pending_approvals: input.pending_approvals || [],
    pending_human_inputs: input.pending_human_inputs || [],
    messages: input.messages || [],
    artifacts: input.artifacts || [],
    latest_run: input.latest_run || null,
    workspace_state: input.workspace_state || {},
    mission_snapshot: input.mission_snapshot || null,
    mission_spec: input.mission_spec || null,
  };
}

test("task guidance prioritizes blocking human decisions", () => {
  const guidance = deriveTaskGuidance(
    detail({
      pending_approvals: [{ approval_id: "approval-1" }],
      latest_run: { status: "running" },
    }),
  );
  assert.equal(guidance.phase, "decision");
  assert.equal(guidance.primaryAction, "open-task-inbox");
  assert.equal(guidance.signals[1].value, "1");
});

test("task guidance presents active execution as supervised progress", () => {
  const guidance = deriveTaskGuidance(
    detail({
      latest_run: { status: "running" },
      workspace_state: { latest_run_summary: "Two of four work packages are complete." },
    }),
  );
  assert.equal(guidance.phase, "running");
  assert.equal(guidance.primaryAction, "view-task-progress");
  assert.match(guidance.detail, /Two of four/);
});

test("task guidance leads completed tasks with returned results", () => {
  const guidance = deriveTaskGuidance(
    detail({
      latest_run: { status: "completed" },
      artifacts: [{ artifact_id: "artifact-1" }, { artifact_id: "artifact-2" }],
    }),
  );
  assert.equal(guidance.phase, "result");
  assert.equal(guidance.primaryAction, "review-task-results");
  assert.match(guidance.title, /2 results/);
});

test("task guidance refreshes stale routes before execution", () => {
  const guidance = deriveTaskGuidance(
    detail({
      mission_spec: { route: { stale: true } },
    }),
  );
  assert.equal(guidance.phase, "prepare");
  assert.equal(guidance.primaryAction, "refresh-task-plan");
  assert.match(taskGuidanceDirective(guidance.primaryAction), /Revise the plan/);
});

test("task guidance exposes one recommended start action for ready tasks", () => {
  const guidance = deriveTaskGuidance(detail());
  assert.equal(guidance.phase, "ready");
  assert.equal(guidance.primaryAction, "start-task-work");
  assert.match(taskGuidanceDirective(guidance.primaryAction), /Run this task/);
});

test("task guidance keeps an understanding-stage task in conversation", () => {
  const guidance = deriveTaskGuidance(
    detail({ workspace_state: { stage: "understand" } }),
  );
  assert.equal(guidance.phase, "clarify");
  assert.equal(guidance.primaryAction, "review-task-conversation");
  assert.equal(guidance.signals[0].value, "Clarifying");
});

test("task guidance surfaces transition failures without inventing success", () => {
  const guidance = deriveTaskGuidance(
    detail({
      messages: [
        {
          role: "orchestrator",
          content: { failed_transition: "run", error_code: "run_validation_failed" },
        },
      ],
    }),
  );
  assert.equal(guidance.phase, "prepare");
  assert.equal(guidance.primaryAction, "review-task-conversation");
  assert.match(guidance.detail, /run validation failed/);
});

test("review-first autonomy replaces execution with plan review", () => {
  const guidance = deriveTaskGuidance(detail(), { autonomyMode: "review_first" });
  assert.equal(guidance.primaryAction, "review-task-plan");
  assert.equal(guidance.statusLabel, "Ready to review");
});

test("unchecked completed results recommend one quality action", () => {
  const guidance = deriveTaskGuidance(
    detail({ latest_run: { status: "completed" }, artifacts: [{ artifact_id: "artifact-1" }] }),
    { quality: { state: "unchecked" } },
  );
  assert.equal(guidance.primaryAction, "check-task-quality");
  assert.equal(guidance.primaryLabel, "Check quality");
});

test("repair guidance overrides a routine ready action", () => {
  const guidance = deriveTaskGuidance(detail(), {
    repair: {
      title: "Verify a model before starting work",
      detail: "Verify one model connection.",
      action: "open-task-settings",
      actionLabel: "Verify model",
    },
  });
  assert.equal(guidance.phase, "prepare");
  assert.equal(guidance.primaryAction, "open-task-settings");
});
