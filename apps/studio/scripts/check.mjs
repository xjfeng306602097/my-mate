import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = [
  "server.mjs",
  "src/app.js",
  "src/dag-layout.js",
  "src/graph-editor-model.js",
  "src/runtime-graph-model.js",
  "src/lifecycle-status-model.js",
  "src/runtime-graph-view.js",
  "src/setup-connection-model.js",
  "src/runtime-evaluation-view.js",
  "src/runtime-node-drawer.js",
  "src/task-guidance-model.js",
  "src/task-intelligence-model.js",
  "src/workspace-change-diff-model.js",
  "src/workboard-files-model.js",
  "src/agent-model-binding-model.js",
  "src/agent-conversation-presenter.js",
  "src/agent-run-status-model.js",
  "src/agent-dag-polling-model.js",
  "src/authoring-graph-interaction-model.js",
  "src/proposal-presentation-model.js",
  "src/workflow-version-model.js",
  "src/workspace-task-tree-model.js",
  "src/runtime-graph-fixtures.js",
  "src/runtime-graph-fixture.js",
  "scripts/visual-check.mjs",
  "scripts/conversation-ui-regression.mjs",
  "scripts/desktop-workflow-e2e.mjs",
  "scripts/authoring-graph-visual-check.mjs",
  "scripts/runtime-graph-visual-check.mjs",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const graphEditorTests = spawnSync(process.execPath, ["--test", "test/graph-editor-model.test.mjs"], {
  stdio: "inherit",
});
if (graphEditorTests.status !== 0) process.exit(graphEditorTests.status || 1);

const lifecycleStatusTests = spawnSync(process.execPath, ["--test", "test/lifecycle-status-model.test.mjs"], {
  stdio: "inherit",
});
if (lifecycleStatusTests.status !== 0) process.exit(lifecycleStatusTests.status || 1);

const taskGuidanceTests = spawnSync(process.execPath, ["--test", "test/task-guidance-model.test.mjs"], {
  stdio: "inherit",
});
if (taskGuidanceTests.status !== 0) process.exit(taskGuidanceTests.status || 1);

const taskIntelligenceTests = spawnSync(process.execPath, ["--test", "test/task-intelligence-model.test.mjs"], {
  stdio: "inherit",
});
if (taskIntelligenceTests.status !== 0) process.exit(taskIntelligenceTests.status || 1);

const setupConnectionTests = spawnSync(process.execPath, ["--test", "test/setup-connection-model.test.mjs"], {
  stdio: "inherit",
});
if (setupConnectionTests.status !== 0) process.exit(setupConnectionTests.status || 1);

const workspaceChangeDiffTests = spawnSync(process.execPath, ["--test", "test/workspace-change-diff-model.test.mjs"], {
  stdio: "inherit",
});
if (workspaceChangeDiffTests.status !== 0) process.exit(workspaceChangeDiffTests.status || 1);

const workspaceTaskTreeTests = spawnSync(process.execPath, ["--test", "test/workspace-task-tree-model.test.mjs"], {
  stdio: "inherit",
});
if (workspaceTaskTreeTests.status !== 0) process.exit(workspaceTaskTreeTests.status || 1);

const workboardFilesTests = spawnSync(process.execPath, ["--test", "test/workboard-files-model.test.mjs"], {
  stdio: "inherit",
});
if (workboardFilesTests.status !== 0) process.exit(workboardFilesTests.status || 1);

const agentModelBindingTests = spawnSync(process.execPath, ["--test", "test/agent-model-binding-model.test.mjs"], {
  stdio: "inherit",
});
if (agentModelBindingTests.status !== 0) process.exit(agentModelBindingTests.status || 1);

const agentConversationPresenterTests = spawnSync(process.execPath, ["--test", "test/agent-conversation-presenter.test.mjs"], {
  stdio: "inherit",
});
if (agentConversationPresenterTests.status !== 0) process.exit(agentConversationPresenterTests.status || 1);

const agentRunStatusModelTests = spawnSync(process.execPath, ["--test", "test/agent-run-status-model.test.mjs"], {
  stdio: "inherit",
});
if (agentRunStatusModelTests.status !== 0) process.exit(agentRunStatusModelTests.status || 1);

const agentDagPollingModelTests = spawnSync(process.execPath, ["--test", "test/agent-dag-polling-model.test.mjs"], {
  stdio: "inherit",
});
if (agentDagPollingModelTests.status !== 0) process.exit(agentDagPollingModelTests.status || 1);

const authoringGraphInteractionModelTests = spawnSync(process.execPath, ["--test", "test/authoring-graph-interaction-model.test.mjs"], {
  stdio: "inherit",
});
if (authoringGraphInteractionModelTests.status !== 0) process.exit(authoringGraphInteractionModelTests.status || 1);

const proposalPresentationModelTests = spawnSync(process.execPath, ["--test", "test/proposal-presentation-model.test.mjs"], {
  stdio: "inherit",
});
if (proposalPresentationModelTests.status !== 0) process.exit(proposalPresentationModelTests.status || 1);

const workflowVersionModelTests = spawnSync(process.execPath, ["--test", "test/workflow-version-model.test.mjs"], {
  stdio: "inherit",
});
if (workflowVersionModelTests.status !== 0) process.exit(workflowVersionModelTests.status || 1);

const appSource = readFileSync("src/app.js", "utf8");
const styleSource = readFileSync("src/styles.css", "utf8");
const layoutSource = readFileSync("src/dag-layout.js", "utf8");
const runtimeModelSource = readFileSync("src/runtime-graph-model.js", "utf8");
const runtimeViewSource = readFileSync("src/runtime-graph-view.js", "utf8");
const agentConversationPresenterSource = readFileSync("src/agent-conversation-presenter.js", "utf8");
const studioServerSource = readFileSync("server.mjs", "utf8");
const desktopWorkflowE2eSource = readFileSync("scripts/desktop-workflow-e2e.mjs", "utf8");
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
  ["desktop workspace bridge", appSource, "globalThis.myMateDesktop"],
  ["workspace-first sidebar tree", appSource, "function renderDesktopWorkspaceTree"],
  ["workspace task grouping model", appSource, "groupWorkspaceTasks"],
  ["workspace task startup session hydration", appSource, "loadSessions(false)"],
  ["workspace creator modal", appSource, "function renderWorkspaceCreator"],
  ["workspace modal global overlay", appSource, "${renderWorkspaceCreator()}"],
  ["workspace task drag source", appSource, "data-workspace-task-drag-session-id"],
  ["workspace task drop target", appSource, "data-workspace-drop-project-id"],
  ["workspace task durable reassignment", appSource, "async function moveTaskToDesktopProject"],
  ["workspace task local tree refresh", appSource, "function renderDesktopWorkspaceTreeSurface"],
  ["workspace task move performance metric", appSource, "fullRenderDelta"],
  ["Tasks, Build, Operate, and System navigation tabs", appSource, 'data-action="switch-navigation-tab"'],
  ["Task navigation default", appSource, 'navigationTab: "task"'],
  ["Build navigation group", appSource, 'data-tab="build"'],
  ["Operate navigation group", appSource, 'data-tab="operate"'],
  ["System navigation group", appSource, 'data-tab="system"'],
  ["navigation tab ownership", appSource, 'aria-controls="nav-panel-task"'],
  ["Mission Workspace entry", appSource, 'label: "Mission Workspace"'],
  ["conversation-first task CTA", appSource, "Start conversation"],
  ["Control Plane status recovery", appSource, "function controlPlaneBanner"],
  ["Workflow editor default view", appSource, 'if (nav === "templates") state.activeView = "template"'],
  ["Workflow editor loads templates on entry", appSource, 'if (nav === "templates" && !state.loading && !state.templates.length)'],
  ["workflow generator separate mode", appSource, "function renderWorkflowGenerator"],
  ["published workflow protected edit", appSource, 'data-action="edit-workflow"'],
  ["workflow versions hidden behind history", appSource, "function renderWorkflowVersionHistoryModal"],
  ["workflow family list de-duplication", appSource, "groupWorkflowFamilies(state.templates)"],
  ["workflow generator native click retry", desktopWorkflowE2eSource, "await clickUntil("],
  ["delegation drawer cleared across task navigation", appSource, "delegationDrawerWasOpen"],
  ["Agent activity event stream", appSource, "function openAgentEventStream"],
  ["Agent event stream protocol", appSource, 'source.addEventListener("agent.event"'],
  ["Agent activity timeline", appSource, "data-agent-activity-timeline"],
  ["Agent activity, conversation, and outputs tabs", appSource, '["activity", "Activity"], ["conversation", "Conversation"], ["outputs", "Outputs"]'],
  ["Agent event stream cleanup", appSource, "closeAgentEventStream();"],
  ["Agent running status projection", appSource, "agentDelegationStatusFromEvent"],
  ["Agent running breathing indicator", styleSource, "agent-running-breathe"],
  ["Studio Agent event SSE proxy", studioServerSource, "agent-runs"],
  ["Studio SSE resume cursor forwarding", studioServerSource, 'req.headers["last-event-id"]'],
  ["workflow authoring steps", appSource, "Workflow authoring steps"],
  ["workflow step inspector", appSource, "function renderWorkflowSelectionInspector"],
  ["workflow authoring no mission rail", appSource, "workflow-authoring-layout"],
  ["workspace-scoped new task", appSource, "beginNewTaskInProject"],
  ["new task automatic workspace binding", appSource, 'await ensureDesktopWorkspaceBinding(sessionId, "snapshot-read")'],
  ["desktop workspace picker", appSource, 'data-action="choose-desktop-workspace"'],
  ["desktop workspace browser fallback", appSource, 'class="task-desktop-required"'],
  ["desktop workspace file context", appSource, "desktop_text_content"],
  ["runtime evidence timestamp formatter", appSource, "formatWorkspaceTimestamp(item.created_at)"],
  ["task workspace default route", appSource, 'activeNav: "orchestrator"'],
  ["dashboard advanced nav item", appSource, '{ id: "dashboard", label: "Runtime dashboard" }'],
  ["memory advanced nav item", appSource, '{ id: "memory", label: "Memory" }'],
  ["memory status loader", appSource, "async function loadMemoryStatus"],
  ["memory retrieval search", appSource, 'request("/api/memory-retrieval/search"'],
  ["memory workspace renderer", appSource, "function renderMemoryWorkspace"],
  ["conversation memory activation evidence", appSource, "conversation-memory-context"],
  ["memory empty activation guidance", appSource, "Memory is not influencing replies yet"],
  ["human-side primary navigation", appSource, '{ id: "inbox", label: "Inbox"'],
  ["task one-action entry", appSource, 'data-action="orchestrator-send-message"'],
  ["adaptive task guidance", appSource, "function renderTaskGuidance"],
  ["task recommended advance", appSource, 'data-action="${escapeHtml(guidance.primaryAction)}"'],
  ["task proactive decision action", appSource, 'action === "open-task-inbox"'],
  ["task results first surface", appSource, "function renderTaskResults"],
  ["compact task result row", appSource, 'class="task-result-file"'],
  ["task result preview action", appSource, 'data-action="open-artifact-preview"'],
  ["session artifact download", appSource, 'class="task-result-download'],
  ["artifact syntax highlighting", appSource, "hljs.highlight"],
  ["artifact Mermaid rendering", appSource, "hydrateArtifactMermaidDiagrams"],
  ["artifact Mermaid source fallback", appSource, 'action: "toggle-artifact-mermaid-source"'],
  ["human autonomy settings", appSource, "function saveProductAutonomyMode"],
  ["autonomy controls update in place", appSource, "function syncAutonomyControlState"],
  ["autonomy selected mode no-op", appSource, "persistedMode === nextMode"],
  ["autopilot guarded advance", appSource, "function maybeAutoAdvanceTask"],
  ["task repair guidance", appSource, "deriveRepairGuidance"],
  ["result quality guidance", appSource, "function renderTaskQuality"],
  ["result quality action", appSource, 'action === "check-task-quality"'],
  ["AI-01 durable autopilot API", appSource, "/autopilot/resume"],
  ["AI-01 operator controls", appSource, "function controlTaskAutopilot"],
  ["GENUI-01 component registry", appSource, "function renderGeneratedMissionWorkspace"],
  ["GENUI-01 server plan", appSource, "experience.uiPlan?.blocks"],
  ["SUP-01 alert inbox", appSource, "resolveSupervisionAlert"],
  ["SUP-01 generated repair", appSource, "function renderGeneratedRepair"],
  ["attention inbox loader", appSource, "async function loadInbox"],
  ["workspace change set loader", appSource, "/api/runtime/workspace-change-sets"],
  ["workspace visual diff renderer", appSource, "function renderWorkspaceDiff"],
  ["workboard inline Diff preview", appSource, "function renderWorkspaceDiffPreviewModal"],
  ["workboard inline Diff action", appSource, 'data-action="open-workspace-diff-preview"'],
  ["conversation turn change receipt", appSource, "function renderConversationChangeReceipt"],
  ["conversation action receipt", appSource, "function renderConversationActionReceipt"],
  ["conversation action details", appSource, "conversation-action-details"],
  ["conversation action expansion persistence", appSource, "conversationActionExpanded"],
  ["conversation action detail expansion persistence", appSource, "conversationActionDetailsExpanded"],
  ["conversation change review file selector", appSource, 'data-action="select-workspace-diff-preview-file"'],
  ["workspace change review surface", appSource, "function renderWorkspaceChangeReview"],
  ["workspace change apply action", appSource, "async function resolveWorkspaceChangeSet"],
  ["workboard file search", appSource, 'data-field="workboard.query"'],
  ["workboard bounded pagination", appSource, "buildWorkboardPage(resultItems"],
  ["workspace external application action", appSource, "openDesktopWorkspaceExternal"],
  ["product settings renderer", appSource, "function renderProductSettingsPanel"],
  ["dashboard renderer", appSource, "function renderDashboardWorkspace"],
  ["dashboard API call", appSource, 'request(`/api/dashboard/summary?${params.toString()}`)'],
  ["dashboard refresh action", appSource, 'data-action="refresh-dashboard"'],
  ["dashboard focus target", appSource, 'data-workspace-focus="dashboard-hotspots"'],
  ["dashboard hotspot action", appSource, 'data-action="open-dashboard-hotspot"'],
  ["dashboard hotspot opener", appSource, "async function openDashboardHotspotSession"],
  ["dashboard observability metrics", appSource, "function renderDashboardObservability"],
  ["dashboard activity chart", appSource, "function renderDashboardActivity"],
  ["dashboard trace evaluation correlation", appSource, "Trace / Event / Evaluation Correlation"],
  ["dashboard cost attribution renderer", appSource, "function renderDashboardCostReport"],
  ["dashboard cost grouping action", appSource, 'data-action="set-dashboard-cost-group"'],
  ["dashboard cost report contract", appSource, "cost_report"],
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
  ["registry governance loader", appSource, "async function loadGovernance"],
  ["provider connection loader", appSource, 'request("/api/registry/provider-connections")'],
  ["provider connection renderer", appSource, "function renderProviderConnectionManager"],
  ["provider connection modal", appSource, "function renderProviderConnectionModal"],
  ["first-run setup modal", appSource, "function renderStudioSetupModal"],
  ["setup environment runner", appSource, "async function runSetupEnvironmentChecks"],
  ["setup default agent creation", appSource, 'agent_id: "default-agent"'],
  ["setup save and verify copy", appSource, "Save & verify"],
  ["setup existing connection selector", appSource, 'data-field="setup.connectionId"'],
  ["setup registry hydration", appSource, "syncSetupConnectionFromRegistry"],
  ["setup entry action", appSource, 'data-action="open-studio-setup"'],
  ["provider multi-model editor", appSource, 'data-action="add-provider-model"'],
  ["provider API key input", appSource, 'data-field="connection.apiKey"'],
  ["provider connection save action", appSource, 'data-action="save-provider-connection"'],
  ["provider connection test action", appSource, 'data-action="test-provider-connection"'],
  ["provider connection test API", appSource, "/test`"],
  ["Agent V2 provider connection binding", appSource, 'data-field="agentDefinition.connectionId"'],
  ["registry section tabs", appSource, 'data-action="select-registry-section"'],
  ["registry section state", appSource, 'registrySection: "connections"'],
  ["registry governance renderer", appSource, "function renderGovernancePanel"],
  ["registry governance proposal", appSource, "async function submitGovernanceProposal"],
  ["registry governance approval", appSource, 'data-action="approve-governance-change"'],
  ["registry governance apply", appSource, 'data-action="apply-governance-change"'],
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
  ["task switch request cancellation", appSource, "workspaceLoadController.abort()"],
  ["task workspace short-lived cache", appSource, "SESSION_WORKSPACE_CACHE_TTL_MS"],
  ["task workspace scoped renderer", appSource, "function renderTaskWorkspaceSurface"],
  ["mission inventory task detail refresh", appSource, "if (isWorkspaceSurfaceNav()) {\n    render();\n    return;\n  }"],
  ["task workspace progressive hydration", appSource, "function hydrateSessionWorkspaceSecondary"],
  ["task switch render metrics", appSource, "data-my-mate-performance"],
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
  ["Sub Agent parent navigation rail", appSource, 'task-conversation-rail ${parentTaskId ? "has-parent-task" : ""}'],
  ["Sub Agent parent navigation layout", styleSource, ".task-conversation-rail.has-parent-task"],
  ["Sub Agent readable conversation", appSource, "function renderSubAgentTaskConversation"],
  ["Sub Agent protocol prompt filter", agentConversationPresenterSource, "isAgentProtocolPrompt"],
  ["Sub Agent structured result presenter", agentConversationPresenterSource, "parseAgentStructuredResult"],
  ["mission execution queue focus", appSource, 'data-workspace-focus="execution-queue"'],
  ["mission workspace feed focus", appSource, 'data-workspace-focus="workspace-feed"'],
  ["workspace feed filter action", appSource, 'data-action="set-workspace-feed-filter"'],
  ["orchestrator renderer", appSource, "function renderOrchestratorWorkbench"],
  ["orchestrator send action", appSource, 'data-action="orchestrator-send-message"'],
  ["orchestrator composer clears after send", appSource, 'state.planner.intent = ""'],
  ["task workspace split layout", appSource, "task-workspace-grid"],
  ["task workboard surface", appSource, "task-workboard-panel"],
  ["task conversation right rail", appSource, "task-conversation-rail"],
  ["task conversation unified scroll surface", appSource, "task-conversation-scroll"],
  ["task conversation scroll styles", styleSource, ".task-conversation-scroll"],
  ["task conversation visibility control", appSource, 'data-action="hide-task-conversation"'],
  ["task conversation WebSocket transport", appSource, "sendConversationSocketTurn"],
  ["task conversation streaming delta", appSource, 'payload.type === "conversation.delta"'],
  ["task conversation plain message composer", appSource, 'placeholder="Message My Mate"'],
  ["task scroll preservation", appSource, "captureTaskWorkspaceScroll"],
  ["session stream alert debounce", appSource, "sessionStreamErrorTimer"],
  ["session stream unchanged snapshot guard", appSource, "getWorkspaceRenderSignature"],
  ["provider-backed conversation evidence", appSource, "message.content?.response_source"],
  ["new task invalidates stale workspace loads", appSource, "workspaceLoadSeq += 1;\n  closeSessionStream();\n  resetWorkspaceDrilldownState();"],
  ["session stream rejects stale events", appSource, "const isCurrentStream = () =>"],
  ["conversation model source badge", styleSource, ".conversation-source"],
  ["completed runs are not labelled live", appSource, '`${formatWorkspaceLabel(runStatus)} run`'],
  ["conversation excludes structural cards", appSource, 'message.role === "user" || message.role === "orchestrator"'],
  ["runtime label follows dispatcher", appSource, "function getRuntimeExecutionLabel"],
  ["runtime overlay has component positioning", appSource, "const overlayStyle = state.ui.runtimeOverlayOpen"],
  ["orchestrator command", appSource, "nav:orchestrator"],
  ["durable proposal state", appSource, "activeProposal"],
  ["durable proposal API", appSource, "/dag-proposals"],
  ["durable proposal create action", appSource, 'data-action="create-dag-proposal"'],
  ["durable proposal confirm identity", appSource, 'data-proposal-id="${escapeHtml(activeProposal.proposal_id)}"'],
  ["durable proposal confirm dispatch identity", appSource, "button.dataset.proposalId"],
  ["proposal run launch", appSource, "launchConfirmedProposalRun"],
  ["patch graph review panel", appSource, "function renderPatchGraphReviewPanel"],
  ["patch graph review focus", appSource, 'data-workspace-focus="patch-graph"'],
  ["authoring graph model", appSource, "function buildAuthoringGraphModel"],
  ["authoring graph canvas", appSource, "function renderAuthoringGraphCanvas"],
  ["authoring graph node selection", appSource, 'data-action="select-authoring-node"'],
  ["authoring graph edge selection", appSource, 'data-action="select-authoring-edge"'],
  ["authoring graph drag", appSource, 'document.addEventListener("pointermove"'],
  ["authoring graph ports", appSource, 'data-action="authoring-port-out"'],
  ["authoring graph undo", appSource, "undoAuthoringGraph"],
  ["authoring graph patch preview", appSource, "buildGraphPatchPreview"],
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
  ["desktop workspace browser styles", styleSource, ".desktop-local-browser"],
  ["orchestrator styles", styleSource, ".orchestrator-workbench"],
  ["task workspace split styles", styleSource, ".task-workspace-grid"],
  ["task workboard styles", styleSource, ".task-workboard-panel"],
  ["task conversation rail styles", styleSource, ".task-conversation-rail"],
  ["task conversation hidden scrollbar", styleSource, "scrollbar-width: none"],
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
  ["registry governance styles", styleSource, ".governance-workbench"],
  ["provider connection styles", styleSource, ".provider-modal-backdrop"],
  ["first-run setup styles", styleSource, ".setup-modal-backdrop"],
  ["setup environment styles", styleSource, ".setup-environment-card"],
  ["registry section tab styles", styleSource, ".registry-section-tabs"],
  ["provider connection status layout", styleSource, ".provider-connection-status"],
  ["mission workspace support styles", styleSource, ".mission-support-panel"],
  ["mission delivery trace styles", styleSource, ".mission-delivery-trace-panel"],
  ["mission output history styles", styleSource, ".mission-output-history-panel"],
  ["mission rail empty callout styles", styleSource, ".rail-empty-callout"],
  ["workspace feed filter styles", styleSource, ".rail-feed-filter"],
  ["workspace focus styles", styleSource, ".workspace-focus-highlight"],
];

