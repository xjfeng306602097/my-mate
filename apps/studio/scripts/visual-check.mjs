import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(new URL("../../mobile/package.json", import.meta.url));
const WebSocket = require("ws");

const studioUrl = process.env.STUDIO_VISUAL_URL || "http://127.0.0.1:5174";
const cdpPort = Number(process.env.CHROME_CDP_PORT || 9223);
const cdpBaseUrl = `http://127.0.0.1:${cdpPort}`;
const screenshotPath =
  process.env.STUDIO_VISUAL_SCREENSHOT ||
  path.resolve(process.cwd(), "tmp/studio-visual-check.png");

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return await response.json();
}

async function openChromeTab(url) {
  try {
    return await fetchJson(`${cdpBaseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
    });
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
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || "CDP command failed"));
      } else {
        resolve(message.result || {});
      }
      return;
    }
    const eventHandlers = handlers.get(message.method);
    if (eventHandlers) {
      for (const handler of eventHandlers) {
        handler(message.params || {});
      }
    }
  });

  return {
    ready: new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    close: () => ws.close(),
    on(method, handler) {
      const eventHandlers = handlers.get(method) || [];
      eventHandlers.push(handler);
      handlers.set(method, eventHandlers);
    },
    send(method, params = {}) {
      const id = nextId++;
      const payload = JSON.stringify({ id, method, params });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(payload);
      });
    },
  };
}

function waitForEvent(client, method, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
    client.on(method, (params) => {
      clearTimeout(timer);
      resolve(params);
    });
  });
}

async function waitForExpression(client, expression, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.result?.value) {
      return result.result.value;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function ensureMissionWorkspaceReady(client, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const stateResult = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const surfaceCount = document.querySelectorAll('.mission-main-surface-card').length;
        const firstMission = document.querySelector('[data-action="select-session"]');
        return {
          surfaceCount,
          hasMissionList: !!firstMission,
        };
      })()`,
      returnByValue: true,
    });
    const snapshot = stateResult.result?.value || {};
    if (snapshot.surfaceCount === 5) {
      return snapshot;
    }
    if (snapshot.hasMissionList) {
      await client.send("Runtime.evaluate", {
        expression: `(() => {
          const firstMission = document.querySelector('[data-action="select-session"]');
          if (!firstMission) return false;
          firstMission.click();
          return true;
        })()`,
        returnByValue: true,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for mission workspace surfaces to render.");
}

async function main() {
  await fetchJson(`${cdpBaseUrl}/json/version`);
  const tab = await openChromeTab(studioUrl);
  const client = createCdpClient(tab.webSocketDebuggerUrl);
  const frontendErrors = [];

  await client.ready;
  client.on("Runtime.exceptionThrown", (params) => {
    frontendErrors.push(params.exceptionDetails?.text || "Runtime exception");
  });
  client.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") {
      frontendErrors.push(
        params.args?.map((arg) => arg.value || arg.description || "").filter(Boolean).join(" ") ||
          "Console error",
      );
    }
  });

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const loaded = waitForEvent(client, "Page.loadEventFired");
  await client.send("Page.navigate", { url: studioUrl });
  await loaded;
  await waitForExpression(client, "!!document.querySelector('.desktop-grid')");
  await waitForExpression(
    client,
    "document.querySelectorAll('.mission-main-surface-card').length === 5 || !!document.querySelector('[data-action=\"select-session\"]')",
  );
  await ensureMissionWorkspaceReady(client);

  const domResult = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const surfaces = [...document.querySelectorAll('.mission-main-surface-card')];
      const supportPanels = [...document.querySelectorAll('.mission-support-panel')];
      const operationalPanels = [...document.querySelectorAll('.operational-context-panel')];
      const railPanels = [...document.querySelectorAll('.desktop-rail > .rail-panel')];
      const feedFilters = [...document.querySelectorAll('[data-action="set-workspace-feed-filter"]')];
      const surfaceGrid = document.querySelector('.mission-main-surface-grid');
      const contextStrip = document.querySelector('.mission-context-strip');
      return {
        title: document.title,
        surfaceCount: surfaces.length,
        supportPanelCount: supportPanels.length,
        operationalPanelCount: operationalPanels.length,
        railPanelCount: railPanels.length,
        feedFilterCount: feedFilters.length,
        hasMissionInspector: !!document.querySelector('.mission-inspector-panel'),
        surfacesBeforeContext: !!surfaceGrid && !!contextStrip &&
          surfaceGrid.getBoundingClientRect().top < contextStrip.getBoundingClientRect().top,
        bodyTextLength: document.body.innerText.trim().length,
      };
    })()`,
    returnByValue: true,
  });
  const dom = domResult.result?.value || {};

  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  client.close();

  if (frontendErrors.length) {
    throw new Error(`Frontend errors: ${frontendErrors.join(" | ")}`);
  }
  if (dom.bodyTextLength < 200) {
    throw new Error("Studio page appears blank or under-rendered.");
  }
  if (dom.surfaceCount !== 5) {
    throw new Error(`Expected 5 mission surface cards, found ${dom.surfaceCount}.`);
  }
  if (!dom.surfacesBeforeContext) {
    throw new Error("Mission surfaces do not render before the context strip.");
  }
  if (!dom.hasMissionInspector) {
    throw new Error("Mission inspector rail panel is missing.");
  }
  if (dom.feedFilterCount !== 5) {
    throw new Error(`Expected 5 workspace feed filters, found ${dom.feedFilterCount}.`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        studioUrl,
        screenshotPath,
        ...dom,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
