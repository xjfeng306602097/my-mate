function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toneForVerdict(value) {
  if (["pass", "complete", "completed", "not_applicable", "not_enforced"].includes(value)) return "success";
  if (["fail", "reject", "failed", "error"].includes(value)) return "danger";
  if (["incomplete", "partial", "queued", "running"].includes(value)) return "warn";
  return "neutral";
}

function verdictLabel(value) {
  return String(value || "unavailable").replaceAll("_", " ");
}

function renderVerdict(label, value) {
  return `
    <div class="runtime-verdict-item">
      <span>${escapeHtml(label)}</span>
      <strong class="runtime-state-label tone-${toneForVerdict(value)}">${escapeHtml(verdictLabel(value))}</strong>
    </div>
  `;
}

function renderFinding(finding) {
  const severity = finding?.severity || "info";
  return `
    <div class="runtime-finding-row tone-${toneForVerdict(severity === "error" ? "fail" : severity === "warning" ? "partial" : "unknown")}">
      <span class="runtime-secondary-kind">${escapeHtml(String(severity).slice(0, 3).toUpperCase())}</span>
      <div>
        <strong>${escapeHtml(finding?.summary || finding?.check_id || "Evaluation finding")}</strong>
        <small>${escapeHtml(finding?.detail || finding?.dimension || "No detail recorded.")}</small>
      </div>
      <span class="runtime-state-label tone-${finding?.passed === false ? "danger" : "neutral"}">${escapeHtml(finding?.check_id || finding?.dimension || severity)}</span>
    </div>
  `;
}

function renderScorecard(scorecard) {
  if (!scorecard) {
    return '<p class="runtime-empty-state">Create a pipeline scorecard after the run is terminal and settled.</p>';
  }
  return `
    <section class="runtime-evaluation-block">
      <div class="runtime-secondary-heading">
        <strong>Pipeline Scorecard</strong>
        <span>${escapeHtml(`${scorecard.passed_checks ?? 0}/${scorecard.total_checks ?? 0} checks`)}</span>
      </div>
      <div class="runtime-verdict-grid">
        ${renderVerdict("Pipeline", scorecard.pipeline_verdict)}
        ${renderVerdict("Contract", scorecard.contract_verdict)}
        ${renderVerdict("Gate", scorecard.gate_verdict)}
        ${renderVerdict("Enforcement", scorecard.enforcement)}
      </div>
      <div class="runtime-evaluation-meta">
        <span>${escapeHtml(scorecard.profile || "pipeline-v1")}</span>
        <span>${escapeHtml(`${scorecard.hard_error_count ?? 0} errors`)}</span>
        <span>${escapeHtml(`${scorecard.warning_count ?? 0} warnings`)}</span>
        <span>${escapeHtml(`${scorecard.blind_spot_count ?? 0} blind spots`)}</span>
      </div>
      ${(scorecard.findings || []).length ? `<div class="runtime-findings-list">${scorecard.findings.map(renderFinding).join("")}</div>` : '<p class="runtime-empty-state">No scorecard findings.</p>'}
    </section>
  `;
}

function renderEvaluation(evaluation) {
  if (!evaluation) {
    return '<p class="runtime-empty-state">Run a deterministic or record-only evaluation to produce independent verdicts.</p>';
  }
  return `
    <section class="runtime-evaluation-block">
      <div class="runtime-secondary-heading">
        <strong>Independent Evaluation</strong>
        <span class="runtime-state-label tone-${toneForVerdict(evaluation.status)}">${escapeHtml(verdictLabel(evaluation.status))}</span>
      </div>
      <div class="runtime-verdict-grid">
        ${renderVerdict("Pipeline", evaluation.pipeline_verdict)}
        ${renderVerdict("Contract", evaluation.contract_verdict)}
        ${renderVerdict("Evidence", evaluation.evidence_verdict)}
        ${renderVerdict("Usage", evaluation.usage_verdict)}
        ${renderVerdict("Quality", evaluation.quality_verdict)}
        ${renderVerdict("Gate", evaluation.gate_verdict)}
      </div>
      <div class="runtime-evaluation-meta">
        <span>${escapeHtml(evaluation.evaluator?.id || evaluation.evaluator_id || "unknown evaluator")}</span>
        <span>${escapeHtml(evaluation.evaluator?.kind || "unknown kind")}</span>
        <span>${escapeHtml(`attempt ${evaluation.attempt || 1}`)}</span>
        ${evaluation.error ? `<span class="danger-text">${escapeHtml(evaluation.error)}</span>` : ""}
      </div>
      ${(evaluation.findings || []).length ? `<div class="runtime-findings-list">${evaluation.findings.map(renderFinding).join("")}</div>` : '<p class="runtime-empty-state">No evaluation findings.</p>'}
    </section>
  `;
}

