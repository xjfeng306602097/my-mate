const NODE_TYPES = [
  "agent_task",
  "approval",
  "human_input",
  "notify",
  "condition",
  "fanout",
  "reducer",
  "tool_task",
  "planner",
  "end",
];

const APPROVAL_KINDS = [
  "human_review",
  "prod_release",
  "budget_override",
  "privileged_tool_use",
];

const DEFAULT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    goal: {
      type: "string",
      title: "Goal",
    },
  },
  required: ["goal"],
};

const DEFAULT_POLICY = {
  max_parallel_nodes: 1,
  default_timeout_seconds: 900,
  budget_policy: {},
  approval_policy: {},
};

const DEFAULT_REGISTRY_METADATA = {};
const DEFAULT_SKILL_SCHEMA = { type: "object" };
const DEFAULT_SKILL_OUTPUT_CONTRACT = {};

function emptyHumanInputDrafts() {
  return {};
}

const state = {
  templates: [],
  missions: [],
  sessions: [],
  orchestratorProfiles: [],
  agentProfiles: [],
  skills: [],
  activeView: "plan",
  activeNav: "missions",
  lineage: null,
  selectedId: null,
  selectedSessionId: null,
  loading: false,
  registryLoading: false,
  orchestratorProfilesLoading: false,
  missionsLoading: false,
  sessionsLoading: false,
  sessionVisibilitySaving: false,
  runtimeLoading: false,
  saving: false,
  publishing: false,
  deriving: false,
  versioning: false,
  archiving: false,
  planning: false,
  applyingPlan: false,
  savingPlan: false,
  applyingDagDraft: false,
  savingDagDraft: false,
  proposalDispatching: false,
  registrySaving: false,
  registryDisabling: false,
  error: null,
  notice: null,
  runtimeSummary: null,
  workspaceDetail: null,
  missionQuery: "",
  sessionQuery: "",
  missionVisibility: "active",
  sessionVisibility: "active",
  commandPaletteOpen: false,
  commandPaletteQuery: "",
  commandPaletteIndex: 0,
  attachmentSaving: false,
  streamStatus: "idle",
  streamError: null,
  streamSource: null,
  actionLoading: {},
  humanInputDrafts: emptyHumanInputDrafts(),
  preview: {
    type: "workspace",
    key: null,
  },
  workspaceSelection: {
    type: "none",
    key: null,
  },
  registryEditor: {
    profile: emptyAgentProfileEditor(),
    skill: emptySkillEditor(),
  },
  orchestrator: {
    selectedProfileId: "",
    name: "Studio Orchestrator",
    provider: "",
    model: "",
    systemPrompt:
      "You are the mission orchestrator. Clarify the user's intent, define the MissionSpec, propose a DAG, assign subagents, and supervise execution until the requested deliverables are complete.",
    defaultToolsText: "",
    defaultSubagentsText: "",
  },
  ui: {
    orchestratorSetupExpanded: false,
    workspaceFeedFilter: "all",
    workspaceFeedExpanded: false,
  },
  attachmentEditor: {
    name: "",
    storageUri: "",
    mimeType: "",
    summary: "",
  },
  executionControl: {
    interventionText: "",
    interventionKind: "guidance",
  },
  planner: {
    intent: "",
    templateId: "",
    inputsText: prettyJson({}),
    maxAgentNodes: "1",
    recommendation: null,
    candidatePlan: null,
    dagDraft: null,
    dagProposals: [],
    confirmedProposalId: null,
    activeProposal: null,
    proposalSessionId: "",
    proposalLoading: false,
    proposalSaving: false,
    proposalConfirming: false,
    proposalOverrides: {},
    error: null,
  },
  editor: emptyEditor(),
};

let pendingCommandPaletteFocus = null;
let pendingWorkspaceFocus = null;
let pendingSessionInventoryScroll = false;
let pendingWorkspaceFeedEntryKey = null;
let restoreWorkspaceFocusFromLocation = false;
let workspaceLoadSeq = 0;
let missionSearchTimer = null;
let sessionSearchTimer = null;

const DESKTOP_NAV_ITEMS = new Set([
  "orchestrator",
  "missions",
  "sessions",
  "agents",
  "templates",
  "registry",
  "settings",
]);
const WORKSPACE_SELECTION_TYPES = new Set(["checkpoint", "output-history"]);
const WORKSPACE_FEED_FILTERS = new Set(["all", "evidence", "context", "outputs", "patches"]);

function emptyAgentProfileEditor() {
  return {
    mode: "new",
    profileId: "",
    status: "active",
    name: "",
    description: "",
    openclawAgentId: "",
    openclawProvider: "",
    openclawModel: "",
    openclawRuntimeMode: "",
    defaultSkillsText: "",
    allowedToolsText: "",
    disallowedSkillsText: "",
    policyTagsText: "",
    metadataText: prettyJson(DEFAULT_REGISTRY_METADATA),
  };
}

function emptySkillEditor() {
  return {
    mode: "new",
    skillId: "",
    status: "active",
    name: "",
    description: "",
    category: "general",
    allowedToolsText: "",
    tagsText: "",
    inputSchemaText: prettyJson(DEFAULT_SKILL_SCHEMA),
    outputContractText: prettyJson(DEFAULT_SKILL_OUTPUT_CONTRACT),
    metadataText: prettyJson(DEFAULT_REGISTRY_METADATA),
  };
}

function editorFromAgentProfile(profile) {
  const metadata = profile.metadata || DEFAULT_REGISTRY_METADATA;
  const openclaw = metadata.openclaw && typeof metadata.openclaw === "object" && !Array.isArray(metadata.openclaw)
    ? metadata.openclaw
    : {};
  return {
    mode: "edit",
    profileId: profile.profile_id,
    status: profile.status || "active",
    name: profile.name || profile.profile_id,
    description: profile.description || "",
    openclawAgentId: profile.openclaw_agent_id || "",
    openclawProvider: openclaw.provider || metadata.openclaw_provider || "",
    openclawModel: openclaw.model || metadata.openclaw_model || "",
    openclawRuntimeMode: openclaw.runtime_mode || metadata.openclaw_runtime_mode || "",
    defaultSkillsText: (profile.default_skills || []).join(", "),
    allowedToolsText: (profile.allowed_tools || []).join(", "),
    disallowedSkillsText: (profile.disallowed_skills || []).join(", "),
    policyTagsText: (profile.policy_tags || []).join(", "),
    metadataText: prettyJson(metadata),
  };
}

function editorFromSkill(skill) {
  return {
    mode: "edit",
    skillId: skill.skill_id,
    status: skill.status || "active",
    name: skill.name || skill.skill_id,
    description: skill.description || "",
    category: skill.category || "general",
    allowedToolsText: (skill.allowed_tools || []).join(", "),
    tagsText: (skill.tags || []).join(", "),
    inputSchemaText: prettyJson(skill.input_schema || DEFAULT_SKILL_SCHEMA),
    outputContractText: prettyJson(skill.output_contract || DEFAULT_SKILL_OUTPUT_CONTRACT),
    metadataText: prettyJson(skill.metadata || DEFAULT_REGISTRY_METADATA),
  };
}

function emptyNode(index) {
  return {
    id: `node_${index}`,
    name: `Node ${index}`,
    type: "agent_task",
    agent_profile: "backend",
    allowed_skills: ["coding-agent"],
    config: {},
    retry_policy: {
      max_attempts: 1,
      backoff_seconds: 5,
    },
    timeout_seconds: 600,
    parallelism: 1,
    approval_kind: null,
    human_input_schema: null,
  };
}

function emptyEditor() {
  return {
    templateId: null,
    status: "new",
    version: null,
    name: "New Workflow",
    description: "Draft workflow template",
    workspaceScope: "default",
    inputSchemaText: prettyJson(DEFAULT_INPUT_SCHEMA),
    policyText: prettyJson(DEFAULT_POLICY),
    bindingsText: prettyJson({ backend: "backend" }),
    metadataText: prettyJson({ domain: "demo" }),
    nodes: [
      {
        ...emptyNode(1),
        id: "node_backend",
        name: "Backend Task",
        timeout_seconds: 900,
        config: {
          allowed_tools: ["read", "write", "shell"],
          output_contract: {
            expected_artifacts: ["agent-report"],
          },
        },
      },
      {
        ...emptyNode(2),
        id: "node_end",
        name: "End",
        type: "end",
        agent_profile: null,
        allowed_skills: [],
        retry_policy: {
          max_attempts: 0,
          backoff_seconds: 0,
        },
        timeout_seconds: 60,
      },
    ],
    edges: [
      {
        from: "node_backend",
        to: "node_end",
        condition: null,
        label: null,
      },
    ],
    updatedAt: null,
  };
}

function editorFromTemplate(template) {
  return {
    templateId: template.template_id,
    status: template.status,
    version: template.version,
    name: template.name,
    description: template.description,
    workspaceScope: template.workspace_scope,
    inputSchemaText: prettyJson(template.input_schema),
    policyText: prettyJson(template.policy),
    bindingsText: prettyJson(template.agent_profile_bindings),
    metadataText: prettyJson(template.metadata),
    nodes: template.nodes,
    edges: template.edges,
    updatedAt: template.updated_at,
  };
}

function nodeFromCompiledNode(compiledNode) {
  return {
    id: compiledNode.node_id,
    name: compiledNode.name,
    type: compiledNode.type,
    agent_profile: compiledNode.agent_profile,
    allowed_skills: compiledNode.allowed_skills || [],
    config: {
      ...(compiledNode.input_payload?.node_config || {}),
      allowed_tools: compiledNode.allowed_tools || [],
      output_contract: compiledNode.output_contract || {},
    },
    retry_policy: {
      max_attempts: compiledNode.retry_policy?.max_attempts ?? 1,
      backoff_seconds: 5,
    },
    timeout_seconds: compiledNode.timeout_seconds || 600,
    parallelism: compiledNode.parallelism_budget || 1,
    approval_kind: compiledNode.approval_kind || null,
    human_input_schema: compiledNode.human_input_schema || null,
  };
}

function editorFromCandidatePlan(candidatePlan, sourceTemplate) {
  const plan = candidatePlan.candidate_plan;
  const sourceMetadata = sourceTemplate?.metadata || {};
  return {
    templateId: null,
    status: "new",
    version: null,
    name: `${sourceTemplate?.name || plan.template_id} Variant`,
    description: `Draft copied from planner preview for: ${plan.intent}`,
    workspaceScope: plan.workspace_id || sourceTemplate?.workspace_scope || "default",
    inputSchemaText: prettyJson(sourceTemplate?.input_schema || DEFAULT_INPUT_SCHEMA),
    policyText: prettyJson(plan.policy_snapshot || sourceTemplate?.policy || DEFAULT_POLICY),
    bindingsText: prettyJson(sourceTemplate?.agent_profile_bindings || {}),
    metadataText: prettyJson({
      ...sourceMetadata,
      planner_source_template_id: plan.template_id,
      planner_source_template_version: plan.template_version,
      planner_intent: plan.intent,
      planner_context: plan.planner_context || {},
    }),
    nodes: (plan.compiled_nodes || []).map(nodeFromCompiledNode),
    edges: plan.edges || [],
    updatedAt: null,
  };
}

function editorFromDagDraft(dagDraft) {
  const draft = dagDraft.draft_template;
  return {
    templateId: null,
    status: "new",
    version: null,
    name: draft.name || "Planned Workflow",
    description: draft.description || "Planner-generated DAG draft",
    workspaceScope: draft.workspace_scope || "default",
    inputSchemaText: prettyJson(draft.input_schema || DEFAULT_INPUT_SCHEMA),
    policyText: prettyJson(draft.policy || DEFAULT_POLICY),
    bindingsText: prettyJson(draft.agent_profile_bindings || {}),
    metadataText: prettyJson({
      ...(draft.metadata || {}),
      planner_context: dagDraft.planner_context || {},
      planner_validation: dagDraft.validation || {},
      planner_registry_recommendations: dagDraft.registry_recommendations || [],
    }),
    nodes: draft.nodes || [],
    edges: draft.edges || [],
    updatedAt: null,
  };
}

function getProposalNodeKey(node, index) {
  return String(node.id || node.node_id || node.node_run_id || `proposal_node_${index + 1}`);
}

function getNodeConfig(node) {
  return node.config && typeof node.config === "object" && !Array.isArray(node.config)
    ? node.config
    : node.input_payload?.node_config && typeof node.input_payload.node_config === "object" && !Array.isArray(node.input_payload.node_config)
      ? node.input_payload.node_config
      : {};
}

function getProposalNodeDraft(node, index) {
  const key = getProposalNodeKey(node, index);
  const config = getNodeConfig(node);
  const override = state.planner.proposalOverrides[key] || {};
  const outputContract =
    override.outputContractText !== undefined
      ? override.outputContractText
      : prettyJson(config.output_contract || node.output_contract || {});
  return {
    key,
    id: key,
    name: node.name || node.node_name || key,
    type: node.type || "agent_task",
    agentProfile:
      override.agentProfile !== undefined
        ? override.agentProfile
        : node.agent_profile || node.agentProfile || "",
    skillsText:
      override.skillsText !== undefined
        ? override.skillsText
        : (node.allowed_skills || node.allowedSkills || []).join(", "),
    toolsText:
      override.toolsText !== undefined
        ? override.toolsText
        : (config.allowed_tools || node.allowed_tools || []).join(", "),
    provider:
      override.provider !== undefined
        ? override.provider
        : config.provider || node.provider || "",
    model:
      override.model !== undefined
        ? override.model
        : config.model || node.model || "",
    contextText:
      override.contextText !== undefined
        ? override.contextText
        : config.input_context || config.prompt || config.instructions || "",
    outputContractText: outputContract,
  };
}

function parseProposalOverrideNode(draft) {
  const outputContract = parseJsonObject(draft.outputContractText || "{}");
  if (!outputContract.ok) {
    return {
      ok: false,
      message: `${draft.name || draft.id} output contract: ${outputContract.message}`,
    };
  }
  return {
    ok: true,
    value: {
      agent_profile: draft.agentProfile.trim() || null,
      allowed_skills: parseCsv(draft.skillsText),
      config_patch: {
        allowed_tools: parseCsv(draft.toolsText),
        provider: draft.provider.trim() || null,
        model: draft.model.trim() || null,
        input_context: draft.contextText.trim() || null,
        output_contract: outputContract.value,
      },
    },
  };
}

function applyProposalOverridesToEditor(editor) {
  const overrides = state.planner.proposalOverrides || {};
  const metadata = parseJsonObject(editor.metadataText || "{}");
  if (!metadata.ok) {
    throw new Error(`Planner draft metadata: ${metadata.message}`);
  }
  const nodes = editor.nodes.map((node, index) => {
    const key = getProposalNodeKey(node, index);
    if (!overrides[key]) {
      return node;
    }
    const draft = getProposalNodeDraft(node, index);
    const parsed = parseProposalOverrideNode(draft);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const configPatch = parsed.value.config_patch;
    const nextConfig = {
      ...(node.config || {}),
      allowed_tools: configPatch.allowed_tools,
      output_contract: configPatch.output_contract,
    };
    if (configPatch.provider) {
      nextConfig.provider = configPatch.provider;
    } else {
      delete nextConfig.provider;
    }
    if (configPatch.model) {
      nextConfig.model = configPatch.model;
    } else {
      delete nextConfig.model;
    }
    if (configPatch.input_context) {
      nextConfig.input_context = configPatch.input_context;
    } else {
      delete nextConfig.input_context;
    }
    return {
      ...node,
      agent_profile: parsed.value.agent_profile,
      allowed_skills: parsed.value.allowed_skills,
      config: nextConfig,
    };
  });
  return {
    ...editor,
    nodes,
    metadataText: prettyJson({
      ...metadata.value,
      planner_assignment_overrides: overrides,
    }),
  };
}

function getActiveProposalSessionId() {
  return state.selectedSessionId || state.workspaceDetail?.session?.session_id || "";
}

function getActiveProposalId() {
  return state.planner.activeProposal?.proposal_id || state.planner.confirmedProposalId || "";
}

function getActiveProposalTrace(detail = state.workspaceDetail) {
  const activeProposal = state.planner.activeProposal || null;
  const confirmedProposalId =
    state.planner.confirmedProposalId ||
    detail?.session?.confirmed_proposal_id ||
    detail?.workspace_state?.latest_proposal_id ||
    "";
  const proposalId = activeProposal?.proposal_id || confirmedProposalId;
  if (!proposalId) return null;
  const metadata = activeProposal?.metadata && typeof activeProposal.metadata === "object" ? activeProposal.metadata : {};
  return {
    proposalId,
    status: activeProposal?.status || (proposalId === confirmedProposalId ? "confirmed" : "tracked"),
    title: activeProposal?.title || "DAG proposal",
    executionTemplateId:
      typeof metadata.execution_template_id === "string" && metadata.execution_template_id.trim()
        ? metadata.execution_template_id.trim()
        : "",
    confirmedBy: activeProposal?.confirmed_by || "",
    confirmedAt: activeProposal?.confirmed_at || "",
    assignmentCount: Array.isArray(activeProposal?.assignments) ? activeProposal.assignments.length : null,
  };
}

function getCurrentProposalPlanRevision() {
  const optionsCard = (state.workspaceDetail?.messages || [])
    .filter((message) => message.kind === "plan_options_card")
    .slice(-1)[0];
  const revision =
    typeof optionsCard?.content?.revision === "number"
      ? optionsCard.content.revision
      : typeof state.workspaceDetail?.mission_spec?.route?.activeRevision === "number"
        ? state.workspaceDetail.mission_spec.route.activeRevision
        : null;
  const option =
    optionsCard?.content?.selected_option === "alternative" ? "alternative" : "primary";
  return revision ? { revision, option } : null;
}

function getProposalDraftSource() {
  const durableDraft = state.planner.activeProposal?.dag_draft;
  if (durableDraft && typeof durableDraft === "object" && !Array.isArray(durableDraft)) {
    return durableDraft;
  }
  return state.planner.dagDraft;
}

function getProposalSourceNodes() {
  const dagDraft = getProposalDraftSource();
  const dagNodes = Array.isArray(dagDraft?.draft_template?.nodes)
    ? dagDraft.draft_template.nodes
    : [];
  if (dagNodes.length) return dagNodes;
  return state.planner.candidatePlan?.candidate_plan?.compiled_nodes || [];
}

function proposalOverridesFromAssignments(proposal) {
  const overrides = {};
  for (const assignment of proposal?.assignments || []) {
    if (!assignment?.node_id) continue;
    overrides[assignment.node_id] = {
      agentProfile: assignment.subagent_profile_id || "",
      skillsText: (assignment.allowed_skills || []).join(", "),
      toolsText: (assignment.allowed_tools || []).join(", "),
      provider: assignment.provider || "",
      model: assignment.model || "",
      contextText: assignment.input_context || "",
      outputContractText: assignment.output_contract || "{}",
    };
  }
  return overrides;
}

function applyDurableProposalToPlanner(proposal) {
  state.planner.activeProposal = proposal || null;
  if (!proposal) {
    state.planner.proposalOverrides = {};
    return;
  }
  if (proposal.dag_draft && typeof proposal.dag_draft === "object" && !Array.isArray(proposal.dag_draft)) {
    state.planner.dagDraft = proposal.dag_draft;
  }
  state.planner.proposalOverrides = proposalOverridesFromAssignments(proposal);
}

function resetDurableProposalState(sessionId = "") {
  state.planner.dagProposals = [];
  state.planner.confirmedProposalId = null;
  state.planner.activeProposal = null;
  state.planner.proposalSessionId = sessionId;
  state.planner.proposalOverrides = {};
}

function updateProposalOverride(key, patch) {
  state.planner.proposalOverrides = {
    ...state.planner.proposalOverrides,
    [key]: {
      ...(state.planner.proposalOverrides[key] || {}),
      ...patch,
    },
  };
  render();
}

function syncProposalOverrideField(target) {
  const key = target.dataset.key || "";
  const field = target.dataset.field || "";
  const value = target.value;
  if (!key) return;
  const current = state.planner.proposalOverrides[key] || {};
  const next = { ...current };
  if (field === "proposal.agent_profile") next.agentProfile = value;
  if (field === "proposal.allowed_skills") next.skillsText = value;
  if (field === "proposal.allowed_tools") next.toolsText = value;
  if (field === "proposal.provider") next.provider = value;
  if (field === "proposal.model") next.model = value;
  if (field === "proposal.context") next.contextText = value;
  if (field === "proposal.output_contract") next.outputContractText = value;
  state.planner.proposalOverrides = {
    ...state.planner.proposalOverrides,
    [key]: next,
  };
}

