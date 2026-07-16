export type RunStatus =
  | "draft"
  | "queued"
  | "running"
  | "waiting_human"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type TemplateStatus = "draft" | "published" | "archived";
export type RegistryStatus = "active" | "disabled";
export type GovernanceMode = "advisory" | "enforced";
export type GovernanceProtectedAction =
  | "agent_profile.upsert"
  | "agent_profile.disable"
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
export type SessionStatus =
  | "draft"
  | "planning"
  | "ready_to_run"
  | "running"
  | "waiting_human"
  | "completed"
  | "failed"
  | "cancelled";
export type PlannerValidationCategory = "required_input" | "registry" | "graph" | "other";
export type PlannerValidationCode =
  | "missing_required_input"
  | "missing_agent_profile"
  | "missing_runtime_agent_ref"
  | "missing_openclaw_agent"
  | "unknown_agent_profile"
  | "disabled_agent_profile"
  | "unknown_skill"
  | "disabled_skill"
  | "disallowed_skill"
  | "no_ready_frontier"
  | "no_terminal_node";
export type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting_human"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

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
  activeRunId: string | null;
  latestMessageId: string | null;
  latestUserMessageId: string | null;
  latestPlanMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RouteCompareOption = "primary" | "alternative";
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
  runtime_projection?: Record<string, unknown> | null;
  artifacts?: ArtifactRecord[];
  pending_approvals?: ApprovalRecord[];
  pending_human_inputs?: HumanInputRecord[];
  supervision_alerts?: SupervisionAlertRecord[];
  autopilot?: AutopilotControllerRecord | null;
  ui_plan?: MissionUiPlan;
  workspace_binding?: PublicWorkspaceBinding | null;
  task_workspace?: PublicTaskWorkspace | null;
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

export type AutopilotMode = "review_first" | "assisted" | "autopilot";
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

export type TaskCheckpointStatus =
  | "in_progress"
  | "resumable"
  | "waiting_human"
  | "completed"
  | "failed"
  | "superseded";

export type TaskCheckpointReason =
  | "turn_started"
  | "manual_resume"
  | "automatic_resume"
  | "context_compacted"
  | "continuation_limit"
  | "tool_round_limit"
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
  tool_rounds: number;
  tool_round_limit_reached: boolean;
  action_ids: string[];
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

export interface AgentHostingSummary {
  ownership: {
    execution_runtime: string;
    runtime_protocol: "my_mate";
    orchestration_binding: "my_mate";
  };
  profiles: Array<{
    profile_id: string;
    name: string;
    status: RegistryStatus;
    runtime_agent_ref: string;
    agent_runtime: string;
    harness_profile: string | null;
    openclaw_agent_id: string;
    default_skills: string[];
    provider: string | null;
    model: string | null;
    runtime_mode: string | null;
    managed_by: "my_mate_registry";
    health: {
      status: "ready" | "needs_binding" | "disabled";
      detail: string;
    };
  }>;
}

export interface UpdateAgentHostingRequest {
  runtime_agent_ref?: string;
  agent_runtime?: string;
  harness_profile?: string | null;
  openclaw_agent_id?: string;
  provider?: string | null;
  model?: string | null;
  runtime_mode?: string | null;
}

