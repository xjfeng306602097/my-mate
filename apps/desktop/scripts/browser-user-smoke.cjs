const { app, BrowserWindow, session } = require("electron");
const { BrowserCapabilityHost } = require("../src/browser-capability.cjs");

const mode = process.env.MY_MATE_BROWSER_SMOKE_MODE === "edge" ? "edge" : "chrome";

app.whenReady().then(async () => {
  const host = new BrowserCapabilityHost({
    app,
    BrowserWindow,
    session,
    dialog: { showMessageBox: async () => ({ response: 0 }) },
  });
  try {
    const opened = await host.execute({
      sessionId: `browser-${mode}-smoke`,
      capabilityId: "browser_navigate",
      arguments: { url: "https://example.com/", mode },
    });
    const snapshot = await host.execute({
      sessionId: `browser-${mode}-smoke`,
      capabilityId: "browser_snapshot",
      arguments: { browser_session_id: opened.browser_session_id, max_chars: 5000 },
    });
    await host.closeAll({ terminateUserBrowsers: true });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode,
      url: snapshot.url,
      title: snapshot.title,
      visible: opened.visible,
      text: snapshot.text,
    })}\n`);
    app.exit(0);
  } catch (error) {
    await host.closeAll({ terminateUserBrowsers: true });
    process.stderr.write(`${JSON.stringify({
      ok: false,
      mode,
      code: error?.code || "browser_smoke_failed",
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    app.exit(1);
  }
});
