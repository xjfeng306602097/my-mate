import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyRuntimeWorkspaceChangeSet,
  finalizeSandboxWorkspace,
  prepareSandboxWorkspace,
  rejectRuntimeWorkspaceChangeSet,
} from "../src/runtime/workspace-change-set.js";
import { buildRunRecord, saveRun } from "../src/run-store.js";
import { createSession } from "../src/session-store.js";
import { registerWorkspaceBinding } from "../src/workspace-binding-store.js";
import { ensureRunWorkspace, finalizeRunWorkspace, runWorkspaceHostPath } from "../src/runtime/run-workspace.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

function makeWorkspace(): { root: string; sandbox: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-workspace-"));
  const sandbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-sandbox-")), "project");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "edit.txt"), "before\n", "utf8");
  fs.writeFileSync(path.join(root, "delete.txt"), "remove me\n", "utf8");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=blocked\n", "utf8");
  return { root, sandbox };
}

test("sandbox workspace produces an approval-gated change set and applies reviewed files", () => {
  resetTestRoot();
  const { root, sandbox } = makeWorkspace();
  prepareSandboxWorkspace({ sourceRoot: root, sandboxRoot: sandbox });
  assert.equal(fs.existsSync(path.join(sandbox, ".env")), false);

  fs.writeFileSync(path.join(sandbox, "src", "edit.txt"), "after\n", "utf8");
  fs.rmSync(path.join(sandbox, "delete.txt"));
  fs.writeFileSync(path.join(sandbox, "added.txt"), "new\n", "utf8");
  const changeSet = finalizeSandboxWorkspace({
    runId: "run-change-set",
    nodeRunId: "node-change-set",
    jobId: "job-change-set",
    sandboxRoot: sandbox,
  });

  assert.equal(changeSet?.status, "pending");
  assert.deepEqual(
    changeSet?.changes.map((change) => [change.relative_path, change.kind]),
    [["added.txt", "added"], ["delete.txt", "deleted"], ["src/edit.txt", "modified"]],
  );
  const editedDiff = changeSet?.changes.find((change) => change.relative_path === "src/edit.txt")?.diff;
  assert.equal(editedDiff?.status, "available");
  assert.ok(editedDiff?.lines.some((line) => line.kind === "deleted" && line.text === "before"));
  assert.ok(editedDiff?.lines.some((line) => line.kind === "added" && line.text === "after"));
  const applied = applyRuntimeWorkspaceChangeSet({
    changeSetId: changeSet?.change_set_id || "",
    actor: "operator-test",
    comment: "Reviewed in test",
  });
  assert.equal(applied.status, "applied");
  assert.equal(fs.readFileSync(path.join(root, "src", "edit.txt"), "utf8"), "after\n");
  assert.equal(fs.existsSync(path.join(root, "delete.txt")), false);
  assert.equal(fs.readFileSync(path.join(root, "added.txt"), "utf8"), "new\n");
  assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), "SECRET=blocked\n");

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
});

