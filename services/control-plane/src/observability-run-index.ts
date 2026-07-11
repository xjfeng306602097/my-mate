import path from "node:path";
import { OBSERVABILITY_RUN_INDEX_DIR } from "./config.js";
import { listRunEvents } from "./event-store.js";
import { listEvaluations } from "./evaluation/evaluation-store.js";
import { sumDecimalStrings } from "./evaluation/pricing/decimal.js";
import { listScorecards } from "./evaluation/scorecard-store.js";
import {
  clearObservabilityRunDirty,
  listDirtyObservabilityRunIds,
} from "./observability-index-dirty.js";
import { listRuntimeJobRecords } from "./runtime/runtime-job-store.js";
import { listWorkerEvidence } from "./runtime/worker-evidence-store.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { RunRecord, RunStatus } from "./types.js";
import { nowIso } from "./utils.js";

interface MoneyValue {
  currency: string;
  amount_decimal: string;
}

export interface ObservabilityJobPoint {
  job_id: string;
  status: string;
  attempt: number;
  model_job: boolean;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface ObservabilityUsagePoint {
  job_id: string;
  model_job: boolean;
  created_at: string;
  total_tokens: number | null;
  provider_reported_cost: MoneyValue | null;
  estimated_cost: MoneyValue | null;
}

export interface ObservabilityRunIndexRecord {
  schema_version: 1;
  run_id: string;
  indexed_at: string;
  run_updated_at: string;
  status: RunStatus;
  intent: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  jobs: ObservabilityJobPoint[];
  usage: ObservabilityUsagePoint[];
  evidence_count: number;
  native_evidence_count: number;
  trace_id: string;
  event_count: number;
  last_sequence: number | null;
  last_event_type: string | null;
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
}

export interface ObservabilityIndexLoadResult {
  records: ObservabilityRunIndexRecord[];
  rebuilt_records: number;
  pruned_indexes: number;
  pruned_dirty_markers: number;
}

export interface ObservabilityIndexLoadOptions {
  pruneRunIds?: Set<string>;
}

function indexPath(runId: string): string {
  return path.join(OBSERVABILITY_RUN_INDEX_DIR, `${encodeURIComponent(runId)}.json`);
}

function durationMs(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  return finished - started;
}

function addMoney(target: Map<string, string[]>, value: MoneyValue | null | undefined): void {
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

function buildObservabilityRunIndex(run: RunRecord): ObservabilityRunIndexRecord {
  const jobs = listRuntimeJobRecords(run.run_id);
  const evidence = listWorkerEvidence(run.run_id);
  const events = listRunEvents(run.run_id);
  const scorecard = listScorecards(run.run_id)[0] || null;
  const evaluation = listEvaluations(run.run_id)[0] || null;
  const modelJobIds = new Set(
    jobs.filter((job) => job.agent_runtime !== "local").map((job) => job.job_id),
  );
  const latestUsageByJob = new Map<string, (typeof evidence)[number]>();
  for (const item of evidence) {
    if (item.kind === "usage" && item.usage) latestUsageByJob.set(item.job_id, item);
  }

  const providerCosts = new Map<string, string[]>();
  const estimatedCosts = new Map<string, string[]>();
  let totalTokens = 0;
  let tokenRecords = 0;
  const usage = [...latestUsageByJob.values()].map((item) => {
    if (item.usage?.total_tokens !== null && item.usage?.total_tokens !== undefined) {
      totalTokens += item.usage.total_tokens;
      tokenRecords += 1;
    }
    addMoney(providerCosts, item.usage?.provider_reported_cost);
    addMoney(estimatedCosts, item.usage?.estimated_cost);
    return {
      job_id: item.job_id,
      model_job: modelJobIds.has(item.job_id),
      created_at: item.created_at,
      total_tokens: item.usage?.total_tokens ?? null,
      provider_reported_cost: item.usage?.provider_reported_cost || null,
      estimated_cost: item.usage?.estimated_cost || null,
    } satisfies ObservabilityUsagePoint;
  });
  const latestEvent = events.at(-1) || null;

  return {
    schema_version: 1,
    run_id: run.run_id,
    indexed_at: nowIso(),
    run_updated_at: run.updated_at,
    status: run.status,
    intent: run.intent,
    created_at: run.created_at,
    updated_at: run.updated_at,
    started_at: run.started_at,
    finished_at: run.finished_at,
    duration_ms: durationMs(run.started_at, run.finished_at),
    jobs: jobs.map((job) => ({
      job_id: job.job_id,
      status: job.status,
      attempt: job.attempt,
      model_job: job.agent_runtime !== "local",
      finished_at: job.finished_at,
      duration_ms: durationMs(job.accepted_at || job.created_at, job.finished_at),
    })),
    usage,
    evidence_count: evidence.length,
    native_evidence_count: evidence.filter((item) => item.source?.synthetic === false).length,
    trace_id: evidence.find((item) => item.trace?.trace_id)?.trace?.trace_id || `trace:${run.run_id}`,
    event_count: events.length,
    last_sequence: latestEvent?.run_sequence ?? null,
    last_event_type: latestEvent?.type || null,
    scorecard_id: scorecard?.scorecard_id || null,
    pipeline_verdict: scorecard?.pipeline_verdict || evaluation?.pipeline_verdict || null,
    evaluation_id: evaluation?.evaluation_id || null,
    evaluation_status: evaluation?.status || null,
    quality_verdict: evaluation?.quality_verdict || null,
    gate_verdict: evaluation?.gate_verdict || scorecard?.gate_verdict || null,
    finding_count: (scorecard?.findings.length || 0) + (evaluation?.findings.length || 0),
    total_tokens: tokenRecords ? totalTokens : null,
    provider_reported_costs: moneyTotals(providerCosts),
    estimated_costs: moneyTotals(estimatedCosts),
  };
}

function readCurrentIndex(
  run: RunRecord,
  dirtyRunIds: Set<string>,
): ObservabilityRunIndexRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = indexPath(run.run_id);
  if (!storage.exists(filePath) || dirtyRunIds.has(run.run_id)) return null;
  try {
    const record = storage.readJson<ObservabilityRunIndexRecord>(filePath);
    if (
      record.schema_version !== 1 ||
      record.run_id !== run.run_id ||
      record.run_updated_at !== run.updated_at
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function loadObservabilityRunIndexes(
  runs: RunRecord[],
  options?: ObservabilityIndexLoadOptions,
): ObservabilityIndexLoadResult {
  const storage = getJsonStorageBackend();
  const dirtyRunIds = listDirtyObservabilityRunIds();
  const pruneRunIds = options?.pruneRunIds || new Set<string>();
  const records: ObservabilityRunIndexRecord[] = [];
  let rebuiltRecords = 0;
  let prunedIndexes = 0;
  let prunedDirtyMarkers = 0;

  for (const filePath of storage.listJsonFiles(OBSERVABILITY_RUN_INDEX_DIR)) {
    const runId = decodeURIComponent(path.basename(filePath, ".json"));
    if (!pruneRunIds.has(runId)) continue;
    storage.removeJson(filePath);
    prunedIndexes += 1;
  }
  for (const runId of pruneRunIds) {
    if (!dirtyRunIds.has(runId)) continue;
    clearObservabilityRunDirty(runId);
    dirtyRunIds.delete(runId);
    prunedDirtyMarkers += 1;
  }

  for (const run of runs) {
    const current = readCurrentIndex(run, dirtyRunIds);
    if (current) {
      records.push(current);
      continue;
    }
    const rebuilt = buildObservabilityRunIndex(run);
    storage.writeJson(indexPath(run.run_id), rebuilt);
    clearObservabilityRunDirty(run.run_id);
    records.push(rebuilt);
    rebuiltRecords += 1;
  }

  return {
    records,
    rebuilt_records: rebuiltRecords,
    pruned_indexes: prunedIndexes,
    pruned_dirty_markers: prunedDirtyMarkers,
  };
}
