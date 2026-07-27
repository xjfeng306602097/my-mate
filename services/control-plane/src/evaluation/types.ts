import type { RuntimeEventCursorRecord } from "../runtime/runtime-event-cursor-store.js";
import type { RuntimeJobRecord } from "../runtime/runtime-job-store.js";
import type { RuntimeWorkerRecord } from "../runtime/runtime-worker-store.js";
import type { NodeHandoffRecord } from "../runtime/node-handoff-store.js";
import type { WorkerLeaseRecord } from "../runtime/worker-lease-store.js";
import type { WorkerEvidence } from "../runtime-protocol.js";
import type { UsageSummary } from "@my-mate/shared-types/runtime-protocol";
import type {
  ApprovalRecord,
  ArtifactRecord,
  DagPatchRecord,
  EventRecord,
  HumanInputRecord,
  NodeRunRecord,
  RunPlanRecord,
  RunRecord,
  RunRouteSnapshot,
  SessionInterventionRecord,
} from "../types.js";

export interface SnapshotCompleteness {
  route: "complete" | "legacy_inferred" | "missing";
  events: "complete" | "legacy_partial" | "missing";
  evidence: "complete" | "partial" | "unavailable";
  usage: "complete" | "partial" | "unavailable";
  cost: "complete" | "partial" | "unavailable";
  redaction_blocked_count: number;
  late_record_count: number;
  blind_spots: string[];
}

export type EvidenceArtifactRecord = Pick<
  ArtifactRecord,
  | "artifact_id"
  | "run_id"
  | "node_run_id"
  | "type"
  | "name"
  | "storage_uri"
  | "mime_type"
  | "size_bytes"
  | "created_at"
>;

export interface RunEvidenceSnapshot {
  schema_version: 1;
  snapshot_id: string;
  snapshot_state: "terminal" | "incomplete";
  generated_at: string;
  run: RunRecord;
  route: RunRouteSnapshot;
  initial_plan: RunPlanRecord;
  effective_plan: RunPlanRecord;
  node_runs: NodeRunRecord[];
  runtime_jobs: RuntimeJobRecord[];
  runtime_workers: RuntimeWorkerRecord[];
  worker_leases: WorkerLeaseRecord[];
  event_cursors: RuntimeEventCursorRecord[];
  events: EventRecord[];
  evidence: WorkerEvidence[];
  handoffs: NodeHandoffRecord[];
  artifacts: EvidenceArtifactRecord[];
  approvals: ApprovalRecord[];
  human_inputs: HumanInputRecord[];
  interventions: SessionInterventionRecord[];
  dag_patches: DagPatchRecord[];
  completeness: SnapshotCompleteness;
  snapshot_cursor: string;
  evidence_digest: string;
}

export type FindingSeverity = "error" | "warning" | "blind_spot" | "info";

export interface ScorecardFinding {
  check_id: string;
  severity: FindingSeverity;
  passed: boolean;
  summary: string;
  detail: string;
  evidence_refs: string[];
}

export interface ScorecardResult {
  schema_version: 1;
  scorecard_id: string;
  run_id: string;
  snapshot_id: string;
  evidence_digest: string;
  profile: string;
  policy_version: number;
  enforcement: "off" | "advisory" | "strict";
  pipeline_verdict: "pass" | "fail" | "incomplete";
  contract_verdict: "pass" | "fail" | "not_applicable" | "incomplete";
  gate_verdict: "pass" | "reject" | "not_enforced";
  passed_checks: number;
  total_checks: number;
  hard_error_count: number;
  warning_count: number;
  blind_spot_count: number;
  findings: ScorecardFinding[];
  created_at: string;
}

export type EvaluationDimension = "pipeline" | "contract" | "evidence" | "usage" | "quality";

export interface EvaluationFinding extends ScorecardFinding {
  dimension: EvaluationDimension;
}

