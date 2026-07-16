const { app, BrowserWindow, dialog, session } = require("electron");
const { BrowserCapabilityHost } = require("../src/browser-capability.cjs");

app.whenReady().then(async () => {
  const host = new BrowserCapabilityHost({
    app,
    BrowserWindow,
    dialog,
    session,
  });
  try {
    const opened = await host.execute({
      sessionId: "browser-smoke",
      capabilityId: "browser_navigate",
      arguments: { url: "https://example.com/", mode: "isolated" },
    });
    const snapshot = await host.execute({
      sessionId: "browser-smoke",
      capabilityId: "browser_snapshot",
      arguments: { browser_session_id: opened.browser_session_id, max_chars: 5000 },
    });
    await host.execute({
      sessionId: "browser-smoke",
      capabilityId: "browser_close",
      arguments: { browser_session_id: opened.browser_session_id },
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: opened.mode,
      url: snapshot.url,
      title: snapshot.title,
      text: snapshot.text,
      interactive_count: snapshot.interactive?.length || 0,
    })}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code || "browser_smoke_failed",
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    app.exit(1);
  }
});