function flushProposalOverridesFromDom() {
  document
    .querySelectorAll("[data-field^='proposal.'][data-key]")
    .forEach((target) => syncProposalOverrideField(target));
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function statusTone(status) {
  if (
    status === "published" ||
    status === "completed" ||
    status === "ready" ||
    status === "running" ||
    status === "active" ||
    status === "done" ||
    status === "returned" ||
    status === "satisfied" ||
    status === "confirmed"
  ) {
    return "success";
  }
  if (status === "failed" || status === "cancelled" || status === "blocked") return "danger";
  if (
    status === "draft" ||
    status === "new" ||
    status === "waiting_human" ||
    status === "paused" ||
    status === "prepared" ||
    status === "in_progress" ||
    status === "review_ready"
  ) return "warn";
  return "neutral";
}

function getPatchOperationOutcomes(patch) {
  if (Array.isArray(patch?.operation_outcomes)) {
    return patch.operation_outcomes.filter((item) => item && typeof item === "object");
  }
  if (Array.isArray(patch?.metadata?.operation_outcomes)) {
    return patch.metadata.operation_outcomes.filter((item) => item && typeof item === "object");
  }
  return [];
}

function getPatchTopology(patch) {
  if (patch?.resumed_topology && typeof patch.resumed_topology === "object") {
    return patch.resumed_topology;
  }
  if (patch?.metadata?.resumed_topology && typeof patch.metadata.resumed_topology === "object") {
    return patch.metadata.resumed_topology;
  }
  return null;
}

function getPatchGraphPreview(patch) {
  if (patch?.graph_preview && typeof patch.graph_preview === "object") {
    return patch.graph_preview;
  }
  if (patch?.metadata?.graph_preview && typeof patch.metadata.graph_preview === "object") {
    return patch.metadata.graph_preview;
  }
  return null;
}

function renderPatchGraphPreview(patch) {
  const preview = getPatchGraphPreview(patch);
  if (!preview) return "";
  const lines = Array.isArray(preview.summary_lines)
    ? preview.summary_lines.filter((line) => typeof line === "string" && line.trim()).slice(0, 4)
    : [];
  const predicted = preview.predicted_topology && typeof preview.predicted_topology === "object"
    ? preview.predicted_topology
    : null;
  const actual = preview.actual_topology && typeof preview.actual_topology === "object"
    ? preview.actual_topology
    : null;
  return `
    <div class="patch-graph-preview">
      <div class="patch-outcome-head">
        <strong>Graph Preview</strong>
        <span class="badge ${actual ? "success" : "warn"}">${escapeHtml(actual ? "actual" : "predicted")}</span>
      </div>
      ${
        lines.length
          ? `<div class="patch-outcome-list">${lines
              .map((line) => `<small>${escapeHtml(line)}</small>`)
              .join("")}</div>`
          : ""
      }
      ${
        predicted
          ? `<small>${escapeHtml(`Predicted: ${predicted.node_count ?? "-"} nodes / ${predicted.edge_count ?? "-"} edges`)}</small>`
          : ""
      }
      ${
        actual
          ? `<small>${escapeHtml(`Actual: ${actual.node_count ?? "-"} nodes / ${actual.edge_count ?? "-"} edges`)}</small>`
          : ""
      }
    </div>
  `;
}

function findLatestPatchWithGraphPreview(detail) {
  const patches = Array.isArray(detail?.dag_patches) ? detail.dag_patches : [];
  return [...patches].reverse().find((patch) => getPatchGraphPreview(patch)) || null;
}

function formatTopologySnapshotLine(topology) {
  if (!topology || typeof topology !== "object") {
    return "No topology snapshot";
  }
  const readyCount = Array.isArray(topology.ready_node_run_ids) ? topology.ready_node_run_ids.length : 0;
  const runningCount = Array.isArray(topology.running_node_run_ids) ? topology.running_node_run_ids.length : 0;
  const waitingCount = Array.isArray(topology.waiting_node_run_ids) ? topology.waiting_node_run_ids.length : 0;
  return `${topology.node_count ?? "-"} nodes / ${topology.edge_count ?? "-"} edges / ${readyCount} ready / ${runningCount} running / ${waitingCount} waiting`;
}

function renderPatchTopologySnapshotCard(label, topology, tone) {
  const frontier = Array.isArray(topology?.frontier) ? topology.frontier : [];
  return `
    <div class="patch-topology-card">
      <div class="patch-outcome-head">
        <strong>${escapeHtml(label)}</strong>
        <span class="badge ${tone}">${escapeHtml(topology ? "available" : "missing")}</span>
      </div>
      <p>${escapeHtml(formatTopologySnapshotLine(topology))}</p>
      <small>${escapeHtml(frontier.length ? `Frontier: ${frontier.slice(0, 4).join(", ")}` : "No frontier snapshot")}</small>
      ${
        typeof topology?.max_parallel_nodes === "number"
          ? `<small>${escapeHtml(`Max parallel nodes: ${topology.max_parallel_nodes}`)}</small>`
          : ""
      }
    </div>
  `;
}

function renderPatchGraphReviewPanel(detail) {
  const patch = findLatestPatchWithGraphPreview(detail);
  if (!patch) {
    return "";
  }
  const preview = getPatchGraphPreview(patch);
  const lines = Array.isArray(preview?.summary_lines)
    ? preview.summary_lines.filter((line) => typeof line === "string" && line.trim()).slice(0, 5)
    : [];
  const labels = Array.isArray(preview?.operation_labels)
    ? preview.operation_labels.filter((label) => typeof label === "string" && label.trim())
    : [];
  const actual = preview?.actual_topology && typeof preview.actual_topology === "object"
    ? preview.actual_topology
    : null;
  return `
    <section class="subpanel patch-graph-review-panel" data-workspace-focus="patch-graph">
      <div class="subpanel-header">
        <strong>Patch Graph Review</strong>
        <span class="badge ${actual ? "success" : "warn"}">${escapeHtml(actual ? "Actual recorded" : "Prediction")}</span>
      </div>
      <p class="muted">${escapeHtml(patch.summary || patch.reason || "Runtime patch graph impact preview.")}</p>
      <div class="patch-graph-review-grid">
        ${renderPatchTopologySnapshotCard("Current", preview?.before_topology || null, "neutral")}
        ${renderPatchTopologySnapshotCard("Predicted", preview?.predicted_topology || null, "warn")}
        ${renderPatchTopologySnapshotCard("Actual", actual, actual ? "success" : "neutral")}
      </div>
      ${
        labels.length
          ? `<div class="patch-operation-tags">${labels
              .map((label) => `<span class="badge warn">${escapeHtml(label)}</span>`)
              .join("")}</div>`
          : ""
      }
      ${
        lines.length
          ? `<div class="patch-review-lines">${lines
              .map((line) => `<small>${escapeHtml(line)}</small>`)
              .join("")}</div>`
          : ""
      }
    </section>
  `;
}

function patchStatusTone(status) {
  if (status === "applied") return "success";
  if (status === "applied_with_errors" || status === "needs_confirmation") return "warn";
  if (status === "unsupported" || status === "rejected") return "neutral";
  return statusTone(status);
}

function getWorkspaceContractVersion(detail) {
  const snapshotVersion = detail?.mission_snapshot?.workspace_contract_version;
  if (typeof snapshotVersion === "number" && Number.isFinite(snapshotVersion)) {
    return snapshotVersion;
  }
  const responseVersion = detail?.workspace_contract_version;
  return typeof responseVersion === "number" && Number.isFinite(responseVersion)
    ? responseVersion
    : 0;
}

function hasVersionedMissionWorkspaceSnapshot(snapshot) {
  return (
    !!snapshot &&
    typeof snapshot.workspace_contract_version === "number" &&
    snapshot.workspace_contract_version > 0
  );
}

function getWorkspaceMissionSpec(detail) {
  const snapshot = detail?.mission_snapshot || null;
  if (hasVersionedMissionWorkspaceSnapshot(snapshot)) {
    return snapshot.spec || detail?.mission_spec || detail?.session?.mission_spec || null;
  }
  return detail?.mission_spec || snapshot?.spec || detail?.session?.mission_spec || null;
}

function getWorkspaceLatestRunId(detail) {
  return detail?.latest_run?.run_id || detail?.session?.latest_run_id || detail?.mission?.latest_run_id || null;
}

function formatMissionRouteLabel(route) {
  if (!route) return "Unrouted";
  const revision = route.activeRevision ?? route.confirmedRevision ?? route.latestRevision;
  const option = route.activeOption || route.confirmedOption || "primary";
  if (typeof revision === "number") return `v${revision} / ${option}`;
  if (route.selectedTemplateName) return route.selectedTemplateName;
  return route.stale ? "Needs refresh" : "Unrouted";
}

function renderSpecChipList(items, emptyLabel) {
  const values = Array.isArray(items)
    ? items.filter((item) => typeof item === "string" && item.trim()).slice(0, 6)
    : [];
  if (!values.length) {
    return `<p class="muted">${escapeHtml(emptyLabel)}</p>`;
  }
  return `
    <div class="skill-chip-list">
      ${values.map((item) => `<span class="skill-chip">${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function renderProposalTracePanel(detail = state.workspaceDetail) {
  const trace = getActiveProposalTrace(detail);
  if (!trace) return "";
  const confirmedAt = trace.confirmedAt ? new Date(trace.confirmedAt).toLocaleString() : "";
  return `
    <div class="proposal-trace-panel">
      <div class="proposal-record-meta">
        <span class="badge ${statusTone(trace.status)}">${escapeHtml(trace.status)}</span>
        <small>${escapeHtml(trace.proposalId)}</small>
      </div>
      <div class="rail-kv-list compact-kv-list">
        <div><strong>Proposal</strong><span>${escapeHtml(trace.title)}</span></div>
        <div><strong>Template</strong><span>${escapeHtml(trace.executionTemplateId || "not resolved")}</span></div>
        <div><strong>Assignments</strong><span>${escapeHtml(trace.assignmentCount === null ? "not loaded" : String(trace.assignmentCount))}</span></div>
        <div><strong>Confirmed</strong><span>${escapeHtml(trace.confirmedBy ? `${trace.confirmedBy}${confirmedAt ? ` / ${confirmedAt}` : ""}` : "not confirmed")}</span></div>
      </div>
    </div>
  `;
}

function countRouteCompareChanges(changeSet) {
  if (!changeSet) return 0;
  return (
    (changeSet.added || []).length +
    (changeSet.removed || []).length +
    (changeSet.changed || []).length
  );
}

function renderRouteCompareGroup(title, changeSet, tone = "neutral") {
  const count = countRouteCompareChanges(changeSet);
  if (!count) return "";
  const items = [
    ...(changeSet.added || []).map((item) => `Added ${item}`),
    ...(changeSet.removed || []).map((item) => `Removed ${item}`),
    ...(changeSet.changed || []).map((item) => `Changed ${item}`),
  ].slice(0, 5);
  return `
    <div class="route-compare-group">
      <div class="subpanel-header">
        <strong>${escapeHtml(title)}</strong>
        <span class="badge ${tone}">${escapeHtml(String(count))}</span>
      </div>
      <div class="route-compare-list">
        ${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderRouteComparePanel(compare) {
  if (!compare) {
    return "";
  }
  const groups = [
    renderRouteCompareGroup("Nodes", compare.changedNodes),
    renderRouteCompareGroup("Edges", compare.changedEdges),
    renderRouteCompareGroup("Gates", compare.changedApprovals, "warn"),
    renderRouteCompareGroup("Outputs", compare.changedOutputs, "success"),
    renderRouteCompareGroup("Risks", compare.changedRisks, "warn"),
  ].filter(Boolean);
  const summary =
    (compare.summaryLines || []).find((line) => !/^Comparing /i.test(line)) ||
    compare.recommendation?.detail ||
    "No material route changes detected.";

  return `
    <section class="subpanel route-compare-panel" data-workspace-focus="compare">
      <div class="subpanel-header">
        <strong>Route Compare</strong>
        <span class="badge ${escapeHtml(compare.recommendation?.tone || "neutral")}">${escapeHtml(compare.recommendation?.label || "Compare")}</span>
      </div>
      <div class="route-compare-endpoints">
        <div>
          <span>Left</span>
          <strong>${escapeHtml(compare.left?.label || "left")}</strong>
          <small>${escapeHtml(compare.left?.templateName || compare.left?.templateId || "No template")}</small>
        </div>
        <div>
          <span>Right</span>
          <strong>${escapeHtml(compare.right?.label || "right")}</strong>
          <small>${escapeHtml(compare.right?.templateName || compare.right?.templateId || "No template")}</small>
        </div>
      </div>
      <p class="muted">${escapeHtml(summary)}</p>
      ${
        groups.length
          ? `<div class="route-compare-grid">${groups.join("")}</div>`
          : '<p class="muted">No changed nodes, gates, outputs, or risks.</p>'
      }
    </section>
  `;
}

function renderMissionWorkspaceSectionGrid(sections) {
  const values = Array.isArray(sections) ? sections : [];
  if (!values.length) {
    return "";
  }
  const rank = {
    objective: 0,
    route: 1,
    work_packages: 2,
    checkpoints: 3,
    outputs: 4,
    pending_decisions: 5,
    execution_summary: 6,
    evidence_summary: 7,
  };
  return `
    <section class="subpanel mission-main-surface-panel">
      <div class="subpanel-header">
        <strong>Workspace Surfaces</strong>
        <span class="badge neutral">${escapeHtml(String(values.length))}</span>
      </div>
      <div class="mission-main-surface-grid">
        ${[...values]
          .sort((left, right) => (rank[left.key] ?? 50) - (rank[right.key] ?? 50))
          .map(
            (section) => `
              <div class="mission-main-surface-card">
                <div class="mission-main-surface-head">
                  <span>${escapeHtml(section.label || section.key || "Surface")}</span>
                  <span class="badge ${statusTone(section.status || section.tone)}">${escapeHtml(section.status || "pending")}</span>
                </div>
                <strong>${escapeHtml(section.title || "Workspace surface")}</strong>
                <p>${escapeHtml(section.summary || "No surface summary yet.")}</p>
                ${
                  Array.isArray(section.detailLines) && section.detailLines.length
                    ? `<div class="mission-main-surface-lines">${section.detailLines
                        .slice(0, 3)
                        .map((line) => `<small>${escapeHtml(line)}</small>`)
                        .join("")}</div>`
                    : ""
                }
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMissionWorkPackagesPanel(pipelines) {
  const values = Array.isArray(pipelines) ? pipelines : [];
  return `
    <section class="subpanel mission-detail-panel">
      <div class="subpanel-header">
        <strong>Work Packages</strong>
        <span class="badge ${values.length ? "success" : "neutral"}">${escapeHtml(String(values.length))}</span>
      </div>
      <div class="mission-detail-list">
        ${
          values.length
            ? values
                .map(
                  (pipeline) => `
                    <div class="mission-detail-item">
                      <div class="mission-detail-head">
                        <strong>${escapeHtml(pipeline.title || pipeline.key || "Work package")}</strong>
                        <span class="badge ${statusTone(pipeline.status || pipeline.tone)}">${escapeHtml(pipeline.status || "pending")}</span>
                      </div>
                      <p>${escapeHtml(pipeline.summary || "Compiled work package is ready for orchestration.")}</p>
                      <div class="mission-detail-meta">
                        <small>${escapeHtml(pipeline.activeNodeName || pipeline.blocker || "No active node detail yet.")}</small>
                        ${
                          pipeline.primaryAgentLabel
                            ? `<small>${escapeHtml(`Lead agent: ${pipeline.primaryAgentLabel}`)}</small>`
                            : ""
                        }
                        ${
                          pipeline.artifactExpectation
                            ? `<small>${escapeHtml(`Expected outputs: ${pipeline.artifactExpectation}`)}</small>`
                            : ""
                        }
                        ${
                          Array.isArray(pipeline.outputKeys) && pipeline.outputKeys.length
                            ? `<small>${escapeHtml(`Output keys: ${pipeline.outputKeys.slice(0, 3).join(", ")}`)}</small>`
                            : ""
                        }
                        ${
                          Array.isArray(pipeline.checkpointKeys) && pipeline.checkpointKeys.length
                            ? `<small>${escapeHtml(`Checkpoints: ${pipeline.checkpointKeys.slice(0, 3).join(", ")}`)}</small>`
                            : ""
                        }
                        ${
                          pipeline.nextActionLabel
                            ? `<small>${escapeHtml(`Next: ${pipeline.nextActionLabel}`)}</small>`
                            : ""
                        }
                      </div>
                    </div>
                  `,
                )
                .join("")
            : '<p class="muted">No work packages are materialized yet.</p>'
        }
      </div>
    </section>
  `;
}

function uniqueWorkspaceLabels(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function findArtifactByMessageId(detail, artifactMessageId) {
  if (!artifactMessageId) return null;
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
  const artifactMessage = messages.find(
    (message) => message.message_id === artifactMessageId && message.kind === "artifact_card",
  );
  if (!artifactMessage) return null;
  const content = artifactMessage.content || {};
  return (
    artifacts.find((artifact) => {
      const nameMatches =
        content.name && artifact.name && String(content.name).trim() === String(artifact.name).trim();
      const uriMatches =
        content.storage_uri &&
        (artifact.storage_uri || artifact.path) &&
        String(content.storage_uri).trim() === String(artifact.storage_uri || artifact.path).trim();
      return Boolean(nameMatches || uriMatches);
    }) || {
      name: content.name || content.artifact_id || "Artifact",
      storage_uri: content.storage_uri || "",
      mime_type: content.mime_type || "",
      summary: "Returned artifact linked from the mission output ledger.",
    }
  );
}

function buildMissionEvidenceBundle(chips, lines) {
  const evidence = [];
  const seenChips = new Set();
  for (const chip of Array.isArray(chips) ? chips : []) {
    const label = String(chip?.label || "").trim();
    if (!label) continue;
    const tone = chip?.tone || "neutral";
    const key = `${tone}:${label.toLowerCase()}`;
    if (seenChips.has(key)) continue;
    seenChips.add(key);
    evidence.push({ tone, label });
  }
  return {
    evidence,
    lines: uniqueWorkspaceLabels(lines),
  };
}

function buildMissionSurfaceEvidence(detail, surface, item) {
  if (surface === "checkpoint") {
    return buildMissionCheckpointEvidence(detail, item);
  }
  if (surface === "output") {
    return buildMissionOutputEvidence(detail, item);
  }
  return buildMissionEvidenceBundle([], []);
}

function buildMissionArtifactRunEvidence(entry) {
  const chips = [];
  const lines = [];
  if (entry?.routeLabel) {
    chips.push({ tone: "neutral", label: entry.routeLabel });
    lines.push(`Route: ${entry.routeLabel}`);
  }
  if (entry?.runId) {
    chips.push({ tone: "warn", label: "Run linked" });
    lines.push(`Run: ${entry.runId}`);
  }
  if (entry?.nodeRunId) {
    chips.push({ tone: "warn", label: "Node run linked" });
    lines.push(`Node run: ${entry.nodeRunId}`);
  }
  if (entry?.createdAt) {
    lines.push(`Captured: ${formatWorkspaceTimestamp(entry.createdAt)}`);
  }
  return buildMissionEvidenceBundle(chips, lines);
}

function buildMissionArtifactEntry(detail, message, runCardByRunId = new Map(), fallbackRouteLabel = "") {
  if (!message || message.kind !== "artifact_card") {
    return null;
  }
  const content = message.content || {};
  const name =
    typeof content.name === "string"
      ? content.name
      : typeof content.artifact_id === "string"
        ? content.artifact_id
        : "";
  const runId = message.linked_run_id || null;
  const runCard = runId ? runCardByRunId.get(runId) || null : null;
  const planRevision =
    typeof runCard?.content?.plan_revision === "number"
      ? runCard.content.plan_revision
      : null;
  const planOption =
    typeof runCard?.content?.plan_option === "string" && runCard.content.plan_option.trim()
      ? runCard.content.plan_option.trim()
      : null;
  const artifact = findArtifactByMessageId(detail, message.message_id);
  const artifactName = name || artifact?.name || "";
  const artifactUri =
    (typeof content.storage_uri === "string" && content.storage_uri.trim()) ||
    artifact?.storage_uri ||
    artifact?.path ||
    "";
  const artifactMimeType =
    (typeof content.mime_type === "string" && content.mime_type.trim()) ||
    artifact?.mime_type ||
    artifact?.type ||
    "";
  const artifactTitle = artifactName || artifact?.artifact_id || "Artifact";
  const artifactDetail = artifactUri || artifactMimeType || artifact?.summary || "Returned artifact";
  const entry = {
    key: message.message_id,
    artifactTitle,
    artifactDetail,
    artifactName: artifactName || artifactTitle,
    artifactUri,
    artifactMimeType,
    artifactSummary: artifact?.summary || "",
    createdAt: message.created_at,
    runId,
    routeLabel:
      typeof planRevision === "number"
        ? `v${planRevision} / ${planOption || "primary"}`
        : fallbackRouteLabel,
    nodeRunId: message.linked_node_run_id || null,
  };
  return {
    ...entry,
    evidence: buildMissionArtifactRunEvidence(entry),
  };
}

function buildMissionOutputEvidence(detail, output) {
  const pipelineMap = new Map(
    (Array.isArray(detail?.mission_snapshot?.pipelines) ? detail.mission_snapshot.pipelines : []).map((pipeline) => [
      pipeline.key,
      pipeline,
    ]),
  );
  const pipelineLabels = uniqueWorkspaceLabels(
    (output?.pipelineKeys || []).map((key) => pipelineMap.get(key)?.title || formatWorkspaceLabel(key)),
  );
  const artifacts = uniqueWorkspaceLabels(
    (output?.artifactMessageIds || []).map((artifactMessageId) => {
      const artifact = findArtifactByMessageId(detail, artifactMessageId);
      if (!artifact) return null;
      return artifact.name || artifact.storage_uri || artifact.mime_type || "Artifact";
    }),
  );
  const evidence = [];
  if (pipelineLabels.length) {
    evidence.push({ tone: "neutral", label: `${pipelineLabels.length} package${pipelineLabels.length === 1 ? "" : "s"}` });
  }
  if (artifacts.length) {
    evidence.push({ tone: "success", label: `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}` });
  }
  if (output?.status === "returned") {
    evidence.push({ tone: "success", label: "Returned" });
  } else if (output?.status === "in_progress") {
    evidence.push({ tone: "warn", label: "Runtime linked" });
  } else if (output?.status === "prepared") {
    evidence.push({ tone: "warn", label: "Prepared" });
  }
  return buildMissionEvidenceBundle(evidence, [
    pipelineLabels.length ? `Work packages: ${pipelineLabels.join(", ")}` : null,
    artifacts.length ? `Artifacts: ${artifacts.join(", ")}` : null,
  ]);
}

function buildMissionDeliveryTrace(detail) {
  const outputs = Array.isArray(detail?.mission_snapshot?.outputs) ? detail.mission_snapshot.outputs : [];
  const pipelines = Array.isArray(detail?.mission_snapshot?.pipelines) ? detail.mission_snapshot.pipelines : [];
  const runtimeNodes = Array.isArray(detail?.runtime_graph?.nodes) ? detail.runtime_graph.nodes : [];
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const runCards = messages.filter((message) => message.kind === "run_card");
  const runCardByRunId = new Map(
    runCards
      .map((message) => {
        const runId = typeof message.content?.run_id === "string" ? message.content.run_id : message.linked_run_id;
        return runId ? [runId, message] : null;
      })
      .filter(Boolean),
  );
  const routeLabel = formatMissionRouteLabel(detail?.mission_spec?.route || null);

  const pipelineMap = new Map(pipelines.map((pipeline) => [pipeline.key, pipeline]));
  const nodeRunsByPackage = new Map();
  const nodeByRunId = new Map(runtimeNodes.map((node) => [node.nodeRunId, node]));
  for (const node of runtimeNodes) {
    const current = nodeRunsByPackage.get(node.workPackageKey) || [];
    current.push(node);
    nodeRunsByPackage.set(node.workPackageKey, current);
  }

  const traces = outputs.map((output) => {
    const packageKeys = Array.isArray(output.pipelineKeys) ? output.pipelineKeys : [];
    const packages = packageKeys
      .map((key) => {
        const pipeline = pipelineMap.get(key) || null;
        const relatedNodes = nodeRunsByPackage.get(key) || [];
        return {
          key,
          title: pipeline?.title || formatWorkspaceLabel(key),
          status: pipeline?.status || (relatedNodes.some((node) => node.status === "running" || node.status === "waiting_human") ? "active" : "pending"),
          nodes: relatedNodes.map((node) => ({
            name: node.name || node.nodeId || "Node",
            status: node.status || "pending",
          })),
        };
      })
      .filter((item) => item.title);

    const artifacts = (Array.isArray(output.artifactMessageIds) ? output.artifactMessageIds : [])
      .map((artifactMessageId) => {
        const artifactMessage = messages.find((message) => message.message_id === artifactMessageId) || null;
        const artifactEntry = buildMissionArtifactEntry(detail, artifactMessage, runCardByRunId, routeLabel);
        return artifactEntry
          ? {
              title: artifactEntry.artifactTitle,
              detail: artifactEntry.artifactDetail,
              linkedNodeRunId: artifactEntry.nodeRunId,
              evidence: artifactEntry.evidence,
              linkedNodeName:
                artifactMessage?.linked_node_run_id && nodeByRunId.has(artifactMessage.linked_node_run_id)
                  ? nodeByRunId.get(artifactMessage.linked_node_run_id)?.name ||
                    nodeByRunId.get(artifactMessage.linked_node_run_id)?.nodeId ||
                    null
                  : null,
            }
          : null;
      })
      .filter(Boolean);

    return {
      key: output.key || normalizeWorkspaceKey(output.title || "output"),
      title: output.title || output.key || "Output",
      status: output.status || "requested",
      packages,
      artifacts,
    };
  });

  return traces.filter((trace) => trace.packages.length || trace.artifacts.length || trace.status !== "requested");
}

function buildMissionOutputHistory(detail) {
  const outputs = Array.isArray(detail?.mission_snapshot?.outputs) ? detail.mission_snapshot.outputs : [];
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const runCards = messages.filter((message) => message.kind === "run_card");
  const runCardByRunId = new Map(
    runCards
      .map((message) => {
        const runId = typeof message.content?.run_id === "string" ? message.content.run_id : message.linked_run_id;
        return runId ? [runId, message] : null;
      })
      .filter(Boolean),
  );
  const routeLabel = formatMissionRouteLabel(detail?.mission_spec?.route || null);

  return outputs
    .map((output) => {
      const title = output.title || output.key || "Output";
      const requestedKey = normalizeWorkspaceKey(title);
      const historyEntries = messages
        .filter((message) => message.kind === "artifact_card")
        .map((message) => {
          const content = message.content || {};
          const name = typeof content.name === "string" ? content.name : typeof content.artifact_id === "string" ? content.artifact_id : "";
          if (normalizeWorkspaceKey(name) !== requestedKey) {
            return null;
          }
          return buildMissionArtifactEntry(detail, message, runCardByRunId, routeLabel);
        })
        .filter(Boolean)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

      const latest = historyEntries[0] || null;
      const previous = historyEntries[1] || null;

      return {
        key: output.key || requestedKey,
        title,
        status: output.status || "requested",
        count: historyEntries.length,
        latest,
        previous,
        historyEntries,
      };
    })
    .filter((item) => item.count > 0 || item.status !== "requested");
}

function getMissionCheckpointKey(checkpoint) {
  return checkpoint?.key || normalizeWorkspaceKey(checkpoint?.label || checkpoint?.title || checkpoint?.status || "checkpoint");
}

function getSelectedWorkspaceOutputHistory(detail = state.workspaceDetail) {
  const selection = state.workspaceSelection || {};
  if (selection.type !== "output-history" || !selection.key) {
    return null;
  }
  return buildMissionOutputHistory(detail).find((item) => item.key === selection.key) || null;
}

function getSelectedWorkspaceCheckpoint(detail = state.workspaceDetail) {
  const selection = state.workspaceSelection || {};
  if (selection.type !== "checkpoint" || !selection.key) {
    return null;
  }
  const checkpoints = Array.isArray(detail?.mission_snapshot?.checkpoints) ? detail.mission_snapshot.checkpoints : [];
  return checkpoints.find((checkpoint) => getMissionCheckpointKey(checkpoint) === selection.key) || null;
}

function clearWorkspaceSelection() {
  state.workspaceSelection = {
    type: "none",
    key: null,
  };
}

function resetWorkspaceDrilldownState({ resetFeed = true } = {}) {
  clearWorkspaceSelection();
  pendingWorkspaceFocus = null;
  pendingWorkspaceFeedEntryKey = null;
  restoreWorkspaceFocusFromLocation = false;
  if (resetFeed) {
    state.ui.workspaceFeedFilter = "all";
    state.ui.workspaceFeedExpanded = false;
  }
}

function prepareWorkspaceSessionChange(nextSessionId) {
  const currentSessionId = state.selectedSessionId || getWorkspaceSessionId(state.workspaceDetail);
  if (currentSessionId && nextSessionId && currentSessionId !== nextSessionId) {
    resetWorkspaceDrilldownState();
  }
}

function reconcileWorkspaceSelection(detail = state.workspaceDetail) {
  const selection = state.workspaceSelection || {};
  if (selection.type === "output-history") {
    const items = buildMissionOutputHistory(detail);
    if (!items.some((item) => item.key === selection.key)) {
      clearWorkspaceSelection();
    }
    return;
  }
  if (selection.type === "checkpoint") {
    const checkpoints = Array.isArray(detail?.mission_snapshot?.checkpoints) ? detail.mission_snapshot.checkpoints : [];
    if (!checkpoints.some((checkpoint) => getMissionCheckpointKey(checkpoint) === selection.key)) {
      clearWorkspaceSelection();
    }
    return;
  }
  if (selection.type !== "none" || selection.key !== null) {
    clearWorkspaceSelection();
  }
}

function formatWorkspaceTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function buildOutputHistoryDeltaSummary(item) {
  if (!item?.latest) {
    return {
      tone: "neutral",
      summary: "No returned artifact yet.",
      chips: [{ tone: statusTone(item?.status || "requested"), label: item?.status || "requested" }],
      lines: [],
    };
  }

  const latest = item.latest;
  const previous = item.previous;
  if (!previous) {
    return {
      tone: "success",
      summary: "First returned version captured.",
      chips: [
        { tone: "success", label: "First version" },
        { tone: statusTone(item.status || "returned"), label: item.status || "returned" },
      ],
      lines: uniqueWorkspaceLabels([
        latest.artifactName ? `Artifact: ${latest.artifactName}` : null,
        latest.artifactUri ? `URI: ${latest.artifactUri}` : null,
        latest.artifactMimeType ? `MIME: ${latest.artifactMimeType}` : null,
        latest.routeLabel ? `Route: ${latest.routeLabel}` : null,
        latest.runId ? `Run: ${latest.runId}` : null,
        latest.nodeRunId ? `Node run: ${latest.nodeRunId}` : null,
        latest.createdAt ? `Captured: ${formatWorkspaceTimestamp(latest.createdAt)}` : null,
      ]),
    };
  }

  const chips = [];
  const lines = [];
  const addArtifactFieldDelta = (label, key, tone = "success") => {
    const before = previous[key] || "";
    const after = latest[key] || "";
    if (before !== after) {
      chips.push({ tone, label: `${label} changed` });
      lines.push(`${label}: ${before || "unknown"} -> ${after || "unknown"}`);
      return true;
    }
    return false;
  };

  if (latest.routeLabel !== previous.routeLabel) {
    chips.push({ tone: "warn", label: "Route changed" });
    lines.push(`Route: ${previous.routeLabel || "unknown"} -> ${latest.routeLabel || "unknown"}`);
  } else if (latest.routeLabel) {
    chips.push({ tone: "neutral", label: "Route stable" });
  }

  const artifactNameChanged = addArtifactFieldDelta("Name", "artifactName");
  const artifactUriChanged = addArtifactFieldDelta("URI", "artifactUri");
  const artifactMimeChanged = addArtifactFieldDelta("MIME", "artifactMimeType");
  if (!artifactNameChanged && !artifactUriChanged && !artifactMimeChanged && latest.artifactDetail) {
    chips.push({ tone: "neutral", label: "Artifact stable" });
  }

  if (latest.runId && previous.runId && latest.runId !== previous.runId) {
    chips.push({ tone: "warn", label: "Run changed" });
    lines.push(`Run: ${previous.runId} -> ${latest.runId}`);
  } else if (latest.runId) {
    chips.push({ tone: "neutral", label: "Same run lineage" });
  }

  if (latest.nodeRunId && previous.nodeRunId && latest.nodeRunId !== previous.nodeRunId) {
    chips.push({ tone: "warn", label: "Node reran" });
    lines.push(`Node run: ${previous.nodeRunId} -> ${latest.nodeRunId}`);
  } else if (latest.nodeRunId) {
    chips.push({ tone: "neutral", label: "Same node lineage" });
  }

  if ((latest.createdAt || previous.createdAt) && latest.createdAt !== previous.createdAt) {
    chips.push({ tone: "neutral", label: "Capture changed" });
    lines.push(`Captured: ${formatWorkspaceTimestamp(previous.createdAt)} -> ${formatWorkspaceTimestamp(latest.createdAt)}`);
  }

  const materialChange = chips.some((chip) => chip.label.includes("changed") || chip.label === "Node reran");

  return {
    tone: materialChange ? "warn" : "neutral",
    summary: materialChange ? "Latest version diverges from the prior artifact return." : "Latest version matches the prior artifact identity and route.",
    chips: uniqueWorkspaceLabels(chips.map((chip) => `${chip.tone}::${chip.label}`)).map((value) => {
      const [tone, label] = value.split("::");
      return { tone, label };
    }),
    lines: uniqueWorkspaceLabels(lines),
  };
}

function buildWorkspaceEvidenceFeedItems(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && message.kind !== "text")
    .slice()
    .reverse()
    .map((message) => {
      const content = message.content || {};
      if (message.kind === "artifact_card") {
        const routeLabel =
          typeof content.plan_revision === "number"
            ? `v${content.plan_revision} / ${content.plan_option || "primary"}`
            : "";
        return {
          key: message.message_id || `artifact:${message.created_at || ""}`,
          kind: message.kind,
          title: content.name || content.artifact_id || "Artifact",
          detail:
            (typeof content.storage_uri === "string" && content.storage_uri.trim()) ||
            (typeof content.mime_type === "string" && content.mime_type.trim()) ||
            "Returned artifact",
          meta: uniqueWorkspaceLabels([
            routeLabel ? `Route: ${routeLabel}` : null,
            message.linked_run_id ? `Run: ${message.linked_run_id}` : null,
            message.linked_node_run_id ? `Node run: ${message.linked_node_run_id}` : null,
          ]),
          createdAt: message.created_at || "",
        };
      }
      if (message.kind === "run_card") {
        return {
          key: message.message_id || `run:${message.created_at || ""}`,
          kind: message.kind,
          title: content.title || content.run_id || "Run",
          detail:
            (typeof content.summary === "string" && content.summary.trim()) ||
            (message.linked_run_id ? `Run: ${message.linked_run_id}` : "Run update"),
          meta: uniqueWorkspaceLabels([
            typeof content.plan_revision === "number"
              ? `Route: v${content.plan_revision} / ${content.plan_option || "primary"}`
              : null,
            message.linked_run_id ? `Run: ${message.linked_run_id}` : null,
          ]),
          createdAt: message.created_at || "",
        };
      }
      return {
        key: message.message_id || `${message.kind || "event"}:${message.created_at || ""}`,
        kind: message.kind || "event",
        title: formatWorkspaceLabel(message.kind || "event"),
        detail:
          (typeof content.summary === "string" && content.summary.trim()) ||
          (typeof content.title === "string" && content.title.trim()) ||
          "Workspace evidence recorded.",
        meta: uniqueWorkspaceLabels([
          message.linked_run_id ? `Run: ${message.linked_run_id}` : null,
          message.linked_node_run_id ? `Node run: ${message.linked_node_run_id}` : null,
        ]),
        createdAt: message.created_at || "",
      };
    });
}

function getArtifactWorkspaceFeedKey(artifact) {
  return normalizeWorkspaceKey(
    artifact?.storage_uri || artifact?.path || artifact?.name || artifact?.artifact_id || artifact?.kind || "artifact",
  );
}

function limitWorkspaceFeedItems(items, itemLimit, pinnedKey, getKey = (item) => item?.key || "") {
  const values = Array.isArray(items) ? items : [];
  const limit = Math.max(0, Number(itemLimit) || 0);
  const visible = values.slice(0, limit);
  const normalizedPinnedKey = normalizeWorkspaceKey(pinnedKey || "");
  if (!normalizedPinnedKey || visible.some((item) => normalizeWorkspaceKey(getKey(item)) === normalizedPinnedKey)) {
    return visible;
  }
  const pinned = values.find((item) => normalizeWorkspaceKey(getKey(item)) === normalizedPinnedKey);
  return pinned ? [...visible, pinned] : visible;
}

function buildSelectedOutputArtifactTargets(detail, item) {
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
  if (!item?.historyEntries?.length || !artifacts.length) {
    return [];
  }

  const targets = item.historyEntries
    .map((entry) => {
      const normalizedTitle = normalizeWorkspaceKey(entry.artifactTitle || "");
      const normalizedDetail = normalizeWorkspaceKey(entry.artifactDetail || "");
      const matchedArtifact =
        artifacts.find((artifact) => {
          const artifactName = normalizeWorkspaceKey(
            artifact.name || artifact.kind || artifact.type || artifact.artifact_id || "",
          );
          const artifactUri = normalizeWorkspaceKey(artifact.storage_uri || artifact.path || "");
          return Boolean(
            (normalizedDetail && artifactUri && normalizedDetail === artifactUri) ||
              (normalizedTitle && artifactName && normalizedTitle === artifactName),
          );
        }) || null;

      if (!matchedArtifact) {
        return null;
      }

      const artifactKey = getArtifactWorkspaceFeedKey(matchedArtifact) || `artifact-${entry.key}`;

      return {
        entryKey: entry.key,
        artifactKey,
        artifactTitle:
          matchedArtifact.name ||
          matchedArtifact.kind ||
          matchedArtifact.type ||
          matchedArtifact.artifact_id ||
          "Artifact",
        artifactDetail:
          matchedArtifact.storage_uri ||
          matchedArtifact.path ||
          matchedArtifact.summary ||
          matchedArtifact.kind ||
          "Generated output",
      };
    })
    .filter(Boolean);

  const seen = new Set();
  return targets.filter((target) => {
    if (seen.has(target.artifactKey)) return false;
    seen.add(target.artifactKey);
    return true;
  });
}

function findWorkspaceOutputHistoryKeyByEntryKey(detail, entryKey) {
  const normalizedEntryKey = String(entryKey || "");
  if (!normalizedEntryKey) return "";
  return (
    buildMissionOutputHistory(detail).find((item) =>
      item.historyEntries.some((entry) => entry.key === normalizedEntryKey),
    )?.key || ""
  );
}

function findWorkspaceOutputHistoryKeyByArtifactKey(detail, artifactKey) {
  const normalizedArtifactKey = normalizeWorkspaceKey(artifactKey || "");
  if (!normalizedArtifactKey) return "";
  return (
    buildMissionOutputHistory(detail).find((item) =>
      buildSelectedOutputArtifactTargets(detail, item).some((target) => target.artifactKey === normalizedArtifactKey),
    )?.key || ""
  );
}

function selectWorkspaceOutputHistory(outputHistoryKey) {
  if (!outputHistoryKey) return;
  state.workspaceSelection = {
    type: "output-history",
    key: outputHistoryKey,
  };
}

function buildWorkspaceFeedRailModel(detail) {
  const attachments = detail?.attachments || [];
  const artifacts = detail?.artifacts || [];
  const dagPatches = detail?.dag_patches || [];
  const messages = detail?.messages || [];
  const snapshot = detail?.mission_snapshot || null;
  const evidenceSummary = snapshot?.evidenceSummary || null;
  const rawCardPolicy = snapshot?.rawCardPolicy || null;
  const evidenceItems = buildWorkspaceEvidenceFeedItems(messages).slice(0, 8);
  const filter = state.ui.workspaceFeedFilter || "all";
  const expanded = state.ui.workspaceFeedExpanded === true;
  const itemLimit = expanded ? 8 : 3;

  return {
    title: evidenceSummary?.title || "Workspace Feed",
    summary:
      evidenceSummary?.summary ||
      rawCardPolicy?.summary ||
      "Recent evidence, context, returned outputs, and runtime patches.",
    evidenceSummary,
    rawCardPolicy,
    attachments,
    artifacts,
    dagPatches,
    evidenceItems,
    filter,
    expanded,
    itemLimit,
    pinnedEntryKey: pendingWorkspaceFeedEntryKey,
    totalCount: evidenceItems.length + attachments.length + artifacts.length + dagPatches.length,
    filters: [
      ["all", "All", evidenceItems.length + attachments.length + artifacts.length + dagPatches.length],
      ["evidence", "Evidence", evidenceItems.length],
      ["context", "Context", attachments.length],
      ["outputs", "Outputs", artifacts.length],
      ["patches", "Patches", dagPatches.length],
    ],
    showSection(section) {
      return filter === "all" || filter === section;
    },
  };
}

function buildSelectedOutputRailModel(detail) {
  const history = getSelectedWorkspaceOutputHistory(detail);
  return {
    history,
    delta: history ? buildOutputHistoryDeltaSummary(history) : null,
    artifacts: history ? buildSelectedOutputArtifactTargets(detail, history) : [],
  };
}

function buildSelectedCheckpointTargets(detail, checkpoint) {
  if (!checkpoint) return [];
  const key = normalizeWorkspaceKey(getMissionCheckpointKey(checkpoint));
  const evidence = buildMissionSurfaceEvidence(detail, "checkpoint", checkpoint);
  const approvals = Array.isArray(detail?.pending_approvals) ? detail.pending_approvals : [];
  const humanInputs = Array.isArray(detail?.pending_human_inputs) ? detail.pending_human_inputs : [];
  const dagPatches = Array.isArray(detail?.dag_patches) ? detail.dag_patches : [];
  const interventions = Array.isArray(detail?.interventions) ? detail.interventions : [];
  const outputs = Array.isArray(detail?.mission_snapshot?.outputs) ? detail.mission_snapshot.outputs : [];
  const returnedOutputs = outputs.filter((output) => output.status === "returned");
  const targets = [];
  const addTarget = (target) => {
    if (!target?.key || targets.some((item) => item.key === target.key)) return;
    targets.push(target);
  };

  if (key.includes("human") || evidence.lines.some((line) => line.startsWith("Approvals:") || line.startsWith("Inputs:"))) {
    if (approvals.length || humanInputs.length) {
      addTarget({
        key: "execution-queue",
        label: "Open gates",
        targetType: "nav-focus",
        nav: "orchestrator",
        focus: "execution-queue",
      });
    }
  }

  if (key.includes("output") || evidence.lines.some((line) => line.startsWith("Outputs:"))) {
    if (returnedOutputs.length || (Array.isArray(detail?.artifacts) && detail.artifacts.length)) {
      addTarget({
        key: "returned-outputs",
        label: "Open returned outputs",
        targetType: "feed",
        feedFilter: "outputs",
        focus: "workspace-feed",
      });
    }
  }

  if (key.includes("runtime-state") || key.includes("runtime")) {
    if (detail?.runtime_graph || getWorkspaceLatestRunId(detail)) {
      addTarget({
        key: "runtime-graph",
        label: "Open runtime graph",
        targetType: "focus",
        focus: "graph",
      });
    }
  }

  if (key.includes("steering") || evidence.lines.some((line) => line.startsWith("Patches:"))) {
    if (dagPatches.length) {
      addTarget({
        key: "runtime-patches",
        label: "Open patches",
        targetType: "feed",
        feedFilter: "patches",
        focus: "workspace-feed",
      });
    }
    if (interventions.length) {
      addTarget({
        key: "runtime-queue",
        label: "Open interventions",
        targetType: "nav-focus",
        nav: "orchestrator",
        focus: "execution-queue",
      });
    }
  }

  if ((key.includes("launch") || key.includes("route")) && detail?.route_compare) {
    addTarget({
      key: "route-compare",
      label: "Open route compare",
      targetType: "focus",
      focus: "compare",
    });
  }

  return targets;
}

function buildSelectedCheckpointRailModel(detail) {
  const checkpoint = getSelectedWorkspaceCheckpoint(detail);
  return {
    checkpoint,
    key: checkpoint ? getMissionCheckpointKey(checkpoint) : null,
    evidence: checkpoint ? buildMissionSurfaceEvidence(detail, "checkpoint", checkpoint) : buildMissionEvidenceBundle([], []),
    targets: checkpoint ? buildSelectedCheckpointTargets(detail, checkpoint) : [],
  };
}

function buildMissionInspectorRailModel(detail) {
  const session = detail?.session || null;
  const snapshot = detail?.mission_snapshot || null;
  const view = detail?.mission_view || detail?.mission?.mission_view || null;
  const spec = getWorkspaceMissionSpec(detail);
  const workspace = detail?.workspace_state || {};
  const route = spec?.route || null;
  const routeLabel = route ? formatMissionRouteLabel(route) : view?.routeLabel || "Unrouted";
  const approvals = detail?.pending_approvals || [];
  const humanInputs = detail?.pending_human_inputs || [];
  const conversationRail = snapshot?.conversationRail || null;
  const missionTitle = snapshot?.missionTitle || view?.title || spec?.objective || session?.title || "Untitled mission";
  const summary =
    snapshot?.missionSummary ||
    view?.summary ||
    spec?.decisionFocus ||
    workspace.next_recommended_detail ||
    "Mission contract and route context stay visible here.";
  const nextLabel = snapshot?.nextActionLabel || view?.nextActionLabel || (detail?.next_actions || []).join(", ") || "none";
  const nextDetail = snapshot?.nextActionDetail || view?.nextActionDetail || workspace.next_recommended_detail || "";
  const workLabel = spec?.pipelineSummary
    ? `${spec.pipelineSummary.active} live / ${spec.pipelineSummary.total} total`
    : view?.workLabel || "Not materialized";
  const checkpointLabel = spec?.checkpointSummary
    ? `${spec.checkpointSummary.completed}/${spec.checkpointSummary.total}`
    : view?.checkpointLabel || "None";

  return {
    title: missionTitle,
    summary,
    statusClass: snapshot?.missionStatusTone || view?.statusTone || statusTone(detail?.latest_run?.status || "neutral"),
    statusLabel: snapshot?.missionStatusLabel || view?.statusLabel || detail?.latest_run?.status || "idle",
    kv: [
      ["Mission", missionTitle],
      ["Route", routeLabel],
      ["Work", workLabel],
      ["Checkpoints", checkpointLabel],
      ["Stream", state.streamStatus],
      ["Run", detail?.latest_run?.status || "idle"],
      ["Approvals", approvals.length],
      ["Human Input", humanInputs.length],
      ["Conversation", conversationRail?.auditMessageCount ?? snapshot?.conversationTurns ?? 0],
    ],
    next: {
      label: nextLabel,
      detail: nextDetail || detail?.workspace_state?.latest_run_summary || "No live run summary.",
    },
    conversation: conversationRail,
  };
}

function renderRailEmptyCallout(title, detail) {
  return `
    <div class="rail-empty-callout">
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function renderMissionInspectorSelectionHint(detail, selectedCheckpoint, selectedOutput) {
  if (selectedCheckpoint.checkpoint || selectedOutput.history) {
    return "";
  }
  const checkpointCount = Array.isArray(detail?.mission_snapshot?.checkpoints)
    ? detail.mission_snapshot.checkpoints.length
    : 0;
  const outputHistoryCount = buildMissionOutputHistory(detail).length;
  if (checkpointCount || outputHistoryCount) {
    return renderRailEmptyCallout(
      "No evidence selection pinned",
      "Checkpoint and output history details stay here after a ledger row is selected.",
    );
  }
  return renderRailEmptyCallout(
    "No drilldown evidence yet",
    "Checkpoint and output history details appear after the mission records checkpoints or returned artifacts.",
  );
}

function buildDesktopRailViewModel(detail) {
  return {
    detail,
    inspector: buildMissionInspectorRailModel(detail),
    selectedCheckpoint: buildSelectedCheckpointRailModel(detail),
    selectedOutput: buildSelectedOutputRailModel(detail),
    feed: buildWorkspaceFeedRailModel(detail),
    routeCompare: detail?.route_compare || null,
    hasRuntimeContext: !!detail?.runtime_graph || !!getWorkspaceLatestRunId(detail),
  };
}

function buildMissionWorkspaceViewModel(detail) {
  const session = detail?.session || null;
  const snapshot = detail?.mission_snapshot || null;
  const workspaceContractVersion = getWorkspaceContractVersion(detail);
  const hasVersionedWorkspaceContract = hasVersionedMissionWorkspaceSnapshot(snapshot);
  const spec = getWorkspaceMissionSpec(detail);
  const workspace = detail?.workspace_state || {};
  const stages = Array.isArray(snapshot?.stages) ? snapshot.stages : [];
  const pipelines = Array.isArray(snapshot?.pipelines) ? snapshot.pipelines : [];
  const checkpoints = Array.isArray(snapshot?.checkpoints) ? snapshot.checkpoints : [];
  const outputs = Array.isArray(snapshot?.outputs) ? snapshot.outputs : [];
  const workspaceSections = Array.isArray(snapshot?.workspaceSections) ? snapshot.workspaceSections : [];
  const route = spec?.route || null;
  const pipelineSummary = spec?.pipelineSummary || {
    total: pipelines.length,
    ready: 0,
    active: pipelines.filter((item) => item.status === "active").length,
    blocked: pipelines.filter((item) => item.status === "blocked").length,
    completed: pipelines.filter((item) => item.status === "done").length,
    primaryAgentLabels: [],
  };
  const checkpointSummary = spec?.checkpointSummary || {
    total: checkpoints.length,
    completed: checkpoints.filter((item) => item.status === "done").length,
    active: checkpoints.filter((item) => item.status === "active").length,
    pending: checkpoints.filter((item) => item.status === "pending").length,
    labels: checkpoints.map((item) => item.label).filter(Boolean),
  };
  const routeLabel = formatMissionRouteLabel(route);
  const routeTone = route?.stale
    ? "warn"
    : typeof route?.confirmedRevision === "number"
      ? "success"
      : typeof route?.activeRevision === "number"
        ? "warn"
        : "neutral";
  const nextMoveLabel =
    snapshot?.nextActionLabel ||
    workspace.next_recommended_label ||
    workspace.pending_decision ||
    "Move the mission forward";

  return {
    ready: Boolean(session && (snapshot || spec)),
    workspaceContractVersion,
    hasVersionedWorkspaceContract,
    detail,
    session,
    spec,
    route,
    routeLabel,
    routeTone,
    workspaceSections,
    stages,
    pipelines,
    checkpoints,
    outputs,
    requestedOutputs: spec?.requestedOutputs,
    header: {
      title: snapshot?.missionTitle || spec?.objective || session?.title || "Mission Workspace",
      summary:
        snapshot?.missionSummary ||
        spec?.decisionFocus ||
        spec?.sourceBrief ||
        "No mission summary yet.",
      statusLabel: snapshot?.missionStatusLabel || session?.status || "idle",
      statusTone: snapshot?.missionStatusTone || statusTone(session?.status || "idle"),
    },
    specBand: {
      objective: snapshot?.objective || spec?.objective || session?.current_goal || "Mission contract is forming",
      sourceBrief:
        spec?.sourceBrief ||
        "Objective, route, work packages, checkpoints, outputs, pending decisions, execution summary, and evidence summary stay visible while the mission moves.",
      routeTemplate: route?.selectedTemplateName || route?.selectedTemplateId || "No selected route template",
    },
    summaryStats: [
      ["Next Move", nextMoveLabel],
      ["Goal", spec?.objective || snapshot?.objective || session?.current_goal || "No active goal yet."],
      ["Execution Route", routeLabel],
      ["Work Packages", `${pipelineSummary.active} live / ${pipelineSummary.total} total`],
      ["Checkpoints", `${checkpointSummary.completed}/${checkpointSummary.total} complete`],
    ],
    support: {
      detail,
      spec,
      route,
      routeTone,
      routeLabel,
      stages,
      pipelines,
      conversationRail: snapshot?.conversationRail || null,
      evidenceSummary: snapshot?.evidenceSummary || null,
      rawCardPolicy: snapshot?.rawCardPolicy || null,
    },
  };
}

function buildMissionCheckpointEvidence(detail, checkpoint) {
  const approvals = Array.isArray(detail?.pending_approvals) ? detail.pending_approvals : [];
  const humanInputs = Array.isArray(detail?.pending_human_inputs) ? detail.pending_human_inputs : [];
  const dagPatches = Array.isArray(detail?.dag_patches) ? detail.dag_patches : [];
  const interventions = Array.isArray(detail?.interventions) ? detail.interventions : [];
  const outputs = Array.isArray(detail?.mission_snapshot?.outputs) ? detail.mission_snapshot.outputs : [];
  const evidence = [];
  const lines = [];

  if (checkpoint?.key === "launch-gate" && detail?.mission_spec?.route) {
    const route = detail.mission_spec.route;
    evidence.push({
      tone: typeof route.confirmedRevision === "number" ? "success" : "warn",
      label: typeof route.confirmedRevision === "number" ? "Confirmed route" : "Needs confirm",
    });
    if (route.selectedTemplateName || route.selectedTemplateId) {
      lines.push(`Route template: ${route.selectedTemplateName || route.selectedTemplateId}`);
    }
  }

  if (checkpoint?.key === "runtime-state" && detail?.latest_run) {
    evidence.push({ tone: statusTone(detail.latest_run.status), label: detail.latest_run.status || "runtime" });
    if (detail?.workspace_state?.latest_subtask?.node_name) {
      lines.push(`Active node: ${detail.workspace_state.latest_subtask.node_name}`);
    }
  }

  if (checkpoint?.key === "human-gates") {
    if (approvals.length) {
      evidence.push({ tone: "warn", label: `${approvals.length} approval${approvals.length === 1 ? "" : "s"}` });
      lines.push(`Approvals: ${approvals.slice(0, 2).map((item) => item.summary || item.title || "approval").join(", ")}`);
    }
    if (humanInputs.length) {
      evidence.push({ tone: "warn", label: `${humanInputs.length} input${humanInputs.length === 1 ? "" : "s"}` });
      lines.push(`Inputs: ${humanInputs.slice(0, 2).map((item) => item.summary || item.title || "input").join(", ")}`);
    }
  }

  if (checkpoint?.key === "outputs-returned") {
    const returnedOutputs = outputs.filter((output) => output.status === "returned");
    evidence.push({ tone: returnedOutputs.length ? "success" : "neutral", label: `${returnedOutputs.length} returned` });
    if (returnedOutputs.length) {
      lines.push(`Outputs: ${returnedOutputs.slice(0, 3).map((output) => output.title || output.key || "output").join(", ")}`);
    }
  }

  if (checkpoint?.key === "runtime-steering") {
    if (dagPatches.length) {
      evidence.push({ tone: "warn", label: `${dagPatches.length} patch${dagPatches.length === 1 ? "" : "es"}` });
      lines.push(`Patches: ${dagPatches.slice(0, 2).map((item) => item.summary || item.patch_id || "patch").join(", ")}`);
    }
    if (interventions.length) {
      evidence.push({ tone: "neutral", label: `${interventions.length} intervention${interventions.length === 1 ? "" : "s"}` });
    }
  }

  return buildMissionEvidenceBundle(evidence, lines);
}

function renderMissionEvidenceChips(items) {
  const values = Array.isArray(items) ? items : [];
  if (!values.length) {
    return "";
  }
  return `
    <div class="mission-evidence-chip-list">
      ${values
        .map(
          (item) => `<span class="badge ${item.tone || "neutral"}">${escapeHtml(item.label || "Evidence")}</span>`,
        )
        .join("")}
    </div>
  `;
}

function renderMissionEvidenceLines(evidence, hiddenPrefixes = [], limit = 2) {
  const lines = Array.isArray(evidence?.lines) ? evidence.lines : [];
  const hidden = Array.isArray(hiddenPrefixes) ? hiddenPrefixes : [];
  const visible = lines.filter((line) => !hidden.some((prefix) => String(line).startsWith(prefix)));
  if (!visible.length) {
    return "";
  }
  return visible
    .slice(0, limit)
    .map((line) => `<small>${escapeHtml(line)}</small>`)
    .join("");
}

function renderMissionDeliveryTracePanel(detail) {
  const traces = buildMissionDeliveryTrace(detail);
  if (!traces.length) {
    return "";
  }
  return `
    <section class="subpanel mission-delivery-trace-panel" data-workspace-focus="delivery-trace">
      <div class="subpanel-header">
        <strong>Delivery Trace</strong>
        <span class="badge neutral">${escapeHtml(String(traces.length))}</span>
      </div>
      <div class="mission-trace-list">
        ${traces
          .map(
            (trace) => `
              <div class="mission-trace-item">
                <div class="mission-detail-head">
                  <strong>${escapeHtml(trace.title)}</strong>
                  <span class="badge ${statusTone(trace.status)}">${escapeHtml(trace.status)}</span>
                </div>
                <div class="mission-trace-chain">
                  <div class="mission-trace-column">
                    <span>Work Package</span>
                    ${
                      trace.packages.length
                        ? trace.packages
                            .map(
                              (pkg) => `
                                <div class="mission-trace-card">
                                  <strong>${escapeHtml(pkg.title)}</strong>
                                  <small>${escapeHtml(pkg.status)}</small>
                                  ${
                                    pkg.nodes.length
                                      ? `<div class="mission-trace-inline">${pkg.nodes
                                          .slice(0, 3)
                                          .map(
                                            (node) =>
                                              `<span class="badge ${statusTone(node.status)}">${escapeHtml(node.name)}</span>`,
                                          )
                                          .join("")}</div>`
                                      : ""
                                  }
                                </div>
                              `,
                            )
                            .join("")
                        : '<div class="mission-trace-card empty"><small>No linked package</small></div>'
                    }
                  </div>
                  <div class="mission-trace-arrow" aria-hidden="true">&gt;</div>
                  <div class="mission-trace-column">
                    <span>Output</span>
                    <div class="mission-trace-card current">
                      <strong>${escapeHtml(trace.title)}</strong>
                      <small>${escapeHtml(trace.status)}</small>
                    </div>
                  </div>
                  <div class="mission-trace-arrow" aria-hidden="true">&gt;</div>
                  <div class="mission-trace-column">
                    <span>Artifact</span>
                    ${
                      trace.artifacts.length
                        ? trace.artifacts
                            .map(
                              (artifact) => `
                                <div class="mission-trace-card">
                                  <strong>${escapeHtml(artifact.title)}</strong>
                                  <small>${escapeHtml(artifact.detail || "Returned artifact")}</small>
                                  ${renderMissionEvidenceLines(artifact.evidence, ["Node run:"])}
                                  ${
                                    artifact.linkedNodeRunId
                                      ? `<small>${escapeHtml(`Node run: ${artifact.linkedNodeRunId}`)}</small>`
                                      : ""
                                  }
                                </div>
                              `,
                            )
                            .join("")
                        : '<div class="mission-trace-card empty"><small>No returned artifact yet</small></div>'
                    }
                  </div>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMissionOutputHistoryPanel(detail) {
  const items = buildMissionOutputHistory(detail);
  if (!items.length) {
    return "";
  }
  return `
    <section class="subpanel mission-output-history-panel" data-workspace-focus="output-history">
      <div class="subpanel-header">
        <strong>Output History</strong>
        <span class="badge neutral">${escapeHtml(String(items.length))}</span>
      </div>
      <div class="mission-history-list">
        ${items
          .map(
            (item) => `
              <button type="button" class="mission-history-item ${state.workspaceSelection?.type === "output-history" && state.workspaceSelection?.key === item.key ? "selected" : ""}" aria-pressed="${state.workspaceSelection?.type === "output-history" && state.workspaceSelection?.key === item.key ? "true" : "false"}" data-action="select-output-history" data-output-history-key="${escapeHtml(item.key)}">
                <div class="mission-detail-head">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="badge ${item.count > 1 ? "warn" : "success"}">${escapeHtml(`${item.count} version${item.count === 1 ? "" : "s"}`)}</span>
                </div>
                <div class="mission-history-compare-grid">
                  <div class="mission-history-card current">
                    <span>Latest</span>
                    ${
                      item.latest
                        ? `
                          <strong>${escapeHtml(item.latest.artifactTitle)}</strong>
                          <small>${escapeHtml(item.latest.routeLabel || "Current route")}</small>
                          <small>${escapeHtml(item.latest.artifactDetail)}</small>
                          ${renderMissionEvidenceLines(item.latest.evidence, ["Route:", "Run:"])}
                          ${
                            item.latest.runId
                              ? `<small>${escapeHtml(`Run: ${item.latest.runId}`)}</small>`
                              : ""
                          }
                        `
                        : `<small>${escapeHtml(item.status === "requested" ? "No returned artifact yet." : "History pending.")}</small>`
                    }
                  </div>
                  <div class="mission-history-card">
                    <span>Previous</span>
                    ${
                      item.previous
                        ? `
                          <strong>${escapeHtml(item.previous.artifactTitle)}</strong>
                          <small>${escapeHtml(item.previous.routeLabel || "Prior route")}</small>
                          <small>${escapeHtml(item.previous.artifactDetail)}</small>
                          ${renderMissionEvidenceLines(item.previous.evidence, ["Route:", "Run:"])}
                          ${
                            item.previous.runId
                              ? `<small>${escapeHtml(`Run: ${item.previous.runId}`)}</small>`
                              : ""
                          }
                        `
                        : `<small>No prior version recorded.</small>`
                    }
                  </div>
                </div>
                ${
                  item.historyEntries.length > 0
                    ? `<div class="mission-history-timeline">${item.historyEntries
                        .slice(0, 4)
                        .map(
                          (entry) => `
                            <div class="mission-history-timeline-item">
                              <strong>${escapeHtml(entry.routeLabel || "Route")}</strong>
                              <small>${escapeHtml(entry.artifactTitle)}</small>
                              <small>${escapeHtml(entry.artifactDetail)}</small>
                              ${renderMissionEvidenceLines(entry.evidence, ["Route:"])}
                            </div>
                          `,
                        )
                        .join("")}</div>`
                    : ""
                }
              </button>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMissionCheckpointsPanel(detail, checkpoints) {
  const values = Array.isArray(checkpoints) ? checkpoints : [];
  return `
    <section class="subpanel mission-detail-panel" data-workspace-focus="checkpoint-ledger">
      <div class="subpanel-header">
        <strong>Checkpoint Ledger</strong>
        <span class="badge ${values.some((checkpoint) => checkpoint.status === "active") ? "warn" : values.length ? "success" : "neutral"}">${escapeHtml(String(values.length))}</span>
      </div>
      <div class="mission-detail-list">
        ${
          values.length
            ? values
                .map(
                  (checkpoint) => {
                    const checkpointKey = getMissionCheckpointKey(checkpoint);
                    const selected =
                      state.workspaceSelection?.type === "checkpoint" && state.workspaceSelection?.key === checkpointKey;
                    const evidence = buildMissionSurfaceEvidence(detail, "checkpoint", checkpoint);
                    return `
                    <button type="button" class="mission-detail-item ${selected ? "selected" : ""}" aria-pressed="${selected ? "true" : "false"}" data-action="select-checkpoint" data-checkpoint-key="${escapeHtml(checkpointKey)}">
                      <div class="mission-detail-head">
                        <strong>${escapeHtml(checkpoint.label || checkpoint.key || "Checkpoint")}</strong>
                        <span class="badge ${statusTone(checkpoint.status || checkpoint.tone)}">${escapeHtml(checkpoint.status || "pending")}</span>
                      </div>
                      <p>${escapeHtml(checkpoint.detail || "Checkpoint detail is not available yet.")}</p>
                      ${renderMissionEvidenceChips(evidence.evidence)}
                      <div class="mission-detail-meta">
                        ${checkpoint.type ? `<small>${escapeHtml(`Type: ${formatWorkspaceLabel(checkpoint.type)}`)}</small>` : ""}
                        ${
                          typeof checkpoint.relatedRouteRevision === "number"
                            ? `<small>${escapeHtml(`Route: v${checkpoint.relatedRouteRevision}`)}</small>`
                            : ""
                        }
                        ${checkpoint.relatedRunId ? `<small>${escapeHtml(`Run: ${checkpoint.relatedRunId}`)}</small>` : ""}
                        ${
                          Array.isArray(checkpoint.relatedOutputKeys) && checkpoint.relatedOutputKeys.length
                            ? `<small>${escapeHtml(`Outputs: ${checkpoint.relatedOutputKeys.slice(0, 3).join(", ")}`)}</small>`
                            : ""
                        }
                        ${
                          checkpoint.nextActionLabel
                            ? `<small>${escapeHtml(`Next: ${checkpoint.nextActionLabel}`)}</small>`
                            : ""
                        }
                      </div>
                      ${
                        evidence.lines.length
                          ? `<div class="mission-detail-meta">${evidence.lines
                              .map((line) => `<small>${escapeHtml(line)}</small>`)
                              .join("")}</div>`
                          : ""
                      }
                    </button>
                  `;
                  },
                )
                .join("")
            : '<p class="muted">No checkpoints are defined yet.</p>'
        }
      </div>
    </section>
  `;
}

function renderMissionOutputsPanel(detail, outputs, requestedOutputs) {
  const values = Array.isArray(outputs) ? outputs : [];
  const requested = Array.isArray(requestedOutputs) ? requestedOutputs : [];
  const outputRank = {
    returned: 4,
    in_progress: 3,
    prepared: 2,
    requested: 1,
  };
  const sortedValues = [...values].sort((left, right) => {
    const rankDelta = (outputRank[right.status] || 0) - (outputRank[left.status] || 0);
    if (rankDelta !== 0) return rankDelta;
    const leftTime = Array.isArray(left.history) ? left.history[0]?.createdAt || "" : "";
    const rightTime = Array.isArray(right.history) ? right.history[0]?.createdAt || "" : "";
    return rightTime.localeCompare(leftTime);
  });
  if (!values.length && !requested.length) {
    return "";
  }
  return `
    <section class="subpanel mission-outputs-panel">
      <div class="subpanel-header">
        <strong>Outputs Ledger</strong>
        <span class="badge ${values.some((output) => output.status === "returned") ? "success" : values.length ? "warn" : "neutral"}">${escapeHtml(String(values.length || requested.length))}</span>
      </div>
      ${
        values.length
          ? `<div class="mission-output-ledger">
              ${sortedValues
                .map((output) => {
                  const evidence = buildMissionSurfaceEvidence(detail, "output", output);
                  return `
                    <div class="mission-output-item">
                      <div class="mission-output-head">
                        <strong>${escapeHtml(output.title || output.key || "Output")}</strong>
                        <span class="badge ${statusTone(output.status)}">${escapeHtml(output.status || "requested")}</span>
                      </div>
                      <p>${escapeHtml(output.summary || "Output is tracked by the mission workspace.")}</p>
                      ${renderMissionEvidenceChips(evidence.evidence)}
                      <div class="mission-output-lines">
                        ${output.stageKey ? `<small>${escapeHtml(`Stage: ${formatWorkspaceLabel(output.stageKey)}`)}</small>` : ""}
                        ${output.currentActionLabel ? `<small>${escapeHtml(`Next: ${output.currentActionLabel}`)}</small>` : ""}
                        ${
                          Array.isArray(output.relatedCheckpointKeys) && output.relatedCheckpointKeys.length
                            ? `<small>${escapeHtml(`Checkpoints: ${output.relatedCheckpointKeys.slice(0, 3).join(", ")}`)}</small>`
                            : ""
                        }
                        ${
                          output.latestArtifactMessageId
                            ? `<small>${escapeHtml(`Latest artifact: ${output.latestArtifactMessageId}`)}</small>`
                            : ""
                        }
                        ${
                          Array.isArray(output.history) && output.history.length
                            ? `<small>${escapeHtml(`History: ${output.history.length} step${output.history.length === 1 ? "" : "s"}`)}</small>`
                            : ""
                        }
                      </div>
                      ${
                        (Array.isArray(output.detailLines) && output.detailLines.length) || evidence.lines.length
                          ? `<div class="mission-output-lines">${uniqueWorkspaceLabels([
                              ...(Array.isArray(output.detailLines) ? output.detailLines.slice(0, 3) : []),
                              ...evidence.lines,
                              ...(Array.isArray(output.history)
                                ? output.history
                                    .slice(0, 2)
                                    .map((entry) => `${formatWorkspaceLabel(entry.status)}: ${entry.summary}`)
                                : []),
                            ])
                              .map((line) => `<small>${escapeHtml(line)}</small>`)
                              .join("")}</div>`
                          : ""
                      }
                    </div>
                  `;
                })
                .join("")}
            </div>`
          : renderSpecChipList(requested, "No requested outputs are defined yet.")
      }
    </section>
  `;
}

function renderMissionWorkspaceSupport(input) {
  const {
    detail,
    spec,
    route,
    routeTone,
    routeLabel,
    stages,
    pipelines,
    conversationRail,
    evidenceSummary,
    rawCardPolicy,
  } = input;
  const proposalTrace = getActiveProposalTrace(detail);
  const hasSupport =
    !!spec ||
    !!proposalTrace ||
    (Array.isArray(stages) && stages.length > 0) ||
    (Array.isArray(pipelines) && pipelines.length > 0) ||
    !!conversationRail ||
    !!evidenceSummary ||
    !!rawCardPolicy;

  if (!hasSupport) {
    return "";
  }

  return `
    <section class="subpanel mission-support-panel">
      <div class="subpanel-header">
        <strong>Workspace Support</strong>
        <span class="badge neutral">Secondary</span>
      </div>
      <div class="mission-support-grid">
        <section class="mission-support-card">
          <div class="mission-support-card-head">
            <strong>Route Contract</strong>
            <span class="badge ${routeTone}">${escapeHtml(route?.stale ? "Needs refresh" : routeLabel)}</span>
          </div>
          <p>${escapeHtml(route?.staleReason || spec?.decisionFocus || "Route lineage and constraints support the main workspace surfaces.")}</p>
          <div class="rail-kv-list compact-kv-list">
            <div><strong>Latest</strong><span>${escapeHtml(spec?.revisionLineage?.latestRevision ?? "none")}</span></div>
            <div><strong>Confirmed</strong><span>${escapeHtml(typeof spec?.revisionLineage?.confirmedRevision === "number" ? `v${spec.revisionLineage.confirmedRevision} / ${spec.revisionLineage.confirmedOption || "primary"}` : "none")}</span></div>
            <div><strong>Template</strong><span>${escapeHtml(route?.selectedTemplateName || route?.selectedTemplateId || "No selected route template")}</span></div>
          </div>
          ${proposalTrace ? renderProposalTracePanel(detail) : ""}
          ${renderSpecChipList(spec?.constraints, "No explicit constraints yet.")}
        </section>
        <section class="mission-support-card">
          <div class="mission-support-card-head">
            <strong>Work Evidence</strong>
            <span class="badge neutral">${escapeHtml(String((stages?.length || 0) + (pipelines?.length || 0)))}</span>
          </div>
          <div class="mission-support-list">
            ${(stages || [])
              .slice(0, 3)
              .map(
                (stage) => `
                  <div class="mission-support-row">
                    <span class="badge ${stage.tone}">${escapeHtml(stage.label)}</span>
                    <div><strong>${escapeHtml(stage.title)}</strong><p>${escapeHtml(stage.detail)}</p></div>
                  </div>
                `,
              )
              .join("")}
            ${(pipelines || [])
              .slice(0, 4)
              .map(
                (pipeline) => `
                  <div class="mission-support-row">
                    <span class="badge ${pipeline.tone}">${escapeHtml(pipeline.status)}</span>
                    <div><strong>${escapeHtml(pipeline.title)}</strong><p>${escapeHtml(pipeline.activeNodeName || pipeline.blocker || pipeline.summary || "No active node.")}</p></div>
                  </div>
                `,
              )
              .join("") || '<p class="muted">No work package evidence yet.</p>'}
          </div>
        </section>
        <section class="mission-support-card">
          <div class="mission-support-card-head">
            <strong>Mission Timeline</strong>
            <span class="badge neutral">${escapeHtml(String(stages?.length || 0))}</span>
          </div>
          <div class="mission-support-list">
            ${(stages || [])
              .slice(0, 4)
              .map(
                (stage) => `
                  <div class="mission-support-row">
                    <span class="badge ${stage.tone || statusTone(stage.status)}">${escapeHtml(stage.metric || stage.status || "stage")}</span>
                    <div><strong>${escapeHtml(stage.title || stage.label || "Stage")}</strong><p>${escapeHtml(stage.detail || "No stage detail yet.")}</p></div>
                  </div>
                `,
              )
              .join("")}
            ${!(stages || []).length ? '<p class="muted">No mission timeline evidence yet.</p>' : ""}
          </div>
        </section>
        <section class="mission-support-card">
          <div class="mission-support-card-head">
            <strong>Conversation And Evidence</strong>
            <span class="badge neutral">Audit</span>
          </div>
          <p>${escapeHtml(conversationRail?.summary || "Conversation stays available for intent, explanation, decision, and audit context.")}</p>
          <div class="mission-support-list">
            ${
              conversationRail?.responsibilities?.length
                ? `<div class="mission-support-row">
                    <span class="badge neutral">Conversation</span>
                    <div><strong>${escapeHtml(conversationRail.title || "Mission coordination")}</strong><p>${escapeHtml(conversationRail.responsibilities.map(formatWorkspaceLabel).join(", "))}</p></div>
                  </div>`
                : ""
            }
            ${
              evidenceSummary
                ? `<div class="mission-support-row">
                    <span class="badge neutral">Evidence</span>
                    <div><strong>${escapeHtml(evidenceSummary.title || "Evidence Summary")}</strong><p>${escapeHtml(evidenceSummary.summary || "Technical evidence remains drilldown context.")}</p></div>
                  </div>`
                : ""
            }
            ${
              rawCardPolicy
                ? `<div class="mission-support-row">
                    <span class="badge neutral">${escapeHtml(formatWorkspaceLabel(rawCardPolicy.defaultState || "collapsed"))}</span>
                    <div><strong>Raw cards are secondary</strong><p>${escapeHtml(rawCardPolicy.summary || "Raw cards stay collapsed unless audit drilldown is needed.")}</p></div>
                  </div>`
                : ""
            }
          </div>
        </section>
      </div>
    </section>
  `;
}

function formatFileSize(sizeBytes) {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return null;
  }
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAttachmentContextPanel(attachments) {
  const values = Array.isArray(attachments) ? attachments : [];
  const editor = state.attachmentEditor;
  return `
    <section class="subpanel attachment-context-panel">
      <div class="subpanel-header">
        <strong>Context Files</strong>
        <span class="badge ${values.length ? "success" : "neutral"}">${escapeHtml(String(values.length))}</span>
      </div>
      <div class="attachment-form">
        <label>Name<input value="${escapeHtml(editor.name)}" data-field="attachment.name" placeholder="Brief, screenshot, notes" /></label>
        <label>URI<input value="${escapeHtml(editor.storageUri)}" data-field="attachment.storageUri" placeholder="file:///workspace/brief.md or https://..." /></label>
        <label>Type<input value="${escapeHtml(editor.mimeType)}" data-field="attachment.mimeType" placeholder="text/markdown" /></label>
        <label>Summary<input value="${escapeHtml(editor.summary)}" data-field="attachment.summary" placeholder="What this file should inform" /></label>
        <button class="secondary" data-action="attach-context-file" ${state.attachmentSaving || !state.selectedSessionId ? "disabled" : ""}>${state.attachmentSaving ? "Attaching..." : "Attach"}</button>
      </div>
      <div class="attachment-list">
        ${
          values.length
            ? values
                .slice(-6)
                .reverse()
                .map((attachment) => {
                  const size = formatFileSize(attachment.size_bytes);
                  return `
                    <div class="attachment-item">
                      <div>
                        <strong>${escapeHtml(attachment.name || "Attached file")}</strong>
                        <small>${escapeHtml(attachment.summary || attachment.storage_uri || "Context reference")}</small>
                      </div>
                      <span class="badge neutral">${escapeHtml(size || attachment.mime_type || attachment.kind || "context")}</span>
                    </div>
                  `;
                })
                .join("")
            : '<p class="muted">No context files attached yet.</p>'
        }
      </div>
    </section>
  `;
}

function formatWorkspaceLabel(value) {
  const text = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Item";
  return text
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeWorkspaceKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSchemaShape(schema) {
  return {
    properties:
      schema && typeof schema === "object" && !Array.isArray(schema) && schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {},
    required:
      schema && typeof schema === "object" && !Array.isArray(schema) && Array.isArray(schema.required)
        ? schema.required.filter((item) => typeof item === "string")
        : [],
  };
}

function isSchemaMultiline(field) {
  return field?.multiline === true || field?.format === "textarea";
}

function buildSchemaPayload(schema, value) {
  const normalized = normalizeSchemaShape(schema);
  const result = {};
  for (const [key, field] of Object.entries(normalized.properties)) {
    const rawValue = value[key];
    if (rawValue === undefined || rawValue === "") {
      continue;
    }
    if (field?.type === "boolean") {
      result[key] = rawValue === true;
      continue;
    }
    if (typeof rawValue !== "string") {
      result[key] = rawValue;
      continue;
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }
    if (field?.type === "number" || field?.type === "integer") {
      const parsed = field.type === "integer" ? Number.parseInt(trimmed, 10) : Number(trimmed);
      result[key] = Number.isNaN(parsed) ? trimmed : parsed;
      continue;
    }
    result[key] = trimmed;
  }
  return result;
}

function validateRequiredSchemaFields(schema, value) {
  const normalized = normalizeSchemaShape(schema);
  for (const key of normalized.required) {
    const rawValue = value[key];
    if (typeof rawValue === "boolean") {
      continue;
    }
    if (!(rawValue || "").trim()) {
      return key;
    }
  }
  return null;
}

function getHumanInputDraft(inputRequestId, schema) {
  const existing = state.humanInputDrafts[inputRequestId];
  if (existing) {
    return existing;
  }
  const normalized = normalizeSchemaShape(schema);
  const next = {};
  for (const [key, field] of Object.entries(normalized.properties)) {
    next[key] = field?.type === "boolean" ? false : "";
  }
  state.humanInputDrafts = {
    ...state.humanInputDrafts,
    [inputRequestId]: next,
  };
  return next;
}

function updateHumanInputDraft(inputRequestId, key, value) {
  const current = state.humanInputDrafts[inputRequestId] || {};
  state.humanInputDrafts = {
    ...state.humanInputDrafts,
    [inputRequestId]: {
      ...current,
      [key]: value,
    },
  };
  render();
}

function renderHumanInputSchemaForm(input) {
  const schema = normalizeSchemaShape(input.input_schema || {});
  const fields = Object.keys(schema.properties);
  const draft = getHumanInputDraft(input.input_request_id, schema);
  if (!fields.length) {
    return `
      <textarea rows="3" data-field="human-input.payload" data-input-request-id="${escapeHtml(input.input_request_id)}" placeholder='{"approved": true}'></textarea>
    `;
  }
  return `
    <div class="schema-form-grid">
      ${fields
        .map((key) => {
          const field = schema.properties[key] || {};
          const label = field.title || formatWorkspaceLabel(key);
          const required = schema.required.includes(key);
          const currentValue = draft[key];
          if (Array.isArray(field.enum) && field.enum.length) {
            return `
              <label class="schema-form-field span-2">
                <span>${escapeHtml(label)}${required ? ' <em>*</em>' : ""}</span>
                ${field.description ? `<small>${escapeHtml(field.description)}</small>` : ""}
                <div class="schema-segmented">
                  ${field.enum
                    .map((option) => `
                      <button
                        type="button"
                        class="schema-segment ${currentValue === option ? "selected" : ""}"
                        data-action="set-human-input-enum"
                        data-input-request-id="${escapeHtml(input.input_request_id)}"
                        data-schema-key="${escapeHtml(key)}"
                        data-schema-value="${escapeHtml(String(option))}"
                      >${escapeHtml(String(option))}</button>
                    `)
                    .join("")}
                </div>
              </label>
            `;
          }
          if (field.type === "boolean") {
            return `
              <label class="schema-form-field">
                <span>${escapeHtml(label)}${required ? ' <em>*</em>' : ""}</span>
                ${field.description ? `<small>${escapeHtml(field.description)}</small>` : ""}
                <button
                  type="button"
                  class="schema-boolean-toggle ${currentValue === true ? "selected" : ""}"
                  data-action="toggle-human-input-boolean"
                  data-input-request-id="${escapeHtml(input.input_request_id)}"
                  data-schema-key="${escapeHtml(key)}"
                >${currentValue === true ? "Yes" : "No"}</button>
              </label>
            `;
          }
          const multiline = isSchemaMultiline(field);
          return `
            <label class="schema-form-field ${multiline ? "span-2" : ""}">
              <span>${escapeHtml(label)}${required ? ' <em>*</em>' : ""}</span>
              ${field.description ? `<small>${escapeHtml(field.description)}</small>` : ""}
              ${
                multiline
                  ? `<textarea rows="3" data-field="human-input.schema" data-input-request-id="${escapeHtml(input.input_request_id)}" data-schema-key="${escapeHtml(key)}" placeholder="${escapeHtml(field.type === "number" || field.type === "integer" ? "Enter a number" : "Enter details")}">${escapeHtml(typeof currentValue === "string" ? currentValue : "")}</textarea>`
                  : `<input value="${escapeHtml(typeof currentValue === "string" ? currentValue : "")}" data-field="human-input.schema" data-input-request-id="${escapeHtml(input.input_request_id)}" data-schema-key="${escapeHtml(key)}" placeholder="${escapeHtml(field.type === "number" || field.type === "integer" ? "Enter a number" : "Enter value")}" />`
              }
            </label>
          `;
        })
        .join("")}
    </div>
  `;
}

function getExecutionDeliverables(detail) {
  const spec = getWorkspaceMissionSpec(detail);
  const requestedOutputs = Array.isArray(spec?.requestedOutputs) ? spec.requestedOutputs : [];
  const missionOutputs = Array.isArray(detail?.mission_snapshot?.outputs)
    ? detail.mission_snapshot.outputs
    : [];
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
  const items = [];
  const seen = new Set();

  for (const output of missionOutputs) {
    const title = output.title || output.key || output.name || "Deliverable";
    const key = normalizeWorkspaceKey(title);
    seen.add(key);
    items.push({
      key,
      title,
      status: output.status || "requested",
      summary: output.summary || "Tracked from mission output projection.",
      detail: Array.isArray(output.detailLines) ? output.detailLines[0] || "" : "",
      uri: output.storage_uri || output.storageUri || "",
      artifactCount: Array.isArray(output.artifacts) ? output.artifacts.length : 0,
      source: "mission-output",
    });
  }

  for (const artifact of artifacts) {
    const title =
      artifact.name ||
      artifact.kind ||
      artifact.type ||
      artifact.artifact_id ||
      "Artifact";
    const key = normalizeWorkspaceKey(title);
    const detailKey = normalizeWorkspaceKey(artifact.kind || artifact.type || "");
    if (seen.has(key) || (detailKey && seen.has(detailKey))) {
      continue;
    }
    seen.add(key);
    items.push({
      key,
      title,
      status: "returned",
      summary: artifact.summary || "Generated output from the latest run.",
      detail: artifact.kind || artifact.type || "",
      uri: artifact.storage_uri || artifact.path || "",
      artifactCount: 1,
      source: "artifact",
    });
  }

  for (const output of requestedOutputs) {
    const key = normalizeWorkspaceKey(output);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      key,
      title: formatWorkspaceLabel(output),
      status: "requested",
      summary: "Requested by the mission contract and still waiting for a returned output.",
      detail: "",
      uri: "",
      artifactCount: 0,
      source: "requested-output",
    });
  }

  return items;
}

function getExecutionQueueItems(detail) {
  const approvals = Array.isArray(detail?.pending_approvals) ? detail.pending_approvals : [];
  const humanInputs = Array.isArray(detail?.pending_human_inputs)
    ? detail.pending_human_inputs
    : [];
  const interventions = Array.isArray(detail?.interventions) ? detail.interventions : [];
  const dagPatches = Array.isArray(detail?.dag_patches) ? detail.dag_patches : [];

  const items = [];
  for (const approval of approvals) {
    items.push({
      kind: "approval",
      title: approval.title || approval.summary || approval.approval_id || "Approval required",
      status: approval.status || "waiting_human",
      detail:
        approval.detail ||
        approval.reason ||
        approval.summary ||
        "A human approval is required before execution can continue.",
    });
  }
  for (const input of humanInputs) {
    items.push({
      kind: "human-input",
      title: input.title || input.summary || input.input_id || "Human input required",
      status: input.status || "waiting_human",
      detail:
        input.detail ||
        input.prompt ||
        input.summary ||
        "The runtime is waiting for additional human input.",
    });
  }
  for (const intervention of interventions) {
    items.push({
      kind: "intervention",
      title:
        intervention.summary ||
        intervention.title ||
        intervention.kind ||
        intervention.intervention_id ||
        "Intervention",
      status: intervention.status || "pending",
      detail:
        intervention.reason ||
        intervention.kind ||
        "The orchestrator proposed a runtime intervention.",
    });
  }
  for (const patch of dagPatches) {
    items.push({
      kind: "dag-patch",
      title: patch.summary || patch.patch_id || "Runtime patch",
      status: patch.status || "proposed",
      detail:
        patch.reason ||
        getPatchTopology(patch)?.summary ||
        "Topology or runtime patch generated from an intervention.",
    });
  }
  return items;
}

function renderExecutionDeliverablesPanel(detail) {
  const items = getExecutionDeliverables(detail);
  const returnedCount = items.filter((item) => item.status === "returned").length;

  return `
    <section class="subpanel execution-deliverables-panel" data-workspace-focus="execution-deliverables">
      <div class="subpanel-header">
        <strong>Deliverables</strong>
        <span class="badge ${returnedCount ? "success" : items.length ? "warn" : "neutral"}">${escapeHtml(`${returnedCount}/${items.length || 0}`)}</span>
      </div>
      <div class="execution-ledger">
        ${
          items.length
            ? items
                .map(
                  (item) => `
                    <div class="execution-ledger-item">
                      <div class="execution-ledger-head">
                        <strong>${escapeHtml(item.title)}</strong>
                        <span class="badge ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
                      </div>
                      <p>${escapeHtml(item.summary)}</p>
                      <small>${escapeHtml(item.detail || item.uri || "Awaiting returned output.")}</small>
                    </div>
                  `,
                )
                .join("")
            : '<p class="muted">No deliverables have been declared yet.</p>'
        }
      </div>
    </section>
  `;
}

function renderExecutionRunControls(detail) {
  const runId = detail?.latest_run?.run_id || detail?.workspace_state?.latest_run_id || null;
  const runStatus = detail?.latest_run?.status || detail?.workspace_state?.run_status || "idle";
  if (!runId) {
    return `
      <section class="subpanel execution-control-panel" data-workspace-focus="run-controls">
        <div class="subpanel-header">
          <strong>Run Controls</strong>
          <span class="badge neutral">idle</span>
        </div>
        <p class="muted">No live run is attached to this mission yet.</p>
      </section>
    `;
  }

  const pauseLoading = isActionLoading("run-pause", runId);
  const resumeLoading = isActionLoading("run-resume", runId);
  const cancelLoading = isActionLoading("run-cancel", runId);
  const canPause = runStatus === "running";
  const canResume = runStatus === "paused";
  const canCancel = runStatus === "running" || runStatus === "paused" || runStatus === "waiting_human";

  return `
    <section class="subpanel execution-control-panel" data-workspace-focus="run-controls">
      <div class="subpanel-header">
        <strong>Run Controls</strong>
        <span class="badge ${statusTone(runStatus)}">${escapeHtml(runStatus)}</span>
      </div>
      <div class="orchestrator-actions execution-control-actions">
        <button class="secondary" data-action="run-pause" data-run-id="${escapeHtml(runId)}" ${pauseLoading || !canPause ? "disabled" : ""}>${pauseLoading ? "Pausing..." : "Pause"}</button>
        <button class="secondary" data-action="run-resume" data-run-id="${escapeHtml(runId)}" ${resumeLoading || !canResume ? "disabled" : ""}>${resumeLoading ? "Resuming..." : "Resume"}</button>
        <button class="secondary danger-action" data-action="run-cancel" data-run-id="${escapeHtml(runId)}" ${cancelLoading || !canCancel ? "disabled" : ""}>${cancelLoading ? "Cancelling..." : "Cancel"}</button>
      </div>
      <small>${escapeHtml(detail?.workspace_state?.latest_run_summary || detail?.latest_run?.current_summary || "Use controls sparingly; run state changes are persisted through the control plane.")}</small>
    </section>
  `;
}

function renderExecutionInterventionComposer(detail) {
  const sessionId = detail?.session?.session_id || state.selectedSessionId || "";
  const runId = detail?.latest_run?.run_id || detail?.workspace_state?.latest_run_id || "";
  const submitting = isActionLoading("intervention-submit", sessionId || "session");
  const kinds = [
    { value: "guidance", label: "Guidance" },
    { value: "pause_request", label: "Pause" },
    { value: "skip_request", label: "Skip" },
    { value: "add_node_request", label: "Add Step" },
    { value: "parallelism_request", label: "Parallelism" },
    { value: "change_request", label: "Change Route" },
  ];

  return `
    <section class="subpanel execution-control-panel" data-workspace-focus="runtime-intervention">
      <div class="subpanel-header">
        <strong>Runtime Intervention</strong>
        <span class="badge neutral">${escapeHtml(runId ? "live run" : "next pass")}</span>
      </div>
      <div class="execution-intervention-form">
        <label>Kind
          <select data-field="execution.interventionKind">
            ${kinds
              .map(
                (kind) => `<option value="${kind.value}" ${state.executionControl.interventionKind === kind.value ? "selected" : ""}>${kind.label}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="span-2">Instruction
          <textarea rows="3" data-field="execution.interventionText" placeholder="Describe the runtime adjustment or next-pass guidance.">${escapeHtml(state.executionControl.interventionText || "")}</textarea>
        </label>
        <button class="primary" data-action="submit-intervention" ${submitting || !sessionId || !state.executionControl.interventionText.trim() ? "disabled" : ""}>${submitting ? "Submitting..." : "Record intervention"}</button>
      </div>
    </section>
  `;
}

function renderExecutionQueuePanel(detail) {
  const approvals = Array.isArray(detail?.pending_approvals) ? detail.pending_approvals : [];
  const humanInputs = Array.isArray(detail?.pending_human_inputs)
    ? detail.pending_human_inputs
    : [];
  const interventions = Array.isArray(detail?.interventions) ? detail.interventions : [];
  const dagPatches = Array.isArray(detail?.dag_patches) ? detail.dag_patches : [];
  const items = getExecutionQueueItems(detail);
  const workspace = detail?.workspace_state || {};
  const latestSubtask = workspace.latest_subtask || null;

  return `
    <section class="subpanel execution-queue-panel" data-workspace-focus="execution-queue">
      <div class="subpanel-header">
        <strong>Interventions & Gates</strong>
        <span class="badge ${items.length ? "warn" : "neutral"}">${escapeHtml(String(items.length))}</span>
      </div>
      ${
        latestSubtask
          ? `
            <div class="execution-queue-highlight">
              <strong>${escapeHtml(latestSubtask.node_name || "Latest subtask")}</strong>
              <span class="badge ${statusTone(latestSubtask.status || "pending")}">${escapeHtml(latestSubtask.status || "pending")}</span>
              <small>${escapeHtml(latestSubtask.progress_message || "No progress detail yet.")}</small>
            </div>
          `
          : ""
      }
      <div class="execution-queue-list">
        ${approvals
          .map((approval) => {
            const approveLoading = isActionLoading("approval-approve", approval.approval_id);
            const rejectLoading = isActionLoading("approval-reject", approval.approval_id);
            return `
              <div class="execution-queue-item">
                <div class="execution-ledger-head">
                  <strong>${escapeHtml(approval.summary || approval.approval_id || "Approval required")}</strong>
                  <span class="badge ${statusTone(approval.status || "waiting_human")}">${escapeHtml(approval.status || "pending")}</span>
                </div>
                <p>${escapeHtml(approval.kind || "Human review")}</p>
                <div class="orchestrator-actions execution-inline-actions">
                  <button class="secondary" data-action="approve-approval" data-approval-id="${escapeHtml(approval.approval_id)}" ${approveLoading ? "disabled" : ""}>${approveLoading ? "Approving..." : "Approve"}</button>
                  <button class="secondary danger-action" data-action="reject-approval" data-approval-id="${escapeHtml(approval.approval_id)}" ${rejectLoading ? "disabled" : ""}>${rejectLoading ? "Rejecting..." : "Reject"}</button>
                </div>
              </div>
            `;
          })
          .join("")}
        ${humanInputs
          .map((input) => {
            const submitLoading = isActionLoading("human-input-submit", input.input_request_id);
            return `
              <div class="execution-queue-item">
                <div class="execution-ledger-head">
                  <strong>${escapeHtml(input.summary || input.input_request_id || "Human input required")}</strong>
                  <span class="badge ${statusTone(input.status || "waiting_human")}">${escapeHtml(input.status || "pending")}</span>
                </div>
                <p>${escapeHtml(input.node_name || "Submit structured input to resume the waiting node.")}</p>
                ${renderHumanInputSchemaForm(input)}
                <div class="orchestrator-actions execution-inline-actions">
                  <button class="secondary" data-action="submit-human-input" data-input-request-id="${escapeHtml(input.input_request_id)}" ${submitLoading ? "disabled" : ""}>${submitLoading ? "Submitting..." : "Submit input"}</button>
                </div>
              </div>
            `;
          })
          .join("")}
        ${dagPatches
          .map((patch) => {
            const confirmLoading = isActionLoading("patch-confirm", patch.patch_id);
            const rejectLoading = isActionLoading("patch-reject", patch.patch_id);
            const canConfirm =
              patch.status !== "applied" &&
              patch.status !== "applied_with_errors" &&
              patch.status !== "rejected" &&
              patch.status !== "unsupported" &&
              patch.apply_supported;
            const canReject =
              patch.status !== "applied" &&
              patch.status !== "applied_with_errors" &&
              patch.status !== "rejected" &&
              patch.status !== "unsupported";
            return `
              <div class="execution-queue-item">
                <div class="execution-ledger-head">
                  <strong>${escapeHtml(patch.summary || patch.patch_id || "Runtime patch")}</strong>
                  <span class="badge ${statusTone(patch.status || "pending")}">${escapeHtml(patch.status || "proposed")}</span>
                </div>
                <p>${escapeHtml(patch.reason || "Patch proposal generated from a runtime intervention.")}</p>
                <small>${escapeHtml((patch.operations || []).map((operation) => operation.op || "operation").join(", ") || "No operations")}</small>
                ${renderPatchGraphPreview(patch)}
                <div class="orchestrator-actions execution-inline-actions">
                  <button class="secondary" data-action="confirm-patch" data-patch-id="${escapeHtml(patch.patch_id)}" ${confirmLoading || !canConfirm ? "disabled" : ""}>${confirmLoading ? "Applying..." : "Confirm patch"}</button>
                  <button class="secondary danger-action" data-action="reject-patch" data-patch-id="${escapeHtml(patch.patch_id)}" ${rejectLoading || !canReject ? "disabled" : ""}>${rejectLoading ? "Rejecting..." : "Reject patch"}</button>
                </div>
              </div>
            `;
          })
          .join("")}
        ${interventions
          .map(
            (intervention) => `
              <div class="execution-queue-item">
                <div class="execution-ledger-head">
                  <strong>${escapeHtml(intervention.summary || intervention.intervention_id || "Intervention")}</strong>
                  <span class="badge ${statusTone(intervention.status || "pending")}">${escapeHtml(intervention.status || "recorded")}</span>
                </div>
                <p>${escapeHtml(intervention.interpreted_intent || intervention.content || "Runtime guidance was recorded for the orchestrator.")}</p>
                <small>${escapeHtml(intervention.kind || "guidance")}</small>
              </div>
            `,
          )
          .join("")}
        ${
          !approvals.length && !humanInputs.length && !dagPatches.length && !interventions.length && !items.length
            ? '<p class="muted">No approvals, human inputs, interventions, or runtime patches are waiting.</p>'
            : ""
        }
      </div>
    </section>
  `;
}

function renderExecutionCockpit(detail) {
  const workspace = detail?.workspace_state || {};
  const runStatus = detail?.latest_run?.status || workspace.run_status || "idle";
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
  const attachments = Array.isArray(detail?.attachments) ? detail.attachments : [];
  const queueItems = getExecutionQueueItems(detail);

  return `
    <section class="panel execution-cockpit-panel">
      <div class="panel-header">
        <div>
          <h3>Execution Cockpit</h3>
          <p>${escapeHtml(workspace.latest_run_summary || workspace.next_recommended_detail || "Supervise runtime, outputs, context, and intervention backlog from one place.")}</p>
        </div>
        <span class="badge ${statusTone(runStatus)}">${escapeHtml(runStatus)}</span>
      </div>
      <div class="workspace-summary-grid compact-summary execution-cockpit-summary">
        <div class="summary-stat">
          <strong>Deliverables</strong>
          <p>${escapeHtml(String(getExecutionDeliverables(detail).length))}</p>
        </div>
        <div class="summary-stat">
          <strong>Artifacts</strong>
          <p>${escapeHtml(String(artifacts.length))}</p>
        </div>
        <div class="summary-stat">
          <strong>Context Files</strong>
          <p>${escapeHtml(String(attachments.length))}</p>
        </div>
        <div class="summary-stat">
          <strong>Open Gates</strong>
          <p>${escapeHtml(String(queueItems.length))}</p>
        </div>
      </div>
      <div class="execution-cockpit-grid">
        <div class="execution-cockpit-main">
          ${renderExecutionRunControls(detail)}
          ${renderExecutionInterventionComposer(detail)}
          ${renderPatchGraphReviewPanel(detail)}
          ${renderRuntimeGraphPanel(detail?.runtime_graph || null)}
          ${renderAttachmentContextPanel(attachments)}
        </div>
        <div class="execution-cockpit-side">
          ${renderExecutionDeliverablesPanel(detail)}
          ${renderExecutionQueuePanel(detail)}
        </div>
      </div>
    </section>
  `;
}

function formatRuntimeMarker(marker) {
  if (marker === "active_frontier") return "Frontier";
  if (marker === "waiting_human") return "Human wait";
  if (marker === "approval_gate") return "Approval";
  if (marker === "human_input_gate") return "Input";
  if (marker === "blocked") return "Blocked";
  if (marker === "skipped") return "Skipped";
  if (marker === "terminal") return "Terminal";
  if (marker === "ready") return "Ready";
  return String(marker || "Marker").replace(/[_-]+/g, " ");
}

function runtimeMarkerTone(marker) {
  if (marker === "blocked") return "danger";
  if (marker === "waiting_human" || marker === "approval_gate" || marker === "human_input_gate") return "warn";
  if (marker === "active_frontier" || marker === "ready" || marker === "terminal") return "success";
  return "neutral";
}

function renderRuntimeGraphPanel(graph) {
  if (!graph) {
    return `
      <section class="subpanel runtime-graph-panel" data-workspace-focus="graph">
        <div class="subpanel-header">
          <strong>Runtime Graph</strong>
          <span class="badge neutral">Pending</span>
        </div>
        <p class="muted">Runtime topology will appear after the latest run plan is available.</p>
      </section>
    `;
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const packages = Array.isArray(graph.workPackages) ? graph.workPackages : [];
  const frontier = Array.isArray(graph.frontier) ? graph.frontier : [];
  const nodeNameById = new Map(nodes.map((node) => [node.nodeId, node.name]));
  const activeNodes = nodes.filter((node) =>
    (node.markers || []).includes("active_frontier") ||
    node.status === "running" ||
    node.status === "waiting_human",
  );
  const blockedNodes = nodes.filter((node) =>
    (node.markers || []).includes("blocked") ||
    (node.markers || []).includes("waiting_human") ||
    node.status === "failed" ||
    node.status === "cancelled",
  );
  const graphTone = blockedNodes.length
    ? "warn"
    : graph.runStatus === "completed"
      ? "success"
      : activeNodes.length
        ? "success"
        : "neutral";
  const summary =
    (graph.summaryLines || []).find((line) => /frontier|waiting|blocked|skipped/i.test(line)) ||
    `${nodes.length} node(s), ${edges.length} edge(s), ${packages.length} work package(s).`;

  return `
    <section class="subpanel runtime-graph-panel" data-workspace-focus="graph">
      <div class="subpanel-header">
        <strong>Runtime Graph</strong>
        <span class="badge ${graphTone}">${escapeHtml(graph.runStatus || "runtime")}</span>
      </div>
      <p class="muted">${escapeHtml(summary)}</p>
      <div class="runtime-graph-stats">
        <div><strong>${escapeHtml(String(nodes.length))}</strong><span>Nodes</span></div>
        <div><strong>${escapeHtml(String(edges.length))}</strong><span>Edges</span></div>
        <div><strong>${escapeHtml(String(frontier.length))}</strong><span>Frontier</span></div>
        <div><strong>${escapeHtml(String(packages.length))}</strong><span>Packages</span></div>
      </div>
      <div class="runtime-graph-layout">
        <div class="runtime-node-list">
          ${nodes
            .map(
              (node, index) => `
                <div class="runtime-node">
                  <span class="runtime-node-index ${statusTone(node.status)}">${escapeHtml(String(index + 1))}</span>
                  <div class="runtime-node-body">
                    <div class="runtime-node-head">
                      <strong>${escapeHtml(node.name || node.nodeId || "Node")}</strong>
                      <span class="badge ${statusTone(node.status)}">${escapeHtml(node.status || "pending")}</span>
                    </div>
                    <small>${escapeHtml(node.workPackageLabel || "Execution")} / ${escapeHtml(node.type || "task")}${node.agentProfile ? ` / ${escapeHtml(node.agentProfile)}` : ""}</small>
                    ${node.progress?.message ? `<p>${escapeHtml(node.progress.message)}</p>` : ""}
                    ${
                      Array.isArray(node.markers) && node.markers.length
                        ? `<div class="runtime-marker-row">${node.markers
                            .slice(0, 5)
                            .map((marker) => `<span class="badge ${runtimeMarkerTone(marker)}">${escapeHtml(formatRuntimeMarker(marker))}</span>`)
                            .join("")}</div>`
                        : ""
                    }
                  </div>
                </div>
              `,
            )
            .join("") || '<p class="muted">No runtime nodes yet.</p>'}
        </div>
        <div class="runtime-side-stack">
          <div class="runtime-package-list">
            ${packages
              .map(
                (pkg) => `
                  <div class="runtime-package">
                    <div class="runtime-package-head">
                      <strong>${escapeHtml(pkg.label || pkg.key || "Package")}</strong>
                      <span class="badge ${statusTone(pkg.status)}">${escapeHtml(pkg.status || "pending")}</span>
                    </div>
                    <small>${escapeHtml(String((pkg.nodeRunIds || []).length))} node(s), ${escapeHtml(String(pkg.readyCount || 0))} ready, ${escapeHtml(String(pkg.activeCount || 0))} active, ${escapeHtml(String(pkg.blockedCount || 0))} blocked</small>
                  </div>
                `,
              )
              .join("") || '<p class="muted">No work packages yet.</p>'}
          </div>
          <div class="runtime-edge-list">
            ${edges
              .slice(0, 8)
              .map(
                (edge) => `
                  <div class="runtime-edge">
                    <span>${escapeHtml(nodeNameById.get(edge.fromNodeId) || edge.fromNodeId || "from")} -&gt; ${escapeHtml(nodeNameById.get(edge.toNodeId) || edge.toNodeId || "to")}</span>
                    <span class="badge ${statusTone(edge.status)}">${escapeHtml(edge.status || "pending")}</span>
                  </div>
                `,
              )
              .join("") || '<p class="muted">No runtime edges yet.</p>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body && body.message ? body.message : `Request failed: ${response.status}`);
  }
  return body;
}

function actionKey(action, id) {
  return `${action}:${id}`;
}

function isActionLoading(action, id) {
  return !!state.actionLoading[actionKey(action, id)];
}

function setActionLoading(action, id, value) {
  const key = actionKey(action, id);
  if (value) {
    state.actionLoading = {
      ...state.actionLoading,
      [key]: true,
    };
    return;
  }
  const next = { ...state.actionLoading };
  delete next[key];
  state.actionLoading = next;
}

function buildSessionInventoryQuery({ query, visibility }) {
  const params = new URLSearchParams();
  if (query && query.trim()) {
    params.set("q", query.trim());
  }
  if (visibility && visibility !== "active") {
    params.set("visibility", visibility);
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function isWorkspaceSurfaceNav(nav = state.activeNav) {
  return nav === "missions" || nav === "sessions";
}

function shouldPersistWorkspaceLocationState() {
  return Boolean(state.selectedSessionId && isWorkspaceSurfaceNav());
}

function getWorkspaceFocusForLocationState() {
  if (!isWorkspaceSurfaceNav()) return "";
  const selection = state.workspaceSelection || {};
  if (selection.type === "checkpoint" && selection.key) {
    return "checkpoint-ledger";
  }
  if (selection.type === "output-history" && selection.key) {
    return "output-history";
  }
  const feedFilter = state.ui.workspaceFeedFilter || "all";
  if (state.ui.workspaceFeedExpanded === true || (WORKSPACE_FEED_FILTERS.has(feedFilter) && feedFilter !== "all")) {
    return "workspace-feed";
  }
  return "";
}

function queueRestoredWorkspaceFocusFromLocation() {
  if (!restoreWorkspaceFocusFromLocation || !state.workspaceDetail) return;
  const focus = getWorkspaceFocusForLocationState();
  restoreWorkspaceFocusFromLocation = false;
  if (focus) {
    pendingWorkspaceFocus = focus;
  }
}

function buildStudioLocationState() {
  const params = new URLSearchParams();
  if (DESKTOP_NAV_ITEMS.has(state.activeNav)) {
    params.set("nav", state.activeNav);
  }
  if (state.selectedSessionId) {
    params.set("session", state.selectedSessionId);
  }
  if (state.missionQuery.trim()) {
    params.set("mq", state.missionQuery.trim());
  }
  if (state.missionVisibility !== "active") {
    params.set("mv", state.missionVisibility);
  }
  if (state.sessionQuery.trim()) {
    params.set("sq", state.sessionQuery.trim());
  }
  if (state.sessionVisibility !== "active") {
    params.set("sv", state.sessionVisibility);
  }
  if (shouldPersistWorkspaceLocationState()) {
    const selection = state.workspaceSelection || {};
    if (WORKSPACE_SELECTION_TYPES.has(selection.type) && selection.key) {
      params.set("ws", selection.type);
      params.set("wsk", selection.key);
    }
    const feedFilter = state.ui.workspaceFeedFilter || "all";
    if (WORKSPACE_FEED_FILTERS.has(feedFilter) && feedFilter !== "all") {
      params.set("wf", feedFilter);
    }
    if (state.ui.workspaceFeedExpanded === true) {
      params.set("wfe", "1");
    }
  }
  const next = params.toString();
  const target = next ? `${window.location.pathname}?${next}` : window.location.pathname;
  const current = `${window.location.pathname}${window.location.search}`;
  if (target === current) {
    return;
  }
  window.history.replaceState(null, "", target);
}

function hydrateStudioLocationState() {
  const params = new URLSearchParams(window.location.search);
  const nav = params.get("nav");
  const sessionId = params.get("session");
  const missionQuery = params.get("mq");
  const missionVisibility = params.get("mv");
  const sessionQuery = params.get("sq");
  const sessionVisibility = params.get("sv");
  const workspaceSelectionType = params.get("ws");
  const workspaceSelectionKey = params.get("wsk");
  const workspaceFeedFilter = params.get("wf");
  const workspaceFeedExpanded = params.get("wfe");

  if (nav && DESKTOP_NAV_ITEMS.has(nav)) {
    state.activeNav = nav;
  }
  if (sessionId) {
    state.selectedSessionId = sessionId;
  }
  if (missionQuery) {
    state.missionQuery = missionQuery;
  }
  if (missionVisibility === "archived") {
    state.missionVisibility = missionVisibility;
  }
  if (sessionQuery) {
    state.sessionQuery = sessionQuery;
  }
  if (sessionVisibility === "archived") {
    state.sessionVisibility = sessionVisibility;
  }
  if (isWorkspaceSurfaceNav()) {
    if (
      workspaceSelectionType &&
      workspaceSelectionKey &&
      WORKSPACE_SELECTION_TYPES.has(workspaceSelectionType)
    ) {
      state.workspaceSelection = {
        type: workspaceSelectionType,
        key: workspaceSelectionKey,
      };
      restoreWorkspaceFocusFromLocation = true;
    }
    if (workspaceFeedFilter && WORKSPACE_FEED_FILTERS.has(workspaceFeedFilter)) {
      state.ui.workspaceFeedFilter = workspaceFeedFilter;
      restoreWorkspaceFocusFromLocation = true;
    }
    if (workspaceFeedExpanded === "1" || workspaceFeedExpanded === "true") {
      state.ui.workspaceFeedExpanded = true;
      restoreWorkspaceFocusFromLocation = true;
    }
  }
}

function getLocationSessionId() {
  return new URLSearchParams(window.location.search).get("session") || "";
}

async function restoreWorkspaceSessionFromLocation() {
  const sessionId = getLocationSessionId();
  if (!sessionId || !isWorkspaceSurfaceNav()) return;
  const currentSessionId = getWorkspaceSessionId(state.workspaceDetail);
  if (currentSessionId === sessionId) return;
  state.selectedSessionId = sessionId;
  await loadSessionWorkspace(sessionId, false);
  render();
}

function scheduleMissionSearch() {
  if (missionSearchTimer) {
    window.clearTimeout(missionSearchTimer);
  }
  missionSearchTimer = window.setTimeout(() => {
    missionSearchTimer = null;
    void loadMissions();
  }, 180);
}

function scheduleSessionSearch() {
  if (sessionSearchTimer) {
    window.clearTimeout(sessionSearchTimer);
  }
  sessionSearchTimer = window.setTimeout(() => {
    sessionSearchTimer = null;
    void loadSessions();
  }, 180);
}

function closeSessionStream() {
  if (state.streamSource) {
    state.streamSource.close();
    state.streamSource = null;
  }
  state.streamStatus = "idle";
  state.streamError = null;
}

function applyWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  const latestRunId = getWorkspaceLatestRunId(snapshot);
  const currentGraph = state.workspaceDetail?.runtime_graph || null;
  const snapshotGraph = snapshot.runtime_graph || snapshot.runtimeGraph || null;
  state.workspaceDetail = {
    session: snapshot.session || null,
    messages: snapshot.messages || [],
    latest_run: snapshot.latest_run || null,
    workspace_state: snapshot.workspace_state || {},
    next_actions: snapshot.next_actions || [],
    mission_snapshot: snapshot.mission_snapshot || null,
    mission_spec: snapshot.mission_spec || null,
    mission_view: snapshot.mission_view || snapshot.mission?.mission_view || null,
    attachments: snapshot.attachments || state.workspaceDetail?.attachments || [],
    route_compare: snapshot.route_compare || state.workspaceDetail?.route_compare || null,
    runtime_graph:
      snapshotGraph ||
      (currentGraph && currentGraph.runId === latestRunId ? currentGraph : null),
    artifacts: snapshot.artifacts || state.workspaceDetail?.artifacts || [],
    pending_approvals: snapshot.pending_approvals || [],
    pending_human_inputs: snapshot.pending_human_inputs || [],
    interventions: snapshot.interventions || [],
    dag_patches: snapshot.dag_patches || [],
  };
  reconcileWorkspaceSelection(state.workspaceDetail);
}

async function loadRuntimeGraphForWorkspace(shouldRender = true) {
  const runId = getWorkspaceLatestRunId(state.workspaceDetail);
  if (!state.workspaceDetail || !runId) {
    if (state.workspaceDetail) {
      state.workspaceDetail.runtime_graph = null;
    }
    if (shouldRender) render();
    return null;
  }
  try {
    const graph = await request(`/api/runs/${encodeURIComponent(runId)}/graph`);
    if (state.workspaceDetail && getWorkspaceLatestRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_graph = graph;
    }
    if (shouldRender) render();
    return graph;
  } catch (_error) {
    if (state.workspaceDetail && getWorkspaceLatestRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_graph = null;
    }
    if (shouldRender) render();
    return null;
  }
}

function openSessionStream(sessionId) {
  closeSessionStream();
  if (!sessionId) return;
  state.streamStatus = "connecting";
  state.streamError = null;
  const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
  state.streamSource = source;

  source.addEventListener("open", () => {
    state.streamStatus = "open";
    state.streamError = null;
    render();
  });

  const onEvent = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload?.data && (payload.type === "snapshot" || payload.type === "workspace.updated")) {
        applyWorkspaceSnapshot(payload.data);
        void loadRuntimeGraphForWorkspace(true);
        render();
      }
    } catch (error) {
      state.streamError = error.message || "Failed to parse session stream.";
      render();
    }
  };

  source.addEventListener("snapshot", onEvent);
  source.addEventListener("workspace.updated", onEvent);
  source.addEventListener("heartbeat", () => {
    if (state.streamStatus !== "open") {
      state.streamStatus = "open";
      render();
    }
  });
  source.addEventListener("error", () => {
    state.streamStatus = "error";
    state.streamError = "Session stream disconnected.";
    render();
  });
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, message: "JSON must be an object." };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: error.message || "Invalid JSON." };
  }
}

function parseCsv(text) {
  return String(text || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPlannerInvocationPayload() {
  const payload = {};
  if (state.orchestrator.selectedProfileId) {
    payload.orchestrator_profile_id = state.orchestrator.selectedProfileId;
    return payload;
  }
  if (state.orchestrator.provider.trim()) {
    payload.planner_provider_id = state.orchestrator.provider.trim();
  }
  if (state.orchestrator.model.trim()) {
    payload.planner_model = state.orchestrator.model.trim();
  }
  if (state.orchestrator.systemPrompt.trim()) {
    payload.orchestrator_system_prompt = state.orchestrator.systemPrompt.trim();
  }
  return payload;
}

function buildDraftPayload(editor = state.editor) {
  const inputSchema = parseJsonObject(editor.inputSchemaText);
  if (!inputSchema.ok) return { ok: false, message: `Input schema: ${inputSchema.message}` };
  const policy = parseJsonObject(editor.policyText);
  if (!policy.ok) return { ok: false, message: `Policy: ${policy.message}` };
  const bindings = parseJsonObject(editor.bindingsText);
  if (!bindings.ok) return { ok: false, message: `Agent bindings: ${bindings.message}` };
  const metadata = parseJsonObject(editor.metadataText);
  if (!metadata.ok) return { ok: false, message: `Metadata: ${metadata.message}` };
  if (!editor.name.trim()) return { ok: false, message: "Template name is required." };
  if (!editor.nodes.length) return { ok: false, message: "At least one node is required." };

  return {
    ok: true,
    payload: {
      name: editor.name.trim(),
      description: editor.description.trim(),
      workspace_scope: editor.workspaceScope.trim() || "default",
      input_schema: inputSchema.value,
      policy: policy.value,
      agent_profile_bindings: bindings.value,
      nodes: editor.nodes,
      edges: editor.edges,
      metadata: metadata.value,
    },
  };
}

function buildAgentProfilePayload(editor = state.registryEditor.profile) {
  const metadata = parseJsonObject(editor.metadataText);
  if (!metadata.ok) return { ok: false, message: `Agent metadata: ${metadata.message}` };
  if (!editor.name.trim()) return { ok: false, message: "Agent name is required." };

  return {
    ok: true,
    payload: {
      profile_id: editor.profileId.trim() || slugify(editor.name),
      name: editor.name.trim(),
      description: editor.description.trim(),
      openclaw_agent_id: editor.openclawAgentId.trim(),
      default_skills: parseCsv(editor.defaultSkillsText),
      allowed_tools: parseCsv(editor.allowedToolsText),
      disallowed_skills: parseCsv(editor.disallowedSkillsText),
      policy_tags: parseCsv(editor.policyTagsText),
      status: editor.status === "disabled" ? "disabled" : "active",
      metadata: {
        ...metadata.value,
        openclaw: {
          ...(metadata.value.openclaw && typeof metadata.value.openclaw === "object" && !Array.isArray(metadata.value.openclaw)
            ? metadata.value.openclaw
            : {}),
          provider: editor.openclawProvider.trim() || null,
          model: editor.openclawModel.trim() || null,
          runtime_mode: editor.openclawRuntimeMode.trim() || null,
        },
      },
    },
  };
}

function buildSkillPayload(editor = state.registryEditor.skill) {
  const inputSchema = parseJsonObject(editor.inputSchemaText);
  if (!inputSchema.ok) return { ok: false, message: `Skill input schema: ${inputSchema.message}` };
  const outputContract = parseJsonObject(editor.outputContractText);
  if (!outputContract.ok) {
    return { ok: false, message: `Skill output contract: ${outputContract.message}` };
  }
  const metadata = parseJsonObject(editor.metadataText);
  if (!metadata.ok) return { ok: false, message: `Skill metadata: ${metadata.message}` };
  if (!editor.name.trim()) return { ok: false, message: "Skill name is required." };

  return {
    ok: true,
    payload: {
      skill_id: editor.skillId.trim() || slugify(editor.name),
      name: editor.name.trim(),
      description: editor.description.trim(),
      category: editor.category.trim() || "general",
      allowed_tools: parseCsv(editor.allowedToolsText),
      input_schema: inputSchema.value,
      output_contract: outputContract.value,
      tags: parseCsv(editor.tagsText),
      status: editor.status === "disabled" ? "disabled" : "active",
      metadata: metadata.value,
    },
  };
}

function validateGraph() {
  const warnings = [];
  const nodeIds = new Set(state.editor.nodes.map((node) => node.id));
  if (nodeIds.size !== state.editor.nodes.length) {
    warnings.push("Duplicate node IDs will fail server validation.");
  }
  for (const edge of state.editor.edges) {
    if (!nodeIds.has(edge.from)) warnings.push(`Edge source not found: ${edge.from}`);
    if (!nodeIds.has(edge.to)) warnings.push(`Edge target not found: ${edge.to}`);
  }
  if (!state.editor.nodes.some((node) => node.type === "end")) {
    warnings.push("No end node is configured.");
  }
  return warnings;
}

async function loadTemplates(nextSelectedId = state.selectedId) {
  state.loading = true;
  state.error = null;
  render();
  try {
    const response = await request("/api/templates");
    state.templates = response.items || [];
    const nextSelected =
      nextSelectedId ||
      state.templates.find((item) => item.status === "draft")?.template_id ||
      state.templates[0]?.template_id ||
      null;
    if (nextSelected) {
      await selectTemplate(nextSelected, false);
    } else {
      state.selectedId = null;
      state.editor = emptyEditor();
    }
  } catch (error) {
    state.error = error.message || "Failed to load templates.";
  } finally {
    state.loading = false;
    render();
  }
}

async function loadRegistry(shouldRender = true) {
  state.registryLoading = true;
  if (shouldRender) render();
  try {
    const [profiles, skills] = await Promise.all([
      request("/api/registry/agent-profiles"),
      request("/api/registry/skills"),
    ]);
    state.agentProfiles = profiles.items || [];
    state.skills = skills.items || [];
  } catch (error) {
    state.error = error.message || "Failed to load registry.";
  } finally {
    state.registryLoading = false;
    if (shouldRender) render();
  }
}

function applyOrchestratorProfile(profile) {
  if (!profile) return;
  state.orchestrator.selectedProfileId = profile.orchestrator_id || "";
  state.orchestrator.name = profile.name || "Studio Orchestrator";
  state.orchestrator.provider = profile.provider || "";
  state.orchestrator.model = profile.model || "";
  state.orchestrator.systemPrompt = profile.system_prompt || state.orchestrator.systemPrompt;
  state.orchestrator.defaultToolsText = (profile.default_tools || []).join(", ");
  state.orchestrator.defaultSubagentsText = (profile.default_subagent_profile_ids || []).join(", ");
}

async function loadOrchestratorProfiles(shouldRender = true) {
  state.orchestratorProfilesLoading = true;
  if (shouldRender) render();
  try {
    const response = await request("/api/orchestrator-profiles");
    state.orchestratorProfiles = response.items || [];
    const selected =
      state.orchestratorProfiles.find(
        (profile) => profile.orchestrator_id === state.orchestrator.selectedProfileId,
      ) ||
      state.orchestratorProfiles[0] ||
      null;
    if (selected) {
      applyOrchestratorProfile(selected);
    }
  } catch (error) {
    state.orchestratorProfiles = [];
    state.error = error.message || "Failed to load orchestrator profiles.";
  } finally {
    state.orchestratorProfilesLoading = false;
    if (shouldRender) render();
  }
}

async function loadMissions(shouldRender = true) {
  state.missionsLoading = true;
  if (shouldRender) render();
  try {
    const response = await request(
      `/api/missions${buildSessionInventoryQuery({
        query: state.missionQuery,
        visibility: state.missionVisibility,
      })}`,
    );
    state.missions = response.items || [];
    if (state.missions[0]?.session_id) {
      if (!state.selectedSessionId) {
        state.selectedSessionId = state.missions[0].session_id;
      }
      if (state.activeNav === "orchestrator") {
        state.activeNav = "missions";
      }
    } else if (!state.selectedSessionId && state.activeNav === "missions") {
      state.activeNav = "orchestrator";
    }
    buildStudioLocationState();
  } catch (error) {
    state.error = error.message || "Failed to load missions.";
  } finally {
    state.missionsLoading = false;
    if (shouldRender) render();
  }
}

async function loadSessions(shouldRender = true) {
  state.sessionsLoading = true;
  if (shouldRender) render();
  try {
    const response = await request(
      `/api/sessions${buildSessionInventoryQuery({
        query: state.sessionQuery,
        visibility: state.sessionVisibility,
      })}`,
    );
    state.sessions = response.items || [];
    buildStudioLocationState();
  } catch (error) {
    state.error = error.message || "Failed to load sessions.";
  } finally {
    state.sessionsLoading = false;
    if (shouldRender) render();
  }
}

async function loadRuntimeSummary(shouldRender = true) {
  state.runtimeLoading = true;
  if (shouldRender) render();
  try {
    state.runtimeSummary = await request("/api/runtime/summary");
    if (!state.orchestrator.provider) {
      state.orchestrator.provider = state.runtimeSummary?.planner?.provider_id || "";
    }
    if (!state.orchestrator.model) {
      state.orchestrator.model = state.runtimeSummary?.planner?.llm_model || "";
    }
  } catch (error) {
    state.error = error.message || "Failed to load runtime summary.";
  } finally {
    state.runtimeLoading = false;
    if (shouldRender) render();
  }
}

async function loadDagProposalDetail(sessionId, proposalId) {
  if (!sessionId || !proposalId) return null;
  const response = await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals/${encodeURIComponent(proposalId)}`,
  );
  return response.proposal || null;
}

async function loadSessionDagProposals(sessionId, shouldRender = true, workspaceSeq = null) {
  if (!sessionId) {
    resetDurableProposalState("");
    if (shouldRender) render();
    return null;
  }
  const sessionChanged = state.planner.proposalSessionId && state.planner.proposalSessionId !== sessionId;
  if (sessionChanged) {
    state.planner.candidatePlan = null;
    state.planner.dagDraft = null;
    resetDurableProposalState(sessionId);
  }
  state.planner.proposalLoading = true;
  if (shouldRender) render();
  try {
    const response = await request(`/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals`);
    if (workspaceSeq !== null && workspaceSeq !== workspaceLoadSeq) return null;
    const items = response.items || [];
    state.planner.dagProposals = items;
    state.planner.confirmedProposalId = response.confirmed_proposal_id || null;
    state.planner.proposalSessionId = sessionId;
    const activeProposalId = state.planner.activeProposal?.proposal_id || "";
    const preferredId =
      (items.some((item) => item.proposal_id === activeProposalId) ? activeProposalId : "") ||
      state.planner.confirmedProposalId ||
      items[0]?.proposal_id ||
      "";
    const proposal = preferredId ? await loadDagProposalDetail(sessionId, preferredId) : null;
    if (workspaceSeq !== null && workspaceSeq !== workspaceLoadSeq) return null;
    applyDurableProposalToPlanner(proposal);
    return proposal;
  } catch (error) {
    if (workspaceSeq === null || workspaceSeq === workspaceLoadSeq) {
      state.planner.error = error.message || "Failed to load DAG proposals.";
    }
    return null;
  } finally {
    if (workspaceSeq === null || workspaceSeq === workspaceLoadSeq) {
      state.planner.proposalLoading = false;
      if (shouldRender) render();
    }
  }
}

async function loadSessionWorkspace(sessionId, shouldRender = true) {
  const loadSeq = ++workspaceLoadSeq;
  if (!sessionId) {
    state.workspaceDetail = null;
    resetWorkspaceDrilldownState();
    resetDurableProposalState("");
    closeSessionStream();
    if (shouldRender) render();
    return;
  }
  const currentSessionId = state.workspaceDetail?.session?.session_id || null;
  if (currentSessionId && sessionId !== currentSessionId) {
    resetWorkspaceDrilldownState();
  }
  if (shouldRender) {
    state.loading = true;
    render();
  }
  try {
    const [detail, routeCompare] = await Promise.all([
      request(`/api/sessions/${encodeURIComponent(sessionId)}`),
      request(`/api/sessions/${encodeURIComponent(sessionId)}/compare`).catch(() => null),
    ]);
    if (loadSeq !== workspaceLoadSeq) return;
    const latestRunId = getWorkspaceLatestRunId(detail);
    const runArtifactsPromise = latestRunId
      ? request(`/api/runs/${encodeURIComponent(latestRunId)}/artifacts`).catch(() => null)
      : Promise.resolve(null);
    const runtimeGraph = latestRunId
      ? await request(`/api/runs/${encodeURIComponent(latestRunId)}/graph`).catch(() => null)
      : null;
    if (loadSeq !== workspaceLoadSeq) return;
    applyWorkspaceSnapshot({
      ...detail,
      route_compare: routeCompare,
      runtime_graph: runtimeGraph,
      artifacts: detail.artifacts || [],
      pending_approvals: detail.pending_approvals || [],
      pending_human_inputs: detail.pending_human_inputs || [],
      interventions: detail.interventions || [],
      dag_patches: detail.dag_patches || [],
    });
    state.selectedSessionId = sessionId;
    buildStudioLocationState();
    await loadSessionDagProposals(sessionId, false, loadSeq);
    if (loadSeq !== workspaceLoadSeq) return;
    openSessionStream(sessionId);
    void runArtifactsPromise.then((runArtifacts) => {
      if (loadSeq !== workspaceLoadSeq) return;
      if (!state.workspaceDetail || getWorkspaceLatestRunId(state.workspaceDetail) !== latestRunId) return;
      state.workspaceDetail = {
        ...state.workspaceDetail,
        artifacts: runArtifacts?.items || state.workspaceDetail.artifacts || [],
      };
      render();
    });
  } catch (error) {
    if (loadSeq === workspaceLoadSeq) {
      state.error = error.message || "Failed to load session workspace.";
    }
  } finally {
    if (loadSeq === workspaceLoadSeq) {
      state.loading = false;
      queueRestoredWorkspaceFocusFromLocation();
      if (shouldRender) render();
    }
  }
}

async function loadWorkspaceData(nextSelectedId = state.selectedId) {
  const initialSessionId = state.selectedSessionId;
  const baseLoads = [
    loadTemplates(nextSelectedId),
    loadOrchestratorProfiles(false),
    loadRegistry(false),
    loadRuntimeSummary(false),
  ];

  if (initialSessionId) {
    await Promise.all([...baseLoads, loadSessionWorkspace(initialSessionId, false)]);
    queueRestoredWorkspaceFocusFromLocation();
    render();
    void Promise.all([
      loadMissions(false),
      state.activeNav === "sessions" ? loadSessions(false) : Promise.resolve(),
    ]).then(() => render());
    return;
  }

  await Promise.all([
    ...baseLoads,
    loadMissions(false),
    state.activeNav === "sessions" ? loadSessions(false) : Promise.resolve(),
  ]);
  if (state.selectedSessionId) {
    await loadSessionWorkspace(state.selectedSessionId, false);
  }
  queueRestoredWorkspaceFocusFromLocation();
  render();
}

async function refreshSelectedWorkspace(shouldRender = true) {
  if (state.selectedSessionId) {
    await loadSessionWorkspace(state.selectedSessionId, shouldRender);
    return;
  }
  if (shouldRender) render();
}

async function performWorkspaceAction(action, id, work) {
  setActionLoading(action, id, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    await work();
    await refreshSelectedWorkspace(false);
  } catch (error) {
    state.error = error.message || "Workspace action failed.";
  } finally {
    setActionLoading(action, id, false);
    render();
  }
}

async function controlRun(runId, verb) {
  if (!runId) return;
  await performWorkspaceAction(`run-${verb}`, runId, async () => {
    const response = await request(`/api/runs/${encodeURIComponent(runId)}/actions/${verb}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.notice = response?.run?.status
      ? `Run ${verb}d: ${response.run.status}`
      : `Run ${verb} request sent.`;
  });
}

async function resolveApproval(approvalId, decision) {
  if (!approvalId) return;
  await performWorkspaceAction(`approval-${decision}`, approvalId, async () => {
    const comment =
      decision === "reject"
        ? window.prompt("Rejection note", "Rejected from execution cockpit.") || ""
        : "";
    const response = await request(`/api/approvals/${encodeURIComponent(approvalId)}/${decision}`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    });
    state.notice = `Approval ${response.status || decision}.`;
  });
}

