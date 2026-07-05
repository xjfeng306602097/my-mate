import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = [
  "server.mjs",
  "src/app.js",
  "scripts/visual-check.mjs",
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
  ["mission workspace default route", appSource, 'activeNav: "missions"'],
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
  ["mission workspace contract version model", appSource, "workspaceContractVersion"],
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
  ["orchestrator command", appSource, "nav:orchestrator"],
  ["durable proposal state", appSource, "activeProposal"],
  ["durable proposal API", appSource, "/dag-proposals"],
  ["durable proposal create action", appSource, 'data-action="create-dag-proposal"'],
  ["proposal run launch", appSource, "launchConfirmedProposalRun"],
  ["patch graph review panel", appSource, "function renderPatchGraphReviewPanel"],
  ["patch graph review focus", appSource, 'data-workspace-focus="patch-graph"'],
  ["command palette styles", styleSource, ".command-palette"],
  ["patch graph review styles", styleSource, ".patch-graph-review-panel"],
  ["attachment styles", styleSource, ".attachment-context-panel"],
  ["orchestrator styles", styleSource, ".orchestrator-workbench"],
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

console.log("Studio syntax and interaction smoke checks passed.");
