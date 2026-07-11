import { listApprovals } from "./approval-store.js";
import { listHumanInputs } from "./human-input-store.js";
import { listSessionDagPatches } from "./dag-patch-store.js";
import { listRunEvents } from "./event-store.js";
import { sumDecimalStrings } from "./evaluation/pricing/decimal.js";
import {
  loadObservabilityRunIndexes,
  type ObservabilityRunIndexRecord,
} from "./observability-run-index.js";
import { listRuns } from "./run-store.js";
import { listSessionMessages } from "./session-message-store.js";
import { listSessions } from "./session-store.js";
import { getObservabilityRetentionHours } from "./config.js";
import { getJsonStorageBackendKind } from "./storage-backend.js";
import type {
  ApprovalRecord,
  EventRecord,
  HumanInputRecord,
  RunRecord,
  RunStatus,
  SessionRecord,
  SessionStatus,
} from "./types.js";
import { nowIso } from "./utils.js";

interface DashboardStatusCount<TStatus extends string> {
  status: TStatus;
  count: number;
}

interface DashboardMetricDistribution {
  count: number;
  average_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

interface DashboardActivityBucket {
  bucket_start: string;
  runs_started: number;
  runs_completed: number;
  runs_failed: number;
  jobs_completed: number;
  jobs_failed: number;
  total_tokens: number;
}

interface DashboardReliabilityMetrics {
  runs_observed: number;
  terminal_runs: number;
  completed_runs: number;
  failed_runs: number;
  run_success_rate: number | null;
  jobs_observed: number;
  terminal_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  retry_attempts: number;
  job_success_rate: number | null;
  retry_rate: number | null;
}

interface DashboardUsageMetrics {
  model_jobs: number;
  usage_records: number;
  token_completeness: "complete" | "partial" | "unavailable";
  total_tokens: number | null;
  provider_reported_costs: Record<string, string>;
  estimated_costs: Record<string, string>;
}

interface DashboardComparisonMetric {
  current: number | null;
  previous: number | null;
  delta: number | null;
  change_rate: number | null;
  direction: "up" | "down" | "flat" | "unavailable";
  outcome: "improved" | "regressed" | "neutral" | "unavailable";
}

export type DashboardObservabilityStatusFilter =
  | "all"
  | "active"
  | "terminal"
  | "completed"
  | "failed"
  | "cancelled";

export interface DashboardObservabilityOptions {
  windowHours?: number | null;
  status?: DashboardObservabilityStatusFilter;
  correlationLimit?: number;
  compare?: "none" | "previous";
}

export interface DashboardSummaryResponse {
  generated_at: string;
  runtime_health: {
    storage_backend_kind: string;
    execution_adapter_kind: string;
    attention_tone: "neutral" | "warn" | "danger";
    summary_lines: string[];
  };
  workload: {
    sessions: {
      total: number;
      active: number;
      archived: number;
      by_status: Array<DashboardStatusCount<SessionStatus>>;
    };
    runs: {
      total: number;
      active: number;
      terminal: number;
      by_status: Array<DashboardStatusCount<RunStatus>>;
      stuck: number;
      recently_failed: number;
      completed_today: number;
    };
  };
  backlog: {
    pending_approvals: number;
    pending_human_inputs: number;
    pending_patch_confirmations: number;
    unsupported_patch_proposals: number;
    stale_sessions: number;
  };
  hotspots: {
    waiting_runs: Array<{
      run_id: string;
      session_id: string | null;
      status: RunStatus;
      summary: string;
      updated_at: string;
    }>;
    recently_failed_runs: Array<{
      run_id: string;
      session_id: string | null;
      summary: string;
      updated_at: string;
      latest_failure_event_type: string | null;
    }>;
    approval_backlog: Array<ApprovalRecord & { session_id: string | null }>;
    human_input_backlog: Array<HumanInputRecord & { session_id: string | null }>;
  };
  observability: {
    query: {
      window_hours: number | null;
      status: DashboardObservabilityStatusFilter;
      correlation_limit: number;
      index_schema_version: 1;
      indexed_runs: number;
      rebuilt_runs: number;
      compare: "none" | "previous";
    };
    retention: {
      enabled: boolean;
      applied: boolean;
      retention_hours: number | null;
      cutoff_at: string | null;
      retained_runs: number;
      excluded_runs: number;
      pruned_indexes: number;
      pruned_dirty_markers: number;
      canonical_data_retained: true;
    };
    window: {
      started_at: string;
      ended_at: string;
      bucket_minutes: number;
      bucket_count: number;
    };
    reliability: DashboardReliabilityMetrics;
    latency: {
      run_duration: DashboardMetricDistribution;
      job_duration: DashboardMetricDistribution;
    };
    usage: DashboardUsageMetrics;
    activity: DashboardActivityBucket[];
    comparison: {
      mode: "previous_period";
      coverage: "complete" | "partial";
      previous_window: {
        started_at: string;
        ended_at: string;
      };
      metrics: {
        runs_observed: DashboardComparisonMetric;
        run_success_rate: DashboardComparisonMetric;
        job_success_rate: DashboardComparisonMetric;
        retry_rate: DashboardComparisonMetric;
        run_p95_ms: DashboardComparisonMetric;
        job_p95_ms: DashboardComparisonMetric;
        total_tokens: DashboardComparisonMetric;
      };
    } | null;
    correlations: Array<{
      run_id: string;
      session_id: string | null;
      status: RunStatus;
      intent: string;
      updated_at: string;
      duration_ms: number | null;
      trace_id: string;
      event_count: number;
      last_sequence: number | null;
      last_event_type: string | null;
      job_count: number;
      retry_count: number;
      evidence_count: number;
      native_evidence_count: number;
      scorecard_id: string | null;
      pipeline_verdict: string | null;
      evaluation_id: string | null;
      evaluation_status: string | null;
      quality_verdict: string | null;
      gate_verdict: string | null;
      finding_count: number;
      total_tokens: number | null;
      provider_reported_costs: Record<string, string>;
      estimated_costs: Record<string, string>;
    }>;
  };
}

function countByStatus<TStatus extends string>(
  statuses: readonly TStatus[],
  items: Array<{ status: TStatus }>,
): Array<DashboardStatusCount<TStatus>> {
  return statuses.map((status) => ({
    status,
    count: items.filter((item) => item.status === status).length,
  }));
}

function isActiveSession(session: SessionRecord): boolean {
  return !session.archived && !session.hidden;
}

function isRunStuck(run: RunRecord): boolean {
  return run.status === "waiting_human" || run.status === "paused" || run.status === "blocked";
}

function isToday(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return value.slice(0, 10) === nowIso().slice(0, 10);
}

function latestFailureEvent(events: EventRecord[]): EventRecord | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const current = events[index];
    if (current?.type === "run.failed" || current?.type === "node.failed") {
      return current;
    }
  }
  return null;
}

