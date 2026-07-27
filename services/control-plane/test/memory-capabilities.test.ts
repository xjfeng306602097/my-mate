import assert from "node:assert/strict";
import test from "node:test";
import { getCapabilityRegistry } from "../src/capability-registry.js";
import { executeConversationTool, getConversationToolDefinitions } from "../src/conversation-tools.js";
import {
  approveMemoryCandidate,
  createMemory,
  getMemory,
  listMemories,
  listMemoryCandidates,
} from "../src/memory-store.js";
import { getCapabilityPluginHost } from "../src/plugin-host.js";
import { createSessionMessage } from "../src/session-message-store.js";
import { createSession } from "../src/session-store.js";
import type { AgentBindingSnapshot, AutopilotMode, SessionRecord } from "../src/types.js";
import { resetTestRoot } from "./helpers.js";

function sessionWithUserTurn(mode: AutopilotMode, text: string): SessionRecord {
  const session = createSession({
    initial_message: text,
    created_by: "memory-user",
    autonomy_mode: mode,
  });
  session.metadata.agent_binding_snapshot = {
    memory_policy: {
      enabled: true,
      automatic_recall: true,
      write_mode: "automatic",
    },
  } as AgentBindingSnapshot;
  createSessionMessage({
    session_id: session.session_id,
    role: "user",
    kind: "text",
    content: { text },
  });
  return session;
}

async function callTool(
  session: SessionRecord,
  name: string,
  args: Record<string, unknown>,
) {
  const callId = `call-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const argumentsWithPolicy = ["memory_remember", "memory_forget"].includes(name)
    ? { ...args, idempotency_key: `${session.session_id}:${callId}` }
    : args;
  return await executeConversationTool({
    session,
    call: {
      id: callId,
      name,
      arguments: argumentsWithPolicy,
    },
  });
}

test("memory.core tools enforce autonomy policy through Conversation Actions", async () => {
  resetTestRoot();
  const host = getCapabilityPluginHost();
  const registry = getCapabilityRegistry();
  host.resetForTests();
  registry.clear();
  try {
    const plugins = host.discover();
    assert.equal(plugins.find((item) => item.plugin_id === "memory.core")?.status, "ready");
    const definitions = getConversationToolDefinitions();
    for (const name of ["memory_search", "memory_remember", "memory_forget"]) {
      assert.equal(definitions.some((tool) => tool.name === name), true);
    }

    const reviewSession = sessionWithUserTurn("review_first", "请记住，我偏好简洁、有证据的技术说明。");
    const reviewWrite = await callTool(reviewSession, "memory_remember", {
      content: "User prefers concise, evidence-backed technical explanations.",
      kind: "preference",
      scope_kind: "user",
      confidence: 1,
      importance: 0.8,
    });
    assert.equal(reviewWrite.is_error, false);
    assert.equal(reviewWrite.content.outcome, "pending_review");
    assert.equal(listMemories().length, 0);
    const reviewCandidate = listMemoryCandidates()[0]!;
    assert.equal(reviewCandidate.operation, "create");
    assert.equal(reviewCandidate.autonomy_mode, "review_first");
    assert.equal(reviewCandidate.proposed_memory?.source.action_id, reviewWrite.action_id);
    const approvedReview = approveMemoryCandidate(reviewCandidate.candidate_id);
    assert.equal(approvedReview?.memory.status, "active");

    const assistedExplicit = sessionWithUserTurn("assisted", "Remember that generated deliverables belong in outputs.");
    const assistedWrite = await callTool(assistedExplicit, "memory_remember", {
      content: "Generated deliverables belong in the outputs directory.",
      kind: "convention",
      confidence: 1,
    });
    assert.equal(assistedWrite.content.outcome, "stored");

    const assistedInferred = sessionWithUserTurn("assisted", "I usually prefer TypeScript for services.");
    const inferredWrite = await callTool(assistedInferred, "memory_remember", {
      content: "User usually prefers TypeScript for services.",
      kind: "preference",
      scope_kind: "user",
      confidence: 0.9,
    });
    assert.equal(inferredWrite.content.outcome, "pending_review");

    const autopilotLowRisk = sessionWithUserTurn("autopilot", "The project uses pnpm workspaces.");
    const autopilotWrite = await callTool(autopilotLowRisk, "memory_remember", {
      content: "The project uses pnpm workspaces.",
      kind: "fact",
      confidence: 0.95,
    });
    assert.equal(autopilotWrite.content.outcome, "stored");

    const autopilotUncertain = sessionWithUserTurn("autopilot", "The deployment might use Kubernetes.");
    const uncertainWrite = await callTool(autopilotUncertain, "memory_remember", {
      content: "The deployment uses Kubernetes.",
      kind: "fact",
      confidence: 0.6,
    });
    assert.equal(uncertainWrite.content.outcome, "pending_review");

    const secretWrite = await callTool(assistedExplicit, "memory_remember", {
      content: "api_key=sk-abcdefghijklmnopqrstuvwxyz123456",
      kind: "fact",
    });
    assert.equal(secretWrite.is_error, true);
    assert.equal(secretWrite.content.code, "memory_sensitive_content");

    const search = await callTool(assistedExplicit, "memory_search", {
      query: "outputs directory",
      limit: 10,
    });
    assert.equal(search.is_error, false);
    assert.equal(search.content.count, 1);
    const searchItems = search.content.memories as Array<{ memory_id: string }>;
    const outputMemoryId = searchItems[0]!.memory_id;

    createMemory({
      content: "The outputs directory contains a restricted deployment secret reference.",
      kind: "fact",
      sensitivity: "restricted",
    });
    createMemory({
      content: "Another user prefers the outputs directory for exports.",
      kind: "preference",
      scope_kind: "user",
      scope_id: "another-user",
    });
    const privacySearch = await callTool(assistedExplicit, "memory_search", {
      query: "outputs directory",
      limit: 10,
    });
    assert.equal(privacySearch.content.count, 1);

    const forgetSession = sessionWithUserTurn("review_first", "请删除这条记忆，忘记 outputs 目录约定。");
    const forget = await callTool(forgetSession, "memory_forget", {
      memory_id: outputMemoryId,
      reason: "User explicitly asked to remove it.",
    });
    assert.equal(forget.content.outcome, "pending_review");
    const deleteCandidate = listMemoryCandidates().find((item) => item.operation === "delete");
    assert.ok(deleteCandidate);
    assert.equal(deleteCandidate.source.action_id, forget.action_id);
    assert.equal(getMemory(outputMemoryId)?.status, "active");
    const approvedDelete = approveMemoryCandidate(deleteCandidate.candidate_id);
    assert.equal(approvedDelete?.memory.status, "deleted");
    assert.equal(getMemory(outputMemoryId)?.status, "deleted");
  } finally {
    host.resetForTests();
    registry.clear();
  }
});
