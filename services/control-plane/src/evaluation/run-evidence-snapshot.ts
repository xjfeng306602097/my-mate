import { listApprovals } from "../approval-store.js";
import { listArtifacts } from "../artifact-store.js";
import { listRunDagPatches } from "../dag-patch-store.js";
import { listRunEvents } from "../event-store.js";
import { listHumanInputs } from "../human-input-store.js";
import { listNodeRuns } from "../node-run-store.js";
import { getInitialRunPlan } from "../run-initial-plan-store.js";
import { getRunPlan } from "../run-plan-store.js";
import { getRunRouteOrLegacy } from "../run-route-store.js";
import { getRun } from "../run-store.js";
import { listRunInterventions } from "../session-intervention-store.js";
import { listRuntimeEventCursors } from "../runtime/runtime-event-cursor-store.js";
import { listRuntimeJobRecords } from "../runtime/runtime-job-store.js";
import { listRuntimeWorkerRecords } from "../runtime/runtime-worker-store.js";
import { listNodeHandoffRecords } from "../runtime/node-handoff-store.js";
import { listWorkerEvidence } from "../runtime/worker-evidence-store.js";
import { listWorkerLeaseRecords } from "../runtime/worker-lease-store.js";
import {
  buildSupervisionCursorPosition,
  encodeSupervisionCursor,
} from "../runtime/supervision-cursor.js";
import { nowIso } from "../utils.js";
import { EVIDENCE_SETTLE_QUIET_MS } from "../config.js";
import { canonicalizeForEvidence, evidenceDigest } from "./canonical-json.js";
import { getRunEvidenceSnapshot, saveRunEvidenceSnapshot } from "./snapshot-store.js";
import type {
  EvidenceArtifactRecord,
  RunEvidenceSnapshot,
  SnapshotCompleteness,
} from "./types.js";
import { classifyEvidenceCostCompleteness } from "../runtime/provider-evidence-projection.js";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_JOB_STATUSES = new Set([
  "created",
  "queued",
  "dispatching",
  "accepted",
  "deferred",
  "running",
  "waiting_human",
]);
const ACTIVE_LEASE_STATUSES = new Set(["provisioning", "ready", "active", "stale"]);
const ACTIVE_WORKER_STATUSES = new Set(["expected", "connected", "busy", "stale"]);
const EVALUATION_LIFECYCLE_EVENTS = new Set(["scorecard.completed", "evaluation.completed"]);

export function classifyUsageCompleteness(
  modelJobIds: string[],
  evidence: ReturnType<typeof listWorkerEvidence>,
): SnapshotCompleteness["usage"] {
  const usageAvailabilityByJob = new Map<string, "available" | "partial" | "unavailable">();
  for (const item of evidence) {
    if (item.kind !== "usage" || !item.usage) continue;
    const previous = usageAvailabilityByJob.get(item.job_id);
    const next = item.usage.availability;
    if (next === "available" || (next === "partial" && previous !== "available") || !previous) {
      usageAvailabilityByJob.set(item.job_id, next);
    }
  }
  const states = modelJobIds.map((jobId) => usageAvailabilityByJob.get(jobId) || "unavailable");
  if (states.length === 0 || states.every((status) => status === "unavailable")) {
    return "unavailable";
  }
  return states.every((status) => status === "available") ? "complete" : "partial";
}

function byCreatedAtAndId<T extends Record<string, unknown>>(
  values: T[],
  createdKey: keyof T,
  idKey: keyof T,
): T[] {
  return [...values].sort((left, right) => {
    const created = String(left[createdKey] || "").localeCompare(String(right[createdKey] || ""));
    return created || String(left[idKey] || "").localeCompare(String(right[idKey] || ""));
  });
}

function toEvidenceArtifact(
  artifact: ReturnType<typeof listArtifacts>[number],
): EvidenceArtifactRecord {
  return {
    artifact_id: artifact.artifact_id,
    run_id: artifact.run_id,
    node_run_id: artifact.node_run_id,
    type: artifact.type,
    name: artifact.name,
    storage_uri: artifact.storage_uri,
    mime_type: artifact.mime_type,
    size_bytes: artifact.size_bytes,
    created_at: artifact.created_at,
  };
}

