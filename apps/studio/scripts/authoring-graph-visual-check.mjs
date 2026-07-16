import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(new URL("../../mobile/package.json", import.meta.url));
const WebSocket = require("ws");
const studioUrl = process.env.STUDIO_VISUAL_URL || "http://127.0.0.1:5674/?nav=templates";
const cdpBase = `http://127.0.0.1:${process.env.CHROME_CDP_PORT || "9223"}`;
const outputDir = path.resolve(process.cwd(), "tmp/authoring-graph");

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json();
}

async function openTab() {
  const url = `${cdpBase}/json/new?${encodeURIComponent(studioUrl)}`;
  try {
    return await json(url, { method: "PUT" });
  } catch {
    return await json(url);
  }
}

function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let id = 0;
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result || {});
  });
  return {
    ready: new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed");
  return result.result?.value;
}

async function waitFor(client, expression, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(client, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function clickSelector(client, selector) {
  const point = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Missing click target ${selector}`);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

async function openDag(client) {
  await waitFor(client, `!!document.querySelector('[data-action="switch-view"][data-view="dag"]')`);
  await clickSelector(client, '[data-action="switch-view"][data-view="dag"]');
  await waitFor(client, `!!document.querySelector('.authoring-graph-canvas')`);
}

async function screenshot(client, name) {
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outputDir, name), Buffer.from(result.data, "base64"));
}

async function assertLayout(client, viewport) {
  const result = await evaluate(client, `(() => {
    const panel = document.querySelector('.authoring-graph-canvas-panel');
    const canvas = document.querySelector('.authoring-graph-canvas');
    const review = document.querySelector('.authoring-graph-review-strip');
    const rects = [panel, canvas, review].filter(Boolean).map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return {
      bodyOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      zeroSize: rects.some((rect) => rect.right <= rect.left || rect.bottom <= rect.top),
      nodes: document.querySelectorAll('.authoring-graph-node').length,
      ports: document.querySelectorAll('.authoring-port').length,
      validation: document.querySelector('.authoring-graph-review-strip')?.textContent || '',
    };
  })()`);
  if (result.bodyOverflow || result.zeroSize || result.nodes < 2 || result.ports < result.nodes * 2) {
    throw new Error(`${viewport} layout failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function main() {
  await json(`${cdpBase}/json/version`);
  await mkdir(outputDir, { recursive: true });
  const tab = await openTab();
  const client = connect(tab.webSocketDebuggerUrl);
  await client.ready;
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Page.navigate", { url: studioUrl });
    await openDag(client);
    const initialNodes = await evaluate(client, `document.querySelectorAll('.authoring-graph-node').length`);
    const initialEdges = await evaluate(client, `document.querySelectorAll('.authoring-graph-edge').length`);
    await clickSelector(client, '[data-action="add-node"]');
    await waitFor(client, `document.querySelectorAll('.authoring-graph-node').length === ${initialNodes + 1}`);
    await clickSelector(client, `.authoring-graph-node[data-index="${initialNodes - 1}"] .authoring-port-out`);
    await clickSelector(client, `.authoring-graph-node[data-index="${initialNodes}"] .authoring-port-in`);
    await waitFor(client, `document.querySelectorAll('.authoring-graph-edge').length === ${initialEdges + 1}`);
    await clickSelector(client, '[data-action="undo-authoring"]');
    await waitFor(client, `document.querySelectorAll('.authoring-graph-edge').length === ${initialEdges}`);
    await clickSelector(client, '[data-action="redo-authoring"]');
    await waitFor(client, `document.querySelectorAll('.authoring-graph-edge').length === ${initialEdges + 1}`);

    const drag = await evaluate(client, `(() => {
      const element = document.querySelector('.authoring-graph-node[data-index="${initialNodes}"]');
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + 60, y: rect.top + 24 };
    })()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...drag });
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: drag.x + 70, y: drag.y + 50 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: drag.x + 70, y: drag.y + 50 });
    await waitFor(client, `document.querySelector('.authoring-graph-review-strip')?.textContent.includes('layout changed')`);
    const desktop = await assertLayout(client, "desktop");
    await screenshot(client, "desktop.png");

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const mobile = await assertLayout(client, "mobile");
    await screenshot(client, "mobile.png");
    console.log(JSON.stringify({ ok: true, desktop, mobile, outputDir }, null, 2));
  } finally {
    client.close();
    await fetch(`${cdpBase}/json/close/${tab.id}`);
  }
}

await main();
