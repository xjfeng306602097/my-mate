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

export type SessionStatus =
  | "draft"
  | "planning"
  | "ready_to_run"
  | "running"
  | "waiting_human"
  | "completed"
  | "failed"
  | "cancelled";

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

export type RunValidationMode = "warn" | "strict" | "bypass";

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

export interface NodeProgress {
  percent: number;
  message: string;
  updated_at: string;
}

export interface MobileTask {
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
  execution_ref: {
    openclaw_task_id: string | null;
    openclaw_session_id: string | null;
  };
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
  proposal_id?: string | null;
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

export interface ArtifactRecord {
  artifact_id: string;
  run_id: string;
  node_run_id: string | null;
  type: string;
  name: string;
  storage_uri: string;
  mime_type: string;
  size_bytes: number;
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

export interface TimelineItem {
  event_id: string;
  node_run_id: string | null;
  type: string;
  actor_type: string;
  actor_id: string;
  summary: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MobileRunSummary {
  run_id: string;
  template_id: string;
  template_version: number;
  proposal_id?: string | null;
  status: RunStatus;
  intent: string;
  current_summary: string;
  updated_at: string;
  active_task: MobileTask | null;
  pending_approval_count: number;
  pending_human_input_count: number;
  artifact_count: number;
  next_actions: string[];
}

export interface TemplateSummary {
  template_id: string;
  version: number;
  name: string;
  status: string;
  description: string;
  workspace_scope: string;
  input_schema: {
    type?: string;
    properties?: Record<
      string,
      { type?: string; title?: string; description?: string; enum?: string[]; format?: string; multiline?: boolean }
    >;
    required?: string[];
  };
  policy: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface RunSummary {
  run_id: string;
  template_id: string;
  proposal_id?: string | null;
  status: RunStatus;
  current_summary: string;
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
  };
}

export interface CandidatePlanNode {
  node_run_id: string;
  node_id: string;
  name: string;
  type: string;
  agent_profile: string | null;
  openclaw_agent_id: string | null;
  allowed_skills: string[];
  allowed_tools: string[];
  registry_provenance?: {
    agent_profile_requested: string | null;
    agent_profile_resolved: string | null;
    agent_profile_status: string | null;
    agent_profile_source: string;
    openclaw_agent_id_source: string;
    skill_bindings: Array<{
      skill_id: string;
      sources: string[];
      registry_status: string;
      included: boolean;
      excluded_reason: string | null;
    }>;
    tool_bindings: Array<{
      tool_id: string;
      sources: string[];
    }>;
  };
  status: NodeStatus;
}

export interface PlannerCandidatePlanResponse {
  candidate_plan: {
    run_id: string;
    template_id: string;
    template_version: number;
    workspace_id: string;
    requested_by: string;
    intent: string;
    inputs: Record<string, unknown>;
    compiled_nodes: CandidatePlanNode[];
    frontier: string[];
    planner_context: Record<string, unknown>;
    status: RunStatus;
    created_at: string;
  };
  validation: PlannerValidationResult;
}

export interface PlannerValidationResult {
  passed: boolean;
  warnings: string[];
  details: Array<{
    code: PlannerValidationCode;
    category: PlannerValidationCategory;
    message: string;
    field: string | null;
    node_id: string | null;
    node_name: string | null;
    agent_profile_id: string | null;
    skill_id: string | null;
  }>;
}

export interface CreateRunResponse {
  run_id: string;
  status: RunStatus;
  validation: PlannerValidationResult;
}

export interface MobileHomeResponse {
  overview: {
    total_runs: number;
    active_runs: number;
    waiting_runs: number;
    failed_runs: number;
    completed_runs: number;
    cancelled_runs: number;
    pending_approval_count: number;
    pending_human_input_count: number;
  };
  missions: {
    total_missions: number;
    active_missions: number;
    waiting_missions: number;
    missions_needing_attention: number;
  };
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
  task: MobileTask | null;
  input_schema: {
    properties?: Record<
      string,
      { type?: string; title?: string; description?: string; enum?: string[]; format?: string; multiline?: boolean }
    >;
    required?: string[];
  } | null;
  next_actions: string[];
}

export interface MobileRunFollowUp {
  run: RunRecord;
  session_id: string | null;
  mission: MissionListItem | null;
  blocker: string | null;
  active_task: MobileTask | null;
  pending_approvals: ApprovalRecord[];
  pending_human_inputs: HumanInputRecord[];
  latest_timeline: TimelineItem[];
  artifacts: ArtifactRecord[];
  artifact_count: number;
  next_actions: string[];
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
  runtimeMonitoring?: RuntimeMonitoringSummary;
  summaryLines: string[];
}

export interface SessionSummary {
  session_id: string;
  title: string;
  status: SessionStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  hidden: boolean;
  hidden_at: string | null;
  hidden_by: string | null;
  current_goal: string | null;
  current_plan_summary: string | null;
  latest_run_id: string | null;
  active_run_ids: string[];
  confirmed_plan_revision?: number | null;
  confirmed_plan_option?: "primary" | "alternative" | null;
  confirmed_proposal_id?: string | null;
  working_goal?: string | null;
  constraints_summary?: string | null;
  open_question_count?: number;
  pending_decision?: string | null;
  latest_orchestrator_intent?: string | null;
  workspace_state?: Record<string, unknown> | null;
  mission_spec?: MissionSpecSummary | null;
  mission_spec_contract?: MissionSpecContract | null;
  mission_snapshot?: MissionSnapshot | null;
  message_count: number;
}

export interface SessionRecord extends SessionSummary {
  last_orchestrator_message_id?: string | null;
  metadata?: Record<string, unknown>;
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
  recommendation: {
    label: string;
    detail: string;
    tone: "neutral" | "warn" | "success" | "danger";
  };
}

export type MissionWorkspaceStageKey = "briefing" | "work" | "plan" | "execution" | "thread";

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
  mission_view?: MissionView;
}

export interface MissionDetailResponse {
  mission: MissionListItem;
  session: SessionRecord;
  messages: SessionMessageRecord[];
  latest_run: RunRecord | null;
  attachments?: SessionAttachmentRecord[];
  workspace_contract_version?: number | null;
  mission_spec?: MissionSpecSummary | null;
  mission_spec_contract?: MissionSpecContract | null;
  mission_snapshot?: MissionSnapshot | null;
  mission_view?: MissionView;
}

export interface SessionDetailResponse {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  latest_run: RunRecord | null;
  attachments?: SessionAttachmentRecord[];
  workspace_contract_version?: number | null;
  mission_spec?: MissionSpecSummary | null;
  mission_spec_contract?: MissionSpecContract | null;
  mission_snapshot?: MissionSnapshot | null;
}

export interface CreateSessionMessageResponse {
  session: SessionRecord;
  user_message: SessionMessageRecord;
  messages: SessionMessageRecord[];
}

export interface CreateSessionInterventionResponse {
  session: SessionRecord;
  intervention: SessionInterventionRecord;
  messages: SessionMessageRecord[];
}

export interface SessionPlanResponse {
  session: SessionRecord;
  recommendation: PlannerTemplateSelectionResponse | null;
  candidate_plan: {
    run_id: string;
    template_id?: string;
    compiled_nodes: CandidatePlanNode[];
    [key: string]: unknown;
  };
  validation: PlannerValidationResult;
  messages: SessionMessageRecord[];
}

export interface SessionDagDraftResponse {
  session: SessionRecord;
  draft_template: {
    template_id: string;
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    policy: Record<string, unknown>;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    workspace_scope?: string;
    agent_profile_bindings?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  template_recommendation: PlannerTemplateSelectionResponse | null;
  registry_recommendations: Array<{
    node_id: string;
    node_name: string;
    agent_profile_id: string | null;
    agent_profile_name: string | null;
    openclaw_agent_id: string | null;
    skill_ids: string[];
    score: number;
    reason: string;
    warnings: string[];
  }>;
  validation: PlannerValidationResult;
  planner_context: {
    planner_model: string;
    intent_tokens: string[];
    source_template_id: string | null;
    draft_strategy: "template_variant" | "registry_synthesis";
    human_confirmation_required: boolean;
  };
  messages: SessionMessageRecord[];
}

export interface SessionRunResponse {
  run_id: string;
  status: RunStatus;
  proposal_id?: string | null;
  validation: PlannerValidationResult;
  session: SessionRecord;
  messages: SessionMessageRecord[];
}

export interface ConfirmSessionPlanResponse {
  session: SessionRecord;
  revision: number;
  option?: "primary" | "alternative";
  message: SessionMessageRecord;
}
