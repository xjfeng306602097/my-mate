const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { canonicalDirectory, resolveWithinRoot } = require("./workspace-capability.cjs");

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PREVIEW_FILE_BYTES = 64 * 1024 * 1024;

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function previewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function applySecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; "));
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function containsHiddenSegment(relativePath) {
  return relativePath.split(/[\\/]/u).some((segment) => segment.startsWith("."));
}

class WorkspacePreviewHost {
  constructor(options = {}) {
    this.fs = options.fs || fs;
    this.idleTimeoutMs = Math.max(25, Number(options.idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS);
    this.previews = new Map();
  }

  async start(input = {}) {
    const workspaceRoot = await canonicalDirectory(input.workspaceRoot, this.fs);
    const entryPath = await resolveWithinRoot(workspaceRoot, input.relativePath, {
      fs: this.fs,
      purpose: "Workspace preview",
    });
    const entryStat = await this.fs.promises.stat(entryPath);
    if (!entryStat.isFile() || path.basename(entryPath).toLowerCase() !== "index.html") {
      throw previewError("invalid-preview-entry", "Workspace preview requires a real index.html file.");
    }
    const previewRoot = await canonicalDirectory(path.dirname(entryPath), this.fs);
    const key = `${workspaceRoot}\0${previewRoot}`;
    const reusable = this.previews.get(key);
    if (reusable && reusable.server.listening) {
      reusable.touch();
      return { url: reusable.url, rootPath: previewRoot, reused: true };
    }

    const nonce = randomBytes(18).toString("base64url");
    let idleTimer = null;
    const server = http.createServer((request, response) => {
      void this.#serve({ request, response, previewRoot, nonce, touch });
    });
    const close = async () => {
      if (idleTimer) clearTimeout(idleTimer);
      this.previews.delete(key);
      if (!server.listening) return;
      await new Promise((resolve) => server.close(() => resolve()));
    };
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => void close(), this.idleTimeoutMs);
      idleTimer.unref?.();
    };

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.unref?.();
    const address = server.address();
    if (!address || typeof address === "string") {
      await close();
      throw previewError("preview-start-failed", "Workspace preview could not allocate a localhost port.");
    }
    const url = `http://127.0.0.1:${address.port}/${nonce}/`;
    this.previews.set(key, { server, url, close, touch });
    touch();
    return { url, rootPath: previewRoot, reused: false };
  }

  async #serve({ request, response, previewRoot, nonce, touch }) {
    applySecurityHeaders(response);
    touch();
    if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }
    try {
      const requestedUrl = new URL(request.url, "http://127.0.0.1");
      const prefix = `/${nonce}/`;
      if (!requestedUrl.pathname.startsWith(prefix)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const encodedRelativePath = requestedUrl.pathname.slice(prefix.length);
      const relativePath = decodeURIComponent(encodedRelativePath || "index.html");
      if (!relativePath || containsHiddenSegment(relativePath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const filePath = await resolveWithinRoot(previewRoot, relativePath, {
        fs: this.fs,
        purpose: "Workspace preview",
      });
      const stat = await this.fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_PREVIEW_FILE_BYTES) {
        response.writeHead(stat.isFile() ? 413 : 404);
        response.end(stat.isFile() ? "Preview file is too large" : "Not found");
        return;
      }
      response.setHeader("Content-Type", MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream");
      response.setHeader("Content-Length", stat.size);
      response.writeHead(200);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = this.fs.createReadStream(filePath);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  }

  async closeAll() {
    await Promise.all([...this.previews.values()].map((preview) => preview.close()));
  }
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_MS,
  MAX_PREVIEW_FILE_BYTES,
  WorkspacePreviewHost,
};
