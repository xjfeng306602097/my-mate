import { createHash } from "node:crypto";
import { appendRunEvent } from "../event-store.js";
import { createEmptyExecutionRef } from "../execution-ref.js";
import type { NodeProvisioner, WorkerCleanupResult } from "../node-provisioner.js";
import { applyNodeStatus, getCompiledNode, getMutableNodeRun, recomputeFrontier } from "../node-scheduler.js";
import { listNodeRuns, saveNodeRuns } from "../node-run-store.js";
import { getRunPlan, saveRunPlan } from "../run-plan-store.js";
import { getRun, listRuns, saveRun } from "../run-store.js";
import type { RuntimeDispatcher } from "../runtime-dispatcher.js";
import { nowIso } from "../utils.js";
import {
  executionReplayView,
  findExecutionReplayByIdempotencyKey,
  getExecutionReplay,
  listExecutionReplays,
  saveExecutionReplay,
} from "./execution-replay-store.js";
import {
  findLatestRuntimeJobRecordForNode,
  getRuntimeJobRecord,
  listRuntimeJobRecords,
  saveRuntimeJobRecord,
  type RuntimeJobRecord,
} from "./runtime-job-store.js";
import type { RuntimeEngine } from "./runtime-engine.js";
import {
  findRuntimeCompensationForJob,
  listRuntimeCompensations,
  saveRuntimeCompensation,
} from "./runtime-compensation-store.js";
import type {
  ExecutionReplayRecord,
  ExecutionReplayView,
  RuntimeCompensationReason,
  RuntimeCompensationRecord,
  RuntimeRecoveryView,
} from "./recovery-contracts.js";
import {
  findActiveWorkerLeaseForJob,
  getWorkerLeaseRecord,
  listWorkerLeaseRecords,
  type WorkerLeaseRecord,
} from "./worker-lease-store.js";

const activeJobStatuses = new Set(["dispatching", "accepted", "running", "waiting_human"]);
const terminalReplayStatuses = new Set(["completed", "failed", "cancelled"]);
const activeCompensations = new Map<string, Promise<RuntimeCompensationRecord>>();

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf-8").digest("hex");
}

function compensationId(jobId: string, reason: RuntimeCompensationReason): string {
  return `compensation:${createHash("sha256").update(`${jobId}\n${reason}`, "utf-8").digest("hex").slice(0, 24)}`;
}

function replayId(runId: string, nodeRunId: string, sourceJobId: string, key: string): string {
  const value = digest([runId, nodeRunId, sourceJobId, key]).slice(0, 24);
  return `execution-replay:${value}`;
}

