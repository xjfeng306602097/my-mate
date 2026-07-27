const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const { ServiceSupervisor, sanitizedServiceEnvironment } = require("../src/service-supervisor.cjs");

test("service supervisor removes only missing extra CA certificate paths", () => {
  const missing = sanitizedServiceEnvironment({ NODE_EXTRA_CA_CERTS: path.join(__dirname, "missing-ca.pem"), KEEP_ME: "yes" });
  assert.equal(missing.NODE_EXTRA_CA_CERTS, undefined);
  assert.equal(missing.KEEP_ME, "yes");
  const present = sanitizedServiceEnvironment({ NODE_EXTRA_CA_CERTS: __filename });
  assert.equal(present.NODE_EXTRA_CA_CERTS, __filename);
});

test("service supervisor reuses healthy services without spawning", async () => {
  let spawnCount = 0;
  const supervisor = new ServiceSupervisor({
    fetchImpl: async () => ({ ok: true }),
    spawnImpl: () => { spawnCount += 1; },
  });
  await supervisor.startAll();
  assert.equal(spawnCount, 0);
  assert.equal(supervisor.snapshot().every((service) => service.status === "ready" && !service.managed), true);
});

test("service supervisor does not reuse a control plane with a mismatched Desktop bridge token", async () => {
  let bridgeChecks = 0;
  const supervisor = new ServiceSupervisor({
    runtimeDataDir: path.join(__dirname, "missing-runtime"),
    fetchImpl: async (url) => {
      if (url.includes("/api/internal/desktop/health")) {
        bridgeChecks += 1;
        return { ok: false, status: 401 };
      }
      return { ok: true, status: 200 };
    },
    spawnImpl: () => {
      throw new Error("spawn should not be reached without a matching runtime lease");
    },
  });
  const [controlPlane] = supervisor.definitions();
  await assert.rejects(() => supervisor.startOne(controlPlane));
  assert.equal(bridgeChecks > 0, true);
});

test("service supervisor reports a managed service after startup", async () => {
  let healthy = false;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 123;
  child.killed = false;
  child.kill = () => { child.killed = true; };
  const supervisor = new ServiceSupervisor({
    startTimeoutMs: 2_000,
    fetchImpl: async () => ({ ok: healthy }),
    spawnImpl: () => {
      healthy = true;
      return child;
    },
  });
  const [definition] = supervisor.definitions();
  await supervisor.startOne(definition);
  assert.equal(supervisor.snapshot()[0].status, "ready");
  assert.equal(supervisor.snapshot()[0].managed, true);
  supervisor.stopAll();
  assert.equal(child.killed, true);
});

test("service supervisor runs child services in Node mode under Electron", async () => {
  const originalElectronVersion = process.versions.electron;
  Object.defineProperty(process.versions, "electron", { value: "37.0.0", configurable: true });
  let spawnOptions = null;
  const child = new EventEmitter();
  child.pid = 1234;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  const supervisor = new ServiceSupervisor({
    repoRoot: path.join(__dirname, "..", "..", ".."),
    fetchImpl: async () => ({ ok: fetchCalls++ > 0 }),
    spawnImpl: (_command, _args, options) => {
      spawnOptions = options;
      return child;
    },
    startTimeoutMs: 200,
  });
  let fetchCalls = 0;
  try {
    await supervisor.startOne(supervisor.definitions()[0]);
    assert.equal(spawnOptions.env.ELECTRON_RUN_AS_NODE, "1");
  } finally {
    Object.defineProperty(process.versions, "electron", {
      value: originalElectronVersion,
      configurable: true,
    });
  }
});

test("packaged service definitions use compiled entrypoints and a user-data runtime root", () => {
  const runtimeRoot = path.join("C:\\", "Program Files", "My Mate", "resources", "runtime");
  const runtimeDataDir = path.join("C:\\", "Users", "test", "AppData", "Roaming", "My Mate", "runtime");
  const supervisor = new ServiceSupervisor({
    repoRoot: runtimeRoot,
    runtimeDataDir,
    packaged: true,
  });
  const [controlPlane, gateway, studio] = supervisor.definitions();
  assert.equal(supervisor.startTimeoutMs, 180_000);
  assert.deepEqual(controlPlane.args, [path.join(runtimeRoot, "services", "control-plane", "dist", "src", "server.js")]);
  assert.deepEqual(gateway.args, [path.join(runtimeRoot, "services", "api-gateway", "dist", "src", "server.js")]);
  assert.deepEqual(studio.args, ["server.mjs"]);
  assert.equal(controlPlane.env.MY_MATE_DATA_DIR, runtimeDataDir);
  assert.equal(controlPlane.env.MY_MATE_STORAGE_BACKEND, "sqlite");
  assert.equal(controlPlane.env.MY_MATE_STORAGE_AUTO_MIGRATE, "true");
  assert.equal(controlPlane.env.MY_MATE_STORAGE_SQLITE_HELPER_RUNTIME, "node");
  assert.equal(controlPlane.args.some((value) => value.includes("tsx")), false);
  assert.equal(gateway.args.some((value) => value.includes("tsx")), false);
});

