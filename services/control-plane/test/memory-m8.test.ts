import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MEMORIES_DIR,
  MEMORY_CANDIDATES_DIR,
  MEMORY_RETRIEVAL_INDEX_DIR,
  MEMORY_SNAPSHOTS_DIR,
  SUPERVISION_ALERTS_DIR,
} from "../src/config.js";
import { searchMemoryRetrieval } from "../src/memory-retrieval-index.js";
import { buildAutomaticMemoryRecall } from "../src/memory-auto-recall.js";
import { getMemoryObservability } from "../src/memory-observability.js";
import { updateMemorySettings } from "../src/memory-settings-store.js";
import { runMemoryMaintenanceSweep } from "../src/memory-lifecycle.js";
import {
  isRecommendationNewerThanSnapshot,
  listSessionMemoryRecommendations,
} from "../src/memory-recommendation.js";
import { ensureCoreMemorySnapshot, getCoreMemorySnapshot } from "../src/memory-snapshot-store.js";
import {
  createMemory,
  createMemoryCandidate,
  getMemory,
  listMemoryCandidates,
  migratePrivateMemoryRecordsAtRest,
} from "../src/memory-store.js";
import { createSession } from "../src/session-store.js";
import { createSessionMessage, listSessionMessages } from "../src/session-message-store.js";
import { runProactiveSupervisionScan } from "../src/proactive-supervisor.js";
import { listSupervisionAlerts } from "../src/supervision-store.js";
import { runWithSystemWorkspaceContext } from "../src/request-security.js";
import { getJson, resetTestRoot, startTestServer } from "./helpers.js";

test("M8 encrypts private canonical memory, candidates, and snapshots at rest", async () => {
  resetTestRoot();
  const previousKey = process.env.MY_MATE_MEMORY_SECRET_KEY;
  process.env.MY_MATE_MEMORY_SECRET_KEY = "m8-memory-encryption-test-key";
  try {
    const content = "Private preference: use the internal Atlas release codename.";
    const memory = createMemory({
      scope_kind: "user",
      scope_id: "m8-owner",
      kind: "preference",
      content,
      sensitivity: "private",
      tags: ["atlas-private"],
    });
    const memoryFile = path.join(MEMORIES_DIR, "default", `${encodeURIComponent(memory.memory_id)}.json`);
    const persistedMemory = fs.readFileSync(memoryFile, "utf8");
    assert.doesNotMatch(persistedMemory, /Atlas release codename|atlas-private/);
    assert.match(persistedMemory, /aes-256-gcm|ciphertext/);
    assert.equal(getMemory(memory.memory_id)?.content, content);

    const candidate = createMemoryCandidate({
      operation: "create",
      proposed_memory: {
        scope_kind: "user",
        scope_id: "m8-owner",
        kind: "fact",
        content: "Private candidate for the Borealis customer account.",
        sensitivity: "private",
        tags: ["borealis-private"],
      },
      rationale: "The Borealis account detail may help later.",
    });
    const candidateFile = path.join(MEMORY_CANDIDATES_DIR, "default", `${encodeURIComponent(candidate.candidate_id)}.json`);
    const persistedCandidate = fs.readFileSync(candidateFile, "utf8");
    assert.doesNotMatch(persistedCandidate, /Borealis customer|Borealis account|borealis-private/);
    assert.equal(listMemoryCandidates("pending")[0]?.proposed_memory?.content, "Private candidate for the Borealis customer account.");

    const session = createSession({ title: "M8 private snapshot", created_by: "m8-owner" });
    const snapshot = ensureCoreMemorySnapshot(session);
    assert.ok(snapshot.entries.some((entry) => entry.memory_id === memory.memory_id));
    const snapshotFile = path.join(MEMORY_SNAPSHOTS_DIR, "default", `${encodeURIComponent(session.session_id)}.json`);
    const persistedSnapshot = fs.readFileSync(snapshotFile, "utf8");
    assert.doesNotMatch(persistedSnapshot, /Atlas release codename|atlas-private/);
    assert.equal(getCoreMemorySnapshot(session.session_id)?.entries.find((entry) => entry.memory_id === memory.memory_id)?.content, content);

    const result = await searchMemoryRetrieval({ query: "Atlas release codename", principalId: "m8-owner" });
    assert.equal(result.hits[0]?.memory.memory_id, memory.memory_id);
    const journal = fs.readFileSync(path.join(MEMORY_RETRIEVAL_INDEX_DIR, "journal.jsonl"), "utf8");
    assert.doesNotMatch(journal, /Atlas release codename|atlas-private/);
  } finally {
    if (previousKey === undefined) delete process.env.MY_MATE_MEMORY_SECRET_KEY;
    else process.env.MY_MATE_MEMORY_SECRET_KEY = previousKey;
  }
});

test("M8 maintenance sweep processes every discovered Workspace independently", () => {
  resetTestRoot();
  for (const workspaceId of ["alpha", "beta"]) {
    runWithSystemWorkspaceContext(workspaceId, () => {
      createMemory({
        scope_kind: "workspace",
        scope_id: workspaceId,
        content: `${workspaceId} expired memory`,
        expires_at: "2020-01-01T00:00:00.000Z",
      });
    });
  }
  const sweep = runMemoryMaintenanceSweep({ dueOnly: false });
  assert.ok(sweep.workspace_count >= 3);
  assert.ok(sweep.results.some((result) => result.workspace_id === "alpha" && result.expired_memories === 1));
  assert.ok(sweep.results.some((result) => result.workspace_id === "beta" && result.expired_memories === 1));
  assert.equal(sweep.failed_workspaces.length, 0);
});