async function resolvePatch(patchId, decision) {
  const sessionId = state.selectedSessionId;
  if (!sessionId || !patchId) return;
  await performWorkspaceAction(`patch-${decision}`, patchId, async () => {
    const body =
      decision === "reject"
        ? {
            reason:
              window.prompt("Patch rejection reason", "Rejected from execution cockpit.") ||
              "Rejected from execution cockpit.",
            requested_by: "studio-operator",
          }
        : {
            requested_by: "studio-operator",
          };
    const response = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/patches/${encodeURIComponent(patchId)}/${decision}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    state.notice =
      decision === "confirm"
        ? `Patch ${response.patch?.status || "applied"}.`
        : `Patch ${response.patch?.status || "rejected"}.`;
  });
}

async function submitHumanInputRequest(inputRequestId, triggerButton = null) {
  if (!inputRequestId) return;
  const input = (state.workspaceDetail?.pending_human_inputs || []).find(
    (item) => item.input_request_id === inputRequestId,
  );
  const schema = normalizeSchemaShape(input?.input_schema || {});
  const hasSchemaFields = Object.keys(schema.properties).length > 0;
  let payload = {};
  if (hasSchemaFields) {
    const draft = getHumanInputDraft(inputRequestId, schema);
    const missing = validateRequiredSchemaFields(schema, draft);
    if (missing) {
      state.error = `Fill required field: ${missing}`;
      state.notice = null;
      render();
      return;
    }
    payload = buildSchemaPayload(schema, draft);
  } else {
    const field =
      triggerButton?.closest(".execution-queue-item")?.querySelector(
        `textarea[data-field="human-input.payload"][data-input-request-id="${inputRequestId}"]`,
      ) ||
      document.querySelector(
        `textarea[data-field="human-input.payload"][data-input-request-id="${inputRequestId}"]`,
      );
    const raw = field?.value?.trim() || "";
    if (raw) {
      const parsed = parseJsonObject(raw);
      if (!parsed.ok) {
        state.error = `Human input payload: ${parsed.message}`;
        state.notice = null;
        render();
        return;
      }
      payload = parsed.value;
    }
  }
  await performWorkspaceAction("human-input-submit", inputRequestId, async () => {
    const response = await request(
      `/api/human-inputs/${encodeURIComponent(inputRequestId)}/submit`,
      {
        method: "POST",
        body: JSON.stringify({ payload }),
      },
    );
    const nextDrafts = { ...state.humanInputDrafts };
    delete nextDrafts[inputRequestId];
    state.humanInputDrafts = nextDrafts;
    state.notice = `Human input ${response.status || "submitted"}.`;
  });
}

