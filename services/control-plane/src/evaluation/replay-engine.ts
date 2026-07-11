import { createHash } from "node:crypto";
import { getInitialRunPlan } from "../run-initial-plan-store.js";
import { nowIso } from "../utils.js";
import { canonicalizeForEvidence, evidenceDigest } from "./canonical-json.js";
import { buildRunEvidenceSnapshot } from "./run-evidence-snapshot.js";
import {
  createInitialReplayRuntimeState,
  reduceRuntimeState,
} from "./runtime-state-reducer.js";
import {
  findReplayByEventDigest,
  saveReplay,
} from "./replay-store.js";
import type {
  ReplayDifference,
  ReplayResult,
  ReplayRuntimeState,
  RunEvidenceSnapshot,
} from "./types.js";

function replayId(runId: string, digest: string): string {
  return `replay:${runId}:${createHash("sha256").update(digest, "utf-8").digest("hex").slice(0, 20)}`;
}

function normalized(value: unknown): unknown {
  return value === undefined ? null : canonicalizeForEvidence(value);
}

function difference(
  values: ReplayDifference[],
  input: Omit<ReplayDifference, "replayed" | "persisted"> & {
    replayed: unknown;
    persisted: unknown;
  },
): void {
  const replayed = normalized(input.replayed);
  const persisted = normalized(input.persisted);
  if (JSON.stringify(replayed) === JSON.stringify(persisted)) return;
  values.push({ ...input, replayed, persisted });
}

function compareProjection(
  snapshot: RunEvidenceSnapshot,
  state: ReplayRuntimeState,
): { differences: ReplayDifference[]; missingReferences: string[] } {
  const differences: ReplayDifference[] = [];
  const missingReferences: string[] = [];
  difference(differences, {
    category: "run",
    record_id: snapshot.run.run_id,
    field: "status",
    replayed: state.run_status,
    persisted: snapshot.run.status,
    severity: "error",
    summary: "Replayed run status differs from the persisted run projection.",
  });
  difference(differences, {
    category: "plan",
    record_id: snapshot.effective_plan.run_id,
    field: "status",
    replayed: state.run_status,
    persisted: snapshot.effective_plan.status,
    severity: "error",
    summary: "Replayed run status differs from the effective plan status.",
  });
  const replayFrontier = Object.values(state.nodes)
    .filter((node) => node.status === "ready")
    .map((node) => node.node_run_id)
    .sort();
  difference(differences, {
    category: "plan",
    record_id: snapshot.effective_plan.run_id,
    field: "frontier",
    replayed: replayFrontier,
    persisted: [...snapshot.effective_plan.frontier].sort(),
    severity: "error",
    summary: "Replayed ready frontier differs from the persisted effective plan.",
  });

  const persistedNodes = new Map(snapshot.node_runs.map((item) => [item.node_run_id, item]));
  for (const [nodeRunId, replayed] of Object.entries(state.nodes)) {
    const persisted = persistedNodes.get(nodeRunId);
    if (!persisted) {
      missingReferences.push(`node:${nodeRunId}`);
      continue;
    }
    for (const field of ["status", "attempt"] as const) {
      difference(differences, {
        category: "node",
        record_id: nodeRunId,
        field,
        replayed: replayed[field],
        persisted: persisted[field],
        severity: "error",
        summary: `Replayed node ${field} differs from the persisted node projection.`,
      });
    }
  }
  for (const nodeRunId of persistedNodes.keys()) {
    if (!state.nodes[nodeRunId]) missingReferences.push(`initial-plan-node:${nodeRunId}`);
  }

  const compareResources = (
    category: "job" | "worker" | "lease",
    replayed: ReplayRuntimeState["jobs"],
    persisted: Map<string, { status: string }>,
  ) => {
    for (const [id, record] of Object.entries(replayed)) {
      const stored = persisted.get(id);
      if (!stored) {
        missingReferences.push(`${category}:${id}`);
        continue;
      }
      difference(differences, {
        category,
        record_id: id,
        field: "status",
        replayed: record.status,
        persisted: stored.status,
        severity: "error",
        summary: `Replayed ${category} status differs from the persisted projection.`,
      });
    }
    for (const id of persisted.keys()) {
      if (!replayed[id]) {
        differences.push({
          category,
          record_id: id,
          field: "event_coverage",
          replayed: null,
          persisted: "present",
          severity: "error",
          summary: `Persisted ${category} has no reconstructing lifecycle event.`,
        });
      }
    }
  };
  compareResources(
    "job",
    state.jobs,
    new Map(snapshot.runtime_jobs.map((item) => [item.job_id, item])),
  );
  compareResources(
    "worker",
    state.workers,
    new Map(snapshot.runtime_workers.map((item) => [item.worker_id, item])),
  );
  compareResources(
    "lease",
    state.leases,
    new Map(snapshot.worker_leases.map((item) => [item.lease_id, item])),
  );

  const compareIds = (
    category: "handoff" | "artifact" | "evidence" | "gate" | "runtime_patch",
    replayed: string[],
    persisted: string[],
  ) => {
    const replayedSet = new Set(replayed);
    const persistedSet = new Set(persisted);
    for (const id of replayedSet) {
      if (!persistedSet.has(id)) missingReferences.push(`${category}:${id}`);
    }
    for (const id of persistedSet) {
      if (!replayedSet.has(id)) {
        differences.push({
          category,
          record_id: id,
          field: "event_coverage",
          replayed: null,
          persisted: "present",
          severity: "error",
          summary: `Persisted ${category} record has no reconstructing event.`,
        });
      }
    }
  };
  compareIds("handoff", state.handoff_ids, snapshot.handoffs.map((item) => item.handoff_id));
  compareIds("artifact", state.artifact_ids, snapshot.artifacts.map((item) => item.artifact_id));
  compareIds("evidence", state.evidence_ids, snapshot.evidence.map((item) => item.evidence_id));
  compareIds(
    "gate",
    [...state.approval_ids, ...state.human_input_ids],
    [
      ...snapshot.approvals.map((item) => item.approval_id),
      ...snapshot.human_inputs.map((item) => item.input_request_id),
    ],
  );
  compareIds("runtime_patch", state.runtime_patch_ids, snapshot.dag_patches
    .filter((item) => item.status === "applied")
    .map((item) => item.patch_id));

  for (const event of snapshot.events) {
    if (event.node_run_id && !state.nodes[event.node_run_id]) {
      missingReferences.push(`event-node:${event.event_id}:${event.node_run_id}`);
    }
  }
  return {
    differences,
    missingReferences: [...new Set(missingReferences)].sort(),
  };
}

