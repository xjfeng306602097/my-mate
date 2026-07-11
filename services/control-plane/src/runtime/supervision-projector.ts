import { listApprovals } from "../approval-store.js";
import { listArtifacts } from "../artifact-store.js";
import { listRunEvents } from "../event-store.js";
import { listHumanInputs } from "../human-input-store.js";
import { listNodeRuns } from "../node-run-store.js";
import { getRunPlan } from "../run-plan-store.js";
import { getRunRouteOrLegacy } from "../run-route-store.js";
import { getRun } from "../run-store.js";
import { buildRuntimeGraphSummary } from "../runtime-graph.js";
import { listRuntimeJobRecords } from "./runtime-job-store.js";
import { listRuntimeWorkerRecords } from "./runtime-worker-store.js";
import { listNodeHandoffRecords } from "./node-handoff-store.js";
import { listWorkerEvidence } from "./worker-evidence-store.js";
import { listWorkerLeaseRecords } from "./worker-lease-store.js";
import {
  decodeSupervisionCursor,
  encodeSupervisionCursor,
  initialSupervisionCursor,
  type SupervisionCursorPosition,
} from "./supervision-cursor.js";
import { EVIDENCE_SETTLE_QUIET_MS } from "../config.js";

type DeltaItem =
  | { stream: "event"; created_at: string; id: string; value: ReturnType<typeof listRunEvents>[number] }
  | { stream: "evidence"; created_at: string; id: string; value: ReturnType<typeof listWorkerEvidence>[number] }
  | { stream: "handoff"; created_at: string; id: string; value: ReturnType<typeof listNodeHandoffRecords>[number] }
  | { stream: "artifact"; created_at: string; id: string; value: ReturnType<typeof listArtifacts>[number] };

function afterPosition(
  createdAt: string,
  id: string,
  cursorCreatedAt: string | null,
  cursorId: string | null,
): boolean {
  if (!cursorCreatedAt) {
    return true;
  }
  const comparison = createdAt.localeCompare(cursorCreatedAt);
  return comparison > 0 || (comparison === 0 && id.localeCompare(cursorId || "") > 0);
}

function applyDeltaPosition(
  position: SupervisionCursorPosition,
  item: DeltaItem,
): void {
  if (item.stream === "event") {
    position.event_sequence = item.value.run_sequence || position.event_sequence + 1;
    position.event_id = item.value.event_id;
    position.graph_revision = Math.max(position.graph_revision, position.event_sequence);
  } else if (item.stream === "evidence") {
    position.evidence_created_at = item.value.created_at;
    position.evidence_id = item.value.evidence_id;
  } else if (item.stream === "handoff") {
    position.handoff_created_at = item.value.created_at;
    position.handoff_id = item.value.handoff_id;
  } else {
    position.artifact_created_at = item.value.created_at;
    position.artifact_id = item.value.artifact_id;
  }
}

