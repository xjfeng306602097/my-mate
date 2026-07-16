import assert from "node:assert/strict";
import test from "node:test";
import {
  groupWorkspaceTasks,
  reassignSessionProjectMetadata,
} from "../src/workspace-task-tree-model.js";

const projects = [
  { projectId: "local-a", registeredProjectId: "project-a", name: "Alpha", rootPath: "C:/alpha" },
  { projectId: "local-b", registeredProjectId: "project-b", name: "Beta", rootPath: "C:/beta" },
];
const sessions = [
  { session_id: "session-a", metadata: { local_project_id: "project-a" } },
  { session_id: "session-b", metadata: { local_project_id: "project-b" } },
  { session_id: "session-old", metadata: {} },
];
const missions = [
  { session_id: "session-a", title: "Translate report", status: "draft" },
  { session_id: "session-b", title: "Build spreadsheet", status: "running" },
  { session_id: "session-old", title: "Legacy task", status: "draft" },
];

test("groups tasks beneath their registered Desktop Workspace", () => {
  const result = groupWorkspaceTasks({ projects, sessions, missions });
  assert.deepEqual(result.groups.map((group) => group.tasks.map((task) => task.session_id)), [
    ["session-a"],
    ["session-b"],
  ]);
  assert.deepEqual(result.unassigned.map((task) => task.session_id), ["session-old"]);
});

test("keeps a parent Workspace when its child task matches search", () => {
  const result = groupWorkspaceTasks({ projects, sessions, missions, query: "spreadsheet" });
  assert.deepEqual(result.groups.map((group) => group.project.projectId), ["local-b"]);
  assert.deepEqual(result.groups[0].tasks.map((task) => task.session_id), ["session-b"]);
  assert.equal(result.unassigned.length, 0);
});

test("matching a Workspace name keeps all of its tasks visible", () => {
  const result = groupWorkspaceTasks({ projects, sessions, missions, query: "alpha" });
  assert.deepEqual(result.groups.map((group) => group.project.projectId), ["local-a"]);
  assert.deepEqual(result.groups[0].tasks.map((task) => task.session_id), ["session-a"]);
});

test("regroups a task after its durable Project association changes", () => {
  const reassignedSessions = sessions.map((session) =>
    session.session_id === "session-a"
      ? { ...session, metadata: { ...session.metadata, local_project_id: "project-b" } }
      : session,
  );
  const result = groupWorkspaceTasks({ projects, sessions: reassignedSessions, missions });
  assert.deepEqual(result.groups[0].tasks, []);
  assert.deepEqual(
    result.groups[1].tasks.map((task) => task.session_id),
    ["session-a", "session-b"],
  );
});

test("patches only Project metadata after a durable task reassignment", () => {
  const session = { session_id: "session-a", title: "Keep me", metadata: { retained: true } };
  const updated = reassignSessionProjectMetadata(session, {
    task_workspace_id: "task-workspace-b",
    output_relative_path: "deliverables",
    project: { project_id: "project-b" },
  });
  assert.deepEqual(updated, {
    session_id: "session-a",
    title: "Keep me",
    metadata: {
      retained: true,
      local_project_id: "project-b",
      task_workspace_id: "task-workspace-b",
      task_output_relative_path: "deliverables",
    },
  });
  assert.notEqual(updated, session);
});