function jobDeadline(job: RuntimeJobRecord): { deadlineAt: string; reason: RuntimeCompensationReason } | null {
  const timeoutSeconds = Number(job.job.envelope.timeout_seconds || 0);
  const startedAt = Date.parse(job.accepted_at || job.created_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return null;
  return {
    deadlineAt: new Date(startedAt + timeoutSeconds * 1000).toISOString(),
    reason: "node_timeout",
  };
}

function resolveDeadline(job: RuntimeJobRecord, lease: WorkerLeaseRecord | null) {
  const jobValue = jobDeadline(job);
  const leaseDeadline = lease?.expires_at && Number.isFinite(Date.parse(lease.expires_at))
    ? lease.expires_at
    : null;
  if (leaseDeadline && (!jobValue || leaseDeadline < jobValue.deadlineAt)) {
    return { deadlineAt: leaseDeadline, reason: "lease_expired" as const };
  }
  return jobValue;
}

function appendCompensationEvent(
  record: RuntimeCompensationRecord,
  type: "recovery.timeout_detected" | "recovery.compensation_started" | "recovery.compensation_completed" | "recovery.compensation_failed",
  payload: Record<string, unknown>,
  createdAt: string,
): string {
  const event = appendRunEvent({
    run_id: record.run_id,
    node_run_id: record.node_run_id,
    type,
    actor_type: "system",
    actor_id: "runtime-compensation",
    payload: {
      compensation_id: record.compensation_id,
      job_id: record.job_id,
      lease_id: record.lease_id,
      worker_id: record.worker_id,
      reason: record.reason,
      ...payload,
    },
    created_at: createdAt,
    idempotency_key: `${type}:${record.compensation_id}:${record.status}`,
  });
  record.evidence_event_ids.push(event.event_id);
  return event.event_id;
}

async function cleanupCompensationLease(input: {
  record: RuntimeCompensationRecord;
  lease: WorkerLeaseRecord | null;
  provisioner?: NodeProvisioner | null;
}): Promise<WorkerCleanupResult | null> {
  if (!input.lease) return null;
  const latest = getWorkerLeaseRecord(input.lease.run_id, input.lease.lease_id) || input.lease;
  if (latest.status === "released" && latest.cleanup?.status === "succeeded") {
    return {
      status: "succeeded",
      lease_id: latest.lease_id,
      run_id: latest.run_id,
      node_run_id: latest.node_run_id,
      worker_id: latest.worker_id,
      attempt_id: latest.cleanup.attempt_id,
      attempt: latest.cleanup.attempt,
      reason: latest.cleanup.reason,
      container_ref: latest.cleanup.container_ref,
      resource_found: false,
      capacity_released: true,
      started_at: latest.cleanup.started_at,
      completed_at: latest.cleanup.completed_at || latest.cleanup.started_at,
      error: null,
    };
  }
  if (!input.provisioner?.releaseWorker) {
    throw new Error("Runtime Worker cleanup is unavailable for this compensation attempt.");
  }
  return (await input.provisioner.releaseWorker(latest, `timeout_compensation:${input.record.reason}`)) || null;
}

async function executeCompensation(input: {
  record: RuntimeCompensationRecord;
  engine: RuntimeEngine;
  dispatcher?: RuntimeDispatcher | null;
  provisioner?: NodeProvisioner | null;
  now?: () => string;
}): Promise<RuntimeCompensationRecord> {
  const timestamp = (input.now || nowIso)();
  const record = input.record;
  const job = getRuntimeJobRecord(record.run_id, record.job_id);
  const run = getRun(record.run_id);
  const plan = getRunPlan(record.run_id);
  const nodeRuns = listNodeRuns(record.run_id);
  const node = plan ? getCompiledNode(plan, record.node_run_id) : null;
  const nodeRun = getMutableNodeRun(nodeRuns, record.node_run_id);
  if (!job || !run || !plan || !node || !nodeRun) {
    record.status = "cleanup_failed";
    record.last_error = "Compensation lineage is incomplete; run, plan, node, or job is missing.";
    record.updated_at = timestamp;
    appendCompensationEvent(record, "recovery.compensation_failed", { error: record.last_error }, timestamp);
    return saveRuntimeCompensation(record);
  }

  if (record.status === "detected") {
    record.status = "cancelling";
    record.updated_at = timestamp;
    appendCompensationEvent(record, "recovery.compensation_started", {}, timestamp);
    saveRuntimeCompensation(record);
    if (record.lease_id) {
      input.dispatcher?.notifyNodeAction(record.run_id, record.node_run_id, "retry");
    }
  }

  if (activeJobStatuses.has(job.status)) {
    job.status = "failed";
    job.finished_at = timestamp;
    job.last_error = `Execution deadline exceeded at ${record.deadline_at}.`;
    const failed = appendRunEvent({
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      type: "job.failed",
      actor_type: "system",
      actor_id: "runtime-compensation",
      payload: {
        job_id: job.job_id,
        compensation_id: record.compensation_id,
        reason: record.reason,
        deadline_at: record.deadline_at,
      },
      created_at: timestamp,
      idempotency_key: `job.failed:${job.job_id}:timeout_compensation`,
    });
    job.last_event_id = failed.event_id;
    saveRuntimeJobRecord(job);
  }
  if (!["failed", "cancelled"].includes(nodeRun.status)) {
    applyNodeStatus(plan, nodeRuns, node.node_run_id, "failed", timestamp, "Execution deadline exceeded", 100);
    appendRunEvent({
      run_id: record.run_id,
      node_run_id: record.node_run_id,
      type: "node.failed",
      actor_type: "system",
      actor_id: "runtime-compensation",
      payload: {
        node_id: node.node_id,
        job_id: job.job_id,
        compensation_id: record.compensation_id,
        reason: record.reason,
        deadline_at: record.deadline_at,
      },
      created_at: timestamp,
      idempotency_key: `node.failed:${record.node_run_id}:${record.compensation_id}`,
    });
  }
  run.status = "failed";
  run.current_summary = `Runtime compensation: ${node.name}`;
  run.blocked_reason = "Execution deadline exceeded; Runtime Worker cleanup is required.";
  run.finished_at = timestamp;
  run.updated_at = timestamp;
  plan.status = "failed";
  saveRun(run);
  saveRunPlan(plan);
  saveNodeRuns(run.run_id, nodeRuns);

  record.status = "cleanup_pending";
  record.updated_at = timestamp;
  saveRuntimeCompensation(record);
  const lease = record.lease_id ? getWorkerLeaseRecord(record.run_id, record.lease_id) : null;
  try {
    const cleanup = await cleanupCompensationLease({ record, lease, provisioner: input.provisioner });
    if (cleanup?.attempt_id && !record.cleanup_attempt_ids.includes(cleanup.attempt_id)) {
      record.cleanup_attempt_ids.push(cleanup.attempt_id);
    }
    if (cleanup && cleanup.status !== "succeeded") {
      throw new Error(cleanup.error || "Runtime Worker cleanup failed.");
    }
    record.capacity_released = cleanup?.capacity_released ?? !lease;
    if (!record.capacity_released) throw new Error("Runtime Worker capacity was not released.");

    const canRetry = nodeRun.attempt < Math.max(1, node.retry_policy.max_attempts);
    if (canRetry) {
      node.status = "ready";
      node.execution_ref = createEmptyExecutionRef();
      node.retry_policy.attempt = nodeRun.attempt;
      nodeRun.status = "ready";
      nodeRun.progress = { percent: 0, message: "Ready after timeout compensation", updated_at: timestamp };
      nodeRun.finished_at = null;
      recomputeFrontier(plan);
      run.status = "running";
      run.current_summary = `Retrying after timeout compensation: ${node.name}`;
      run.blocked_reason = null;
      run.finished_at = null;
      plan.status = "running";
      saveRun(run);
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      record.retry_scheduled = true;
      await input.engine.queueReadyNodes(run.run_id, "timeout_compensation");
      const redispatched = findLatestRuntimeJobRecordForNode(run.run_id, node.node_run_id);
      record.redispatched_job_id = redispatched && redispatched.job_id !== record.job_id
        ? redispatched.job_id
        : null;
    }
    record.status = "completed";
    record.completed_at = (input.now || nowIso)();
    record.updated_at = record.completed_at;
    record.last_error = null;
    appendCompensationEvent(record, "recovery.compensation_completed", {
      capacity_released: record.capacity_released,
      cleanup_attempt_ids: record.cleanup_attempt_ids,
      retry_scheduled: record.retry_scheduled,
      redispatched_job_id: record.redispatched_job_id,
    }, record.completed_at);
  } catch (error) {
    record.status = "cleanup_failed";
    record.updated_at = (input.now || nowIso)();
    record.last_error = error instanceof Error ? error.message : "Runtime compensation failed.";
    appendCompensationEvent(record, "recovery.compensation_failed", { error: record.last_error }, record.updated_at);
  }
  return saveRuntimeCompensation(record);
}

function executeCompensationOnce(input: {
  record: RuntimeCompensationRecord;
  engine: RuntimeEngine;
  dispatcher?: RuntimeDispatcher | null;
  provisioner?: NodeProvisioner | null;
  now?: () => string;
}): Promise<RuntimeCompensationRecord> {
  const existing = activeCompensations.get(input.record.compensation_id);
  if (existing) return existing;
  const operation = executeCompensation(input).finally(() => {
    activeCompensations.delete(input.record.compensation_id);
  });
  activeCompensations.set(input.record.compensation_id, operation);
  return operation;
}

export async function scanRuntimeTimeouts(input: {
  engine: RuntimeEngine;
  dispatcher?: RuntimeDispatcher | null;
  provisioner?: NodeProvisioner | null;
  runId?: string;
  now?: () => string;
}): Promise<{ detected: number; completed: number; failed: number; records: RuntimeCompensationRecord[] }> {
  const timestamp = (input.now || nowIso)();
  const records: RuntimeCompensationRecord[] = [];
  const pending = listRuntimeCompensations(input.runId).filter((record) => record.status !== "completed");
  for (const record of pending) {
    records.push(await executeCompensationOnce({ ...input, record }));
  }
  for (const job of (input.runId ? listRuntimeJobRecords(input.runId) : listRuntimeJobRecordsForAllRuns())) {
    if (!activeJobStatuses.has(job.status) || findRuntimeCompensationForJob(job.job_id)) continue;
    const lease = findActiveWorkerLeaseForJob(job.job_id);
    const deadline = resolveDeadline(job, lease);
    if (!deadline || Date.parse(deadline.deadlineAt) > Date.parse(timestamp)) continue;
    const record: RuntimeCompensationRecord = {
      schema_version: 1,
      compensation_id: compensationId(job.job_id, deadline.reason),
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      job_id: job.job_id,
      worker_id: lease?.worker_id || job.worker_id,
      lease_id: lease?.lease_id || job.lease_id,
      reason: deadline.reason,
      status: "detected",
      deadline_at: deadline.deadlineAt,
      detected_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
      cleanup_attempt_ids: [],
      capacity_released: false,
      retry_scheduled: false,
      redispatched_job_id: null,
      last_error: null,
      evidence_event_ids: [],
    };
    appendCompensationEvent(record, "recovery.timeout_detected", { deadline_at: deadline.deadlineAt }, timestamp);
    saveRuntimeCompensation(record);
    records.push(await executeCompensationOnce({ ...input, record }));
  }
  return {
    detected: records.length,
    completed: records.filter((record) => record.status === "completed").length,
    failed: records.filter((record) => record.status === "cleanup_failed").length,
    records,
  };
}

function listRuntimeJobRecordsForAllRuns(): RuntimeJobRecord[] {
  const runIds = new Set(
    listRuns()
      .filter((run) => !["completed", "failed", "cancelled"].includes(run.status))
      .map((run) => run.run_id),
  );
  return [...runIds].flatMap((runId) => listRuntimeJobRecords(runId));
}

export async function createOrGetFailureReplay(input: {
  engine: RuntimeEngine;
  runId: string;
  nodeRunId: string;
  idempotencyKey: string;
  requestedBy: string;
  now?: () => string;
}): Promise<{ result: ExecutionReplayView; created: boolean }> {
  const existing = findExecutionReplayByIdempotencyKey(input.runId, input.idempotencyKey);
  if (existing) {
    if (existing.node_run_id !== input.nodeRunId) throw new Error("IDEMPOTENCY_CONFLICT");
    return { result: executionReplayView(existing), created: false };
  }
  const run = getRun(input.runId);
  const plan = getRunPlan(input.runId);
  const nodeRuns = listNodeRuns(input.runId);
  const node = plan ? getCompiledNode(plan, input.nodeRunId) : null;
  const nodeRun = getMutableNodeRun(nodeRuns, input.nodeRunId);
  if (!run || !plan) throw new Error("RUN_NOT_FOUND");
  if (!node || !nodeRun) throw new Error("NODE_NOT_FOUND");
  if (!["failed", "cancelled"].includes(nodeRun.status)) throw new Error("NODE_NOT_FAILED");
  const sourceJob = findLatestRuntimeJobRecordForNode(input.runId, input.nodeRunId);
  if (!sourceJob || !["failed", "cancelled", "rejected"].includes(sourceJob.status)) {
    throw new Error("FAILED_JOB_NOT_FOUND");
  }
  const activeJob = listRuntimeJobRecords(input.runId).find((record) =>
    record.node_run_id === input.nodeRunId && activeJobStatuses.has(record.status),
  );
  const unsettledLease = listWorkerLeaseRecords(input.runId).find((lease) =>
    lease.job_id === sourceJob.job_id &&
    ["provisioning", "ready", "active", "stale", "cleanup_pending", "cleanup_failed"].includes(lease.status),
  );
  if (activeJob || unsettledLease) throw new Error("REPLAY_CONFLICT");

  const timestamp = (input.now || nowIso)();
  const identity = {
    plan: {
      template_id: sourceJob.job.envelope.template_id,
      template_version: sourceJob.job.envelope.template_version,
      node_id: sourceJob.job.node_id,
      node_run_id: sourceJob.job.node_run_id,
    },
    runtime: {
      target_kind: sourceJob.target_kind,
      agent_runtime: sourceJob.agent_runtime,
      runtime_agent_ref: sourceJob.runtime_agent_ref,
      harness_profile: sourceJob.job.harness.harness_profile,
    },
    envelope: sourceJob.job.envelope,
  };
  const record: ExecutionReplayRecord = {
    schema_version: 1,
    replay_id: replayId(input.runId, input.nodeRunId, sourceJob.job_id, input.idempotencyKey),
    idempotency_key: input.idempotencyKey,
    run_id: input.runId,
    node_run_id: input.nodeRunId,
    source_job_id: sourceJob.job_id,
    replay_job_id: null,
    source_attempt: sourceJob.attempt,
    replay_attempt: null,
    status: "requested",
    requested_by: input.requestedBy,
    requested_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
    identity_digest: digest(identity),
    plan_identity: identity.plan,
    runtime_identity: identity.runtime,
    lineage_event_ids: [],
    last_error: null,
    frozen_job: JSON.parse(JSON.stringify(sourceJob.job)),
  };
  const requested = appendRunEvent({
    run_id: input.runId,
    node_run_id: input.nodeRunId,
    type: "recovery.replay_requested",
    actor_type: "operator",
    actor_id: input.requestedBy,
    payload: {
      replay_id: record.replay_id,
      source_job_id: sourceJob.job_id,
      identity_digest: record.identity_digest,
      execution_kind: "failure_replay",
    },
    created_at: timestamp,
    idempotency_key: `recovery.replay_requested:${record.replay_id}`,
  });
  record.lineage_event_ids.push(requested.event_id);
  saveExecutionReplay(record);

  node.status = "ready";
  node.execution_ref = createEmptyExecutionRef();
  node.retry_policy.attempt = nodeRun.attempt;
  nodeRun.status = "ready";
  nodeRun.progress = { percent: 0, message: "Ready for failure replay", updated_at: timestamp };
  nodeRun.finished_at = null;
  recomputeFrontier(plan);
  run.status = "running";
  run.current_summary = `Replaying failed node: ${node.name}`;
  run.blocked_reason = null;
  run.waiting_reason = null;
  run.finished_at = null;
  run.updated_at = timestamp;
  run.last_event_id = requested.event_id;
  plan.status = "running";
  saveRun(run);
  saveRunPlan(plan);
  saveNodeRuns(run.run_id, nodeRuns);

  await input.engine.queueReadyNodes(input.runId, "failure_replay");
  const persisted = getExecutionReplay(input.runId, record.replay_id) || record;
  return { result: executionReplayView(persisted), created: true };
}

export function buildRuntimeRecoveryView(runId: string): RuntimeRecoveryView {
  const compensations = listRuntimeCompensations(runId);
  const replays = listExecutionReplays(runId);
  const pendingCompensations = compensations.filter((record) => record.status !== "completed");
  const activeReplays = replays.filter((record) => !terminalReplayStatuses.has(record.status));
  const cleanupFailures = compensations.filter((record) => record.status === "cleanup_failed");
  return {
    run_id: runId,
    generated_at: nowIso(),
    posture: cleanupFailures.length ? "degraded" : pendingCompensations.length || activeReplays.length ? "recovering" : "healthy",
    summary: {
      compensations: compensations.length,
      pending_compensations: pendingCompensations.length,
      cleanup_failures: cleanupFailures.length,
      execution_replays: replays.length,
      active_replays: activeReplays.length,
    },
    compensations,
    execution_replays: replays.map(executionReplayView),
  };
}

export async function resumeRequestedFailureReplays(input: {
  engine: RuntimeEngine;
  now?: () => string;
}): Promise<{ resumed: string[]; failed: string[] }> {
  const resumed: string[] = [];
  const failed: string[] = [];
  for (const replay of listExecutionReplays().filter((record) => record.status === "requested" && !record.replay_job_id)) {
    const run = getRun(replay.run_id);
    const plan = getRunPlan(replay.run_id);
    const nodeRuns = listNodeRuns(replay.run_id);
    const node = plan ? getCompiledNode(plan, replay.node_run_id) : null;
    const nodeRun = getMutableNodeRun(nodeRuns, replay.node_run_id);
    if (!run || !plan || !node || !nodeRun) {
      replay.status = "failed";
      replay.last_error = "Failure replay could not resume because its run plan lineage is missing.";
      replay.updated_at = (input.now || nowIso)();
      replay.completed_at = replay.updated_at;
      saveExecutionReplay(replay);
      failed.push(replay.replay_id);
      continue;
    }
    node.status = "ready";
    node.execution_ref = createEmptyExecutionRef();
    node.retry_policy.attempt = nodeRun.attempt;
    nodeRun.status = "ready";
    nodeRun.finished_at = null;
    nodeRun.progress = { percent: 0, message: "Resuming persisted failure replay", updated_at: (input.now || nowIso)() };
    recomputeFrontier(plan);
    run.status = "running";
    run.finished_at = null;
    run.blocked_reason = null;
    run.current_summary = `Resuming failure replay: ${node.name}`;
    plan.status = "running";
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(run.run_id, nodeRuns);
    await input.engine.queueReadyNodes(run.run_id, "failure_replay_recovery");
    resumed.push(replay.replay_id);
  }
  return { resumed, failed };
}
