function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return "not started";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
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

function formatMoneyMap(values) {
  const entries = Object.entries(values || {});
  return entries.length ? entries.map(([currency, amount]) => `${currency} ${amount}`).join(" + ") : "unavailable";
}

function prettyPayload(value) {
  if (value === undefined || value === null) return "No inline payload.";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function evidenceRow(item, fallbackKind = "evidence") {
  const source = item.source?.provider || item.kind || fallbackKind;
  const detail = item.storage_uri || item.output_ref || item.input_ref || item.trace?.tool_call_id || "";
  return `
    <div class="runtime-drawer-row">
      <span class="runtime-drawer-kind">${escapeHtml(String(source).slice(0, 3).toUpperCase())}</span>
      <div>
        <strong>${escapeHtml(item.summary || item.name || fallbackKind)}</strong>
        <small>${escapeHtml(formatTimestamp(item.created_at || item.started_at))}${detail ? ` / ${escapeHtml(detail)}` : ""}</small>
      </div>
    </div>
  `;
}

function renderEmpty(message) {
  return `<p class="runtime-drawer-empty">${escapeHtml(message)}</p>`;
}

function renderAttempts(node) {
  if (!node.jobs.length) return renderEmpty("No runtime attempt has been dispatched.");
  return node.jobs
    .slice()
    .reverse()
    .map((job) => `
      <div class="runtime-attempt-row">
        <div>
          <strong>Attempt ${escapeHtml(job.attempt || 1)}</strong>
          <small>${escapeHtml(job.agent_runtime || "local")} / ${escapeHtml(job.target_kind || "local")}</small>
        </div>
        <span class="runtime-state-label tone-${escapeHtml(job.status === "failed" || job.status === "rejected" ? "danger" : job.status === "completed" ? "success" : "warn")}">${escapeHtml(job.status || "created")}</span>
        <small>${escapeHtml(formatTimestamp(job.created_at))}</small>
      </div>
    `)
    .join("");
}

function renderPrompts(node) {
  if (!node.prompts.length) return renderEmpty("No prompt evidence is available for this node.");
  return node.prompts
    .slice()
    .reverse()
    .map((prompt) => `
      ${evidenceRow(prompt, "prompt")}
      ${prompt.inline_payload !== undefined && prompt.inline_payload !== null
        ? `<details class="runtime-payload"><summary>Payload</summary><pre>${escapeHtml(prettyPayload(prompt.inline_payload))}</pre></details>`
        : ""}
    `)
    .join("");
}

function renderTools(node) {
  const rows = node.toolSpans.length
    ? node.toolSpans.map((span) => ({
        summary: span.name,
        created_at: span.started_at,
        output_ref: span.output_ref,
        trace: { tool_call_id: span.tool_call_id },
        source: { provider: span.provider },
        status: span.status,
      }))
    : node.toolCalls;
  if (!rows.length) return renderEmpty("No tool calls were recorded.");
  return rows
    .slice()
    .reverse()
    .map((item) => `
      <div class="runtime-drawer-row ${item.status === "error" ? "is-error" : ""}">
        <span class="runtime-drawer-kind">TL</span>
        <div>
          <strong>${escapeHtml(item.summary || "Tool call")}</strong>
          <small>${escapeHtml(item.trace?.tool_call_id || item.output_ref || "No native tool call ID")}</small>
        </div>
      </div>
    `)
    .join("");
}

function renderUsage(node) {
  const usage = node.usage;
  return `
    <div class="runtime-drawer-metrics">
      <div><span>Tokens</span><strong>${escapeHtml(usage.totalTokens ?? "-")}</strong></div>
      <div><span>Input</span><strong>${escapeHtml(usage.inputTokens ?? "-")}</strong></div>
      <div><span>Output</span><strong>${escapeHtml(usage.outputTokens ?? "-")}</strong></div>
      <div><span>Turns</span><strong>${escapeHtml(usage.turnCount ?? "-")}</strong></div>
    </div>
    <div class="runtime-drawer-kv">
      <div><span>Token evidence</span><strong>${escapeHtml(usage.tokenCompleteness)}</strong></div>
      <div><span>Provider cost</span><strong>${escapeHtml(formatMoneyMap(usage.providerReportedCosts))}</strong></div>
      <div><span>Estimated cost</span><strong>${escapeHtml(formatMoneyMap(usage.estimatedCosts))}</strong></div>
    </div>
  `;
}

export function renderRuntimeNodeDrawer(node) {
  if (!node) return "";
  return `
    <aside class="runtime-node-drawer" aria-label="Runtime node details" data-runtime-node-drawer="${escapeHtml(node.nodeRunId)}">
      <div class="runtime-drawer-header">
        <div>
          <span class="runtime-drawer-eyebrow">${escapeHtml(node.workPackageLabel || "Execution")}</span>
          <strong>${escapeHtml(node.name || node.nodeId || "Node")}</strong>
          <small>${escapeHtml(node.role)}</small>
        </div>
        <button class="icon-button runtime-drawer-close" type="button" data-action="close-runtime-node" title="Close node details" aria-label="Close node details">&#10005;</button>
      </div>

      <section class="runtime-drawer-section">
        <div class="runtime-drawer-section-title"><strong>Summary</strong><span class="runtime-state-label tone-${escapeHtml(node.tone)}">${escapeHtml(node.status)}</span></div>
        <div class="runtime-drawer-metrics">
          <div><span>Progress</span><strong>${escapeHtml(`${node.progressPercent}%`)}</strong></div>
          <div><span>Duration</span><strong>${escapeHtml(formatDuration(node.durationMs))}</strong></div>
          <div><span>Attempt</span><strong>${escapeHtml(`${node.attempt}/${node.maxAttempts}`)}</strong></div>
          <div><span>Artifacts</span><strong>${escapeHtml(node.artifacts.length)}</strong></div>
        </div>
        <p>${escapeHtml(node.progressMessage || node.errorSummary || "No progress message recorded.")}</p>
        <div class="runtime-drawer-kv">
          <div><span>Node ID</span><strong>${escapeHtml(node.nodeId)}</strong></div>
          <div><span>Node run</span><strong>${escapeHtml(node.nodeRunId)}</strong></div>
          <div><span>Job</span><strong>${escapeHtml(node.activeJobId || "none")}</strong></div>
          <div><span>Worker</span><strong>${escapeHtml(node.activeWorkerId || "none")}</strong></div>
          <div><span>Lease</span><strong>${escapeHtml(node.activeLeaseId || "none")}</strong></div>
          <div><span>Gate</span><strong>${escapeHtml(node.humanGateState || "none")}</strong></div>
        </div>
      </section>

      <section class="runtime-drawer-section">
        <div class="runtime-drawer-section-title"><strong>Attempts</strong><span>${escapeHtml(node.jobs.length)}</span></div>
        ${renderAttempts(node)}
      </section>
      <section class="runtime-drawer-section">
        <div class="runtime-drawer-section-title"><strong>Prompt</strong><span>${escapeHtml(node.prompts.length)}</span></div>
        ${renderPrompts(node)}
      </section>
      <section class="runtime-drawer-section">
        <div class="runtime-drawer-section-title"><strong>Tools</strong><span>${escapeHtml(node.toolCallCount)}</span></div>
        ${renderTools(node)}
      </section>
      <section class="runtime-drawer-section">
        <div class="runtime-drawer-section-title"><strong>Usage</strong><span>${escapeHtml(node.usage.tokenCompleteness)}</span></div>
        ${renderUsage(node)}
      </section>
      <section class="runtime-drawer-section">
        <div class="runtime-drawer-section-title"><strong>Handoffs</strong><span>${escapeHtml(node.handoffs.length)}</span></div>
        ${node.handoffs.length ? node.handoffs.slice().reverse().map((item) => evidenceRow(item, "handoff")).join("") : renderEmpty("No handoffs were emitted.")}
      </section>
      <section class="runtime-drawer-section">
        <div class="runtime-drawer-section-title"><strong>Artifacts</strong><span>${escapeHtml(node.artifacts.length)}</span></div>
        ${node.artifacts.length ? node.artifacts.slice().reverse().map((item) => evidenceRow(item, "artifact")).join("") : renderEmpty("No artifacts were produced.")}
      </section>
      <section class="runtime-drawer-section">
        <div class="runtime-drawer-section-title"><strong>Errors</strong><span>${escapeHtml(node.errors.length)}</span></div>
        ${node.errors.length ? node.errors.slice().reverse().map((item) => evidenceRow(item, "error")).join("") : renderEmpty("No errors recorded for this node.")}
      </section>
    </aside>
  `;
}