test("service supervisor keeps a shorter development timeout and honors explicit overrides", () => {
  assert.equal(new ServiceSupervisor().startTimeoutMs, 45_000);
  assert.equal(new ServiceSupervisor({ packaged: true, startTimeoutMs: 12_345 }).startTimeoutMs, 12_345);
});

test("service supervisor ignores a stale SIGTERM after replacement service is ready", async () => {
  let healthy = false;
  let spawnCount = 0;
  const children = [];
  const supervisor = new ServiceSupervisor({
    startTimeoutMs: 1_000,
    fetchImpl: async () => ({ ok: healthy }),
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 1_000 + spawnCount;
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        healthy = false;
      };
      children.push(child);
      spawnCount += 1;
      healthy = true;
      return child;
    },
  });
  const definition = {
    id: "test-service",
    cwd: __dirname,
    command: process.execPath,
    args: [],
    env: {},
    healthUrl: "http://127.0.0.1:1/health",
  };
  supervisor.definitions = () => [definition];

  await supervisor.startAll();
  const firstChild = children[0];
  await supervisor.restartAll();
  const secondChild = children[1];

  assert.equal(supervisor.snapshot()[0].status, "ready");
  assert.equal(supervisor.snapshot()[0].pid, secondChild.pid);
  firstChild.emit("exit", null, "SIGTERM");
  assert.equal(supervisor.snapshot()[0].status, "ready");
  assert.equal(supervisor.snapshot()[0].pid, secondChild.pid);
  assert.equal(supervisor.snapshot()[0].error, null);
});

test("service supervisor records an intentional child exit as stopped", async () => {
  let healthy = false;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 2_001;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    healthy = false;
  };
  const supervisor = new ServiceSupervisor({
    startTimeoutMs: 1_000,
    fetchImpl: async () => ({ ok: healthy }),
    spawnImpl: () => {
      healthy = true;
      return child;
    },
  });
  const definition = {
    id: "test-service",
    cwd: __dirname,
    command: process.execPath,
    args: [],
    env: {},
    healthUrl: "http://127.0.0.1:1/health",
  };
  supervisor.definitions = () => [definition];

  await supervisor.startAll();
  supervisor.stopAll();
  child.emit("exit", null, "SIGTERM");

  assert.equal(supervisor.snapshot()[0].status, "stopped");
  assert.equal(supervisor.snapshot()[0].managed, false);
  assert.equal(supervisor.snapshot()[0].pid, null);
  assert.equal(supervisor.snapshot()[0].error, null);
});

test("service supervisor restarts an unexpectedly exited managed service with backoff", async () => {
  let healthy = false;
  let spawnCount = 0;
  const children = [];
  const supervisor = new ServiceSupervisor({
    startTimeoutMs: 500,
    restartBackoffMs: [5],
    restartStableMs: 100,
    fetchImpl: async () => ({ ok: healthy }),
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 3_000 + spawnCount;
      child.killed = false;
      child.kill = () => { child.killed = true; healthy = false; };
      children.push(child);
      spawnCount += 1;
      healthy = true;
      return child;
    },
  });
  const definition = {
    id: "test-service",
    cwd: __dirname,
    command: process.execPath,
    args: [],
    env: {},
    healthUrl: "http://127.0.0.1:1/health",
  };
  supervisor.definitions = () => [definition];

  await supervisor.startAll();
  healthy = false;
  children[0].emit("exit", 1, null);
  assert.equal(supervisor.snapshot()[0].status, "restarting");
  assert.equal(supervisor.snapshot()[0].restart_attempt, 1);

  const deadline = Date.now() + 500;
  while (spawnCount < 2 && Date.now() < deadline) await delayForTest(5);
  assert.equal(spawnCount, 2);
  assert.equal(supervisor.snapshot()[0].status, "ready");
  assert.equal(supervisor.snapshot()[0].pid, children[1].pid);
  supervisor.stopAll();
});

test("service supervisor cancels a pending automatic restart when Desktop stops", async () => {
  let healthy = false;
  let spawnCount = 0;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4_001;
  child.killed = false;
  child.kill = () => { child.killed = true; healthy = false; };
  const supervisor = new ServiceSupervisor({
    startTimeoutMs: 500,
    restartBackoffMs: [50],
    fetchImpl: async () => ({ ok: healthy }),
    spawnImpl: () => { spawnCount += 1; healthy = true; return child; },
  });
  const definition = {
    id: "test-service",
    cwd: __dirname,
    command: process.execPath,
    args: [],
    env: {},
    healthUrl: "http://127.0.0.1:1/health",
  };
  supervisor.definitions = () => [definition];

  await supervisor.startAll();
  healthy = false;
  child.emit("exit", 1, null);
  supervisor.stopAll();
  await delayForTest(80);
  assert.equal(spawnCount, 1);
});

function delayForTest(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