async function submitRuntimeIntervention() {
  const sessionId = state.selectedSessionId;
  const content = state.executionControl.interventionText.trim();
  if (!sessionId || !content) {
    return;
  }
  await performWorkspaceAction("intervention-submit", sessionId, async () => {
    const response = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/interventions`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          kind: state.executionControl.interventionKind,
          target_run_id: state.workspaceDetail?.latest_run?.run_id || state.workspaceDetail?.workspace_state?.latest_run_id || undefined,
          metadata: {
            source: "studio-execution-cockpit",
          },
        }),
      },
    );
    state.executionControl.interventionText = "";
    state.notice = response?.intervention?.summary
      ? `Recorded intervention: ${response.intervention.summary}`
      : "Runtime intervention recorded.";
  });
}

async function loadLineage(templateId) {
  if (!templateId) {
    state.lineage = null;
    return;
  }
  try {
    state.lineage = await request(`/api/templates/${encodeURIComponent(templateId)}/lineage`);
  } catch (_error) {
    state.lineage = null;
  }
}

async function selectTemplate(templateId, shouldRender = true) {
  if (shouldRender) {
    state.loading = true;
    render();
  }
  try {
    state.error = null;
    state.selectedId = templateId;
    const template = await request(`/api/templates/${encodeURIComponent(templateId)}`);
    state.editor = editorFromTemplate(template);
    await loadLineage(templateId);
  } catch (error) {
    state.error = error.message || "Failed to load template.";
  } finally {
    state.loading = false;
    if (shouldRender) render();
  }
}

async function createDraftTemplate(editor, templateId) {
  const draft = buildDraftPayload(editor);
  if (!draft.ok) {
    throw new Error(draft.message);
  }

  return await request("/api/templates", {
    method: "POST",
    body: JSON.stringify({
      ...draft.payload,
      template_id: templateId || slugify(editor.name),
    }),
  });
}

async function saveDraft() {
  const draft = buildDraftPayload();
  if (!draft.ok) {
    state.error = draft.message;
    state.notice = null;
    render();
    return;
  }
  if (["published", "archived"].includes(state.editor.status)) {
    state.error = "Only draft templates can be saved.";
    state.notice = null;
    render();
    return;
  }

  state.saving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const saved = state.editor.templateId
      ? await request(`/api/templates/${encodeURIComponent(state.editor.templateId)}`, {
          method: "PUT",
          body: JSON.stringify(draft.payload),
        })
      : await createDraftTemplate(state.editor, slugify(state.editor.name));
    state.notice = `Saved ${saved.template_id}`;
    await loadTemplates(saved.template_id);
  } catch (error) {
    state.error = error.message || "Failed to save template.";
  } finally {
    state.saving = false;
    render();
  }
}

async function publishDraft() {
  if (!state.editor.templateId) {
    state.error = "Save the draft before publishing.";
    state.notice = null;
    render();
    return;
  }
  state.publishing = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const published = await request(`/api/templates/${encodeURIComponent(state.editor.templateId)}/publish`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.notice = `Published ${published.template_id}`;
    await loadTemplates(published.template_id);
  } catch (error) {
    state.error = error.message || "Failed to publish template.";
  } finally {
    state.publishing = false;
    render();
  }
}

async function deriveSelectedTemplate() {
  if (!state.editor.templateId) {
    state.error = "Select a saved template before deriving.";
    render();
    return;
  }
  state.deriving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const derived = await request(`/api/templates/${encodeURIComponent(state.editor.templateId)}/derive`, {
      method: "POST",
      body: JSON.stringify({
        name: `${state.editor.name} Variant`,
      }),
    });
    state.notice = `Derived ${derived.template_id}`;
    await loadWorkspaceData(derived.template_id);
  } catch (error) {
    state.error = error.message || "Failed to derive template.";
  } finally {
    state.deriving = false;
    render();
  }
}

async function createSelectedTemplateVersion() {
  if (!state.editor.templateId) {
    state.error = "Select a published template before creating a version.";
    render();
    return;
  }
  state.versioning = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const version = await request(`/api/templates/${encodeURIComponent(state.editor.templateId)}/new-version`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.notice = `Created version draft ${version.template_id}`;
    await loadWorkspaceData(version.template_id);
  } catch (error) {
    state.error = error.message || "Failed to create template version.";
  } finally {
    state.versioning = false;
    render();
  }
}

async function archiveSelectedTemplate() {
  if (!state.editor.templateId) {
    state.error = "Select a saved template before archiving.";
    render();
    return;
  }
  state.archiving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const archived = await request(`/api/templates/${encodeURIComponent(state.editor.templateId)}/archive`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.notice = `Archived ${archived.template_id}`;
    await loadWorkspaceData(archived.template_id);
  } catch (error) {
    state.error = error.message || "Failed to archive template.";
  } finally {
    state.archiving = false;
    render();
  }
}

function getSelectedSessionInventoryItem() {
  if (!state.selectedSessionId) return null;
  return (
    state.missions.find((item) => item.session_id === state.selectedSessionId) ||
    state.sessions.find((item) => item.session_id === state.selectedSessionId) ||
    state.workspaceDetail?.session ||
    null
  );
}

async function updateSelectedSessionVisibility(action) {
  if (!state.selectedSessionId) {
    state.error = "Select a mission or session before changing visibility.";
    render();
    return;
  }
  state.sessionVisibilitySaving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const response = await request(
      `/api/sessions/${encodeURIComponent(state.selectedSessionId)}/${action}`,
      {
        method: "POST",
        body: JSON.stringify({
          requested_by: "studio",
          reason: action === "archive" ? "Archived from Studio workspace." : undefined,
        }),
      },
    );
    state.notice = `${action === "archive" ? "Archived" : "Restored"} ${
      response.session?.title || state.selectedSessionId
    }`;
    await Promise.all([loadMissions(false), loadSessions(false), loadSessionWorkspace(state.selectedSessionId, false)]);
  } catch (error) {
    state.error = error.message || "Failed to update session visibility.";
  } finally {
    state.sessionVisibilitySaving = false;
    render();
  }
}

async function createWorkspaceAttachment() {
  if (!state.selectedSessionId) {
    state.error = "Select a mission or session before attaching context.";
    state.notice = null;
    render();
    return;
  }
  const editor = state.attachmentEditor;
  const storageUri = editor.storageUri.trim();
  if (!storageUri) {
    state.error = "Attachment URI is required.";
    state.notice = null;
    render();
    return;
  }
  state.attachmentSaving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const response = await request(
      `/api/sessions/${encodeURIComponent(state.selectedSessionId)}/attachments`,
      {
        method: "POST",
        body: JSON.stringify({
          name: editor.name.trim() || undefined,
          storage_uri: storageUri,
          mime_type: editor.mimeType.trim() || undefined,
          summary: editor.summary.trim() || undefined,
          kind: "context",
          created_by: "studio",
        }),
      },
    );
    if (state.workspaceDetail) {
      state.workspaceDetail.attachments = response.items || [response.attachment].filter(Boolean);
    }
    state.attachmentEditor = {
      name: "",
      storageUri: "",
      mimeType: "",
      summary: "",
    };
    state.notice = `Attached ${response.attachment?.name || "context file"}.`;
    await Promise.all([loadMissions(false), loadSessions(false)]);
  } catch (error) {
    state.error = error.message || "Failed to attach context.";
  } finally {
    state.attachmentSaving = false;
    render();
  }
}

function getMessageText(message) {
  const content = message?.content || {};
  return (
    content.narrative_reply ||
    content.text ||
    content.turn_summary ||
    content.summary ||
    content.working_goal ||
    ""
  );
}

async function sendOrchestratorMessage() {
  const content = state.planner.intent.trim();
  if (!content) {
    state.planner.error = "Describe the mission or next instruction first.";
    render();
    return;
  }

  state.planning = true;
  state.planner.error = null;
  state.error = null;
  state.notice = null;
  render();
  try {
    if (state.selectedSessionId) {
      await request(`/api/sessions/${encodeURIComponent(state.selectedSessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      await loadSessionWorkspace(state.selectedSessionId, false);
      state.notice = "Orchestrator updated the active mission.";
    } else {
      const payload = {
        initial_message: content,
        created_by: "studio-orchestrator",
      };
      if (state.orchestrator.selectedProfileId) {
        payload.orchestrator_profile_id = state.orchestrator.selectedProfileId;
      }
      const created = await request("/api/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const sessionId = created.session?.session_id || created.session?.id || null;
      if (sessionId) {
        state.selectedSessionId = sessionId;
        await Promise.all([loadMissions(false), loadSessions(false), loadSessionWorkspace(sessionId, false)]);
      }
      state.notice = "Started a new orchestrated mission.";
    }
  } catch (error) {
    state.error = error.message || "Failed to send instruction to orchestrator.";
  } finally {
    state.planning = false;
    render();
  }
}

function getWorkspaceSessionId(detail) {
  return detail?.session?.session_id || detail?.session?.id || null;
}

function getMissionInventoryLabels(mission) {
  const snapshot = mission.mission_snapshot || null;
  const spec = hasVersionedMissionWorkspaceSnapshot(snapshot)
    ? snapshot.spec || mission.mission_spec || null
    : mission.mission_spec || snapshot?.spec || null;
  const view = mission.mission_view || null;
  const title = snapshot?.missionTitle || view?.title || spec?.objective || mission.title || mission.session_id || "Untitled mission";
  const subtitle = spec
    ? formatMissionRouteLabel(spec.route)
    : snapshot?.nextActionLabel || view?.routeLabel || mission.status || "mission";
  return {
    title,
    subtitle: mission.archived ? `Archived / ${subtitle}` : subtitle,
  };
}

function getSessionInventoryLabels(session) {
  const title = session.title || session.session_id || "Untitled session";
  const subtitle = session.archived
    ? `Archived / ${session.session_id}`
    : session.workspace_state?.stage || session.status || "session";
  return { title, subtitle };
}

function getActiveSessionInventoryItems() {
  return state.activeNav === "sessions" ? state.sessions : state.missions;
}

function switchDesktopNav(nav) {
  state.activeNav = nav;
  state.error = null;
  buildStudioLocationState();
  render();
}

function queueCommandPaletteFocus(mode = "end") {
  pendingCommandPaletteFocus = mode;
}

function openCommandPalette() {
  state.commandPaletteOpen = true;
  state.commandPaletteIndex = 0;
  state.error = null;
  queueCommandPaletteFocus("select");
  render();
}

function closeCommandPalette() {
  state.commandPaletteOpen = false;
  state.commandPaletteQuery = "";
  state.commandPaletteIndex = 0;
  pendingCommandPaletteFocus = null;
  render();
}

async function openSessionFromCommand(nav, sessionId) {
  if (!sessionId) return;
  prepareWorkspaceSessionChange(sessionId);
  state.activeNav = nav === "orchestrator" ? "missions" : nav;
  state.selectedSessionId = sessionId;
  pendingSessionInventoryScroll = true;
  await loadSessionWorkspace(sessionId);
}

async function openWorkspaceFocusPanel(kind) {
  if (!state.selectedSessionId) {
    state.activeNav = "missions";
    state.error = `Select a mission or session before opening ${kind}.`;
    state.notice = null;
    render();
    return;
  }

  state.activeNav = state.activeNav === "sessions" ? "sessions" : "missions";
  state.error = null;
  state.notice = null;
  const currentSessionId = getWorkspaceSessionId(state.workspaceDetail);
  if (!state.workspaceDetail || currentSessionId !== state.selectedSessionId) {
    await loadSessionWorkspace(state.selectedSessionId, false);
  }
  if (kind === "graph") {
    await loadRuntimeGraphForWorkspace(false);
  }

  const hasPanel =
    kind === "compare"
      ? !!state.workspaceDetail?.route_compare
      : !!(state.workspaceDetail?.runtime_graph || getWorkspaceLatestRunId(state.workspaceDetail));

  if (!hasPanel) {
    state.notice =
      kind === "compare"
        ? "No route compare is available for the selected workspace."
        : "No runtime graph is available for the selected workspace.";
    render();
    return;
  }

  pendingWorkspaceFocus = kind;
  state.notice = kind === "compare" ? "Opened route compare." : "Opened runtime graph.";
  render();
}

function commandSearchText(item) {
  return [
    item.title,
    item.subtitle,
    item.group,
    ...(Array.isArray(item.keywords) ? item.keywords : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildCommandPaletteItems() {
  const selected = getSelectedSessionInventoryItem();
  const selectedLabels = selected?.mission_snapshot || selected?.mission_spec
    ? getMissionInventoryLabels(selected)
    : selected
      ? getSessionInventoryLabels(selected)
      : null;
  const items = [
    {
      key: "nav:orchestrator",
      group: "Navigate",
      title: "Go to Orchestrator",
      subtitle: "Chat-first mission steering",
      keywords: ["studio v2", "orchestrator", "dag", "subagent", "model"],
      run: () => switchDesktopNav("orchestrator"),
    },
    {
      key: "nav:missions",
      group: "Navigate",
      title: "Go to Missions",
      subtitle: "Mission workspace inventory",
      keywords: ["workspace", "mission"],
      run: () => switchDesktopNav("missions"),
    },
    {
      key: "nav:sessions",
      group: "Navigate",
      title: "Go to Sessions",
      subtitle: "Session inventory and archived work",
      keywords: ["session", "inventory"],
      run: () => switchDesktopNav("sessions"),
    },
    {
      key: "nav:templates",
      group: "Navigate",
      title: "Go to Templates",
      subtitle: "Template authoring workspace",
      keywords: ["template", "dag", "planner"],
      run: () => switchDesktopNav("templates"),
    },
    {
      key: "nav:agents",
      group: "Navigate",
      title: "Go to Subagents",
      subtitle: "Hosted subagent bindings and runtime intent",
      keywords: ["agent", "subagent", "profile", "openclaw"],
      run: async () => {
        state.activeNav = "agents";
        await loadRuntimeSummary(false);
        render();
      },
    },
    {
      key: "nav:registry",
      group: "Navigate",
      title: "Go to Registry",
      subtitle: "Agent profiles and skills",
      keywords: ["skill", "profile"],
      run: async () => {
        state.activeNav = "registry";
        await loadRegistry(false);
        render();
      },
    },
    {
      key: "nav:settings",
      group: "Navigate",
      title: "Go to Settings",
      subtitle: "Runtime and planner ownership",
      keywords: ["runtime", "planner"],
      run: async () => {
        state.activeNav = "settings";
        await loadRuntimeSummary(false);
        render();
      },
    },
    {
      key: "workspace:compare",
      group: "Workspace",
      title: "Open Plan Compare",
      subtitle: selectedLabels ? selectedLabels.title : "Select a mission or session first",
      keywords: ["diff", "compare", "route", "version"],
      run: () => openWorkspaceFocusPanel("compare"),
    },
    {
      key: "workspace:graph",
      group: "Workspace",
      title: "Open Runtime Graph",
      subtitle: selectedLabels ? selectedLabels.title : "Select a mission or session first",
      keywords: ["graph", "runtime", "run"],
      run: () => openWorkspaceFocusPanel("graph"),
    },
    {
      key: "refresh:workspace",
      group: "Refresh",
      title: "Refresh Workspace",
      subtitle: "Templates, registry, missions, sessions, runtime",
      keywords: ["sync", "reload"],
      run: async () => {
        await loadWorkspaceData();
        state.notice = "Workspace refreshed.";
        render();
      },
    },
    {
      key: "refresh:runtime",
      group: "Refresh",
      title: "Refresh Runtime",
      subtitle: "Runtime health and agent hosting summary",
      keywords: ["agents", "health", "reload"],
      run: async () => {
        await loadRuntimeSummary(false);
        state.notice = "Runtime summary refreshed.";
        render();
      },
    },
  ];

  for (const mission of state.missions) {
    const labels = getMissionInventoryLabels(mission);
    items.push({
      key: `mission:${mission.session_id}`,
      group: "Mission",
      title: labels.title,
      subtitle: labels.subtitle,
      keywords: [mission.session_id, mission.status, mission.title],
      run: () => openSessionFromCommand("missions", mission.session_id),
    });
  }

  for (const session of state.sessions) {
    const labels = getSessionInventoryLabels(session);
    items.push({
      key: `session:${session.session_id}`,
      group: "Session",
      title: labels.title,
      subtitle: labels.subtitle,
      keywords: [session.session_id, session.status, session.workspace_state?.stage],
      run: () => openSessionFromCommand("sessions", session.session_id),
    });
  }

  return items;
}

function getFilteredCommandPaletteItems() {
  const query = state.commandPaletteQuery.trim().toLowerCase();
  const items = buildCommandPaletteItems();
  if (!query) return items;
  const terms = query.split(/\s+/g).filter(Boolean);
  return items.filter((item) => {
    const text = commandSearchText(item);
    return terms.every((term) => text.includes(term));
  });
}

function getCommandPaletteSelectedIndex(items) {
  if (!items.length) return 0;
  return Math.min(Math.max(state.commandPaletteIndex, 0), items.length - 1);
}

function moveCommandPaletteSelection(offset) {
  const items = getFilteredCommandPaletteItems();
  if (!items.length) return;
  const selectedIndex = getCommandPaletteSelectedIndex(items);
  state.commandPaletteIndex = (selectedIndex + offset + items.length) % items.length;
  queueCommandPaletteFocus("end");
  render();
}

async function executeCommandPaletteItem(key) {
  const items = getFilteredCommandPaletteItems();
  const selectedIndex = getCommandPaletteSelectedIndex(items);
  const item = items.find((candidate) => candidate.key === key) || items[selectedIndex];
  if (!item) return;
  state.commandPaletteOpen = false;
  state.commandPaletteQuery = "";
  state.commandPaletteIndex = 0;
  pendingCommandPaletteFocus = null;
  render();
  try {
    await item.run();
  } catch (error) {
    state.error = error.message || "Failed to run command.";
    state.notice = null;
    render();
  }
}

function navigateSessionInventory(offset) {
  const items = getActiveSessionInventoryItems().filter((item) => item?.session_id);
  if (!items.length) return false;
  const currentIndex = items.findIndex((item) => item.session_id === state.selectedSessionId);
  const nextIndex =
    currentIndex === -1
      ? offset > 0
        ? 0
        : items.length - 1
      : (currentIndex + offset + items.length) % items.length;
  const nextSessionId = items[nextIndex]?.session_id;
  if (!nextSessionId) return false;
  prepareWorkspaceSessionChange(nextSessionId);
  state.selectedSessionId = nextSessionId;
  pendingSessionInventoryScroll = true;
  void loadSessionWorkspace(nextSessionId);
  return true;
}

function openSelectedSessionInventoryItem() {
  if (!state.selectedSessionId) {
    return navigateSessionInventory(1);
  }
  pendingSessionInventoryScroll = true;
  void loadSessionWorkspace(state.selectedSessionId);
  return true;
}

function isTextEntryTarget(target) {
  if (!target) return false;
  const tagName = target.tagName ? target.tagName.toLowerCase() : "";
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function applyPendingCommandPaletteFocus() {
  if (!state.commandPaletteOpen) {
    pendingCommandPaletteFocus = null;
    return;
  }
  if (!pendingCommandPaletteFocus) return;
  const mode = pendingCommandPaletteFocus;
  pendingCommandPaletteFocus = null;
  window.setTimeout(() => {
    const input = document.querySelector("[data-command-palette-input]");
    if (input) {
      input.focus();
      if (mode === "select") {
        input.select();
      } else if (typeof input.setSelectionRange === "function") {
        const cursor = input.value.length;
        input.setSelectionRange(cursor, cursor);
      }
    }
    document.querySelector(".command-palette-item.selected")?.scrollIntoView({ block: "nearest" });
  }, 0);
}

function applyPendingWorkspaceFocus() {
  if (!pendingWorkspaceFocus) return;
  const focus = pendingWorkspaceFocus;
  pendingWorkspaceFocus = null;
  window.setTimeout(() => {
    const target = document.querySelector(`[data-workspace-focus="${focus}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    target.classList.add("workspace-focus-highlight");
    window.setTimeout(() => target.classList.remove("workspace-focus-highlight"), 1200);
  }, 0);
}

function applyPendingWorkspaceFeedEntryHighlight() {
  if (!pendingWorkspaceFeedEntryKey) return;
  const key = pendingWorkspaceFeedEntryKey;
  pendingWorkspaceFeedEntryKey = null;
  window.setTimeout(() => {
    const target = document.querySelector(`[data-workspace-feed-entry-key="${key}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("workspace-focus-highlight");
    window.setTimeout(() => target.classList.remove("workspace-focus-highlight"), 1200);
  }, 0);
}

function applyPendingSessionInventoryScroll() {
  if (!pendingSessionInventoryScroll) return;
  pendingSessionInventoryScroll = false;
  const selectedSessionId = state.selectedSessionId;
  if (!selectedSessionId) return;
  window.setTimeout(() => {
    const buttons = document.querySelectorAll("[data-session-id]");
    for (const button of buttons) {
      if (button.dataset.sessionId === selectedSessionId) {
        button.scrollIntoView({ block: "nearest" });
        break;
      }
    }
  }, 0);
}

function afterRender() {
  if (state.commandPaletteOpen && !pendingCommandPaletteFocus) {
    pendingCommandPaletteFocus = "end";
  }
  applyPendingCommandPaletteFocus();
  applyPendingWorkspaceFocus();
  applyPendingWorkspaceFeedEntryHighlight();
  applyPendingSessionInventoryScroll();
}

async function saveOrchestratorProfile() {
  const name = state.orchestrator.name.trim();
  if (!name) {
    state.error = "Orchestrator profile name is required.";
    state.notice = null;
    render();
    return;
  }

  state.orchestratorProfilesLoading = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const saved = await request("/api/orchestrator-profiles", {
      method: "POST",
      body: JSON.stringify({
        orchestrator_id: state.orchestrator.selectedProfileId || undefined,
        name,
        provider: state.orchestrator.provider.trim(),
        model: state.orchestrator.model.trim(),
        system_prompt: state.orchestrator.systemPrompt.trim(),
        default_tools: parseCsv(state.orchestrator.defaultToolsText),
        default_subagent_profile_ids: parseCsv(state.orchestrator.defaultSubagentsText),
        planning_policy: {},
        handoff_policy: {},
        metadata: {
          source: "studio-v2",
        },
      }),
    });
    applyOrchestratorProfile(saved);
    state.notice = `Saved orchestrator profile ${saved.orchestrator_id}`;
    await loadOrchestratorProfiles(false);
  } catch (error) {
    state.error = error.message || "Failed to save orchestrator profile.";
  } finally {
    state.orchestratorProfilesLoading = false;
    render();
  }
}

async function saveAgentProfile() {
  const draft = buildAgentProfilePayload();
  if (!draft.ok) {
    state.error = draft.message;
    state.notice = null;
    render();
    return;
  }

  state.registrySaving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const saved = await request("/api/registry/agent-profiles", {
      method: "POST",
      body: JSON.stringify(draft.payload),
    });
    state.notice = `Saved agent profile ${saved.profile_id}`;
    state.registryEditor.profile = editorFromAgentProfile(saved);
    await Promise.all([loadRegistry(false), loadRuntimeSummary(false)]);
  } catch (error) {
    state.error = error.message || "Failed to save agent profile.";
  } finally {
    state.registrySaving = false;
    render();
  }
}

async function disableAgentProfile() {
  const profileId = state.registryEditor.profile.profileId.trim();
  if (!profileId) {
    state.error = "Select a saved agent profile before disabling.";
    render();
    return;
  }

  state.registryDisabling = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const disabled = await request(
      `/api/registry/agent-profiles/${encodeURIComponent(profileId)}/disable`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    state.notice = `Disabled agent profile ${disabled.profile_id}`;
    state.registryEditor.profile = editorFromAgentProfile(disabled);
    await Promise.all([loadRegistry(false), loadRuntimeSummary(false)]);
  } catch (error) {
    state.error = error.message || "Failed to disable agent profile.";
  } finally {
    state.registryDisabling = false;
    render();
  }
}

async function saveSkill() {
  const draft = buildSkillPayload();
  if (!draft.ok) {
    state.error = draft.message;
    state.notice = null;
    render();
    return;
  }

  state.registrySaving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const saved = await request("/api/registry/skills", {
      method: "POST",
      body: JSON.stringify(draft.payload),
    });
    state.notice = `Saved skill ${saved.skill_id}`;
    state.registryEditor.skill = editorFromSkill(saved);
    await loadRegistry(false);
  } catch (error) {
    state.error = error.message || "Failed to save skill.";
  } finally {
    state.registrySaving = false;
    render();
  }
}

async function disableSkill() {
  const skillId = state.registryEditor.skill.skillId.trim();
  if (!skillId) {
    state.error = "Select a saved skill before disabling.";
    render();
    return;
  }

  state.registryDisabling = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const disabled = await request(`/api/registry/skills/${encodeURIComponent(skillId)}/disable`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.notice = `Disabled skill ${disabled.skill_id}`;
    state.registryEditor.skill = editorFromSkill(disabled);
    await loadRegistry(false);
  } catch (error) {
    state.error = error.message || "Failed to disable skill.";
  } finally {
    state.registryDisabling = false;
    render();
  }
}

async function planFromIntent() {
  if (!state.planner.intent.trim()) {
    state.planner.error = "Intent is required.";
    render();
    return;
  }

  const parsedInputs = parseJsonObject(state.planner.inputsText);
  if (!parsedInputs.ok) {
    state.planner.error = `Planner inputs: ${parsedInputs.message}`;
    render();
    return;
  }

  state.planning = true;
  state.planner.error = null;
  state.planner.recommendation = null;
  state.planner.candidatePlan = null;
  state.planner.proposalOverrides = {};
  state.notice = null;
  render();
  try {
    const recommendation = await request("/api/planner/template-selection", {
      method: "POST",
      body: JSON.stringify({
        intent: state.planner.intent.trim(),
        ...buildPlannerInvocationPayload(),
      }),
    });
    state.planner.recommendation = recommendation;
    state.planner.templateId = recommendation.selected_template.template_id;
    await refreshCandidatePlan(false);
  } catch (error) {
    state.planner.error = error.message || "Planning failed.";
  } finally {
    state.planning = false;
    render();
  }
}

async function refreshCandidatePlan(shouldRender = true) {
  if (!state.planner.intent.trim()) {
    state.planner.error = "Intent is required.";
    if (shouldRender) render();
    return;
  }
  if (!state.planner.templateId.trim()) {
    state.planner.error = "Select a template candidate first.";
    if (shouldRender) render();
    return;
  }

  const parsedInputs = parseJsonObject(state.planner.inputsText);
  if (!parsedInputs.ok) {
    state.planner.error = `Planner inputs: ${parsedInputs.message}`;
    if (shouldRender) render();
    return;
  }

  state.planning = true;
  state.planner.error = null;
  if (shouldRender) render();
  try {
    const candidatePlan = await request("/api/planner/candidate-plan", {
      method: "POST",
      body: JSON.stringify({
        intent: state.planner.intent.trim(),
        template_id: state.planner.templateId.trim(),
        inputs: parsedInputs.value,
        ...buildPlannerInvocationPayload(),
      }),
    });
    state.planner.candidatePlan = candidatePlan;
    state.planner.proposalOverrides = {};
  } catch (error) {
    state.planner.error = error.message || "Candidate plan failed.";
  } finally {
    state.planning = false;
    if (shouldRender) render();
  }
}

async function generateDagDraft(shouldRender = true) {
  if (!state.planner.intent.trim()) {
    state.planner.error = "Intent is required.";
    if (shouldRender) render();
    return;
  }

  const parsedInputs = parseJsonObject(state.planner.inputsText);
  if (!parsedInputs.ok) {
    state.planner.error = `Planner inputs: ${parsedInputs.message}`;
    if (shouldRender) render();
    return;
  }

  const maxAgentNodes = Number(state.planner.maxAgentNodes || 1);
  if (!Number.isFinite(maxAgentNodes) || maxAgentNodes < 1) {
    state.planner.error = "Max agent nodes must be a positive number.";
    if (shouldRender) render();
    return;
  }

  state.planning = true;
  state.planner.error = null;
  state.planner.dagDraft = null;
  state.planner.activeProposal = null;
  state.planner.proposalOverrides = {};
  state.notice = null;
  if (shouldRender) render();
  try {
    const dagDraft = await request("/api/planner/dag-draft", {
      method: "POST",
      body: JSON.stringify({
        intent: state.planner.intent.trim(),
        template_id: state.planner.templateId.trim() || undefined,
        inputs: parsedInputs.value,
        max_agent_nodes: maxAgentNodes,
        ...buildPlannerInvocationPayload(),
      }),
    });
    state.planner.dagDraft = dagDraft;
    state.planner.proposalOverrides = {};
    if (dagDraft.template_recommendation) {
      state.planner.recommendation = dagDraft.template_recommendation;
      state.planner.templateId = dagDraft.template_recommendation.selected_template.template_id;
    }
  } catch (error) {
    state.planner.error = error.message || "DAG draft generation failed.";
  } finally {
    state.planning = false;
    if (shouldRender) render();
  }
}

function getCurrentPlannerTemplateId() {
  return (
    state.planner.templateId ||
    state.planner.dagDraft?.template_recommendation?.selected_template?.template_id ||
    state.planner.dagDraft?.planner_context?.source_template_id ||
    ""
  );
}

function buildDurableProposalAssignments() {
  flushProposalOverridesFromDom();
  const nodes = getProposalSourceNodes();
  if (!nodes.length) {
    throw new Error("Generate or load a DAG proposal before saving assignments.");
  }
  return nodes.map((node, index) => {
    const draft = getProposalNodeDraft(node, index);
    const outputContractText = draft.outputContractText.trim();
    if (outputContractText) {
      const parsed = parseJsonObject(outputContractText);
      if (!parsed.ok) {
        throw new Error(`${draft.name || draft.id} output contract: ${parsed.message}`);
      }
    }
    return {
      node_id: draft.id,
      node_name: draft.name || null,
      subagent_profile_id: draft.agentProfile.trim() || null,
      provider: draft.provider.trim() || null,
      model: draft.model.trim() || null,
      allowed_tools: parseCsv(draft.toolsText),
      allowed_skills: parseCsv(draft.skillsText),
      input_context: draft.contextText.trim() || null,
      output_contract: outputContractText || null,
      metadata: {
        source: "studio",
        node_type: draft.type,
      },
    };
  });
}

async function createDurableDagProposal() {
  const sessionId = getActiveProposalSessionId();
  if (!sessionId) {
    state.planner.error = "Select or start a mission before creating a DAG proposal.";
    render();
    return;
  }
  const parsedInputs = parseJsonObject(state.planner.inputsText);
  if (!parsedInputs.ok) {
    state.planner.error = `Planner inputs: ${parsedInputs.message}`;
    render();
    return;
  }

  state.planner.proposalSaving = true;
  state.planner.error = null;
  state.error = null;
  state.notice = null;
  render();
  try {
    const planRevision = getCurrentProposalPlanRevision();
    const body = {
      inputs: parsedInputs.value,
    };
    const templateId = getCurrentPlannerTemplateId();
    if (templateId) body.template_id = templateId;
    if (planRevision) {
      body.source_revision = planRevision.revision;
      body.source_option = planRevision.option;
    }
    const response = await request(`/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    applyDurableProposalToPlanner(response.proposal || null);
    state.notice = response.proposal?.proposal_id
      ? `Created DAG proposal ${response.proposal.proposal_id}.`
      : "Created DAG proposal.";
    await Promise.all([loadMissions(false), loadSessions(false), loadSessionWorkspace(sessionId, false)]);
  } catch (error) {
    state.planner.error = error.message || "Failed to create DAG proposal.";
  } finally {
    state.planner.proposalSaving = false;
    render();
  }
}

async function saveDurableProposalAssignments() {
  const sessionId = getActiveProposalSessionId();
  const proposalId = getActiveProposalId();
  if (!sessionId || !proposalId) {
    state.planner.error = "Load a durable DAG proposal before saving assignments.";
    render();
    return;
  }

  state.planner.proposalSaving = true;
  state.planner.error = null;
  state.error = null;
  state.notice = null;
  render();
  try {
    const response = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals/${encodeURIComponent(proposalId)}/assignments`,
      {
        method: "PATCH",
        body: JSON.stringify({ assignments: buildDurableProposalAssignments() }),
      },
    );
    applyDurableProposalToPlanner(response.proposal || null);
    state.notice = `Saved assignments for ${proposalId}.`;
    await loadSessionDagProposals(sessionId, false);
  } catch (error) {
    state.planner.error = error.message || "Failed to save proposal assignments.";
  } finally {
    state.planner.proposalSaving = false;
    render();
  }
}

async function confirmDurableProposal() {
  const sessionId = getActiveProposalSessionId();
  const proposalId = getActiveProposalId();
  if (!sessionId || !proposalId) {
    state.planner.error = "Load a durable DAG proposal before confirming it.";
    render();
    return;
  }

  state.planner.proposalConfirming = true;
  state.planner.error = null;
  state.error = null;
  state.notice = null;
  render();
  try {
    const assignments = buildDurableProposalAssignments();
    await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals/${encodeURIComponent(proposalId)}/assignments`,
      {
        method: "PATCH",
        body: JSON.stringify({ assignments }),
      },
    );
    const response = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals/${encodeURIComponent(proposalId)}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmed_by: "studio-operator" }),
      },
    );
    state.planner.confirmedProposalId = response.session?.confirmed_proposal_id || proposalId;
    applyDurableProposalToPlanner(response.proposal || null);
    state.notice = `Confirmed proposal ${proposalId}.`;
    await Promise.all([loadMissions(false), loadSessions(false), loadSessionWorkspace(sessionId, false)]);
  } catch (error) {
    state.planner.error = error.message || "Failed to confirm DAG proposal.";
  } finally {
    state.planner.proposalConfirming = false;
    render();
  }
}

async function launchConfirmedProposalRun() {
  const sessionId = getActiveProposalSessionId();
  const proposalId = getActiveProposalId();
  if (!sessionId || !proposalId) {
    state.planner.error = "Confirm or load a proposal before launching a run.";
    render();
    return;
  }

  state.proposalDispatching = true;
  state.planner.error = null;
  state.error = null;
  state.notice = null;
  render();
  try {
    const response = await request(`/api/sessions/${encodeURIComponent(sessionId)}/runs`, {
      method: "POST",
      body: JSON.stringify({
        proposal_id: proposalId,
        validation_mode: "warn",
      }),
    });
    state.notice = response.run_id
      ? `Launched run ${response.run_id} from proposal ${proposalId}.`
      : `Launched run from proposal ${proposalId}.`;
    await Promise.all([loadMissions(false), loadSessions(false), loadSessionWorkspace(sessionId, false)]);
  } catch (error) {
    state.planner.error = error.message || "Failed to launch proposal run.";
  } finally {
    state.proposalDispatching = false;
    render();
  }
}

async function applyCandidatePlanToDraft() {
  if (!state.planner.candidatePlan) {
    state.planner.error = "Generate a candidate plan first.";
    render();
    return;
  }

  if (
    !confirmPlannerAdoption({
      strategy: "candidate_run_preview",
      warningCount: state.planner.candidatePlan.validation?.warnings?.length || 0,
      targetLabel: "Copy preview into an editable draft.",
    })
  ) {
    return;
  }

  state.applyingPlan = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const templateId = state.planner.candidatePlan.candidate_plan.template_id;
    let sourceTemplate = state.templates.find((template) => template.template_id === templateId) || null;
    if (!sourceTemplate) {
      sourceTemplate = await request(`/api/templates/${encodeURIComponent(templateId)}`);
    }
    state.selectedId = null;
    state.editor = applyProposalOverridesToEditor(
      editorFromCandidatePlan(state.planner.candidatePlan, sourceTemplate),
    );
    state.notice = "Planner preview copied into an unsaved draft.";
  } catch (error) {
    state.error = error.message || "Failed to copy planner preview.";
  } finally {
    state.applyingPlan = false;
    render();
  }
}

async function applyDagDraftToEditor() {
  if (!state.planner.dagDraft) {
    state.planner.error = "Generate a DAG draft first.";
    render();
    return;
  }

  if (
    !confirmPlannerAdoption({
      strategy: state.planner.dagDraft.planner_context?.draft_strategy || "dag_draft",
      warningCount: state.planner.dagDraft.validation?.warnings?.length || 0,
      targetLabel: "Copy DAG draft into the editor for human review.",
    })
  ) {
    return;
  }

  state.applyingDagDraft = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    state.selectedId = null;
    state.editor = applyProposalOverridesToEditor(editorFromDagDraft(state.planner.dagDraft));
    state.notice = "Planner DAG draft copied into the editor for confirmation.";
  } catch (error) {
    state.error = error.message || "Failed to copy DAG draft.";
  } finally {
    state.applyingDagDraft = false;
    render();
  }
}

async function saveDagDraftAsTemplate() {
  if (!state.planner.dagDraft) {
    state.planner.error = "Generate a DAG draft first.";
    render();
    return;
  }

  if (
    !confirmPlannerAdoption({
      strategy: state.planner.dagDraft.planner_context?.draft_strategy || "dag_draft",
      warningCount: state.planner.dagDraft.validation?.warnings?.length || 0,
      targetLabel: "Save this planner DAG draft as a template draft.",
    })
  ) {
    return;
  }

  state.savingDagDraft = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const draftEditor = applyProposalOverridesToEditor(editorFromDagDraft(state.planner.dagDraft));
    const suffix = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "")
      .toLowerCase();
    const preferredId = state.planner.dagDraft.draft_template?.template_id || slugify(draftEditor.name);
    const saved = await createDraftTemplate(draftEditor, `${preferredId}-${suffix}`);
    state.notice = `Saved planner DAG draft ${saved.template_id}`;
    await loadTemplates(saved.template_id);
  } catch (error) {
    state.error = error.message || "Failed to save DAG draft.";
  } finally {
    state.savingDagDraft = false;
    render();
  }
}

async function saveCandidatePlanAsDraft() {
  if (!state.planner.candidatePlan) {
    state.planner.error = "Generate a candidate plan first.";
    render();
    return;
  }

  if (
    !confirmPlannerAdoption({
      strategy: "candidate_run_preview",
      warningCount: state.planner.candidatePlan.validation?.warnings?.length || 0,
      targetLabel: "Save this planner preview as a template draft.",
    })
  ) {
    return;
  }

  state.savingPlan = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const templateId = state.planner.candidatePlan.candidate_plan.template_id;
    let sourceTemplate = state.templates.find((template) => template.template_id === templateId) || null;
    if (!sourceTemplate) {
      sourceTemplate = await request(`/api/templates/${encodeURIComponent(templateId)}`);
    }

    const draftEditor = applyProposalOverridesToEditor(
      editorFromCandidatePlan(state.planner.candidatePlan, sourceTemplate),
    );
    const suffix = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "")
      .toLowerCase();
    const saved = await createDraftTemplate(
      draftEditor,
      `planner_${slugify(draftEditor.name)}_${suffix}`,
    );
    state.notice = `Saved planner draft ${saved.template_id}`;
    await loadTemplates(saved.template_id);
  } catch (error) {
    state.error = error.message || "Failed to save planner draft.";
  } finally {
    state.savingPlan = false;
    render();
  }
}

function updateEditor(patch) {
  state.editor = { ...state.editor, ...patch };
  render();
}

function updateAgentProfileEditor(patch) {
  state.registryEditor.profile = { ...state.registryEditor.profile, ...patch };
  render();
}

function updateSkillEditor(patch) {
  state.registryEditor.skill = { ...state.registryEditor.skill, ...patch };
  render();
}

function updateNode(index, patch) {
  state.editor.nodes = state.editor.nodes.map((node, nodeIndex) =>
    nodeIndex === index ? { ...node, ...patch } : node,
  );
  render();
}

function removeNode(index) {
  const node = state.editor.nodes[index];
  state.editor.nodes = state.editor.nodes.filter((_, nodeIndex) => nodeIndex !== index);
  state.editor.edges = state.editor.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
  render();
}

function addNode() {
  state.editor.nodes = [...state.editor.nodes, emptyNode(state.editor.nodes.length + 1)];
  render();
}

function addEdge() {
  state.editor.edges = [
    ...state.editor.edges,
    {
      from: state.editor.nodes[0]?.id || "",
      to: state.editor.nodes[1]?.id || state.editor.nodes[0]?.id || "",
      condition: null,
      label: null,
    },
  ];
  render();
}

function updateEdge(index, patch) {
  state.editor.edges = state.editor.edges.map((edge, edgeIndex) =>
    edgeIndex === index ? { ...edge, ...patch } : edge,
  );
  render();
}

function removeEdge(index) {
  state.editor.edges = state.editor.edges.filter((_, edgeIndex) => edgeIndex !== index);
  render();
}

function renderTemplateList() {
  return state.templates
    .map(
      (template) => `
        <button class="template-item ${template.template_id === state.selectedId ? "selected" : ""}" data-action="select-template" data-id="${escapeHtml(template.template_id)}">
          <span class="status-dot ${statusTone(template.status)}"></span>
          <span>
            <strong>${escapeHtml(template.name)}</strong>
            <small>${escapeHtml(template.template_id)}</small>
          </span>
        </button>
      `,
    )
    .join("");
}

function renderSessionInventoryControls(kind) {
  const isMission = kind === "missions";
  const query = isMission ? state.missionQuery : state.sessionQuery;
  const visibility = isMission ? state.missionVisibility : state.sessionVisibility;
  const selected = getSelectedSessionInventoryItem();
  const selectedArchived = selected?.archived === true;
  const canUpdateVisibility = !!state.selectedSessionId && !!selected;
  return `
    <div class="sidebar-filter-panel">
      <label>
        Search
        <input value="${escapeHtml(query)}" data-field="${isMission ? "mission.query" : "session.query"}" placeholder="Title, id, brief, output, run" />
      </label>
      <div class="sidebar-segment">
        ${["active", "archived"]
          .map(
            (item) => `
              <button class="mini-button ${visibility === item ? "selected" : ""}" data-action="${isMission ? "set-mission-visibility" : "set-session-visibility"}" data-visibility="${item}">
                ${item === "active" ? "Active" : "Archived"}
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="sidebar-filter-actions">
        <button class="mini-button" data-action="${isMission ? "search-missions" : "search-sessions"}">${isMission ? state.missionsLoading ? "..." : "Search" : state.sessionsLoading ? "..." : "Search"}</button>
        <button class="mini-button" data-action="${selectedArchived ? "unarchive-session" : "archive-session"}" ${!canUpdateVisibility || state.sessionVisibilitySaving ? "disabled" : ""}>
          ${state.sessionVisibilitySaving ? "Working..." : selectedArchived ? "Restore" : "Archive"}
        </button>
      </div>
    </div>
  `;
}

function renderMissionList() {
  if (!state.missions.length) {
    return `<p class="sidebar-muted">${
      state.missionVisibility === "archived"
        ? "No archived missions."
        : state.missionQuery.trim()
          ? "No missions match the current search."
          : "No missions yet."
    }</p>`;
  }
  return state.missions
    .map((mission) => {
      const labels = getMissionInventoryLabels(mission);
      return `
        <button class="template-item ${mission.session_id === state.selectedSessionId ? "selected" : ""}" data-action="select-session" data-id="${escapeHtml(mission.session_id)}" data-session-id="${escapeHtml(mission.session_id)}">
          <span class="status-dot ${statusTone(mission.status)}"></span>
          <span>
            <strong>${escapeHtml(labels.title)}</strong>
            <small>${escapeHtml(labels.subtitle)}</small>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderSessionList() {
  if (!state.sessions.length) {
    return `<p class="sidebar-muted">${
      state.sessionVisibility === "archived"
        ? "No archived sessions."
        : state.sessionQuery.trim()
          ? "No sessions match the current search."
          : "No sessions yet."
    }</p>`;
  }
  return state.sessions
    .map((session) => {
      const labels = getSessionInventoryLabels(session);
      return `
        <button class="template-item ${session.session_id === state.selectedSessionId ? "selected" : ""}" data-action="select-session" data-id="${escapeHtml(session.session_id)}" data-session-id="${escapeHtml(session.session_id)}">
          <span class="status-dot ${statusTone(session.status)}"></span>
          <span>
            <strong>${escapeHtml(labels.title)}</strong>
            <small>${escapeHtml(labels.subtitle)}</small>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderDesktopNav() {
  const items = [
    { id: "orchestrator", label: "Orchestrator" },
    { id: "missions", label: "Missions" },
    { id: "sessions", label: "Sessions" },
    { id: "agents", label: "Subagents" },
    { id: "templates", label: "Templates" },
    { id: "registry", label: "Registry" },
    { id: "settings", label: "Settings" },
  ];
  return `
    <nav class="desktop-nav">
      ${items
        .map(
          (item) => `
            <button class="desktop-nav-item ${state.activeNav === item.id ? "selected" : ""}" data-action="switch-nav" data-nav="${item.id}">
              <strong>${item.label}</strong>
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function renderAgentHostingSidebarList() {
  const hostedProfiles = state.runtimeSummary?.agent_hosting?.profiles || [];
  if (!hostedProfiles.length) {
    return '<p class="sidebar-muted">No hosted agents yet.</p>';
  }
  return hostedProfiles
    .map(
      (profile) => `
        <button class="template-item ${profile.profile_id === state.registryEditor.profile.profileId ? "selected" : ""}" data-action="edit-agent-profile-from-hosting" data-id="${escapeHtml(profile.profile_id)}">
          <span class="status-dot ${profile.health?.status === "ready" ? "success" : profile.health?.status === "disabled" ? "neutral" : "warn"}"></span>
          <span>
            <strong>${escapeHtml(profile.profile_id)}</strong>
            <small>${escapeHtml(profile.model || profile.openclaw_agent_id || profile.health?.status || "unbound")}</small>
          </span>
        </button>
      `,
    )
    .join("");
}

function renderMissionWorkspace() {
  const model = buildMissionWorkspaceViewModel(state.workspaceDetail);
  if (!model.ready) {
    return `
      <section class="panel desktop-empty-panel">
        <div class="panel-header">
          <div><h3>Mission Workspace</h3><p>Select a mission or session from the left rail.</p></div>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel desktop-workspace-panel">
      <div class="panel-header">
        <div>
          <h3>${escapeHtml(model.header.title)}</h3>
          <p>${escapeHtml(model.header.summary)}</p>
        </div>
        <span class="badge ${model.header.statusTone}">${escapeHtml(model.header.statusLabel)}</span>
      </div>
      ${renderMissionWorkspaceSectionGrid(model.workspaceSections)}
      <div class="mission-context-strip">
      <div class="mission-spec-band">
        <div class="mission-spec-copy">
          <span>MissionSpec</span>
          <strong>${escapeHtml(model.specBand.objective)}</strong>
          <p>${escapeHtml(model.specBand.sourceBrief)}</p>
        </div>
        <div class="mission-spec-route">
          <span class="badge ${model.routeTone}">${escapeHtml(model.routeLabel)}</span>
          <small>${escapeHtml(model.specBand.routeTemplate)}</small>
        </div>
      </div>
      <div class="workspace-summary-grid compact-workspace-summary">
        ${model.summaryStats
          .map(
            ([label, value]) => `
              <div class="summary-stat">
                <strong>${escapeHtml(label)}</strong>
                <p>${escapeHtml(value)}</p>
              </div>
            `,
          )
          .join("")}
      </div>
      </div>
      <div class="mission-primary-detail-grid">
        ${renderMissionWorkPackagesPanel(model.pipelines)}
        ${renderMissionCheckpointsPanel(model.detail, model.checkpoints)}
        ${renderMissionOutputsPanel(model.detail, model.outputs, model.requestedOutputs)}
      </div>
      ${renderMissionOutputHistoryPanel(model.detail)}
      ${renderMissionDeliveryTracePanel(model.detail)}
      ${renderMissionWorkspaceSupport(model.support)}
    </section>
  `;
}

function renderDesktopRail() {
  const rail = buildDesktopRailViewModel(state.workspaceDetail);
  const { detail, inspector, selectedCheckpoint, selectedOutput, feed, routeCompare, hasRuntimeContext } = rail;
  const visibleEvidenceItems = limitWorkspaceFeedItems(
    feed.evidenceItems,
    feed.itemLimit,
    feed.pinnedEntryKey,
    (item) => item.key,
  );
  const visibleOutputArtifacts = limitWorkspaceFeedItems(
    feed.artifacts.slice().reverse(),
    feed.itemLimit,
    feed.pinnedEntryKey,
    getArtifactWorkspaceFeedKey,
  );
  const patchFeed = feed.dagPatches.length
    ? feed.dagPatches
        .slice(-feed.itemLimit)
        .reverse()
        .map((patch) => {
          const outcomes = getPatchOperationOutcomes(patch);
          const topology = getPatchTopology(patch);
          const readyCount = Array.isArray(topology?.ready_node_run_ids)
            ? topology.ready_node_run_ids.length
            : 0;
          const runningCount = Array.isArray(topology?.running_node_run_ids)
            ? topology.running_node_run_ids.length
            : 0;
          return `
            <div class="rail-feed-item">
              <div class="patch-outcome-head">
                <strong>${escapeHtml(patch.summary || patch.patch_id || "Runtime patch")}</strong>
                <span class="badge ${patchStatusTone(patch.status)}">${escapeHtml(patch.status || "proposed")}</span>
              </div>
              <small>${escapeHtml(patch.patch_id || "patch")}</small>
              ${
                outcomes.length
                  ? `<div class="patch-outcome-list">
                      ${outcomes
                        .map(
                          (outcome) => `
                            <div class="patch-outcome-line">
                              <span class="badge ${outcome.applied ? "success" : "danger"}">${escapeHtml(outcome.applied ? "applied" : "failed")}</span>
                              <small>${escapeHtml(outcome.op || "operation")}${outcome.node_name ? ` / ${escapeHtml(outcome.node_name)}` : ""}${outcome.error ? ` / ${escapeHtml(outcome.error)}` : ""}</small>
                            </div>
                          `,
                        )
                        .join("")}
                    </div>`
                  : '<small>No operation outcomes yet.</small>'
              }
              ${
                topology
                  ? `<small>${escapeHtml(`Topology: ${topology.node_count ?? "-"} nodes / ${topology.edge_count ?? "-"} edges / ${readyCount} ready / ${runningCount} running`)}</small>`
                  : ""
              }
              ${renderPatchGraphPreview(patch)}
            </div>
          `;
        })
        .join("")
    : '<p class="muted">No runtime patches yet.</p>';

  return `
    <aside class="desktop-rail">
      <section class="panel rail-panel mission-inspector-panel">
        <div class="panel-header">
          <div><h3>Mission Inspector</h3><p>${escapeHtml(inspector.summary)}</p></div>
          <span class="badge ${inspector.statusClass}">${escapeHtml(inspector.statusLabel)}</span>
        </div>
        <div class="rail-kv-list">
          ${inspector.kv
            .map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`)
            .join("")}
        </div>
        <div class="rail-note">
          <strong>${escapeHtml(inspector.next.label)}</strong>
          <small>${escapeHtml(inspector.next.detail)}</small>
        </div>
        ${
          inspector.conversation
            ? `
              <div class="rail-contract-card">
                <strong>${escapeHtml(inspector.conversation.title || "Mission coordination")}</strong>
                <small>${escapeHtml(inspector.conversation.summary || "Conversation records intent, explanation, decisions, and audit context.")}</small>
                ${
                  Array.isArray(inspector.conversation.responsibilities) && inspector.conversation.responsibilities.length
                    ? `<div class="rail-contract-chip-list">${inspector.conversation.responsibilities
                        .map((item) => `<span class="badge neutral">${escapeHtml(formatWorkspaceLabel(item))}</span>`)
                        .join("")}</div>`
                    : ""
                }
                ${
                  inspector.conversation.latestDecision
                    ? `<small>${escapeHtml(`Decision: ${inspector.conversation.latestDecision}`)}</small>`
                    : ""
                }
              </div>
            `
            : ""
        }
        ${renderMissionInspectorSelectionHint(detail, selectedCheckpoint, selectedOutput)}
        ${
          selectedCheckpoint.checkpoint
            ? `
              <div class="rail-checkpoint-detail">
                <div class="subpanel-header">
                  <strong>${escapeHtml(selectedCheckpoint.checkpoint.label || selectedCheckpoint.checkpoint.key || "Checkpoint")}</strong>
                  <span class="badge ${statusTone(selectedCheckpoint.checkpoint.status || selectedCheckpoint.checkpoint.tone)}">${escapeHtml(selectedCheckpoint.checkpoint.status || "pending")}</span>
                </div>
                <p>${escapeHtml(selectedCheckpoint.checkpoint.detail || "Checkpoint detail is not available yet.")}</p>
                ${renderMissionEvidenceChips(selectedCheckpoint.evidence.evidence)}
                ${
                  selectedCheckpoint.evidence.lines.length
                    ? `<div class="rail-output-history-lines">${selectedCheckpoint.evidence.lines
                        .map((line) => `<small>${escapeHtml(line)}</small>`)
                        .join("")}</div>`
                    : ""
                }
                ${
                  selectedCheckpoint.targets.length
                    ? `<div class="rail-output-history-actions">
                        ${selectedCheckpoint.targets
                          .map(
                            (target) => `
                              <button type="button" class="mini-button" data-action="jump-checkpoint-target" data-target-type="${escapeHtml(target.targetType)}" data-nav="${escapeHtml(target.nav || "")}" data-focus="${escapeHtml(target.focus || "")}" data-feed-filter="${escapeHtml(target.feedFilter || "")}">
                                ${escapeHtml(target.label)}
                              </button>
                            `,
                          )
                          .join("")}
                      </div>`
                    : renderRailEmptyCallout(
                        "No linked jump target",
                        "This checkpoint has evidence lines only; no approvals, returned outputs, runtime graph, route compare, or patches are attached.",
                      )
                }
              </div>
            `
            : ""
        }
        ${
          selectedOutput.history
            ? `
              <div class="rail-output-history-detail">
                <div class="subpanel-header">
                  <strong>${escapeHtml(selectedOutput.history.title)}</strong>
                  <span class="badge ${selectedOutput.history.count > 1 ? "warn" : "success"}">${escapeHtml(`${selectedOutput.history.count} version${selectedOutput.history.count === 1 ? "" : "s"}`)}</span>
                </div>
                ${
                  selectedOutput.delta
                    ? `
                      <div class="rail-output-history-summary">
                        <span class="badge ${selectedOutput.delta.tone}">${escapeHtml(selectedOutput.delta.summary)}</span>
                        ${
                          selectedOutput.delta.chips.length
                            ? `<div class="skill-chip-list">${selectedOutput.delta.chips
                                .map((chip) => `<span class="skill-chip ${chip.tone}">${escapeHtml(chip.label)}</span>`)
                                .join("")}</div>`
                            : ""
                        }
                        ${
                          selectedOutput.delta.lines.length
                            ? `<div class="rail-output-history-lines">${selectedOutput.delta.lines
                                .map((line) => `<small>${escapeHtml(line)}</small>`)
                                .join("")}</div>`
                            : ""
                        }
                        ${
                          selectedOutput.artifacts.length
                            ? `<div class="rail-output-history-actions">
                                ${selectedOutput.artifacts
                                  .slice(0, 2)
                                  .map(
                                    (target, index) => `
                                      <button type="button" class="mini-button" data-action="jump-output-artifact" data-feed-filter="outputs" data-artifact-key="${escapeHtml(target.artifactKey)}" data-feed-entry-key="${escapeHtml(target.entryKey)}" data-output-history-key="${escapeHtml(selectedOutput.history.key)}">
                                        ${escapeHtml(index === 0 ? "Open current artifact" : "Open prior artifact")}
                                      </button>
                                    `,
                                  )
                                  .join("")}
                              </div>`
                            : renderRailEmptyCallout(
                                "No returned output target",
                                "This history is recorded in evidence, but no returned output row matches its artifact name or URI.",
                              )
                        }
                      </div>
                    `
                    : ""
                }
                <div class="rail-output-history-stack">
                  ${
                    selectedOutput.history.historyEntries.length
                      ? selectedOutput.history.historyEntries
                          .slice(0, 6)
                          .map(
                            (entry) => `
                              <button type="button" class="rail-feed-item rail-feed-jump-button" data-action="jump-output-history-entry" data-feed-filter="evidence" data-feed-entry-key="${escapeHtml(entry.key)}">
                                <strong>${escapeHtml(entry.artifactTitle)}</strong>
                                <small>${escapeHtml(entry.routeLabel || "Route unknown")}</small>
                                <small>${escapeHtml(entry.artifactDetail)}</small>
                                ${
                                  entry.runId
                                    ? `<small>${escapeHtml(`Run: ${entry.runId}`)}</small>`
                                    : ""
                                }
                                ${
                                  entry.nodeRunId
                                    ? `<small>${escapeHtml(`Node run: ${entry.nodeRunId}`)}</small>`
                                    : ""
                                }
                              </button>
                            `,
                          )
                          .join("")
                      : renderRailEmptyCallout(
                          "No artifact history recorded",
                          "The requested output is tracked, but no artifact card has been recorded for it yet.",
                        )
                  }
                </div>
              </div>
            `
            : ""
        }
      </section>
      ${
        routeCompare || hasRuntimeContext
          ? `
            <section class="panel rail-panel operational-context-panel">
              <div class="panel-header">
                <div><h3>Operational Context</h3><p>Route comparison and runtime topology stay secondary to the mission surfaces.</p></div>
              </div>
              ${routeCompare ? renderRouteComparePanel(routeCompare) : ""}
              ${hasRuntimeContext ? renderRuntimeGraphPanel(detail?.runtime_graph || null) : ""}
            </section>
          `
          : ""
      }
      <section class="panel rail-panel" data-workspace-focus="workspace-feed">
        <div class="panel-header">
          <div><h3>${escapeHtml(feed.title)}</h3><p>${escapeHtml(feed.summary)}</p></div>
          <span class="badge neutral">${escapeHtml(String(feed.totalCount))}</span>
        </div>
        ${
          feed.rawCardPolicy
            ? `
              <div class="rail-contract-card compact">
                <strong>${escapeHtml(feed.rawCardPolicy.defaultState === "collapsed" ? "Collapsed audit cards" : "Audit cards")}</strong>
                <small>${escapeHtml(feed.rawCardPolicy.summary || "Raw cards stay secondary to the mission workspace.")}</small>
                <div class="rail-contract-chip-list">
                  <span class="badge neutral">${escapeHtml(formatWorkspaceLabel(feed.rawCardPolicy.role || "secondary_audit"))}</span>
                  <span class="badge neutral">${escapeHtml(`${feed.rawCardPolicy.hiddenFromConversationCount || 0} raw`)}</span>
                  <span class="badge neutral">${escapeHtml(`${feed.rawCardPolicy.foldedPlanningRevisionCount || 0} folded`)}</span>
                </div>
              </div>
            `
            : ""
        }
        <div class="rail-feed-toolbar">
          <div class="rail-feed-filter" role="tablist" aria-label="Workspace feed filter">
          ${feed.filters
            .map(
              ([key, label, count]) => `
                <button class="mini-button ${feed.filter === key ? "selected" : ""}" data-action="set-workspace-feed-filter" data-filter="${escapeHtml(key)}">
                  ${escapeHtml(label)} ${escapeHtml(String(count))}
                </button>
              `,
            )
            .join("")}
          </div>
          <button class="mini-button ${feed.expanded ? "selected" : ""}" data-action="toggle-workspace-feed-expanded">
            ${feed.expanded ? "Expanded" : "Compact"}
          </button>
        </div>
        ${
          feed.showSection("evidence")
            ? `<div class="rail-feed-heading">Evidence</div>
              <div class="rail-feed">
                ${visibleEvidenceItems
                  .map(
                    (item) => `
                      <div class="rail-feed-item" data-workspace-feed-entry-key="${escapeHtml(item.key)}">
                        <strong>${escapeHtml(item.title)}</strong>
                        <small>${escapeHtml(item.detail)}</small>
                        ${item.meta.map((line) => `<small>${escapeHtml(line)}</small>`).join("")}
                        <small>${escapeHtml(formatWorkspaceTimestamp(item.createdAt))}</small>
                      </div>
                    `,
                  )
                  .join("") || '<p class="muted">No evidence yet.</p>'}
              </div>`
            : ""
        }
        ${
          feed.showSection("context")
            ? `<div class="rail-feed-heading">Context</div>
              ${renderAttachmentContextPanel(feed.attachments)}`
            : ""
        }
        ${
          feed.showSection("outputs")
            ? `<div class="rail-feed-heading">Returned Outputs</div>
              <div class="rail-feed">
                ${
                  feed.artifacts.length
                    ? visibleOutputArtifacts
                        .map(
                          (artifact) => `
                            <div class="rail-feed-item" data-workspace-feed-entry-key="${escapeHtml(getArtifactWorkspaceFeedKey(artifact))}">
                              <strong>${escapeHtml(artifact.name || artifact.kind || artifact.artifact_id || "artifact")}</strong>
                              <small>${escapeHtml(artifact.storage_uri || artifact.summary || artifact.path || "Generated output")}</small>
                            </div>
                          `,
                        )
                        .join("")
                    : '<p class="muted">No returned outputs yet.</p>'
                }
              </div>`
            : ""
        }
        ${
          feed.showSection("patches")
            ? `<div class="rail-feed-heading">Runtime Patches</div>
              <div class="rail-feed">${patchFeed}</div>`
            : ""
        }
      </section>
    </aside>
  `;
}

function renderRegistryPanel() {
  const activeProfiles = state.agentProfiles.filter((profile) => profile.status === "active");
  const activeSkills = state.skills.filter((skill) => skill.status === "active");

  return `
    <div class="sidebar-panel">
      <div class="sidebar-panel-header">
        <strong>Agent Registry</strong>
        <button class="mini-button" data-action="refresh-registry">${state.registryLoading ? "..." : "Ref"}</button>
      </div>
      ${
        activeProfiles.length
          ? activeProfiles
              .slice(0, 6)
              .map(
                (profile) => `
                  <div class="registry-item">
                    <strong>${escapeHtml(profile.profile_id)}</strong>
                    <small>${escapeHtml(profile.openclaw_agent_id)} / ${escapeHtml((profile.default_skills || []).join(", ") || "no-skills")}</small>
                  </div>
                `,
              )
              .join("")
          : '<p class="sidebar-muted">No active profiles.</p>'
      }
      <div class="sidebar-panel-header slim"><strong>Skills</strong><span>${activeSkills.length}</span></div>
      <div class="skill-chip-list">
        ${
          activeSkills.length
            ? activeSkills
                .slice(0, 10)
                .map((skill) => `<span class="skill-chip">${escapeHtml(skill.skill_id)}</span>`)
                .join("")
            : '<span class="skill-chip muted">none</span>'
        }
      </div>
    </div>
  `;
}

function renderLineagePanel(readOnly) {
  if (!state.lineage || !state.lineage.items?.length) {
    return "";
  }
  return `
    <section class="panel lineage-panel">
      <div class="panel-header">
        <div><h3>Template Lineage</h3><p>${escapeHtml(state.lineage.family_id)} / ${state.lineage.items.length} item(s)</p></div>
      </div>
      <div class="lineage-list">
        ${state.lineage.items
          .map(
            (item) => `
              <button class="lineage-item ${item.template_id === state.editor.templateId ? "selected" : ""}" data-action="select-template" data-id="${escapeHtml(item.template_id)}">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="badge ${statusTone(item.status)}">${escapeHtml(item.status)} v${item.version}</span>
                <small>${escapeHtml(item.template_id)} / ${escapeHtml(item.versioning.derivation_kind)}</small>
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="lineage-actions">
        <button class="secondary" data-action="derive-template" ${state.deriving || !state.editor.templateId || state.editor.status === "archived" ? "disabled" : ""}>${state.deriving ? "Deriving..." : "Derive variant"}</button>
        <button class="secondary" data-action="new-template-version" ${state.versioning || state.editor.status !== "published" ? "disabled" : ""}>${state.versioning ? "Creating..." : "New version"}</button>
        <button class="secondary danger-action" data-action="archive-template" ${state.archiving || !state.editor.templateId || state.editor.status === "archived" || readOnly && state.editor.status !== "published" ? "disabled" : ""}>${state.archiving ? "Archiving..." : "Archive"}</button>
      </div>
    </section>
  `;
}

function renderAgentProfileManager() {
  const editor = state.registryEditor.profile;
  const selectedId = editor.profileId;
  return `
    <div class="registry-manager-column">
      <div class="registry-manager-header">
        <div>
          <h4>Agent Profiles</h4>
          <p>${state.agentProfiles.length} profile(s)</p>
        </div>
        <button class="mini-button" data-action="new-agent-profile">New</button>
      </div>
      <div class="registry-record-list">
        ${
          state.agentProfiles.length
            ? state.agentProfiles
                .map(
                  (profile) => `
                    <button class="registry-record ${profile.profile_id === selectedId ? "selected" : ""}" data-action="edit-agent-profile" data-id="${escapeHtml(profile.profile_id)}">
                      <span>
                        <strong>${escapeHtml(profile.profile_id)}</strong>
                        <small>${escapeHtml(profile.openclaw_agent_id || "unbound")} / ${escapeHtml((profile.default_skills || []).join(", ") || "no-skills")}</small>
                      </span>
                      <span class="badge ${profile.status === "active" ? "success" : "neutral"}">${escapeHtml(profile.status)}</span>
                    </button>
                  `,
                )
                .join("")
            : '<p class="muted">No agent profiles yet.</p>'
        }
      </div>
      <div class="registry-form">
        <div class="form-grid compact">
          <label>ID<input value="${escapeHtml(editor.profileId)}" data-field="agent.profileId" ${editor.mode === "edit" ? "disabled" : ""} /></label>
          <label>Status
            <select data-field="agent.status">
              <option value="active" ${editor.status === "active" ? "selected" : ""}>active</option>
              <option value="disabled" ${editor.status === "disabled" ? "selected" : ""}>disabled</option>
            </select>
          </label>
          <label>Name<input value="${escapeHtml(editor.name)}" data-field="agent.name" /></label>
          <label>OpenClaw agent<input value="${escapeHtml(editor.openclawAgentId)}" data-field="agent.openclawAgentId" /></label>
          <label>OpenClaw provider<input value="${escapeHtml(editor.openclawProvider)}" data-field="agent.openclawProvider" placeholder="openai / anthropic / custom" /></label>
          <label>OpenClaw model<input value="${escapeHtml(editor.openclawModel)}" data-field="agent.openclawModel" placeholder="runtime model id" /></label>
          <label>Runtime mode<input value="${escapeHtml(editor.openclawRuntimeMode)}" data-field="agent.openclawRuntimeMode" placeholder="native-agent / bridge / custom" /></label>
          <label class="span-2">Description<textarea rows="2" data-field="agent.description">${escapeHtml(editor.description)}</textarea></label>
          <label>Default skills<input value="${escapeHtml(editor.defaultSkillsText)}" list="skill-options" data-field="agent.defaultSkillsText" /></label>
          <label>Disallowed skills<input value="${escapeHtml(editor.disallowedSkillsText)}" list="skill-options" data-field="agent.disallowedSkillsText" /></label>
          <label>Allowed tools<input value="${escapeHtml(editor.allowedToolsText)}" data-field="agent.allowedToolsText" /></label>
          <label>Policy tags<input value="${escapeHtml(editor.policyTagsText)}" data-field="agent.policyTagsText" /></label>
          <label class="span-2">Metadata JSON<textarea class="code" rows="4" data-field="agent.metadataText">${escapeHtml(editor.metadataText)}</textarea></label>
        </div>
        <div class="registry-actions">
          <button class="primary" data-action="save-agent-profile" ${state.registrySaving ? "disabled" : ""}>${state.registrySaving ? "Saving..." : "Save profile"}</button>
          <button class="secondary danger-action" data-action="disable-agent-profile" ${state.registryDisabling || editor.mode !== "edit" || editor.status === "disabled" ? "disabled" : ""}>${state.registryDisabling ? "Disabling..." : "Disable"}</button>
        </div>
      </div>
    </div>
  `;
}

function renderSkillManager() {
  const editor = state.registryEditor.skill;
  const selectedId = editor.skillId;
  return `
    <div class="registry-manager-column">
      <div class="registry-manager-header">
        <div>
          <h4>Skills</h4>
          <p>${state.skills.length} skill(s)</p>
        </div>
        <button class="mini-button" data-action="new-skill">New</button>
      </div>
      <div class="registry-record-list">
        ${
          state.skills.length
            ? state.skills
                .map(
                  (skill) => `
                    <button class="registry-record ${skill.skill_id === selectedId ? "selected" : ""}" data-action="edit-skill" data-id="${escapeHtml(skill.skill_id)}">
                      <span>
                        <strong>${escapeHtml(skill.skill_id)}</strong>
                        <small>${escapeHtml(skill.category || "general")} / ${escapeHtml((skill.allowed_tools || []).join(", ") || "no-tools")}</small>
                      </span>
                      <span class="badge ${skill.status === "active" ? "success" : "neutral"}">${escapeHtml(skill.status)}</span>
                    </button>
                  `,
                )
                .join("")
            : '<p class="muted">No skills yet.</p>'
        }
      </div>
      <div class="registry-form">
        <div class="form-grid compact">
          <label>ID<input value="${escapeHtml(editor.skillId)}" data-field="skill.skillId" ${editor.mode === "edit" ? "disabled" : ""} /></label>
          <label>Status
            <select data-field="skill.status">
              <option value="active" ${editor.status === "active" ? "selected" : ""}>active</option>
              <option value="disabled" ${editor.status === "disabled" ? "selected" : ""}>disabled</option>
            </select>
          </label>
          <label>Name<input value="${escapeHtml(editor.name)}" data-field="skill.name" /></label>
          <label>Category<input value="${escapeHtml(editor.category)}" data-field="skill.category" /></label>
          <label class="span-2">Description<textarea rows="2" data-field="skill.description">${escapeHtml(editor.description)}</textarea></label>
          <label>Allowed tools<input value="${escapeHtml(editor.allowedToolsText)}" data-field="skill.allowedToolsText" /></label>
          <label>Tags<input value="${escapeHtml(editor.tagsText)}" data-field="skill.tagsText" /></label>
          <label class="span-2">Input schema JSON<textarea class="code" rows="4" data-field="skill.inputSchemaText">${escapeHtml(editor.inputSchemaText)}</textarea></label>
          <label class="span-2">Output contract JSON<textarea class="code" rows="4" data-field="skill.outputContractText">${escapeHtml(editor.outputContractText)}</textarea></label>
          <label class="span-2">Metadata JSON<textarea class="code" rows="4" data-field="skill.metadataText">${escapeHtml(editor.metadataText)}</textarea></label>
        </div>
        <div class="registry-actions">
          <button class="primary" data-action="save-skill" ${state.registrySaving ? "disabled" : ""}>${state.registrySaving ? "Saving..." : "Save skill"}</button>
          <button class="secondary danger-action" data-action="disable-skill" ${state.registryDisabling || editor.mode !== "edit" || editor.status === "disabled" ? "disabled" : ""}>${state.registryDisabling ? "Disabling..." : "Disable"}</button>
        </div>
      </div>
    </div>
  `;
}

function renderRegistryManagerPanel() {
  return `
    <section class="panel registry-manager-panel">
      <div class="panel-header">
        <div><h3>Registry Manager</h3><p>Configure reusable agents and skills for DAG nodes.</p></div>
        <button class="secondary" data-action="refresh-registry" ${state.registryLoading ? "disabled" : ""}>${state.registryLoading ? "Refreshing..." : "Refresh"}</button>
      </div>
      <div class="registry-manager-grid">
        ${renderAgentProfileManager()}
        ${renderSkillManager()}
      </div>
    </section>
  `;
}

function renderPlannerCandidate(candidate) {
  const selected = candidate.template_id === state.planner.templateId;
  return `
    <button class="planner-candidate ${selected ? "selected" : ""}" data-action="select-planner-template" data-id="${escapeHtml(candidate.template_id)}">
      <span>
        <strong>${escapeHtml(candidate.name)}</strong>
        <small>${escapeHtml(candidate.template_id)}</small>
      </span>
      <span class="badge ${candidate.score > 0 ? "success" : "warn"}">${candidate.score.toFixed(2)}</span>
    </button>
  `;
}

function renderRegistryRecommendation(recommendation, index) {
  return `
    <div class="mini-node">
      <strong>${index + 1}. ${escapeHtml(recommendation.node_name)}</strong>
      <small>Agent: ${escapeHtml(recommendation.agent_profile_id || "needs assignment")}</small>
      <small>OpenClaw: ${escapeHtml(recommendation.openclaw_agent_id || "unbound")}</small>
      <small>Skills: ${escapeHtml((recommendation.skill_ids || []).join(", ") || "none")}</small>
      <small>Score ${Number(recommendation.score || 0).toFixed(2)} / ${escapeHtml(recommendation.reason || "No reason")}</small>
      ${
        recommendation.warnings?.length
          ? `<ul class="warning-list compact">${recommendation.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
          : ""
      }
    </div>
  `;
}

function groupValidationWarnings(validation) {
  const details = Array.isArray(validation?.details) ? validation.details : [];
  if (details.length === 0) {
    const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
    return warnings.length
      ? [
          {
            key: "other",
            title: "Other checks",
            tone: "warn",
            items: warnings,
          },
        ]
      : [];
  }

  const groups = [
    { key: "required_input", title: "Required input", tone: "danger", items: [] },
    { key: "registry", title: "Registry binding", tone: "warn", items: [] },
    { key: "graph", title: "Workflow graph", tone: "warn", items: [] },
    { key: "other", title: "Other checks", tone: "warn", items: [] },
  ];

  for (const detail of details) {
    const group = groups.find((item) => item.key === detail.category) || groups[3];
    group.items.push(detail.message);
  }

  return groups.filter((group) => group.items.length > 0);
}

function renderValidationGroups(validation, emptyText) {
  const groups = groupValidationWarnings(validation);
  if (groups.length === 0) {
    return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  }

  return `<div class="validation-group-list">
    ${groups
      .map(
        (group) => `
          <div class="validation-group">
            <div class="validation-group-header">
              <strong>${escapeHtml(group.title)}</strong>
              <span class="badge ${group.tone}">${group.items.length}</span>
            </div>
            <ul class="warning-list compact">${group.items.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
          </div>
        `,
      )
      .join("")}
  </div>`;
}

function plannerValidationBadge(validation) {
  const groups = groupValidationWarnings(validation);
  if (groups.length === 0) {
    return { label: "valid", tone: "success" };
  }
  if (groups.some((group) => group.key === "required_input")) {
    return { label: "missing input", tone: "danger" };
  }
  return { label: "warnings", tone: "warn" };
}

function confirmPlannerAdoption(options) {
  const summary = [];
  if (options.strategy) {
    summary.push(`Strategy: ${options.strategy}`);
  }
  summary.push(`Warnings: ${options.warningCount}`);
  summary.push(options.targetLabel);
  return window.confirm(`Adopt planner output?\n\n${summary.join("\n")}`);
}

function renderPlannerPanel() {
  const recommendation = state.planner.recommendation;
  const candidatePlan = state.planner.candidatePlan;
  const dagDraft = state.planner.dagDraft;
  const candidateNodes = candidatePlan?.candidate_plan?.compiled_nodes || [];
  const readyCount = candidatePlan?.candidate_plan?.frontier?.length || 0;
  const candidateBadge = plannerValidationBadge(candidatePlan?.validation || null);
  const dagBadge = plannerValidationBadge(dagDraft?.validation || null);
  const dagNodes = dagDraft?.draft_template?.nodes || [];
  const dagRecommendations = dagDraft?.registry_recommendations || [];

  return `
    <section class="panel planner-panel">
      <div class="panel-header">
        <div>
          <h3>Plan from intent</h3>
          <p>Fill the task intent first. Generate a DAG draft, then copy or save it for human review.</p>
        </div>
      </div>
      <div class="workflow-steps">
        <div class="workflow-step active"><strong>1</strong><span>Describe task</span></div>
        <div class="workflow-step ${dagDraft || candidatePlan ? "active" : ""}"><strong>2</strong><span>Generate draft</span></div>
        <div class="workflow-step ${state.editor.status === "new" || state.editor.status === "draft" ? "active" : ""}"><strong>3</strong><span>Confirm template</span></div>
      </div>
      <div class="planner-grid">
        <label>Intent<textarea rows="4" data-field="planner.intent" placeholder="Describe the business task">${escapeHtml(state.planner.intent)}</textarea></label>
        <div class="planner-input-stack">
          <label>Inputs JSON<textarea class="code" rows="4" data-field="planner.inputsText">${escapeHtml(state.planner.inputsText)}</textarea></label>
          <label>Max agent nodes<input type="number" min="1" max="6" data-field="planner.maxAgentNodes" value="${escapeHtml(state.planner.maxAgentNodes)}" /></label>
        </div>
      </div>
      <div class="planner-action-groups">
        <div class="planner-action-group">
          <strong>Generate</strong>
          <div class="planner-actions">
            <button class="primary" data-action="generate-dag-draft" ${state.planning ? "disabled" : ""}>${state.planning ? "Generating..." : "Generate DAG draft"}</button>
            <button class="secondary" data-action="plan-intent" ${state.planning ? "disabled" : ""}>${state.planning ? "Planning..." : "Recommend template"}</button>
            <button class="secondary" data-action="refresh-plan-preview" ${state.planning || !state.planner.templateId ? "disabled" : ""}>${state.planning ? "Planning..." : "Refresh run preview"}</button>
          </div>
        </div>
        <div class="planner-action-group">
          <strong>Confirm</strong>
          <div class="planner-actions">
            <button class="primary" data-action="apply-dag-draft" ${state.applyingDagDraft || !dagDraft ? "disabled" : ""}>${state.applyingDagDraft ? "Copying..." : "Copy DAG draft"}</button>
            <button class="secondary" data-action="save-dag-draft" ${state.savingDagDraft || !dagDraft ? "disabled" : ""}>${state.savingDagDraft ? "Saving..." : "Save DAG draft"}</button>
            <button class="secondary" data-action="apply-plan-draft" ${state.applyingPlan || !candidatePlan ? "disabled" : ""}>${state.applyingPlan ? "Copying..." : "Copy run preview"}</button>
          </div>
        </div>
      </div>
      <p class="planner-hint">Planner DAG drafts are not published automatically; copy or save them, then review and publish manually.</p>
      ${state.planner.error ? `<div class="alert danger inline-alert">${escapeHtml(state.planner.error)}</div>` : ""}
      ${
        recommendation || dagDraft
          ? `<div class="planner-results">
              <div>
                <h4>Template candidates</h4>
                ${
                  recommendation
                    ? `<div class="planner-candidate-list">${recommendation.candidates.map(renderPlannerCandidate).join("")}</div>`
                    : '<p class="muted">No template candidate; registry synthesis will be used.</p>'
                }
              </div>
              <div class="plan-summary">
                 <div class="summary-row">
                   <strong>${escapeHtml(candidatePlan?.candidate_plan?.template_id || dagDraft?.draft_template?.template_id || recommendation?.selected_template?.template_id || "planner")}</strong>
                   ${
                     candidatePlan
                       ? `<span class="badge ${candidateBadge.tone}">${candidateBadge.label}</span>`
                       : ""
                   }
                 </div>
                 ${
                   candidatePlan
                     ? `<p>${candidateNodes.length} node(s), ${readyCount} ready frontier node(s)</p>
                       ${renderValidationGroups(candidatePlan.validation, "No planner warnings.")}
                       <div class="mini-node-list">
                          ${candidateNodes
                            .slice(0, 5)
                           .map(
                             (node, index) => `
                               <div class="mini-node">
                                 <strong>${index + 1}. ${escapeHtml(node.name)}</strong>
                                 <small>${escapeHtml(node.type)} / ${escapeHtml(node.status)} / ${escapeHtml(node.agent_profile || "no-agent")}</small>
                                 <small>OpenClaw: ${escapeHtml(node.openclaw_agent_id || "unbound")}</small>
                                 <small>Skills: ${escapeHtml((node.allowed_skills || []).join(", ") || "none")}</small>
                                 <small>Source: ${escapeHtml(node.registry_provenance?.agent_profile_source || "unknown")} / OpenClaw ${escapeHtml(node.registry_provenance?.openclaw_agent_id_source || "unknown")}</small>
                               </div>
                             `,
                           )
                           .join("")}
                       </div>`
                    : '<p class="muted">No candidate plan yet.</p>'
                }
              </div>
              <div class="plan-summary">
                 <div class="summary-row">
                   <strong>${escapeHtml(dagDraft?.draft_template?.name || "DAG draft")}</strong>
                   ${
                     dagDraft
                       ? `<span class="badge ${dagBadge.tone}">${escapeHtml(dagDraft.planner_context.draft_strategy)} / ${dagBadge.label}</span>`
                       : ""
                   }
                 </div>
                 ${
                   dagDraft
                     ? `<p>${dagNodes.length} template node(s), ${dagRecommendations.length} registry recommendation(s)</p>
                       ${renderValidationGroups(dagDraft.validation, "No DAG draft warnings.")}
                       <div class="mini-node-list">
                          ${dagRecommendations.map(renderRegistryRecommendation).join("")}
                        </div>`
                    : '<p class="muted">No DAG draft yet.</p>'
                }
              </div>
            </div>`
          : '<p class="muted">Enter an intent and generate a planner preview.</p>'
      }
    </section>
  `;
}

function renderNode(node, index, readOnly) {
  const skills = node.allowed_skills.join(", ");
  const config = prettyJson(node.config);
  const humanInput = node.human_input_schema ? prettyJson(node.human_input_schema) : "";
  return `
    <article class="node-card">
      <div class="node-card-header">
        <strong>${escapeHtml(node.id || `node_${index + 1}`)}</strong>
        <button class="icon-button danger" data-action="remove-node" data-index="${index}" ${readOnly ? "disabled" : ""}>Del</button>
      </div>
      <div class="form-grid compact">
        <label>ID<input value="${escapeHtml(node.id)}" data-field="node.id" data-index="${index}" ${readOnly ? "disabled" : ""} /></label>
        <label>Type
          <select data-field="node.type" data-index="${index}" ${readOnly ? "disabled" : ""}>
            ${NODE_TYPES.map((type) => `<option value="${type}" ${node.type === type ? "selected" : ""}>${type}</option>`).join("")}
          </select>
        </label>
        <label>Name<input value="${escapeHtml(node.name)}" data-field="node.name" data-index="${index}" ${readOnly ? "disabled" : ""} /></label>
        <label>Agent<input value="${escapeHtml(node.agent_profile || "")}" list="agent-profile-options" data-field="node.agent_profile" data-index="${index}" ${readOnly || node.type === "end" ? "disabled" : ""} /></label>
        <label>Skills<input value="${escapeHtml(skills)}" list="skill-options" data-field="node.allowed_skills" data-index="${index}" ${readOnly ? "disabled" : ""} /></label>
        <label>Approval
          <select data-field="node.approval_kind" data-index="${index}" ${readOnly ? "disabled" : ""}>
            <option value="">none</option>
            ${APPROVAL_KINDS.map((kind) => `<option value="${kind}" ${node.approval_kind === kind ? "selected" : ""}>${kind}</option>`).join("")}
          </select>
        </label>
        <label>Attempts<input type="number" min="0" value="${node.retry_policy.max_attempts}" data-field="node.retry_policy.max_attempts" data-index="${index}" ${readOnly ? "disabled" : ""} /></label>
        <label>Backoff<input type="number" min="0" value="${node.retry_policy.backoff_seconds}" data-field="node.retry_policy.backoff_seconds" data-index="${index}" ${readOnly ? "disabled" : ""} /></label>
        <label>Timeout<input type="number" min="1" value="${node.timeout_seconds}" data-field="node.timeout_seconds" data-index="${index}" ${readOnly ? "disabled" : ""} /></label>
        <label>Parallelism<input type="number" min="1" value="${node.parallelism}" data-field="node.parallelism" data-index="${index}" ${readOnly ? "disabled" : ""} /></label>
        <label class="span-2">Config JSON<textarea class="code" rows="5" data-field="node.config" data-index="${index}" ${readOnly ? "disabled" : ""}>${escapeHtml(config)}</textarea></label>
        <label class="span-2">Human input schema<textarea class="code" rows="4" data-field="node.human_input_schema" data-index="${index}" ${readOnly ? "disabled" : ""}>${escapeHtml(humanInput)}</textarea></label>
      </div>
    </article>
  `;
}

function renderEdge(edge, index, readOnly) {
  const options = state.editor.nodes
    .map((node) => `<option value="${escapeHtml(node.id)}" ${edge.from === node.id ? "selected" : ""}>${escapeHtml(node.id)}</option>`)
    .join("");
  const toOptions = state.editor.nodes
    .map((node) => `<option value="${escapeHtml(node.id)}" ${edge.to === node.id ? "selected" : ""}>${escapeHtml(node.id)}</option>`)
    .join("");
  return `
    <article class="edge-card">
      <select data-field="edge.from" data-index="${index}" ${readOnly ? "disabled" : ""}>${options}</select>
      <span>to</span>
      <select data-field="edge.to" data-index="${index}" ${readOnly ? "disabled" : ""}>${toOptions}</select>
      <input value="${escapeHtml(edge.label || "")}" placeholder="Label" data-field="edge.label" data-index="${index}" ${readOnly ? "disabled" : ""} />
      <button class="icon-button danger" data-action="remove-edge" data-index="${index}" ${readOnly ? "disabled" : ""}>Del</button>
    </article>
  `;
}

function renderViewTabs() {
  const tabs = [
    { id: "plan", label: "Plan", description: "Intent to DAG draft" },
    { id: "template", label: "Template", description: "Basics and policy" },
    { id: "dag", label: "DAG", description: "Nodes and edges" },
    { id: "registry", label: "Registry", description: "Agents and skills" },
    { id: "review", label: "Review", description: "Validate and publish" },
  ];
  return `
    <nav class="view-tabs" aria-label="Workspace sections">
      ${tabs
        .map(
          (tab) => `
            <button class="view-tab ${state.activeView === tab.id ? "selected" : ""}" data-action="switch-view" data-view="${tab.id}">
              <strong>${tab.label}</strong>
              <small>${tab.description}</small>
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function renderTemplateBasicsPanel(readOnly) {
  return `
    <section class="panel editor-panel">
      <div class="panel-header">
        <div><h3>Template basics</h3><p>Name, description, workspace, schema, policy, and metadata.</p></div>
      </div>
      <div class="form-grid">
        <label>Name<input value="${escapeHtml(state.editor.name)}" data-field="template.name" ${readOnly ? "disabled" : ""} /></label>
        <label>Workspace<input value="${escapeHtml(state.editor.workspaceScope)}" data-field="template.workspaceScope" ${readOnly ? "disabled" : ""} /></label>
        <label class="span-2">Description<textarea rows="3" data-field="template.description" ${readOnly ? "disabled" : ""}>${escapeHtml(state.editor.description)}</textarea></label>
      </div>
    </section>
    <section class="panel json-panel wide-panel">
      <div class="panel-header"><h3>Schema & policy</h3></div>
      <div class="json-edit-grid">
        <label>Input schema<textarea class="code" rows="12" data-field="template.inputSchemaText" ${readOnly ? "disabled" : ""}>${escapeHtml(state.editor.inputSchemaText)}</textarea></label>
        <label>Policy<textarea class="code" rows="12" data-field="template.policyText" ${readOnly ? "disabled" : ""}>${escapeHtml(state.editor.policyText)}</textarea></label>
        <label>Agent bindings<textarea class="code" rows="7" data-field="template.bindingsText" ${readOnly ? "disabled" : ""}>${escapeHtml(state.editor.bindingsText)}</textarea></label>
        <label>Metadata<textarea class="code" rows="7" data-field="template.metadataText" ${readOnly ? "disabled" : ""}>${escapeHtml(state.editor.metadataText)}</textarea></label>
      </div>
    </section>
    ${renderLineagePanel(readOnly)}
  `;
}

function renderDagEditorPanel(readOnly) {
  return `
    <section class="panel graph-panel">
      <div class="panel-header">
        <div><h3>Nodes</h3><p>${state.editor.nodes.length} configured task or control nodes.</p></div>
        <button class="secondary" data-action="add-node" ${readOnly ? "disabled" : ""}>Add node</button>
      </div>
      <div class="node-list">${state.editor.nodes.map((node, index) => renderNode(node, index, readOnly)).join("")}</div>
    </section>

    <section class="panel graph-panel">
      <div class="panel-header">
        <div><h3>Edges</h3><p>${state.editor.edges.length} transitions between nodes.</p></div>
        <button class="secondary" data-action="add-edge" ${readOnly ? "disabled" : ""}>Add edge</button>
      </div>
      <div class="edge-list">${state.editor.edges.map((edge, index) => renderEdge(edge, index, readOnly)).join("")}</div>
    </section>
  `;
}

function renderReviewPanel(input) {
  return `
    <section class="panel preview-panel wide-panel">
      <div class="panel-header">
        <div><h3>Validation preview</h3><p>Review graph warnings and the final template payload before saving or publishing.</p></div>
      </div>
      ${
        input.warnings.length
          ? `<ul class="warning-list">${input.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
          : '<p class="muted">No local graph warnings.</p>'
      }
      <pre>${escapeHtml(prettyJson(input.preview))}</pre>
    </section>
  `;
}

function renderAgentHostingPanel() {
  const runtime = state.runtimeSummary?.execution_runtime || null;
  const hosting = state.runtimeSummary?.agent_hosting || null;
  const hostedProfiles = hosting?.profiles || [];
  const readyCount = hostedProfiles.filter((profile) => profile.health?.status === "ready").length;
  const needsBindingCount = hostedProfiles.filter((profile) => profile.health?.status === "needs_binding").length;

  return `
    <div class="agent-hosting-workspace">
      <section class="panel agent-hosting-panel">
        <div class="panel-header">
          <div><h3>Subagent Hosting</h3><p>OpenClaw runtime ownership with My Mate registry bindings.</p></div>
          <button class="secondary" data-action="refresh-runtime" ${state.runtimeLoading ? "disabled" : ""}>${state.runtimeLoading ? "Refreshing..." : "Refresh"}</button>
        </div>
        <div class="workspace-summary-grid compact-summary">
          <div class="summary-stat">
            <strong>Hosted</strong>
            <p>${escapeHtml(String(hostedProfiles.length))}</p>
          </div>
          <div class="summary-stat">
            <strong>Ready</strong>
            <p>${escapeHtml(String(readyCount))}</p>
          </div>
          <div class="summary-stat">
            <strong>Needs Binding</strong>
            <p>${escapeHtml(String(needsBindingCount))}</p>
          </div>
          <div class="summary-stat">
            <strong>Runtime</strong>
            <p>${escapeHtml(runtime?.adapter_kind || "unknown")}</p>
          </div>
        </div>
        <div class="hosting-list expanded">
          ${
            hostedProfiles.length
              ? hostedProfiles
                  .map(
                    (profile) => `
                      <div class="hosting-item">
                        <div>
                          <strong>${escapeHtml(profile.profile_id)}</strong>
                          <p>${escapeHtml(profile.name)} / ${escapeHtml(profile.openclaw_agent_id || "unbound")}</p>
                        </div>
                        <div class="hosting-meta">
                          <span>${escapeHtml(profile.provider || "provider unset")}</span>
                          <span>${escapeHtml(profile.model || "model unset")}</span>
                          <span>${escapeHtml(profile.runtime_mode || runtime?.bridge_execution_mode || "runtime default")}</span>
                        </div>
                        <span class="badge ${profile.health?.status === "ready" ? "success" : profile.health?.status === "disabled" ? "neutral" : "warn"}">${escapeHtml(profile.health?.status || "unknown")}</span>
                        <button class="mini-button" data-action="edit-agent-profile-from-hosting" data-id="${escapeHtml(profile.profile_id)}">Edit</button>
                      </div>
                    `,
                  )
                  .join("")
              : '<p class="muted">No agent profiles have been registered yet.</p>'
          }
        </div>
      </section>
      <section class="panel registry-manager-panel">
        ${renderAgentProfileManager()}
      </section>
    </div>
  `;
}

function renderSettingsPanel() {
  const runtime = state.runtimeSummary?.execution_runtime || null;
  const hosting = state.runtimeSummary?.agent_hosting || null;
  const planner = state.runtimeSummary?.planner || null;
  const registry = state.runtimeSummary?.registry || null;
  const hostedProfiles = hosting?.profiles || [];

  return `
    <section class="panel settings-panel">
      <div class="panel-header">
        <div><h3>Desktop Settings</h3><p>Separate runtime, planner, and registry ownership instead of mixing them into one page.</p></div>
        <button class="secondary" data-action="refresh-runtime" ${state.runtimeLoading ? "disabled" : ""}>${state.runtimeLoading ? "Refreshing..." : "Refresh runtime"}</button>
      </div>
      <div class="settings-grid">
        <section class="subpanel span-2">
          <div class="subpanel-header">
            <strong>Subagent Hosting</strong>
            <span class="badge neutral">${escapeHtml(String(hostedProfiles.length))} profiles</span>
          </div>
          <div class="hosting-list">
            ${
              hostedProfiles.length
                ? hostedProfiles
                    .map(
                      (profile) => `
                        <div class="hosting-item">
                          <div>
                            <strong>${escapeHtml(profile.profile_id)}</strong>
                            <p>${escapeHtml(profile.name)} / ${escapeHtml(profile.openclaw_agent_id || "unbound")}</p>
                          </div>
                          <div class="hosting-meta">
                            <span>${escapeHtml(profile.provider || "provider unset")}</span>
                            <span>${escapeHtml(profile.model || "model unset")}</span>
                            <span>${escapeHtml(profile.runtime_mode || runtime?.bridge_execution_mode || "runtime default")}</span>
                          </div>
                          <span class="badge ${profile.health?.status === "ready" ? "success" : profile.health?.status === "disabled" ? "neutral" : "warn"}">${escapeHtml(profile.health?.status || "unknown")}</span>
                          <button class="mini-button" data-action="edit-agent-profile-from-hosting" data-id="${escapeHtml(profile.profile_id)}">Edit</button>
                        </div>
                      `,
                    )
                    .join("")
                : '<p class="muted">No agent profiles have been registered yet.</p>'
            }
          </div>
        </section>
        <section class="subpanel">
          <div class="subpanel-header"><strong>Execution Runtime</strong></div>
          <div class="rail-kv-list">
            <div><strong>Adapter</strong><span>${escapeHtml(runtime?.adapter_kind || "unknown")}</span></div>
            <div><strong>Bridge Mode</strong><span>${escapeHtml(runtime?.bridge_execution_mode || "n/a")}</span></div>
            <div><strong>Health</strong><span>${escapeHtml(runtime?.runtime_health?.status || "unknown")}</span></div>
            <div><strong>Detail</strong><span>${escapeHtml(runtime?.runtime_health?.detail || "No runtime detail.")}</span></div>
          </div>
        </section>
        <section class="subpanel">
          <div class="subpanel-header"><strong>Planner</strong></div>
          <div class="rail-kv-list">
            <div><strong>Provider</strong><span>${escapeHtml(planner?.provider_name || planner?.provider_id || "unknown")}</span></div>
            <div><strong>Fallback</strong><span>${escapeHtml(planner?.fallback_provider_name || planner?.fallback_provider_id || "unknown")}</span></div>
            <div><strong>LLM Model</strong><span>${escapeHtml(planner?.llm_model || "n/a")}</span></div>
            <div><strong>Registered</strong><span>${escapeHtml((planner?.registered_provider_ids || []).join(", ") || "none")}</span></div>
          </div>
        </section>
        <section class="subpanel">
          <div class="subpanel-header"><strong>Registry</strong></div>
          <div class="rail-kv-list">
            <div><strong>Agent Profiles</strong><span>${escapeHtml(String(registry?.agent_profile_count ?? 0))}</span></div>
            <div><strong>Active Profiles</strong><span>${escapeHtml(String(registry?.active_agent_profile_count ?? 0))}</span></div>
            <div><strong>Skills</strong><span>${escapeHtml(String(registry?.skill_count ?? 0))}</span></div>
            <div><strong>Templates</strong><span>${escapeHtml(String(registry?.template_count ?? 0))}</span></div>
          </div>
        </section>
      </div>
    </section>
  `;
}

function getSelectedOrchestratorProfile() {
  return (
    state.orchestratorProfiles.find(
      (profile) => profile.orchestrator_id === state.orchestrator.selectedProfileId,
    ) ||
    state.orchestratorProfiles[0] ||
    null
  );
}

function renderOrchestratorSidebarContent() {
  const activeProfile = getSelectedOrchestratorProfile();
  const recent = state.missions.slice(0, 8);
  return `
    <div class="orchestrator-sidebar">
      <section class="sidebar-panel">
        <div class="sidebar-panel-header">
          <strong>Orchestrator</strong>
          <button class="mini-button" data-action="refresh-runtime">${state.runtimeLoading ? "..." : "Sync"}</button>
        </div>
        <div class="registry-item">
          <strong>${escapeHtml(activeProfile?.name || activeProfile?.orchestrator_id || state.orchestrator.name || "Draft orchestrator")}</strong>
          <small>${escapeHtml(state.orchestrator.provider || state.runtimeSummary?.planner?.provider_name || "provider unset")} / ${escapeHtml(state.orchestrator.model || state.runtimeSummary?.planner?.llm_model || "model unset")}</small>
        </div>
      </section>
      <section class="sidebar-panel">
        <div class="sidebar-panel-header">
          <strong>Active Missions</strong>
          <button class="mini-button" data-action="refresh-missions">${state.missionsLoading ? "..." : "Ref"}</button>
        </div>
        <div class="template-list">
          ${
            recent.length
              ? recent
                  .map((mission) => {
                    const labels = getMissionInventoryLabels(mission);
                    return `
                      <button class="template-item ${mission.session_id === state.selectedSessionId ? "selected" : ""}" data-action="select-session" data-id="${escapeHtml(mission.session_id)}" data-session-id="${escapeHtml(mission.session_id)}">
                        <span class="status-dot ${statusTone(mission.status)}"></span>
                        <span>
                          <strong>${escapeHtml(labels.title)}</strong>
                          <small>${escapeHtml(labels.subtitle)}</small>
                        </span>
                      </button>
                    `;
                  })
                  .join("")
              : '<p class="sidebar-muted">No active missions yet.</p>'
          }
        </div>
      </section>
    </div>
  `;
}

function renderOrchestratorConversation(messages) {
  const visible = messages
    .filter((message) =>
      message.role === "user" ||
      message.role === "orchestrator" ||
      message.kind === "goal_update_card" ||
      message.kind === "workspace_snapshot_card",
    )
    .slice(-10);
  if (!visible.length) {
    return '<p class="muted">Start by describing the mission. The orchestrator will turn it into a MissionSpec and DAG proposal.</p>';
  }
  return `
    <div class="orchestrator-chat-feed">
      ${visible
        .map((message) => {
          const role = message.role === "user" ? "user" : "orchestrator";
          const text = getMessageText(message) || message.kind;
          return `
            <article class="orchestrator-message ${role}">
              <span>${escapeHtml(role === "user" ? "You" : "Orchestrator")}</span>
              <p>${escapeHtml(text)}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderProposalAssignmentEditor(node, index, recommendation) {
  const draft = getProposalNodeDraft(node, index);
  const recommendationText = recommendation
    ? `${recommendation.agent_profile_name || recommendation.agent_profile_id || "registry"} / score ${recommendation.score ?? "n/a"}`
    : "";
  return `
    <article class="orchestrator-node-card editable">
      <span>${escapeHtml(String(index + 1))}</span>
      <div class="proposal-node-editor">
        <div class="proposal-node-title">
          <strong>${escapeHtml(draft.name)}</strong>
          <small>${escapeHtml(draft.type)}${recommendationText ? ` / ${escapeHtml(recommendationText)}` : ""}</small>
        </div>
        <div class="proposal-assignment-grid">
          <label>Subagent<input value="${escapeHtml(draft.agentProfile)}" list="agent-profile-options" data-field="proposal.agent_profile" data-key="${escapeHtml(draft.key)}" /></label>
          <label>Skills<input value="${escapeHtml(draft.skillsText)}" list="skill-options" data-field="proposal.allowed_skills" data-key="${escapeHtml(draft.key)}" /></label>
          <label>Tools<input value="${escapeHtml(draft.toolsText)}" data-field="proposal.allowed_tools" data-key="${escapeHtml(draft.key)}" /></label>
          <label>Provider<input value="${escapeHtml(draft.provider)}" data-field="proposal.provider" data-key="${escapeHtml(draft.key)}" /></label>
          <label>Model<input value="${escapeHtml(draft.model)}" data-field="proposal.model" data-key="${escapeHtml(draft.key)}" /></label>
          <label class="span-2">Input context<textarea rows="2" data-field="proposal.context" data-key="${escapeHtml(draft.key)}">${escapeHtml(draft.contextText)}</textarea></label>
          <label class="span-2">Output contract<textarea class="code" rows="3" data-field="proposal.output_contract" data-key="${escapeHtml(draft.key)}">${escapeHtml(draft.outputContractText)}</textarea></label>
        </div>
      </div>
    </article>
  `;
}

function renderDagProposalSummary() {
  const candidatePlan = state.planner.candidatePlan;
  const activeProposal = state.planner.activeProposal;
  const dagDraft = getProposalDraftSource();
  const candidateNodes = candidatePlan?.candidate_plan?.compiled_nodes || [];
  const dagNodes = dagDraft?.draft_template?.nodes || [];
  const nodes = dagNodes.length ? dagNodes : candidateNodes;
  const recommendations = dagDraft?.registry_recommendations || [];
  const validation = dagDraft?.validation || candidatePlan?.validation || null;
  const badge = plannerValidationBadge(validation);
  const sessionId = getActiveProposalSessionId();
  const hasDurableProposal = !!activeProposal?.proposal_id;
  const proposalStatus = activeProposal?.status || "";
  const canSaveAssignments =
    hasDurableProposal && proposalStatus !== "rejected" && proposalStatus !== "superseded";
  const canConfirmProposal = hasDurableProposal && proposalStatus === "review_ready";
  const canLaunchRun = hasDurableProposal && proposalStatus === "confirmed";
  const warnings = activeProposal?.warnings || [];
  const checklist = activeProposal?.checklist || [];
  const durableActions = sessionId
    ? `
      <div class="orchestrator-actions">
        <button class="secondary" data-action="create-dag-proposal" ${state.planner.proposalSaving || state.planner.proposalLoading ? "disabled" : ""}>${state.planner.proposalSaving ? "Creating..." : hasDurableProposal ? "New proposal" : "Create proposal"}</button>
        <button class="secondary" data-action="save-proposal-assignments" ${state.planner.proposalSaving || !canSaveAssignments ? "disabled" : ""}>${state.planner.proposalSaving ? "Saving..." : "Save assignments"}</button>
        <button class="primary" data-action="confirm-dag-proposal" ${state.planner.proposalConfirming || !canConfirmProposal ? "disabled" : ""}>${state.planner.proposalConfirming ? "Confirming..." : "Confirm proposal"}</button>
        <button class="primary" data-action="launch-proposal-run" ${state.proposalDispatching || !canLaunchRun ? "disabled" : ""}>${state.proposalDispatching ? "Launching..." : "Launch run"}</button>
      </div>
    `
    : "";
  const proposalMeta = hasDurableProposal
    ? `
      <div class="proposal-record-meta">
        <span class="badge ${statusTone(proposalStatus)}">${escapeHtml(proposalStatus)}</span>
        <small>${escapeHtml(activeProposal.proposal_id)}${activeProposal.source_revision ? ` / route v${escapeHtml(activeProposal.source_revision)}` : ""}</small>
      </div>
    `
    : state.planner.proposalLoading
      ? '<p class="muted">Loading durable proposals...</p>'
      : sessionId
        ? '<p class="muted">No durable proposal saved for this mission yet.</p>'
        : "";
  const proposalActions = dagDraft
    ? `
      <div class="orchestrator-actions">
        <button class="secondary" data-action="apply-dag-draft" ${state.applyingDagDraft ? "disabled" : ""}>${state.applyingDagDraft ? "Copying..." : "Copy to editor"}</button>
        <button class="primary" data-action="save-dag-draft" ${state.savingDagDraft ? "disabled" : ""}>${state.savingDagDraft ? "Saving..." : "Save draft"}</button>
      </div>
    `
    : candidatePlan
      ? `
        <div class="orchestrator-actions">
          <button class="secondary" data-action="apply-plan-draft" ${state.applyingPlan ? "disabled" : ""}>${state.applyingPlan ? "Copying..." : "Copy to editor"}</button>
          <button class="primary" data-action="save-plan-draft" ${state.savingPlan ? "disabled" : ""}>${state.savingPlan ? "Saving..." : "Save draft"}</button>
        </div>
      `
      : "";

  return `
    <section class="subpanel orchestrator-dag-panel">
      <div class="subpanel-header">
        <strong>DAG Proposal</strong>
        <span class="badge ${hasDurableProposal ? statusTone(proposalStatus) : badge.tone}">${escapeHtml(hasDurableProposal ? proposalStatus : nodes.length ? `${nodes.length} node(s)` : "not generated")}</span>
      </div>
      ${proposalMeta}
      ${hasDurableProposal ? renderProposalTracePanel() : ""}
      ${
        nodes.length
          ? `<div class="orchestrator-node-grid">
              ${nodes
                .slice(0, 8)
                .map((node, index) => renderProposalAssignmentEditor(node, index, recommendations[index] || null))
                .join("")}
            </div>
            ${durableActions}
            ${proposalActions}
            ${
              warnings.length
                ? `<ul class="warning-list compact">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
                : ""
            }
            ${
              checklist.length
                ? `<div class="skill-chip-list">${checklist.map((item) => `<span class="skill-chip">${escapeHtml(item)}</span>`).join("")}</div>`
                : ""
            }
            ${renderValidationGroups(validation, "No DAG warnings.")}`
          : `<p class="muted">Generate or create a DAG proposal from the mission brief to review subagent assignments.</p>
            ${durableActions}`
      }
    </section>
  `;
}

function renderMissionSpecCompact(detail) {
  const spec = getWorkspaceMissionSpec(detail);
  if (!spec) {
    return `
      <section class="subpanel">
        <div class="subpanel-header"><strong>MissionSpec</strong><span class="badge neutral">draft</span></div>
        <p class="muted">MissionSpec will appear after the orchestrator reads the brief.</p>
      </section>
    `;
  }
  return `
    <section class="subpanel">
      <div class="subpanel-header"><strong>MissionSpec</strong><span class="badge ${spec.route?.stale ? "warn" : "success"}">${escapeHtml(formatMissionRouteLabel(spec.route))}</span></div>
      <p class="muted">${escapeHtml(spec.objective || "No objective yet.")}</p>
      <div class="skill-chip-list">
        ${(spec.requestedOutputs || []).slice(0, 6).map((item) => `<span class="skill-chip">${escapeHtml(item)}</span>`).join("") || '<span class="skill-chip muted">outputs pending</span>'}
      </div>
    </section>
  `;
}

function getOrchestratorFlowSteps(detail) {
  const workspace = detail?.workspace_state || {};
  const hasConversation = Array.isArray(detail?.messages) && detail.messages.length > 0;
  const hasMissionSpec = !!getWorkspaceMissionSpec(detail);
  const hasDagProposal =
    (Array.isArray(state.planner?.dagDraft?.draft_template?.nodes) &&
      state.planner.dagDraft.draft_template.nodes.length > 0) ||
    (Array.isArray(state.planner?.candidatePlan?.candidate_plan?.compiled_nodes) &&
      state.planner.candidatePlan.candidate_plan.compiled_nodes.length > 0);
  const hasRun =
    !!detail?.latest_run?.run_id ||
    !!workspace.latest_run_id ||
    !!detail?.runtime_graph;

  return [
    {
      label: "Brief",
      title: hasConversation ? "Mission is in conversation" : "Start with a plain-language mission",
      detail: hasConversation
        ? "The orchestrator has mission context and can keep refining it."
        : "Describe the outcome first. The orchestrator will shape the mission from there.",
      tone: hasConversation ? "success" : "neutral",
    },
    {
      label: "Route",
      title: hasDagProposal ? "MissionSpec and route are visible" : "Review the MissionSpec and DAG proposal",
      detail: hasDagProposal
        ? "Subagent assignments and execution intent are visible before dispatch."
        : "Generate a DAG proposal or plan route before handing work to subagents.",
      tone: hasDagProposal || hasMissionSpec ? "warn" : "neutral",
    },
    {
      label: "Execute",
      title: hasRun ? "Supervise execution and outputs" : "Launch and supervise the run",
      detail: hasRun
        ? "Use the cockpit to watch runtime state, outputs, and operator gates."
        : "Once the route looks right, launch the run and supervise it from the cockpit.",
      tone: hasRun ? "success" : "neutral",
    },
  ];
}

function renderOrchestratorLaunchpad(detail) {
  const steps = getOrchestratorFlowSteps(detail);
  return `
    <section class="subpanel orchestrator-launchpad">
      <div class="subpanel-header">
        <strong>Operating Flow</strong>
        <span class="badge neutral">Conversation first</span>
      </div>
      <div class="orchestrator-launch-grid">
        ${steps
          .map(
            (step, index) => `
              <article class="orchestrator-launch-step">
                <span class="badge ${step.tone}">${escapeHtml(String(index + 1))}</span>
                <div>
                  <strong>${escapeHtml(step.label)}</strong>
                  <h4>${escapeHtml(step.title)}</h4>
                  <p>${escapeHtml(step.detail)}</p>
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderOrchestratorWorkbench() {
  const detail = state.workspaceDetail;
  const session = detail?.session || null;
  const messages = detail?.messages || [];
  const workspace = detail?.workspace_state || {};
  const title = session?.title || "New orchestrated mission";
  const subtitle =
    detail?.mission_snapshot?.nextActionDetail ||
    detail?.workspace_state?.next_recommended_detail ||
    "Shape the brief, lock the route, and hand work to runtime only when the mission contract is clear.";
  const hasExecutionData =
    !!detail?.runtime_graph ||
    !!detail?.latest_run ||
    !!workspace.latest_run_id ||
    (Array.isArray(detail?.artifacts) && detail.artifacts.length > 0) ||
    (Array.isArray(detail?.interventions) && detail.interventions.length > 0) ||
    (Array.isArray(detail?.dag_patches) && detail.dag_patches.length > 0);

  return `
    <div class="orchestrator-workbench">
      ${renderOrchestratorLaunchpad(detail)}
      <section class="panel orchestrator-chat-panel">
        <div class="panel-header">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(subtitle)}</p>
          </div>
          <span class="badge ${statusTone(session?.status || "draft")}">${escapeHtml(session?.status || "new mission")}</span>
        </div>
        ${renderOrchestratorConversation(messages)}
        <div class="orchestrator-composer">
          <label>Mission instruction<textarea rows="5" data-field="planner.intent" placeholder="Describe the outcome, constraints, and outputs you need.">${escapeHtml(state.planner.intent)}</textarea></label>
          <div class="orchestrator-actions">
            <button class="primary" data-action="orchestrator-send-message" ${state.planning ? "disabled" : ""}>${state.planning ? "Thinking..." : state.selectedSessionId ? "Send to orchestrator" : "Start mission"}</button>
            <button class="secondary" data-action="generate-dag-draft" ${state.planning || !state.planner.intent.trim() ? "disabled" : ""}>Generate DAG</button>
            <button class="secondary" data-action="plan-intent" ${state.planning || !state.planner.intent.trim() ? "disabled" : ""}>Plan mission</button>
          </div>
        </div>
        ${state.planner.error ? `<div class="alert danger inline-alert">${escapeHtml(state.planner.error)}</div>` : ""}
      </section>
      ${renderMissionSpecCompact(detail)}
      ${renderDagProposalSummary()}
      ${hasExecutionData ? renderExecutionCockpit(detail) : ""}
    </div>
  `;
}

function renderOrchestratorRail() {
  const runtime = state.runtimeSummary?.execution_runtime || null;
  const planner = state.runtimeSummary?.planner || null;
  const profiles = state.orchestratorProfiles || [];
  const selectedProfile = getSelectedOrchestratorProfile();
  const hostedProfiles = state.runtimeSummary?.agent_hosting?.profiles || [];
  const readySubagents = hostedProfiles.filter((profile) => profile.health?.status === "ready");
  const detail = state.workspaceDetail;
  const deliverables = getExecutionDeliverables(detail);
  const queueItems = getExecutionQueueItems(detail);
  const latestArtifacts = Array.isArray(detail?.artifacts) ? detail.artifacts.slice(-4).reverse() : [];
  const latestRunStatus =
    detail?.latest_run?.status ||
    detail?.workspace_state?.run_status ||
    detail?.session?.workspace_state?.run_status ||
    "idle";
  const setupExpanded = state.ui.orchestratorSetupExpanded;

  return `
    <aside class="desktop-rail">
      <section class="panel rail-panel">
        <div class="panel-header">
          <div><h3>Orchestrator Setup</h3><p>Persisted profile intent for the supervising orchestrator.</p></div>
          <div class="orchestrator-setup-actions">
            <span class="badge neutral">${state.orchestratorProfilesLoading ? "syncing" : "V2"}</span>
            <button class="mini-button" data-action="toggle-orchestrator-setup">${setupExpanded ? "Hide" : "Edit"}</button>
          </div>
        </div>
        <div class="orchestrator-setup-summary">
          <div><strong>Profile</strong><span>${escapeHtml(selectedProfile?.name || selectedProfile?.orchestrator_id || "New orchestrator")}</span></div>
          <div><strong>Provider</strong><span>${escapeHtml(state.orchestrator.provider || planner?.provider_id || "unset")}</span></div>
          <div><strong>Model</strong><span>${escapeHtml(state.orchestrator.model || planner?.llm_model || "unset")}</span></div>
          <div><strong>Subagents</strong><span>${escapeHtml(state.orchestrator.defaultSubagentsText || "runtime defaults")}</span></div>
        </div>
        ${
          setupExpanded
            ? `
              <div class="orchestrator-config-grid">
                <label>Profile
                  <select data-field="orchestrator.selectedProfileId">
                    <option value="">New orchestrator</option>
                    ${profiles.map((profile) => `<option value="${escapeHtml(profile.orchestrator_id)}" ${selectedProfile?.orchestrator_id === profile.orchestrator_id ? "selected" : ""}>${escapeHtml(profile.name || profile.orchestrator_id)}</option>`).join("")}
                  </select>
                </label>
                <label>Name<input value="${escapeHtml(state.orchestrator.name || "")}" data-field="orchestrator.name" placeholder="Studio Orchestrator" /></label>
                <label>Provider<input value="${escapeHtml(state.orchestrator.provider || planner?.provider_id || "")}" data-field="orchestrator.provider" placeholder="planner/provider" /></label>
                <label>Model<input value="${escapeHtml(state.orchestrator.model || planner?.llm_model || "")}" data-field="orchestrator.model" placeholder="model id" /></label>
                <label>System prompt<textarea rows="5" data-field="orchestrator.systemPrompt">${escapeHtml(state.orchestrator.systemPrompt)}</textarea></label>
                <label>Default tools<input value="${escapeHtml(state.orchestrator.defaultToolsText || "")}" data-field="orchestrator.defaultToolsText" placeholder="tool-a, tool-b" /></label>
                <label>Default subagents<input value="${escapeHtml(state.orchestrator.defaultSubagentsText || "")}" data-field="orchestrator.defaultSubagentsText" placeholder="researcher, builder" /></label>
                <button class="primary" data-action="save-orchestrator-profile">Save orchestrator profile</button>
              </div>
            `
            : ""
        }
      </section>
      <section class="panel rail-panel">
        <div class="panel-header">
          <div><h3>Supervision</h3><p>Runtime posture, deliverables, and execution gates.</p></div>
          <span class="badge ${statusTone(latestRunStatus)}">${escapeHtml(latestRunStatus)}</span>
        </div>
        <div class="rail-kv-list">
          <div><strong>Deliverables</strong><span>${escapeHtml(`${deliverables.filter((item) => item.status === "returned").length}/${deliverables.length}`)}</span></div>
          <div><strong>Open Gates</strong><span>${escapeHtml(String(queueItems.length))}</span></div>
          <div><strong>Artifacts</strong><span>${escapeHtml(String((detail?.artifacts || []).length))}</span></div>
        </div>
      </section>
      <section class="panel rail-panel">
        <div class="panel-header">
          <div><h3>Latest Outputs</h3><p>Returned deliverables and recent runtime outputs.</p></div>
        </div>
        <div class="rail-feed">
          ${
            deliverables.filter((item) => item.status === "returned").length
              ? deliverables
                  .filter((item) => item.status === "returned")
                  .slice(0, 4)
                  .map(
                    (item) => `
                      <div class="rail-feed-item">
                        <strong>${escapeHtml(item.title)}</strong>
                        <small>${escapeHtml(item.summary || item.uri || "Returned output")}</small>
                      </div>
                    `,
                  )
                  .join("")
              : latestArtifacts.length
                ? latestArtifacts
                    .map(
                      (artifact) => `
                        <div class="rail-feed-item">
                          <strong>${escapeHtml(artifact.name || artifact.kind || artifact.artifact_id || "artifact")}</strong>
                          <small>${escapeHtml(artifact.summary || artifact.storage_uri || artifact.path || "Generated output")}</small>
                        </div>
                      `,
                    )
                    .join("")
                : '<p class="muted">No returned outputs yet.</p>'
          }
        </div>
      </section>
      <section class="panel rail-panel">
        <div class="panel-header">
          <div><h3>Approvals & Interventions</h3><p>Items that may require operator attention.</p></div>
          <span class="badge ${queueItems.length ? "warn" : "neutral"}">${escapeHtml(String(queueItems.length))}</span>
        </div>
        <div class="rail-feed">
          ${
            queueItems.length
              ? queueItems
                  .slice(0, 6)
                  .map(
                    (item) => `
                      <div class="rail-feed-item">
                        <strong>${escapeHtml(item.title)}</strong>
                        <small>${escapeHtml(item.detail || formatWorkspaceLabel(item.kind))}</small>
                      </div>
                    `,
                  )
                  .join("")
              : '<p class="muted">No approvals or interventions are pending.</p>'
          }
        </div>
      </section>
      <section class="panel rail-panel">
        <div class="panel-header">
          <div><h3>Subagents</h3><p>Available workers for DAG assignment.</p></div>
          <span class="badge ${readySubagents.length ? "success" : "warn"}">${escapeHtml(String(readySubagents.length))} ready</span>
        </div>
        <div class="rail-feed">
          ${
            hostedProfiles.length
              ? hostedProfiles.slice(0, 8).map((profile) => `
                  <div class="rail-feed-item">
                    <strong>${escapeHtml(profile.profile_id)}</strong>
                    <small>${escapeHtml(profile.model || profile.openclaw_agent_id || profile.health?.status || "unbound")}</small>
                  </div>
                `).join("")
              : '<p class="muted">No subagents registered yet.</p>'
          }
        </div>
      </section>
      <section class="panel rail-panel">
        <div class="panel-header">
          <div><h3>Runtime</h3><p>${escapeHtml(runtime?.runtime_health?.detail || "Runtime summary unavailable.")}</p></div>
          <span class="badge ${runtime?.runtime_health?.status === "ok" ? "success" : "warn"}">${escapeHtml(runtime?.adapter_kind || "runtime")}</span>
        </div>
        <div class="rail-kv-list">
          <div><strong>Planner</strong><span>${escapeHtml(planner?.provider_name || planner?.provider_id || "unknown")}</span></div>
          <div><strong>LLM Model</strong><span>${escapeHtml(planner?.llm_model || "n/a")}</span></div>
          <div><strong>Registered</strong><span>${escapeHtml((planner?.registered_provider_ids || []).join(", ") || "none")}</span></div>
        </div>
      </section>
    </aside>
  `;
}

function renderDesktopSidebarContent() {
  if (state.activeNav === "orchestrator") {
    return renderOrchestratorSidebarContent();
  }
  if (state.activeNav === "missions") {
    return `
      <div class="sidebar-section-header">
        <strong>Missions</strong>
        <button class="mini-button" data-action="refresh-missions">${state.missionsLoading ? "..." : "Ref"}</button>
      </div>
      ${renderSessionInventoryControls("missions")}
      <div class="template-list">${renderMissionList()}</div>
    `;
  }
  if (state.activeNav === "sessions") {
    return `
      <div class="sidebar-section-header">
        <strong>Sessions</strong>
        <button class="mini-button" data-action="refresh-sessions">${state.sessionsLoading ? "..." : "Ref"}</button>
      </div>
      ${renderSessionInventoryControls("sessions")}
      <div class="template-list">${renderSessionList()}</div>
    `;
  }
  if (state.activeNav === "agents") {
    return `
      <div class="sidebar-section-header">
        <strong>Subagents</strong>
        <button class="mini-button" data-action="refresh-runtime">${state.runtimeLoading ? "..." : "Ref"}</button>
      </div>
      <button class="primary full" data-action="new-agent-profile">New agent</button>
      <div class="template-list">${renderAgentHostingSidebarList()}</div>
    `;
  }
  if (state.activeNav === "templates") {
    return `
      <button class="primary full" data-action="new-template">New template</button>
      <div class="template-list">${renderTemplateList()}</div>
    `;
  }
  if (state.activeNav === "registry") {
    return renderRegistryPanel();
  }
  return `
    <div class="sidebar-panel">
      <div class="sidebar-panel-header"><strong>Workspace Status</strong></div>
      <div class="registry-item">
        <strong>Runtime</strong>
        <small>${escapeHtml(state.runtimeSummary?.execution_runtime?.runtime_health?.detail || "Runtime summary unavailable.")}</small>
      </div>
      <div class="registry-item">
        <strong>Planner</strong>
        <small>${escapeHtml(state.runtimeSummary?.planner?.provider_name || "Planner summary unavailable.")}</small>
      </div>
    </div>
  `;
}

function renderDesktopCenter(readOnly, warnings, preview) {
  if (state.activeNav === "orchestrator") {
    return renderOrchestratorWorkbench();
  }
  if (state.activeNav === "missions" || state.activeNav === "sessions") {
    return renderMissionWorkspace();
  }
  if (state.activeNav === "templates") {
    return `
      ${renderViewTabs()}
      <div class="layout-grid single-view">
        ${renderActiveView(readOnly, warnings, preview)}
      </div>
    `;
  }
  if (state.activeNav === "agents") {
    return renderAgentHostingPanel();
  }
  if (state.activeNav === "registry") {
    return renderRegistryManagerPanel();
  }
  return renderSettingsPanel();
}

function renderCommandPalette() {
  if (!state.commandPaletteOpen) return "";
  const items = getFilteredCommandPaletteItems();
  const selectedIndex = getCommandPaletteSelectedIndex(items);
  return `
    <div class="command-palette-layer">
      <button class="command-palette-scrim" data-action="close-command-palette" aria-label="Close command palette"></button>
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="command-palette-search">
          <input data-command-palette-input data-field="command.query" value="${escapeHtml(state.commandPaletteQuery)}" placeholder="Search commands, missions, sessions" autocomplete="off" />
          <span>Ctrl/Cmd K</span>
        </div>
        <div class="command-palette-list" role="listbox">
          ${
            items.length
              ? items
                  .map(
                    (item, index) => `
                      <button class="command-palette-item ${index === selectedIndex ? "selected" : ""}" data-action="run-command" data-key="${escapeHtml(item.key)}" role="option" aria-selected="${index === selectedIndex ? "true" : "false"}">
                        <span>
                          <strong>${escapeHtml(item.title)}</strong>
                          <small>${escapeHtml(item.subtitle || item.key)}</small>
                        </span>
                        <em>${escapeHtml(item.group || "Command")}</em>
                      </button>
                    `,
                  )
                  .join("")
              : '<div class="command-palette-empty">No commands found.</div>'
          }
        </div>
      </section>
    </div>
  `;
}

function renderActiveView(readOnly, warnings, preview) {
  if (state.activeView === "template") {
    return renderTemplateBasicsPanel(readOnly);
  }
  if (state.activeView === "dag") {
    return renderDagEditorPanel(readOnly);
  }
  if (state.activeView === "registry") {
    return renderRegistryManagerPanel();
  }
  if (state.activeView === "review") {
    return renderReviewPanel({ warnings, preview });
  }
  return renderPlannerPanel();
}

function render() {
  const readOnly = ["published", "archived"].includes(state.editor.status);
  const warnings = validateGraph();
  const selectedTemplate = state.templates.find((item) => item.template_id === state.selectedId) || null;
  const preview = selectedTemplate || buildDraftPayload();
  const workspaceSession = state.workspaceDetail?.session || null;
  const workspaceTitle =
    state.activeNav === "orchestrator"
      ? "Orchestrator Workbench"
      : state.activeNav === "missions" || state.activeNav === "sessions"
      ? workspaceSession?.title || "Mission Workspace"
      : state.activeNav === "templates"
        ? state.editor.name
        : state.activeNav === "agents"
          ? "Subagent Hosting"
        : state.activeNav === "registry"
          ? "Registry Workspace"
          : "Desktop Settings";
  const workspaceSubtitle =
    state.activeNav === "orchestrator"
      ? "Choose model intent, talk through the mission, review the MissionSpec and DAG before subagents execute."
      : state.activeNav === "missions" || state.activeNav === "sessions"
      ? workspaceSession?.workspace_state?.next_recommended_detail ||
        state.workspaceDetail?.mission_snapshot?.nextActionDetail ||
        "Mission-first workspace for brief, work, checkpoints, outputs, and runtime."
      : state.activeNav === "templates"
        ? `${state.editor.templateId || "unsaved draft"}${state.editor.updatedAt ? ` / updated ${new Date(state.editor.updatedAt).toLocaleString()}` : ""}`
        : state.activeNav === "agents"
          ? "Manage OpenClaw subagent bindings, providers, and runtime model intent."
        : state.activeNav === "registry"
          ? "Manage reusable agent profiles and skills."
          : "Observe runtime, planner, and registry ownership boundaries.";
  const titleBadge =
    state.activeNav === "orchestrator"
      ? "V2"
      : state.activeNav === "templates"
      ? `${state.editor.status}${state.editor.version ? ` v${state.editor.version}` : ""}`
      : state.activeNav === "missions" || state.activeNav === "sessions"
        ? workspaceSession?.status || "idle"
        : state.activeNav;

  document.getElementById("root").innerHTML = `
    <main class="app-shell">
      <datalist id="agent-profile-options">
        ${state.agentProfiles.map((profile) => `<option value="${escapeHtml(profile.profile_id)}"></option>`).join("")}
      </datalist>
      <datalist id="skill-options">
        ${state.skills.map((skill) => `<option value="${escapeHtml(skill.skill_id)}"></option>`).join("")}
      </datalist>
      <aside class="sidebar">
        <div class="sidebar-header">
          <div>
            <p class="eyebrow">My Mate</p>
            <h1>${escapeHtml(state.activeNav === "orchestrator" ? "Mission Orchestrator" : "Mission Workspace")}</h1>
          </div>
          <div class="sidebar-header-actions">
            <button class="icon-button" data-action="open-command-palette" title="Command palette (Ctrl/Cmd+K)">Cmd</button>
            <button class="icon-button" data-action="refresh" title="Refresh">${state.loading ? "..." : "Ref"}</button>
          </div>
        </div>
        ${renderDesktopNav()}
        ${renderDesktopSidebarContent()}
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <div class="title-row">
              <h2>${escapeHtml(workspaceTitle)}</h2>
              <span class="badge ${statusTone(titleBadge)}">${escapeHtml(titleBadge)}</span>
            </div>
            <p>${escapeHtml(workspaceSubtitle || "")}</p>
          </div>
          <div class="actions">
            ${
              state.activeNav === "templates"
                ? `
                  <button class="secondary" data-action="derive-template" ${state.deriving || !state.editor.templateId || state.editor.status === "archived" ? "disabled" : ""}>${state.deriving ? "Deriving..." : "Derive"}</button>
                  <button class="secondary" data-action="new-template-version" ${state.versioning || state.editor.status !== "published" ? "disabled" : ""}>${state.versioning ? "Creating..." : "New version"}</button>
                  <button class="secondary" data-action="save-draft" ${state.saving || readOnly ? "disabled" : ""}>${state.saving ? "Saving..." : "Save draft"}</button>
                  <button class="primary" data-action="publish-draft" ${state.publishing || state.editor.status !== "draft" ? "disabled" : ""}>${state.publishing ? "Publishing..." : "Publish"}</button>
                `
                : `
                  <button class="secondary" data-action="refresh-runtime" ${state.runtimeLoading ? "disabled" : ""}>${state.runtimeLoading ? "Refreshing..." : "Runtime Summary"}</button>
                  <button class="primary" data-action="refresh-missions" ${state.missionsLoading ? "disabled" : ""}>${state.missionsLoading ? "Refreshing..." : "Sync Missions"}</button>
                `
            }
          </div>
        </header>

        ${state.error ? `<div class="alert danger">${escapeHtml(state.error)}</div>` : ""}
        ${state.notice ? `<div class="alert success">${escapeHtml(state.notice)}</div>` : ""}
        ${state.streamError ? `<div class="alert warn">${escapeHtml(state.streamError)}</div>` : ""}
        ${state.activeNav === "templates" && readOnly ? '<div class="alert warn">Published templates are read-only in this MVP.</div>' : ""}

        <div class="desktop-grid">
          <div class="desktop-center">
            ${renderDesktopCenter(readOnly, warnings, preview)}
          </div>
          ${state.activeNav === "orchestrator" ? renderOrchestratorRail() : renderDesktopRail()}
        </div>
      </section>
    </main>
    ${renderCommandPalette()}
  `;
  afterRender();
}

function handleChange(target) {
  const field = target.dataset.field;
  if (!field) return;
  const value = target.value;
  const index = Number(target.dataset.index);

  if (field === "template.name") updateEditor({ name: value });
  if (field === "template.workspaceScope") updateEditor({ workspaceScope: value });
  if (field === "template.description") updateEditor({ description: value });
  if (field === "template.inputSchemaText") updateEditor({ inputSchemaText: value });
  if (field === "template.policyText") updateEditor({ policyText: value });
  if (field === "template.bindingsText") updateEditor({ bindingsText: value });
  if (field === "template.metadataText") updateEditor({ metadataText: value });
  if (field === "mission.query") {
    state.missionQuery = value;
    return;
  }
  if (field === "session.query") {
    state.sessionQuery = value;
    return;
  }
  if (field === "command.query") {
    state.commandPaletteQuery = value;
    state.commandPaletteIndex = 0;
    queueCommandPaletteFocus("end");
    render();
    return;
  }
  if (field === "attachment.name") {
    state.attachmentEditor.name = value;
    return;
  }
  if (field === "attachment.storageUri") {
    state.attachmentEditor.storageUri = value;
    return;
  }
  if (field === "attachment.mimeType") {
    state.attachmentEditor.mimeType = value;
    return;
  }
  if (field === "attachment.summary") {
    state.attachmentEditor.summary = value;
    return;
  }
  if (field === "execution.interventionKind") {
    state.executionControl.interventionKind = value;
    render();
    return;
  }
  if (field === "execution.interventionText") {
    state.executionControl.interventionText = value;
    render();
    return;
  }
  if (field === "human-input.schema") {
    updateHumanInputDraft(target.dataset.inputRequestId || "", target.dataset.schemaKey || "", value);
    return;
  }
  if (field === "orchestrator.selectedProfileId") {
    state.orchestrator.selectedProfileId = value;
    const profile = state.orchestratorProfiles.find((item) => item.orchestrator_id === value);
    if (profile) {
      applyOrchestratorProfile(profile);
    } else if (!value) {
      state.orchestrator.name = "Studio Orchestrator";
    }
    return;
  }
  if (field === "orchestrator.name") {
    state.orchestrator.name = value;
    return;
  }
  if (field === "orchestrator.provider") {
    state.orchestrator.provider = value;
    return;
  }
  if (field === "orchestrator.model") {
    state.orchestrator.model = value;
    return;
  }
  if (field === "orchestrator.systemPrompt") {
    state.orchestrator.systemPrompt = value;
    return;
  }
  if (field === "orchestrator.defaultToolsText") {
    state.orchestrator.defaultToolsText = value;
    return;
  }
  if (field === "orchestrator.defaultSubagentsText") {
    state.orchestrator.defaultSubagentsText = value;
    return;
  }
  if (field === "planner.intent") {
    state.planner.intent = value;
    state.planner.templateId = "";
    state.planner.recommendation = null;
    state.planner.candidatePlan = null;
    state.planner.dagDraft = null;
    state.planner.proposalOverrides = {};
    state.planner.error = null;
    return;
  }
  if (field === "planner.inputsText") {
    state.planner.inputsText = value;
    state.planner.candidatePlan = null;
    state.planner.dagDraft = null;
    state.planner.proposalOverrides = {};
    state.planner.error = null;
    return;
  }
  if (field === "planner.maxAgentNodes") {
    state.planner.maxAgentNodes = value;
    state.planner.dagDraft = null;
    state.planner.proposalOverrides = {};
    state.planner.error = null;
    return;
  }
  if (field === "proposal.agent_profile") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "proposal.allowed_skills") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "proposal.allowed_tools") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "proposal.provider") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "proposal.model") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "proposal.context") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "proposal.output_contract") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "agent.profileId") updateAgentProfileEditor({ profileId: slugify(value) });
  if (field === "agent.status") updateAgentProfileEditor({ status: value });
  if (field === "agent.name") updateAgentProfileEditor({ name: value });
  if (field === "agent.description") updateAgentProfileEditor({ description: value });
  if (field === "agent.openclawAgentId") updateAgentProfileEditor({ openclawAgentId: value });
  if (field === "agent.openclawProvider") updateAgentProfileEditor({ openclawProvider: value });
  if (field === "agent.openclawModel") updateAgentProfileEditor({ openclawModel: value });
  if (field === "agent.openclawRuntimeMode") updateAgentProfileEditor({ openclawRuntimeMode: value });
  if (field === "agent.defaultSkillsText") updateAgentProfileEditor({ defaultSkillsText: value });
  if (field === "agent.allowedToolsText") updateAgentProfileEditor({ allowedToolsText: value });
  if (field === "agent.disallowedSkillsText") {
    updateAgentProfileEditor({ disallowedSkillsText: value });
  }
  if (field === "agent.policyTagsText") updateAgentProfileEditor({ policyTagsText: value });
  if (field === "agent.metadataText") updateAgentProfileEditor({ metadataText: value });
  if (field === "skill.skillId") updateSkillEditor({ skillId: slugify(value) });
  if (field === "skill.status") updateSkillEditor({ status: value });
  if (field === "skill.name") updateSkillEditor({ name: value });
  if (field === "skill.description") updateSkillEditor({ description: value });
  if (field === "skill.category") updateSkillEditor({ category: value });
  if (field === "skill.allowedToolsText") updateSkillEditor({ allowedToolsText: value });
  if (field === "skill.tagsText") updateSkillEditor({ tagsText: value });
  if (field === "skill.inputSchemaText") updateSkillEditor({ inputSchemaText: value });
  if (field === "skill.outputContractText") updateSkillEditor({ outputContractText: value });
  if (field === "skill.metadataText") updateSkillEditor({ metadataText: value });

  if (field === "node.id") updateNode(index, { id: slugify(value) });
  if (field === "node.type") {
    const patch = { type: value };
    if (value === "end") {
      patch.agent_profile = null;
      patch.allowed_skills = [];
      patch.approval_kind = null;
      patch.human_input_schema = null;
    }
    updateNode(index, patch);
  }
  if (field === "node.name") updateNode(index, { name: value });
  if (field === "node.agent_profile") updateNode(index, { agent_profile: value.trim() || null });
  if (field === "node.allowed_skills") {
    updateNode(index, {
      allowed_skills: value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    });
  }
  if (field === "node.approval_kind") updateNode(index, { approval_kind: value || null });
  if (field === "node.retry_policy.max_attempts") {
    updateNode(index, {
      retry_policy: { ...state.editor.nodes[index].retry_policy, max_attempts: Number(value) },
    });
  }
  if (field === "node.retry_policy.backoff_seconds") {
    updateNode(index, {
      retry_policy: { ...state.editor.nodes[index].retry_policy, backoff_seconds: Number(value) },
    });
  }
  if (field === "node.timeout_seconds") updateNode(index, { timeout_seconds: Number(value) });
  if (field === "node.parallelism") updateNode(index, { parallelism: Number(value) });
  if (field === "node.config") {
    const parsed = parseJsonObject(value);
    if (parsed.ok) updateNode(index, { config: parsed.value });
  }
  if (field === "node.human_input_schema") {
    if (!value.trim()) {
      updateNode(index, { human_input_schema: null });
    } else {
      const parsed = parseJsonObject(value);
      if (parsed.ok) updateNode(index, { human_input_schema: parsed.value });
    }
  }
  if (field === "edge.from") updateEdge(index, { from: value });
  if (field === "edge.to") updateEdge(index, { to: value });
  if (field === "edge.label") updateEdge(index, { label: value || null });
}

function syncTextareaState(target) {
  const field = target.dataset.field;
  if (!field) return;
  const value = target.value;
  const index = Number(target.dataset.index);

  if (field === "planner.intent") {
    state.planner.intent = value;
    state.planner.templateId = "";
    state.planner.recommendation = null;
    state.planner.candidatePlan = null;
    state.planner.dagDraft = null;
    state.planner.proposalOverrides = {};
    state.planner.error = null;
    return;
  }
  if (field === "planner.inputsText") {
    state.planner.inputsText = value;
    state.planner.candidatePlan = null;
    state.planner.dagDraft = null;
    state.planner.proposalOverrides = {};
    state.planner.error = null;
    return;
  }
  if (field === "proposal.context") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "proposal.output_contract") {
    syncProposalOverrideField(target);
    return;
  }
  if (field === "orchestrator.systemPrompt") {
    state.orchestrator.systemPrompt = value;
    return;
  }
  if (field === "template.description") state.editor.description = value;
  if (field === "template.inputSchemaText") state.editor.inputSchemaText = value;
  if (field === "template.policyText") state.editor.policyText = value;
  if (field === "template.bindingsText") state.editor.bindingsText = value;
  if (field === "template.metadataText") state.editor.metadataText = value;
  if (field === "agent.description") state.registryEditor.profile.description = value;
  if (field === "agent.metadataText") state.registryEditor.profile.metadataText = value;
  if (field === "skill.description") state.registryEditor.skill.description = value;
  if (field === "skill.inputSchemaText") state.registryEditor.skill.inputSchemaText = value;
  if (field === "skill.outputContractText") state.registryEditor.skill.outputContractText = value;
  if (field === "skill.metadataText") state.registryEditor.skill.metadataText = value;
  if (field === "node.config") {
    const parsed = parseJsonObject(value);
    if (parsed.ok && state.editor.nodes[index]) {
      state.editor.nodes[index] = { ...state.editor.nodes[index], config: parsed.value };
    }
  }
  if (field === "node.human_input_schema" && state.editor.nodes[index]) {
    if (!value.trim()) {
      state.editor.nodes[index] = { ...state.editor.nodes[index], human_input_schema: null };
    } else {
      const parsed = parseJsonObject(value);
      if (parsed.ok) {
        state.editor.nodes[index] = {
          ...state.editor.nodes[index],
          human_input_schema: parsed.value,
        };
      }
    }
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "open-command-palette") {
    openCommandPalette();
    return;
  }
  if (action === "close-command-palette") {
    closeCommandPalette();
    return;
  }
  if (action === "run-command") {
    void executeCommandPaletteItem(button.dataset.key || "");
    return;
  }
  if (action === "refresh") void loadWorkspaceData();
  if (action === "switch-nav") {
    switchDesktopNav(button.dataset.nav || "missions");
  }
  if (action === "switch-view") {
    state.activeView = button.dataset.view || "plan";
    render();
  }
  if (action === "refresh-missions") void loadMissions();
  if (action === "refresh-sessions") void loadSessions();
  if (action === "search-missions") void loadMissions();
  if (action === "search-sessions") void loadSessions();
  if (action === "set-mission-visibility") {
    state.missionVisibility = button.dataset.visibility || "active";
    void loadMissions();
  }
  if (action === "set-session-visibility") {
    state.sessionVisibility = button.dataset.visibility || "active";
    void loadSessions();
  }
  if (action === "archive-session") void updateSelectedSessionVisibility("archive");
  if (action === "unarchive-session") void updateSelectedSessionVisibility("unarchive");
  if (action === "attach-context-file") void createWorkspaceAttachment();
  if (action === "orchestrator-send-message") void sendOrchestratorMessage();
  if (action === "save-orchestrator-profile") void saveOrchestratorProfile();
  if (action === "toggle-orchestrator-setup") {
    state.ui.orchestratorSetupExpanded = !state.ui.orchestratorSetupExpanded;
    render();
  }
  if (action === "toggle-workspace-feed-expanded") {
    state.ui.workspaceFeedExpanded = !state.ui.workspaceFeedExpanded;
    buildStudioLocationState();
    render();
  }
  if (action === "set-workspace-feed-filter") {
    state.ui.workspaceFeedFilter = button.dataset.filter || "all";
    buildStudioLocationState();
    render();
  }
  if (action === "jump-output-history-entry") {
    const feedEntryKey = button.dataset.feedEntryKey || "";
    selectWorkspaceOutputHistory(findWorkspaceOutputHistoryKeyByEntryKey(state.workspaceDetail, feedEntryKey));
    state.ui.workspaceFeedFilter = button.dataset.feedFilter || "evidence";
    state.ui.workspaceFeedExpanded = true;
    pendingWorkspaceFocus = "output-history";
    pendingWorkspaceFeedEntryKey = feedEntryKey || null;
    buildStudioLocationState();
    render();
  }
  if (action === "jump-output-artifact") {
    const artifactKey = button.dataset.artifactKey || "";
    const outputHistoryKey =
      button.dataset.outputHistoryKey || findWorkspaceOutputHistoryKeyByArtifactKey(state.workspaceDetail, artifactKey);
    selectWorkspaceOutputHistory(outputHistoryKey);
    state.ui.workspaceFeedFilter = button.dataset.feedFilter || "outputs";
    state.ui.workspaceFeedExpanded = true;
    pendingWorkspaceFeedEntryKey = artifactKey || null;
    buildStudioLocationState();
    render();
  }
  if (action === "jump-checkpoint-target") {
    const targetType = button.dataset.targetType || "focus";
    const nav = button.dataset.nav || "";
    const focus = button.dataset.focus || (targetType === "feed" ? "workspace-feed" : "");
    const feedFilter = button.dataset.feedFilter || "";
    if (feedFilter) {
      state.ui.workspaceFeedFilter = feedFilter;
      state.ui.workspaceFeedExpanded = true;
    }
    if (nav && DESKTOP_NAV_ITEMS.has(nav)) {
      state.activeNav = nav;
      buildStudioLocationState();
    }
    if (focus) {
      pendingWorkspaceFocus = focus;
    }
    buildStudioLocationState();
    render();
  }
  if (action === "select-checkpoint") {
    const key = button.dataset.checkpointKey || "";
    const isSelected = state.workspaceSelection?.type === "checkpoint" && state.workspaceSelection?.key === key;
    state.workspaceSelection = isSelected || !key ? { type: "none", key: null } : { type: "checkpoint", key };
    if (!isSelected && key) {
      pendingWorkspaceFocus = "checkpoint-ledger";
    }
    buildStudioLocationState();
    render();
  }
  if (action === "select-output-history") {
    const key = button.dataset.outputHistoryKey || "";
    const isSelected =
      state.workspaceSelection?.type === "output-history" && state.workspaceSelection?.key === key;
    state.workspaceSelection = isSelected || !key ? { type: "none", key: null } : { type: "output-history", key };
    if (!isSelected && key) {
      pendingWorkspaceFocus = "output-history";
    }
    buildStudioLocationState();
    render();
  }
  if (action === "refresh-runtime") void loadRuntimeSummary();
  if (action === "run-pause") void controlRun(button.dataset.runId, "pause");
  if (action === "run-resume") void controlRun(button.dataset.runId, "resume");
  if (action === "run-cancel") void controlRun(button.dataset.runId, "cancel");
  if (action === "set-human-input-enum") {
    updateHumanInputDraft(
      button.dataset.inputRequestId || "",
      button.dataset.schemaKey || "",
      button.dataset.schemaValue || "",
    );
  }
  if (action === "toggle-human-input-boolean") {
    const inputRequestId = button.dataset.inputRequestId || "";
    const schemaKey = button.dataset.schemaKey || "";
    const current = state.humanInputDrafts[inputRequestId]?.[schemaKey] === true;
    updateHumanInputDraft(inputRequestId, schemaKey, !current);
  }
  if (action === "approve-approval") void resolveApproval(button.dataset.approvalId, "approve");
  if (action === "reject-approval") void resolveApproval(button.dataset.approvalId, "reject");
  if (action === "confirm-patch") void resolvePatch(button.dataset.patchId, "confirm");
  if (action === "reject-patch") void resolvePatch(button.dataset.patchId, "reject");
  if (action === "submit-human-input") void submitHumanInputRequest(button.dataset.inputRequestId, button);
  if (action === "submit-intervention") void submitRuntimeIntervention();
  if (action === "select-session") {
    state.activeNav = state.activeNav === "sessions" ? "sessions" : "missions";
    const nextSessionId = button.dataset.id || "";
    prepareWorkspaceSessionChange(nextSessionId);
    state.selectedSessionId = nextSessionId;
    pendingSessionInventoryScroll = true;
    void loadSessionWorkspace(state.selectedSessionId);
  }
  if (action === "refresh-registry") void loadRegistry();
  if (action === "new-agent-profile") {
    state.activeNav = "agents";
    state.registryEditor.profile = emptyAgentProfileEditor();
    render();
  }
  if (action === "new-skill") {
    state.registryEditor.skill = emptySkillEditor();
    render();
  }
  if (action === "edit-agent-profile") {
    const profile = state.agentProfiles.find((item) => item.profile_id === button.dataset.id);
    if (profile) {
      state.registryEditor.profile = editorFromAgentProfile(profile);
      render();
    }
  }
  if (action === "edit-agent-profile-from-hosting") {
    const profile = state.agentProfiles.find((item) => item.profile_id === button.dataset.id);
    if (profile) {
      state.activeNav = "agents";
      state.registryEditor.profile = editorFromAgentProfile(profile);
      render();
    }
  }
  if (action === "edit-skill") {
    const skill = state.skills.find((item) => item.skill_id === button.dataset.id);
    if (skill) {
      state.registryEditor.skill = editorFromSkill(skill);
      render();
    }
  }
  if (action === "save-agent-profile") void saveAgentProfile();
  if (action === "disable-agent-profile") void disableAgentProfile();
  if (action === "save-skill") void saveSkill();
  if (action === "disable-skill") void disableSkill();
  if (action === "new-template") {
    state.activeNav = "templates";
    state.selectedId = null;
    state.lineage = null;
    state.editor = emptyEditor();
    state.notice = "Started a new draft.";
    state.error = null;
    render();
  }
  if (action === "select-template") void selectTemplate(button.dataset.id);
  if (action === "plan-intent") void planFromIntent();
  if (action === "refresh-plan-preview") void refreshCandidatePlan();
  if (action === "generate-dag-draft") void generateDagDraft();
  if (action === "apply-plan-draft") void applyCandidatePlanToDraft();
  if (action === "save-plan-draft") void saveCandidatePlanAsDraft();
  if (action === "apply-dag-draft") void applyDagDraftToEditor();
  if (action === "save-dag-draft") void saveDagDraftAsTemplate();
  if (action === "create-dag-proposal") void createDurableDagProposal();
  if (action === "save-proposal-assignments") void saveDurableProposalAssignments();
  if (action === "confirm-dag-proposal") void confirmDurableProposal();
  if (action === "launch-proposal-run") void launchConfirmedProposalRun();
  if (action === "select-planner-template") {
    state.planner.templateId = button.dataset.id || "";
    state.planner.candidatePlan = null;
    state.planner.dagDraft = null;
    state.planner.proposalOverrides = {};
    render();
    void refreshCandidatePlan();
  }
  if (action === "save-draft") void saveDraft();
  if (action === "publish-draft") void publishDraft();
  if (action === "derive-template") void deriveSelectedTemplate();
  if (action === "new-template-version") void createSelectedTemplateVersion();
  if (action === "archive-template") void archiveSelectedTemplate();
  if (action === "add-node") addNode();
  if (action === "remove-node") removeNode(Number(button.dataset.index));
  if (action === "add-edge") addEdge();
  if (action === "remove-edge") removeEdge(Number(button.dataset.index));
});

document.addEventListener("change", (event) => handleChange(event.target));
document.addEventListener("input", (event) => {
  if (event.target.matches("textarea[data-field]")) syncTextareaState(event.target);
  if (event.target.matches("input[data-field^='proposal.']")) syncProposalOverrideField(event.target);
  if (event.target.matches("input[data-field='mission.query'], input[data-field='session.query'], input[data-field='command.query'], input[data-field^='attachment.'], input[data-field^='orchestrator.'], textarea[data-field='execution.interventionText']")) {
    handleChange(event.target);
  }
});

document.addEventListener("keydown", (event) => {
  const key = event.key;
  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }

  if (state.commandPaletteOpen) {
    if (key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
      return;
    }
    if (key === "ArrowDown") {
      event.preventDefault();
      moveCommandPaletteSelection(1);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      moveCommandPaletteSelection(-1);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      void executeCommandPaletteItem("");
      return;
    }
  }

  if (isTextEntryTarget(event.target)) return;
  if (state.activeNav !== "missions" && state.activeNav !== "sessions") return;

  if (key === "ArrowDown") {
    event.preventDefault();
    navigateSessionInventory(1);
  }
  if (key === "ArrowUp") {
    event.preventDefault();
    navigateSessionInventory(-1);
  }
  if (key === "Enter") {
    event.preventDefault();
    openSelectedSessionInventoryItem();
  }
});

hydrateStudioLocationState();
render();
void loadWorkspaceData();
void restoreWorkspaceSessionFromLocation();
