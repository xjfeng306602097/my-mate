import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MEMORIES_DIR,
  MEMORY_FEEDBACK_DIR,
  MEMORY_OVERLAYS_DIR,
  MEMORY_RETRIEVAL_INDEX_DIR,
  MEMORY_SNAPSHOTS_DIR,
  MEMORY_TURN_CONTEXTS_DIR,
} from "../src/config.js";
import {
  createMemoryOverlay,
  createRecommendationFeedback,
  freezeTurnMemoryContext,
} from "../src/memory-activation-store.js";
import {
  createEncryptedMemoryBackup,
  getMemoryOperationsStatus,
  hardPurgeMemory,
  restoreEncryptedMemoryBackup,
  rotateMemoryEncryptionKey,
  runMemoryRetention,
  scanMemoryIntegrity,
} from "../src/memory-operations.js";
import { ensureCoreMemorySnapshot } from "../src/memory-snapshot-store.js";
import { createMemory, deleteMemory, getMemory, listAllMemories } from "../src/memory-store.js";
import { createSession } from "../src/session-store.js";
import { createSessionMessage } from "../src/session-message-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

const PASSPHRASE = "M10 test backup passphrase";

function rawTree(root: string): string {
  if (!fs.existsSync(root)) return "";
  return fs.readdirSync(root, { withFileTypes: true }).map((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? rawTree(target) : fs.readFileSync(target, "utf8");
  }).join("\n");
}

test("M10 rotates workspace data keys and re-encrypts every Private Memory surface", () => {
  resetTestRoot();
  process.env.MY_MATE_MEMORY_SECRET_KEY = "m10-root-key";
  const content = "Private M10 Polaris launch convention.";
  const memory = createMemory({ scope_kind: "user", scope_id: "m10-owner", content, sensitivity: "private" });
  const session = createSession({ title: "Polaris launch", created_by: "m10-owner" });
  const message = createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "Prepare Polaris launch evidence." },
  });
  ensureCoreMemorySnapshot(session);
  createMemoryOverlay({ session, memoryId: memory.memory_id, mode: "session" });
  freezeTurnMemoryContext({
    session,
    sourceUserMessageId: message.message_id,
    providerConnectionId: "m10-provider",
    model: "m10-model",
    coreEntries: [],
    automaticEntries: [],
    prompt: "M10 prompt",
  });
  const before = getMemoryOperationsStatus().key.active_key_id;
  const result = rotateMemoryEncryptionKey();
  assert.notEqual(result.key.active_key_id, before);
  assert.ok(result.rewritten_records >= 3);
  assert.equal(result.key.retained_key_count, 1);
  assert.equal(getMemory(memory.memory_id)?.content, content);
  const persisted = [MEMORIES_DIR, MEMORY_SNAPSHOTS_DIR, MEMORY_OVERLAYS_DIR, MEMORY_TURN_CONTEXTS_DIR]
    .map(rawTree).join("\n");
  assert.doesNotMatch(persisted, /Private M10 Polaris/);
  assert.match(persisted, /"key_id": "memkey_/);
});

test("M10 hard purge removes derived copies and cryptographically erases Private Memory", () => {
  resetTestRoot();
  process.env.MY_MATE_MEMORY_SECRET_KEY = "m10-purge-root-key";
  const memory = createMemory({
    scope_kind: "user",
    scope_id: "m10-owner",
    content: "Private M10 Vega customer constraint.",
    sensitivity: "private",
  });
  const session = createSession({ title: "Vega", created_by: "m10-owner" });
  const message = createSessionMessage({ session_id: session.session_id, role: "user", kind: "text", content: { text: "Use Vega constraint." } });
  const overlay = createMemoryOverlay({ session, memoryId: memory.memory_id, mode: "session" });
  freezeTurnMemoryContext({ session, sourceUserMessageId: message.message_id, providerConnectionId: null, model: null, coreEntries: [], automaticEntries: [], prompt: "Vega" });
  createRecommendationFeedback({
    session,
    recommendationId: "memrec_m10",
    memoryId: memory.memory_id,
    memoryVersion: memory.version,
    action: "keep_for_session",
  });
  const result = hardPurgeMemory(memory.memory_id);
  assert.equal(result.cryptographic_erasure, true);
  assert.equal(getMemory(memory.memory_id), null);
  assert.ok(result.removed_by_type.overlay >= 1);
  assert.ok(result.removed_by_type.turn_context >= 1);
  assert.ok(result.removed_by_type.feedback >= 1);
  assert.doesNotMatch(rawTree(MEMORY_FEEDBACK_DIR), new RegExp(memory.memory_id));
  assert.doesNotMatch(rawTree(MEMORY_RETRIEVAL_INDEX_DIR), /Vega customer constraint/);
  assert.equal(fs.existsSync(path.join(MEMORY_OVERLAYS_DIR, "default", session.session_id, `${overlay.overlay_id}.json`)), false);
});

