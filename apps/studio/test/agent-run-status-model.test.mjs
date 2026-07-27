import assert from "node:assert/strict";
import test from "node:test";

import {
  agentDelegationStatusFromEvent,
  isAgentDelegationRunning,
} from "../src/agent-run-status-model.js";

test("Agent delegation becomes active when execution emits real work", () => {
  assert.equal(agentDelegationStatusFromEvent("accepted", { type: "agent.started", status: "running" }), "running");
  assert.equal(agentDelegationStatusFromEvent("running", { type: "tool.started", status: "running" }), "running");
  assert.equal(agentDelegationStatusFromEvent("running", { type: "tool.failed", status: "failed" }), "running");
  assert.equal(isAgentDelegationRunning("running"), true);
  assert.equal(isAgentDelegationRunning("waiting_human"), false);
});

test("Agent delegation stops breathing for approval and terminal states", () => {
  assert.equal(agentDelegationStatusFromEvent("running", { type: "tool.waiting_approval", status: "waiting" }), "waiting_human");
  assert.equal(agentDelegationStatusFromEvent("running", { type: "agent.completed", status: "succeeded" }), "completed");
  assert.equal(agentDelegationStatusFromEvent("running", { type: "agent.completed", status: "waiting" }), "blocked");
  assert.equal(agentDelegationStatusFromEvent("running", { type: "agent.failed", status: "failed" }), "failed");
  assert.equal(agentDelegationStatusFromEvent("running", { type: "agent.cancelled", status: "cancelled" }), "cancelled");
});

test("Assignment alone does not claim that the Agent is already working", () => {
  assert.equal(agentDelegationStatusFromEvent("queued", { type: "task.assigned", status: "info" }), "accepted");
  assert.equal(agentDelegationStatusFromEvent("waiting_human", { type: "task.assigned", status: "info" }), "waiting_human");
});
