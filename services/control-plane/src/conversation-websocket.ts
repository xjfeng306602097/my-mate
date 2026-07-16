import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type {
  ConversationStreamTurnInput,
  ConversationStreamTurnResult,
} from "./app.js";
import {
  resolveTrustedRequestContext,
  runWithRequestContext,
  type SecurityOptions,
} from "./request-security.js";

interface ConversationCommand {
  type: "conversation.send";
  request_id: string;
  content?: string;
  resume_latest_user?: boolean;
  provider_connection_id?: string;
  model?: string;
  target_artifact_id?: string;
}

interface ConversationSocketOptions {
  security: SecurityOptions;
  turnHandler: (input: ConversationStreamTurnInput) => Promise<ConversationStreamTurnResult>;
}

interface DesktopCapabilityResultCommand {
  type: "conversation.desktop_result";
  capability_request_id: string;
  action_id: string;
}

function isDesktopCapabilityResultCommand(value: unknown): value is DesktopCapabilityResultCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  return command.type === "conversation.desktop_result" &&
    typeof command.capability_request_id === "string" && !!command.capability_request_id.trim() &&
    typeof command.action_id === "string" && !!command.action_id.trim();
}

function parseJson(data: RawData): unknown {
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString("utf-8")
    : data instanceof ArrayBuffer
      ? Buffer.from(data).toString("utf-8")
      : Buffer.from(data).toString("utf-8");
  return JSON.parse(text) as unknown;
}

function isConversationCommand(value: unknown): value is ConversationCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  return (
    command.type === "conversation.send" &&
    typeof command.request_id === "string" &&
    !!command.request_id.trim() &&
    (typeof command.content === "string" || command.resume_latest_user === true) &&
    (command.provider_connection_id === undefined || typeof command.provider_connection_id === "string") &&
    (command.model === undefined || typeof command.model === "string") &&
    (command.target_artifact_id === undefined || typeof command.target_artifact_id === "string")
  );
}

