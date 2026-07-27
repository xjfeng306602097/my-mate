import assert from "node:assert/strict";
import test from "node:test";
import {
  countWorkspaceChangeKinds,
  formatWorkspaceBytes,
  openWorkspaceChangeSets,
  selectWorkspaceChangeSet,
  selectWorkspaceFile,
  workspaceChangeKindSymbol,
  workspaceChangeTone,
} from "../src/workspace-change-diff-model.js";

const pending = {
  change_set_id: "pending-1",
  status: "pending",
  changes: [
    { relative_path: "src/add.js", kind: "added" },
    { relative_path: "src/edit.js", kind: "modified" },
    { relative_path: "src/remove.js", kind: "deleted" },
  ],
};

test("workspace change diff model defaults to actionable sets but preserves a selected history item", () => {
  const items = [
    { change_set_id: "applied-1", status: "applied", changes: [] },
    pending,
    { change_set_id: "blocked-1", status: "blocked", changes: [] },
  ];
  assert.deepEqual(openWorkspaceChangeSets(items).map((item) => item.change_set_id), ["pending-1", "blocked-1"]);
  assert.equal(selectWorkspaceChangeSet(items, "blocked-1")?.change_set_id, "blocked-1");
  assert.equal(selectWorkspaceChangeSet(items, "applied-1")?.change_set_id, "applied-1");
  assert.equal(selectWorkspaceChangeSet(items, "missing")?.change_set_id, "pending-1");
  assert.equal(selectWorkspaceFile(pending, "src/edit.js")?.kind, "modified");
  assert.equal(selectWorkspaceFile(pending, "missing")?.relative_path, "src/add.js");
});

test("workspace change diff model summarizes status, kinds, and sizes", () => {
  assert.deepEqual(countWorkspaceChangeKinds(pending), { added: 1, modified: 1, deleted: 1 });
  assert.equal(workspaceChangeTone("blocked"), "danger");
  assert.equal(workspaceChangeTone("pending"), "warn");
  assert.equal(workspaceChangeKindSymbol("added"), "+");
  assert.equal(workspaceChangeKindSymbol("deleted"), "-");
  assert.equal(formatWorkspaceBytes(1536), "1.5 KB");
});