export interface RuntimeSummary {
  execution_runtime: {
    adapter_kind: string;
    registered_adapter_kinds: string[];
    local_execution_enabled: boolean;
    auto_approve_human_gates: boolean;
    bridge_base_url: string | null;
    bridge_execution_mode: string | null;
    bridge_dispatch_path: string | null;
    bridge_control_path: string | null;
    bridge_sweep_path: string | null;
    callback_base_url: string | null;
    callback_path: string | null;
    gateway_base_url: string | null;
    approval_console_base_url: string | null;
    container_name: string | null;
    runtime_health: {
      status: "ok" | "warn";
      detail: string;
      bridge_configured: boolean;
      callback_configured: boolean;
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
  agent_hosting: AgentHostingSummary;
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
    agent_profile_count: number;
    active_agent_profile_count: number;
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
  agent_profile: string | null;
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
  agent_profile_bindings: Record<string, unknown>;
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
  orchestrator_profile_id?: string;
  provider_connection_id?: string;
  model?: string;
  defer_conversation_reply?: boolean;
  autonomy_mode?: AutopilotMode;
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

export interface AgentProfileRecord {
  profile_id: string;
  workspace_id?: string;
  name: string;
  description: string;
  runtime_agent_ref?: string;
  agent_runtime?: string;
  harness_profile?: string | null;
  provider_connection_id?: string | null;
  openclaw_agent_id: string;
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

export interface UpsertOrchestratorProfileRequest {
  orchestrator_id?: string;
  name: string;
  provider?: string;
  model?: string;
  system_prompt?: string;
  default_tools?: string[];
  default_subagent_profile_ids?: string[];
  planning_policy?: Record<string, unknown>;
  handoff_policy?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpsertAgentProfileRequest {
  profile_id?: string;
  name: string;
  description?: string;
  runtime_agent_ref?: string;
  agent_runtime?: string;
  harness_profile?: string | null;
  provider_connection_id?: string | null;
  openclaw_agent_id?: string;
  default_skills?: string[];
  allowed_tools?: string[];
  disallowed_skills?: string[];
  policy_tags?: string[];
  status?: RegistryStatus;
  metadata?: Record<string, unknown>;
}

export interface ProviderConnectionRecord {
  connection_id: string;
  workspace_id: string;
  name: string;
  agent_runtime: string;
  provider: string;
  protocol: "codex-appserver" | "anthropic-messages" | "openai-compatible" | "openclaw-bridge";
  base_url: string | null;
  models: string[];
  default_model: string | null;
  max_input_tokens: number;
  max_output_tokens: number;
  context_compression_enabled: boolean;
  context_compression_threshold_percent: number;
  max_continuation_rounds: number;
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
  credential_source?: ProviderConnectionRecord["credential_source"];
  credential_env?: string;
  api_key?: string;
  status?: RegistryStatus;
  metadata?: Record<string, unknown>;
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
  resource_type: "agent_profile" | "skill" | "template";
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

export type ExecutionTargetKind =
  | "local"
  | "external-bridge"
  | "docker-worker"
  | "node-worker";

export interface ExecutionRef {
  job_id: string | null;
  worker_id: string | null;
  lease_id: string | null;
  target_kind: ExecutionTargetKind | null;
  dispatch_id: string | null;
  provider_refs: Record<string, string | null>;
  openclaw_task_id: string | null;
  openclaw_session_id: string | null;
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
  agent_profile: string | null;
  runtime_agent_ref: string | null;
  agent_runtime?: string | null;
  harness_profile?: string | null;
  provider_connection?: ProviderConnectionSnapshot | null;
  openclaw_agent_id: string | null;
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
  sources: Array<"agent_profile_default" | "node_allowed">;
  registry_status: RegistryStatus | "missing";
  included: boolean;
  excluded_reason: "disallowed_by_agent_profile" | "disabled" | "missing" | null;
}

export interface RegistryToolProvenance {
  tool_id: string;
  sources: Array<"agent_profile_allowed" | "node_allowed">;
}

export interface RegistryProvenance {
  agent_profile_requested: string | null;
  agent_profile_resolved: string | null;
  agent_profile_status: RegistryStatus | "missing" | null;
  agent_profile_source: "registry" | "template_binding" | "fallback" | "none";
  runtime_agent_ref_source: RuntimeAgentRefSource;
  openclaw_agent_id_source: RuntimeAgentRefSource;
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
  agentProfile: string | null;
  runtimeAgentRef: string | null;
  openclawAgentId: string | null;
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
  orchestrator_profile_id?: string;
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
    orchestrator_profile_id?: string;
    orchestrator_system_prompt?: string;
    preferred_subagent_profile_ids?: string[];
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
  orchestrator_profile_id?: string;
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
  agent_profile_id: string | null;
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
  orchestrator_profile_id?: string;
  planner_provider_id?: string;
  planner_model?: string;
  orchestrator_system_prompt?: string;
}

export interface PlannerRegistryRecommendation {
  node_id: string;
  node_name: string;
  agent_profile_id: string | null;
  agent_profile_name: string | null;
  runtime_agent_ref: string | null;
  openclaw_agent_id: string | null;
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
    orchestrator_profile_id?: string;
    orchestrator_system_prompt?: string;
    preferred_subagent_profile_ids?: string[];
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
  orchestrator_profile_id: string | null;
  system_prompt_summary: string | null;
  fallback_used: boolean;
  fallback_reason: string | null;
}

export interface DagProposalAssignment {
  node_id: string;
  node_name: string | null;
  subagent_profile_id: string | null;
  provider: string | null;
  model: string | null;
  allowed_tools: string[];
  allowed_skills: string[];
  input_context: string | null;
  output_contract: string | null;
  metadata: Record<string, unknown>;
}

export interface DagProposalRecord {
  proposal_id: string;
  mission_id: string;
  session_id: string;
  orchestrator_profile_id: string | null;
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
}

export interface UpdateDagProposalAssignmentsRequest {
  assignments: DagProposalAssignment[];
}

export interface ConfirmDagProposalRequest {
  confirmed_by?: string;
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
  agent_profile: string | null;
  runtime_agent_ref: string | null;
  agent_runtime: string | null;
  harness_profile: string | null;
  provider_connection?: ProviderConnectionSnapshot | null;
  openclaw_agent_id?: string | null;
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
  openclaw_task_id: string | null;
  openclaw_session_id: string | null;
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

export interface OpenClawBridgeDispatchRequest {
  run_id: string;
  node_run_id: string;
  node_id: string;
  node_name: string;
  node_type: string;
  template_id: string;
  template_version: number;
  workspace_id: string;
  requested_by: string;
  intent: string;
  openclaw_agent_id: string | null;
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
  callback: {
    report_url: string;
    bearer_token: string | null;
  };
  trace_context: {
    run_id: string;
    node_run_id: string;
    requested_by: string;
  };
  openclaw_runtime: {
    execution_mode: string;
    gateway_base_url: string | null;
    approval_console_base_url: string | null;
    container_name: string | null;
  };
}

export interface OpenClawBridgeControlRequest {
  run_id: string;
  node_run_id: string | null;
  action: "pause" | "resume" | "cancel" | "retry" | "skip";
  trace_context: {
    run_id: string;
    node_run_id: string | null;
  };
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
    openclaw_task_id: string | null;
    openclaw_session_id: string | null;
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

export interface OpenClawReportCallbackRequest {
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
    openclaw_task_id: string | null;
    openclaw_session_id: string | null;
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
  runtime_agent_ref: string | null;
  openclaw_agent_id: string | null;
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
