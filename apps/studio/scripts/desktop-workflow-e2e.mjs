import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(new URL("../../mobile/package.json", import.meta.url));
const WebSocket = require("ws");
const port = process.env.MY_MATE_DESKTOP_CDP_PORT || "9223";
const base = process.env.MY_MATE_DESKTOP_URL || "http://127.0.0.1:6374";
const controlPlaneBase = process.env.MY_MATE_CONTROL_PLANE_URL || "http://127.0.0.1:6372";
const scenario = process.env.MY_MATE_DESKTOP_WORKFLOW_SCENARIO || "editor-smoke";
const resumeFrom = process.env.MY_MATE_DESKTOP_WORKFLOW_RESUME || "";
const resumedDagId = process.env.MY_MATE_DESKTOP_DAG_ID || "";
const resumedTemplateId = process.env.MY_MATE_DESKTOP_TEMPLATE_ID || "production-incident-response";
const manualHumanGate = process.env.MY_MATE_DESKTOP_MANUAL_GATE === "1";
const editorOnly = process.env.MY_MATE_DESKTOP_E2E_EDITOR_ONLY === "1";
const outputDir = path.resolve(
  process.cwd(),
  scenario === "production-incident"
    ? "output/desktop-workflow-production-e2e"
    : "output/desktop-workflow-e2e",
);

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(url + " returned " + response.status + (body ? ": " + body.slice(0, 1200) : ""));
  }
  return response.json();
}

async function resolveE2EProvider() {
  const registry = await json(controlPlaneBase + "/api/registry/provider-connections");
  const connections = Array.isArray(registry?.items) ? registry.items : [];
  const usable = connections.filter((connection) =>
    connection?.status === "active" &&
    connection?.credential_configured === true &&
    connection?.verification?.status === "verified" &&
    typeof connection?.default_model === "string" &&
    connection.default_model.trim() &&
    Array.isArray(connection.models) &&
    connection.models.includes(connection.default_model),
  );
  const connection = usable.find((item) => item.connection_id === "big-model-smart-agi") || usable[0];
  if (!connection) {
    throw new Error("Desktop E2E requires an active, credential-ready, verified Provider Connection with a valid default model.");
  }
  return {
    connectionId: connection.connection_id,
    model: connection.default_model,
  };
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out connecting to the Desktop CDP endpoint.")), 10_000);
    socket.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result || {});
  });
  socket.on("close", () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("Desktop CDP connection closed before the command completed."));
    }
    pending.clear();
  });
  return {
    ready,
    close: () => socket.close(),
    send(method, params = {}, timeoutMs = 15_000) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Desktop CDP command timed out: ${method}`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
  };
}

async function recordStage(evidence, name, detail = {}) {
  evidence.current_stage = name;
  evidence.updated_at = new Date().toISOString();
  Object.assign(evidence, detail);
  await writeFile(
    path.join(outputDir, scenario === "production-incident" ? "incident-progress.json" : "progress.json"),
    JSON.stringify(evidence, null, 2),
    "utf8",
  );
  console.log(`[desktop-e2e] ${name}`);
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result?.value;
}

async function waitFor(client, expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out: " + expression);
}

async function click(client, selector) {
  await client.send("Page.bringToFront");
  let point = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    point = await evaluate(client, "(() => { const selector = " + JSON.stringify(selector) + "; const matches = [...document.querySelectorAll(selector)]; const visible = matches.find((element) => { const r = element.getBoundingClientRect(); const style = getComputedStyle(element); return (r.width > 0 || r.height > 0) && style.visibility !== 'hidden' && style.display !== 'none'; }); if (!visible) return null; visible.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); const diagnostics = []; for (const current of [...document.querySelectorAll(selector)]) { const r = current.getBoundingClientRect(); if (r.width <= 0 && r.height <= 0) continue; const x = r.left + r.width / 2; const y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); diagnostics.push({ rect: { left: r.left, top: r.top, width: r.width, height: r.height }, hit: hit ? { tag: hit.tagName, className: String(hit.className || ''), action: hit.dataset?.action || '' } : null }); if (hit && current.contains(hit)) return { x, y, hitTarget: true, diagnostics }; } const r = visible.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, hitTarget: false, diagnostics }; })()");
    if (point) break;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (!point) throw new Error("Missing selector: " + selector);
  if (!point.hitTarget) throw new Error("Selector is visually obstructed: " + selector + " " + JSON.stringify(point.diagnostics));
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...point });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...point });
  await new Promise((resolve) => setTimeout(resolve, 40));
  return point;
}

async function clickUntil(client, selector, expression, timeout = 8000) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await click(client, selector);
    try {
      await waitFor(client, expression, timeout);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function connectPort(client, sourceIndex, targetIndex, expectedEdges) {
  const source = `.authoring-graph-node[data-index="${sourceIndex}"] .authoring-port-out`;
  const target = `.authoring-graph-node[data-index="${targetIndex}"] .authoring-port-in`;
  const sourcePoint = await evaluate(client, `(() => { const element = document.querySelector(${JSON.stringify(source)}); if (!element) return null; element.scrollIntoView({ block: 'center', inline: 'nearest' }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  if (!sourcePoint) throw new Error("Missing source port: " + source);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...sourcePoint });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...sourcePoint });
  try {
    await waitFor(client, "!!document.querySelector('.authoring-connection-hint')");
  } catch (error) {
    const debug = await evaluate(client, "(() => { const e = document.querySelector(" + JSON.stringify(source) + "); const r = e?.getBoundingClientRect(); const at = document.elementFromPoint(" + sourcePoint.x + ", " + sourcePoint.y + "); return { sourceIndex: " + sourceIndex + ", targetIndex: " + targetIndex + ", point: " + JSON.stringify(sourcePoint) + ", rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null, hit: at?.className || at?.tagName || null, hitIndex: at?.dataset?.index || null, edges: document.querySelectorAll('.authoring-graph-line').length }; })()");
    throw new Error("Source port did not enter connection mode: " + JSON.stringify(debug), { cause: error });
  }
  const hit = await evaluate(client, "(() => { const e = document.querySelector(" + JSON.stringify(target) + "); if (!e) return null; const r=e.getBoundingClientRect(); const at=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return {target:e.dataset.index, hit:at?.className || at?.tagName || null, x:r.left+r.width/2, y:r.top+r.height/2}; })()");
  if (!hit || !String(hit.hit || "").includes("authoring-port-in")) {
    throw new Error("Target port is not clickable: " + JSON.stringify(hit));
  }
  for (let step = 1; step <= 5; step += 1) {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "left",
      buttons: 1,
      x: sourcePoint.x + ((hit.x - sourcePoint.x) * step) / 5,
      y: sourcePoint.y + ((hit.y - sourcePoint.y) * step) / 5,
    });
  }
  await waitFor(client, "!!document.querySelector('[data-authoring-connection-preview]')");
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x: hit.x, y: hit.y });
  await waitFor(client, "document.querySelectorAll('.authoring-graph-line').length >= " + expectedEdges);
}

async function dragNode(client, index, deltaX, deltaY) {
  const selector = `.authoring-graph-node[data-index="${index}"] .authoring-graph-node-head`;
  const before = await evaluate(client, "(() => { const node = document.querySelector(" + JSON.stringify(`.authoring-graph-node[data-index="${index}"]`) + "); const handle = document.querySelector(" + JSON.stringify(selector) + "); if (!node || !handle) return null; const r = handle.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: parseFloat(node.style.left), top: parseFloat(node.style.top) }; })()");
  if (!before) throw new Error("Missing drag target: " + selector);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x: before.x, y: before.y });
  for (let step = 1; step <= 6; step += 1) {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "left",
      buttons: 1,
      x: before.x + (deltaX * step) / 6,
      y: before.y + (deltaY * step) / 6,
    });
  }
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x: before.x + deltaX, y: before.y + deltaY });
  await waitFor(client, "(() => { const node = document.querySelector(" + JSON.stringify(`.authoring-graph-node[data-index="${index}"]`) + "); return node && (Math.abs(parseFloat(node.style.left) - " + before.left + ") > 20 || Math.abs(parseFloat(node.style.top) - " + before.top + ") > 20); })()");
  return evaluate(client, "(() => { const node = document.querySelector(" + JSON.stringify(`.authoring-graph-node[data-index="${index}"]`) + "); return { left: parseFloat(node.style.left), top: parseFloat(node.style.top) }; })()");
}

