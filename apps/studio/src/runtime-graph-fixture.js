import { getRuntimeGraphFixture } from "./runtime-graph-fixtures.js";
import { buildRuntimeGraphModel } from "./runtime-graph-model.js";
import { renderRuntimeGraphView } from "./runtime-graph-view.js";

const params = new URLSearchParams(window.location.search);
const fixture = getRuntimeGraphFixture(params.get("fixture") || "linear");
const ui = {
  zoom: Number(params.get("zoom") || 1),
  activeTab: params.get("tab") || "timeline",
  drawerOpen: params.get("drawer") !== "0",
  listFallback: params.get("list") === "1",
  overlayOpen: false,
};
let selectedNodeRunId = fixture.graph.nodes[0]?.nodeRunId || "";

function render() {
  const model = buildRuntimeGraphModel({
    ...fixture,
    selectedNodeRunId,
    nowMs: Date.parse("2026-07-10T08:10:00.000Z"),
  });
  document.getElementById("runtime-fixture-root").innerHTML = renderRuntimeGraphView(model, ui);
  window.__runtimeGraphFixture = { fixture: fixture.name, model, ui };
}

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  if (["select-runtime-node", "select-runtime-edge", "select-runtime-trace", "select-runtime-evidence"].includes(action)) {
    selectedNodeRunId = actionTarget.dataset.nodeRunId || selectedNodeRunId;
    ui.drawerOpen = true;
  } else if (action === "close-runtime-node") {
    ui.drawerOpen = false;
  } else if (action === "runtime-zoom-in") {
    ui.zoom = Math.min(1.35, ui.zoom + 0.1);
  } else if (action === "runtime-zoom-out") {
    ui.zoom = Math.max(0.5, ui.zoom - 0.1);
  } else if (action === "toggle-runtime-list") {
    ui.listFallback = !ui.listFallback;
  } else if (action === "select-runtime-tab") {
    ui.activeTab = actionTarget.dataset.runtimeTab || "timeline";
  } else {
    return;
  }
  render();
});

render();
