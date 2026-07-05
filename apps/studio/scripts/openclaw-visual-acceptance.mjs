import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../mobile/package.json", import.meta.url));
const WebSocket = require("ws");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) continue;
    const [key, inlineValue] = raw.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node apps/studio/scripts/openclaw-visual-acceptance.mjs [options]

Options:
  --summary <path>       main-openclaw-proposal-e2e summary.json. Defaults to latest.
  --out-dir <path>       Directory for screenshots and visual-summary.json.
  --studio-url <url>     Studio base URL. Defaults to summary.services.studio_base_url or 5174.
  --url <url>            Full Studio URL to open. Overrides --studio-url.
  --cdp-port <port>      Chrome remote debugging port. Defaults to CHROME_CDP_PORT or 9223.
  --close-existing-studio-tabs
                         Close existing Chrome tabs for the target Studio port first.
`);
}

function resolveExistingPath(input) {
  if (!input) return null;
  if (path.isAbsolute(input)) return input;
  const cwdPath = path.resolve(process.cwd(), input);
  if (existsSync(cwdPath)) return cwdPath;
  return path.resolve(repoRoot, input);
}

function resolveOutputPath(input) {
  if (!input) return null;
  if (path.isAbsolute(input)) return input;
  return path.resolve(repoRoot, input);
}

async function findLatestSummaryPath() {
  const root = path.join(repoRoot, "tmp", "main-openclaw-proposal-e2e");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const summaryPath = path.join(root, entry.name, "summary.json");
    if (!existsSync(summaryPath)) continue;
    const stats = await stat(summaryPath);
    candidates.push({ summaryPath, mtimeMs: stats.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!candidates.length) {
    throw new Error(`No E2E summary.json found under ${root}. Run scripts/main-openclaw-proposal-e2e.mjs first.`);
  }
  return candidates[0].summaryPath;
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return await response.json();
}

async function ensureCdpReachable(cdpBaseUrl) {
  try {
    await fetchJson(`${cdpBaseUrl}/json/version`);
  } catch (error) {
    throw new Error(
      `Chrome CDP is not reachable at ${cdpBaseUrl}. Start Chrome with --remote-debugging-port before running visual acceptance. ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function openChromeTab(cdpBaseUrl, url) {
  try {
    return await fetchJson(`${cdpBaseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
    });
  } catch {
    return await fetchJson(`${cdpBaseUrl}/json/new?${encodeURIComponent(url)}`);
  }
}

async function closeChromeTab(cdpBaseUrl, tabId) {
  if (!tabId) return;
  try {
    await fetch(`${cdpBaseUrl}/json/close/${encodeURIComponent(tabId)}`);
  } catch {
    // Closing the tab is best-effort cleanup after evidence has been captured.
  }
}

async function closeExistingStudioTabs(cdpBaseUrl, studioBaseUrl) {
  const target = new URL(studioBaseUrl);
  const tabs = await fetchJson(`${cdpBaseUrl}/json`).catch(() => []);
  if (!Array.isArray(tabs)) return;
  for (const tab of tabs) {
    if (tab?.type !== "page" || !tab.id || !tab.url) continue;
    let tabUrl = null;
    try {
      tabUrl = new URL(tab.url);
    } catch {
      continue;
    }
    if (tabUrl.hostname === target.hostname && tabUrl.port === target.port) {
      await closeChromeTab(cdpBaseUrl, tab.id);
    }
  }
}

function createCdpClient(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();

  function rejectPending(error) {
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(error);
    }
  }

  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || "CDP command failed"));
      } else {
        resolve(message.result || {});
      }
      return;
    }
    for (const handler of handlers.get(message.method) || []) {
      handler(message.params || {});
    }
  });
  ws.on("close", () => rejectPending(new Error("CDP socket closed.")));
  ws.on("error", (error) => rejectPending(error));

  return {
    ready: new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    close: () => ws.close(),
    on(method, handler) {
      const list = handlers.get(method) || [];
      list.push(handler);
      handlers.set(method, list);
    },
    send(method, params = {}, timeoutMs = 30000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for CDP command ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

function waitForEvent(client, method, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
    client.on(method, (params) => {
      clearTimeout(timer);
      resolve(params);
    });
  });
}

async function waitForOptionalEvent(client, method, timeoutMs = 3000) {
  try {
    return await waitForEvent(client, method, timeoutMs);
  } catch {
    return null;
  }
}

async function waitForExpression(client, expression, timeoutMs = 60000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await client.send(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
        },
        10000,
      );
      if (result.result?.value) return result.result.value;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const suffix = lastError instanceof Error ? ` Last evaluation error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for expression: ${expression}.${suffix}`);
}

function normalizeUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return String(value || "");
  }
}

async function ensureBrowserLocation(client, url) {
  const current = await client
    .send(
      "Runtime.evaluate",
      {
        expression: "window.location.href",
        returnByValue: true,
      },
      10000,
    )
    .catch(() => null);
  if (normalizeUrl(current?.result?.value) === normalizeUrl(url)) {
    return;
  }
  const loaded = waitForOptionalEvent(client, "Page.loadEventFired", 10000);
  await client
    .send(
      "Runtime.evaluate",
      {
        expression: `window.location.href = ${JSON.stringify(url)}`,
        returnByValue: true,
      },
      10000,
    )
    .catch(() => null);
  await loaded;
}

async function readDomDebugSnapshot(client) {
  const result = await client
    .send(
      "Runtime.evaluate",
      {
        expression: `(() => ({
          href: window.location.href,
          title: document.title,
          bodyText: document.body?.innerText?.slice(0, 1200) || "",
          surfaceCount: document.querySelectorAll(".mission-main-surface-card").length,
          hasDesktopGrid: !!document.querySelector(".desktop-grid"),
        }))()`,
        returnByValue: true,
      },
      10000,
    )
    .catch(() => null);
  return result?.result?.value || null;
}

function requireId(ids, key) {
  const value = ids?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`E2E summary is missing ids.${key}.`);
  }
  return value.trim();
}

function buildStudioMissionUrl({ explicitUrl, studioBaseUrl, sessionId }) {
  if (explicitUrl) return explicitUrl;
  const baseUrl = studioBaseUrl.replace(/\/+$/g, "");
  return `${baseUrl}/?nav=missions&session=${encodeURIComponent(sessionId)}&wf=outputs&wfe=1`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const summaryPath = resolveExistingPath(args.summary || process.env.OPENCLAW_E2E_SUMMARY) || (await findLatestSummaryPath());
  const summary = await readJsonFile(summaryPath);
  if (!summary?.ok) {
    throw new Error(`E2E summary is not ok: ${summaryPath}`);
  }

  const sessionId = requireId(summary.ids, "session_id");
  const proposalId = requireId(summary.ids, "proposal_id");
  const runId = requireId(summary.ids, "run_id");
  const dispatchId = requireId(summary.ids, "dispatch_id");
  const summaryStamp = path.basename(path.dirname(summaryPath));
  const outDir =
    resolveOutputPath(args["out-dir"] || process.env.OPENCLAW_VISUAL_OUT_DIR) ||
    path.join(repoRoot, "tmp", "openclaw-visual-acceptance", summaryStamp);
  const studioBaseUrl =
    String(args["studio-url"] || process.env.STUDIO_VISUAL_URL || summary.services?.studio_base_url || "http://127.0.0.1:5174");
  const studioUrl = buildStudioMissionUrl({
    explicitUrl: args.url,
    studioBaseUrl,
    sessionId,
  });
  const cdpPort = Number(args["cdp-port"] || process.env.CHROME_CDP_PORT || 9223);
  const cdpBaseUrl = `http://127.0.0.1:${cdpPort}`;

  await ensureCdpReachable(cdpBaseUrl);
  if (args["close-existing-studio-tabs"]) {
    await closeExistingStudioTabs(cdpBaseUrl, studioBaseUrl);
  }
  const tab = await openChromeTab(cdpBaseUrl, "about:blank");
  const client = createCdpClient(tab.webSocketDebuggerUrl);
  const frontendErrors = [];
  const networkEvents = [];

  await client.ready;
  client.on("Runtime.exceptionThrown", (params) => {
    frontendErrors.push(params.exceptionDetails?.text || "Runtime exception");
  });
  client.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") {
      frontendErrors.push(
        params.args?.map((arg) => arg.value || arg.description || "").filter(Boolean).join(" ") || "Console error",
      );
    }
  });
  client.on("Network.requestWillBeSent", (params) => {
    const url = params.request?.url || "";
    if (url.includes("/api/")) {
      networkEvents.push({ type: "request", url });
    }
  });
  client.on("Network.responseReceived", (params) => {
    const url = params.response?.url || "";
    if (url.includes("/api/")) {
      networkEvents.push({ type: "response", url, status: params.response?.status || null });
    }
  });
  client.on("Network.loadingFailed", (params) => {
    networkEvents.push({
      type: "failed",
      requestId: params.requestId,
      errorText: params.errorText || "",
      canceled: Boolean(params.canceled),
    });
  });

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const loaded = waitForOptionalEvent(client, "Page.loadEventFired");
  try {
    await client.send("Page.navigate", { url: studioUrl }, 15000);
  } catch {
    // Some Chrome builds keep Page.navigate pending while the navigation still
    // proceeds. ensureBrowserLocation and the DOM assertions below verify the
    // final page state.
  }
  await loaded;
  await ensureBrowserLocation(client, studioUrl);

  await waitForExpression(client, "!!document.querySelector('.desktop-grid')");
  try {
    await waitForExpression(
      client,
      `document.body.innerText.includes(${JSON.stringify(sessionId)}) || document.body.innerText.includes("Main OpenClaw proposal E2E")`,
    );
  } catch (error) {
    const debug = await readDomDebugSnapshot(client);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; DOM snapshot: ${JSON.stringify(debug)}; ` +
        `Network tail: ${JSON.stringify(networkEvents.slice(-30))}`,
    );
  }
  await waitForExpression(client, `document.body.innerText.includes(${JSON.stringify(proposalId)})`);
  await waitForExpression(client, `document.body.innerText.includes(${JSON.stringify("Runtime Graph")})`);
  await waitForExpression(
    client,
    `(() => {
      const feedText = document.querySelector('[data-workspace-focus="workspace-feed"]')?.innerText || "";
      return feedText.includes(${JSON.stringify(dispatchId)}) && feedText.includes("agent-report") && feedText.includes("handoff");
    })()`,
    120000,
  );

  const domResult = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const text = document.body.innerText;
      const lowerText = text.toLowerCase();
      const feedText = document.querySelector('[data-workspace-focus="workspace-feed"]')?.innerText || "";
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) };
      };
      return {
        url: window.location.href,
        title: document.title,
        bodyTextLength: text.trim().length,
        hasMissionTitle: text.includes("Main OpenClaw proposal E2E"),
        hasProposalTrace: !!document.querySelector(".proposal-trace-panel") && text.includes(${JSON.stringify(proposalId)}),
        hasRuntimeGraph: !!document.querySelector(".runtime-graph-panel") && text.includes("Runtime Graph") && text.includes("completed"),
        hasMissionInspector: !!document.querySelector(".mission-inspector-panel") && text.includes("Mission Inspector"),
        hasWorkspaceFeed: !!document.querySelector('[data-workspace-focus="workspace-feed"]') && text.includes("Workspace Feed"),
        feedText,
        hasReturnedOutputs: feedText.toLowerCase().includes("returned outputs") && feedText.includes("agent-report") && feedText.includes("handoff"),
        hasDispatchEvidence: text.includes(${JSON.stringify(dispatchId)}),
        feedExpanded: text.includes("Expanded"),
        outputFilterSelected: !![...document.querySelectorAll('[data-action="set-workspace-feed-filter"]')]
          .find((button) => button.textContent.includes("Outputs") && button.classList.contains("selected")),
        surfaceCount: document.querySelectorAll(".mission-main-surface-card").length,
        railPanelCount: document.querySelectorAll(".desktop-rail > .rail-panel").length,
        proposalRect: rect(".proposal-trace-panel"),
        runtimeGraphRect: rect(".runtime-graph-panel"),
        workspaceFeedRect: rect('[data-workspace-focus="workspace-feed"]'),
      };
    })()`,
    returnByValue: true,
  });
  const dom = domResult.result?.value || {};

  await mkdir(outDir, { recursive: true });
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const screenshotPath = path.join(outDir, "studio-openclaw-session.png");

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector(".proposal-trace-panel")?.scrollIntoView({ block: "center", inline: "nearest" })`,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const proposalScreenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const proposalScreenshotPath = path.join(outDir, "studio-openclaw-proposal-trace.png");

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector(".runtime-graph-panel")?.scrollIntoView({ block: "center", inline: "nearest" })`,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const runtimeScreenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const runtimeScreenshotPath = path.join(outDir, "studio-openclaw-runtime-graph.png");
  const visualSummaryPath = path.join(outDir, "visual-summary.json");

  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  await writeFile(proposalScreenshotPath, Buffer.from(proposalScreenshot.data, "base64"));
  await writeFile(runtimeScreenshotPath, Buffer.from(runtimeScreenshot.data, "base64"));

  const failures = [];
  if (frontendErrors.length) failures.push(`frontend errors: ${frontendErrors.join(" | ")}`);
  for (const [key, label] of [
    ["hasMissionTitle", "mission title"],
    ["hasProposalTrace", "proposal trace"],
    ["hasRuntimeGraph", "runtime graph completed"],
    ["hasMissionInspector", "mission inspector"],
    ["hasWorkspaceFeed", "workspace feed"],
    ["hasReturnedOutputs", "returned outputs"],
    ["hasDispatchEvidence", "dispatch evidence"],
    ["feedExpanded", "expanded feed"],
    ["outputFilterSelected", "outputs filter selected"],
  ]) {
    if (!dom[key]) failures.push(`missing ${label}`);
  }
  if (dom.surfaceCount < 5) failures.push(`expected at least 5 mission surfaces, found ${dom.surfaceCount}`);
  if (dom.bodyTextLength < 500) failures.push("page appears under-rendered");

  const visualSummary = {
    ok: failures.length === 0,
    verified_at: new Date().toISOString(),
    e2eSummaryPath: summaryPath,
    sessionId,
    proposalId,
    runId,
    dispatchId,
    screenshotPath,
    proposalScreenshotPath,
    runtimeScreenshotPath,
    visualSummaryPath,
    failures,
    ...dom,
  };

  await writeFile(visualSummaryPath, `${JSON.stringify(visualSummary, null, 2)}\n`);
  client.close();
  await closeChromeTab(cdpBaseUrl, tab.id);

  if (failures.length) {
    throw new Error(`Visual acceptance failed: ${failures.join("; ")}. Summary: ${visualSummaryPath}`);
  }

  console.log(JSON.stringify(visualSummary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
