import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type { GatewayConfig } from "./config.js";
import { encodeSignedIdentity, resolveRequestIdentity } from "./identity.js";

interface ClientConversationMessage extends Record<string, unknown> {
  auth?: {
    token?: string;
    workspace_id?: string;
  };
}

function isConversationPath(req: IncomingMessage): boolean {
  const url = new URL(req.url || "/", "http://gateway.local");
  return /^\/api\/sessions\/[^/]+\/conversation$/u.test(url.pathname);
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}\n`,
  );
  socket.destroy();
}

function rawText(data: RawData): string {
  return Array.isArray(data)
    ? Buffer.concat(data).toString("utf-8")
    : data instanceof ArrayBuffer
      ? Buffer.from(data).toString("utf-8")
      : Buffer.from(data).toString("utf-8");
}

function parseClientMessage(data: RawData): ClientConversationMessage | null {
  try {
    const parsed = JSON.parse(rawText(data)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ClientConversationMessage
      : null;
  } catch {
    return null;
  }
}

function sanitizedMessage(message: ClientConversationMessage): string {
  const { auth: _auth, ...payload } = message;
  return JSON.stringify(payload);
}

function sendError(socket: WebSocket, code: string, message: string, requestId?: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: "conversation.error",
    code,
    message,
    ...(typeof requestId === "string" ? { request_id: requestId } : {}),
  }));
}

function upstreamUrl(req: IncomingMessage, config: GatewayConfig): string {
  const target = new URL(req.url || "/", config.controlPlaneBaseUrl);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.search = "";
  return target.toString();
}

export class ConversationWebSocketProxy {
  private readonly server = new WebSocketServer({ noServer: true });
  private attached = false;

  constructor(private readonly config: GatewayConfig) {}

  attach(httpServer: HttpServer): void {
    if (this.attached) return;
    this.attached = true;
    httpServer.on("upgrade", (req, socket, head) => {
      if (!isConversationPath(req)) return;
      this.server.handleUpgrade(req, socket, head, (webSocket) => {
        this.handleConnection(req, webSocket);
      });
    });
  }

  close(): void {
    this.server.close();
  }

  private handleConnection(req: IncomingMessage, client: WebSocket): void {
    let upstream: WebSocket | null = null;
    let authenticated = false;
    const pending: string[] = [];

    const connect = (message: ClientConversationMessage): boolean => {
      const token = typeof message.auth?.token === "string" ? message.auth.token : "";
      const workspaceId =
        typeof message.auth?.workspace_id === "string" ? message.auth.workspace_id : "";
      const resolution = resolveRequestIdentity({
        header: (name) => {
          const normalized = name.toLowerCase();
          if (normalized === "authorization") return token ? `Bearer ${token}` : undefined;
          if (normalized === "x-my-mate-workspace-id") return workspaceId || undefined;
          if (normalized === "x-request-id") {
            return typeof message.request_id === "string" ? message.request_id : undefined;
          }
          return undefined;
        },
      }, this.config);
      if (!resolution.ok) {
        sendError(client, resolution.code, resolution.message, message.request_id);
        client.close(1008, resolution.message);
        return false;
      }

      authenticated = true;
      const signedIdentity = encodeSignedIdentity(
        resolution.context,
        this.config.internalAuthSecret,
      );
      upstream = new WebSocket(upstreamUrl(req, this.config), {
        headers: {
          "x-my-mate-gateway": "api-gateway",
          "x-my-mate-auth-context": signedIdentity.payload,
          "x-my-mate-auth-signature": signedIdentity.signature,
          "x-my-mate-workspace-id": resolution.context.selected_workspace.workspace_id,
          "x-request-id": resolution.context.request_id,
        },
      });
      upstream.on("open", () => {
        for (const item of pending.splice(0)) upstream?.send(item);
      });
      upstream.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });
      upstream.on("close", (code, reason) => {
        if (client.readyState === WebSocket.OPEN) client.close(code || 1011, reason.toString());
      });
      upstream.on("error", (error) => {
        sendError(client, "upstream_unavailable", error.message, message.request_id);
        if (client.readyState === WebSocket.OPEN) client.close(1011, "Control Plane unavailable");
      });
      return true;
    };

    client.on("message", (data) => {
      const message = parseClientMessage(data);
      if (!message) {
        sendError(client, "invalid_json", "Conversation command must be valid JSON.");
        return;
      }
      if (!authenticated && !connect(message)) return;
      const sanitized = sanitizedMessage(message);
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(sanitized);
      else pending.push(sanitized);
    });
    client.on("close", () => {
      if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close(1000, "Client closed");
    });
  }
}
