import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeExternalConflict,
  createMemoryExternalSource,
  ingestExternalMemoryBatch,
} from "../src/memory-external-sync.js";
import {
  createMemoryCollection,
  createMemoryShare,
  listMemoryConflicts,
  listSharedMemoryViews,
  resolveMemoryConflict,
  suggestSharedMemoryChange,
} from "../src/memory-sharing-store.js";
import { createMemoryOverlay } from "../src/memory-activation-store.js";
import { ensureCoreMemorySnapshot } from "../src/memory-snapshot-store.js";
import { createMemory, getMemory, listAllMemories, updateMemory } from "../src/memory-store.js";
import { runWithSystemWorkspaceContext } from "../src/request-security.js";
import { createSession } from "../src/session-store.js";
import { createSessionMessage } from "../src/session-message-store.js";
import { ensureWorkspace } from "../src/workspace-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

function workspace<T>(workspaceId: string, callback: () => T): T {
  return runWithSystemWorkspaceContext(workspaceId, callback);
}

function seedWorkspaces(): void {
  ensureWorkspace({ workspaceId: "alpha", name: "Alpha", createdBy: "test" });
  ensureWorkspace({ workspaceId: "beta", name: "Beta", createdBy: "test" });
}

test("M11 projects controlled Team Memory into target snapshots and routes suggestions to source conflicts", () => {
  resetTestRoot();
  seedWorkspaces();
  const setup = workspace("alpha", () => {
    const collection = createMemoryCollection({ name: "Release Team", kind: "team", member_workspace_ids: ["beta"] });
    const memory = createMemory({ content: "Orion release reviews require rollback and verification evidence.", tags: ["orion", "release"] });
    const share = createMemoryShare({
      collection_id: collection.collection_id,
      memory_id: memory.memory_id,
      target_workspace_ids: ["beta"],
      mode: "suggest_changes",
      version_policy: "pinned",
    });
    return { collection, memory, share };
  });

  const conflict = workspace("beta", () => {
    const views = listSharedMemoryViews();
    assert.equal(views.length, 1);
    assert.equal(views[0]?.collection.kind, "team");
    assert.match(views[0]?.projected_memory.content || "", /rollback/);
    const session = createSession({ title: "Orion release review", created_by: "beta-user" });
    createSessionMessage({ session_id: session.session_id, role: "user", kind: "text", content: { text: "Prepare Orion release evidence." } });
    const snapshot = ensureCoreMemorySnapshot(session);
    const projected = views[0]!.projected_memory;
    assert.ok(snapshot.entries.some((entry) => entry.memory_id === projected.memory_id));
    assert.equal(createMemoryOverlay({ session, memoryId: projected.memory_id, mode: "next_turn" }).entry.content, projected.content);
    return suggestSharedMemoryChange(setup.share.share_id, "Orion release reviews require rollback, verification, and owner evidence.");
  });

  workspace("alpha", () => {
    assert.equal(listMemoryConflicts()[0]?.conflict_id, conflict.conflict_id);
    const resolved = resolveMemoryConflict(conflict.conflict_id, { resolution: "accept_proposed" });
    assert.match(resolved?.memory.content || "", /owner evidence/);
    assert.equal(resolved?.conflict.status, "resolved");
  });
  workspace("beta", () => {
    const pinned = listSharedMemoryViews()[0]!;
    assert.equal(pinned.freshness, "stale");
    assert.doesNotMatch(pinned.projected_memory.content, /owner evidence/);
  });
});

test("M11 rejects cross-Workspace sharing of Private Memory", () => {
  resetTestRoot();
  seedWorkspaces();
  workspace("alpha", () => {
    const collection = createMemoryCollection({ name: "Private Team", kind: "organization", member_workspace_ids: ["beta"] });
    const memory = createMemory({ scope_kind: "user", scope_id: "alpha-user", content: "Private organization note.", sensitivity: "private" });
    assert.throws(() => createMemoryShare({
      collection_id: collection.collection_id,
      memory_id: memory.memory_id,
      target_workspace_ids: ["beta"],
    }), /cannot be shared/);
  });
});

