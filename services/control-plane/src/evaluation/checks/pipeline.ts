import type {
  FindingSeverity,
  RunEvidenceSnapshot,
  ScorecardFinding,
} from "../types.js";

const TERMINAL_RUN = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_NODE = new Set(["completed", "failed", "skipped", "cancelled"]);
const ACTIVE_JOB = new Set(["created", "queued", "dispatching", "accepted", "running", "waiting_human"]);
const ACTIVE_LEASE = new Set(["provisioning", "ready", "active", "stale"]);
const ACTIVE_WORKER = new Set(["expected", "connected", "busy", "stale"]);

function finding(input: {
  checkId: string;
  passed: boolean;
  summary: string;
  detail: string;
  evidenceRefs?: string[];
  failureSeverity?: FindingSeverity;
}): ScorecardFinding {
  return {
    check_id: input.checkId,
    severity: input.passed ? "info" : input.failureSeverity || "error",
    passed: input.passed,
    summary: input.summary,
    detail: input.detail,
    evidence_refs: input.evidenceRefs || [],
  };
}

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function expectedArtifacts(node: RunEvidenceSnapshot["effective_plan"]["compiled_nodes"][number]): string[] {
  const value = node.output_contract.expected_artifacts;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];
}

function terminalRegression(snapshot: RunEvidenceSnapshot): string[] {
  const violations: string[] = [];
  let runTerminal = false;
  const terminalNodes = new Set<string>();
  for (const event of snapshot.events) {
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
      runTerminal = true;
      continue;
    }
    if (runTerminal && ["run.started", "run.resumed", "run.paused", "run.blocked"].includes(event.type)) {
      violations.push(`run:${event.event_id}`);
    }
    if (event.node_run_id && ["node.completed", "node.failed", "node.skipped"].includes(event.type)) {
      terminalNodes.add(event.node_run_id);
      continue;
    }
    if (
      event.node_run_id &&
      terminalNodes.has(event.node_run_id) &&
      ["node.ready", "node.started", "node.progress"].includes(event.type)
    ) {
      violations.push(`node:${event.node_run_id}:${event.event_id}`);
    }
  }
  return violations;
}

