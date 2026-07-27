import assert from "node:assert/strict";
import test from "node:test";
import { appendAgentRunEvent, listAgentRunEvents } from "../src/agent-run-event-store.js";
import { createAgentRun } from "../src/agent-runtime-store.js";
import type { AgentBindingSnapshot } from "../src/types.js";
import { resetTestRoot, startTestServer } from "./helpers.js";

function eventInput(agentRunId: string, index: number, idempotencyKey: string | null = null) {
  return {
    workspaceId: "default",
    dagId: "dag_event_test",
    nodeId: "node_event_test",
    taskId: "task_event_test",
    agentRunId,
    type: "agent.progress" as const,
    status: "running" as const,
    summary: `Progress ${index}`,
    payload: { index },
    idempotencyKey,
  };
}

function testBinding(): AgentBindingSnapshot {
  return {
    schema_version: 2,
    binding_id: "binding_event_test",
    binding_mode: "pinned",
    agent_id: "event-test-agent",
    agent_version: 1,
    agent_name: "Event Test Agent",
    agent_role: "worker",
    provider_id: "provider_event_test",
    provider_connection_id: "connection_event_test",
    connection_revision: "revision_event_test",
    model_deployment_id: "deployment_event_test",
    model: "event-test-model",
    system_prompt: "Test events.",
    tool_policy: { allowed_tools: [], denied_tools: [], max_tool_rounds: 1 },
    skill_policy: { locked_skills: [], denied_skills: [], dynamic_activation: false },
    memory_policy: { enabled: false, automatic_recall: false, write_mode: "disabled" },
    context_policy: { compression_enabled: true, compression_threshold_percent: 80, max_continuation_rounds: 2 },
    runtime_policy: { runtime: "native", sandbox: "auto", timeout_seconds: 60 },
    workspace_policy: { read: true, write: false, allowed_project_ids: [] },
    autonomy_ceiling: "assisted",
    artifact_policy: {},
    delivery_policy: {},
    snapshot_digest: "event-test-digest",
    created_at: new Date().toISOString(),
  };
}

test("AgentRun events preserve sequence and idempotency beyond 1000 records", () => {
  resetTestRoot();
  const runId = "agent_run_long_event_test";
  for (let index = 1; index <= 1_005; index += 1) {
    appendAgentRunEvent(eventInput(runId, index, index === 1 ? "first-event" : null));
  }

  const tail = listAgentRunEvents({ workspaceId: "default", agentRunId: runId, afterSequence: 998, limit: 20 });
  assert.deepEqual(tail.map((event) => event.sequence), [999, 1000, 1001, 1002, 1003, 1004, 1005]);
  const duplicate = appendAgentRunEvent(eventInput(runId, 9_999, "first-event"));
  assert.equal(duplicate.sequence, 1);
  assert.equal(listAgentRunEvents({ workspaceId: "default", agentRunId: runId, afterSequence: 1_000, limit: 20 }).length, 5);
});

test("AgentRun event REST pagination and SSE resume use the durable sequence", async () => {
  resetTestRoot();
  const run = createAgentRun({ workspaceId: "default", kind: "delegation", bindingSnapshot: testBinding() });
  for (let index = 1; index <= 4; index += 1) appendAgentRunEvent(eventInput(run.agent_run_id, index));
  const server = await startTestServer();
  try {
    const pageResponse = await fetch(`${server.baseUrl}/api/agent-runs/${run.agent_run_id}/events?after_sequence=1&limit=2`);
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.json() as { items: Array<{ sequence: number }>; next_after_sequence: number; has_more: boolean };
    assert.deepEqual(page.items.map((event) => event.sequence), [2, 3]);
    assert.equal(page.next_after_sequence, 3);
    assert.equal(page.has_more, true);

    const controller = new AbortController();
    const streamResponse = await fetch(
      `${server.baseUrl}/api/agent-runs/${run.agent_run_id}/events/stream?after_sequence=1`,
      { headers: { "last-event-id": "2" }, signal: controller.signal },
    );
    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body!.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    assert.match(text, /id: 3\nevent: agent\.event\n/u);
    assert.doesNotMatch(text, /id: [12]\n/u);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  } finally {
    await server.close();
  }
});
