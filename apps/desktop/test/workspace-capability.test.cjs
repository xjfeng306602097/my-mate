const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  canonicalDirectory,
  isWithinRoot,
  listWorkspaceDirectory,
  readWorkspaceText,
  rejectUnsafeRelativePath,
  sensitivePathReason,
} = require("../src/workspace-capability.cjs");

async function fixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "my-mate-desktop-"));
  await fs.promises.mkdir(path.join(root, "src"));
  await fs.promises.writeFile(path.join(root, "src", "hello.txt"), "hello desktop\n");
  await fs.promises.writeFile(path.join(root, ".env"), "SECRET=value\n");
  return root;
}

test("workspace paths cannot escape the selected root", async (t) => {
  const root = await fixture();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const canonical = await canonicalDirectory(root);
  assert.equal(isWithinRoot(canonical, path.join(canonical, "src")), true);
  assert.equal(isWithinRoot(canonical, path.dirname(canonical)), false);
  assert.throws(() => rejectUnsafeRelativePath(path.resolve(root, "src")), /relative/u);
  await assert.rejects(() => readWorkspaceText(canonical, "../outside.txt"), /escapes/u);
});

test("directory listing filters sensitive files and returns relative entries", async (t) => {
  const root = await fixture();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const listing = await listWorkspaceDirectory(await canonicalDirectory(root));
  assert.deepEqual(listing.items.map((item) => item.name), ["src"]);
  assert.equal(listing.items[0].relativePath, "src");
  assert.match(sensitivePathReason(path.join(root, ".env")), /blocked/u);
});

test("bounded text reads return content and a real file URL", async (t) => {
  const root = await fixture();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const result = await readWorkspaceText(await canonicalDirectory(root), "src/hello.txt");
  assert.equal(result.content, "hello desktop\n");
  assert.equal(result.relativePath, "src/hello.txt");
  assert.match(result.fileUrl, /^file:/u);
});

test("sensitive and unsupported files are rejected", async (t) => {
  const root = await fixture();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const canonical = await canonicalDirectory(root);
  await assert.rejects(() => readWorkspaceText(canonical, ".env"), /blocked/u);
  await fs.promises.writeFile(path.join(root, "image.png"), Buffer.from([1, 2, 3]));
  await assert.rejects(() => readWorkspaceText(canonical, "image.png"), /recognized text/u);
});

test("resolved links cannot escape the workspace root", async (t) => {
  const root = await fixture();
  const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), "my-mate-outside-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  t.after(() => fs.promises.rm(outside, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(outside, "outside.txt"), "not workspace context\n");
  try {
    await fs.promises.symlink(outside, path.join(root, "linked-outside"), "junction");
  } catch (error) {
    t.skip(`Link creation is unavailable: ${error.code || error.message}`);
    return;
  }
  const canonical = await canonicalDirectory(root);
  await assert.rejects(() => readWorkspaceText(canonical, "linked-outside/outside.txt"), /resolved path escapes/u);
});
