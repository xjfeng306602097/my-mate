import { createHash } from "node:crypto";
import { listApprovals } from "./approval-store.js";
import { getAutopilotController } from "./autopilot-store.js";
import { listEvaluations } from "./evaluation/evaluation-store.js";
import { listScorecards } from "./evaluation/scorecard-store.js";
import { listHumanInputs } from "./human-input-store.js";
import {
  isRecommendationNewerThanSnapshot,
  listSessionMemoryRecommendations,
} from "./memory-recommendation.js";
import { getCoreMemorySnapshot } from "./memory-snapshot-store.js";
import { getProviderConnection } from "./provider-connection-store.js";
import { getPublishedAgentVersion } from "./agent-runtime-store.js";
import { getActiveWorkspaceId, runWithSystemWorkspaceContext } from "./request-security.js";
import { getRun } from "./run-store.js";
import { listSessions } from "./session-store.js";
import {
  findOpenSupervisionAlert,
  listSupervisionAlerts,
  saveSupervisionAlert,
} from "./supervision-store.js";
import type {
  SessionRecord,
  SupervisionAlertCategory,
  SupervisionAlertRecord,
  SupervisionAlertSeverity,
} from "./types.js";
import { nowIso } from "./utils.js";

type Candidate = {
  workspaceId: string;
  sessionId: string;
  runId: string | null;
  category: SupervisionAlertCategory;
  severity: SupervisionAlertSeverity;
  title: string;
  detail: string;
  action: string;
  actionLabel: string;
  key: string;
  metadata?: Record<string, unknown>;
};

function alertId(fingerprint: string): string {
  return `alert_${createHash("sha256").update(fingerprint).digest("hex").slice(0, 20)}`;
}

