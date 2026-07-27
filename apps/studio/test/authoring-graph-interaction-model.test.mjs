import assert from "node:assert/strict";
import test from "node:test";

import {
  authoringConnectionPath,
  authoringNodesInRectangle,
  authoringSelectionIncludesNode,
} from "../src/authoring-graph-interaction-model.js";

test("recognizes single and marquee node selections", () => {
  assert.equal(authoringSelectionIncludesNode({ type: "node", index: 2 }, 2), true);
  assert.equal(authoringSelectionIncludesNode({ type: "nodes", indexes: [1, 3] }, 3), true);
  assert.equal(authoringSelectionIncludesNode({ type: "nodes", indexes: [1, 3] }, 2), false);
});

test("builds a stable cubic preview path", () => {
  assert.equal(authoringConnectionPath({ fromX: 100, fromY: 40, toX: 260, toY: 140 }), "M 100 40 C 224 40, 224 140, 260 140");
});

test("finds every node intersected by a rectangle in either drag direction", () => {
  const nodes = [
    { index: 0, left: 10, top: 10, width: 100, height: 60 },
    { index: 1, left: 160, top: 20, width: 100, height: 60 },
    { index: 2, left: 320, top: 200, width: 100, height: 60 },
  ];
  assert.deepEqual(authoringNodesInRectangle(nodes, { startX: 275, startY: 100, endX: 0, endY: 0 }), [0, 1]);
});