function renderReplay(replay) {
  if (!replay) {
    return '<p class="runtime-empty-state">Replay verification has not been run in this Studio session.</p>';
  }
  return `
    <section class="runtime-evaluation-block">
      <div class="runtime-secondary-heading">
        <strong>Replay Verification</strong>
        <span class="runtime-state-label tone-${toneForVerdict(replay.verification)}">${escapeHtml(verdictLabel(replay.verification))}</span>
      </div>
      <div class="runtime-verdict-grid">
        ${renderVerdict("Events", replay.event_completeness)}
        ${renderVerdict("Projection", replay.verification)}
        <div class="runtime-verdict-item"><span>Processed</span><strong>${escapeHtml(replay.processed_events ?? 0)}</strong></div>
        <div class="runtime-verdict-item"><span>Differences</span><strong>${escapeHtml((replay.projection_differences || []).length)}</strong></div>
        <div class="runtime-verdict-item"><span>Missing refs</span><strong>${escapeHtml((replay.missing_references || []).length)}</strong></div>
      </div>
      ${(replay.projection_differences || []).length ? `<div class="runtime-findings-list">${replay.projection_differences.map((difference) => renderFinding({
        severity: difference.severity,
        passed: false,
        check_id: difference.category,
        summary: difference.summary,
        detail: `${difference.record_id} / ${difference.field}`,
      })).join("")}</div>` : '<p class="runtime-empty-state">Replay matched persisted projections.</p>'}
      ${(replay.missing_references || []).length ? `<div class="runtime-missing-ref-list">${replay.missing_references.map((reference) => `<span>${escapeHtml(reference)}</span>`).join("")}</div>` : ""}
    </section>
  `;
}

export function renderRuntimeEvaluationPanel(model, ui = {}) {
  const latestByCreatedAt = (items) => (items || []).reduce((latest, item) =>
    !latest || String(item?.created_at || "").localeCompare(String(latest?.created_at || "")) > 0
      ? item
      : latest, null);
  const scorecard = latestByCreatedAt(model.scorecards);
  const evaluation = latestByCreatedAt(model.evaluations);
  const terminal = ["completed", "failed", "cancelled"].includes(model.runStatus);
  return `
    <div class="runtime-evaluation-workbench">
      <div class="runtime-evaluation-actions">
        <div>
          <strong>Evaluation Loop</strong>
          <small>Score pipeline evidence, evaluate independent quality, then verify replay consistency.</small>
        </div>
        <div class="runtime-evaluation-buttons">
          <button class="secondary" type="button" data-action="create-runtime-scorecard" ${ui.scorecardLoading || !terminal ? "disabled" : ""}>${ui.scorecardLoading ? "Scoring..." : "Create scorecard"}</button>
          <button class="secondary" type="button" data-action="run-runtime-evaluation" data-evaluator="deterministic-v1" ${ui.evaluationLoading || !terminal ? "disabled" : ""}>${ui.evaluationLoading ? "Evaluating..." : "Deterministic eval"}</button>
          <button class="secondary" type="button" data-action="run-runtime-evaluation" data-evaluator="none" ${ui.evaluationLoading || !terminal ? "disabled" : ""}>Record-only eval</button>
          <button class="secondary" type="button" data-action="verify-runtime-replay" ${ui.replayLoading || !terminal ? "disabled" : ""}>${ui.replayLoading ? "Replaying..." : "Verify replay"}</button>
        </div>
      </div>
      ${!terminal ? '<p class="runtime-evaluation-gate">Evaluation actions unlock after the run reaches a terminal state.</p>' : ""}
      ${renderScorecard(scorecard)}
      ${renderEvaluation(evaluation)}
      ${renderReplay(model.replay)}
    </div>
  `;
}