test("M8 automatic recall cache records hits and invalidates on canonical writes", async () => {
  resetTestRoot();
  updateMemorySettings({ automatic_recall: { cache_ttl_seconds: 60 } });
  createMemory({ content: "Orion release reports include a verification table." });
  const session = createSession({ title: "M8 recall cache", created_by: "m8-owner" });
  createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "What do we remember about Orion release reports?" },
  });
  const messages = listSessionMessages(session.session_id);
  const first = await buildAutomaticMemoryRecall(session, messages);
  const second = await buildAutomaticMemoryRecall(session, messages);
  assert.match(first || "", /verification table/);
  assert.equal(second, first);
  let metrics = getMemoryObservability();
  assert.equal(metrics.automatic_recall_cache_misses, 1);
  assert.equal(metrics.automatic_recall_cache_hits, 1);

  createMemory({ content: "Orion release reports also include rollback evidence." });
  const third = await buildAutomaticMemoryRecall(session, messages);
  assert.match(third || "", /rollback evidence/);
  metrics = getMemoryObservability();
  assert.equal(metrics.automatic_recall_cache_misses, 2);
  assert.equal(metrics.automatic_recall_cache_hits, 1);
  assert.ok(metrics.automatic_recall_total_latency_ms >= metrics.automatic_recall_last_latency_ms!);
});

test("M8 migrates legacy private records without changing canonical content", () => {
  resetTestRoot();
  const previousKey = process.env.MY_MATE_MEMORY_SECRET_KEY;
  process.env.MY_MATE_MEMORY_SECRET_KEY = "m8-memory-migration-test-key";
  try {
    const workspaceDir = path.join(MEMORIES_DIR, "default");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const file = path.join(workspaceDir, "legacy-private.json");
    fs.writeFileSync(file, JSON.stringify({
      schema_version: 1,
      memory_id: "legacy-private",
      workspace_id: "default",
      scope_kind: "user",
      scope_id: "m8-owner",
      kind: "fact",
      content: "Legacy private plaintext.",
      confidence: 1,
      importance: 0.5,
      sensitivity: "private",
      tags: ["legacy-private-tag"],
      source: { origin: "system", session_id: null, message_ids: [], action_id: null, provider_id: null, note: null },
      status: "active",
      valid_from: null,
      valid_until: null,
      expires_at: null,
      supersedes_memory_id: null,
      version: 1,
      created_by: "system",
      created_at: "2026-07-16T00:00:00.000Z",
      updated_by: "system",
      updated_at: "2026-07-16T00:00:00.000Z",
    }), "utf8");
    const migrated = migratePrivateMemoryRecordsAtRest("default");
    assert.equal(migrated.memories, 1);
    assert.equal(getMemory("legacy-private")?.content, "Legacy private plaintext.");
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /Legacy private plaintext|legacy-private-tag/);
  } finally {
    if (previousKey === undefined) delete process.env.MY_MATE_MEMORY_SECRET_KEY;
    else process.env.MY_MATE_MEMORY_SECRET_KEY = previousKey;
  }
});

test("M8 recommends relevant Memory and explains frozen snapshot freshness", () => {
  resetTestRoot();
  const session = createSession({
    title: "Atlas release checklist",
    initial_message: "Prepare the Atlas release checklist.",
    created_by: "m8-owner",
  });
  createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "What validation evidence belongs in the Atlas release checklist?" },
  });
  const relevant = createMemory({
    scope_kind: "user",
    scope_id: "m8-owner",
    content: "Atlas release checklists include validation evidence and rollback proof.",
    tags: ["atlas", "release"],
  });
  createMemory({ content: "Office lunch orders close at eleven." });

  const recommendations = listSessionMemoryRecommendations(session);
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0]?.memory_id, relevant.memory_id);
  assert.equal(recommendations[0]?.already_in_snapshot, false);
  assert.equal(recommendations[0]?.applied_automatically, false);
  assert.match(recommendations[0]?.reason || "", /frozen Core Memory snapshot/);
  assert.equal(isRecommendationNewerThanSnapshot(
    recommendations[0]!,
    getCoreMemorySnapshot(session.session_id)?.created_at || null,
  ), true);
});

test("M8 exposes Session Memory recommendations through the API", async () => {
  resetTestRoot();
  const session = createSession({
    title: "Borealis handoff",
    initial_message: "Create a Borealis handoff report.",
    created_by: "dev-user",
  });
  createMemory({ content: "Borealis handoff reports include owner and verification status." });
  const server = await startTestServer();
  try {
    const response = await getJson(`${server.baseUrl}/api/sessions/${session.session_id}/memory-recommendations`);
    assert.equal(response.status, 200);
    assert.equal(response.body.session_id, session.session_id);
    assert.equal(response.body.count, 1);
    assert.match(response.body.recommendations[0].summary, /verification status/);
  } finally {
    await server.close();
  }
});

test("M8 proactive recommendation alerts never persist Private Memory plaintext", () => {
  resetTestRoot();
  const session = createSession({
    title: "Nebula customer plan",
    initial_message: "Prepare the Nebula customer plan.",
    created_by: "m8-owner",
  });
  const secretContent = "Nebula customer private renewal concession is seven percent.";
  createMemory({
    scope_kind: "user",
    scope_id: "m8-owner",
    content: secretContent,
    sensitivity: "private",
    tags: ["nebula-private"],
  });

  runProactiveSupervisionScan();
  const alert = listSupervisionAlerts({ sessionId: session.session_id })
    .find((item) => item.category === "memory_recommendation");
  assert.ok(alert);
  assert.doesNotMatch(JSON.stringify(alert), /renewal concession|seven percent|nebula-private/i);
  const persisted = fs.readdirSync(SUPERVISION_ALERTS_DIR)
    .map((name) => fs.readFileSync(path.join(SUPERVISION_ALERTS_DIR, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(persisted, /renewal concession|seven percent|nebula-private/i);
});
