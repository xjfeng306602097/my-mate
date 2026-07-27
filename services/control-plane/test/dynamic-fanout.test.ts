import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyExecutionRef } from "../src/execution-ref.js";
import { materializeDynamicFanout } from "../src/runtime/dynamic-fanout.js";
import type { CompiledNodeRecord, NodeRunRecord, RunPlanRecord } from "../src/types.js";

const timestamp = "2026-07-12T00:00:00.000Z";

function node(id: string, config: Record<string, unknown> = {}): CompiledNodeRecord {
  return {
    node_run_id: `nr:${id}`,
    node_id: id,
    name: id,
    type: "agent_task",
    agent_profile: null,
    runtime_agent_ref: null,
    allowed_skills: [],
    allowed_tools: [],
    approval_kind: null,
    human_input_schema: null,
    status: id === "source" ? "running" : "pending",
    retry_policy: { max_attempts: 2, attempt: 0 },
    timeout_seconds: 60,
    parallelism_budget: 1,
    input_payload: { node_config: config, run_inputs: {} },
    output_contract: {},
    execution_ref: createEmptyExecutionRef(),
    registry_provenance: {
      agent_id_requested: null,
      agent_id_resolved: null,
      agent_status: null,
      agent_source: "none",
      runtime_agent_ref_source: "none",
      skill_bindings: [],
      tool_bindings: [],
    },
  };
}

function fixture(maxItems = 4): { plan: RunPlanRecord; nodeRuns: NodeRunRecord[] } {
  const source = node("source", {
    dynamic_fanout: {
      target_node_id: "worker",
      source_path: "content.items",
      max_items: maxItems,
      item_input_key: "work_item",
    },
  });
  const nodes = [source, node("worker"), node("join")];
  return {
    plan: {
      run_id: "run-fanout",
      template_id: "template-fanout",
      template_version: 1,
      workspace_id: "workspace",
      requested_by: "tester",
      intent: "fan out",
      inputs: {},
      compiled_nodes: nodes,
      edges: [
        { from: "source", to: "worker", condition: null, label: null },
        { from: "worker", to: "join", condition: null, label: null },
      ],
      frontier: [],
      policy_snapshot: { max_parallel_nodes: 2 },
      planner_context: {},
      status: "running",
      created_at: timestamp,
    },
    nodeRuns: nodes.map((item) => ({
      node_run_id: item.node_run_id,
      run_id: "run-fanout",
      status: item.status,
      progress: { percent: 0, message: "test", updated_at: timestamp },
      attempt: 0,
      started_at: null,
      finished_at: null,
    })),
  };
}

test("dynamic fanout materializes deterministic children and an all-children join", () => {
  const { plan, nodeRuns } = fixture();
  const result = materializeDynamicFanout({
    plan,
    nodeRuns,
    source: plan.compiled_nodes[0]!,
    handoffId: "handoff-items",
    content: { items: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    timestamp,
  });
  assert.equal(result.item_count, 3);
  assert.deepEqual(plan.compiled_nodes.map((item) => item.node_id), [
    "source", "join", "worker__fanout_001", "worker__fanout_002", "worker__fanout_003",
  ]);
  assert.equal(plan.edges.filter((edge) => edge.to === "join").length, 3);
  assert.deepEqual(
    plan.compiled_nodes.find((item) => item.node_id === "worker__fanout_002")
      ?.input_payload.run_inputs,
    { work_item: { id: "b" }, fanout_index: 1 },
  );
  assert.equal(nodeRuns.filter((item) => item.dynamic_fanout).length, 3);

  const duplicate = materializeDynamicFanout({
    plan,
    nodeRuns,
    source: plan.compiled_nodes[0]!,
    handoffId: "handoff-items",
    content: { items: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    timestamp,
  });
  assert.equal(duplicate.applied, false);
  assert.equal(plan.compiled_nodes.length, 5);
});

test("dynamic fanout supports zero items and rejects bounded-cardinality overflow", () => {
  const empty = fixture();
  const result = materializeDynamicFanout({
    plan: empty.plan,
    nodeRuns: empty.nodeRuns,
    source: empty.plan.compiled_nodes[0]!,
    handoffId: "handoff-empty",
    content: { items: [] },
    timestamp,
  });
  assert.equal(result.item_count, 0);
  assert.deepEqual(empty.plan.edges.map((edge) => `${edge.from}->${edge.to}`), ["source->join"]);

  const overflow = fixture(2);
  assert.throws(() => materializeDynamicFanout({
    plan: overflow.plan,
    nodeRuns: overflow.nodeRuns,
    source: overflow.plan.compiled_nodes[0]!,
    handoffId: "handoff-overflow",
    content: { items: [1, 2, 3] },
    timestamp,
  }), /exceeding max_items 2/);
  assert.equal(overflow.plan.compiled_nodes.some((item) => item.node_id === "worker"), true);
});
