import express from "express";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { readConfig, type GatewayConfig } from "./config.js";
import { encodeSignedIdentity, resolveRequestIdentity } from "./identity.js";
import type { RequestAuthContext } from "@my-mate/shared-types/identity";

type RouteRule = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: RegExp;
};

const PROXY_RULES: RouteRule[] = [
  { method: "GET", pattern: /^\/api\/auth\/me$/ },
  { method: "GET", pattern: /^\/api\/workspaces$/ },
  { method: "POST", pattern: /^\/api\/workspaces$/ },
  { method: "GET", pattern: /^\/api\/workspaces\/[^/]+\/members$/ },
  { method: "PUT", pattern: /^\/api\/workspaces\/[^/]+\/members\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/audit-events$/ },
  { method: "GET", pattern: /^\/api\/governance\/policy$/ },
  { method: "POST", pattern: /^\/api\/governance\/policy$/ },
  { method: "GET", pattern: /^\/api\/governance\/changes$/ },
  { method: "POST", pattern: /^\/api\/governance\/changes$/ },
  { method: "GET", pattern: /^\/api\/governance\/changes\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/governance\/changes\/[^/]+\/(?:approve|reject|apply)$/ },
  { method: "GET", pattern: /^\/api\/templates$/ },
  { method: "POST", pattern: /^\/api\/templates$/ },
  { method: "GET", pattern: /^\/api\/templates\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/templates\/[^/]+\/lineage$/ },
  { method: "PUT", pattern: /^\/api\/templates\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/templates\/[^/]+\/publish$/ },
  { method: "POST", pattern: /^\/api\/templates\/[^/]+\/archive$/ },
  { method: "POST", pattern: /^\/api\/templates\/[^/]+\/derive$/ },
  { method: "POST", pattern: /^\/api\/templates\/[^/]+\/new-version$/ },
  { method: "GET", pattern: /^\/api\/orchestrator-profiles$/ },
  { method: "POST", pattern: /^\/api\/orchestrator-profiles$/ },
  { method: "GET", pattern: /^\/api\/orchestrator-profiles\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/registry\/agent-profiles$/ },
  { method: "POST", pattern: /^\/api\/registry\/agent-profiles$/ },
  { method: "GET", pattern: /^\/api\/registry\/agent-profiles\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/registry\/agent-profiles\/[^/]+\/disable$/ },
  { method: "GET", pattern: /^\/api\/registry\/provider-connections$/ },
  { method: "POST", pattern: /^\/api\/registry\/provider-connections$/ },
  { method: "GET", pattern: /^\/api\/registry\/provider-connections\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/registry\/provider-connections\/[^/]+\/test$/ },
  { method: "POST", pattern: /^\/api\/registry\/provider-connections\/[^/]+\/disable$/ },
  { method: "GET", pattern: /^\/api\/registry\/mcp-connector-presets$/ },
  { method: "GET", pattern: /^\/api\/registry\/mcp-servers$/ },
  { method: "POST", pattern: /^\/api\/registry\/mcp-servers$/ },
  { method: "POST", pattern: /^\/api\/registry\/mcp-servers\/reload$/ },
  { method: "POST", pattern: /^\/api\/registry\/mcp-servers\/[^/]+\/(?:test|enable|disable)$/ },
  { method: "GET", pattern: /^\/api\/registry\/skills$/ },
  { method: "POST", pattern: /^\/api\/registry\/skills$/ },
  { method: "GET", pattern: /^\/api\/registry\/skills\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/registry\/skills\/[^/]+\/disable$/ },
  { method: "POST", pattern: /^\/api\/planner\/template-selection$/ },
  { method: "POST", pattern: /^\/api\/planner\/dag-draft$/ },
  { method: "POST", pattern: /^\/api\/planner\/candidate-plan$/ },
  { method: "GET", pattern: /^\/api\/missions$/ },
  { method: "GET", pattern: /^\/api\/missions\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/missions\/[^/]+\/materializer$/ },
  { method: "POST", pattern: /^\/api\/missions\/[^/]+\/materializer\/(?:rebuild|verify)$/ },
  { method: "GET", pattern: /^\/api\/runtime\/summary$/ },
  { method: "GET", pattern: /^\/api\/dashboard\/summary$/ },
  { method: "GET", pattern: /^\/api\/agents\/hosting$/ },
  { method: "PUT", pattern: /^\/api\/agents\/[^/]+\/hosting$/ },
  { method: "GET", pattern: /^\/api\/sessions$/ },
  { method: "POST", pattern: /^\/api\/sessions$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/autopilot$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/workspace-binding$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/task-workspace$/ },
  { method: "PUT", pattern: /^\/api\/sessions\/[^/]+\/autopilot$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/autopilot\/(?:tick|pause|resume)$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/(?:archive|unarchive|hide|unhide)$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/attachments$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/attachments$/ },
  { method: "DELETE", pattern: /^\/api\/sessions\/[^/]+\/attachments\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/artifacts\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/artifacts\/[^/]+\/compare$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/artifacts\/[^/]+\/download$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/compare$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/stream$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/memory-snapshot$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/memory-review$/ },
  { method: "GET", pattern: /^\/api\/memory-settings$/ },
  { method: "PUT", pattern: /^\/api\/memory-settings$/ },
  { method: "GET", pattern: /^\/api\/memory-observability$/ },
  { method: "GET", pattern: /^\/api\/memory-intelligence\/evaluation$/ },
  { method: "GET", pattern: /^\/api\/memory-maintenance$/ },
  { method: "POST", pattern: /^\/api\/memory-maintenance$/ },
  { method: "POST", pattern: /^\/api\/memory-maintenance\/sweep$/ },
  { method: "GET", pattern: /^\/api\/memories(?:\/export|\/[^/]+)?$/ },
  { method: "POST", pattern: /^\/api\/memories(?:\/import|\/[^/]+\/restore)?$/ },
  { method: "PATCH", pattern: /^\/api\/memories\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/api\/memories\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/memory-candidates(?:\/[^/]+)?$/ },
  { method: "POST", pattern: /^\/api\/memory-candidates(?:\/[^/]+\/(?:approve|reject))?$/ },
  { method: "POST", pattern: /^\/api\/session-recall\/search$/ },
  { method: "POST", pattern: /^\/api\/memory-retrieval\/search$/ },
  { method: "GET", pattern: /^\/api\/memory-retrieval\/status$/ },
  { method: "POST", pattern: /^\/api\/memory-retrieval\/rebuild$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/memory-recommendations$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/memory-recommendations\/[^/]+\/feedback$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/memory-overlay$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/memory-overlay$/ },
  { method: "DELETE", pattern: /^\/api\/sessions\/[^/]+\/memory-overlay\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/memory-contexts(?:\/[^/]+)?$/ },
  { method: "GET", pattern: /^\/api\/memory-onboarding$/ },
  { method: "POST", pattern: /^\/api\/memory-onboarding\/(?:start|preview|complete|dismiss)$/ },
  { method: "GET", pattern: /^\/api\/memory-effectiveness$/ },
  { method: "GET", pattern: /^\/api\/memory-knowledge\/status$/ },
  { method: "POST", pattern: /^\/api\/memory-knowledge\/(?:query|rebuild)$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/checkpoints$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/checkpoints\/latest$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/checkpoints\/[^/]+\/resume$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/interventions$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/patches\/[^/]+\/(?:confirm|reject)$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/dag-draft$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/plan$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/plan\/revise$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/plan\/confirm$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/dag-proposals$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/dag-proposals$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/dag-proposals\/[^/]+$/ },
  { method: "PATCH", pattern: /^\/api\/sessions\/[^/]+\/dag-proposals\/[^/]+\/assignments$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/dag-proposals\/[^/]+\/(?:confirm|reject|supersede)$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/runs$/ },
  { method: "GET", pattern: /^\/api\/projects$/ },
  { method: "POST", pattern: /^\/api\/diagnostics\/doctor$/ },
  { method: "GET", pattern: /^\/api\/runs$/ },
  { method: "POST", pattern: /^\/api\/runs$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/route$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/supervise$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/scorecards$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/scorecards$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/scorecards\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/evaluations$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/evaluations$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/evaluations\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/trace$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/replays$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/replays\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/replay-plans$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/replay-plans\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/reruns$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/events$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/artifacts$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/artifacts\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/artifacts\/[^/]+\/download$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/plan$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/graph$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/runtime$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/recovery$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/recovery\/scan$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/nodes\/[^/]+\/recovery-replays$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/recovery-replays\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/nodes$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/actions\/(?:pause|resume|cancel)$/ },
  { method: "POST", pattern: /^\/api\/runs\/[^/]+\/nodes\/[^/]+\/actions\/(?:retry|skip)$/ },
  { method: "GET", pattern: /^\/api\/mobile\/home$/ },
  { method: "GET", pattern: /^\/api\/mobile\/inbox$/ },
  { method: "GET", pattern: /^\/api\/mobile\/runs$/ },
  { method: "GET", pattern: /^\/api\/mobile\/runs\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/mobile\/runs\/[^/]+\/follow-up$/ },
  { method: "GET", pattern: /^\/api\/approvals$/ },
  { method: "POST", pattern: /^\/api\/approvals\/[^/]+\/(?:approve|reject)$/ },
  { method: "GET", pattern: /^\/api\/runtime\/workspace-change-sets(?:\/[^/]+)?$/ },
  { method: "POST", pattern: /^\/api\/runtime\/workspace-change-sets\/[^/]+\/(?:apply|reject)$/ },
  { method: "GET", pattern: /^\/api\/human-inputs$/ },
  { method: "POST", pattern: /^\/api\/human-inputs\/[^/]+\/submit$/ },
  { method: "GET", pattern: /^\/api\/supervision\/alerts$/ },
  { method: "POST", pattern: /^\/api\/supervision\/scan$/ },
  { method: "POST", pattern: /^\/api\/supervision\/alerts\/[^/]+\/resolve$/ },
];

