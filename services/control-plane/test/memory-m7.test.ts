import assert from "node:assert/strict";
import test from "node:test";
import { buildAutomaticMemoryRecall } from "../src/memory-auto-recall.js";
import { runBackgroundMemoryReview } from "../src/memory-background-review.js";
import { evaluateConversationIntentRouter } from "../src/memory-intelligence-evaluation.js";
import { extractModelMemoryProposals } from "../src/memory-intelligence.js";
import { parseModelIntentRoute, routeConversationIntent } from "../src/conversation-intent-router.js";
import { refineConversationIntent } from "../src/conversation-intent-intelligence.js";
import { getMemoryObservability } from "../src/memory-observability.js";
import { updateMemorySettings } from "../src/memory-settings-store.js";
import {
  approveMemoryCandidate,
  createMemory,
  getMemory,
} from "../src/memory-store.js";
import {
  recordProviderConnectionVerification,
  upsertProviderConnection,
} from "../src/provider-connection-store.js";
import { createSessionMessage, listSessionMessages } from "../src/session-message-store.js";
import { createSession, saveSession } from "../src/session-store.js";
import type { SessionRecord } from "../src/types.js";
import { getJson, resetTestRoot, startTestServer } from "./helpers.js";

function configureIntelligence(): string {
  const connection = upsertProviderConnection({
    connection_id: "m7-intelligence",
    name: "M7 Intelligence",
    agent_runtime: "codex",
    provider: "openai-compatible",
    protocol: "openai-compatible",
    base_url: "https://memory.example",
    models: ["memory-test"],
    default_model: "memory-test",
    api_key: "memory-test-secret",
    credential_source: "managed",
    credential_env: "OPENAI_API_KEY",
    status: "active",
    metadata: {},
  });
  recordProviderConnectionVerification(connection.connection_id, {
    status: "verified",
    tested_at: "2026-07-16T00:00:00.000Z",
    detail: "verified for M7 tests",
    duration_ms: 1,
    model: "memory-test",
  });
  updateMemorySettings({
    intelligence: {
      extraction_mode: "hybrid",
      provider_connection_id: connection.connection_id,
      model: "memory-test",
      min_confidence: 0.7,
    },
    scope_policy: { agent_memory_enabled: true },
  });
  return connection.connection_id;
}

function sessionWithTurn(text: string, autonomyMode = "assisted"): SessionRecord {
  const session = createSession({ title: "M7 memory intelligence", created_by: "m7-owner" });
  session.metadata = {
    ...session.metadata,
    autonomy_mode: autonomyMode,
    conversation_provider_connection_id: "m7-intelligence",
    conversation_model: "memory-test",
    agent_id: "m7-agent",
  };
  saveSession(session);
  createSessionMessage({ session_id: session.session_id, role: "user", kind: "text", content: { text } });
  createSessionMessage({ session_id: session.session_id, role: "orchestrator", kind: "text", content: { text: "Turn completed." } });
  return session;
}