function conversationSessionId(req: IncomingMessage): string | null {
  const url = new URL(req.url || "/", "http://conversation.local");
  const match = /^\/api\/sessions\/([^/]+)\/conversation$/u.exec(url.pathname);
  return match ? decodeURIComponent(match[1] || "") : null;
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}\n`,
  );
  socket.destroy();
}

function requestHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function send(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

export class ConversationWebSocketHub {
  private readonly server = new WebSocketServer({ noServer: true });
  private attached = false;

  constructor(private readonly options: ConversationSocketOptions) {}

  attach(httpServer: HttpServer): void {
    if (this.attached) return;
    this.attached = true;
    httpServer.on("upgrade", (req, socket, head) => {
      const sessionId = conversationSessionId(req);
      if (!sessionId) return;
      const resolution = resolveTrustedRequestContext(
        { header: (name) => requestHeader(req, name) },
        this.options.security,
      );
      if (!resolution.ok) {
        rejectUpgrade(socket, resolution.status, resolution.message);
        return;
      }
      if (!resolution.context.permissions.includes("mission.edit")) {
        rejectUpgrade(socket, 403, "Mission edit permission is required.");
        return;
      }
      this.server.handleUpgrade(req, socket, head, (webSocket) => {
        this.handleConnection(sessionId, webSocket, resolution.context);
      });
    });
  }

  close(): void {
    this.server.close();
  }

  private handleConnection(
    sessionId: string,
    socket: WebSocket,
    context: Parameters<typeof runWithRequestContext>[0],
  ): void {
    let messageChain = Promise.resolve();
    let activeController: AbortController | null = null;
    const desktopCapabilityWaiters = new Map<string, {
      actionId: string;
      resolve: () => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }>();
    send(socket, { type: "conversation.connected", session_id: sessionId });

    socket.on("message", (data) => {
      try {
        const immediate = parseJson(data);
        if (isDesktopCapabilityResultCommand(immediate)) {
          const waiter = desktopCapabilityWaiters.get(immediate.capability_request_id);
          if (!waiter || waiter.actionId !== immediate.action_id) return;
          clearTimeout(waiter.timeout);
          desktopCapabilityWaiters.delete(immediate.capability_request_id);
          waiter.resolve();
          return;
        }
      } catch {
        // The regular command path below reports invalid JSON consistently.
      }
      const run = async () => {
        let command: unknown;
        try {
          command = parseJson(data);
        } catch {
          send(socket, {
            type: "conversation.error",
            code: "invalid_json",
            message: "Conversation command must be valid JSON.",
          });
          return;
        }
        if (!isConversationCommand(command)) {
          send(socket, {
            type: "conversation.error",
            code: "invalid_command",
            message: "Unsupported conversation command.",
          });
          return;
        }

        activeController = new AbortController();
        try {
          const result = await runWithRequestContext(context, () =>
            this.options.turnHandler({
              sessionId,
              content: command.content,
              resumeLatestUser: command.resume_latest_user === true,
              providerConnectionId: command.provider_connection_id,
              model: command.model,
              targetArtifactId: command.target_artifact_id,
              signal: activeController?.signal,
              onStarted: ({ userMessage, providerConnectionId, model, checkpointId }) => {
                send(socket, {
                  type: "conversation.started",
                  request_id: command.request_id,
                  session_id: sessionId,
                  user_message: userMessage,
                  provider_connection_id: providerConnectionId,
                  model,
                  checkpoint_id: checkpointId,
                });
              },
              onDelta: (text) => {
                send(socket, {
                  type: "conversation.delta",
                  request_id: command.request_id,
                  session_id: sessionId,
                  delta: text,
                });
              },
              onToolProgress: (progress) => {
                send(socket, {
                  type: "conversation.tool",
                  request_id: command.request_id,
                  session_id: sessionId,
                  action_id: progress.action_id,
                  tool_name: progress.tool_name,
                  risk_level: progress.risk_level,
                  status: progress.status,
                  summary: progress.summary,
                });
              },
              onDesktopCapability: (request) => new Promise<void>((resolve, reject) => {
                const capabilityRequestId = `desktop_${randomUUID()}`;
                const timeout = setTimeout(() => {
                  desktopCapabilityWaiters.delete(capabilityRequestId);
                  reject(Object.assign(new Error("Desktop capability confirmation timed out."), {
                    code: "desktop_capability_timeout",
                  }));
                }, 120_000);
                desktopCapabilityWaiters.set(capabilityRequestId, {
                  actionId: request.action_id,
                  resolve,
                  reject,
                  timeout,
                });
                send(socket, {
                  type: "conversation.desktop_action",
                  request_id: command.request_id,
                  session_id: sessionId,
                  capability_request_id: capabilityRequestId,
                  action_id: request.action_id,
                  action_type: request.type,
                  application_name: request.application_name,
                  capability_id: request.capability_id,
                  executor: request.executor,
                  risk_level: request.risk_level,
                  arguments: request.arguments,
                });
              }),
            }),
          );
          send(socket, {
            type: "conversation.completed",
            request_id: command.request_id,
            session_id: sessionId,
            assistant_message: result.assistantMessage,
            session: result.session,
          });
        } catch (error) {
          send(socket, {
            type: "conversation.error",
            request_id: command.request_id,
            session_id: sessionId,
            code:
              error && typeof error === "object" && "code" in error
                ? String((error as { code?: unknown }).code || "conversation_failed")
                : "conversation_failed",
            message: error instanceof Error ? error.message : "Conversation failed.",
          });
        } finally {
          activeController = null;
        }
      };
      messageChain = messageChain.then(run, run);
    });

    socket.on("close", () => {
      activeController?.abort();
      for (const [capabilityRequestId, waiter] of desktopCapabilityWaiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("Desktop capability connection closed."));
        desktopCapabilityWaiters.delete(capabilityRequestId);
      }
    });
  }
}
