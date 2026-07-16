const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BrowserCapabilityHost,
  assertPublicBrowserUrl,
  browserExecutableCandidates,
  isPrivateAddress,
  normalizeElementRef,
} = require("../src/browser-capability.cjs");

test("browser URL policy blocks local and private destinations", async () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("10.1.2.3"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  await assert.rejects(() => assertPublicBrowserUrl("http://localhost/admin"), /private/u);
  await assert.rejects(
    () => assertPublicBrowserUrl("https://internal.example/", {
      lookup: async () => [{ address: "192.168.1.5", family: 4 }],
    }),
    /private/u,
  );
  const parsed = await assertPublicBrowserUrl("https://example.com/path", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(parsed.hostname, "example.com");
});

test("browser tools accept only snapshot references and known capabilities", async () => {
  assert.equal(normalizeElementRef("@e12"), "e12");
  assert.throws(() => normalizeElementRef("button.submit"), /snapshot/u);
  const host = new BrowserCapabilityHost({
    BrowserWindow: class {},
    session: {},
    dialog: {},
    app: {},
  });
  await assert.rejects(
    () => host.execute({ sessionId: "session-1", capabilityId: "browser_execute_script", arguments: {} }),
    /invalid/u,
  );
});

test("Chrome and Edge candidates use dedicated installed browser executables", () => {
  assert.equal(browserExecutableCandidates("chrome").some((value) => value.endsWith("chrome.exe")), true);
  assert.equal(browserExecutableCandidates("edge").some((value) => value.endsWith("msedge.exe")), true);
});