export function buildSupervisionProjection(input: {
  runId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const run = getRun(input.runId);
  const plan = getRunPlan(input.runId);
  const route = getRunRouteOrLegacy(input.runId);
  if (!run || !plan || !route) {
    return null;
  }
  const nodeRuns = listNodeRuns(input.runId);
  const graph = buildRuntimeGraphSummary({ run, plan, nodeRuns });
  const jobs = listRuntimeJobRecords(input.runId);
  const leases = listWorkerLeaseRecords(input.runId);
  const workerIds = new Set(leases.map((lease) => lease.worker_id));
  const workers = listRuntimeWorkerRecords().filter((worker) => workerIds.has(worker.worker_id));
  const events = listRunEvents(input.runId);
  const evidence = listWorkerEvidence(input.runId);
  const handoffs = listNodeHandoffRecords(input.runId);
  const artifacts = listArtifacts(input.runId);
  const position = input.cursor
    ? decodeSupervisionCursor(input.cursor, input.runId)
    : initialSupervisionCursor(input.runId);

  const candidates: DeltaItem[] = [
    ...events
      .filter((event) => (event.run_sequence || 0) > position.event_sequence)
      .map((event) => ({
        stream: "event" as const,
        created_at: event.created_at,
        id: event.event_id,
        value: event,
      })),
    ...evidence
      .filter((item) =>
        afterPosition(item.created_at, item.evidence_id, position.evidence_created_at, position.evidence_id),
      )
      .map((item) => ({
        stream: "evidence" as const,
        created_at: item.created_at,
        id: item.evidence_id,
        value: item,
      })),
    ...handoffs
      .filter((item) =>
        afterPosition(item.created_at, item.handoff_id, position.handoff_created_at, position.handoff_id),
      )
      .map((item) => ({
        stream: "handoff" as const,
        created_at: item.created_at,
        id: item.handoff_id,
        value: item,
      })),
    ...artifacts
      .filter((item) =>
        afterPosition(item.created_at, item.artifact_id, position.artifact_created_at, position.artifact_id),
      )
      .map((item) => ({
        stream: "artifact" as const,
        created_at: item.created_at,
        id: item.artifact_id,
        value: item,
      })),
  ].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.stream.localeCompare(right.stream) ||
      left.id.localeCompare(right.id),
  );
  const limit = Math.min(500, Math.max(1, Math.floor(input.limit || 100)));
  const selected = candidates.slice(0, limit);
  const nextPosition: SupervisionCursorPosition = { ...position };
  selected.forEach((item) => applyDeltaPosition(nextPosition, item));

  const eventDeltas = selected.filter((item) => item.stream === "event").map((item) => item.value);
  const evidenceDeltas = selected
    .filter((item) => item.stream === "evidence")
    .map((item) => {
      const value = item.value as ReturnType<typeof listWorkerEvidence>[number];
      return {
        evidence_id: value.evidence_id,
        run_id: value.run_id,
        node_run_id: value.node_run_id,
        job_id: value.job_id,
        worker_id: value.worker_id,
        evidence_schema_version: value.evidence_schema_version || 1,
        sequence: value.sequence || null,
        kind: value.kind,
        source: value.source || null,
        trace: value.trace || null,
        summary: value.summary,
        input_ref: value.input_ref || null,
        output_ref: value.output_ref || null,
        storage_uri: value.storage_uri,
        usage: value.usage || null,
        redaction_status: value.redaction_status,
        created_at: value.created_at,
      };
    });
  const handoffDeltas = selected.filter((item) => item.stream === "handoff").map((item) => item.value);
  const artifactDeltas = selected.filter((item) => item.stream === "artifact").map((item) => item.value);
  const changedNodeIds = new Set<string>();
  for (const item of selected) {
    const value = item.value as { node_run_id?: string | null };
    if (value.node_run_id) {
      changedNodeIds.add(value.node_run_id);
    }
  }
  const changedNodes = input.cursor
    ? graph.nodes.filter((node) => changedNodeIds.has(node.nodeRunId))
    : graph.nodes;
  const activeJobs = jobs.filter((job) =>
    ["created", "queued", "dispatching", "accepted", "deferred", "running", "waiting_human"].includes(job.status),
  );
  const activeLeases = leases.filter((lease) =>
    [
      "provisioning",
      "ready",
      "active",
      "stale",
      "cleanup_pending",
      "cleanup_failed",
    ].includes(lease.status),
  );
  const connectedWorkers = workers.filter((worker) =>
    ["expected", "connected", "busy", "stale"].includes(worker.status),
  );
  const terminal = ["completed", "failed", "cancelled"].includes(run.status);
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
    !Number.isFinite(latestEvidenceAt) || Date.now() - latestEvidenceAt >= EVIDENCE_SETTLE_QUIET_MS;

  return {
    schema_version: 1,
    run_id: input.runId,
    route,
    status: run.status,
    settled:
      terminal &&
      activeJobs.length === 0 &&
      activeLeases.length === 0 &&
      connectedWorkers.length === 0 &&
      quietWindowElapsed,
    graph_revision: nextPosition.graph_revision,
    frontier: graph.frontier,
    changed_nodes: changedNodes,
    resources: {
      active_jobs: activeJobs.length,
      connected_ephemeral_workers: connectedWorkers.length,
      active_leases: activeLeases.length,
    },
    gates: {
      approvals: listApprovals("pending").filter((record) => record.run_id === input.runId),
      human_inputs: listHumanInputs("pending").filter((record) => record.run_id === input.runId),
    },
    deltas: {
      events: eventDeltas,
      evidence: evidenceDeltas,
      handoffs: handoffDeltas,
      artifacts: artifactDeltas,
    },
    cursor: encodeSupervisionCursor(nextPosition),
    has_more: candidates.length > selected.length,
    next_poll_after_ms: terminal ? 250 : 1000,
  };
}