function modelFetch(memories: unknown[]): typeof fetch {
  return async () => new Response(JSON.stringify({
    id: "m7-memory-response",
    model: "memory-test",
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: JSON.stringify({ memories }) },
    }],
    usage: { prompt_tokens: 50, completion_tokens: 20 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function proposal(operation: string, overrides: Record<string, unknown> = {}) {
  return {
    operation,
    target_memory_id: null,
    scope_kind: "user",
    kind: "preference",
    content: "Use concise validation evidence in future reports.",
    confidence: 0.94,
    importance: 0.8,
    sensitivity: "normal",
    tags: ["reporting"],
    rationale: "Durable cross-task preference.",
    ...overrides,
  };
}

test("M7 deterministic Intent Router passes its multilingual quality gate", () => {
  resetTestRoot();
  const evaluation = evaluateConversationIntentRouter();
  assert.equal(evaluation.total, 36);
  assert.equal(evaluation.passed, evaluation.total);
  assert.equal(evaluation.accuracy, 1);
  assert.equal(evaluation.memory_operations.total, 8);
  assert.equal(evaluation.memory_operations.accuracy, 1);
  assert.equal(routeConversationIntent("current task status?").intent, "ask_status");
  assert.equal(routeConversationIntent("\u5e2e\u6211\u751f\u6210\u65b9\u6848").intent, "ask_plan");
  assert.equal(routeConversationIntent("Translate report.md to French").entities.filename, "report.md");
  const modeled = parseModelIntentRoute("prefix {\"intent\":\"ask_run\",\"confidence\":0.91,\"risk\":\"high\",\"entities\":{\"parallelism\":4},\"reason\":\"explicit\"} suffix");
  assert.equal(modeled?.source, "model");
  assert.equal(modeled?.intent, "ask_run");
  assert.equal(parseModelIntentRoute("{\"intent\":\"unknown\",\"confidence\":1}"), null);
});

test("M7 intent evaluation is exposed through the Control Plane contract", async () => {
  resetTestRoot();
  const server = await startTestServer();
  try {
    const response = await getJson(`${server.baseUrl}/api/memory-intelligence/evaluation`);
    assert.equal(response.status, 200);
    assert.equal(response.body.suite, "m8-memory-intelligence-v2");
    assert.equal(response.body.total, 36);
    assert.equal(response.body.accuracy, 1);
    assert.equal(response.body.memory_operations.accuracy, 1);
  } finally {
    await server.close();
  }
});

test("M7 model Intent Router refines low-confidence routes and fails closed to deterministic intent", async () => {
  resetTestRoot();
  configureIntelligence();
  updateMemorySettings({ intelligence: { intent_model_enabled: true } });
  const session = sessionWithTurn("Okay, continue with that.");
  const deterministic = routeConversationIntent("Okay, continue with that.");
  assert.equal(deterministic.confidence, 0.58);
  const routed = await refineConversationIntent(session, deterministic, {
    fetchImpl: modelFetch([]).bind(null) as typeof fetch,
  });
  assert.equal(routed, deterministic, "an invalid model contract must use the deterministic route");

  const validFetch: typeof fetch = async () => new Response(JSON.stringify({
    id: "m7-intent-response",
    model: "memory-test",
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: JSON.stringify({
          intent: "ask_run",
          confidence: 0.93,
          entities: {},
          risk: "medium",
          required_capability: "runtime.execute",
          directive_text: "continue",
          reason: "The user asked to continue execution.",
        }),
      },
    }],
    usage: { prompt_tokens: 30, completion_tokens: 10 },
  }), { status: 200, headers: { "content-type": "application/json" } });
  const refined = await refineConversationIntent(session, deterministic, { fetchImpl: validFetch });
  assert.equal(refined.intent, "ask_run");
  assert.equal(refined.source, "model");

  const failed = await refineConversationIntent(session, deterministic, {
    fetchImpl: async () => { throw new Error("network down"); },
  });
  assert.equal(failed, deterministic);
  const metrics = getMemoryObservability();
  assert.equal(metrics.intent_model_attempts, 3);
  assert.equal(metrics.intent_model_successes, 1);
  assert.equal(metrics.intent_model_fallbacks, 2);
});

test("M7 hybrid extraction supports create and deterministic failure fallback", async () => {
  resetTestRoot();
  configureIntelligence();
  const modeledSession = sessionWithTurn("Remember my reporting preference.");
  const modeled = await runBackgroundMemoryReview(modeledSession.session_id, {
    fetchImpl: modelFetch([proposal("create")]),
  });
  assert.equal(modeled.extractor, "model");
  assert.equal(modeled.candidate_ids.length, 1);
  assert.equal(modeled.proposed_operations.create, 1);

  const fallbackSession = sessionWithTurn("I prefer concise validation evidence in every engineering report.");
  const fallback = await runBackgroundMemoryReview(fallbackSession.session_id, {
    fetchImpl: async () => { throw new Error("provider unavailable"); },
  });
  assert.equal(fallback.extractor, "deterministic");
  assert.equal(fallback.candidate_ids.length, 1);
  const metrics = getMemoryObservability();
  assert.equal(metrics.model_extraction_attempts, 2);
  assert.equal(metrics.model_extraction_successes, 1);
  assert.equal(metrics.model_extraction_fallbacks, 1);
});