test("M10 encrypted backup restores logical records after key destruction", () => {
  resetTestRoot();
  process.env.MY_MATE_MEMORY_SECRET_KEY = "m10-backup-root-key";
  const memory = createMemory({
    scope_kind: "user",
    scope_id: "m10-owner",
    content: "Private M10 backup recovery evidence.",
    sensitivity: "private",
  });
  const backup = createEncryptedMemoryBackup({ passphrase: PASSPHRASE });
  assert.ok(backup.record_count >= 1);
  hardPurgeMemory(memory.memory_id);
  assert.equal(getMemory(memory.memory_id), null);
  const dryRun = restoreEncryptedMemoryBackup({ backupId: backup.backup_id, passphrase: PASSPHRASE, dryRun: true });
  assert.equal(dryRun.verified_digest, true);
  assert.equal(getMemory(memory.memory_id), null);
  const restored = restoreEncryptedMemoryBackup({ backupId: backup.backup_id, passphrase: PASSPHRASE });
  assert.ok(restored.restored_records >= 1);
  assert.equal(getMemory(memory.memory_id)?.content, "Private M10 backup recovery evidence.");
  assert.throws(() => restoreEncryptedMemoryBackup({ backupId: backup.backup_id, passphrase: "incorrect passphrase" }), /integrity verification failed/);
});

test("M10 integrity and retention report bounded operational results", () => {
  resetTestRoot();
  const deleted = createMemory({ content: "M10 retention deletion target." });
  deleteMemory(deleted.memory_id);
  const file = path.join(MEMORIES_DIR, "default", `${encodeURIComponent(deleted.memory_id)}.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.updated_at = "2020-01-01T00:00:00.000Z";
  fs.writeFileSync(file, JSON.stringify(raw), "utf8");
  const integrity = scanMemoryIntegrity();
  assert.equal(integrity.status, "healthy");
  const retention = runMemoryRetention();
  assert.equal(retention.purged_memories, 1);
  assert.equal(listAllMemories({ status: "all" }).length, 0);
});

test("M10 APIs expose operations, key rotation, backup verification, and purge confirmation", async () => {
  resetTestRoot();
  const memory = createMemory({ content: "M10 API purge target." });
  const server = await startTestServer();
  try {
    const status = await getJson(`${server.baseUrl}/api/memory-operations`);
    assert.equal(status.status, 200);
    assert.match(status.body.key.active_key_id, /^memkey_/);
    const rotate = await postJson(`${server.baseUrl}/api/memory-keys/rotate`, {});
    assert.equal(rotate.status, 200);
    const backup = await postJson(`${server.baseUrl}/api/memory-backups`, { passphrase: PASSPHRASE });
    assert.equal(backup.status, 201);
    const wrongPurge = await postJson(`${server.baseUrl}/api/memories/${memory.memory_id}/purge`, { confirm_memory_id: "wrong" });
    assert.equal(wrongPurge.status, 400);
    const purge = await postJson(`${server.baseUrl}/api/memories/${memory.memory_id}/purge`, { confirm_memory_id: memory.memory_id });
    assert.equal(purge.status, 200);
  } finally {
    await server.close();
  }
});
