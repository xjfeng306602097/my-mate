import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyConversationWorkspaceOperations,
  conversationWorkspaceStatus,
  finalizeConversationCodingTransaction,
  getConversationCodingTransaction,
  runConversationWorkspaceCommand,
} from "../src/conversation-coding-workspace.js";
import {
  applyRuntimeWorkspaceChangeSet,
  getRuntimeWorkspaceChangeSet,
} from "../src/runtime/workspace-change-set.js";
import {
  createJsonStorageBackend,
  getJsonStorageBackend,
  setJsonStorageBackend,
} from "../src/storage-backend.js";
import { executeConversationTool } from "../src/conversation-tools.js";
import { completeConversationAction, createConversationAction } from "../src/conversation-action-store.js";
import { createSession, getSession, saveSession } from "../src/session-store.js";
import { createSessionMessage } from "../src/session-message-store.js";
import { registerWorkspaceBinding } from "../src/workspace-binding-store.js";
import { postJson, resetTestRoot, startTestServer } from "./helpers.js";

function fixture() {
  resetTestRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-conversation-code-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "edit.ts"), "export const value = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "remove.txt"), "remove\n", "utf8");
  fs.writeFileSync(path.join(root, "move.txt"), "move\n", "utf8");
  const session = createSession({ initial_message: "Edit this project", created_by: "test" });
  registerWorkspaceBinding({
    workspaceId: session.workspace_id || "default",
    sessionId: session.session_id,
    desktopInstanceId: "desktop-code-test",
    capabilityId: "capability-code-test",
    rootPath: root,
    access: "sandbox-write",
    scope: "session",
  });
  return { root, session };
}

