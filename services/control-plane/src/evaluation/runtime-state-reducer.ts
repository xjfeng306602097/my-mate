import type { EventRecord, RunPlanRecord } from "../types.js";
import type {
  ReplayResourceState,
  ReplayRuntimeState,
} from "./types.js";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addUnique(values: string[], value: string | null): string[] {
  return value && !values.includes(value) ? [...values, value] : values;
}

function resource(
  current: Record<string, ReplayResourceState>,
  id: string,
  event: EventRecord,
  status: string,
  jobId?: string | null,
): Record<string, ReplayResourceState> {
  const previous = current[id];
  return {
    ...current,
    [id]: {
      id,
      status,
      node_run_id: event.node_run_id ?? previous?.node_run_id ?? null,
      job_id: jobId ?? previous?.job_id ?? null,
      updated_at: event.created_at,
    },
  };
}

export function createInitialReplayRuntimeState(
  runId: string,
  initialPlan: RunPlanRecord,
): ReplayRuntimeState {
  return {
    run_id: runId,
    run_status: initialPlan.status,
    run_started_at: null,
    run_finished_at: null,
    last_event_id: null,
    nodes: Object.fromEntries(initialPlan.compiled_nodes.map((node) => [
      node.node_run_id,
      {
        node_run_id: node.node_run_id,
        status: node.status,
        attempt: 0,
        started_at: null,
        finished_at: null,
      },
    ])),
    jobs: {},
    workers: {},
    leases: {},
    handoff_ids: [],
    artifact_ids: [],
    evidence_ids: [],
    approval_ids: [],
    human_input_ids: [],
    runtime_patch_ids: [],
    processed_events: 0,
    first_sequence: null,
    last_sequence: null,
  };
}

