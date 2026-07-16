import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishTaskArtifact } from "../src/durable-artifact-publisher.js";
import { getSession } from "../src/session-store.js";
import { getTaskWorkspace } from "../src/task-workspace-store.js";
import { listSessionWorkspaceBindings } from "../src/workspace-binding-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

test("Desktop Projects bind Tasks and publish durable outputs without exposing host roots", async () => {
  resetTestRoot();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-project-"));
  const server = await startTestServer({ desktopBridgeToken: "desktop-project-secret" });
  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create a durable report",
      created_by: "test",
      defer_conversation_reply: true,
    });
    const sessionId = created.body.session.session_id as string;
    const bound = await postJson(
      `${server.baseUrl}/api/internal/desktop/workspace-bindings`,
      {
        session_id: sessionId,
        desktop_instance_id: "desktop-project-test",
        capability_id: "project-capability",
        root_path: projectRoot,
        display_name: "Quarterly report",
        description: "Durable task outputs",
        output_relative_path: "deliverables",
        access: "snapshot-read",
        scope: "session",
      },
      { authorization: "Bearer desktop-project-secret" },
    );
    assert.equal(bound.status, 201);
    assert.equal(bound.body.project.name, "Quarterly report");
    assert.equal(bound.body.task_workspace.output_relative_path, "deliverables");
    assert.equal("root_path" in bound.body.project, false);

    const projects = await getJson(`${server.baseUrl}/api/projects`);
    assert.equal(projects.body.items.length, 1);
    assert.equal("root_path" in projects.body.items[0], false);

    const taskWorkspace = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/task-workspace`);
    assert.equal(taskWorkspace.body.task_workspace.project.project_id, bound.body.project.project_id);
    assert.equal(getTaskWorkspace(sessionId)?.binding_id, bound.body.binding.binding_id);

    const published = publishTaskArtifact({
      sessionId,
      fileName: "report.md",
      content: Buffer.from("# Durable output\n", "utf8"),
    });
    assert.equal(published?.published_relative_path, "deliverables/report.md");
    assert.equal(fs.readFileSync(path.join(projectRoot, "deliverables", "report.md"), "utf8"), "# Durable output\n");

    const archived = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/archive`, { reason: "Done" });
    assert.equal(archived.status, 200);
    assert.equal(getTaskWorkspace(sessionId)?.status, "archived");
    assert.equal(fs.existsSync(path.join(projectRoot, "deliverables", "report.md")), true);

    const projectArchived = await postJson(
      `${server.baseUrl}/api/internal/desktop/projects/${bound.body.project.project_id}/archive`,
      {},
      { authorization: "Bearer desktop-project-secret" },
    );
    assert.equal(projectArchived.status, 200);
    assert.equal(projectArchived.body.removed_local_directory, false);
    assert.equal(fs.existsSync(projectRoot), true);
  } finally {
    await server.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("Desktop can move assigned and unassigned Tasks between authorized Projects", async () => {
  resetTestRoot();
  const projectRootA = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-project-a-"));
  const projectRootB = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-project-b-"));
  const server = await startTestServer({ desktopBridgeToken: "desktop-move-secret" });
  const bind = (sessionId: string, rootPath: string, capabilityId: string, projectId = "") =>
    postJson(
      `${server.baseUrl}/api/internal/desktop/workspace-bindings`,
      {
        session_id: sessionId,
        desktop_instance_id: "desktop-move-test",
        capability_id: capabilityId,
        root_path: rootPath,
        display_name: path.basename(rootPath),
        output_relative_path: "outputs",
        ...(projectId ? { project_id: projectId } : {}),
        access: "snapshot-read",
        scope: "session",
      },
      { authorization: "Bearer desktop-move-secret" },
    );
  try {
    const assigned = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Move this task",
      created_by: "test",
      defer_conversation_reply: true,
    });
    const assignedSessionId = assigned.body.session.session_id as string;
    const firstBinding = await bind(assignedSessionId, projectRootA, "capability-a");
    assert.equal(firstBinding.status, 201);
    const moved = await bind(assignedSessionId, projectRootB, "capability-b");
    assert.equal(moved.status, 201);
    assert.notEqual(moved.body.project.project_id, firstBinding.body.project.project_id);
    assert.equal(getTaskWorkspace(assignedSessionId)?.project_id, moved.body.project.project_id);
    assert.equal(getSession(assignedSessionId)?.metadata?.local_project_id, moved.body.project.project_id);
    const bindingHistory = listSessionWorkspaceBindings(assignedSessionId);
    assert.equal(bindingHistory.filter((binding) => binding.status === "active").length, 1);
    assert.equal(bindingHistory.find((binding) => binding.binding_id === firstBinding.body.binding.binding_id)?.status, "revoked");

    const unassigned = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Archive this task",
      created_by: "test",
      defer_conversation_reply: true,
    });
    const unassignedSessionId = unassigned.body.session.session_id as string;
    const assignedToB = await bind(
      unassignedSessionId,
      projectRootB,
      "capability-b",
      moved.body.project.project_id,
    );
    assert.equal(assignedToB.status, 201);
    assert.equal(getTaskWorkspace(unassignedSessionId)?.project_id, moved.body.project.project_id);

    const rejected = await bind(
      unassignedSessionId,
      projectRootB,
      "wrong-capability",
      moved.body.project.project_id,
    );
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, "local_project_capability_mismatch");
    assert.equal(getTaskWorkspace(unassignedSessionId)?.project_id, moved.body.project.project_id);
    assert.equal("root_path" in moved.body.project, false);
  } finally {
    await server.close();
    fs.rmSync(projectRootA, { recursive: true, force: true });
    fs.rmSync(projectRootB, { recursive: true, force: true });
  }
});
