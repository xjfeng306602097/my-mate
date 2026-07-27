import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createConversationAction,
  getConversationAction,
  listConversationActions,
  markConversationActionPendingApproval,
} from "../src/conversation-action-store.js";
import {
  executeConversationTool,
  type ConversationToolCall,
} from "../src/conversation-tools.js";
import {
  generateProviderConversationReply,
  streamProviderConversationReply,
} from "../src/conversation-provider.js";
import { listSessionMessages } from "../src/session-message-store.js";
import { createSession, getSession } from "../src/session-store.js";
import { registerWorkspaceBinding } from "../src/workspace-binding-store.js";
import { getCapabilityPluginHost } from "../src/plugin-host.js";
import { getSkillHost } from "../src/skill-host.js";
import { listSkillEvaluations, updateSkillWorkspaceProfile } from "../src/skill-platform-store.js";
import { listUserSchedules } from "../src/user-schedule-store.js";
import { postJson, resetTestRoot, startTestServer } from "./helpers.js";

async function registerVerifiedConnection(input: {
  baseUrl: string;
  connectionId: string;
  protocol: "anthropic-messages" | "openai-compatible";
  provider: "anthropic-compatible" | "openai-compatible";
  model: string;
}): Promise<void> {
  const created = await postJson(`${input.baseUrl}/api/registry/provider-connections`, {
    connection_id: input.connectionId,
    name: input.connectionId,
    agent_runtime: input.protocol === "anthropic-messages" ? "glm" : "codex",
    provider: input.provider,
    protocol: input.protocol,
    base_url: "https://conversation-tools.example",
    models: [input.model],
    default_model: input.model,
    max_input_tokens: 32_768,
    max_output_tokens: 4_096,
    max_tool_rounds: 3,
    credential_source: "managed",
    credential_env: input.protocol === "anthropic-messages" ? "GLM_API_KEY" : "OPENAI_API_KEY",
    api_key: "conversation-tool-secret",
    status: "active",
    metadata: {},
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const verified = await postJson(
    `${input.baseUrl}/api/registry/provider-connections/${input.connectionId}/test`,
    {},
  );
  assert.equal(verified.body.verification.status, "verified", JSON.stringify(verified.body));
}

test("Provider failure marks an automatically activated Skill invocation as failed", async () => {
  resetTestRoot();
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "provider unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await registerVerifiedConnection({
      baseUrl: server.baseUrl,
      connectionId: "skill-provider-failure",
      protocol: "anthropic-messages",
      provider: "anthropic-compatible",
      model: "glm-5.2",
    });
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create an Excel spreadsheet with a release checklist.",
      provider_connection_id: "skill-provider-failure",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const session = getSession(String(created.body.session.session_id));
    assert.ok(session);
    await assert.rejects(
      () => generateProviderConversationReply({
        session,
        messages: listSessionMessages(session.session_id),
        fetchImpl: providerFetch,
      }),
      /HTTP 503/u,
    );
    const invocation = getSkillHost().listInvocations("default", session.session_id)
      .find((item) => item.skill_id === "artifact-spreadsheet");
    assert.equal(invocation?.status, "failed");
    assert.equal(invocation?.verification_status, "failed");
    assert.equal(listSkillEvaluations("default", "artifact-spreadsheet")[0]?.verdict, "failed");
  } finally {
    await server.close();
  }
});

