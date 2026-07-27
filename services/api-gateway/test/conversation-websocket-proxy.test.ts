import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { createApp } from "../src/app.js";
import { ConversationWebSocketProxy } from "../src/conversation-websocket-proxy.js";
import type { GatewayConfig } from "../src/config.js";

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

test("conversation WebSocket proxy authenticates once and strips client credentials upstream", async () => {
  const upstreamServer = http.createServer();
  const upstreamWebSocket = new WebSocketServer({ noServer: true });
  let resolveUpstreamObservation!: (value: {
    headers: http.IncomingHttpHeaders;
    message: Record<string, unknown>;
  }) => void;
  const upstreamObservation = new Promise<{
    headers: http.IncomingHttpHeaders;
    message: Record<string, unknown>;
  }>((resolve) => {
    resolveUpstreamObservation = resolve;
  });
  upstreamServer.on("upgrade", (req, socket, head) => {
    upstreamWebSocket.handleUpgrade(req, socket, head, (webSocket) => {
      webSocket.on("message", (data) => {
        const upstreamMessage = JSON.parse(data.toString()) as Record<string, unknown>;
        webSocket.send(JSON.stringify({
          type: "conversation.completed",
          request_id: upstreamMessage.request_id,
        }));
        resolveUpstreamObservation({ headers: req.headers, message: upstreamMessage });
      });
    });
  });
  const upstreamPort = await listen(upstreamServer);
  const config: GatewayConfig = {
    port: 0,
    controlPlaneBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    apiKey: "gateway-test-token",
    identities: [],
    internalAuthSecret: "gateway-internal-secret",
    requestTimeoutMs: 5_000,
  };
  const gatewayServer = http.createServer(createApp(config));
  const proxy = new ConversationWebSocketProxy(config);
  proxy.attach(gatewayServer);
  const gatewayPort = await listen(gatewayServer);
  const client = new WebSocket(
    `ws://127.0.0.1:${gatewayPort}/api/sessions/session-test/conversation`,
  );

  try {
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });
    const completed = new Promise<Record<string, unknown>>((resolve, reject) => {
      client.on("message", (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
      client.once("error", reject);
    });
    client.send(JSON.stringify({
      type: "conversation.send",
      request_id: "conversation-request-1",
      content: "Hello",
      auth: {
        token: "gateway-test-token",
        workspace_id: "default",
      },
    }));
    const [completedMessage, observed] = await Promise.all([completed, upstreamObservation]);
    assert.equal(completedMessage.type, "conversation.completed");
    assert.equal(observed.message.type, "conversation.send");
    assert.equal("auth" in observed.message, false);
    assert.equal(observed.headers["x-my-mate-gateway"], "api-gateway");
    assert.ok(observed.headers["x-my-mate-auth-context"]);
    assert.ok(observed.headers["x-my-mate-auth-signature"]);
    assert.equal(observed.headers.authorization, undefined);
  } finally {
    client.close();
    proxy.close();
    upstreamWebSocket.close();
    await close(gatewayServer);
    await close(upstreamServer);
  }
});

test("conversation WebSocket proxy converts abnormal upstream closure into a valid close frame", async () => {
  const upstreamServer = http.createServer();
  const upstreamWebSocket = new WebSocketServer({ noServer: true });
  upstreamServer.on("upgrade", (req, socket, head) => {
    upstreamWebSocket.handleUpgrade(req, socket, head, (webSocket) => {
      webSocket.once("message", () => webSocket.terminate());
    });
  });
  const upstreamPort = await listen(upstreamServer);
  const config: GatewayConfig = {
    port: 0,
    controlPlaneBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    apiKey: "gateway-test-token",
    identities: [],
    internalAuthSecret: "gateway-internal-secret",
    requestTimeoutMs: 5_000,
  };
  const gatewayServer = http.createServer(createApp(config));
  const proxy = new ConversationWebSocketProxy(config);
  proxy.attach(gatewayServer);
  const gatewayPort = await listen(gatewayServer);
  const client = new WebSocket(`ws://127.0.0.1:${gatewayPort}/api/sessions/session-test/conversation`);
  try {
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    const closed = new Promise<number>((resolve) => client.once("close", (code) => resolve(code)));
    client.send(JSON.stringify({
      type: "conversation.send",
      request_id: "conversation-abnormal-close",
      content: "Hello",
      auth: { token: "gateway-test-token", workspace_id: "default" },
    }));
    assert.equal(await closed, 1011);
  } finally {
    proxy.close();
    upstreamWebSocket.close();
    await close(gatewayServer);
    await close(upstreamServer);
  }
});
