import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  appendConversationEvent,
  latestConversationEventSequence,
  listConversationEvents,
  subscribeConversationEvents,
  type ConversationEventRecord,
} from "./conversation-event-store.js";
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

interface ConversationAttachCommand {
  type: "conversation.attach";
  after_sequence?: number;
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

interface DesktopCapabilityWaiter {
  sessionId: string;
  actionId: string;
  payload: Record<string, unknown>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ActiveConversationTurn {
  requestId: string;
  controller: AbortController;
  providerConnectionId: string;
  model: string;
  checkpointId: string;
  partialText: string;
  toolProgress: Map<string, Record<string, unknown>>;
  startedAt: string;
}

interface ConversationSessionRuntime {
  workspaceId: string;
  sockets: Set<WebSocket>;
  commandChain: Promise<void>;
  activeTurn: ActiveConversationTurn | null;
  terminalEvent: Record<string, unknown> | null;
  cleanupTimer: NodeJS.Timeout | null;
  eventUnsubscribe: (() => void) | null;
}

const MAX_ACTIVE_TEXT_CHARACTERS = 200_000;

function isDesktopCapabilityResultCommand(value: unknown): value is DesktopCapabilityResultCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  return command.type === "conversation.desktop_result" &&
    typeof command.capability_request_id === "string" && !!command.capability_request_id.trim() &&
    typeof command.action_id === "string" && !!command.action_id.trim();
}

function isConversationAttachCommand(value: unknown): value is ConversationAttachCommand {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "conversation.attach";
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
  private readonly sessions = new Map<string, ConversationSessionRuntime>();
  private readonly desktopCapabilityWaiters = new Map<string, DesktopCapabilityWaiter>();
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
    for (const runtime of this.sessions.values()) {
      if (runtime.cleanupTimer) clearTimeout(runtime.cleanupTimer);
      runtime.eventUnsubscribe?.();
      runtime.eventUnsubscribe = null;
      runtime.activeTurn?.controller.abort(new Error("Conversation WebSocket Hub is shutting down."));
      for (const socket of runtime.sockets) {
        if (socket.readyState < WebSocket.CLOSING) socket.close(1012, "Conversation service restarting");
      }
    }
    for (const [capabilityRequestId, waiter] of this.desktopCapabilityWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Conversation WebSocket Hub is shutting down."));
      this.desktopCapabilityWaiters.delete(capabilityRequestId);
    }
    this.sessions.clear();
    this.server.close();
  }

