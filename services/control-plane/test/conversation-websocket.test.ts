import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { ConversationWebSocketHub } from "../src/conversation-websocket.js";
import { getJson, postJson, resetTestRoot } from "./helpers.js";

async function listen(server: http.Server): Promise<number> {
  return await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Server address unavailable.");
      resolve(address.port);
    });
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("conversation WebSocket streams Provider deltas and persists the completed reply", async () => {
  resetTestRoot();
  let streamRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (body.stream === true) {
      streamRound += 1;
      if (streamRound === 1) {
        return new Response([
          'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":8}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"ws-app-1","name":"desktop_application_open","input":{"application_name":"Test App"}}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":2}}\n\n',
        ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response([
        'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":12}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Incremental "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"reply"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({
      model: "glm-5.2",
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = createApp({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
    desktopBridgeToken: "desktop-action-secret",
  });
  const server = http.createServer(app);
  const hub = new ConversationWebSocketHub({
    security: app.locals.conversationSecurity,
    turnHandler: app.locals.streamConversationTurn,
  });
  hub.attach(server);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await postJson(`${baseUrl}/api/registry/provider-connections`, {
      connection_id: "ws-glm",
      name: "WebSocket GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "ws-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${baseUrl}/api/registry/provider-connections/ws-glm/test`, {});
    const created = await postJson(`${baseUrl}/api/sessions`, {
      initial_message: "Start a streamed conversation",
      provider_connection_id: "ws-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = created.body.session.session_id as string;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${sessionId}/conversation`);
    const events: Array<Record<string, unknown>> = [];
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const completed = new Promise<void>((resolve, reject) => {
        socket.on("message", (data) => {
          const event = JSON.parse(data.toString()) as Record<string, unknown>;
          events.push(event);
          if (event.type === "conversation.desktop_action") {
            void postJson(
              `${baseUrl}/api/internal/desktop/sessions/${sessionId}/conversation-actions/${String(event.action_id)}/result`,
              { status: "succeeded", application_name: "Test App" },
              { authorization: "Bearer desktop-action-secret" },
            ).then((attested) => {
              if (attested.status !== 200) throw new Error("Desktop attestation failed.");
              socket.send(JSON.stringify({
                type: "conversation.desktop_result",
                capability_request_id: event.capability_request_id,
                action_id: event.action_id,
              }));
            }).catch(reject);
          }
          if (event.type === "conversation.completed") resolve();
          if (event.type === "conversation.error") reject(new Error(String(event.message || "failed")));
        });
      });
      socket.send(JSON.stringify({
        type: "conversation.send",
        request_id: "ws-turn-1",
        resume_latest_user: true,
        provider_connection_id: "ws-glm",
        model: "glm-5.2",
      }));
      await completed;
      assert.deepEqual(
        events.filter((event) => event.type === "conversation.delta").map((event) => event.delta),
        ["Incremental ", "reply"],
      );
      assert.deepEqual(
        events.filter((event) => event.type === "conversation.tool").map((event) => event.status),
        ["running", "pending_approval", "succeeded"],
      );
      assert.equal(
        events.filter((event) => event.type === "conversation.tool").every((event) => !("root_path" in event)),
        true,
      );
      const detail = await getJson(`${baseUrl}/api/sessions/${sessionId}`);
      const reply = (detail.body.messages as Array<Record<string, any>>)
        .find((message) => message.role === "orchestrator" && message.kind === "text");
      assert.equal(reply?.content.text, "Incremental reply");
      assert.equal(reply?.content.response_source, "provider");
    } finally {
      socket.close();
    }
  } finally {
    hub.close();
    await close(server);
  }
});

test("conversation WebSocket returns a download link instead of streaming generated file contents", async () => {
  resetTestRoot();
  let conversationCalls = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationCalls += 1;
    const text = conversationCalls === 1
      ? "好的，我现在开始生成。"
      : '<my-mate-file name="notes-zh.md">\n# 中文内容\n\n完整正文\n</my-mate-file>';
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":20}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":30}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const app = createApp({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  const server = http.createServer(app);
  const hub = new ConversationWebSocketHub({
    security: app.locals.conversationSecurity,
    turnHandler: app.locals.streamConversationTurn,
  });
  hub.attach(server);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await postJson(`${baseUrl}/api/registry/provider-connections`, {
      connection_id: "ws-file-glm",
      name: "WebSocket File GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "ws-file-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${baseUrl}/api/registry/provider-connections/ws-file-glm/test`, {});
    const created = await postJson(`${baseUrl}/api/sessions`, {
      initial_message: "Translate an attachment",
      provider_connection_id: "ws-file-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = created.body.session.session_id as string;
    await postJson(`${baseUrl}/api/sessions/${sessionId}/attachments`, {
      name: "notes-en.md",
      storage_uri: "studio-upload://notes-en.md",
      kind: "context",
      metadata: {
        source: "studio_conversation_upload",
        uploaded_text_content: "# Notes\n\nComplete source.",
      },
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${sessionId}/conversation`);
    const events: Array<Record<string, any>> = [];
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const completed = new Promise<void>((resolve, reject) => {
        socket.on("message", (data) => {
          const event = JSON.parse(data.toString()) as Record<string, any>;
          events.push(event);
          if (event.type === "conversation.completed") resolve();
          if (event.type === "conversation.error") reject(new Error(String(event.message || "failed")));
        });
      });
      socket.send(JSON.stringify({
        type: "conversation.send",
        request_id: "ws-file-turn-1",
        content: "请把这个文件翻译成中文，并生成文件给我。",
        provider_connection_id: "ws-file-glm",
        model: "glm-5.2",
      }));
      await completed;
      const deltas = events
        .filter((event) => event.type === "conversation.delta")
        .map((event) => String(event.delta || ""));
      assert.equal(deltas.length, 1);
      assert.match(deltas[0] || "", /download/i);
      assert.doesNotMatch(deltas[0] || "", /\u5b8c\u6574\u6b63\u6587/);
      const completedEvent = events.find((event) => event.type === "conversation.completed");
      assert.equal(completedEvent?.assistant_message?.content?.deliverable_status, "returned");
      const detail = await getJson(`${baseUrl}/api/sessions/${sessionId}`);
      assert.ok((detail.body.messages as Array<Record<string, any>>).some(
        (message) => message.kind === "artifact_card" && message.content?.name === "notes-zh.md",
      ));
    } finally {
      socket.close();
    }
  } finally {
    hub.close();
    await close(server);
  }
});

test("conversation WebSocket keeps a turn running across disconnect and reattaches to its Session", async () => {
  resetTestRoot();
  let streamStarted = false;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (body.stream !== true) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    streamStarted = true;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":8}}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Still "}}\n\n',
        ].join("")));
        setTimeout(() => {
          controller.enqueue(encoder.encode([
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"running"}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
          ].join("")));
          controller.close();
        }, 200);
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const app = createApp({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  const server = http.createServer(app);
  const hub = new ConversationWebSocketHub({
    security: app.locals.conversationSecurity,
    turnHandler: app.locals.streamConversationTurn,
  });
  hub.attach(server);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await postJson(`${baseUrl}/api/registry/provider-connections`, {
      connection_id: "ws-reattach-glm",
      name: "WebSocket reattach GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "ws-reattach-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${baseUrl}/api/registry/provider-connections/ws-reattach-glm/test`, {});
    const created = await postJson(`${baseUrl}/api/sessions`, {
      initial_message: "Run through a network interruption",
      provider_connection_id: "ws-reattach-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = created.body.session.session_id as string;
    const url = `ws://127.0.0.1:${port}/api/sessions/${sessionId}/conversation`;
    const first = new WebSocket(url);
    let firstCursor = 0;
    await new Promise<void>((resolve, reject) => {
      first.once("open", resolve);
      first.once("error", reject);
    });
    const firstDelta = new Promise<void>((resolve, reject) => {
      first.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        if (event.type === "conversation.delta") {
          firstCursor = Number(event.sequence || 0);
          resolve();
        }
        if (event.type === "conversation.error") reject(new Error(String(event.message || "failed")));
      });
    });
    first.send(JSON.stringify({
      type: "conversation.send",
      request_id: "ws-reattach-turn-1",
      resume_latest_user: true,
      provider_connection_id: "ws-reattach-glm",
      model: "glm-5.2",
    }));
    await firstDelta;
    first.close(1000, "Simulated client network loss");
    await new Promise<void>((resolve) => first.once("close", () => resolve()));

    const second = new WebSocket(url);
    const events: Array<Record<string, any>> = [];
    try {
      await new Promise<void>((resolve, reject) => {
        second.once("open", resolve);
        second.once("error", reject);
      });
      const completed = new Promise<void>((resolve, reject) => {
        second.on("message", (data) => {
          const event = JSON.parse(data.toString()) as Record<string, any>;
          events.push(event);
          if (event.type === "conversation.completed") resolve();
          if (event.type === "conversation.error") reject(new Error(String(event.message || "failed")));
        });
      });
      assert.ok(firstCursor > 0);
      second.send(JSON.stringify({ type: "conversation.attach", after_sequence: firstCursor }));
      await completed;
      assert.equal(streamStarted, true);
      assert.equal(events.some((event) => event.type === "conversation.active"), true);
      assert.equal(events.filter((event) => typeof event.sequence === "number").every((event) => Number(event.sequence) > firstCursor), true);
      const completedEvent = events.find((event) => event.type === "conversation.completed");
      assert.equal(completedEvent?.assistant_message?.content?.text, "Still running");
      const detail = await getJson(`${baseUrl}/api/sessions/${sessionId}`);
      assert.equal(detail.body.task_checkpoint?.status, "completed");
      assert.notEqual(detail.body.task_checkpoint?.reason, "client_disconnected");
    } finally {
      second.close();
    }
  } finally {
    hub.close();
    await close(server);
  }
});