export function evaluatePipelineChecks(snapshot: RunEvidenceSnapshot): ScorecardFinding[] {
  const findings: ScorecardFinding[] = [];
  const initialFallback = snapshot.completeness.blind_spots.some((spot) =>
    spot.toLowerCase().includes("initial plan snapshot is missing"),
  );
  const foundationReady =
    !!snapshot.route.route_id &&
    snapshot.initial_plan.run_id === snapshot.run.run_id &&
    snapshot.effective_plan.run_id === snapshot.run.run_id &&
    !initialFallback;
  findings.push(finding({
    checkId: "pipeline.foundation_records",
    passed: foundationReady,
    summary: foundationReady
      ? "Route, initial plan, and effective plan are present."
      : "One or more canonical foundation records are missing.",
    detail: `route=${snapshot.completeness.route}; initial_plan=${initialFallback ? "fallback" : "persisted"}; effective_plan=present`,
    evidenceRefs: [
      `route:${snapshot.route.route_id}`,
      `plan:initial:${snapshot.run.run_id}`,
      `plan:effective:${snapshot.run.run_id}`,
    ],
  }));

  const terminal = TERMINAL_RUN.has(snapshot.run.status) && snapshot.snapshot_state === "terminal";
  findings.push(finding({
    checkId: "pipeline.expected_terminal_state",
    passed: terminal,
    failureSeverity: "warning",
    summary: terminal ? "Run reached a terminal and settled state." : "Run is not terminal and settled.",
    detail: `run_status=${snapshot.run.status}; snapshot_state=${snapshot.snapshot_state}`,
    evidenceRefs: [`run:${snapshot.run.run_id}`, `snapshot:${snapshot.snapshot_id}`],
  }));

  const projectionCounts = new Map<string, number>();
  snapshot.node_runs.forEach((node) =>
    projectionCounts.set(node.node_run_id, (projectionCounts.get(node.node_run_id) || 0) + 1),
  );
  const projectionViolations = snapshot.effective_plan.compiled_nodes
    .filter((node) => projectionCounts.get(node.node_run_id) !== 1)
    .map((node) => node.node_run_id);
  const unknownProjections = snapshot.node_runs
    .filter((node) => !snapshot.effective_plan.compiled_nodes.some((compiled) => compiled.node_run_id === node.node_run_id))
    .map((node) => node.node_run_id);
  findings.push(finding({
    checkId: "pipeline.node_projection_cardinality",
    passed: projectionViolations.length === 0 && unknownProjections.length === 0,
    summary:
      projectionViolations.length === 0 && unknownProjections.length === 0
        ? "Every compiled node has exactly one current projection."
        : "Node projection cardinality does not match the compiled plan.",
    detail: `missing_or_duplicate=${projectionViolations.join(",") || "none"}; unknown=${unknownProjections.join(",") || "none"}`,
    evidenceRefs: [...projectionViolations, ...unknownProjections].map((id) => `node:${id}`),
  }));

  const activeNodes = snapshot.node_runs.filter((node) => !TERMINAL_NODE.has(node.status));
  const nodeStatusCounts = Object.fromEntries(
    [...new Set(snapshot.node_runs.map((node) => node.status))].map((status) => [
      status,
      snapshot.node_runs.filter((node) => node.status === status).length,
    ]),
  );
  const terminalConsistency = !TERMINAL_RUN.has(snapshot.run.status) || activeNodes.length === 0;
  const completedConsistency =
    snapshot.run.status !== "completed" ||
    snapshot.node_runs.every((node) => node.status === "completed" || node.status === "skipped");
  const failedConsistency =
    snapshot.run.status !== "failed" || snapshot.node_runs.some((node) => node.status === "failed");
  const statusConsistent = terminalConsistency && completedConsistency && failedConsistency;
  findings.push(finding({
    checkId: "pipeline.terminal_projection_consistency",
    passed: statusConsistent,
    summary: statusConsistent
      ? "Run and node terminal states are consistent."
      : "Run and node terminal states disagree.",
    detail: `run_status=${snapshot.run.status}; node_statuses=${JSON.stringify(nodeStatusCounts)}`,
    evidenceRefs: activeNodes.map((node) => `node:${node.node_run_id}`),
  }));

  const nodeRunById = new Map(snapshot.node_runs.map((node) => [node.node_run_id, node]));
  const retryViolations = snapshot.effective_plan.compiled_nodes.filter((node) => {
    const attempt = nodeRunById.get(node.node_run_id)?.attempt || 0;
    return attempt > Math.max(0, node.retry_policy.max_attempts);
  });
  findings.push(finding({
    checkId: "pipeline.retry_policy",
    passed: retryViolations.length === 0,
    summary: retryViolations.length === 0
      ? "Retry attempts remain within declared policy."
      : "One or more nodes exceeded their retry policy.",
    detail: retryViolations.length
      ? retryViolations.map((node) => `${node.node_run_id}:${nodeRunById.get(node.node_run_id)?.attempt}/${node.retry_policy.max_attempts}`).join(", ")
      : "No retry overflow was found.",
    evidenceRefs: retryViolations.map((node) => `node:${node.node_run_id}`),
  }));

  const compiledByNodeId = new Map(
    snapshot.effective_plan.compiled_nodes.map((node) => [node.node_id, node]),
  );
  const takenEdges = snapshot.effective_plan.edges.filter((edge) => {
    const source = compiledByNodeId.get(edge.from);
    const target = compiledByNodeId.get(edge.to);
    if (!source || !target) return false;
    return nodeRunById.get(source.node_run_id)?.status === "completed" &&
      nodeRunById.get(target.node_run_id)?.status !== "pending";
  });
  const missingHandoffs = takenEdges.filter((edge) => {
    const source = compiledByNodeId.get(edge.from)!;
    const target = compiledByNodeId.get(edge.to)!;
    return !snapshot.handoffs.some(
      (handoff) =>
        handoff.node_run_id === source.node_run_id &&
        handoff.routed_node_run_ids.includes(target.node_run_id) &&
        hasContent(handoff.content),
    );
  });
  findings.push(finding({
    checkId: "pipeline.required_handoffs",
    passed: missingHandoffs.length === 0,
    summary: missingHandoffs.length === 0
      ? "Every taken edge has a non-empty routed handoff."
      : "One or more taken edges are missing a non-empty routed handoff.",
    detail: missingHandoffs.length
      ? missingHandoffs.map((edge) => `${edge.from}->${edge.to}`).join(", ")
      : `${takenEdges.length} taken edge(s) verified.`,
    evidenceRefs: snapshot.handoffs.map((handoff) => `handoff:${handoff.handoff_id}`),
  }));

  const artifactViolations: string[] = [];
  for (const node of snapshot.effective_plan.compiled_nodes) {
    const required = expectedArtifacts(node);
    if (required.length === 0 || nodeRunById.get(node.node_run_id)?.status !== "completed") continue;
    const actual = snapshot.artifacts.filter((artifact) => artifact.node_run_id === node.node_run_id);
    if (
      actual.length < required.length ||
      actual.some((artifact) => !artifact.storage_uri?.trim())
    ) {
      artifactViolations.push(
        `${node.node_run_id}:expected=${required.length},actual=${actual.length}`,
      );
    }
  }
  findings.push(finding({
    checkId: "pipeline.required_artifacts",
    passed: artifactViolations.length === 0,
    summary: artifactViolations.length === 0
      ? "Required artifacts exist and contain storage references."
      : "Required artifacts or storage references are missing.",
    detail: artifactViolations.join(", ") || `${snapshot.artifacts.length} artifact record(s) verified.`,
    evidenceRefs: snapshot.artifacts.map((artifact) => `artifact:${artifact.artifact_id}`),
  }));

  const activeJobs = snapshot.runtime_jobs.filter((job) => ACTIVE_JOB.has(job.status));
  findings.push(finding({
    checkId: "pipeline.no_active_jobs",
    passed: activeJobs.length === 0,
    summary: activeJobs.length === 0 ? "No active runtime job remains." : "Active runtime jobs remain.",
    detail: activeJobs.map((job) => `${job.job_id}:${job.status}`).join(", ") || "Runtime jobs are terminal.",
    evidenceRefs: activeJobs.map((job) => `job:${job.job_id}`),
  }));

  const activeLeases = snapshot.worker_leases.filter((lease) => ACTIVE_LEASE.has(lease.status));
  findings.push(finding({
    checkId: "pipeline.no_active_leases",
    passed: activeLeases.length === 0,
    summary: activeLeases.length === 0 ? "No active Worker lease remains." : "Active Worker leases remain.",
    detail: activeLeases.map((lease) => `${lease.lease_id}:${lease.status}`).join(", ") || "Worker leases are released or failed.",
    evidenceRefs: activeLeases.map((lease) => `lease:${lease.lease_id}`),
  }));

  const activeWorkers = snapshot.runtime_workers.filter((worker) => ACTIVE_WORKER.has(worker.status));
  findings.push(finding({
    checkId: "pipeline.no_connected_ephemeral_workers",
    passed: activeWorkers.length === 0,
    summary: activeWorkers.length === 0
      ? "No run-scoped ephemeral Worker remains active."
      : "Run-scoped ephemeral Workers remain active.",
    detail: activeWorkers.map((worker) => `${worker.worker_id}:${worker.status}`).join(", ") || "Workers are released or disconnected.",
    evidenceRefs: activeWorkers.map((worker) => `worker:${worker.worker_id}`),
  }));

  const sequences = snapshot.events.map((event) => event.run_sequence);
  const eventOrderValid =
    snapshot.completeness.events === "complete" &&
    sequences.every((sequence, index) => sequence === index + 1);
  const ignoredEventCount = snapshot.event_cursors.reduce(
    (total, cursor) => total + cursor.ignored_event_count,
    0,
  );
  findings.push(finding({
    checkId: "pipeline.event_sequence_idempotency",
    passed: eventOrderValid,
    failureSeverity: "blind_spot",
    summary: eventOrderValid
      ? "Domain events are ordered and Worker rejection counts are visible."
      : "Event ordering is incomplete or legacy.",
    detail: `events=${snapshot.events.length}; completeness=${snapshot.completeness.events}; ignored_worker_events=${ignoredEventCount}`,
    evidenceRefs: snapshot.events.slice(-10).map((event) => `event:${event.event_id}`),
  }));

  const regressions = terminalRegression(snapshot);
  findings.push(finding({
    checkId: "pipeline.no_terminal_regression",
    passed: regressions.length === 0,
    summary: regressions.length === 0
      ? "No terminal state regression was observed."
      : "A terminal run or node emitted a later active transition.",
    detail: regressions.join(", ") || "Terminal transitions are monotonic.",
    evidenceRefs: regressions,
  }));

  const pendingApprovals = snapshot.approvals.filter((approval) => approval.status === "pending");
  const pendingInputs = snapshot.human_inputs.filter((input) => input.status === "pending");
  const pendingGateCount = pendingApprovals.length + pendingInputs.length;
  const gateConsistent = TERMINAL_RUN.has(snapshot.run.status)
    ? pendingGateCount === 0
    : snapshot.run.status !== "waiting_human" || pendingGateCount > 0;
  findings.push(finding({
    checkId: "pipeline.gate_consistency",
    passed: gateConsistent,
    summary: gateConsistent
      ? "Approval and human-input gates match run status."
      : "Pending gates are inconsistent with run status.",
    detail: `run_status=${snapshot.run.status}; pending_approvals=${pendingApprovals.length}; pending_human_inputs=${pendingInputs.length}`,
    evidenceRefs: [
      ...pendingApprovals.map((approval) => `approval:${approval.approval_id}`),
      ...pendingInputs.map((input) => `human_input:${input.input_request_id}`),
    ],
  }));

  const modelJobs = snapshot.runtime_jobs.filter((job) => job.agent_runtime !== "local");
  const blindSpots = [...snapshot.completeness.blind_spots];
  if (modelJobs.length > 0 && snapshot.completeness.usage !== "complete") {
    blindSpots.push(`Model usage evidence is ${snapshot.completeness.usage}.`);
  }
  if (modelJobs.length > 0 && snapshot.completeness.cost !== "complete") {
    blindSpots.push(`Model cost evidence is ${snapshot.completeness.cost}.`);
  }
  findings.push(finding({
    checkId: "pipeline.evidence_completeness",
    passed: blindSpots.length === 0 && snapshot.completeness.redaction_blocked_count === 0,
    failureSeverity: "blind_spot",
    summary:
      blindSpots.length === 0 && snapshot.completeness.redaction_blocked_count === 0
        ? "No blocked redaction or missing evidence blind spot was found."
        : "Evidence completeness has explicit blind spots.",
    detail: blindSpots.join(" ") || "Evidence completeness is sufficient for pipeline checks.",
    evidenceRefs: snapshot.evidence.map((evidence) => `evidence:${evidence.evidence_id}`),
  }));

  return findings;
}