function sortByUpdatedAtDesc<T extends { updated_at: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function latestFailureEventType(runId: string): string | null {
  const events = listRunEvents(runId);
  return latestFailureEvent(events)?.type || null;
}

function collectPatchBacklog(sessions: SessionRecord[]): {
  pendingPatchConfirmations: number;
  unsupportedPatchProposals: number;
} {
  let pendingPatchConfirmations = 0;
  let unsupportedPatchProposals = 0;

  for (const session of sessions) {
    const patches = listSessionDagPatches(session.session_id);
    pendingPatchConfirmations += patches.filter((item) => item.status === "needs_confirmation").length;
    unsupportedPatchProposals += patches.filter((item) => item.status === "unsupported").length;
  }

  return {
    pendingPatchConfirmations,
    unsupportedPatchProposals,
  };
}

function isSessionStale(session: SessionRecord): boolean {
  const workspaceState =
    session.metadata &&
    typeof session.metadata.workspace_state === "object" &&
    session.metadata.workspace_state !== null &&
    !Array.isArray(session.metadata.workspace_state)
      ? (session.metadata.workspace_state as Record<string, unknown>)
      : null;

  return workspaceState?.stale === true;
}

function buildRunSessionMap(sessions: SessionRecord[]): Map<string, string> {
  const runSessionMap = new Map<string, string>();

  for (const session of sessions) {
    if (session.latest_run_id && !runSessionMap.has(session.latest_run_id)) {
      runSessionMap.set(session.latest_run_id, session.session_id);
    }
    for (const runId of session.active_run_ids) {
      if (runId && !runSessionMap.has(runId)) {
        runSessionMap.set(runId, session.session_id);
      }
    }
  }

  for (const session of sessions) {
    for (const message of listSessionMessages(session.session_id)) {
      if (message.linked_run_id && !runSessionMap.has(message.linked_run_id)) {
        runSessionMap.set(message.linked_run_id, session.session_id);
      }
    }
  }

  return runSessionMap;
}

function percentile(sorted: number[], ratio: number): number | null {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? null;
}

function metricDistribution(values: Array<number | null>): DashboardMetricDistribution {
  const available = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  return {
    count: available.length,
    average_ms: available.length
      ? Math.round(available.reduce((total, value) => total + value, 0) / available.length)
      : null,
    p50_ms: percentile(available, 0.5),
    p95_ms: percentile(available, 0.95),
    max_ms: available.at(-1) ?? null,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null;
}

function addMoney(
  target: Map<string, string[]>,
  value: { currency: string; amount_decimal: string } | null | undefined,
): void {
  if (!value) return;
  target.set(value.currency, [...(target.get(value.currency) || []), value.amount_decimal]);
}

function moneyTotals(values: Map<string, string[]>): Record<string, string> {
  return Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amounts]) => [currency, sumDecimalStrings(amounts)]),
  );
}

