import { listArtifacts } from "../artifact-store.js";
import { listNodeRuns } from "../node-run-store.js";
import { getRunPlan } from "../run-plan-store.js";
import { getRun } from "../run-store.js";
import { buildRuntimeGraphSummary } from "../runtime-graph.js";
import { listRuntimeWorkerRecords } from "./runtime-worker-store.js";
import { listRuntimeEventCursors } from "./runtime-event-cursor-store.js";
import { listRuntimeJobRecords } from "./runtime-job-store.js";
import { listWorkerLeaseRecords } from "./worker-lease-store.js";
import { listWorkerEvidence } from "./worker-evidence-store.js";
import { listNodeHandoffRecords } from "./node-handoff-store.js";
import { nowIso } from "../utils.js";
import { getRunRouteOrLegacy } from "../run-route-store.js";
import { buildProviderEvidenceProjection } from "./provider-evidence-projection.js";
import { buildRuntimeRecoveryView } from "./runtime-recovery-service.js";

export function buildRuntimeRunProjection(runId: string) {
  const run = getRun(runId);
  const plan = getRunPlan(runId);
  if (!run || !plan) {
    return null;
  }
  const nodeRuns = listNodeRuns(runId);
  const jobs = listRuntimeJobRecords(runId);
  const leases = listWorkerLeaseRecords(runId);
  const workerIds = new Set(leases.map((lease) => lease.worker_id));
  const workers = listRuntimeWorkerRecords().filter((worker) => workerIds.has(worker.worker_id));
  const evidence = listWorkerEvidence(runId);
  const handoffs = listNodeHandoffRecords(runId);
  const eventCursors = listRuntimeEventCursors(runId);
  const artifacts = listArtifacts(runId);
  const providerEvidence = buildProviderEvidenceProjection(jobs, evidence);

  return {
    projection_version: 2,
    generated_at: nowIso(),
    run_id: runId,
    route: getRunRouteOrLegacy(runId),
    graph: buildRuntimeGraphSummary({
      run,
      plan,
      nodeRuns,
    }),
    jobs,
    leases,
    workers,
    evidence,
    handoffs,
    artifacts,
    provider_evidence: providerEvidence,
    recovery: buildRuntimeRecoveryView(runId),
    event_delivery: {
      tracked_jobs: eventCursors.length,
      ignored_events: eventCursors.reduce(
        (total, cursor) => total + cursor.ignored_event_count,
        0,
      ),
      cursors: eventCursors,
    },
    summary: {
      active_jobs: jobs.filter((job) =>
        ["dispatching", "accepted", "running", "waiting_human"].includes(job.status),
      ).length,
      connected_workers: workers.filter((worker) =>
        ["connected", "busy"].includes(worker.status),
      ).length,
      active_leases: leases.filter((lease) =>
        ["provisioning", "ready", "active", "cleanup_pending", "cleanup_failed"].includes(
          lease.status,
        ),
      ).length,
      evidence_items: evidence.length,
      native_evidence_items: providerEvidence.native_evidence_count,
      open_tool_calls: providerEvidence.tools.open_tool_call_ids.length,
      handoffs: handoffs.length,
      artifacts: artifacts.length,
    },
  };
}
