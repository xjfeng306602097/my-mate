import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { MEMORY_TURN_CONTEXTS_DIR } from "../src/config.js";
import {
  contextEntryFromCore,
  createMemoryOverlay,
  createRecommendationFeedback,
  freezeTurnMemoryContext,
  listMemoryOverlays,
  listTurnMemoryContexts,
  memoryEffectiveness,
} from "../src/memory-activation-store.js";
import {
  completeMemoryOnboarding,
  getMemoryOnboarding,
  previewMemoryOnboarding,
  startMemoryOnboarding,
} from "../src/memory-onboarding-store.js";
import { listSessionMemoryRecommendations } from "../src/memory-recommendation.js";
import { ensureCoreMemorySnapshot } from "../src/memory-snapshot-store.js";
import { createMemory, listMemories } from "../src/memory-store.js";
import { createSession } from "../src/session-store.js";
import { createSessionMessage } from "../src/session-message-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

test("M9 freezes exact turn context, consumes next-turn overlays once, and reuses it on retry", () => {
  resetTestRoot();
  const previousKey = process.env.MY_MATE_MEMORY_SECRET_KEY;
  process.env.MY_MATE_MEMORY_SECRET_KEY = "m9-private-context-key";
  try {
    const memory = createMemory({
      scope_kind: "user",
      scope_id: "m9-owner",
      kind: "preference",
      content: "Private M9 preference: use the Lyra validation convention.",
      sensitivity: "private",
    });
    const session = createSession({ title: "Lyra validation", created_by: "m9-owner" });
    const user = createSessionMessage({
      session_id: session.session_id,
      role: "user",
      kind: "text",
      content: { text: "Prepare Lyra validation evidence." },
    });
    const overlay = createMemoryOverlay({ session, memoryId: memory.memory_id, mode: "next_turn" });
    const core = ensureCoreMemorySnapshot(session);
    const first = freezeTurnMemoryContext({
      session,
      sourceUserMessageId: user.message_id,
      providerConnectionId: "provider-m9",
      model: "model-m9",
      coreEntries: [...core.entries, ...core.project_entries].map(contextEntryFromCore),
      automaticEntries: [],
      prompt: "stable prompt",
    });
    assert.equal(first.reused, false);
    assert.ok(first.snapshot.entries.some((entry) => entry.memory_id === memory.memory_id && entry.source === "manual_overlay"));
    assert.equal(listMemoryOverlays(session.session_id).find((item) => item.overlay_id === overlay.overlay_id)?.status, "consumed");

    const retry = freezeTurnMemoryContext({
      session,
      sourceUserMessageId: user.message_id,
      providerConnectionId: "provider-m9",
      model: "model-m9",
      coreEntries: [],
      automaticEntries: [],
      prompt: "a recomputed prompt that must not replace the frozen context",
    });
    assert.equal(retry.reused, true);
    assert.equal(retry.snapshot.context_id, first.snapshot.context_id);
    assert.equal(listTurnMemoryContexts(session.session_id).length, 1);

    const file = path.join(
      MEMORY_TURN_CONTEXTS_DIR,
      "default",
      encodeURIComponent(session.session_id),
      `${encodeURIComponent(first.snapshot.context_id)}.json`,
    );
    const persisted = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(persisted, /Lyra validation convention/);
    assert.match(persisted, /aes-256-gcm|ciphertext/);
  } finally {
    if (previousKey === undefined) delete process.env.MY_MATE_MEMORY_SECRET_KEY;
    else process.env.MY_MATE_MEMORY_SECRET_KEY = previousKey;
  }
});

