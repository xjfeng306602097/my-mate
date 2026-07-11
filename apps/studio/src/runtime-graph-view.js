import { renderRuntimeNodeDrawer } from "./runtime-node-drawer.js";
import { renderRuntimeEvaluationPanel } from "./runtime-evaluation-view.js";

const RUNTIME_TABS = [
  ["timeline", "Timeline"],
  ["evaluation", "Scorecard / Eval"],
  ["recovery", "Recovery"],
  ["trace", "Trace"],
  ["evidence", "Raw Evidence"],
  ["routes", "Route Changes"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 1));
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return "-";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function formatTimestamp(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return "not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(parsed));
}

function formatMoney(values) {
  const entries = Object.entries(values || {});
  return entries.length ? entries.map(([currency, amount]) => `${currency} ${amount}`).join(" + ") : "-";
}

function formatCompleteness(value) {
  if (value === "complete") return "complete";
  if (value === "partial") return "partial";
  return "unavailable";
}

function edgePath(edge) {
  const delta = Math.max(44, Math.abs(edge.toX - edge.fromX) * 0.45);
  const firstBend = edge.fromX + (edge.toX >= edge.fromX ? delta : -delta);
  const secondBend = edge.toX - (edge.toX >= edge.fromX ? delta : -delta);
  return `M ${edge.fromX} ${edge.fromY} C ${firstBend} ${edge.fromY}, ${secondBend} ${edge.toY}, ${edge.toX} ${edge.toY}`;
}

function renderEdge(edge) {
  if (!edge.valid) return "";
  const label = String(edge.label || "").slice(0, 42);
  const labelX = (edge.fromX + edge.toX) / 2;
  const labelY = (edge.fromY + edge.toY) / 2 - 7;
  return `
    <g class="runtime-graph-edge-group tone-${escapeHtml(edge.tone)}">
      <path class="runtime-graph-edge-hit" data-action="select-runtime-edge" data-node-run-id="${escapeHtml(edge.fromNodeRunId || "")}" data-edge-id="${escapeHtml(edge.id)}" d="${edgePath(edge)}"></path>
      <path class="runtime-graph-edge-line" d="${edgePath(edge)}" marker-end="url(#runtime-arrow-${escapeHtml(edge.tone)})"></path>
      ${label ? `<text class="runtime-graph-edge-label" x="${labelX}" y="${labelY}" text-anchor="middle"><tspan>${escapeHtml(label)}</tspan></text>` : ""}
    </g>
  `;
}

function runtimeNodeBadges(node) {
  return [
    node.maxAttempts > 1 ? `${node.attempt}/${node.maxAttempts} attempts` : null,
    node.toolFailureCount ? `${node.toolFailureCount} tool fail` : node.toolCallCount ? `${node.toolCallCount} tools` : null,
    node.usage.tokenCompleteness === "complete" ? `${node.usage.totalTokens ?? 0} tokens` : `usage ${node.usage.tokenCompleteness}`,
    Number.isFinite(node.durationMs) ? formatDuration(node.durationMs) : null,
  ].filter(Boolean).slice(0, 4);
}

function renderNode(node, selectedNodeRunId) {
  const badges = runtimeNodeBadges(node);
  return `
    <button
      class="runtime-graph-node tone-${escapeHtml(node.tone)} ${selectedNodeRunId === node.nodeRunId ? "selected" : ""} ${node.invalid ? "invalid" : ""}"
      style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px"
      type="button"
      data-action="select-runtime-node"
      data-node-run-id="${escapeHtml(node.nodeRunId)}"
      aria-label="${escapeHtml(`${node.name}, ${node.status}`)}"
    >
      <span class="runtime-graph-node-head">
        <span class="runtime-status-dot" aria-hidden="true"></span>
        <span class="runtime-graph-node-title">
          <strong>${escapeHtml(node.name || node.nodeId || "Node")}</strong>
          <small>${escapeHtml(node.role)}</small>
        </span>
        <span class="runtime-state-label tone-${escapeHtml(node.tone)}">${escapeHtml(node.status)}</span>
      </span>
      <span class="runtime-graph-node-secondary">${escapeHtml(node.workPackageLabel || "Execution")}${node.progressMessage ? ` / ${escapeHtml(node.progressMessage)}` : ""}</span>
      <span class="runtime-graph-node-badges">${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}</span>
      <span class="runtime-graph-node-progress"><span style="width:${node.progressPercent}%"></span></span>
    </button>
  `;
}

