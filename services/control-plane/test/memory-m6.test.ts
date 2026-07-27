import assert from "node:assert/strict";
import test from "node:test";
import { runBackgroundMemoryReview } from "../src/memory-background-review.js";
import { runMemoryMaintenance } from "../src/memory-lifecycle.js";
import { extendCoreMemorySnapshotForProject, getCoreMemorySnapshot } from "../src/memory-snapshot-store.js";
import { createMemory, getMemory, listMemories, listMemoryCandidates, restoreMemory } from "../src/memory-store.js";
import { exportMemories, importMemories } from "../src/memory-transfer.js";
import { createSessionMessage } from "../src/session-message-store.js";
import { createSession, saveSession } from "../src/session-store.js";
import { updateMemorySettings } from "../src/memory-settings-store.js";
import { resetTestRoot } from "./helpers.js";

test("M6 background review is idempotent and follows assisted/autopilot policy", async () => {
  resetTestRoot();
  const session = createSession({ title: "M6 review", created_by: "memory-owner" });
  session.metadata = { ...session.metadata, autonomy_mode: "assisted" };
  saveSession(session);
  createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "我偏好所有长期工程报告都使用简洁、可验证并且带证据引用的中文表达。" },
  });

  const first = await runBackgroundMemoryReview(session.session_id);
  const repeated = await runBackgroundMemoryReview(session.session_id);
  assert.equal(first.status, "completed");
  assert.equal(first.candidate_ids.length, 1);
  assert.equal(first.committed_memory_ids.length, 0);
  assert.equal(repeated.message_digest, first.message_digest);
  assert.deepEqual(repeated.candidate_ids, first.candidate_ids);
  assert.equal(listMemoryCandidates("pending").length, 1);

  session.metadata = { ...session.metadata, autonomy_mode: "autopilot" };
  const binding = session.metadata.agent_binding_snapshot as Record<string, unknown>;
  session.metadata.agent_binding_snapshot = {
    ...binding,
    memory_policy: { enabled: true, automatic_recall: true, write_mode: "automatic" },
  };
  saveSession(session);
  createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "以后请始终把最终结果写成可以直接执行的短句，并且保留必要的验证证据。" },
  });
  const autopilot = await runBackgroundMemoryReview(session.session_id);
  assert.equal(autopilot.committed_memory_ids.length, 1);
  assert.equal(getMemory(autopilot.committed_memory_ids[0]!)?.source.origin, "background_review");
});

test("M6 event-driven review extracts checkpoint summaries once per trigger", async () => {
  resetTestRoot();
  const session = createSession({ title: "M6 event review", created_by: "memory-owner" });
  const sourceText = "以后请始终在长任务检查点保留验证证据，并使用简洁的中文总结。";
  const first = await runBackgroundMemoryReview(session.session_id, {
    trigger: "checkpoint",
    triggerId: "checkpoint-7:v3",
    sourceText,
    sourceMessageId: "checkpoint-7",
  });
  const repeated = await runBackgroundMemoryReview(session.session_id, {
    trigger: "checkpoint",
    triggerId: "checkpoint-7:v3",
    sourceText,
    sourceMessageId: "checkpoint-7",
  });
  assert.equal(first.trigger, "checkpoint");
  assert.equal(first.trigger_id, "checkpoint-7:v3");
  assert.equal(first.candidate_ids.length, 1);
  assert.equal(repeated.message_digest, first.message_digest);
  assert.deepEqual(repeated.candidate_ids, first.candidate_ids);
  assert.equal(listMemoryCandidates("pending").length, 1);
});

test("M6 Project memory extends but does not mutate the frozen base snapshot", () => {
  resetTestRoot();
  updateMemorySettings({ scope_policy: { agent_memory_enabled: true } });
  const base = createMemory({ content: "Workspace reports use stable headings.", kind: "convention" });
  const agent = createMemory({
    scope_kind: "agent",
    scope_id: "default-agent",
    content: "The default agent summarizes validation evidence before completion.",
    kind: "convention",
  });
  const session = createSession({ title: "Project snapshot", created_by: "snapshot-owner" });
  const initial = getCoreMemorySnapshot(session.session_id);
  assert.ok(initial);
  const project = createMemory({
    scope_kind: "project",
    scope_id: "project-alpha",
    kind: "decision",
    content: "Project Alpha uses Docker for high-risk writes.",
  });
  const extended = extendCoreMemorySnapshotForProject(session.session_id, "project-alpha");
  assert.ok(extended);
  assert.equal(extended.project_binding?.project_id, "project-alpha");
  assert.deepEqual(extended.entries.map((entry) => entry.memory_id), initial.entries.map((entry) => entry.memory_id));
  assert.ok(extended.entries.some((entry) => entry.memory_id === base.memory_id));
  assert.ok(extended.entries.some((entry) => entry.memory_id === agent.memory_id));
  assert.ok(extended.project_entries.some((entry) => entry.memory_id === project.memory_id));
  assert.notEqual(extended.digest, initial.digest);
});

test("M6 import ignores foreign ids and supports dry-run, export, expiration, and restore", () => {
  resetTestRoot();
  const payload = {
    schema_version: 1,
    memories: [{
      memory_id: "foreign-memory-id",
      scope_kind: "workspace",
      scope_id: "foreign-workspace",
      kind: "fact",
      content: "Imported durable fact.",
      confidence: 0.9,
      importance: 0.6,
      sensitivity: "normal",
      tags: ["import-test"],
    }],
  };
  const dryRun = importMemories(payload, { dryRun: true, strategy: "skip" });
  assert.equal(dryRun.created, 1);
  assert.equal(listMemories({ status: "all" }).length, 0);

  const imported = importMemories(payload, { strategy: "skip" });
  assert.equal(imported.created, 1);
  assert.notEqual(imported.memory_ids[0], "foreign-memory-id");
  assert.equal(getMemory(imported.memory_ids[0]!)?.source.note, "Imported from foreign-memory-id");
  assert.equal(importMemories(payload, { strategy: "skip" }).skipped, 1);
  assert.equal(exportMemories("all").count, 1);

  const expiring = createMemory({
    content: "Temporary fact that has expired.",
    expires_at: "2020-01-01T00:00:00.000Z",
  });
  const maintenance = runMemoryMaintenance();
  assert.equal(maintenance.expired_memories, 1);
  assert.equal(getMemory(expiring.memory_id)?.status, "expired");
  const restored = restoreMemory(expiring.memory_id);
  assert.equal(restored?.status, "active");
  assert.equal(restored?.expires_at, null);
});