if (appSource.includes('state.activeNav === "sessions" ? loadSessions(false)')) {
  console.error("Workspace task startup must not gate Session hydration on the legacy Sessions navigation.");
  process.exit(1);
}

if (appSource.includes("function renderTaskProjectWorkspace")) {
  console.error("Per-task Project configuration must not return to the primary task workboard.");
  process.exit(1);
}

const workspaceTreeStart = appSource.indexOf("function renderDesktopWorkspaceTree()");
const workspaceTreeEnd = appSource.indexOf("function renderOrchestratorSidebarContent", workspaceTreeStart);
const workspaceTreeSource = appSource.slice(workspaceTreeStart, workspaceTreeEnd);
if (workspaceTreeStart < 0 || workspaceTreeEnd < 0 || workspaceTreeSource.includes("renderWorkspaceCreator()")) {
  console.error("Workspace creation must remain a global modal and must not expand inside the sidebar tree.");
  process.exit(1);
}

const productSettingsStart = appSource.indexOf("function renderProductSettingsPanel");
const productSettingsEnd = appSource.indexOf("function renderDesktopCenter", productSettingsStart);
const productSettingsSource = appSource.slice(productSettingsStart, productSettingsEnd);
if (
  productSettingsStart < 0 ||
  productSettingsEnd < 0 ||
  productSettingsSource.includes("renderDesktopWorkspaceBrowser()") ||
  productSettingsSource.includes("Workspace details") ||
  productSettingsSource.includes("Local workspace")
) {
  console.error("Workspace selection and folder configuration belong in the sidebar, not Settings.");
  process.exit(1);
}