function renderListFallback(model) {
  return `
    <div class="runtime-graph-list-fallback" aria-label="Runtime graph node list">
      ${model.nodes.map((node) => `
        <button type="button" class="runtime-graph-list-node ${model.selectedNode?.nodeRunId === node.nodeRunId ? "selected" : ""}" data-action="select-runtime-node" data-node-run-id="${escapeHtml(node.nodeRunId)}">
          <span class="runtime-status-dot tone-${escapeHtml(node.tone)}"></span>
          <span><strong>${escapeHtml(node.name || node.nodeId)}</strong><small>${escapeHtml(`${node.workPackageLabel || "Execution"} / ${node.role}`)}</small></span>
          <span class="runtime-state-label tone-${escapeHtml(node.tone)}">${escapeHtml(node.status)}</span>
        </button>
      `).join("") || '<p class="runtime-empty-state">No runtime nodes are available.</p>'}
    </div>
  `;
}

function renderTimeline(model) {
  const spans = model.trace.spans.slice().sort((left, right) => String(right.started_at || "").localeCompare(String(left.started_at || ""))).slice(0, 60);
  if (!spans.length) return '<p class="runtime-empty-state">No timeline spans are available.</p>';
  return `<div class="runtime-secondary-list">${spans.map((span) => `
    <div class="runtime-secondary-row">
      <span class="runtime-secondary-kind">${escapeHtml(String(span.kind || "event").slice(0, 3).toUpperCase())}</span>
      <div><strong>${escapeHtml(span.name || span.kind || "Event")}</strong><small>${escapeHtml(formatTimestamp(span.started_at))}${span.node_run_id ? ` / ${escapeHtml(span.node_run_id)}` : ""}</small></div>
      <span class="runtime-state-label tone-${span.status === "error" ? "danger" : span.status === "ok" ? "success" : "neutral"}">${escapeHtml(span.status || "unknown")}</span>
    </div>
  `).join("")}</div>`;
}

function renderEvaluation(model) {
  const scorecards = model.scorecards;
  const evaluations = model.evaluations;
  return `
    <div class="runtime-evaluation-summary">
      <div class="runtime-secondary-heading"><strong>Scorecards</strong><span>${escapeHtml(scorecards.length)}</span></div>
      ${scorecards.length ? scorecards.slice().reverse().map((item) => `
        <div class="runtime-secondary-row"><span class="runtime-secondary-kind">SC</span><div><strong>${escapeHtml(item.profile || item.scorecard_id || "Scorecard")}</strong><small>${escapeHtml(item.verdict || item.status || item.created_at || "recorded")}</small></div></div>
      `).join("") : '<p class="runtime-empty-state">No scorecard has been created for this run.</p>'}
      <div class="runtime-secondary-heading"><strong>Evaluations</strong><span>${escapeHtml(evaluations.length)}</span></div>
      ${evaluations.length ? evaluations.slice().reverse().map((item) => `
        <div class="runtime-secondary-row"><span class="runtime-secondary-kind">EV</span><div><strong>${escapeHtml(item.evaluator_id || item.evaluation_id || "Evaluation")}</strong><small>${escapeHtml(item.quality_verdict || item.status || "recorded")}</small></div><span class="runtime-state-label tone-${item.status === "failed" ? "danger" : item.status === "completed" ? "success" : "warn"}">${escapeHtml(item.status || "unknown")}</span></div>
      `).join("") : '<p class="runtime-empty-state">No evaluation has been run.</p>'}
    </div>
  `;
}

function renderTrace(model) {
  if (!model.trace.spans.length) return '<p class="runtime-empty-state">Trace projection is unavailable.</p>';
  return `<div class="runtime-secondary-list">${model.trace.spans.map((span) => `
    <button type="button" class="runtime-secondary-row runtime-secondary-button" data-action="select-runtime-trace" data-node-run-id="${escapeHtml(span.node_run_id || "")}">
      <span class="runtime-secondary-kind">${escapeHtml(String(span.kind).slice(0, 3).toUpperCase())}</span>
      <span><strong>${escapeHtml(span.name)}</strong><small>${escapeHtml(span.span_id)}${span.provider ? ` / ${escapeHtml(span.provider)}` : ""}${span.model ? ` / ${escapeHtml(span.model)}` : ""}</small></span>
      <span class="runtime-state-label tone-${span.status === "error" ? "danger" : span.status === "ok" ? "success" : "neutral"}">${escapeHtml(span.status)}</span>
    </button>
  `).join("")}</div>`;
}

