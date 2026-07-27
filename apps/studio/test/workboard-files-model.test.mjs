import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkboardPage,
  filterWorkboardFileDeliverables,
  mergeWorkspaceChangeSetHistory,
} from "../src/workboard-files-model.js";

const files = Array.from({ length: 24 }, (_, index) => ({
  title: `src/file-${index + 1}.ts`,
  detail: index % 2 ? "Modified" : "Generated output",
  mimeType: "text/typescript",
}));

test("Workboard files are capped at ten rows and page bounds are clamped", () => {
  assert.deepEqual(buildWorkboardPage(files, "", 1).items.map((item) => item.title), files.slice(0, 10).map((item) => item.title));
  assert.equal(buildWorkboardPage(files, "", 2).items.length, 10);
  assert.equal(buildWorkboardPage(files, "", 99).page, 3);
  assert.equal(buildWorkboardPage(files, "", 99).items.length, 4);
});

test("Workboard search matches names and metadata before pagination", () => {
  const result = buildWorkboardPage(files, "generated output", 2);
  assert.equal(result.filteredCount, 12);
  assert.equal(result.page, 2);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((item) => item.detail === "Generated output"));
});

test("Workboard excludes runtime narrative cards from the file list", () => {
  const files = filterWorkboardFileDeliverables([
    { title: "Runtime handoff", source: "runtime", status: "returned" },
    { title: "report.md", source: "artifact", uri: "/api/artifacts/report/download" },
    { title: "result.pdf", artifactId: "artifact-pdf", mimeType: "application/pdf" },
  ]);
  assert.deepEqual(files.map((item) => item.title), ["report.md", "result.pdf"]);
});

test("Workboard keeps earlier files when a later Change Set modifies only one path", () => {
  const merged = mergeWorkspaceChangeSetHistory([
    {
      change_set_id: "first",
      status: "applied",
      created_at: "2026-07-22T00:00:00.000Z",
      changes: [
        { relative_path: "index.html", kind: "added" },
        { relative_path: "src/game.js", kind: "added" },
      ],
    },
    {
      change_set_id: "second",
      status: "applied",
      created_at: "2026-07-22T00:01:00.000Z",
      changes: [{ relative_path: "src/game.js", kind: "modified" }],
    },
  ]);
  assert.deepEqual(merged.map((item) => [item.change.relative_path, item.change.kind, item.changeSet.change_set_id]), [
    ["index.html", "added", "first"],
    ["src/game.js", "modified", "second"],
  ]);
});

test("Workboard accepts the server-side final Workspace file projection", () => {
  const merged = mergeWorkspaceChangeSetHistory([], null, [
    {
      relative_path: "index.html",
      kind: "added",
      status: "applied",
      change_set_id: "projection-1",
      source_root: "C:/workspace",
      added_lines: 4,
      deleted_lines: 0,
    },
    {
      relative_path: "src/app.js",
      kind: "modified",
      status: "pending",
      change_set_id: "projection-2",
      source_root: "C:/workspace",
      added_lines: 2,
      deleted_lines: 1,
    },
  ]);
  assert.deepEqual(merged.map((entry) => entry.change.relative_path), ["index.html", "src/app.js"]);
  assert.equal(merged[1].changeSet.status, "pending");
});