async function marqueeSelectWorkflowNodes(client) {
  const points = await evaluate(client, `(() => {
    const canvas = document.querySelector('.authoring-graph-canvas');
    const surface = canvas?.querySelector('.authoring-graph-surface');
    const nodes = [...document.querySelectorAll('.authoring-graph-node')];
    if (!canvas || !surface || nodes.length < 2) return null;
    const canvasRect = canvas.getBoundingClientRect();
    const nodeRects = nodes.map((node) => node.getBoundingClientRect()).filter((rect) =>
      rect.right > canvasRect.left && rect.left < canvasRect.right && rect.bottom > canvasRect.top && rect.top < canvasRect.bottom
    );
    if (nodeRects.length < 2) return null;
    return {
      start: {
        x: Math.max(canvasRect.left + 5, Math.min(...nodeRects.map((rect) => rect.left)) - 12),
        y: Math.max(canvasRect.top + 5, Math.min(...nodeRects.map((rect) => rect.top)) - 12),
      },
      end: {
        x: Math.min(canvasRect.right - 5, Math.max(...nodeRects.map((rect) => rect.right)) + 8),
        y: Math.min(canvasRect.bottom - 5, Math.max(...nodeRects.map((rect) => rect.bottom)) + 8),
      },
      expected: nodeRects.length,
    };
  })()`);
  if (!points) throw new Error("Workflow marquee selection requires at least two visible nodes.");
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", modifiers: 8, ...points.start });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, modifiers: 8, ...points.start });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, modifiers: 8, ...points.end });
  await waitFor(client, `document.querySelectorAll('.authoring-graph-node.marquee-selected').length === ${points.expected}`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, modifiers: 8, ...points.end });
  await waitFor(client, `document.querySelectorAll('.authoring-graph-node.selected').length === ${points.expected}`);
  return points.expected;
}

async function setField(client, selector, value) {
  await click(client, selector);
  const actual = await evaluate(client, "(() => { const element = document.querySelector(" + JSON.stringify(selector) + "); if (!element) return null; const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, " + JSON.stringify(value) + "); element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: " + JSON.stringify(value) + " })); element.dispatchEvent(new Event('change', { bubbles: true })); return element.value; })()");
  if (actual !== value) throw new Error("Field was not replaced for " + selector + ": " + JSON.stringify(actual));
}

async function openNodeMenu(client) {
  if (!(await evaluate(client, "!!document.querySelector('[data-action=\\\"add-node-type\\\"]')"))) {
    await click(client, '[data-action="toggle-authoring-node-menu"]');
    await waitFor(client, "!!document.querySelector('[data-action=\"add-node-type\"]')");
  }
}