const taskMoveStart = appSource.indexOf("async function moveTaskToDesktopProject");
const taskMoveEnd = appSource.indexOf("async function archiveDesktopProject", taskMoveStart);
const taskMoveSource = appSource.slice(taskMoveStart, taskMoveEnd);
const taskMoveForbiddenWork = [
  "loadSessionWorkspace(",
  "loadMissions(",
  "loadSessions(",
  "desktopHost.workspace.projects",
  "desktopHost.workspace.get",
  "\n  render();",
];
if (
  taskMoveStart < 0 ||
  taskMoveEnd < 0 ||
  taskMoveForbiddenWork.some((marker) => taskMoveSource.includes(marker))
) {
  console.error("Task reassignment must not reload Session data or trigger a full Studio render.");
  process.exit(1);
}

if (appSource.includes("toggle-advanced-navigation") || styleSource.includes(".desktop-nav-toggle")) {
  console.error("Grouped navigation must use the Task / Build / Operate / Admin tab control, not a disclosure toggle.");
  process.exit(1);
}

if (
  !styleSource.includes(".workspace-modal-backdrop") ||
  !styleSource.includes("width: min(520px, 100%)") ||
  !styleSource.includes(".workspace-tree-project.is-drop-target")
) {
  console.error("Workspace modal sizing and drag target feedback styles are required.");
  process.exit(1);
}