function eventCompleteness(snapshot: RunEvidenceSnapshot, hasInitialPlan: boolean): "complete" | "legacy_partial" {
  if (!hasInitialPlan || snapshot.route.source_kind === "legacy" || snapshot.events.length === 0) {
    return "legacy_partial";
  }
  const sequences = snapshot.events.map((event) => event.run_sequence);
  if (snapshot.events.some((event) => event.schema_version !== 2 || typeof event.run_sequence !== "number")) {
    return "legacy_partial";
  }
  return sequences.every((sequence, index) => sequence === index + 1)
    ? "complete"
    : "legacy_partial";
}

export function createOrGetReplay(runId: string): {
  result: ReplayResult;
  created: boolean;
} {
  const snapshot = buildRunEvidenceSnapshot(runId, { allowIncomplete: true });
  const storedInitialPlan = getInitialRunPlan(runId);
  const initialPlan = storedInitialPlan || snapshot.initial_plan;
  const digest = evidenceDigest({
    route: snapshot.route,
    initial_plan: initialPlan,
    events: snapshot.events,
    evidence: snapshot.evidence.map((item) => ({
      evidence_id: item.evidence_id,
      job_id: item.job_id,
      sequence: item.sequence || null,
      kind: item.kind,
      source: item.source || null,
      trace: item.trace || null,
      redaction_status: item.redaction_status,
    })),
  });
  const existing = findReplayByEventDigest(runId, digest);
  if (existing) return { result: existing, created: false };

  let state = createInitialReplayRuntimeState(runId, initialPlan);
  for (const event of snapshot.events) state = reduceRuntimeState(state, event);
  const compared = compareProjection(snapshot, state);
  const completeness = eventCompleteness(snapshot, Boolean(storedInitialPlan));
  const verification: ReplayResult["verification"] = completeness === "legacy_partial"
    ? "partial"
    : compared.differences.length === 0 && compared.missingReferences.length === 0
      ? "pass"
      : "fail";
  const result: ReplayResult = {
    schema_version: 1,
    replay_id: replayId(runId, digest),
    run_id: runId,
    route_id: snapshot.route.route_id,
    event_digest: digest,
    event_completeness: completeness,
    verification,
    processed_events: state.processed_events,
    first_sequence: state.first_sequence,
    last_sequence: state.last_sequence,
    projection_differences: compared.differences,
    missing_references: compared.missingReferences,
    created_at: nowIso(),
  };
  return { result: saveReplay(result), created: true };
}