test("M11 external sync creates canonical Memory and stops on local-edit conflicts", () => {
  resetTestRoot();
  ensureWorkspace({ workspaceId: "beta", name: "Beta", createdBy: "test" });
  const collection = createMemoryCollection({ name: "Synced Organization", kind: "organization", member_workspace_ids: ["beta"] });
  const source = createMemoryExternalSource({ name: "Notion push", provider: "push", collection_id: collection.collection_id });
  const first = ingestExternalMemoryBatch({
    sourceId: source.source_id,
    cursor: "cursor-1",
    items: [{ external_id: "page-1", external_version: "1", content: "External release policy v1.", kind: "convention", tags: ["release"] }],
  });
  assert.equal(first.created, 1);
  const imported = listAllMemories({ status: "active" })
    .find((item) => item.source.provider_id === source.source_id)!;
  workspace("beta", () => assert.equal(listSharedMemoryViews()[0]?.projected_memory.content, "External release policy v1."));
  assert.ok(imported);
  updateMemory(imported.memory_id, { content: "Locally edited release policy." });
  const second = ingestExternalMemoryBatch({
    sourceId: source.source_id,
    cursor: "cursor-2",
    items: [{ external_id: "page-1", external_version: "2", content: "External release policy v2.", kind: "convention", tags: ["release"] }],
  });
  assert.equal(second.conflicts, 1);
  assert.equal(getMemory(imported.memory_id)?.content, "Locally edited release policy.");
  const conflict = listMemoryConflicts()[0]!;
  const resolved = resolveMemoryConflict(conflict.conflict_id, { resolution: "accept_proposed" })!;
  acknowledgeExternalConflict(resolved.conflict, resolved.memory);
  assert.equal(getMemory(imported.memory_id)?.content, "External release policy v2.");
  const replay = ingestExternalMemoryBatch({
    sourceId: source.source_id,
    items: [{ external_id: "page-1", external_version: "2", content: "External release policy v2.", kind: "convention" }],
  });
  assert.equal(replay.skipped, 1);
  updateMemory(imported.memory_id, { content: "Locally protected before external deletion." });
  const deletion = ingestExternalMemoryBatch({
    sourceId: source.source_id,
    items: [{ external_id: "page-1", external_version: "3", deleted: true }],
  });
  assert.equal(deletion.conflicts, 1);
  const deleteConflict = listMemoryConflicts().find((item) => item.status === "pending" && item.proposed_deleted)!;
  const deleteResolution = resolveMemoryConflict(deleteConflict.conflict_id, { resolution: "accept_proposed" })!;
  acknowledgeExternalConflict(deleteResolution.conflict, deleteResolution.memory);
  assert.equal(getMemory(imported.memory_id)?.status, "deleted");
});

test("M11 APIs expose collection, share, conflict, and external source surfaces", async () => {
  resetTestRoot();
  ensureWorkspace({ workspaceId: "beta", name: "Beta", createdBy: "test" });
  const memory = createMemory({ content: "M11 API shared release policy." });
  const server = await startTestServer();
  try {
    const collection = await postJson(`${server.baseUrl}/api/memory-collections`, { name: "API Team", kind: "team", member_workspace_ids: ["beta"] });
    assert.equal(collection.status, 201);
    const share = await postJson(`${server.baseUrl}/api/memory-shares`, {
      collection_id: collection.body.collection_id,
      memory_id: memory.memory_id,
      target_workspace_ids: ["beta"],
      mode: "read_only",
    });
    assert.equal(share.status, 201);
    const sources = await postJson(`${server.baseUrl}/api/memory-external-sources`, { name: "Push API", provider: "push" });
    assert.equal(sources.status, 201);
    const ingested = await postJson(`${server.baseUrl}/api/memory-external-sources/${sources.body.source_id}/ingest`, {
      items: [{ external_id: "api-1", external_version: "1", content: "External API memory." }],
    });
    assert.equal(ingested.status, 200);
    assert.equal((await getJson(`${server.baseUrl}/api/memory-collections`)).status, 200);
    assert.equal((await getJson(`${server.baseUrl}/api/memory-shares`)).status, 200);
    assert.equal((await getJson(`${server.baseUrl}/api/memory-conflicts`)).status, 200);
    assert.equal((await getJson(`${server.baseUrl}/api/memory-external-sources`)).status, 200);
  } finally {
    await server.close();
  }
});