test("M9 recommendation feedback is content-free and dismisses only the exact Session version", () => {
  resetTestRoot();
  const session = createSession({ title: "Orion release report", created_by: "m9-owner" });
  createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "What belongs in the Orion release report?" },
  });
  const memory = createMemory({
    scope_kind: "user",
    scope_id: "m9-owner",
    content: "Orion release reports include verification and rollback evidence.",
  });
  const recommendation = listSessionMemoryRecommendations(session)[0]!;
  assert.equal(recommendation.memory_id, memory.memory_id);
  assert.match(recommendation.recommendation_id, /^memrec_/);
  const feedback = createRecommendationFeedback({
    session,
    recommendationId: recommendation.recommendation_id,
    memoryId: recommendation.memory_id,
    memoryVersion: recommendation.memory_version,
    action: "dismiss_for_session",
    reasonCode: "wrong_task",
  });
  assert.equal("content" in feedback, false);
  assert.equal(listSessionMemoryRecommendations(session).length, 0);

  const other = createSession({ title: "Orion release report", created_by: "m9-owner" });
  createSessionMessage({
    session_id: other.session_id,
    role: "user",
    kind: "text",
    content: { text: "Prepare the Orion release report." },
  });
  assert.equal(listSessionMemoryRecommendations(other)[0]?.memory_id, memory.memory_id);
});

test("M9 guided onboarding resumes drafts and commits explicit entries while inferred entries stay reviewable", () => {
  resetTestRoot();
  assert.equal(getMemoryOnboarding().status, "not_started");
  assert.equal(startMemoryOnboarding().status, "in_progress");
  const preview = previewMemoryOnboarding({
    step: 3,
    entries: [
      { content: "Keep answers concise and evidence-backed.", kind: "preference", scope_kind: "user", origin: "explicit" },
      { content: "The release checklist may require rollback proof.", kind: "convention", scope_kind: "workspace", origin: "inferred" },
    ],
  });
  assert.equal(preview.step, 3);
  assert.equal(getMemoryOnboarding().draft_entries.length, 2);
  const completed = completeMemoryOnboarding();
  assert.equal(completed.status, "completed");
  assert.equal(completed.committed_memory_ids.length, 1);
  assert.equal(completed.candidate_ids.length, 1);
  assert.equal(listMemories({ status: "active" }).some((item) => item.content.includes("concise")), true);
});

test("M9 APIs expose overlays, contexts, onboarding, and effectiveness", async () => {
  resetTestRoot();
  const session = createSession({ title: "M9 API", created_by: "dev-user" });
  const user = createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "Use M9 API memory." },
  });
  const memory = createMemory({ content: "M9 API memory includes acceptance evidence." });
  createMemoryOverlay({ session, memoryId: memory.memory_id, mode: "session" });
  freezeTurnMemoryContext({
    session,
    sourceUserMessageId: user.message_id,
    providerConnectionId: "m9-api-provider",
    model: "m9-api-model",
    coreEntries: [],
    automaticEntries: [],
    prompt: "M9 API prompt",
  });
  const server = await startTestServer();
  try {
    const overlay = await getJson(`${server.baseUrl}/api/sessions/${session.session_id}/memory-overlay`);
    assert.equal(overlay.status, 200);
    assert.equal(overlay.body.count, 1);
    const contexts = await getJson(`${server.baseUrl}/api/sessions/${session.session_id}/memory-contexts`);
    assert.equal(contexts.status, 200);
    assert.equal(contexts.body.count, 1);
    const onboarding = await postJson(`${server.baseUrl}/api/memory-onboarding/start`, {});
    assert.equal(onboarding.status, 200);
    assert.equal(onboarding.body.status, "in_progress");
    const effectiveness = await getJson(`${server.baseUrl}/api/memory-effectiveness`);
    assert.equal(effectiveness.status, 200);
    assert.equal(effectiveness.body.turn_contexts, 1);
    assert.equal(memoryEffectiveness().turn_contexts, 1);
  } finally {
    await server.close();
  }
});

test("M9 recommendation assembly stays below the 100 ms local p95 target at 500 active memories", () => {
  resetTestRoot();
  const session = createSession({ title: "M9 performance release evidence", created_by: "m9-owner" });
  createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text: "Prepare M9 performance release evidence." },
  });
  for (let index = 0; index < 500; index += 1) {
    createMemory({ content: `M9 performance release evidence convention ${index}.` });
  }
  const samples = Array.from({ length: 20 }, () => {
    const started = performance.now();
    const recommendations = listSessionMemoryRecommendations(session, { limit: 8 });
    assert.equal(recommendations.length, 8);
    return performance.now() - started;
  }).sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  assert.ok(p95 < 100, `Expected local p95 < 100 ms, received ${p95.toFixed(2)} ms.`);
});