test("M7 governed update, supersede, delete, and ignore mutations preserve canonical truth", async () => {
  resetTestRoot();
  configureIntelligence();
  const original = createMemory({
    scope_kind: "user",
    scope_id: "m7-owner",
    kind: "preference",
    content: "Use short reports.",
  });

  const updateSession = sessionWithTurn("My reporting preference now includes validation evidence.");
  const updateReview = await runBackgroundMemoryReview(updateSession.session_id, {
    fetchImpl: modelFetch([proposal("update", { target_memory_id: original.memory_id })]),
  });
  const updated = approveMemoryCandidate(updateReview.candidate_ids[0]!);
  assert.equal(updated?.memory.memory_id, original.memory_id);
  assert.equal(updated?.memory.version, 2);
  assert.match(updated?.memory.content || "", /validation evidence/);

  const supersedeSession = sessionWithTurn("Replace that reporting preference with a stronger convention.");
  const supersedeReview = await runBackgroundMemoryReview(supersedeSession.session_id, {
    fetchImpl: modelFetch([proposal("supersede", {
      target_memory_id: original.memory_id,
      content: "Every release report must include concise validation evidence.",
    })]),
  });
  assert.equal(supersedeReview.proposed_operations.supersede, 1);
  const superseded = approveMemoryCandidate(supersedeReview.candidate_ids[0]!);
  assert.notEqual(superseded?.memory.memory_id, original.memory_id);
  assert.equal(superseded?.memory.supersedes_memory_id, original.memory_id);
  assert.equal(getMemory(original.memory_id)?.status, "superseded");

  const deletable = createMemory({
    scope_kind: "user",
    scope_id: "m7-owner",
    kind: "fact",
    content: "A temporary durable fact to remove.",
  });
  const deleteSession = sessionWithTurn("Forget the temporary durable fact.");
  const deleteReview = await runBackgroundMemoryReview(deleteSession.session_id, {
    fetchImpl: modelFetch([proposal("delete", {
      target_memory_id: deletable.memory_id,
      kind: "fact",
      content: deletable.content,
    })]),
  });
  approveMemoryCandidate(deleteReview.candidate_ids[0]!);
  assert.equal(getMemory(deletable.memory_id)?.status, "deleted");

  const ignoreSession = sessionWithTurn("Thanks, that is all for now.");
  const ignored = await extractModelMemoryProposals({
    session: ignoreSession,
    fetchImpl: modelFetch([proposal("ignore", { content: "", confidence: 0.2 })]),
  });
  assert.equal(ignored?.proposals[0]?.operation, "ignore");
  const ignoreReview = await runBackgroundMemoryReview(ignoreSession.session_id, {
    fetchImpl: modelFetch([proposal("ignore", { content: "", confidence: 0.2 })]),
  });
  assert.equal(ignoreReview.extractor, "model");
  assert.equal(ignoreReview.candidate_ids.length, 0);
  assert.equal(ignoreReview.committed_memory_ids.length, 0);
  assert.equal(ignoreReview.reason, "no_durable_memory_detected");
});

test("M7 automatic recall enforces user and Agent scope plus character budget", async () => {
  resetTestRoot();
  updateMemorySettings({
    automatic_recall: { enabled: true, max_results: 20, character_budget: 500 },
    scope_policy: { agent_memory_enabled: true },
  });
  createMemory({ scope_kind: "workspace", scope_id: "default", content: "Saturn workspace convention." });
  createMemory({ scope_kind: "user", scope_id: "m7-owner", content: "Saturn owner preference." });
  createMemory({ scope_kind: "user", scope_id: "other-owner", content: "Saturn private other-user preference." });
  createMemory({ scope_kind: "agent", scope_id: "m7-agent", content: "Saturn current agent lesson." });
  createMemory({ scope_kind: "agent", scope_id: "other-agent", content: "Saturn unrelated agent lesson." });
  createMemory({ scope_kind: "workspace", scope_id: "default", content: `Saturn ${"oversized ".repeat(80)}` });
  const session = sessionWithTurn("What do we remember about Saturn?");
  const recall = await buildAutomaticMemoryRecall(session, listSessionMessages(session.session_id));
  assert.ok(recall);
  assert.ok(recall.length <= 500 + 160);
  assert.match(recall, /Saturn workspace convention/);
  assert.match(recall, /Saturn owner preference/);
  assert.match(recall, /Saturn current agent lesson/);
  assert.doesNotMatch(recall, /other-user|other-owner|unrelated agent/);
  assert.doesNotMatch(recall, /oversized oversized oversized/);
});
