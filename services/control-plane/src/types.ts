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
  | "artifact.created";

export type ActorType = "user" | "agent" | "system" | "operator";
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
}

export interface SessionWorkspaceDetailResponse {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  latest_run: RunRecord | null;
  attachments: SessionAttachmentRecord[];
  workspace_state: Record<string, unknown>;
  next_actions: string[];
  workspace_contract_version: number | null;
  mission_spec: MissionSpecSummary | null;
  mission_spec_contract: MissionSpecContract | null;
  mission_snapshot: MissionSnapshot | null;
}

export interface AgentHostingSummary {
  ownership: {
    execution_runtime: "openclaw";
    orchestration_binding: "my_mate";
  };
  profiles: Array<{
    profile_id: string;
    name: string;
    status: RegistryStatus;
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
  openclaw_agent_id?: string;
  provider?: string | null;
  model?: string | null;
  runtime_mode?: string | null;
}

export interface RuntimeSummary {
  execution_runtime: {
    adapter_kind: string;
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
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition: Record<string, unknown> | null;
  label: string | null;
}

export interface TemplatePolicy {
  max_parallel_nodes: number;
  default_timeout_seconds: number;
  budget_policy: Record<string, unknown>;
  approval_policy: Record<string, unknown>;
}

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

export interface CreateSessionRequest {
  title?: string;
  initial_message?: string;
  created_by?: string;
  orchestrator_profile_id?: string;
}

export interface CreateSessionMessageRequest {
  content: string;
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
  name: string;
  description: string;
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
  openclaw_agent_id: string;
  default_skills?: string[];
  allowed_tools?: string[];
  disallowed_skills?: string[];
  policy_tags?: string[];
  status?: RegistryStatus;
  metadata?: Record<string, unknown>;
}

export interface SkillRecord {
  skill_id: string;
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

export interface ExecutionRef {
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
}

export interface CompiledNodeRecord {
  node_run_id: string;
  node_id: string;
  name: string;
  type: string;
  agent_profile: string | null;
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
  openclaw_agent_id_source: "registry" | "template_binding" | "fallback" | "none";
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
  openclawAgentId: string | null;
  approvalKind: string | null;
  humanInputRequired: boolean;
  expectedArtifacts: string[];
  workPackageKey: string;
  workPackageLabel: string;
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
  nodeRunIds: string[];
  status: "done" | "active" | "blocked" | "pending";
  readyCount: number;
  activeCount: number;
  completedCount: number;
  blockedCount: number;
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
}

export interface EventRecord {
  event_id: string;
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

export interface PlannerTemplateCandidate {
  template_id: string;
  version: number;
  name: string;
  description: string;
  workspace_scope: string;
  score: number;
  matched_terms: string[];
  reason: string;
}

export interface PlannerTemplateSelectionResponse {
  selected_template: PlannerTemplateCandidate;
  candidates: PlannerTemplateCandidate[];
  planner_context: {
    planner_model: string;
    intent_tokens: string[];
    provider_id?: string;
    fallback_used?: boolean;
    fallback_reason?: string;
  };
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
  openclaw_agent_id: string | null;
  skill_ids: string[];
  score: number;
  reason: string;
  warnings: string[];
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
  proposal_id: string | null;
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
    dispatch_id: string | null;
    openclaw_task_id: string | null;
    openclaw_session_id: string | null;
  };
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
    dispatch_id: string | null;
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