test("workspace change application rejects concurrent source edits", () => {
  resetTestRoot();
  const { root, sandbox } = makeWorkspace();
  prepareSandboxWorkspace({ sourceRoot: root, sandboxRoot: sandbox });
  fs.writeFileSync(path.join(sandbox, "src", "edit.txt"), "sandbox edit\n", "utf8");
  const changeSet = finalizeSandboxWorkspace({
    runId: "run-conflict",
    nodeRunId: "node-conflict",
    jobId: "job-conflict",
    sandboxRoot: sandbox,
  });
  fs.writeFileSync(path.join(root, "src", "edit.txt"), "user edit\n", "utf8");

  assert.throws(
    () => applyRuntimeWorkspaceChangeSet({ changeSetId: changeSet?.change_set_id || "", actor: "operator-test" }),
    /WORKSPACE_CONFLICT/u,
  );
  const rejected = rejectRuntimeWorkspaceChangeSet({
    changeSetId: changeSet?.change_set_id || "",
    actor: "operator-test",
    comment: "Source changed",
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(fs.readFileSync(path.join(root, "src", "edit.txt"), "utf8"), "user edit\n");

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
});

test("workspace change application rolls back earlier files when a later commit fails", () => {
  resetTestRoot();
  const { root, sandbox } = makeWorkspace();
  prepareSandboxWorkspace({ sourceRoot: root, sandboxRoot: sandbox });
  fs.writeFileSync(path.join(sandbox, "delete.txt"), "updated delete file\n", "utf8");
  fs.writeFileSync(path.join(sandbox, "src", "edit.txt"), "updated edit file\n", "utf8");
  const changeSet = finalizeSandboxWorkspace({
    runId: "run-rollback",
    nodeRunId: "node-rollback",
    jobId: "job-rollback",
    sandboxRoot: sandbox,
  });
  const originalRename = fs.renameSync;
  const originalCopy = fs.copyFileSync;
  const failingTarget = path.join(root, "src", "edit.txt");
  let commitRenames = 0;
  (fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = ((source, target) => {
    if (String(source).includes(".my-mate-") && String(source).endsWith(".tmp")) {
      commitRenames += 1;
      if (commitRenames === 2) throw new Error("simulated rename failure");
    }
    return originalRename(source, target);
  }) as typeof fs.renameSync;
  (fs as unknown as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = ((source, target, mode) => {
    if (String(source).endsWith(".tmp") && path.resolve(String(target)) === path.resolve(failingTarget)) {
      throw new Error("simulated copy failure");
    }
    return originalCopy(source, target, mode);
  }) as typeof fs.copyFileSync;
  try {
    assert.throws(
      () => applyRuntimeWorkspaceChangeSet({ changeSetId: changeSet?.change_set_id || "", actor: "operator-test" }),
      /simulated copy failure/u,
    );
    assert.equal(fs.readFileSync(path.join(root, "delete.txt"), "utf8"), "remove me\n");
    assert.equal(fs.readFileSync(path.join(root, "src", "edit.txt"), "utf8"), "before\n");
  } finally {
    (fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = originalRename;
    (fs as unknown as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = originalCopy;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
  }
});

test("Run Workspace preserves earlier worker edits and produces one final Change Set", () => {
  resetTestRoot();
  const { root } = makeWorkspace();
  try {
    ensureRunWorkspace({ runId: "run-shared-workspace", sourceRoot: root });
    const sandbox = runWorkspaceHostPath("run-shared-workspace");
    fs.writeFileSync(path.join(sandbox, "src", "edit.txt"), "first worker\n", "utf8");
    ensureRunWorkspace({ runId: "run-shared-workspace", sourceRoot: root });
    assert.equal(fs.readFileSync(path.join(sandbox, "src", "edit.txt"), "utf8"), "first worker\n");
    fs.writeFileSync(path.join(sandbox, "second.txt"), "second worker\n", "utf8");
    const changeSet = finalizeRunWorkspace({
      runId: "run-shared-workspace",
      nodeRunId: "node-final",
      jobId: "job-final",
    });
    assert.deepEqual(
      changeSet?.changes.map((change) => change.relative_path),
      ["second.txt", "src/edit.txt"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace change previews distinguish binary, oversized, and truncated text", () => {
  resetTestRoot();
  const { root, sandbox } = makeWorkspace();
  fs.writeFileSync(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(root, "oversized.txt"), "a".repeat(256 * 1024 + 1), "utf8");
  fs.writeFileSync(path.join(root, "long-line.txt"), `${"x".repeat(2_100)}\n`, "utf8");
  prepareSandboxWorkspace({ sourceRoot: root, sandboxRoot: sandbox });

  fs.writeFileSync(path.join(sandbox, "binary.dat"), Buffer.from([0, 9, 8, 7]));
  fs.writeFileSync(path.join(sandbox, "oversized.txt"), "b".repeat(256 * 1024 + 1), "utf8");
  fs.writeFileSync(path.join(sandbox, "long-line.txt"), `${"y".repeat(2_100)}\n`, "utf8");
  const changeSet = finalizeSandboxWorkspace({
    runId: "run-preview-change",
    nodeRunId: "node-preview-change",
    jobId: "job-preview-change",
    sandboxRoot: sandbox,
  });

  const binary = changeSet?.changes.find((change) => change.relative_path === "binary.dat");
  const oversized = changeSet?.changes.find((change) => change.relative_path === "oversized.txt");
  const longLine = changeSet?.changes.find((change) => change.relative_path === "long-line.txt");
  assert.equal(binary?.diff.status, "binary");
  assert.equal(binary?.diff.truncated, false);
  assert.equal(oversized?.diff.status, "too_large");
  assert.equal(oversized?.diff.truncated, true);
  assert.equal(longLine?.diff.status, "available");
  assert.equal(longLine?.diff.truncated, true);
  assert.deepEqual(longLine?.diff.lines.map((line) => line.kind), ["deleted", "added"]);
  assert.ok(longLine?.diff.lines.every((line) => line.text.length <= 2_000));

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
});

test("workspace change set API lists and applies pending changes", async () => {
  resetTestRoot();
  const { root, sandbox } = makeWorkspace();
  prepareSandboxWorkspace({ sourceRoot: root, sandboxRoot: sandbox });
  fs.writeFileSync(path.join(sandbox, "src", "edit.txt"), "api edit\n", "utf8");
  const changeSet = finalizeSandboxWorkspace({
    runId: "run-api-change",
    nodeRunId: "node-api-change",
    jobId: "job-api-change",
    sandboxRoot: sandbox,
  });
  const server = await startTestServer();
  try {
    const listed = await getJson(`${server.baseUrl}/api/runtime/workspace-change-sets?status=pending`);
    assert.equal(listed.status, 200);
    assert.ok((listed.body.items as Array<{ change_set_id: string }>).some(
      (item) => item.change_set_id === changeSet?.change_set_id,
    ));
    const applied = await postJson(
      `${server.baseUrl}/api/runtime/workspace-change-sets/${changeSet?.change_set_id}/apply`,
      { comment: "API review" },
    );
    assert.equal(applied.status, 200);
    assert.equal(applied.body.status, "applied");
    assert.equal(fs.readFileSync(path.join(root, "src", "edit.txt"), "utf8"), "api edit\n");
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
  }
});

test("bound local Change Sets require the authenticated Desktop apply boundary", async () => {
  resetTestRoot();
  const { root, sandbox } = makeWorkspace();
  const session = createSession({ initial_message: "Edit project", created_by: "test" });
  const binding = registerWorkspaceBinding({
    workspaceId: session.workspace_id || "default",
    sessionId: session.session_id,
    desktopInstanceId: "desktop-apply-test",
    capabilityId: "capability-apply-test",
    rootPath: root,
    access: "sandbox-write",
    scope: "session",
  });
  const run = buildRunRecord({
    intent: "Edit project",
    template_id: "test-template",
    inputs: {},
  });
  run.workspace_binding_id = binding.binding_id;
  saveRun(run);
  prepareSandboxWorkspace({ sourceRoot: root, sandboxRoot: sandbox });
  fs.writeFileSync(path.join(sandbox, "src", "edit.txt"), "desktop edit\n", "utf8");
  const changeSet = finalizeSandboxWorkspace({
    runId: run.run_id,
    nodeRunId: "node-desktop-apply",
    jobId: "job-desktop-apply",
    sandboxRoot: sandbox,
  });
  const server = await startTestServer({ desktopBridgeToken: "desktop-apply-secret" });
  try {
    const publicApply = await postJson(
      `${server.baseUrl}/api/runtime/workspace-change-sets/${changeSet?.change_set_id}/apply`,
      {},
    );
    assert.equal(publicApply.status, 409);
    assert.equal(publicApply.body.code, "desktop_apply_required");
    const applied = await postJson(
      `${server.baseUrl}/api/internal/desktop/workspace-change-sets/${changeSet?.change_set_id}/apply`,
      {
        desktop_instance_id: "desktop-apply-test",
        capability_id: "capability-apply-test",
      },
      { authorization: "Bearer desktop-apply-secret" },
    );
    assert.equal(applied.status, 200);
    assert.equal(fs.readFileSync(path.join(root, "src", "edit.txt"), "utf8"), "desktop edit\n");
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
  }
});