function buildObservabilityMetricSnapshot(records: ObservabilityRunIndexRecord[]): {
  reliability: DashboardReliabilityMetrics;
  latency: {
    run_duration: DashboardMetricDistribution;
    job_duration: DashboardMetricDistribution;
  };
  usage: DashboardUsageMetrics;
} {
  const allJobs = records.flatMap((record) => record.jobs);
  const terminalRuns = records.filter((record) =>
    ["completed", "failed", "cancelled"].includes(record.status),
  );
  const terminalJobs = allJobs.filter((job) =>
    ["completed", "failed", "cancelled", "rejected"].includes(job.status),
  );
  const completedRuns = terminalRuns.filter((record) => record.status === "completed").length;
  const completedJobs = terminalJobs.filter((job) => job.status === "completed").length;
  const failedJobs = terminalJobs.filter(
    (job) => job.status === "failed" || job.status === "rejected",
  ).length;
  const retryAttempts = allJobs.filter((job) => job.attempt > 1).length;
  const modelJobs = allJobs.filter((job) => job.model_job);
  const usageRecords = records.flatMap((record) => record.usage).filter((item) => item.model_job);
  const tokenRecords = usageRecords.filter((item) => item.total_tokens !== null);
  const providerCosts = new Map<string, string[]>();
  const estimatedCosts = new Map<string, string[]>();
  for (const item of usageRecords) {
    addMoney(providerCosts, item.provider_reported_cost);
    addMoney(estimatedCosts, item.estimated_cost);
  }

  return {
    reliability: {
      runs_observed: records.length,
      terminal_runs: terminalRuns.length,
      completed_runs: completedRuns,
      failed_runs: terminalRuns.filter((record) => record.status === "failed").length,
      run_success_rate: ratio(completedRuns, terminalRuns.length),
      jobs_observed: allJobs.length,
      terminal_jobs: terminalJobs.length,
      completed_jobs: completedJobs,
      failed_jobs: failedJobs,
      retry_attempts: retryAttempts,
      job_success_rate: ratio(completedJobs, terminalJobs.length),
      retry_rate: ratio(retryAttempts, allJobs.length),
    },
    latency: {
      run_duration: metricDistribution(terminalRuns.map((record) => record.duration_ms)),
      job_duration: metricDistribution(terminalJobs.map((job) => job.duration_ms)),
    },
    usage: {
      model_jobs: modelJobs.length,
      usage_records: usageRecords.length,
      token_completeness: modelJobs.length === 0 || tokenRecords.length === 0
        ? "unavailable"
        : tokenRecords.length === modelJobs.length
          ? "complete"
          : "partial",
      total_tokens: tokenRecords.length
        ? tokenRecords.reduce((total, item) => total + (item.total_tokens || 0), 0)
        : null,
      provider_reported_costs: moneyTotals(providerCosts),
      estimated_costs: moneyTotals(estimatedCosts),
    },
  };
}

function roundComparisonValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function buildComparisonMetric(
  current: number | null,
  previous: number | null,
  preference: "higher" | "lower" | "neutral",
): DashboardComparisonMetric {
  if (current === null || previous === null) {
    return {
      current,
      previous,
      delta: null,
      change_rate: null,
      direction: "unavailable",
      outcome: "unavailable",
    };
  }
  const delta = roundComparisonValue(current - previous);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const outcome = direction === "flat" || preference === "neutral"
    ? "neutral"
    : (preference === "higher" && direction === "up") ||
        (preference === "lower" && direction === "down")
      ? "improved"
      : "regressed";
  return {
    current,
    previous,
    delta,
    change_rate: previous === 0 ? null : roundComparisonValue(delta / Math.abs(previous)),
    direction,
    outcome,
  };
}

function runRetentionTimestamp(run: RunRecord): number {
  const parsed = Date.parse(run.finished_at || run.updated_at || run.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isActiveRunStatus(status: RunStatus): boolean {
  return ["queued", "running", "waiting_human", "paused", "blocked"].includes(status);
}

function matchesObservabilityStatus(
  record: ObservabilityRunIndexRecord,
  status: DashboardObservabilityStatusFilter,
): boolean {
  if (status === "all") return true;
  if (status === "active") {
    return ["queued", "running", "waiting_human", "paused", "blocked"].includes(record.status);
  }
  if (status === "terminal") {
    return ["completed", "failed", "cancelled"].includes(record.status);
  }
  return record.status === status;
}

function overlapsObservabilityWindow(
  record: ObservabilityRunIndexRecord,
  startedAtMs: number,
  endedAtMs: number,
): boolean {
  const runStarted = Date.parse(record.started_at || record.created_at);
  const runEnded = Date.parse(record.finished_at || record.updated_at);
  return Number.isFinite(runStarted) && Number.isFinite(runEnded) && runStarted < endedAtMs && runEnded >= startedAtMs;
}

function buildDashboardObservability(input: {
  generatedAt: string;
  runs: RunRecord[];
  runSessionMap: Map<string, string>;
  options?: DashboardObservabilityOptions;
}): DashboardSummaryResponse["observability"] {
  const status = input.options?.status || "all";
  const windowHours = input.options?.windowHours ?? null;
  const correlationLimit = Math.min(100, Math.max(1, input.options?.correlationLimit || 20));
  const compare = input.options?.compare || "none";
  const displayWindowHours = windowHours || 24;
  const bucketMinutes = displayWindowHours <= 24 ? 60 : displayWindowHours <= 168 ? 360 : 1440;
  const bucketMs = bucketMinutes * 60 * 1000;
  const generatedMs = Date.parse(input.generatedAt);
  const endBucketMs = Math.floor(generatedMs / bucketMs) * bucketMs;
  const endedAtMs = endBucketMs + bucketMs;
  const startedAtMs = endedAtMs - displayWindowHours * 60 * 60 * 1000;
  const bucketCount = Math.ceil((endedAtMs - startedAtMs) / bucketMs);
  const retentionHours = getObservabilityRetentionHours();
  const retentionApplied = windowHours !== null && retentionHours !== null;
  const retentionCutoffMs = retentionApplied
    ? generatedMs - retentionHours * 60 * 60 * 1000
    : null;
  const retainedRuns = retentionCutoffMs === null
    ? input.runs
    : input.runs.filter(
        (run) => isActiveRunStatus(run.status) || runRetentionTimestamp(run) >= retentionCutoffMs,
      );
  const retainedRunIds = new Set(retainedRuns.map((run) => run.run_id));
  const excludedRuns = input.runs.filter((run) => !retainedRunIds.has(run.run_id));
  const indexLoad = loadObservabilityRunIndexes(retainedRuns, {
    pruneRunIds: new Set(excludedRuns.map((run) => run.run_id)),
  });
  const records = indexLoad.records.filter(
    (record) =>
      matchesObservabilityStatus(record, status) &&
      (windowHours === null || overlapsObservabilityWindow(record, startedAtMs, endedAtMs)),
  );
  const currentMetrics = buildObservabilityMetricSnapshot(records);
  const previousStartedAtMs = startedAtMs - displayWindowHours * 60 * 60 * 1000;
  const previousRecords = compare === "previous" && windowHours !== null
    ? indexLoad.records.filter(
        (record) =>
          matchesObservabilityStatus(record, status) &&
          overlapsObservabilityWindow(record, previousStartedAtMs, startedAtMs),
      )
    : [];
  const previousMetrics = compare === "previous" && windowHours !== null
    ? buildObservabilityMetricSnapshot(previousRecords)
    : null;

  const activity: DashboardActivityBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    bucket_start: new Date(startedAtMs + index * bucketMs).toISOString(),
    runs_started: 0,
    runs_completed: 0,
    runs_failed: 0,
    jobs_completed: 0,
    jobs_failed: 0,
    total_tokens: 0,
  }));
  const bucketFor = (value: string | null | undefined): DashboardActivityBucket | null => {
    const parsed = Date.parse(value || "");
    if (!Number.isFinite(parsed)) return null;
    const index = Math.floor((parsed - startedAtMs) / bucketMs);
    return index >= 0 && index < activity.length ? activity[index] || null : null;
  };
  for (const record of records) {
    const startedBucket = bucketFor(record.started_at || record.created_at);
    if (startedBucket) startedBucket.runs_started += 1;
    const finishedBucket = bucketFor(record.finished_at);
    if (finishedBucket && record.status === "completed") finishedBucket.runs_completed += 1;
    if (finishedBucket && record.status === "failed") finishedBucket.runs_failed += 1;
    for (const job of record.jobs) {
      const jobBucket = bucketFor(job.finished_at);
      if (jobBucket && job.status === "completed") jobBucket.jobs_completed += 1;
      if (jobBucket && (job.status === "failed" || job.status === "rejected")) jobBucket.jobs_failed += 1;
    }
    for (const usage of record.usage) {
      const usageBucket = bucketFor(usage.created_at);
      if (usageBucket && usage.total_tokens !== null) usageBucket.total_tokens += usage.total_tokens;
    }
  }

  const correlations = [...records]
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, correlationLimit)
    .map((record) => ({
      run_id: record.run_id,
      session_id: input.runSessionMap.get(record.run_id) || null,
      status: record.status,
      intent: record.intent,
      updated_at: record.updated_at,
      duration_ms: record.duration_ms,
      trace_id: record.trace_id,
      event_count: record.event_count,
      last_sequence: record.last_sequence,
      last_event_type: record.last_event_type,
      job_count: record.jobs.length,
      retry_count: record.jobs.filter((job) => job.attempt > 1).length,
      evidence_count: record.evidence_count,
      native_evidence_count: record.native_evidence_count,
      scorecard_id: record.scorecard_id,
      pipeline_verdict: record.pipeline_verdict,
      evaluation_id: record.evaluation_id,
      evaluation_status: record.evaluation_status,
      quality_verdict: record.quality_verdict,
      gate_verdict: record.gate_verdict,
      finding_count: record.finding_count,
      total_tokens: record.total_tokens,
      provider_reported_costs: record.provider_reported_costs,
      estimated_costs: record.estimated_costs,
    }));

  return {
    query: {
      window_hours: windowHours,
      status,
      correlation_limit: correlationLimit,
      index_schema_version: 1,
      indexed_runs: indexLoad.records.length,
      rebuilt_runs: indexLoad.rebuilt_records,
      compare,
    },
    retention: {
      enabled: retentionHours !== null,
      applied: retentionApplied,
      retention_hours: retentionHours,
      cutoff_at: retentionCutoffMs === null ? null : new Date(retentionCutoffMs).toISOString(),
      retained_runs: retainedRuns.length,
      excluded_runs: excludedRuns.length,
      pruned_indexes: indexLoad.pruned_indexes,
      pruned_dirty_markers: indexLoad.pruned_dirty_markers,
      canonical_data_retained: true,
    },
    window: {
      started_at: new Date(startedAtMs).toISOString(),
      ended_at: new Date(endedAtMs).toISOString(),
      bucket_minutes: bucketMinutes,
      bucket_count: bucketCount,
    },
    reliability: currentMetrics.reliability,
    latency: currentMetrics.latency,
    usage: currentMetrics.usage,
    activity,
    comparison: previousMetrics
      ? {
          mode: "previous_period",
          coverage:
            retentionCutoffMs !== null && retentionCutoffMs > previousStartedAtMs
              ? "partial"
              : "complete",
          previous_window: {
            started_at: new Date(previousStartedAtMs).toISOString(),
            ended_at: new Date(startedAtMs).toISOString(),
          },
          metrics: {
            runs_observed: buildComparisonMetric(
              currentMetrics.reliability.runs_observed,
              previousMetrics.reliability.runs_observed,
              "neutral",
            ),
            run_success_rate: buildComparisonMetric(
              currentMetrics.reliability.run_success_rate,
              previousMetrics.reliability.run_success_rate,
              "higher",
            ),
            job_success_rate: buildComparisonMetric(
              currentMetrics.reliability.job_success_rate,
              previousMetrics.reliability.job_success_rate,
              "higher",
            ),
            retry_rate: buildComparisonMetric(
              currentMetrics.reliability.retry_rate,
              previousMetrics.reliability.retry_rate,
              "lower",
            ),
            run_p95_ms: buildComparisonMetric(
              currentMetrics.latency.run_duration.p95_ms,
              previousMetrics.latency.run_duration.p95_ms,
              "lower",
            ),
            job_p95_ms: buildComparisonMetric(
              currentMetrics.latency.job_duration.p95_ms,
              previousMetrics.latency.job_duration.p95_ms,
              "lower",
            ),
            total_tokens: buildComparisonMetric(
              currentMetrics.usage.total_tokens,
              previousMetrics.usage.total_tokens,
              "neutral",
            ),
          },
        }
      : null,
    correlations,
  };
}

