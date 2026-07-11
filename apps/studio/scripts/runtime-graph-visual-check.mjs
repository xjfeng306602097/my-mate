import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { findDagLayoutOverlaps } from "../src/dag-layout.js";
import { getRuntimeGraphFixture, RUNTIME_GRAPH_FIXTURE_NAMES } from "../src/runtime-graph-fixtures.js";
import { buildRuntimeGraphModel } from "../src/runtime-graph-model.js";

const layoutOnly = process.argv.includes("--layout-only");
const studioUrl = (process.env.STUDIO_VISUAL_URL || "http://127.0.0.1:5174").replace(/\/$/, "");
const cdpPort = Number(process.env.CHROME_CDP_PORT || 9223);
const cdpBaseUrl = `http://127.0.0.1:${cdpPort}`;
const outputDir = path.resolve(process.cwd(), "tmp/runtime-graph-visual");

function buildFixtureModel(name) {
  const fixture = getRuntimeGraphFixture(name);
  return buildRuntimeGraphModel({
    ...fixture,
    selectedNodeRunId: fixture.graph.nodes[0]?.nodeRunId || "",
    nowMs: Date.parse("2026-07-10T08:10:00.000Z"),
  });
}

function assertEdgeEndpoints(model) {
  const nodeById = new Map(model.nodes.map((node) => [node.nodeRunId, node]));
  for (const edge of model.edges.filter((item) => item.valid)) {
    const from = nodeById.get(edge.fromNodeRunId);
    const to = nodeById.get(edge.toNodeRunId);
    assert.ok(from && to, `${model.runId}: edge endpoint node missing`);
    assert.ok(edge.fromX === from.x || edge.fromX === from.x + from.width, `${edge.id}: source endpoint is not on node boundary`);
    assert.ok(edge.toX === to.x || edge.toX === to.x + to.width, `${edge.id}: target endpoint is not on node boundary`);
    assert.ok(edge.fromY >= from.y && edge.fromY <= from.y + from.height, `${edge.id}: source Y is outside node boundary`);
    assert.ok(edge.toY >= to.y && edge.toY <= to.y + to.height, `${edge.id}: target Y is outside node boundary`);
  }
}

function runLayoutAcceptance() {
  const summaries = [];
  for (const name of RUNTIME_GRAPH_FIXTURE_NAMES) {
    const fixture = getRuntimeGraphFixture(name);
    const model = buildFixtureModel(name);
    const overlaps = findDagLayoutOverlaps(model.layout);
    assert.deepEqual(overlaps, [], `${name}: runtime nodes overlap`);
    assert.ok(model.layout.bounds.width > 0 && model.layout.bounds.height > 0, `${name}: graph bounds are empty`);
    assert.equal(model.nodes.length, fixture.graph.nodes.length, `${name}: node count changed during projection`);
    assertEdgeEndpoints(model);

    const statusOnlyFixture = structuredClone(fixture);
    if (statusOnlyFixture.graph.nodes[0]) statusOnlyFixture.graph.nodes[0].status = "running";
    const statusModel = buildRuntimeGraphModel({
      ...statusOnlyFixture,
      selectedNodeRunId: statusOnlyFixture.graph.nodes[0]?.nodeRunId || "",
      nowMs: Date.parse("2026-07-10T08:10:00.000Z"),
    });
    assert.deepEqual(
      statusModel.nodes.map((node) => [node.nodeRunId, node.x, node.y, node.width, node.height]),
      model.nodes.map((node) => [node.nodeRunId, node.x, node.y, node.width, node.height]),
      `${name}: status-only update changed layout`,
    );
    summaries.push({ name, nodes: model.nodes.length, edges: model.edges.length, width: model.layout.width, height: model.layout.height });
  }
  return summaries;
}

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

function createCdpClient(WebSocket, webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message || "CDP command failed"));
      else entry.resolve(message.result || {});
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