test("Conversation Agent converts a natural recurring request into a durable cron schedule", async () => {
  resetTestRoot();
  let round = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({ model: "glm-5.2", stop_reason: "end_turn", content: [{ type: "text", text: "OK" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    round += 1;
    return new Response(JSON.stringify(round === 1 ? {
      model: "glm-5.2",
      stop_reason: "tool_use",
      content: [{
        type: "tool_use",
        id: "schedule-create-1",
        name: "schedule_create",
        input: {
          name: "Daily Guangzhou weather",
          prompt: "Summarize Guangzhou weather.",
          cron_expression: "0 9 * * *",
          timezone: "Asia/Shanghai",
          autonomy_mode: "assisted",
        },
      }],
    } : {
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Created the daily schedule with its verified id and next run." }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await registerVerifiedConnection({
      baseUrl: server.baseUrl,
      connectionId: "schedule-agent-provider",
      protocol: "anthropic-messages",
      provider: "anthropic-compatible",
      model: "glm-5.2",
    });
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Every day at 9 AM Shanghai time, summarize Guangzhou weather.",
      provider_connection_id: "schedule-agent-provider",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const session = getSession(String(created.body.session.session_id));
    assert.ok(session);
    const reply = await generateProviderConversationReply({
      session,
      messages: listSessionMessages(session.session_id),
      fetchImpl: providerFetch,
    });
    assert.match(reply.text, /Created the daily schedule/u);
    const schedules = listUserSchedules("default");
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0]?.recurrence.kind, "cron");
    assert.equal(schedules[0]?.recurrence.kind === "cron" ? schedules[0].recurrence.expression : "", "0 9 * * *");
    assert.equal(schedules[0]?.timezone, "Asia/Shanghai");
    assert.ok(schedules[0]?.next_run_at);
  } finally {
    await server.close();
  }
});

test("Anthropic Conversation Agent executes a clock tool and automatically resumes to a final answer", async () => {
  resetTestRoot();
  const conversationRequests: Array<Record<string, any>> = [];
  let conversationRound = 0;
  let responseMode: "normal" | "approval_claim" | "tool_loop" | "desktop_retry" = "normal";
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationRequests.push(body);
    conversationRound += 1;
    if (responseMode === "approval_claim") {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "等待执行权限确认后，我将运行命令。" }],
        usage: { input_tokens: 4, output_tokens: 4 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (responseMode === "tool_loop") {
      if (!Array.isArray(body.tools)) {
        return new Response(JSON.stringify({
          model: "glm-5.2",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "I found enough evidence and summarized the result without more tools." }],
          usage: { input_tokens: 6, output_tokens: 8 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: `loop_${conversationRound}`, name: "system_clock_read", input: {} }],
        usage: { input_tokens: 4, output_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (responseMode === "desktop_retry") {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "tool_use",
        content: [{
          type: "tool_use",
          id: `desktop_retry_${conversationRound}`,
          name: "desktop_application_open",
          input: { application_name: "Test App" },
        }],
        usage: { input_tokens: 4, output_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (conversationRound === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tool_clock_1", name: "system_clock_read", input: {} },
          { type: "tool_use", id: "tool_workspace_1", name: "workspace_list", input: {} },
        ],
        usage: { input_tokens: 12, output_tokens: 4 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "The trusted system clock has been read successfully." }],
      usage: { input_tokens: 18, output_tokens: 8 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
    desktopBridgeToken: "desktop-retry-secret",
  });
  try {
    await registerVerifiedConnection({
      baseUrl: server.baseUrl,
      connectionId: "anthropic-tool-loop",
      protocol: "anthropic-messages",
      provider: "anthropic-compatible",
      model: "glm-5.2",
    });
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "What is the current system date?",
      provider_connection_id: "anthropic-tool-loop",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const session = getSession(sessionId);
    assert.ok(session);
    const progress: string[] = [];
    const reply = await generateProviderConversationReply({
      session,
      messages: listSessionMessages(sessionId),
      fetchImpl: providerFetch,
      onToolProgress: (event) => {
        progress.push(event.status);
      },
    });
    assert.equal(reply.text, "The trusted system clock has been read successfully.");
    assert.equal(reply.evidence.tool_rounds, 1);
    assert.equal(reply.evidence.action_ids.length, 1);
    assert.ok(reply.evidence.action_ids.every(Boolean));
    assert.deepEqual(progress, ["running", "succeeded"]);
    assert.equal(conversationRequests.length, 2);
    assert.ok(Array.isArray(conversationRequests[0]?.tools));
    const followUpMessages = conversationRequests[1]?.messages as Array<Record<string, any>>;
    const resultBlock = followUpMessages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .find((block) => block.type === "tool_result");
    assert.equal(resultBlock?.tool_use_id, "tool_clock_1");
    assert.match(String(resultBlock?.content || ""), /local_date/);
    const unavailableBlock = followUpMessages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .find((block) => block.tool_use_id === "tool_workspace_1");
    assert.match(String(unavailableBlock?.content || ""), /tool_not_allowed/);
    assert.equal(listConversationActions(sessionId)[0]?.status, "succeeded");

    responseMode = "approval_claim";
    await assert.rejects(
      () => generateProviderConversationReply({
        session,
        messages: listSessionMessages(sessionId),
        fetchImpl: providerFetch,
      }),
      (error: unknown) => (error as { code?: string }).code === "conversation_invalid_approval_claim",
    );

    responseMode = "tool_loop";
    const limitedReply = await generateProviderConversationReply({
      session,
      messages: listSessionMessages(sessionId),
      fetchImpl: providerFetch,
    });
    assert.equal(limitedReply.text, "I found enough evidence and summarized the result without more tools.");
    assert.equal(limitedReply.evidence.tool_rounds, 3);
    assert.equal(limitedReply.evidence.tool_round_limit_reached, true);
    assert.equal(listConversationActions(sessionId).filter((action) => action.tool_call_id.startsWith("loop_")).length, 3);
    assert.equal(conversationRequests.at(-1)?.tools, undefined);
    assert.match(String(conversationRequests.at(-1)?.system || ""), /tool budget is exhausted/i);

    updateSkillWorkspaceProfile("default", { auto_activation: false });
    responseMode = "desktop_retry";
    await assert.rejects(
      () => generateProviderConversationReply({
        session,
        messages: listSessionMessages(sessionId),
        fetchImpl: providerFetch,
        onDesktopCapability: async (request) => {
          const result = await postJson(
            `${server.baseUrl}/api/internal/desktop/sessions/${sessionId}/conversation-actions/${request.action_id}/result`,
            {
              status: "failed",
              code: "desktop_application_not_found",
              application_name: "Test App",
            },
            { authorization: "Bearer desktop-retry-secret" },
          );
          assert.equal(result.status, 200);
        },
      }),
      (error: unknown) => (error as { code?: string }).code === "conversation_desktop_action_limit",
    );
    assert.equal(
      listConversationActions(sessionId).filter((action) => action.tool_call_id.startsWith("desktop_retry_")).length,
      1,
    );
  } finally {
    await server.close();
  }
});

test("Conversation Agent throttles oversized parallel tool batches without failing the long task", async () => {
  resetTestRoot();
  const conversationRequests: Array<Record<string, any>> = [];
  let conversationRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationRequests.push(body);
    conversationRound += 1;
    if (conversationRound === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "tool_use",
        content: Array.from({ length: 17 }, (_, index) => ({
          type: "tool_use",
          id: `parallel_clock_${index + 1}`,
          name: "system_clock_read",
          input: {},
        })),
        usage: { input_tokens: 12, output_tokens: 34 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "The bounded batch completed and the task continued." }],
      usage: { input_tokens: 24, output_tokens: 9 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await registerVerifiedConnection({
      baseUrl: server.baseUrl,
      connectionId: "parallel-tool-batch-provider",
      protocol: "anthropic-messages",
      provider: "anthropic-compatible",
      model: "glm-5.2",
    });
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Inspect many independent facts and then finish the task.",
      provider_connection_id: "parallel-tool-batch-provider",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const session = getSession(sessionId);
    assert.ok(session);

    const reply = await generateProviderConversationReply({
      session,
      messages: listSessionMessages(sessionId),
      fetchImpl: providerFetch,
    });

    assert.equal(reply.text, "The bounded batch completed and the task continued.");
    assert.equal(reply.evidence.tool_rounds, 1);
    assert.equal(reply.evidence.action_ids.length, 16);
    assert.equal(listConversationActions(sessionId).length, 16);
    const followUpBlocks = (conversationRequests[1]?.messages as Array<Record<string, any>>)
      .flatMap((message) => Array.isArray(message.content) ? message.content : []);
    assert.equal(followUpBlocks.filter((block) => block.type === "tool_result").length, 17);
    assert.match(
      String(followUpBlocks.find((block) => block.tool_use_id === "parallel_clock_17")?.content || ""),
      /tool_call_batch_limit/u,
    );
  } finally {
    await server.close();
  }
});

test("OpenAI streaming Conversation Agent assembles tool deltas and resumes with a native tool result", async () => {
  resetTestRoot();
  const conversationRequests: Array<Record<string, any>> = [];
  let conversationRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
    if (body.stream !== true) {
      return new Response(JSON.stringify({
        model: "gpt-test",
        choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationRequests.push(body);
    conversationRound += 1;
    if (conversationRound === 1) {
      return new Response([
        'data: {"model":"gpt-test","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_host_1","type":"function","function":{"name":"system_host_info","arguments":"{"}}]},"finish_reason":null}]}\n\n',
        'data: {"model":"gpt-test","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":8,"completion_tokens":3}}\n\n',
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response([
      'data: {"model":"gpt-test","choices":[{"delta":{"content":"Host information is available."},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":5}}\n\n',
      "data: [DONE]\n\n",
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await registerVerifiedConnection({
      baseUrl: server.baseUrl,
      connectionId: "openai-tool-loop",
      protocol: "openai-compatible",
      provider: "openai-compatible",
      model: "gpt-test",
    });
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Which operating system is this?",
      provider_connection_id: "openai-tool-loop",
      model: "gpt-test",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const session = getSession(sessionId);
    assert.ok(session);
    const deltas: string[] = [];
    const reply = await streamProviderConversationReply({
      session,
      messages: listSessionMessages(sessionId),
      fetchImpl: providerFetch,
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });
    assert.equal(reply.text, "Host information is available.");
    assert.deepEqual(deltas, ["Host information is available."]);
    assert.equal(reply.evidence.tool_rounds, 1);
    assert.ok(Array.isArray(conversationRequests[0]?.tools));
    const followUpMessages = conversationRequests[1]?.messages as Array<Record<string, any>>;
    assert.equal(followUpMessages.some((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "call_host_1"), true);
    const toolResult = followUpMessages.find((message) => message.role === "tool");
    assert.equal(toolResult?.tool_call_id, "call_host_1");
    assert.match(String(toolResult?.content || ""), /platform/);
  } finally {
    await server.close();
  }
});

test("tool-backed Conversation Agent repairs a progress-only stop into a complete final answer", async () => {
  resetTestRoot();
  const conversationRequests: Array<Record<string, any>> = [];
  let conversationRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
    if (body.stream !== true) {
      return new Response(JSON.stringify({
        model: "gpt-test",
        choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationRequests.push(body);
    conversationRound += 1;
    if (conversationRound === 1) {
      return new Response([
        'data: {"model":"gpt-test","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_host_research","type":"function","function":{"name":"system_host_info","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (conversationRound === 2) {
      return new Response([
        'data: {"model":"gpt-test","choices":[{"delta":{"content":"搜索结果找到了一些信息，让我再搜集一些更多框架的信息。"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response([
      'data: {"model":"gpt-test","choices":[{"delta":{"content":"建议采用持久化状态图，并优先评估 LangGraph、AutoGen 和 CrewAI；生产系统还需要幂等、预算、审批和故障恢复。"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await registerVerifiedConnection({
      baseUrl: server.baseUrl,
      connectionId: "semantic-finalization-provider",
      protocol: "openai-compatible",
      provider: "openai-compatible",
      model: "gpt-test",
    });
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Recommend an open-source multi-Agent DAG framework.",
      provider_connection_id: "semantic-finalization-provider",
      model: "gpt-test",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const session = getSession(sessionId);
    assert.ok(session);
    const reply = await streamProviderConversationReply({
      session,
      messages: listSessionMessages(sessionId),
      fetchImpl: providerFetch,
      onDelta: () => {},
    });
    assert.match(reply.text, /LangGraph、AutoGen 和 CrewAI/u);
    assert.equal(reply.evidence.tool_rounds, 1);
    assert.equal(reply.evidence.semantic_repair_rounds, 1);
    assert.equal(reply.evidence.continuation_rounds, 1);
    assert.equal(conversationRequests.length, 3);
    assert.match(String(conversationRequests[2]?.messages?.at(-1)?.content || ""), /complete, self-contained final answer/i);
    assert.equal(Array.isArray(conversationRequests[2]?.tools), false);
  } finally {
    await server.close();
  }
});

test("OpenAI streaming Conversation Agent finalizes without tools when its tool budget is exhausted", async () => {
  resetTestRoot();
  const conversationRequests: Array<Record<string, any>> = [];
  let conversationRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
    if (body.stream !== true) {
      return new Response(JSON.stringify({
        model: "gpt-test",
        choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationRequests.push(body);
    conversationRound += 1;
    if (Array.isArray(body.tools)) {
      const toolId = `stream_budget_${conversationRound}`;
      return new Response([
        `data: ${JSON.stringify({
          model: "gpt-test",
          choices: [{
            delta: { tool_calls: [{ index: 0, id: toolId, type: "function", function: { name: "system_clock_read", arguments: "{}" } }] },
            finish_reason: "tool_calls",
          }],
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response([
      `data: ${JSON.stringify({
        model: "gpt-test",
        choices: [{ delta: { content: "Tool research is complete; here is the final answer." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 9 },
      })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await registerVerifiedConnection({
      baseUrl: server.baseUrl,
      connectionId: "openai-stream-budget",
      protocol: "openai-compatible",
      provider: "openai-compatible",
      model: "gpt-test",
    });
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Research until the configured tool budget is reached.",
      provider_connection_id: "openai-stream-budget",
      model: "gpt-test",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const session = getSession(sessionId);
    assert.ok(session);
    const deltas: string[] = [];
    const reply = await streamProviderConversationReply({
      session,
      messages: listSessionMessages(sessionId),
      fetchImpl: providerFetch,
      onDelta: (delta) => { deltas.push(delta); },
    });
    assert.equal(reply.text, "Tool research is complete; here is the final answer.");
    assert.deepEqual(deltas, ["Tool research is complete; here is the final answer."]);
    assert.equal(reply.evidence.tool_rounds, 3);
    assert.equal(reply.evidence.tool_round_limit_reached, true);
    assert.equal(conversationRequests.length, 4);
    assert.ok(Array.isArray(conversationRequests[2]?.tools));
    assert.equal(conversationRequests[3]?.tools, undefined);
    assert.match(String(conversationRequests[3]?.messages?.[0]?.content || ""), /tool budget is exhausted/i);
  } finally {
    await server.close();
  }
});

test("Conversation Workspace tools enforce binding, traversal, sensitive-file, symlink, and size boundaries", async () => {
  resetTestRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-conversation-tools-"));
  const outside = path.join(os.tmpdir(), `my-mate-outside-${Date.now()}.txt`);
  fs.writeFileSync(path.join(root, "notes.txt"), "trusted workspace text", "utf-8");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=not-readable", "utf-8");
  fs.writeFileSync(path.join(root, "large.txt"), Buffer.alloc(256 * 1024 + 1, 65));
  fs.writeFileSync(outside, "outside", "utf-8");
  let symlinkCreated = false;
  try {
    fs.symlinkSync(outside, path.join(root, "outside-link.txt"), "file");
    symlinkCreated = true;
  } catch {
    // Some Windows environments do not grant symlink creation privileges.
  }
  try {
    const session = createSession({ initial_message: "Inspect files", created_by: "test" });
    registerWorkspaceBinding({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      desktopInstanceId: "desktop-test",
      capabilityId: "capability-test",
      rootPath: root,
      access: "snapshot-read",
      scope: "session",
    });
    const run = (call: ConversationToolCall) => executeConversationTool({ session, call });
    const hardware = await run({ id: "hardware-1", name: "system_hardware_info", arguments: {} });
    assert.equal(hardware.is_error, false);
    assert.equal(Number((hardware.content.cpu as Record<string, unknown>)?.logical_processors) > 0, true);
    const recycleBin = await run({ id: "recycle-1", name: "system_recycle_bin_inspect", arguments: { max_items: 0 } });
    assert.equal(typeof recycleBin.content.ok, "boolean");
    const listed = await run({ id: "list-1", name: "workspace_list", arguments: { path: "." } });
    assert.equal(listed.is_error, false);
    assert.doesNotMatch(JSON.stringify(listed.content), new RegExp(root.replaceAll("\\", "\\\\"), "u"));
    assert.equal(JSON.stringify(listed.content).includes(".env"), false);
    const read = await run({ id: "read-1", name: "workspace_read_text", arguments: { path: "notes.txt" } });
    assert.equal(read.content.content, "trusted workspace text");
    const traversal = await run({ id: "read-2", name: "workspace_read_text", arguments: { path: "../outside.txt" } });
    assert.equal(traversal.content.code, "workspace_path_invalid");
    const sensitive = await run({ id: "read-3", name: "workspace_read_text", arguments: { path: ".env" } });
    assert.equal(sensitive.content.code, "workspace_path_sensitive");
    const oversized = await run({ id: "read-4", name: "workspace_read_text", arguments: { path: "large.txt" } });
    assert.equal(oversized.content.code, "workspace_file_too_large");
    if (symlinkCreated) {
      const symlink = await run({ id: "read-5", name: "workspace_read_text", arguments: { path: "outside-link.txt" } });
      assert.equal(symlink.content.code, "workspace_symlink_rejected");
    }
    const webSession = createSession({ initial_message: "Inspect files in web", created_by: "test" });
    const unavailable = await executeConversationTool({
      session: webSession,
      call: { id: "read-web", name: "workspace_list", arguments: {} },
    });
    assert.equal(unavailable.content.code, "workspace_unavailable");
    assert.equal(listConversationActions(session.session_id).filter((action) => action.status === "failed").length >= 3, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test("Desktop privately attests a pending application Action before Conversation can claim success", async () => {
  resetTestRoot();
  const session = createSession({ initial_message: "Open Test App", created_by: "test" });
  const action = markConversationActionPendingApproval(createConversationAction({
    workspaceId: session.workspace_id || "default",
    sessionId: session.session_id,
    toolCallId: "desktop-call-1",
    toolName: "desktop_application_open",
    arguments: { application_name: "Test App" },
    riskLevel: "T2",
  }));
  const server = await startTestServer({ desktopBridgeToken: "desktop-action-secret" });
  try {
    const unauthorized = await postJson(
      `${server.baseUrl}/api/internal/desktop/sessions/${session.session_id}/conversation-actions/${action.action_id}/result`,
      { status: "succeeded", application_name: "Test App" },
    );
    assert.equal(unauthorized.status, 401);
    const attested = await postJson(
      `${server.baseUrl}/api/internal/desktop/sessions/${session.session_id}/conversation-actions/${action.action_id}/result`,
      { status: "succeeded", application_name: "Test App" },
      { authorization: "Bearer desktop-action-secret" },
    );
    assert.equal(attested.status, 200);
    assert.equal(getConversationAction(session.session_id, action.action_id)?.status, "succeeded");
    assert.equal(getConversationAction(session.session_id, action.action_id)?.result?.desktop_attested, true);
  } finally {
    await server.close();
  }
});

test("Desktop privately attests registered browser capability results", async () => {
  resetTestRoot();
  const host = getCapabilityPluginHost();
  host.resetForTests();
  host.discover();
  const session = createSession({ initial_message: "Read example.com", created_by: "test" });
  const action = createConversationAction({
    workspaceId: session.workspace_id || "default",
    sessionId: session.session_id,
    toolCallId: "browser-call-1",
    toolName: "browser_snapshot",
    arguments: { browser_session_id: "browser-test" },
    riskLevel: "T0",
    executor: "browser",
  });
  const server = await startTestServer({ desktopBridgeToken: "desktop-browser-secret" });
  try {
    const mismatch = await postJson(
      `${server.baseUrl}/api/internal/desktop/sessions/${session.session_id}/conversation-actions/${action.action_id}/result`,
      { status: "succeeded", capability_id: "browser_close", result: { closed: true } },
      { authorization: "Bearer desktop-browser-secret" },
    );
    assert.equal(mismatch.status, 400);
    const attested = await postJson(
      `${server.baseUrl}/api/internal/desktop/sessions/${session.session_id}/conversation-actions/${action.action_id}/result`,
      {
        status: "succeeded",
        capability_id: "browser_snapshot",
        result: { url: "https://example.com/", title: "Example Domain" },
      },
      { authorization: "Bearer desktop-browser-secret" },
    );
    assert.equal(attested.status, 200);
    assert.equal(getConversationAction(session.session_id, action.action_id)?.result?.desktop_attested, true);
    assert.equal(getConversationAction(session.session_id, action.action_id)?.result?.capability_id, "browser_snapshot");
    const toolResult = await executeConversationTool({
      session,
      call: {
        id: "browser-call-2",
        name: "browser_close",
        arguments: { browser_session_id: "browser-session-2" },
      },
      onDesktopCapability: async (request) => {
        assert.equal(request.type, "capability.execute");
        assert.equal(request.executor, "browser");
        const response = await postJson(
          `${server.baseUrl}/api/internal/desktop/sessions/${session.session_id}/conversation-actions/${request.action_id}/result`,
          {
            status: "succeeded",
            capability_id: request.capability_id,
            result: { browser_session_id: "browser-session-2", closed: true },
          },
          { authorization: "Bearer desktop-browser-secret" },
        );
        assert.equal(response.status, 200);
      },
    });
    assert.equal(toolResult.is_error, false);
    assert.equal(toolResult.content.desktop_attested, true);
  } finally {
    await server.close();
    host.resetForTests();
  }
});
