import type {
  AgentDagStatus as SharedAgentDagStatus,
  AgentRole as SharedAgentRole,
  AgentRunStatus as SharedAgentRunStatus,
  AgentTaskStatus as SharedAgentTaskStatus,
  AutonomyMode as SharedAutonomyMode,
  NodeStatus as SharedNodeStatus,
  PlanOption as SharedPlanOption,
  RunStatus as SharedRunStatus,
  SessionStatus as SharedSessionStatus,
  TaskCheckpointStatus as SharedTaskCheckpointStatus,
  WorkerTargetKind as SharedWorkerTargetKind,
} from "@my-mate/shared-types/domain-lifecycle";

export type RunStatus = SharedRunStatus;

export type TemplateStatus = "draft" | "published" | "archived";
export type RegistryStatus = "active" | "disabled";
export type GovernanceMode = "advisory" | "enforced";
export type GovernanceProtectedAction =
  | "agent.upsert"
  | "agent.disable"
  | "skill.upsert"
  | "skill.disable"
  | "template.publish"
  | "template.archive";
export type GovernanceChangeStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "conflicted";
export type TemplateDerivationKind = "derive" | "version";
export type RunValidationMode = "warn" | "strict" | "bypass";
export type SessionStatus = SharedSessionStatus;
export type PlannerValidationCategory = "required_input" | "registry" | "graph" | "other";
export type PlannerValidationCode =
  | "missing_required_input"
  | "missing_agent"
  | "unknown_agent"
  | "disabled_agent"
  | "unknown_skill"
  | "disabled_skill"
  | "disallowed_skill"
  | "no_ready_frontier"
  | "no_terminal_node";
export type NodeStatus = SharedNodeStatus;

export type EventType =
  | "run.created"
  | "run.queued"
  | "run.started"
  | "run.paused"
  | "run.resumed"
  | "run.cancelled"
  | "run.blocked"
  | "run.completed"
  | "run.failed"
  | "node.ready"
  | "node.started"
  | "node.progress"
  | "node.completed"
  | "node.failed"
  | "node.skipped"
  | "approval.requested"
  | "approval.granted"
  | "approval.rejected"
  | "human_input.requested"
  | "human_input.submitted"
  | "artifact.created"
  | "job.created"
  | "job.dispatching"
  | "job.accepted"
  | "job.running"
  | "job.waiting_human"
  | "job.completed"
  | "job.failed"
  | "job.cancelled"
  | "job.control_applied"
  | "job.control_rejected"
  | "human_gate.control_sent"
  | "human_gate.control_failed"
  | "worker.expected"
  | "worker.registered"
  | "worker.status_changed"
  | "worker.released"
  | "lease.acquired"
  | "lease.activated"
  | "lease.cleanup_started"
  | "lease.cleanup_completed"
  | "lease.cleanup_failed"
  | "lease.released"
  | "lease.failed"
  | "handoff.recorded"
  | "evidence.recorded"
  | "runtime.patch_applied"
  | "runtime.fanout_materialized"
  | "runtime.quiescent"
  | "recovery.timeout_detected"
  | "recovery.compensation_started"
  | "recovery.compensation_completed"
  | "recovery.compensation_failed"
  | "recovery.replay_requested"
  | "recovery.replay_dispatched"
  | "recovery.replay_completed"
  | "recovery.replay_failed"
  | "recovery.failure_routed"
  | "scorecard.completed"
  | "evaluation.completed";

export type ActorType = "user" | "agent" | "system" | "operator";
export type RuntimeAgentRefSource = "registry" | "template_binding" | "fallback" | "none";
export type SessionMessageRole = "user" | "orchestrator" | "system";
export type SessionMessageKind =
  | "text"
  | "system"
  | "orchestrator_turn"
  | "goal_update_card"
  | "decision_card"
  | "workspace_snapshot_card"
  | "intervention_card"
  | "dag_patch_card"
  | "draft_card"
  | "plan_card"
  | "plan_options_card"
  | "run_card"
  | "agent_activity"
  | "summary_card"
  | "subtask_card"
  | "approval_card"
  | "human_input_card"
  | "artifact_card";

export type MissionWorkspaceStageKey =
  | "briefing"
  | "work"
  | "plan"
  | "execution"
  | "thread";

export interface MissionRouteSummary {
  activeRevision: number | null;
  activeOption: "primary" | "alternative" | null;
  latestRevision: number | null;
  confirmedRevision: number | null;
  confirmedOption: "primary" | "alternative" | null;
  selectedTemplateId: string | null;
  selectedTemplateName: string | null;
  alternativeAvailable: boolean;
  stale: boolean;
  staleReason: string | null;
}

export interface MissionPipelineSummary {
  total: number;
  ready: number;
  active: number;
  blocked: number;
  completed: number;
  primaryAgentLabels: string[];
}

export interface MissionCheckpointSummary {
  total: number;
  completed: number;
  active: number;
  pending: number;
  labels: string[];
}

export interface MissionRevisionLineageSummary {
  sourceRevision: number | null;
  sourceOption: "primary" | "alternative" | null;
  latestRevision: number | null;
  confirmedRevision: number | null;
  confirmedOption: "primary" | "alternative" | null;
}

export interface MissionSpecSummary {
  objective: string | null;
  sourceBrief: string | null;
  constraints: string[];
  requestedOutputs: string[];
  openQuestions: string[];
  decisionFocus: string | null;
  route: MissionRouteSummary;
  pipelineSummary: MissionPipelineSummary;
  checkpointSummary: MissionCheckpointSummary;
  revisionLineage: MissionRevisionLineageSummary;
}

