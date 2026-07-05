import express from "express";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { readConfig, type GatewayConfig } from "./config.js";

type RouteRule = {
  method: "GET" | "POST" | "PUT" | "PATCH";
  pattern: RegExp;
};

const PROXY_RULES: RouteRule[] = [
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
  { method: "GET", pattern: /^\/api\/registry\/skills$/ },
  { method: "POST", pattern: /^\/api\/registry\/skills$/ },
  { method: "GET", pattern: /^\/api\/registry\/skills\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/registry\/skills\/[^/]+\/disable$/ },
  { method: "POST", pattern: /^\/api\/planner\/template-selection$/ },
  { method: "POST", pattern: /^\/api\/planner\/dag-draft$/ },
  { method: "POST", pattern: /^\/api\/planner\/candidate-plan$/ },
  { method: "GET", pattern: /^\/api\/missions$/ },
  { method: "GET", pattern: /^\/api\/missions\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/runtime\/summary$/ },
  { method: "GET", pattern: /^\/api\/agents\/hosting$/ },
  { method: "PUT", pattern: /^\/api\/agents\/[^/]+\/hosting$/ },
  { method: "GET", pattern: /^\/api\/sessions$/ },
  { method: "POST", pattern: /^\/api\/sessions$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/(?:archive|unarchive|hide|unhide)$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/attachments$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/attachments$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/compare$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/stream$/ },
  { method: "GET", pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
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
  { method: "GET", pattern: /^\/api\/runs$/ },
  { method: "POST", pattern: /^\/api\/runs$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/events$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/artifacts$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/plan$/ },
  { method: "GET", pattern: /^\/api\/runs\/[^/]+\/graph$/ },
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
  { method: "GET", pattern: /^\/api\/human-inputs$/ },
  { method: "POST", pattern: /^\/api\/human-inputs\/[^/]+\/submit$/ },
];

function isAuthorized(req: Request, config: GatewayConfig): boolean {
  if (!config.apiKey) {
    return true;
  }
  return req.header("authorization") === `Bearer ${config.apiKey}`;
}

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

function copyHeaders(req: Request): Headers {
  const headers = new Headers();
  headers.set("x-my-mate-gateway", "api-gateway");

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

  return headers;
}

function isSseRequest(req: Request): boolean {
  return /^\/api\/sessions\/[^/]+\/stream$/.test(getOriginalPath(req));
}

async function proxyToControlPlane(
  req: Request,
  res: Response,
  config: GatewayConfig,
): Promise<void> {
  if (!isAuthorized(req, config)) {
    res.status(401).json({
      code: "unauthorized",
      message: "Invalid API gateway token.",
    });
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
  const timeout = setTimeout(() => abortController.abort(), config.requestTimeoutMs);

  try {
    const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase());
    const targetUrl = buildTargetUrl(req, config);
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: copyHeaders(req),
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      signal: abortController.signal,
    });
    const contentType = upstream.headers.get("content-type") || "application/json";

    res.status(upstream.status);
    res.setHeader("content-type", contentType);

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

    const text = await upstream.text();
    res.send(text);
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
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
      auth_required: !!config.apiKey,
    });
  });

  app.use("/api", (req: Request, res: Response) => {
    void proxyToControlPlane(req, res, config);
  });

  return app;
}
