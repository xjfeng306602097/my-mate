import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ensureCoreMemorySnapshot, getCoreMemorySnapshot } from "../src/memory-snapshot-store.js";
import { createMemory } from "../src/memory-store.js";
import { createSessionMessage } from "../src/session-message-store.js";
import {
  recallSessions,
  sessionRecallPathsForTests,
} from "../src/session-recall-store.js";
import { createSession } from "../src/session-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

test("Core Memory snapshot is visibility-filtered and frozen for the Session", () => {
  resetTestRoot();
  const workspaceMemory = createMemory({
    content: "Generated reports use a concise executive summary.",
    kind: "convention",
    importance: 0.9,
  });
  const privateMemory = createMemory({
    content: "The snapshot owner prefers Chinese output.",
    kind: "preference",
    scope_kind: "user",
    scope_id: "snapshot-owner",
    sensitivity: "private",
  });
  createMemory({
    content: "Another user prefers verbose output.",
    kind: "preference",
    scope_kind: "user",
    scope_id: "someone-else",
    sensitivity: "private",
  });
  createMemory({
    content: "Restricted operational reference.",
    kind: "fact",
    sensitivity: "restricted",
  });

  const session = createSession({ title: "Frozen memory", created_by: "snapshot-owner" });
  const initial = getCoreMemorySnapshot(session.session_id);
  assert.ok(initial);
  assert.deepEqual(
    new Set(initial.entries.map((entry) => entry.memory_id)),
    new Set([workspaceMemory.memory_id, privateMemory.memory_id]),
  );

  const laterMemory = createMemory({
    content: "This was learned after the Session started.",
    kind: "fact",
    importance: 1,
  });
  const frozen = ensureCoreMemorySnapshot(session);
  assert.equal(frozen.snapshot_id, initial.snapshot_id);
  assert.equal(frozen.digest, initial.digest);
  assert.equal(frozen.entries.some((entry) => entry.memory_id === laterMemory.memory_id), false);
});

test("Session Recall rebuilds legacy history, anchors context, excludes current Session, and recovers corruption", () => {
  resetTestRoot();
  const historical = createSession({ title: "\u53d1\u5e03\u590d\u76d8", created_by: "recall-owner" });
  createSessionMessage({
    session_id: historical.session_id,
    role: "user",
    kind: "text",
    content: { text: "\u5148\u786e\u8ba4\u53d1\u5e03\u8303\u56f4\u548c\u9a8c\u6536\u6807\u51c6\u3002" },
  });
  const matched = createSessionMessage({
    session_id: historical.session_id,
    role: "orchestrator",
    kind: "text",
    content: { text: "\u6700\u7ec8\u53d1\u5e03\u6e05\u5355\u5305\u542b\u684c\u9762\u7aef\u5b89\u88c5\u5305\u3001\u6821\u9a8c\u548c\u4e0e\u56de\u6eda\u8bf4\u660e\u3002 api_key=secret-value-123456" },
  });
  createSessionMessage({
    session_id: historical.session_id,
    role: "user",
    kind: "text",
    content: { text: "\u6309\u8fd9\u4e2a\u6e05\u5355\u6267\u884c\u3002" },
  });
  const current = createSession({ title: "Current", created_by: "recall-owner" });
  createSessionMessage({
    session_id: current.session_id,
    role: "user",
    kind: "text",
    content: { text: "\u5f53\u524d Session \u4e5f\u63d0\u5230\u4e86\u53d1\u5e03\u6e05\u5355\uff0c\u4f46\u4e0d\u5e94\u53ec\u56de\u81ea\u5df1\u3002" },
  });

  const paths = sessionRecallPathsForTests();
  fs.rmSync(paths.journal, { force: true });
  fs.rmSync(paths.database, { force: true });
  const first = recallSessions({
    query: "\u53d1\u5e03\u6e05\u5355",
    currentSessionId: current.session_id,
    limit: 5,
    contextRadius: 1,
  });
  assert.equal(first.index_rebuilt, true);
  assert.equal(first.count, 1);
  assert.equal(first.hits[0]?.session_id, historical.session_id);
  assert.equal(first.hits[0]?.matched_message_id, matched.message_id);
  assert.equal(first.hits[0]?.context.length, 3);
  assert.match(first.hits[0]?.context.find((message) => message.matched)?.text || "", /\[REDACTED\]/u);
  assert.equal(first.hits.some((hit) => hit.session_id === current.session_id), false);

  fs.writeFileSync(paths.database, "not a sqlite database", "utf-8");
  const recovered = recallSessions({
    query: "\u53d1\u5e03\u6e05\u5355",
    currentSessionId: current.session_id,
  });
  assert.equal(recovered.index_rebuilt, true);
  assert.equal(recovered.hits[0]?.session_id, historical.session_id);
});

test("Memory snapshot and Session Recall APIs expose the M3 contracts", async () => {
  resetTestRoot();
  createMemory({ content: "API snapshots retain this workspace convention.", kind: "convention" });
  const historical = createSession({ title: "API history", created_by: "api-owner" });
  createSessionMessage({
    session_id: historical.session_id,
    role: "user",
    kind: "text",
    content: { text: "The API release checklist includes rollback evidence." },
  });
  const current = createSession({ title: "API current", created_by: "api-owner" });
  const server = await startTestServer();
  try {
    const snapshot = await getJson(
      `${server.baseUrl}/api/sessions/${current.session_id}/memory-snapshot`,
    );
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.session_id, current.session_id);
    assert.equal(snapshot.body.entries.length, 1);

    const recall = await postJson(`${server.baseUrl}/api/session-recall/search`, {
      query: "release checklist",
      current_session_id: current.session_id,
      limit: 3,
      context_radius: 1,
    });
    assert.equal(recall.status, 200);
    assert.equal(recall.body.count, 1);
    assert.equal(recall.body.hits[0].session_id, historical.session_id);
  } finally {
    await server.close();
  }
});