function isAllowedProxyRequest(req: Request): boolean {
  const method = req.method.toUpperCase();
  const path = getOriginalPath(req);
  return PROXY_RULES.some((rule) => rule.method === method && rule.pattern.test(path));
}

function getOriginalPath(req: Request): string {
  return new URL(req.originalUrl, "http://gateway.local").pathname;
}

function buildTargetUrl(req: Request, config: GatewayConfig): URL {
  const target = new URL(req.originalUrl, config.controlPlaneBaseUrl);
  target.pathname = getOriginalPath(req);
  return target;
}

function copyHeaders(
  req: Request,
  authContext: RequestAuthContext,
  internalAuthSecret: string,
): Headers {
  const headers = new Headers();
  headers.set("x-my-mate-gateway", "api-gateway");
  const signedIdentity = encodeSignedIdentity(authContext, internalAuthSecret);
  headers.set("x-my-mate-auth-context", signedIdentity.payload);
  headers.set("x-my-mate-auth-signature", signedIdentity.signature);
  headers.set("x-my-mate-workspace-id", authContext.selected_workspace.workspace_id);

  const contentType = req.header("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  } else {
    headers.set("content-type", "application/json");
  }

  const accept = req.header("accept");
  if (accept) {
    headers.set("accept", accept);
  }

  const requestId = req.header("x-request-id");
  if (requestId) {
    headers.set("x-request-id", requestId);
  }

  const idempotencyKey = req.header("idempotency-key");
  if (
    idempotencyKey &&
    (
      /^\/api\/runs\/[^/]+\/reruns$/.test(getOriginalPath(req)) ||
      /^\/api\/runs\/[^/]+\/nodes\/[^/]+\/recovery-replays$/.test(getOriginalPath(req))
    )
  ) {
    headers.set("idempotency-key", idempotencyKey);
  }

  return headers;
}