  private sessionRuntime(sessionId: string, workspaceId = "default"): ConversationSessionRuntime {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: ConversationSessionRuntime = {
      workspaceId,
      sockets: new Set(),
      commandChain: Promise.resolve(),
      activeTurn: null,
      terminalEvent: null,
      cleanupTimer: null,
      eventUnsubscribe: null,
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  private broadcast(sessionId: string, payload: Record<string, unknown>): void {
    for (const socket of this.sessions.get(sessionId)?.sockets || []) send(socket, payload);
  }

  private sendPersisted(socket: WebSocket, event: ConversationEventRecord): void {
    send(socket, { ...event.payload, sequence: event.sequence });
  }

  private publish(sessionId: string, payload: Record<string, unknown>, idempotencyKey?: string | null): void {
    appendConversationEvent({
      workspaceId: this.sessionRuntime(sessionId).workspaceId,
      sessionId,
      type: String(payload.type || "conversation.event"),
      payload,
      idempotencyKey,
    });
  }

  private subscribeRuntime(sessionId: string, runtime: ConversationSessionRuntime): void {
    if (runtime.eventUnsubscribe) return;
    runtime.eventUnsubscribe = subscribeConversationEvents(sessionId, (event) => {
      for (const socket of runtime.sockets) this.sendPersisted(socket, event);
    });
  }

  private replay(sessionId: string, socket: WebSocket, afterSequence: number): void {
    for (const event of listConversationEvents({
      workspaceId: this.sessionRuntime(sessionId).workspaceId,
      sessionId,
      afterSequence,
      limit: 1_000,
    })) this.sendPersisted(socket, event);
  }

  private sendActiveSnapshot(sessionId: string, socket: WebSocket): void {
    const active = this.sessions.get(sessionId)?.activeTurn;
    if (!active) {
      const terminalEvent = this.sessions.get(sessionId)?.terminalEvent;
      if (terminalEvent) {
        send(socket, terminalEvent);
        return;
      }
      send(socket, { type: "conversation.idle", session_id: sessionId });
      return;
    }
    send(socket, {
      type: "conversation.active",
      session_id: sessionId,
      request_id: active.requestId,
      provider_connection_id: active.providerConnectionId,
      model: active.model,
      checkpoint_id: active.checkpointId,
      partial_text: active.partialText,
      tool_progress: [...active.toolProgress.values()],
      started_at: active.startedAt,
      latest_sequence: latestConversationEventSequence(sessionId, this.sessions.get(sessionId)?.workspaceId || "default"),
    });
    for (const waiter of this.desktopCapabilityWaiters.values()) {
      if (waiter.sessionId === sessionId) send(socket, waiter.payload);
    }
  }

  private resolveDesktopCapability(command: DesktopCapabilityResultCommand): void {
    const waiter = this.desktopCapabilityWaiters.get(command.capability_request_id);
    if (!waiter || waiter.actionId !== command.action_id) return;
    clearTimeout(waiter.timeout);
    this.desktopCapabilityWaiters.delete(command.capability_request_id);
    waiter.resolve();
  }

  private handleConnection(
    sessionId: string,
    socket: WebSocket,
    context: Parameters<typeof runWithRequestContext>[0],
  ): void {
    const runtime = this.sessionRuntime(sessionId, context.selected_workspace.workspace_id);
    runtime.sockets.add(socket);
    this.subscribeRuntime(sessionId, runtime);
    send(socket, {
      type: "conversation.connected",
      session_id: sessionId,
      active: Boolean(runtime.activeTurn),
      latest_sequence: latestConversationEventSequence(sessionId, runtime.workspaceId),
    });

    socket.on("message", (data) => {
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
      if (isDesktopCapabilityResultCommand(command)) {
        this.resolveDesktopCapability(command);
        return;
      }
      if (isConversationAttachCommand(command)) {
        if (Number.isInteger(command.after_sequence)) {
          this.replay(sessionId, socket, Math.max(0, command.after_sequence || 0));
        }
        this.sendActiveSnapshot(sessionId, socket);
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

      const run = async () => {
        if (runtime.cleanupTimer) {
          clearTimeout(runtime.cleanupTimer);
          runtime.cleanupTimer = null;
        }
        runtime.terminalEvent = null;
        const activeTurn: ActiveConversationTurn = {
          requestId: command.request_id,
          controller: new AbortController(),
          providerConnectionId: command.provider_connection_id || "",
          model: command.model || "",
          checkpointId: "",
          partialText: "",
          toolProgress: new Map(),
          startedAt: new Date().toISOString(),
        };
        runtime.activeTurn = activeTurn;
        try {
          const result = await runWithRequestContext(context, () =>
            this.options.turnHandler({
              sessionId,
              content: command.content,
              resumeLatestUser: command.resume_latest_user === true,
              providerConnectionId: command.provider_connection_id,
              model: command.model,
              targetArtifactId: command.target_artifact_id,
              signal: activeTurn.controller.signal,
              onStarted: ({ userMessage, providerConnectionId, model, checkpointId }) => {
                activeTurn.providerConnectionId = providerConnectionId || "";
                activeTurn.model = model || "";
                activeTurn.checkpointId = checkpointId;
                this.publish(sessionId, {
                  type: "conversation.started",
                  request_id: command.request_id,
                  session_id: sessionId,
                  user_message: userMessage,
                  provider_connection_id: providerConnectionId,
                  model,
                  checkpoint_id: checkpointId,
                }, `conversation.started:${command.request_id}`);
              },
              onDelta: (text) => {
                activeTurn.partialText = `${activeTurn.partialText}${text}`.slice(-MAX_ACTIVE_TEXT_CHARACTERS);
                this.publish(sessionId, {
                  type: "conversation.delta",
                  request_id: command.request_id,
                  session_id: sessionId,
                  delta: text,
                });
              },
              onToolProgress: (progress) => {
                const payload = {
                  type: "conversation.tool",
                  request_id: command.request_id,
                  session_id: sessionId,
                  action_id: progress.action_id,
                  tool_name: progress.tool_name,
                  risk_level: progress.risk_level,
                  status: progress.status,
                  summary: progress.summary,
                };
                activeTurn.toolProgress.set(progress.action_id, payload);
                this.publish(sessionId, payload, `conversation.tool:${progress.action_id}:${progress.status}`);
              },
              onDesktopCapability: (request) => new Promise<void>((resolve, reject) => {
                const capabilityRequestId = `desktop_${randomUUID()}`;
                const payload = {
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
                  workspace_access: request.workspace_access,
                  workspace_scope: request.workspace_scope,
                };
                const timeout = setTimeout(() => {
                  this.desktopCapabilityWaiters.delete(capabilityRequestId);
                  reject(Object.assign(new Error("Desktop capability confirmation timed out."), {
                    code: "desktop_capability_timeout",
                  }));
                }, 120_000);
                this.desktopCapabilityWaiters.set(capabilityRequestId, {
                  sessionId,
                  actionId: request.action_id,
                  payload,
                  resolve,
                  reject,
                  timeout,
                });
                this.publish(sessionId, payload, `conversation.desktop_action:${capabilityRequestId}`);
              }),
            }),
          );
          runtime.terminalEvent = {
            type: "conversation.completed",
            request_id: command.request_id,
            session_id: sessionId,
            assistant_message: result.assistantMessage,
            session: result.session,
          };
          this.publish(sessionId, runtime.terminalEvent, `conversation.completed:${command.request_id}`);
        } catch (error) {
          runtime.terminalEvent = {
            type: "conversation.error",
            request_id: command.request_id,
            session_id: sessionId,
            code:
              error && typeof error === "object" && "code" in error
                ? String((error as { code?: unknown }).code || "conversation_failed")
                : "conversation_failed",
            message: error instanceof Error ? error.message : "Conversation failed.",
          };
          this.publish(sessionId, runtime.terminalEvent, `conversation.error:${command.request_id}`);
        } finally {
          if (runtime.activeTurn === activeTurn) runtime.activeTurn = null;
          if (!runtime.sockets.size) {
            runtime.cleanupTimer = setTimeout(() => {
              if (!runtime.sockets.size && !runtime.activeTurn) {
                runtime.eventUnsubscribe?.();
                runtime.eventUnsubscribe = null;
                this.sessions.delete(sessionId);
              }
            }, 300_000);
            runtime.cleanupTimer.unref?.();
          }
        }
      };
      runtime.commandChain = runtime.commandChain.then(run, run);
    });

    socket.on("close", () => {
      runtime.sockets.delete(socket);
      if (!runtime.sockets.size && !runtime.activeTurn && !runtime.terminalEvent) {
        runtime.eventUnsubscribe?.();
        runtime.eventUnsubscribe = null;
        this.sessions.delete(sessionId);
      }
    });
  }
}