export function buildDashboardSummary(input: {
  executionAdapterKind: string;
  observability?: DashboardObservabilityOptions;
}): DashboardSummaryResponse {
  const sessions = listSessions();
  const runs = listRuns();
  const pendingApprovals = listApprovals("pending");
  const pendingHumanInputs = listHumanInputs("pending");
  const patchBacklog = collectPatchBacklog(sessions);
  const runSessionMap = buildRunSessionMap(sessions);
  const generatedAt = nowIso();

  const recentlyFailedRuns = sortByUpdatedAtDesc(
    runs.filter((run) => run.status === "failed"),
  )
    .slice(0, 5)
    .map((run) => {
      return {
        run_id: run.run_id,
        session_id: runSessionMap.get(run.run_id) || null,
        summary: run.current_summary,
        updated_at: run.updated_at,
        latest_failure_event_type: latestFailureEventType(run.run_id),
      };
    });

  const waitingRuns = sortByUpdatedAtDesc(
    runs.filter((run) => run.status === "waiting_human" || run.status === "blocked" || run.status === "paused"),
  )
    .slice(0, 5)
    .map((run) => ({
      run_id: run.run_id,
      session_id: runSessionMap.get(run.run_id) || null,
      status: run.status,
      summary: run.waiting_reason || run.blocked_reason || run.current_summary,
      updated_at: run.updated_at,
    }));

  const activeRuns = runs.filter(
    (run) =>
      run.status === "queued" ||
      run.status === "running" ||
      run.status === "waiting_human" ||
      run.status === "paused" ||
      run.status === "blocked",
  );

  const runtimeSummaryLines: string[] = [
    `${activeRuns.length} active run(s)`,
    `${pendingApprovals.length} pending approval(s)`,
    `${pendingHumanInputs.length} pending human input request(s)`,
  ];

  if (patchBacklog.pendingPatchConfirmations > 0) {
    runtimeSummaryLines.push(
      `${patchBacklog.pendingPatchConfirmations} patch confirmation(s) waiting`,
    );
  }
  if (recentlyFailedRuns.length > 0) {
    runtimeSummaryLines.push(`${recentlyFailedRuns.length} recent failed run(s) need review`);
  }

  const attentionTone =
    recentlyFailedRuns.length > 0
      ? "danger"
      : pendingApprovals.length > 0 ||
          pendingHumanInputs.length > 0 ||
          patchBacklog.pendingPatchConfirmations > 0
        ? "warn"
        : "neutral";

  return {
    generated_at: generatedAt,
    runtime_health: {
      storage_backend_kind: getJsonStorageBackendKind(),
      execution_adapter_kind: input.executionAdapterKind,
      attention_tone: attentionTone,
      summary_lines: runtimeSummaryLines,
    },
    workload: {
      sessions: {
        total: sessions.length,
        active: sessions.filter((item) => isActiveSession(item)).length,
        archived: sessions.filter((item) => item.archived).length,
        by_status: countByStatus(
          ["draft", "planning", "ready_to_run", "running", "waiting_human", "completed", "failed", "cancelled"],
          sessions,
        ),
      },
      runs: {
        total: runs.length,
        active: activeRuns.length,
        terminal: runs.filter((run) => ["completed", "failed", "cancelled"].includes(run.status)).length,
        by_status: countByStatus(
          ["draft", "queued", "running", "waiting_human", "paused", "blocked", "completed", "failed", "cancelled"],
          runs,
        ),
        stuck: runs.filter((run) => isRunStuck(run)).length,
        recently_failed: recentlyFailedRuns.length,
        completed_today: runs.filter((run) => run.status === "completed" && isToday(run.finished_at)).length,
      },
    },
    backlog: {
      pending_approvals: pendingApprovals.length,
      pending_human_inputs: pendingHumanInputs.length,
      pending_patch_confirmations: patchBacklog.pendingPatchConfirmations,
      unsupported_patch_proposals: patchBacklog.unsupportedPatchProposals,
      stale_sessions: sessions.filter((session) => isSessionStale(session)).length,
    },
    hotspots: {
      waiting_runs: waitingRuns,
      recently_failed_runs: recentlyFailedRuns,
      approval_backlog: pendingApprovals.slice(0, 5).map((approval) => ({
        ...approval,
        session_id: runSessionMap.get(approval.run_id) || null,
      })),
      human_input_backlog: pendingHumanInputs.slice(0, 5).map((inputRecord) => ({
        ...inputRecord,
        session_id: runSessionMap.get(inputRecord.run_id) || null,
      })),
    },
    observability: buildDashboardObservability({
      generatedAt,
      runs,
      runSessionMap,
      options: input.observability,
    }),
  };
}