function renderEvidence(model) {
  if (!model.evidence.length) return '<p class="runtime-empty-state">No worker evidence is available.</p>';
  return `<div class="runtime-secondary-list">${model.evidence.slice().reverse().map((item) => `
    <button type="button" class="runtime-secondary-row runtime-secondary-button" data-action="select-runtime-evidence" data-node-run-id="${escapeHtml(item.node_run_id || "")}">
      <span class="runtime-secondary-kind">${escapeHtml(String(item.kind || "log").slice(0, 3).toUpperCase())}</span>
      <span><strong>${escapeHtml(item.summary || item.kind || "Evidence")}</strong><small>${escapeHtml(formatTimestamp(item.created_at))}${item.source?.provider ? ` / ${escapeHtml(item.source.provider)}` : ""}</small></span>
      <span class="runtime-state-label tone-${item.kind === "error" || item.redaction_status === "blocked" ? "danger" : item.redaction_status === "redacted" ? "warn" : "neutral"}">${escapeHtml(item.redaction_status || "recorded")}</span>
    </button>
  `).join("")}</div>`;
}

function renderRouteChanges(model) {
  const compare = model.routeChanges;
  const summaryLines = Array.isArray(compare?.summaryLines) ? compare.summaryLines : [];
  return `
    <div class="runtime-route-summary">
      <div class="runtime-drawer-kv">
        <div><span>Route</span><strong>${escapeHtml(model.route.label)}</strong></div>
        <div><span>Route ID</span><strong>${escapeHtml(model.route.id || "not recorded")}</strong></div>
        <div><span>Source</span><strong>${escapeHtml(model.route.source)}</strong></div>
      </div>
      ${summaryLines.length ? `<div class="runtime-secondary-list">${summaryLines.map((line) => `<div class="runtime-secondary-row"><span class="runtime-secondary-kind">RT</span><div><strong>${escapeHtml(line)}</strong></div></div>`).join("")}</div>` : '<p class="runtime-empty-state">No route comparison changes are attached to this run view.</p>'}
    </div>
  `;
}

function renderRecovery(model, ui) {
  const recovery = model.recovery || {};
  const summary = recovery.summary || {};
  const compensations = Array.isArray(recovery.compensations) ? recovery.compensations : [];
  const replays = Array.isArray(recovery.execution_replays) ? recovery.execution_replays : [];
  const selected = model.selectedNode;
  const replayEligible = selected && ["failed", "cancelled"].includes(selected.status);
  const postureTone = recovery.posture === "degraded" ? "danger" : recovery.posture === "recovering" ? "warn" : "success";
  return `
    <div class="runtime-recovery-workbench">
      <div class="runtime-secondary-heading">
        <div><strong>Recovery Posture</strong><span class="runtime-state-label tone-${postureTone}">${escapeHtml(recovery.posture || "healthy")}</span></div>
        <div class="runtime-recovery-actions">
          <button class="secondary" type="button" data-action="scan-runtime-recovery" ${ui.recoveryLoading ? "disabled" : ""}>${ui.recoveryLoading ? "Scanning..." : "Scan deadlines"}</button>
          <button class="primary" type="button" data-action="replay-runtime-node" ${!replayEligible || ui.failureReplayLoading ? "disabled" : ""}>${ui.failureReplayLoading ? "Dispatching..." : "Replay failed node"}</button>
        </div>
      </div>
      <div class="runtime-recovery-metrics">
        <div><span>Compensations</span><strong>${escapeHtml(summary.compensations || 0)}</strong></div>
        <div><span>Pending</span><strong>${escapeHtml(summary.pending_compensations || 0)}</strong></div>
        <div><span>Cleanup failures</span><strong>${escapeHtml(summary.cleanup_failures || 0)}</strong></div>
        <div><span>Failure replays</span><strong>${escapeHtml(summary.execution_replays || 0)}</strong></div>
      </div>
      <div class="runtime-secondary-heading"><strong>Compensation Audit</strong><span>${escapeHtml(compensations.length)}</span></div>
      ${compensations.length ? `<div class="runtime-secondary-list">${compensations.slice().reverse().map((item) => `
        <div class="runtime-secondary-row">
          <span class="runtime-secondary-kind">CP</span>
          <div><strong>${escapeHtml(item.reason || "compensation")}</strong><small>${escapeHtml(item.node_run_id || "")}${item.cleanup_attempt_ids?.length ? ` / ${escapeHtml(item.cleanup_attempt_ids.join(", "))}` : ""}</small></div>
          <span class="runtime-state-label tone-${item.status === "cleanup_failed" ? "danger" : item.status === "completed" ? "success" : "warn"}">${escapeHtml(item.status || "unknown")}</span>
        </div>`).join("")}</div>` : '<p class="runtime-empty-state">No timeout compensation has been required.</p>'}
      <div class="runtime-secondary-heading"><strong>Failure Replay Lineage</strong><span>${escapeHtml(replays.length)}</span></div>
      ${replays.length ? `<div class="runtime-secondary-list">${replays.slice().reverse().map((item) => `
        <div class="runtime-secondary-row">
          <span class="runtime-secondary-kind">RP</span>
          <div><strong>${escapeHtml(item.node_run_id || "failure replay")}</strong><small>${escapeHtml(item.source_job_id || "source unavailable")} -> ${escapeHtml(item.replay_job_id || "dispatch pending")}</small></div>
          <span class="runtime-state-label tone-${item.status === "failed" ? "danger" : item.status === "completed" ? "success" : "warn"}">${escapeHtml(item.status || "unknown")}</span>
        </div>`).join("")}</div>` : '<p class="runtime-empty-state">No failed node has been replayed.</p>'}
    </div>
  `;
}