export function reduceRuntimeState(
  state: ReplayRuntimeState,
  event: EventRecord,
): ReplayRuntimeState {
  const sequence = typeof event.run_sequence === "number" ? event.run_sequence : null;
  let next: ReplayRuntimeState = {
    ...state,
    processed_events: state.processed_events + 1,
    first_sequence: state.first_sequence ?? sequence,
    last_sequence: sequence ?? state.last_sequence,
    last_event_id: event.event_id,
  };
  const payload = event.payload || {};
  const jobId = text(payload.job_id);
  const workerId = text(payload.worker_id);
  const leaseId = text(payload.lease_id);
  const node = event.node_run_id ? state.nodes[event.node_run_id] : null;
  const updateNode = (
    status: NonNullable<typeof node>["status"],
    options?: { started?: boolean; finished?: boolean; incrementAttempt?: boolean },
  ) => {
    if (!event.node_run_id || !node) return;
    next = {
      ...next,
      nodes: {
        ...next.nodes,
        [event.node_run_id]: {
          ...node,
          status,
          attempt: node.attempt + (options?.incrementAttempt ? 1 : 0),
          started_at: options?.started ? node.started_at || event.created_at : node.started_at,
          finished_at: options?.finished ? event.created_at : status === "ready" ? null : node.finished_at,
        },
      },
    };
  };

  switch (event.type) {
    case "run.created":
    case "run.queued":
      next.run_status = "queued";
      break;
    case "run.started":
    case "run.resumed":
      next.run_status = "running";
      next.run_started_at = next.run_started_at || event.created_at;
      next.run_finished_at = null;
      break;
    case "run.paused":
      next.run_status = "paused";
      break;
    case "run.blocked":
      next.run_status = "blocked";
      break;
    case "run.completed":
      next.run_status = "completed";
      next.run_finished_at = event.created_at;
      break;
    case "run.failed":
      next.run_status = "failed";
      next.run_finished_at = event.created_at;
      break;
    case "run.cancelled":
      next.run_status = "cancelled";
      next.run_finished_at = event.created_at;
      next.nodes = Object.fromEntries(Object.entries(next.nodes).map(([id, item]) => [
        id,
        ["completed", "failed", "skipped", "cancelled"].includes(item.status)
          ? item
          : { ...item, status: "cancelled", finished_at: event.created_at },
      ]));
      break;
    case "node.ready":
      updateNode("ready");
      if (["failed", "cancelled", "waiting_human", "blocked"].includes(next.run_status)) {
        next.run_status = "running";
        next.run_finished_at = null;
      }
      break;
    case "node.started":
      updateNode("running", { started: true, incrementAttempt: true });
      break;
    case "node.completed":
      updateNode("completed", { finished: true });
      break;
    case "node.failed":
      updateNode("failed", { finished: true });
      break;
    case "node.skipped":
      updateNode("skipped", { finished: true });
      break;
    case "approval.requested":
      next.approval_ids = addUnique(next.approval_ids, text(payload.approval_id));
      updateNode("waiting_human");
      next.run_status = "waiting_human";
      break;
    case "approval.granted":
      next.approval_ids = addUnique(next.approval_ids, text(payload.approval_id));
      updateNode("ready");
      next.run_status = "running";
      break;
    case "approval.rejected":
      next.approval_ids = addUnique(next.approval_ids, text(payload.approval_id));
      updateNode("failed", { finished: true });
      next.run_status = "failed";
      next.run_finished_at = event.created_at;
      break;
    case "human_input.requested":
      next.human_input_ids = addUnique(next.human_input_ids, text(payload.input_request_id));
      updateNode("waiting_human");
      next.run_status = "waiting_human";
      break;
    case "human_input.submitted":
      next.human_input_ids = addUnique(next.human_input_ids, text(payload.input_request_id));
      updateNode("ready");
      next.run_status = "running";
      break;
    case "job.created":
    case "job.dispatching":
    case "job.accepted":
    case "job.running":
    case "job.waiting_human":
    case "job.completed":
    case "job.failed":
    case "job.cancelled":
      if (jobId) {
        const status = event.type.slice("job.".length);
        next.jobs = resource(next.jobs, jobId, event, status);
        if (event.type === "job.cancelled") {
          updateNode("cancelled", { finished: true });
          next.run_status = "cancelled";
          next.run_finished_at = event.created_at;
        }
        if (event.type === "job.failed") {
          next.run_status = "failed";
          next.run_finished_at = event.created_at;
        }
        if (event.type === "job.waiting_human") {
          updateNode("waiting_human");
          next.run_status = "waiting_human";
        } else if (event.type === "job.running" || event.type === "job.accepted") {
          next.run_status = "running";
        }
      }
      break;
    case "worker.expected":
    case "worker.registered":
    case "worker.status_changed":
    case "worker.released":
      if (workerId) {
        const status = event.type === "worker.registered"
          ? "connected"
          : event.type === "worker.status_changed"
            ? text(payload.status) || "unknown"
            : event.type.slice("worker.".length);
        next.workers = resource(next.workers, workerId, event, status, jobId);
      }
      break;
    case "lease.acquired":
    case "lease.activated":
    case "lease.released":
    case "lease.failed":
      if (leaseId) {
        const status = event.type === "lease.acquired"
          ? "provisioning"
          : event.type === "lease.activated"
            ? "active"
            : event.type.slice("lease.".length);
        next.leases = resource(next.leases, leaseId, event, status, jobId);
      }
      break;
    case "handoff.recorded":
      next.handoff_ids = addUnique(next.handoff_ids, text(payload.handoff_id));
      break;
    case "artifact.created":
      next.artifact_ids = addUnique(next.artifact_ids, text(payload.artifact_id));
      break;
    case "evidence.recorded":
      next.evidence_ids = addUnique(next.evidence_ids, text(payload.evidence_id));
      break;
    case "runtime.patch_applied":
      next.runtime_patch_ids = addUnique(next.runtime_patch_ids, text(payload.patch_id));
      break;
    default:
      break;
  }
  return next;
}
