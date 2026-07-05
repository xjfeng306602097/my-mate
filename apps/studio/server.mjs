import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 5174);
const GATEWAY_BASE_URL = (process.env.MY_MATE_API_GATEWAY_BASE_URL || "http://127.0.0.1:4030").replace(/\/+$/g, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyApi(req, res) {
  try {
    const target = `${GATEWAY_BASE_URL}${req.url}`;
    const body = ["GET", "HEAD"].includes(req.method || "GET") ? undefined : await readRequestBody(req);
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        "content-type": req.headers["content-type"] || "application/json",
        accept: req.headers.accept || "application/json",
      },
      body,
    });
    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const isSse = (req.url || "").match(/^\/api\/sessions\/[^/]+\/stream$/);

    res.writeHead(upstream.status, {
      "content-type": contentType,
      ...(isSse ? { "cache-control": "no-cache", connection: "keep-alive" } : {}),
    });

    if (isSse && upstream.body) {
      const upstreamStream = Readable.fromWeb(upstream.body);
      req.on("close", () => upstreamStream.destroy());
      upstreamStream.on("error", () => {
        if (!res.writableEnded) {
          res.end();
        }
      });
      upstreamStream.pipe(res);
      return;
    }

    const responseBody = Buffer.from(await upstream.arrayBuffer());
    res.end(responseBody);
  } catch (error) {
    sendJson(res, 502, {
      code: "gateway_proxy_failed",
      message: error instanceof Error ? error.message : "Gateway proxy failed.",
    });
  }
}

function resolveStaticPath(urlPath) {
  const normalized = path.normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const relativePath = normalized === "/" ? "index.html" : normalized.replace(/^[/\\]/, "");
  const fullPath = path.join(__dirname, relativePath);
  if (!fullPath.startsWith(__dirname)) {
    return null;
  }
  return fullPath;
}

async function serveStatic(req, res) {
  const requested = resolveStaticPath(req.url || "/");
  if (!requested || !existsSync(requested) || !statSync(requested).isFile()) {
    const indexPath = path.join(__dirname, "index.html");
    const body = await readFile(indexPath);
    res.writeHead(200, { "content-type": MIME_TYPES[".html"] });
    res.end(body);
    return;
  }

  const ext = path.extname(requested);
  res.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
  createReadStream(requested).pipe(res);
}

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/api/")) {
    void proxyApi(req, res);
    return;
  }
  void serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`My Mate Studio listening on http://127.0.0.1:${PORT}`);
  console.log(`Proxying /api to ${GATEWAY_BASE_URL}`);
});
