import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../mobile/package.json", import.meta.url));
const WebSocket = require("ws");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const [name, inlineValue] = value.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[name] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[name] = argv[index + 1];
      index += 1;
    } else {
      args[name] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const studioUrl = String(args["studio-url"] || process.env.STUDIO_CONVERSATION_URL || "http://127.0.0.1:5174");
const cdpPort = Number(args["cdp-port"] || process.env.CHROME_CDP_PORT || 9223);
const cdpBaseUrl = `http://127.0.0.1:${cdpPort}`;
const prompt = String(
  args.prompt ||
  "UI regression: What is the weather in Guangzhou today? If live data is unavailable, say so directly. Do not create a workflow.",
);
const stamp = new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "");
const outputDir = path.resolve(
  repoRoot,
  String(args["out-dir"] || `tmp/conversation-ui-regression/${stamp}`),
);
const screenshotPath = path.join(outputDir, "conversation.png");
const summaryPath = path.join(outputDir, "summary.json");

const forbiddenReplyPatterns = [
  /anchored the mission/i,
  /before I draft the workflow/i,
  /constraints or success criteria should shape the workflow/i,
  /turn the current brief into an initial DAG/i,
  /comparing full plan options/i,
];

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json();
}

async function openChromeTab(url) {
  try {
    return await fetchJson(`${cdpBaseUrl}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  } catch {
    return await fetchJson(`${cdpBaseUrl}/json/new?${encodeURIComponent(url)}`);
  }
}

function createCdpClient(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();

  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message || "CDP command failed"));
      else request.resolve(message.result || {});
      return;
    }
    for (const handler of handlers.get(message.method) || []) handler(message.params || {});
  });

  return {
    ready: new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    close: () => ws.close(),
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) || []), handler]);
    },
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function waitForExpression(client, expression, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value) return result.result.value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for browser state: ${expression}`);
}

function orchestratorUrl() {
  const url = new URL(studioUrl);
  url.search = "?nav=orchestrator";
  return url.toString();
}

async function main() {
  await fetch(studioUrl).then((response) => {
    if (!response.ok) throw new Error(`Studio returned ${response.status} at ${studioUrl}`);
  });
  await fetchJson(`${cdpBaseUrl}/json/version`);
  const chromeTab = await openChromeTab(orchestratorUrl());
  const client = createCdpClient(chromeTab.webSocketDebuggerUrl);
  const frontendErrors = [];

  try {
    await client.ready;
    client.on("Runtime.exceptionThrown", (event) => {
      frontendErrors.push(event.exceptionDetails?.text || "Runtime exception");
    });
    client.on("Runtime.consoleAPICalled", (event) => {
      if (event.type === "error") {
        frontendErrors.push(event.args?.map((item) => item.value || item.description || "").join(" ") || "Console error");
      }
    });
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await waitForExpression(
      client,
      "!!document.querySelector('[aria-label=\"Task description\"]') || !!document.querySelector('[data-action=\"new-task\"]')",
    );
    await client.send("Runtime.evaluate", {
      expression: `(() => {
        const button = document.querySelector('[data-action="new-task"]');
        if (button) button.click();
        return true;
      })()`,
      returnByValue: true,
    });
    await waitForExpression(
      client,
      `(() => {
        const task = document.querySelector('[aria-label="Task description"]');
        const model = document.querySelector('[aria-label="Conversation model"]');
        return !!task && !!model && !!model.value && !!model.options[model.selectedIndex]?.value;
      })()`,
    );

    const prepared = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const textarea = document.querySelector('[aria-label="Task description"]');
        const model = document.querySelector('[aria-label="Conversation model"]');
        textarea.value = ${JSON.stringify(prompt)};
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          model: model.options[model.selectedIndex]?.textContent?.trim() || '',
          modelValue: model.value,
        };
      })()`,
      returnByValue: true,
    });
    const selectedModel = prepared.result?.value || {};
    if (!selectedModel.modelValue) throw new Error("No verified conversation model is selected in New task.");

    await waitForExpression(
      client,
      "(() => { const button = document.querySelector('[data-action=\"orchestrator-send-message\"]'); return !!button && !button.disabled; })()",
    );
    await client.send("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector('[data-action="orchestrator-send-message"]').click();
        return true;
      })()`,
      returnByValue: true,
    });

    const result = await waitForExpression(
      client,
      `(() => {
        const articles = [...document.querySelectorAll('.orchestrator-message')];
        const reply = [...articles].reverse().find((item) => item.querySelector('.conversation-source'));
        const error = document.querySelector('.alert.danger')?.textContent?.trim() || '';
        if (!reply && !error) return null;
        const source = reply?.querySelector('.conversation-source');
        const grid = document.querySelector('.task-workspace-grid');
        const center = grid?.querySelector(':scope > .desktop-center');
        const rail = grid?.querySelector(':scope > .task-conversation-rail-container');
        const conversationScroll = rail?.querySelector('.task-conversation-scroll');
        const centerRect = center?.getBoundingClientRect();
        const railRect = rail?.getBoundingClientRect();
        return {
          url: location.href,
          sessionId: new URL(location.href).searchParams.get('session') || '',
          replyText: reply?.querySelector('p')?.textContent?.trim() || '',
          sourceText: source?.textContent?.trim() || '',
          sourceTitle: source?.getAttribute('title') || '',
          sourceIsProvider: source?.classList.contains('provider') || false,
          selectedSessionText: document.querySelector('[data-action="select-session"].selected')?.textContent?.trim() || '',
          layout: {
            hasGrid: !!grid,
            hasWorkboard: !!center?.querySelector('.task-workboard-panel'),
            conversationInCenter: !!center?.querySelector('.task-conversation-rail'),
            conversationInRail: !!rail?.querySelector('.task-conversation-rail'),
            splitColumns: !!centerRect && !!railRect && centerRect.right <= railRect.left,
            centerOverflowY: center ? getComputedStyle(center).overflowY : '',
            chatOverflowY: conversationScroll ? getComputedStyle(conversationScroll).overflowY : '',
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
          },
          error,
        };
      })()`,
      120000,
    );

    const scrollStability = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const center = document.querySelector('.task-workspace-grid > .desktop-center');
        const feed = document.querySelector('.task-conversation-rail .task-conversation-scroll');
        const selector = document.querySelector('.task-conversation-rail [data-field="planner.conversationTarget"]');
        if (!center || !feed || !selector) return { supported: false };
        center.scrollTop = Math.min(72, Math.max(0, center.scrollHeight - center.clientHeight));
        feed.scrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight - 72);
        const before = { center: center.scrollTop, feed: feed.scrollTop };
        selector.dispatchEvent(new Event('change', { bubbles: true }));
        const nextCenter = document.querySelector('.task-workspace-grid > .desktop-center');
        const nextFeed = document.querySelector('.task-conversation-rail .task-conversation-scroll');
        return {
          supported: true,
          before,
          after: { center: nextCenter?.scrollTop || 0, feed: nextFeed?.scrollTop || 0 },
        };
      })()`,
      returnByValue: true,
    }).then((evaluation) => evaluation.result?.value || { supported: false });

    const screenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await mkdir(outputDir, { recursive: true });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

    if (frontendErrors.length) throw new Error(`Frontend errors: ${frontendErrors.join(" | ")}`);
    if (result.error) throw new Error(`Studio conversation error: ${result.error}`);
    if (!result.sessionId) throw new Error("The UI did not navigate to the created Session.");
    if (!result.sourceIsProvider || !result.sourceText || !result.sourceTitle) {
      throw new Error("The assistant reply is missing visible Provider/model evidence.");
    }
    if (!result.replyText) throw new Error("The Provider reply is empty.");
    if (!result.layout?.hasGrid || !result.layout?.hasWorkboard) {
      throw new Error(`The task Workboard layout is missing: ${JSON.stringify(result.layout)}`);
    }
    if (result.layout.conversationInCenter || !result.layout.conversationInRail || !result.layout.splitColumns) {
      throw new Error(`Conversation is not isolated in the desktop right rail: ${JSON.stringify(result.layout)}`);
    }
    if (!['auto', 'scroll'].includes(result.layout.centerOverflowY) || !['auto', 'scroll'].includes(result.layout.chatOverflowY)) {
      throw new Error(`Task surfaces do not have independent scrolling: ${JSON.stringify(result.layout)}`);
    }
    if (result.layout.documentHeight > result.layout.viewportHeight + 2) {
      throw new Error(`Desktop task page exceeds the viewport: ${JSON.stringify(result.layout)}`);
    }
    if (scrollStability.supported && (
      scrollStability.before.center !== scrollStability.after.center ||
      scrollStability.before.feed !== scrollStability.after.feed
    )) {
      throw new Error(`A task re-render reset scroll positions: ${JSON.stringify(scrollStability)}`);
    }
    if (forbiddenReplyPatterns.some((pattern) => pattern.test(result.replyText))) {
      throw new Error(`Legacy workflow guidance leaked into the Provider reply: ${result.replyText}`);
    }
    if (/draft a workflow|review workflow|run workflow/i.test(result.selectedSessionText)) {
      throw new Error(`The task rail unexpectedly advanced to a workflow action: ${result.selectedSessionText}`);
    }

    const detailUrl = new URL(`/api/sessions/${encodeURIComponent(result.sessionId)}`, studioUrl);
    const detail = await fetchJson(detailUrl);
    const structuralMessages = (detail.messages || []).filter((message) =>
      ["draft_card", "plan_card", "plan_options_card"].includes(message.kind),
    );
    if (structuralMessages.length) {
      throw new Error(
        `A plain conversation prompt created structural workflow messages: ${structuralMessages.map((item) => item.kind).join(", ")}`,
      );
    }

    if (!args["keep-session"]) {
      const archiveUrl = new URL(`/api/sessions/${encodeURIComponent(result.sessionId)}/archive`, studioUrl);
      const archived = await fetch(archiveUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requested_by: "conversation-ui-regression", reason: "Disposable UI regression Session." }),
      });
      if (!archived.ok) throw new Error(`Failed to archive regression Session: ${archived.status}`);
    }

    const summary = {
      ok: true,
      verified_at: new Date().toISOString(),
      studio_url: studioUrl,
      session_id: result.sessionId,
      selected_model: selectedModel.model,
      provider_evidence: result.sourceText,
      provider_evidence_detail: result.sourceTitle,
      layout: result.layout,
      scroll_stability: scrollStability,
      reply: result.replyText,
      archived: !args["keep-session"],
      screenshot_path: screenshotPath,
    };
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ ...summary, summary_path: summaryPath }, null, 2));
  } finally {
    try {
      await client.send("Page.close");
    } catch {
      // Chrome may close the socket before acknowledging Page.close.
    }
    client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