function renderSecondaryPanel(model, activeTab, ui) {
  if (activeTab === "evaluation") return renderRuntimeEvaluationPanel(model, ui);
  if (activeTab === "recovery") return renderRecovery(model, ui);
  if (activeTab === "trace") return renderTrace(model);
  if (activeTab === "evidence") return renderEvidence(model);
  if (activeTab === "routes") return renderRouteChanges(model);
  return renderTimeline(model);
}

function renderRunControls(model) {
  const controls = [];
  if (["running", "queued"].includes(model.runStatus)) {
    controls.push(`<button class="icon-button" type="button" data-action="run-pause" data-run-id="${escapeHtml(model.runId)}" title="Pause run" aria-label="Pause run">&#9208;</button>`);
  }
  if (["paused", "blocked", "waiting_human"].includes(model.runStatus)) {
    controls.push(`<button class="icon-button" type="button" data-action="run-resume" data-run-id="${escapeHtml(model.runId)}" title="Resume run" aria-label="Resume run">&#9654;</button>`);
  }
  if (!["completed", "failed", "cancelled"].includes(model.runStatus)) {
    controls.push(`<button class="icon-button danger-action" type="button" data-action="run-cancel" data-run-id="${escapeHtml(model.runId)}" title="Cancel run" aria-label="Cancel run">&#9632;</button>`);
  }
  return controls.join("");
}