function isSseRequest(req: Request): boolean {
  return /^\/api\/sessions\/[^/]+\/stream$/.test(getOriginalPath(req));
}

function proxyTimeoutMs(req: Request, config: GatewayConfig): number {
  if (
    req.method.toUpperCase() === "POST" &&
    /^\/api\/sessions\/[^/]+\/messages$/.test(getOriginalPath(req))
  ) {
    return Math.max(config.requestTimeoutMs, 600_000);
  }
  return config.requestTimeoutMs;
}

async function proxyToControlPlane(
  req: Request,
  res: Response,
  config: GatewayConfig,
): Promise<void> {
  const identity = resolveRequestIdentity(req, config);
  if (!identity.ok) {
    res.status(identity.status).json({ code: identity.code, message: identity.message });
    return;
  }

  if (!isAllowedProxyRequest(req)) {
    res.status(404).json({
      code: "route_not_found",
      message: "Gateway route is not exposed.",
    });
    return;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), proxyTimeoutMs(req, config));

  try {
    const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase());
    const targetUrl = buildTargetUrl(req, config);
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: copyHeaders(req, identity.context, config.internalAuthSecret),
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      signal: abortController.signal,
    });
    const contentType = upstream.headers.get("content-type") || "application/json";

    res.status(upstream.status);
    res.setHeader("content-type", contentType);
    const contentDisposition = upstream.headers.get("content-disposition");
    if (contentDisposition) res.setHeader("content-disposition", contentDisposition);
    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) res.setHeader("cache-control", cacheControl);

    if (isSseRequest(req)) {
      res.setHeader("cache-control", upstream.headers.get("cache-control") || "no-cache");
      res.setHeader("connection", "keep-alive");
      if (!upstream.body) {
        res.end();
        return;
      }
      const upstreamStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      req.on("close", () => {
        abortController.abort();
        upstreamStream.destroy();
      });
      upstreamStream.on("error", () => {
        if (!res.writableEnded) {
          res.end();
        }
      });
      upstreamStream.pipe(res);
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    res.status(aborted ? 504 : 502).json({
      code: aborted ? "upstream_timeout" : "upstream_unavailable",
      message: aborted
        ? "Control-plane request timed out."
        : error instanceof Error
          ? error.message
          : "Control-plane request failed.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createApp(overrides: Partial<GatewayConfig> = {}) {
  const config = readConfig(overrides);
  const app = express();
  app.use((req: Request, res: Response, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Request-Id, X-My-Mate-Workspace-Id",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method.toUpperCase() === "OPTIONS") {
      res.status(204).send();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      port: config.port,
      control_plane_base_url: config.controlPlaneBaseUrl,
      auth_required: !!config.apiKey || config.identities.length > 0,
      identity_count: config.identities.length + (config.apiKey ? 1 : 0),
    });
  });

  app.use("/api", (req: Request, res: Response) => {
    void proxyToControlPlane(req, res, config);
  });

  return app;
}
