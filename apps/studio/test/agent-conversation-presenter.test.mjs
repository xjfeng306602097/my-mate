import test from "node:test";
import assert from "node:assert/strict";

import {
  agentFieldLabel,
  buildAgentEventConversation,
  buildSubAgentConversationPresentation,
  parseAgentStructuredResult,
  stripAgentProtocolContext,
  visibleAgentResultEntries,
} from "../src/agent-conversation-presenter.js";

const protocolPrompt = `Analyze the service regression and report the likely cause.

Mission inputs (authoritative user-supplied workflow inputs):
{"secret_protocol_shape":true}

Return a JSON object matching this output contract:
{"facts":[]}`;

test("Sub Agent presentation hides protocol context and keeps the assignment", () => {
  const presentation = buildSubAgentConversationPresentation({
    messages: [
      { role: "user", kind: "text", content: { text: protocolPrompt } },
      { role: "orchestrator", kind: "text", content: { text: '{"facts":["Pool size regressed"]}' } },
      { role: "system", kind: "workspace_snapshot_card", content: { state: { internal: true } } },
    ],
  });

  assert.equal(presentation.assignment, "Analyze the service regression and report the likely cause.");
  assert.deepEqual(presentation.conversation, []);
  assert.deepEqual(presentation.result.structured, { facts: ["Pool size regressed"] });
  assert.equal(JSON.stringify(presentation).includes("secret_protocol_shape"), false);
});

test("Sub Agent presentation preserves ordinary follow-up conversation", () => {
  const presentation = buildSubAgentConversationPresentation({
    objective: "Review the implementation.",
    messages: [
      { role: "user", kind: "text", content: { text: protocolPrompt } },
      { role: "user", kind: "text", content: { text: "Please also check accessibility." } },
      { role: "orchestrator", kind: "text", content: { text: "I checked the keyboard navigation." } },
      { role: "orchestrator", kind: "text", content: { text: "The review is complete." } },
    ],
  });

  assert.deepEqual(presentation.conversation.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "Please also check accessibility." },
    { role: "agent", text: "I checked the keyboard navigation." },
  ]);
  assert.equal(presentation.result.text, "The review is complete.");
  assert.equal(presentation.result.structured, null);
});

test("Sub Agent event conversation groups streamed updates around tool activity", () => {
  const events = [
    { sequence: 1, type: "agent.message.delta", created_at: "2026-07-25T03:00:00.000Z", payload: { text: "I am " } },
    { sequence: 2, type: "agent.message.delta", created_at: "2026-07-25T03:00:01.000Z", payload: { text: "checking files." } },
    { sequence: 3, type: "tool.started", payload: { tool_name: "workspace_list" } },
    { sequence: 4, type: "tool.completed", payload: { tool_name: "workspace_list" } },
    { sequence: 5, type: "agent.message.delta", created_at: "2026-07-25T03:00:02.000Z", payload: { text: "The files " } },
    { sequence: 6, type: "agent.message.delta", created_at: "2026-07-25T03:00:03.000Z", payload: { text: "are ready." } },
  ];

  assert.deepEqual(
    buildAgentEventConversation(events).map(({ role, source, text }) => ({ role, source, text })),
    [
      { role: "agent", source: "event", text: "I am checking files." },
      { role: "agent", source: "event", text: "The files are ready." },
    ],
  );

  const presentation = buildSubAgentConversationPresentation({
    objective: "Inspect the workspace.",
    events,
    latestSummary: "The files are ready.",
  });
  assert.deepEqual(presentation.conversation.map(({ text }) => text), [
    "I am checking files.",
    "The files are ready.",
  ]);
  assert.equal(presentation.result.text, "The files are ready.");
});

test("Sub Agent event conversation collapses an exactly repeated completion stream", () => {
  const completedText = "**Observed**\n\nThe workspace is ready.";
  const events = [
    { sequence: 1, type: "agent.message.delta", payload: { text: completedText } },
    { sequence: 2, type: "agent.message.delta", payload: { text: completedText } },
    { sequence: 3, type: "agent.message.completed", payload: { text: completedText } },
  ];

  assert.deepEqual(buildAgentEventConversation(events).map(({ text }) => text), [completedText]);
});

test("Sub Agent presentation accepts a structured result from the completion event", () => {
  const presentation = buildSubAgentConversationPresentation({
    objective: "Review the release.",
    events: [{ sequence: 1, type: "agent.progress", summary: "Reviewing evidence." }],
    latestResult: { verdict: "accepted", session_id: "hidden" },
  });

  assert.equal(presentation.conversation[0].text, "Reviewing evidence.");
  assert.deepEqual(presentation.result.structured, { verdict: "accepted", session_id: "hidden" });
});

test("structured result helpers present business fields and hide wire-only fields", () => {
  assert.deepEqual(parseAgentStructuredResult("```json\n{\"review_verdict\":\"accepted\"}\n```"), {
    review_verdict: "accepted",
  });
  assert.equal(agentFieldLabel("review_verdict"), "Review Verdict");
  assert.deepEqual(
    visibleAgentResultEntries({ expected_artifacts: ["report"], session_id: "internal", facts: ["done"] }),
    [["facts", ["done"]]],
  );
  assert.deepEqual(
    visibleAgentResultEntries({ dag_id: "internal", state_revision: 7, approved: true }, 2),
    [["approved", true]],
  );
  assert.deepEqual(
    visibleAgentResultEntries({
      evidence: {
        mission_inputs: { internal: true },
        dependency_results: [{ node_id: "internal" }],
      },
      report: { summary: "Ready for review", task_id: "internal" },
    }),
    [["report", { summary: "Ready for review", task_id: "internal" }]],
  );
  assert.equal(stripAgentProtocolContext(protocolPrompt), "Analyze the service regression and report the likely cause.");
});
