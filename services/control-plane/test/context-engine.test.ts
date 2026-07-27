import assert from "node:assert/strict";
import test from "node:test";
import { DefaultContextEngine } from "../src/context-engine.js";
import { buildConversationWorldState } from "../src/context-world-state.js";
import {
  getMemoryTierState,
  maintainMemoryTiers,
  recordMemoryAccesses,
} from "../src/memory-tier-store.js";
import { createMemory } from "../src/memory-store.js";
import { createSession } from "../src/session-store.js";
import { resetTestRoot } from "./helpers.js";

const estimate = (value: string): number => Math.ceil(value.length / 4);
const truncate = (value: string, tokens: number): string => value.slice(0, tokens * 4);

test("Context Engine builds a bounded working set and omits cold low-priority segments", () => {
  resetTestRoot();
  const session = createSession({ initial_message: "Build a release report.", created_by: "context-owner" });
  const engine = new DefaultContextEngine();
  const result = engine.assemble({
    session,
    messages: [],
    segments: [
      { id: "authority", content: "authoritative mission state", priority: 100, required: true },
      { id: "working_memory", content: "W".repeat(480), priority: 80, max_token_share: 0.6 },
      { id: "peripheral_memory", content: "P".repeat(480), priority: 5, max_token_share: 0.6 },
    ],
    maxInputTokens: 200,
    reservedTokens: 0,
    estimateTokens: estimate,
    selectHistory: (budget) => budget >= 20 ? [{ role: "user", content: "latest user turn" }] : [],
    truncate,
    textOf: () => "",
  });
  assert.match(result.system, /authoritative mission state/u);
  assert.ok(result.metrics.included_segments.includes("working_memory"));
  assert.ok(result.metrics.omitted_segments.includes("peripheral_memory"));
  assert.equal(result.history.at(-1)?.content, "latest user turn");
});

test("Context Engine serializes compaction for the same Session", async () => {
  resetTestRoot();
  const engine = new DefaultContextEngine();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const first = engine.compact({
    workspaceId: "default",
    sessionId: "session-lock",
    execute: async () => {
      await blocked;
      return "summary";
    },
  });
  const second = await engine.compact({
    workspaceId: "default",
    sessionId: "session-lock",
    execute: async () => "duplicate",
  });
  assert.equal(second.acquired, false);
  release();
  assert.deepEqual(await first, { acquired: true, value: "summary" });
});

test("Memory tier state promotes repeated relevant access and decays when cold", () => {
  resetTestRoot();
  const memory = createMemory({
    content: "Release reports must include rollback evidence.",
    kind: "convention",
    importance: 0.7,
    confidence: 0.8,
  });
  assert.equal(getMemoryTierState(memory).tier, "working");
  recordMemoryAccesses([memory], "2026-01-01T00:00:00.000Z");
  const [promoted] = recordMemoryAccesses([memory], "2026-01-01T00:01:00.000Z");
  assert.equal(promoted?.tier, "core");
  const [cooled] = maintainMemoryTiers([memory], "2027-01-01T00:00:00.000Z");
  assert.equal(cooled?.tier, "working");
  assert.equal(cooled?.last_demoted_at, "2027-01-01T00:00:00.000Z");
});

test("World State remains authoritative and valid without a DAG or Checkpoint", () => {
  resetTestRoot();
  const session = createSession({ initial_message: "Implement the desktop export flow.", created_by: "world-owner" });
  session.current_plan_summary = "Inspect, implement, test, and review.";
  const state = buildConversationWorldState(session);
  assert.match(state.text, /Authoritative World State/u);
  assert.match(state.text, /Implement the desktop export flow/u);
  assert.match(state.text, /Inspect, implement, test, and review/u);
  assert.equal(state.dag_id, null);
  assert.equal(state.checkpoint_id, null);
});
