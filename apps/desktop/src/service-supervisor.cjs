const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isHealthy(url, fetchImpl = fetch, options = {}) {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(900),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    return Array.isArray(options.acceptStatuses)
      ? options.acceptStatuses.includes(response.status)
      : response.ok;
  } catch {
    return false;
  }
}

function sanitizedServiceEnvironment(environment = process.env) {
  const next = { ...environment };
  if (next.NODE_EXTRA_CA_CERTS && !fs.existsSync(path.resolve(next.NODE_EXTRA_CA_CERTS))) {
    delete next.NODE_EXTRA_CA_CERTS;
  }
  return next;
}

class ServiceSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "..", "..", ".."));
    this.spawnImpl = options.spawnImpl || spawn;
    this.fetchImpl = options.fetchImpl || fetch;
    this.packaged = options.packaged === true;
    this.startTimeoutMs = options.startTimeoutMs || (this.packaged ? 180_000 : 45_000);
    this.desktopBridgeToken = options.desktopBridgeToken || process.env.MY_MATE_DESKTOP_BRIDGE_TOKEN || "";
    this.desktopInstanceId = options.desktopInstanceId || process.env.MY_MATE_DESKTOP_INSTANCE_ID || "";
    this.runtimeDataDir = options.runtimeDataDir ? path.resolve(options.runtimeDataDir) : "";
    this.logRoot = options.logRoot ? path.resolve(options.logRoot) : "";
    this.autoRestart = options.autoRestart !== false;
    this.restartBackoffMs = Array.isArray(options.restartBackoffMs) && options.restartBackoffMs.length
      ? options.restartBackoffMs.map((value) => Math.max(0, Number(value) || 0))
      : [500, 1_000, 2_000, 5_000, 10_000];
    this.maxRestartAttempts = Math.max(1, Number(options.maxRestartAttempts || 8));
    this.restartStableMs = Math.max(0, Number(options.restartStableMs ?? 30_000));
    this.services = new Map();
    this.expectedStops = new WeakSet();
    this.restartTimers = new Map();
    this.restartStableTimers = new Map();
    this.restartAttempts = new Map();
    this.autoRestartArmed = false;
    this.stopping = false;
  }

  definitions() {
    const node = process.execPath;
    const controlPlaneDir = path.join(this.repoRoot, "services", "control-plane");
    const gatewayDir = path.join(this.repoRoot, "services", "api-gateway");
    const studioDir = path.join(this.repoRoot, "apps", "studio");
    const controlPlaneArgs = this.packaged
      ? [path.join(controlPlaneDir, "dist", "src", "server.js")]
      : [path.join(controlPlaneDir, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"];
    const gatewayArgs = this.packaged
      ? [path.join(gatewayDir, "dist", "src", "server.js")]
      : [path.join(gatewayDir, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"];
    return [
      {
        id: "control-plane",
        cwd: controlPlaneDir,
        command: node,
        args: controlPlaneArgs,
        env: {
          PORT: "6372",
          MY_MATE_PUBLIC_BASE_URL: "http://127.0.0.1:6372",
          MY_MATE_DESKTOP_BRIDGE_TOKEN: this.desktopBridgeToken,
          MY_MATE_DESKTOP_INSTANCE_ID: this.desktopInstanceId,
          ...(this.runtimeDataDir ? {
            MY_MATE_DATA_DIR: this.runtimeDataDir,
            MY_MATE_STORAGE_BACKEND: "sqlite",
            MY_MATE_STORAGE_AUTO_MIGRATE: "true",
            MY_MATE_STORAGE_SQLITE_HELPER_RUNTIME: "node",
          } : {}),
        },
        healthUrl: "http://127.0.0.1:6372/health",
        bridgeHealthUrl: "http://127.0.0.1:6372/api/internal/desktop/health",
        bridgeHealthHeaders: { authorization: `Bearer ${this.desktopBridgeToken}` },
      },
      {
        id: "api-gateway",
        cwd: gatewayDir,
        command: node,
        args: gatewayArgs,
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
        log_file: current?.logFile ? path.basename(current.logFile) : null,
        restart_attempt: current?.restartAttempt || 0,
        next_restart_at: current?.nextRestartAt || null,
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
    this.stopping = false;
    this.autoRestartArmed = false;
    try {
      for (const definition of this.definitions()) await this.startOne(definition);
      this.autoRestartArmed = this.autoRestart;
      return this.snapshot();
    } catch (error) {
      this.autoRestartArmed = false;
      throw error;
    }
  }

  async startOne(definition) {
    const healthy = await isHealthy(definition.healthUrl, this.fetchImpl);
    const bridgeHealthy = !definition.bridgeHealthUrl || await isHealthy(
      definition.bridgeHealthUrl,
      this.fetchImpl,
      { headers: definition.bridgeHealthHeaders },
    );
    if (healthy && bridgeHealthy) {
      this.clearRestartTimer(definition.id);
      this.restartAttempts.set(definition.id, 0);
      this.update(definition.id, { status: "ready", managed: false, child: null, error: null, restartAttempt: 0, nextRestartAt: null });
      return;
    }
    if (healthy && definition.bridgeHealthUrl && !bridgeHealthy) {
      await this.stopStaleLeasedService(definition);
    }
    this.update(definition.id, { status: "starting", managed: true, error: null, nextRestartAt: null });
    const child = this.spawnImpl(definition.command, definition.args, {
      cwd: definition.cwd,
      env: {
        ...sanitizedServiceEnvironment(),
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        ...definition.env,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const logs = [];
    const logFile = this.logRoot ? path.join(this.logRoot, `${definition.id}.log`) : "";
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
        fs.rmSync(`${logFile}.1`, { force: true });
        fs.renameSync(logFile, `${logFile}.1`);
      }
    }
    const appendLog = (chunk) => {
      logs.push(String(chunk));
      if (logs.length > 40) logs.shift();
      if (logFile) fs.appendFileSync(logFile, String(chunk), { encoding: "utf8", mode: 0o600 });
    };
    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);
    child.once("error", (error) => {
      const current = this.services.get(definition.id);
      if (current?.child !== child || this.expectedStops.has(child)) return;
      this.update(definition.id, { status: "failed", child: null, error: error.message });
      this.scheduleRestart(definition, error.message);
    });
    child.once("exit", (code, signal) => {
      const current = this.services.get(definition.id);
      const expected = this.expectedStops.delete(child);
      if (current?.child !== child) return;
      if (expected || current.status === "stopping") {
        this.update(definition.id, {
          status: "stopped",
          managed: false,
          child: null,
          error: null,
        });
        return;
      }
      this.update(definition.id, {
        status: "failed",
        child: null,
        error: `Service exited (${signal || (code ?? "unknown")}). ${logs.join("").trim()}`.trim(),
      });
      this.scheduleRestart(definition, this.services.get(definition.id)?.error || `${definition.id} exited.`);
    });
    this.update(definition.id, { child, logs, logFile });
    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      if (this.services.get(definition.id)?.status === "failed") {
        throw new Error(this.services.get(definition.id).error || `${definition.id} failed to start.`);
      }
      const baseHealthy = await isHealthy(definition.healthUrl, this.fetchImpl);
      const bridgeReady = !definition.bridgeHealthUrl || await isHealthy(
        definition.bridgeHealthUrl,
        this.fetchImpl,
        { headers: definition.bridgeHealthHeaders },
      );
      if (baseHealthy && bridgeReady) {
        this.update(definition.id, { status: "ready", error: null, nextRestartAt: null });
        this.scheduleRestartAttemptReset(definition.id, child);
        return;
      }
      await delay(250);
    }
    child.kill();
    const error = `${definition.id} did not become healthy within ${this.startTimeoutMs}ms.`;
    this.update(definition.id, { status: "failed", error });
    throw new Error(error);
  }

  clearRestartTimer(id) {
    const timer = this.restartTimers.get(id);
    if (timer) clearTimeout(timer);
    this.restartTimers.delete(id);
  }

  clearRestartAttemptReset(id) {
    const timer = this.restartStableTimers.get(id);
    if (timer) clearTimeout(timer);
    this.restartStableTimers.delete(id);
  }

  scheduleRestartAttemptReset(id, child) {
    this.clearRestartAttemptReset(id);
    if ((this.restartAttempts.get(id) || 0) === 0) return;
    const timer = setTimeout(() => {
      this.restartStableTimers.delete(id);
      const current = this.services.get(id);
      if (current?.status !== "ready" || current?.child !== child) return;
      this.restartAttempts.set(id, 0);
      this.update(id, { restartAttempt: 0, nextRestartAt: null });
    }, this.restartStableMs);
    timer.unref?.();
    this.restartStableTimers.set(id, timer);
  }

  scheduleRestart(definition, error) {
    if (!this.autoRestart || !this.autoRestartArmed || this.stopping || this.restartTimers.has(definition.id)) return;
    this.clearRestartAttemptReset(definition.id);
    const attempt = (this.restartAttempts.get(definition.id) || 0) + 1;
    this.restartAttempts.set(definition.id, attempt);
    if (attempt > this.maxRestartAttempts) {
      this.update(definition.id, {
        status: "failed",
        restartAttempt: attempt - 1,
        nextRestartAt: null,
        error: `${error} Automatic restart stopped after ${this.maxRestartAttempts} attempts.`.trim(),
      });
      return;
    }
    const delayMs = this.restartBackoffMs[Math.min(attempt - 1, this.restartBackoffMs.length - 1)];
    const nextRestartAt = new Date(Date.now() + delayMs).toISOString();
    this.update(definition.id, {
      status: "restarting",
      managed: true,
      child: null,
      error,
      restartAttempt: attempt,
      nextRestartAt,
    });
    const timer = setTimeout(async () => {
      this.restartTimers.delete(definition.id);
      if (this.stopping || !this.autoRestartArmed) return;
      try {
        await this.startOne(definition);
      } catch (restartError) {
        if (!this.restartTimers.has(definition.id)) {
          this.scheduleRestart(
            definition,
            restartError instanceof Error ? restartError.message : String(restartError),
          );
        }
      }
    }, delayMs);
    timer.unref?.();
    this.restartTimers.set(definition.id, timer);
  }

  async stopStaleLeasedService(definition) {
    if (!this.runtimeDataDir || !definition?.bridgeHealthUrl) return false;
    const ownerPath = path.join(this.runtimeDataDir, ".control-plane.lock", "owner.json");
    try {
      const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
      const ownerDataDir = path.resolve(String(owner.data_dir || ""));
      const expectedDataDir = path.resolve(this.runtimeDataDir);
      const ownerPid = Number(owner.pid);
      if (ownerDataDir !== expectedDataDir || !Number.isInteger(ownerPid) || ownerPid <= 0 || ownerPid === process.pid) {
        return false;
      }
      process.kill(ownerPid);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (!(await isHealthy(definition.healthUrl, this.fetchImpl))) return true;
        await delay(100);
      }
    } catch {
      return false;
    }
    return false;
  }

  stopAll() {
    this.stopping = true;
    this.autoRestartArmed = false;
    for (const id of this.restartTimers.keys()) this.clearRestartTimer(id);
    for (const id of this.restartStableTimers.keys()) this.clearRestartAttemptReset(id);
    for (const [id, current] of this.services) {
      if (!current.managed || !current.child || current.child.killed) continue;
      this.update(id, { status: "stopping" });
      this.expectedStops.add(current.child);
      current.child.kill();
    }
  }

  async restartAll() {
    this.stopAll();
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const health = await Promise.all(this.definitions().map(async (definition) => {
        const baseHealthy = await isHealthy(definition.healthUrl, this.fetchImpl);
        if (!baseHealthy || !definition.bridgeHealthUrl) return baseHealthy;
        return await isHealthy(definition.bridgeHealthUrl, this.fetchImpl, { headers: definition.bridgeHealthHeaders });
      }));
      if (health.every((ready) => !ready)) break;
      await delay(100);
    }
    this.services.clear();
    this.restartAttempts.clear();
    this.stopping = false;
    return await this.startAll();
  }

  readLogs(id, lineLimit = 200) {
    const definition = this.definitions().find((item) => item.id === id);
    if (!definition || !this.logRoot) throw new Error("Service log is unavailable.");
    const logFile = path.join(this.logRoot, `${definition.id}.log`);
    if (!fs.existsSync(logFile)) return { id: definition.id, lines: [] };
    const lines = fs.readFileSync(logFile, "utf8").split(/\r?\n/u).filter(Boolean).slice(-Math.max(1, Math.min(500, lineLimit)));
    return {
      id: definition.id,
      lines: lines.map((line) => line
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/ig, "$1[redacted]")
        .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[redacted-key]")),
    };
  }
}

module.exports = { ServiceSupervisor, isHealthy, sanitizedServiceEnvironment };