for (const [label, source, marker] of smokeMarkers) {
  if (!source.includes(marker)) {
    console.error(`Studio smoke check failed: missing ${label} marker (${marker}).`);
    process.exit(1);
  }
}

if (appSource.includes("Use as target") || appSource.includes("target_artifact_id")) {
  console.error("Studio smoke check failed: file mutation targets must be resolved automatically.");
  process.exit(1);
}

const retiredAgentSurfaceMarkers = [
  "/api/registry/agent-profiles",
  "/api/orchestrator-profiles",
  'data-field="agent.openclawAgentId"',
  'data-field="node.agent_profile"',
  'data-field="proposal.agent_profile"',
  "function renderLegacyAgentHostingPanel",
  "loadOrchestratorProfiles",
];
for (const marker of retiredAgentSurfaceMarkers) {
  if (appSource.includes(marker)) {
    console.error(`Studio smoke check failed: retired Agent surface returned (${marker}).`);
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

const autonomySaveStart = appSource.indexOf("async function saveProductAutonomyMode");
const autonomySaveEnd = appSource.indexOf("async function loadGovernance", autonomySaveStart);
const autonomySaveSource = appSource.slice(autonomySaveStart, autonomySaveEnd);
if (autonomySaveStart < 0 || autonomySaveEnd < 0 || autonomySaveSource.includes("/autopilot")) {
  console.error("Studio smoke check failed: global autonomy settings must not mutate a selected Session controller.");
  process.exit(1);
}

const runtimeLayoutCheck = spawnSync(process.execPath, ["scripts/runtime-graph-visual-check.mjs", "--layout-only"], {
  stdio: "inherit",
});
if (runtimeLayoutCheck.status !== 0) {
  process.exit(runtimeLayoutCheck.status || 1);
}

console.log("Studio syntax and interaction smoke checks passed.");