export interface MissionSpecContract {
  specId: string;
  missionId: string;
  sessionId: string;
  schemaVersion: 1;
  title: string;
  status: SessionStatus;
  objective: string | null;
  sourceBrief: string | null;
  constraints: string[];
  requestedOutputs: string[];
  openQuestions: string[];
  decisionFocus: string | null;
  route: MissionRouteSummary;
  pipelineSummary: MissionPipelineSummary;
  checkpointSummary: MissionCheckpointSummary;
  revisionLineage: MissionRevisionLineageSummary;
  executionContract?: ExecutionContract;
  activeRunId: string | null;
  latestMessageId: string | null;
  latestUserMessageId: string | null;
  latestPlanMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionContract {
  schemaVersion: 1;
  status: "forming" | "ready" | "executing" | "awaiting_acceptance" | "satisfied" | "blocked";
  deliverables: string[];
  acceptanceCriteria: string[];
  verificationSteps: string[];
  boundaries: string[];
  openQuestions: string[];
  completionRule: "all_required_deliverables_and_acceptance_criteria";
}

export type MissionDeltaClassification =
  | "baseline"
  | "minor"
  | "material"
  | "topology"
  | "critical";

export interface MissionDeltaChange {
  field: string;
  operation: "added" | "removed" | "replaced";
  impact: "informational" | "execution" | "topology" | "risk";
  before: unknown;
  after: unknown;
}

export interface MissionSpecRevisionRecord {
  schema_version: 1;
  revision_id: string;
  mission_id: string;
  session_id: string;
  revision: number;
  parent_revision_id: string | null;
  source_message_id: string | null;
  mission_spec_contract: MissionSpecContract;
  semantic_digest: string;
  delta_id: string;
  created_at: string;
}

export interface MissionDeltaRecord {
  schema_version: 1;
  delta_id: string;
  mission_id: string;
  session_id: string;
  from_revision_id: string | null;
  to_revision_id: string;
  source_message_id: string | null;
  classification: MissionDeltaClassification;
  changed_fields: string[];
  changes: MissionDeltaChange[];
  requires_interview_reassessment: boolean;
  requires_orchestration_reassessment: boolean;
  invalidates_confirmed_proposal: boolean;
  evidence: string[];
  created_at: string;
}

export type MissionInterviewMode = "skip" | "focused" | "deep";
export type MissionInterviewQuestionStatus =
  | "open"
  | "answered"
  | "inferred"
  | "deferred"
  | "invalidated";

export interface MissionInterviewQuestion {
  question_id: string;
  decision_key: string;
  dependency_keys: string[];
  blocking_level: "none" | "soft" | "hard";
  prompt: string;
  reason: string;
  recommended_answer: string | null;
  answer: string | null;
  answer_source: "user" | "workspace" | "system" | "model" | "default" | null;
  affected_node_ids: string[];
  status: MissionInterviewQuestionStatus;
  answered_at: string | null;
}

export interface InterviewDecisionRecord {
  schema_version: 1;
  decision_id: string;
  mission_id: string;
  session_id: string;
  mission_revision_id: string;
  mode: MissionInterviewMode;
  reason_codes: string[];
  blocking_decisions: string[];
  recommended_defaults: Record<string, string>;
  invalidated_question_ids: string[];
  decided_by: "policy" | "user";
  policy_version: string;
  created_at: string;
}

export interface MissionInterviewRecord {
  schema_version: 1;
  interview_id: string;
  mission_id: string;
  session_id: string;
  mission_revision_id: string;
  decision_id: string;
  mode: MissionInterviewMode;
  status: "inactive" | "active" | "ready" | "superseded";
  readiness_score: number;
  questions: MissionInterviewQuestion[];
  supersedes_interview_id: string | null;
  created_at: string;
  updated_at: string;
}

export type RouteCompareOption = SharedPlanOption;
export type RouteCompareKind =
  | "option"
  | "revision"
  | "confirmed_vs_latest"
  | "same_route";

export interface RouteCompareSide {
  revision: number | null;
  option: RouteCompareOption;
  messageId: string | null;
  templateId: string | null;
  templateName: string | null;
  nodeCount: number;
  edgeCount: number;
  approvalGateCount: number;
  outputCount: number;
  warningCount: number;
  label: string;
}

export interface RouteCompareChangeSet {
  added: string[];
  removed: string[];
  changed: string[];
  unchangedCount: number;
}

export interface RouteCompareRecommendation {
  label: string;
  detail: string;
  tone: "neutral" | "warn" | "success" | "danger";
}

export interface RouteCompareSummary {
  sessionId: string;
  comparisonKind: RouteCompareKind;
  left: RouteCompareSide;
  right: RouteCompareSide;
  changedNodes: RouteCompareChangeSet;
  changedEdges: RouteCompareChangeSet;
  changedApprovals: RouteCompareChangeSet;
  changedOutputs: RouteCompareChangeSet;
  changedRisks: RouteCompareChangeSet;
  summaryLines: string[];
  recommendation: RouteCompareRecommendation;
}

export interface MissionPipeline {
  key: string;
  title: string;
  summary: string;
  status: "done" | "active" | "pending" | "blocked";
  tone: "neutral" | "warn" | "success" | "danger";
  stageKey: MissionWorkspaceStageKey;
  nodeCount: number;
  readyCount: number;
  primaryAgentLabel: string | null;
  artifactExpectation: string | null;
  outputKeys: string[];
  checkpointKeys: string[];
  blocker: string | null;
  activeNodeName: string | null;
  nextActionLabel: string | null;
}

export type MissionCheckpointType =
  | "objective"
  | "route"
  | "launch"
  | "runtime"
  | "human_gate"
  | "output"
  | "runtime_steering";

export interface MissionCheckpoint {
  key: string;
  type: MissionCheckpointType;
  label: string;
  detail: string;
  tone: "neutral" | "warn" | "success" | "danger";
  status: "done" | "active" | "pending";
  relatedRouteRevision: number | null;
  relatedPipelineKeys: string[];
  relatedOutputKeys: string[];
  relatedRunId: string | null;
  nextActionLabel: string | null;
}

export interface WorkspaceArtifactSurface {
  key: string;
  title: string;
  summary: string;
  tone: "neutral" | "warn" | "success" | "danger";
  chips: string[];
  detailLines: string[];
}

export interface MissionOutputHistoryEntry {
  key: string;
  title: string;
  summary: string;
  status: "requested" | "prepared" | "in_progress" | "returned";
  source: "mission_spec" | "pipeline" | "runtime" | "artifact";
  createdAt: string | null;
  pipelineKeys: string[];
  artifactMessageIds: string[];
}

export interface MissionOutput {
  key: string;
  title: string;
  summary: string;
  status: "requested" | "prepared" | "in_progress" | "returned";
  tone: "neutral" | "warn" | "success" | "danger";
  source: "mission_spec" | "pipeline" | "runtime" | "artifact";
  stageKey: MissionWorkspaceStageKey;
  pipelineKeys: string[];
  artifactMessageIds: string[];
  relatedCheckpointKeys: string[];
  latestArtifactMessageId: string | null;
  currentActionLabel: string | null;
  history: MissionOutputHistoryEntry[];
  detailLines: string[];
}

export interface MissionStageSummary {
  key: MissionWorkspaceStageKey;
  label: string;
  title: string;
  detail: string;
  metric: string;
  tone: "neutral" | "warn" | "success" | "danger";
  status: "done" | "active" | "pending";
}

export type MissionWorkspaceSectionKey =
  | "objective"
  | "route"
  | "work_packages"
  | "checkpoints"
  | "outputs"
  | "pending_decisions"
  | "execution_summary"
  | "evidence_summary";

export interface MissionWorkspaceSection {
  key: MissionWorkspaceSectionKey;
  label: string;
  title: string;
  summary: string;
  tone: "neutral" | "warn" | "success" | "danger";
  status: "done" | "active" | "pending" | "blocked";
  itemCount: number;
  detailLines: string[];
}

export type MissionConversationResponsibility =
  | "intent_record"
  | "orchestrator_explanation"
  | "decision_record"
  | "audit_trail";

export interface MissionConversationRail {
  title: string;
  summary: string;
  responsibilities: MissionConversationResponsibility[];
  latestIntent: string | null;
  latestExplanation: string | null;
  latestDecision: string | null;
  auditMessageCount: number;
}

export interface MissionEvidenceSummary {
  title: string;
  summary: string;
  role: "technical_evidence";
  defaultState: "collapsed";
  totalSignals: number;
  plannerSignals: number;
  runtimeSignals: number;
  artifactSignals: number;
  patchSignals: number;
  drilldownLabels: string[];
}

export interface MissionRawCardPolicy {
  role: "secondary_audit";
  defaultState: "collapsed";
  drilldownOnly: boolean;
  hiddenFromConversationCount: number;
  foldedPlanningRevisionCount: number;
  preservedKinds: SessionMessageKind[];
  summary: string;
}

export interface MissionSnapshot {
  workspace_contract_version: number;
  missionTitle: string;
  missionSummary: string;
  missionStatusLabel: string;
  missionStatusTone: "neutral" | "warn" | "success" | "danger";
  objective: string | null;
  spec: MissionSpecSummary;
  stages: MissionStageSummary[];
  pipelines: MissionPipeline[];
  checkpoints: MissionCheckpoint[];
  outputs: MissionOutput[];
  workspaceSections: MissionWorkspaceSection[];
  artifactSurfaces: WorkspaceArtifactSurface[];
  nextActionLabel: string | null;
  nextActionDetail: string | null;
  latestUserInstruction: string | null;
  orchestratorReadback: string | null;
  latestOrchestratorReply: string | null;
  activeRouteRevision: number | null;
  activeRouteOption: "primary" | "alternative" | null;
  activeRunId: string | null;
  conversationTurns: number;
  evidenceCount: number;
  conversationRail: MissionConversationRail;
  evidenceSummary: MissionEvidenceSummary;
  rawCardPolicy: MissionRawCardPolicy;
}

export interface MissionView {
  title: string;
  summary: string;
  statusLabel: string;
  statusTone: "neutral" | "warn" | "success" | "danger";
  nextActionLabel: string | null;
  nextActionDetail: string | null;
  routeLabel: string;
  workLabel: string;
  checkpointLabel: string;
  updatedLabel: string;
}

export interface MissionListItem {
  mission_id: string;
  session_id: string;
  title: string;
  status: SessionStatus;
  updated_at: string;
  created_at: string;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  hidden: boolean;
  hidden_at: string | null;
  hidden_by: string | null;
  latest_run_id: string | null;
  active_run_ids: string[];
  message_count: number;
  mission_spec: MissionSpecSummary | null;
  mission_spec_contract: MissionSpecContract | null;
  mission_snapshot: MissionSnapshot | null;
  mission_view: MissionView;
}

export interface MissionDetailResponse {
  mission: MissionListItem;
  session: SessionRecord;
  messages: SessionMessageRecord[];
  latest_run: RunRecord | null;
  attachments: SessionAttachmentRecord[];
  workspace_state?: Record<string, unknown>;
  next_actions?: string[];
  workspace_contract_version?: number | null;
  mission_spec?: MissionSpecSummary | null;
  mission_spec_contract?: MissionSpecContract | null;
  mission_snapshot?: MissionSnapshot | null;
  mission_view?: MissionView;
  runtime_projection?: Record<string, unknown> | null;
}

export interface SessionWorkspaceDetailResponse {
  mission: MissionListItem;
  session: SessionRecord;
  messages: SessionMessageRecord[];
  latest_run: RunRecord | null;
  selected_run_id?: string | null;
  attachments: SessionAttachmentRecord[];
  workspace_state: Record<string, unknown>;
  next_actions: string[];
  workspace_contract_version: number | null;
  mission_spec: MissionSpecSummary | null;
  mission_spec_contract: MissionSpecContract | null;
  mission_snapshot: MissionSnapshot | null;
  mission_view: MissionView;
  runtime_projection?: Record<string, unknown> | null;
  artifacts?: ArtifactRecord[];
  agent_dag?: AgentDagRecord | null;
  agent_dag_artifacts?: AgentArtifactReference[];
  agent_delegations?: AgentDelegationProjection[];
  conversation_actions?: ConversationActionRecord[];
  workspace_change_set?: SessionWorkspaceChangeSetProjection | null;
  workspace_change_sets?: SessionWorkspaceChangeSetProjection[];
  workspace_files?: SessionWorkspaceFileProjection[];
  conversation_summary?: SessionConversationSummary;
  pending_approvals?: ApprovalRecord[];
  pending_human_inputs?: HumanInputRecord[];
  supervision_alerts?: SupervisionAlertRecord[];
  autopilot?: AutopilotControllerRecord | null;
  ui_plan?: MissionUiPlan;
  workspace_binding?: PublicWorkspaceBinding | null;
  task_workspace?: PublicTaskWorkspace | null;
}

/**
 * A task-scoped projection of one DAG node. Hidden child Sessions remain an
 * implementation detail of the Control Plane, while this projection gives
 * the parent Conversation an auditable, clickable Agent work surface.
 */
export interface AgentDelegationProjection {
  dag_id: string;
  parent_dag_id: string | null;
  delegation_depth: number;
  node_id: string;
  task_id: string;
  node_name: string;
  role: AgentRole;
  role_label: string;
  status: AgentTaskStatus | AgentRunStatus;
  objective: string;
  agent_id: string;
  agent_name: string;
  agent_version: number;
  model: string;
  skills: string[];
  agent_run_id: string | null;
  child_session_id: string | null;
  child_session_status: SessionStatus | null;
  child_session_title: string | null;
  parent_session_id: string;
  latest_summary: string | null;
  latest_result_id: string | null;
  messages: SessionMessageRecord[];
  actions: ConversationActionRecord[];
  artifacts: AgentArtifactReference[];
  events: AgentRunEventRecord[];
  latest_event_sequence: number;
}

export interface SessionWorkspaceChangeProjection {
  relative_path: string;
  kind: "added" | "modified" | "deleted";
  before_size_bytes: number | null;
  after_size_bytes: number | null;
  added_lines: number;
  deleted_lines: number;
}

export interface SessionWorkspaceChangeSetProjection {
  change_set_id: string;
  status: "pending" | "applied" | "rejected" | "blocked" | "apply_failed";
  origin: "runtime" | "conversation";
  source_root: string;
  changes: SessionWorkspaceChangeProjection[];
  blocked_reason: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface SessionWorkspaceFileProjection {
  relative_path: string;
  kind: "added" | "modified" | "deleted";
  status: "pending" | "applied";
  change_set_id: string;
  source_root: string;
  before_size_bytes: number | null;
  after_size_bytes: number | null;
  added_lines: number;
  deleted_lines: number;
  created_at: string;
}

export interface SessionConversationSummary {
  message_count: number | null;
  endpoint: string;
}

export type SupervisionAlertSeverity = "info" | "warning" | "critical";
export type SupervisionAlertStatus = "open" | "resolved";
export type SupervisionAlertCategory =
  | "human_decision"
  | "runtime_failure"
  | "runtime_stalled"
  | "quality_gap"
  | "configuration"
  | "autopilot"
  | "memory_recommendation";

export interface SupervisionAlertRecord {
  alert_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string | null;
  category: SupervisionAlertCategory;
  severity: SupervisionAlertSeverity;
  status: SupervisionAlertStatus;
  fingerprint: string;
  title: string;
  detail: string;
  recommended_action: string;
  recommended_action_label: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  occurrence_count: number;
  metadata: Record<string, unknown>;
}

export type AutopilotMode = SharedAutonomyMode;
export type AutopilotPendingGate =
  | "start_confirmation"
  | "workspace_authorization"
  | "runtime_approval"
  | "human_input"
  | "change_review";
export type AutopilotStatus =
  | "disabled"
  | "ready"
  | "running"
  | "waiting_human"
  | "blocked"
  | "paused"
  | "completed"
  | "failed";

export interface AutopilotControllerRecord {
  session_id: string;
  workspace_id: string;
  mode: AutopilotMode;
  status: AutopilotStatus;
  phase: string;
  iteration: number;
  max_iterations: number;
  max_runtime_minutes: number;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  last_tick_at: string | null;
  next_tick_at: string | null;
  last_action: string | null;
  last_detail: string | null;
  handoff_reason: string | null;
  pending_gate?: AutopilotPendingGate | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export type MemoryScopeKind = "user" | "workspace" | "project" | "agent";
export type MemoryKind = "preference" | "fact" | "convention" | "decision" | "lesson";
export type MemorySensitivity = "normal" | "private" | "restricted";
export type MemoryStatus = "active" | "superseded" | "expired" | "deleted";
export type MemorySourceOrigin =
  | "explicit_user"
  | "inferred"
  | "background_review"
  | "imported"
  | "system";

export interface MemorySource {
  origin: MemorySourceOrigin;
  session_id: string | null;
  message_ids: string[];
  action_id: string | null;
  provider_id: string | null;
  note: string | null;
}

export interface MemoryRecord {
  schema_version: 1;
  memory_id: string;
  workspace_id: string;
  scope_kind: MemoryScopeKind;
  scope_id: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
  importance: number;
  sensitivity: MemorySensitivity;
  status: MemoryStatus;
  tags: string[];
  source: MemorySource;
  valid_from: string | null;
  valid_until: string | null;
  expires_at: string | null;
  supersedes_memory_id: string | null;
  version: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

export interface MemoryProposal {
  scope_kind: MemoryScopeKind;
  scope_id: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
  importance: number;
  sensitivity: MemorySensitivity;
  tags: string[];
  source: MemorySource;
  valid_from: string | null;
  valid_until: string | null;
  expires_at: string | null;
  supersedes_memory_id: string | null;
}

export type MemoryCandidateStatus = "pending" | "approved" | "rejected";
export type MemoryCandidateRisk = "low" | "medium" | "high";
export type MemoryCandidateOperation = "create" | "update" | "delete";

export interface MemoryCandidateRecord {
  schema_version: 1;
  candidate_id: string;
  workspace_id: string;
  operation: MemoryCandidateOperation;
  target_memory_id: string | null;
  proposed_memory: MemoryProposal | null;
  source: MemorySource;
  rationale: string;
  risk: MemoryCandidateRisk;
  autonomy_mode: AutopilotMode;
  status: MemoryCandidateStatus;
  proposed_by: string;
  proposed_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  committed_memory_id: string | null;
}

export interface CoreMemorySnapshotEntry {
  memory_id: string;
  memory_version: number;
  scope_kind: MemoryScopeKind;
  scope_id: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
  importance: number;
  sensitivity: Exclude<MemorySensitivity, "restricted">;
  tags: string[];
  source: MemorySource;
  updated_at: string;
}

export interface CoreMemorySnapshot {
  schema_version: 1;
  snapshot_id: string;
  session_id: string;
  workspace_id: string;
  owner_principal_id: string;
  entries: CoreMemorySnapshotEntry[];
  memory_versions: Record<string, number>;
  character_budget: number;
  estimated_token_budget: number;
  digest: string;
  created_at: string;
  project_binding: {
    project_id: string;
    bound_at: string;
  } | null;
  project_entries: CoreMemorySnapshotEntry[];
}

export interface MemorySettings {
  schema_version: 1;
  workspace_id: string;
  background_review: {
    enabled: boolean;
    min_user_characters: number;
    max_candidates_per_review: number;
  };
  automatic_recall: {
    enabled: boolean;
    max_results: number;
    character_budget: number;
    cache_ttl_seconds: number;
  };
  intelligence: {
    extraction_mode: "deterministic" | "hybrid";
    intent_model_enabled: boolean;
    provider_connection_id: string | null;
    model: string | null;
    max_turn_characters: number;
    min_confidence: number;
    model_timeout_ms: number;
  };
  scope_policy: {
    project_memory_enabled: boolean;
    agent_memory_enabled: boolean;
  };
  retention: {
    resolved_candidate_days: number;
    journal_max_records: number;
    maintenance_interval_minutes: number;
    soft_deleted_memory_days: number;
    expired_memory_days: number;
    turn_context_days: number;
    feedback_days: number;
    backup_days: number;
  };
  embedding: {
    provider: "disabled" | "openai-compatible";
    provider_connection_id: string | null;
    model: string | null;
    dimensions: number | null;
  };
  knowledge_graph: {
    provider: "disabled" | "mempalace";
    palace_path: string | null;
    python_bin: string | null;
    sync_canonical: boolean;
  };
  updated_by: string;
  updated_at: string;
}

export interface MemoryObservability {
  schema_version: 1;
  workspace_id: string;
  retrieval_queries: number;
  retrieval_failures: number;
  retrieval_total_latency_ms: number;
  retrieval_last_latency_ms: number | null;
  lexical_hits: number;
  ngram_hits: number;
  embedding_hits: number;
  embedding_fallbacks: number;
  index_rebuilds: number;
  background_reviews: number;
  background_candidates: number;
  background_commits: number;
  model_extraction_attempts: number;
  model_extraction_successes: number;
  model_extraction_fallbacks: number;
  model_proposed_creates: number;
  model_proposed_updates: number;
  model_proposed_supersedes: number;
  model_proposed_deletes: number;
  automatic_recall_queries: number;
  automatic_recall_hits: number;
  automatic_recall_failures: number;
  automatic_recall_cache_hits: number;
  automatic_recall_cache_misses: number;
  automatic_recall_total_latency_ms: number;
  automatic_recall_last_latency_ms: number | null;
  intent_model_attempts: number;
  intent_model_successes: number;
  intent_model_fallbacks: number;
  candidates_approved: number;
  candidates_rejected: number;
  imported_memories: number;
  exported_memories: number;
  maintenance_runs: number;
  maintenance_sweeps: number;
  maintenance_workspace_failures: number;
  private_memory_migrations: number;
  private_candidate_migrations: number;
  last_query_at: string | null;
  last_review_at: string | null;
  last_maintenance_at: string | null;
  updated_at: string;
}

export type MemoryReviewTrigger =
  | "conversation_turn"
  | "context_compaction"
  | "checkpoint"
  | "dag_node_completion"
  | "dag_completion"
  | "reviewer_acceptance"
  | "user_approval"
  | "task_completion";

export interface MemoryReviewRecord {
  schema_version: 1;
  workspace_id: string;
  session_id: string;
  message_digest: string;
  status: "completed" | "skipped" | "failed";
  reviewed_message_ids: string[];
  candidate_ids: string[];
  committed_memory_ids: string[];
  extractor: "deterministic" | "model";
  provider_connection_id: string | null;
  proposed_operations: {
    create: number;
    update: number;
    supersede: number;
    delete: number;
  };
  reason: string | null;
  reviewed_at: string;
  trigger?: MemoryReviewTrigger;
  trigger_id?: string;
}

export type MemoryIntelligenceOperation = "create" | "update" | "supersede" | "delete" | "ignore";

export interface MemoryIntelligenceProposal {
  operation: MemoryIntelligenceOperation;
  target_memory_id: string | null;
  scope_kind: MemoryScopeKind;
  scope_id: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
  importance: number;
  sensitivity: MemorySensitivity;
  tags: string[];
  rationale: string;
}

export interface ConversationIntentRoute {
  schema_version: 1;
  intent: "capture_goal" | "clarify" | "ask_status" | "add_constraint" | "ask_draft" | "ask_plan" | "ask_revise" | "ask_confirm" | "ask_run";
  confidence: number;
  source: "deterministic" | "model";
  entities: Record<string, string | number | boolean | null>;
  risk: "low" | "medium" | "high";
  required_capability: string | null;
  directive_text: string | null;
  reason: string;
}

export interface ConversationIntentEvaluationResult {
  schema_version: 1;
  suite: string;
  total: number;
  passed: number;
  accuracy: number;
  average_confidence: number;
  per_intent: Array<{
    intent: ConversationIntentRoute["intent"];
    total: number;
    passed: number;
    accuracy: number;
  }>;
  cases: Array<{
    fixture_id: string;
    expected_intent: ConversationIntentRoute["intent"];
    actual_intent: ConversationIntentRoute["intent"];
    confidence: number;
    passed: boolean;
  }>;
  memory_operations: {
    total: number;
    passed: number;
    accuracy: number;
    per_operation: Array<{
      operation: MemoryIntelligenceOperation;
      total: number;
      passed: number;
      accuracy: number;
    }>;
    cases: Array<{
      fixture_id: string;
      expected_operation: MemoryIntelligenceOperation;
      actual_operation: MemoryIntelligenceOperation;
      passed: boolean;
    }>;
  };
  evaluated_at: string;
}

export interface MemoryMaintenanceResult {
  schema_version: 1;
  workspace_id: string;
  expired_memories: number;
  pruned_candidates: number;
  retrieval_rebuilt: boolean;
  canonical_memories: number;
  private_memories_migrated: number;
  private_candidates_migrated: number;
  duration_ms: number;
  completed_at: string;
}

export interface MemoryMaintenanceSweepResult {
  schema_version: 1;
  workspace_count: number;
  maintained_workspaces: number;
  skipped_workspaces: number;
  failed_workspaces: Array<{ workspace_id: string; error: string }>;
  results: MemoryMaintenanceResult[];
  completed_at: string;
}

export interface MemoryExportBundle {
  schema_version: 1;
  exported_at: string;
  workspace_id: string;
  count: number;
  memories: MemoryRecord[];
}

export interface MemoryImportResult {
  dry_run: boolean;
  strategy: "skip" | "merge" | "replace";
  total: number;
  created: number;
  updated: number;
  skipped: number;
  rejected: number;
  errors: Array<{ index: number; message: string }>;
  memory_ids: string[];
}

export interface SessionRecallContextMessage {
  message_id: string;
  role: SessionMessageRole;
  kind: SessionMessageKind;
  text: string;
  created_at: string;
  matched: boolean;
}

export interface SessionRecallHit {
  session_id: string;
  session_title: string;
  matched_message_id: string;
  matched_at: string;
  score: number;
  context: SessionRecallContextMessage[];
}

export interface SessionRecallResult {
  query: string;
  workspace_id: string;
  current_session_id: string;
  count: number;
  index_rebuilt: boolean;
  hits: SessionRecallHit[];
}

export type MemoryRetrievalMode =
  | "hybrid_lexical_ngram_v1"
  | "hybrid_lexical_embedding_v1";

export interface MemoryRetrievalEvidence {
  lexical_score: number;
  semantic_score: number;
  fused_score: number;
  lexical_rank: number | null;
  semantic_rank: number | null;
  matched_by: Array<"lexical" | "ngram" | "embedding">;
}

export interface MemoryRetrievalHit {
  memory: MemoryRecord;
  evidence: MemoryRetrievalEvidence;
}

export interface MemoryRecommendation {
  schema_version: 1;
  session_id: string;
  memory_id: string;
  memory_version: number;
  scope_kind: MemoryScopeKind;
  scope_id: string;
  kind: MemoryKind;
  sensitivity: Exclude<MemorySensitivity, "restricted">;
  title: string;
  summary: string;
  reason: string;
  score: number;
  already_in_snapshot: boolean;
  applied_automatically: boolean;
  snapshot_version: number | null;
  updated_at: string;
  recommendation_id: string;
  application_state: "available" | "queued" | "kept" | "applied" | "dismissed";
  last_applied_context_id: string | null;
  available_actions: Array<"use_next_turn" | "keep_for_session" | "dismiss_for_session" | "not_relevant" | "edit_requested" | "forget_requested">;
}

export type TurnMemoryContextSource = "core_snapshot" | "automatic_recall" | "manual_overlay";

export interface TurnMemoryContextEntry {
  memory_id: string;
  memory_version: number;
  source: TurnMemoryContextSource;
  scope_kind: MemoryScopeKind;
  scope_id: string;
  kind: MemoryKind;
  sensitivity: Exclude<MemorySensitivity, "restricted">;
  content: string;
  content_digest: string;
}

export interface TurnMemoryContextSnapshot {
  schema_version: 1;
  context_id: string;
  workspace_id: string;
  session_id: string;
  source_user_message_id: string;
  provider_connection_id: string | null;
  model: string | null;
  entries: TurnMemoryContextEntry[];
  character_count: number;
  prompt_digest: string;
  created_at: string;
}

export type MemoryOverlayMode = "next_turn" | "session";
export type MemoryOverlayStatus = "queued" | "active" | "consumed" | "revoked" | "stale";

export interface MemoryOverlayRecord {
  schema_version: 1;
  overlay_id: string;
  workspace_id: string;
  session_id: string;
  memory_id: string;
  memory_version: number;
  mode: MemoryOverlayMode;
  status: MemoryOverlayStatus;
  entry: Omit<TurnMemoryContextEntry, "source">;
  created_by: string;
  created_at: string;
  consumed_context_id: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
}

export type MemoryRecommendationFeedbackAction =
  | "use_next_turn"
  | "keep_for_session"
  | "dismiss_for_session"
  | "not_relevant"
  | "edit_requested"
  | "forget_requested";

export interface MemoryRecommendationFeedback {
  schema_version: 1;
  feedback_id: string;
  recommendation_id: string;
  workspace_id: string;
  session_id: string;
  memory_id: string;
  memory_version: number;
  action: MemoryRecommendationFeedbackAction;
  reason_code: "useful" | "wrong_task" | "outdated" | "incorrect" | "too_sensitive" | "other" | null;
  actor_id: string;
  created_at: string;
}

export type MemoryOnboardingStatus = "not_started" | "in_progress" | "completed" | "dismissed";

export interface MemoryOnboardingRecord {
  schema_version: 1;
  workspace_id: string;
  principal_id: string;
  status: MemoryOnboardingStatus;
  step: number;
  draft_entries: Array<{
    content: string;
    kind: MemoryKind;
    scope_kind: "user" | "workspace" | "project";
    scope_id: string | null;
    sensitivity: Exclude<MemorySensitivity, "restricted">;
    tags: string[];
    origin: "explicit" | "inferred";
  }>;
  committed_memory_ids: string[];
  candidate_ids: string[];
  started_at: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
  updated_at: string;
}

export interface MemoryEffectiveness {
  schema_version: 1;
  workspace_id: string;
  turn_contexts: number;
  applied_memories: number;
  recommendation_feedback: number;
  accepted_recommendations: number;
  dismissed_recommendations: number;
  not_relevant_recommendations: number;
  acceptance_rate: number;
  dismissal_rate: number;
  stale_overlays: number;
  evaluated_tasks: number;
  evaluated_tasks_with_memory: number;
  evaluation_join_rate: number;
  correlation_note: string;
  context_total_latency_ms: number;
  context_last_latency_ms: number | null;
  evaluated_at: string;
}

export interface MemoryKeyStatus {
  schema_version: 1;
  workspace_id: string;
  active_key_id: string;
  active_key_created_at: string;
  retained_key_count: number;
  last_rotated_at: string | null;
  root_source: "environment" | "local_file";
}

export interface MemoryIntegrityReport {
  schema_version: 1;
  report_id: string;
  workspace_id: string;
  status: "healthy" | "degraded";
  checked_records: number;
  encrypted_records: number;
  invalid_records: number;
  orphan_references: number;
  issues: Array<{
    code: string;
    record_type: string;
    record_id: string | null;
  }>;
  scanned_at: string;
}

export interface MemoryPurgeResult {
  schema_version: 1;
  purge_id: string;
  workspace_id: string;
  memory_id: string;
  removed_records: number;
  removed_by_type: Record<string, number>;
  retrieval_rebuilt: boolean;
  knowledge_rebuilt: boolean;
  cryptographic_erasure: boolean;
  completed_at: string;
}

export interface MemoryRetentionRunResult {
  schema_version: 1;
  workspace_id: string;
  purged_memories: number;
  pruned_contexts: number;
  pruned_feedback: number;
  pruned_backups: number;
  completed_at: string;
}

export interface MemoryBackupMetadata {
  schema_version: 1;
  backup_id: string;
  workspace_id: string;
  record_count: number;
  encrypted_bytes: number;
  manifest_digest: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
}

export interface MemoryRestoreResult {
  schema_version: 1;
  backup_id: string;
  workspace_id: string;
  dry_run: boolean;
  restored_records: number;
  skipped_records: number;
  verified_digest: boolean;
  completed_at: string;
}

export interface MemoryOperationsStatus {
  schema_version: 1;
  workspace_id: string;
  key: MemoryKeyStatus;
  retention: MemorySettings["retention"];
  backups: MemoryBackupMetadata[];
  last_integrity: MemoryIntegrityReport | null;
}

export interface MemoryCollection {
  schema_version: 1;
  collection_id: string;
  kind: "team" | "organization";
  name: string;
  owner_workspace_id: string;
  member_workspace_ids: string[];
  status: "active" | "archived";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryShareGrant {
  schema_version: 1;
  share_id: string;
  collection_id: string;
  source_workspace_id: string;
  source_memory_id: string;
  source_memory_version: number;
  target_workspace_ids: string[];
  mode: "read_only" | "suggest_changes";
  version_policy: "pinned" | "follow_latest";
  status: "active" | "revoked";
  published_content: string;
  published_digest: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface SharedMemoryView {
  share: Omit<MemoryShareGrant, "published_content">;
  collection: MemoryCollection;
  projected_memory: MemoryRecord;
  freshness: "current" | "stale" | "source_unavailable";
}

export interface MemoryConflictRecord {
  schema_version: 1;
  conflict_id: string;
  workspace_id: string;
  kind: "shared_suggestion" | "external_update";
  status: "pending" | "resolved" | "dismissed";
  target_memory_id: string;
  share_id: string | null;
  source_id: string | null;
  external_id: string | null;
  external_version: string | null;
  base_memory_version: number;
  current_content: string;
  proposed_content: string;
  proposed_deleted: boolean;
  proposed_kind: MemoryKind;
  proposed_tags: string[];
  proposed_by: string;
  resolution: "accept_proposed" | "keep_current" | "merge" | "dismiss" | null;
  resolved_memory_version: number | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface MemoryExternalSource {
  schema_version: 1;
  source_id: string;
  workspace_id: string;
  name: string;
  provider: "mcp" | "push";
  server_id: string | null;
  tool_name: string | null;
  tool_arguments: Record<string, unknown>;
  collection_id: string | null;
  status: "active" | "disabled" | "degraded";
  last_cursor: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryExternalItem {
  external_id: string;
  external_version: string;
  content: string;
  kind: MemoryKind;
  tags: string[];
  deleted?: boolean;
}

export interface MemorySyncRun {
  schema_version: 1;
  sync_id: string;
  workspace_id: string;
  source_id: string;
  status: "completed" | "partial" | "failed";
  received: number;
  created: number;
  updated: number;
  deleted: number;
  conflicts: number;
  skipped: number;
  cursor: string | null;
  error: string | null;
  completed_at: string;
}

export interface MemoryEmbeddingProviderStatus {
  provider_id: string;
  state: "disabled" | "ready" | "degraded";
  model: string | null;
  dimensions: number | null;
  fingerprint: string | null;
  cached_vectors: number;
  last_error: string | null;
}

export interface MemoryRetrievalIndexStatus {
  schema_version: 1;
  retrieval: MemoryRetrievalMode;
  workspace_id: string;
  journal_records: number;
  indexed_records: number;
  active_records: number;
  database_bytes: number;
  last_rebuilt_at: string | null;
  embedding: MemoryEmbeddingProviderStatus;
}

export interface MemoryRetrievalResult {
  query: string;
  workspace_id: string;
  count: number;
  retrieval: MemoryRetrievalMode;
  index_rebuilt: boolean;
  embedding_fallback: boolean;
  hits: MemoryRetrievalHit[];
}

export interface MemoryKnowledgeProviderStatus {
  provider_id: "disabled" | "mempalace";
  state: "disabled" | "ready" | "unavailable" | "degraded";
  read_only: boolean;
  palace_path: string | null;
  canonical_source: "my_mate_memory_records";
  last_error: string | null;
}

export interface MemoryKnowledgeRelation {
  subject: string;
  predicate: string;
  object: string;
  valid_from: string | null;
  valid_until: string | null;
  memory_id: string | null;
}

export interface MemoryKnowledgeQueryResult {
  provider: MemoryKnowledgeProviderStatus;
  entity: string;
  count: number;
  relations: MemoryKnowledgeRelation[];
}

export type TaskCheckpointStatus = SharedTaskCheckpointStatus;

export type TaskCheckpointReason =
  | "turn_started"
  | "manual_resume"
  | "automatic_resume"
  | "context_compacted"
  | "continuation_limit"
  | "tool_round_limit"
  | "completion_contract_incomplete"
  | "budget_limit"
  | "provider_interrupted"
  | "client_disconnected"
  | "server_restart"
  | "waiting_approval"
  | "waiting_input"
  | "turn_completed"
  | "resume_limit"
  | "new_user_turn"
  | "unrecoverable_error";

export interface TaskCheckpointTransition {
  version: number;
  status: TaskCheckpointStatus;
  reason: TaskCheckpointReason;
  detail: string | null;
  created_at: string;
}

export interface TaskCheckpointProviderState {
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "unknown" | null;
  continuation_rounds: number;
  continuation_limit_reached: boolean;
  context_compacted: boolean;
  compaction_count: number;
  in_loop_compaction_count: number;
  context_snapshot_id: string | null;
  context_pressure_peak_tokens: number;
  pruned_tool_result_count: number;
  repeated_tool_call_limit_reached: boolean;
  tool_rounds: number;
  tool_round_limit_reached: boolean;
  action_ids: string[];
  completion_contract: {
    status: "satisfied" | "incomplete" | "blocked";
    reason: string;
    successful_action_ids: string[];
    failed_action_ids: string[];
  };
}

export interface LongTaskRuntimeState {
  schema_version: 1;
  started_at: string;
  updated_at: string;
  elapsed_ms: number;
  turn_attempts: number;
  resume_attempts: number;
  cumulative_input_tokens: number;
  cumulative_reported_input_tokens: number;
  cumulative_estimated_input_tokens: number;
  input_token_accounting: "reported" | "estimated" | "mixed" | "unavailable";
  cumulative_output_tokens: number;
  cumulative_total_tokens: number;
  max_wall_time_ms: number;
  max_turn_attempts: number;
  max_total_tokens: number;
  cost_status: "unavailable" | "partial" | "complete";
  cumulative_costs: Record<string, string>;
  exhausted: boolean;
  exhausted_reason: "wall_time" | "turn_attempts" | "total_tokens" | null;
}

export interface TaskCheckpointRecord {
  schema_version: 1;
  checkpoint_id: string;
  workspace_id: string;
  session_id: string;
  autonomy_mode: AutopilotMode;
  status: TaskCheckpointStatus;
  reason: TaskCheckpointReason;
  version: number;
  goal: string | null;
  source_user_message_id: string;
  source_assistant_message_id: string | null;
  resume_from_checkpoint_id: string | null;
  resume_attempts: number;
  max_resume_attempts: number;
  auto_resume_eligible: boolean;
  progress_summary: string | null;
  context_summary: string | null;
  next_action: string | null;
  provider_state: TaskCheckpointProviderState | null;
  long_task_runtime: LongTaskRuntimeState;
  last_error_code: string | null;
  last_error_message: string | null;
  transitions: TaskCheckpointTransition[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type MissionUiComponent =
  | "task_guidance"
  | "decision_queue"
  | "progress_summary"
  | "result_gallery"
  | "quality_summary"
  | "repair_recommendation"
  | "conversation"
  | "technical_details";

export interface MissionUiBlock {
  block_id: string;
  component: MissionUiComponent;
  priority: number;
  visibility: "primary" | "secondary" | "advanced";
  title: string;
  data: Record<string, unknown>;
}

export interface MissionUiPlan {
  version: 1;
  phase: string;
  generated_at: string;
  primary_action: string | null;
  blocks: MissionUiBlock[];
  fallback_component: "task_guidance";
}

export interface RuntimeSummary {
  execution_runtime: {
    adapter_kind: string;
    registered_adapter_kinds: string[];
    local_execution_enabled: boolean;
    auto_approve_human_gates: boolean;
    runtime_health: {
      status: "ok" | "warn";
      detail: string;
    };
    maintenance: {
      supported_actions: Array<"dispatch_sweep">;
    };
    runtime_dispatcher: {
      kind: string;
      dispatch_mainline: "runtime-worker-job";
      legacy_execution_adapter_bridge: boolean;
    };
    node_provisioner: {
      kind: string;
      status: "not_wired" | "ready" | "deferred";
      capacity: {
        max_concurrent_workers: number;
        active_workers: number;
        queue_depth: number;
        queue_limit: number;
        queue_timeout_ms: number;
      };
      recovery: {
        cleanup_pending: number;
        cleanup_failed: number;
        last_reconciliation_at: string | null;
        last_reconciliation_status: "not_run" | "healthy" | "degraded" | "failed";
        discovered_containers: number;
        orphan_containers: number;
        removed_containers: number;
        cleanup_failures: number;
      };
    };
    worker_hub: {
      kind: string | null;
      connected_workers: number;
      busy_workers: number;
      stale_workers: number;
    };
  };
  planner: {
    provider_id: string;
    provider_name: string;
    fallback_provider_id: string;
    fallback_provider_name: string;
    registered_provider_ids: string[];
    llm_model: string;
    llm_max_tokens: number;
    llm_timeout_ms: number;
  };
  registry: {
    agent_definition_count: number;
    active_agent_definition_count: number;
    skill_count: number;
    active_skill_count: number;
    template_count: number;
    published_template_count: number;
    draft_template_count: number;
  };
}

export interface SessionWorkspaceStreamSnapshot {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  latest_run: RunRecord | null;
  workspace_state: Record<string, unknown>;
  next_actions: string[];
  mission_snapshot: MissionSnapshot | null;
  mission_spec: MissionSpecSummary | null;
  mission_spec_contract: MissionSpecContract | null;
  attachments: SessionAttachmentRecord[];
  artifacts: ArtifactRecord[];
  pending_approvals: ApprovalRecord[];
  pending_human_inputs: HumanInputRecord[];
  interventions: SessionInterventionRecord[];
  dag_patches: DagPatchRecord[];
  supervision_alerts: SupervisionAlertRecord[];
  autopilot: AutopilotControllerRecord | null;
  ui_plan: MissionUiPlan;
  workspace_binding?: PublicWorkspaceBinding | null;
}

export interface SessionWorkspaceStreamEvent {
  event_id: string;
  type:
    | "snapshot"
    | "session.updated"
    | "workspace.updated"
    | "mission.updated"
    | "messages.updated"
    | "latest_run.updated"
    | "artifacts.updated"
    | "attachments.updated"
    | "approvals.updated"
    | "human_inputs.updated"
    | "interventions.updated"
    | "dag_patches.updated"
    | "supervision.updated"
    | "autopilot.updated"
    | "ui_plan.updated"
    | "heartbeat";
  session_id: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

export interface RetryPolicy {
  max_attempts: number;
  backoff_seconds: number;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  /** Read-only migration input. Canonical templates use agent_id. */
  agent_profile?: string | null;
  agent_id?: string | null;
  agent_version?: number | null;
  agent_binding_snapshot?: AgentBindingSnapshot | null;
  allowed_skills: string[];
  config: Record<string, unknown>;
  retry_policy: RetryPolicy;
  timeout_seconds: number;
  parallelism: number;
  approval_kind: string | null;
  human_input_schema: Record<string, unknown> | null;
  work_package?: WorkPackageBinding;
}

export interface WorkPackageBinding {
  key: string;
  label: string;
  order: number;
}

export type WorkPackageIdentitySource =
  | "declared"
  | "compiler_default"
  | "legacy_inferred";

export interface CompiledWorkPackageBinding extends WorkPackageBinding {
  identity_source: WorkPackageIdentitySource;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  from_port?: string | null;
  to_port?: string | null;
  condition: Record<string, unknown> | null;
  label: string | null;
}

export interface TemplatePolicy {
  max_parallel_nodes: number;
  default_timeout_seconds: number;
  budget_policy: Record<string, unknown>;
  approval_policy: Record<string, unknown>;
  scorecard?: {
    profile: string;
    version: number;
    enforcement: "off" | "advisory" | "strict";
    settle_timeout_seconds: number;
    checks: ScorecardCheckDefinition[];
  };
}

export interface ScorecardCheckSelector {
  node_id?: string;
  node_run_id?: string;
  work_package?: string;
}

interface ScorecardCheckBase {
  id: string;
  severity?: "error" | "warning";
  selector?: ScorecardCheckSelector;
}

export type ScorecardCheckDefinition =
  | (ScorecardCheckBase & {
      type: "required_evidence";
      kinds: string[];
      min_count?: number;
    })
  | (ScorecardCheckBase & {
      type: "required_tool";
      names: string[];
      min_calls?: number;
      max_calls?: number;
    })
  | (ScorecardCheckBase & {
      type: "artifact_contract";
      artifact_type?: string;
      mime_type?: string;
      name_pattern?: string;
      metadata_schema?: Record<string, unknown>;
      min_count?: number;
      require_resolvable_uri?: boolean;
    })
  | (ScorecardCheckBase & {
      type: "handoff_schema";
      schema: Record<string, unknown>;
      min_count?: number;
    })
  | (ScorecardCheckBase & {
      type: "test_category";
      categories: Array<"lint" | "unit" | "integration" | "security" | "rollback">;
    })
  | (ScorecardCheckBase & {
      type: "deterministic_assertion";
      subject: "run" | "route" | "evidence" | "artifact" | "handoff";
      path: string;
      operator: "equals" | "contains" | "regex" | "numeric_range";
      expected?: unknown;
      min?: number;
      max?: number;
      match?: "any" | "all";
      quality?: boolean;
    });

export interface WorkflowTemplateRecord {
  template_id: string;
  version: number;
  name: string;
  status: TemplateStatus;
  description: string;
  workspace_scope: string;
  input_schema: Record<string, unknown>;
  policy: TemplatePolicy;
  /** Read-only migration input. Canonical templates pin node Agent bindings. */
  agent_profile_bindings?: Record<string, unknown>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface TemplateVersioningMetadata {
  family_id: string;
  root_template_id: string;
  source_template_id: string | null;
  source_version: number | null;
  previous_template_id: string | null;
  previous_version: number | null;
  derivation_kind: "initial" | TemplateDerivationKind;
  generation: number;
}

export interface DeriveTemplateRequest {
  template_id?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionRecord {
  session_id: string;
  workspace_id?: string;
  title: string;
  status: SessionStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  current_goal: string | null;
  current_plan_summary: string | null;
  latest_run_id: string | null;
  active_run_ids: string[];
  last_orchestrator_message_id: string | null;
  confirmed_plan_revision: number | null;
  confirmed_plan_option: "primary" | "alternative" | null;
  confirmed_proposal_id: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  hidden: boolean;
  hidden_at: string | null;
  hidden_by: string | null;
  metadata: Record<string, unknown>;
  mission_spec?: MissionSpecSummary | null;
  mission_spec_contract?: MissionSpecContract | null;
  mission_snapshot?: MissionSnapshot | null;
}

export type AgentAutonomyMode = SharedAutonomyMode;
export type AgentBindingMode = "pinned" | "follow_latest";
export type AgentRunKind = "conversation" | "workflow_node" | "schedule" | "continuation" | "delegation" | "review";
export type AgentRunStatus = SharedAgentRunStatus;
export type AgentRole = SharedAgentRole;

export interface ProviderDefinitionRecord {
  provider_id: string;
  workspace_id: string;
  name: string;
  protocol: ProviderConnectionRecord["protocol"];
  provider_family: string;
  capabilities: string[];
  status: RegistryStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ModelDeploymentRecord {
  deployment_id: string;
  workspace_id: string;
  provider_id: string;
  connection_id: string;
  model: string;
  display_name: string;
  modalities: string[];
  context_window: number;
  max_output_tokens: number;
  supports_tools: boolean;
  supports_streaming: boolean;
  status: RegistryStatus;
  connection_revision: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentDefinitionRecord {
  agent_id: string;
  workspace_id: string;
  name: string;
  description: string;
  latest_version: number;
  published_version: number | null;
  status: RegistryStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentVersionRecord {
  agent_id: string;
  workspace_id: string;
  version: number;
  status: "draft" | "published" | "retired";
  role: AgentRole;
  responsibility?: string;
  system_prompt: string;
  model_policy: {
    deployment_id: string | null;
    provider_connection_id: string | null;
    model: string | null;
    allow_runtime_override: boolean;
    routing_preference?: "quality" | "balanced" | "cost" | "latency";
    fallback_models?: string[];
    allow_model_escalation?: boolean;
  };
  capability_policy?: {
    capability_tags: string[];
    allow_delegation: boolean;
    input_contract: Record<string, unknown>;
    output_contract: Record<string, unknown>;
    acceptance_criteria: string[];
    verification_steps: string[];
  };
  tool_policy: {
    allowed_tools: string[];
    denied_tools: string[];
    max_tool_rounds: number | null;
  };
  skill_policy: {
    locked_skills: Array<{ skill_id: string; version: string | null }>;
    denied_skills: string[];
    dynamic_activation: boolean;
  };
  memory_policy: {
    enabled: boolean;
    automatic_recall: boolean;
    write_mode: "disabled" | "review" | "automatic";
  };
  context_policy: {
    compression_enabled: boolean;
    compression_threshold_percent: number;
    max_continuation_rounds: number | null;
  };
  runtime_policy: {
    runtime: "native";
    sandbox: "local" | "docker" | "isolated" | "auto";
    timeout_seconds: number;
  };
  workspace_policy: {
    read: boolean;
    write: boolean;
    allowed_project_ids: string[];
  };
  autonomy_ceiling: AgentAutonomyMode;
  artifact_policy: Record<string, unknown>;
  delivery_policy: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  published_at: string | null;
}

export interface AgentTeamMember {
  member_id: string;
  agent_id: string;
  agent_version: number | null;
  role: AgentRole;
  capability_tags: string[];
  required: boolean;
}

export interface AgentTeamRecord {
  team_id: string;
  workspace_id: string;
  name: string;
  description: string;
  orchestrator_member_id: string;
  reviewer_member_ids: string[];
  members: AgentTeamMember[];
  policy: {
    max_concurrency: number;
    max_delegation_depth: number;
    max_total_agent_runs: number;
    max_total_tool_rounds: number;
    max_runtime_seconds: number;
    require_reviewer: boolean;
    cancel_children_on_parent_cancel: boolean;
  };
  status: RegistryStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentArtifactReference {
  artifact_id: string;
  kind: string;
  name: string;
  uri: string | null;
  mime_type: string | null;
  sha256: string | null;
  size_bytes: number | null;
  producer_agent_run_id: string | null;
  metadata: Record<string, unknown>;
}

export type AgentTaskStatus = SharedAgentTaskStatus;

export type AgentDagJoinPolicy = "all" | "any" | "quorum";
export type AgentDagConditionOperator = "exists" | "truthy" | "equals" | "not_equals" | "contains";
export interface AgentDagCondition {
  path: string;
  operator: AgentDagConditionOperator;
  value?: unknown;
}

export interface AgentDagStateMapping {
  source_path: string;
  target_path: string;
  reducer: "replace" | "merge" | "append";
}

export interface AgentReviewerVerdict {
  verdict: "accepted" | "rejected";
  criteria: Array<{ name: string; passed: boolean; detail: string }>;
  issues: string[];
  required_revisions: string[];
}

export interface AgentHumanGateConfig {
  gate_type: "approval" | "input";
  prompt: string;
  input_schema: Record<string, unknown>;
  auto_resume: boolean;
}
export interface AgentTaskRecord {
  task_id: string;
  workspace_id: string;
  dag_id: string;
  dag_run_id: string | null;
  node_id: string;
  parent_task_id: string | null;
  depth: number;
  status: AgentTaskStatus;
  title: string;
  objective: string;
  context: Record<string, unknown>;
  expected_output: Record<string, unknown>;
  acceptance_criteria?: string[];
  verification_steps?: string[];
  binding_snapshot: AgentBindingSnapshot;
  permission_ceiling: {
    autonomy_mode: AgentAutonomyMode;
    allowed_tools: string[];
    workspace_read: boolean;
    workspace_write: boolean;
  };
  budget: {
    max_tool_rounds: number;
    max_runtime_seconds: number;
    max_output_tokens: number | null;
  };
  assigned_agent_run_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface AgentResultRecord {
  result_id: string;
  task_id: string;
  agent_run_id: string;
  status: "completed" | "blocked" | "failed" | "cancelled";
  summary: string;
  output: Record<string, unknown>;
  artifact_refs: AgentArtifactReference[];
  verification: {
    status: "unverified" | "verified" | "rejected";
    reviewer_agent_run_id: string | null;
    evidence: Record<string, unknown>;
  };
  error_code: string | null;
  created_at: string;
}

export type AgentMessageType =
  | "task.request"
  | "task.accepted"
  | "task.progress"
  | "task.blocked"
  | "artifact.published"
  | "task.result"
  | "task.failed"
  | "task.cancel"
  | "task.steer"
  | "gate.requested"
  | "gate.resolved"
  | "agent.heartbeat";

export interface AgentMessageEnvelope {
  schema_version: 1;
  message_id: string;
  message_type: AgentMessageType;
  workspace_id: string;
  dag_id: string;
  dag_run_id: string | null;
  task_id: string;
  from_agent_run_id: string | null;
  to_agent_run_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string;
  payload: Record<string, unknown>;
  artifact_refs: AgentArtifactReference[];
  created_at: string;
}

export interface AgentDagNode {
  node_id: string;
  name: string;
  task_id: string;
  binding_snapshot: AgentBindingSnapshot;
  role: AgentRole;
  kind: DagDefinitionNodeKind;
  depends_on: string[];
  join_policy: AgentDagJoinPolicy;
  join_quorum: number | null;
  condition: AgentDagCondition | null;
  state_input: Record<string, string>;
  state_output: AgentDagStateMapping[];
  human_gate: AgentHumanGateConfig | null;
  retry_policy: RetryPolicy;
  status: AgentTaskStatus;
  reviewer_node_id: string | null;
  acceptance_criteria?: string[];
  verification_steps?: string[];
  metadata: Record<string, unknown>;
}

export interface AgentDagRecord {
  schema_version: 1;
  dag_id: string;
  workspace_id: string;
  session_id: string;
  source_message_id: string | null;
  idempotency_key: string;
  team_id: string | null;
  title: string;
  objective: string;
  execution_contract?: ExecutionContract | null;
  status: SharedAgentDagStatus;
  orchestrator_binding: AgentBindingSnapshot;
  parent_dag_id: string | null;
  delegation_depth: number;
  nodes: AgentDagNode[];
  state_schema: Record<string, unknown>;
  state: Record<string, unknown>;
  state_revision: number;
  policy: AgentTeamRecord["policy"];
  budget_usage: {
    agent_runs: number;
    tool_rounds: number;
    runtime_seconds: number;
  };
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AgentDagGateRecord {
  gate_id: string;
  workspace_id: string;
  dag_id: string;
  node_id: string;
  task_id: string;
  gate_type: "approval" | "input";
  status: "pending" | "approved" | "rejected" | "submitted" | "cancelled";
  prompt: string;
  input_schema: Record<string, unknown>;
  response: Record<string, unknown> | null;
  auto_resume: boolean;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface AgentBindingSnapshot {
  schema_version: 2;
  binding_id: string;
  binding_mode: AgentBindingMode;
  agent_id: string;
  agent_version: number;
  agent_name: string;
  agent_role: AgentRole;
  responsibility?: string;
  provider_id: string;
  provider_connection_id: string;
  connection_revision: string;
  model_deployment_id: string;
  model: string;
  model_routing_policy?: {
    routing_preference: "quality" | "balanced" | "cost" | "latency";
    fallback_models: string[];
    allow_model_escalation: boolean;
  };
  system_prompt: string;
  tool_policy: AgentVersionRecord["tool_policy"];
  skill_policy: AgentVersionRecord["skill_policy"];
  capability_policy?: NonNullable<AgentVersionRecord["capability_policy"]>;
  memory_policy: AgentVersionRecord["memory_policy"];
  context_policy: AgentVersionRecord["context_policy"];
  runtime_policy: AgentVersionRecord["runtime_policy"];
  workspace_policy: AgentVersionRecord["workspace_policy"];
  autonomy_ceiling: AgentAutonomyMode;
  artifact_policy: Record<string, unknown>;
  delivery_policy: Record<string, unknown>;
  snapshot_digest: string;
  created_at: string;
}

export interface AgentRunRecord {
  agent_run_id: string;
  workspace_id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  binding_snapshot: AgentBindingSnapshot;
  session_id: string | null;
  workflow_run_id: string | null;
  node_run_id: string | null;
  schedule_id: string | null;
  schedule_run_id: string | null;
  parent_agent_run_id: string | null;
  attempt: number;
  input_digest: string | null;
  output_digest: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  metadata: Record<string, unknown>;
}

export type AgentRunEventType =
  | "task.assigned"
  | "agent.started"
  | "agent.progress"
  | "agent.message.delta"
  | "agent.message.completed"
  | "tool.started"
  | "tool.waiting_approval"
  | "tool.completed"
  | "tool.failed"
  | "checkpoint.saved"
  | "artifact.created"
  | "handoff.returned"
  | "agent.completed"
  | "agent.failed"
  | "agent.cancelled";

export type AgentRunEventStatus =
  | "info"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface AgentRunEventRecord {
  event_id: string;
  workspace_id: string;
  dag_id: string;
  node_id: string;
  task_id: string;
  agent_run_id: string;
  child_session_id: string | null;
  sequence: number;
  type: AgentRunEventType;
  status: AgentRunEventStatus;
  summary: string;
  payload: Record<string, unknown>;
  idempotency_key: string | null;
  created_at: string;
}

export interface SessionMessageRecord {
  message_id: string;
  session_id: string;
  role: SessionMessageRole;
  kind: SessionMessageKind;
  content: Record<string, unknown>;
  created_at: string;
  linked_run_id: string | null;
  linked_node_run_id: string | null;
}

export type ConversationActionRiskLevel = "T0" | "T1" | "T2" | "T3";
export type ConversationActionStatus = "running" | "succeeded" | "failed" | "pending_approval";

export interface ConversationActionRecord {
  action_id: string;
  workspace_id: string;
  session_id: string;
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  idempotency_key: string | null;
  arguments_digest: string;
  risk_level: ConversationActionRiskLevel;
  executor: "control-plane" | "runtime-worker" | "desktop" | "browser" | "mcp";
  status: ConversationActionStatus;
  approval_id: string | null;
  result: Record<string, unknown> | null;
  error_code: string | null;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface CreateSessionRequest {
  title?: string;
  initial_message?: string;
  created_by?: string;
  provider_connection_id?: string;
  model?: string;
  defer_conversation_reply?: boolean;
  autonomy_mode?: AutopilotMode;
  agent_id?: string;
  agent_version?: number;
  agent_binding_mode?: AgentBindingMode;
}

export type WorkspaceBindingAccess = "snapshot-read" | "sandbox-write";
export type WorkspaceBindingScope = "run" | "session" | "persistent";
export type WorkspaceBindingStatus = "active" | "expired" | "revoked" | "invalid";

export type LocalProjectStatus = "active" | "archived" | "unavailable";

export interface LocalProjectRecord {
  project_id: string;
  workspace_id: string;
  desktop_instance_id: string;
  capability_digest: string;
  root_path: string;
  root_fingerprint: string;
  name: string;
  description: string | null;
  status: LocalProjectStatus;
  default_output_relative_path: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  metadata: Record<string, unknown>;
}

export type PublicLocalProject = Pick<
  LocalProjectRecord,
  | "project_id"
  | "name"
  | "description"
  | "status"
  | "default_output_relative_path"
  | "created_at"
  | "updated_at"
  | "archived_at"
>;

export type TaskWorkspaceStatus = "active" | "archived";

export interface TaskWorkspaceRecord {
  task_workspace_id: string;
  workspace_id: string;
  session_id: string;
  project_id: string;
  binding_id: string;
  output_relative_path: string;
  status: TaskWorkspaceStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  metadata: Record<string, unknown>;
}

export interface PublicTaskWorkspace {
  task_workspace_id: string;
  session_id: string;
  project: PublicLocalProject;
  binding_id: string;
  output_relative_path: string;
  status: TaskWorkspaceStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface WorkspaceBindingRecord {
  binding_id: string;
  workspace_id: string;
  session_id: string;
  desktop_instance_id: string;
  capability_digest: string;
  root_path: string;
  root_fingerprint: string;
  display_name: string;
  access: WorkspaceBindingAccess;
  scope: WorkspaceBindingScope;
  status: WorkspaceBindingStatus;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_validated_at: string;
  metadata: Record<string, unknown>;
}

export type PublicWorkspaceBinding = Pick<
  WorkspaceBindingRecord,
  | "binding_id"
  | "session_id"
  | "display_name"
  | "access"
  | "scope"
  | "status"
  | "expires_at"
  | "updated_at"
>;

export interface CreateSessionMessageRequest {
  content: string;
  provider_connection_id?: string;
  model?: string;
  target_artifact_id?: string;
}

export interface CreateSessionMessageResponse {
  session: SessionRecord;
  user_message: SessionMessageRecord;
  messages: SessionMessageRecord[];
}

export type SessionInterventionKind =
  | "guidance"
  | "change_request"
  | "pause_request"
  | "resume_request"
  | "skip_request"
  | "add_node_request"
  | "parallelism_request";

export type SessionInterventionStatus =
  | "recorded"
  | "queued_for_next_pass"
  | "needs_review"
  | "applied"
  | "rejected";

export interface SessionInterventionRecord {
  intervention_id: string;
  session_id: string;
  run_id: string | null;
  node_run_id: string | null;
  requested_by: string;
  kind: SessionInterventionKind;
  status: SessionInterventionStatus;
  content: string;
  summary: string;
  interpreted_intent: string;
  patch_preview: {
    supported: boolean;
    reason: string;
    operations: Array<Record<string, unknown>>;
  };
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type DagPatchOperationKind =
  | "pause_for_replan"
  | "skip_node"
  | "add_node"
  | "change_parallelism"
  | "resume_with_patch"
  | "record_guidance";

export type DagPatchStatus =
  | "proposed"
  | "needs_confirmation"
  | "applied"
  | "applied_with_errors"
  | "rejected"
  | "unsupported";

export interface DagPatchOperation {
  op: DagPatchOperationKind;
  node_run_id?: string | null;
  node_id?: string | null;
  node_name?: string | null;
  value?: unknown;
  reason: string;
  supported: boolean;
}

export interface DagPatchOperationOutcome {
  op: DagPatchOperationKind;
  node_run_id: string | null;
  node_id: string | null;
  node_name: string | null;
  applied: boolean;
  error: string | null;
  details: Record<string, unknown>;
}

export interface DagPatchTopologySnapshot {
  node_count: number;
  edge_count: number;
  frontier: string[];
  ready_node_run_ids: string[];
  running_node_run_ids: string[];
  waiting_node_run_ids: string[];
  max_parallel_nodes: number | null;
}

export interface DagPatchGraphPreview {
  summary_lines: string[];
  operation_labels: string[];
  before_topology: DagPatchTopologySnapshot | null;
  predicted_topology: DagPatchTopologySnapshot | null;
  actual_topology: DagPatchTopologySnapshot | null;
  node_delta: number;
  edge_delta: number;
  parallelism_delta: number | null;
  target_node_names: string[];
  status_effect: string | null;
  frontier_effect: string | null;
}

export interface DagPatchRecord {
  patch_id: string;
  session_id: string;
  run_id: string | null;
  intervention_id: string | null;
  requested_by: string;
  status: DagPatchStatus;
  reason: string;
  summary: string;
  operations: DagPatchOperation[];
  requires_confirmation: boolean;
  apply_supported: boolean;
  unsupported_reason: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
  applied_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  operation_outcomes: DagPatchOperationOutcome[];
  application_errors: string[];
  resumed_topology: DagPatchTopologySnapshot | null;
  graph_preview: DagPatchGraphPreview | null;
  metadata: Record<string, unknown>;
}

export interface CreateSessionInterventionRequest {
  content: string;
  kind?: SessionInterventionKind;
  target_run_id?: string;
  target_node_run_id?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateSessionInterventionResponse {
  session: SessionRecord;
  intervention: SessionInterventionRecord;
  messages: SessionMessageRecord[];
}

export interface PlanSessionRequest {
  template_id?: string;
  draft_message_id?: string;
  inputs?: Record<string, unknown>;
}

export interface SessionDagDraftRequest {
  template_id?: string;
  inputs?: Record<string, unknown>;
  max_agent_nodes?: number;
}

export interface ReviseSessionPlanRequest {
  revision?: number;
  option?: "primary" | "alternative";
  instructions: string;
}

export interface CreateRunFromSessionRequest {
  template_id?: string;
  inputs?: Record<string, unknown>;
  validation_mode?: RunValidationMode;
  plan_revision?: number;
  plan_option?: "primary" | "alternative";
  proposal_id?: string;
}

export interface ConfirmSessionPlanRequest {
  revision: number;
  option?: "primary" | "alternative";
}

export interface TemplateLineageItem {
  template_id: string;
  version: number;
  name: string;
  status: TemplateStatus;
  description: string;
  updated_at: string;
  published_at: string | null;
  versioning: TemplateVersioningMetadata;
}

export interface TemplateLineageResponse {
  family_id: string;
  root_template_id: string;
  items: TemplateLineageItem[];
}

/** Historical storage shape. New code must use AgentDefinitionRecord. */
export interface LegacyAgentProfileRecord {
  profile_id: string;
  workspace_id?: string;
  name: string;
  description: string;
  provider_connection_id?: string | null;
  default_skills: string[];
  allowed_tools: string[];
  disallowed_skills: string[];
  policy_tags: string[];
  status: RegistryStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrchestratorProfileRecord {
  orchestrator_id: string;
  workspace_id?: string;
  name: string;
  provider: string;
  model: string;
  system_prompt: string;
  default_tools: string[];
  default_subagent_profile_ids: string[];
  planning_policy: Record<string, unknown>;
  handoff_policy: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProviderConnectionRecord {
  connection_id: string;
  workspace_id: string;
  name: string;
  agent_runtime: string;
  provider: string;
  protocol: "codex-appserver" | "anthropic-messages" | "openai-compatible";
  base_url: string | null;
  models: string[];
  default_model: string | null;
  max_input_tokens: number;
  max_output_tokens: number;
  context_compression_enabled: boolean;
  context_compression_threshold_percent: number;
  max_continuation_rounds: number;
  max_tool_rounds: number;
  credential_source: "managed" | "environment";
  credential_env: string;
  verification: ProviderConnectionVerification | null;
  status: RegistryStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProviderConnectionVerification {
  status: "verified" | "failed";
  tested_at: string;
  detail: string;
  duration_ms: number;
  model: string | null;
}

export interface UpsertProviderConnectionRequest {
  connection_id?: string;
  name: string;
  agent_runtime: string;
  provider?: string;
  protocol?: ProviderConnectionRecord["protocol"];
  base_url?: string | null;
  models?: string[];
  default_model?: string | null;
  max_input_tokens?: number;
  max_output_tokens?: number;
  context_compression_enabled?: boolean;
  context_compression_threshold_percent?: number;
  max_continuation_rounds?: number;
  max_tool_rounds?: number;
  credential_source?: ProviderConnectionRecord["credential_source"];
  credential_env?: string;
  api_key?: string;
  status?: RegistryStatus;
  metadata?: Record<string, unknown>;
}

export type ProviderConnectionReferenceKind =
  | "agent"
  | "session"
  | "schedule"
  | "workflow_template"
  | "agent_run"
  | "agent_dag"
  | "workflow_run";

export interface ProviderConnectionReference {
  kind: ProviderConnectionReferenceKind;
  reference_id: string;
  label: string;
  status: string;
  blocking: boolean;
  migratable: boolean;
  detail: string;
}

export interface ProviderConnectionReferenceReport {
  connection_id: string;
  workspace_id: string;
  connection_status: RegistryStatus;
  references: ProviderConnectionReference[];
  blocking_count: number;
  migratable_count: number;
  historical_count: number;
  can_delete: boolean;
}

export interface MigrateProviderConnectionRequest {
  target_connection_id: string;
  target_model?: string | null;
}

export interface ProviderConnectionMigrationResult {
  source_connection_id: string;
  target_connection_id: string;
  target_model: string;
  migrated_agents: number;
  migrated_sessions: number;
  migrated_schedules: number;
  migrated_workflow_templates: number;
  remaining: ProviderConnectionReferenceReport;
}

export interface DeleteProviderConnectionResult {
  connection_id: string;
  deleted: true;
  credential_deleted: boolean;
}

export interface ProviderConnectionSnapshot {
  connection_id: string;
  agent_runtime: string;
  provider: string;
  protocol: ProviderConnectionRecord["protocol"];
  base_url: string | null;
  model: string | null;
  credential_source: ProviderConnectionRecord["credential_source"];
  credential_env: string;
}

export interface SkillRecord {
  skill_id: string;
  workspace_id?: string;
  name: string;
  description: string;
  category: string;
  allowed_tools: string[];
  input_schema: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  tags: string[];
  status: RegistryStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpsertSkillRequest {
  skill_id?: string;
  name: string;
  description?: string;
  category?: string;
  allowed_tools?: string[];
  input_schema?: Record<string, unknown>;
  output_contract?: Record<string, unknown>;
  tags?: string[];
  status?: RegistryStatus;
  metadata?: Record<string, unknown>;
}

export type SkillPackageSource = "bundled" | "official_optional" | "installed" | "workspace" | "custom" | "marketplace";
export type SkillActivationPolicy = "explicit_only" | "advisory" | "auto";
export type SkillActivationSource = "explicit" | "intent" | "model" | "preloaded";
export type SkillTrustLevel = "bundled" | "official" | "workspace" | "community" | "unverified";

export interface SkillScriptDeclaration {
  id: string;
  runtime: "node" | "python" | "shell";
  entrypoint: string;
  input_schema: Record<string, unknown>;
  timeout_seconds: number;
  network: "none" | "public";
  workspace_access: "read" | "write";
  digest: string | null;
}

export interface SkillPackageManifest {
  schema_version: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  risk_level: ConversationActionRiskLevel;
  allowed_tools: string[];
  required_capabilities: string[];
  permission_scopes: string[];
  activation_keywords: string[];
  negative_keywords: string[];
  activation_policy: SkillActivationPolicy;
  platforms: string[];
  resources: string[];
  scripts: SkillScriptDeclaration[];
  input_schema: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  enabled_by_default: boolean;
  publisher: string | null;
  license: string | null;
  trust_level: SkillTrustLevel;
  metadata: Record<string, unknown>;
}

export interface SkillPackageStatus {
  skill_id: string;
  workspace_id: string | null;
  name: string;
  version: string;
  description: string;
  category: string;
  risk_level: ConversationActionRiskLevel;
  allowed_tools: string[];
  required_capabilities: string[];
  permission_scopes: string[];
  activation_keywords: string[];
  negative_keywords: string[];
  activation_policy: SkillActivationPolicy;
  platforms: string[];
  resources: string[];
  scripts: SkillScriptDeclaration[];
  input_schema: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  source: SkillPackageSource;
  enabled: boolean;
  status: "ready" | "disabled" | "error" | "incompatible";
  compatibility: "ready" | "degraded" | "blocked";
  missing_requirements: string[];
  error: string | null;
  instructions_digest: string;
  root_path: string;
  manifest_path: string;
  metadata: Record<string, unknown>;
  publisher: string | null;
  license: string | null;
  trust_level: SkillTrustLevel;
}

export interface SkillInvocationRecord {
  schema_version: 1;
  invocation_id: string;
  workspace_id: string;
  session_id: string;
  skill_id: string;
  skill_version: string;
  instructions_digest: string;
  action_id: string | null;
  activation_source: SkillActivationSource;
  status: "loaded" | "completed" | "failed";
  allowed_tools: string[];
  required_capabilities: string[];
  tool_action_ids: string[];
  error_code: string | null;
  verification_status: "pending" | "passed" | "failed" | "not_applicable";
  output_contract: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SkillWorkspaceProfile {
  schema_version: 1;
  workspace_id: string;
  auto_activation: boolean;
  enabled_categories: string[];
  trusted_sources: SkillTrustLevel[];
  update_policy: "manual" | "notify" | "automatic_official";
  pinned_versions: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface SkillLockEntry {
  skill_id: string;
  version: string;
  source: SkillPackageSource;
  trust_level: SkillTrustLevel;
  instructions_digest: string;
  manifest_digest: string;
  locked_at: string;
}

export interface SkillLockfileRecord {
  schema_version: 1;
  workspace_id: string;
  entries: SkillLockEntry[];
  updated_at: string;
}

export interface SkillCatalogSourceRecord {
  source_id: string;
  name: string;
  kind: "official" | "directory" | "http" | "marketplace" | "hermes";
  location: string;
  enabled: boolean;
  trust_level: SkillTrustLevel;
  public_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillEvaluationRecord {
  evaluation_id: string;
  workspace_id: string;
  skill_id: string;
  skill_version: string;
  invocation_id: string | null;
  verdict: "passed" | "failed" | "partial";
  output_contract_passed: boolean;
  tool_policy_passed: boolean;
  latency_ms: number | null;
  tool_rounds: number;
  error_code: string | null;
  created_at: string;
}

export interface GovernancePolicyRecord {
  schema_version: 1;
  workspace_id: string;
  mode: GovernanceMode;
  required_approvals: number;
  allow_self_approval: boolean;
  protected_actions: GovernanceProtectedAction[];
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface GovernanceApprovalRecord {
  principal_id: string;
  decision: "approved" | "rejected";
  comment: string | null;
  decided_at: string;
}

export interface GovernanceChangeRecord {
  schema_version: 1;
  change_id: string;
  workspace_id: string;
  action: GovernanceProtectedAction;
  resource_type: "agent" | "skill" | "template";
  resource_id: string;
  reason: string;
  payload: Record<string, unknown>;
  payload_digest: string;
  base_digest: string;
  status: GovernanceChangeStatus;
  required_approvals: number;
  allow_self_approval: boolean;
  approvals: GovernanceApprovalRecord[];
  proposed_by: string;
  proposed_at: string;
  approved_at: string | null;
  applied_by: string | null;
  applied_at: string | null;
  result: Record<string, unknown> | null;
  conflict_reason: string | null;
  updated_at: string;
}

export interface CreateGovernanceChangeRequest {
  action: GovernanceProtectedAction;
  resource_id: string;
  reason: string;
  payload?: Record<string, unknown>;
}

export interface GovernanceDecisionRequest {
  comment?: string;
}

export type ExecutionTargetKind = SharedWorkerTargetKind;

export interface ExecutionRef {
  job_id: string | null;
  worker_id: string | null;
  lease_id: string | null;
  target_kind: ExecutionTargetKind | null;
  dispatch_id: string | null;
  provider_refs: Record<string, string | null>;
}

export interface ExecutionArtifactRecord {
  artifact_id: string;
  type: string;
  name: string;
  storage_uri: string;
  mime_type: string;
  size_bytes: number;
}

export interface ArtifactRecord extends ExecutionArtifactRecord {
  run_id: string;
  node_run_id: string | null;
  created_at: string;
  publication_status?: "published" | "unpublished" | "failed";
  published_relative_path?: string | null;
  publication_error?: string | null;
}

export interface SessionAttachmentRecord {
  attachment_id: string;
  session_id: string;
  name: string;
  storage_uri: string;
  mime_type: string | null;
  size_bytes: number | null;
  kind: string;
  summary: string | null;
  created_by: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface CreateSessionAttachmentRequest {
  name?: string;
  storage_uri: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  kind?: string | null;
  summary?: string | null;
  created_by?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRecord {
  approval_id: string;
  run_id: string;
  node_run_id: string | null;
  kind: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  summary: string;
  requested_at: string;
  resolved_at: string | null;
  gate_id?: string | null;
}

export interface HumanInputRecord {
  input_request_id: string;
  run_id: string;
  node_run_id: string | null;
  status: "pending" | "submitted" | "expired" | "cancelled";
  summary: string;
  input_schema: Record<string, unknown>;
  requested_at: string;
  submitted_at: string | null;
  gate_id?: string | null;
}

export interface RuntimeHumanGateRecord {
  gate_id: string;
  kind: "approval" | "human_input";
  status: "requested" | "suspended" | "resuming" | "resumed" | "rejected" | "cancelled";
  transport: "worker_native" | "manager_requeue";
  run_id: string;
  node_run_id: string;
  job_id: string;
  worker_id: string | null;
  summary: string;
  input_schema: Record<string, unknown> | null;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  requested_at: string;
  suspended_at: string | null;
  resolved_at: string | null;
  control_id: string | null;
  last_error: string | null;
}

export interface CompiledNodeRecord {
  node_run_id: string;
  node_id: string;
  name: string;
  type: string;
  /** Historical RunPlan read compatibility only. */
  agent_profile?: string | null;
  agent_id?: string | null;
  agent_version?: number | null;
  agent_binding_snapshot?: AgentBindingSnapshot | null;
  runtime_agent_ref: string | null;
  agent_runtime?: string | null;
  harness_profile?: string | null;
  provider_connection?: ProviderConnectionSnapshot | null;
  /** Historical RunPlan read compatibility only. */
  openclaw_agent_id?: string | null;
  allowed_skills: string[];
  allowed_tools: string[];
  approval_kind: string | null;
  human_input_schema: Record<string, unknown> | null;
  status: NodeStatus;
  retry_policy: {
    max_attempts: number;
    attempt: number;
  };
  timeout_seconds: number;
  parallelism_budget: number;
  input_payload: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  execution_ref: ExecutionRef;
  registry_provenance: RegistryProvenance;
  work_package?: CompiledWorkPackageBinding;
  dynamic_fanout?: {
    source_node_id: string;
    source_node_run_id: string;
    source_handoff_id: string;
    template_node_id: string;
    item_index: number;
    item_count: number;
  };
}

export type RunRouteSourceKind =
  | "session_plan"
  | "proposal"
  | "direct_template"
  | "rerun"
  | "legacy";

export interface RunWorkPackageSnapshot extends WorkPackageBinding {
  node_run_ids: string[];
  identity_source: WorkPackageIdentitySource;
}

export interface RunRouteSnapshot {
  schema_version: 1;
  run_id: string;
  route_id: string;
  source_kind: RunRouteSourceKind;
  session_id: string | null;
  proposal_id: string | null;
  plan_revision: number | null;
  plan_option: "primary" | "alternative" | null;
  source_run_id?: string | null;
  template_id: string;
  template_version: number;
  template_name: string;
  node_count: number;
  edge_count: number;
  work_packages: RunWorkPackageSnapshot[];
  created_at: string;
}

export interface RunRouteSource {
  kind: Exclude<RunRouteSourceKind, "legacy">;
  session_id?: string | null;
  proposal_id?: string | null;
  plan_revision?: number | null;
  plan_option?: "primary" | "alternative" | null;
  source_run_id?: string | null;
  route_id?: string | null;
}

export interface RunInitializationRecord {
  schema_version: 1;
  run_id: string;
  state: "preparing" | "ready" | "failed";
  required_records: string[];
  completed_records: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegistrySkillProvenance {
  skill_id: string;
  sources: Array<"agent_default" | "node_allowed">;
  registry_status: RegistryStatus | "missing";
  included: boolean;
  excluded_reason: "disallowed_by_agent" | "disabled" | "missing" | null;
}

export interface RegistryToolProvenance {
  tool_id: string;
  sources: Array<"agent_allowed" | "node_allowed">;
}

export interface RegistryProvenance {
  agent_id_requested: string | null;
  agent_id_resolved: string | null;
  agent_status: RegistryStatus | "missing" | null;
  agent_source: "registry" | "template_binding" | "fallback" | "none";
  runtime_agent_ref_source: RuntimeAgentRefSource;
  skill_bindings: RegistrySkillProvenance[];
  tool_bindings: RegistryToolProvenance[];
}

export interface RunPlanRecord {
  run_id: string;
  template_id: string;
  template_version: number;
  workspace_id: string;
  requested_by: string;
  intent: string;
  inputs: Record<string, unknown>;
  compiled_nodes: CompiledNodeRecord[];
  edges: WorkflowEdge[];
  frontier: string[];
  policy_snapshot: Record<string, unknown>;
  planner_context: Record<string, unknown>;
  status: RunStatus;
  created_at: string;
}

export type RuntimeGraphMarker =
  | "active_frontier"
  | "waiting_human"
  | "approval_gate"
  | "human_input_gate"
  | "blocked"
  | "recovered_failure"
  | "skipped"
  | "terminal"
  | "ready";

export interface RuntimeGraphNode {
  nodeRunId: string;
  nodeId: string;
  name: string;
  type: string;
  status: NodeStatus;
  progress: NodeProgress;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  agentId: string | null;
  runtimeAgentRef: string | null;
  approvalKind: string | null;
  humanInputRequired: boolean;
  expectedArtifacts: string[];
  workPackageKey: string;
  workPackageLabel: string;
  workPackageOrder: number;
  workPackageIdentitySource: WorkPackageIdentitySource;
  markers: RuntimeGraphMarker[];
}

export interface RuntimeGraphEdge {
  fromNodeId: string;
  toNodeId: string;
  fromNodeRunId: string | null;
  toNodeRunId: string | null;
  label: string | null;
  condition: Record<string, unknown> | null;
  status: "satisfied" | "active" | "blocked" | "pending";
}

export interface RuntimeGraphWorkPackage {
  key: string;
  label: string;
  order: number;
  identitySource: WorkPackageIdentitySource;
  nodeRunIds: string[];
  status: "done" | "active" | "blocked" | "pending";
  readyCount: number;
  activeCount: number;
  completedCount: number;
  blockedCount: number;
}

export interface RuntimeMonitoringSummary {
  progress: {
    totalNodes: number;
    completedNodes: number;
    skippedNodes: number;
    activeNodes: number;
    readyNodes: number;
    waitingNodes: number;
    blockedNodes: number;
    frontierCount: number;
    percentComplete: number;
    averageNodeProgress: number;
    label: string;
    detail: string;
    tone: "neutral" | "warn" | "success" | "danger";
  };
  checkpoints: {
    approvalGateCount: number;
    humanInputGateCount: number;
    waitingHumanCount: number;
    blockedGateCount: number;
    nextCheckpointLabel: string | null;
    nextActionLabel: string;
    detail: string;
    tone: "neutral" | "warn" | "success" | "danger";
  };
  cost: {
    label: string;
    detail: string;
    posture: "nominal" | "attention" | "blocked";
    maxParallelNodes: number | null;
    activeCapacity: number;
    readyQueue: number;
    capacityUtilization: number | null;
    timeoutBudgetSeconds: number;
    remainingRetryBudget: number;
    budgetPolicyPresent: boolean;
    tone: "neutral" | "warn" | "success" | "danger";
  };
}

export interface RuntimeGraphSummary {
  runId: string;
  templateId: string;
  templateVersion: number;
  runStatus: RunStatus;
  intent: string;
  generatedAt: string;
  nodes: RuntimeGraphNode[];
  edges: RuntimeGraphEdge[];
  frontier: string[];
  statusCounts: Record<NodeStatus, number>;
  markers: {
    activeFrontier: string[];
    waitingHuman: string[];
    blocked: string[];
    skipped: string[];
  };
  workPackages: RuntimeGraphWorkPackage[];
  runtimeMonitoring: RuntimeMonitoringSummary;
  summaryLines: string[];
}

export interface NodeProgress {
  percent: number;
  message: string;
  updated_at: string;
}

export interface NodeRunRecord {
  node_run_id: string;
  run_id: string;
  status: NodeStatus;
  progress: NodeProgress;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  dynamic_fanout?: CompiledNodeRecord["dynamic_fanout"];
}

export interface EventRecord {
  schema_version?: 2;
  event_id: string;
  run_sequence?: number;
  correlation_id?: string | null;
  causation_id?: string | null;
  idempotency_key?: string | null;
  run_id: string;
  node_run_id: string | null;
  type: EventType;
  actor_type: ActorType;
  actor_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CreateRunRequest {
  intent: string;
  template_id: string;
  inputs: Record<string, unknown>;
  validation_mode?: RunValidationMode;
  proposal_id?: string;
}

export interface PlannerTemplateSelectionRequest {
  intent: string;
  orchestrator_agent_id?: string;
  planner_provider_id?: string;
}

export interface PlannerTemplateCandidateEvidence {
  coverage_score?: number;
  density_score?: number;
  registry_readiness_score?: number;
  domain_overlap_score?: number;
  matched_domains?: string[];
  metadata_domain_match?: boolean;
}

export interface PlannerTemplateCandidate {
  template_id: string;
  version: number;
  name: string;
  description: string;
  workspace_scope: string;
  score: number;
  matched_terms: string[];
  reason: string;
  evidence?: PlannerTemplateCandidateEvidence;
}

export interface PlannerTemplateSelectionResponse {
  selected_template: PlannerTemplateCandidate;
  candidates: PlannerTemplateCandidate[];
  planner_context: {
    planner_model: string;
    intent_tokens: string[];
    provider_id?: string;
    requested_provider_id?: string;
    requested_model?: string;
    orchestrator_agent_id?: string;
    orchestrator_system_prompt?: string;
    preferred_agent_ids?: string[];
    prefer_domain_match?: boolean;
    default_max_agent_nodes?: number;
    require_review?: boolean;
    fallback_used?: boolean;
    fallback_reason?: string;
  };
}

export interface PlannerPlanOptionContent {
  source: "primary" | "alternative";
  template_id: string;
  execution_template_id: string;
  template_name: string;
  recommendation_reason: string;
  recommendation_evidence?: PlannerTemplateCandidateEvidence;
  comparison_rationale?: string;
  candidate_plan: RunPlanRecord;
  validation: PlannerValidationResult;
  confirmation_checklist: Record<string, unknown>;
}

export interface PlannerCandidatePlanRequest {
  intent: string;
  template_id: string;
  inputs: Record<string, unknown>;
  orchestrator_agent_id?: string;
  planner_provider_id?: string;
  planner_model?: string;
  orchestrator_system_prompt?: string;
}

export interface PlannerValidationDetail {
  code: PlannerValidationCode;
  category: PlannerValidationCategory;
  message: string;
  field: string | null;
  node_id: string | null;
  node_name: string | null;
  agent_id: string | null;
  skill_id: string | null;
}

export interface PlannerValidationResult {
  passed: boolean;
  warnings: string[];
  details: PlannerValidationDetail[];
}

export interface PlannerCandidatePlanResponse {
  candidate_plan: RunPlanRecord;
  validation: PlannerValidationResult;
}

export interface PlannerDagDraftRequest {
  intent: string;
  template_id?: string;
  inputs?: Record<string, unknown>;
  max_agent_nodes?: number;
  orchestrator_agent_id?: string;
  planner_provider_id?: string;
  planner_model?: string;
  orchestrator_system_prompt?: string;
}

export interface PlannerRegistryRecommendation {
  node_id: string;
  node_name: string;
  agent_id: string | null;
  agent_name: string | null;
  runtime_agent_ref: string | null;
  skill_ids: string[];
  allowed_tools: string[];
  score: number;
  reason: string;
  warnings: string[];
  evidence?: {
    preferred_rank?: number | null;
    policy_score?: number;
    profile_token_score?: number;
    skill_score?: number;
    readiness_score?: number;
    disallowed_penalty?: number;
    domain_overlap_score?: number;
    matched_domains?: string[];
    coverage_domains?: string[];
  };
}

export interface PlannerDagDraftResponse {
  draft_template: CreateTemplateRequest & { template_id: string };
  template_recommendation: PlannerTemplateSelectionResponse | null;
  registry_recommendations: PlannerRegistryRecommendation[];
  validation: PlannerValidationResult;
  planner_context: {
    planner_model: string;
    intent_tokens: string[];
    source_template_id: string | null;
    draft_strategy: "template_variant" | "registry_synthesis";
    human_confirmation_required: boolean;
    provider_id?: string;
    requested_provider_id?: string;
    requested_model?: string;
    orchestrator_agent_id?: string;
    orchestrator_system_prompt?: string;
    preferred_agent_ids?: string[];
    prefer_domain_match?: boolean;
    default_max_agent_nodes?: number;
    require_review?: boolean;
    fallback_used?: boolean;
    fallback_reason?: string;
  };
}

export type DagProposalStatus =
  | "draft"
  | "review_ready"
  | "confirmed"
  | "rejected"
  | "superseded";

export interface DagProposalPlannerContext {
  provider_id: string | null;
  model: string | null;
  orchestrator_agent_id: string | null;
  system_prompt_summary: string | null;
  fallback_used: boolean;
  fallback_reason: string | null;
}

export interface DagProposalAssignment {
  node_id: string;
  node_name: string | null;
  agent_id: string | null;
  provider: string | null;
  model: string | null;
  allowed_tools: string[];
  allowed_skills: string[];
  input_context: string | null;
  output_contract: string | null;
  metadata: Record<string, unknown>;
}

export type OrchestrationDecisionMode = "direct" | "template" | "dynamic" | "manual";

export interface OrchestrationDecision {
  schema_version: 1;
  decision_id: string;
  mission_spec_id: string | null;
  mode: OrchestrationDecisionMode;
  requires_dag: boolean;
  reason: string;
  selected_template_id: string | null;
  required_capabilities: string[];
  risk_level: "low" | "medium" | "high";
  approval_required: boolean;
  policy_version?: string;
  evidence?: {
    signals: string[];
    scores: {
      direct: number;
      template: number;
      dynamic: number;
      manual: number;
    };
    matched_template_id?: string | null;
    rationale: string[];
  };
  created_at: string;
}

export type ExecutionShape = "direct" | "delegated" | "durable_dag";
export type ExecutionProposalSource = "template" | "dynamic" | "manual" | null;

export interface ExecutionShapeDecisionRecord {
  schema_version: 1;
  decision_id: string;
  mission_id: string;
  session_id: string;
  mission_revision_id: string;
  recommended_shape: ExecutionShape;
  selected_shape: ExecutionShape | null;
  proposal_source: ExecutionProposalSource;
  selection_status: "automatic" | "recommended" | "confirmed" | "blocked";
  decided_by: "policy" | "user" | "confirmed_state";
  reason: string;
  reason_codes: string[];
  evidence: {
    signals: string[];
    scores: Record<ExecutionShape, number>;
    rationale: string[];
  };
  risk_level: "low" | "medium" | "high";
  approval_required: boolean;
  policy_version: string;
  supersedes_decision_id: string | null;
  created_at: string;
}

export interface AgentRequirement {
  requirement_id: string;
  node_id: string | null;
  preferred_agent_id: string | null;
  preferred_agent_version: number | null;
  role: AgentRole | null;
  capability_tags: string[];
  required_skills: string[];
  required_tools: string[];
  model_constraints: {
    provider_connection_id: string | null;
    model: string | null;
    minimum_context_window: number | null;
  };
  memory_policy: Partial<AgentVersionRecord["memory_policy"]>;
  permission_policy: {
    workspace_read: boolean;
    workspace_write: boolean;
    autonomy_ceiling: AgentAutonomyMode | null;
  };
  isolation_requirement: "local" | "docker" | "isolated" | "auto";
  input_contract: Record<string, unknown>;
  output_contract: Record<string, unknown>;
}

export interface AgentCapabilityCandidate {
  agent_id: string;
  agent_version: number;
  agent_name: string;
  role: AgentRole;
  score: number;
  readiness: "ready" | "blocked";
  matched_capabilities: string[];
  missing_capabilities: string[];
  missing_skills: string[];
  missing_tools: string[];
  issues: string[];
}

export interface AgentCapabilityGap {
  gap_id: string;
  requirement_id: string;
  kind: "agent" | "capability" | "skill" | "tool" | "provider" | "permission" | "runtime";
  value: string;
  blocking: boolean;
  resolution_hint: string;
}

export interface AgentCapabilityPlanRecord {
  schema_version: 1;
  plan_id: string;
  mission_id: string;
  session_id: string;
  mission_revision_id: string;
  requirements: AgentRequirement[];
  candidates: Record<string, AgentCapabilityCandidate[]>;
  selected_bindings: Record<string, { agent_id: string; agent_version: number } | null>;
  gaps: AgentCapabilityGap[];
  status: "ready" | "partial" | "blocked";
  task_scoped_agent_recommended: boolean;
  created_at: string;
  updated_at: string;
}

export type DagDefinitionNodeKind =
  | "agent_task"
  | "reviewer"
  | "human_gate"
  | "condition"
  | "fanout"
  | "combine"
  | "end";

export interface DagDefinitionAgentSelector {
  agent_id: string | null;
  agent_version: number | null;
  role: AgentRole | null;
  capability_tags: string[];
}

export interface DagDefinitionNode {
  node_id: string;
  name: string;
  kind: DagDefinitionNodeKind;
  objective: string;
  agent_selector: DagDefinitionAgentSelector | null;
  depends_on: string[];
  join_policy: AgentDagJoinPolicy;
  join_quorum: number | null;
  condition: AgentDagCondition | null;
  state_input: Record<string, string>;
  state_output: AgentDagStateMapping[];
  human_gate: AgentHumanGateConfig | null;
  retry_policy: RetryPolicy;
  allowed_tools: string[];
  allowed_skills: string[];
  input_contract: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  acceptance_criteria?: string[];
  verification_steps?: string[];
  autonomy_mode: AgentAutonomyMode;
  max_tool_rounds: number | null;
  max_runtime_seconds: number | null;
  reviewer_node_id: string | null;
  metadata: Record<string, unknown>;
}

export interface DagDefinition {
  schema_version: 1;
  definition_id: string;
  revision: number;
  source: {
    kind: "template" | "model" | "manual";
    template_id: string | null;
    message_id: string | null;
  };
  title: string;
  objective: string;
  nodes: DagDefinitionNode[];
  state_schema: Record<string, unknown>;
  initial_state: Record<string, unknown>;
  policy: Partial<AgentTeamRecord["policy"]>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DagProposalRecord {
  protocol_version: 1;
  proposal_id: string;
  mission_id: string;
  session_id: string;
  orchestrator_agent_id: string | null;
  source_message_id: string | null;
  source_revision: number | null;
  source_option: "primary" | "alternative" | null;
  status: DagProposalStatus;
  title: string;
  summary: string;
  mission_spec_contract: MissionSpecContract | null;
  planner_context: DagProposalPlannerContext;
  dag_draft: Record<string, unknown>;
  route_compare: RouteCompareSummary | null;
  assignments: DagProposalAssignment[];
  orchestration_decision: OrchestrationDecision | null;
  dag_definition: DagDefinition | null;
  compiled_agent_dag_id: string | null;
  compiled_at: string | null;
  warnings: string[];
  checklist: string[];
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  superseded_at: string | null;
  superseded_by_proposal_id: string | null;
  supersedes_proposal_id: string | null;
  metadata: Record<string, unknown>;
}

export interface DagProposalSummary {
  proposal_id: string;
  session_id: string;
  mission_id: string;
  status: DagProposalStatus;
  title: string;
  summary: string;
  source_revision: number | null;
  source_option: "primary" | "alternative" | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDagProposalRequest {
  source_message_id?: string;
  source_revision?: number;
  source_option?: "primary" | "alternative";
  template_id?: string;
  inputs?: Record<string, unknown>;
  source_kind?: "template" | "model" | "manual";
  orchestration_decision?: OrchestrationDecision;
  dag_definition?: DagDefinition;
}

export interface UpdateDagProposalAssignmentsRequest {
  assignments: DagProposalAssignment[];
}

export interface ConfirmDagProposalRequest {
  confirmed_by?: string;
  start?: boolean;
}

export interface RejectDagProposalRequest {
  rejected_by?: string;
  reason?: string;
}

export interface SupersedeDagProposalRequest {
  source_message_id?: string;
  reason?: string;
  template_id?: string;
  inputs?: Record<string, unknown>;
}

export interface CreateDagProposalResponse {
  session: SessionRecord;
  proposal: DagProposalRecord;
}

export interface ListDagProposalsResponse {
  items: DagProposalSummary[];
  confirmed_proposal_id: string | null;
}

export interface CreateTemplateRequest {
  template_id?: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  policy: TemplatePolicy;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  workspace_scope?: string;
  agent_profile_bindings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  policy?: TemplatePolicy;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  workspace_scope?: string;
  agent_profile_bindings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RunRecord {
  run_id: string;
  template_id: string;
  template_version: number;
  workspace_id: string;
  requested_by: string;
  intent: string;
  status: RunStatus;
  current_summary: string;
  waiting_reason: string | null;
  blocked_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_event_id: string | null;
  created_at: string;
  updated_at: string;
  inputs: Record<string, unknown>;
  workspace_binding_id?: string | null;
  proposal_id: string | null;
  source_run_id?: string | null;
  rerun_reason?: string | null;
  rerun_idempotency_key?: string | null;
}

export interface DispatchEnvelope {
  run_id: string;
  node_run_id: string;
  template_id: string;
  template_version: number;
  workspace_id: string;
  requested_by: string;
  intent: string;
  node_id: string;
  node_name: string;
  node_type: string;
  agent_id: string | null;
  agent_version?: number | null;
  agent_binding_snapshot?: AgentBindingSnapshot | null;
  runtime_agent_ref: string | null;
  agent_runtime: string | null;
  harness_profile: string | null;
  provider_connection?: ProviderConnectionSnapshot | null;
  allowed_skills: string[];
  allowed_tools: string[];
  registry_provenance: RegistryProvenance;
  timeout_seconds: number;
  parallelism_budget: number;
  retry_policy: {
    max_attempts: number;
    attempt: number;
  };
  input_payload: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  trace_context: {
    run_id: string;
    node_run_id: string;
    requested_by: string;
  };
}

export interface AdapterDispatchResult {
  dispatch_id: string;
  provider_refs: Record<string, string | null>;
  status: "accepted" | "rejected" | "deferred";
}

export interface DispatchSweepSummary {
  scanned: number;
  normalized: number;
  resumed: number;
  aligned: number;
  finalized: number;
}

export interface ExecutionMaintenanceResult {
  action: "dispatch_sweep";
  adapter_kind: string;
  supported: boolean;
  message: string | null;
  summary: DispatchSweepSummary | null;
}

export interface NormalizedExecutionReport {
  run_id: string;
  node_run_id: string;
  status: NodeStatus | "accepted";
  progress: {
    percent: number;
    message: string;
  };
  artifacts: ExecutionArtifactRecord[];
  error: {
    code: string;
    message: string;
  } | null;
  raw_ref: {
    job_id?: string | null;
    worker_id?: string | null;
    lease_id?: string | null;
    target_kind?: ExecutionTargetKind | null;
    dispatch_id: string | null;
    provider_refs?: Record<string, string | null>;
  };
  human_gate?: {
    gate_id: string;
    kind: "approval" | "human_input";
    summary: string;
    input_schema: Record<string, unknown> | null;
    requested_at: string;
  } | null;
  created_at: string;
}

export interface RuntimeReportCallbackRequest {
  run_id: string;
  node_run_id: string;
  status: NodeStatus | "accepted";
  progress?: {
    percent: number;
    message: string;
  } | null;
  artifacts?: ExecutionArtifactRecord[];
  error?: {
    code: string;
    message: string;
  } | null;
  raw_ref?: {
    job_id?: string | null;
    worker_id?: string | null;
    lease_id?: string | null;
    target_kind?: ExecutionTargetKind | null;
    dispatch_id: string | null;
    provider_refs?: Record<string, string | null>;
  } | null;
  created_at?: string;
}

export interface MobileRunTimelineItem {
  event_id: string;
  node_run_id: string | null;
  type: EventType;
  actor_type: ActorType;
  actor_id: string;
  summary: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MobileRunTaskItem {
  node_run_id: string;
  node_id: string;
  name: string;
  type: string;
  status: NodeStatus;
  progress: NodeProgress;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  agent_id: string | null;
  runtime_agent_ref: string | null;
  execution_ref: ExecutionRef;
}

export interface MobileRunDetail {
  run: RunRecord;
  tasks: MobileRunTaskItem[];
  pending_approvals: ApprovalRecord[];
  pending_human_inputs: HumanInputRecord[];
  artifacts: ArtifactRecord[];
  timeline: MobileRunTimelineItem[];
  next_actions: string[];
}

export interface MobileRunSummary {
  run_id: string;
  template_id: string;
  template_version: number;
  proposal_id: string | null;
  status: RunStatus;
  intent: string;
  current_summary: string;
  updated_at: string;
  active_task: MobileRunTaskItem | null;
  pending_approval_count: number;
  pending_human_input_count: number;
  artifact_count: number;
  next_actions: string[];
}

export interface MobileHomeOverview {
  total_runs: number;
  active_runs: number;
  waiting_runs: number;
  failed_runs: number;
  completed_runs: number;
  cancelled_runs: number;
  pending_approval_count: number;
  pending_human_input_count: number;
}

export interface MobileHomeMissionSummary {
  total_missions: number;
  active_missions: number;
  waiting_missions: number;
  missions_needing_attention: number;
}

export interface MobileHomeResponse {
  overview: MobileHomeOverview;
  missions: MobileHomeMissionSummary;
  focus_session: MissionListItem | null;
  recent_sessions: MissionListItem[];
  focus_run: MobileRunSummary | null;
  recent_runs: MobileRunSummary[];
  inbox: {
    pending_count: number;
    pending_approval_count: number;
    pending_human_input_count: number;
  };
}

export interface MobileInboxItem {
  kind: "approval" | "human_input";
  request_id: string;
  run_id: string;
  node_run_id: string | null;
  run_status: RunStatus;
  intent: string;
  summary: string;
  requested_at: string;
  task: MobileRunTaskItem | null;
  input_schema: Record<string, unknown> | null;
  next_actions: string[];
}

export interface MobileRunFollowUp {
  run: RunRecord;
  session_id: string | null;
  mission: MissionListItem | null;
  blocker: string | null;
  active_task: MobileRunTaskItem | null;
  pending_approvals: ApprovalRecord[];
  pending_human_inputs: HumanInputRecord[];
  latest_timeline: MobileRunTimelineItem[];
  artifacts: ArtifactRecord[];
  artifact_count: number;
  next_actions: string[];
}
