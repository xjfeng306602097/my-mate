const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { RuntimeProvisioner } = require("../src/runtime-provisioner.cjs");

test("runtime provisioner reports Docker daemon failures without claiming image readiness", async () => {
  const provisioner = new RuntimeProvisioner({
    runtimeRoot: path.join(__dirname, ".."),
    execFileImpl: async () => { throw new Error("daemon unavailable"); },
  });
  const status = await provisioner.inspect();
  assert.equal(status.docker.status, "unavailable");
  assert.equal(status.images.every((image) => image.status === "unknown"), true);
});

test("runtime provisioner verifies both pinned images", async () => {
  const calls = [];
  const provisioner = new RuntimeProvisioner({
    runtimeRoot: path.join(__dirname, ".."),
    execFileImpl: async (_command, args) => {
      calls.push(args);
      if (args[0] === "version") return { stdout: "28.0.1\n", stderr: "" };
      return { stdout: `sha256:${args[2]}\n`, stderr: "" };
    },
  });
  const status = await provisioner.inspect();
  assert.equal(status.docker.status, "ready");
  assert.deepEqual(status.images.map((image) => image.status), ["ready", "ready"]);
  assert.equal(calls.filter((args) => args[0] === "image").length, 2);
});