test("Conversation coding transaction keeps bulk edits sandboxed until reviewed apply", () => {
  const { root, session } = fixture();
  try {
    const beforeHash = "5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29";
    const result = applyConversationWorkspaceOperations({
      session,
      idempotencyKey: "batch-1",
      operations: [
        { kind: "replace", path: "src/edit.ts", old_text: "value = 1", new_text: "value = 2", expected_sha256: beforeHash },
        { kind: "write", path: "src/new.ts", content: "export const added = true;\n" },
        { kind: "delete", path: "remove.txt" },
        { kind: "move", path: "move.txt", destination: "archive/moved.txt" },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(root, "src", "edit.ts"), "utf8"), "export const value = 1;\n");
    assert.equal(fs.existsSync(path.join(root, "src", "new.ts")), false);
    assert.equal(fs.existsSync(path.join(root, "remove.txt")), true);

    const replay = applyConversationWorkspaceOperations({
      session,
      idempotencyKey: "batch-1",
      operations: [{ kind: "write", path: "should-not-exist.txt", content: "duplicate" }],
    });
    assert.equal(replay.idempotent_replay, true);
    const transaction = getConversationCodingTransaction(session.session_id);
    assert.ok(transaction);
    assert.equal(fs.existsSync(path.join(transaction!.sandbox_root, "should-not-exist.txt")), false);

    const status = conversationWorkspaceStatus(session);
    assert.deepEqual(
      (status.changes as Array<{ path: string; kind: string }>).map((change) => [change.path, change.kind]),
      [["archive/moved.txt", "added"], ["move.txt", "deleted"], ["remove.txt", "deleted"], ["src/edit.ts", "modified"], ["src/new.ts", "added"]],
    );
    const changeSet = finalizeConversationCodingTransaction(session);
    assert.equal(changeSet?.origin, "conversation");
    assert.equal(changeSet?.session_id, session.session_id);
    assert.equal(changeSet?.workspace_binding_id?.startsWith("wsbind_"), true);
    assert.equal(getConversationCodingTransaction(session.session_id)?.status, "awaiting_review");

    applyRuntimeWorkspaceChangeSet({ changeSetId: changeSet!.change_set_id, actor: "test-reviewer" });
    assert.equal(fs.readFileSync(path.join(root, "src", "edit.ts"), "utf8"), "export const value = 2;\n");
    assert.equal(fs.readFileSync(path.join(root, "src", "new.ts"), "utf8"), "export const added = true;\n");
    assert.equal(fs.existsSync(path.join(root, "remove.txt")), false);
    assert.equal(fs.readFileSync(path.join(root, "archive", "moved.txt"), "utf8"), "move\n");
    assert.equal(getConversationCodingTransaction(session.session_id)?.status, "closed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Shared Agent sandbox rejects an implicit cross-Agent overwrite and permits an explicit hash handoff", () => {
  const { root, session } = fixture();
  try {
    const firstAgent = createSession({ title: "First Agent" });
    firstAgent.metadata = { ...firstAgent.metadata, coding_workspace_owner_session_id: session.session_id, agent_task_id: "task-first" };
    const secondAgent = createSession({ title: "Second Agent" });
    secondAgent.metadata = { ...secondAgent.metadata, coding_workspace_owner_session_id: session.session_id, agent_task_id: "task-second" };

    applyConversationWorkspaceOperations({
      session: firstAgent,
      idempotencyKey: "first-owner",
      operations: [{ kind: "write", path: "src/shared.ts", content: "export const owner = 'first';\n" }],
    });
    assert.throws(() => applyConversationWorkspaceOperations({
      session: secondAgent,
      idempotencyKey: "implicit-overwrite",
      operations: [{ kind: "write", path: "src/shared.ts", content: "export const owner = 'second';\n" }],
    }), (error: unknown) => (error as { code?: string }).code === "workspace_path_claim_conflict");

    const transaction = getConversationCodingTransaction(session.session_id)!;
    const sharedPath = path.join(transaction.sandbox_root, "src", "shared.ts");
    const expectedSha256 = createHash("sha256").update(fs.readFileSync(sharedPath)).digest("hex");
    applyConversationWorkspaceOperations({
      session: secondAgent,
      idempotencyKey: "explicit-handoff",
      operations: [{ kind: "write", path: "src/shared.ts", content: "export const owner = 'second';\n", expected_sha256: expectedSha256 }],
    });
    assert.equal(fs.readFileSync(sharedPath, "utf8"), "export const owner = 'second';\n");
    assert.equal(getConversationCodingTransaction(session.session_id)?.path_claims["src/shared.ts"]?.agent_task_id, "task-second");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Conversation coding batch rolls back earlier operations when a later operation fails", () => {
  const { root, session } = fixture();
  try {
    assert.throws(() => applyConversationWorkspaceOperations({
      session,
      idempotencyKey: "rollback-batch",
      operations: [
        { kind: "write", path: "first.txt", content: "created\n" },
        { kind: "replace", path: "src/edit.ts", old_text: "missing text", new_text: "never" },
      ],
    }), /old_text was not found/u);
    const transaction = getConversationCodingTransaction(session.session_id);
    assert.ok(transaction);
    assert.equal(fs.existsSync(path.join(transaction!.sandbox_root, "first.txt")), false);
    assert.equal(fs.readFileSync(path.join(transaction!.sandbox_root, "src", "edit.ts"), "utf8"), "export const value = 1;\n");
    assert.equal(transaction!.operation_ledger.at(-1)?.status, "failed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Conversation sandbox commands are network-isolated and idempotent", async () => {
  const { root, session } = fixture();
  try {
    let calls = 0;
    let capturedArgs: string[] = [];
    const execute = async (_executable: string, args: string[]) => {
      calls += 1;
      capturedArgs = args;
      return { stdout: "tests passed\n", stderr: "" };
    };
    const first = await runConversationWorkspaceCommand({
      session,
      idempotencyKey: "test-command",
      command: "npm",
      args: ["test"],
      timeoutSeconds: 30,
      execDocker: execute,
    });
    const replay = await runConversationWorkspaceCommand({
      session,
      idempotencyKey: "test-command",
      command: "npm",
      args: ["test"],
      execDocker: execute,
    });
    assert.equal(first.ok, true);
    assert.equal(replay.idempotent_replay, true);
    assert.equal(calls, 1);
    assert.ok(capturedArgs.includes("none"));
    assert.ok(capturedArgs.includes("--cap-drop"));
    assert.ok(capturedArgs.includes("--mount"));
    assert.equal(getConversationCodingTransaction(session.session_id)?.operation_ledger.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Conversation coding reuses one persistent transaction with SQLite storage", async () => {
  resetTestRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-conversation-code-sqlite-"));
  const previousBackend = getJsonStorageBackend();
  const previousSqlitePath = process.env.MY_MATE_SQLITE_PATH;
  process.env.MY_MATE_SQLITE_PATH = path.join(root, "control-plane.sqlite3");
  setJsonStorageBackend(createJsonStorageBackend("sqlite"));
  try {
    const session = createSession({ initial_message: "Persist this coding transaction", created_by: "test" });
    registerWorkspaceBinding({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      desktopInstanceId: "desktop-sqlite-code-test",
      capabilityId: "capability-sqlite-code-test",
      rootPath: root,
      access: "sandbox-write",
      scope: "session",
    });
    const written = applyConversationWorkspaceOperations({
      session,
      idempotencyKey: "sqlite-write",
      operations: [{ kind: "write", path: "generated.txt", content: "persisted\n" }],
    });
    let mountedWorkspace = "";
    const commanded = await runConversationWorkspaceCommand({
      session,
      idempotencyKey: "sqlite-command",
      command: "node",
      args: ["--version"],
      execDocker: async (_executable, args) => {
        const mount = args[args.indexOf("--mount") + 1] || "";
        mountedWorkspace = mount.match(/source=([^,]+),target=\/workspace/u)?.[1] || "";
        return { stdout: "v22\n", stderr: "" };
      },
    });
    assert.equal(commanded.transaction_id, written.transaction_id);
    assert.equal(fs.readFileSync(path.join(mountedWorkspace, "generated.txt"), "utf8"), "persisted\n");
    assert.equal(getConversationCodingTransaction(session.session_id)?.operation_ledger.length, 2);
    const changeSet = finalizeConversationCodingTransaction(session);
    assert.equal(changeSet?.status, "pending");
    assert.equal(changeSet?.changes.length, 1);
    assert.equal(changeSet?.changes[0]?.relative_path, "generated.txt");
    assert.equal(getRuntimeWorkspaceChangeSet(changeSet!.change_set_id)?.change_set_id, changeSet!.change_set_id);
    assert.equal(getConversationCodingTransaction(session.session_id)?.status, "awaiting_review");
  } finally {
    setJsonStorageBackend(previousBackend);
    if (previousSqlitePath === undefined) delete process.env.MY_MATE_SQLITE_PATH;
    else process.env.MY_MATE_SQLITE_PATH = previousSqlitePath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Conversation coding authorization follows Review First and network escalation policy", async () => {
  const { root, session } = fixture();
  try {
    session.metadata = { ...session.metadata, autonomy_mode: "review_first" };
    const reviewFirst = await executeConversationTool({
      session,
      call: {
        id: "review-first-write",
        name: "workspace_apply_operations",
        arguments: {
          idempotency_key: "review-first-write",
          operations: [{ kind: "write", path: "review-first.txt", content: "pending\n" }],
        },
      },
    });
    assert.equal(reviewFirst.is_error, true);
    assert.equal(reviewFirst.content.code, "desktop_approval_unavailable");
    assert.equal(getConversationCodingTransaction(session.session_id), null);

    session.metadata = { ...session.metadata, autonomy_mode: "assisted" };
    const publicNetwork = await executeConversationTool({
      session,
      call: {
        id: "public-network-command",
        name: "workspace_run_command",
        arguments: {
          idempotency_key: "public-network-command",
          command: "npm",
          args: ["install"],
          network: "public",
        },
      },
    });
    assert.equal(publicNetwork.is_error, true);
    assert.equal(publicNetwork.content.code, "desktop_approval_unavailable");
    assert.equal(getConversationCodingTransaction(session.session_id), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Conversation coding upgrades a read binding through Desktop and resumes the original write", async () => {
  const { root, session } = fixture();
  try {
    registerWorkspaceBinding({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      desktopInstanceId: "desktop-code-test",
      capabilityId: "capability-code-test",
      rootPath: root,
      access: "snapshot-read",
      scope: "session",
    });
    session.metadata = { ...session.metadata, autonomy_mode: "assisted" };
    const progress: string[] = [];
    let authorizationRequests = 0;
    const result = await executeConversationTool({
      session,
      call: {
        id: "authorize-and-write",
        name: "workspace_apply_operations",
        arguments: {
          idempotency_key: "authorize-and-write",
          operations: [{ kind: "write", path: "authorized.txt", content: "sandboxed\n" }],
        },
      },
      onProgress: (event) => { progress.push(event.status); },
      onDesktopCapability: async (request) => {
        assert.equal(request.type, "workspace.authorize");
        assert.equal(request.workspace_access, "sandbox-write");
        authorizationRequests += 1;
        registerWorkspaceBinding({
          workspaceId: session.workspace_id || "default",
          sessionId: session.session_id,
          desktopInstanceId: "desktop-code-test",
          capabilityId: "capability-code-test",
          rootPath: root,
          access: "sandbox-write",
          scope: "session",
        });
      },
    });
    assert.equal(result.is_error, false, JSON.stringify(result.content));
    assert.equal(authorizationRequests, 1);
    assert.ok(progress.includes("pending_approval"));
    assert.equal(fs.existsSync(path.join(root, "authorized.txt")), false);
    const transaction = getConversationCodingTransaction(session.session_id);
    assert.ok(transaction);
    assert.equal(fs.readFileSync(path.join(transaction!.sandbox_root, "authorized.txt"), "utf8"), "sandboxed\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Conversation coding requests Desktop authorization when the Session has no Workspace binding", async () => {
  resetTestRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-conversation-code-unbound-"));
  const session = createSession({ initial_message: "Create a file in the current Workspace", created_by: "test" });
  session.metadata = { ...session.metadata, autonomy_mode: "assisted" };
  try {
    let authorizationRequests = 0;
    const result = await executeConversationTool({
      session,
      call: {
        id: "authorize-unbound-write",
        name: "workspace_apply_operations",
        arguments: {
          idempotency_key: "authorize-unbound-write",
          operations: [{ kind: "write", path: "unbound.txt", content: "authorized\n" }],
        },
      },
      onDesktopCapability: async (request) => {
        assert.equal(request.type, "workspace.authorize");
        assert.equal(request.workspace_access, "sandbox-write");
        authorizationRequests += 1;
        registerWorkspaceBinding({
          workspaceId: session.workspace_id || "default",
          sessionId: session.session_id,
          desktopInstanceId: "desktop-code-unbound-test",
          capabilityId: "capability-code-unbound-test",
          rootPath: root,
          access: "sandbox-write",
          scope: "session",
        });
      },
    });
    assert.equal(result.is_error, false, JSON.stringify(result.content));
    assert.equal(authorizationRequests, 1);
    const transaction = getConversationCodingTransaction(session.session_id);
    assert.ok(transaction);
    assert.equal(fs.readFileSync(path.join(transaction!.sandbox_root, "unbound.txt"), "utf8"), "authorized\n");
    assert.equal(fs.existsSync(path.join(root, "unbound.txt")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Conversation coding transaction handles a 100-file change set", () => {
  const { root, session } = fixture();
  try {
    applyConversationWorkspaceOperations({
      session,
      idempotencyKey: "stress-100-files",
      operations: Array.from({ length: 100 }, (_, index) => ({
        kind: "write" as const,
        path: `generated/file-${String(index).padStart(3, "0")}.ts`,
        content: `export const item${index} = ${index};\n`,
      })),
    });
    const changeSet = finalizeConversationCodingTransaction(session);
    assert.equal(changeSet?.changes.length, 100);
    assert.equal(fs.existsSync(path.join(root, "generated")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Conversation Change Set requires Desktop authorization and completes the Task without a synthetic Run", async () => {
  const { root, session } = fixture();
  applyConversationWorkspaceOperations({
    session,
    idempotencyKey: "desktop-review",
    operations: [{ kind: "write", path: "reviewed.txt", content: "approved\n" }],
  });
  const changeSet = finalizeConversationCodingTransaction(session)!;
  session.status = "draft";
  saveSession(session);
  const server = await startTestServer({ desktopBridgeToken: "desktop-code-secret" });
  try {
    const publicApply = await postJson(
      `${server.baseUrl}/api/runtime/workspace-change-sets/${changeSet.change_set_id}/apply`,
      {},
    );
    assert.equal(publicApply.status, 409);
    assert.equal(publicApply.body.code, "desktop_apply_required");
    assert.equal(fs.existsSync(path.join(root, "reviewed.txt")), false);

    const desktopApply = await postJson(
      `${server.baseUrl}/api/internal/desktop/workspace-change-sets/${changeSet.change_set_id}/apply`,
      {
        desktop_instance_id: "desktop-code-test",
        capability_id: "capability-code-test",
      },
      { authorization: "Bearer desktop-code-secret" },
    );
    assert.equal(desktopApply.status, 200);
    assert.equal(desktopApply.body.status, "applied");
    assert.equal(fs.readFileSync(path.join(root, "reviewed.txt"), "utf8"), "approved\n");
    const completedSession = getSession(session.session_id);
    assert.equal(completedSession?.status, "completed", "Applying reviewed files must complete the Task.");
    assert.equal((completedSession?.metadata.workspace_state as Record<string, unknown>)?.stage, "deliver");
    assert.equal((completedSession?.metadata.mission_route_state as Record<string, unknown>)?.selected_template_id, "conversation-direct");
    assert.equal(completedSession?.metadata.latest_workspace_change_set_status, "applied");

    const detailResponse = await fetch(`${server.baseUrl}/api/sessions/${session.session_id}`);
    const detail = await detailResponse.json() as Record<string, any>;
    assert.equal(detail.session.status, "completed");
    assert.equal(detail.workspace_state.stage, "deliver");
    assert.equal(detail.mission_spec.route.selectedTemplateId, "conversation-direct");
    assert.equal(detail.workspace_change_set.status, "applied");
    assert.deepEqual(detail.workspace_change_set.changes.map((change: Record<string, unknown>) => change.relative_path), ["reviewed.txt"]);
    assert.ok(detail.mission_snapshot.stages.some((stage: Record<string, unknown>) =>
      stage.key === "plan" && stage.title === "Direct conversation execution" && stage.status === "done"));
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Session detail retains applied Change Set history for the Workboard", async () => {
  const { root, session } = fixture();
  const server = await startTestServer({ desktopBridgeToken: "desktop-history-secret" });
  try {
    applyConversationWorkspaceOperations({
      session,
      idempotencyKey: "history-first",
      operations: [
        { kind: "write", path: "index.html", content: "<main>first</main>\n" },
        { kind: "write", path: "src/game.js", content: "export const game = 1;\n" },
      ],
    });
    const first = finalizeConversationCodingTransaction(session)!;
    const firstApplied = await postJson(
      `${server.baseUrl}/api/internal/desktop/workspace-change-sets/${first.change_set_id}/apply`,
      { desktop_instance_id: "desktop-code-test", capability_id: "capability-code-test" },
      { authorization: "Bearer desktop-history-secret" },
    );
    assert.equal(firstApplied.status, 200);

    const followUpSession = getSession(session.session_id)!;
    applyConversationWorkspaceOperations({
      session: followUpSession,
      idempotencyKey: "history-second",
      operations: [{
        kind: "replace",
        path: "src/game.js",
        old_text: "game = 1",
        new_text: "game = 2",
      }],
    });
    const second = finalizeConversationCodingTransaction(followUpSession)!;
    const secondApplied = await postJson(
      `${server.baseUrl}/api/internal/desktop/workspace-change-sets/${second.change_set_id}/apply`,
      { desktop_instance_id: "desktop-code-test", capability_id: "capability-code-test" },
      { authorization: "Bearer desktop-history-secret" },
    );
    assert.equal(secondApplied.status, 200);

    const response = await fetch(`${server.baseUrl}/api/sessions/${session.session_id}`);
    const detail = await response.json() as Record<string, any>;
    assert.equal(detail.workspace_change_set.change_set_id, second.change_set_id);
    assert.equal(detail.workspace_change_sets.length, 2);
    assert.equal(detail.workspace_files.length, 2);
    assert.deepEqual(
      detail.workspace_files.map((file: Record<string, unknown>) => file.relative_path),
      ["index.html", "src/game.js"],
    );
    assert.deepEqual(
      detail.workspace_change_sets.flatMap((changeSet: Record<string, any>) =>
        changeSet.changes.map((change: Record<string, unknown>) => change.relative_path),
      ).sort(),
      ["index.html", "src/game.js", "src/game.js"],
    );

    createSessionMessage({ session_id: session.session_id, role: "user", kind: "text", content: { text: "first" } });
    createSessionMessage({ session_id: session.session_id, role: "orchestrator", kind: "text", content: { text: "second" } });

    const summaryResponse = await fetch(`${server.baseUrl}/api/sessions/${session.session_id}?include=summary`);
    const summary = await summaryResponse.json() as Record<string, any>;
    assert.equal(summaryResponse.status, 200);
    assert.deepEqual(summary.messages, []);
    assert.equal(summary.conversation_summary.endpoint, `/api/sessions/${session.session_id}/messages`);
    const messagesResponse = await fetch(`${server.baseUrl}/api/sessions/${session.session_id}/messages?limit=1`);
    const messages = await messagesResponse.json() as Record<string, any>;
    assert.equal(messagesResponse.status, 200);
    assert.equal(messages.items.length, 1);
    assert.equal(messages.truncated, true);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Session workspace action projection redacts credentials while preserving command evidence", async () => {
  const { root, session } = fixture();
  const action = createConversationAction({
    workspaceId: session.workspace_id || "default",
    sessionId: session.session_id,
    toolCallId: "redaction-action",
    toolName: "workspace_run_command",
    arguments: {
      command: "npm",
      args: ["test"],
      authorization: "Bearer private-value",
      nested: { access_token: "private-token" },
    },
    riskLevel: "T1",
    executor: "runtime-worker",
  });
  completeConversationAction({
    action,
    result: { ok: true, stdout: "tests passed", api_key: "private-key" },
  });
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/${session.session_id}`);
    assert.equal(response.status, 200);
    const workspace = await response.json() as Record<string, any>;
    const projected = workspace.conversation_actions.find(
      (candidate: Record<string, unknown>) => candidate.action_id === action.action_id,
    );
    assert.ok(projected);
    assert.equal(projected.arguments.command, "npm");
    assert.equal(projected.arguments.authorization, "[redacted]");
    assert.equal(projected.arguments.nested.access_token, "[redacted]");
    assert.equal(projected.result.stdout, "tests passed");
    assert.equal(projected.result.api_key, "[redacted]");
    assert.doesNotMatch(JSON.stringify(workspace.conversation_actions), /private-(?:value|token|key)/u);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP Conversation tool loop finalizes sandbox edits into one visual Change Set", async () => {
  resetTestRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-conversation-http-code-"));
  fs.writeFileSync(path.join(root, "README.md"), "before\n", "utf8");
  let toolRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (!Array.isArray(body.tools)) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "No standalone file operation is required." }],
        usage: { input_tokens: 10, output_tokens: 6 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    toolRound += 1;
    if (toolRound === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "tool_use",
        content: [{
          type: "tool_use",
          id: "coding_write_1",
          name: "workspace_apply_operations",
          input: {
            idempotency_key: "http-repository-edit",
            operations: [{ kind: "replace", path: "README.md", old_text: "before", new_text: "after" }],
          },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "The repository update is complete and ready for review." }],
      usage: { input_tokens: 30, output_tokens: 12 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    const connection = await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "coding-http-provider",
      name: "Coding HTTP Provider",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://coding.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 32768,
      max_output_tokens: 4096,
      max_tool_rounds: 8,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "coding-secret",
      status: "active",
      metadata: {},
    });
    assert.equal(connection.status, 201);
    const verified = await postJson(`${server.baseUrl}/api/registry/provider-connections/coding-http-provider/test`, {});
    assert.equal(verified.body.verification.status, "verified");
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Repository implementation task",
      provider_connection_id: "coding-http-provider",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    registerWorkspaceBinding({
      workspaceId: "default",
      sessionId,
      desktopInstanceId: "desktop-http-code",
      capabilityId: "capability-http-code",
      rootPath: root,
      access: "sandbox-write",
      scope: "session",
    });
    const response = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Implement the requested repository behavior now.",
      provider_connection_id: "coding-http-provider",
      model: "glm-5.2",
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), "before\n");
    const session = getSession(sessionId)!;
    assert.equal(session.status, "waiting_human");
    assert.equal(typeof session.metadata.latest_workspace_change_set_id, "string");
    assert.equal(getConversationCodingTransaction(sessionId)?.status, "awaiting_review");
    const workspaceResponse = await fetch(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(workspaceResponse.status, 200);
    const workspace = await workspaceResponse.json() as Record<string, any>;
    assert.equal(workspace.latest_run, null);
    assert.equal(workspace.workspace_change_set.change_set_id, session.metadata.latest_workspace_change_set_id);
    assert.equal(workspace.workspace_change_set.status, "pending");
    const receiptMessage = workspace.messages.find((message: Record<string, any>) =>
      message.role === "orchestrator" &&
      message.kind === "text" &&
      message.content?.workspace_change_set_id === workspace.workspace_change_set.change_set_id
    );
    assert.ok(receiptMessage, "the assistant reply should own the Change Set shown as its turn receipt");
    assert.deepEqual(receiptMessage.content.workspace_change_summary.changes, [{
      relative_path: "README.md",
      kind: "modified",
      added_lines: 1,
      deleted_lines: 1,
    }]);
    assert.deepEqual(
      workspace.workspace_change_set.changes.map((change: Record<string, unknown>) => [change.relative_path, change.kind]),
      [["README.md", "modified"]],
    );
    const actionIds = Array.isArray(receiptMessage.content.action_ids)
      ? receiptMessage.content.action_ids.filter((value: unknown): value is string => typeof value === "string")
      : [];
    assert.equal(actionIds.length, 1, "the assistant turn should retain the executed action id");
    assert.ok(Array.isArray(workspace.conversation_actions), "workspace detail should expose persisted conversation actions");
    const action = workspace.conversation_actions.find((candidate: Record<string, unknown>) => candidate.action_id === actionIds[0]);
    assert.ok(action, "the action id on the assistant turn should resolve to a persisted action");
    assert.equal(action.tool_name, "workspace_apply_operations");
    assert.equal(action.status, "succeeded");
    assert.equal(typeof action.started_at, "string");
    assert.equal(typeof action.updated_at, "string");
    assert.equal(action.arguments?.operations?.[0]?.path, "README.md");
    assert.equal(workspace.ui_plan.phase, "decision");
    assert.equal(workspace.ui_plan.primary_action, "open-task-inbox");
    assert.equal(
      workspace.ui_plan.blocks.find((block: Record<string, any>) => block.component === "result_gallery")?.data?.count,
      1,
    );
    assert.match(JSON.stringify(response.body), /visual Change Set|可视化 Change Set/u);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("one-shot multi-file game request uses Workspace tools and Desktop authorization instead of file clarification", async () => {
  resetTestRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-conversation-game-"));
  let toolRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (!Array.isArray(body.tools)) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "No standalone file operation is required." }],
        usage: { input_tokens: 10, output_tokens: 6 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    toolRound += 1;
    if (toolRound === 1) {
      const input = {
        idempotency_key: "one-shot-game-files",
        operations: [
          { kind: "write", path: "index.html", content: "<!doctype html><canvas id=\"game\"></canvas><script type=\"module\" src=\"game.js\"></script>\n" },
          { kind: "write", path: "styles.css", content: "canvas { display: block; }\n" },
          { kind: "write", path: "game.js", content: "const canvas = document.querySelector('#game');\ncanvas.width = 800;\n" },
          { kind: "write", path: "README.md", content: "# Chrono Salvager\n\nOpen index.html to play.\n" },
        ],
      };
      return new Response([
        'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":120}}}\n\n',
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "game_workspace_write_1", name: "workspace_apply_operations", input } })}\n\n`,
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":80}}\n\n',
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":180}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Chrono Salvager is implemented and verified in the Workspace Change Set."}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":40}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "one-shot-game-provider",
      name: "One-shot Game Provider",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://game.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524288,
      max_output_tokens: 65536,
      max_tool_rounds: 8,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "game-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/one-shot-game-provider/test`, {});
    const prompt = "请在当前 Workspace 从零开发一个完整游戏，合理拆分 index.html、styles.css、多个 JavaScript 模块和 README.md，完成前列出实际创建/修改的文件。";
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: prompt,
      provider_connection_id: "one-shot-game-provider",
      model: "glm-5.2",
      defer_conversation_reply: true,
      autonomy_mode: "assisted",
    });
    const sessionId = String(created.body.session.session_id);
    registerWorkspaceBinding({
      workspaceId: "default",
      sessionId,
      desktopInstanceId: "desktop-one-shot-game",
      capabilityId: "capability-one-shot-game",
      rootPath: root,
      access: "snapshot-read",
      scope: "session",
    });
    let authorizationRequests = 0;
    const result = await server.app.locals.streamConversationTurn({
      sessionId,
      resumeLatestUser: true,
      providerConnectionId: "one-shot-game-provider",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: async (request: Record<string, unknown>) => {
        assert.equal(request.type, "workspace.authorize");
        authorizationRequests += 1;
        registerWorkspaceBinding({
          workspaceId: "default",
          sessionId,
          desktopInstanceId: "desktop-one-shot-game",
          capabilityId: "capability-one-shot-game",
          rootPath: root,
          access: "sandbox-write",
          scope: "session",
        });
      },
    });
    assert.equal(authorizationRequests, 1);
    assert.equal(fs.existsSync(path.join(root, "index.html")), false);
    assert.doesNotMatch(String(result.assistantMessage.content.text), /Select an explicit source file|\u9009\u62e9.*\u6587\u4ef6/iu);
    assert.match(String(result.assistantMessage.content.text), /Chrono Salvager/u);
    const transaction = getConversationCodingTransaction(sessionId);
    assert.equal(transaction?.status, "awaiting_review");
    assert.equal((conversationWorkspaceStatus(getSession(sessionId)!).changes as unknown[]).length, 4);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