export interface EvaluationResult {
  schema_version: 1;
  evaluation_id: string;
  run_id: string;
  snapshot_id: string;
  evidence_digest: string;
  scorecard_id: string;
  evaluator: {
    id: string;
    kind: "none" | "deterministic" | "model";
    version: string;
    provider: string | null;
    model: string | null;
    prompt_version: string | null;
  };
  pipeline_verdict: "pass" | "fail" | "incomplete";
  contract_verdict: "pass" | "fail" | "not_applicable" | "incomplete";
  evidence_verdict: "complete" | "partial" | "unavailable";
  usage_verdict: "complete" | "partial" | "unavailable";
  quality_verdict: "pass" | "fail" | "not_evaluated" | "error";
  gate_verdict: "pass" | "reject" | "not_enforced";
  findings: EvaluationFinding[];
  evaluator_usage: UsageSummary | null;
  status: "queued" | "running" | "completed" | "failed";
  attempt: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export type TraceSpanKind =
  | "run"
  | "node"
  | "job"
  | "model"
  | "tool"
  | "handoff"
  | "artifact"
  | "control";

export interface TraceSpan {
  span_id: string;
  parent_span_id: string | null;
  trace_id: string;
  run_id: string;
  node_run_id: string | null;
  job_id: string | null;
  kind: TraceSpanKind;
  name: string;
  status: "ok" | "error" | "unknown";
  started_at: string;
  finished_at: string | null;
  input_ref: string | null;
  output_ref: string | null;
  tool_call_id: string | null;
  provider: string | null;
  model: string | null;
  usage: UsageSummary | null;
  attributes: Record<string, string | number | boolean | null>;
}

export interface TraceProjection {
  schema_version: 1;
  run_id: string;
  trace_id: string;
  completeness: "complete" | "legacy_partial";
  spans: TraceSpan[];
  cursor: string | null;
  has_more: boolean;
}

export interface ReplayNodeState {
  node_run_id: string;
  status: NodeRunRecord["status"];
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface ReplayResourceState {
  id: string;
  status: string;
  node_run_id: string | null;
  job_id: string | null;
  updated_at: string;
}

export interface ReplayRuntimeState {
  run_id: string;
  run_status: RunRecord["status"];
  run_started_at: string | null;
  run_finished_at: string | null;
  last_event_id: string | null;
  nodes: Record<string, ReplayNodeState>;
  jobs: Record<string, ReplayResourceState>;
  workers: Record<string, ReplayResourceState>;
  leases: Record<string, ReplayResourceState>;
  handoff_ids: string[];
  artifact_ids: string[];
  evidence_ids: string[];
  approval_ids: string[];
  human_input_ids: string[];
  runtime_patch_ids: string[];
  processed_events: number;
  first_sequence: number | null;
  last_sequence: number | null;
}

export interface ReplayDifference {
  category: "run" | "plan" | "node" | "job" | "worker" | "lease" | "handoff" | "artifact" | "evidence" | "gate" | "runtime_patch";
  record_id: string;
  field: string;
  replayed: unknown;
  persisted: unknown;
  severity: "error" | "warning";
  summary: string;
}

export interface ReplayResult {
  schema_version: 1;
  replay_id: string;
  run_id: string;
  route_id: string;
  event_digest: string;
  event_completeness: "complete" | "legacy_partial";
  verification: "pass" | "fail" | "partial";
  processed_events: number;
  first_sequence: number | null;
  last_sequence: number | null;
  projection_differences: ReplayDifference[];
  missing_references: string[];
  created_at: string;
}

export type ReplayPlanCategory =
  | "runtime_environment"
  | "scheduler_dispatch"
  | "provider_harness"
  | "prompt_agent_assignment"
  | "handoff_contract"
  | "artifact_contract"
  | "evidence_completeness"
  | "policy_evaluator"
  | "human_gate"
  | "budget_usage";

export interface ReplayPlanRecommendation {
  recommendation_id: string;
  category: ReplayPlanCategory;
  priority: "high" | "medium" | "low";
  summary: string;
  rationale: string;
  change_target: string;
  references: string[];
}

export interface ReplayPlanResult {
  schema_version: 1;
  replay_plan_id: string;
  run_id: string;
  replay_id: string;
  scorecard_id: string | null;
  evaluation_id: string | null;
  trace_completeness: "complete" | "legacy_partial";
  recommendations: ReplayPlanRecommendation[];
  summary: string;
  created_at: string;
}
