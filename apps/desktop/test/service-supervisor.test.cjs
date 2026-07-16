const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const { ServiceSupervisor } = require("../src/service-supervisor.cjs");

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