function candidateFingerprint(candidate: Candidate): string {
  return [candidate.workspaceId, candidate.sessionId, candidate.runId || "none", candidate.category, candidate.key].join(":");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function providerReady(session: SessionRecord): boolean {
  const workspaceId = session.workspace_id || getActiveWorkspaceId() || "default";
  const metadata = record(session.metadata);
  const snapshot = record(metadata.agent_binding_snapshot);
  const agentId = nonEmptyString(metadata.agent_id) || nonEmptyString(snapshot.agent_id) || "default-agent";
  const agent = getPublishedAgentVersion(agentId, workspaceId);
  const connectionId =
    nonEmptyString(metadata.conversation_provider_connection_id) ||
    nonEmptyString(snapshot.provider_connection_id) ||
    agent?.model_policy.provider_connection_id ||
    null;
  if (!connectionId) return false;
  const connection = getProviderConnection(connectionId);
  if (connection?.status !== "active" || connection.verification?.status !== "verified") return false;
  const model =
    nonEmptyString(metadata.conversation_model) ||
    nonEmptyString(snapshot.model) ||
    agent?.model_policy.model ||
    connection.default_model ||
    connection.models[0] ||
    null;
  return !!model && (connection.models.length === 0 || connection.models.includes(model));
}

const STALE_DRAFT_AFTER_MS = 24 * 60 * 60 * 1000;

function hasExplicitExecutionIntent(session: SessionRecord): boolean {
  const metadata = record(session.metadata);
  const workspaceState = record(metadata.workspace_state);
  const intent = nonEmptyString(metadata.latest_orchestrator_intent) || "";
  const nextAction = nonEmptyString(workspaceState.next_recommended_action) || "";
  return Boolean(
    /(?:^|_)(?:run|execute|resume|workspace_change|artifact_worker|agent_dag|schedule|long_task)(?:_|$)/i.test(intent) ||
    /^(?:start|run|execute|resume|approve|confirm)(?:_|$)/i.test(nextAction) ||
    metadata.autonomy_mode === "autopilot" ||
    metadata.product_autonomy_mode === "autopilot",
  );
}

function shouldSuperviseProviderConfiguration(
  session: SessionRecord,
  run: ReturnType<typeof getRun>,
  autopilot: ReturnType<typeof getAutopilotController>,
  timestamp: string,
): boolean {
  if (session.archived || session.hidden) return false;
  if (["completed", "failed", "cancelled"].includes(session.status)) return false;
  if (run || autopilot && ["running", "blocked", "failed"].includes(autopilot.status)) return true;
  if (["planning", "ready_to_run", "running", "waiting_human"].includes(session.status)) return true;
  if (hasExplicitExecutionIntent(session)) return true;
  if (session.status !== "draft") return false;
  const updatedAt = Date.parse(session.updated_at || session.created_at || "");
  const observedAt = Date.parse(timestamp);
  if (!Number.isFinite(updatedAt) || !Number.isFinite(observedAt)) return true;
  // A future-dated record is treated as recently created. This also keeps deterministic test clocks stable.
  if (updatedAt >= observedAt) return true;
  return observedAt - updatedAt <= STALE_DRAFT_AFTER_MS;
}

function qualityGap(runId: string): { gap: boolean; detail: string } {
  const scorecard = listScorecards(runId)[0] || null;
  const evaluation = listEvaluations(runId)[0] || null;
  if (!scorecard || !evaluation) {
    return { gap: true, detail: "Completed work is missing a pipeline scorecard or independent evaluation." };
  }
  const values = [
    scorecard.pipeline_verdict,
    scorecard.contract_verdict,
    evaluation.quality_verdict,
    evaluation.evidence_verdict,
  ];
  const failed = values.some((value) => ["fail", "failed", "reject", "error", "incomplete"].includes(String(value || "").toLowerCase()));
  return failed
    ? { gap: true, detail: "Completed work has a failed or incomplete quality, evidence, pipeline, or contract verdict." }
    : { gap: false, detail: "" };
}

function candidatesForSession(session: SessionRecord, timestamp: string, stalledAfterMs: number): Candidate[] {
  const candidates: Candidate[] = [];
  const run = session.latest_run_id ? getRun(session.latest_run_id) : null;
  const autopilot = getAutopilotController(session.session_id);
  const approvals = run ? listApprovals("pending").filter((item) => item.run_id === run.run_id) : [];
  const humanInputs = run ? listHumanInputs("pending").filter((item) => item.run_id === run.run_id) : [];
  const decisions = approvals.length + humanInputs.length;

  if (shouldSuperviseProviderConfiguration(session, run, autopilot, timestamp) && !providerReady(session)) {
    candidates.push({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      runId: null,
      category: "configuration",
      severity: "warning",
      title: "Verify a model before this task can continue",
      detail: "The task is preserved, but its selected Agent does not have a verified Provider Connection and model.",
      action: "open-task-settings",
      actionLabel: "Verify model",
      key: "provider-not-verified",
    });
  }
  if (decisions) {
    candidates.push({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      runId: run?.run_id || null,
      category: "human_decision",
      severity: "warning",
      title: `${decisions} decision${decisions === 1 ? "" : "s"} need attention`,
      detail: "Execution is waiting for approval or required human input.",
      action: "open-task-inbox",
      actionLabel: "Review decision",
      key: "human-gates",
      metadata: { approval_count: approvals.length, human_input_count: humanInputs.length },
    });
  }
  if (run && ["failed", "cancelled"].includes(run.status)) {
    candidates.push({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      runId: run.run_id,
      category: "runtime_failure",
      severity: "critical",
      title: "The task stopped before completion",
      detail: run.blocked_reason || run.waiting_reason || run.current_summary || "Runtime failure evidence is available.",
      action: "scan-task-recovery",
      actionLabel: "Check recovery",
      key: `runtime-${run.status}`,
    });
  }
  if (run && ["queued", "running"].includes(run.status)) {
    const age = Date.parse(timestamp) - Date.parse(run.updated_at);
    if (Number.isFinite(age) && age >= stalledAfterMs) {
      candidates.push({
        workspaceId: session.workspace_id || "default",
        sessionId: session.session_id,
        runId: run.run_id,
        category: "runtime_stalled",
        severity: "warning",
        title: "Execution may be stalled",
        detail: `No Run update has been recorded for ${Math.max(1, Math.floor(age / 60000))} minutes.`,
        action: "view-task-progress",
        actionLabel: "Review progress",
        key: "runtime-stalled",
        metadata: { stale_for_ms: age },
      });
    }
  }
  if (run?.status === "completed") {
    const quality = qualityGap(run.run_id);
    if (quality.gap) {
      candidates.push({
        workspaceId: session.workspace_id || "default",
        sessionId: session.session_id,
        runId: run.run_id,
        category: "quality_gap",
        severity: "warning",
        title: "Result quality needs verification",
        detail: quality.detail,
        action: "check-task-quality",
        actionLabel: "Check quality",
        key: "quality-gap",
      });
    }
  }
  const configurationAlreadyExplainsHandoff =
    candidates.some((candidate) => candidate.category === "configuration") &&
    /provider|connection|model|configuration/i.test(autopilot?.handoff_reason || autopilot?.last_detail || "");
  if (autopilot && ["blocked", "failed"].includes(autopilot.status) && !configurationAlreadyExplainsHandoff) {
    candidates.push({
      workspaceId: session.workspace_id || "default",
      sessionId: session.session_id,
      runId: run?.run_id || null,
      category: "autopilot",
      severity: autopilot.status === "failed" ? "critical" : "warning",
      title: "Autopilot handed control back",
      detail: autopilot.handoff_reason || autopilot.last_detail || "Autopilot reached a policy or execution boundary.",
      action: "review-task-conversation",
      actionLabel: "Review handoff",
      key: `autopilot-${autopilot.status}`,
    });
  }
  const snapshot = getCoreMemorySnapshot(session.session_id, session.workspace_id || "default");
  if (snapshot) {
    const recommendation = listSessionMemoryRecommendations(session, { limit: 5, now: timestamp })
      .find((item) => isRecommendationNewerThanSnapshot(item, snapshot.created_at));
    if (recommendation) {
      const privateMemory = recommendation.sensitivity === "private";
      candidates.push({
        workspaceId: session.workspace_id || "default",
        sessionId: session.session_id,
        runId: run?.run_id || null,
        category: "memory_recommendation",
        severity: "info",
        title: "A newer memory may help this task",
        detail: privateMemory
          ? "A relevant Private Memory changed after this Task's frozen snapshot. Review it before applying the newer context."
          : `${recommendation.summary} This memory changed after the Task's frozen snapshot.`,
        action: "review-memory-recommendation",
        actionLabel: "Review memory",
        key: `${recommendation.memory_id}-v${recommendation.memory_version}`,
        metadata: {
          memory_id: recommendation.memory_id,
          memory_version: recommendation.memory_version,
          scope_kind: recommendation.scope_kind,
          sensitivity: recommendation.sensitivity,
          score: recommendation.score,
        },
      });
    }
  }
  return candidates;
}

export function runProactiveSupervisionScan(input: {
  now?: string;
  stalledAfterMs?: number;
} = {}): { scanned_sessions: number; open_alerts: SupervisionAlertRecord[]; resolved_alerts: string[] } {
  const timestamp = input.now || nowIso();
  const stalledAfterMs = Math.max(60_000, input.stalledAfterMs || 5 * 60_000);
  const sessions = listSessions();
  const activeWorkspaceId = getActiveWorkspaceId();
  const candidates = sessions.flatMap((session) => activeWorkspaceId
    ? candidatesForSession(session, timestamp, stalledAfterMs)
    : runWithSystemWorkspaceContext(
      session.workspace_id || "default",
      () => candidatesForSession(session, timestamp, stalledAfterMs),
    ));
  const seen = new Set<string>();
  const openAlerts = candidates.map((candidate) => {
    const fingerprint = candidateFingerprint(candidate);
    seen.add(fingerprint);
    const existing = findOpenSupervisionAlert(fingerprint);
    return saveSupervisionAlert({
      alert_id: existing?.alert_id || alertId(fingerprint),
      workspace_id: candidate.workspaceId,
      session_id: candidate.sessionId,
      run_id: candidate.runId,
      category: candidate.category,
      severity: candidate.severity,
      status: "open",
      fingerprint,
      title: candidate.title,
      detail: candidate.detail,
      recommended_action: candidate.action,
      recommended_action_label: candidate.actionLabel,
      first_seen_at: existing?.first_seen_at || timestamp,
      last_seen_at: timestamp,
      resolved_at: null,
      occurrence_count: (existing?.occurrence_count || 0) + 1,
      metadata: { ...(existing?.metadata || {}), ...(candidate.metadata || {}) },
    });
  });

  const resolvedAlerts: string[] = [];
  for (const alert of listSupervisionAlerts({ status: "open" })) {
    if (seen.has(alert.fingerprint)) continue;
    saveSupervisionAlert({ ...alert, status: "resolved", resolved_at: timestamp, last_seen_at: timestamp });
    resolvedAlerts.push(alert.alert_id);
  }
  return { scanned_sessions: sessions.length, open_alerts: openAlerts, resolved_alerts: resolvedAlerts };
}