async function shot(client, name) {
  await writeFile(path.join(outputDir, name + ".txt"), await evaluate(client, "document.body.innerText"), "utf8");
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await client.send("Page.bringToFront");
      const result = await client.send(
        "Page.captureScreenshot",
        { format: "png", fromSurface: true, captureBeyondViewport: false },
        45_000,
      );
      await writeFile(path.join(outputDir, name + ".png"), Buffer.from(result.data, "base64"));
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Desktop screenshot failed: ${name}`);
}

async function configureWorkflowNode(client, input) {
  const selector = `.authoring-graph-node[data-index="${input.index}"]`;
  await click(client, selector);
  await waitFor(client, `!!document.querySelector('[data-field="node.name"][data-index="${input.index}"]')`);
  await setField(client, `[data-field="node.name"][data-index="${input.index}"]`, input.name);
  await setField(client, `[data-field="node.objective"][data-index="${input.index}"]`, input.objective);
  if (input.agentId) {
    await waitFor(client, `!!document.querySelector('[data-field="node.agent_id"] option[value=${JSON.stringify(input.agentId)}]:not([disabled])')`);
    await setField(client, `[data-field="node.agent_id"][data-index="${input.index}"]`, input.agentId);
  }
  if (input.type && input.type !== "agent_task") {
    const detailsSelector = `.workflow-step-inspector details.workflow-advanced-details`;
    const detailsOpen = await evaluate(client, `document.querySelector(${JSON.stringify(detailsSelector)})?.open === true`);
    if (!detailsOpen) await click(client, `${detailsSelector} summary`);
    await setField(client, `[data-field="node.type"][data-index="${input.index}"]`, input.type);
  }
  if (input.approvalKind) {
    await setField(client, `[data-field="node.approval_kind"][data-index="${input.index}"]`, input.approvalKind);
  }
  if (input.readOnlyTools && input.type !== "reducer" && input.type !== "approval") {
    const detailsSelector = `.workflow-step-inspector details.workflow-advanced-details`;
    const detailsOpen = await evaluate(client, `document.querySelector(${JSON.stringify(detailsSelector)})?.open === true`);
    if (!detailsOpen) await click(client, `${detailsSelector} summary`);
    const config = {
      objective: input.objective,
      allowed_tools: ["workspace_read_text"],
      acceptance_criteria: ["Return a concrete, auditable result for this synthetic incident without performing an external production action."],
      verification_steps: ["Check the supplied incident context and upstream durable evidence before returning the result."],
    };
    await setField(client, `[data-field="node.config"][data-index="${input.index}"]`, JSON.stringify(config, null, 2));
  }
}

async function addWorkflowNode(client, input) {
  await openNodeMenu(client);
  await click(client, `[data-action="add-node-type"][data-node-type="${input.menuType || "agent_task"}"]`);
  await waitFor(client, `document.querySelectorAll('.authoring-graph-node').length === ${input.index + 1}`);
  await configureWorkflowNode(client, input);
}

async function currentScheduleIds() {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await json(base + "/api/schedules");
      return new Set((response.items || []).map((item) => item.schedule_id));
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

async function assertNoUnexpectedSchedules(evidence, baseline, phase) {
  const current = await currentScheduleIds();
  const unexpected = [...current].filter((scheduleId) => !baseline.has(scheduleId));
  evidence.steps.push({ name: `incident_no_unexpected_schedule_${phase}`, ok: unexpected.length === 0, unexpected_schedule_ids: unexpected });
  if (unexpected.length) throw new Error(`Incident Sub Agents created unexpected schedules during ${phase}: ${unexpected.join(", ")}`);
}

async function verifyParentChildSessionExperience(client, evidence, sessionId, dagId, phase) {
  await client.send("Page.navigate", { url: base + "/?nav=orchestrator&session=" + encodeURIComponent(sessionId) });
  await waitFor(client, `!!document.querySelector('[data-workspace-focus="agent-work"]')`, 60_000);
  const sessionDetail = await json(base + "/api/sessions/" + encodeURIComponent(sessionId));
  const delegations = (sessionDetail.agent_delegations || []).filter((item) => item.agent_run_id);
  const childDelegations = delegations.filter((item) => item.child_session_id);
  const activityMessages = (sessionDetail.messages || []).filter((message) => message.kind === "agent_activity" && message.content?.agent_dag_id === dagId);
  const startedCards = (sessionDetail.messages || []).filter((message) =>
    message.kind === "run_card" &&
    message.content?.agent_dag_id === dagId &&
    message.content?.event === "started"
  );
  const runCatalog = await json(base + "/api/agent-runs");
  const dagRuns = (runCatalog.items || []).filter((run) => run.workflow_run_id === dagId);
  const rootRuns = dagRuns.filter((run) => run.node_run_id === null);
  const childRuns = dagRuns.filter((run) => run.node_run_id !== null);
  const projectionOk =
    startedCards.length === 1 &&
    rootRuns.length === 1 &&
    childRuns.length > 0 &&
    childRuns.every((run) => run.parent_agent_run_id === rootRuns[0].agent_run_id) &&
    childDelegations.length > 0 &&
    activityMessages.length > 0;
  await shot(client, `${phase}-parent-agent-activity`);
  evidence.steps.push({
    name: `${phase}_parent_child_projection`,
    ok: projectionOk,
    start_card_count: startedCards.length,
    root_agent_run_count: rootRuns.length,
    child_agent_run_count: childRuns.length,
    child_session_count: childDelegations.length,
    agent_activity_count: activityMessages.length,
  });
  if (!projectionOk) {
    throw new Error("Parent/Child Agent projection is incomplete: " + JSON.stringify(evidence.steps.at(-1)));
  }

  const openConversation = '[data-action="open-agent-delegation-conversation"]:not([disabled])';
  await waitFor(client, `!!document.querySelector(${JSON.stringify(openConversation)})`, 60_000);
  await clickUntil(client, openConversation, "!!document.querySelector('[data-agent-delegation-drawer]')");
  await shot(client, `${phase}-child-conversation-drawer`);
  const drawer = await evaluate(client, `({
    text: document.querySelector('[data-agent-delegation-drawer]')?.innerText || '',
    childSessionId: document.querySelector('[data-action="open-agent-delegation-task"]')?.dataset.sessionId || ''
  })`);
  const drawerText = drawer.text.toLocaleLowerCase();
  if (!drawer.childSessionId || !drawerText.includes("agent conversation") || !drawerText.includes("open full task")) {
    throw new Error("Child Agent conversation drawer is incomplete: " + JSON.stringify(drawer));
  }
  evidence.steps.push({ name: `${phase}_child_conversation_drawer`, ok: true, child_session_id: drawer.childSessionId });

  await clickUntil(
    client,
    '[data-action="open-agent-delegation-task"]',
    `!!document.querySelector('[data-action="open-parent-agent-task"][data-session-id=${JSON.stringify(sessionId)}]')`,
  );
  const childUrl = await evaluate(client, "location.href");
  await shot(client, `${phase}-full-child-task`);
  evidence.steps.push({
    name: `${phase}_full_child_task`,
    ok: childUrl.includes(encodeURIComponent(drawer.childSessionId)),
    child_session_id: drawer.childSessionId,
  });
  await clickUntil(
    client,
    `[data-action="open-parent-agent-task"][data-session-id="${sessionId}"]`,
    `location.href.includes(${JSON.stringify(encodeURIComponent(sessionId))})`,
  );
  evidence.steps.push({ name: `${phase}_return_to_main_task`, ok: true, session_id: sessionId });
}

async function completeIncidentAtHumanGate(client, evidence, sessionId, dagId, initialDetail, scheduleBaseline) {
  let detail = initialDetail;
  await client.send("Page.navigate", { url: base + "/?nav=agents" });
  const runsTab = '[data-action="switch-agent-tab"][data-tab="runs"]';
  await waitFor(client, `!!document.querySelector(${JSON.stringify(runsTab)})`);
  await clickUntil(client, runsTab, `document.querySelector(${JSON.stringify(runsTab)})?.getAttribute("aria-selected") === "true"`);
  await waitFor(client, `!!document.querySelector('[data-action="select-agent-dag"][data-dag-id=${JSON.stringify(dagId)}]')`, 60_000);
  const dagSelector = `[data-action="select-agent-dag"][data-dag-id="${dagId}"]`;
  const detailSelector = `.agent-dag-detail[data-agent-dag-id="${dagId}"]`;
  await clickUntil(client, dagSelector, `!!document.querySelector(${JSON.stringify(detailSelector)})`, 30_000);
  const recoveredApprovedGate = detail.gates?.find((gate) => gate.status === "approved");
  if (detail.dag.status === "waiting_human") {
    await waitFor(client, `!!document.querySelector('[data-action="resolve-agent-dag-gate"][data-dag-id=${JSON.stringify(dagId)}][data-approved="true"]')`);
    await shot(client, "16-incident-human-gate");
    evidence.steps.push({ name: "incident_human_gate", ok: true, dag_id: dagId, status: detail.dag.status });
    if (manualHumanGate) {
      console.log(JSON.stringify({ event: "incident_human_gate_ready", dag_id: dagId, session_id: sessionId }));
    } else {
      const approveGateSelector = `[data-action="resolve-agent-dag-gate"][data-dag-id="${dagId}"][data-approved="true"]`;
      await clickUntil(
        client,
        approveGateSelector,
        `(() => { const button = document.querySelector(${JSON.stringify(approveGateSelector)}); return !button || button.disabled; })()`,
      );
    }
    const gateDeadline = Date.now() + (manualHumanGate ? 300_000 : 60_000);
    let permissionCaptured = false;
    while (Date.now() < gateDeadline) {
      const permissionSelector = '.studio-dialog [data-action="respond-studio-dialog"][data-response="0"]';
      if (!permissionCaptured && await evaluate(client, `!!document.querySelector(${JSON.stringify(permissionSelector)})`)) {
        await shot(client, "16a-incident-workspace-permission");
        evidence.steps.push({ name: "incident_workspace_permission", ok: true, access: "sandbox-write" });
        permissionCaptured = true;
        if (!manualHumanGate) await click(client, permissionSelector);
      }
      detail = await json(base + "/api/agent-dags/" + encodeURIComponent(dagId));
      if (!detail.gates?.some((gate) => gate.status === "pending")) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (detail.gates?.some((gate) => gate.status === "pending")) {
      throw new Error("Incident Human Gate was not resolved before the Desktop approval timeout.");
    }
  } else if (recoveredApprovedGate) {
    evidence.steps.push({
      name: "incident_human_gate",
      ok: true,
      dag_id: dagId,
      status: recoveredApprovedGate.status,
      recovered: true,
      resolved_at: recoveredApprovedGate.resolved_at || null,
    });
  }
  const terminalDeadline = Date.now() + 600_000;
  while (Date.now() < terminalDeadline) {
    detail = await json(base + "/api/agent-dags/" + encodeURIComponent(dagId));
    if (["completed", "failed", "cancelled"].includes(detail.dag?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (detail?.dag?.status !== "completed") {
    throw new Error("Incident DAG did not complete after Human Gate approval: " + JSON.stringify({ status: detail?.dag?.status, tasks: detail?.tasks?.map((task) => ({ title: task.title, status: task.status })) }));
  }
  await assertNoUnexpectedSchedules(evidence, scheduleBaseline, "completed_run");
  await clickUntil(
    client,
    '[data-action="refresh-agent-orchestration"]',
    `document.querySelector('[data-action="select-agent-dag"][data-dag-id=${JSON.stringify(dagId)}]')?.innerText.includes(${JSON.stringify(detail.dag.status)})`,
    30_000,
  );
  await waitFor(client, `document.querySelector('[data-action="select-agent-dag"][data-dag-id=${JSON.stringify(dagId)}]')?.innerText.includes(${JSON.stringify(detail.dag.status)})`);
  await clickUntil(client, dagSelector, `!!document.querySelector(${JSON.stringify(detailSelector)})`, 30_000);
  await waitFor(client, `document.querySelector('.agent-dag-detail')?.innerText.includes(${JSON.stringify(detail.dag.status)})`);
  await shot(client, "17-incident-completed");
  const reviewer = detail.dag.nodes?.find((node) => node.role === "reviewer");
  const terminalOk = detail.tasks.every((task) => ["completed", "skipped"].includes(task.status)) && reviewer?.metadata?.review_verdict === "accepted";
  evidence.session_id = sessionId;
  evidence.dag_id = dagId;
  const completedSession = await json(base + "/api/sessions/" + encodeURIComponent(sessionId));
  const completedDelegations = (completedSession.agent_delegations || []).filter((item) => item.agent_run_id);
  const childSessionsComplete = completedDelegations.length > 0 && completedDelegations.every((item) => item.child_session_id);
  evidence.steps.push({ name: "incident_completed", ok: terminalOk && childSessionsComplete, status: detail.dag.status, reviewer_verdict: reviewer?.metadata?.review_verdict || null, child_session_count: completedDelegations.filter((item) => item.child_session_id).length, tasks: detail.tasks?.map((task) => ({ title: task.title, status: task.status })) });

  const aggregationDeadline = Date.now() + 180_000;
  while (Date.now() < aggregationDeadline) {
    detail = await json(base + "/api/agent-dags/" + encodeURIComponent(dagId));
    if (["completed", "failed"].includes(detail.aggregation?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (detail.aggregation?.status !== "completed") {
    throw new Error("Main Agent aggregation did not complete: " + JSON.stringify(detail.aggregation || null));
  }
  const summarizedSession = await json(base + "/api/sessions/" + encodeURIComponent(sessionId));
  const finalSummary = [...(summarizedSession.messages || [])].reverse().find((message) =>
    message.role === "orchestrator" &&
    message.kind === "text" &&
    message.content?.agent_dag_id === dagId &&
    message.content?.orchestration_summary === true
  );
  const finalSummaryOk =
    finalSummary?.content?.completion_contract?.status === "satisfied" &&
    typeof finalSummary.content.text === "string" &&
    finalSummary.content.text.trim().length > 100;
  await client.send("Page.navigate", { url: base + "/?nav=orchestrator&session=" + encodeURIComponent(sessionId) });
  await waitFor(client, "!!document.querySelector('[data-workspace-focus=\"agent-work\"]')", 60_000);
  const summarySelector = `article[data-orchestration-summary="true"][data-agent-dag-id="${dagId}"]`;
  await waitFor(client, `document.querySelector(${JSON.stringify(summarySelector)})?.innerText.trim().length > 100`, 60_000);
  await shot(client, "18-incident-final-summary");
  evidence.steps.push({
    name: "incident_final_summary",
    ok: finalSummaryOk,
    aggregation_status: detail.aggregation.status,
    attempt_count: detail.aggregation.attempt_count,
    completion_contract_status: finalSummary?.content?.completion_contract?.status || null,
    summary_length: finalSummary?.content?.text?.length || 0,
  });
  if (!finalSummaryOk) throw new Error("Main Agent final summary did not satisfy the completion contract.");
}

async function removeDefaultWorkflowEdge(client) {
  if (!(await evaluate(client, "document.querySelectorAll('.authoring-graph-line').length"))) return;
  await click(client, '.authoring-graph-line');
  await waitFor(client, "!!document.querySelector('[data-action=\"remove-edge\"]')");
  await click(client, '[data-action="remove-edge"]');
  await waitFor(client, "document.querySelectorAll('.authoring-graph-line').length === 0");
}

async function createAndRunIncidentWorkflow(client, evidence) {
  const scheduleBaseline = await currentScheduleIds();
  const workflowSuffix = Date.now();
  const workflowName = `Production Incident Response ${workflowSuffix}`;
  const workflowTemplateId = resumeFrom === "incident-published"
    ? resumedTemplateId
    : `production-incident-response-${workflowSuffix}`;
  if (resumeFrom === "incident-gate") {
    if (!resumedDagId) throw new Error("MY_MATE_DESKTOP_DAG_ID is required for incident-gate recovery.");
    const detail = await json(base + "/api/agent-dags/" + encodeURIComponent(resumedDagId));
    if (!["waiting_human", "running", "completed"].includes(detail?.dag?.status)) throw new Error("Recovered incident DAG cannot continue: " + JSON.stringify(detail?.dag?.status));
    evidence.steps.push({ name: "incident_human_gate_recovered", ok: true, dag_id: resumedDagId, state_revision: detail.dag.state_revision, status: detail.dag.status });
    await completeIncidentAtHumanGate(client, evidence, detail.dag.session_id, resumedDagId, detail, scheduleBaseline);
    return;
  }
  const intent = "Create a production incident response workflow with alert triage, parallel service and infrastructure diagnosis, containment planning, independent review, human approval, controlled remediation or rollback, verification, and a postmortem. Do not perform any real production action during this test.";
  let template = null;
  if (resumeFrom === "incident-published") {
    template = await json(base + "/api/templates/" + encodeURIComponent(workflowTemplateId));
    evidence.steps.push({ name: "incident_published_recovered", ok: template.status === "published" && template.nodes.length === 11 && template.edges.length === 11, template_id: template.template_id, status: template.status, node_count: template.nodes.length, edge_count: template.edges.length });
  } else {
  if (resumeFrom !== "incident-authored") {
    await client.send("Page.navigate", { url: base + "/?nav=templates" });
    await waitFor(client, "!!document.querySelector('[data-action=\"open-workflow-generator\"]')");
    // Initial template loading can replace the sidebar between locating the button and
    // dispatching the native mouse event. Re-resolve and retry until the generator is visible.
    await clickUntil(
      client,
      '[data-action="open-workflow-generator"]',
      "!!document.querySelector('[data-field=\"planner.intent\"]')",
    );
    await setField(client, '[data-field="planner.intent"]', intent);
    await setField(client, '[data-field="planner.inputsText"]', JSON.stringify({ severity: "SEV-1", environment: "synthetic", external_actions_allowed: false }, null, 2));
    await setField(client, '[data-field="planner.maxAgentNodes"]', "8");
    await clickUntil(
      client,
      '[data-action="generate-dag-draft"]',
      `document.querySelector('[data-action="generate-dag-draft"]')?.disabled === true`,
    );
    await waitFor(client, "!!document.querySelector('.planner-results') && !document.querySelector('[data-action=\"apply-dag-draft\"]')?.disabled", 45_000);
    const generated = await evaluate(client, `({
      text: document.querySelector('.planner-results')?.innerText || '',
      miniNodes: document.querySelectorAll('.planner-results .mini-node').length,
      hasWarnings: (document.querySelector('.planner-results')?.innerText || '').includes('warnings')
    })`);
    await shot(client, "08-incident-generator");
    evidence.steps.push({ name: "incident_generator", ok: generated.miniNodes > 0, generated });
    const adoptDraftSelector = '.studio-dialog [data-action="respond-studio-dialog"][data-response="0"]';
    await clickUntil(client, '[data-action="apply-dag-draft"]', `!!document.querySelector(${JSON.stringify(adoptDraftSelector)})`);
    await clickUntil(client, adoptDraftSelector, "!!document.querySelector('.authoring-graph-canvas')");
    const generatedEditor = await evaluate(client, "({ nodes: document.querySelectorAll('.authoring-graph-node').length, edges: document.querySelectorAll('.authoring-graph-line').length })");
    await shot(client, "09-incident-generated-draft");
    evidence.steps.push({ name: "incident_generated_draft_opened", ok: generatedEditor.nodes > 0, graph: generatedEditor });

    await clickUntil(client, '[data-action="new-template"]', "document.querySelector('[data-field=\"template.name\"]')?.value === 'New Workflow'");
    await setField(client, '[data-field="template.name"]', workflowName);
    await setField(client, '[data-field="template.description"]', "Triage a synthetic production incident, diagnose service and infrastructure in parallel, review and approve a containment plan, prepare controlled remediation or rollback, verify recovery, and capture a postmortem without silently changing production.");
    await clickUntil(client, '[data-action="switch-view"][data-view="dag"]', "!!document.querySelector('.authoring-graph-canvas')");
    await removeDefaultWorkflowEdge(client);
    await configureWorkflowNode(client, { index: 0, name: "Alert Triage", objective: "Classify the synthetic alert, establish severity, scope, and immediate safety constraints from the Mission input. Do not call tools or change production.", agentId: "ops-runner" });
    await addWorkflowNode(client, { index: 2, name: "Service Diagnosis", objective: "Analyze the service evidence supplied in the Mission input and produce likely application-level causes. Do not change files or systems.", agentId: "e2e-medium-backend" });
    await addWorkflowNode(client, { index: 3, name: "Infrastructure Diagnosis", objective: "Analyze the infrastructure evidence supplied in the Mission input and produce likely platform-level causes. Do not change production.", agentId: "ops-runner" });
    await addWorkflowNode(client, { index: 4, name: "Combine Findings", objective: "Combine service and infrastructure findings into one incident state.", type: "reducer" });
    await addWorkflowNode(client, { index: 5, name: "Containment Plan", objective: "Prepare a bounded containment plan using only Mission inputs and upstream node outputs as authoritative incident evidence. Copy the supplied rollback_trigger and recovery_criteria exactly. Label any additional thresholds or actions as proposals, never as observed facts. If review_feedback exists, use it only as revision instructions and never claim it was part of the original request or incident evidence. Preparing a plan and readiness checklist is allowed before approval; do not execute or publish a remediation package.", agentId: "ops-runner" });
    await addWorkflowNode(client, { index: 6, name: "Independent Review", objective: "Review the diagnosis and containment plan for evidence traceability and safety. Accept when factual claims are supported by Mission inputs or upstream outputs, added recommendations are explicitly labelled as proposals, the supplied rollback trigger and recovery criteria are preserved, and no external action is performed. Planning and readiness checklists are allowed before the Human Gate; only execution and publication of the remediation package require approval. Treat review_feedback as revision guidance rather than incident evidence.", agentId: "e2e-medium-reviewer" });
    await addWorkflowNode(client, { index: 7, name: "Incident Commander Approval", objective: "Require a human incident commander to approve the controlled remediation or rollback plan.", menuType: "approval", type: "approval", approvalKind: "prod_release" });
    await addWorkflowNode(client, { index: 8, name: "Controlled Remediation Or Rollback", objective: "Produce an operator-ready remediation or rollback package from the approved DAG state. This synthetic test must not execute external production actions.", agentId: "ops-runner" });
    await addWorkflowNode(client, { index: 9, name: "Recovery Verification", objective: "Verify the synthetic recovery evidence in the DAG state and determine whether service objectives are restored.", agentId: "e2e-medium-test" });
    await addWorkflowNode(client, { index: 10, name: "Postmortem", objective: "Create a concise postmortem from the accumulated DAG state with timeline, root cause, contributing factors, corrective actions, and owners.", agentId: "content-writer" });

    const edges = [[0,2],[0,3],[2,4],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,1]];
    for (let index = 0; index < edges.length; index += 1) {
      await connectPort(client, edges[index][0], edges[index][1], index + 1);
    }
  } else {
    await waitFor(client, "!!document.querySelector('.authoring-graph-canvas')");
    const recovered = await evaluate(client, `({
      name: document.querySelector('[data-field="template.name"]')?.value || '',
      nodes: document.querySelectorAll('.authoring-graph-node').length,
      edges: document.querySelectorAll('.authoring-graph-line').length,
      nodeNames: [...document.querySelectorAll('.authoring-graph-node')].map((node) => node.innerText)
    })`);
    const requiredNames = ["Alert Triage", "Incident Commander Approval", "Postmortem", "End"];
    const hasRequiredNodes = requiredNames.every((name) => recovered.nodeNames.some((text) => text.includes(name)));
    if (recovered.nodes !== 11 || recovered.edges !== 11 || !hasRequiredNodes) {
      throw new Error("Incident authoring checkpoint is not recoverable: " + JSON.stringify(recovered));
    }
    evidence.steps.push({ name: "incident_authoring_recovered", ok: true, ...recovered });
  }
  await click(client, '.authoring-graph-canvas-panel > .panel-header [data-action="fit-authoring-view"]');
  await shot(client, "10-incident-production-flow");
  evidence.steps.push({ name: "incident_flow_authored", ok: true, nodes: 11, edges: 11 });

  await click(client, '[data-action="validate-workflow"]');
  await waitFor(client, "!!document.querySelector('[data-action=\"publish-draft\"]')");
  const validation = await evaluate(client, "document.querySelector('.preview-panel')?.innerText || ''");
  await shot(client, "11-incident-validation");
  evidence.steps.push({ name: "incident_validation", ok: validation.includes("No local graph warnings"), validation });
  await clickUntil(client, '[data-action="save-draft"]', `document.body.innerText.includes(${JSON.stringify(`Saved ${workflowTemplateId}`)})`);
  await clickUntil(client, '[data-action="publish-draft"]', `document.body.innerText.includes(${JSON.stringify(`Published ${workflowTemplateId}`)})`);
  template = await json(base + "/api/templates/" + encodeURIComponent(workflowTemplateId));
  await shot(client, "12-incident-published");
  evidence.steps.push({ name: "incident_published", ok: template.status === "published" && template.nodes.length === 11 && template.edges.length === 11, template_id: template.template_id, status: template.status, node_count: template.nodes.length, edge_count: template.edges.length });
  }

  await client.send("Page.navigate", { url: base + "/?nav=library" });
  await waitFor(client, `!!document.querySelector('[data-action="use-library-workflow"][data-id=${JSON.stringify(workflowTemplateId)}]')`);
  await clickUntil(
    client,
    `[data-action="use-library-workflow"][data-id="${workflowTemplateId}"]`,
    "document.body.innerText.includes('Workflow selected. Describe the outcome to start the task.')",
  );
  const selectedWorkflow = await evaluate(client, "document.body.innerText.includes('Production Incident Response') || document.body.innerText.includes('Workflow selected')");
  evidence.steps.push({ name: "incident_selected_from_library", ok: selectedWorkflow });

  const provider = await resolveE2EProvider();
  evidence.steps.push({ name: "incident_provider_ready", ok: true, connection_id: provider.connectionId, model: provider.model });
  const createdSession = await json(controlPlaneBase + "/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `Production Incident Desktop E2E ${Date.now()}`,
      created_by: "desktop-production-e2e",
      provider_connection_id: provider.connectionId,
      model: provider.model,
      initial_message: "Run the synthetic incident response workflow. No real external production action is allowed. Approve nothing until the Human Gate is visible in Desktop.",
      defer_conversation_reply: true,
    }),
  });
  const sessionId = createdSession.session_id || createdSession.session?.session_id;
  if (!sessionId) throw new Error("Incident Desktop E2E could not create an isolated Session.");
  const workspaceBinding = await evaluate(client, `(async () => {
    const workspace = await window.myMateDesktop?.workspace?.get?.();
    if (!workspace?.capabilityId) return null;
    const response = await window.myMateDesktop.workspace.authorize({
      capabilityId: workspace.capabilityId,
      sessionId: ${JSON.stringify(sessionId)},
      access: "snapshot-read",
      scope: "session"
    });
    return response?.binding || null;
  })()`);
  evidence.steps.push({ name: "incident_workspace_binding", ok: true, required: false, binding_id: workspaceBinding?.binding_id || null, access: workspaceBinding?.access || null });
  const proposalResponse = await json(base + "/api/sessions/" + encodeURIComponent(sessionId) + "/dag-proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      template_id: template.template_id,
      inputs: {
        goal: "Safely assess and recover a synthetic checkout API incident. Planning and readiness checklists are allowed, but explicit human approval is required before publishing a final remediation package or performing any external action.",
        incident: {
          id: "INC-SYNTHETIC-001",
          severity: "SEV-1",
          environment: "synthetic",
          affected_service: "checkout-api",
          symptoms: ["HTTP 5xx increased from 0.2% to 18%", "p95 latency increased from 240ms to 2.8s"],
          service_evidence: ["Error signature: DatabasePoolTimeout", "Regression began immediately after release checkout-api-2026.07.22.3"],
          infrastructure_evidence: ["Database CPU remained below 45%", "No node, pod, or network saturation alerts"],
          last_change: "Connection pool size was reduced from 80 to 8 in release checkout-api-2026.07.22.3",
          safe_containment: "Prepare rollback to checkout-api-2026.07.22.2; do not execute it in this test",
          rollback_trigger: "Abort if error rate or latency worsens during the synthetic verification window",
          recovery_criteria: ["HTTP 5xx below 1%", "p95 latency below 400ms", "No DatabasePoolTimeout for 10 minutes"],
          external_actions_allowed: false,
        },
      },
    }),
  });
  const proposal = proposalResponse.proposal;
  if (proposal?.status !== "review_ready") throw new Error("Incident Proposal did not reach review_ready: " + JSON.stringify(proposal?.warnings || []));
  await client.send("Page.navigate", { url: base + "/?nav=orchestrator&session=" + encodeURIComponent(sessionId) });
  const confirmSelector = `[data-action="confirm-dag-proposal"][data-proposal-id="${proposal.proposal_id}"]`;
  await waitFor(client, `!!document.querySelector(${JSON.stringify(confirmSelector)})`, 60_000);
  const confirmLabel = await evaluate(client, `document.querySelector(${JSON.stringify(confirmSelector)})?.innerText || ''`);
  await shot(client, "13-incident-confirm-and-start");
  evidence.steps.push({
    name: "incident_confirm_and_start_ready",
    ok: ["Approve & start", "Confirm & start"].some((label) => confirmLabel.includes(label)),
    label: confirmLabel,
    proposal_id: proposal.proposal_id,
  });
  await clickUntil(
    client,
    confirmSelector,
    `(() => { const button = document.querySelector(${JSON.stringify(confirmSelector)}); return !button || button.disabled || button.innerText.includes('Starting'); })()`,
  );
  const confirmationDeadline = Date.now() + 120_000;
  let confirmedProposal = null;
  while (Date.now() < confirmationDeadline) {
    confirmedProposal = await json(base + "/api/sessions/" + encodeURIComponent(sessionId) + "/dag-proposals/" + encodeURIComponent(proposal.proposal_id));
    if (confirmedProposal.proposal?.compiled_agent_dag_id) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const dagId = confirmedProposal?.proposal?.compiled_agent_dag_id;
  if (!dagId) throw new Error("Confirm & start did not compile an Agent DAG through the Desktop UI.");
  evidence.steps.push({ name: "incident_confirm_and_start_applied", ok: confirmedProposal.proposal.status === "confirmed", dag_id: dagId });
  const gateDeadline = Date.now() + 600_000;
  let detail = null;
  while (Date.now() < gateDeadline) {
    detail = await json(base + "/api/agent-dags/" + encodeURIComponent(dagId));
    if (["waiting_human", "failed", "completed"].includes(detail.dag?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const writeEnabledTasks = (detail?.tasks || []).filter((task) => task.permission_ceiling?.workspace_write === true).map((task) => task.title);
  evidence.steps.push({ name: "incident_read_only_permission_ceiling", ok: writeEnabledTasks.length === 0, write_enabled_tasks: writeEnabledTasks });
  if (writeEnabledTasks.length) throw new Error("Read-only incident Workflow unexpectedly requested Workspace write permission: " + writeEnabledTasks.join(", "));
  await assertNoUnexpectedSchedules(evidence, scheduleBaseline, "before_human_gate");
  if (detail?.dag?.status !== "waiting_human") throw new Error("Incident DAG did not stop at Human Gate: " + JSON.stringify({ status: detail?.dag?.status, tasks: detail?.tasks?.map((task) => ({ title: task.title, status: task.status })) }));
  if (!detail.gates?.some((gate) => gate.status === "pending")) {
    const reviewer = detail.dag.nodes?.find((node) => node.role === "reviewer");
    throw new Error("Incident DAG entered waiting_human without a pending Human Gate: " + JSON.stringify({
      reviewer_verdict: reviewer?.metadata?.review_verdict || null,
      reviewer_issues: reviewer?.metadata?.review?.issues || [],
      tasks: detail.tasks?.map((task) => ({ title: task.title, status: task.status })),
    }));
  }
  await verifyParentChildSessionExperience(client, evidence, sessionId, dagId, "14-incident");
  await completeIncidentAtHumanGate(client, evidence, sessionId, dagId, detail, scheduleBaseline);
}

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  let targets = [];
  let target = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !target) {
    targets = await json("http://127.0.0.1:" + port + "/json/list");
    target = targets.find((item) => item.title === "My Mate Studio" && item.type === "page") || null;
    if (!target) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!target) throw new Error("Packaged My Mate Studio page was not found.");
  const client = connect(target.webSocketDebuggerUrl);
  await client.ready;
  const evidence = { started_at: new Date().toISOString(), steps: [] };
  await recordStage(evidence, "desktop_cdp_connected");
  const templateName = `Desktop DAG E2E ${Date.now()}`;
  const templateId = templateName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await recordStage(evidence, "desktop_runtime_enabled");
    if (scenario === "production-incident") {
      await createAndRunIncidentWorkflow(client, evidence);
      evidence.ok = evidence.steps.every((step) => step.ok);
      evidence.completed_at = new Date().toISOString();
      await writeFile(path.join(outputDir, "incident-evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
      console.log(JSON.stringify(evidence, null, 2));
      if (!evidence.ok) throw new Error("Production Desktop E2E evidence contains a failed step.");
      return;
    }
    await client.send("Page.navigate", { url: base + "/?nav=templates" });
    await recordStage(evidence, "workflow_editor_navigation_started");
    await waitFor(client, "!!document.querySelector('[data-action=\"new-template\"]')");
    const providerConnections = await json(base + "/api/registry/provider-connections");
    if (editorOnly && !(providerConnections.items || []).length) {
      await waitFor(client, "!!document.querySelector('.setup-modal-backdrop')");
    }
    if (await evaluate(client, "!!document.querySelector('.setup-modal-backdrop')")) {
      await click(client, '.setup-modal-footer [data-action="dismiss-studio-setup"]');
      await waitFor(client, "!document.querySelector('.setup-modal-backdrop')");
      evidence.steps.push({ name: "fresh_install_setup_deferred", ok: true, execution_ready: false });
      await recordStage(evidence, "fresh_install_setup_deferred");
    }
    await recordStage(evidence, "workflow_library_ready");
    let agentCatalog = await json(base + "/api/agents");
    const readyAgentIds = new Set(
      (agentCatalog.readiness || [])
        .filter((item) => item.state === "ready")
        .map((item) => item.agent_id),
    );
    const preferredReadyAgents = ["e2e-medium-backend", "ops-runner", "research-analyst"];
    let readyAgentId =
      preferredReadyAgents.find((agentId) => readyAgentIds.has(agentId)) ||
      (agentCatalog.items || []).find((agent) => agent.status === "active" && readyAgentIds.has(agent.agent_id))?.agent_id ||
      (editorOnly ? (agentCatalog.items || []).find((agent) => agent.status === "active")?.agent_id : null);
    if (!readyAgentId && editorOnly) {
      await client.send("Page.navigate", { url: base + "/?nav=agents" });
      await waitFor(client, "!!document.querySelector('[data-action=\"open-agent-creator\"]')");
      await clickUntil(
        client,
        '[data-action="open-agent-creator"]',
        "!!document.querySelector('[data-field=\"agentDefinition.name\"]')",
      );
      await setField(client, '[data-field="agentDefinition.name"]', "Desktop Editor E2E Agent");
      await setField(client, '[data-field="agentDefinition.description"]', "Unbound Agent created through the packaged Desktop UI for deterministic Workflow Editor acceptance.");
      await click(client, '[data-action="create-agent-definition"]');
      await waitFor(client, "!!document.querySelector('[data-action=\"respond-studio-dialog\"][data-response=\"0\"]')");
      await click(client, '[data-action="respond-studio-dialog"][data-response="0"]');
      await waitFor(client, "!!document.querySelector('.agent-library-row[data-agent-id=\"desktop-editor-e2e-agent\"]')");
      await shot(client, "00-agent-created");
      evidence.steps.push({ name: "fresh_install_agent_created", ok: true, agent_id: "desktop-editor-e2e-agent", model_binding: "unbound" });
      await recordStage(evidence, "fresh_install_agent_created", { agent_id: "desktop-editor-e2e-agent" });
      agentCatalog = await json(base + "/api/agents");
      readyAgentId = (agentCatalog.items || []).find((agent) => agent.agent_id === "desktop-editor-e2e-agent" && agent.status === "active")?.agent_id || null;
      await client.send("Page.navigate", { url: base + "/?nav=templates" });
      await waitFor(client, "!!document.querySelector('[data-action=\"new-template\"]')");
    }
    if (!readyAgentId) throw new Error(editorOnly
      ? "Desktop editor E2E requires at least one published Agent definition."
      : "Desktop E2E requires at least one ready published Agent.");
    const workflowAgentReady = readyAgentIds.has(readyAgentId);
    evidence.ready_agent_id = readyAgentId;
    evidence.workflow_agent_id = readyAgentId;
    evidence.workflow_agent_ready = workflowAgentReady;
    await recordStage(evidence, workflowAgentReady ? "ready_agent_selected" : "workflow_agent_selected", {
      workflow_agent_id: readyAgentId,
      execution_ready: workflowAgentReady,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await click(client, '[data-action="new-template"]');
    await recordStage(evidence, "new_workflow_clicked");
    await waitFor(client, "document.querySelector('[data-field=\"template.name\"]')?.value === 'New Workflow'");
    await setField(client, '[data-field="template.name"]', templateName);
    await setField(client, '[data-field="template.description"]', "Agent, condition, loop, and finish runtime verification.");
    await click(client, '[data-action="switch-view"][data-view="dag"]');
    await waitFor(client, "!!document.querySelector('.authoring-graph-canvas')");
    await click(client, '.authoring-graph-node[data-index="0"]');
    await waitFor(client, "!!document.querySelector('[data-field=\"node.agent_id\"] option[value=" + JSON.stringify(readyAgentId) + "]:not([disabled])')");
    evidence.steps.push({ name: "editor_opened", ok: true });
    await recordStage(evidence, "workflow_editor_opened");

    await openNodeMenu(client);
    await click(client, '[data-action="add-node-type"][data-node-type="condition"]');
    await waitFor(client, "document.querySelectorAll('.authoring-graph-node').length === 3");
    await click(client, '.authoring-graph-node[data-index="2"]');
    await waitFor(client, "!!document.querySelector('[data-field=\"node.condition.path\"]')");
    await setField(client, '[data-field="node.condition.path"]', "payload.status");
    await setField(client, '[data-field="node.condition.operator"]', "equals");
    await setField(client, '[data-field="node.condition.value"]', "ready");
    const draggedCondition = await dragNode(client, 2, 120, 72);
    await shot(client, "01-condition");
    evidence.steps.push({ name: "condition_configured_and_dragged", ok: true, position: draggedCondition });
    await recordStage(evidence, "condition_configured");

    await openNodeMenu(client);
    await click(client, '[data-action="add-node-type"][data-node-type="fanout"]');
    await waitFor(client, "document.querySelectorAll('.authoring-graph-node').length === 4");
    await click(client, '.authoring-graph-node[data-index="3"]');
    await waitFor(client, "!!document.querySelector('[data-field=\"node.loop.items_path\"]')");
    await setField(client, '[data-field="node.loop.items_path"]', "items");
    await setField(client, '[data-field="node.loop.max_iterations"]', "3");
    await setField(client, '[data-field="node.loop.concurrency"]', "1");
    const loopValues = await evaluate(client, "({ path: document.querySelector('[data-field=\"node.loop.items_path\"]')?.value, max: document.querySelector('[data-field=\"node.loop.max_iterations\"]')?.value, concurrency: document.querySelector('[data-field=\"node.loop.concurrency\"]')?.value })");
    if (loopValues.path !== "items" || loopValues.max !== "3" || loopValues.concurrency !== "1") throw new Error("Loop fields were not replaced: " + JSON.stringify(loopValues));
    // Bind every executable step through the UI to a Registry Agent that the
    // current Desktop reports as ready. A named Agent can be active yet still
    // be blocked by its Provider or Skill binding, so do not hard-code one.
    for (const index of [0]) {
      await click(client, `.authoring-graph-node[data-index="${index}"]`);
      await setField(client, '[data-field="node.agent_id"]', readyAgentId);
    }
    await shot(client, "02-loop");
    evidence.steps.push({ name: "loop_configured", ok: true });
    await recordStage(evidence, "loop_configured");

    for (const [edgeIndex, pair] of [[0, [0, 2]], [1, [2, 3]], [2, [3, 1]]]) {
      await connectPort(client, pair[0], pair[1], edgeIndex + 2);
    }
    const graph = await evaluate(client, "({ nodes: document.querySelectorAll('.authoring-graph-node').length, edges: document.querySelectorAll('.authoring-graph-line').length, inspector: document.querySelector('.workflow-step-inspector')?.innerText || '' })");
    await shot(client, "03-connected-dag");
    evidence.steps.push({ name: "graph_connected", ok: graph.nodes === 4 && graph.edges >= 4, graph });
    await recordStage(evidence, "graph_connected");

    const marqueeNodeCount = await marqueeSelectWorkflowNodes(client);
    await shot(client, "03a-marquee-selection");
    evidence.steps.push({ name: "marquee_selection", ok: marqueeNodeCount >= 2, selected_nodes: marqueeNodeCount });
    await recordStage(evidence, "marquee_selection_verified");

    await click(client, '[data-action="validate-workflow"]');
    await waitFor(client, "!!document.querySelector('[data-action=\"publish-draft\"]')");
    const review = await evaluate(client, "document.querySelector('.preview-panel')?.innerText || ''");
    await shot(client, "04-validation");
    evidence.steps.push({ name: "validation", ok: review.includes("No local graph warnings"), review });
    await recordStage(evidence, "workflow_validated");

    await clickUntil(client, '[data-action="save-draft"]', "document.body.innerText.includes('Saved " + templateId + "') || document.body.innerText.includes('Template already exists.') || document.body.innerText.includes('Failed to save template.')");
    let savedTemplate = await json(base + "/api/templates/" + encodeURIComponent(templateId));
    if (savedTemplate.status !== "published") {
      await clickUntil(client, '[data-action="publish-draft"]', "document.body.innerText.includes('Published " + templateId + "')");
      savedTemplate = await json(base + "/api/templates/" + encodeURIComponent(templateId));
    }
    await shot(client, "05-saved");
    evidence.steps.push({ name: "saved", ok: savedTemplate.nodes.length === 4 && savedTemplate.edges.length >= 3 && savedTemplate.status === "published", template_id: savedTemplate.template_id, status: savedTemplate.status, nodes: savedTemplate.nodes.map((node) => ({ id: node.id, type: node.type })), edges: savedTemplate.edges });
    await recordStage(evidence, "workflow_published", { template_id: savedTemplate.template_id });

    if (editorOnly) {
      await waitFor(client, "!!document.querySelector('[data-action=\"edit-workflow\"]')");
      await clickUntil(client, '[data-action="edit-workflow"]', "document.body.innerText.includes('Editing unpublished changes') && !!document.querySelector('[data-action=\"save-draft\"]')");
      const versionDrafts = await json(base + "/api/templates");
      const editDraft = (versionDrafts.items || []).find((item) => item.status === "draft" && item.metadata?.versioning?.family_id === templateId);
      if (!editDraft) throw new Error("Published workflow edit did not create a protected draft.");
      const editSurface = await evaluate(client, `({
        matchingWorkflowRows: [...document.querySelectorAll('.sidebar .template-list .template-item')].filter((item) => item.innerText.includes(${JSON.stringify(templateName)})).length,
        draftLabel: document.querySelector('.sidebar .template-list .template-item small')?.innerText || '',
        saveAvailable: !!document.querySelector('[data-action="save-draft"]:not([disabled])')
      })`);
      await shot(client, "06-protected-edit-draft");
      evidence.steps.push({ name: "published_workflow_edit", ok: editSurface.matchingWorkflowRows === 1 && editSurface.draftLabel.includes("Unpublished changes") && editSurface.saveAvailable, draft_template_id: editDraft.template_id, surface: editSurface });

      await clickUntil(client, '[data-action="save-draft"]', "document.body.innerText.includes('Saved " + editDraft.template_id + "')");
      await clickUntil(client, '[data-action="validate-workflow"]', "!!document.querySelector('[data-action=\"publish-draft\"]')");
      await clickUntil(client, '[data-action="publish-draft"]', "document.body.innerText.includes('Published " + editDraft.template_id + "')");
      const republished = await json(base + "/api/templates/" + encodeURIComponent(editDraft.template_id));
      await clickUntil(
        client,
        '.workflow-more-menu summary',
        `(() => {
          const menu = document.querySelector('.workflow-more-menu');
          const item = menu?.querySelector('[data-action="show-workflow-history"]');
          if (!menu?.open || !item) return false;
          const rect = item.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return rect.width > 0 && rect.height > 0 && !!hit && item.contains(hit);
        })()`,
      );
      await clickUntil(client, '[data-action="show-workflow-history"]', "document.querySelectorAll('.workflow-history-row').length === 2");
      const history = await evaluate(client, `({
        rows: document.querySelectorAll('.workflow-history-row').length,
        text: document.querySelector('.workflow-history-dialog')?.innerText || '',
        matchingWorkflowRows: [...document.querySelectorAll('.sidebar .template-list .template-item')].filter((item) => item.innerText.includes(${JSON.stringify(templateName)})).length
      })`);
      await shot(client, "07-version-history");
      evidence.steps.push({ name: "workflow_republished_without_list_duplication", ok: republished.status === "published" && republished.version === 2 && history.rows === 2 && history.matchingWorkflowRows === 1 && history.text.includes("Current") && history.text.includes("Previous release"), template_id: republished.template_id, version: republished.version, history });
      await click(client, '[data-action="close-workflow-history"]');
      evidence.steps.push({ name: "editor_only_ci_gate", ok: true, provider_required: false });
      evidence.ok = evidence.steps.every((step) => step.ok);
      evidence.completed_at = new Date().toISOString();
      evidence.current_stage = "completed";
      await writeFile(path.join(outputDir, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
      console.log(JSON.stringify(evidence, null, 2));
      if (!evidence.ok) throw new Error("Desktop editor E2E evidence contains a failed step.");
      return;
    }

    const provider = await resolveE2EProvider();
    evidence.steps.push({ name: "provider_ready", ok: true, connection_id: provider.connectionId, model: provider.model });
    const createdSession = await json(controlPlaneBase + "/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: `Desktop DAG E2E ${Date.now()}`,
        created_by: "desktop-e2e",
        provider_connection_id: provider.connectionId,
        model: provider.model,
        initial_message: "Execute the Desktop DAG workflow E2E verification. Use the provided workflow inputs and report the runtime result.",
        defer_conversation_reply: true,
      }),
    });
    const sessionId = createdSession.session_id || createdSession.session?.session_id;
    if (!sessionId) throw new Error("Desktop E2E could not create an isolated Session.");
    evidence.session_id = sessionId;
    const proposalResponse = await json(base + "/api/sessions/" + encodeURIComponent(sessionId) + "/dag-proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: savedTemplate.template_id, inputs: { goal: "Run the desktop DAG E2E workflow", payload: { status: "ready" }, items: ["a", "b"] } }) });
    const proposal = proposalResponse.proposal;
    evidence.steps.push({ name: "proposal_created", ok: Boolean(proposal?.proposal_id), proposal_id: proposal?.proposal_id, status: proposal?.status, warnings: proposal?.warnings || [] });
    await recordStage(evidence, "proposal_created", { session_id: sessionId, proposal_id: proposal?.proposal_id || null });
    if (proposal?.status === "review_ready") {
      const confirmed = await json(base + "/api/sessions/" + encodeURIComponent(sessionId) + "/dag-proposals/" + encodeURIComponent(proposal.proposal_id) + "/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed_by: "desktop-e2e" }) });
      const dagId = confirmed.agent_dag?.dag_id || confirmed.proposal?.compiled_agent_dag_id;
      evidence.steps.push({ name: "proposal_confirmed", ok: Boolean(dagId), dag_id: dagId });
      await recordStage(evidence, "proposal_confirmed", { dag_id: dagId || null });
      if (dagId) {
        const run = await json(base + "/api/sessions/" + encodeURIComponent(sessionId) + "/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposal_id: proposal.proposal_id, validation_mode: "warn" }) });
        let detail = null;
        const runtimeDeadline = Date.now() + 45_000;
        while (Date.now() < runtimeDeadline) {
          detail = await json(base + "/api/agent-dags/" + encodeURIComponent(run.agent_dag_id || dagId));
          const tasks = detail.tasks || [];
          if (tasks.length >= 3 && tasks.every((task) => ["completed", "failed", "cancelled", "skipped"].includes(task.status))) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!detail) throw new Error("AgentDag detail was not returned.");
        const dagRecord = detail.dag || detail.agent_dag || detail;
        const taskById = new Map((detail.tasks || []).map((task) => [task.task_id, task]));
        const runtimeTasks = (dagRecord.nodes || []).map((node) => {
          const task = taskById.get(node.task_id);
          return {
            task_id: node.task_id,
            node_id: node.node_id,
            definition_node_id: node.metadata?.definition_node_id || null,
            status: task?.status || node.status,
            depends_on: task?.depends_on || node.depends_on || [],
          };
        });
        const executedDefinitionNodes = new Map(runtimeTasks.map((task) => [task.definition_node_id, task.status]));
        const runtimeOk = ["node_backend", "node_3", "node_4"].every((nodeId) => executedDefinitionNodes.get(nodeId) === "completed");
        evidence.steps.push({ name: "run_attempted", ok: runtimeOk, run, dag_status: dagRecord.status, tasks: runtimeTasks });
        await recordStage(evidence, "dag_runtime_terminal", { dag_status: dagRecord.status });
      }
    } else {
      evidence.steps.push({ name: "proposal_confirmed", ok: false, blocked_reason: "Proposal did not reach review_ready", readiness: proposal?.capability_plan });
    }
    evidence.ok = evidence.steps.every((step) => step.ok);
    evidence.completed_at = new Date().toISOString();
    evidence.current_stage = "completed";
    await writeFile(path.join(outputDir, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
    console.log(JSON.stringify(evidence, null, 2));
    if (!evidence.ok) throw new Error("Desktop E2E evidence contains a failed step.");
  } catch (error) {
    evidence.ok = false;
    evidence.error = error.message || String(error);
    evidence.completed_at = new Date().toISOString();
    evidence.current_stage = "failed";
    await shot(client, scenario === "production-incident" ? "99-incident-failure" : "99-failure").catch(() => null);
    await writeFile(path.join(outputDir, scenario === "production-incident" ? "incident-evidence.json" : "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
    throw error;
  } finally {
    client.close();
  }
}

await main();