function buildDigestDomain(
  domain: Omit<RunEvidenceSnapshot, "schema_version" | "snapshot_id" | "snapshot_state" | "generated_at" | "snapshot_cursor" | "evidence_digest">,
): unknown {
  const {
    current_summary: _currentSummary,
    last_event_id: _lastEventId,
    updated_at: _runUpdatedAt,
    ...run
  } = domain.run;
  return {
    ...domain,
    run,
    node_runs: domain.node_runs.map((nodeRun) => ({
      ...nodeRun,
      progress: {
        percent: nodeRun.progress.percent,
      },
    })),
    runtime_jobs: domain.runtime_jobs.map((job) => ({
      ...job,
      last_event_id: undefined,
    })),
    runtime_workers: domain.runtime_workers.map((worker) => ({
      ...worker,
      last_heartbeat_at: undefined,
    })),
    worker_leases: domain.worker_leases.map((lease) => ({
      ...lease,
      last_heartbeat_at: undefined,
    })),
    event_cursors: domain.event_cursors.map((cursor) => ({
      ...cursor,
      updated_at: undefined,
    })),
    events: domain.events.filter((event) => !EVALUATION_LIFECYCLE_EVENTS.has(event.type)),
  };
}

export function buildRunEvidenceSnapshot(
  runId: string,
  options?: { allowIncomplete?: boolean; generatedAt?: string },
): RunEvidenceSnapshot {
  const run = getRun(runId);
  const effectivePlan = getRunPlan(runId);
  const route = getRunRouteOrLegacy(runId);
  if (!run || !effectivePlan || !route) {
    throw new Error("RUN_EVIDENCE_NOT_FOUND");
  }

  const blindSpots: string[] = [];
  const storedInitialPlan = getInitialRunPlan(runId);
  const initialPlan = storedInitialPlan || structuredClone(effectivePlan);
  if (!storedInitialPlan) {
    blindSpots.push("Initial plan snapshot is missing; effective plan used as compatibility fallback.");
  }

  const nodeRuns = listNodeRuns(runId);
  const runtimeJobs = listRuntimeJobRecords(runId);
  const workerLeases = listWorkerLeaseRecords(runId);
  const workerIds = new Set(workerLeases.map((lease) => lease.worker_id));
  const runtimeWorkers = listRuntimeWorkerRecords().filter((worker) => workerIds.has(worker.worker_id));
  const eventCursors = listRuntimeEventCursors(runId).sort(
    (left, right) => left.job_id.localeCompare(right.job_id),
  );
  const events = listRunEvents(runId);
  const evidence = byCreatedAtAndId(
    listWorkerEvidence(runId) as unknown as Array<Record<string, unknown>>,
    "created_at",
    "evidence_id",
  ) as unknown as ReturnType<typeof listWorkerEvidence>;
  const handoffs = byCreatedAtAndId(
    listNodeHandoffRecords(runId) as unknown as Array<Record<string, unknown>>,
    "created_at",
    "handoff_id",
  ) as unknown as ReturnType<typeof listNodeHandoffRecords>;
  const artifactRecords = byCreatedAtAndId(
    listArtifacts(runId) as unknown as Array<Record<string, unknown>>,
    "created_at",
    "artifact_id",
  ) as unknown as ReturnType<typeof listArtifacts>;
  const artifacts = artifactRecords.map(toEvidenceArtifact);
  const approvals = listApprovals().filter((record) => record.run_id === runId);
  const humanInputs = listHumanInputs().filter((record) => record.run_id === runId);
  const interventions = listRunInterventions(runId);
  const dagPatches = listRunDagPatches(runId);

  const terminal = TERMINAL_RUN_STATUSES.has(run.status);
  const resourcesSettled =
    runtimeJobs.every((job) => !ACTIVE_JOB_STATUSES.has(job.status)) &&
    workerLeases.every((lease) => !ACTIVE_LEASE_STATUSES.has(lease.status)) &&
    runtimeWorkers.every((worker) => !ACTIVE_WORKER_STATUSES.has(worker.status));
  const generatedAt = options?.generatedAt || nowIso();
  const latestEvidenceAt = [
    ...evidence.map((record) => record.created_at),
    ...handoffs.map((record) => record.created_at),
    ...artifacts.map((record) => record.created_at),
    run.finished_at,
  ]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite)
    .reduce((latest, value) => Math.max(latest, value), Number.NEGATIVE_INFINITY);
  const quietWindowElapsed =
    !Number.isFinite(latestEvidenceAt) ||
    Date.parse(generatedAt) - latestEvidenceAt >= EVIDENCE_SETTLE_QUIET_MS;
  const settled = resourcesSettled && quietWindowElapsed;
  const snapshotState = terminal && settled ? "terminal" : "incomplete";
  if (snapshotState === "incomplete" && !options?.allowIncomplete) {
    throw new Error(terminal ? "RUN_NOT_SETTLED" : "RUN_NOT_TERMINAL");
  }
  if (!terminal) {
    blindSpots.push(`Run is not terminal (status=${run.status}).`);
  } else if (!resourcesSettled) {
    blindSpots.push("Runtime resources have not settled.");
  } else if (!quietWindowElapsed) {
    blindSpots.push(`Evidence quiet window (${EVIDENCE_SETTLE_QUIET_MS} ms) has not elapsed.`);
  }

  const allEventsV2 = events.length > 0 && events.every(
    (event) => event.schema_version === 2 && typeof event.run_sequence === "number",
  );
  if (!allEventsV2) {
    blindSpots.push(events.length ? "Legacy events do not have complete run sequencing." : "No run events were found.");
  }
  const evidenceByJob = new Set(evidence.map((item) => item.job_id));
  const jobsWithEvidence = runtimeJobs.filter((job) => evidenceByJob.has(job.job_id)).length;
  const evidenceStatus: SnapshotCompleteness["evidence"] =
    runtimeJobs.length === 0
      ? "unavailable"
      : jobsWithEvidence === runtimeJobs.length
        ? "complete"
        : jobsWithEvidence > 0
          ? "partial"
          : "unavailable";
  if (runtimeJobs.length > 0 && evidenceStatus !== "complete") {
    blindSpots.push("One or more runtime jobs have no persisted evidence.");
  }
  const modelJobs = runtimeJobs.filter((job) => job.agent_runtime !== "local");
  const usageStatus = classifyUsageCompleteness(
    modelJobs.map((job) => job.job_id),
    evidence,
  );
  if (modelJobs.length > 0 && usageStatus !== "complete") {
    blindSpots.push(`Provider usage is ${usageStatus} for one or more model jobs.`);
  }
  const costStatus = classifyEvidenceCostCompleteness(
    modelJobs.map((job) => job.job_id),
    evidence,
  );
  if (modelJobs.length > 0 && costStatus !== "complete") {
    blindSpots.push(`Provider-reported or catalog-estimated cost is ${costStatus} for one or more model jobs.`);
  }
  const redactionBlockedCount = evidence.filter(
    (item) => item.redaction_status === "blocked",
  ).length;
  if (redactionBlockedCount > 0) {
    blindSpots.push(`${redactionBlockedCount} evidence record(s) were blocked by redaction.`);
  }
  const finishedAt = run.finished_at ? Date.parse(run.finished_at) : Number.POSITIVE_INFINITY;
  const lateRecordCount = [...evidence, ...handoffs, ...artifacts].filter((record) => {
    const createdAt = Date.parse(record.created_at);
    return Number.isFinite(createdAt) && createdAt > finishedAt;
  }).length;

  const completeness: SnapshotCompleteness = {
    route: route.source_kind === "legacy" ? "legacy_inferred" : "complete",
    events: events.length === 0 ? "missing" : allEventsV2 ? "complete" : "legacy_partial",
    evidence: evidenceStatus,
    usage: usageStatus,
    cost: costStatus,
    redaction_blocked_count: redactionBlockedCount,
    late_record_count: lateRecordCount,
    blind_spots: blindSpots,
  };
  const cursor = encodeSupervisionCursor(
    buildSupervisionCursorPosition({ runId, events, evidence, handoffs, artifacts }),
  );
  const domain = canonicalizeForEvidence({
    run,
    route,
    initial_plan: initialPlan,
    effective_plan: effectivePlan,
    node_runs: nodeRuns,
    runtime_jobs: runtimeJobs,
    runtime_workers: runtimeWorkers,
    worker_leases: workerLeases,
    event_cursors: eventCursors,
    events,
    evidence,
    handoffs,
    artifacts,
    approvals,
    human_inputs: humanInputs,
    interventions,
    dag_patches: dagPatches,
    completeness,
  }) as Omit<RunEvidenceSnapshot, "schema_version" | "snapshot_id" | "snapshot_state" | "generated_at" | "snapshot_cursor" | "evidence_digest">;
  const digest = evidenceDigest(buildDigestDomain(domain));
  return {
    schema_version: 1,
    snapshot_id: `snapshot:${runId}:${digest.slice(7, 23)}`,
    snapshot_state: snapshotState,
    generated_at: generatedAt,
    ...domain,
    snapshot_cursor: cursor,
    evidence_digest: digest,
  };
}

export function getOrCreateRunEvidenceSnapshot(
  runId: string,
  options?: { allowIncomplete?: boolean },
): RunEvidenceSnapshot {
  const snapshot = buildRunEvidenceSnapshot(runId, options);
  const existing = getRunEvidenceSnapshot(runId, snapshot.evidence_digest);
  return existing || saveRunEvidenceSnapshot(snapshot);
}
