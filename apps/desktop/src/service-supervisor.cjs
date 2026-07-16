const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const path = require("node:path");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isHealthy(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(900) });
    return response.ok;
  } catch {
    return false;
  }
}

class ServiceSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "..", "..", ".."));
    this.spawnImpl = options.spawnImpl || spawn;
    this.fetchImpl = options.fetchImpl || fetch;
    this.startTimeoutMs = options.startTimeoutMs || 45_000;
    this.desktopBridgeToken = options.desktopBridgeToken || process.env.MY_MATE_DESKTOP_BRIDGE_TOKEN || "";
    this.desktopInstanceId = options.desktopInstanceId || process.env.MY_MATE_DESKTOP_INSTANCE_ID || "";
    this.services = new Map();
  }

  definitions() {
    const node = process.execPath;
    const controlPlaneDir = path.join(this.repoRoot, "services", "control-plane");
    const gatewayDir = path.join(this.repoRoot, "services", "api-gateway");
    const studioDir = path.join(this.repoRoot, "apps", "studio");
    return [
      {
        id: "control-plane",
        cwd: controlPlaneDir,
        command: node,
        args: [path.join(controlPlaneDir, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"],
        env: {
          PORT: "6372",
          MY_MATE_PUBLIC_BASE_URL: "http://127.0.0.1:6372",
          MY_MATE_DESKTOP_BRIDGE_TOKEN: this.desktopBridgeToken,
          MY_MATE_DESKTOP_INSTANCE_ID: this.desktopInstanceId,
        },
        healthUrl: "http://127.0.0.1:6372/health",
      },
      {
        id: "api-gateway",
        cwd: gatewayDir,
        command: node,
        args: [path.join(gatewayDir, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"],
        env: { PORT: "6373", MY_MATE_CONTROL_PLANE_BASE_URL: "http://127.0.0.1:6372" },
        healthUrl: "http://127.0.0.1:6373/health",
      },
      {
        id: "studio",
        cwd: studioDir,
        command: node,
        args: ["server.mjs"],
        env: { PORT: "6374", MY_MATE_API_GATEWAY_BASE_URL: "http://127.0.0.1:6373" },
        healthUrl: "http://127.0.0.1:6374/",
      },
    ];
  }

  snapshot() {
    return this.definitions().map((definition) => {
      const current = this.services.get(definition.id);
      return {
        id: definition.id,
        status: current?.status || "stopped",
        managed: current?.managed || false,
        pid: current?.child?.pid || null,
        error: current?.error || null,
      };
    });
  }

  update(id, patch) {
    const next = { ...(this.services.get(id) || {}), ...patch };
    this.services.set(id, next);
    this.emit("status", this.snapshot());
    return next;
  }

  async startAll() {
    for (const definition of this.definitions()) await this.startOne(definition);
    return this.snapshot();
  }

  async startOne(definition) {
    if (await isHealthy(definition.healthUrl, this.fetchImpl)) {
      this.update(definition.id, { status: "ready", managed: false, child: null, error: null });
      return;
    }
    this.update(definition.id, { status: "starting", managed: true, error: null });
    const child = this.spawnImpl(definition.command, definition.args, {
      cwd: definition.cwd,
      env: {
        ...process.env,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        ...definition.env,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const logs = [];
    const appendLog = (chunk) => {
      logs.push(String(chunk));
      if (logs.length > 40) logs.shift();
    };
    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);
    child.once("error", (error) => this.update(definition.id, { status: "failed", error: error.message }));
    child.once("exit", (code, signal) => {
      const current = this.services.get(definition.id);
      if (current?.status !== "stopping") {
        this.update(definition.id, {
          status: "failed",
          child: null,
          error: `Service exited (${signal || (code ?? "unknown")}). ${logs.join("").trim()}`.trim(),
        });
      }
    });
    this.update(definition.id, { child, logs });
    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      if (this.services.get(definition.id)?.status === "failed") {
        throw new Error(this.services.get(definition.id).error || `${definition.id} failed to start.`);
      }
      if (await isHealthy(definition.healthUrl, this.fetchImpl)) {
        this.update(definition.id, { status: "ready", error: null });
        return;
      }
      await delay(250);
    }
    child.kill();
    const error = `${definition.id} did not become healthy within ${this.startTimeoutMs}ms.`;
    this.update(definition.id, { status: "failed", error });
    throw new Error(error);
  }

  stopAll() {
    for (const [id, current] of this.services) {
      if (!current.managed || !current.child || current.child.killed) continue;
      this.update(id, { status: "stopping" });
      current.child.kill();
    }
  }
}

module.exports = { ServiceSupervisor, isHealthy };
