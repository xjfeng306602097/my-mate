import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGraphPatchPreview,
  commitGraphHistory,
  createGraphHistory,
  redoGraphHistory,
  undoGraphHistory,
  validateGraphTopology,
} from "../src/graph-editor-model.js";

test("graph editor history supports bounded undo and redo", () => {
  let history = createGraphHistory({ nodes: [{ id: "a" }], edges: [] }, 2);
  history = commitGraphHistory(history, { nodes: [{ id: "a" }, { id: "b" }], edges: [] });
  history = commitGraphHistory(history, { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [] });
  assert.equal(history.undo.length, 2);
  history = undoGraphHistory(history);
  assert.deepEqual(history.present.nodes.map((node) => node.id), ["a", "b"]);
  history = redoGraphHistory(history);
  assert.deepEqual(history.present.nodes.map((node) => node.id), ["a", "b", "c"]);
});

test("graph topology validation catches endpoint, duplicate, self-edge, cycle and condition defects", () => {
  const result = validateGraphTopology({
    nodes: [{ id: "a" }, { id: "b" }, { id: "b" }],
    edges: [
      { from: "a", to: "a", condition: null },
      { from: "a", to: "missing", condition: "bad" },
      { from: "a", to: "b", condition: null },
      { from: "b", to: "a", condition: null },
      { from: "a", to: "b", condition: null },
    ],
  });
  assert.equal(result.valid, false);
  for (const code of [
    "node_id_duplicate",
    "edge_self_cycle",
    "edge_endpoint_missing",
    "edge_condition_invalid",
    "edge_duplicate",
    "graph_cycle",
  ]) assert.equal(result.errors.some((error) => error.code === code), true, code);
});

test("graph patch preview reports node and port-aware edge changes", () => {
  const preview = buildGraphPatchPreview(
    { nodes: [{ id: "a", name: "A" }, { id: "b", name: "B" }], edges: [{ from: "a", to: "b" }] },
    { nodes: [{ id: "a", name: "A2" }, { id: "c", name: "C" }], edges: [{ from: "a", from_port: "success", to: "c", to_port: "input" }] },
  );
  assert.deepEqual(preview.nodes_added, ["c"]);
  assert.deepEqual(preview.nodes_removed, ["b"]);
  assert.deepEqual(preview.nodes_changed, ["a"]);
  assert.equal(preview.edges_added.length, 1);
  assert.equal(preview.edges_removed.length, 1);
  assert.equal(preview.layout_changed, false);
});
