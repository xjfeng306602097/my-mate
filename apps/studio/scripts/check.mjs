import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = [
  "server.mjs",
  "src/app.js",
  "src/dag-layout.js",
  "src/runtime-graph-model.js",
  "src/runtime-graph-view.js",
  "src/runtime-evaluation-view.js",
  "src/runtime-node-drawer.js",
  "src/runtime-graph-fixtures.js",
  "src/runtime-graph-fixture.js",
  "scripts/visual-check.mjs",
  "scripts/runtime-graph-visual-check.mjs",
  "scripts/openclaw-visual-acceptance.mjs",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const appSource = readFileSync("src/app.js", "utf8");
const styleSource = readFileSync("src/styles.css", "utf8");
const layoutSource = readFileSync("src/dag-layout.js", "utf8");
const runtimeModelSource = readFileSync("src/runtime-graph-model.js", "utf8");
const runtimeViewSource = readFileSync("src/runtime-graph-view.js", "utf8");
const smokeMarkers = [
  ["command palette state", appSource, "commandPaletteOpen"],
  ["command palette renderer", appSource, "function renderCommandPalette"],
  ["command palette entry action", appSource, 'data-action="open-command-palette"'],
  ["command palette execution", appSource, "executeCommandPaletteItem"],
  ["keyboard shortcut handler", appSource, 'document.addEventListener("keydown"'],
  ["session keyboard navigation", appSource, "navigateSessionInventory"],
  ["compare focus target", appSource, 'data-workspace-focus="compare"'],
  ["graph focus target", appSource, 'data-workspace-focus="graph"'],
  ["attachment action", appSource, 'data-action="attach-context-file"'],
  ["attachment API call", appSource, "/attachments"],
  ["attachment drop zone", appSource, 'data-attachment-drop-zone="true"'],
  ["attachment file picker action", appSource, 'data-action="pick-context-file"'],
  ["attachment file picker handler", appSource, "createWorkspaceAttachmentsFromFiles"],
  ["workspace context browser", appSource, "function renderWorkspaceContextBrowser"],
  ["workspace context browser action", appSource, 'data-action="attach-workspace-context-reference"'],
  ["runtime evidence timestamp formatter", appSource, "formatWorkspaceTimestamp(item.created_at)"],
  ["mission workspace default route", appSource, 'activeNav: "missions"'],
  ["dashboard nav item", appSource, '{ id: "dashboard", label: "Dashboard" }'],
  ["dashboard renderer", appSource, "function renderDashboardWorkspace"],
  ["dashboard API call", appSource, 'request(`/api/dashboard/summary?${params.toString()}`)'],
  ["dashboard refresh action", appSource, 'data-action="refresh-dashboard"'],
  ["dashboard focus target", appSource, 'data-workspace-focus="dashboard-hotspots"'],
  ["dashboard hotspot action", appSource, 'data-action="open-dashboard-hotspot"'],
  ["dashboard hotspot opener", appSource, "async function openDashboardHotspotSession"],
  ["dashboard observability metrics", appSource, "function renderDashboardObservability"],
  ["dashboard activity chart", appSource, "function renderDashboardActivity"],
  ["dashboard trace evaluation correlation", appSource, "Trace / Event / Evaluation Correlation"],
  ["dashboard indexed query filters", appSource, "function renderDashboardFilters"],
  ["dashboard time filter", appSource, 'data-field="dashboard.windowHours"'],
  ["dashboard status filter", appSource, 'data-field="dashboard.status"'],
  ["dashboard dynamic activity title", appSource, "function formatDashboardActivityTitle"],
  ["dashboard previous period toggle", appSource, 'data-field="dashboard.comparePrevious"'],
  ["trusted identity API", appSource, 'request("/api/auth/me")'],
  ["workspace selection action", appSource, 'data-action="select-security-workspace"'],
  ["workspace member role action", appSource, 'data-action="set-security-member-role"'],
  ["security audit API", appSource, 'request("/api/audit-events?limit=50")'],
  ["security audit chain state", appSource, "auditChainVerified"],
  ["workspace security refresh reload", appSource, "async function refreshStudioSecurityAndWorkspace"],
  ["workspace security scoped reset", appSource, "function resetWorkspaceScopedState"],
  ["dashboard comparison renderer", appSource, "function renderDashboardComparison"],
  ["dashboard retention metadata", appSource, "observability?.retention"],
  ["runtime worker capacity formatter", appSource, "function formatRuntimeCapacityValue"],
  ["runtime worker queue timeout formatter", appSource, "function formatRuntimeQueueTimeout"],
  ["runtime worker capacity projection", appSource, "runtime?.node_provisioner?.capacity"],
  ["workspace selected run helper", appSource, "function getWorkspaceSelectedRunId"],
  ["session run selector query", appSource, "?run_id=${encodeURIComponent(selectedRunId)}"],
  ["workspace run url param", appSource, 'params.set("run", getWorkspaceSelectedRunId(state.workspaceDetail))'],
  ["workspace run location restore", appSource, "function getLocationRunId"],
  ["studio location hydration call", appSource, "hydrateStudioLocationState();"],
  ["studio location session restore call", appSource, "restoreWorkspaceSessionFromLocation();"],
  ["workspace url state guard", appSource, "function shouldPersistWorkspaceLocationState"],
  ["workspace location session restore", appSource, "function restoreWorkspaceSessionFromLocation"],
  ["workspace drilldown reset", appSource, "function resetWorkspaceDrilldownState"],
  ["workspace session change preparation", appSource, "function prepareWorkspaceSessionChange"],
  ["workspace restored focus resolver", appSource, "function getWorkspaceFocusForLocationState"],
  ["workspace restored focus queue", appSource, "function queueRestoredWorkspaceFocusFromLocation"],
  ["workspace selection url type", appSource, 'params.set("ws", selection.type)'],
  ["workspace selection url key", appSource, 'params.set("wsk", selection.key)'],
  ["workspace feed filter url", appSource, 'params.set("wf", feedFilter)'],
  ["workspace feed expanded url", appSource, 'params.set("wfe", "1")'],
  ["mission workspace contract version helper", appSource, "function hasVersionedMissionWorkspaceSnapshot"],
  ["mission workspace contract spec guard", appSource, "if (hasVersionedMissionWorkspaceSnapshot(snapshot))"],
  ["mission workspace contract version model", appSource, "workspaceContractVersion"],
  ["mission workspace contract sections", appSource, "const workspaceSections = Array.isArray(snapshot?.workspaceSections) ? snapshot.workspaceSections : []"],
  ["mission workspace objective section rank", appSource, "objective: 0"],
  ["mission workspace route section rank", appSource, "route: 1"],
  ["mission workspace work packages section rank", appSource, "work_packages: 2"],
  ["mission workspace pending decisions section rank", appSource, "pending_decisions: 5"],
  ["mission workspace execution summary section rank", appSource, "execution_summary: 6"],
  ["mission workspace evidence summary section rank", appSource, "evidence_summary: 7"],
  ["mission work package output keys", appSource, "pipeline.outputKeys"],
  ["mission work package next action", appSource, "pipeline.nextActionLabel"],
  ["mission checkpoint type", appSource, "checkpoint.type"],
  ["mission checkpoint related outputs", appSource, "checkpoint.relatedOutputKeys"],
  ["mission output current action", appSource, "output.currentActionLabel"],
  ["mission output latest artifact", appSource, "output.latestArtifactMessageId"],
  ["mission output history", appSource, "output.history"],
  ["mission conversation rail contract", appSource, "snapshot?.conversationRail"],
  ["mission evidence summary contract", appSource, "snapshot?.evidenceSummary"],
  ["mission raw card policy contract", appSource, "snapshot?.rawCardPolicy"],
  ["mission raw cards collapsed", appSource, "feed.rawCardPolicy.defaultState"],
  ["mission workspace view model", appSource, "function buildMissionWorkspaceViewModel"],
  ["mission evidence bundle", appSource, "function buildMissionEvidenceBundle"],
  ["mission surface evidence", appSource, "function buildMissionSurfaceEvidence"],
  ["mission artifact run evidence", appSource, "function buildMissionArtifactRunEvidence"],
  ["mission artifact entry", appSource, "function buildMissionArtifactEntry"],
  ["mission artifact feed key", appSource, "function getArtifactWorkspaceFeedKey"],
  ["mission feed pinned target", appSource, "function limitWorkspaceFeedItems"],
  ["mission output history artifact resolver", appSource, "function findWorkspaceOutputHistoryKeyByArtifactKey"],
  ["mission rail empty callout", appSource, "function renderRailEmptyCallout"],
  ["mission inspector selection hint", appSource, "function renderMissionInspectorSelectionHint"],
  ["mission artifact level diff", appSource, "artifactMimeType"],
  ["mission workspace surfaces", appSource, "function renderMissionWorkspaceSectionGrid"],
  ["mission delivery trace", appSource, "function renderMissionDeliveryTracePanel"],
  ["mission output history", appSource, "function renderMissionOutputHistoryPanel"],
  ["mission rail view model", appSource, "function buildDesktopRailViewModel"],
  ["mission feed rail model", appSource, "function buildWorkspaceFeedRailModel"],
  ["mission selected checkpoint rail model", appSource, "function buildSelectedCheckpointRailModel"],
  ["mission selected checkpoint targets", appSource, "function buildSelectedCheckpointTargets"],
  ["mission selected output rail model", appSource, "function buildSelectedOutputRailModel"],
  ["mission checkpoint drilldown action", appSource, 'data-action="select-checkpoint"'],
  ["mission checkpoint target jump", appSource, 'data-action="jump-checkpoint-target"'],
  ["mission output artifact jump", appSource, 'data-action="jump-output-artifact"'],
  ["mission output history jump target", appSource, "data-output-history-key"],
  ["mission workspace support strip", appSource, "function renderMissionWorkspaceSupport"],
  ["mission support proposal trace", appSource, "renderProposalTracePanel(detail)"],
  ["mission execution queue focus", appSource, 'data-workspace-focus="execution-queue"'],
  ["mission workspace feed focus", appSource, 'data-workspace-focus="workspace-feed"'],
  ["workspace feed filter action", appSource, 'data-action="set-workspace-feed-filter"'],
  ["orchestrator renderer", appSource, "function renderOrchestratorWorkbench"],
  ["orchestrator send action", appSource, 'data-action="orchestrator-send-message"'],
  ["orchestrator composer clears after send", appSource, 'state.planner.intent = ""'],
  ["completed runs are not labelled live", appSource, '`${formatWorkspaceLabel(runStatus)} run`'],
  ["conversation excludes structural cards", appSource, 'message.role === "user" || message.role === "orchestrator"'],
  ["runtime label follows dispatcher", appSource, "function getRuntimeExecutionLabel"],
  ["runtime overlay has component positioning", appSource, "const overlayStyle = state.ui.runtimeOverlayOpen"],
  ["orchestrator command", appSource, "nav:orchestrator"],
  ["durable proposal state", appSource, "activeProposal"],
  ["durable proposal API", appSource, "/dag-proposals"],
  ["durable proposal create action", appSource, 'data-action="create-dag-proposal"'],
  ["proposal run launch", appSource, "launchConfirmedProposalRun"],
  ["patch graph review panel", appSource, "function renderPatchGraphReviewPanel"],
  ["patch graph review focus", appSource, 'data-workspace-focus="patch-graph"'],
  ["authoring graph model", appSource, "function buildAuthoringGraphModel"],
  ["authoring graph canvas", appSource, "function renderAuthoringGraphCanvas"],
  ["authoring graph node selection", appSource, 'data-action="select-authoring-node"'],
  ["authoring graph edge selection", appSource, 'data-action="select-authoring-edge"'],
  ["route compare diff browser", appSource, "function buildRouteCompareDiffBrowser"],
  ["route compare refresh action", appSource, 'data-action="refresh-route-compare"'],
  ["route compare history picker", appSource, 'data-action="pick-route-compare-history"'],
  ["planner recommendation coverage evidence", appSource, "coverage_domains"],
  ["planner recommendation coverage copy", appSource, "Coverage fill:"],
  ["command palette styles", styleSource, ".command-palette"],
  ["patch graph review styles", styleSource, ".patch-graph-review-panel"],
  ["authoring graph canvas styles", styleSource, ".authoring-graph-canvas"],
  ["authoring graph selection styles", styleSource, ".authoring-form-selected"],
  ["route compare browser styles", styleSource, ".route-compare-browser-grid"],
  ["route compare graph styles", styleSource, ".route-compare-graph-canvas"],
  ["attachment styles", styleSource, ".attachment-context-panel"],
  ["attachment drop styles", styleSource, ".attachment-drop-zone"],
  ["workspace context browser styles", styleSource, ".attachment-browser"],
  ["orchestrator styles", styleSource, ".orchestrator-workbench"],
  ["runtime overlay styles", styleSource, ".runtime-inspector-overlay {"],
  ["shared DAG layout", layoutSource, "export function buildDagLayout"],
  ["shared DAG barycenter", layoutSource, "sortColumnByBarycenter"],
  ["runtime graph model", runtimeModelSource, "export function buildRuntimeGraphModel"],
  ["runtime graph neighbor navigation", runtimeModelSource, "export function findRuntimeNeighbor"],
  ["runtime graph primary view", runtimeViewSource, "export function renderRuntimeGraphView"],
  ["runtime graph node drawer", runtimeViewSource, "renderRuntimeNodeDrawer"],
  ["runtime trace API", appSource, "/trace?limit=500"],
  ["runtime supervision cursor", appSource, "/supervise?${query}"],
  ["runtime node URL state", appSource, 'params.set("node", state.ui.runtimeNodeRunId)'],
  ["runtime graph V2 styles", styleSource, ".runtime-graph-v2"],
  ["runtime graph drawer styles", styleSource, ".runtime-node-drawer"],
  ["runtime graph mobile fallback", styleSource, ".runtime-graph-list-fallback"],
  ["dashboard panel styles", styleSource, ".dashboard-panel"],
  ["dashboard summary line styles", styleSource, ".dashboard-summary-lines"],
  ["dashboard filter styles", styleSource, ".dashboard-toolbar"],
  ["dashboard comparison styles", styleSource, ".dashboard-comparison-strip"],
  ["workspace security styles", styleSource, ".security-member-row"],
  ["mission workspace support styles", styleSource, ".mission-support-panel"],
  ["mission delivery trace styles", styleSource, ".mission-delivery-trace-panel"],
  ["mission output history styles", styleSource, ".mission-output-history-panel"],
  ["mission rail empty callout styles", styleSource, ".rail-empty-callout"],
  ["workspace feed filter styles", styleSource, ".rail-feed-filter"],
  ["workspace focus styles", styleSource, ".workspace-focus-highlight"],
];

for (const [label, source, marker] of smokeMarkers) {
  if (!source.includes(marker)) {
    console.error(`Studio smoke check failed: missing ${label} marker (${marker}).`);
    process.exit(1);
  }
}

const workspaceRendererStart = appSource.indexOf("function renderMissionWorkspace()");
const surfacesRenderIndex = appSource.indexOf("${renderMissionWorkspaceSectionGrid(model.workspaceSections)}", workspaceRendererStart);
const contextStripIndex = appSource.indexOf('<div class="mission-context-strip">', workspaceRendererStart);

if (workspaceRendererStart < 0 || surfacesRenderIndex < 0 || contextStripIndex < 0) {
  console.error("Studio smoke check failed: missing mission workspace first-screen structure.");
  process.exit(1);
}

if (surfacesRenderIndex > contextStripIndex) {
  console.error("Studio smoke check failed: workspace surfaces must render before the context strip.");
  process.exit(1);
}

const runtimeLayoutCheck = spawnSync(process.execPath, ["scripts/runtime-graph-visual-check.mjs", "--layout-only"], {
  stdio: "inherit",
});
if (runtimeLayoutCheck.status !== 0) {
  process.exit(runtimeLayoutCheck.status || 1);
}

console.log("Studio syntax and interaction smoke checks passed.");
