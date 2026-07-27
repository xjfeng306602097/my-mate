import assert from "node:assert/strict";
import test from "node:test";

import { agentDagPollingDecision, mergeAgentDagSummary } from "../src/agent-dag-polling-model.js";

test("detail polling refreshes the matching DAG list summary", () => {
  const items = [
    { dag_id: "dag-1", title: "Long task", status: "running", state_revision: 7 },
    { dag_id: "dag-2", title: "Other task", status: "completed", state_revision: 2 },
  ];

  const merged = mergeAgentDagSummary(items, {
    dag_id: "dag-1",
    status: "completed",
    state_revision: 10,
    revision: 12,
  });

  assert.deepEqual(merged[0], {
    dag_id: "dag-1",
    title: "Long task",
    status: "completed",
    state_revision: 10,
    revision: 12,
  });
  assert.equal(merged[1], items[1]);
  assert.notEqual(merged, items);
});

test("detail polling can insert a DAG missing from the current page", () => {
  const dag = { dag_id: "dag-new", status: "running", state_revision: 0 };
  assert.deepEqual(mergeAgentDagSummary([], dag), [dag]);
});

test("polls active DAGs and slows down while waiting for a person", () => {
  assert.deepEqual(agentDagPollingDecision({ dag: { status: "running" } }), {
    shouldPoll: true,
    delayMs: 1_000,
    reason: "running",
  });
  assert.deepEqual(agentDagPollingDecision({ dag: { status: "waiting_human" } }), {
    shouldPoll: true,
    delayMs: 2_000,
    reason: "waiting_human",
  });
});

test("keeps polling a completed DAG until final aggregation settles", () => {
  assert.equal(agentDagPollingDecision({
    dag: { status: "completed" },
    aggregation: { status: "not_started" },
  }).shouldPoll, true);
  assert.equal(agentDagPollingDecision({
    dag: { status: "completed" },
    aggregation: { status: "running" },
  }).shouldPoll, true);
});

test("stops after aggregation completes or fails", () => {
  assert.equal(agentDagPollingDecision({
    dag: { status: "completed" },
    aggregation: { status: "completed" },
  }).shouldPoll, false);
  assert.equal(agentDagPollingDecision({
    dag: { status: "completed" },
    aggregation: { status: "failed" },
  }).shouldPoll, false);
  assert.equal(agentDagPollingDecision({ dag: { status: "cancelled" } }).shouldPoll, false);
});
