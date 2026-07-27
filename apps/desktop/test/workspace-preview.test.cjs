const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { WorkspacePreviewHost } = require("../src/workspace-preview.cjs");

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-preview-"));
  const workspace = path.join(parent, "workspace");
  const site = path.join(workspace, "dist");
  const outside = path.join(parent, "outside");
  fs.mkdirSync(path.join(site, "assets"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(site, "index.html"), '<!doctype html><script type="module" src="./assets/app.js"></script><canvas></canvas>', "utf8");
  fs.writeFileSync(path.join(site, "assets", "app.js"), "document.body.dataset.ready = 'true';\n", "utf8");
  fs.writeFileSync(path.join(site, "assets", "style.css"), "canvas { width: 100px; }\n", "utf8");
  fs.writeFileSync(path.join(outside, "secret.js"), "globalThis.secret = true;\n", "utf8");
  return { parent, workspace, site, outside };
}

test("localhost Workspace preview serves a nonce-scoped site and blocks escapes", async () => {
  const { parent, workspace, site, outside } = fixture();
  const host = new WorkspacePreviewHost({ idleTimeoutMs: 30_000 });
  try {
    const preview = await host.start({ workspaceRoot: workspace, relativePath: "dist/index.html" });
    assert.match(preview.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/$/u);

    const page = await fetch(preview.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") || "", /^text\/html/u);
    assert.match(page.headers.get("content-security-policy") || "", /connect-src 'none'/u);
    assert.match(await page.text(), /<canvas>/u);

    const script = await fetch(new URL("assets/app.js", preview.url));
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") || "", /^text\/javascript/u);

    const missing = await fetch(new URL("missing/", preview.url));
    assert.equal(missing.status, 404, "Directory listing must never be exposed.");
    const traversal = await fetch(`${preview.url}..%2F..%2Foutside%2Fsecret.js`);
    assert.equal(traversal.status, 404);
    const invalidNonce = await fetch(preview.url.replace(/\/[^/]+\/$/u, "/wrong/"));
    assert.equal(invalidNonce.status, 404);

    try {
      fs.symlinkSync(outside, path.join(site, "escape"), "junction");
      const symlinkEscape = await fetch(new URL("escape/secret.js", preview.url));
      assert.equal(symlinkEscape.status, 404);
    } catch (error) {
      if (!error || !["EPERM", "EACCES"].includes(error.code)) throw error;
    }

    const reused = await host.start({ workspaceRoot: workspace, relativePath: "dist/index.html" });
    assert.equal(reused.url, preview.url);
    assert.equal(reused.reused, true);
    await host.closeAll();
    await assert.rejects(() => fetch(preview.url));
  } finally {
    await host.closeAll();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("Workspace preview only accepts index.html inside the authorized root", async () => {
  const { parent, workspace, site, outside } = fixture();
  const host = new WorkspacePreviewHost();
  try {
    fs.writeFileSync(path.join(site, "other.html"), "other", "utf8");
    await assert.rejects(
      () => host.start({ workspaceRoot: workspace, relativePath: "dist/other.html" }),
      (error) => error?.code === "invalid-preview-entry",
    );
    await assert.rejects(
      () => host.start({ workspaceRoot: workspace, relativePath: path.join("..", path.basename(outside), "secret.js") }),
      (error) => error?.code === "outside-workspace",
    );
  } finally {
    await host.closeAll();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