export function renderRuntimeGraphView(model, ui = {}) {
  if (!model?.runId) {
    return `
      <section class="subpanel runtime-graph-v2" data-workspace-focus="graph">
        <div class="runtime-empty-state">Runtime topology will appear after a run plan is available.</div>
      </section>
    `;
  }
  const zoom = clamp(ui.zoom, 0.5, 1.35);
  const activeTab = RUNTIME_TABS.some(([id]) => id === ui.activeTab) ? ui.activeTab : "timeline";
  const drawerOpen = ui.drawerOpen === true && !!model.selectedNode;
  const overlayClass = ui.overlayOpen ? " runtime-graph-overlay" : "";
  const listClass = ui.listFallback ? " show-list-fallback" : "";
  const tokenCompleteness = formatCompleteness(model.usage.tokenCompleteness);
  const costCompleteness = model.usage.providerCostCompleteness === "unavailable"
    ? formatCompleteness(model.usage.estimatedCostCompleteness)
    : formatCompleteness(model.usage.providerCostCompleteness);
  return `
    <section class="subpanel runtime-graph-v2${overlayClass}${listClass}" data-workspace-focus="graph" data-runtime-run-id="${escapeHtml(model.runId)}">
      <div class="runtime-run-toolbar">
        <div class="runtime-run-identity">
          <strong>Runtime Graph</strong>
          <span class="runtime-state-label tone-${escapeHtml(model.runTone)}">${escapeHtml(model.runStatus)}</span>
        </div>
        <div class="runtime-run-facts">
          <div><span>Route</span><strong title="${escapeHtml(model.route.id)}">${escapeHtml(model.route.label)}</strong></div>
          <div><span>Duration</span><strong>${escapeHtml(formatDuration(model.runDurationMs))}</strong></div>
          <div><span>Nodes</span><strong>${escapeHtml(model.nodes.length)}</strong></div>
          <div><span>Usage</span><strong class="completeness-${escapeHtml(tokenCompleteness)}">${escapeHtml(tokenCompleteness)}</strong></div>
          <div><span>Cost</span><strong class="completeness-${escapeHtml(costCompleteness)}">${escapeHtml(costCompleteness)}</strong></div>
        </div>
        <div class="runtime-run-actions">
          ${renderRunControls(model)}
          <button class="icon-button" type="button" data-action="refresh-runtime-projection" title="Refresh runtime" aria-label="Refresh runtime">&#8635;</button>
          <button class="icon-button" type="button" data-action="toggle-runtime-overlay" title="${ui.overlayOpen ? "Exit full screen" : "Open full screen"}" aria-label="${ui.overlayOpen ? "Exit full screen" : "Open full screen"}">${ui.overlayOpen ? "&#10005;" : "&#9974;"}</button>
        </div>
      </div>

      <div class="runtime-graph-shell ${drawerOpen ? "drawer-open" : ""}">
        <div class="runtime-graph-main">
          <div class="runtime-graph-controls" aria-label="Graph controls">
            <button class="icon-button" type="button" data-action="runtime-zoom-out" title="Zoom out" aria-label="Zoom out">&#8722;</button>
            <span>${escapeHtml(`${Math.round(zoom * 100)}%`)}</span>
            <button class="icon-button" type="button" data-action="runtime-zoom-in" title="Zoom in" aria-label="Zoom in">&#43;</button>
            <button class="icon-button" type="button" data-action="runtime-fit-view" title="Fit graph to view" aria-label="Fit graph to view">&#10530;</button>
            <button class="icon-button" type="button" data-action="toggle-runtime-list" title="Toggle node list" aria-label="Toggle node list">&#9776;</button>
          </div>
          <div class="runtime-graph-viewport" tabindex="0" data-runtime-graph-viewport="true">
            <div class="runtime-graph-zoom-shell" style="width:${Math.round(model.layout.width * zoom)}px;height:${Math.round(model.layout.height * zoom)}px">
              <div class="runtime-graph-surface" style="width:${model.layout.width}px;height:${model.layout.height}px;transform:scale(${zoom})">
                <svg class="runtime-graph-svg" viewBox="0 0 ${model.layout.width} ${model.layout.height}" aria-hidden="true">
                  <defs>
                    <marker id="runtime-arrow-satisfied" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
                    <marker id="runtime-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
                    <marker id="runtime-arrow-blocked" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
                    <marker id="runtime-arrow-pending" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
                    <marker id="runtime-arrow-skipped" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
                  </defs>
                  ${model.edges.map(renderEdge).join("")}
                </svg>
                ${model.nodes.map((node) => renderNode(node, model.selectedNode?.nodeRunId)).join("")}
              </div>
            </div>
          </div>
          ${renderListFallback(model)}
        </div>
        ${drawerOpen ? renderRuntimeNodeDrawer(model.selectedNode) : ""}
      </div>

      <div class="runtime-secondary-tabs" role="tablist" aria-label="Runtime evidence views">
        ${RUNTIME_TABS.map(([id, label]) => `<button type="button" role="tab" aria-selected="${activeTab === id}" class="${activeTab === id ? "selected" : ""}" data-action="select-runtime-tab" data-runtime-tab="${id}">${escapeHtml(label)}</button>`).join("")}
      </div>
      <div class="runtime-secondary-panel" role="tabpanel" data-runtime-active-tab="${escapeHtml(activeTab)}">
        ${renderSecondaryPanel(model, activeTab, ui)}
      </div>
      <div class="runtime-run-footnote">
        <span>Trace ${escapeHtml(model.trace.completeness)}</span>
        <span>${escapeHtml(formatMoney(model.usage.providerReportedCosts))} provider cost</span>
        <span>${escapeHtml(formatMoney(model.usage.estimatedCosts))} estimated cost</span>
      </div>
    </section>
  `;
}
