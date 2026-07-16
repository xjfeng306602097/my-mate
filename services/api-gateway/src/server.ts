import http from "node:http";
import { readConfig } from "./config.js";
import { createApp } from "./app.js";
import { ConversationWebSocketProxy } from "./conversation-websocket-proxy.js";

const config = readConfig();
export function createGatewayRuntimeServer() {
  const app = createApp(config);
  const server = http.createServer(app);
  const conversationProxy = new ConversationWebSocketProxy(config);
  conversationProxy.attach(server);
  return { app, server, conversationProxy };
}

const runtime = createGatewayRuntimeServer();

runtime.server.listen(config.port, () => {
  console.log(`My Mate API gateway listening on http://localhost:${config.port}`);
});

function shutdown(): void {
  runtime.conversationProxy.close();
  runtime.server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