async function waitForExpression(client, expression, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value) return result.result.value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function inspectFixture(WebSocket, fixtureName, viewport) {
  const url = `${studioUrl}/runtime-graph-fixture.html?fixture=${encodeURIComponent(fixtureName)}&drawer=1`;
  const tab = await openChromeTab(url);
  const client = createCdpClient(WebSocket, tab.webSocketDebuggerUrl);
  const frontendErrors = [];
  await client.ready;
  client.on("Runtime.exceptionThrown", (params) => frontendErrors.push(params.exceptionDetails?.text || "Runtime exception"));
  client.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") frontendErrors.push(params.args?.map((arg) => arg.value || arg.description || "").join(" ") || "Console error");
  });
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width <= 700 });
  await client.send("Page.navigate", { url });
  await waitForExpression(client, "!!window.__runtimeGraphFixture && !!document.querySelector('.runtime-graph-v2')");

  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const visible = (element) => element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
      const intersects = (left, right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
      const viewport = document.querySelector('.runtime-graph-viewport');
      const drawer = document.querySelector('.runtime-node-drawer');
      const surface = document.querySelector('.runtime-graph-surface');
      const nodes = [...document.querySelectorAll('.runtime-graph-node')].filter(visible);
      const overlaps = [];
      nodes.forEach((left, leftIndex) => nodes.slice(leftIndex + 1).forEach((right) => {
        if (intersects(left.getBoundingClientRect(), right.getBoundingClientRect())) overlaps.push([left.dataset.nodeRunId, right.dataset.nodeRunId]);
      }));
      const selected = document.querySelector('.runtime-graph-node.selected, .runtime-graph-list-node.selected');
      const canvasVisible = visible(viewport);
      const selectedRect = selected?.getBoundingClientRect();
      const selectedVisible = !selectedRect || (selectedRect.bottom >= 0 && selectedRect.top <= innerHeight && selectedRect.right >= 0 && selectedRect.left <= innerWidth);
      return {
        canvasVisible,
        listVisible: visible(document.querySelector('.runtime-graph-list-fallback')),
        graphWidth: surface?.getBoundingClientRect().width || 0,
        graphHeight: surface?.getBoundingClientRect().height || 0,
        nodeCount: window.__runtimeGraphFixture.model.nodes.length,
        renderedNodeCount: nodes.length,
        edgeCount: document.querySelectorAll('.runtime-graph-edge-line').length,
        overlaps,
        selectedVisible,
        drawerPresent: !!drawer,
        drawerCanvasOverlap: visible(drawer) && visible(viewport) ? intersects(drawer.getBoundingClientRect(), viewport.getBoundingClientRect()) : false,
        toolbarWidth: document.querySelector('.runtime-run-toolbar')?.getBoundingClientRect().width || 0,
        bodyOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        statusTones: [...new Set([...document.querySelectorAll('.runtime-graph-node, .runtime-graph-list-node .runtime-status-dot')].map((element) => [...element.classList].find((name) => name.startsWith('tone-'))).filter(Boolean))],
      };
    })()`,
    returnByValue: true,
  });
  const dom = result.result?.value || {};
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const screenshotPath = path.join(outputDir, `${fixtureName}-${viewport.width}x${viewport.height}.png`);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  await client.send("Page.close").catch(() => {});
  client.close();

  assert.deepEqual(frontendErrors, [], `${fixtureName} ${viewport.width}x${viewport.height}: frontend errors`);
  assert.deepEqual(dom.overlaps, [], `${fixtureName} ${viewport.width}x${viewport.height}: DOM node overlap`);
  assert.ok(dom.selectedVisible, `${fixtureName} ${viewport.width}x${viewport.height}: selected node is not visible`);
  assert.ok(dom.toolbarWidth > 0, `${fixtureName} ${viewport.width}x${viewport.height}: toolbar is blank`);
  assert.equal(dom.drawerCanvasOverlap, false, `${fixtureName} ${viewport.width}x${viewport.height}: drawer overlaps canvas`);
  assert.equal(dom.bodyOverflow, false, `${fixtureName} ${viewport.width}x${viewport.height}: page has horizontal overflow`);
  if (viewport.width > 700) {
    assert.ok(dom.canvasVisible, `${fixtureName}: desktop canvas is hidden`);
    assert.ok(dom.graphWidth > 0 && dom.graphHeight > 0, `${fixtureName}: desktop graph bounds are blank`);
    assert.equal(dom.renderedNodeCount, dom.nodeCount, `${fixtureName}: desktop node render count mismatch`);
  } else {
    assert.ok(dom.listVisible, `${fixtureName}: mobile topology list is hidden`);
  }
  return { fixtureName, viewport, screenshotPath, ...dom };
}

async function main() {
  const layouts = runLayoutAcceptance();
  if (layoutOnly) {
    console.log(JSON.stringify({ ok: true, mode: "layout-only", fixtures: layouts }, null, 2));
    return;
  }
  await fetch(`${studioUrl}/runtime-graph-fixture.html`).then((response) => {
    if (!response.ok) throw new Error(`Studio fixture page returned ${response.status}`);
  });
  await fetchJson(`${cdpBaseUrl}/json/version`);
  const require = createRequire(new URL("../../mobile/package.json", import.meta.url));
  const WebSocket = require("ws");
  await mkdir(outputDir, { recursive: true });
  const cases = [
    ...RUNTIME_GRAPH_FIXTURE_NAMES.map((fixtureName) => ({ fixtureName, viewport: { width: 1440, height: 900 } })),
    { fixtureName: "twenty", viewport: { width: 1280, height: 720 } },
    { fixtureName: "waiting", viewport: { width: 390, height: 844 } },
    { fixtureName: "failed", viewport: { width: 360, height: 800 } },
  ];
  const visual = [];
  for (const item of cases) visual.push(await inspectFixture(WebSocket, item.fixtureName, item.viewport));
  const summaryPath = path.join(outputDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify({ ok: true, layouts, visual }, null, 2));
  console.log(JSON.stringify({ ok: true, summaryPath, screenshots: visual.map((item) => item.screenshotPath) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
