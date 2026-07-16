import DOMPurify from "/node_modules/dompurify/dist/purify.es.mjs";
import hljs from "/node_modules/@highlightjs/cdn-assets/es/highlight.min.js";
import { marked } from "/node_modules/marked/lib/marked.esm.js";
import mermaid from "/node_modules/mermaid/dist/mermaid.esm.min.mjs";
import { buildDagLayout } from "./dag-layout.js";
import { buildRuntimeGraphModel, findRuntimeNeighbor } from "./runtime-graph-model.js";
import { renderRuntimeGraphView } from "./runtime-graph-view.js";
import { deriveTaskGuidance, taskGuidanceDirective } from "./task-guidance-model.js";
import {
  AUTONOMY_MODES,
  autonomyModeCopy,
  deriveRepairGuidance,
  deriveResultQuality,
  normalizeAutonomyMode,
} from "./task-intelligence-model.js";
import {
  buildGraphPatchPreview,
  commitGraphHistory,
  createGraphHistory,
  redoGraphHistory,
  undoGraphHistory,
  validateGraphTopology,
} from "./graph-editor-model.js";
import { NEW_SETUP_CONNECTION_ID, selectSetupConnection } from "./setup-connection-model.js";
import {
  countWorkspaceChangeKinds,
  formatWorkspaceBytes,
  openWorkspaceChangeSets,
  selectWorkspaceChangeSet,
  selectWorkspaceFile,
  workspaceChangeKindSymbol,
  workspaceChangeTone,
} from "./workspace-change-diff-model.js";
import { groupWorkspaceTasks, reassignSessionProjectMetadata } from "./workspace-task-tree-model.js";

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

const CONVERSATION_UPLOAD_MAX_BYTES = 512 * 1024;
const CONVERSATION_TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".conf", ".cpp", ".cs", ".css", ".csv", ".go", ".graphql", ".h", ".hpp",
  ".html", ".ini", ".java", ".js", ".json", ".jsx", ".log", ".md", ".mjs", ".php", ".properties",
  ".py", ".rb", ".rs", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const CONVERSATION_SENSITIVE_FILE_PATTERN = /(^|[.])(env|key|pem|p12|pfx|crt|cer|der|keystore)$/i;

marked.setOptions({ gfm: true, breaks: true });
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral",
  fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
  flowchart: { htmlLabels: false, useMaxWidth: false },
  sequence: { useMaxWidth: false },
});

let artifactMermaidRenderSequence = 0;

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
const DEFAULT_PROVIDER_MAX_INPUT_TOKENS = 524288;
const DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS = 65536;
const DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT = 75;
const DEFAULT_MAX_CONTINUATION_ROUNDS = 8;
const PROVIDER_CREDENTIAL_ENVS = {
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  "claude-sdk": ["ANTHROPIC_API_KEY"],
  glm: ["GLM_API_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
  kimi: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
  openclaw: ["MY_MATE_OPENCLAW_WORKER_BRIDGE_API_KEY", "MY_MATE_OPENCLAW_BRIDGE_API_KEY"],
};
const PROVIDER_DEFAULTS = {
  codex: {
    label: "OpenAI Codex",
    provider: "openai",
    credentialEnv: "OPENAI_API_KEY",
    modelPlaceholder: "gpt-5.3-codex",
    endpointPlaceholder: "Default OpenAI endpoint",
  },
  "claude-sdk": {
    label: "Anthropic Claude",
    provider: "anthropic",
    credentialEnv: "ANTHROPIC_API_KEY",
    modelPlaceholder: "claude-sonnet-4-5",
    endpointPlaceholder: "Default Anthropic endpoint",
  },
  glm: {
    label: "GLM 5.2",
    provider: "anthropic-compatible",
    credentialEnv: "GLM_API_KEY",
    modelPlaceholder: "glm-5.2",
    endpointPlaceholder: "https://provider.example/anthropic",
  },
  kimi: {
    label: "Kimi",
    provider: "moonshot",
    credentialEnv: "KIMI_API_KEY",
    modelPlaceholder: "moonshot model id",
    endpointPlaceholder: "Default Moonshot endpoint",
  },
  openclaw: {
    label: "OpenClaw",
    provider: "openclaw",
    credentialEnv: "MY_MATE_OPENCLAW_WORKER_BRIDGE_API_KEY",
    modelPlaceholder: "OpenClaw agent id",
    endpointPlaceholder: "OpenClaw bridge URL",
  },
};
const AGENT_RUNTIMES = Object.keys(PROVIDER_CREDENTIAL_ENVS);
const PROVIDER_PROTOCOLS = {
  "codex-appserver": "Codex App Server",
  "anthropic-messages": "Anthropic Messages",
  "openai-compatible": "OpenAI compatible",
  "openclaw-bridge": "OpenClaw bridge",
};
const PROVIDER_PRESETS = {
  openai: { label: "OpenAI", runtime: "codex", protocol: "codex-appserver", provider: "openai", model: "gpt-5.3-codex" },
  anthropic: { label: "Anthropic", runtime: "claude-sdk", protocol: "anthropic-messages", provider: "anthropic", model: "claude-sonnet-4-5" },
  glm: { label: "GLM", runtime: "glm", protocol: "anthropic-messages", provider: "anthropic-compatible", model: "glm-5.2" },
  kimi: { label: "Kimi", runtime: "kimi", protocol: "openai-compatible", provider: "moonshot", model: "kimi-k2.5" },
  openclaw: { label: "OpenClaw", runtime: "openclaw", protocol: "openclaw-bridge", provider: "openclaw", model: "" },
  custom: { label: "Custom", runtime: "codex", protocol: "openai-compatible", provider: "custom", model: "" },
};

function providerRuntimeLabel(runtime) {
  return PROVIDER_DEFAULTS[runtime]?.label || runtime;
}

function renderProviderRuntimeOptions(selectedRuntime) {
  return AGENT_RUNTIMES.map(
    (runtime) => `<option value="${runtime}" ${selectedRuntime === runtime ? "selected" : ""}>${escapeHtml(providerRuntimeLabel(runtime))}</option>`,
  ).join("");
}

const CREDENTIAL_ENV_LABELS = {
  OPENAI_API_KEY: "OpenAI API key",
  CODEX_API_KEY: "Codex API key",
  ANTHROPIC_API_KEY: "Anthropic API key",
  GLM_API_KEY: "GLM API key",
  ZAI_API_KEY: "Z.AI API key",
  ZHIPU_API_KEY: "Zhipu API key",
  KIMI_API_KEY: "Kimi API key",
  MOONSHOT_API_KEY: "Moonshot API key",
  MY_MATE_OPENCLAW_WORKER_BRIDGE_API_KEY: "OpenClaw Worker key",
  MY_MATE_OPENCLAW_BRIDGE_API_KEY: "OpenClaw bridge key",
};

function credentialEnvLabel(name) {
  return `${CREDENTIAL_ENV_LABELS[name] || "Credential"} / ${name}`;
}
const DEFAULT_SKILL_SCHEMA = { type: "object" };
const DEFAULT_SKILL_OUTPUT_CONTRACT = {};
const STUDIO_API_KEY_STORAGE = "my-mate.studio.api-key";
const STUDIO_WORKSPACE_STORAGE = "my-mate.studio.workspace-id";
const STUDIO_SETUP_DISMISSED_STORAGE = "my-mate.studio.setup-dismissed";
const STUDIO_AUTONOMY_STORAGE = "my-mate.studio.autonomy-mode";
const SESSION_WORKSPACE_CACHE_TTL_MS = 120_000;
const desktopHost = globalThis.myMateDesktop || null;
const studioPerformance = {
  fullRenderCount: 0,
  taskSurfaceRenderCount: 0,
  taskSwitch: null,
  taskMove: null,
};
globalThis.__MY_MATE_PERFORMANCE__ = studioPerformance;

function performanceNow() {
  return globalThis.performance?.now?.() || Date.now();
}

function publishStudioPerformance() {
  document.documentElement?.setAttribute(
    "data-my-mate-performance",
    JSON.stringify(studioPerformance),
  );
}

function beginTaskSwitchMeasurement(sessionId, cached) {
  studioPerformance.taskSwitch = {
    sessionId,
    cached,
    startedAt: performanceNow(),
    mainVisibleMs: null,
    hydratedMs: null,
  };
  publishStudioPerformance();
}

function markTaskSwitchMainVisible(sessionId) {
  const measurement = studioPerformance.taskSwitch;
  if (!measurement || measurement.sessionId !== sessionId || measurement.mainVisibleMs !== null) return;
  measurement.mainVisibleMs = Math.round(performanceNow() - measurement.startedAt);
  publishStudioPerformance();
}

function markTaskSwitchHydrated(sessionId) {
  const measurement = studioPerformance.taskSwitch;
  if (!measurement || measurement.sessionId !== sessionId) return;
  measurement.hydratedMs = Math.round(performanceNow() - measurement.startedAt);
  publishStudioPerformance();
}

function emptyHumanInputDrafts() {
  return {};
}

function emptyOrchestratorEditor() {
  return {
    selectedProfileId: "",
    name: "Studio Orchestrator",
    provider: "",
    model: "",
    systemPrompt:
      "You are the mission orchestrator. Clarify the user's intent, define the MissionSpec, propose a DAG, assign subagents, and supervise execution until the requested deliverables are complete.",
    defaultToolsText: "",
    defaultSubagentsText: "",
  };
}

function emptyGovernanceState() {
  return {
    policy: null,
    changes: [],
    loading: false,
    saving: false,
    draft: {
      action: "agent_profile.upsert",
      resourceId: "",
      reason: "",
      payloadText: "{}",
    },
  };
}

const state = {
  templates: [],
  missions: [],
  sessions: [],
  orchestratorProfiles: [],
  agentProfiles: [],
  providerConnections: [],
  mcpConnectorPresets: [],
  mcpServers: [],
  skills: [],
  activeView: "plan",
  activeNav: "orchestrator",
  lineage: null,
  selectedId: null,
  selectedSessionId: null,
  workspaceLoadingSessionId: "",
  loading: false,
  registryLoading: false,
  orchestratorProfilesLoading: false,
  missionsLoading: false,
  sessionsLoading: false,
  sessionVisibilitySaving: false,
  runtimeLoading: false,
  dashboardLoading: false,
  memoryLoading: false,
  routeCompareLoading: false,
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
  providerConnectionTestingId: "",
  mcpServerTestingId: "",
  product: {
    autonomyMode: normalizeAutonomyMode(globalThis.localStorage?.getItem(STUDIO_AUTONOMY_STORAGE)),
    autonomySaving: false,
  },
  error: null,
  notice: null,
  runtimeSummary: null,
  dashboardSummary: null,
  memory: {
    retrievalStatus: null,
    knowledgeStatus: null,
    settings: null,
    observability: null,
    intelligenceEvaluation: null,
    maintenance: null,
    maintenanceSweep: null,
    recommendations: null,
    overlays: null,
    contexts: null,
    onboarding: null,
    effectiveness: null,
    onboardingDraft: {
      responsePreferences: "",
      validationConventions: "",
      projectConventions: "",
      private: false,
    },
    records: [],
    candidates: [],
    query: "",
    statusFilter: "active",
    scopeFilter: "all",
    kindFilter: "all",
    searchResult: null,
    rebuilding: false,
    saving: false,
    editingId: "",
    editContent: "",
    importText: "",
    importStrategy: "skip",
    importDryRun: true,
    importResult: null,
  },
  inbox: {
    approvals: [],
    humanInputs: [],
    alerts: [],
    memoryCandidates: [],
    workspaceChanges: [],
    selectedWorkspaceChangeId: "",
    selectedWorkspaceFile: "",
    confirmWorkspaceChangeAction: "",
    loading: false,
    error: null,
  },
  security: {
    identity: null,
    members: [],
    auditEvents: [],
    auditChainVerified: false,
    loading: false,
    apiKey: globalThis.localStorage?.getItem(STUDIO_API_KEY_STORAGE) || "",
    workspaceId: globalThis.localStorage?.getItem(STUDIO_WORKSPACE_STORAGE) || "",
  },
  desktop: {
    available: Boolean(desktopHost),
    loading: false,
    hostInfo: null,
    services: [],
    workspace: null,
    projects: [],
    listing: null,
    projectDraft: {
      name: "",
      description: "",
      outputRelativePath: "outputs",
    },
    error: null,
  },
  governance: emptyGovernanceState(),
  dashboardFilters: {
    windowHours: 24,
    status: "all",
    comparePrevious: true,
    costGroupBy: "agent",
  },
  workspaceDetail: null,
  missionQuery: "",
  sessionQuery: "",
  missionVisibility: "active",
  sessionVisibility: "active",
  commandPaletteOpen: false,
  commandPaletteQuery: "",
  commandPaletteIndex: 0,
  attachmentSaving: false,
  artifactPreview: {
    open: false,
    loading: false,
    compareLoading: false,
    error: null,
    tab: "preview",
    artifactId: "",
    detail: null,
    compare: null,
  },
  streamStatus: "idle",
  streamError: null,
  streamSource: null,
  conversationSocketStatus: "idle",
  conversationSocketError: null,
  conversationStream: null,
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
    connection: emptyProviderConnectionEditor(),
    mcpServer: emptyMcpServerEditor(),
    skill: emptySkillEditor(),
  },
  setup: {
    open: false,
    tab: "model",
    dismissed: globalThis.localStorage?.getItem(STUDIO_SETUP_DISMISSED_STORAGE) === "1",
    initialized: false,
    modelSaving: false,
    environmentLoading: false,
    hostReport: null,
    dockerReport: null,
    error: null,
    editorTouched: false,
  },
  orchestrator: emptyOrchestratorEditor(),
  ui: {
    orchestratorSetupExpanded: false,
    navigationTab: "task",
    workspaceFeedFilter: "all",
    workspaceFeedExpanded: false,
    taskConversationVisible: true,
    taskConversationExpanded: false,
    taskRuntimeExpanded: false,
    taskPlanExpanded: false,
    workspaceCreatorOpen: false,
    workspaceCreatorStartTask: false,
    taskMoveSessionId: "",
    taskMoveProjectId: "",
    taskSidebarQuery: "",
    runtimeOverlayOpen: false,
    runtimeNodeRunId: "",
    runtimeDrawerOpen: false,
    runtimeGraphZoom: 1,
    runtimeGraphTab: "timeline",
    runtimeGraphListFallback: false,
    authoringGraphSelection: {
      type: "none",
      index: null,
    },
    routeCompareSelection: {
      leftKey: "",
      rightKey: "",
    },
    registrySection: "connections",
    providerConnectionModalOpen: false,
    mcpServerModalOpen: false,
  },
  attachmentEditor: {
    name: "",
    storageUri: "",
    mimeType: "",
    summary: "",
  },
  attachmentFilePickerKey: 0,
  executionControl: {
    interventionText: "",
    interventionKind: "guidance",
  },
  planner: {
    intent: "",
    conversationProviderConnectionId: "",
    conversationModel: "",
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
let draggedWorkspaceTaskSessionId = "";
let pendingAuthoringGraphFocus = null;
let authoringGraphHistory = createGraphHistory({ nodes: [], edges: [], metadataText: "{}" });
let authoringGraphSavedSnapshot = { nodes: [], edges: [], metadataText: "{}" };
let authoringGraphConnection = null;
let authoringNodeDrag = null;
let restoreWorkspaceFocusFromLocation = false;
let workspaceLoadSeq = 0;
let workspaceLoadController = null;
let missionSearchTimer = null;
let sessionSearchTimer = null;
let taskSidebarSearchTimer = null;
let runtimeSupervisionTimer = null;
let runtimeSupervisionRunId = "";
let runtimeSupervisionCursor = "";
let sessionStreamErrorTimer = null;
let pendingRuntimeNodeFocus = false;
let conversationSocket = null;
let conversationSocketSessionId = "";
let conversationSocketOpenPromise = null;
const conversationSocketRequests = new Map();
const autopilotAdvanceAttempts = new Set();
const pendingTaskMoveStreamSessions = new Set();
const sessionWorkspaceCache = new Map();

const DESKTOP_NAV_ITEMS = new Set([
  "orchestrator",
  "inbox",
  "library",
  "missions",
  "sessions",
  "dashboard",
  "memory",
  "agents",
  "templates",
  "registry",
  "settings",
  "operations",
]);
const TASK_NAV_IDS = new Set(["orchestrator", "inbox", "library", "settings"]);
const ADVANCED_NAV_IDS = new Set([
  "missions",
  "sessions",
  "dashboard",
  "memory",
  "agents",
  "templates",
  "registry",
  "operations",
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
    agentRuntime: "codex",
    harnessProfile: "agent-harness-v1",
    providerConnectionId: "",
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

function emptyProviderConnectionEditor() {
  return {
    mode: "new",
    connectionId: "",
    status: "active",
    name: "",
    preset: "openai",
    agentRuntime: "codex",
    provider: "openai",
    protocol: "codex-appserver",
    baseUrl: "",
    models: ["gpt-5.3-codex"],
    defaultModel: "gpt-5.3-codex",
    maxInputTokens: DEFAULT_PROVIDER_MAX_INPUT_TOKENS,
    maxOutputTokens: DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS,
    contextCompressionEnabled: true,
    contextCompressionThresholdPercent: DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
    maxContinuationRounds: DEFAULT_MAX_CONTINUATION_ROUNDS,
    credentialSource: "managed",
    credentialEnv: "OPENAI_API_KEY",
    apiKey: "",
    credentialConfigured: false,
    metadataText: prettyJson(DEFAULT_REGISTRY_METADATA),
  };
}

function emptyMcpServerEditor() {
  return {
    mode: "new",
    presetId: "custom",
    presetSecretValues: {},
    serverId: "",
    name: "",
    description: "",
    transport: desktopHost?.mcp?.configure ? "stdio" : "streamable-http",
    command: "",
    argsText: "",
    url: "",
    headersText: "{}",
    environmentText: "{}",
    secretsText: "{}",
    includeToolsText: "",
    excludeToolsText: "",
    defaultRiskLevel: "",
    riskOverridesText: "{}",
    connectTimeoutMs: 30000,
    toolTimeoutMs: 60000,
    enabled: true,
    status: "disconnected",
    secretConfigured: false,
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
    agentRuntime: profile.agent_runtime || "openclaw",
    harnessProfile: profile.harness_profile || "",
    providerConnectionId: profile.provider_connection_id || "",
    openclawAgentId: profile.runtime_agent_ref || profile.openclaw_agent_id || "",
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

function editorFromProviderConnection(connection) {
  const preset = Object.entries(PROVIDER_PRESETS).find(([, item]) =>
    item.runtime === connection.agent_runtime && item.provider === connection.provider
  )?.[0] || "custom";
  return {
    mode: "edit",
    connectionId: connection.connection_id,
    status: connection.status || "active",
    name: connection.name || connection.connection_id,
    preset,
    agentRuntime: connection.agent_runtime || "codex",
    provider: connection.provider || "",
    protocol: connection.protocol || PROVIDER_PRESETS[preset]?.protocol || "openai-compatible",
    baseUrl: connection.base_url || "",
    models: connection.models?.length ? [...connection.models] : [connection.default_model || ""],
    defaultModel: connection.default_model || "",
    maxInputTokens: connection.max_input_tokens || DEFAULT_PROVIDER_MAX_INPUT_TOKENS,
    maxOutputTokens: connection.max_output_tokens || DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS,
    contextCompressionEnabled: connection.context_compression_enabled !== false,
    contextCompressionThresholdPercent: connection.context_compression_threshold_percent || DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
    maxContinuationRounds: Number.isInteger(connection.max_continuation_rounds)
      ? connection.max_continuation_rounds
      : DEFAULT_MAX_CONTINUATION_ROUNDS,
    credentialSource: connection.credential_source || "environment",
    credentialEnv: connection.credential_env || "",
    apiKey: "",
    credentialConfigured: connection.credential_configured === true,
    metadataText: prettyJson(connection.metadata || {}),
  };
}

function editorFromMcpServer(server) {
  const preset = state.mcpConnectorPresets.find((item) =>
    item.transport === server.transport && item.server?.url && item.server.url === server.url
  );
  return {
    mode: "edit",
    presetId: preset?.preset_id || "custom",
    presetSecretValues: {},
    serverId: server.server_id || "",
    name: server.name || server.server_id || "",
    description: server.description || "",
    transport: server.transport || "streamable-http",
    command: server.command || "",
    argsText: (server.args || []).join("\n"),
    url: server.url || "",
    headersText: prettyJson(server.headers || {}),
    environmentText: prettyJson(server.environment || {}),
    secretsText: "{}",
    includeToolsText: (server.tool_filter?.include || []).join(", "),
    excludeToolsText: (server.tool_filter?.exclude || []).join(", "),
    defaultRiskLevel: server.default_risk_level || "",
    riskOverridesText: prettyJson(server.tool_risk_overrides || {}),
    connectTimeoutMs: server.connect_timeout_ms || 30000,
    toolTimeoutMs: server.tool_timeout_ms || 60000,
    enabled: server.enabled !== false,
    status: server.status || "disconnected",
    secretConfigured: server.secret_configured === true,
  };
}

function editorFromMcpConnectorPreset(preset) {
  const server = preset?.server || {};
  return {
    ...emptyMcpServerEditor(),
    presetId: preset?.preset_id || "custom",
    presetSecretValues: Object.fromEntries((preset?.secrets || []).map((secret) => [secret.name, ""])),
    serverId: server.server_id || "",
    name: server.name || preset?.name || "",
    description: server.description || preset?.description || "",
    transport: preset?.transport || server.transport || "streamable-http",
    command: server.command || "",
    argsText: (server.args || []).join("\n"),
    url: server.url || "",
    headersText: prettyJson(server.headers || {}),
    environmentText: prettyJson(server.environment || {}),
    includeToolsText: (server.tool_filter?.include || []).join(", "),
    excludeToolsText: (server.tool_filter?.exclude || []).join(", "),
    defaultRiskLevel: server.default_risk_level || "",
    riskOverridesText: prettyJson(server.tool_risk_overrides || {}),
    connectTimeoutMs: server.connect_timeout_ms || 30000,
    toolTimeoutMs: server.tool_timeout_ms || 60000,
    enabled: server.enabled === true,
  };
}

function runtimeAgentRefOf(value) {
  return value?.runtime_agent_ref || value?.openclaw_agent_id || "";
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

function renderMarkdown(value) {
  const dirty = marked.parse(String(value || ""), { async: false });
  const clean = DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["audio", "button", "embed", "form", "iframe", "img", "input", "object", "select", "source", "style", "textarea", "video"],
    FORBID_ATTR: ["style", "srcset"],
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  template.content.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  return template.innerHTML;
}

function artifactCodeLanguage(code) {
  const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
  return languageClass ? languageClass.slice("language-".length).trim().toLowerCase() : "";
}

function looksLikeMermaidSource(value) {
  const firstMeaningfulLine = String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
  return /^(?:%%|graph\s+(?:TB|TD|BT|RL|LR)\b|flowchart\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|journey\b|gantt\b|pie\b|mindmap\b|timeline\b|gitGraph\b|quadrantChart\b|xychart-beta\b|block-beta\b|architecture-beta\b|packet-beta\b|kanban\b)/i.test(firstMeaningfulLine);
}

function createArtifactCodeToolbar(label, actions) {
  const toolbar = document.createElement("div");
  toolbar.className = "artifact-code-toolbar";
  const language = document.createElement("span");
  language.className = "artifact-code-language";
  language.textContent = label || "Code";
  const actionGroup = document.createElement("div");
  actionGroup.className = "artifact-code-actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.className = "artifact-code-action";
    button.type = "button";
    button.dataset.action = action.action;
    button.textContent = action.label;
    if (action.title) button.title = action.title;
    actionGroup.append(button);
  }
  toolbar.append(language);
  if (actions.length) toolbar.append(actionGroup);
  return toolbar;
}

function renderArtifactMarkdown(value) {
  const template = document.createElement("template");
  template.innerHTML = renderMarkdown(value);
  template.content.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement;
    if (!pre) return;
    const source = code.textContent || "";
    const language = artifactCodeLanguage(code);
    if (language === "mermaid" || (!language && looksLikeMermaidSource(source))) {
      const diagram = document.createElement("section");
      diagram.className = "artifact-mermaid";
      diagram.dataset.mermaidStatus = "pending";
      const toolbar = createArtifactCodeToolbar("Mermaid diagram", [
        { action: "toggle-artifact-mermaid-source", label: "Source", title: "Show Mermaid source" },
      ]);
      const canvas = document.createElement("div");
      canvas.className = "artifact-mermaid-canvas";
      canvas.dataset.mermaidCanvas = "true";
      canvas.innerHTML = '<span class="artifact-mermaid-loading">Rendering diagram...</span>';
      const sourcePre = document.createElement("pre");
      sourcePre.className = "artifact-mermaid-source";
      sourcePre.hidden = true;
      const sourceCode = document.createElement("code");
      sourceCode.textContent = source;
      sourcePre.append(sourceCode);
      diagram.append(toolbar, canvas, sourcePre);
      pre.replaceWith(diagram);
      return;
    }

    let highlighted;
    try {
      highlighted = language && hljs.getLanguage(language)
        ? hljs.highlight(source, { language, ignoreIllegals: true })
        : hljs.highlightAuto(source);
    } catch {
      highlighted = { value: escapeHtml(source), language: language || "text" };
    }
    code.className = "hljs";
    code.innerHTML = highlighted.value;
    const block = document.createElement("section");
    block.className = "artifact-code-block";
    const label = language || highlighted.language || "text";
    block.append(
      createArtifactCodeToolbar(label, []),
    );
    pre.replaceWith(block);
    block.append(pre);
  });
  return template.innerHTML;
}

async function hydrateArtifactMermaidDiagrams() {
  const diagrams = [...document.querySelectorAll('.artifact-mermaid[data-mermaid-status="pending"]')];
  for (const diagram of diagrams) {
    diagram.dataset.mermaidStatus = "rendering";
    const source = diagram.querySelector(".artifact-mermaid-source code")?.textContent || "";
    const canvas = diagram.querySelector("[data-mermaid-canvas]");
    if (!canvas || !source.trim()) {
      diagram.dataset.mermaidStatus = "error";
      continue;
    }
    const renderId = `artifact-mermaid-${++artifactMermaidRenderSequence}`;
    try {
      const result = await mermaid.render(renderId, source);
      if (!diagram.isConnected) continue;
      canvas.innerHTML = DOMPurify.sanitize(result.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ["foreignObject"],
      });
      result.bindFunctions?.(canvas);
      diagram.dataset.mermaidStatus = "ready";
    } catch (error) {
      if (!diagram.isConnected) continue;
      diagram.dataset.mermaidStatus = "error";
      canvas.innerHTML = `<div class="artifact-mermaid-error"><strong>Diagram could not be rendered.</strong><span>${escapeHtml(error instanceof Error ? error.message : "Invalid Mermaid syntax")}</span></div>`;
      const sourcePre = diagram.querySelector(".artifact-mermaid-source");
      if (sourcePre) sourcePre.hidden = false;
    }
  }
}

function toggleArtifactMermaidSource(button) {
  const diagram = button.closest(".artifact-mermaid");
  const source = diagram?.querySelector(".artifact-mermaid-source");
  if (!source) return;
  source.hidden = !source.hidden;
  button.textContent = source.hidden ? "Source" : "Hide source";
  button.setAttribute("aria-expanded", String(!source.hidden));
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isConversationInputAttachment(attachment) {
  return (
    attachment?.kind !== "generated_output" &&
    attachment?.metadata?.source !== "conversation_generated_output"
  );
}

function filterConversationInputAttachments(attachments) {
  return Array.isArray(attachments) ? attachments.filter(isConversationInputAttachment) : [];
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

function getRuntimeExecutionLabel(runtime) {
  return runtime?.runtime_dispatcher?.kind || runtime?.adapter_kind || "unknown";
}

function formatRuntimeCapacityValue(current, limit) {
  return Number.isFinite(current) && Number.isFinite(limit) && limit > 0
    ? `${current} / ${limit}`
    : "n/a";
}

function formatRuntimeQueueTimeout(value) {
  if (!Number.isFinite(value) || value <= 0) return "n/a";
  if (value >= 60000 && value % 60000 === 0) return `${value / 60000}m`;
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000}s`;
  return `${value}ms`;
}

function normalizeTone(value) {
  return ["neutral", "warn", "success", "danger"].includes(value) ? value : statusTone(value);
}

function compareLabelForKind(kind) {
  if (kind === "option") return "Option";
  if (kind === "revision") return "Revision";
  if (kind === "confirmed_vs_latest") return "Confirmed vs latest";
  if (kind === "same_route") return "Same route";
  return "Compare";
}

function buildRouteCompareSelectionKey(revision, option) {
  return `${typeof revision === "number" ? revision : "none"}:${option === "alternative" ? "alternative" : "primary"}`;
}

function parseRouteCompareSelectionKey(key) {
  const [revisionPart, optionPart] = String(key || "").split(":");
  const revision = Number(revisionPart);
  return {
    revision: Number.isInteger(revision) && revision > 0 ? revision : null,
    option: optionPart === "alternative" ? "alternative" : "primary",
  };
}

function routeCompareSideSubtitle(side) {
  if (!side) return "No route";
  const parts = [];
  if (typeof side.nodeCount === "number") parts.push(`${side.nodeCount} nodes`);
  if (typeof side.edgeCount === "number") parts.push(`${side.edgeCount} edges`);
  if (typeof side.outputCount === "number") parts.push(`${side.outputCount} outputs`);
  if (typeof side.warningCount === "number" && side.warningCount > 0) {
    parts.push(`${side.warningCount} warnings`);
  }
  return parts.join(" / ") || "No route stats";
}

function listWorkspacePlanningRoutes(detail = state.workspaceDetail) {
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const entries = [];
  const seen = new Set();
  for (const message of messages) {
    if (message?.kind !== "plan_options_card" && message?.kind !== "plan_card") continue;
    const revision = typeof message?.content?.revision === "number" ? message.content.revision : null;
    if (revision === null) continue;
    const includeAlternative =
      message.kind === "plan_options_card" && isRecord(message.content.alternative);
    const options = includeAlternative ? ["primary", "alternative"] : ["primary"];
    for (const option of options) {
      const payload =
        message.kind === "plan_options_card"
          ? message.content[option]
          : option === "primary"
            ? message.content
            : null;
      if (!isRecord(payload)) continue;
      const key = buildRouteCompareSelectionKey(revision, option);
      if (seen.has(key)) continue;
      seen.add(key);
      const candidatePlan = isRecord(payload.candidate_plan) ? payload.candidate_plan : null;
      const confirmationChecklist = isRecord(payload.confirmation_checklist) ? payload.confirmation_checklist : null;
      const validation = isRecord(payload.validation) ? payload.validation : null;
      const templateName =
        typeof payload.template_name === "string" && payload.template_name.trim()
          ? payload.template_name.trim()
          : typeof payload.template_id === "string" && payload.template_id.trim()
            ? payload.template_id.trim()
            : `v${revision}`;
      const nodeCount =
        Array.isArray(candidatePlan?.compiled_nodes) ? candidatePlan.compiled_nodes.length : null;
      const edgeCount = Array.isArray(candidatePlan?.edges) ? candidatePlan.edges.length : null;
      const warningCount =
        Array.isArray(validation?.warnings)
          ? validation.warnings.length
          : typeof confirmationChecklist?.warning_count === "number"
            ? confirmationChecklist.warning_count
            : 0;
      entries.push({
        key,
        revision,
        option,
        label: `v${revision} / ${option}`,
        templateName,
        nodeCount,
        edgeCount,
        warningCount,
        payload,
        createdAt: message.created_at || "",
        confirmed:
          detail?.session?.confirmed_plan_revision === revision &&
          (detail?.session?.confirmed_plan_option || "primary") === option,
        selected:
          detail?.mission_spec?.route?.activeRevision === revision &&
          (detail?.mission_spec?.route?.activeOption || "primary") === option,
      });
    }
  }
  return entries.sort((left, right) => {
    if (right.revision !== left.revision) return right.revision - left.revision;
    if (left.option === right.option) return 0;
    return left.option === "primary" ? -1 : 1;
  });
}

function buildRouteCompareQuery(selection) {
  const params = new URLSearchParams();
  if (typeof selection?.leftRevision === "number") {
    params.set("left_revision", String(selection.leftRevision));
  }
  if (selection?.leftOption) {
    params.set("left_option", selection.leftOption);
  }
  if (typeof selection?.rightRevision === "number") {
    params.set("right_revision", String(selection.rightRevision));
  }
  if (selection?.rightOption) {
    params.set("right_option", selection.rightOption);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function getActiveRouteCompareSelection(detail = state.workspaceDetail) {
  const compare = detail?.route_compare || null;
  if (compare?.left || compare?.right) {
    return {
      leftKey: buildRouteCompareSelectionKey(compare.left?.revision, compare.left?.option),
      rightKey: buildRouteCompareSelectionKey(compare.right?.revision, compare.right?.option),
    };
  }
  const history = listWorkspacePlanningRoutes(detail);
  return {
    leftKey: history[1]?.key || history[0]?.key || "",
    rightKey: history[0]?.key || "",
  };
}

function synchronizeRouteCompareSelection(detail = state.workspaceDetail) {
  const history = listWorkspacePlanningRoutes(detail);
  if (!history.length) {
    state.ui.routeCompareSelection = { leftKey: "", rightKey: "" };
    return;
  }
  const next = { ...state.ui.routeCompareSelection };
  if (!history.some((entry) => entry.key === next.leftKey)) {
    next.leftKey = history[1]?.key || history[0].key;
  }
  if (!history.some((entry) => entry.key === next.rightKey)) {
    next.rightKey = history[0].key;
  }
  if (!next.leftKey) next.leftKey = history[1]?.key || history[0].key;
  if (!next.rightKey) next.rightKey = history[0].key;
  state.ui.routeCompareSelection = next;
}

function getRouteCompareNodeIdentity(node, index) {
  return String(node?.node_id || node?.id || node?.node_run_id || node?.name || `node-${index + 1}`);
}

function getRouteCompareNodeName(node, fallback) {
  return String(node?.name || fallback || "").trim() || fallback;
}

function buildRouteCompareGraphSide(side) {
  if (!isRecord(side)) return { nodes: [], edges: [] };
  const payload = isRecord(side.payload) ? side.payload : {};
  const candidatePlan = isRecord(payload.candidate_plan) ? payload.candidate_plan : null;
  const compiledNodes = Array.isArray(candidatePlan?.compiled_nodes) ? candidatePlan.compiled_nodes : [];
  const rawEdges = Array.isArray(candidatePlan?.edges) ? candidatePlan.edges : [];
  const nodeIndexById = new Map();
  compiledNodes.forEach((node, index) => {
    const nodeId = getRouteCompareNodeIdentity(node, index);
    nodeIndexById.set(nodeId, index);
  });
  const layoutNodeIds = compiledNodes.map((_, index) => `route-node-${index}`);
  const edges = rawEdges.map((edge, index) => {
    const from = String(edge?.from || "");
    const to = String(edge?.to || "");
    const fromIndex = nodeIndexById.has(from) ? nodeIndexById.get(from) : -1;
    const toIndex = nodeIndexById.has(to) ? nodeIndexById.get(to) : -1;
    const valid = fromIndex >= 0 && toIndex >= 0;
    return {
      key: `${from}->${to}:${index}`,
      from,
      to,
      fromIndex,
      toIndex,
      label:
        typeof edge?.label === "string" && edge.label.trim()
          ? edge.label.trim()
          : isRecord(edge?.condition)
            ? "conditional"
            : "",
      valid,
    };
  });
  const layout = buildDagLayout(
    compiledNodes.map((_, index) => ({ id: layoutNodeIds[index], order: index, width: 164, height: 70 })),
    edges
      .filter((edge) => edge.valid)
      .map((edge) => ({ id: edge.key, from: layoutNodeIds[edge.fromIndex], to: layoutNodeIds[edge.toIndex] })),
    { paddingX: 20, paddingY: 20, columnGap: 36, rowGap: 26, minWidth: 420, minHeight: 180 },
  );
  const layoutNodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const layoutEdgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const nodes = compiledNodes.map((node, index) => {
    const id = getRouteCompareNodeIdentity(node, index);
    const positioned = layoutNodeById.get(layoutNodeIds[index]);
    return {
      key: id,
      id,
      label: getRouteCompareNodeName(node, id),
      type: String(node?.type || "agent_task"),
      agent: String(node?.agent_profile || ""),
      column: positioned?.column || 0,
      row: positioned?.row || 0,
      x: positioned?.x || 20,
      y: positioned?.y || 20,
    };
  });
  return {
    nodes,
    edges: edges.map((edge) => {
      const positioned = layoutEdgeById.get(edge.key);
      return {
        ...edge,
        fromX: positioned?.fromX || 0,
        fromY: positioned?.fromY || 0,
        toX: positioned?.toX || 0,
        toY: positioned?.toY || 0,
      };
    }),
    width: layout.width,
    height: layout.height,
  };
}

function buildRouteCompareDiffBrowser(detail = state.workspaceDetail) {
  const compare = detail?.route_compare || null;
  const history = listWorkspacePlanningRoutes(detail);
  const activeSelection = getActiveRouteCompareSelection(detail);
  if (!compare) {
    return {
      history,
      selection: activeSelection,
      compare: null,
      leftGraph: { nodes: [], edges: [], width: 420, height: 180 },
      rightGraph: { nodes: [], edges: [], width: 420, height: 180 },
      nodeDiffSet: new Map(),
      edgeDiffSet: new Map(),
      summary: "",
    };
  }
  const leftRoute = history.find((entry) => entry.key === buildRouteCompareSelectionKey(compare.left?.revision, compare.left?.option)) || null;
  const rightRoute = history.find((entry) => entry.key === buildRouteCompareSelectionKey(compare.right?.revision, compare.right?.option)) || null;
  const leftGraph = buildRouteCompareGraphSide(leftRoute);
  const rightGraph = buildRouteCompareGraphSide(rightRoute);
  const nodeDiffSet = new Map();
  for (const label of compare.changedNodes?.added || []) nodeDiffSet.set(label, "added");
  for (const label of compare.changedNodes?.removed || []) nodeDiffSet.set(label, "removed");
  for (const label of compare.changedNodes?.changed || []) nodeDiffSet.set(label, "changed");
  const edgeDiffSet = new Map();
  for (const label of compare.changedEdges?.added || []) edgeDiffSet.set(label, "added");
  for (const label of compare.changedEdges?.removed || []) edgeDiffSet.set(label, "removed");
  for (const label of compare.changedEdges?.changed || []) edgeDiffSet.set(label, "changed");
  const recommendationDetail = compare.recommendation?.detail || "";
  const summary =
    (compare.summaryLines || [])
      .filter((line) => !/^Comparing /i.test(line))
      .filter((line) => !recommendationDetail || line !== recommendationDetail)
      .slice(0, 2)
      .join(" ") ||
    recommendationDetail ||
    "No material route changes detected.";
  return {
    history,
    selection: activeSelection,
    compare,
    leftGraph,
    rightGraph,
    nodeDiffSet,
    edgeDiffSet,
    summary,
  };
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

function getPatchOperations(patch) {
  return Array.isArray(patch?.operations)
    ? patch.operations.filter((operation) => operation && typeof operation === "object")
    : [];
}

function formatSignedPatchDelta(label, value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${label} ${value >= 0 ? "+" : ""}${value}`
    : null;
}

function patchConfirmationSummary(patch) {
  const status = patch?.status || "proposed";
  if (status === "applied") return "Applied and preserved in the runtime audit trail.";
  if (status === "applied_with_errors") return "Partially applied; inspect failed operation outcomes.";
  if (status === "rejected") return "Rejected and preserved as an audit record.";
  if (patch?.apply_supported) return "Apply-ready after human confirmation.";
  return patch?.unsupported_reason || "Preserved for audit, but not live-apply ready.";
}

function renderPatchReviewSummary(patch) {
  const operations = getPatchOperations(patch);
  const outcomes = getPatchOperationOutcomes(patch);
  const preview = getPatchGraphPreview(patch);
  const impact = [
    formatSignedPatchDelta("nodes", preview?.node_delta),
    formatSignedPatchDelta("edges", preview?.edge_delta),
    formatSignedPatchDelta("parallelism", preview?.parallelism_delta),
  ].filter(Boolean);
  const appliedCount = outcomes.filter((outcome) => outcome.applied === true).length;
  const failedCount = outcomes.filter((outcome) => outcome.applied !== true).length;
  return `
    <div class="patch-review-summary">
      <span>${escapeHtml(`${operations.length} operation${operations.length === 1 ? "" : "s"}`)}</span>
      ${impact.length ? `<span>${escapeHtml(`Impact: ${impact.join(", ")}`)}</span>` : ""}
      ${
        outcomes.length
          ? `<span>${escapeHtml(`Outcomes: ${appliedCount} applied${failedCount ? `, ${failedCount} failed` : ""}`)}</span>`
          : ""
      }
      <span>${escapeHtml(patchConfirmationSummary(patch))}</span>
    </div>
  `;
}

function renderPatchOperationReview(patch) {
  const operations = getPatchOperations(patch);
  if (!operations.length) {
    return '<small>No structured patch operations recorded.</small>';
  }
  return `
    <div class="patch-operation-review">
      ${operations
        .map((operation, index) => {
          const op = operation.op || "operation";
          const value = operation.value && typeof operation.value === "object" ? operation.value : null;
          const requestedStep = value && typeof value.requested_step === "string" ? value.requested_step : null;
          const requestedParallelism =
            value && value.requested_parallelism !== undefined ? String(value.requested_parallelism) : null;
          return `
            <div class="patch-operation-row">
              <div class="patch-outcome-head">
                <strong>${escapeHtml(op.replace(/_/g, " "))}</strong>
                <span class="badge ${operation.supported === false ? "neutral" : "warn"}">${escapeHtml(operation.supported === false ? "mapping needed" : "mapped")}</span>
              </div>
              ${
                operation.node_name || operation.node_id
                  ? `<small>${escapeHtml(`Target: ${operation.node_name || operation.node_id}`)}</small>`
                  : ""
              }
              ${requestedStep ? `<small>${escapeHtml(`Requested step: ${requestedStep}`)}</small>` : ""}
              ${requestedParallelism ? `<small>${escapeHtml(`Requested parallelism: ${requestedParallelism}`)}</small>` : ""}
              ${operation.reason ? `<small>${escapeHtml(operation.reason)}</small>` : ""}
              <small>${escapeHtml(`Order: ${index + 1}`)}</small>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPatchOutcomeReview(patch) {
  const outcomes = getPatchOperationOutcomes(patch);
  if (!outcomes.length) {
    return "";
  }
  return `
    <div class="patch-outcome-list">
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
    </div>
  `;
}

function renderPatchTopologyComparison(patch) {
  const preview = getPatchGraphPreview(patch);
  const topology = getPatchTopology(patch);
  const before = preview?.before_topology && typeof preview.before_topology === "object"
    ? preview.before_topology
    : null;
  const predicted = preview?.predicted_topology && typeof preview.predicted_topology === "object"
    ? preview.predicted_topology
    : null;
  const actual = preview?.actual_topology && typeof preview.actual_topology === "object"
    ? preview.actual_topology
    : null;
  const cards = [
    before ? renderPatchTopologySnapshotCard("Before", before, "neutral") : "",
    predicted ? renderPatchTopologySnapshotCard("Predicted", predicted, "warn") : "",
    actual ? renderPatchTopologySnapshotCard("Actual", actual, "success") : "",
  ].filter(Boolean);
  if (!cards.length && topology) {
    cards.push(renderPatchTopologySnapshotCard("Latest", topology, patchStatusTone(patch?.status)));
  }
  return cards.length ? `<div class="patch-topology-compact-grid">${cards.join("")}</div>` : "";
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

function getWorkspaceSelectedRunId(detail) {
  return detail?.selected_run_id || detail?.latest_run?.run_id || null;
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

function renderRouteCompareHistoryPicker(browser) {
  if (!browser.history.length) return "";
  return `
    <div class="route-compare-history">
      ${browser.history
        .map((entry) => `
          <button class="route-compare-history-item ${browser.selection.leftKey === entry.key || browser.selection.rightKey === entry.key ? "selected" : ""}" data-action="pick-route-compare-history" data-key="${escapeHtml(entry.key)}">
            <strong>${escapeHtml(entry.label)}</strong>
            <small>${escapeHtml(entry.templateName)}</small>
            <small>${escapeHtml(`${entry.nodeCount ?? 0} nodes / ${entry.edgeCount ?? 0} edges${entry.warningCount ? ` / ${entry.warningCount} warnings` : ""}`)}</small>
            <span class="route-compare-history-flags">
              ${entry.confirmed ? '<span class="badge success">confirmed</span>' : ""}
              ${entry.selected ? '<span class="badge warn">active</span>' : ""}
            </span>
          </button>
        `)
        .join("")}
    </div>
  `;
}

function renderRouteCompareSideSelector(side, browser) {
  const currentKey = side === "left" ? browser.selection.leftKey : browser.selection.rightKey;
  const current = browser.history.find((entry) => entry.key === currentKey) || null;
  return `
    <label class="route-compare-selector">
      <span>${escapeHtml(side === "left" ? "Left route" : "Right route")}</span>
      <select data-field="${escapeHtml(`route-compare.${side}`)}">
        ${browser.history
          .map(
            (entry) => `
              <option value="${escapeHtml(entry.key)}" ${entry.key === currentKey ? "selected" : ""}>
                ${escapeHtml(`${entry.label} - ${entry.templateName}`)}
              </option>
            `,
          )
          .join("")}
      </select>
      <small>${escapeHtml(current ? `${current.templateName} / ${current.nodeCount ?? 0} nodes / ${current.edgeCount ?? 0} edges` : "No route selected")}</small>
    </label>
  `;
}

function renderRouteCompareGraphNode(node, diffSet, side) {
  const tone = diffSet.get(`${node.label} (${node.id})`) || diffSet.get(node.label) || "";
  return `
    <div class="route-compare-node ${tone ? `diff-${tone}` : ""}" style="left: ${node.x}px; top: ${node.y}px;" data-side="${escapeHtml(side)}">
      <strong>${escapeHtml(node.label)}</strong>
      <small>${escapeHtml(node.id)}</small>
      <span>${escapeHtml(node.type)}</span>
      ${node.agent ? `<span>${escapeHtml(node.agent)}</span>` : ""}
    </div>
  `;
}

function renderRouteCompareGraphEdge(edge, diffSet) {
  if (!edge.valid) return "";
  const label = `${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`;
  const tone = diffSet.get(label) || "";
  const bend = Math.max(edge.fromX + 28, edge.toX - 28);
  const path = `M ${edge.fromX} ${edge.fromY} C ${bend} ${edge.fromY}, ${bend} ${edge.toY}, ${edge.toX} ${edge.toY}`;
  return `<path class="route-compare-line ${tone ? `diff-${tone}` : ""}" d="${path}"></path>`;
}

function renderRouteCompareGraphSurface(title, route, graph, nodeDiffSet, edgeDiffSet, side) {
  if (!route) {
    return `
      <section class="route-compare-graph-card">
        <div class="subpanel-header">
          <strong>${escapeHtml(title)}</strong>
          <span class="badge neutral">No route</span>
        </div>
        <p class="muted">No comparable graph is available for this endpoint.</p>
      </section>
    `;
  }
  return `
    <section class="route-compare-graph-card">
      <div class="subpanel-header">
        <strong>${escapeHtml(title)}</strong>
        <span class="badge ${route.confirmed ? "success" : route.selected ? "warn" : "neutral"}">${escapeHtml(route.label)}</span>
      </div>
      <p class="muted">${escapeHtml(route.templateName)}</p>
      <small>${escapeHtml(routeCompareSideSubtitle(route))}</small>
      <div class="route-compare-graph-surface">
        <div class="route-compare-graph-canvas" style="width: ${graph.width}px; height: ${graph.height}px;">
          <svg class="route-compare-graph-lines" viewBox="0 0 ${graph.width} ${graph.height}" aria-hidden="true">
            ${graph.edges.map((edge) => renderRouteCompareGraphEdge(edge, edgeDiffSet)).join("")}
          </svg>
          ${graph.nodes.map((node) => renderRouteCompareGraphNode(node, nodeDiffSet, side)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderRouteCompareDetailList(compare) {
  const sections = [
    ["Nodes", compare.changedNodes, "neutral"],
    ["Edges", compare.changedEdges, "neutral"],
    ["Gates", compare.changedApprovals, "warn"],
    ["Outputs", compare.changedOutputs, "success"],
    ["Risks", compare.changedRisks, "warn"],
  ]
    .map(([title, changeSet, tone]) => renderRouteCompareGroup(title, changeSet, tone))
    .filter(Boolean);
  return sections.length
    ? `<div class="route-compare-grid">${sections.join("")}</div>`
    : '<p class="muted">No changed nodes, gates, outputs, or risks.</p>';
}

function renderRouteComparePanel(compare) {
  const browser = buildRouteCompareDiffBrowser();
  if (!compare && !browser.history.length) {
    return "";
  }
  const leftRoute = browser.history.find((entry) => entry.key === browser.selection.leftKey) || null;
  const rightRoute = browser.history.find((entry) => entry.key === browser.selection.rightKey) || null;
  const compareKind = compare ? compareLabelForKind(compare.comparisonKind) : "Route";

  return `
    <section class="subpanel route-compare-panel" data-workspace-focus="compare">
      <div class="subpanel-header">
        <strong>Route Compare</strong>
        <span class="badge ${escapeHtml(compare?.recommendation?.tone || "neutral")}">${escapeHtml(compare?.recommendation?.label || compareKind)}</span>
      </div>
      <div class="route-compare-toolbar">
        <div class="route-compare-selectors">
          ${renderRouteCompareSideSelector("left", browser)}
          ${renderRouteCompareSideSelector("right", browser)}
        </div>
        <button class="secondary" data-action="refresh-route-compare" ${state.routeCompareLoading ? "disabled" : ""}>
          ${state.routeCompareLoading ? "Refreshing..." : "Refresh compare"}
        </button>
      </div>
      ${renderRouteCompareHistoryPicker(browser)}
      ${
        compare
          ? `
            <div class="route-compare-endpoints">
              <div>
                <span>Left</span>
                <strong>${escapeHtml(compare.left?.label || "left")}</strong>
                <small>${escapeHtml(compare.left?.templateName || compare.left?.templateId || "No template")}</small>
                <small>${escapeHtml(routeCompareSideSubtitle(compare.left))}</small>
              </div>
              <div>
                <span>Right</span>
                <strong>${escapeHtml(compare.right?.label || "right")}</strong>
                <small>${escapeHtml(compare.right?.templateName || compare.right?.templateId || "No template")}</small>
                <small>${escapeHtml(routeCompareSideSubtitle(compare.right))}</small>
              </div>
            </div>
            ${
              compare.recommendation?.detail
                ? `<div class="route-compare-recommendation ${escapeHtml(compare.recommendation.tone || "neutral")}">
                    <p>${escapeHtml(compare.recommendation.detail)}</p>
                  </div>`
                : ""
            }
            <p class="muted route-compare-summary">${escapeHtml(browser.summary)}</p>
            <div class="route-compare-browser-grid">
              ${renderRouteCompareGraphSurface("Left Graph", leftRoute, browser.leftGraph, browser.nodeDiffSet, browser.edgeDiffSet, "left")}
              ${renderRouteCompareGraphSurface("Right Graph", rightRoute, browser.rightGraph, browser.nodeDiffSet, browser.edgeDiffSet, "right")}
            </div>
            ${renderRouteCompareDetailList(compare)}
          `
          : '<p class="muted">No route compare is available for the current route selection.</p>'
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
  state.ui.routeCompareSelection = { leftKey: "", rightKey: "" };
  state.ui.runtimeNodeRunId = "";
  state.ui.runtimeDrawerOpen = false;
  state.ui.runtimeGraphZoom = 1;
  state.ui.runtimeGraphTab = "timeline";
  state.ui.runtimeGraphListFallback = false;
  state.ui.runtimeOverlayOpen = false;
  state.ui.taskConversationExpanded = false;
  state.ui.taskRuntimeExpanded = false;
  state.ui.taskPlanExpanded = false;
  document.body.classList.remove("runtime-overlay-active");
}

function prepareWorkspaceSessionChange(nextSessionId) {
  const currentSessionId = state.selectedSessionId || getWorkspaceSessionId(state.workspaceDetail);
  if (currentSessionId === nextSessionId) return;
  workspaceLoadSeq += 1;
  closeSessionStream();
  resetWorkspaceDrilldownState();
  if (workspaceLoadController) {
    workspaceLoadController.abort();
    workspaceLoadController = null;
  }
  closeConversationSocket();
  state.conversationStream = null;
  state.artifactPreview.open = false;
}

function getSessionWorkspaceCacheKey(sessionId, runId = "") {
  return `${sessionId}:${runId || "latest"}`;
}

function getCachedSessionWorkspace(sessionId, runId = "") {
  const key = getSessionWorkspaceCacheKey(sessionId, runId);
  const cached = sessionWorkspaceCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    sessionWorkspaceCache.delete(key);
    return null;
  }
  return cached.detail;
}

function cacheSessionWorkspace(sessionId, runId, detail) {
  if (!sessionId || !detail) return;
  sessionWorkspaceCache.set(getSessionWorkspaceCacheKey(sessionId, runId), {
    detail,
    expiresAt: Date.now() + SESSION_WORKSPACE_CACHE_TTL_MS,
  });
}

function getSessionInventoryTitle(sessionId) {
  const item =
    state.missions.find((candidate) => candidate.session_id === sessionId) ||
    state.sessions.find((candidate) => candidate.session_id === sessionId);
  return item?.title || sessionId || "Task";
}

function updateTaskInventorySelection(sessionId) {
  for (const button of document.querySelectorAll('[data-action="select-session"]')) {
    button.classList.toggle("selected", button.dataset.sessionId === sessionId);
  }
}

function showTaskWorkspacePending(sessionId) {
  if (state.activeNav !== "orchestrator") return;
  updateTaskInventorySelection(sessionId);
  const workspace = document.querySelector(".app-shell > .workspace");
  if (!workspace) return;
  workspace.classList.add("task-switch-pending");
  workspace.setAttribute("aria-busy", "true");
  const title = workspace.querySelector(".topbar h2");
  if (title) title.textContent = getSessionInventoryTitle(sessionId);
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
  synchronizeRouteCompareSelection(detail);
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

function buildWorkspaceContextBrowserItems(detail) {
  const attachments = Array.isArray(detail?.attachments) ? detail.attachments : [];
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
  const contextItems = attachments.map((attachment) => ({
    key: `attachment:${attachment.attachment_id || attachment.storage_uri || attachment.name}`,
    type: "context",
    title: attachment.name || "Attached file",
    summary: attachment.summary || attachment.storage_uri || "Context reference",
    storageUri: attachment.storage_uri || "",
    mimeType: attachment.mime_type || "",
    sizeBytes: attachment.size_bytes,
    createdAt: attachment.created_at || "",
    badge: formatFileSize(attachment.size_bytes) || attachment.mime_type || attachment.kind || "context",
    attachable: false,
  }));
  const outputItems = artifacts.map((artifact) => ({
    key: `artifact:${getArtifactWorkspaceFeedKey(artifact) || artifact.artifact_id || artifact.storage_uri || artifact.name}`,
    type: "output",
    title: artifact.name || artifact.kind || artifact.type || artifact.artifact_id || "Generated output",
    summary: artifact.summary || artifact.storage_uri || artifact.path || artifact.kind || "Generated workspace material",
    storageUri: artifact.storage_uri || artifact.path || "",
    mimeType: artifact.mime_type || "",
    sizeBytes: artifact.size_bytes,
    createdAt: artifact.created_at || "",
    badge: formatFileSize(artifact.size_bytes) || artifact.mime_type || artifact.kind || "output",
    attachable: Boolean(artifact.storage_uri || artifact.path),
  }));
  return [...contextItems, ...outputItems].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "context" ? -1 : 1;
    }
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
  });
}

function renderWorkspaceContextBrowser(detail) {
  const items = buildWorkspaceContextBrowserItems(detail).slice(0, 8);
  return `
    <div class="attachment-browser" data-workspace-context-browser="true">
      <div class="attachment-browser-head">
        <strong>Workspace Browser</strong>
        <span class="badge neutral">${escapeHtml(String(items.length))}</span>
      </div>
      <div class="attachment-browser-list">
        ${
          items.length
            ? items
                .map(
                  (item) => `
                    <div class="attachment-browser-item">
                      <div>
                        <strong>${escapeHtml(item.title)}</strong>
                        <small>${escapeHtml(item.summary)}</small>
                      </div>
                      <div class="attachment-browser-actions">
                        <span class="badge neutral">${escapeHtml(item.badge || item.type)}</span>
                        ${
                          item.attachable
                            ? `<button class="mini-button" data-action="attach-workspace-context-reference" data-key="${escapeHtml(item.key)}" ${state.attachmentSaving || !state.selectedSessionId ? "disabled" : ""}>Use</button>`
                            : ""
                        }
                      </div>
                    </div>
                  `,
                )
                .join("")
            : '<p class="muted">No workspace material yet.</p>'
        }
      </div>
    </div>
  `;
}

function renderDesktopWorkspaceBrowser() {
  if (!state.desktop.available) return "";
  const workspace = state.desktop.workspace;
  const listing = state.desktop.listing;
  const entries = Array.isArray(listing?.items) ? listing.items : [];
  const currentPath = listing?.relativePath || "";
  const binding = state.workspaceDetail?.workspace_binding || null;
  const sessionId = state.selectedSessionId || getWorkspaceSessionId(state.workspaceDetail);
  const projects = Array.isArray(state.desktop.projects) ? state.desktop.projects.filter((item) => !item.archived) : [];
  const taskWorkspace = state.workspaceDetail?.task_workspace || null;
  return `
    <div class="desktop-local-browser">
      <div class="desktop-project-strip">
        <div class="desktop-project-list">
          ${projects.length
            ? projects.map((project) => `
                <button class="desktop-project-row ${project.active ? "selected" : ""}" type="button" data-action="select-desktop-project" data-project-id="${escapeHtml(project.projectId)}">
                  <span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.rootPath)}</small></span>
                  ${project.registeredProjectId === taskWorkspace?.project?.project_id ? '<span class="badge success">Task</span>' : ""}
                </button>`).join("")
            : '<p class="muted">No saved Projects on this Desktop.</p>'}
        </div>
        <div class="desktop-project-create">
          <input data-field="desktop.projectName" value="${escapeHtml(state.desktop.projectDraft.name)}" placeholder="New project folder name" />
          <input data-field="desktop.projectDescription" value="${escapeHtml(state.desktop.projectDraft.description)}" placeholder="Description (optional)" />
          <div>
            <label>Output folder<input data-field="desktop.outputRelativePath" value="${escapeHtml(state.desktop.projectDraft.outputRelativePath)}" /></label>
            <button class="mini-button" type="button" data-action="create-desktop-project" ${state.desktop.loading || !state.desktop.projectDraft.name.trim() ? "disabled" : ""}>Create Project</button>
          </div>
        </div>
      </div>
      <div class="desktop-local-browser-head">
        <div>
          <span class="desktop-host-label">Desktop workspace</span>
          <strong>${escapeHtml(workspace?.displayName || workspace?.name || "No folder selected")}</strong>
          <small>${escapeHtml(workspace ? (currentPath || workspace.rootPath) : "Choose a folder to grant read-only access.")}</small>
        </div>
        <div class="desktop-local-browser-actions">
          ${workspace ? `<button class="mini-button icon-button" type="button" data-action="refresh-desktop-workspace" title="Refresh folder" aria-label="Refresh folder">&#8635;</button>` : ""}
          ${workspace ? `<button class="mini-button icon-button" type="button" data-action="archive-desktop-project" data-project-id="${escapeHtml(workspace.projectId || "")}" title="Archive Project reference" aria-label="Archive Project reference">&#128451;</button>` : ""}
          ${workspace && sessionId && binding?.access !== "sandbox-write" ? `<button class="mini-button" type="button" data-action="authorize-desktop-workspace-write" ${state.desktop.loading ? "disabled" : ""}>Allow sandbox edits</button>` : ""}
          <button class="mini-button" type="button" data-action="choose-desktop-workspace" ${state.desktop.loading ? "disabled" : ""}>${workspace ? "Change Folder" : "Choose Folder"}</button>
        </div>
      </div>
      ${state.desktop.error ? `<p class="desktop-local-error">${escapeHtml(state.desktop.error)}</p>` : ""}
      ${
        workspace
          ? `<div class="desktop-local-pathbar">
              <button class="mini-button icon-button" type="button" data-action="open-desktop-workspace-directory" data-path="${escapeHtml(listing?.parentRelativePath || "")}" ${listing?.parentRelativePath === null || state.desktop.loading ? "disabled" : ""} title="Parent folder" aria-label="Parent folder">&#8593;</button>
              <span>${escapeHtml(currentPath || "/")}</span>
              <span class="badge neutral">Outputs: ${escapeHtml(taskWorkspace?.output_relative_path || workspace.outputRelativePath || "outputs")}</span>
              <span class="badge ${binding?.access === "sandbox-write" ? "success" : "neutral"}">${binding?.access === "sandbox-write" ? "Sandbox edits allowed" : "Read only"}</span>
            </div>
            <div class="desktop-local-entries">
              ${
                entries.length
                  ? entries
                      .map(
                        (entry) => `<div class="desktop-local-entry">
                          <div class="desktop-local-entry-name">
                            <span class="desktop-entry-icon" aria-hidden="true">${entry.kind === "directory" ? "&#9656;" : "&#183;"}</span>
                            <div><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.kind === "directory" ? "Folder" : formatFileSize(entry.sizeBytes) || "File")}</small></div>
                          </div>
                          <div class="desktop-local-entry-actions">
                            ${entry.kind === "directory" ? `<button class="mini-button" type="button" data-action="open-desktop-workspace-directory" data-path="${escapeHtml(entry.relativePath)}">Open</button>` : ""}
                            ${entry.readableText ? `<button class="mini-button" type="button" data-action="attach-desktop-workspace-file" data-path="${escapeHtml(entry.relativePath)}" ${state.attachmentSaving || !state.selectedSessionId ? "disabled" : ""}>Use as context</button>` : ""}
                          </div>
                        </div>`,
                      )
                      .join("")
                  : `<p class="muted">${state.desktop.loading ? "Loading folder..." : "This folder has no supported entries."}</p>`
              }
            </div>`
          : ""
      }
    </div>
  `;
}

function renderAttachmentContextPanel(attachments, detail = state.workspaceDetail) {
  const values = Array.isArray(attachments) ? attachments : [];
  const editor = state.attachmentEditor;
  return `
    <section class="subpanel attachment-context-panel">
      <div class="subpanel-header">
        <strong>Context Files</strong>
        <span class="badge ${values.length ? "success" : "neutral"}">${escapeHtml(String(values.length))}</span>
      </div>
      <div class="attachment-drop-zone" data-attachment-drop-zone="true">
        <div>
          <strong>Local References</strong>
          <small>${state.desktop.available ? "Desktop reads only the files you explicitly add as context." : "Browser files stay local; Studio stores context metadata."}</small>
        </div>
        <div class="attachment-drop-actions">
          <button class="mini-button" data-action="pick-context-file" ${state.attachmentSaving || !state.selectedSessionId ? "disabled" : ""}>Choose Files</button>
          <input class="hidden-file-input" type="file" multiple data-field="attachment.filePicker" data-key="${escapeHtml(String(state.attachmentFilePickerKey))}" />
        </div>
      </div>
      ${renderDesktopWorkspaceBrowser()}
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
      ${renderWorkspaceContextBrowser(detail)}
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
    const artifactMessage = output.latestArtifactMessageId
      ? (detail?.messages || []).find(
          (message) =>
            message.message_id === output.latestArtifactMessageId &&
            message.kind === "artifact_card",
        )
      : null;
    const artifactContent = artifactMessage?.content || {};
    const title = output.title || output.key || output.name || "Deliverable";
    const key = normalizeWorkspaceKey(title);
    seen.add(key);
    items.push({
      key,
      title,
      status: output.status || "requested",
      summary: output.summary || "Tracked from mission output projection.",
      detail: Array.isArray(output.detailLines) ? output.detailLines[0] || "" : "",
      uri: output.storage_uri || output.storageUri || artifactContent.storage_uri || "",
      artifactId: artifactContent.artifact_id || output.latestGeneratedArtifactId || "",
      mimeType: artifactContent.mime_type || "",
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
      artifactId: artifact.artifact_id || "",
      mimeType: artifact.mime_type || "",
      artifactCount: 1,
      source: "artifact",
    });
  }

  for (const message of [...(detail?.messages || [])].reverse()) {
    if (message.kind !== "artifact_card") continue;
    const content = message.content || {};
    const title = content.name || content.artifact_id || "Generated output";
    const key = normalizeWorkspaceKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      key,
      title,
      status: "returned",
      summary: content.summary || "Generated output from the task conversation.",
      detail: content.mime_type || "",
      uri: content.storage_uri || "",
      artifactId: content.artifact_id || "",
      mimeType: content.mime_type || "",
      artifactCount: 1,
      source: "artifact-message",
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
  const runStatus = detail?.latest_run?.status || detail?.workspace_state?.run_status || "idle";
  const terminalRun = ["completed", "failed", "cancelled"].includes(runStatus);
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
        <span class="badge neutral">${escapeHtml(runId ? terminalRun ? `${formatWorkspaceLabel(runStatus)} run` : "live run" : "next pass")}</span>
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
                ${renderPatchReviewSummary(patch)}
                ${renderPatchOperationReview(patch)}
                ${renderPatchOutcomeReview(patch)}
                ${renderPatchTopologyComparison(patch)}
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
      ${renderRuntimeInspectorPanel(detail?.runtime_graph || null, detail?.runtime_projection || null)}
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
  if (marker === "recovered_failure") return "Recovered failure";
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
  if (marker === "active_frontier" || marker === "ready" || marker === "terminal" || marker === "recovered_failure") return "success";
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
  const monitoring = graph.runtimeMonitoring && typeof graph.runtimeMonitoring === "object"
    ? graph.runtimeMonitoring
    : null;

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
      ${
        monitoring
          ? `<div class="runtime-monitoring-grid">
              <div class="runtime-monitoring-card">
                <div class="runtime-package-head">
                  <strong>${escapeHtml(monitoring.progress?.label || "Runtime progress")}</strong>
                  <span class="badge ${normalizeTone(monitoring.progress?.tone || "neutral")}">${escapeHtml(`${monitoring.progress?.percentComplete ?? 0}%`)}</span>
                </div>
                <p>${escapeHtml(monitoring.progress?.detail || "Progress detail is not available.")}</p>
                <small>${escapeHtml(`Average node progress ${monitoring.progress?.averageNodeProgress ?? 0}% / frontier ${monitoring.progress?.frontierCount ?? frontier.length}`)}</small>
              </div>
              <div class="runtime-monitoring-card">
                <div class="runtime-package-head">
                  <strong>Checkpoints</strong>
                  <span class="badge ${normalizeTone(monitoring.checkpoints?.tone || "neutral")}">${escapeHtml(monitoring.checkpoints?.nextActionLabel || "Monitor")}</span>
                </div>
                <p>${escapeHtml(monitoring.checkpoints?.detail || "No checkpoint detail is available.")}</p>
                ${
                  monitoring.checkpoints?.nextCheckpointLabel
                    ? `<small>${escapeHtml(`Next: ${monitoring.checkpoints.nextCheckpointLabel}`)}</small>`
                    : ""
                }
              </div>
              <div class="runtime-monitoring-card">
                <div class="runtime-package-head">
                  <strong>${escapeHtml(monitoring.cost?.label || "Cost posture")}</strong>
                  <span class="badge ${normalizeTone(monitoring.cost?.tone || "neutral")}">${escapeHtml(
                    typeof monitoring.cost?.capacityUtilization === "number"
                      ? `${Math.round(monitoring.cost.capacityUtilization * 100)}% capacity`
                      : "capacity open",
                  )}</span>
                </div>
                <p>${escapeHtml(monitoring.cost?.detail || "No capacity detail is available.")}</p>
                <small>${escapeHtml(monitoring.cost?.budgetPolicyPresent ? "Budget policy present" : "No explicit budget policy")}</small>
              </div>
            </div>`
          : ""
      }
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

function renderLegacyRuntimeInspectorPanel(graph, projection) {
  if (!graph) {
    return renderRuntimeGraphPanel(graph);
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const jobs = Array.isArray(projection?.jobs) ? projection.jobs : [];
  const leases = Array.isArray(projection?.leases) ? projection.leases : [];
  const workers = Array.isArray(projection?.workers) ? projection.workers : [];
  const evidence = Array.isArray(projection?.evidence) ? projection.evidence : [];
  const handoffs = Array.isArray(projection?.handoffs) ? projection.handoffs : [];
  const artifacts = Array.isArray(projection?.artifacts) ? projection.artifacts : [];
  const activeNode =
    nodes.find((node) => node.nodeRunId === state.ui.runtimeNodeRunId) ||
    nodes.find((node) => node.status === "running" || node.status === "waiting_human") ||
    nodes.find((node) => (node.markers || []).includes("active_frontier")) ||
    nodes[0] ||
    null;
  if (activeNode && state.ui.runtimeNodeRunId !== activeNode.nodeRunId) {
    state.ui.runtimeNodeRunId = activeNode.nodeRunId;
  }
  const nodeJobs = activeNode
    ? jobs.filter((job) => job.node_run_id === activeNode.nodeRunId)
    : [];
  const activeJob = nodeJobs.at(-1) || null;
  const activeLease = activeJob
    ? leases.find((lease) => lease.job_id === activeJob.job_id || lease.lease_id === activeJob.lease_id) || null
    : null;
  const activeWorker = activeLease
    ? workers.find((worker) => worker.worker_id === activeLease.worker_id) || null
    : null;
  const nodeEvidence = activeNode
    ? evidence.filter((item) => item.node_run_id === activeNode.nodeRunId).slice(-12).reverse()
    : [];
  const nodeHandoffs = activeNode
    ? handoffs.filter((item) => item.node_run_id === activeNode.nodeRunId).slice(-4).reverse()
    : [];
  const nodeArtifacts = activeNode
    ? artifacts.filter((item) => item.node_run_id === activeNode.nodeRunId).slice(-6).reverse()
    : [];
  const graphTone = nodes.some((node) => node.status === "failed" || node.status === "cancelled")
    ? "danger"
    : graph.runStatus === "completed"
      ? "success"
      : nodes.some((node) => node.status === "running" || node.status === "waiting_human")
        ? "warn"
        : "neutral";
  const summary = projection?.summary || {};
  const overlayClass = state.ui.runtimeOverlayOpen ? " runtime-inspector-overlay" : "";
  const overlayStyle = state.ui.runtimeOverlayOpen
    ? ' style="position:fixed;inset:10px;z-index:1200;margin:0;overflow:auto"'
    : "";
  const nodeNameById = new Map(nodes.map((node) => [node.nodeId, node.name]));

  return `
    <section class="subpanel runtime-inspector${overlayClass}" data-workspace-focus="graph"${overlayStyle}>
      <div class="runtime-inspector-toolbar">
        <div>
          <div class="subpanel-header runtime-inspector-title">
            <strong>Runtime Inspector</strong>
            <span class="badge ${graphTone}">${escapeHtml(graph.runStatus || "runtime")}</span>
          </div>
          <p class="muted">Worker execution, graph state, handoffs, evidence, and artifacts share one live projection.</p>
        </div>
        <div class="runtime-inspector-actions">
          <button class="icon-button" type="button" data-action="refresh-runtime-projection" title="Refresh runtime">&#8635;</button>
          <button class="icon-button" type="button" data-action="toggle-runtime-overlay" title="${state.ui.runtimeOverlayOpen ? "Exit full screen" : "Open full screen"}">${state.ui.runtimeOverlayOpen ? "&#10005;" : "&#9974;"}</button>
        </div>
      </div>
      <div class="runtime-inspector-metrics">
        <div><strong>${escapeHtml(String(summary.active_jobs ?? jobs.filter((job) => ["dispatching", "accepted", "running", "waiting_human"].includes(job.status)).length))}</strong><span>Active jobs</span></div>
        <div><strong>${escapeHtml(String(summary.connected_workers ?? workers.filter((worker) => ["connected", "busy"].includes(worker.status)).length))}</strong><span>Workers</span></div>
        <div><strong>${escapeHtml(String(summary.active_leases ?? leases.filter((lease) => ["provisioning", "ready", "active"].includes(lease.status)).length))}</strong><span>Leases</span></div>
        <div><strong>${escapeHtml(String(summary.evidence_items ?? evidence.length))}</strong><span>Evidence</span></div>
        <div><strong>${escapeHtml(String(summary.handoffs ?? handoffs.length))}</strong><span>Handoffs</span></div>
      </div>
      <div class="runtime-inspector-grid">
        <div class="runtime-inspector-nodes">
          <div class="runtime-pane-heading"><strong>Execution Graph</strong><span>${escapeHtml(String(nodes.length))} nodes</span></div>
          <div class="runtime-node-list runtime-node-list-selectable">
            ${nodes.map((node, index) => `
              <button type="button" class="runtime-node runtime-node-button ${activeNode?.nodeRunId === node.nodeRunId ? "selected" : ""}" data-action="select-runtime-node" data-node-run-id="${escapeHtml(node.nodeRunId || "")}">
                <span class="runtime-node-index ${statusTone(node.status)}">${escapeHtml(String(index + 1))}</span>
                <span class="runtime-node-body">
                  <span class="runtime-node-head"><strong>${escapeHtml(node.name || node.nodeId || "Node")}</strong><span class="badge ${statusTone(node.status)}">${escapeHtml(node.status || "pending")}</span></span>
                  <small>${escapeHtml(node.workPackageLabel || "Execution")} / ${escapeHtml(node.type || "task")}</small>
                  <span class="runtime-node-progress"><span style="width:${Math.max(0, Math.min(100, Number(node.progress?.percent || 0)))}%"></span></span>
                  ${node.progress?.message ? `<small>${escapeHtml(node.progress.message)}</small>` : ""}
                </span>
              </button>
            `).join("") || '<p class="muted">No runtime nodes yet.</p>'}
          </div>
          <div class="runtime-edge-list runtime-inspector-edges">
            ${edges.slice(0, 12).map((edge) => `
              <div class="runtime-edge">
                <span>${escapeHtml(nodeNameById.get(edge.fromNodeId) || edge.fromNodeId || "from")} -&gt; ${escapeHtml(nodeNameById.get(edge.toNodeId) || edge.toNodeId || "to")}</span>
                <span class="badge ${statusTone(edge.status)}">${escapeHtml(edge.label || edge.status || "pending")}</span>
              </div>
            `).join("") || '<p class="muted">No runtime edges yet.</p>'}
          </div>
        </div>
        <div class="runtime-inspector-detail">
          <div class="runtime-pane-heading"><strong>${escapeHtml(activeNode?.name || "Node detail")}</strong><span>${escapeHtml(activeNode?.nodeRunId || "No selection")}</span></div>
          <div class="runtime-execution-identity">
            <div><span>Harness</span><strong>${escapeHtml(activeJob?.agent_runtime || activeNode?.agentProfile || "not assigned")}</strong></div>
            <div><span>Worker</span><strong>${escapeHtml(activeWorker?.worker_id || activeJob?.worker_id || "not connected")}</strong></div>
            <div><span>Lease</span><strong>${escapeHtml(activeLease?.status || "none")}</strong></div>
            <div><span>Target</span><strong>${escapeHtml(activeJob?.target_kind || "local")}</strong></div>
          </div>
          <div class="runtime-detail-section">
            <div class="runtime-pane-heading"><strong>Handoffs</strong><span>${escapeHtml(String(nodeHandoffs.length))}</span></div>
            ${nodeHandoffs.map((handoff) => `
              <div class="runtime-evidence-row">
                <span class="badge ${/fail|error|reject/i.test(handoff.port || "") ? "danger" : "success"}">${escapeHtml(handoff.port || "success")}</span>
                <div><strong>${escapeHtml(handoff.summary || "Node handoff")}</strong><small>${escapeHtml((handoff.routed_node_run_ids || []).length ? `Routed ${handoff.routed_node_run_ids.length} node(s)` : "No downstream route selected")}</small></div>
              </div>
            `).join("") || '<p class="muted">No handoff evidence for this node.</p>'}
          </div>
          <div class="runtime-detail-section runtime-evidence-section">
            <div class="runtime-pane-heading"><strong>Evidence Stream</strong><span>${escapeHtml(String(nodeEvidence.length))}</span></div>
            ${nodeEvidence.map((item) => `
              <div class="runtime-evidence-row">
                <span class="runtime-evidence-kind">${escapeHtml(String(item.kind || "log").slice(0, 2).toUpperCase())}</span>
                <div><strong>${escapeHtml(item.summary || item.kind || "Evidence")}</strong><small>${escapeHtml(item.created_at ? formatWorkspaceTimestamp(item.created_at) : "")}${item.storage_uri ? ` / ${escapeHtml(item.storage_uri)}` : ""}</small></div>
              </div>
            `).join("") || '<p class="muted">Evidence appears as the worker executes tools and returns output.</p>'}
          </div>
          <div class="runtime-detail-section">
            <div class="runtime-pane-heading"><strong>Artifacts</strong><span>${escapeHtml(String(nodeArtifacts.length))}</span></div>
            ${nodeArtifacts.map((artifact) => `
              <div class="runtime-evidence-row">
                <span class="runtime-evidence-kind">AR</span>
                <div><strong>${escapeHtml(artifact.name || artifact.artifact_id || "Artifact")}</strong><small>${escapeHtml(artifact.storage_uri || artifact.mime_type || "Stored output")}</small></div>
              </div>
            `).join("") || '<p class="muted">No artifacts returned by this node.</p>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function getCurrentRuntimeGraphModel(graph = state.workspaceDetail?.runtime_graph, projection = state.workspaceDetail?.runtime_projection) {
  return buildRuntimeGraphModel({
    graph,
    projection,
    trace: state.workspaceDetail?.runtime_trace || null,
    scorecards: state.workspaceDetail?.runtime_scorecards || [],
    evaluations: state.workspaceDetail?.runtime_evaluations || [],
    replay: state.workspaceDetail?.runtime_replay || null,
    routeChanges: state.workspaceDetail?.route_compare || null,
    selectedNodeRunId: state.ui.runtimeNodeRunId,
  });
}

function renderRuntimeInspectorPanel(graph, projection) {
  const model = getCurrentRuntimeGraphModel(graph, projection);
  return renderRuntimeGraphView(model, {
    zoom: state.ui.runtimeGraphZoom,
    activeTab: state.ui.runtimeGraphTab,
    drawerOpen: state.ui.runtimeDrawerOpen,
    listFallback: state.ui.runtimeGraphListFallback,
    overlayOpen: state.ui.runtimeOverlayOpen,
    scorecardLoading: isActionLoading("runtime-scorecard", model.runId),
    evaluationLoading: isActionLoading("runtime-evaluation", model.runId),
    replayLoading: isActionLoading("runtime-replay", model.runId),
    recoveryLoading: isActionLoading("runtime-recovery", model.runId),
    failureReplayLoading: isActionLoading("runtime-failure-replay", model.selectedNode?.nodeRunId || ""),
  });
}

async function request(path, options = {}) {
  const authHeaders = {
    ...(state.security.apiKey ? { authorization: `Bearer ${state.security.apiKey}` } : {}),
    ...(state.security.workspaceId ? { "x-my-mate-workspace-id": state.security.workspaceId } : {}),
  };
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...authHeaders,
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(body && body.message ? body.message : `Request failed: ${response.status}`);
    error.code = body?.code || "request_failed";
    error.status = response.status;
    throw error;
  }
  return body;
}

function hasSecurityPermission(permission) {
  return state.security.identity?.permissions?.includes(permission) === true;
}

function isGovernedAction(action) {
  const policy = state.governance.policy;
  return policy?.mode === "enforced" && policy.protected_actions?.includes(action);
}

function stageGovernanceProposal(action, resourceId, payload, reason) {
  state.governance.draft = {
    action,
    resourceId: resourceId || "",
    reason: reason || "",
    payloadText: prettyJson(payload || {}),
  };
  state.activeNav = "registry";
  state.notice = "Governed change staged for review before submission.";
  state.error = null;
  render();
}

function resetWorkspaceScopedState() {
  workspaceLoadSeq += 1;
  closeSessionStream();
  state.templates = [];
  state.missions = [];
  state.sessions = [];
  state.orchestratorProfiles = [];
  state.agentProfiles = [];
  state.providerConnections = [];
  state.mcpServers = [];
  state.skills = [];
  state.governance = emptyGovernanceState();
  state.lineage = null;
  state.selectedId = null;
  state.selectedSessionId = null;
  state.workspaceDetail = null;
  state.runtimeSummary = null;
  state.dashboardSummary = null;
  state.memory = {
    retrievalStatus: null,
    knowledgeStatus: null,
    settings: null,
    observability: null,
    maintenance: null,
    maintenanceSweep: null,
    recommendations: null,
    overlays: null,
    contexts: null,
    onboarding: null,
    effectiveness: null,
    onboardingDraft: {
      responsePreferences: "",
      validationConventions: "",
      projectConventions: "",
      private: false,
    },
    records: [],
    candidates: [],
    query: "",
    statusFilter: "active",
    scopeFilter: "all",
    kindFilter: "all",
    searchResult: null,
    rebuilding: false,
    saving: false,
    editingId: "",
    editContent: "",
    importText: "",
    importStrategy: "skip",
    importDryRun: true,
    importResult: null,
  };
  state.inbox = {
    approvals: [],
    humanInputs: [],
    alerts: [],
    memoryCandidates: [],
    workspaceChanges: [],
    selectedWorkspaceChangeId: "",
    selectedWorkspaceFile: "",
    confirmWorkspaceChangeAction: "",
    loading: false,
    error: null,
  };
  state.preview = { type: "workspace", key: null };
  state.registryEditor = {
    profile: emptyAgentProfileEditor(),
    connection: emptyProviderConnectionEditor(),
    mcpServer: emptyMcpServerEditor(),
    skill: emptySkillEditor(),
  };
  state.setup.open = false;
  state.setup.initialized = false;
  state.setup.hostReport = null;
  state.setup.dockerReport = null;
  state.setup.error = null;
  state.orchestrator = emptyOrchestratorEditor();
  state.editor = emptyEditor();
  state.planner.templateId = "";
  state.planner.recommendation = null;
  state.planner.candidatePlan = null;
  state.planner.dagDraft = null;
  state.planner.error = null;
  resetDurableProposalState("");
  resetWorkspaceDrilldownState();
}

async function loadSecurity(shouldRender = true) {
  state.security.loading = true;
  if (shouldRender) render();
  try {
    const identity = await request("/api/auth/me");
    state.security.identity = identity;
    state.security.workspaceId = identity.selected_workspace.workspace_id;
    globalThis.localStorage?.setItem(STUDIO_WORKSPACE_STORAGE, state.security.workspaceId);
    const [members, audit] = await Promise.all([
      request(`/api/workspaces/${encodeURIComponent(state.security.workspaceId)}/members`),
      request("/api/audit-events?limit=50"),
    ]);
    state.security.members = members.items || [];
    state.security.auditEvents = audit.items || [];
    state.security.auditChainVerified = audit.chain_verified === true;
    state.error = null;
    return true;
  } catch (error) {
    state.security.identity = null;
    state.security.members = [];
    state.security.auditEvents = [];
    state.security.auditChainVerified = false;
    state.error = error.message || "Failed to load identity and workspace security.";
    return false;
  } finally {
    state.security.loading = false;
    if (shouldRender) render();
  }
}

async function switchSecurityWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === state.security.workspaceId) return;
  state.security.workspaceId = workspaceId;
  globalThis.localStorage?.setItem(STUDIO_WORKSPACE_STORAGE, workspaceId);
  resetWorkspaceScopedState();
  state.error = null;
  render();
  if (await loadSecurity(false)) {
    await loadWorkspaceData();
  }
  render();
}

async function refreshStudioSecurityAndWorkspace() {
  if (!(await loadSecurity(false))) {
    resetWorkspaceScopedState();
    render();
    return;
  }
  resetWorkspaceScopedState();
  await loadWorkspaceData();
  render();
}

async function saveStudioSecuritySettings() {
  const input = document.querySelector("input[data-field='security.apiKey']");
  const nextApiKey = input?.value?.trim() || "";
  const identityChanged = nextApiKey !== state.security.apiKey;
  state.security.apiKey = nextApiKey;
  if (state.security.apiKey) globalThis.localStorage?.setItem(STUDIO_API_KEY_STORAGE, state.security.apiKey);
  else globalThis.localStorage?.removeItem(STUDIO_API_KEY_STORAGE);
  if (identityChanged) {
    state.security.workspaceId = "";
    globalThis.localStorage?.removeItem(STUDIO_WORKSPACE_STORAGE);
    resetWorkspaceScopedState();
    state.error = null;
    render();
  }
  await refreshStudioSecurityAndWorkspace();
}

async function updateStudioMemberRole(principalId, role) {
  const identity = state.security.identity;
  const member = state.security.members.find((item) => item.principal_id === principalId);
  if (!identity || !member || !role) return;
  await request(
    `/api/workspaces/${encodeURIComponent(identity.selected_workspace.workspace_id)}/members/${encodeURIComponent(principalId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        display_name: member.display_name,
        principal_type: member.principal_type,
        role,
        status: member.status,
      }),
    },
  );
  await loadSecurity();
}

function setRouteCompareSelection(side, key) {
  const history = listWorkspacePlanningRoutes(state.workspaceDetail);
  if (!history.some((entry) => entry.key === key)) return;
  const next = { ...state.ui.routeCompareSelection, [`${side}Key`]: key };
  if (next.leftKey === next.rightKey) {
    const fallback =
      history.find((entry) => entry.key !== key)?.key || key;
    if (side === "left") {
      next.rightKey = fallback;
    } else {
      next.leftKey = fallback;
    }
  }
  state.ui.routeCompareSelection = next;
}

async function refreshSelectedRouteCompare() {
  const selection = state.ui.routeCompareSelection;
  if (!selection.leftKey || !selection.rightKey) {
    state.notice = "No compare route selection is available for this workspace.";
    state.error = null;
    render();
    return;
  }
  state.error = null;
  state.notice = null;
  await loadRouteCompareForWorkspace(selection, true);
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

function shouldPersistWorkspaceRunSelection() {
  const selectedRunId = getWorkspaceSelectedRunId(state.workspaceDetail);
  const latestSessionRunId = state.workspaceDetail?.session?.latest_run_id || null;
  return Boolean(
    shouldPersistWorkspaceLocationState() &&
      selectedRunId &&
      selectedRunId !== latestSessionRunId,
  );
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
  if (shouldPersistWorkspaceRunSelection() || (shouldPersistWorkspaceLocationState() && state.ui.runtimeNodeRunId)) {
    params.set("run", getWorkspaceSelectedRunId(state.workspaceDetail));
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
    if (state.ui.runtimeNodeRunId) {
      params.set("node", state.ui.runtimeNodeRunId);
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
  const selectedRunId = params.get("run");
  const missionQuery = params.get("mq");
  const missionVisibility = params.get("mv");
  const sessionQuery = params.get("sq");
  const sessionVisibility = params.get("sv");
  const workspaceSelectionType = params.get("ws");
  const workspaceSelectionKey = params.get("wsk");
  const workspaceFeedFilter = params.get("wf");
  const workspaceFeedExpanded = params.get("wfe");
  const runtimeNodeRunId = params.get("node");

  if (nav && DESKTOP_NAV_ITEMS.has(nav)) {
    state.activeNav = nav;
  }
  if (sessionId) {
    state.selectedSessionId = sessionId;
  }
  if (selectedRunId) {
    state.workspaceDetail = {
      ...(state.workspaceDetail || {}),
      selected_run_id: selectedRunId,
    };
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
    if (runtimeNodeRunId) {
      state.ui.runtimeNodeRunId = runtimeNodeRunId;
      state.ui.runtimeDrawerOpen = true;
      pendingRuntimeNodeFocus = true;
    }
  }
}

function getLocationSessionId() {
  return new URLSearchParams(window.location.search).get("session") || "";
}

function getLocationRunId() {
  return new URLSearchParams(window.location.search).get("run") || "";
}

async function restoreWorkspaceSessionFromLocation() {
  const sessionId = getLocationSessionId();
  const runId = getLocationRunId();
  if (!sessionId || !isWorkspaceSurfaceNav()) return;
  const currentSessionId = getWorkspaceSessionId(state.workspaceDetail);
  const currentRunId = getWorkspaceSelectedRunId(state.workspaceDetail);
  if (currentSessionId === sessionId && (!runId || currentRunId === runId)) return;
  state.selectedSessionId = sessionId;
  await loadSessionWorkspace(sessionId, false, { runId: runId || null });
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

function stopRuntimeSupervision() {
  if (runtimeSupervisionTimer) {
    window.clearTimeout(runtimeSupervisionTimer);
    runtimeSupervisionTimer = null;
  }
  runtimeSupervisionRunId = "";
  runtimeSupervisionCursor = "";
}

function scheduleRuntimeSupervision(runId, delayMs) {
  if (!runId || runtimeSupervisionRunId !== runId) return;
  if (runtimeSupervisionTimer) window.clearTimeout(runtimeSupervisionTimer);
  runtimeSupervisionTimer = window.setTimeout(() => {
    runtimeSupervisionTimer = null;
    void pollRuntimeSupervision(runId);
  }, Math.max(0, Number(delayMs || 0)));
}

async function pollRuntimeSupervision(runId) {
  if (!runId || runtimeSupervisionRunId !== runId) return;
  const query = new URLSearchParams({ limit: "200" });
  if (runtimeSupervisionCursor) query.set("cursor", runtimeSupervisionCursor);
  try {
    const projection = await request(`/api/runs/${encodeURIComponent(runId)}/supervise?${query}`);
    if (runtimeSupervisionRunId !== runId || getWorkspaceSelectedRunId(state.workspaceDetail) !== runId) return;
    runtimeSupervisionCursor = projection.cursor || runtimeSupervisionCursor;
    const deltaCount =
      (projection.deltas?.events?.length || 0) +
      (projection.deltas?.evidence?.length || 0) +
      (projection.deltas?.handoffs?.length || 0) +
      (projection.deltas?.artifacts?.length || 0) +
      (projection.changed_nodes?.length || 0);
    if (deltaCount) {
      await loadRuntimeGraphForWorkspace(false);
      render();
    }
    if (projection.settled) {
      stopRuntimeSupervision();
      return;
    }
    scheduleRuntimeSupervision(runId, projection.has_more ? 0 : projection.next_poll_after_ms || 1000);
  } catch {
    if (runtimeSupervisionRunId === runId) scheduleRuntimeSupervision(runId, 2000);
  }
}

function startRuntimeSupervision(runId) {
  if (!runId) {
    stopRuntimeSupervision();
    return;
  }
  if (runtimeSupervisionRunId === runId && runtimeSupervisionTimer) return;
  stopRuntimeSupervision();
  runtimeSupervisionRunId = runId;
  scheduleRuntimeSupervision(runId, 0);
}

function closeSessionStream() {
  stopRuntimeSupervision();
  if (sessionStreamErrorTimer) {
    window.clearTimeout(sessionStreamErrorTimer);
    sessionStreamErrorTimer = null;
  }
  if (state.streamSource) {
    state.streamSource.close();
    state.streamSource = null;
  }
  state.streamStatus = "idle";
  state.streamError = null;
}

function closeConversationSocket(reason = "Conversation changed.") {
  const socket = conversationSocket;
  conversationSocket = null;
  conversationSocketSessionId = "";
  conversationSocketOpenPromise = null;
  state.conversationSocketStatus = "idle";
  state.conversationSocketError = null;
  for (const pending of conversationSocketRequests.values()) {
    pending.reject(new Error(reason));
  }
  conversationSocketRequests.clear();
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, reason);
}

function updateConversationStreamDom() {
  const stream = state.conversationStream;
  if (!stream) return;
  const textNode = document.querySelector(
    `[data-conversation-stream-id="${CSS.escape(stream.requestId)}"] [data-conversation-stream-text]`,
  );
  if (textNode) textNode.innerHTML = renderMarkdown(stream.text);
  const toolNode = document.querySelector(
    `[data-conversation-stream-id="${CSS.escape(stream.requestId)}"] [data-conversation-tool-progress]`,
  );
  if (toolNode) {
    toolNode.innerHTML = (stream.toolProgress || []).map((progress) => `
      <div class="conversation-tool-progress ${escapeHtml(progress.status || "running")}" title="${escapeHtml(progress.actionId || "")}">
        <span class="status-dot ${progress.status === "succeeded" ? "success" : progress.status === "failed" ? "danger" : "warn"}"></span>
        <span>${escapeHtml(progress.summary || progress.toolName || "Running tool")}</span>
      </div>
    `).join("");
  }
  const feed = document.querySelector(".task-conversation-rail .orchestrator-chat-feed");
  if (feed) {
    const distanceFromBottom = Math.max(0, feed.scrollHeight - feed.clientHeight - feed.scrollTop);
    if (distanceFromBottom <= 72 || stream.text.length < 80) feed.scrollTop = feed.scrollHeight;
  }
}

async function handleConversationSocketEvent(event) {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    state.conversationSocketError = "Conversation stream returned invalid data.";
    return;
  }
  if (payload.type === "conversation.connected") return;
  const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
  const pending = conversationSocketRequests.get(requestId);
  if (!pending) return;
  if (payload.type === "conversation.started") {
    pending.started = true;
    state.conversationSocketStatus = "streaming";
    if (state.conversationStream?.requestId === requestId) {
      state.conversationStream.providerConnectionId = payload.provider_connection_id || "";
      state.conversationStream.model = payload.model || "";
    }
    return;
  }
  if (payload.type === "conversation.delta") {
    if (state.conversationStream?.requestId === requestId && typeof payload.delta === "string") {
      state.conversationStream.text += payload.delta;
      updateConversationStreamDom();
    }
    return;
  }
  if (payload.type === "conversation.tool") {
    if (state.conversationStream?.requestId === requestId) {
      const progress = {
        actionId: payload.action_id || "",
        toolName: payload.tool_name || "",
        status: payload.status || "running",
        summary: payload.summary || "Running tool",
      };
      const existingIndex = (state.conversationStream.toolProgress || [])
        .findIndex((item) => item.actionId === progress.actionId);
      if (existingIndex >= 0) state.conversationStream.toolProgress[existingIndex] = progress;
      else state.conversationStream.toolProgress.push(progress);
      updateConversationStreamDom();
    }
    return;
  }
  if (payload.type === "conversation.desktop_action") {
    try {
      if (payload.action_type === "capability.execute") {
        if (!desktopHost?.capability?.execute) {
          throw new Error("This capability requires an updated My Mate Desktop.");
        }
        await desktopHost.capability.execute({
          sessionId: payload.session_id || "",
          actionId: payload.action_id || "",
          capabilityId: payload.capability_id || "",
          executor: payload.executor || "",
          riskLevel: payload.risk_level || "T1",
          arguments: payload.arguments || {},
        });
      } else if (payload.action_type === "capability.approve") {
        if (!desktopHost?.capability?.approve) {
          throw new Error("This MCP action requires an updated My Mate Desktop.");
        }
        await desktopHost.capability.approve({
          sessionId: payload.session_id || "",
          actionId: payload.action_id || "",
          capabilityId: payload.capability_id || "",
          executor: payload.executor || "mcp",
          riskLevel: payload.risk_level || "T2",
          arguments: payload.arguments || {},
        });
      } else {
        if (!desktopHost?.application?.open) {
          throw new Error("This action requires My Mate Desktop.");
        }
        await desktopHost.application.open({
          sessionId: payload.session_id || "",
          actionId: payload.action_id || "",
          applicationName: payload.application_name || "",
        });
      }
    } catch (error) {
      state.conversationSocketError = error.message || "Desktop capability action failed.";
    } finally {
      if (conversationSocket?.readyState === WebSocket.OPEN) {
        conversationSocket.send(JSON.stringify({
          type: "conversation.desktop_result",
          capability_request_id: payload.capability_request_id || "",
          action_id: payload.action_id || "",
        }));
      }
    }
    return;
  }
  if (payload.type === "conversation.completed") {
    conversationSocketRequests.delete(requestId);
    state.conversationSocketStatus = "open";
    pending.resolve(payload);
    return;
  }
  if (payload.type === "conversation.error") {
    conversationSocketRequests.delete(requestId);
    const error = new Error(payload.message || "Conversation stream failed.");
    error.code = payload.code || "conversation_failed";
    error.started = pending.started;
    pending.reject(error);
  }
}

function openConversationSocket(sessionId) {
  if (
    conversationSocket &&
    conversationSocketSessionId === sessionId &&
    conversationSocket.readyState === WebSocket.OPEN
  ) {
    return Promise.resolve(conversationSocket);
  }
  if (
    conversationSocket &&
    conversationSocketSessionId === sessionId &&
    conversationSocket.readyState === WebSocket.CONNECTING &&
    conversationSocketOpenPromise
  ) {
    return conversationSocketOpenPromise;
  }

  closeConversationSocket("Conversation session changed.");
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/conversation`;
  const socket = new WebSocket(url);
  conversationSocket = socket;
  conversationSocketSessionId = sessionId;
  state.conversationSocketStatus = "connecting";
  state.conversationSocketError = null;
  conversationSocketOpenPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) socket.close();
      reject(new Error("Conversation stream connection timed out."));
    }, 8_000);
    socket.addEventListener("open", () => {
      window.clearTimeout(timeout);
      state.conversationSocketStatus = "open";
      conversationSocketOpenPromise = null;
      resolve(socket);
    }, { once: true });
    socket.addEventListener("error", () => {
      window.clearTimeout(timeout);
      if (socket.readyState !== WebSocket.OPEN) reject(new Error("Conversation stream is unavailable."));
    }, { once: true });
  });
  socket.addEventListener("message", handleConversationSocketEvent);
  socket.addEventListener("close", () => {
    if (conversationSocket !== socket) return;
    conversationSocket = null;
    conversationSocketSessionId = "";
    conversationSocketOpenPromise = null;
    state.conversationSocketStatus = "idle";
    for (const pending of conversationSocketRequests.values()) {
      pending.reject(new Error("Conversation stream disconnected."));
    }
    conversationSocketRequests.clear();
  });
  return conversationSocketOpenPromise;
}

async function sendConversationSocketTurn(sessionId, input) {
  const socket = await openConversationSocket(sessionId);
  return await new Promise((resolve, reject) => {
    const pending = { resolve, reject, started: false };
    conversationSocketRequests.set(input.request_id, pending);
    socket.send(JSON.stringify({
      type: "conversation.send",
      ...input,
      auth: {
        token: state.security.apiKey || "",
        workspace_id: state.security.workspaceId || "",
      },
    }));
  });
}

function getWorkspaceRenderSignature(detail) {
  if (!detail) return "";
  return JSON.stringify({
    session: detail.session || null,
    messages: detail.messages || [],
    latest_run: detail.latest_run || null,
    selected_run_id: detail.selected_run_id || null,
    workspace_state: detail.workspace_state || {},
    next_actions: detail.next_actions || [],
    mission_snapshot: detail.mission_snapshot || null,
    mission_spec: detail.mission_spec || null,
    mission_view: detail.mission_view || null,
    attachments: detail.attachments || [],
    route_compare: detail.route_compare || null,
    runtime_graph: detail.runtime_graph || null,
    runtime_projection: detail.runtime_projection || null,
    runtime_trace: detail.runtime_trace || null,
    runtime_scorecards: detail.runtime_scorecards || [],
    runtime_evaluations: detail.runtime_evaluations || [],
    runtime_replay: detail.runtime_replay || null,
    artifacts: detail.artifacts || [],
    pending_approvals: detail.pending_approvals || [],
    pending_human_inputs: detail.pending_human_inputs || [],
    interventions: detail.interventions || [],
    dag_patches: detail.dag_patches || [],
    supervision_alerts: detail.supervision_alerts || [],
    autopilot: detail.autopilot || null,
    task_checkpoint: detail.task_checkpoint || null,
    workspace_binding: detail.workspace_binding || null,
    ui_plan: detail.ui_plan
      ? {
          version: detail.ui_plan.version || null,
          phase: detail.ui_plan.phase || null,
          primary_action: detail.ui_plan.primary_action || null,
          blocks: detail.ui_plan.blocks || [],
          fallback_component: detail.ui_plan.fallback_component || null,
        }
      : null,
  });
}

function applyWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const previousSignature = getWorkspaceRenderSignature(state.workspaceDetail);
  const latestRunId = getWorkspaceLatestRunId(snapshot);
  const currentGraph = state.workspaceDetail?.runtime_graph || null;
  const currentRuntimeProjection = state.workspaceDetail?.runtime_projection || null;
  const currentRuntimeTrace = state.workspaceDetail?.runtime_trace || null;
  const currentRuntimeScorecards = state.workspaceDetail?.runtime_scorecards || [];
  const currentRuntimeEvaluations = state.workspaceDetail?.runtime_evaluations || [];
  const currentRuntimeReplay = state.workspaceDetail?.runtime_replay || null;
  const snapshotGraph = snapshot.runtime_graph || snapshot.runtimeGraph || null;
  state.workspaceDetail = {
    session: snapshot.session || null,
    messages: snapshot.messages || [],
    latest_run: snapshot.latest_run || null,
    selected_run_id: snapshot.selected_run_id || snapshot.latest_run?.run_id || null,
    workspace_state: snapshot.workspace_state || {},
    next_actions: snapshot.next_actions || [],
    mission_snapshot: snapshot.mission_snapshot || null,
    mission_spec: snapshot.mission_spec || null,
    mission_view: snapshot.mission_view || snapshot.mission?.mission_view || null,
    attachments: filterConversationInputAttachments(
      snapshot.attachments || state.workspaceDetail?.attachments || [],
    ),
    route_compare: snapshot.route_compare || state.workspaceDetail?.route_compare || null,
    runtime_graph:
      snapshotGraph ||
      (currentGraph && currentGraph.runId === latestRunId ? currentGraph : null),
    runtime_projection:
      snapshot.runtime_projection ||
      (currentRuntimeProjection?.run_id === latestRunId ? currentRuntimeProjection : null),
    runtime_trace:
      snapshot.runtime_trace ||
      (currentRuntimeTrace?.run_id === latestRunId ? currentRuntimeTrace : null),
    runtime_scorecards:
      snapshot.runtime_scorecards ||
      (currentRuntimeProjection?.run_id === latestRunId ? currentRuntimeScorecards : []),
    runtime_evaluations:
      snapshot.runtime_evaluations ||
      (currentRuntimeProjection?.run_id === latestRunId ? currentRuntimeEvaluations : []),
    runtime_replay:
      snapshot.runtime_replay ||
      (currentRuntimeProjection?.run_id === latestRunId ? currentRuntimeReplay : null),
    artifacts: snapshot.artifacts || state.workspaceDetail?.artifacts || [],
    pending_approvals: snapshot.pending_approvals || [],
    pending_human_inputs: snapshot.pending_human_inputs || [],
    interventions: snapshot.interventions || [],
    dag_patches: snapshot.dag_patches || [],
    supervision_alerts: snapshot.supervision_alerts || [],
    autopilot: snapshot.autopilot || null,
    ui_plan: snapshot.ui_plan || null,
    workspace_binding: snapshot.workspace_binding || state.workspaceDetail?.workspace_binding || null,
  };
  reconcileWorkspaceSelection(state.workspaceDetail);
  return previousSignature !== getWorkspaceRenderSignature(state.workspaceDetail);
}

async function loadRuntimeGraphForWorkspace(shouldRender = true) {
  const runId = getWorkspaceSelectedRunId(state.workspaceDetail);
  if (!state.workspaceDetail || !runId) {
    if (state.workspaceDetail) {
      state.workspaceDetail.runtime_graph = null;
      state.workspaceDetail.runtime_projection = null;
      state.workspaceDetail.runtime_trace = null;
      state.workspaceDetail.runtime_scorecards = [];
      state.workspaceDetail.runtime_evaluations = [];
      state.workspaceDetail.runtime_replay = null;
    }
    if (shouldRender) render();
    return null;
  }
  try {
    const [projection, trace, scorecards, evaluations] = await Promise.all([
      request(`/api/runs/${encodeURIComponent(runId)}/runtime`),
      request(`/api/runs/${encodeURIComponent(runId)}/trace?limit=500`).catch(() => null),
      request(`/api/runs/${encodeURIComponent(runId)}/scorecards`).catch(() => ({ items: [] })),
      request(`/api/runs/${encodeURIComponent(runId)}/evaluations`).catch(() => ({ items: [] })),
    ]);
    const graph = projection?.graph || null;
    if (state.workspaceDetail && getWorkspaceSelectedRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_graph = graph;
      state.workspaceDetail.runtime_projection = projection;
      state.workspaceDetail.runtime_trace = trace;
      state.workspaceDetail.runtime_scorecards = scorecards?.items || [];
      state.workspaceDetail.runtime_evaluations = evaluations?.items || [];
    }
    if (shouldRender) render();
    return graph;
  } catch (_error) {
    if (state.workspaceDetail && getWorkspaceSelectedRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_graph = null;
      state.workspaceDetail.runtime_projection = null;
      state.workspaceDetail.runtime_trace = null;
      state.workspaceDetail.runtime_scorecards = [];
      state.workspaceDetail.runtime_evaluations = [];
      state.workspaceDetail.runtime_replay = null;
    }
    if (shouldRender) render();
    return null;
  }
}

function upsertRuntimeResult(items, result, idKey) {
  const existing = Array.isArray(items) ? items : [];
  const resultId = result?.[idKey];
  if (!resultId) return existing;
  return [...existing.filter((item) => item?.[idKey] !== resultId), result];
}

async function createRuntimeScorecard() {
  const runId = getWorkspaceSelectedRunId(state.workspaceDetail);
  if (!runId || !state.workspaceDetail) return;
  setActionLoading("runtime-scorecard", runId, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    const scorecard = await request(`/api/runs/${encodeURIComponent(runId)}/scorecards`, {
      method: "POST",
      body: JSON.stringify({ profile: "pipeline-v1", allow_incomplete: false }),
    });
    if (state.workspaceDetail && getWorkspaceSelectedRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_scorecards = upsertRuntimeResult(
        state.workspaceDetail.runtime_scorecards,
        scorecard,
        "scorecard_id",
      );
    }
    state.notice = `Scorecard ${scorecard.pipeline_verdict || "recorded"}: ${scorecard.passed_checks ?? 0}/${scorecard.total_checks ?? 0} checks.`;
  } catch (error) {
    state.error = error.message || "Failed to create runtime scorecard.";
  } finally {
    setActionLoading("runtime-scorecard", runId, false);
    render();
  }
}

async function pollRuntimeEvaluation(runId, evaluation) {
  let current = evaluation;
  for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(current?.status); attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    if (getWorkspaceSelectedRunId(state.workspaceDetail) !== runId) return current;
    current = await request(
      `/api/runs/${encodeURIComponent(runId)}/evaluations/${encodeURIComponent(current.evaluation_id)}`,
    );
    if (state.workspaceDetail && getWorkspaceSelectedRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_evaluations = upsertRuntimeResult(
        state.workspaceDetail.runtime_evaluations,
        current,
        "evaluation_id",
      );
      render();
    }
  }
  return current;
}

async function runRuntimeEvaluation(evaluator) {
  const runId = getWorkspaceSelectedRunId(state.workspaceDetail);
  if (!runId || !state.workspaceDetail) return;
  setActionLoading("runtime-evaluation", runId, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    let evaluation = await request(`/api/runs/${encodeURIComponent(runId)}/evaluations`, {
      method: "POST",
      body: JSON.stringify({ evaluator: evaluator || "deterministic-v1", allow_incomplete: false }),
    });
    if (state.workspaceDetail && getWorkspaceSelectedRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_evaluations = upsertRuntimeResult(
        state.workspaceDetail.runtime_evaluations,
        evaluation,
        "evaluation_id",
      );
      render();
    }
    evaluation = await pollRuntimeEvaluation(runId, evaluation);
    state.notice = `Evaluation ${evaluation.status || "recorded"}; quality ${evaluation.quality_verdict || "not evaluated"}.`;
  } catch (error) {
    state.error = error.message || "Failed to run evaluation.";
  } finally {
    setActionLoading("runtime-evaluation", runId, false);
    render();
  }
}

async function checkTaskQuality() {
  const runId = getWorkspaceSelectedRunId(state.workspaceDetail);
  if (!runId || !state.workspaceDetail) return;
  setActionLoading("task-quality", runId, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    const scorecard = await request(`/api/runs/${encodeURIComponent(runId)}/scorecards`, {
      method: "POST",
      body: JSON.stringify({ profile: "pipeline-v1", allow_incomplete: false }),
    });
    if (state.workspaceDetail && getWorkspaceSelectedRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_scorecards = upsertRuntimeResult(
        state.workspaceDetail.runtime_scorecards,
        scorecard,
        "scorecard_id",
      );
    }
    let evaluation = await request(`/api/runs/${encodeURIComponent(runId)}/evaluations`, {
      method: "POST",
      body: JSON.stringify({ evaluator: "deterministic-v1", allow_incomplete: false }),
    });
    if (state.workspaceDetail && getWorkspaceSelectedRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_evaluations = upsertRuntimeResult(
        state.workspaceDetail.runtime_evaluations,
        evaluation,
        "evaluation_id",
      );
      render();
    }
    evaluation = await pollRuntimeEvaluation(runId, evaluation);
    const quality = deriveResultQuality(state.workspaceDetail);
    state.notice = `Quality check: ${quality.label}.`;
  } catch (error) {
    state.error = error.message || "Failed to check result quality.";
  } finally {
    setActionLoading("task-quality", runId, false);
    render();
  }
}

async function verifyRuntimeReplay() {
  const runId = getWorkspaceSelectedRunId(state.workspaceDetail);
  if (!runId || !state.workspaceDetail) return;
  setActionLoading("runtime-replay", runId, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    const replay = await request(`/api/runs/${encodeURIComponent(runId)}/replays`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (state.workspaceDetail && getWorkspaceSelectedRunId(state.workspaceDetail) === runId) {
      state.workspaceDetail.runtime_replay = replay;
    }
    state.notice = `Replay ${replay.verification || "recorded"}: ${replay.processed_events ?? 0} events, ${(replay.projection_differences || []).length} differences.`;
  } catch (error) {
    state.error = error.message || "Failed to verify replay.";
  } finally {
    setActionLoading("runtime-replay", runId, false);
    render();
  }
}

async function scanRuntimeRecovery() {
  const runId = getWorkspaceSelectedRunId(state.workspaceDetail);
  if (!runId || !state.workspaceDetail) return;
  setActionLoading("runtime-recovery", runId, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    const result = await request(`/api/runs/${encodeURIComponent(runId)}/recovery/scan`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadRuntimeGraphForWorkspace(false);
    state.notice = `Recovery scan: ${result.completed || 0} completed, ${result.failed || 0} failed.`;
  } catch (error) {
    state.error = error.message || "Failed to scan runtime recovery.";
  } finally {
    setActionLoading("runtime-recovery", runId, false);
    render();
  }
}

async function replayFailedRuntimeNode() {
  const runId = getWorkspaceSelectedRunId(state.workspaceDetail);
  const nodeRunId = state.ui.runtimeNodeRunId;
  if (!runId || !nodeRunId || !state.workspaceDetail) return;
  setActionLoading("runtime-failure-replay", nodeRunId, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    const replay = await request(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRunId)}/recovery-replays`,
      {
        method: "POST",
        headers: { "idempotency-key": globalThis.crypto?.randomUUID?.() || `${runId}:${nodeRunId}:${Date.now()}` },
        body: JSON.stringify({}),
      },
    );
    await loadRuntimeGraphForWorkspace(false);
    state.notice = `Failure replay ${replay.status || "recorded"}: ${replay.replay_job_id || "dispatch pending"}.`;
  } catch (error) {
    state.error = error.message || "Failed to replay the selected node.";
  } finally {
    setActionLoading("runtime-failure-replay", nodeRunId, false);
    render();
  }
}

async function loadRouteCompareForWorkspace(selection = null, shouldRender = true) {
  const sessionId = getWorkspaceSessionId(state.workspaceDetail);
  if (!sessionId || !state.workspaceDetail) {
    return null;
  }
  const activeSelection = selection || getActiveRouteCompareSelection(state.workspaceDetail);
  const left = parseRouteCompareSelectionKey(activeSelection.leftKey);
  const right = parseRouteCompareSelectionKey(activeSelection.rightKey);
  const explicitSelection =
    typeof left.revision === "number" &&
    typeof right.revision === "number" &&
    !!left.option &&
    !!right.option;
  if (shouldRender) {
    state.routeCompareLoading = true;
    render();
  }
  try {
    const query = explicitSelection
      ? buildRouteCompareQuery({
          leftRevision: left.revision,
          leftOption: left.option,
          rightRevision: right.revision,
          rightOption: right.option,
        })
      : "";
    const compare = await request(`/api/sessions/${encodeURIComponent(sessionId)}/compare${query}`).catch(() => null);
    if (!state.workspaceDetail || getWorkspaceSessionId(state.workspaceDetail) !== sessionId) {
      return null;
    }
    state.workspaceDetail = {
      ...state.workspaceDetail,
      route_compare: compare,
    };
    if (compare?.left || compare?.right) {
      state.ui.routeCompareSelection = {
        leftKey: buildRouteCompareSelectionKey(compare.left?.revision, compare.left?.option),
        rightKey: buildRouteCompareSelectionKey(compare.right?.revision, compare.right?.option),
      };
    } else {
      synchronizeRouteCompareSelection(state.workspaceDetail);
    }
    return compare;
  } finally {
    state.routeCompareLoading = false;
    if (shouldRender) render();
  }
}

function openSessionStream(sessionId, options = {}) {
  closeSessionStream();
  if (!sessionId) return;
  state.streamStatus = "connecting";
  state.streamError = null;
  const selectedRunId = options?.runId || getWorkspaceSelectedRunId(state.workspaceDetail) || "";
  const streamQuery = selectedRunId ? `?run_id=${encodeURIComponent(selectedRunId)}` : "";
  const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream${streamQuery}`);
  state.streamSource = source;
  startRuntimeSupervision(selectedRunId);
  const isCurrentStream = () =>
    state.streamSource === source &&
    state.selectedSessionId === sessionId &&
    getWorkspaceSessionId(state.workspaceDetail) === sessionId;

  source.addEventListener("open", () => {
    if (!isCurrentStream()) return;
    if (sessionStreamErrorTimer) {
      window.clearTimeout(sessionStreamErrorTimer);
      sessionStreamErrorTimer = null;
    }
    const hadVisibleError = !!state.streamError;
    state.streamStatus = "open";
    state.streamError = null;
    if (hadVisibleError) renderTaskWorkspaceSurface();
  });

  const onEvent = (event) => {
    if (!isCurrentStream()) return;
    try {
      const payload = JSON.parse(event.data);
      if (payload?.data && (payload.type === "snapshot" || payload.type === "workspace.updated")) {
        const workspaceChanged = applyWorkspaceSnapshot(payload.data);
        if (!workspaceChanged) return;
        if (pendingTaskMoveStreamSessions.has(sessionId)) return;
        void loadRuntimeGraphForWorkspace(false).finally(() => {
          if (isCurrentStream()) renderTaskWorkspaceSurface();
        });
      }
    } catch (error) {
      state.streamError = error.message || "Failed to parse session stream.";
      renderTaskWorkspaceSurface();
    }
  };

  source.addEventListener("snapshot", onEvent);
  source.addEventListener("workspace.updated", onEvent);
  source.addEventListener("heartbeat", () => {
    if (!isCurrentStream()) return;
    if (state.streamStatus !== "open") {
      state.streamStatus = "open";
    }
  });
  source.addEventListener("error", () => {
    if (!isCurrentStream()) return;
    state.streamStatus = "error";
    if (sessionStreamErrorTimer) window.clearTimeout(sessionStreamErrorTimer);
    sessionStreamErrorTimer = window.setTimeout(() => {
      sessionStreamErrorTimer = null;
      if (!isCurrentStream() || state.streamStatus !== "error") return;
      state.streamError = "Session stream disconnected.";
      renderTaskWorkspaceSurface();
    }, 1500);
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
      agent_runtime: editor.agentRuntime,
      harness_profile: editor.harnessProfile.trim() || null,
      provider_connection_id: editor.providerConnectionId || null,
      runtime_agent_ref: editor.openclawAgentId.trim(),
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

function buildProviderConnectionPayload(editor = state.registryEditor.connection) {
  const metadata = parseJsonObject(editor.metadataText);
  if (!metadata.ok) return { ok: false, message: `Provider metadata: ${metadata.message}` };
  if (!editor.name.trim()) return { ok: false, message: "Provider Connection name is required." };
  if (!AGENT_RUNTIMES.includes(editor.agentRuntime)) {
    return { ok: false, message: "Select a supported Agent Runtime." };
  }
  if (!PROVIDER_PROTOCOLS[editor.protocol]) {
    return { ok: false, message: "Select a supported provider protocol." };
  }
  const models = [...new Set((editor.models || []).map((item) => item.trim()).filter(Boolean))];
  if (!models.length) return { ok: false, message: "Add at least one model." };
  const defaultModel = models.includes(editor.defaultModel) ? editor.defaultModel : models[0];
  if (!(PROVIDER_CREDENTIAL_ENVS[editor.agentRuntime] || []).includes(editor.credentialEnv)) {
    return { ok: false, message: "Select a credential environment variable allowed for this runtime." };
  }
  if (!Number.isInteger(editor.maxInputTokens) || editor.maxInputTokens < 4096 || editor.maxInputTokens > 1048576) {
    return { ok: false, message: "Maximum input tokens must be an integer between 4,096 and 1,048,576." };
  }
  if (!Number.isInteger(editor.maxOutputTokens) || editor.maxOutputTokens < 1024 || editor.maxOutputTokens > 131072) {
    return { ok: false, message: "Maximum output tokens must be an integer between 1,024 and 131,072." };
  }
  if (!Number.isInteger(editor.contextCompressionThresholdPercent) || editor.contextCompressionThresholdPercent < 50 || editor.contextCompressionThresholdPercent > 95) {
    return { ok: false, message: "Compression threshold must be an integer between 50 and 95 percent." };
  }
  if (!Number.isInteger(editor.maxContinuationRounds) || editor.maxContinuationRounds < 0 || editor.maxContinuationRounds > 32) {
    return { ok: false, message: "Continuation rounds must be an integer between 0 and 32." };
  }
  if ((editor.agentRuntime === "glm" || editor.preset === "custom") && !editor.baseUrl.trim()) {
    return { ok: false, message: "This provider requires an endpoint." };
  }
  if (editor.credentialSource === "managed" && !editor.credentialConfigured && !editor.apiKey.trim()) {
    return { ok: false, message: "API key is required." };
  }

  return {
    ok: true,
    payload: {
      connection_id: editor.connectionId.trim() || slugify(editor.name),
      name: editor.name.trim(),
      agent_runtime: editor.agentRuntime,
      provider: editor.provider.trim() || PROVIDER_DEFAULTS[editor.agentRuntime]?.provider || editor.agentRuntime,
      protocol: editor.protocol,
      base_url: editor.baseUrl.trim() || null,
      models,
      default_model: defaultModel || null,
      max_input_tokens: editor.maxInputTokens,
      max_output_tokens: editor.maxOutputTokens,
      context_compression_enabled: editor.contextCompressionEnabled,
      context_compression_threshold_percent: editor.contextCompressionThresholdPercent,
      max_continuation_rounds: editor.maxContinuationRounds,
      credential_source: editor.credentialSource,
      credential_env: editor.credentialEnv,
      ...(editor.apiKey.trim() ? { api_key: editor.apiKey.trim() } : {}),
      status: editor.status === "disabled" ? "disabled" : "active",
      metadata: metadata.value,
    },
  };
}

function buildMcpServerPayload(editor = state.registryEditor.mcpServer) {
  const headers = parseJsonObject(editor.headersText);
  if (!headers.ok) return { ok: false, message: `MCP headers: ${headers.message}` };
  const environment = parseJsonObject(editor.environmentText);
  if (!environment.ok) return { ok: false, message: `MCP environment: ${environment.message}` };
  const secrets = parseJsonObject(editor.secretsText);
  if (!secrets.ok) return { ok: false, message: `MCP secrets: ${secrets.message}` };
  const riskOverrides = parseJsonObject(editor.riskOverridesText);
  if (!riskOverrides.ok) return { ok: false, message: `MCP risk overrides: ${riskOverrides.message}` };
  if (!editor.name.trim()) return { ok: false, message: "MCP server name is required." };
  if (!['stdio', 'streamable-http'].includes(editor.transport)) {
    return { ok: false, message: "Select a supported MCP transport." };
  }
  if (editor.transport === "stdio" && !desktopHost?.mcp?.configure) {
    return { ok: false, message: "Stdio MCP servers require My Mate Desktop." };
  }
  if (editor.transport === "stdio" && !editor.command.trim()) {
    return { ok: false, message: "Stdio MCP server executable is required." };
  }
  if (editor.transport === "streamable-http" && !editor.url.trim()) {
    return { ok: false, message: "Streamable HTTP MCP URL is required." };
  }
  const preset = state.mcpConnectorPresets.find((item) => item.preset_id === editor.presetId) || null;
  const presetSecretValues = Object.fromEntries(
    Object.entries(editor.presetSecretValues || {}).filter(([, value]) => typeof value === "string" && value.trim()),
  );
  const secretValues = {
    ...Object.fromEntries(
      Object.entries(secrets.value).filter(([, value]) => typeof value === "string" && value.trim()),
    ),
    ...presetSecretValues,
  };
  const missingRequiredSecret = (preset?.secrets || []).find((secret) =>
    secret.required && !editor.secretConfigured && !secretValues[secret.name]
  );
  if (editor.enabled && missingRequiredSecret) {
    return { ok: false, message: `${missingRequiredSecret.label} is required before enabling this connector.` };
  }
  return {
    ok: true,
    payload: {
      server_id: editor.serverId.trim() || slugify(editor.name).replaceAll("-", "."),
      name: editor.name.trim(),
      description: editor.description.trim() || null,
      transport: editor.transport,
      command: editor.transport === "stdio" ? editor.command.trim() : null,
      args: editor.transport === "stdio"
        ? editor.argsText.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)
        : [],
      url: editor.transport === "streamable-http" ? editor.url.trim() : null,
      headers: editor.transport === "streamable-http" ? headers.value : {},
      environment: editor.transport === "stdio" ? environment.value : {},
      enabled: editor.enabled,
      connect_timeout_ms: Number(editor.connectTimeoutMs),
      tool_timeout_ms: Number(editor.toolTimeoutMs),
      tool_filter: {
        include: editor.includeToolsText.split(",").map((item) => item.trim()).filter(Boolean),
        exclude: editor.excludeToolsText.split(",").map((item) => item.trim()).filter(Boolean),
      },
      default_risk_level: editor.defaultRiskLevel || null,
      tool_risk_overrides: riskOverrides.value,
      ...(Object.keys(secretValues).length ? { secrets: secretValues } : {}),
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

function getSetupConnection(preferredId = state.registryEditor.connection.connectionId) {
  const defaultConnectionId = state.agentProfiles.find((profile) => profile.profile_id === "default-agent")
    ?.provider_connection_id || "";
  return selectSetupConnection(state.providerConnections, preferredId || defaultConnectionId);
}

function createSetupConnectionEditor() {
  const editor = emptyProviderConnectionEditor();
  editor.name = `${PROVIDER_PRESETS[editor.preset].label} default`;
  return editor;
}

function syncSetupConnectionFromRegistry(force = false) {
  if (!state.setup.open || (!force && state.setup.editorTouched)) return;
  const connection = getSetupConnection();
  if (connection) state.registryEditor.connection = editorFromProviderConnection(connection);
}

function openStudioSetup(tab = "model", shouldRender = true) {
  const connection = getSetupConnection();
  if (connection) {
    state.registryEditor.connection = editorFromProviderConnection(connection);
  } else {
    state.registryEditor.connection = createSetupConnectionEditor();
  }
  state.setup.open = true;
  state.setup.tab = tab;
  state.setup.error = null;
  state.setup.editorTouched = false;
  if (shouldRender) render();
}

function maybeOpenStudioSetup() {
  if (state.setup.initialized) return;
  state.setup.initialized = true;
  if (!getSetupConnection() && !state.setup.dismissed) {
    openStudioSetup("model", false);
  }
}

async function loadRegistry(shouldRender = true) {
  state.registryLoading = true;
  if (shouldRender) render();
  try {
    const [connections, profiles, skills, mcpPresets, mcpServers] = await Promise.all([
      request("/api/registry/provider-connections"),
      request("/api/registry/agent-profiles"),
      request("/api/registry/skills"),
      request("/api/registry/mcp-connector-presets"),
      request("/api/registry/mcp-servers"),
    ]);
    state.providerConnections = connections.items || [];
    state.agentProfiles = profiles.items || [];
    state.skills = skills.items || [];
    state.mcpConnectorPresets = mcpPresets.items || [];
    state.mcpServers = mcpServers.items || [];
    syncSetupConnectionFromRegistry();
    const persistedAutonomy = state.agentProfiles.find((profile) => profile.profile_id === "default-agent")
      ?.metadata?.product_autonomy_mode;
    if (AUTONOMY_MODES.includes(persistedAutonomy)) {
      state.product.autonomyMode = persistedAutonomy;
      globalThis.localStorage?.setItem(STUDIO_AUTONOMY_STORAGE, persistedAutonomy);
    }
    maybeOpenStudioSetup();
  } catch (error) {
    state.error = error.message || "Failed to load registry.";
  } finally {
    state.registryLoading = false;
    if (shouldRender) render();
  }
}

function syncAutonomyControlState() {
  const activeMode = state.product.autonomyMode;
  document.querySelectorAll(".autonomy-option[data-mode]").forEach((button) => {
    const selected = button.dataset.mode === activeMode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.disabled = state.product.autonomySaving;
  });
  const badge = document.querySelector(".autonomy-policy-heading .badge");
  if (badge) badge.textContent = autonomyModeCopy(activeMode).label;
}

async function saveProductAutonomyMode(mode) {
  const nextMode = normalizeAutonomyMode(mode);
  const profile = state.agentProfiles.find((item) => item.profile_id === "default-agent") || null;
  const persistedMode = profile?.metadata?.product_autonomy_mode;
  if (!state.product.autonomySaving && nextMode === state.product.autonomyMode && persistedMode === nextMode) {
    return;
  }
  state.product.autonomyMode = nextMode;
  state.product.autonomySaving = true;
  state.error = null;
  state.notice = null;
  globalThis.localStorage?.setItem(STUDIO_AUTONOMY_STORAGE, nextMode);
  syncAutonomyControlState();
  let requiresRender = false;
  try {
    if (!profile) {
      state.notice = `Saved ${autonomyModeCopy(nextMode).label} for this Studio. Model setup will bind it to the default agent.`;
      requiresRender = true;
      return;
    }
    if (isGovernedAction("agent_profile.upsert")) {
      state.notice = `Saved ${autonomyModeCopy(nextMode).label} for this Studio. Workspace policy requires a governed Registry change before other clients inherit it.`;
      requiresRender = true;
      return;
    }
    const saved = await request("/api/registry/agent-profiles", {
      method: "POST",
      body: JSON.stringify({
        profile_id: profile.profile_id,
        name: profile.name,
        description: profile.description || "Default task execution profile",
        runtime_agent_ref: profile.runtime_agent_ref || "",
        agent_runtime: profile.agent_runtime || "codex",
        harness_profile: profile.harness_profile || "agent-harness-v1",
        provider_connection_id: profile.provider_connection_id || null,
        openclaw_agent_id: profile.openclaw_agent_id || "",
        default_skills: profile.default_skills || [],
        allowed_tools: profile.allowed_tools || [],
        disallowed_skills: profile.disallowed_skills || [],
        policy_tags: profile.policy_tags || [],
        status: profile.status || "active",
        metadata: {
          ...(profile.metadata || {}),
          product_autonomy_mode: nextMode,
        },
      }),
    });
    state.agentProfiles = [
      ...state.agentProfiles.filter((item) => item.profile_id !== saved.profile_id),
      saved,
    ];
  } catch (error) {
    state.error = `${error.message || "Failed to save workspace autonomy."} The local Studio preference remains ${autonomyModeCopy(nextMode).label}.`;
    requiresRender = true;
  } finally {
    state.product.autonomySaving = false;
    if (requiresRender) render();
    else syncAutonomyControlState();
  }
}

async function loadGovernance(shouldRender = true) {
  state.governance.loading = true;
  if (shouldRender) render();
  try {
    const result = await request("/api/governance/changes?limit=100");
    state.governance.policy = result.policy || null;
    state.governance.changes = result.items || [];
  } catch (error) {
    state.error = error.message || "Failed to load governance changes.";
  } finally {
    state.governance.loading = false;
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
    buildStudioLocationState();
  } catch (error) {
    state.error = error.message || "Failed to load missions.";
  } finally {
    state.missionsLoading = false;
    if (shouldRender) render();
  }
}

async function loadInbox(shouldRender = true) {
  state.inbox.loading = true;
  state.inbox.error = null;
  if (shouldRender) render();
  try {
    const [approvals, humanInputs, alerts, workspaceChanges, memoryCandidates] = await Promise.all([
      request("/api/approvals"),
      request("/api/human-inputs"),
      request("/api/supervision/alerts?status=open"),
      request("/api/runtime/workspace-change-sets"),
      request("/api/memory-candidates?status=pending"),
    ]);
    state.inbox.approvals = approvals.items || [];
    state.inbox.humanInputs = humanInputs.items || [];
    state.inbox.alerts = alerts.items || [];
    state.inbox.workspaceChanges = workspaceChanges.items || [];
    state.inbox.memoryCandidates = memoryCandidates.items || [];
    const selectedChangeSet = selectWorkspaceChangeSet(
      state.inbox.workspaceChanges,
      state.inbox.selectedWorkspaceChangeId,
    );
    state.inbox.selectedWorkspaceChangeId = selectedChangeSet?.change_set_id || "";
    state.inbox.selectedWorkspaceFile = selectWorkspaceFile(
      selectedChangeSet,
      state.inbox.selectedWorkspaceFile,
    )?.relative_path || "";
  } catch (error) {
    state.inbox.error = error.message || "Failed to load items that need attention.";
  } finally {
    state.inbox.loading = false;
    if (shouldRender) render();
  }
}

function selectWorkspaceChangeSetForReview(changeSetId) {
  const selected = selectWorkspaceChangeSet(state.inbox.workspaceChanges, changeSetId);
  state.inbox.selectedWorkspaceChangeId = selected?.change_set_id || "";
  state.inbox.selectedWorkspaceFile = selectWorkspaceFile(selected)?.relative_path || "";
  state.inbox.confirmWorkspaceChangeAction = "";
  state.error = null;
  render();
}

function selectWorkspaceChangeFileForReview(relativePath) {
  const selected = selectWorkspaceChangeSet(
    state.inbox.workspaceChanges,
    state.inbox.selectedWorkspaceChangeId,
  );
  state.inbox.selectedWorkspaceFile = selectWorkspaceFile(selected, relativePath)?.relative_path || "";
  state.inbox.confirmWorkspaceChangeAction = "";
  render();
}

async function resolveWorkspaceChangeSet(mode) {
  const selected = selectWorkspaceChangeSet(
    state.inbox.workspaceChanges,
    state.inbox.selectedWorkspaceChangeId,
  );
  if (!selected || !["apply", "reject"].includes(mode)) return;
  setActionLoading("workspace-change", selected.change_set_id, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    if (mode === "apply" && desktopHost?.workspace?.applyChangeSet && state.desktop.workspace) {
      await desktopHost.workspace.applyChangeSet({
        capabilityId: state.desktop.workspace.capabilityId,
        changeSetId: selected.change_set_id,
      });
    } else {
      await request(
        `/api/runtime/workspace-change-sets/${encodeURIComponent(selected.change_set_id)}/${mode}`,
        { method: "POST", body: JSON.stringify({ comment: "Reviewed in My Mate Studio" }) },
      );
    }
    state.inbox.confirmWorkspaceChangeAction = "";
    state.inbox.selectedWorkspaceChangeId = "";
    state.inbox.selectedWorkspaceFile = "";
    await loadInbox(false);
    state.notice = mode === "apply"
      ? "Reviewed workspace changes were applied to the source folder."
      : "Workspace changes were rejected. The source folder was not modified.";
  } catch (error) {
    state.error = error.message || `Failed to ${mode} workspace changes.`;
  } finally {
    setActionLoading("workspace-change", selected.change_set_id, false);
    render();
  }
}

async function resolveSupervisionAlert(alertId) {
  if (!alertId) return;
  setActionLoading("supervision-alert", alertId, true);
  state.error = null;
  try {
    await request(`/api/supervision/alerts/${encodeURIComponent(alertId)}/resolve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadInbox(false);
    if (state.workspaceDetail) {
      state.workspaceDetail.supervision_alerts = (state.workspaceDetail.supervision_alerts || []).filter(
        (alert) => alert.alert_id !== alertId,
      );
    }
    state.notice = "Supervisor alert dismissed. It will reopen only if the condition remains after the next scan.";
  } catch (error) {
    state.error = error.message || "Failed to resolve supervisor alert.";
  } finally {
    setActionLoading("supervision-alert", alertId, false);
    render();
  }
}

async function openSupervisionAlertRecommendation(sessionId, action) {
  if (action === "open-task-settings") {
    switchDesktopNav("settings");
    return;
  }
  if (action === "open-task-library") {
    switchDesktopNav("library");
    return;
  }
  if (!sessionId) return;
  await openSessionFromCommand("orchestrator", sessionId);
  if (action === "scan-task-recovery") {
    state.ui.taskRuntimeExpanded = true;
    await scanRuntimeRecovery();
  } else if (action === "review-task-plan") {
    state.ui.taskPlanExpanded = true;
    pendingWorkspaceFocus = "task-plan";
    render();
  } else if (action === "check-task-quality") {
    await checkTaskQuality();
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

async function loadDashboardSummary(shouldRender = true) {
  state.dashboardLoading = true;
  if (shouldRender) render();
  try {
    const params = new URLSearchParams({
      window_hours: String(state.dashboardFilters.windowHours || 24),
      status: state.dashboardFilters.status || "all",
      correlation_limit: "20",
      compare: state.dashboardFilters.comparePrevious ? "previous" : "none",
    });
    state.dashboardSummary = await request(`/api/dashboard/summary?${params.toString()}`);
  } catch (error) {
    state.error = error.message || "Failed to load dashboard summary.";
  } finally {
    state.dashboardLoading = false;
    if (shouldRender) render();
  }
}

async function loadMemoryStatus(shouldRender = true) {
  state.memoryLoading = true;
  if (shouldRender) render();
  try {
    const params = new URLSearchParams({
      status: state.memory.statusFilter || "active",
      limit: "500",
    });
    if (state.memory.scopeFilter !== "all") params.set("scope_kind", state.memory.scopeFilter);
    if (state.memory.kindFilter !== "all") params.set("kind", state.memory.kindFilter);
    if (state.memory.query.trim()) params.set("query", state.memory.query.trim());
    const recommendationSessionId = state.selectedSessionId || state.workspaceDetail?.session?.session_id || "";
    const [retrievalStatus, knowledgeStatus, memories, candidates, settings, observability, maintenance, intelligenceEvaluation, recommendations, overlays, contexts, onboarding, effectiveness] = await Promise.all([
      request("/api/memory-retrieval/status"),
      request("/api/memory-knowledge/status"),
      request(`/api/memories?${params.toString()}`),
      request("/api/memory-candidates?status=pending"),
      request("/api/memory-settings"),
      request("/api/memory-observability"),
      request("/api/memory-maintenance"),
      request("/api/memory-intelligence/evaluation"),
      recommendationSessionId
        ? request(`/api/sessions/${encodeURIComponent(recommendationSessionId)}/memory-recommendations`)
        : Promise.resolve(null),
      recommendationSessionId
        ? request(`/api/sessions/${encodeURIComponent(recommendationSessionId)}/memory-overlay`)
        : Promise.resolve(null),
      recommendationSessionId
        ? request(`/api/sessions/${encodeURIComponent(recommendationSessionId)}/memory-contexts`)
        : Promise.resolve(null),
      request("/api/memory-onboarding"),
      request("/api/memory-effectiveness"),
    ]);
    state.memory.retrievalStatus = retrievalStatus;
    state.memory.knowledgeStatus = knowledgeStatus;
    state.memory.records = memories.items || [];
    state.memory.candidates = candidates.items || [];
    state.memory.settings = settings;
    state.memory.observability = observability;
    state.memory.maintenance = maintenance.last_run || null;
    state.memory.intelligenceEvaluation = intelligenceEvaluation;
    state.memory.recommendations = recommendations;
    state.memory.overlays = overlays;
    state.memory.contexts = contexts;
    state.memory.onboarding = onboarding;
    state.memory.effectiveness = effectiveness;
  } catch (error) {
    state.error = error.message || "Failed to load memory status.";
  } finally {
    state.memoryLoading = false;
    if (shouldRender) render();
  }
}

async function searchMemoryFromStudio() {
  const query = state.memory.query.trim();
  if (!query || state.memoryLoading) return;
  state.memoryLoading = true;
  state.error = null;
  render();
  try {
    state.memory.searchResult = await request("/api/memory-retrieval/search", {
      method: "POST",
      body: JSON.stringify({ query, limit: 12 }),
    });
  } catch (error) {
    state.error = error.message || "Memory search failed.";
  } finally {
    state.memoryLoading = false;
    render();
  }
}

function currentMemoryRecommendation(recommendationId) {
  return (state.memory.recommendations?.recommendations || [])
    .find((item) => item.recommendation_id === recommendationId) || null;
}

function activeOverlayForRecommendation(item) {
  return (state.memory.overlays?.items || []).find((overlay) =>
    overlay.memory_id === item.memory_id &&
    overlay.memory_version === item.memory_version &&
    ["queued", "active", "stale"].includes(overlay.status),
  ) || null;
}

function updateMemoryRecommendationSurfaces() {
  const task = document.querySelector("[data-task-memory-recommendations]");
  if (task) task.innerHTML = renderTaskMemoryRecommendationContent();
  const center = document.querySelector("[data-memory-recommendation-list]");
  if (center) center.innerHTML = renderMemoryRecommendationListContent();
}

async function applyMemoryRecommendationAction(recommendationId, action) {
  const sessionId = state.selectedSessionId || state.workspaceDetail?.session?.session_id || "";
  const recommendation = currentMemoryRecommendation(recommendationId);
  if (!sessionId || !recommendation || state.memory.saving) return;
  state.memory.saving = true;
  document.querySelectorAll(`[data-recommendation-id="${CSS.escape(recommendationId)}"] button`)
    .forEach((button) => { button.disabled = true; });
  try {
    const result = await request(`/api/sessions/${encodeURIComponent(sessionId)}/memory-recommendations/${encodeURIComponent(recommendationId)}/feedback`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    if (action === "dismiss_for_session" || action === "not_relevant") {
      state.memory.recommendations.recommendations = state.memory.recommendations.recommendations
        .filter((item) => item.recommendation_id !== recommendationId);
    } else if (action === "use_next_turn" || action === "keep_for_session") {
      recommendation.application_state = action === "use_next_turn" ? "queued" : "kept";
      state.memory.overlays ||= { items: [] };
      if (result.overlay) state.memory.overlays.items = [result.overlay, ...(state.memory.overlays.items || [])];
    }
    state.notice = action === "use_next_turn"
      ? "Memory queued for the next reply."
      : action === "keep_for_session"
        ? "Memory will stay active for this Task."
        : "Memory recommendation feedback saved.";
    updateMemoryRecommendationSurfaces();
  } catch (error) {
    state.error = error.message || "Memory recommendation action failed.";
    render();
  } finally {
    state.memory.saving = false;
  }
}

async function removeMemoryOverlay(overlayId, recommendationId) {
  const sessionId = state.selectedSessionId || state.workspaceDetail?.session?.session_id || "";
  if (!sessionId || !overlayId || state.memory.saving) return;
  state.memory.saving = true;
  try {
    await request(`/api/sessions/${encodeURIComponent(sessionId)}/memory-overlay/${encodeURIComponent(overlayId)}`, {
      method: "DELETE",
    });
    state.memory.overlays.items = (state.memory.overlays?.items || []).filter((item) => item.overlay_id !== overlayId);
    const recommendation = currentMemoryRecommendation(recommendationId);
    if (recommendation) recommendation.application_state = recommendation.last_applied_context_id ? "applied" : "available";
    updateMemoryRecommendationSurfaces();
  } catch (error) {
    state.error = error.message || "Task Memory could not be removed.";
    render();
  } finally {
    state.memory.saving = false;
  }
}

async function startMemoryOnboardingFromStudio() {
  try {
    state.memory.onboarding = await request("/api/memory-onboarding/start", { method: "POST", body: "{}" });
    render();
  } catch (error) {
    state.error = error.message || "Memory onboarding could not start.";
    render();
  }
}

function onboardingDraftEntries() {
  const draft = state.memory.onboardingDraft;
  const sensitivity = draft.private ? "private" : "normal";
  const entries = [];
  if (draft.responsePreferences.trim()) entries.push({
    content: draft.responsePreferences.trim(), kind: "preference", scope_kind: "user", sensitivity, tags: ["onboarding", "response"], origin: "explicit",
  });
  if (draft.validationConventions.trim()) entries.push({
    content: draft.validationConventions.trim(), kind: "convention", scope_kind: "workspace", sensitivity, tags: ["onboarding", "validation"], origin: "explicit",
  });
  const projectId = state.workspaceDetail?.task_workspace?.project_id || state.desktop.workspace?.projectId || "";
  if (draft.projectConventions.trim() && projectId) entries.push({
    content: draft.projectConventions.trim(), kind: "convention", scope_kind: "project", scope_id: projectId, sensitivity, tags: ["onboarding", "project"], origin: "explicit",
  });
  return entries;
}

async function advanceMemoryOnboarding(complete = false) {
  const onboarding = state.memory.onboarding;
  if (!onboarding || state.memory.saving) return;
  state.memory.saving = true;
  try {
    const nextStep = Math.min(4, Math.max(1, Number(onboarding.step || 1) + (complete ? 0 : 1)));
    state.memory.onboarding = await request("/api/memory-onboarding/preview", {
      method: "POST",
      body: JSON.stringify({ step: nextStep, entries: onboardingDraftEntries() }),
    });
    if (complete) {
      state.memory.onboarding = await request("/api/memory-onboarding/complete", { method: "POST", body: "{}" });
      state.notice = "Memory onboarding completed.";
      await loadMemoryStatus(false);
    }
  } catch (error) {
    state.error = error.message || "Memory onboarding could not be saved.";
  } finally {
    state.memory.saving = false;
    render();
  }
}

async function dismissMemoryOnboardingFromStudio() {
  try {
    state.memory.onboarding = await request("/api/memory-onboarding/dismiss", { method: "POST", body: "{}" });
    render();
  } catch (error) {
    state.error = error.message || "Memory onboarding could not be dismissed.";
    render();
  }
}

async function rebuildMemoryFromStudio(target) {
  if (state.memory.rebuilding) return;
  state.memory.rebuilding = true;
  state.error = null;
  render();
  try {
    await request(target === "knowledge" ? "/api/memory-knowledge/rebuild" : "/api/memory-retrieval/rebuild", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadMemoryStatus(false);
    state.notice = target === "knowledge"
      ? "Knowledge provider sync completed."
      : "Memory index rebuilt from canonical records.";
  } catch (error) {
    state.error = error.message || "Memory rebuild failed.";
  } finally {
    state.memory.rebuilding = false;
    render();
  }
}

async function resolveMemoryCandidate(candidateId, decision) {
  if (!candidateId || !["approve", "reject"].includes(decision)) return;
  setActionLoading("memory-candidate", candidateId, true);
  state.error = null;
  try {
    await request(`/api/memory-candidates/${encodeURIComponent(candidateId)}/${decision}`, {
      method: "POST",
      body: JSON.stringify({ note: `Reviewed in Studio: ${decision}` }),
    });
    await Promise.all([loadMemoryStatus(false), loadInbox(false)]);
    state.notice = decision === "approve" ? "Memory candidate approved." : "Memory candidate rejected.";
  } catch (error) {
    state.error = error.message || `Failed to ${decision} memory candidate.`;
  } finally {
    setActionLoading("memory-candidate", candidateId, false);
    render();
  }
}

async function saveMemoryEdit(memoryId) {
  const content = state.memory.editContent.trim();
  if (!memoryId || !content) return;
  state.memory.saving = true;
  state.error = null;
  render();
  try {
    await request(`/api/memories/${encodeURIComponent(memoryId)}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
    state.memory.editingId = "";
    state.memory.editContent = "";
    await loadMemoryStatus(false);
    state.notice = "Memory updated.";
  } catch (error) {
    state.error = error.message || "Failed to update memory.";
  } finally {
    state.memory.saving = false;
    render();
  }
}

async function changeMemoryStatus(memoryId, mode) {
  if (!memoryId || !["delete", "restore"].includes(mode)) return;
  state.memory.saving = true;
  state.error = null;
  render();
  try {
    await request(`/api/memories/${encodeURIComponent(memoryId)}${mode === "restore" ? "/restore" : ""}`, {
      method: mode === "restore" ? "POST" : "DELETE",
      ...(mode === "restore" ? { body: JSON.stringify({}) } : {}),
    });
    await loadMemoryStatus(false);
    state.notice = mode === "restore" ? "Memory restored." : "Memory moved to deleted state.";
  } catch (error) {
    state.error = error.message || `Failed to ${mode} memory.`;
  } finally {
    state.memory.saving = false;
    render();
  }
}

async function saveMemorySettings() {
  if (!state.memory.settings || state.memory.saving) return;
  state.memory.saving = true;
  state.error = null;
  render();
  try {
    state.memory.settings = await request("/api/memory-settings", {
      method: "PUT",
      body: JSON.stringify(state.memory.settings),
    });
    await loadMemoryStatus(false);
    state.notice = "Memory settings saved.";
  } catch (error) {
    state.error = error.message || "Failed to save memory settings.";
  } finally {
    state.memory.saving = false;
    render();
  }
}

async function runMemoryMaintenanceFromStudio() {
  if (state.memory.rebuilding) return;
  state.memory.rebuilding = true;
  state.error = null;
  render();
  try {
    state.memory.maintenance = await request("/api/memory-maintenance", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadMemoryStatus(false);
    state.notice = "Memory maintenance completed.";
  } catch (error) {
    state.error = error.message || "Memory maintenance failed.";
  } finally {
    state.memory.rebuilding = false;
    render();
  }
}

async function runMemoryMaintenanceSweepFromStudio() {
  if (state.memory.rebuilding) return;
  state.memory.rebuilding = true;
  state.error = null;
  render();
  try {
    state.memory.maintenanceSweep = await request("/api/memory-maintenance/sweep", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadMemoryStatus(false);
    const sweep = state.memory.maintenanceSweep;
    state.notice = `Memory maintenance completed for ${sweep?.maintained_workspaces || 0} Workspace${sweep?.maintained_workspaces === 1 ? "" : "s"}.`;
  } catch (error) {
    state.error = error.message || "Workspace Memory maintenance failed.";
  } finally {
    state.memory.rebuilding = false;
    render();
  }
}

async function importMemoryFromStudio() {
  if (!state.memory.importText.trim() || state.memory.saving) return;
  state.memory.saving = true;
  state.error = null;
  render();
  try {
    state.memory.importResult = await request("/api/memories/import", {
      method: "POST",
      body: JSON.stringify({
        payload: state.memory.importText,
        strategy: state.memory.importStrategy,
        dry_run: state.memory.importDryRun,
      }),
    });
    if (!state.memory.importDryRun) await loadMemoryStatus(false);
    state.notice = state.memory.importDryRun ? "Import validation completed." : "Memory import completed.";
  } catch (error) {
    state.error = error.message || "Memory import failed.";
  } finally {
    state.memory.saving = false;
    render();
  }
}

async function exportMemoryFromStudio(format) {
  try {
    const headers = {
      ...(state.security.apiKey ? { authorization: `Bearer ${state.security.apiKey}` } : {}),
      ...(state.security.workspaceId ? { "x-my-mate-workspace-id": state.security.workspaceId } : {}),
    };
    const response = await fetch(`/api/memories/export?format=${format === "jsonl" ? "jsonl" : "json"}&status=all`, { headers });
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `memory-export.${format === "jsonl" ? "jsonl" : "json"}`;
    link.click();
    URL.revokeObjectURL(link.href);
    state.notice = "Memory export downloaded.";
  } catch (error) {
    state.error = error.message || "Memory export failed.";
  }
  render();
}

async function loadDagProposalDetail(sessionId, proposalId, requestOptions = {}) {
  if (!sessionId || !proposalId) return null;
  const response = await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals/${encodeURIComponent(proposalId)}`,
    requestOptions,
  );
  return response.proposal || null;
}

async function loadSessionDagProposals(
  sessionId,
  shouldRender = true,
  workspaceSeq = null,
  requestOptions = {},
) {
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
    const response = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals`,
      requestOptions,
    );
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
    const proposal = preferredId
      ? await loadDagProposalDetail(sessionId, preferredId, requestOptions)
      : null;
    if (workspaceSeq !== null && workspaceSeq !== workspaceLoadSeq) return null;
    applyDurableProposalToPlanner(proposal);
    return proposal;
  } catch (error) {
    if (error?.name === "AbortError") return null;
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

async function hydrateSessionWorkspaceSecondary({
  sessionId,
  activeRunId,
  loadSeq,
  signal,
  shouldRender,
}) {
  const [routeCompare, runtimeTrace, runtimeScorecards, runtimeEvaluations, _dagProposals, memoryRecommendations, memoryOverlays, memoryContexts] = await Promise.all([
    request(`/api/sessions/${encodeURIComponent(sessionId)}/compare`, { signal }).catch(() => null),
    activeRunId
      ? request(`/api/runs/${encodeURIComponent(activeRunId)}/trace?limit=500`, { signal }).catch(() => null)
      : Promise.resolve(null),
    activeRunId
      ? request(`/api/runs/${encodeURIComponent(activeRunId)}/scorecards`, { signal }).catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] }),
    activeRunId
      ? request(`/api/runs/${encodeURIComponent(activeRunId)}/evaluations`, { signal }).catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] }),
    loadSessionDagProposals(sessionId, false, loadSeq, { signal }),
    request(`/api/sessions/${encodeURIComponent(sessionId)}/memory-recommendations`, { signal }).catch(() => null),
    request(`/api/sessions/${encodeURIComponent(sessionId)}/memory-overlay`, { signal }).catch(() => null),
    request(`/api/sessions/${encodeURIComponent(sessionId)}/memory-contexts`, { signal }).catch(() => null),
  ]);
  if (signal.aborted || loadSeq !== workspaceLoadSeq) return;
  if (!state.workspaceDetail || getWorkspaceSessionId(state.workspaceDetail) !== sessionId) return;

  state.workspaceDetail = {
    ...state.workspaceDetail,
    route_compare: routeCompare,
    runtime_trace: runtimeTrace,
    runtime_scorecards: runtimeScorecards?.items || [],
    runtime_evaluations: runtimeEvaluations?.items || [],
  };
  state.memory.recommendations = memoryRecommendations;
  state.memory.overlays = memoryOverlays;
  state.memory.contexts = memoryContexts;
  if (routeCompare?.left || routeCompare?.right) {
    state.ui.routeCompareSelection = {
      leftKey: buildRouteCompareSelectionKey(routeCompare.left?.revision, routeCompare.left?.option),
      rightKey: buildRouteCompareSelectionKey(routeCompare.right?.revision, routeCompare.right?.option),
    };
  } else {
    synchronizeRouteCompareSelection(state.workspaceDetail);
  }
  cacheSessionWorkspace(sessionId, "", state.workspaceDetail);
  if (activeRunId) cacheSessionWorkspace(sessionId, activeRunId, state.workspaceDetail);
  if (shouldRender) renderTaskWorkspaceSurface();
  if (shouldRender) markTaskSwitchHydrated(sessionId);
}

async function loadSessionWorkspace(sessionId, shouldRender = true, options = {}) {
  const selectedRunId = options?.runId || "";
  const loadSeq = ++workspaceLoadSeq;
  if (workspaceLoadController) workspaceLoadController.abort();
  workspaceLoadController = new AbortController();
  const { signal } = workspaceLoadController;
  if (!sessionId) {
    state.workspaceDetail = null;
    state.workspaceLoadingSessionId = "";
    resetWorkspaceDrilldownState();
    resetDurableProposalState("");
    closeSessionStream();
    closeConversationSocket();
    state.conversationStream = null;
    if (shouldRender) render();
    return;
  }

  const currentSessionId = state.workspaceDetail?.session?.session_id || null;
  const enteringSession = currentSessionId !== sessionId;
  if (enteringSession) {
    state.memory.recommendations = null;
    state.memory.overlays = null;
    state.memory.contexts = null;
  }
  if (currentSessionId && enteringSession) resetWorkspaceDrilldownState();
  if (enteringSession) resetDurableProposalState(sessionId);
  state.workspaceLoadingSessionId = sessionId;

  const cachedDetail = getCachedSessionWorkspace(sessionId, selectedRunId);
  if (shouldRender) beginTaskSwitchMeasurement(sessionId, Boolean(cachedDetail));
  if (cachedDetail) {
    state.workspaceDetail = null;
    applyWorkspaceSnapshot(cachedDetail);
    state.selectedSessionId = sessionId;
    if (shouldRender) {
      renderTaskWorkspaceSurface();
      markTaskSwitchMainVisible(sessionId);
    }
  } else if (shouldRender) {
    showTaskWorkspacePending(sessionId);
  }

  try {
    const sessionQuery = selectedRunId ? `?run_id=${encodeURIComponent(selectedRunId)}` : "";
    const detail = await request(`/api/sessions/${encodeURIComponent(sessionId)}${sessionQuery}`, { signal });
    if (signal.aborted || loadSeq !== workspaceLoadSeq) return;
    if (state.error === "Mission not found." || state.error === "Session not found.") state.error = null;

    if (getWorkspaceSessionId(state.workspaceDetail) !== sessionId) state.workspaceDetail = null;
    applyWorkspaceSnapshot({
      ...detail,
      route_compare: cachedDetail?.route_compare || null,
      runtime_graph: detail.runtime_projection?.graph || null,
      runtime_projection: detail.runtime_projection || null,
      runtime_trace: cachedDetail?.runtime_trace || null,
      runtime_scorecards: cachedDetail?.runtime_scorecards || [],
      runtime_evaluations: cachedDetail?.runtime_evaluations || [],
      runtime_replay: cachedDetail?.runtime_replay || null,
      artifacts: detail.artifacts || [],
      pending_approvals: detail.pending_approvals || [],
      pending_human_inputs: detail.pending_human_inputs || [],
      interventions: detail.interventions || [],
      dag_patches: detail.dag_patches || [],
    });
    void synchronizeDesktopProjectForTask(detail);
    if (enteringSession && state.workspaceDetail?.workspace_state?.stage === "understand") {
      state.ui.taskConversationExpanded = true;
    }
    if (enteringSession) {
      const conversationTarget = getTaskConversationTarget(state.workspaceDetail);
      state.planner.conversationProviderConnectionId = conversationTarget?.connection.connection_id || "";
      state.planner.conversationModel = conversationTarget?.model || "";
    }
    synchronizeRouteCompareSelection(state.workspaceDetail);
    state.selectedSessionId = sessionId;
    state.workspaceLoadingSessionId = "";
    buildStudioLocationState();
    const activeRunId = getWorkspaceSelectedRunId(state.workspaceDetail) || "";
    cacheSessionWorkspace(sessionId, selectedRunId, state.workspaceDetail);
    if (activeRunId) cacheSessionWorkspace(sessionId, activeRunId, state.workspaceDetail);
    openSessionStream(sessionId, { runId: activeRunId });
    queueRestoredWorkspaceFocusFromLocation();
    if (shouldRender) {
      renderTaskWorkspaceSurface();
      markTaskSwitchMainVisible(sessionId);
    }

    await hydrateSessionWorkspaceSecondary({
      sessionId,
      activeRunId,
      loadSeq,
      signal,
      shouldRender,
    });
  } catch (error) {
    if (signal.aborted || error?.name === "AbortError" || loadSeq !== workspaceLoadSeq) return;
    state.workspaceLoadingSessionId = "";
    if (error?.status === 404 || error?.code === "not_found") {
      closeSessionStream();
      closeConversationSocket();
      resetWorkspaceDrilldownState();
      state.selectedSessionId = null;
      state.workspaceDetail = null;
      state.conversationStream = null;
      state.planner.error = null;
      state.error = null;
      state.notice = null;
      buildStudioLocationState();
      void loadMissions(false);
    } else {
      state.error = error.message || "Failed to load session workspace.";
    }
    if (shouldRender) render();
  } finally {
    if (loadSeq === workspaceLoadSeq && workspaceLoadController?.signal === signal) {
      workspaceLoadController = null;
    }
  }
}

async function loadWorkspaceData(nextSelectedId = state.selectedId) {
  const initialSessionId = state.selectedSessionId;
  const baseLoads = [
    loadTemplates(nextSelectedId),
    loadOrchestratorProfiles(false),
    loadRegistry(false),
    loadGovernance(false),
    loadRuntimeSummary(false),
    loadDashboardSummary(false),
    loadInbox(false),
  ];
  if (state.activeNav === "memory") {
    baseLoads.push(loadMemoryStatus(false));
  }

  if (initialSessionId) {
    await Promise.all([...baseLoads, loadSessionWorkspace(initialSessionId, false)]);
    queueRestoredWorkspaceFocusFromLocation();
    render();
    void Promise.all([
      loadMissions(false),
      loadSessions(false),
    ]).then(() => render());
    return;
  }

  await Promise.all([
    ...baseLoads,
    loadMissions(false),
    loadSessions(false),
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
    await loadInbox(false);
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
    resetAuthoringGraphSelection();
    const template = await request(`/api/templates/${encodeURIComponent(templateId)}`);
    state.editor = editorFromTemplate(template);
    resetAuthoringEditorState();
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
  const topology = validateGraphTopology(state.editor);
  if (!topology.valid) {
    state.error = topology.errors.map((item) => item.message).join(" ");
    state.notice = null;
    render();
    return;
  }
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
  if (isGovernedAction("template.publish")) {
    stageGovernanceProposal(
      "template.publish",
      state.editor.templateId,
      {},
      `Publish template ${state.editor.templateId}`,
    );
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
  if (isGovernedAction("template.archive")) {
    stageGovernanceProposal(
      "template.archive",
      state.editor.templateId,
      {},
      `Archive template ${state.editor.templateId}`,
    );
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
    const response = await createWorkspaceAttachmentRequest({
      name: editor.name.trim() || undefined,
      storage_uri: storageUri,
      mime_type: editor.mimeType.trim() || undefined,
      summary: editor.summary.trim() || undefined,
      kind: "context",
      created_by: "studio",
    });
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

function buildBrowserFileStorageUri(file) {
  const fileName = file?.name || "local-file";
  return `browser-file://${encodeURIComponent(fileName)}`;
}

function conversationFileExtension(fileName) {
  const index = String(fileName || "").lastIndexOf(".");
  return index >= 0 ? String(fileName).slice(index).toLowerCase() : "";
}

function assertConversationFileSupported(file) {
  const name = file?.name || "Local file";
  const extension = conversationFileExtension(name);
  if (CONVERSATION_SENSITIVE_FILE_PATTERN.test(name)) {
    throw new Error(`${name} is blocked because credential and certificate files cannot be attached.`);
  }
  if (!CONVERSATION_TEXT_EXTENSIONS.has(extension) && !String(file?.type || "").startsWith("text/")) {
    throw new Error(`${name} is not a supported text file. Upload Markdown, text, JSON, CSV, YAML, source code, or logs.`);
  }
  if (Number(file?.size || 0) > CONVERSATION_UPLOAD_MAX_BYTES) {
    throw new Error(`${name} exceeds the 512 KB conversation attachment limit.`);
  }
}

async function buildAttachmentPayloadFromFile(file) {
  assertConversationFileSupported(file);
  const name = file?.name || "Local file";
  const size = typeof file?.size === "number" && Number.isFinite(file.size) ? Math.max(0, Math.floor(file.size)) : null;
  const content = await file.text();
  if (content.includes("\0")) {
    throw new Error(`${name} appears to be binary and cannot be added as text context.`);
  }
  return {
    name,
    storage_uri: buildBrowserFileStorageUri(file),
    mime_type: file?.type || undefined,
    size_bytes: size,
    summary: "Uploaded text content available to the conversation model.",
    kind: "context",
    created_by: "studio",
    metadata: {
      source: "studio_conversation_upload",
      browser_path_available: false,
      relative_path: name,
      uploaded_text_content: content,
      last_modified:
        typeof file?.lastModified === "number" && Number.isFinite(file.lastModified)
          ? new Date(file.lastModified).toISOString()
          : null,
    },
  };
}

async function createWorkspaceAttachmentRequest(payload) {
  return await request(
    `/api/sessions/${encodeURIComponent(state.selectedSessionId)}/attachments`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

async function createWorkspaceAttachmentsFromFiles(fileList) {
  if (!state.selectedSessionId) {
    state.error = "Select a mission or session before attaching context.";
    state.notice = null;
    render();
    return;
  }
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) {
    return;
  }
  state.attachmentSaving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const payloads = await Promise.all(files.map((file) => buildAttachmentPayloadFromFile(file)));
    let latestResponse = null;
    for (const payload of payloads) {
      latestResponse = await createWorkspaceAttachmentRequest(payload);
    }
    if (state.workspaceDetail && latestResponse) {
      state.workspaceDetail.attachments = latestResponse.items || [latestResponse.attachment].filter(Boolean);
    }
    state.notice = `Attached ${files.length} file${files.length === 1 ? "" : "s"} as model context.`;
    await Promise.all([loadMissions(false), loadSessions(false)]);
  } catch (error) {
    state.error = error.message || "Failed to attach local file reference.";
  } finally {
    state.attachmentSaving = false;
    state.attachmentFilePickerKey += 1;
    render();
  }
}

async function removeWorkspaceAttachment(attachmentId) {
  if (!state.selectedSessionId || !attachmentId) return;
  state.attachmentSaving = true;
  state.error = null;
  try {
    const response = await request(
      `/api/sessions/${encodeURIComponent(state.selectedSessionId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE" },
    );
    if (state.workspaceDetail) state.workspaceDetail.attachments = response.items || [];
    state.notice = `Removed ${response.attachment?.name || "attachment"} from model context.`;
  } catch (error) {
    state.error = error.message || "Failed to remove the attachment.";
  } finally {
    state.attachmentSaving = false;
    render();
  }
}

function reconcileDesktopWorkspace(workspace, projectsResponse) {
  if (!workspace) return null;
  const projects = Array.isArray(projectsResponse?.items) ? projectsResponse.items : [];
  const active = projects.find((project) => project.active || project.projectId === workspace.projectId);
  return active
    ? {
        ...workspace,
        registeredProjectId: active.registeredProjectId || workspace.registeredProjectId || null,
        displayName: active.name || workspace.displayName || workspace.name,
        description: active.description ?? workspace.description ?? null,
        outputRelativePath: active.outputRelativePath || workspace.outputRelativePath || "outputs",
      }
    : workspace;
}

async function initializeDesktopHost() {
  if (!desktopHost) return;
  state.desktop.loading = true;
  state.desktop.error = null;
  render();
  try {
    const [hostInfo, services, workspace, projects] = await Promise.all([
      desktopHost.getHostInfo(),
      desktopHost.getServiceStatus(),
      desktopHost.workspace.get(),
      desktopHost.workspace.projects?.() || Promise.resolve({ items: [] }),
    ]);
    state.desktop.hostInfo = hostInfo;
    state.desktop.services = services;
    state.desktop.projects = projects?.items || [];
    state.desktop.workspace = reconcileDesktopWorkspace(workspace, projects);
    if (workspace) await loadDesktopWorkspaceDirectory("");
    desktopHost.onServiceStatus?.((nextServices) => {
      state.desktop.services = Array.isArray(nextServices) ? nextServices : [];
    });
  } catch (error) {
    state.desktop.error = error.message || "Desktop host is unavailable.";
  } finally {
    state.desktop.loading = false;
    render();
  }
}

async function chooseDesktopWorkspace(openNewTask = false) {
  if (!desktopHost) return;
  state.desktop.loading = true;
  state.desktop.error = null;
  render();
  try {
    const workspace = await desktopHost.workspace.choose();
    const projects = await desktopHost.workspace.projects?.();
    state.desktop.projects = projects?.items || state.desktop.projects;
    state.desktop.workspace = reconcileDesktopWorkspace(workspace, projects);
    state.desktop.listing = null;
    if (state.desktop.workspace) await loadDesktopWorkspaceDirectory("");
    state.ui.workspaceCreatorOpen = false;
    state.ui.workspaceCreatorStartTask = false;
    if (openNewTask && state.desktop.workspace) resetToNewTaskSurface();
  } catch (error) {
    state.desktop.error = error.message || "Failed to select the desktop workspace.";
  } finally {
    state.desktop.loading = false;
    render();
  }
}

async function createDesktopProject(openNewTask = false) {
  if (!desktopHost?.workspace?.create) return;
  state.desktop.loading = true;
  state.desktop.error = null;
  render();
  try {
    const workspace = await desktopHost.workspace.create({
      name: state.desktop.projectDraft.name,
      description: state.desktop.projectDraft.description,
      outputRelativePath: state.desktop.projectDraft.outputRelativePath,
    });
    const projects = await desktopHost.workspace.projects();
    state.desktop.projects = projects?.items || [];
    state.desktop.workspace = reconcileDesktopWorkspace(workspace, projects);
    state.desktop.projectDraft = { name: "", description: "", outputRelativePath: "outputs" };
    state.desktop.listing = null;
    if (state.desktop.workspace) await loadDesktopWorkspaceDirectory("");
    state.ui.workspaceCreatorOpen = false;
    state.ui.workspaceCreatorStartTask = false;
    if (openNewTask && state.desktop.workspace) resetToNewTaskSurface();
  } catch (error) {
    state.desktop.error = error.message || "Failed to create the Desktop Project.";
  } finally {
    state.desktop.loading = false;
    render();
  }
}

async function selectDesktopProject(projectId, registeredProjectId = "") {
  if (!desktopHost?.workspace?.select) return;
  state.desktop.loading = true;
  state.desktop.error = null;
  try {
    const workspace = await desktopHost.workspace.select({ projectId, registeredProjectId });
    const projects = await desktopHost.workspace.projects();
    state.desktop.projects = projects?.items || [];
    state.desktop.workspace = reconcileDesktopWorkspace(workspace, projects);
    state.desktop.listing = null;
    if (workspace) await loadDesktopWorkspaceDirectory("");
  } catch (error) {
    state.desktop.error = error.message || "Failed to select the Desktop Project.";
  } finally {
    state.desktop.loading = false;
    render();
  }
}

function resetToNewTaskSurface() {
  prepareWorkspaceSessionChange("");
  state.activeNav = "orchestrator";
  state.selectedSessionId = null;
  state.workspaceDetail = null;
  state.planner.intent = "";
  state.planner.error = null;
  buildStudioLocationState();
}

function openWorkspaceCreator(startTask = false) {
  state.ui.workspaceCreatorOpen = true;
  state.ui.workspaceCreatorStartTask = startTask;
  state.desktop.error = null;
  render();
  window.setTimeout(() => {
    document.querySelector('[data-workspace-creator-initial="true"]')?.focus();
  }, 0);
}

function closeWorkspaceCreator() {
  state.ui.workspaceCreatorOpen = false;
  state.ui.workspaceCreatorStartTask = false;
  state.desktop.error = null;
  render();
}

async function beginNewTaskInProject(projectId = "") {
  if (state.desktop.available && !projectId && !state.desktop.workspace) {
    state.planner.error = "Add or create a Workspace before starting a task.";
    openWorkspaceCreator(true);
    return;
  }
  if (projectId && state.desktop.workspace?.projectId !== projectId) {
    await selectDesktopProject(projectId);
  }
  state.ui.workspaceCreatorOpen = false;
  resetToNewTaskSurface();
  render();
  document.querySelector('textarea[data-field="planner.intent"]')?.focus();
}

function sessionRegisteredProjectId(sessionId) {
  const session = state.sessions.find((item) => item.session_id === sessionId) ||
    (state.workspaceDetail?.session?.session_id === sessionId ? state.workspaceDetail.session : null);
  return typeof session?.metadata?.local_project_id === "string"
    ? session.metadata.local_project_id
    : "";
}

function canMoveTaskToProject(sessionId, projectId) {
  const project = state.desktop.projects.find((item) => item.projectId === projectId && !item.archived);
  if (!sessionId || !project) return false;
  return !project.registeredProjectId || sessionRegisteredProjectId(sessionId) !== project.registeredProjectId;
}

async function moveTaskToDesktopProject(sessionId, projectId) {
  if (!desktopHost?.workspace?.moveTask || !canMoveTaskToProject(sessionId, projectId)) return;
  const target = state.desktop.projects.find((item) => item.projectId === projectId && !item.archived);
  if (!target) return;
  const startedAt = performanceNow();
  const fullRenderCountBefore = studioPerformance.fullRenderCount;
  const taskSurfaceRenderCountBefore = studioPerformance.taskSurfaceRenderCount;
  const activateTarget = state.selectedSessionId === sessionId;
  state.ui.taskMoveSessionId = sessionId;
  state.ui.taskMoveProjectId = projectId;
  state.desktop.error = null;
  state.error = null;
  studioPerformance.taskMove = {
    sessionId,
    projectId,
    status: "moving",
    startedAt,
    durationMs: null,
    fullRenderDelta: 0,
    taskSurfaceRenderDelta: 0,
  };
  publishStudioPerformance();
  pendingTaskMoveStreamSessions.add(sessionId);
  updateWorkspaceTaskMoveFeedback(sessionId, projectId);
  try {
    const response = await desktopHost.workspace.moveTask({
      sessionId,
      projectId,
      activate: activateTarget,
    });
    if (Array.isArray(response?.projects)) state.desktop.projects = response.projects;
    if (activateTarget && response?.workspace) {
      state.desktop.workspace = response.workspace;
      state.desktop.listing = null;
    }
    applyTaskProjectReassignment(sessionId, response);
    const projectName = target.name || response?.project?.name || "the selected Workspace";
    state.notice = `Moved task to ${projectName}.`;
    state.ui.taskMoveSessionId = "";
    state.ui.taskMoveProjectId = "";
    renderDesktopWorkspaceTreeSurface();
    if (activateTarget) renderDesktopWorkspaceBrowserSurface();
    renderTaskMoveAlert("success", state.notice);
    studioPerformance.taskMove.status = "completed";
  } catch (error) {
    state.desktop.error = error.message || "Failed to move the task to this Workspace.";
    state.error = state.desktop.error;
    renderTaskMoveAlert("danger", state.error);
    studioPerformance.taskMove.status = "failed";
  } finally {
    state.ui.taskMoveSessionId = "";
    state.ui.taskMoveProjectId = "";
    clearWorkspaceTaskMoveFeedback();
    studioPerformance.taskMove.durationMs = Math.round(performanceNow() - startedAt);
    studioPerformance.taskMove.fullRenderDelta = studioPerformance.fullRenderCount - fullRenderCountBefore;
    studioPerformance.taskMove.taskSurfaceRenderDelta =
      studioPerformance.taskSurfaceRenderCount - taskSurfaceRenderCountBefore;
    publishStudioPerformance();
    window.setTimeout(() => pendingTaskMoveStreamSessions.delete(sessionId), 500);
  }
}

function updateWorkspaceTaskMoveFeedback(sessionId, projectId) {
  clearWorkspaceTaskMoveFeedback();
  const task = document.querySelector(
    `[data-workspace-task-drag-session-id="${CSS.escape(sessionId)}"]`,
  );
  if (task) {
    task.classList.add("moving");
    task.setAttribute("aria-busy", "true");
    const subtitle = task.querySelector("small");
    if (subtitle) {
      task.dataset.previousSubtitle = subtitle.textContent || "";
      subtitle.textContent = "Moving to Workspace...";
    }
  }
  document.querySelector(
    `[data-workspace-drop-project-id="${CSS.escape(projectId)}"]`,
  )?.classList.add("receiving-task");
}

function clearWorkspaceTaskMoveFeedback() {
  for (const task of document.querySelectorAll(".workspace-task-item.moving")) {
    task.classList.remove("moving");
    task.removeAttribute("aria-busy");
    const subtitle = task.querySelector("small");
    if (subtitle && task.dataset.previousSubtitle !== undefined) {
      subtitle.textContent = task.dataset.previousSubtitle;
      delete task.dataset.previousSubtitle;
    }
  }
  document.querySelectorAll(".workspace-tree-project.receiving-task")
    .forEach((project) => project.classList.remove("receiving-task"));
}

function patchWorkspaceDetailProject(detail, response) {
  if (!detail || !response?.task_workspace) return detail;
  return {
    ...detail,
    session: reassignSessionProjectMetadata(detail.session, response.task_workspace),
    workspace_binding: response.binding || detail.workspace_binding,
    task_workspace: response.task_workspace,
  };
}

function applyTaskProjectReassignment(sessionId, response) {
  const taskWorkspace = response?.task_workspace;
  if (!taskWorkspace) return;
  state.sessions = state.sessions.map((session) =>
    session.session_id === sessionId ? reassignSessionProjectMetadata(session, taskWorkspace) : session,
  );
  if (state.workspaceDetail?.session?.session_id === sessionId) {
    state.workspaceDetail = patchWorkspaceDetailProject(state.workspaceDetail, response);
  }
  for (const [key, cached] of sessionWorkspaceCache.entries()) {
    if (!key.startsWith(`${sessionId}:`) || !cached?.detail) continue;
    sessionWorkspaceCache.set(key, {
      ...cached,
      detail: patchWorkspaceDetailProject(cached.detail, response),
    });
  }
}

function renderDesktopWorkspaceTreeSurface() {
  if (state.activeNav !== "orchestrator" || !state.desktop.available) return false;
  const sidebar = document.querySelector(".orchestrator-sidebar");
  if (!sidebar) return false;
  const listScrollTop = sidebar.querySelector(".workspace-tree-list")?.scrollTop || 0;
  sidebar.innerHTML = renderDesktopWorkspaceTree();
  const nextList = sidebar.querySelector(".workspace-tree-list");
  if (nextList) nextList.scrollTop = listScrollTop;
  return true;
}

function renderDesktopWorkspaceBrowserSurface() {
  const browser = document.querySelector(".desktop-local-browser");
  if (!browser) return false;
  browser.outerHTML = renderDesktopWorkspaceBrowser();
  return true;
}

function renderTaskMoveAlert(tone, message) {
  document.querySelector(".task-move-alert")?.remove();
  const grid = document.querySelector(".app-shell > .workspace > .desktop-grid");
  if (!grid || !message) return;
  grid.insertAdjacentHTML(
    "beforebegin",
    `<div class="alert ${escapeHtml(tone)} task-move-alert">${escapeHtml(message)}</div>`,
  );
}

async function archiveDesktopProject(projectId) {
  if (!desktopHost?.workspace?.archiveProject || !projectId) return;
  const archivedActiveProject = state.desktop.workspace?.projectId === projectId;
  state.desktop.loading = true;
  state.desktop.error = null;
  try {
    const result = await desktopHost.workspace.archiveProject({ projectId });
    state.desktop.projects = result?.items || [];
    state.desktop.workspace = reconcileDesktopWorkspace(
      await desktopHost.workspace.get(),
      { items: state.desktop.projects },
    );
    state.desktop.listing = null;
    if (state.desktop.workspace) await loadDesktopWorkspaceDirectory("");
    if (archivedActiveProject) resetToNewTaskSurface();
  } catch (error) {
    state.desktop.error = error.message || "Failed to archive the Desktop Project.";
  } finally {
    state.desktop.loading = false;
    render();
  }
}

async function synchronizeDesktopProjectForTask(detail) {
  const registeredProjectId = detail?.task_workspace?.project?.project_id || "";
  if (!registeredProjectId || !desktopHost?.workspace?.select) return;
  const project = state.desktop.projects.find((item) => item.registeredProjectId === registeredProjectId && !item.archived);
  if (!project || project.active) return;
  await selectDesktopProject(project.projectId, registeredProjectId);
}

async function ensureDesktopWorkspaceBinding(sessionId, access = "snapshot-read") {
  const workspace = state.desktop.workspace;
  if (!desktopHost || !workspace || !sessionId) return null;
  const currentResponse = await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/workspace-binding`,
  );
  const current = currentResponse.binding || null;
  if (
    current?.status === "active" &&
    (current.access === access || current.access === "sandbox-write")
  ) {
    if (state.workspaceDetail?.session?.session_id === sessionId) {
      state.workspaceDetail.workspace_binding = current;
    }
    return current;
  }
  const response = await desktopHost.workspace.authorize({
    capabilityId: workspace.capabilityId,
    sessionId,
    access,
    scope: "session",
  });
  const binding = response?.binding || null;
  const projects = await desktopHost.workspace.projects?.();
  if (projects?.items) {
    state.desktop.projects = projects.items;
    state.desktop.workspace = reconcileDesktopWorkspace(
      await desktopHost.workspace.get(),
      projects,
    );
  }
  if (state.workspaceDetail?.session?.session_id === sessionId) {
    state.workspaceDetail.workspace_binding = binding;
    state.workspaceDetail.task_workspace = response?.task_workspace || state.workspaceDetail.task_workspace;
  }
  return binding;
}

async function authorizeDesktopWorkspaceWrite() {
  const sessionId = state.selectedSessionId || getWorkspaceSessionId(state.workspaceDetail);
  if (!sessionId || !state.desktop.workspace) return;
  state.desktop.loading = true;
  state.desktop.error = null;
  state.error = null;
  render();
  try {
    const binding = await ensureDesktopWorkspaceBinding(sessionId, "sandbox-write");
    await loadSessionWorkspace(sessionId, false);
    state.notice = `Sandbox edits are allowed for ${binding?.display_name || state.desktop.workspace.name} in this task.`;
    if (state.workspaceDetail?.autopilot?.pending_gate === "workspace_authorization") {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/autopilot/resume`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadSessionWorkspace(sessionId, false);
    }
  } catch (error) {
    state.desktop.error = error.message || "Workspace authorization failed.";
    state.error = state.desktop.error;
  } finally {
    state.desktop.loading = false;
    render();
  }
}

async function loadDesktopWorkspaceDirectory(relativePath = "") {
  const workspace = state.desktop.workspace;
  if (!desktopHost || !workspace) return;
  state.desktop.loading = true;
  state.desktop.error = null;
  render();
  try {
    state.desktop.listing = await desktopHost.workspace.list({
      capabilityId: workspace.capabilityId,
      relativePath,
    });
  } catch (error) {
    state.desktop.error = error.message || "Failed to read the desktop workspace.";
  } finally {
    state.desktop.loading = false;
    render();
  }
}

async function attachDesktopWorkspaceFile(relativePath) {
  const workspace = state.desktop.workspace;
  if (!desktopHost || !workspace || !state.selectedSessionId) return;
  state.attachmentSaving = true;
  state.desktop.error = null;
  state.error = null;
  state.notice = null;
  render();
  try {
    const file = await desktopHost.workspace.readText({
      capabilityId: workspace.capabilityId,
      relativePath,
    });
    const response = await createWorkspaceAttachmentRequest({
      name: file.name,
      storage_uri: file.fileUrl,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
      summary: `Read-only desktop context from ${file.relativePath}.`,
      kind: "context",
      created_by: "studio-desktop",
      metadata: {
        source: "desktop_workspace",
        workspace_name: workspace.name,
        relative_path: file.relativePath,
        modified_at: file.modifiedAt,
        desktop_path_available: true,
        desktop_text_content: file.content,
      },
    });
    if (state.workspaceDetail) {
      state.workspaceDetail.attachments = response.items || [response.attachment].filter(Boolean);
    }
    state.notice = `Attached ${file.name} with readable local content.`;
    await Promise.all([loadMissions(false), loadSessions(false)]);
  } catch (error) {
    state.desktop.error = error.message || "Failed to attach the desktop file.";
    state.error = state.desktop.error;
  } finally {
    state.attachmentSaving = false;
    render();
  }
}

function getWorkspaceContextReferenceByKey(key) {
  const normalizedKey = String(key || "");
  if (!normalizedKey || !state.workspaceDetail) return null;
  return buildWorkspaceContextBrowserItems(state.workspaceDetail).find((item) => item.key === normalizedKey) || null;
}

async function attachWorkspaceContextReference(key) {
  if (!state.selectedSessionId) {
    state.error = "Select a mission or session before attaching context.";
    state.notice = null;
    render();
    return;
  }
  const item = getWorkspaceContextReferenceByKey(key);
  if (!item?.storageUri) {
    state.error = "Selected workspace item has no reusable reference.";
    state.notice = null;
    render();
    return;
  }
  state.attachmentSaving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const response = await createWorkspaceAttachmentRequest({
      name: item.title,
      storage_uri: item.storageUri,
      mime_type: item.mimeType || undefined,
      size_bytes: item.sizeBytes ?? undefined,
      summary: item.summary || undefined,
      kind: "context",
      created_by: "studio",
      metadata: {
        source: "studio_workspace_browser",
        source_type: item.type,
        source_key: item.key,
      },
    });
    if (state.workspaceDetail) {
      state.workspaceDetail.attachments = response.items || [response.attachment].filter(Boolean);
    }
    state.notice = `Attached ${response.attachment?.name || item.title || "workspace item"}.`;
    await Promise.all([loadMissions(false), loadSessions(false)]);
  } catch (error) {
    state.error = error.message || "Failed to attach workspace reference.";
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

  if (state.desktop.available && !state.desktop.workspace) {
    state.planner.error = "Add or create a Workspace before starting a task.";
    openWorkspaceCreator(true);
    return;
  }

  const conversationTarget = getSelectedConversationTarget();
  if (!conversationTarget) {
    state.planner.error = "Choose or verify a conversation model in Settings first.";
    render();
    return;
  }
  const requestId = globalThis.crypto?.randomUUID?.() || `conversation-${Date.now().toString(36)}`;
  let sessionId = state.selectedSessionId;
  let resumeLatestUser = false;
  let workspaceBound = false;
  state.planning = true;
  state.planner.error = null;
  state.error = null;
  state.notice = null;
  state.planner.intent = "";
  state.conversationStream = {
    requestId,
    sessionId: sessionId || "",
    userText: content,
    text: "",
    providerConnectionId: conversationTarget.connection.connection_id,
    model: conversationTarget.model,
    toolProgress: [],
  };
  render();
  try {
    if (!sessionId) {
      const payload = {
        initial_message: content,
        created_by: "studio-orchestrator",
        provider_connection_id: conversationTarget.connection.connection_id,
        model: conversationTarget.model,
        defer_conversation_reply: true,
        autonomy_mode: state.product.autonomyMode,
      };
      if (state.orchestrator.selectedProfileId) {
        payload.orchestrator_profile_id = state.orchestrator.selectedProfileId;
      }
      const created = await request("/api/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      sessionId = created.session?.session_id || created.session?.id || null;
      resumeLatestUser = created.conversation_deferred === true;
      if (sessionId) {
        state.selectedSessionId = sessionId;
        state.conversationStream.sessionId = sessionId;
        if (state.desktop.workspace && desktopHost) {
          await ensureDesktopWorkspaceBinding(sessionId, "snapshot-read");
          workspaceBound = true;
        }
        await Promise.all([
          loadMissions(false),
          loadSessions(false),
          loadSessionWorkspace(sessionId, false),
        ]);
        render();
      }
    }

    if (!sessionId) throw new Error("The new task did not return a Session id.");
    if (state.desktop.workspace && desktopHost && !workspaceBound) {
      try {
        await ensureDesktopWorkspaceBinding(sessionId, "snapshot-read");
      } catch (error) {
        state.desktop.error = error.message || "The selected Desktop workspace could not be linked to this task.";
      }
    }
    await sendConversationSocketTurn(sessionId, {
      request_id: requestId,
      ...(resumeLatestUser ? { resume_latest_user: true } : { content }),
      provider_connection_id: conversationTarget.connection.connection_id,
      model: conversationTarget.model,
    });
    await Promise.all([
      loadSessionWorkspace(sessionId, false),
      loadMissions(false),
      loadSessions(false),
    ]);
  } catch (error) {
    if (sessionId && error?.started) await loadSessionWorkspace(sessionId, false);
    state.planner.error = error.message || "Failed to send message to My Mate.";
  } finally {
    state.planning = false;
    state.conversationStream = null;
    render();
  }
}

async function resumeTaskCheckpoint() {
  const sessionId = state.workspaceDetail?.session?.session_id || state.selectedSessionId || "";
  const checkpoint = state.workspaceDetail?.task_checkpoint || null;
  if (!sessionId || !checkpoint?.checkpoint_id || checkpoint.status !== "resumable") return;
  const target = getTaskConversationTarget(state.workspaceDetail) || getSelectedConversationTarget(getConversationTargets());
  state.planning = true;
  state.planner.error = null;
  render();
  try {
    await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/checkpoints/${encodeURIComponent(checkpoint.checkpoint_id)}/resume`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(target?.connection?.connection_id
            ? { provider_connection_id: target.connection.connection_id }
            : {}),
          ...(target?.model ? { model: target.model } : {}),
        }),
      },
    );
    await Promise.all([
      loadSessionWorkspace(sessionId, false),
      loadMissions(false),
      loadSessions(false),
    ]);
  } catch (error) {
    state.planner.error = error.message || "The interrupted task could not be resumed.";
  } finally {
    state.planning = false;
    render();
  }
}

async function sendTaskGuidanceDirective(action) {
  const content = taskGuidanceDirective(action);
  const sessionId = state.selectedSessionId || getWorkspaceSessionId(state.workspaceDetail);
  if (!content || !sessionId) return;

  state.planning = true;
  state.planner.error = null;
  state.error = null;
  state.notice = null;
  render();
  try {
    await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    await Promise.all([
      loadMissions(false),
      loadSessions(false),
      loadSessionWorkspace(sessionId, false),
      loadInbox(false),
    ]);
    const guidance = deriveTaskGuidance(state.workspaceDetail);
    if (action === "refresh-task-plan") {
      state.notice = guidance.primaryAction === "refresh-task-plan" ? null : "Updated the task plan.";
    } else {
      state.notice = ["running", "paused", "decision", "result"].includes(guidance.phase)
        ? "Started the task."
        : null;
    }
  } catch (error) {
    state.error = error.message || "My Mate could not advance the task.";
  } finally {
    state.planning = false;
    render();
  }
}

async function maybeAutoAdvanceTask(sessionId) {
  if (
    state.product.autonomyMode !== "autopilot" ||
    !sessionId ||
    state.selectedSessionId !== sessionId ||
    autopilotAdvanceAttempts.has(sessionId)
  ) {
    return;
  }
  const experience = buildTaskExperience(state.workspaceDetail);
  if (!experience.modelVerified || experience.guidance.primaryAction !== "start-task-work") {
    return;
  }
  autopilotAdvanceAttempts.add(sessionId);
  try {
    await request(`/api/sessions/${encodeURIComponent(sessionId)}/autopilot`, {
      method: "PUT",
      body: JSON.stringify({ mode: "autopilot", max_iterations: 12, max_runtime_minutes: 120 }),
    });
    await request(`/api/sessions/${encodeURIComponent(sessionId)}/autopilot/resume`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadSessionWorkspace(sessionId, false);
    state.notice = "Autopilot started within the configured policy boundaries.";
  } catch (error) {
    state.error = error.message || "Autopilot could not start.";
    render();
  }
}

async function controlTaskAutopilot(action) {
  const sessionId = state.selectedSessionId || getWorkspaceSessionId(state.workspaceDetail);
  if (!sessionId) return;
  setActionLoading("task-autopilot", sessionId, true);
  state.error = null;
  state.notice = null;
  render();
  try {
    if (action === "resume") {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/autopilot`, {
        method: "PUT",
        body: JSON.stringify({ mode: state.product.autonomyMode }),
      });
    }
    const controller = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/autopilot/${encodeURIComponent(action)}`,
      { method: "POST", body: JSON.stringify({}) },
    );
    if (state.workspaceDetail) state.workspaceDetail.autopilot = controller;
    await loadSessionWorkspace(sessionId, false);
    state.notice = controller.status === "blocked" || controller.status === "failed"
      ? null
      : controller.status === "waiting_human"
        ? "Autopilot is waiting for a required human decision."
        : action === "pause"
          ? "Autopilot paused."
          : action === "resume"
            ? "Autopilot resumed."
            : "Autopilot checked the task.";
  } catch (error) {
    state.error = error.message || `Autopilot ${action} failed.`;
  } finally {
    setActionLoading("task-autopilot", sessionId, false);
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

function getTaskInventoryLabels(mission) {
  const snapshot = mission?.mission_snapshot || null;
  const title =
    snapshot?.missionTitle ||
    mission?.mission_view?.title ||
    mission?.mission_spec?.objective ||
    mission?.title ||
    "Untitled task";
  const status = String(snapshot?.missionStatusLabel || mission?.status || "ready").replaceAll("_", " ");
  const next = snapshot?.nextActionLabel || mission?.mission_view?.nextActionLabel || "";
  const subtitle = next && !/route|revision|dag|plan/i.test(next) ? next : status;
  return {
    title,
    subtitle: mission?.archived ? `Archived / ${subtitle}` : subtitle,
    tone: snapshot?.missionStatusTone || statusTone(mission?.status || "ready"),
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
  if (TASK_NAV_IDS.has(nav)) state.ui.navigationTab = "task";
  if (ADVANCED_NAV_IDS.has(nav)) state.ui.navigationTab = "advanced";
  state.error = null;
  if (nav === "dashboard" && !state.dashboardSummary && !state.dashboardLoading) {
    void loadDashboardSummary(false).then(() => render());
  }
  if (nav === "inbox" && !state.inbox.loading) {
    void loadInbox(false).then(() => render());
  }
  if (nav === "memory" && !state.memory.retrievalStatus && !state.memoryLoading) {
    void loadMemoryStatus(false).then(() => render());
  }
  buildStudioLocationState();
  render();
}

function switchDesktopNavigationTab(tab) {
  const nextTab = tab === "advanced" ? "advanced" : "task";
  const currentTab = ADVANCED_NAV_IDS.has(state.activeNav) ? "advanced" : "task";
  state.ui.navigationTab = nextTab;
  if (nextTab === currentTab) {
    render();
    return;
  }
  switchDesktopNav(nextTab === "advanced" ? "missions" : "orchestrator");
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

async function openSessionFromCommand(nav, sessionId, options = {}) {
  if (!sessionId) return;
  prepareWorkspaceSessionChange(sessionId);
  state.activeNav = nav;
  state.selectedSessionId = sessionId;
  pendingSessionInventoryScroll = true;
  await loadSessionWorkspace(sessionId, true, options);
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

  if (kind === "execution-queue" || kind === "workspace-feed" || kind === "checkpoint-ledger" || kind === "output-history") {
    pendingWorkspaceFocus = kind;
    state.notice = "Opened workspace queue.";
    render();
    return;
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

async function openDashboardHotspotSession(sessionId, focusKind, runId = "") {
  if (!sessionId) return;
  await openSessionFromCommand("missions", sessionId, { runId: runId || null });
  if (focusKind) {
    await openWorkspaceFocusPanel(focusKind);
  }
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
      key: "nav:dashboard",
      group: "Navigate",
      title: "Go to Dashboard",
      subtitle: "Unified runtime dashboard and operator backlog",
      keywords: ["dashboard", "observability", "runtime", "backlog", "health"],
      run: async () => {
        state.activeNav = "dashboard";
        await Promise.all([loadRuntimeSummary(false), loadDashboardSummary(false)]);
        render();
      },
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
    {
      key: "refresh:dashboard",
      group: "Refresh",
      title: "Refresh Dashboard",
      subtitle: "Dashboard summary and runtime posture",
      keywords: ["dashboard", "summary", "reload"],
      run: async () => {
        await Promise.all([loadRuntimeSummary(false), loadDashboardSummary(false)]);
        state.notice = "Dashboard refreshed.";
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

function applyPendingAuthoringGraphFocus() {
  if (!pendingAuthoringGraphFocus) return;
  const focus = pendingAuthoringGraphFocus;
  pendingAuthoringGraphFocus = null;
  const attribute = focus.type === "edge" ? "data-authoring-edge-index" : "data-authoring-node-index";
  window.setTimeout(() => {
    const target = document.querySelector(`[${attribute}="${focus.index}"]`);
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

function applyPendingRuntimeNodeFocus() {
  if (!pendingRuntimeNodeFocus) return;
  pendingRuntimeNodeFocus = false;
  window.setTimeout(() => {
    const target = document.querySelector(`.runtime-graph-node[data-node-run-id="${CSS.escape(state.ui.runtimeNodeRunId)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    target.focus({ preventScroll: true });
  }, 0);
}

function afterRender() {
  if (state.commandPaletteOpen && !pendingCommandPaletteFocus) {
    pendingCommandPaletteFocus = "end";
  }
  applyPendingCommandPaletteFocus();
  applyPendingWorkspaceFocus();
  applyPendingWorkspaceFeedEntryHighlight();
  applyPendingAuthoringGraphFocus();
  applyPendingSessionInventoryScroll();
  applyPendingRuntimeNodeFocus();
  void hydrateArtifactMermaidDiagrams();
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

async function saveGovernancePolicy() {
  const policy = state.governance.policy;
  if (!policy) return;
  state.governance.saving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    state.governance.policy = await request("/api/governance/policy", {
      method: "POST",
      body: JSON.stringify({
        mode: policy.mode,
        required_approvals: Number(policy.required_approvals) || 1,
        allow_self_approval: policy.allow_self_approval === true,
        protected_actions: policy.protected_actions || [],
      }),
    });
    state.notice = `Governance policy is now ${state.governance.policy.mode}.`;
  } catch (error) {
    state.error = error.message || "Failed to update governance policy.";
  } finally {
    state.governance.saving = false;
    render();
  }
}

async function submitGovernanceProposal() {
  const draft = state.governance.draft;
  const payload = parseJsonObject(draft.payloadText);
  if (!payload.ok) {
    state.error = `Governance payload: ${payload.message}`;
    render();
    return;
  }
  if (!draft.resourceId.trim() || !draft.reason.trim()) {
    state.error = "Governance resource ID and reason are required.";
    render();
    return;
  }
  state.governance.saving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const change = await request("/api/governance/changes", {
      method: "POST",
      body: JSON.stringify({
        action: draft.action,
        resource_id: draft.resourceId.trim(),
        reason: draft.reason.trim(),
        payload: payload.value,
      }),
    });
    state.notice = `Proposed ${change.change_id}`;
    state.governance.draft = emptyGovernanceState().draft;
    await loadGovernance(false);
  } catch (error) {
    state.error = error.message || "Failed to propose governed change.";
  } finally {
    state.governance.saving = false;
    render();
  }
}

async function decideStudioGovernanceChange(changeId, decision) {
  if (!changeId || !["approve", "reject", "apply"].includes(decision)) return;
  state.governance.saving = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const change = await request(
      `/api/governance/changes/${encodeURIComponent(changeId)}/${decision}`,
      { method: "POST", body: JSON.stringify({}) },
    );
    state.notice = `${change.change_id} is ${change.status}.`;
    await Promise.all([
      loadGovernance(false),
      decision === "apply" ? loadRegistry(false) : Promise.resolve(),
      decision === "apply" ? loadTemplates(state.selectedId) : Promise.resolve(),
      decision === "apply" ? loadRuntimeSummary(false) : Promise.resolve(),
    ]);
  } catch (error) {
    state.error = error.message || `Failed to ${decision} governed change.`;
  } finally {
    state.governance.saving = false;
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
  const governedProfileId = draft.payload.profile_id || slugify(draft.payload.name);
  if (isGovernedAction("agent_profile.upsert")) {
    stageGovernanceProposal(
      "agent_profile.upsert",
      governedProfileId,
      draft.payload,
      `Create or update agent profile ${governedProfileId}`,
    );
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

async function saveProviderConnection() {
  const draft = buildProviderConnectionPayload();
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
    const saved = await request("/api/registry/provider-connections", {
      method: "POST",
      body: JSON.stringify(draft.payload),
    });
    state.notice = `Saved Provider Connection ${saved.connection_id}`;
    state.registryEditor.connection = editorFromProviderConnection(saved);
    await loadRegistry(false);
    if (state.registryEditor.profile.mode === "new" && !state.registryEditor.profile.providerConnectionId) {
      updateAgentProfileEditor({
        agentRuntime: saved.agent_runtime,
        providerConnectionId: saved.connection_id,
        openclawProvider: saved.provider,
      });
    }
    state.ui.providerConnectionModalOpen = false;
  } catch (error) {
    state.error = error.message || "Failed to save Provider Connection.";
  } finally {
    state.registrySaving = false;
    render();
  }
}

async function testProviderConnection(connectionId = state.registryEditor.connection.connectionId) {
  const id = connectionId.trim();
  if (!id) {
    state.error = "Save the Provider Connection before testing it.";
    render();
    return;
  }

  state.providerConnectionTestingId = id;
  state.error = null;
  state.notice = null;
  render();
  try {
    const result = await request(
      `/api/registry/provider-connections/${encodeURIComponent(id)}/test`,
      { method: "POST", body: JSON.stringify({}) },
    );
    const updated = result.connection;
    state.providerConnections = state.providerConnections.map((connection) =>
      connection.connection_id === updated.connection_id ? updated : connection
    );
    state.registryEditor.connection = editorFromProviderConnection(updated);
    state.notice = result.verification?.status === "verified"
      ? `Connection verified: ${updated.name}`
      : `Connection test failed: ${updated.name}`;
  } catch (error) {
    state.error = error.code === "route_not_found"
      ? "The running API Gateway does not expose connection testing yet. Restart the API Gateway and try again."
      : error.message || "Connection test could not be completed.";
  } finally {
    state.providerConnectionTestingId = "";
    render();
  }
}

async function saveMcpServer() {
  const draft = buildMcpServerPayload();
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
    const saved = draft.payload.transport === "stdio"
      ? await desktopHost.mcp.configure({ operation: "upsert", workspaceId: state.security.workspaceId || "default", config: draft.payload })
      : await request("/api/registry/mcp-servers", { method: "POST", body: JSON.stringify(draft.payload) });
    state.registryEditor.mcpServer = editorFromMcpServer(saved);
    state.ui.mcpServerModalOpen = false;
    state.notice = saved.status === "error"
      ? `Saved ${saved.name}, but connection failed: ${saved.last_error || "unknown error"}`
      : `Saved MCP server ${saved.name}`;
    await loadRegistry(false);
  } catch (error) {
    state.error = error.message || "Failed to save MCP server.";
  } finally {
    state.registrySaving = false;
    render();
  }
}

async function testMcpServer(serverId = state.registryEditor.mcpServer.serverId) {
  const id = serverId.trim();
  const server = state.mcpServers.find((item) => item.server_id === id);
  if (!server) {
    state.error = "Save the MCP server before testing it.";
    render();
    return;
  }
  state.mcpServerTestingId = id;
  state.error = null;
  state.notice = null;
  render();
  try {
    const updated = server.transport === "stdio"
      ? await desktopHost.mcp.configure({ operation: "test", workspaceId: state.security.workspaceId || "default", serverId: id })
      : await request(`/api/registry/mcp-servers/${encodeURIComponent(id)}/test`, { method: "POST", body: JSON.stringify({}) });
    state.notice = `${updated.name} discovered ${(updated.discovered_tools || []).length} MCP tool(s).`;
    state.registryEditor.mcpServer = editorFromMcpServer(updated);
    await loadRegistry(false);
  } catch (error) {
    state.error = error.message || "MCP connection test failed.";
    await loadRegistry(false);
  } finally {
    state.mcpServerTestingId = "";
    render();
  }
}

async function setMcpServerEnabled(serverId, enabled) {
  const server = state.mcpServers.find((item) => item.server_id === serverId);
  if (!server) return;
  state.registryDisabling = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const updated = enabled && server.transport === "stdio"
      ? await desktopHost.mcp.configure({ operation: "enable", workspaceId: state.security.workspaceId || "default", serverId })
      : await request(`/api/registry/mcp-servers/${encodeURIComponent(serverId)}/${enabled ? "enable" : "disable"}`, {
          method: "POST",
          body: JSON.stringify({}),
        });
    state.notice = `${updated.name} is ${updated.enabled ? "enabled" : "disabled"}.`;
    state.ui.mcpServerModalOpen = false;
    await loadRegistry(false);
  } catch (error) {
    state.error = error.message || `Failed to ${enabled ? "enable" : "disable"} MCP server.`;
  } finally {
    state.registryDisabling = false;
    render();
  }
}

async function runSetupEnvironmentChecks() {
  state.setup.environmentLoading = true;
  state.setup.error = null;
  render();
  try {
    const [hostResult, dockerResult] = await Promise.allSettled([
      request("/api/diagnostics/doctor", {
        method: "POST",
        body: JSON.stringify({ mode: "quick", runtime: "local" }),
      }),
      request("/api/diagnostics/doctor", {
        method: "POST",
        body: JSON.stringify({ mode: "docker", runtime: "docker-worker" }),
      }),
    ]);
    state.setup.hostReport = hostResult.status === "fulfilled" ? hostResult.value : null;
    state.setup.dockerReport = dockerResult.status === "fulfilled" ? dockerResult.value : null;
    if (hostResult.status === "rejected" && dockerResult.status === "rejected") {
      throw new Error("Environment checks could not reach Doctor.");
    }
    if (hostResult.status === "rejected" || dockerResult.status === "rejected") {
      state.setup.error = hostResult.status === "rejected"
        ? "Host environment check failed to run."
        : "Docker environment check failed to run.";
    }
  } catch (error) {
    state.setup.error = error.message || "Environment checks failed.";
  } finally {
    state.setup.environmentLoading = false;
    render();
  }
}

async function saveSetupModel() {
  const editor = state.registryEditor.connection;
  if (!editor.name.trim()) {
    editor.name = `${PROVIDER_PRESETS[editor.preset]?.label || "Model"} default`;
  }
  const draft = buildProviderConnectionPayload(editor);
  if (!draft.ok) {
    state.setup.error = draft.message;
    render();
    return;
  }

  state.setup.modelSaving = true;
  state.setup.error = null;
  render();
  let savedSuccessfully = false;
  try {
    const saved = await request("/api/registry/provider-connections", {
      method: "POST",
      body: JSON.stringify(draft.payload),
    });
    const currentDefault = state.agentProfiles.find((profile) => profile.profile_id === "default-agent");
    await request("/api/registry/agent-profiles", {
      method: "POST",
      body: JSON.stringify({
        profile_id: "default-agent",
        name: currentDefault?.name || "Default Agent",
        description: currentDefault?.description || "Default task execution profile",
        agent_runtime: saved.agent_runtime,
        harness_profile: currentDefault?.harness_profile || "agent-harness-v1",
        provider_connection_id: saved.connection_id,
        runtime_agent_ref: currentDefault?.agent_runtime === saved.agent_runtime ? currentDefault?.runtime_agent_ref || "" : "",
        openclaw_agent_id: currentDefault?.agent_runtime === saved.agent_runtime ? currentDefault?.openclaw_agent_id || "" : "",
        default_skills: currentDefault?.default_skills || [],
        allowed_tools: currentDefault?.allowed_tools || [],
        disallowed_skills: currentDefault?.disallowed_skills || [],
        policy_tags: currentDefault?.policy_tags || [],
        status: "active",
        metadata: {
          ...(currentDefault?.metadata || {}),
          setup_managed: true,
          product_autonomy_mode: state.product.autonomyMode,
        },
      }),
    });
    await loadRegistry(false);
    state.registryEditor.connection = editorFromProviderConnection(saved);
    const tested = await request(
      `/api/registry/provider-connections/${encodeURIComponent(saved.connection_id)}/test`,
      { method: "POST", body: JSON.stringify({}) },
    );
    state.providerConnections = state.providerConnections.map((connection) =>
      connection.connection_id === tested.connection.connection_id ? tested.connection : connection
    );
    state.registryEditor.connection = editorFromProviderConnection(tested.connection);
    state.setup.editorTouched = false;
    if (tested.verification?.status === "verified") {
      state.setup.tab = "environment";
      state.notice = `${saved.name} verified and ready.`;
      savedSuccessfully = true;
    } else {
      state.setup.tab = "model";
      state.setup.error = `Connection saved, but verification failed: ${tested.verification?.detail || "Provider request failed."}`;
    }
  } catch (error) {
    state.setup.error = error.code === "route_not_found"
      ? "The running API Gateway is out of date. Restart it, then run Save & verify again."
      : error.message || "Failed to save and verify the model configuration.";
  } finally {
    state.setup.modelSaving = false;
    render();
  }
  if (savedSuccessfully) await runSetupEnvironmentChecks();
}

function dismissStudioSetup() {
  state.setup.open = false;
  state.setup.dismissed = true;
  globalThis.localStorage?.setItem(STUDIO_SETUP_DISMISSED_STORAGE, "1");
  render();
}

function finishStudioSetup() {
  state.setup.open = false;
  state.setup.dismissed = false;
  globalThis.localStorage?.removeItem(STUDIO_SETUP_DISMISSED_STORAGE);
  state.notice = "Setup complete.";
  render();
}

async function disableProviderConnection() {
  const connectionId = state.registryEditor.connection.connectionId.trim();
  if (!connectionId) {
    state.error = "Select a saved Provider Connection before disabling.";
    render();
    return;
  }

  state.registryDisabling = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    const disabled = await request(
      `/api/registry/provider-connections/${encodeURIComponent(connectionId)}/disable`,
      { method: "POST", body: JSON.stringify({}) },
    );
    state.notice = `Disabled Provider Connection ${disabled.connection_id}`;
    state.registryEditor.connection = editorFromProviderConnection(disabled);
    await loadRegistry(false);
    state.ui.providerConnectionModalOpen = false;
  } catch (error) {
    state.error = error.message || "Failed to disable Provider Connection.";
  } finally {
    state.registryDisabling = false;
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
  if (isGovernedAction("agent_profile.disable")) {
    stageGovernanceProposal(
      "agent_profile.disable",
      profileId,
      {},
      `Disable agent profile ${profileId}`,
    );
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
  const governedSkillId = draft.payload.skill_id || slugify(draft.payload.name);
  if (isGovernedAction("skill.upsert")) {
    stageGovernanceProposal(
      "skill.upsert",
      governedSkillId,
      draft.payload,
      `Create or update skill ${governedSkillId}`,
    );
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
  if (isGovernedAction("skill.disable")) {
    stageGovernanceProposal(
      "skill.disable",
      skillId,
      {},
      `Disable skill ${skillId}`,
    );
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
    resetAuthoringGraphSelection();
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
    resetAuthoringGraphSelection();
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

function authoringGraphSnapshot(editor = state.editor) {
  return {
    nodes: structuredClone(editor.nodes || []),
    edges: structuredClone(editor.edges || []),
    metadataText: editor.metadataText || "{}",
  };
}

function resetAuthoringEditorState(saved = true) {
  const snapshot = authoringGraphSnapshot();
  authoringGraphHistory = createGraphHistory(snapshot);
  if (saved) authoringGraphSavedSnapshot = structuredClone(snapshot);
  authoringGraphConnection = null;
}

function recordAuthoringMutation() {
  authoringGraphHistory = commitGraphHistory(authoringGraphHistory, authoringGraphSnapshot());
}

function restoreAuthoringSnapshot(snapshot) {
  state.editor = {
    ...state.editor,
    nodes: structuredClone(snapshot.nodes),
    edges: structuredClone(snapshot.edges),
    metadataText: snapshot.metadataText,
  };
  resetAuthoringGraphSelection();
  render();
}

function undoAuthoringGraph() {
  const next = undoGraphHistory(authoringGraphHistory);
  if (next === authoringGraphHistory) return;
  authoringGraphHistory = next;
  restoreAuthoringSnapshot(next.present);
}

function redoAuthoringGraph() {
  const next = redoGraphHistory(authoringGraphHistory);
  if (next === authoringGraphHistory) return;
  authoringGraphHistory = next;
  restoreAuthoringSnapshot(next.present);
}

function getAuthoringPositions(editor = state.editor) {
  const parsed = parseJsonObject(editor.metadataText || "{}");
  const positions = parsed.ok && parsed.value.authoring_layout?.positions;
  return positions && typeof positions === "object" && !Array.isArray(positions) ? positions : {};
}

function setAuthoringNodePosition(nodeId, position) {
  const parsed = parseJsonObject(state.editor.metadataText || "{}");
  const metadata = parsed.ok ? parsed.value : {};
  state.editor.metadataText = prettyJson({
    ...metadata,
    authoring_layout: {
      ...(metadata.authoring_layout || {}),
      positions: {
        ...getAuthoringPositions(),
        [nodeId]: { x: Math.round(position.x), y: Math.round(position.y) },
      },
    },
  });
}

resetAuthoringEditorState();

function handleAuthoringPortOut(index) {
  const node = state.editor.nodes[index];
  if (!node) return;
  const selection = state.ui.authoringGraphSelection;
  if (selection?.type === "edge" && state.editor.edges[selection.index]) {
    updateEdge(selection.index, { from: node.id, from_port: "success" });
    return;
  }
  authoringGraphConnection = { sourceIndex: index, sourcePort: "success" };
  selectAuthoringGraphItem("node", index);
}

function handleAuthoringPortIn(index) {
  const node = state.editor.nodes[index];
  if (!node) return;
  const selection = state.ui.authoringGraphSelection;
  if (authoringGraphConnection) {
    const source = state.editor.nodes[authoringGraphConnection.sourceIndex];
    if (source && source.id !== node.id) {
      state.editor.edges = [...state.editor.edges, {
        from: source.id,
        to: node.id,
        from_port: authoringGraphConnection.sourcePort,
        to_port: "input",
        condition: null,
        label: null,
      }];
      recordAuthoringMutation();
      state.ui.authoringGraphSelection = { type: "edge", index: state.editor.edges.length - 1 };
    }
    authoringGraphConnection = null;
    render();
    return;
  }
  if (selection?.type === "edge" && state.editor.edges[selection.index]) {
    updateEdge(selection.index, { to: node.id, to_port: "input" });
  }
}

function deleteAuthoringSelection() {
  const selection = state.ui.authoringGraphSelection;
  if (selection?.type === "node") removeNode(selection.index);
  if (selection?.type === "edge") removeEdge(selection.index);
}

function updateAgentProfileEditor(patch) {
  state.registryEditor.profile = { ...state.registryEditor.profile, ...patch };
}

function updateProviderConnectionEditor(patch) {
  state.registryEditor.connection = { ...state.registryEditor.connection, ...patch };
}

function updateSkillEditor(patch) {
  state.registryEditor.skill = { ...state.registryEditor.skill, ...patch };
}

function updateNode(index, patch) {
  state.editor.nodes = state.editor.nodes.map((node, nodeIndex) =>
    nodeIndex === index ? { ...node, ...patch } : node,
  );
  recordAuthoringMutation();
  render();
}

function removeNode(index) {
  const node = state.editor.nodes[index];
  state.editor.nodes = state.editor.nodes.filter((_, nodeIndex) => nodeIndex !== index);
  state.editor.edges = state.editor.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
  state.ui.authoringGraphSelection = { type: "none", index: null };
  recordAuthoringMutation();
  render();
}

function addNode() {
  state.editor.nodes = [...state.editor.nodes, emptyNode(state.editor.nodes.length + 1)];
  recordAuthoringMutation();
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
  recordAuthoringMutation();
  render();
}

function updateEdge(index, patch) {
  state.editor.edges = state.editor.edges.map((edge, edgeIndex) =>
    edgeIndex === index ? { ...edge, ...patch } : edge,
  );
  recordAuthoringMutation();
  render();
}

function removeEdge(index) {
  state.editor.edges = state.editor.edges.filter((_, edgeIndex) => edgeIndex !== index);
  const selection = state.ui.authoringGraphSelection;
  if (selection?.type === "edge") {
    state.ui.authoringGraphSelection =
      selection.index === index
        ? { type: "none", index: null }
        : { type: "edge", index: selection.index > index ? selection.index - 1 : selection.index };
  }
  recordAuthoringMutation();
  render();
}

function selectAuthoringGraphItem(type, index) {
  const normalizedIndex = Number(index);
  const collection = type === "edge" ? state.editor.edges : state.editor.nodes;
  if (!Number.isInteger(normalizedIndex) || !collection[normalizedIndex]) return;
  state.ui.authoringGraphSelection = { type, index: normalizedIndex };
  pendingAuthoringGraphFocus = { type, index: normalizedIndex };
  render();
}

function resetAuthoringGraphSelection() {
  state.ui.authoringGraphSelection = { type: "none", index: null };
  pendingAuthoringGraphFocus = null;
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
  const primaryItems = [
    { id: "orchestrator", label: "Tasks" },
    { id: "inbox", label: "Inbox", count: getInboxOpenCount() },
    { id: "library", label: "Library" },
    { id: "settings", label: "Settings" },
  ];
  const advancedItems = [
    { id: "missions", label: "Mission workspace" },
    { id: "sessions", label: "Sessions" },
    { id: "dashboard", label: "Runtime dashboard" },
    { id: "memory", label: "Memory" },
    { id: "agents", label: "Subagents" },
    { id: "templates", label: "Workflow editor" },
    { id: "registry", label: "Registry" },
    { id: "operations", label: "System details" },
  ];
  const activeTab = ADVANCED_NAV_IDS.has(state.activeNav)
    ? "advanced"
    : TASK_NAV_IDS.has(state.activeNav)
      ? "task"
      : state.ui.navigationTab;
  const visibleItems = activeTab === "advanced" ? advancedItems : primaryItems;
  const renderItems = (items) => items.map((item) => `
    <button class="desktop-nav-item ${state.activeNav === item.id ? "selected" : ""}" data-action="switch-nav" data-nav="${item.id}">
      <strong>${item.label}</strong>
      ${Number(item.count || 0) > 0 ? `<span class="desktop-nav-count">${item.count}</span>` : ""}
    </button>
  `).join("");
  return `
    <nav class="desktop-nav" aria-label="Main navigation">
      <div class="desktop-nav-tabs" role="tablist" aria-label="Task Workspace navigation">
        <button class="desktop-nav-tab ${activeTab === "task" ? "selected" : ""}" type="button" role="tab" aria-selected="${activeTab === "task"}" data-action="switch-navigation-tab" data-tab="task">Task</button>
        <button class="desktop-nav-tab ${activeTab === "advanced" ? "selected" : ""}" type="button" role="tab" aria-selected="${activeTab === "advanced"}" data-action="switch-navigation-tab" data-tab="advanced">Advanced</button>
      </div>
      <div class="desktop-nav-bookmark-panel ${activeTab}" role="tabpanel" aria-label="${activeTab === "advanced" ? "Advanced" : "Task"} navigation">
        ${renderItems(visibleItems)}
      </div>
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
            <small>${escapeHtml(profile.model || runtimeAgentRefOf(profile) || profile.health?.status || "unbound")}</small>
          </span>
        </button>
      `,
    )
    .join("");
}

function dashboardToneBadgeClass(tone) {
  if (tone === "danger") return "danger";
  if (tone === "warn") return "warn";
  return "success";
}

function formatDashboardStatusCounts(items) {
  return Array.isArray(items)
    ? items
        .filter((item) => Number(item?.count || 0) > 0)
        .map((item) => `${item.status}: ${item.count}`)
        .join(" / ")
    : "";
}

function renderDashboardStatusBreakdown(title, items) {
  const lines = formatDashboardStatusCounts(items);
  return `
    <section class="subpanel dashboard-breakdown-panel">
      <div class="subpanel-header">
        <strong>${escapeHtml(title)}</strong>
      </div>
      <p class="muted">${escapeHtml(lines || "No active status counts.")}</p>
    </section>
  `;
}

function renderDashboardHotspotList(title, items, emptyText, kind = "run") {
  return `
    <section class="subpanel dashboard-hotspot-panel" data-workspace-focus="dashboard-hotspots">
      <div class="subpanel-header">
        <strong>${escapeHtml(title)}</strong>
        <span class="badge neutral">${escapeHtml(String(Array.isArray(items) ? items.length : 0))}</span>
      </div>
      <div class="rail-feed">
        ${
          Array.isArray(items) && items.length
            ? items
                .map((item) => {
                  const sessionId = item.session_id || "";
                  const focusKind =
                    kind === "approval" || kind === "human-input" || kind === "run" && item.status
                      ? kind === "run" && item.status === "failed"
                        ? "graph"
                        : "execution-queue"
                      : "graph";
                  const titleText =
                    kind === "approval"
                      ? item.summary || item.approval_id || "Pending approval"
                      : kind === "human-input"
                        ? item.summary || item.input_request_id || "Pending human input"
                        : item.summary || item.run_id || "Run hotspot";
                  const metaText =
                    kind === "approval"
                      ? item.run_id || item.kind || "approval"
                      : kind === "human-input"
                        ? item.run_id || "human input"
                        : item.run_id || item.status || item.updated_at || "run";
                  const marker =
                    kind === "approval"
                      ? item.kind || "approval"
                      : kind === "human-input"
                        ? "human input"
                        : item.latest_failure_event_type || item.status || "run";
                  if (sessionId) {
                    return `
                      <button type="button" class="rail-feed-item rail-feed-jump-button" data-action="open-dashboard-hotspot" data-session-id="${escapeHtml(sessionId)}" data-focus-kind="${escapeHtml(focusKind)}" data-run-id="${escapeHtml(item.run_id || "")}">
                        <strong>${escapeHtml(titleText)}</strong>
                        <small>${escapeHtml(metaText)}</small>
                        <small>${escapeHtml(marker)}</small>
                      </button>
                    `;
                  }
                  if (kind === "approval") {
                    return `
                      <div class="rail-feed-item">
                        <strong>${escapeHtml(titleText)}</strong>
                        <small>${escapeHtml(metaText)}</small>
                      </div>
                    `;
                  }
                  if (kind === "human-input") {
                    return `
                      <div class="rail-feed-item">
                        <strong>${escapeHtml(titleText)}</strong>
                        <small>${escapeHtml(metaText)}</small>
                      </div>
                    `;
                  }
                  return `
                    <div class="rail-feed-item">
                      <strong>${escapeHtml(titleText)}</strong>
                      <small>${escapeHtml(metaText)}</small>
                    </div>
                  `;
                })
                .join("")
            : `<p class="muted">${escapeHtml(emptyText)}</p>`
        }
      </div>
    </section>
  `;
}

function formatDashboardRate(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(value === 1 || value === 0 ? 0 : 1)}%` : "-";
}

function formatDashboardDuration(value) {
  if (!Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60_000);
  return `${minutes}m ${Math.round((value % 60_000) / 1000)}s`;
}

function formatDashboardMoney(values) {
  const entries = Object.entries(values || {});
  return entries.length ? entries.map(([currency, amount]) => `${currency} ${amount}`).join(" + ") : "-";
}

function dashboardVerdictTone(value) {
  if (["pass", "complete", "completed", "ok"].includes(value)) return "success";
  if (["fail", "failed", "error", "reject"].includes(value)) return "danger";
  if (["partial", "incomplete", "running", "queued"].includes(value)) return "warn";
  return "neutral";
}

function renderDashboardFilters(observability) {
  const query = observability?.query || {};
  const retention = observability?.retention || {};
  const rebuilt = Number(query.rebuilt_runs || 0);
  const indexLabel = rebuilt > 0
    ? `${rebuilt} rebuilt / ${query.indexed_runs || 0} indexed`
    : `${query.indexed_runs || 0} indexed`;
  const retentionHours = Number(retention.retention_hours || 0);
  const retentionLabel = retention.enabled
    ? `${retentionHours % 24 === 0 ? `${retentionHours / 24}d` : `${retentionHours}h`} retention`
    : "Unlimited retention";
  const pruned = Number(retention.pruned_indexes || 0) + Number(retention.pruned_dirty_markers || 0);
  return `
    <div class="dashboard-toolbar">
      <select class="dashboard-filter-select" data-field="dashboard.windowHours" aria-label="Dashboard time window">
        <option value="24" ${state.dashboardFilters.windowHours === 24 ? "selected" : ""}>24 hours</option>
        <option value="168" ${state.dashboardFilters.windowHours === 168 ? "selected" : ""}>7 days</option>
        <option value="720" ${state.dashboardFilters.windowHours === 720 ? "selected" : ""}>30 days</option>
      </select>
      <select class="dashboard-filter-select" data-field="dashboard.status" aria-label="Dashboard run status">
        <option value="all" ${state.dashboardFilters.status === "all" ? "selected" : ""}>All runs</option>
        <option value="active" ${state.dashboardFilters.status === "active" ? "selected" : ""}>Active</option>
        <option value="terminal" ${state.dashboardFilters.status === "terminal" ? "selected" : ""}>Terminal</option>
        <option value="completed" ${state.dashboardFilters.status === "completed" ? "selected" : ""}>Completed</option>
        <option value="failed" ${state.dashboardFilters.status === "failed" ? "selected" : ""}>Failed</option>
        <option value="cancelled" ${state.dashboardFilters.status === "cancelled" ? "selected" : ""}>Cancelled</option>
      </select>
      <label class="dashboard-compare-toggle">
        <input type="checkbox" data-field="dashboard.comparePrevious" aria-label="Compare previous period" ${state.dashboardFilters.comparePrevious ? "checked" : ""}>
        <span>Previous period</span>
      </label>
      <span class="badge ${rebuilt > 0 ? "warn" : "neutral"}">${escapeHtml(indexLabel)}</span>
      <span class="badge ${pruned > 0 ? "warn" : "neutral"}" title="Canonical run and evidence data are retained.">${escapeHtml(pruned > 0 ? `${pruned} pruned / ${retentionLabel}` : retentionLabel)}</span>
      <button class="secondary" data-action="refresh-dashboard" ${state.dashboardLoading || state.runtimeLoading ? "disabled" : ""}>
        ${state.dashboardLoading || state.runtimeLoading ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  `;
}

function formatDashboardActivityTitle(observability) {
  const windowHours = Number(observability?.query?.window_hours || 24);
  if (windowHours > 0 && windowHours % 24 === 0) {
    const days = windowHours / 24;
    return days === 1 ? "24 Hour Activity" : `${days} Day Activity`;
  }
  return `${windowHours} Hour Activity`;
}

function formatDashboardComparisonValue(kind, value) {
  if (!Number.isFinite(value)) return "-";
  if (kind === "rate") return formatDashboardRate(value);
  if (kind === "duration") return formatDashboardDuration(value);
  return String(Math.round(value));
}

function formatDashboardComparisonDelta(kind, metric) {
  if (!Number.isFinite(metric?.delta)) return "No comparable value";
  const sign = metric.delta > 0 ? "+" : "";
  if (kind === "rate") return `${sign}${(metric.delta * 100).toFixed(metric.delta === 0 ? 0 : 1)} pp`;
  if (kind === "duration") {
    const durationSign = metric.delta > 0 ? "+" : metric.delta < 0 ? "-" : "";
    return `${durationSign}${formatDashboardDuration(Math.abs(metric.delta))}`;
  }
  return `${sign}${Math.round(metric.delta)}`;
}

function dashboardComparisonTone(metric) {
  if (metric?.outcome === "improved") return "success";
  if (metric?.outcome === "regressed") return "danger";
  return "neutral";
}

function renderDashboardComparison(observability) {
  const comparison = observability?.comparison || null;
  if (!comparison) return "";
  const metrics = comparison.metrics || {};
  const items = [
    ["Run volume", "count", metrics.runs_observed],
    ["Run success", "rate", metrics.run_success_rate],
    ["Job success", "rate", metrics.job_success_rate],
    ["Retry rate", "rate", metrics.retry_rate],
    ["Run P95", "duration", metrics.run_p95_ms],
    ["Tokens", "count", metrics.total_tokens],
  ];
  return `
    <section class="subpanel span-2 dashboard-comparison-panel">
      <div class="subpanel-header">
        <strong>Previous Period Comparison</strong>
        <span class="badge ${comparison.coverage === "complete" ? "success" : "warn"}">${escapeHtml(`${comparison.coverage || "partial"} coverage`)}</span>
      </div>
      <div class="dashboard-comparison-strip">
        ${items.map(([label, kind, metric]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(formatDashboardComparisonValue(kind, metric?.current))}</strong>
            <small><span class="badge ${dashboardComparisonTone(metric)}">${escapeHtml(formatDashboardComparisonDelta(kind, metric))}</span> vs ${escapeHtml(formatDashboardComparisonValue(kind, metric?.previous))}</small>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderDashboardActivity(observability) {
  const buckets = Array.isArray(observability?.activity) ? observability.activity : [];
  const totals = buckets.map((bucket) =>
    Number(bucket.runs_completed || 0) +
    Number(bucket.runs_failed || 0) +
    Number(bucket.jobs_completed || 0) +
    Number(bucket.jobs_failed || 0));
  const maximum = Math.max(1, ...totals);
  const segmentHeight = (value) => Number(value || 0) > 0
    ? Math.max(2, Math.round((Number(value) / maximum) * 64))
    : 0;
  const labelForBucket = (bucket) => {
    const parsed = Date.parse(bucket?.bucket_start || "");
    return Number.isFinite(parsed)
      ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(parsed))
      : "-";
  };
  return `
    <section class="subpanel span-2 dashboard-activity-panel">
      <div class="subpanel-header">
        <strong>${escapeHtml(formatDashboardActivityTitle(observability))}</strong>
        <span class="badge neutral">${escapeHtml(`${observability?.window?.bucket_minutes || 60}m buckets`)}</span>
      </div>
      <div class="dashboard-activity-bars" aria-label="Runtime activity by time bucket">
        ${buckets.map((bucket) => `
          <div class="dashboard-activity-column" title="${escapeHtml(`${labelForBucket(bucket)} / runs ${bucket.runs_started || 0} started, ${bucket.runs_completed || 0} completed, ${bucket.runs_failed || 0} failed / jobs ${bucket.jobs_completed || 0} completed, ${bucket.jobs_failed || 0} failed / ${bucket.total_tokens || 0} tokens`)}">
            <span class="dashboard-activity-segment jobs" style="height:${segmentHeight((bucket.jobs_completed || 0) + (bucket.jobs_failed || 0))}px"></span>
            <span class="dashboard-activity-segment completed" style="height:${segmentHeight(bucket.runs_completed)}px"></span>
            <span class="dashboard-activity-segment failed" style="height:${segmentHeight(bucket.runs_failed)}px"></span>
          </div>
        `).join("")}
      </div>
      <div class="dashboard-activity-axis">
        <span>${escapeHtml(labelForBucket(buckets[0]))}</span>
        <span>${escapeHtml(labelForBucket(buckets[Math.floor(buckets.length / 2)]))}</span>
        <span>${escapeHtml(labelForBucket(buckets.at(-1)))}</span>
      </div>
      <div class="dashboard-activity-legend">
        <span><i class="jobs"></i>Jobs settled</span>
        <span><i class="completed"></i>Runs completed</span>
        <span><i class="failed"></i>Runs failed</span>
      </div>
    </section>
  `;
}

function renderDashboardCorrelations(observability) {
  const correlations = Array.isArray(observability?.correlations) ? observability.correlations : [];
  return `
    <section class="subpanel span-2 dashboard-correlation-panel" data-workspace-focus="dashboard-correlations">
      <div class="subpanel-header">
        <strong>Trace / Event / Evaluation Correlation</strong>
        <span class="badge neutral">${escapeHtml(String(correlations.length))}</span>
      </div>
      <div class="dashboard-correlation-table">
        <div class="dashboard-correlation-head">
          <span>Run / Trace</span><span>Runtime</span><span>Events</span><span>Evaluation</span><span>Usage</span>
        </div>
        ${correlations.length ? correlations.map((item) => {
          const content = `
            <span class="dashboard-correlation-identity"><strong>${escapeHtml(item.intent || item.run_id)}</strong><small>${escapeHtml(item.trace_id || item.run_id)}</small></span>
            <span><strong class="badge ${dashboardVerdictTone(item.status)}">${escapeHtml(item.status || "unknown")}</strong><small>${escapeHtml(formatDashboardDuration(item.duration_ms))} / ${escapeHtml(`${item.job_count || 0} jobs`)}</small></span>
            <span><strong>${escapeHtml(String(item.event_count || 0))}</strong><small>${escapeHtml(`seq ${item.last_sequence ?? "-"} / ${item.retry_count || 0} retry`)}</small></span>
            <span><strong class="badge ${dashboardVerdictTone(item.quality_verdict || item.pipeline_verdict)}">${escapeHtml(item.quality_verdict || item.pipeline_verdict || "not evaluated")}</strong><small>${escapeHtml(`${item.finding_count || 0} findings / ${item.gate_verdict || "no gate"}`)}</small></span>
            <span><strong>${escapeHtml(item.total_tokens ?? "-")}</strong><small>${escapeHtml(formatDashboardMoney(Object.keys(item.provider_reported_costs || {}).length ? item.provider_reported_costs : item.estimated_costs))}</small></span>
          `;
          return item.session_id
            ? `<button type="button" class="dashboard-correlation-row" data-action="open-dashboard-hotspot" data-session-id="${escapeHtml(item.session_id)}" data-focus-kind="graph" data-run-id="${escapeHtml(item.run_id || "")}">${content}</button>`
            : `<div class="dashboard-correlation-row">${content}</div>`;
        }).join("") : '<p class="muted dashboard-correlation-empty">No correlated runs are available.</p>'}
      </div>
    </section>
  `;
}

function renderDashboardCostReport(observability) {
  const report = observability?.cost_report || null;
  if (!report) return "";
  const groupBy = state.dashboardFilters.costGroupBy || "agent";
  const groups = groupBy === "model"
    ? report.by_provider_model || []
    : groupBy === "work-package"
      ? report.by_work_package || []
      : report.by_agent || [];
  const coverage = report.coverage || {};
  const total = formatDashboardMoney(report.totals?.effective_costs || {});
  const completenessTone = coverage.cost_completeness === "complete"
    ? "success"
    : coverage.cost_completeness === "partial"
      ? "warn"
      : "neutral";
  return `
    <section class="subpanel span-2 dashboard-cost-panel" data-workspace-focus="dashboard-cost-report">
      <div class="subpanel-header">
        <strong>Cost Attribution</strong>
        <div class="dashboard-cost-header-actions">
          <span class="badge ${completenessTone}">${escapeHtml(`${coverage.cost_completeness || "unavailable"} ${coverage.costed_jobs || 0}/${coverage.model_jobs || 0}`)}</span>
          <span class="badge neutral" title="Provider-reported cost is preferred; catalog estimate is used only when provider cost is absent.">${escapeHtml(total)}</span>
        </div>
      </div>
      <div class="dashboard-cost-summary">
        <span><strong>${escapeHtml(String(coverage.provider_reported_jobs || 0))}</strong><small>Provider</small></span>
        <span><strong>${escapeHtml(String(coverage.estimated_only_jobs || 0))}</strong><small>Estimated</small></span>
        <span><strong>${escapeHtml(String(coverage.unavailable_jobs || 0))}</strong><small>Unavailable</small></span>
        <div class="dashboard-cost-segments" role="tablist" aria-label="Cost attribution dimension">
          ${[
            ["agent", "Agent"],
            ["model", "Model"],
            ["work-package", "Work package"],
          ].map(([value, label]) => `<button type="button" role="tab" class="mini-button ${groupBy === value ? "selected" : ""}" data-action="set-dashboard-cost-group" data-value="${value}" aria-selected="${groupBy === value}">${label}</button>`).join("")}
        </div>
      </div>
      <div class="dashboard-cost-table">
        <div class="dashboard-cost-head">
          <span>Attribution</span><span>Coverage</span><span>Tokens</span><span>Effective cost</span><span>Runtime</span>
        </div>
        ${groups.length ? groups.map((group) => `
          <div class="dashboard-cost-row">
            <span><strong>${escapeHtml(group.label || group.key)}</strong><small>${escapeHtml(group.key || "-")}</small></span>
            <span><strong>${escapeHtml(`${group.costed_jobs || 0}/${group.model_jobs || 0}`)}</strong><small>${escapeHtml(group.cost_completeness || "unavailable")}</small></span>
            <span><strong>${escapeHtml(group.total_tokens ?? "-")}</strong><small>${escapeHtml(`${group.usage_records || 0} usage`)}</small></span>
            <span><strong>${escapeHtml(formatDashboardMoney(group.effective_costs || {}))}</strong><small>${escapeHtml(group.cost_source || "unavailable")}</small></span>
            <span><strong>${escapeHtml(`${group.failed_jobs || 0} failed`)}</strong><small>${escapeHtml(`${group.retry_attempts || 0} retries / ${group.run_count || 0} runs`)}</small></span>
          </div>
        `).join("") : '<p class="muted dashboard-cost-empty">No attributed model cost is available.</p>'}
      </div>
    </section>
  `;
}

function renderDashboardObservability(observability) {
  const reliability = observability?.reliability || {};
  const latency = observability?.latency || {};
  const usage = observability?.usage || {};
  const costs = Object.keys(usage.provider_reported_costs || {}).length
    ? usage.provider_reported_costs
    : usage.estimated_costs;
  return `
    <section class="subpanel span-2 dashboard-observability-panel">
      <div class="subpanel-header">
        <strong>Runtime Performance</strong>
        <span class="badge ${usage.token_completeness === "complete" ? "success" : usage.token_completeness === "partial" ? "warn" : "neutral"}">${escapeHtml(`usage ${usage.token_completeness || "unavailable"}`)}</span>
      </div>
      <div class="dashboard-metric-strip">
        <div><span>Run success</span><strong>${escapeHtml(formatDashboardRate(reliability.run_success_rate))}</strong><small>${escapeHtml(`${reliability.completed_runs || 0}/${reliability.terminal_runs || 0} terminal`)}</small></div>
        <div><span>Job success</span><strong>${escapeHtml(formatDashboardRate(reliability.job_success_rate))}</strong><small>${escapeHtml(`${reliability.completed_jobs || 0}/${reliability.terminal_jobs || 0} settled`)}</small></div>
        <div><span>Run P95</span><strong>${escapeHtml(formatDashboardDuration(latency.run_duration?.p95_ms))}</strong><small>${escapeHtml(`${latency.run_duration?.count || 0} samples`)}</small></div>
        <div><span>Job P95</span><strong>${escapeHtml(formatDashboardDuration(latency.job_duration?.p95_ms))}</strong><small>${escapeHtml(`${latency.job_duration?.count || 0} samples`)}</small></div>
        <div><span>Retry rate</span><strong>${escapeHtml(formatDashboardRate(reliability.retry_rate))}</strong><small>${escapeHtml(`${reliability.retry_attempts || 0} retry attempts`)}</small></div>
        <div><span>Usage</span><strong>${escapeHtml(usage.total_tokens ?? "-")}</strong><small>${escapeHtml(formatDashboardMoney(costs))}</small></div>
      </div>
    </section>
    ${renderDashboardComparison(observability)}
    ${renderDashboardActivity(observability)}
    ${renderDashboardCostReport(observability)}
    ${renderDashboardCorrelations(observability)}
  `;
}

function renderDashboardWorkspace() {
  const dashboard = state.dashboardSummary || null;
  const runtime = state.runtimeSummary?.execution_runtime || null;
  const capacity = runtime?.node_provisioner?.capacity || null;
  const recovery = runtime?.node_provisioner?.recovery || null;
  const planner = state.runtimeSummary?.planner || null;
  const registry = state.runtimeSummary?.registry || null;
  const tone = dashboard?.runtime_health?.attention_tone || "neutral";

  return `
    <section class="panel dashboard-panel">
      <div class="panel-header">
        <div>
          <h3>Unified Dashboard</h3>
          <p>Top-level runtime workload, operator backlog, and waiting or failure hotspots.</p>
        </div>
        ${renderDashboardFilters(dashboard?.observability || null)}
      </div>
      <div class="workspace-summary-grid compact-summary dashboard-summary-grid">
        <div class="summary-stat">
          <strong>Sessions</strong>
          <p>${escapeHtml(String(dashboard?.workload?.sessions?.total ?? 0))}</p>
        </div>
        <div class="summary-stat">
          <strong>Runs</strong>
          <p>${escapeHtml(String(dashboard?.workload?.runs?.total ?? 0))}</p>
        </div>
        <div class="summary-stat">
          <strong>Pending Approvals</strong>
          <p>${escapeHtml(String(dashboard?.backlog?.pending_approvals ?? 0))}</p>
        </div>
        <div class="summary-stat">
          <strong>Human Inputs</strong>
          <p>${escapeHtml(String(dashboard?.backlog?.pending_human_inputs ?? 0))}</p>
        </div>
        <div class="summary-stat">
          <strong>Patch Confirms</strong>
          <p>${escapeHtml(String(dashboard?.backlog?.pending_patch_confirmations ?? 0))}</p>
        </div>
        <div class="summary-stat">
          <strong>Recent Failures</strong>
          <p>${escapeHtml(String(dashboard?.workload?.runs?.recently_failed ?? 0))}</p>
        </div>
      </div>
      <div class="settings-grid dashboard-grid">
        <section class="subpanel span-2 dashboard-runtime-panel">
          <div class="subpanel-header">
            <strong>Runtime Health</strong>
            <span class="badge ${dashboardToneBadgeClass(tone)}">${escapeHtml(tone)}</span>
          </div>
          <div class="rail-kv-list">
            <div><strong>Storage</strong><span>${escapeHtml(dashboard?.runtime_health?.storage_backend_kind || "unknown")}</span></div>
            <div><strong>Execution</strong><span>${escapeHtml(getRuntimeExecutionLabel(runtime))}</span></div>
            <div><strong>Workers</strong><span>${escapeHtml(formatRuntimeCapacityValue(capacity?.active_workers, capacity?.max_concurrent_workers))}</span></div>
            <div><strong>Queue</strong><span>${escapeHtml(formatRuntimeCapacityValue(capacity?.queue_depth, capacity?.queue_limit))}</span></div>
            <div><strong>Queue Timeout</strong><span>${escapeHtml(formatRuntimeQueueTimeout(capacity?.queue_timeout_ms))}</span></div>
            <div><strong>Cleanup</strong><span>${escapeHtml(`${recovery?.cleanup_pending ?? 0} pending / ${recovery?.cleanup_failed ?? 0} failed`)}</span></div>
            <div><strong>Reconciliation</strong><span>${escapeHtml(recovery?.last_reconciliation_status || "not run")}</span></div>
            <div><strong>Containers</strong><span>${escapeHtml(`${recovery?.removed_containers ?? 0} removed / ${recovery?.orphan_containers ?? 0} orphaned`)}</span></div>
            <div><strong>Planner</strong><span>${escapeHtml(planner?.provider_name || planner?.provider_id || "unknown")}</span></div>
            <div><strong>Templates</strong><span>${escapeHtml(String(registry?.template_count ?? 0))}</span></div>
          </div>
          <div class="dashboard-summary-lines">
            ${(dashboard?.runtime_health?.summary_lines || []).map((line) => `<span class="skill-chip">${escapeHtml(line)}</span>`).join("")}
          </div>
        </section>
        ${renderDashboardObservability(dashboard?.observability || null)}
        ${renderDashboardStatusBreakdown("Session Status", dashboard?.workload?.sessions?.by_status || [])}
        ${renderDashboardStatusBreakdown("Run Status", dashboard?.workload?.runs?.by_status || [])}
        <section class="subpanel dashboard-backlog-panel">
          <div class="subpanel-header">
            <strong>Backlog</strong>
          </div>
          <div class="rail-kv-list">
            <div><strong>Approvals</strong><span>${escapeHtml(String(dashboard?.backlog?.pending_approvals ?? 0))}</span></div>
            <div><strong>Human Input</strong><span>${escapeHtml(String(dashboard?.backlog?.pending_human_inputs ?? 0))}</span></div>
            <div><strong>Patch Confirm</strong><span>${escapeHtml(String(dashboard?.backlog?.pending_patch_confirmations ?? 0))}</span></div>
            <div><strong>Unsupported Patches</strong><span>${escapeHtml(String(dashboard?.backlog?.unsupported_patch_proposals ?? 0))}</span></div>
            <div><strong>Stale Sessions</strong><span>${escapeHtml(String(dashboard?.backlog?.stale_sessions ?? 0))}</span></div>
            <div><strong>Stuck Runs</strong><span>${escapeHtml(String(dashboard?.workload?.runs?.stuck ?? 0))}</span></div>
          </div>
        </section>
        ${renderDashboardHotspotList("Waiting Runs", dashboard?.hotspots?.waiting_runs || [], "No waiting runs.", "run")}
        ${renderDashboardHotspotList("Recent Failures", dashboard?.hotspots?.recently_failed_runs || [], "No recent failures.", "run")}
        ${renderDashboardHotspotList("Approval Backlog", dashboard?.hotspots?.approval_backlog || [], "No pending approvals.", "approval")}
        ${renderDashboardHotspotList("Human Input Backlog", dashboard?.hotspots?.human_input_backlog || [], "No pending human input.", "human-input")}
      </div>
    </section>
  `;
}

function renderMissionWorkspace() {
  const model = buildMissionWorkspaceViewModel(state.workspaceDetail);
  if (!model.ready) {
    const hasMissionInventory = state.missions.length > 0 || state.sessions.length > 0;
    return `
      <section class="panel desktop-empty-panel">
        <div class="panel-header">
          <div>
            <h3>Mission Workspace</h3>
            <p>${
              hasMissionInventory
                ? "Select a mission from the left rail."
                : "Start a mission here to make Mission Workspace the default working surface."
            }</p>
          </div>
        </div>
        ${
          hasMissionInventory
            ? ""
            : `
              <div class="mission-empty-intake">
                <label>Mission instruction<textarea rows="5" data-field="planner.intent" placeholder="Describe the outcome, constraints, and outputs you need.">${escapeHtml(state.planner.intent)}</textarea></label>
                <div class="orchestrator-actions">
                  <button class="primary" data-action="orchestrator-send-message" ${state.planning ? "disabled" : ""}>${state.planning ? "Thinking..." : "Start mission"}</button>
                  <button class="secondary" data-action="generate-dag-draft" ${state.planning || !state.planner.intent.trim() ? "disabled" : ""}>Generate DAG</button>
                  <button class="secondary" data-action="plan-intent" ${state.planning || !state.planner.intent.trim() ? "disabled" : ""}>Plan mission</button>
                </div>
                ${state.planner.error ? `<div class="alert danger inline-alert">${escapeHtml(state.planner.error)}</div>` : ""}
              </div>
            `
        }
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
      ${state.workspaceDetail?.runtime_graph ? renderRuntimeInspectorPanel(state.workspaceDetail.runtime_graph, state.workspaceDetail.runtime_projection || null) : ""}
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
              ${renderPatchReviewSummary(patch)}
              ${renderPatchOperationReview(patch)}
              ${renderPatchOutcomeReview(patch) || '<small>No operation outcomes yet.</small>'}
              ${
                topology
                  ? `<small>${escapeHtml(`Topology: ${topology.node_count ?? "-"} nodes / ${topology.edge_count ?? "-"} edges / ${readyCount} ready / ${runningCount} running`)}</small>`
                  : ""
              }
              ${renderPatchTopologyComparison(patch)}
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
        routeCompare
          ? `
            <section class="panel rail-panel operational-context-panel">
              <div class="panel-header">
                <div><h3>Route Comparison</h3><p>Review planning revisions without displacing the primary runtime graph.</p></div>
              </div>
              ${routeCompare ? renderRouteComparePanel(routeCompare) : ""}
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
                    <small>${escapeHtml(runtimeAgentRefOf(profile) || profile.provider_connection_id || "unbound")} / ${escapeHtml((profile.default_skills || []).join(", ") || "no-skills")}</small>
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
  const compatibleConnections = state.providerConnections.filter(
    (connection) => connection.status === "active" || connection.connection_id === editor.providerConnectionId,
  );
  const selectedConnection = state.providerConnections.find(
    (connection) => connection.connection_id === editor.providerConnectionId,
  );
  const modelLabel = editor.agentRuntime === "openclaw" ? "Agent ID" : "Model override";
  const modelPlaceholder = selectedConnection?.default_model || PROVIDER_DEFAULTS[editor.agentRuntime]?.modelPlaceholder || "Optional";
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
                        <small>${escapeHtml(providerRuntimeLabel(profile.agent_runtime || "openclaw"))} / ${escapeHtml(profile.provider_connection_id || "no connection")}</small>
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
        <div class="registry-form-title">
          <strong>${editor.mode === "edit" ? "Edit profile" : "New profile"}</strong>
          <span>${escapeHtml(providerRuntimeLabel(editor.agentRuntime))}</span>
        </div>
        <div class="form-grid compact registry-primary-fields">
          <label class="span-2">Profile name<input value="${escapeHtml(editor.name)}" data-field="agent.name" placeholder="Research agent" /></label>
          <label class="span-2">Provider Connection
            <select data-field="agent.providerConnectionId">
              <option value="">No connection</option>
              ${compatibleConnections.map((connection) => `<option value="${escapeHtml(connection.connection_id)}" ${editor.providerConnectionId === connection.connection_id ? "selected" : ""} ${connection.status !== "active" ? "disabled" : ""}>${escapeHtml(connection.name)}${connection.default_model ? ` / ${escapeHtml(connection.default_model)}` : ""}${connection.status !== "active" ? " (disabled)" : ""}</option>`).join("")}
            </select>
          </label>
          <label class="span-2">${modelLabel}
            ${editor.agentRuntime !== "openclaw" && selectedConnection?.models?.length
              ? `<select data-field="agent.openclawAgentId">
                  <option value="">Connection default / ${escapeHtml(selectedConnection.default_model || "runtime default")}</option>
                  ${selectedConnection.models.map((model) => `<option value="${escapeHtml(model)}" ${editor.openclawAgentId === model ? "selected" : ""}>${escapeHtml(model)}</option>`).join("")}
                </select>`
              : `<input value="${escapeHtml(editor.openclawAgentId)}" data-field="agent.openclawAgentId" placeholder="${escapeHtml(modelPlaceholder)}" />`
            }
          </label>
          <label class="span-2">Description<textarea rows="2" data-field="agent.description">${escapeHtml(editor.description)}</textarea></label>
          <label>Default skills<input value="${escapeHtml(editor.defaultSkillsText)}" list="skill-options" data-field="agent.defaultSkillsText" /></label>
          <label>Allowed tools<input value="${escapeHtml(editor.allowedToolsText)}" data-field="agent.allowedToolsText" /></label>
        </div>
        ${selectedConnection ? `
          <div class="registry-binding-summary">
            <span><small>Connection</small><strong>${escapeHtml(selectedConnection.name)}</strong></span>
            <span><small>Model</small><strong>${escapeHtml(editor.openclawAgentId || selectedConnection.default_model || "runtime default")}</strong></span>
            <span><small>Credential</small><strong class="${selectedConnection.credential_configured ? "success-text" : "warn-text"}">${selectedConnection.credential_configured ? "available" : "not detected"}</strong></span>
          </div>
        ` : ""}
        <details class="registry-advanced">
          <summary>Advanced settings</summary>
          <div class="form-grid compact">
            <label>ID<input value="${escapeHtml(editor.profileId)}" data-field="agent.profileId" placeholder="generated from name" ${editor.mode === "edit" ? "disabled" : ""} /></label>
            <label>Status
              <select data-field="agent.status">
                <option value="active" ${editor.status === "active" ? "selected" : ""}>active</option>
                <option value="disabled" ${editor.status === "disabled" ? "selected" : ""}>disabled</option>
              </select>
            </label>
            <label>Agent Runtime<select data-field="agent.agentRuntime">${renderProviderRuntimeOptions(editor.agentRuntime)}</select></label>
            <label>Harness profile<input value="${escapeHtml(editor.harnessProfile)}" data-field="agent.harnessProfile" placeholder="agent-harness-v1" /></label>
            <label>Disallowed skills<input value="${escapeHtml(editor.disallowedSkillsText)}" list="skill-options" data-field="agent.disallowedSkillsText" /></label>
            <label>Policy tags<input value="${escapeHtml(editor.policyTagsText)}" data-field="agent.policyTagsText" /></label>
            <label>Legacy provider<input value="${escapeHtml(editor.openclawProvider)}" data-field="agent.openclawProvider" /></label>
            <label>Legacy model<input value="${escapeHtml(editor.openclawModel)}" data-field="agent.openclawModel" /></label>
            <label>Legacy runtime mode<input value="${escapeHtml(editor.openclawRuntimeMode)}" data-field="agent.openclawRuntimeMode" /></label>
            <label class="span-2">Metadata JSON<textarea class="code" rows="4" data-field="agent.metadataText">${escapeHtml(editor.metadataText)}</textarea></label>
          </div>
        </details>
        <div class="registry-actions">
          <button class="primary" data-action="save-agent-profile" ${state.registrySaving ? "disabled" : ""}>${state.registrySaving ? "Saving..." : "Save profile"}</button>
          <button class="secondary danger-action" data-action="disable-agent-profile" ${state.registryDisabling || editor.mode !== "edit" || editor.status === "disabled" ? "disabled" : ""}>${state.registryDisabling ? "Disabling..." : "Disable"}</button>
        </div>
      </div>
    </div>
  `;
}

function renderMcpServerManager() {
  return `
    <div class="provider-connection-manager">
      <div class="registry-manager-header">
        <div>
          <h4>MCP Servers</h4>
          <p>${state.mcpServers.length} server(s), ${state.mcpServers.reduce((count, server) => count + (server.discovered_tools || []).length, 0)} tool(s)</p>
        </div>
        <button class="primary compact-button" data-action="new-mcp-server">New server</button>
      </div>
      <div class="mcp-server-list">
        ${state.mcpServers.length ? state.mcpServers.map((server) => {
          const statusTone = server.status === "ready" ? "success" : server.status === "error" ? "danger" : server.status === "connecting" ? "warn" : "neutral";
          const testing = state.mcpServerTestingId === server.server_id;
          const desktopRequired = server.transport === "stdio" && !desktopHost?.mcp?.configure;
          return `
            <article class="mcp-server-row">
              <button class="mcp-server-main" data-action="edit-mcp-server" data-id="${escapeHtml(server.server_id)}">
                <span class="mcp-server-identity">
                  <strong>${escapeHtml(server.name)}</strong>
                  <small>${escapeHtml(server.transport === "stdio" ? server.command || "stdio" : server.url || "Streamable HTTP")}</small>
                </span>
                <span class="mcp-server-tools">
                  <strong>${(server.discovered_tools || []).length}</strong>
                  <small>tools</small>
                </span>
                <span class="mcp-server-status">
                  <span class="badge ${statusTone}">${escapeHtml(server.status)}</span>
                  ${server.secret_configured ? '<span class="badge neutral">secrets</span>' : ""}
                </span>
              </button>
              <div class="mcp-server-actions">
                <button class="mini-button" data-action="test-mcp-server" data-id="${escapeHtml(server.server_id)}" ${testing || desktopRequired || !server.enabled ? "disabled" : ""}>${testing ? "Testing..." : "Test"}</button>
                <button class="mini-button ${server.enabled ? "danger-action" : ""}" data-action="toggle-mcp-server" data-id="${escapeHtml(server.server_id)}" data-enabled="${server.enabled ? "false" : "true"}" ${state.registryDisabling || desktopRequired && !server.enabled ? "disabled" : ""}>${server.enabled ? "Disable" : "Enable"}</button>
              </div>
              ${server.last_error ? `<p class="mcp-server-error">${escapeHtml(server.last_error)}</p>` : ""}
            </article>
          `;
        }).join("") : '<div class="provider-connection-empty"><strong>No MCP servers</strong><span>Add a local stdio or public Streamable HTTP server.</span></div>'}
      </div>
    </div>
  `;
}

function renderMcpServerModal() {
  if (!state.ui.mcpServerModalOpen) return "";
  const editor = state.registryEditor.mcpServer;
  const preset = state.mcpConnectorPresets.find((item) => item.preset_id === editor.presetId) || null;
  const testing = state.mcpServerTestingId === editor.serverId;
  return `
    <div class="provider-modal-backdrop">
      <section class="provider-modal" role="dialog" aria-modal="true" aria-label="${editor.mode === "edit" ? "Edit MCP Server" : "New MCP Server"}">
        <header class="provider-modal-header">
          <div><h3>${editor.mode === "edit" ? "Edit MCP Server" : "New MCP Server"}</h3><p>${editor.transport === "stdio" ? "Desktop-authorized local process" : "Public Streamable HTTP endpoint"}</p></div>
          <button class="icon-button" data-action="close-mcp-server-modal" aria-label="Close">&times;</button>
        </header>
        <div class="provider-modal-body">
          ${state.error ? `<div class="alert danger">${escapeHtml(state.error)}</div>` : ""}
          <div class="form-grid compact provider-modal-grid">
            <label class="span-2">Connector
              <select data-field="mcp.presetId" ${editor.mode === "edit" ? "disabled" : ""}>
                ${state.mcpConnectorPresets.map((item) => `<option value="${escapeHtml(item.preset_id)}" ${editor.presetId === item.preset_id ? "selected" : ""}>${escapeHtml(item.name)} / Official remote</option>`).join("")}
                <option value="custom" ${editor.presetId === "custom" ? "selected" : ""}>Custom MCP server</option>
              </select>
            </label>
            ${preset ? `<div class="span-2 mcp-preset-summary"><strong>${escapeHtml(preset.provider)}</strong><span>${escapeHtml(preset.description)}</span></div>` : ""}
            <label class="span-2">Name<input value="${escapeHtml(editor.name)}" data-field="mcp.name" placeholder="GitHub MCP" /></label>
            <label>Transport<select data-field="mcp.transport" ${editor.mode === "edit" ? "disabled" : ""}><option value="stdio" ${editor.transport === "stdio" ? "selected" : ""} ${desktopHost?.mcp?.configure ? "" : "disabled"}>stdio / Desktop</option><option value="streamable-http" ${editor.transport === "streamable-http" ? "selected" : ""}>Streamable HTTP</option></select></label>
            <label>Enabled<input type="checkbox" data-field="mcp.enabled" ${editor.enabled ? "checked" : ""} /></label>
            <label class="span-2">Description<textarea rows="2" data-field="mcp.description">${escapeHtml(editor.description)}</textarea></label>
            ${editor.transport === "stdio" ? `
              <label class="span-2">Executable<input value="${escapeHtml(editor.command)}" data-field="mcp.command" placeholder="C:\\path\\to\\mcp-server.exe" /></label>
              <label class="span-2">Arguments<textarea class="code" rows="3" data-field="mcp.argsText" placeholder="One argument per line">${escapeHtml(editor.argsText)}</textarea></label>
              <label class="span-2">Environment JSON<textarea class="code" rows="4" data-field="mcp.environmentText">${escapeHtml(editor.environmentText)}</textarea></label>
            ` : `
              <label class="span-2">URL<input value="${escapeHtml(editor.url)}" data-field="mcp.url" placeholder="https://mcp.example.com/mcp" /></label>
              <label class="span-2">Headers JSON<textarea class="code" rows="4" data-field="mcp.headersText">${escapeHtml(editor.headersText)}</textarea></label>
            `}
            ${preset ? (preset.secrets || []).map((secret) => {
              const configured = editor.secretConfigured || Boolean(editor.presetSecretValues?.[secret.name]);
              return `<label class="span-2">${escapeHtml(secret.label)}${secret.required ? "" : " (optional)"}
                <input type="password" value="${escapeHtml(editor.presetSecretValues?.[secret.name] || "")}" data-field="mcp.secret.${escapeHtml(secret.name)}" placeholder="${configured ? "Saved secret (leave blank to keep)" : escapeHtml(secret.placeholder)}" autocomplete="new-password" />
                <small>${escapeHtml(configured ? "Credential configured" : secret.description)}</small>
              </label>`;
            }).join("") : `<label class="span-2">Secrets JSON<textarea class="code" rows="3" data-field="mcp.secretsText" placeholder='{"API_TOKEN":"..."}'>${escapeHtml(editor.secretsText)}</textarea></label>`}
          </div>
          <details class="provider-modal-advanced">
            <summary>Advanced settings</summary>
            <div class="form-grid compact provider-modal-grid">
              <label>ID<input value="${escapeHtml(editor.serverId)}" data-field="mcp.serverId" placeholder="generated.from.name" ${editor.mode === "edit" ? "disabled" : ""} /></label>
              <label>Default risk<select data-field="mcp.defaultRiskLevel"><option value="" ${!editor.defaultRiskLevel ? "selected" : ""}>From annotations</option>${["T0", "T1", "T2", "T3"].map((risk) => `<option value="${risk}" ${editor.defaultRiskLevel === risk ? "selected" : ""}>${risk}</option>`).join("")}</select></label>
              <label>Include tools<input value="${escapeHtml(editor.includeToolsText)}" data-field="mcp.includeToolsText" placeholder="tool_a, tool_b" /></label>
              <label>Exclude tools<input value="${escapeHtml(editor.excludeToolsText)}" data-field="mcp.excludeToolsText" placeholder="dangerous_tool" /></label>
              <label>Connect timeout (ms)<input type="number" min="1000" max="120000" step="1000" value="${escapeHtml(String(editor.connectTimeoutMs))}" data-field="mcp.connectTimeoutMs" /></label>
              <label>Tool timeout (ms)<input type="number" min="1000" max="300000" step="1000" value="${escapeHtml(String(editor.toolTimeoutMs))}" data-field="mcp.toolTimeoutMs" /></label>
              <label class="span-2">Risk overrides JSON<textarea class="code" rows="3" data-field="mcp.riskOverridesText">${escapeHtml(editor.riskOverridesText)}</textarea></label>
            </div>
          </details>
          ${editor.mode === "edit" && (state.mcpServers.find((server) => server.server_id === editor.serverId)?.discovered_tools || []).length ? `
            <div class="mcp-tool-preview">
              ${(state.mcpServers.find((server) => server.server_id === editor.serverId)?.discovered_tools || []).map((tool) => `<span><strong>${escapeHtml(tool.tool_name)}</strong><small>${escapeHtml(tool.risk_level)}</small></span>`).join("")}
            </div>
          ` : ""}
        </div>
        <footer class="provider-modal-footer">
          <div>${editor.mode === "edit" ? `<button class="secondary" data-action="test-mcp-server" data-id="${escapeHtml(editor.serverId)}" ${testing || !editor.enabled ? "disabled" : ""}>${testing ? "Testing..." : "Test"}</button>` : ""}</div>
          <div>
            <button class="secondary" data-action="close-mcp-server-modal">Cancel</button>
            <button class="primary" data-action="save-mcp-server" ${state.registrySaving ? "disabled" : ""}>${state.registrySaving ? "Saving..." : "Save server"}</button>
          </div>
        </footer>
      </section>
    </div>
  `;
}

function renderProviderConnectionManager() {
  return `
    <div class="provider-connection-manager">
      <div class="registry-manager-header">
        <div>
          <h4>Provider Connections</h4>
          <p>${state.providerConnections.length} connection(s)</p>
        </div>
        <button class="primary compact-button" data-action="new-provider-connection">New connection</button>
      </div>
      <div class="provider-connection-list">
        ${
          state.providerConnections.length
            ? state.providerConnections.map((connection) => {
                const verification = connection.verification;
                const testStatus = !connection.credential_configured
                  ? { label: "Key missing", tone: "warn" }
                  : verification?.status === "verified"
                    ? { label: "Verified", tone: "success" }
                    : verification?.status === "failed"
                      ? { label: "Failed", tone: "danger" }
                      : { label: "Configured", tone: "neutral" };
                return `
                <button class="provider-connection-row" data-action="edit-provider-connection" data-id="${escapeHtml(connection.connection_id)}">
                  <span class="provider-connection-identity">
                    <strong>${escapeHtml(connection.name)}</strong>
                    <small>${escapeHtml(providerRuntimeLabel(connection.agent_runtime))} / ${(connection.models || []).length} model(s)</small>
                  </span>
                  <span class="provider-connection-model">
                    <small>Default model</small>
                    <strong>${escapeHtml(connection.default_model || "Not selected")}</strong>
                  </span>
                  <span class="provider-connection-status">
                    <span class="badge ${testStatus.tone}">${testStatus.label}</span>
                    <span class="badge ${connection.status === "active" ? "neutral" : "warn"}">${escapeHtml(connection.status)}</span>
                  </span>
                </button>
              `;
              }).join("")
            : '<div class="provider-connection-empty"><strong>No connections</strong><span>Create one to make models available to Agent Profiles.</span></div>'
        }
      </div>
    </div>
  `;
}

function renderProviderConnectionModal() {
  if (!state.ui.providerConnectionModalOpen) return "";
  const editor = state.registryEditor.connection;
  const credentialOptions = PROVIDER_CREDENTIAL_ENVS[editor.agentRuntime] || [];
  const runtimeDefaults = PROVIDER_DEFAULTS[editor.agentRuntime] || {};
  const credentialStatus = editor.credentialSource === "environment"
    ? editor.credentialConfigured ? "Environment key detected" : "Environment key not detected"
    : editor.credentialConfigured ? "API key saved" : "API key required";
  const endpointRequired = editor.agentRuntime === "glm" || editor.preset === "custom";
  const savedConnection = state.providerConnections.find(
    (connection) => connection.connection_id === editor.connectionId,
  );
  const verification = savedConnection?.verification || null;
  const testing = state.providerConnectionTestingId === editor.connectionId;
  const testDisabled = editor.mode !== "edit" || editor.status !== "active" || !editor.credentialConfigured || testing || state.registrySaving;
  return `
    <div class="provider-modal-backdrop">
      <section class="provider-modal" role="dialog" aria-modal="true" aria-label="${editor.mode === "edit" ? "Edit Provider Connection" : "New Provider Connection"}">
        <header class="provider-modal-header">
          <div>
            <h3>${editor.mode === "edit" ? "Edit connection" : "New connection"}</h3>
            <p>${credentialStatus}</p>
          </div>
          <button class="icon-button" data-action="close-provider-connection-modal" title="Close" aria-label="Close">&#10005;</button>
        </header>
        <div class="provider-modal-body">
          ${state.error ? `<div class="alert danger">${escapeHtml(state.error)}</div>` : ""}
          <div class="form-grid compact provider-modal-grid">
            <label class="span-2">Name<input value="${escapeHtml(editor.name)}" data-field="connection.name" placeholder="Production models" /></label>
            <label>Provider
              <select data-field="connection.preset">
                ${Object.entries(PROVIDER_PRESETS).map(([id, preset]) => `<option value="${id}" ${editor.preset === id ? "selected" : ""}>${escapeHtml(preset.label)}</option>`).join("")}
              </select>
            </label>
            <label>Endpoint${endpointRequired ? "" : " (optional)"}<input value="${escapeHtml(editor.baseUrl)}" data-field="connection.baseUrl" placeholder="${escapeHtml(runtimeDefaults.endpointPlaceholder || "https://provider.example/v1")}" /></label>
            ${editor.credentialSource === "managed" ? `
              <label class="span-2">API key
                <input type="password" value="${escapeHtml(editor.apiKey)}" data-field="connection.apiKey" placeholder="${editor.credentialConfigured ? "Saved key (leave blank to keep)" : "Enter API key"}" autocomplete="new-password" />
              </label>
            ` : ""}
          </div>
          <div class="provider-model-section">
            <div class="provider-model-header">
              <div><strong>Models</strong><span>${(editor.models || []).filter((item) => item.trim()).length} configured</span></div>
              <button class="mini-button" data-action="add-provider-model">Add model</button>
            </div>
            <div class="provider-model-list">
              ${(editor.models || []).map((model, index) => `
                <div class="provider-model-row">
                  <input value="${escapeHtml(model)}" data-field="connection.model" data-index="${index}" placeholder="${escapeHtml(runtimeDefaults.modelPlaceholder || "model id")}" />
                  <label class="provider-default-model">
                    <input type="radio" name="provider-default-model" value="${escapeHtml(model)}" data-field="connection.defaultModelChoice" data-index="${index}" ${model && editor.defaultModel === model ? "checked" : ""} />
                    <span>Default</span>
                  </label>
                  <button class="icon-button" data-action="remove-provider-model" data-index="${index}" title="Remove model" aria-label="Remove model">&#10005;</button>
                </div>
              `).join("")}
            </div>
          </div>
          <details class="registry-advanced provider-modal-advanced">
            <summary>Advanced settings</summary>
            <div class="form-grid compact">
              <label>Agent Runtime<select data-field="connection.agentRuntime">${renderProviderRuntimeOptions(editor.agentRuntime)}</select></label>
              <label>Credential storage
                <select data-field="connection.credentialSource">
                  <option value="managed" ${editor.credentialSource === "managed" ? "selected" : ""}>Managed encrypted key</option>
                  <option value="environment" ${editor.credentialSource === "environment" ? "selected" : ""}>Server environment</option>
                </select>
              </label>
              <label>Protocol
                <select data-field="connection.protocol">
                  ${Object.entries(PROVIDER_PROTOCOLS).map(([id, label]) => `<option value="${id}" ${editor.protocol === id ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
                </select>
              </label>
              <label>Environment variable
                <select data-field="connection.credentialEnv">
                  ${credentialOptions.map((name) => `<option value="${name}" ${editor.credentialEnv === name ? "selected" : ""}>${escapeHtml(credentialEnvLabel(name))}</option>`).join("")}
                </select>
              </label>
              <label>ID<input value="${escapeHtml(editor.connectionId)}" data-field="connection.connectionId" placeholder="generated from name" ${editor.mode === "edit" ? "disabled" : ""} /></label>
              <label>Provider ID<input value="${escapeHtml(editor.provider)}" data-field="connection.provider" /></label>
              <label>Status<select data-field="connection.status"><option value="active" ${editor.status === "active" ? "selected" : ""}>active</option><option value="disabled" ${editor.status === "disabled" ? "selected" : ""}>disabled</option></select></label>
              <label>Maximum input tokens<input type="number" min="4096" max="1048576" step="1024" value="${escapeHtml(String(editor.maxInputTokens))}" data-field="connection.maxInputTokens" /></label>
              <label>Maximum output tokens<input type="number" min="1024" max="131072" step="1024" value="${escapeHtml(String(editor.maxOutputTokens))}" data-field="connection.maxOutputTokens" /></label>
              <label class="provider-toggle-field"><span>Automatic context compression</span><input type="checkbox" data-field="connection.contextCompressionEnabled" ${editor.contextCompressionEnabled ? "checked" : ""} /></label>
              <label>Compression threshold (%)<input type="number" min="50" max="95" step="1" value="${escapeHtml(String(editor.contextCompressionThresholdPercent))}" data-field="connection.contextCompressionThresholdPercent" /></label>
              <label>Maximum continuation rounds<input type="number" min="0" max="32" step="1" value="${escapeHtml(String(editor.maxContinuationRounds))}" data-field="connection.maxContinuationRounds" /></label>
              <label class="span-2">Metadata JSON<textarea class="code" rows="3" data-field="connection.metadataText">${escapeHtml(editor.metadataText)}</textarea></label>
            </div>
          </details>
          <div class="provider-test-result ${verification?.status || "untested"}">
            <span class="provider-test-indicator" aria-hidden="true"></span>
            <div>
              <strong>${verification?.status === "verified" ? "Connection verified" : verification?.status === "failed" ? "Connection test failed" : "Connection not tested"}</strong>
              <p>${escapeHtml(verification?.detail || "Run a minimal Provider request to verify the endpoint, credential, and selected model.")}</p>
              ${verification ? `<small>${escapeHtml(verification.model || "Default model")} / ${verification.duration_ms} ms / ${escapeHtml(formatWorkspaceTimestamp(verification.tested_at))}</small>` : `<small>Testing may consume a small amount of Provider quota.</small>`}
            </div>
          </div>
        </div>
        <footer class="provider-modal-footer">
          <div>
            ${editor.mode === "edit" ? `<button class="secondary danger-action" data-action="disable-provider-connection" ${state.registryDisabling || editor.status === "disabled" ? "disabled" : ""}>Disable</button>` : ""}
            <button class="secondary" data-action="test-provider-connection" ${testDisabled ? "disabled" : ""}>${testing ? "Testing..." : "Test connection"}</button>
          </div>
          <div>
            <button class="secondary" data-action="close-provider-connection-modal">Cancel</button>
            <button class="primary" data-action="save-provider-connection" ${state.registrySaving ? "disabled" : ""}>${state.registrySaving ? "Saving..." : "Save connection"}</button>
          </div>
        </footer>
      </section>
    </div>
  `;
}

function getDoctorCheck(report, checkId) {
  return report?.checks?.find((check) => check.id === checkId) || null;
}

function setupStatusTone(status) {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  if (status === "warn") return "warn";
  return "pending";
}

function renderSetupEnvironmentCheck(check, fallbackLabel) {
  const status = check?.status || "pending";
  return `
    <div class="setup-detail-row">
      <span class="setup-status-dot ${setupStatusTone(status)}"></span>
      <span><strong>${escapeHtml(check?.summary || fallbackLabel)}</strong><small>${escapeHtml(check?.detail || "Not checked")}</small></span>
    </div>
  `;
}

function renderStudioSetupModal() {
  if (!state.setup.open) return "";
  const editor = state.registryEditor.connection;
  const preset = PROVIDER_PRESETS[editor.preset] || PROVIDER_PRESETS.custom;
  const defaults = PROVIDER_DEFAULTS[editor.agentRuntime] || {};
  const activeConnections = state.providerConnections.filter((item) => item.status === "active");
  const connection = state.providerConnections.find(
    (item) => item.connection_id === editor.connectionId,
  ) || getSetupConnection();
  const verification = connection?.verification || null;
  const hostCheck = getDoctorCheck(state.setup.hostReport, "host.shell");
  const dockerClient = getDoctorCheck(state.setup.dockerReport, "docker.client");
  const dockerDaemon = getDoctorCheck(state.setup.dockerReport, "docker.daemon");
  const dockerImage = getDoctorCheck(state.setup.dockerReport, "docker.image");
  const dockerMount = getDoctorCheck(state.setup.dockerReport, "docker.workspace_mount");
  const workerLoop = getDoctorCheck(state.setup.dockerReport, "worker.registration_loopback");
  const dockerAppReady = dockerClient?.status === "pass" && dockerDaemon?.status === "pass";
  const environmentChecked = !!state.setup.hostReport || !!state.setup.dockerReport;
  const canFinish = verification?.status === "verified" && environmentChecked && (hostCheck?.status === "pass" || dockerAppReady);
  const selectedModel = editor.defaultModel || editor.models?.[0] || "";
  const credentialLabel = verification?.status === "verified"
    ? "Verified"
    : verification?.status === "failed"
      ? "Verification failed"
      : editor.credentialConfigured ? "Configured" : "Credential required";
  return `
    <div class="setup-modal-backdrop">
      <section class="setup-modal" role="dialog" aria-modal="true" aria-label="My Mate setup">
        <header class="setup-modal-header">
          <div>
            <span class="setup-mark">MM</span>
            <span><h3>Set up My Mate</h3><p>Connect a model. My Mate handles the technical settings.</p></span>
          </div>
          <button class="icon-button" data-action="dismiss-studio-setup" title="Configure later" aria-label="Configure later">&#10005;</button>
        </header>
        <nav class="setup-tabs" role="tablist" aria-label="Setup sections">
          <button class="setup-tab ${state.setup.tab === "model" ? "active" : ""}" data-action="select-setup-tab" data-setup-tab="model" role="tab" aria-selected="${state.setup.tab === "model"}">
            <span class="setup-step">1</span><span>Model</span><span class="setup-status-dot ${verification?.status === "verified" ? "pass" : verification?.status === "failed" ? "fail" : "pending"}"></span>
          </button>
          <button class="setup-tab ${state.setup.tab === "environment" ? "active" : ""}" data-action="select-setup-tab" data-setup-tab="environment" role="tab" aria-selected="${state.setup.tab === "environment"}">
            <span class="setup-step">2</span><span>Machine</span><span class="setup-status-dot ${environmentChecked ? (hostCheck?.status === "pass" || dockerAppReady ? "pass" : "warn") : "pending"}"></span>
          </button>
        </nav>
        <div class="setup-modal-body">
          ${state.setup.error ? `<div class="alert danger">${escapeHtml(state.setup.error)}</div>` : ""}
          ${state.setup.tab === "model" ? `
            <div class="setup-section-heading">
              <div><h4>Model connection</h4><p>Provider, model, and credential are enough for normal setup.</p></div>
              <span class="badge ${verification?.status === "verified" ? "success" : verification?.status === "failed" ? "danger" : "warn"}">${credentialLabel}</span>
            </div>
            ${activeConnections.length ? `
              <div class="setup-connection-picker">
                <label>Saved connection
                  <select data-field="setup.connectionId">
                    ${activeConnections.map((item) => `
                      <option value="${escapeHtml(item.connection_id)}" ${item.connection_id === editor.connectionId ? "selected" : ""}>
                        ${escapeHtml(`${item.name} - ${item.default_model || item.models?.[0] || "No model"}`)}
                      </option>
                    `).join("")}
                    <option value="${NEW_SETUP_CONNECTION_ID}" ${editor.mode === "new" ? "selected" : ""}>Add another connection</option>
                  </select>
                </label>
                <span>${connection ? `${(connection.models || []).length} model${(connection.models || []).length === 1 ? "" : "s"} available: ${escapeHtml((connection.models || []).join(", ") || "No models")}` : "Configure a new provider connection."}</span>
              </div>
            ` : ""}
            <div class="setup-model-grid">
              <label>Provider
                <select data-field="connection.preset">
                  ${Object.entries(PROVIDER_PRESETS).map(([id, item]) => `<option value="${id}" ${editor.preset === id ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
                </select>
              </label>
              <label>Model
                <input value="${escapeHtml(selectedModel)}" data-field="setup.model" placeholder="${escapeHtml(defaults.modelPlaceholder || "model id")}" />
              </label>
              <label class="span-2">Endpoint${editor.agentRuntime === "glm" || editor.preset === "custom" ? "" : " (optional)"}
                <input value="${escapeHtml(editor.baseUrl)}" data-field="connection.baseUrl" placeholder="${escapeHtml(defaults.endpointPlaceholder || "https://provider.example/v1")}" />
              </label>
              ${editor.credentialSource === "managed" ? `
                <label class="span-2">API key
                  <input type="password" value="${escapeHtml(editor.apiKey)}" data-field="connection.apiKey" placeholder="${editor.credentialConfigured ? "Saved key (leave blank to keep)" : "Enter API key"}" autocomplete="new-password" />
                </label>
              ` : ""}
            </div>
            <div class="setup-verification ${verification?.status || "untested"}">
              <span class="setup-status-dot ${verification?.status === "verified" ? "pass" : verification?.status === "failed" ? "fail" : "pending"}"></span>
              <span><strong>${verification?.status === "verified" ? "Connection verified" : verification?.status === "failed" ? "Connection test failed" : "Connection not tested"}</strong><small>${escapeHtml(verification?.detail || "Save and verify sends one minimal request to the selected provider.")}</small></span>
            </div>
            <button class="setup-advanced-link" data-action="open-provider-advanced">Advanced connection settings</button>
          ` : `
            <div class="setup-section-heading">
              <div><h4>Environment</h4><p>Checks run locally through Doctor.</p></div>
              <button class="secondary" data-action="run-setup-environment" ${state.setup.environmentLoading ? "disabled" : ""}>${state.setup.environmentLoading ? "Checking..." : "Run checks"}</button>
            </div>
            <div class="setup-environment-list">
              <article class="setup-environment-card">
                <div class="setup-environment-main">
                  <span class="setup-status-dot ${setupStatusTone(hostCheck?.status)}"></span>
                  <span><strong>${globalThis.navigator?.platform?.startsWith("Win") ? "Git Bash / host shell" : "Host shell"}</strong><small>${escapeHtml(hostCheck?.detail || "Not checked")}</small></span>
                  <span class="badge ${hostCheck?.status === "pass" ? "success" : hostCheck ? "warn" : "neutral"}">${hostCheck?.status === "pass" ? "Ready" : hostCheck ? "Needs attention" : "Pending"}</span>
                </div>
                ${hostCheck?.remediation ? `<p>${escapeHtml(hostCheck.remediation)}</p>` : ""}
              </article>
              <article class="setup-environment-card">
                <div class="setup-environment-main">
                  <span class="setup-status-dot ${dockerAppReady ? "pass" : state.setup.dockerReport ? "fail" : "pending"}"></span>
                  <span><strong>Docker</strong><small>${dockerAppReady ? "CLI and Linux daemon are available." : "Docker Desktop and daemon are checked together."}</small></span>
                  <span class="badge ${dockerAppReady ? "success" : state.setup.dockerReport ? "warn" : "neutral"}">${dockerAppReady ? "Ready" : state.setup.dockerReport ? "Needs attention" : "Pending"}</span>
                </div>
                <details class="setup-environment-details" ${state.setup.dockerReport && !dockerAppReady ? "open" : ""}>
                  <summary>Docker details</summary>
                  ${renderSetupEnvironmentCheck(dockerClient, "Docker CLI")}
                  ${renderSetupEnvironmentCheck(dockerDaemon, "Docker daemon")}
                  ${renderSetupEnvironmentCheck(dockerImage, "Runtime Worker image")}
                  ${renderSetupEnvironmentCheck(dockerMount, "Workspace mount")}
                  ${renderSetupEnvironmentCheck(workerLoop, "Worker registration")}
                </details>
              </article>
            </div>
          `}
        </div>
        <footer class="setup-modal-footer">
          <button class="secondary" data-action="dismiss-studio-setup">Later</button>
          ${state.setup.tab === "model" ? `
            <button class="primary" data-action="save-setup-model" ${state.setup.modelSaving ? "disabled" : ""}>${state.setup.modelSaving ? "Saving & testing..." : "Save & verify"}</button>
          ` : `
            <button class="primary" data-action="finish-studio-setup" ${canFinish ? "" : "disabled"}>Finish setup</button>
          `}
        </footer>
      </section>
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

function renderGovernancePanel(embedded = false) {
  const policy = state.governance.policy;
  const wrapperTag = embedded ? "div" : "section";
  const wrapperClass = embedded ? "registry-governance-view" : "panel governance-panel";
  if (!policy) {
    return `
      <${wrapperTag} class="${wrapperClass}">
        <div class="panel-header">
          <div><h3>Registry Governance</h3><p>Policy and approval state are unavailable.</p></div>
          <button class="secondary" data-action="refresh-governance" ${state.governance.loading ? "disabled" : ""}>Refresh</button>
        </div>
      </${wrapperTag}>
    `;
  }
  const identity = state.security.identity;
  const principalId = identity?.principal?.principal_id || "";
  const canReview = hasSecurityPermission("governance.review");
  const canPropose = hasSecurityPermission("registry.manage");
  const draft = state.governance.draft;
  const pendingCount = state.governance.changes.filter((change) => change.status === "pending").length;
  return `
    <${wrapperTag} class="${wrapperClass}">
      <div class="panel-header">
        <div>
          <h3>Registry Governance</h3>
          <p>${pendingCount} pending / ${state.governance.changes.length} recent change(s)</p>
        </div>
        <span class="badge ${policy.mode === "enforced" ? "warn" : "neutral"}">${escapeHtml(policy.mode)}</span>
      </div>
      <div class="governance-policy-bar">
        <label>Mode
          <select data-field="governance.policy.mode" ${!canReview ? "disabled" : ""}>
            <option value="advisory" ${policy.mode === "advisory" ? "selected" : ""}>advisory</option>
            <option value="enforced" ${policy.mode === "enforced" ? "selected" : ""}>enforced</option>
          </select>
        </label>
        <label>Approvals
          <input type="number" min="1" max="5" value="${escapeHtml(String(policy.required_approvals || 1))}" data-field="governance.policy.requiredApprovals" ${!canReview ? "disabled" : ""} />
        </label>
        <label class="governance-checkbox">
          <input type="checkbox" data-field="governance.policy.allowSelfApproval" ${policy.allow_self_approval ? "checked" : ""} ${!canReview ? "disabled" : ""} />
          <span>Self approval</span>
        </label>
        <button class="secondary" data-action="save-governance-policy" ${!canReview || state.governance.saving ? "disabled" : ""}>Save policy</button>
        <button class="icon-button" data-action="refresh-governance" title="Refresh governance" aria-label="Refresh governance">Ref</button>
      </div>
      <div class="governance-workbench">
        <div class="governance-composer">
          <div class="registry-manager-header">
            <div><h4>Propose Change</h4><p>Payload is frozen and hashed at submission.</p></div>
          </div>
          <div class="form-grid compact">
            <label>Action
              <select data-field="governance.draft.action">
                ${["agent_profile.upsert", "agent_profile.disable", "skill.upsert", "skill.disable", "template.publish", "template.archive"]
                  .map((action) => `<option value="${action}" ${draft.action === action ? "selected" : ""}>${action}</option>`)
                  .join("")}
              </select>
            </label>
            <label>Resource ID<input value="${escapeHtml(draft.resourceId)}" data-field="governance.draft.resourceId" /></label>
            <label class="span-2">Reason<input value="${escapeHtml(draft.reason)}" data-field="governance.draft.reason" /></label>
            <label class="span-2">Payload JSON<textarea class="code" rows="6" data-field="governance.draft.payloadText">${escapeHtml(draft.payloadText)}</textarea></label>
          </div>
          <div class="registry-actions">
            <button class="primary" data-action="submit-governance-proposal" ${!canPropose || state.governance.saving ? "disabled" : ""}>Submit proposal</button>
          </div>
        </div>
        <div class="governance-queue">
          <div class="registry-manager-header">
            <div><h4>Approval Queue</h4><p>Approval and apply are separate evidence-bearing actions.</p></div>
          </div>
          <div class="governance-change-list">
            ${
              state.governance.changes.length
                ? state.governance.changes.map((change) => {
                    const selfBlocked = !change.allow_self_approval && change.proposed_by === principalId;
                    const approvalCount = (change.approvals || []).filter((item) => item.decision === "approved").length;
                    return `
                      <article class="governance-change-row">
                        <div class="governance-change-head">
                          <span>
                            <strong>${escapeHtml(change.action)}</strong>
                            <small>${escapeHtml(`${change.resource_type}/${change.resource_id}`)}</small>
                          </span>
                          <span class="badge ${statusTone(change.status)}">${escapeHtml(change.status)}</span>
                        </div>
                        <p>${escapeHtml(change.reason)}</p>
                        <small>${escapeHtml(change.proposed_by)} / approvals ${approvalCount}/${change.required_approvals}</small>
                        ${change.conflict_reason ? `<small class="danger-text">${escapeHtml(change.conflict_reason)}</small>` : ""}
                        <div class="governance-change-actions">
                          ${change.status === "pending" ? `
                            <button class="mini-button" data-action="approve-governance-change" data-id="${escapeHtml(change.change_id)}" ${!canReview || selfBlocked || state.governance.saving ? "disabled" : ""}>Approve</button>
                            <button class="mini-button danger-action" data-action="reject-governance-change" data-id="${escapeHtml(change.change_id)}" ${!canReview || selfBlocked || state.governance.saving ? "disabled" : ""}>Reject</button>
                          ` : ""}
                          ${change.status === "approved" ? `<button class="mini-button" data-action="apply-governance-change" data-id="${escapeHtml(change.change_id)}" ${!canReview || state.governance.saving ? "disabled" : ""}>Apply</button>` : ""}
                        </div>
                      </article>
                    `;
                  }).join("")
                : '<p class="muted">No governance changes yet.</p>'
            }
          </div>
        </div>
      </div>
    </${wrapperTag}>
  `;
}

function renderRegistryManagerPanel() {
  const section = ["connections", "mcp", "agents", "skills", "governance"].includes(state.ui.registrySection)
    ? state.ui.registrySection
    : "connections";
  const tabs = [
    ["connections", "Connections", state.providerConnections.length],
    ["mcp", "MCP", state.mcpServers.length],
    ["agents", "Agent Profiles", state.agentProfiles.length],
    ["skills", "Skills", state.skills.length],
    ["governance", "Governance", state.governance.changes.length],
  ];
  const sectionContent = section === "agents"
    ? renderAgentProfileManager()
    : section === "mcp"
      ? renderMcpServerManager()
    : section === "skills"
      ? renderSkillManager()
      : section === "governance"
        ? renderGovernancePanel(true)
        : renderProviderConnectionManager();
  return `
    <section class="panel registry-manager-panel">
      <div class="registry-section-bar">
        <nav class="registry-section-tabs" role="tablist" aria-label="Registry sections">
          ${tabs.map(([id, label, count]) => `
            <button class="registry-section-tab ${section === id ? "active" : ""}" data-action="select-registry-section" data-section="${id}" role="tab" aria-selected="${section === id}">
              <span>${label}</span><small>${count}</small>
            </button>
          `).join("")}
        </nav>
        <div class="registry-section-actions">
          <button class="secondary" data-action="open-studio-setup">Setup</button>
          <button class="secondary" data-action="refresh-registry" ${state.registryLoading ? "disabled" : ""}>${state.registryLoading ? "Refreshing..." : "Refresh"}</button>
        </div>
      </div>
      <div class="registry-section-content">
        ${sectionContent}
      </div>
    </section>
  `;
}

function renderPlannerCandidate(candidate) {
  const selected = candidate.template_id === state.planner.templateId;
  const evidenceLines = summarizeTemplateEvidence(candidate);
  const evidenceChips = buildPlannerEvidenceChips(templateEvidenceChips(candidate));
  return `
    <button class="planner-candidate ${selected ? "selected" : ""}" data-action="select-planner-template" data-id="${escapeHtml(candidate.template_id)}">
      <span>
        <strong>${escapeHtml(candidate.name)}</strong>
        <small>${escapeHtml(candidate.template_id)}</small>
        <small>${escapeHtml(candidate.reason || "No recommendation summary.")}</small>
        ${evidenceChips}
        ${evidenceLines.map((line) => `<small>${escapeHtml(line)}</small>`).join("")}
      </span>
      <span class="badge ${candidate.score > 0 ? "success" : "warn"}">${candidate.score.toFixed(2)}</span>
    </button>
  `;
}

function renderRegistryRecommendation(recommendation, index) {
  const evidenceLines = summarizeRegistryRecommendationEvidence(recommendation);
  const evidenceChips = buildPlannerEvidenceChips(registryEvidenceChips(recommendation));
  return `
    <div class="mini-node">
      <strong>${index + 1}. ${escapeHtml(recommendation.node_name)}</strong>
      <small>Agent: ${escapeHtml(recommendation.agent_profile_id || "needs assignment")}</small>
      <small>Runtime: ${escapeHtml(runtimeAgentRefOf(recommendation) || "unbound")}</small>
      <small>Skills: ${escapeHtml((recommendation.skill_ids || []).join(", ") || "none")}</small>
      <small>Score ${Number(recommendation.score || 0).toFixed(2)} / ${escapeHtml(recommendation.reason || "No reason")}</small>
      ${evidenceChips}
      ${evidenceLines.map((line) => `<small>${escapeHtml(line)}</small>`).join("")}
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

function formatPlannerScore(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : null;
}

function formatPlannerPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : null;
}

function formatPlannerDomainLabel(domainId) {
  const labels = {
    coding: "Software engineering",
    research: "Research and analysis",
    content: "Content and creative",
    ops: "Operations and automation",
    customer: "Customer and follow-up",
    review: "Approval and review",
  };
  return labels[domainId] || domainId;
}

function formatPlannerDomainList(domainIds, limit = 2) {
  if (!Array.isArray(domainIds)) {
    return "";
  }
  return domainIds
    .filter((domainId) => typeof domainId === "string" && domainId.trim())
    .slice(0, limit)
    .map((domainId) => formatPlannerDomainLabel(domainId.trim()))
    .join(", ");
}

function buildPlannerEvidenceChips(items) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) {
    return "";
  }
  return `<div class="skill-chip-list planner-evidence-chip-list">${values
    .map(
      (item) =>
        `<span class="skill-chip ${escapeHtml(item.tone || "neutral")}">${escapeHtml(item.label || "Evidence")}</span>`,
    )
    .join("")}</div>`;
}

function templateEvidenceChips(candidate) {
  const evidence = candidate?.evidence || {};
  const chips = [];
  if (Array.isArray(candidate?.matched_terms) && candidate.matched_terms.length) {
    chips.push({ tone: "success", label: `${candidate.matched_terms.length} term match` });
  }
  if (Array.isArray(evidence.matched_domains) && evidence.matched_domains.length) {
    chips.push({ tone: "neutral", label: `Domain: ${formatPlannerDomainList(evidence.matched_domains)}` });
  }
  if (evidence.metadata_domain_match) {
    chips.push({ tone: "success", label: "Metadata domain" });
  }
  return chips;
}

function summarizeTemplateEvidence(candidate) {
  const evidence = candidate?.evidence || {};
  const lines = [];
  const coverage = formatPlannerPercent(evidence.coverage_score);
  const density = formatPlannerPercent(evidence.density_score);
  const readiness = formatPlannerPercent(evidence.registry_readiness_score);
  const domain = formatPlannerPercent(evidence.domain_overlap_score);

  if (coverage || density || readiness) {
    lines.push(
      [
        coverage ? `Coverage ${coverage}` : null,
        density ? `density ${density}` : null,
        readiness ? `registry readiness ${readiness}` : null,
      ]
        .filter(Boolean)
        .join(" / "),
    );
  }
  if (domain) {
    lines.push(`Domain overlap ${domain}`);
  }
  return lines;
}

function registryEvidenceChips(recommendation) {
  const evidence = recommendation?.evidence || {};
  const chips = [];
  if (Array.isArray(evidence.coverage_domains) && evidence.coverage_domains.length) {
    chips.push({ tone: "success", label: `Coverage: ${formatPlannerDomainList(evidence.coverage_domains)}` });
  }
  if (Array.isArray(evidence.matched_domains) && evidence.matched_domains.length) {
    chips.push({ tone: "neutral", label: `Domain: ${formatPlannerDomainList(evidence.matched_domains)}` });
  }
  if (typeof evidence.preferred_rank === "number") {
    chips.push({ tone: "success", label: `Preferred #${evidence.preferred_rank + 1}` });
  }
  if ((evidence.disallowed_penalty || 0) > 0) {
    chips.push({ tone: "warn", label: "Disallowed filtered" });
  }
  return chips;
}

function summarizeRegistryRecommendationEvidence(recommendation) {
  const evidence = recommendation?.evidence || {};
  const lines = [];
  const policy = formatPlannerScore(evidence.policy_score);
  const tokenFit = formatPlannerScore(evidence.profile_token_score);
  const skillFit = formatPlannerScore(evidence.skill_score);
  const readiness = formatPlannerScore(evidence.readiness_score);
  const domain = formatPlannerScore(evidence.domain_overlap_score);
  const coverageDomains = formatPlannerDomainList(evidence.coverage_domains, 4);

  if (policy || tokenFit || skillFit || readiness) {
    lines.push(
      [
        policy ? `Policy ${policy}` : null,
        tokenFit ? `token fit ${tokenFit}` : null,
        skillFit ? `skill fit ${skillFit}` : null,
        readiness ? `readiness ${readiness}` : null,
      ]
        .filter(Boolean)
        .join(" / "),
    );
  }
  if (domain) {
    lines.push(`Domain overlap ${domain}`);
  }
  if (coverageDomains) {
    lines.push(`Coverage fill: ${coverageDomains}`);
  }
  if (Array.isArray(recommendation?.allowed_tools) && recommendation.allowed_tools.length) {
    lines.push(`Tools: ${recommendation.allowed_tools.join(", ")}`);
  }
  return lines;
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
                                 <small>Runtime: ${escapeHtml(runtimeAgentRefOf(node) || "unbound")}</small>
                                 <small>Skills: ${escapeHtml((node.allowed_skills || []).join(", ") || "none")}</small>
                                 <small>Source: ${escapeHtml(node.registry_provenance?.agent_profile_source || "unknown")} / Runtime ${escapeHtml(node.registry_provenance?.runtime_agent_ref_source || node.registry_provenance?.openclaw_agent_id_source || "unknown")}</small>
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

// Form-backed graph canvas model: the node and edge forms remain the source of truth.
function buildAuthoringGraphModel(editor = state.editor) {
  const sourceNodes = Array.isArray(editor.nodes) ? editor.nodes : [];
  const sourceEdges = Array.isArray(editor.edges) ? editor.edges : [];
  const firstIndexById = new Map();
  sourceNodes.forEach((node, index) => {
    const id = String(node?.id || "").trim();
    if (id && !firstIndexById.has(id)) firstIndexById.set(id, index);
  });

  const layoutNodeIds = sourceNodes.map((_, index) => `authoring-node-${index}`);
  const normalizedEdges = sourceEdges.map((edge, index) => {
    const from = String(edge?.from || "").trim();
    const to = String(edge?.to || "").trim();
    const fromIndex = firstIndexById.has(from) ? firstIndexById.get(from) : -1;
    const toIndex = firstIndexById.has(to) ? firstIndexById.get(to) : -1;
    const valid = fromIndex >= 0 && toIndex >= 0;
    return {
      index,
      from,
      to,
      fromIndex,
      toIndex,
      label: edge?.label || (typeof edge?.condition === "string" ? edge.condition : edge?.condition ? "conditional" : ""),
      valid,
      reason: !from || !to ? "missing endpoint" : fromIndex < 0 ? "source missing" : toIndex < 0 ? "target missing" : "",
    };
  });

  const inboundCount = new Map(sourceNodes.map((_, index) => [index, 0]));
  const outboundCount = new Map(sourceNodes.map((_, index) => [index, 0]));
  for (const edge of normalizedEdges) {
    if (!edge.valid) continue;
    outboundCount.set(edge.fromIndex, (outboundCount.get(edge.fromIndex) || 0) + 1);
    inboundCount.set(edge.toIndex, (inboundCount.get(edge.toIndex) || 0) + 1);
  }
  const layout = buildDagLayout(
    sourceNodes.map((_, index) => ({ id: layoutNodeIds[index], order: index, width: 188, height: 98 })),
    normalizedEdges
      .filter((edge) => edge.valid)
      .map((edge) => ({ id: `authoring-edge-${edge.index}`, from: layoutNodeIds[edge.fromIndex], to: layoutNodeIds[edge.toIndex] })),
    { paddingX: 24, paddingY: 24, columnGap: 36, rowGap: 24, minWidth: 720, minHeight: 260 },
  );
  const layoutNodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const layoutEdgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const savedPositions = getAuthoringPositions(editor);
  const nodes = sourceNodes.map((node, index) => {
    const positioned = layoutNodeById.get(layoutNodeIds[index]);
    const savedPosition = savedPositions[String(node?.id || "")];
    const outputContract =
      node?.config?.output_contract && typeof node.config.output_contract === "object"
        ? node.config.output_contract
        : {};
    const expectedArtifacts = Array.isArray(outputContract.expected_artifacts)
      ? outputContract.expected_artifacts
      : [];
    const skills = Array.isArray(node?.allowed_skills) ? node.allowed_skills : [];
    return {
      index,
      id: String(node?.id || `node_${index + 1}`),
      label: node?.name || node?.id || `Node ${index + 1}`,
      type: node?.type || "agent_task",
      tone: node?.type === "end" ? "success" : node?.approval_kind ? "warn" : "neutral",
      agent: node?.agent_profile || "",
      skillCount: skills.length,
      skillsPreview: skills.slice(0, 2).join(", "),
      approvalKind: node?.approval_kind || "",
      parallelism: Number(node?.parallelism || 1),
      timeout: Number(node?.timeout_seconds || 0),
      outputCount: expectedArtifacts.length,
      inboundCount: inboundCount.get(index) || 0,
      outboundCount: outboundCount.get(index) || 0,
      column: positioned?.column || 0,
      row: positioned?.row || 0,
      x: Number.isFinite(savedPosition?.x) ? Math.max(8, savedPosition.x) : positioned?.x || 24,
      y: Number.isFinite(savedPosition?.y) ? Math.max(8, savedPosition.y) : positioned?.y || 24,
      invalid: positioned?.invalid || false,
    };
  });

  const edges = normalizedEdges.map((edge) => {
    const fromNode = nodes[edge.fromIndex];
    const toNode = nodes[edge.toIndex];
    const positioned = layoutEdgeById.get(`authoring-edge-${edge.index}`);
    return {
      ...edge,
      fromLabel: fromNode?.label || edge.from || "missing source",
      toLabel: toNode?.label || edge.to || "missing target",
      fromX: fromNode ? fromNode.x + 188 : positioned?.fromX || 0,
      fromY: fromNode ? fromNode.y + 49 : positioned?.fromY || 0,
      toX: toNode ? toNode.x : positioned?.toX || 0,
      toY: toNode ? toNode.y + 49 : positioned?.toY || 0,
    };
  });
  return {
    nodes,
    edges,
    width: Math.max(layout.width, ...nodes.map((node) => node.x + 220)),
    height: Math.max(layout.height, ...nodes.map((node) => node.y + 130)),
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      invalidEdgeCount: edges.filter((edge) => !edge.valid).length,
      startCount: nodes.filter((node) => node.inboundCount === 0).length,
      endCount: nodes.filter((node) => node.outboundCount === 0).length,
    },
  };
}

function renderAuthoringGraphNode(node, selection) {
  const selected = selection?.type === "node" && selection.index === node.index;
  const markers = [
    node.approvalKind ? `approval: ${node.approvalKind}` : null,
    node.outputCount ? `${node.outputCount} output${node.outputCount === 1 ? "" : "s"}` : null,
    node.parallelism > 1 ? `parallel ${node.parallelism}` : null,
    node.timeout ? `${node.timeout}s` : null,
  ].filter(Boolean);
  return `
    <div class="authoring-graph-node tone-${node.tone} ${selected ? "selected" : ""}" style="left: ${node.x}px; top: ${node.y}px;" data-action="select-authoring-node" data-index="${node.index}" data-node-id="${escapeHtml(node.id)}" tabindex="0">
      <button class="authoring-port authoring-port-in" data-action="authoring-port-in" data-index="${node.index}" title="Connect incoming edge" aria-label="Connect incoming edge"></button>
      <span class="authoring-graph-node-head">
        <span class="authoring-graph-node-index">${node.index + 1}</span>
        <span class="authoring-graph-node-title">
          <strong>${escapeHtml(node.label)}</strong>
          <small>${escapeHtml(node.id)}</small>
        </span>
      </span>
      <span class="authoring-graph-node-meta">
        <span>${escapeHtml(node.type)}</span>
        <span>${escapeHtml(node.agent || "no-agent")}</span>
        <span>${escapeHtml(node.skillsPreview || `${node.skillCount} skills`)}</span>
      </span>
      ${
        markers.length
          ? `<span class="authoring-graph-node-markers">${markers
              .map((marker) => `<span>${escapeHtml(marker)}</span>`)
              .join("")}</span>`
          : ""
      }
      <button class="authoring-port authoring-port-out" data-action="authoring-port-out" data-index="${node.index}" title="Connect outgoing edge" aria-label="Connect outgoing edge"></button>
    </div>
  `;
}

function renderAuthoringGraphEdgePath(edge, selection) {
  if (!edge.valid) return "";
  const selected = selection?.type === "edge" && selection.index === edge.index;
  const bend = Math.max(edge.fromX + 36, edge.toX - 36);
  const path = `M ${edge.fromX} ${edge.fromY} C ${bend} ${edge.fromY}, ${bend} ${edge.toY}, ${edge.toX} ${edge.toY}`;
  return `<path class="authoring-graph-line ${selected ? "selected" : ""}" data-action="select-authoring-edge" data-index="${edge.index}" d="${path}"></path>`;
}

function renderAuthoringGraphEdge(edge, selection) {
  const selected = selection?.type === "edge" && selection.index === edge.index;
  const label = edge.label || (edge.valid ? "transition" : edge.reason);
  return `
    <button class="authoring-graph-edge ${edge.valid ? "" : "invalid"} ${selected ? "selected" : ""}" data-action="select-authoring-edge" data-index="${edge.index}">
      <strong>${escapeHtml(`${edge.fromLabel} -> ${edge.toLabel}`)}</strong>
      <small>${escapeHtml(label)}</small>
    </button>
  `;
}

function renderAuthoringGraphCanvas(readOnly) {
  const model = buildAuthoringGraphModel();
  const selection = state.ui.authoringGraphSelection;
  const validation = validateGraphTopology(state.editor);
  const patch = buildGraphPatchPreview(authoringGraphSavedSnapshot, authoringGraphSnapshot());
  const patchCount = patch.nodes_added.length + patch.nodes_removed.length + patch.nodes_changed.length + patch.edges_added.length + patch.edges_removed.length + (patch.layout_changed ? 1 : 0);
  const invalidBadge = validation.errors.length
    ? `<span class="badge danger">${validation.errors.length} invalid</span>`
    : '<span class="badge success">valid links</span>';
  return `
    <section class="panel graph-panel authoring-graph-canvas-panel">
      <div class="panel-header">
        <div>
          <h3>Graph Canvas</h3>
          <p>${model.stats.nodeCount} nodes, ${model.stats.edgeCount} edges, ${model.stats.startCount} starts, ${model.stats.endCount} exits.</p>
        </div>
        <div class="actions">
          ${invalidBadge}
          <span class="badge neutral">${patchCount} changes</span>
          <button class="icon-button" data-action="undo-authoring" title="Undo" ${readOnly || !authoringGraphHistory.undo.length ? "disabled" : ""}>↶</button>
          <button class="icon-button" data-action="redo-authoring" title="Redo" ${readOnly || !authoringGraphHistory.redo.length ? "disabled" : ""}>↷</button>
          <button class="secondary" data-action="add-node" ${readOnly ? "disabled" : ""}>Add node</button>
          <button class="secondary" data-action="add-edge" ${readOnly ? "disabled" : ""}>Add edge</button>
        </div>
      </div>
      <div class="authoring-graph-workbench">
        <div class="authoring-graph-canvas">
          <div class="authoring-graph-surface" style="width: ${model.width}px; height: ${model.height}px;">
            <svg class="authoring-graph-lines" viewBox="0 0 ${model.width} ${model.height}" aria-hidden="true">
              ${model.edges.map((edge) => renderAuthoringGraphEdgePath(edge, selection)).join("")}
            </svg>
            ${model.nodes.map((node) => renderAuthoringGraphNode(node, selection)).join("")}
          </div>
        </div>
        <div class="authoring-graph-edge-list">
          ${
            model.edges.length
              ? model.edges.map((edge) => renderAuthoringGraphEdge(edge, selection)).join("")
              : '<p class="muted">No edges configured.</p>'
          }
        </div>
      </div>
      <div class="authoring-graph-review-strip">
        <div><strong>Patch preview</strong><small>+${patch.nodes_added.length} nodes, -${patch.nodes_removed.length} nodes, ~${patch.nodes_changed.length} nodes, +${patch.edges_added.length}/-${patch.edges_removed.length} edges${patch.layout_changed ? ", layout changed" : ""}</small></div>
        ${validation.errors.length ? `<ul>${validation.errors.slice(0, 4).map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")}</ul>` : '<span class="badge success">Topology valid</span>'}
      </div>
    </section>
  `;
}

function renderNode(node, index, readOnly) {
  const skills = node.allowed_skills.join(", ");
  const config = prettyJson(node.config);
  const humanInput = node.human_input_schema ? prettyJson(node.human_input_schema) : "";
  const selected = state.ui.authoringGraphSelection?.type === "node" && state.ui.authoringGraphSelection.index === index;
  return `
    <article class="node-card ${selected ? "authoring-form-selected" : ""}" data-authoring-node-index="${index}">
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
  const selected = state.ui.authoringGraphSelection?.type === "edge" && state.ui.authoringGraphSelection.index === index;
  return `
    <article class="edge-card ${selected ? "authoring-form-selected" : ""}" data-authoring-edge-index="${index}">
      <select data-field="edge.from" data-index="${index}" ${readOnly ? "disabled" : ""}>${options}</select>
      <input value="${escapeHtml(edge.from_port || "")}" placeholder="From port" data-field="edge.from_port" data-index="${index}" ${readOnly ? "disabled" : ""} />
      <span>to</span>
      <select data-field="edge.to" data-index="${index}" ${readOnly ? "disabled" : ""}>${toOptions}</select>
      <input value="${escapeHtml(edge.to_port || "")}" placeholder="To port" data-field="edge.to_port" data-index="${index}" ${readOnly ? "disabled" : ""} />
      <input value="${escapeHtml(edge.label || "")}" placeholder="Label" data-field="edge.label" data-index="${index}" ${readOnly ? "disabled" : ""} />
      <textarea class="code" rows="2" placeholder="Condition JSON" data-field="edge.condition" data-index="${index}" ${readOnly ? "disabled" : ""}>${escapeHtml(edge.condition ? prettyJson(edge.condition) : "")}</textarea>
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
    ${renderAuthoringGraphCanvas(readOnly)}

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
  const registeredAdapters = Array.isArray(runtime?.registered_adapter_kinds)
    ? runtime.registered_adapter_kinds
    : [];
  const readyCount = hostedProfiles.filter((profile) => profile.health?.status === "ready").length;
  const needsBindingCount = hostedProfiles.filter((profile) => profile.health?.status === "needs_binding").length;

  return `
    <div class="agent-hosting-workspace">
      <section class="panel agent-hosting-panel">
        <div class="panel-header">
          <div><h3>Subagent Hosting</h3><p>Runtime ownership with My Mate registry bindings.</p></div>
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
            <p>${escapeHtml(getRuntimeExecutionLabel(runtime))}</p>
          </div>
          <div class="summary-stat">
            <strong>Adapters</strong>
            <p>${escapeHtml(registeredAdapters.join(", ") || "none")}</p>
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
                          <p>${escapeHtml(profile.name)} / ${escapeHtml(runtimeAgentRefOf(profile) || "unbound")}</p>
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
  const capacity = runtime?.node_provisioner?.capacity || null;
  const recovery = runtime?.node_provisioner?.recovery || null;
  const hosting = state.runtimeSummary?.agent_hosting || null;
  const planner = state.runtimeSummary?.planner || null;
  const registry = state.runtimeSummary?.registry || null;
  const hostedProfiles = hosting?.profiles || [];
  const identity = state.security.identity;
  const canManageMembers = identity?.permissions?.includes("workspace.manage_members") === true;
  const workspace = identity?.selected_workspace || null;

  return `
    <section class="panel settings-panel">
      <div class="panel-header">
        <div><h3>Desktop Settings</h3><p>Separate runtime, planner, and registry ownership instead of mixing them into one page.</p></div>
        <button class="secondary" data-action="refresh-runtime" ${state.runtimeLoading ? "disabled" : ""}>${state.runtimeLoading ? "Refreshing..." : "Refresh runtime"}</button>
      </div>
      <div class="settings-grid">
        <section class="subpanel span-2 security-console" data-security-console="true">
          <div class="subpanel-header">
            <div>
              <strong>Identity And Workspace</strong>
              <p>${escapeHtml(identity ? `${identity.principal.display_name} (${identity.principal.principal_id})` : "Identity unavailable")}</p>
            </div>
            <span class="badge ${identity ? "success" : "danger"}">${escapeHtml(workspace?.role || "signed out")}</span>
          </div>
          <div class="security-auth-row">
            <label class="field grow"><span>API Token</span><input type="password" data-field="security.apiKey" value="${escapeHtml(state.security.apiKey)}" autocomplete="off" /></label>
            <button class="secondary" data-action="save-security-settings">Save token</button>
            <button class="icon-button" data-action="refresh-security" title="Refresh identity" aria-label="Refresh identity">Ref</button>
          </div>
          <div class="workspace-segments" role="tablist" aria-label="Workspace">
            ${(identity?.available_workspaces || []).map((membership) => `
              <button
                class="workspace-segment ${membership.workspace_id === workspace?.workspace_id ? "selected" : ""}"
                data-action="select-security-workspace"
                data-workspace-id="${escapeHtml(membership.workspace_id)}"
                role="tab"
                aria-selected="${membership.workspace_id === workspace?.workspace_id ? "true" : "false"}"
              >${escapeHtml(membership.workspace_name)} <small>${escapeHtml(membership.role)}</small></button>
            `).join("") || '<span class="muted">No workspace memberships.</span>'}
          </div>
        </section>
        <section class="subpanel span-2 security-members" data-security-members="true">
          <div class="subpanel-header">
            <strong>Workspace Members</strong>
            <span class="badge neutral">${escapeHtml(String(state.security.members.length))} members</span>
          </div>
          <div class="security-member-list">
            ${state.security.members.map((member) => `
              <div class="security-member-row">
                <div><strong>${escapeHtml(member.display_name)}</strong><small>${escapeHtml(member.principal_id)} / ${escapeHtml(member.status)}</small></div>
                <div class="role-segments" role="group" aria-label="Role for ${escapeHtml(member.display_name)}">
                  ${["owner", "admin", "operator", "viewer"].map((role) => `
                    <button class="role-segment ${member.role === role ? "selected" : ""}" data-action="set-security-member-role" data-principal-id="${escapeHtml(member.principal_id)}" data-role="${role}" ${canManageMembers ? "" : "disabled"}>${role}</button>
                  `).join("")}
                </div>
              </div>
            `).join("") || '<p class="muted">No members in this workspace.</p>'}
          </div>
        </section>
        <section class="subpanel span-2 security-audit" data-security-audit="true">
          <div class="subpanel-header">
            <strong>Security Audit</strong>
            <span class="badge ${state.security.auditChainVerified ? "success" : "danger"}">${state.security.auditChainVerified ? "Chain verified" : "Chain unverified"}</span>
          </div>
          <div class="security-audit-list">
            ${state.security.auditEvents.slice(0, 30).map((event) => `
              <div class="security-audit-row">
                <span class="status-dot ${event.outcome === "allowed" ? "success" : event.outcome === "denied" ? "danger" : "warn"}"></span>
                <div><strong>${escapeHtml(event.action)}</strong><small>${escapeHtml(event.principal_id)} / ${escapeHtml(new Date(event.created_at).toLocaleString())}</small></div>
                <span class="badge ${event.outcome === "allowed" ? "success" : event.outcome === "denied" ? "danger" : "warn"}">${escapeHtml(event.outcome)}</span>
              </div>
            `).join("") || '<p class="muted">No security audit events.</p>'}
          </div>
        </section>
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
                            <p>${escapeHtml(profile.name)} / ${escapeHtml(runtimeAgentRefOf(profile) || "unbound")}</p>
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
            <div><strong>Dispatcher</strong><span>${escapeHtml(getRuntimeExecutionLabel(runtime))}</span></div>
            <div><strong>Adapter</strong><span>${escapeHtml(runtime?.adapter_kind || "unknown")}</span></div>
            <div><strong>Bridge Mode</strong><span>${escapeHtml(runtime?.bridge_execution_mode || "n/a")}</span></div>
            <div><strong>Health</strong><span>${escapeHtml(runtime?.runtime_health?.status || "unknown")}</span></div>
            <div><strong>Detail</strong><span>${escapeHtml(runtime?.runtime_health?.detail || "No runtime detail.")}</span></div>
            <div><strong>Workers</strong><span>${escapeHtml(formatRuntimeCapacityValue(capacity?.active_workers, capacity?.max_concurrent_workers))}</span></div>
            <div><strong>Queue</strong><span>${escapeHtml(formatRuntimeCapacityValue(capacity?.queue_depth, capacity?.queue_limit))}</span></div>
            <div><strong>Queue Timeout</strong><span>${escapeHtml(formatRuntimeQueueTimeout(capacity?.queue_timeout_ms))}</span></div>
            <div><strong>Cleanup</strong><span>${escapeHtml(`${recovery?.cleanup_pending ?? 0} pending / ${recovery?.cleanup_failed ?? 0} failed`)}</span></div>
            <div><strong>Reconciliation</strong><span>${escapeHtml(`${recovery?.last_reconciliation_status || "not run"}${recovery?.last_reconciliation_at ? ` at ${recovery.last_reconciliation_at}` : ""}`)}</span></div>
            <div><strong>Containers</strong><span>${escapeHtml(`${recovery?.discovered_containers ?? 0} found / ${recovery?.removed_containers ?? 0} removed / ${recovery?.orphan_containers ?? 0} orphaned`)}</span></div>
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

function renderWorkspaceTaskItem(mission) {
  const labels = getTaskInventoryLabels(mission);
  const moving = mission.session_id === state.ui.taskMoveSessionId;
  return `
    <button class="workspace-task-item ${mission.session_id === state.selectedSessionId ? "selected" : ""} ${moving ? "moving" : ""}" type="button" draggable="${moving ? "false" : "true"}" data-action="select-session" data-id="${escapeHtml(mission.session_id)}" data-session-id="${escapeHtml(mission.session_id)}" data-workspace-task-drag-session-id="${escapeHtml(mission.session_id)}" ${moving ? 'aria-busy="true"' : ""}>
      <span class="status-dot ${escapeHtml(labels.tone)}"></span>
      <span>
        <strong>${escapeHtml(labels.title)}</strong>
        <small>${escapeHtml(moving ? "Moving to Workspace..." : labels.subtitle)}</small>
      </span>
    </button>
  `;
}

function renderWorkspaceCreator() {
  if (!state.ui.workspaceCreatorOpen) return "";
  return `
    <div class="workspace-modal-backdrop">
      <section class="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title" aria-describedby="workspace-modal-description">
        <header class="workspace-modal-header">
          <div>
            <h3 id="workspace-modal-title">Add Workspace</h3>
            <p id="workspace-modal-description">Connect an existing project folder or create a new one.</p>
          </div>
          <button class="icon-button" type="button" data-action="close-workspace-creator" title="Close" aria-label="Close Workspace dialog">&#10005;</button>
        </header>
        <div class="workspace-modal-body">
          ${state.desktop.error ? `<div class="alert danger">${escapeHtml(state.desktop.error)}</div>` : ""}
          <button class="workspace-folder-command" type="button" data-action="add-sidebar-workspace" ${state.desktop.loading ? "disabled" : ""}>
            <span class="workspace-folder-command-icon" aria-hidden="true">&#128193;</span>
            <span><strong>Add existing folder</strong><small>Choose a folder already on this computer</small></span>
            <span class="workspace-folder-command-arrow" aria-hidden="true">&#8250;</span>
          </button>
          <div class="workspace-modal-divider"><span>Create new</span></div>
          <div class="workspace-modal-form">
            <label><span class="workspace-field-label">Folder name</span><input data-workspace-creator-initial="true" data-field="desktop.projectName" value="${escapeHtml(state.desktop.projectDraft.name)}" placeholder="my-project" autocomplete="off" /></label>
            <label><span class="workspace-field-label">Description <small>(optional)</small></span><input data-field="desktop.projectDescription" value="${escapeHtml(state.desktop.projectDraft.description)}" placeholder="Project purpose" /></label>
            <label><span class="workspace-field-label">Output folder</span><input data-field="desktop.outputRelativePath" value="${escapeHtml(state.desktop.projectDraft.outputRelativePath)}" placeholder="outputs" /></label>
          </div>
        </div>
        <footer class="workspace-modal-footer">
          <button class="secondary" type="button" data-action="close-workspace-creator">Cancel</button>
          <button class="primary" type="button" data-action="create-sidebar-project" ${state.desktop.loading || !state.desktop.projectDraft.name.trim() ? "disabled" : ""}>${state.desktop.loading ? "Working..." : "Create Workspace"}</button>
        </footer>
      </section>
    </div>
  `;
}

function renderDesktopWorkspaceTree() {
  const query = state.ui.taskSidebarQuery.trim();
  const { groups: projectGroups, unassigned: unassignedTasks } = groupWorkspaceTasks({
    projects: state.desktop.projects,
    missions: state.missions,
    sessions: state.sessions,
    query,
  });
  return `
    <section class="sidebar-panel workspace-tree-panel">
      <div class="sidebar-panel-header workspace-tree-header">
        <strong>Workspaces</strong>
        <button class="icon-button" type="button" data-action="open-workspace-creator" title="Add Workspace" aria-label="Add Workspace">+</button>
      </div>
      <div class="workspace-tree-search">
        <input value="${escapeHtml(state.ui.taskSidebarQuery)}" data-field="desktop.taskSidebarQuery" placeholder="Search workspaces or tasks" />
      </div>
      ${state.desktop.error ? `<p class="desktop-local-error workspace-tree-error">${escapeHtml(state.desktop.error)}</p>` : ""}
      <div class="workspace-tree-list">
        ${projectGroups.map(({ project, tasks }) => `
          <section class="workspace-tree-project ${project.active ? "active" : ""} ${state.ui.taskMoveProjectId === project.projectId ? "receiving-task" : ""}" data-workspace-drop-project-id="${escapeHtml(project.projectId)}">
            <div class="workspace-project-row">
              <button class="workspace-project-select" type="button" data-action="select-sidebar-project" data-project-id="${escapeHtml(project.projectId)}" data-registered-project-id="${escapeHtml(project.registeredProjectId || "")}">
                <span class="workspace-folder-icon" aria-hidden="true">&#128193;</span>
                <span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.rootPath)}</small></span>
              </button>
              <button class="icon-button workspace-project-archive" type="button" data-action="archive-desktop-project" data-project-id="${escapeHtml(project.projectId)}" title="Archive Workspace reference" aria-label="Archive ${escapeHtml(project.name)}">&#128451;</button>
            </div>
            <div class="workspace-task-children">
              ${project.active ? `<button class="workspace-new-task" type="button" data-action="new-task" data-project-id="${escapeHtml(project.projectId)}"><span aria-hidden="true">+</span> New task</button>` : ""}
              ${tasks.length ? tasks.map(renderWorkspaceTaskItem).join("") : `<p class="workspace-tree-empty">${query ? "No matching tasks" : "No tasks yet"}</p>`}
            </div>
          </section>
        `).join("")}
        ${!projectGroups.length && !unassignedTasks.length ? '<p class="sidebar-muted workspace-tree-empty-state">No Workspaces yet. Add a folder to start.</p>' : ""}
        ${unassignedTasks.length ? `
          <section class="workspace-tree-project unassigned">
            <div class="workspace-unassigned-heading"><strong>Unassigned tasks</strong><small>Created before Workspace grouping</small></div>
            <div class="workspace-task-children">${unassignedTasks.map(renderWorkspaceTaskItem).join("")}</div>
          </section>
        ` : ""}
      </div>
    </section>
  `;
}

function renderOrchestratorSidebarContent() {
  if (state.desktop.available) return `<div class="orchestrator-sidebar">${renderDesktopWorkspaceTree()}</div>`;
  const recent = state.missions.slice(0, 12);
  return `
    <div class="orchestrator-sidebar">
      <section class="sidebar-panel">
        <div class="sidebar-panel-header">
          <strong>Tasks</strong>
          ${state.selectedSessionId ? '<button class="mini-button" data-action="new-task">New</button>' : ""}
        </div>
        <div class="template-list">
          ${
            recent.length
              ? recent
                  .map((mission) => {
                    const labels = getTaskInventoryLabels(mission);
                    return `
                      <button class="template-item ${mission.session_id === state.selectedSessionId ? "selected" : ""}" data-action="select-session" data-id="${escapeHtml(mission.session_id)}" data-session-id="${escapeHtml(mission.session_id)}">
                        <span class="status-dot ${escapeHtml(labels.tone)}"></span>
                        <span>
                          <strong>${escapeHtml(labels.title)}</strong>
                          <small>${escapeHtml(labels.subtitle)}</small>
                        </span>
                      </button>
                    `;
                  })
                  .join("")
              : '<p class="sidebar-muted">No tasks yet.</p>'
          }
        </div>
      </section>
    </div>
  `;
}

function getVisibleOrchestratorMessages(messages) {
  const seen = new Set();
  return messages
    .filter((message) => message.role === "user" || message.role === "orchestrator")
    .filter((message) => {
      const text = getMessageText(message).trim();
      if (!text) return false;
      const key = `${message.role}:${text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-10);
}

function renderOrchestratorConversation(messages) {
  const visible = getVisibleOrchestratorMessages(messages);
  const activeSessionId = state.workspaceDetail?.session?.session_id || state.selectedSessionId || "";
  const stream = state.conversationStream?.sessionId === activeSessionId
    ? state.conversationStream
    : null;
  const latestVisibleUserText = [...visible]
    .reverse()
    .find((message) => message.role === "user")?.content?.text || "";
  const showOptimisticUser = !!stream?.userText && latestVisibleUserText !== stream.userText;
  return `
    <div class="orchestrator-chat-feed">
      ${visible.length ? visible
        .map((message) => {
          const role = message.role === "user" ? "user" : "orchestrator";
          const text = getMessageText(message) || message.kind;
          const source = message.content?.response_source || (role === "orchestrator" ? "legacy_local" : "");
          const sourceLabel = source === "provider"
            ? `${message.content?.model || "Model"} / ${message.content?.provider_connection_id || "Provider"}`
            : source === "deterministic_fallback"
              ? "Local fallback"
              : source === "legacy_local"
                ? "Legacy local reply"
                : "";
          const sourceDetail = source === "deterministic_fallback"
            ? message.content?.fallback_reason || "The selected model did not return a valid reply."
            : source === "provider"
              ? `${message.content?.protocol || "provider"} / requested ${message.content?.requested_model || message.content?.model || "model"} / returned ${message.content?.response_model || message.content?.model || "unknown"}`
              : source === "legacy_local"
                ? "This historical reply has no Provider evidence and was generated by the legacy local conversation path."
                : "";
          return `
            <article class="orchestrator-message ${role}">
              <header><span>${escapeHtml(role === "user" ? "You" : "My Mate")}</span>${role === "orchestrator" && sourceLabel ? `<small class="conversation-source ${source === "provider" ? "provider" : "fallback"}" title="${escapeHtml(sourceDetail)}">${escapeHtml(sourceLabel)}</small>` : ""}</header>
              ${role === "orchestrator" ? `<div class="conversation-markdown">${renderMarkdown(text)}</div>` : `<p>${escapeHtml(text)}</p>`}
            </article>
          `;
        })
        .join("") : '<p class="muted conversation-empty">Start by describing the outcome. My Mate will respond here.</p>'}
      ${showOptimisticUser ? `<article class="orchestrator-message user pending"><header><span>You</span></header><p>${escapeHtml(stream.userText)}</p></article>` : ""}
      ${stream ? `<article class="orchestrator-message orchestrator streaming" data-conversation-stream-id="${escapeHtml(stream.requestId)}"><header><span>My Mate</span><small class="conversation-source provider">${escapeHtml(stream.model || "Connecting...")}</small></header><div class="conversation-tool-progress-list" data-conversation-tool-progress>${(stream.toolProgress || []).map((progress) => `<div class="conversation-tool-progress ${escapeHtml(progress.status || "running")}" title="${escapeHtml(progress.actionId || "")}"><span class="status-dot ${progress.status === "succeeded" ? "success" : progress.status === "failed" ? "danger" : "warn"}"></span><span>${escapeHtml(progress.summary || progress.toolName || "Running tool")}</span></div>`).join("")}</div><div class="conversation-stream-body"><div class="conversation-markdown" data-conversation-stream-text>${renderMarkdown(stream.text)}</div><span class="conversation-stream-caret" aria-hidden="true"></span></div></article>` : ""}
    </div>
  `;
}

function renderProposalAssignmentEditor(node, index, recommendation) {
  const draft = getProposalNodeDraft(node, index);
  const recommendationText = recommendation
    ? `${recommendation.agent_profile_name || recommendation.agent_profile_id || "registry"} / score ${recommendation.score ?? "n/a"}`
    : "";
  const recommendationEvidenceChips = recommendation
    ? buildPlannerEvidenceChips(registryEvidenceChips(recommendation))
    : "";
  const recommendationEvidenceLines = recommendation
    ? summarizeRegistryRecommendationEvidence(recommendation)
    : [];
  return `
    <article class="orchestrator-node-card editable">
      <span>${escapeHtml(String(index + 1))}</span>
      <div class="proposal-node-editor">
        <div class="proposal-node-title">
          <strong>${escapeHtml(draft.name)}</strong>
          <small>${escapeHtml(draft.type)}${recommendationText ? ` / ${escapeHtml(recommendationText)}` : ""}</small>
        </div>
        ${
          recommendation
            ? `<div class="proposal-recommendation-block">
                <div class="proposal-recommendation-head">
                  <strong>${escapeHtml(recommendation.agent_profile_name || recommendation.agent_profile_id || "Registry recommendation")}</strong>
                  <span class="badge ${Number(recommendation.score || 0) > 0 ? "success" : "warn"}">${escapeHtml(formatPlannerScore(Number(recommendation.score || 0)) || "n/a")}</span>
                </div>
                <small>${escapeHtml(recommendation.reason || "No recommendation summary.")}</small>
                ${recommendationEvidenceChips}
                ${recommendationEvidenceLines.map((line) => `<small>${escapeHtml(line)}</small>`).join("")}
                ${
                  recommendation.warnings?.length
                    ? `<ul class="warning-list compact">${recommendation.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
                    : ""
                }
              </div>`
            : '<p class="muted">No registry recommendation was attached to this node draft.</p>'
        }
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

function buildTaskExperience(detail = state.workspaceDetail) {
  const modelVerified = state.providerConnections.some(
    (connection) => connection.status === "active" && connection.verification?.status === "verified",
  );
  const templatesAvailable = state.templates.some((template) => template.status === "published");
  const quality = deriveResultQuality(detail || {});
  const supervisionAlert = Array.isArray(detail?.supervision_alerts) ? detail.supervision_alerts[0] || null : null;
  const repair = supervisionAlert
    ? {
        kind: supervisionAlert.category,
        title: supervisionAlert.title,
        detail: supervisionAlert.detail,
        action: supervisionAlert.recommended_action,
        actionLabel: supervisionAlert.recommended_action_label,
      }
    : deriveRepairGuidance(detail || {}, { modelVerified, templatesAvailable });
  const taskAutonomyMode = normalizeAutonomyMode(
    detail?.autopilot?.mode || detail?.session?.metadata?.autonomy_mode || state.product.autonomyMode,
  );
  const guidance = deriveTaskGuidance(detail, {
    autonomyMode: taskAutonomyMode,
    quality,
    repair,
  });
  return {
    autonomyMode: taskAutonomyMode,
    autonomy: autonomyModeCopy(taskAutonomyMode),
    guidance,
    quality,
    repair,
    modelVerified,
    templatesAvailable,
    supervisionAlert,
    autopilot: detail?.autopilot || null,
    uiPlan: detail?.ui_plan || null,
    workspaceBinding: detail?.workspace_binding || null,
  };
}

function renderTaskGuidance(detail, experience = buildTaskExperience(detail)) {
  const guidance = experience.guidance;
  const signals = guidance.signals || [];
  const guidanceBusy = state.planning || isActionLoading("task-quality", getWorkspaceSelectedRunId(detail) || "");
  const workspaceAuthorizationFailure = [...(detail?.messages || [])]
    .reverse()
    .find((message) => message?.content?.error_code === "workspace_authorization_required");
  const workspaceAuthorizationNeeded =
    experience.autopilot?.pending_gate === "workspace_authorization" ||
    detail?.session?.metadata?.pending_gate === "workspace_authorization" ||
    (experience.workspaceBinding?.access === "snapshot-read" && !!workspaceAuthorizationFailure);
  return `
    <section class="task-guidance-panel task-guidance-${escapeHtml(guidance.phase)}" data-task-phase="${escapeHtml(guidance.phase)}">
      <div class="task-guidance-heading">
        <div>
          <span class="task-start-kicker">Current focus</span>
          <h3>${escapeHtml(guidance.title)}</h3>
          <p>${escapeHtml(guidance.detail)}</p>
        </div>
        <span class="badge ${escapeHtml(guidance.tone)}">${escapeHtml(guidance.statusLabel)}</span>
      </div>
      ${signals.length ? `<div class="task-guidance-signals">
        ${signals
          .slice(0, 3)
          .map(
            (signal) => `
              <div class="task-guidance-signal">
                <small>${escapeHtml(signal.label)}</small>
                <strong class="${escapeHtml(signal.tone)}">${escapeHtml(signal.value)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>` : ""}
      ${workspaceAuthorizationNeeded ? `<div class="task-autopilot-strip task-workspace-authorization-strip">
        <span><strong>Workspace authorization</strong><small>${escapeHtml(experience.autopilot?.handoff_reason || `Allow this task to edit an isolated copy of ${experience.workspaceBinding?.display_name || state.desktop.workspace?.name || "the selected project"}.`)}</small></span>
        <span class="badge warn">Required</span>
        <div class="task-autopilot-actions">
          ${state.desktop.workspace
            ? '<button class="primary" data-action="authorize-desktop-workspace-write">Allow sandbox edits</button>'
            : desktopHost
              ? '<button class="secondary" data-action="choose-desktop-workspace">Choose folder</button>'
              : '<span class="task-desktop-required" title="Open this task in My Mate Desktop to authorize a local folder.">Desktop required</span>'}
        </div>
      </div>` : ""}
      ${experience.autonomyMode === "autopilot" || (experience.autopilot && experience.autopilot.status !== "disabled") ? `<div class="task-autopilot-strip">
        <span><strong>Autopilot</strong><small>${escapeHtml(experience.autopilot?.last_detail || experience.autonomy.detail)}</small></span>
        <span class="badge ${statusTone(experience.autopilot?.status || "ready")}">${escapeHtml(experience.autopilot?.status || "ready")}</span>
        <div class="task-autopilot-actions">
          ${!experience.autopilot ? '<button class="secondary" data-action="task-autopilot-resume">Start Autopilot</button>' : ["paused", "blocked", "waiting_human", "failed"].includes(experience.autopilot.status) ? '<button class="secondary" data-action="task-autopilot-resume">Resume</button>' : '<button class="secondary" data-action="task-autopilot-pause">Pause</button>'}
          <button class="icon-button" data-action="task-autopilot-tick" title="Check task now">Ref</button>
        </div>
      </div>` : ""}
      ${guidance.primaryAction ? `<div class="task-guidance-actions">
        <button class="primary" data-action="${escapeHtml(guidance.primaryAction)}" ${guidanceBusy ? "disabled" : ""}>${guidanceBusy ? "Working..." : escapeHtml(guidance.primaryLabel)}</button>
      </div>` : ""}
    </section>
  `;
}

function renderTaskQuality(detail, experience = buildTaskExperience(detail)) {
  const quality = experience.quality;
  const runStatus = String(detail?.latest_run?.status || detail?.workspace_state?.run_status || "").toLowerCase();
  const shouldShow =
    ["completed", "succeeded", "success"].includes(runStatus) ||
    (detail?.runtime_scorecards || []).length > 0 ||
    (detail?.runtime_evaluations || []).length > 0;
  if (!shouldShow) return "";

  const scorecard = Array.isArray(detail?.runtime_scorecards) ? detail.runtime_scorecards.at(-1) : null;
  const evaluation = Array.isArray(detail?.runtime_evaluations) ? detail.runtime_evaluations.at(-1) : null;
  const checks = [
    ["Pipeline", scorecard?.pipeline_verdict || evaluation?.pipeline_verdict || "not checked"],
    ["Evidence", evaluation?.evidence_verdict || "not checked"],
    ["Quality", evaluation?.quality_verdict || "not checked"],
  ];

  return `
    <section class="task-quality-panel" data-workspace-focus="task-quality">
      <div class="task-quality-heading">
        <div><span class="task-start-kicker">Result quality</span><h3>${escapeHtml(quality.title)}</h3><p>${escapeHtml(quality.detail)}</p></div>
        <span class="badge ${escapeHtml(quality.tone)}">${escapeHtml(quality.label)}</span>
      </div>
      <div class="task-quality-checks">
        ${checks
          .map(
            ([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value).replaceAll("_", " "))}</strong></div>`,
          )
          .join("")}
      </div>
      ${quality.findings.length ? `<ul class="task-quality-findings">${quality.findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul>` : ""}
    </section>
  `;
}

function renderGeneratedDecisionQueue(detail) {
  const approvals = Array.isArray(detail?.pending_approvals) ? detail.pending_approvals.length : 0;
  const inputs = Array.isArray(detail?.pending_human_inputs) ? detail.pending_human_inputs.length : 0;
  if (!approvals && !inputs) return "";
  return `<section class="task-generated-band task-decision-band"><div><span class="task-start-kicker">Decision</span><h3>${escapeHtml(String(approvals + inputs))} item${approvals + inputs === 1 ? "" : "s"} need you</h3><p>${escapeHtml(`${approvals} approval${approvals === 1 ? "" : "s"} / ${inputs} input request${inputs === 1 ? "" : "s"}`)}</p></div><button class="primary" data-action="open-task-inbox">Review decision</button></section>`;
}

function renderGeneratedProgress(detail) {
  const run = detail?.latest_run;
  if (!run) return "";
  return `<section class="task-generated-band task-progress-band"><div><span class="task-start-kicker">Progress</span><h3>${escapeHtml(String(run.status || "working").replaceAll("_", " "))}</h3><p>${escapeHtml(run.current_summary || detail?.workspace_state?.latest_run_summary || "My Mate is supervising execution.")}</p></div><button class="secondary" data-action="view-task-progress">View progress</button></section>`;
}

function renderGeneratedRepair(experience) {
  const alert = experience.supervisionAlert;
  if (!alert) return "";
  const duplicatesPrimaryAction = experience.guidance?.primaryAction === alert.recommended_action;
  return `<section class="task-generated-band task-repair-band"><div><span class="task-start-kicker">Supervisor</span><h3>${escapeHtml(alert.title)}</h3><p>${escapeHtml(alert.detail)}</p><small>${escapeHtml(`Still active / checked ${formatWorkspaceTimestamp(alert.last_seen_at)}`)}</small></div><div class="task-generated-actions">${duplicatesPrimaryAction ? "" : `<button class="primary" data-action="${escapeHtml(alert.recommended_action)}">${escapeHtml(alert.recommended_action_label)}</button>`}<button class="secondary" data-action="resolve-supervision-alert" data-alert-id="${escapeHtml(alert.alert_id)}">Dismiss</button></div></section>`;
}

function recommendationStateLabel(item) {
  return {
    queued: "Next reply",
    kept: "Active in Task",
    applied: "Applied",
    dismissed: "Dismissed",
  }[item.application_state] || "Available";
}

function renderTaskMemoryRecommendationContent() {
  const recommendations = Array.isArray(state.memory.recommendations?.recommendations)
    ? state.memory.recommendations.recommendations.slice(0, 2)
    : [];
  if (!recommendations.length) return "";
  return recommendations.map((item) => {
    const overlay = activeOverlayForRecommendation(item);
    return `
    <article class="task-memory-recommendation" data-recommendation-id="${escapeHtml(item.recommendation_id)}">
      <div><span class="badge neutral">Memory</span><strong>${escapeHtml(item.summary)}</strong><small>${escapeHtml(item.reason)}</small></div>
      <div class="task-memory-actions">
        <span class="badge ${item.application_state === "available" ? "neutral" : "success"}">${escapeHtml(recommendationStateLabel(item))}</span>
        ${item.application_state === "available" ? `<button class="primary" data-action="memory-recommendation-action" data-memory-action="use_next_turn" data-recommendation-id="${escapeHtml(item.recommendation_id)}">Use next reply</button><button class="icon-button" data-action="memory-recommendation-action" data-memory-action="keep_for_session" data-recommendation-id="${escapeHtml(item.recommendation_id)}" title="Keep for this Task" aria-label="Keep for this Task">+</button><button class="icon-button" data-action="memory-recommendation-action" data-memory-action="dismiss_for_session" data-recommendation-id="${escapeHtml(item.recommendation_id)}" title="Dismiss for this Task" aria-label="Dismiss for this Task">&#10005;</button>` : overlay ? `<button class="icon-button" data-action="remove-memory-overlay" data-overlay-id="${escapeHtml(overlay.overlay_id)}" data-recommendation-id="${escapeHtml(item.recommendation_id)}" title="Remove from this Task" aria-label="Remove from this Task">&#10005;</button>` : ""}
      </div>
    </article>`;
  }).join("");
}

function renderMemoryRecommendationListContent() {
  const recommendations = Array.isArray(state.memory.recommendations?.recommendations)
    ? state.memory.recommendations.recommendations
    : [];
  return recommendations.map((item) => {
    const overlay = activeOverlayForRecommendation(item);
    return `<article class="memory-recommendation-row" data-recommendation-id="${escapeHtml(item.recommendation_id)}">
    <div><div class="memory-record-meta"><span class="badge ${item.sensitivity === "private" ? "warn" : "neutral"}">${escapeHtml(item.sensitivity)}</span><small>${escapeHtml(`${item.scope_kind}:${item.scope_id} / ${item.kind} / v${item.memory_version}`)}</small></div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary)}</p><small>${escapeHtml(item.reason)}</small></div>
    <div class="memory-recommendation-actions"><span class="badge ${item.application_state === "available" ? "neutral" : "success"}">${escapeHtml(recommendationStateLabel(item))}</span><strong>${escapeHtml(Number(item.score || 0).toFixed(2))}</strong>${item.application_state === "available" ? `<button class="primary" data-action="memory-recommendation-action" data-memory-action="use_next_turn" data-recommendation-id="${escapeHtml(item.recommendation_id)}">Use next reply</button><button class="secondary" data-action="memory-recommendation-action" data-memory-action="keep_for_session" data-recommendation-id="${escapeHtml(item.recommendation_id)}">Keep for Task</button><button class="icon-button" data-action="memory-recommendation-action" data-memory-action="not_relevant" data-recommendation-id="${escapeHtml(item.recommendation_id)}" title="Not relevant" aria-label="Not relevant">&#10005;</button>` : overlay ? `<button class="secondary" data-action="remove-memory-overlay" data-overlay-id="${escapeHtml(overlay.overlay_id)}" data-recommendation-id="${escapeHtml(item.recommendation_id)}">Remove from Task</button>` : ""}</div>
  </article>`;
  }).join("") || `<p class="muted">${state.memory.recommendations ? "No relevant memory recommendation for the current Task." : "Select a Task, then refresh Memory Center."}</p>`;
}

function renderTaskConversationRail(messages) {
  const visibleMessages = getVisibleOrchestratorMessages(messages);
  const conversationTargets = getConversationTargets();
  const conversationTarget = getTaskConversationTarget(state.workspaceDetail);
  const sendingTarget = getSelectedConversationTarget(conversationTargets) || conversationTarget;
  const attachments = filterConversationInputAttachments(state.workspaceDetail?.attachments);
  const conversationTargetLabel = conversationTarget
    ? `${conversationTarget.connection.name} / ${conversationTarget.model}`
    : "Model unavailable";
  const latestProviderMessage = [...messages].reverse().find(
    (message) => message.content?.response_source === "provider",
  );
  const conversationTargetDetail = latestProviderMessage
    ? `${latestProviderMessage.content?.protocol || "provider"} / requested ${latestProviderMessage.content?.requested_model || latestProviderMessage.content?.model || "model"} / returned ${latestProviderMessage.content?.response_model || latestProviderMessage.content?.model || "unknown"}`
    : conversationTarget
      ? "This Session is pinned to this Provider Connection and model."
      : "No verified Provider Connection is available for this Session.";
  const checkpoint = state.workspaceDetail?.task_checkpoint || null;
  const checkpointNotice = checkpoint?.status === "resumable"
    ? `<div class="task-checkpoint-notice resumable"><span class="status-dot warn"></span><span><strong>Response paused</strong><small>${escapeHtml(checkpoint.next_action || "Continue from the saved task state.")}</small></span><button class="secondary" type="button" data-action="resume-task-checkpoint" ${state.planning ? "disabled" : ""}>Continue</button></div>`
    : checkpoint?.status === "waiting_human"
      ? `<div class="task-checkpoint-notice waiting"><span class="status-dot info"></span><span><strong>Waiting for you</strong><small>${escapeHtml(checkpoint.next_action || "Provide the requested decision or input.")}</small></span></div>`
      : "";
  return `<section class="task-conversation-rail" data-workspace-focus="task-conversation">
    <header class="task-conversation-rail-header">
      <div class="task-conversation-title-row"><div><span class="task-start-kicker">Conversation</span><h3>Task conversation</h3></div><button class="icon-button task-conversation-toggle" data-action="hide-task-conversation" title="Hide conversation" aria-label="Hide conversation">&#10005;</button></div>
      <div class="task-conversation-summary-meta"><span class="conversation-model-chip ${conversationTarget ? "verified" : "unavailable"}" title="${escapeHtml(conversationTargetDetail)}">${escapeHtml(conversationTargetLabel)}</span><span class="badge neutral">${escapeHtml(String(visibleMessages.length))}</span></div>
    </header>
    <section class="orchestrator-chat-panel task-conversation-panel">
      ${renderOrchestratorConversation(messages)}
      ${checkpointNotice}
      ${state.planner.error ? `<div class="alert danger inline-alert">${escapeHtml(state.planner.error)}</div>` : ""}
      <div class="task-memory-recommendations" data-task-memory-recommendations>${renderTaskMemoryRecommendationContent()}</div>
      <div class="orchestrator-composer task-chat-composer" data-conversation-file-drop="true">
        ${attachments.length ? `<div class="task-chat-attachments">${attachments.slice(-6).map((attachment) => `<span class="task-chat-attachment" title="${escapeHtml(attachment.summary || attachment.storage_uri || attachment.name)}"><span>${escapeHtml(attachment.name || "Attached file")}</span><button class="icon-button" type="button" data-action="remove-conversation-attachment" data-attachment-id="${escapeHtml(attachment.attachment_id)}" title="Remove attachment" aria-label="Remove ${escapeHtml(attachment.name || "attachment")}" ${state.attachmentSaving ? "disabled" : ""}>&#10005;</button></span>`).join("")}</div>` : ""}
        <textarea rows="2" aria-label="Message My Mate" data-field="planner.intent" placeholder="Message My Mate" ${state.planning ? "disabled" : ""}>${escapeHtml(state.planner.intent)}</textarea>
        <div class="task-chat-composer-toolbar"><div class="task-chat-toolbar-start"><button class="icon-button task-chat-attach" type="button" data-action="pick-conversation-file" title="Attach text files" aria-label="Attach text files" ${state.attachmentSaving || state.planning ? "disabled" : ""}>&#128206;</button><input class="hidden-file-input" type="file" multiple data-field="conversation.filePicker" data-key="${escapeHtml(String(state.attachmentFilePickerKey))}" accept=".md,.txt,.json,.csv,.yaml,.yml,.xml,.html,.css,.js,.mjs,.jsx,.ts,.tsx,.py,.java,.go,.rs,.sql,.log,.ini,.toml,.sh,.svg,text/*" /><label class="task-chat-model-picker" title="Model for the next reply"><span class="status-dot ${sendingTarget ? "success" : "warn"}"></span><select aria-label="Conversation model" data-field="planner.conversationTarget" ${state.planning || !conversationTargets.length ? "disabled" : ""}>${conversationTargets.length ? conversationTargets.map((target) => `<option value="${escapeHtml(conversationTargetValue(target.connection.connection_id, target.model))}" ${sendingTarget?.connection.connection_id === target.connection.connection_id && sendingTarget.model === target.model ? "selected" : ""}>${escapeHtml(`${target.connection.name} / ${target.model}`)}</option>`).join("") : '<option value="">Model unavailable</option>'}</select></label></div><button class="icon-button primary task-chat-send" data-action="orchestrator-send-message" title="Send message" aria-label="Send message" ${state.planning || !state.planner.intent.trim() || !sendingTarget ? "disabled" : ""}>&#8593;</button></div>
      </div>
    </section>
  </section>`;
}

function renderTaskTechnicalSection(detail, missionSpec, hasProposal, hasExecutionData, workspace) {
  return `${missionSpec || hasProposal ? `<details class="task-technical-details" data-workspace-focus="task-plan" ${state.ui.taskPlanExpanded ? "open" : ""}><summary>Plan and technical details</summary><div>${missionSpec ? renderMissionSpecCompact(detail) : ""}${hasProposal ? renderDagProposalSummary() : ""}</div></details>` : ""}
    ${hasExecutionData ? `<details class="task-runtime-details" data-workspace-focus="task-runtime" ${state.ui.taskRuntimeExpanded ? "open" : ""}><summary><span><strong>Runtime and evidence</strong><small>Progress graph, interventions, artifacts, evaluation, trace, and replay.</small></span><span class="badge ${statusTone(detail?.latest_run?.status || workspace.run_status || "idle")}">${escapeHtml(detail?.latest_run?.status || workspace.run_status || "idle")}</span></summary>${renderExecutionCockpit(detail)}</details>` : ""}`;
}

function renderGeneratedMissionWorkspace(input) {
  const { detail, experience, messages, missionSpec, hasProposal, hasExecutionData, workspace } = input;
  const registry = {
    task_guidance: () => renderTaskGuidance(detail, experience),
    decision_queue: () => renderGeneratedDecisionQueue(detail),
    progress_summary: () => renderGeneratedProgress(detail),
    result_gallery: () => renderTaskResults(detail),
    quality_summary: () => renderTaskQuality(detail, experience),
    repair_recommendation: () => renderGeneratedRepair(experience),
    technical_details: () => renderTaskTechnicalSection(detail, missionSpec, hasProposal, hasExecutionData, workspace),
  };
  const planBlocks = Array.isArray(experience.uiPlan?.blocks) ? experience.uiPlan.blocks : [];
  const blocks = planBlocks.length
    ? planBlocks
    : [
        { block_id: "guidance", component: "task_guidance" },
        { block_id: "results", component: "result_gallery" },
        { block_id: "quality", component: "quality_summary" },
        { block_id: "technical", component: "technical_details" },
      ];
  const rendered = new Set();
  const output = blocks.flatMap((block) => {
    const component = block?.component;
    if (component === "conversation" || !component || rendered.has(component) || typeof registry[component] !== "function") return [];
    rendered.add(component);
    const html = registry[component]();
    return html ? [`<div class="generated-mission-block" data-generated-component="${escapeHtml(component)}">${html}</div>`] : [];
  });
  if (!rendered.has("task_guidance")) output.unshift(`<div class="generated-mission-block" data-generated-component="task_guidance">${renderTaskGuidance(detail, experience)}</div>`);
  if (!rendered.has("result_gallery")) {
    output.splice(Math.min(1, output.length), 0, `<div class="generated-mission-block" data-generated-component="result_gallery">${renderTaskResults(detail)}</div>`);
  }
  return output.join("");
}

function conversationTargetValue(connectionId, model) {
  return `${encodeURIComponent(connectionId)}|${encodeURIComponent(model)}`;
}

function parseConversationTargetValue(value) {
  const separator = value.indexOf("|");
  if (separator < 0) return null;
  try {
    return {
      connectionId: decodeURIComponent(value.slice(0, separator)),
      model: decodeURIComponent(value.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

function getConversationTargets() {
  return state.providerConnections
    .filter(
      (connection) =>
        connection.status === "active" &&
        connection.verification?.status === "verified",
    )
    .flatMap((connection) => {
      const models = connection.models?.length
        ? connection.models
        : [connection.default_model].filter(Boolean);
      return models.map((model) => ({ connection, model }));
    });
}

function getSelectedConversationTarget(targets = getConversationTargets()) {
  return targets.find(
    (target) =>
      target.connection.connection_id === state.planner.conversationProviderConnectionId &&
      target.model === state.planner.conversationModel,
  ) || targets[0] || null;
}

function closeArtifactPreview() {
  state.artifactPreview = {
    open: false,
    loading: false,
    compareLoading: false,
    error: null,
    tab: "preview",
    artifactId: "",
    detail: null,
    compare: null,
  };
  render();
}

async function loadArtifactComparison() {
  const preview = state.artifactPreview;
  const sessionId = state.selectedSessionId;
  if (!preview.open || !sessionId || !preview.artifactId || !preview.detail?.previous_artifact_id) return;
  preview.compareLoading = true;
  preview.error = null;
  render();
  try {
    const compare = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(preview.artifactId)}/compare`,
    );
    if (!state.artifactPreview.open || state.artifactPreview.artifactId !== preview.artifactId) return;
    state.artifactPreview.compare = compare;
  } catch (error) {
    state.artifactPreview.error = error.message;
  } finally {
    if (state.artifactPreview.artifactId === preview.artifactId) {
      state.artifactPreview.compareLoading = false;
      render();
    }
  }
}

async function openArtifactPreview(artifactId, tab = "preview") {
  const sessionId = state.selectedSessionId;
  if (!sessionId || !artifactId) return;
  const runtimeArtifact = (state.workspaceDetail?.artifacts || []).find(
    (artifact) => artifact.artifact_id === artifactId,
  );
  const runtimeRunId = runtimeArtifact?.run_id || state.workspaceDetail?.latest_run?.run_id || "";
  state.artifactPreview = {
    open: true,
    loading: true,
    compareLoading: false,
    error: null,
    tab,
    artifactId,
    detail: null,
    compare: null,
  };
  render();
  try {
    const endpoint = runtimeArtifact && runtimeRunId
      ? `/api/runs/${encodeURIComponent(runtimeRunId)}/artifacts/${encodeURIComponent(artifactId)}`
      : `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`;
    const detail = await request(
      endpoint,
    );
    if (!state.artifactPreview.open || state.artifactPreview.artifactId !== artifactId) return;
    state.artifactPreview.detail = detail;
    state.artifactPreview.loading = false;
    if (tab === "changes" && detail.previous_artifact_id) {
      await loadArtifactComparison();
      return;
    }
  } catch (error) {
    if (state.artifactPreview.artifactId === artifactId) {
      state.artifactPreview.loading = false;
      state.artifactPreview.error = error.message;
    }
  }
  render();
}

function compactArtifactDiffLines(lines, contextSize = 3) {
  const values = Array.isArray(lines) ? lines : [];
  const visible = new Set();
  values.forEach((line, index) => {
    if (line.type === "context") return;
    for (let offset = -contextSize; offset <= contextSize; offset += 1) {
      if (index + offset >= 0 && index + offset < values.length) visible.add(index + offset);
    }
  });
  if (!visible.size && values.length) {
    for (let index = 0; index < Math.min(values.length, contextSize * 2 + 1); index += 1) visible.add(index);
  }
  const compacted = [];
  let previousIndex = -2;
  for (const index of [...visible].sort((left, right) => left - right)) {
    if (index > previousIndex + 1) {
      compacted.push({ type: "skip", text: "Unchanged lines", old_line: null, new_line: null });
    }
    compacted.push(values[index]);
    previousIndex = index;
  }
  if (previousIndex >= 0 && previousIndex < values.length - 1) {
    compacted.push({ type: "skip", text: "Unchanged lines", old_line: null, new_line: null });
  }
  return compacted;
}

function renderArtifactTablePreview(tablePreview) {
  const columns = Array.isArray(tablePreview?.columns) ? tablePreview.columns : [];
  const rows = Array.isArray(tablePreview?.rows) ? tablePreview.rows : [];
  if (!columns.length) return '<div class="artifact-preview-status"><strong>No spreadsheet rows are available.</strong></div>';
  return `
    <div class="artifact-table-preview">
      <table>
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(String(column ?? ""))}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${columns.map((_, index) => `<td>${escapeHtml(String(Array.isArray(row) ? row[index] ?? "" : ""))}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function artifactPreviewLanguage(artifact) {
  const extension = String(artifact?.name || "").split(".").pop()?.toLowerCase() || "";
  const aliases = {
    py: "python", pyi: "python", java: "java", properties: "properties", xml: "xml",
    js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript",
    jsx: "javascript", json: "json", jsonl: "json", yaml: "yaml", yml: "yaml", toml: "ini",
    html: "html", htm: "html", css: "css", scss: "scss", sql: "sql", sh: "shell",
    bash: "shell", zsh: "shell", ps1: "powershell", c: "c", h: "c", cpp: "cpp", cc: "cpp",
    hpp: "cpp", cs: "csharp", go: "go", rs: "rust", rb: "ruby", php: "php", gradle: "gradle",
    md: "markdown", markdown: "markdown",
  };
  return aliases[extension] || "text";
}

function renderArtifactTextPreview(content, artifact) {
  const source = String(content || "");
  const language = artifactPreviewLanguage(artifact);
  let highlighted;
  try {
    highlighted = language !== "text" && hljs.getLanguage(language)
      ? hljs.highlight(source, { language, ignoreIllegals: true })
      : { value: escapeHtml(source), language: "text" };
  } catch {
    highlighted = { value: escapeHtml(source), language: "text" };
  }
  return `<section class="artifact-code-block artifact-standalone-code"><div class="artifact-code-toolbar"><span class="artifact-code-language">${escapeHtml(highlighted.language || language)}</span></div><pre class="artifact-text-preview"><code class="hljs">${highlighted.value}</code></pre></section>`;
}

function renderArtifactPreviewModal() {
  const preview = state.artifactPreview;
  if (!preview.open) return "";
  const detail = preview.detail;
  const artifact = detail?.artifact || null;
  const compare = preview.compare;
  const canCompare = Boolean(detail?.previous_artifact_id);
  const downloadUri = detail?.download_uri || artifact?.storage_uri || "";
  const previewContent = detail
    ? detail.preview_kind === "markdown"
      ? `<div class="artifact-markdown-preview conversation-markdown">${renderArtifactMarkdown(detail.content)}</div>`
      : detail.preview_kind === "table"
        ? renderArtifactTablePreview(detail.table_preview)
        : detail.preview_kind === "image"
          ? `<div class="artifact-media-preview"><img src="${escapeHtml(detail.preview_uri || downloadUri)}" alt="${escapeHtml(artifact?.name || "Generated image")}" /></div>`
          : detail.preview_kind === "pdf"
            ? `<iframe class="artifact-pdf-preview" src="${escapeHtml(detail.preview_uri || downloadUri)}" title="${escapeHtml(artifact?.name || "PDF preview")}"></iframe>`
            : detail.preview_kind === "binary"
              ? `<div class="artifact-preview-status"><strong>Inline preview is not available for this file type.</strong><p>Download the verified file to open it with the appropriate desktop application.</p></div>`
              : renderArtifactTextPreview(detail.content, artifact)
    : "";
  const diffLines = compactArtifactDiffLines(compare?.lines || []);
  const changesContent = preview.compareLoading
    ? '<div class="artifact-preview-status"><strong>Comparing versions...</strong></div>'
    : compare
      ? `<div class="artifact-diff-summary"><span class="badge neutral">v${escapeHtml(String(compare.base?.version || "?"))} to v${escapeHtml(String(compare.target?.version || "?"))}</span><span class="artifact-diff-additions">+${escapeHtml(String(compare.additions || 0))}</span><span class="artifact-diff-deletions">-${escapeHtml(String(compare.deletions || 0))}</span></div>
         <div class="workspace-diff-lines artifact-diff-lines">${diffLines.map((line) => {
           const lineClass = line.type === "added" ? "is-added" : line.type === "removed" ? "is-deleted" : line.type === "skip" ? "is-skip" : "";
           const marker = line.type === "added" ? "+" : line.type === "removed" ? "-" : line.type === "skip" ? "..." : "";
           return `<div class="workspace-diff-line ${lineClass}"><span>${escapeHtml(line.old_line || "")}</span><span>${escapeHtml(line.new_line || "")}</span><span>${escapeHtml(marker)}</span><code>${escapeHtml(line.text || " ")}</code></div>`;
         }).join("")}</div>`
      : canCompare
        ? '<div class="artifact-preview-status"><strong>Select Show diff to compare with the previous version.</strong></div>'
        : '<div class="artifact-preview-status"><strong>This is the first version of this file.</strong><p>A diff becomes available after a newer version is generated.</p></div>';
  return `
    <div class="artifact-preview-backdrop">
      <section class="artifact-preview-modal" role="dialog" aria-modal="true" aria-label="Artifact preview">
        <header class="artifact-preview-header">
          <div><span class="task-start-kicker">Generated output</span><h3>${escapeHtml(artifact?.name || "Artifact preview")}</h3><p>${artifact ? `${escapeHtml(formatFileSize(artifact.size_bytes) || artifact.mime_type || "Text file")} / v${escapeHtml(String(artifact.version || 1))} / ${escapeHtml(formatWorkspaceTimestamp(artifact.created_at))}` : "Loading file details..."}</p></div>
          <button class="icon-button" data-action="close-artifact-preview" title="Close" aria-label="Close artifact preview">&#10005;</button>
        </header>
        ${artifact ? `<div class="artifact-preview-tabs" role="tablist" aria-label="Artifact views"><button class="artifact-preview-tab ${preview.tab === "preview" ? "selected" : ""}" role="tab" aria-selected="${preview.tab === "preview"}" data-action="select-artifact-preview-tab" data-tab="preview">Preview</button><button class="artifact-preview-tab ${preview.tab === "changes" ? "selected" : ""}" role="tab" aria-selected="${preview.tab === "changes"}" data-action="select-artifact-preview-tab" data-tab="changes" ${canCompare ? "" : "disabled"}>Changes${canCompare ? "" : " (first version)"}</button></div>` : ""}
        <div class="artifact-preview-body">
          ${preview.loading ? '<div class="artifact-preview-status"><strong>Loading preview...</strong></div>' : ""}
          ${preview.error ? `<div class="alert danger">${escapeHtml(preview.error)}</div>` : ""}
          ${!preview.loading && !preview.error ? (preview.tab === "changes" ? changesContent : previewContent) : ""}
        </div>
        <footer class="artifact-preview-footer"><span>${artifact ? escapeHtml(`${detail.versions?.length || 1} version${detail.versions?.length === 1 ? "" : "s"}`) : ""}</span><div><button class="secondary" data-action="close-artifact-preview">Close</button>${downloadUri ? `<a class="primary artifact-download-button" href="${escapeHtml(downloadUri)}" download>Download</a>` : ""}</div></footer>
      </section>
    </div>
  `;
}

function renderTaskResults(detail) {
  const deliverables = getExecutionDeliverables(detail).filter(
    (item) => item.status === "returned" || item.status === "completed",
  );
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts.slice(-6).reverse() : [];
  const resultItems = deliverables.length
    ? deliverables.slice(0, 6).map((item) => ({
        title: item.title || "Result",
        detail: item.summary || item.uri || "Returned deliverable",
        uri: item.uri || "",
        artifactId: item.artifactId || "",
        mimeType: item.mimeType || "",
      }))
    : artifacts.map((artifact) => ({
        title: artifact.name || artifact.kind || artifact.artifact_id || "Generated result",
        detail: artifact.summary || artifact.storage_uri || artifact.path || "Generated artifact",
        uri: artifact.storage_uri || artifact.path || "",
        artifactId: artifact.artifact_id || "",
        mimeType: artifact.mime_type || "",
      }));

  const executionStatus = detail?.latest_run?.status || detail?.workspace_state?.run_status || "not started";
  const decisionCount = getExecutionQueueItems(detail).length;
  return `
    <section class="task-workboard-panel" data-workspace-focus="task-results">
      <div class="task-results-heading">
        <div><span class="task-start-kicker">Workboard</span><h3>Files</h3></div>
        <div class="task-workboard-summary" aria-label="Task output summary">
          <span>${escapeHtml(String(resultItems.length))} file${resultItems.length === 1 ? "" : "s"}</span>
          <span class="${escapeHtml(statusTone(executionStatus))}">${escapeHtml(executionStatus)}</span>
          ${decisionCount ? `<span class="warn">${escapeHtml(String(decisionCount))} pending</span>` : ""}
        </div>
      </div>
      ${resultItems.length
        ? `<div class="task-result-list">${resultItems
            .map(
              (item) => `
                <article class="task-result-item">
                  <div class="task-result-file">
                    <strong title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong>
                    <span title="${escapeHtml(item.detail)}">${escapeHtml(item.detail || item.mimeType || "Generated file")}</span>
                  </div>
                  <div class="task-result-actions">
                    ${item.artifactId ? `<button class="secondary" type="button" data-action="open-artifact-preview" data-artifact-id="${escapeHtml(item.artifactId)}">Preview</button>` : ""}
                    ${String(item.uri || "").startsWith("/api/") ? `<a class="task-result-download secondary" href="${escapeHtml(item.uri)}" download>Download</a>` : ""}
                  </div>
                </article>
              `,
            )
            .join("")}</div>`
        : '<div class="task-workboard-empty"><strong>No outputs yet</strong><p>The task is still in conversation and has not returned a deliverable.</p></div>'}
    </section>
  `;
}

function renderOrchestratorWorkbench() {
  const detail = state.workspaceDetail;
  const session = detail?.session || null;
  const messages = detail?.messages || [];
  const workspace = detail?.workspace_state || {};
  const title = session?.title || "What do you want to get done?";
  const subtitle =
    detail?.mission_snapshot?.nextActionDetail ||
    detail?.workspace_state?.next_recommended_detail ||
    "Describe the outcome. My Mate will discuss it with you and choose the internal route only when the task is ready.";
  const hasExecutionData =
    !!detail?.runtime_graph ||
    !!detail?.latest_run ||
    !!workspace.latest_run_id ||
    (Array.isArray(detail?.artifacts) && detail.artifacts.length > 0) ||
    (Array.isArray(detail?.interventions) && detail.interventions.length > 0) ||
    (Array.isArray(detail?.dag_patches) && detail.dag_patches.length > 0);

  const missionSpec = getWorkspaceMissionSpec(detail);
  const hasProposal = !!state.planner?.dagDraft || !!state.planner?.candidatePlan || !!state.planner?.activeProposal;
  const conversationTargets = getConversationTargets();
  const selectedConversationTarget = getSelectedConversationTarget(conversationTargets);
  const verifiedConnection = selectedConversationTarget?.connection || null;
  const activeWorkspace = state.desktop.workspace;
  const taskWorkspaceReady = !state.desktop.available || !!activeWorkspace;
  if (!session) {
    return `
      <div class="orchestrator-workbench task-home-workbench">
        <section class="task-start-surface">
          <div class="task-start-copy"><span class="task-start-kicker">${activeWorkspace ? `New task in ${escapeHtml(activeWorkspace.displayName || activeWorkspace.name)}` : "New task"}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></div>
          ${!taskWorkspaceReady ? `<div class="task-workspace-required"><span><strong>Workspace required</strong><small>Add or create a folder from the left sidebar. New tasks automatically inherit it.</small></span><button class="secondary" data-action="open-workspace-creator">Add Workspace</button></div>` : ""}
          <div class="task-start-composer">
            <textarea rows="6" aria-label="Task description" data-field="planner.intent" placeholder="Describe the result, constraints, and files or systems involved.">${escapeHtml(state.planner.intent)}</textarea>
            <div class="task-start-actions">
              <label class="task-model-picker"><span>Conversation model</span><select aria-label="Conversation model" data-field="planner.conversationTarget" ${conversationTargets.length ? "" : "disabled"}>
                ${conversationTargets.length
                  ? conversationTargets.map((target) => `<option value="${escapeHtml(conversationTargetValue(target.connection.connection_id, target.model))}" ${selectedConversationTarget?.connection.connection_id === target.connection.connection_id && selectedConversationTarget.model === target.model ? "selected" : ""}>${escapeHtml(`${target.connection.name} / ${target.model}`)}</option>`).join("")
                  : '<option value="">No verified model</option>'}
              </select></label>
              <button class="primary task-start-button" data-action="orchestrator-send-message" ${state.planning || !state.planner.intent.trim() || !selectedConversationTarget || !taskWorkspaceReady ? "disabled" : ""}>${state.planning ? "Preparing task..." : taskWorkspaceReady ? "Start task" : "Add Workspace first"}</button>
            </div>
          </div>
          <div class="task-readiness-strip">
            <span class="status-dot ${verifiedConnection ? "success" : "warn"}"></span>
            <span><strong>${verifiedConnection ? "Model verified" : "Model setup needs attention"}</strong><small>${escapeHtml(selectedConversationTarget ? `${verifiedConnection.name} / ${selectedConversationTarget.model}` : "Open Settings to configure and verify a model connection.")}</small></span>
            ${verifiedConnection ? "" : '<button class="secondary" data-action="open-studio-setup">Open Settings</button>'}
          </div>
          ${state.planner.error ? `<div class="alert danger inline-alert">${escapeHtml(state.planner.error)}</div>` : ""}
        </section>
      </div>
    `;
  }
  const taskExperience = buildTaskExperience(detail);
  return `
    <div class="orchestrator-workbench task-active-workbench">
      ${renderGeneratedMissionWorkspace({ detail, experience: taskExperience, messages, missionSpec, hasProposal, hasExecutionData, workspace })}
    </div>
  `;
}

function getTaskConversationTarget(detail = state.workspaceDetail) {
  const providerMessage = [...(detail?.messages || [])].reverse().find(
    (message) => message.content?.response_source === "provider",
  );
  const connectionId =
    providerMessage?.content?.provider_connection_id ||
    detail?.session?.metadata?.conversation_provider_connection_id ||
    "";
  const model =
    providerMessage?.content?.model ||
    detail?.session?.metadata?.conversation_model ||
    "";
  const connection = state.providerConnections.find(
    (item) => item.connection_id === connectionId,
  );
  if (connection && model) return { connection, model };
  return getSelectedConversationTarget();
}

function renderOrchestratorRail() {
  const detail = state.workspaceDetail;
  return `
    <aside class="desktop-rail task-conversation-rail-container">
      ${renderTaskConversationRail(detail?.messages || [])}
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
  if (state.activeNav === "inbox") {
    const count = getInboxOpenCount();
    return `
      <div class="sidebar-section-header">
        <strong>Needs attention</strong>
        <button class="mini-button" data-action="refresh-inbox">${state.inbox.loading ? "..." : "Ref"}</button>
      </div>
      <div class="sidebar-panel">
        <div class="registry-item"><strong>${count ? `${count} open item${count === 1 ? "" : "s"}` : "All clear"}</strong><small>${count ? "Decisions and missing input are collected here." : "No task is waiting for you."}</small></div>
      </div>
    `;
  }
  if (state.activeNav === "library") {
    return `
      <div class="sidebar-section-header"><strong>Library</strong></div>
      <div class="sidebar-panel">
        <div class="registry-item"><strong>${state.templates.length} workflows</strong><small>Reusable starting points selected automatically for new tasks.</small></div>
      </div>
    `;
  }
  if (state.activeNav === "settings") {
    const verified = state.providerConnections.filter((connection) => connection.verification?.status === "verified").length;
    return `
      <div class="sidebar-section-header"><strong>Readiness</strong></div>
      <div class="sidebar-panel">
        <div class="registry-item"><strong>${verified ? `${verified} verified model${verified === 1 ? "" : "s"}` : "Model needs verification"}</strong><small>Model and machine checks are managed from one setup flow.</small></div>
      </div>
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
  if (state.activeNav === "dashboard") {
    return `
      <div class="sidebar-section-header">
        <strong>Dashboard</strong>
        <button class="mini-button" data-action="refresh-dashboard">${state.dashboardLoading ? "..." : "Ref"}</button>
      </div>
      <div class="sidebar-panel">
        <div class="sidebar-panel-header"><strong>Attention</strong></div>
        <div class="registry-item">
          <strong>${escapeHtml(state.dashboardSummary?.runtime_health?.attention_tone || "neutral")}</strong>
          <small>${escapeHtml((state.dashboardSummary?.runtime_health?.summary_lines || []).join(" / ") || "Runtime summary unavailable.")}</small>
        </div>
      </div>
      <div class="sidebar-panel">
        <div class="sidebar-panel-header"><strong>Backlog</strong></div>
        <div class="registry-item">
          <strong>${escapeHtml(String((state.dashboardSummary?.backlog?.pending_approvals || 0) + (state.dashboardSummary?.backlog?.pending_human_inputs || 0)))}</strong>
          <small>${escapeHtml(`approvals ${state.dashboardSummary?.backlog?.pending_approvals || 0} / input ${state.dashboardSummary?.backlog?.pending_human_inputs || 0}`)}</small>
        </div>
      </div>
    `;
  }
  if (state.activeNav === "memory") {
    const retrieval = state.memory.retrievalStatus;
    const knowledge = state.memory.knowledgeStatus;
    return `
      <div class="sidebar-section-header">
        <strong>Memory</strong>
        <button class="mini-button" data-action="refresh-memory">${state.memoryLoading ? "..." : "Ref"}</button>
      </div>
      <div class="sidebar-panel">
        <div class="registry-item">
          <strong>${escapeHtml(retrieval?.retrieval || "Loading")}</strong>
          <small>${escapeHtml(`${retrieval?.active_records || 0} active / ${retrieval?.indexed_records || 0} indexed`)}</small>
        </div>
        <div class="registry-item">
          <strong>${escapeHtml(knowledge?.provider_id || "Knowledge provider")}</strong>
          <small>${escapeHtml(knowledge?.state || "Loading")}</small>
        </div>
      </div>
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

function findMissionForRun(runId) {
  if (!runId) return null;
  return state.missions.find((mission) =>
    mission.latest_run_id === runId ||
    mission.mission_snapshot?.executionSummary?.runId === runId ||
    mission.mission_snapshot?.execution_summary?.run_id === runId
  ) || null;
}

function getOpenWorkspaceChanges() {
  return openWorkspaceChangeSets(state.inbox.workspaceChanges);
}

function getInboxOpenCount() {
  return state.inbox.approvals.length +
    state.inbox.humanInputs.length +
    state.inbox.alerts.length +
    state.inbox.memoryCandidates.length +
    getOpenWorkspaceChanges().length;
}

function workspaceRootLabel(root) {
  const parts = String(root || "").replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) || "Workspace";
}

function renderWorkspaceDiff(change) {
  const diff = change?.diff;
  if (!diff || diff.status !== "available") {
    const reason = diff?.status === "binary"
      ? "Binary file preview is unavailable. Review its size and hashes before applying."
      : diff?.status === "too_large"
        ? "This text file is too large for the bounded inline preview."
        : "This older Change Set does not include an inline preview.";
    return `
      <div class="workspace-diff-unavailable">
        <strong>Preview unavailable</strong>
        <span>${escapeHtml(reason)}</span>
        <dl>
          <div><dt>Before size</dt><dd>${escapeHtml(change?.before_size_bytes == null ? "not present" : formatWorkspaceBytes(change?.before_size_bytes))}</dd></div>
          <div><dt>After size</dt><dd>${escapeHtml(change?.after_size_bytes == null ? "deleted" : formatWorkspaceBytes(change?.after_size_bytes))}</dd></div>
          <div><dt>Before SHA-256</dt><dd>${escapeHtml(change?.before_sha256 || "not present")}</dd></div>
          <div><dt>After SHA-256</dt><dd>${escapeHtml(change?.after_sha256 || "deleted")}</dd></div>
        </dl>
      </div>
    `;
  }
  return `
    <div class="workspace-diff-lines" role="table" aria-label="Line changes">
      ${(diff.lines || []).map((line) => {
        if (line.kind === "skip") {
          return `<div class="workspace-diff-line is-skip" role="row"><span></span><span></span><span>...</span><code>${escapeHtml(line.text)}</code></div>`;
        }
        const marker = line.kind === "added" ? "+" : line.kind === "deleted" ? "-" : " ";
        return `
          <div class="workspace-diff-line is-${escapeHtml(line.kind)}" role="row">
            <span>${escapeHtml(line.old_line ?? "")}</span>
            <span>${escapeHtml(line.new_line ?? "")}</span>
            <span>${marker}</span>
            <code>${escapeHtml(line.text || " ")}</code>
          </div>
        `;
      }).join("") || '<div class="workspace-diff-unavailable"><span>No textual line changes.</span></div>'}
    </div>
  `;
}

function renderWorkspaceChangeReview() {
  const changeSets = getOpenWorkspaceChanges();
  const selected = selectWorkspaceChangeSet(changeSets, state.inbox.selectedWorkspaceChangeId);
  if (!selected) return "";
  const selectedFile = selectWorkspaceFile(selected, state.inbox.selectedWorkspaceFile);
  const counts = countWorkspaceChangeKinds(selected);
  const confirmAction = state.inbox.confirmWorkspaceChangeAction;
  const actionable = selected.status === "pending";
  const rejectable = ["pending", "blocked", "apply_failed"].includes(selected.status);
  return `
    <section class="workspace-change-review" aria-label="Workspace change review">
      <header class="workspace-change-review-header">
        <div>
          <div class="workspace-change-title-row">
            <span class="badge ${workspaceChangeTone(selected.status)}">${escapeHtml(selected.status)}</span>
            <h3>${escapeHtml(workspaceRootLabel(selected.source_root))}</h3>
          </div>
          <p>${escapeHtml(selected.run_id)} / ${escapeHtml(selected.node_run_id)}</p>
        </div>
        <div class="workspace-change-actions">
          <button class="secondary danger-action" data-action="stage-workspace-change-action" data-mode="reject" ${!rejectable || isActionLoading("workspace-change", selected.change_set_id) ? "disabled" : ""}>Reject</button>
          <button class="primary" data-action="stage-workspace-change-action" data-mode="apply" ${!actionable || isActionLoading("workspace-change", selected.change_set_id) ? "disabled" : ""}>Apply changes</button>
        </div>
      </header>
      ${selected.blocked_reason ? `<div class="workspace-change-blocked"><strong>Application blocked</strong><span>${escapeHtml(selected.blocked_reason)}</span></div>` : ""}
      ${confirmAction ? `
        <div class="workspace-change-confirm ${confirmAction === "apply" ? "is-apply" : "is-reject"}">
          <span>${confirmAction === "apply" ? `Apply ${selected.changes.length} reviewed file change${selected.changes.length === 1 ? "" : "s"} to the source workspace?` : "Reject this Change Set without modifying the source workspace?"}</span>
          <div>
            <button class="secondary" data-action="cancel-workspace-change-action">Cancel</button>
            <button class="${confirmAction === "apply" ? "primary" : "secondary danger-action"}" data-action="confirm-workspace-change-action" data-mode="${confirmAction}">Confirm</button>
          </div>
        </div>
      ` : ""}
      <div class="workspace-change-summary" aria-label="Change summary">
        <span><strong>${selected.changes.length}</strong> files</span>
        <span class="is-added"><strong>${counts.added}</strong> added</span>
        <span class="is-modified"><strong>${counts.modified}</strong> modified</span>
        <span class="is-deleted"><strong>${counts.deleted}</strong> deleted</span>
      </div>
      <div class="workspace-change-layout">
        <aside class="workspace-change-set-list" aria-label="Workspace change sets requiring review">
          <div class="workspace-change-pane-title"><strong>Change Sets</strong><span>${changeSets.length}</span></div>
          ${changeSets.map((item) => `
            <button class="workspace-change-set-item ${item.change_set_id === selected.change_set_id ? "selected" : ""}" data-action="select-workspace-change-set" data-change-set-id="${escapeHtml(item.change_set_id)}">
              <span class="status-dot ${workspaceChangeTone(item.status)}"></span>
              <span><strong>${escapeHtml(workspaceRootLabel(item.source_root))}</strong><small>${escapeHtml(`${item.changes?.length || 0} files / ${formatWorkspaceTimestamp(item.created_at)}`)}</small></span>
            </button>
          `).join("")}
        </aside>
        <aside class="workspace-change-file-list" aria-label="Changed files">
          <div class="workspace-change-pane-title"><strong>Files</strong><span>${selected.changes.length}</span></div>
          ${selected.changes.map((change) => `
            <button class="workspace-change-file ${change.relative_path === selectedFile?.relative_path ? "selected" : ""}" data-action="select-workspace-change-file" data-path="${escapeHtml(change.relative_path)}">
              <span class="workspace-change-kind is-${escapeHtml(change.kind)}">${workspaceChangeKindSymbol(change.kind)}</span>
              <span><strong>${escapeHtml(change.relative_path)}</strong><small>${escapeHtml(formatWorkspaceBytes(change.after_size_bytes ?? change.before_size_bytes))}</small></span>
            </button>
          `).join("")}
        </aside>
        <section class="workspace-diff-pane">
          <div class="workspace-diff-header">
            <div><strong>${escapeHtml(selectedFile?.relative_path || "Select a file")}</strong><small>${selectedFile ? escapeHtml(`${selectedFile.kind} / ${formatWorkspaceBytes(selectedFile.after_size_bytes ?? selectedFile.before_size_bytes)}`) : ""}</small></div>
            ${selectedFile?.diff?.truncated ? '<span class="badge neutral">Context trimmed</span>' : ""}
          </div>
          ${selectedFile ? renderWorkspaceDiff(selectedFile) : '<div class="workspace-diff-unavailable"><span>Select a changed file to inspect it.</span></div>'}
        </section>
      </div>
    </section>
  `;
}

function renderInboxWorkspace() {
  const approvals = state.inbox.approvals || [];
  const humanInputs = state.inbox.humanInputs || [];
  const alerts = state.inbox.alerts || [];
  const count = getInboxOpenCount();
  return `
    <section class="product-surface inbox-surface">
      <div class="product-surface-heading">
        <div><h3>${count ? "Your attention is needed" : "Nothing needs your attention"}</h3><p>${count ? "Only decisions that can change or unblock a task appear here." : "My Mate will bring approvals, questions, and blocked tasks here."}</p></div>
        <span class="badge ${count ? "warn" : "success"}">${count ? `${count} open` : "All clear"}</span>
      </div>
      ${state.inbox.error ? `<div class="alert danger">${escapeHtml(state.inbox.error)}</div>` : ""}
      ${renderWorkspaceChangeReview()}
      <div class="inbox-list">
        ${state.inbox.memoryCandidates.map((candidate) => `
          <article class="inbox-item memory-candidate-inbox-item">
            <span class="inbox-item-kind">Memory</span>
            <div><strong>${escapeHtml(candidate.proposed_memory?.kind || candidate.operation || "Memory proposal")}</strong><p>${escapeHtml(candidate.proposed_memory?.content || candidate.rationale || "Review this durable memory change.")}</p><small>${escapeHtml(`${candidate.proposed_memory?.scope_kind || "workspace"}:${candidate.proposed_memory?.scope_id || candidate.workspace_id} / ${candidate.risk} risk`)}</small></div>
            <div class="inbox-item-actions">
              <button class="secondary" data-action="reject-memory-candidate" data-candidate-id="${escapeHtml(candidate.candidate_id)}" ${isActionLoading("memory-candidate", candidate.candidate_id) ? "disabled" : ""}>Reject</button>
              <button class="primary" data-action="approve-memory-candidate" data-candidate-id="${escapeHtml(candidate.candidate_id)}" ${isActionLoading("memory-candidate", candidate.candidate_id) ? "disabled" : ""}>Approve</button>
            </div>
          </article>
        `).join("")}
        ${alerts.map((alert) => {
          const mission = state.missions.find((item) => item.session_id === alert.session_id) || null;
          return `<article class="inbox-item supervision-inbox-item">
            <span class="inbox-item-kind">${escapeHtml(alert.severity === "critical" ? "Critical" : "Supervisor")}</span>
            <div><strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.detail)}</p><small>${escapeHtml(mission ? getTaskInventoryLabels(mission).title : formatWorkspaceTimestamp(alert.last_seen_at))}</small></div>
            <div class="inbox-item-actions">
              <button class="secondary" data-action="resolve-supervision-alert" data-alert-id="${escapeHtml(alert.alert_id)}">Dismiss</button>
              <button class="primary" data-action="open-supervision-alert-task" data-session-id="${escapeHtml(alert.session_id)}" data-recommended-action="${escapeHtml(alert.recommended_action || "")}">${escapeHtml(alert.recommended_action_label || "Open task")}</button>
            </div>
          </article>`;
        }).join("")}
        ${approvals.map((approval) => {
          const mission = findMissionForRun(approval.run_id);
          return `
            <article class="inbox-item">
              <span class="inbox-item-kind">Approval</span>
              <div><strong>${escapeHtml(approval.summary || "Task approval")}</strong><p>${escapeHtml(mission ? getMissionInventoryLabels(mission).title : "A running task is waiting for a decision.")}</p><small>${escapeHtml(formatWorkspaceTimestamp(approval.requested_at))}</small></div>
              <div class="inbox-item-actions">
                ${mission ? `<button class="secondary" data-action="open-inbox-task" data-session-id="${escapeHtml(mission.session_id)}">Open task</button>` : ""}
                <button class="secondary" data-action="reject-approval" data-approval-id="${escapeHtml(approval.approval_id)}">Reject</button>
                <button class="primary" data-action="approve-approval" data-approval-id="${escapeHtml(approval.approval_id)}">Approve</button>
              </div>
            </article>
          `;
        }).join("")}
        ${humanInputs.map((input) => {
          const mission = findMissionForRun(input.run_id);
          return `
            <article class="inbox-item">
              <span class="inbox-item-kind">Input</span>
              <div><strong>${escapeHtml(input.summary || "Task needs more information")}</strong><p>${escapeHtml(mission ? getMissionInventoryLabels(mission).title : "Open the task to provide the requested information.")}</p><small>${escapeHtml(formatWorkspaceTimestamp(input.requested_at))}</small></div>
              <div class="inbox-item-actions">
                ${mission ? `<button class="primary" data-action="open-inbox-task" data-session-id="${escapeHtml(mission.session_id)}">Open task</button>` : '<span class="badge warn">Task unavailable</span>'}
              </div>
            </article>
          `;
        }).join("")}
        ${count ? "" : '<div class="product-empty"><strong>My Mate is working quietly</strong><span>You only need to return when a decision or result is ready.</span></div>'}
      </div>
    </section>
  `;
}

function renderLibraryWorkspace() {
  const reusable = state.templates.filter((template) => template.status === "published");
  return `
    <section class="product-surface library-surface">
      <div class="product-surface-heading">
        <div><h3>Reusable workflows</h3><p>Choose a starting point only when you want one. New tasks can select a workflow automatically.</p></div>
        <span class="badge neutral">${reusable.length} available</span>
      </div>
      <div class="library-grid">
        ${reusable.map((template) => `
          <article class="library-item">
            <div><span class="inbox-item-kind">Workflow</span><strong>${escapeHtml(template.name || template.template_id)}</strong><p>${escapeHtml(template.description || "Reusable task workflow")}</p></div>
            <div class="library-item-meta"><span>${escapeHtml(String(template.nodes?.length || 0))} steps</span><span>v${escapeHtml(String(template.version || 1))}</span></div>
            <button class="primary" data-action="use-library-workflow" data-id="${escapeHtml(template.template_id)}">Use for a task</button>
          </article>
        `).join("") || '<div class="product-empty"><strong>No reusable workflows yet</strong><span>Add one workflow so tasks can start with a validated route.</span><button class="primary" data-action="open-workflow-builder">Open workflow builder</button></div>'}
      </div>
    </section>
  `;
}

function renderProductSettingsPanel() {
  const activeConnections = state.providerConnections.filter((connection) => connection.status === "active");
  const verifiedConnections = activeConnections.filter((connection) => connection.verification?.status === "verified");
  const runtime = state.runtimeSummary?.execution_runtime || null;
  const runtimeReady = runtime?.runtime_health?.status === "ok";
  const autonomy = autonomyModeCopy(state.product.autonomyMode);
  return `
    <section class="product-surface settings-home">
      <div class="product-surface-heading">
        <div><h3>Ready to work</h3><p>Model access and machine readiness are managed here. Advanced runtime details stay optional.</p></div>
        <span class="badge ${verifiedConnections.length && runtimeReady ? "success" : "warn"}">${verifiedConnections.length && runtimeReady ? "Ready" : "Needs attention"}</span>
      </div>
      <div class="settings-home-list">
        <article class="settings-home-row">
          <div><span class="settings-home-index">1</span><span><strong>Model</strong><small>${verifiedConnections.length ? `${verifiedConnections.length} verified connection${verifiedConnections.length === 1 ? "" : "s"}` : activeConnections.length ? "Configured, not verified" : "No model configured"}</small></span></div>
          <button class="primary" data-action="open-studio-setup">${activeConnections.length ? "Manage model" : "Set up model"}</button>
        </article>
        <article class="settings-home-row">
          <div><span class="settings-home-index">2</span><span><strong>Machine</strong><small>${escapeHtml(runtimeReady ? "Local runtime is available" : runtime?.runtime_health?.detail || "Run the machine check")}</small></span></div>
          <button class="secondary" data-action="open-environment-setup">Check machine</button>
        </article>
      </div>
      <section class="autonomy-policy-panel">
        <div class="autonomy-policy-heading">
          <div><h3>How My Mate should act</h3><p>Choose a human policy. Runtime, provider, and agent settings remain derived.</p></div>
          <span class="badge info">${escapeHtml(autonomy.label)}</span>
        </div>
        <div class="autonomy-options" role="radiogroup" aria-label="Task autonomy">
          ${AUTONOMY_MODES.map((mode) => {
            const copy = autonomyModeCopy(mode);
            const selected = state.product.autonomyMode === mode;
            return `<button class="autonomy-option ${selected ? "selected" : ""}" role="radio" aria-checked="${selected}" data-action="save-autonomy-mode" data-mode="${escapeHtml(mode)}" ${state.product.autonomySaving ? "disabled" : ""}><strong>${escapeHtml(copy.label)}</strong><small>${escapeHtml(copy.detail)}</small></button>`;
          }).join("")}
        </div>
      </section>
      <button class="product-advanced-link" data-action="open-registry-advanced">Open advanced model, agent, and governance settings</button>
    </section>
  `;
}

function renderMemoryOnboarding() {
  const onboarding = state.memory.onboarding;
  if (!onboarding) return "";
  if (onboarding.status !== "in_progress") {
    const complete = onboarding.status === "completed";
    return `<section class="memory-onboarding-section"><div><span class="task-start-kicker">Guided setup</span><strong>${complete ? "Memory preferences are configured" : onboarding.status === "dismissed" ? "Memory setup is dismissed" : "Set up how My Mate should work with you"}</strong><small>${complete ? `${onboarding.committed_memory_ids?.length || 0} memories committed / ${onboarding.candidate_ids?.length || 0} awaiting review` : "Optional, resumable, and limited to what you explicitly enter."}</small></div><button class="${complete ? "secondary" : "primary"}" data-action="start-memory-onboarding">${complete ? "Restart" : "Start"}</button></section>`;
  }
  const step = Math.min(4, Math.max(1, Number(onboarding.step || 1)));
  const draft = state.memory.onboardingDraft;
  const body = step === 1
    ? `<label><span>Response and communication preferences</span><textarea rows="3" data-field="memory.onboarding.responsePreferences" placeholder="For example: concise answers, Chinese output, evidence first">${escapeHtml(draft.responsePreferences)}</textarea></label>`
    : step === 2
      ? `<label><span>Validation and delivery conventions</span><textarea rows="3" data-field="memory.onboarding.validationConventions" placeholder="For example: run focused tests and report exact failures">${escapeHtml(draft.validationConventions)}</textarea></label>`
      : step === 3
        ? `<label><span>Current Project conventions (optional)</span><textarea rows="3" data-field="memory.onboarding.projectConventions" placeholder="Only applies to the selected Project">${escapeHtml(draft.projectConventions)}</textarea></label>`
        : `<label class="memory-inline-check"><input type="checkbox" data-field="memory.onboarding.private" ${draft.private ? "checked" : ""} /><span>Store these entries as Private encrypted Memory</span></label><p class="muted">Only the text above will be stored. My Mate will not scan your files, browser history, or connected services.</p>`;
  return `<section class="memory-onboarding-flow"><div class="memory-results-heading"><strong>Guided Memory setup</strong><small>Step ${step} of 4</small></div>${body}<div class="memory-actions-row"><button class="secondary" data-action="dismiss-memory-onboarding">Dismiss</button>${step < 4 ? `<button class="primary" data-action="advance-memory-onboarding">Continue</button>` : `<button class="primary" data-action="complete-memory-onboarding" ${!onboardingDraftEntries().length ? "disabled" : ""}>Review and save</button>`}</div></section>`;
}

function renderMemoryWorkspace() {
  const retrieval = state.memory.retrievalStatus;
  const embedding = retrieval?.embedding || null;
  const knowledge = state.memory.knowledgeStatus;
  const result = state.memory.searchResult;
  const hits = Array.isArray(result?.hits) ? result.hits : [];
  const settings = state.memory.settings;
  const observability = state.memory.observability;
  const intelligenceEvaluation = state.memory.intelligenceEvaluation;
  const maintenance = state.memory.maintenance;
  const maintenanceSweep = state.memory.maintenanceSweep;
  const effectiveness = state.memory.effectiveness;
  const contexts = Array.isArray(state.memory.contexts?.items) ? state.memory.contexts.items : [];
  const overlays = Array.isArray(state.memory.overlays?.items) ? state.memory.overlays.items : [];
  const recommendations = Array.isArray(state.memory.recommendations?.recommendations)
    ? state.memory.recommendations.recommendations
    : [];
  const records = state.memory.records || [];
  const candidates = state.memory.candidates || [];
  return `
    <section class="product-surface memory-workspace">
      <div class="product-surface-heading">
        <div><h3>Memory Center</h3><p>${escapeHtml(retrieval?.workspace_id || state.security.workspaceId || "default")}</p></div>
        <span class="badge ${embedding?.state === "degraded" ? "warn" : "success"}">${escapeHtml(retrieval?.retrieval || "Loading")}</span>
      </div>
      <div class="memory-toolbar">
        <div class="memory-search-row">
          <input data-field="memory.query" value="${escapeHtml(state.memory.query)}" placeholder="Search canonical memory" autocomplete="off" />
          <button class="primary" type="button" data-action="filter-memory" ${state.memoryLoading ? "disabled" : ""}>${state.memoryLoading ? "Loading..." : "Search"}</button>
        </div>
        <div class="memory-filter-row">
          <select data-field="memory.statusFilter" aria-label="Memory status">
            ${["active", "expired", "deleted", "superseded", "all"].map((value) => `<option value="${value}" ${state.memory.statusFilter === value ? "selected" : ""}>${value}</option>`).join("")}
          </select>
          <select data-field="memory.scopeFilter" aria-label="Memory scope">
            ${["all", "user", "workspace", "project", "agent"].map((value) => `<option value="${value}" ${state.memory.scopeFilter === value ? "selected" : ""}>${value}</option>`).join("")}
          </select>
          <select data-field="memory.kindFilter" aria-label="Memory kind">
            ${["all", "preference", "fact", "convention", "decision", "lesson"].map((value) => `<option value="${value}" ${state.memory.kindFilter === value ? "selected" : ""}>${value}</option>`).join("")}
          </select>
          <button class="secondary" data-action="export-memory" data-format="json">Export JSON</button>
          <button class="secondary" data-action="export-memory" data-format="jsonl">Export JSONL</button>
        </div>
      </div>
      ${renderMemoryOnboarding()}
      <div class="memory-status-table" aria-label="Memory activation effectiveness">
        <div><span>Turn contexts</span><strong>${escapeHtml(String(effectiveness?.turn_contexts || 0))}</strong></div>
        <div><span>Accepted recommendations</span><strong>${escapeHtml(String(effectiveness?.accepted_recommendations || 0))}</strong></div>
        <div><span>Acceptance rate</span><strong>${escapeHtml(`${Math.round(Number(effectiveness?.acceptance_rate || 0) * 100)}%`)}</strong></div>
        <div><span>Stale Task overlays</span><strong>${escapeHtml(String(effectiveness?.stale_overlays || 0))}</strong></div>
      </div>
      <p class="memory-correlation-note">${escapeHtml(effectiveness?.correlation_note || "Memory usage metrics report correlation only, not causation.")} ${escapeHtml(`${effectiveness?.evaluated_tasks_with_memory || 0}/${effectiveness?.evaluated_tasks || 0} evaluated Tasks have Memory context evidence.`)}</p>
      <div class="memory-record-list" aria-live="polite">
        <div class="memory-results-heading"><strong>${records.length} canonical memories</strong><small>Canonical records are soft-deleted and remain auditable.</small></div>
        ${records.map((memory) => {
          const editing = state.memory.editingId === memory.memory_id;
          return `<article class="memory-record-row ${memory.status !== "active" ? "is-muted" : ""}">
            <div class="memory-record-main">
              <div class="memory-record-meta"><span class="badge neutral">${escapeHtml(memory.kind)}</span><small>${escapeHtml(`${memory.scope_kind}:${memory.scope_id} / v${memory.version} / ${memory.status}`)}</small></div>
              ${editing ? `<textarea data-field="memory.editContent" rows="3">${escapeHtml(state.memory.editContent)}</textarea>` : `<p>${escapeHtml(memory.content)}</p>`}
              <small>${escapeHtml((memory.tags || []).join(" / ") || formatWorkspaceTimestamp(memory.updated_at))}</small>
            </div>
            <div class="memory-record-actions">
              ${editing
                ? `<button class="secondary" data-action="cancel-memory-edit">Cancel</button><button class="primary" data-action="save-memory-edit" data-memory-id="${escapeHtml(memory.memory_id)}" ${state.memory.saving || !state.memory.editContent.trim() ? "disabled" : ""}>Save</button>`
                : memory.status === "active"
                  ? `<button class="secondary" data-action="edit-memory" data-memory-id="${escapeHtml(memory.memory_id)}">Edit</button><button class="secondary danger-action" data-action="delete-memory" data-memory-id="${escapeHtml(memory.memory_id)}">Delete</button>`
                  : `<button class="secondary" data-action="restore-memory" data-memory-id="${escapeHtml(memory.memory_id)}">Restore</button>`}
            </div>
          </article>`;
        }).join("") || '<div class="product-empty"><strong>No memories in this view</strong><span>Change the filters or complete a task that contains durable preferences or decisions.</span></div>'}
      </div>
      <section class="memory-review-section">
        <div class="memory-results-heading"><strong>Pending review</strong><small>${candidates.length} candidate${candidates.length === 1 ? "" : "s"}</small></div>
        ${candidates.map((candidate) => `<article class="memory-candidate-row">
          <div><div class="memory-record-meta"><span class="badge ${candidate.risk === "high" ? "warn" : "neutral"}">${escapeHtml(candidate.risk)} risk</span><small>${escapeHtml(`${candidate.operation} / ${candidate.proposed_memory?.scope_kind || "workspace"}:${candidate.proposed_memory?.scope_id || candidate.workspace_id}`)}</small></div><p>${escapeHtml(candidate.proposed_memory?.content || candidate.rationale)}</p><small>${escapeHtml(candidate.rationale)}</small></div>
          <div class="memory-record-actions"><button class="secondary" data-action="reject-memory-candidate" data-candidate-id="${escapeHtml(candidate.candidate_id)}">Reject</button><button class="primary" data-action="approve-memory-candidate" data-candidate-id="${escapeHtml(candidate.candidate_id)}">Approve</button></div>
        </article>`).join("") || '<p class="muted">No inferred memory is waiting for review.</p>'}
      </section>
      <div class="memory-status-table">
        <div><span>Canonical journal</span><strong>${escapeHtml(String(retrieval?.journal_records || 0))}</strong></div>
        <div><span>Indexed</span><strong>${escapeHtml(String(retrieval?.indexed_records || 0))}</strong></div>
        <div><span>Queries / failures</span><strong>${escapeHtml(`${observability?.retrieval_queries || 0} / ${observability?.retrieval_failures || 0}`)}</strong></div>
        <div><span>Last latency</span><strong>${escapeHtml(observability?.retrieval_last_latency_ms == null ? "-" : `${observability.retrieval_last_latency_ms} ms`)}</strong></div>
      </div>
      <div class="memory-intelligence-status" aria-label="Memory Intelligence status">
        <div><span>Extraction</span><strong>${escapeHtml(settings?.intelligence?.extraction_mode || "deterministic")}</strong><small>${escapeHtml(`${observability?.model_extraction_successes || 0} success / ${observability?.model_extraction_fallbacks || 0} fallback`)}</small></div>
        <div><span>Automatic recall</span><strong>${escapeHtml(String(observability?.automatic_recall_hits || 0))} hits</strong><small>${escapeHtml(`${observability?.automatic_recall_cache_hits || 0} cache hits / ${observability?.automatic_recall_cache_misses || 0} misses / ${observability?.automatic_recall_last_latency_ms ?? "-"} ms`)}</small></div>
        <div><span>Intent model</span><strong>${settings?.intelligence?.intent_model_enabled ? "Enabled" : "Deterministic"}</strong><small>${escapeHtml(`${observability?.intent_model_successes || 0} success / ${observability?.intent_model_fallbacks || 0} fallback`)}</small></div>
        <div><span>Quality benchmark</span><strong>${escapeHtml(intelligenceEvaluation ? `${Math.round(Number(intelligenceEvaluation.accuracy || 0) * 100)}%` : "-")}</strong><small>${escapeHtml(intelligenceEvaluation ? `${intelligenceEvaluation.passed}/${intelligenceEvaluation.total} intents / ${intelligenceEvaluation.memory_operations?.passed || 0}/${intelligenceEvaluation.memory_operations?.total || 0} operations` : "Not evaluated")}</small></div>
      </div>
      <div class="memory-status-table">
        <div><span>Private storage</span><strong>AES-256-GCM</strong></div>
        <div><span>Private migrations</span><strong>${escapeHtml(String((observability?.private_memory_migrations || 0) + (observability?.private_candidate_migrations || 0)))}</strong></div>
        <div><span>Maintenance sweeps</span><strong>${escapeHtml(String(observability?.maintenance_sweeps || 0))}</strong></div>
        <div><span>Workspace failures</span><strong>${escapeHtml(String(observability?.maintenance_workspace_failures || 0))}</strong></div>
      </div>
      <section class="memory-recommendation-section">
        <div class="memory-results-heading"><strong>Current Task recommendations</strong><small>${state.memory.recommendations ? `${recommendations.length} relevant memories` : "Select a Task to inspect"}</small></div>
        <div data-memory-recommendation-list>${renderMemoryRecommendationListContent()}</div>
      </section>
      <details class="memory-advanced-section">
        <summary>Applied Memory history (${contexts.length})</summary>
        <div class="memory-context-list">${contexts.map((context) => `<article class="memory-context-row"><div><strong>${escapeHtml(context.context_id)}</strong><small>${escapeHtml(`${formatWorkspaceTimestamp(context.created_at)} / ${context.model || "unknown model"} / ${context.entries?.length || 0} entries`)}</small></div><details><summary>Inspect exact context</summary>${(context.entries || []).map((entry) => `<p><span class="badge neutral">${escapeHtml(entry.source)}</span> ${escapeHtml(`${entry.memory_id} v${entry.memory_version}`)} - ${escapeHtml(entry.content)}</p>`).join("") || '<p class="muted">No Memory entries.</p>'}</details></article>`).join("") || '<p class="muted">No provider turn has frozen a Memory context yet.</p>'}</div>
      </details>
      <details class="memory-advanced-section">
        <summary>Task overlays (${overlays.filter((item) => ["queued", "active", "stale"].includes(item.status)).length})</summary>
        <div class="memory-context-list">${overlays.filter((item) => ["queued", "active", "stale"].includes(item.status)).map((overlay) => `<article class="memory-context-row"><div><span><strong>${escapeHtml(`${overlay.entry.kind} memory`)}</strong><small>${escapeHtml(`${overlay.mode} / v${overlay.memory_version}`)}</small></span><span><span class="badge ${overlay.status === "stale" ? "warn" : "success"}">${escapeHtml(overlay.status)}</span> <button class="secondary" data-action="remove-memory-overlay" data-overlay-id="${escapeHtml(overlay.overlay_id)}" data-recommendation-id="">Remove</button></span></div><p>${escapeHtml(overlay.entry.content)}</p></article>`).join("") || '<p class="muted">No queued, active, or stale Task Memory overlays.</p>'}</div>
      </details>
      <div class="memory-provider-row">
        <span><strong>Embedding</strong><small>${escapeHtml(`${embedding?.provider_id || "disabled"}${embedding?.model ? ` / ${embedding.model}` : ""}`)}</small></span>
        <span class="badge ${embedding?.state === "ready" ? "success" : embedding?.state === "degraded" ? "warn" : "neutral"}">${escapeHtml(embedding?.state || "disabled")}</span>
        <span><strong>Knowledge graph</strong><small>${escapeHtml(knowledge?.provider_id || "disabled")}</small></span>
        <span class="badge ${knowledge?.state === "ready" ? "success" : knowledge?.state === "unavailable" || knowledge?.state === "degraded" ? "warn" : "neutral"}">${escapeHtml(knowledge?.state || "disabled")}</span>
      </div>
      <div class="memory-actions-row">
        <button class="secondary" data-action="rebuild-memory-index" ${state.memory.rebuilding ? "disabled" : ""}>${state.memory.rebuilding ? "Rebuilding..." : "Rebuild index"}</button>
        ${knowledge?.provider_id === "mempalace" && !knowledge?.read_only ? `<button class="secondary" data-action="rebuild-memory-knowledge" ${state.memory.rebuilding ? "disabled" : ""}>Sync knowledge graph</button>` : ""}
        <button class="secondary" data-action="run-memory-maintenance" ${state.memory.rebuilding ? "disabled" : ""}>Run maintenance</button>
        <button class="secondary" data-action="run-memory-maintenance-sweep" ${state.memory.rebuilding ? "disabled" : ""}>Maintain all Workspaces</button>
        <small>${maintenanceSweep ? `${escapeHtml(String(maintenanceSweep.maintained_workspaces || 0))} maintained / ${escapeHtml(String(maintenanceSweep.failed_workspaces?.length || 0))} failed` : maintenance ? `Last maintenance ${escapeHtml(formatWorkspaceTimestamp(maintenance.completed_at))}` : "Maintenance has not run yet"}</small>
      </div>
      <details class="memory-advanced-section">
        <summary>Retrieval diagnostics</summary>
        <div class="memory-search-row">
          <input data-field="memory.query" value="${escapeHtml(state.memory.query)}" placeholder="Run hybrid retrieval" autocomplete="off" />
          <button class="secondary" type="button" data-action="search-memory" ${state.memoryLoading || !state.memory.query.trim() ? "disabled" : ""}>Search index</button>
        </div>
        <div class="memory-results" aria-live="polite">
        ${result ? `<div class="memory-results-heading"><strong>${escapeHtml(String(result.count || 0))} results</strong><small>${escapeHtml(result.retrieval || "")}${result.embedding_fallback ? " / embedding fallback" : ""}</small></div>` : ""}
        ${hits.map((hit) => {
          const memory = hit.memory || {};
          const evidence = hit.evidence || {};
          return `<article class="memory-result-row"><div><strong>${escapeHtml(memory.kind || "memory")}</strong><p>${escapeHtml(memory.content || "")}</p><small>${escapeHtml(`${memory.scope_kind || "workspace"}:${memory.scope_id || ""} / v${memory.version || 1}`)}</small></div><div class="memory-result-score"><strong>${escapeHtml(Number(evidence.fused_score || 0).toFixed(4))}</strong><small>${escapeHtml((evidence.matched_by || []).join(" + "))}</small></div></article>`;
        }).join("") || (result ? '<p class="muted">No visible memories matched.</p>' : "")}
        </div>
      </details>
      ${settings ? `<details class="memory-advanced-section" open>
        <summary>Memory settings</summary>
        <div class="memory-settings-grid">
          <label><span>Background review</span><input type="checkbox" data-field="memory.settings.backgroundEnabled" ${settings.background_review.enabled ? "checked" : ""} /></label>
          <label><span>Automatic recall</span><input type="checkbox" data-field="memory.settings.recallEnabled" ${settings.automatic_recall.enabled ? "checked" : ""} /></label>
          <label><span>Extraction mode</span><select data-field="memory.settings.extractionMode"><option value="deterministic" ${settings.intelligence.extraction_mode === "deterministic" ? "selected" : ""}>Deterministic</option><option value="hybrid" ${settings.intelligence.extraction_mode === "hybrid" ? "selected" : ""}>Hybrid model review</option></select></label>
          <label><span>Model intent routing</span><input type="checkbox" data-field="memory.settings.intentModelEnabled" ${settings.intelligence.intent_model_enabled ? "checked" : ""} /></label>
          <label><span>Intelligence connection</span><select data-field="memory.settings.intelligenceConnectionId"><option value="">Use Conversation Provider</option>${state.providerConnections.filter((connection) => connection.status === "active" && connection.verification?.status === "verified" && connection.base_url).map((connection) => `<option value="${escapeHtml(connection.connection_id)}" ${settings.intelligence.provider_connection_id === connection.connection_id ? "selected" : ""}>${escapeHtml(connection.name)}</option>`).join("")}</select></label>
          <label><span>Intelligence model</span><input data-field="memory.settings.intelligenceModel" value="${escapeHtml(settings.intelligence.model || "")}" placeholder="Provider default model" /></label>
          <label><span>Turn character limit</span><input type="number" min="1000" max="100000" step="1000" data-field="memory.settings.maxTurnCharacters" value="${escapeHtml(String(settings.intelligence.max_turn_characters))}" /></label>
          <label><span>Minimum confidence</span><input type="number" min="0.5" max="1" step="0.01" data-field="memory.settings.minConfidence" value="${escapeHtml(String(settings.intelligence.min_confidence))}" /></label>
          <label><span>Model timeout (ms)</span><input type="number" min="1000" max="180000" step="1000" data-field="memory.settings.modelTimeout" value="${escapeHtml(String(settings.intelligence.model_timeout_ms))}" /></label>
          <label><span>Review minimum characters</span><input type="number" min="1" max="10000" data-field="memory.settings.minReviewCharacters" value="${escapeHtml(String(settings.background_review.min_user_characters))}" /></label>
          <label><span>Review candidate limit</span><input type="number" min="1" max="20" data-field="memory.settings.maxReviewCandidates" value="${escapeHtml(String(settings.background_review.max_candidates_per_review))}" /></label>
          <label><span>Recall result limit</span><input type="number" min="1" max="20" data-field="memory.settings.recallMaxResults" value="${escapeHtml(String(settings.automatic_recall.max_results))}" /></label>
          <label><span>Recall character budget</span><input type="number" min="500" max="20000" step="500" data-field="memory.settings.recallCharacterBudget" value="${escapeHtml(String(settings.automatic_recall.character_budget))}" /></label>
          <label><span>Recall cache TTL (seconds)</span><input type="number" min="0" max="3600" step="5" data-field="memory.settings.recallCacheTtl" value="${escapeHtml(String(settings.automatic_recall.cache_ttl_seconds ?? 60))}" /></label>
          <label><span>Project memory</span><input type="checkbox" data-field="memory.settings.projectEnabled" ${settings.scope_policy.project_memory_enabled ? "checked" : ""} /></label>
          <label><span>Agent memory</span><input type="checkbox" data-field="memory.settings.agentEnabled" ${settings.scope_policy.agent_memory_enabled ? "checked" : ""} /></label>
          <label><span>Resolved candidate retention</span><input type="number" min="1" max="3650" data-field="memory.settings.retentionDays" value="${escapeHtml(String(settings.retention.resolved_candidate_days))}" /></label>
          <label><span>Journal record limit</span><input type="number" min="100" max="1000000" data-field="memory.settings.journalLimit" value="${escapeHtml(String(settings.retention.journal_max_records))}" /></label>
          <label><span>Embedding provider</span><select data-field="memory.settings.embeddingProvider"><option value="disabled" ${settings.embedding.provider === "disabled" ? "selected" : ""}>Disabled</option><option value="openai-compatible" ${settings.embedding.provider === "openai-compatible" ? "selected" : ""}>OpenAI compatible</option></select></label>
          <label><span>Provider connection</span><select data-field="memory.settings.connectionId"><option value="">Select connection</option>${state.providerConnections.filter((connection) => connection.status === "active").map((connection) => `<option value="${escapeHtml(connection.connection_id)}" ${settings.embedding.provider_connection_id === connection.connection_id ? "selected" : ""}>${escapeHtml(connection.name)}</option>`).join("")}</select></label>
          <label><span>Embedding model</span><input data-field="memory.settings.embeddingModel" value="${escapeHtml(settings.embedding.model || "")}" placeholder="text-embedding-3-small" /></label>
          <label><span>Knowledge graph</span><select data-field="memory.settings.knowledgeProvider"><option value="disabled" ${settings.knowledge_graph.provider === "disabled" ? "selected" : ""}>Disabled</option><option value="mempalace" ${settings.knowledge_graph.provider === "mempalace" ? "selected" : ""}>MemPalace</option></select></label>
          <label class="memory-settings-wide"><span>MemPalace path</span><input data-field="memory.settings.palacePath" value="${escapeHtml(settings.knowledge_graph.palace_path || "")}" /></label>
        </div>
        <div class="memory-actions-row"><button class="primary" data-action="save-memory-settings" ${state.memory.saving ? "disabled" : ""}>${state.memory.saving ? "Saving..." : "Save settings"}</button></div>
      </details>` : ""}
      <details class="memory-advanced-section">
        <summary>Import memory</summary>
        <textarea data-field="memory.importText" rows="6" placeholder="Paste a JSON bundle or JSONL">${escapeHtml(state.memory.importText)}</textarea>
        <div class="memory-filter-row"><select data-field="memory.importStrategy">${["skip", "merge", "replace"].map((value) => `<option value="${value}" ${state.memory.importStrategy === value ? "selected" : ""}>${value}</option>`).join("")}</select><label class="memory-inline-check"><input type="checkbox" data-field="memory.importDryRun" ${state.memory.importDryRun ? "checked" : ""} /><span>Dry run</span></label><button class="primary" data-action="import-memory" ${!state.memory.importText.trim() || state.memory.saving ? "disabled" : ""}>Import</button></div>
        ${state.memory.importResult ? `<p class="muted">${escapeHtml(`${state.memory.importResult.created} create, ${state.memory.importResult.updated} update, ${state.memory.importResult.skipped} skip, ${state.memory.importResult.rejected} reject`)}</p>` : ""}
      </details>
    </section>
  `;
}

function renderDesktopCenter(readOnly, warnings, preview) {
  if (state.activeNav === "orchestrator") {
    return renderOrchestratorWorkbench();
  }
  if (state.activeNav === "missions" || state.activeNav === "sessions") {
    return renderMissionWorkspace();
  }
  if (state.activeNav === "inbox") {
    return renderInboxWorkspace();
  }
  if (state.activeNav === "library") {
    return renderLibraryWorkspace();
  }
  if (state.activeNav === "dashboard") {
    return renderDashboardWorkspace();
  }
  if (state.activeNav === "memory") {
    return renderMemoryWorkspace();
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
  if (state.activeNav === "operations") {
    return renderSettingsPanel();
  }
  return renderProductSettingsPanel();
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

function captureTaskWorkspaceScroll() {
  const sessionId = state.activeNav === "orchestrator"
    ? state.workspaceDetail?.session?.session_id || ""
    : "";
  if (!sessionId) return null;

  const center = document.querySelector(".task-workspace-grid .desktop-center");
  const taskList = document.querySelector(".orchestrator-sidebar .template-list");
  const chatFeed = document.querySelector(".task-conversation-rail .orchestrator-chat-feed");
  const distanceFromChatBottom = chatFeed
    ? Math.max(0, chatFeed.scrollHeight - chatFeed.clientHeight - chatFeed.scrollTop)
    : 0;

  return {
    sessionId,
    centerTop: center?.scrollTop || 0,
    taskListTop: taskList?.scrollTop || 0,
    chatTop: chatFeed?.scrollTop || 0,
    chatPinnedToBottom: distanceFromChatBottom <= 48,
    windowX: window.scrollX,
    windowY: window.scrollY,
  };
}

function restoreTaskWorkspaceScroll(snapshot) {
  if (!snapshot) return;
  const sessionId = state.activeNav === "orchestrator"
    ? state.workspaceDetail?.session?.session_id || ""
    : "";
  if (!sessionId || snapshot.sessionId !== sessionId) return;

  const restore = () => {
    if (state.workspaceDetail?.session?.session_id !== snapshot.sessionId) return;
    const center = document.querySelector(".task-workspace-grid .desktop-center");
    const taskList = document.querySelector(".orchestrator-sidebar .template-list");
    const chatFeed = document.querySelector(".task-conversation-rail .orchestrator-chat-feed");
    if (center) center.scrollTop = snapshot.centerTop;
    if (taskList) taskList.scrollTop = snapshot.taskListTop;
    if (chatFeed) {
      chatFeed.scrollTop = snapshot.chatPinnedToBottom
        ? chatFeed.scrollHeight
        : Math.min(snapshot.chatTop, Math.max(0, chatFeed.scrollHeight - chatFeed.clientHeight));
    }
    if (window.matchMedia("(max-width: 1180px)").matches) {
      window.scrollTo(snapshot.windowX, snapshot.windowY);
    }
  };

  restore();
  window.requestAnimationFrame(restore);
}

function renderTaskWorkspaceSurface() {
  studioPerformance.taskSurfaceRenderCount += 1;
  publishStudioPerformance();
  const workspaceSession = state.workspaceDetail?.session || null;
  const shell = document.querySelector(".app-shell");
  const workspace = shell?.querySelector(":scope > .workspace");
  const desktopGrid = workspace?.querySelector(".desktop-grid");
  const center = desktopGrid?.querySelector(":scope > .desktop-center");
  if (state.activeNav !== "orchestrator" || !workspaceSession || !shell || !workspace || !desktopGrid || !center) {
    render();
    return;
  }

  const preservedTaskScroll = captureTaskWorkspaceScroll();
  const guidance = buildTaskExperience(state.workspaceDetail).guidance;
  const title = workspaceSession.title || "Tasks";
  const subtitle = guidance?.detail || "Continue the task or review its current result.";
  const badgeLabel = guidance?.statusLabel || "ready";
  const badgeTone = guidance?.tone || statusTone(badgeLabel);
  const readOnly = ["published", "archived"].includes(state.editor.status);
  const warnings = validateGraph();
  const selectedTemplate = state.templates.find((item) => item.template_id === state.selectedId) || null;
  const preview = selectedTemplate || buildDraftPayload();

  shell.classList.add("task-shell-active");
  workspace.classList.remove("task-switch-pending");
  workspace.removeAttribute("aria-busy");
  updateTaskInventorySelection(workspaceSession.session_id);

  const heading = workspace.querySelector(".topbar h2");
  if (heading) heading.textContent = title;
  const topbarDescription = workspace.querySelector(".topbar > div > p");
  if (topbarDescription) topbarDescription.textContent = subtitle;
  const badge = workspace.querySelector(".topbar .badge");
  if (badge) {
    badge.className = `badge ${badgeTone}`;
    badge.textContent = badgeLabel;
  }
  const actions = workspace.querySelector(".topbar .actions");
  if (actions) {
    actions.innerHTML = `${state.ui.taskConversationVisible ? "" : '<button class="icon-button" data-action="show-task-conversation" title="Show conversation" aria-label="Show conversation">&#9776;</button>'}<button class="primary" data-action="new-task">New task</button>`;
  }

  for (const child of [...workspace.children]) {
    if (child.classList?.contains("alert")) child.remove();
  }
  const alerts = [
    state.error ? `<div class="alert danger">${escapeHtml(state.error)}</div>` : "",
    state.notice ? `<div class="alert success">${escapeHtml(state.notice)}</div>` : "",
    state.streamError ? `<div class="alert warn">${escapeHtml(state.streamError)}</div>` : "",
  ].filter(Boolean).join("");
  if (alerts) desktopGrid.insertAdjacentHTML("beforebegin", alerts);

  desktopGrid.className = `desktop-grid task-workspace-grid ${state.ui.taskConversationVisible ? "" : "task-conversation-hidden"}`.trim();
  center.innerHTML = renderDesktopCenter(readOnly, warnings, preview);
  const existingRail = [...desktopGrid.children].find((child) => child !== center) || null;
  const railHtml = state.ui.taskConversationVisible ? renderOrchestratorRail() : "";
  if (existingRail && railHtml) {
    existingRail.outerHTML = railHtml;
  } else if (existingRail) {
    existingRail.remove();
  } else if (railHtml) {
    desktopGrid.insertAdjacentHTML("beforeend", railHtml);
  }

  afterRender();
  restoreTaskWorkspaceScroll(preservedTaskScroll);
}

function render() {
  studioPerformance.fullRenderCount += 1;
  publishStudioPerformance();
  const readOnly = ["published", "archived"].includes(state.editor.status);
  const warnings = validateGraph();
  const selectedTemplate = state.templates.find((item) => item.template_id === state.selectedId) || null;
  const preview = selectedTemplate || buildDraftPayload();
  const workspaceSession = state.workspaceDetail?.session || null;
  const taskGuidance = state.activeNav === "orchestrator" && workspaceSession
    ? buildTaskExperience(state.workspaceDetail).guidance
    : null;
  const workspaceTitle =
    state.activeNav === "orchestrator"
      ? workspaceSession?.title || "Tasks"
      : state.activeNav === "inbox"
        ? "Inbox"
      : state.activeNav === "library"
        ? "Library"
      : state.activeNav === "settings"
        ? "Settings"
      : state.activeNav === "missions" || state.activeNav === "sessions"
        ? workspaceSession?.title || "Mission Workspace"
        : state.activeNav === "dashboard"
          ? "Unified Dashboard"
          : state.activeNav === "memory"
            ? "Memory"
          : state.activeNav === "templates"
        ? state.editor.name
        : state.activeNav === "agents"
          ? "Subagent Hosting"
        : state.activeNav === "registry"
          ? "Registry Workspace"
          : "System Details";
  const workspaceSubtitle =
    state.activeNav === "orchestrator"
      ? workspaceSession
        ? taskGuidance?.detail || "Continue the task or review its current result."
        : "Describe an outcome. My Mate handles planning, model selection, and execution details."
      : state.activeNav === "inbox"
        ? "Approvals, questions, and blocked tasks that specifically need you."
      : state.activeNav === "library"
        ? "Reusable workflows and results without exposing authoring internals."
      : state.activeNav === "settings"
        ? "Configure a model, verify this machine, and manage your workspace."
      : state.activeNav === "missions" || state.activeNav === "sessions"
        ? workspaceSession?.workspace_state?.next_recommended_detail ||
          state.workspaceDetail?.mission_snapshot?.nextActionDetail ||
          "Mission-first workspace for brief, work, checkpoints, outputs, and runtime."
      : state.activeNav === "dashboard"
          ? "Inspect platform workload, operator backlog, and runtime posture in one view."
          : state.activeNav === "memory"
            ? "Inspect hybrid retrieval indexes and optional knowledge providers."
          : state.activeNav === "templates"
        ? `${state.editor.templateId || "unsaved draft"}${state.editor.updatedAt ? ` / updated ${new Date(state.editor.updatedAt).toLocaleString()}` : ""}`
        : state.activeNav === "agents"
          ? "Manage runtime subagent bindings, providers, and model intent."
        : state.activeNav === "registry"
          ? "Manage reusable agent profiles and skills."
          : "Observe runtime, planner, and registry ownership boundaries.";
  const titleBadge =
    state.activeNav === "orchestrator"
      ? taskGuidance?.statusLabel || "ready"
      : state.activeNav === "inbox"
        ? `${getInboxOpenCount()} open`
      : state.activeNav === "library"
        ? `${state.templates.filter((template) => template.status === "published").length} workflows`
      : state.activeNav === "settings"
        ? state.providerConnections.some((connection) => connection.verification?.status === "verified") ? "ready" : "check"
      : state.activeNav === "memory"
        ? state.memory.retrievalStatus?.retrieval || "memory"
      : state.activeNav === "templates"
        ? `${state.editor.status}${state.editor.version ? ` v${state.editor.version}` : ""}`
        : state.activeNav === "missions" || state.activeNav === "sessions"
        ? workspaceSession?.status || "idle"
        : state.activeNav;
  const titleBadgeTone = state.activeNav === "orchestrator" && taskGuidance
    ? taskGuidance.tone
    : statusTone(titleBadge);
  const taskWorkspaceActive = state.activeNav === "orchestrator" && !!workspaceSession;
  const preservedTaskScroll = captureTaskWorkspaceScroll();

  document.getElementById("root").innerHTML = `
    <main class="app-shell ${taskWorkspaceActive ? "task-shell-active" : ""}">
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
            <h1>Task Workspace</h1>
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
              <span class="badge ${escapeHtml(titleBadgeTone)}">${escapeHtml(titleBadge)}</span>
            </div>
            <p>${escapeHtml(workspaceSubtitle || "")}</p>
          </div>
          <div class="actions">
            ${state.activeNav === "orchestrator"
              ? workspaceSession ? `${state.ui.taskConversationVisible ? "" : '<button class="icon-button" data-action="show-task-conversation" title="Show conversation" aria-label="Show conversation">&#9776;</button>'}<button class="primary" data-action="new-task">New task</button>` : ""
              : state.activeNav === "inbox"
                ? `<button class="primary" data-action="refresh-inbox" ${state.inbox.loading ? "disabled" : ""}>${state.inbox.loading ? "Refreshing..." : "Refresh"}</button>`
              : state.activeNav === "library"
                ? `<button class="secondary" data-action="refresh">Refresh library</button>`
              : state.activeNav === "settings"
                ? `<button class="primary" data-action="open-studio-setup">Run setup</button>`
              : state.activeNav === "memory"
                ? `<button class="secondary" data-action="refresh-memory" ${state.memoryLoading ? "disabled" : ""}>${state.memoryLoading ? "Refreshing..." : "Refresh"}</button>`
              : state.activeNav === "templates"
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

        <div class="desktop-grid ${taskWorkspaceActive ? "task-workspace-grid" : ""} ${taskWorkspaceActive && !state.ui.taskConversationVisible ? "task-conversation-hidden" : ""} ${["inbox", "library", "settings", "operations", "memory"].includes(state.activeNav) || (state.activeNav === "orchestrator" && !workspaceSession) ? "product-single-column" : ""}">
          <div class="desktop-center">
            ${renderDesktopCenter(readOnly, warnings, preview)}
          </div>
          ${state.activeNav === "orchestrator" && workspaceSession && state.ui.taskConversationVisible ? renderOrchestratorRail() : state.activeNav === "missions" || state.activeNav === "sessions" || state.activeNav === "dashboard" || state.activeNav === "templates" || state.activeNav === "agents" || state.activeNav === "registry" ? renderDesktopRail() : ""}
        </div>
      </section>
    </main>
    ${renderProviderConnectionModal()}
    ${renderMcpServerModal()}
    ${renderStudioSetupModal()}
    ${renderWorkspaceCreator()}
    ${renderArtifactPreviewModal()}
    ${renderCommandPalette()}
  `;
  afterRender();
  restoreTaskWorkspaceScroll(preservedTaskScroll);
}

function handleChange(target) {
  const field = target.dataset.field;
  if (!field) return;
  const value = target.value;
  const index = Number(target.dataset.index);

  if (field === "setup.connectionId") {
    if (value === NEW_SETUP_CONNECTION_ID) {
      state.registryEditor.connection = createSetupConnectionEditor();
    } else {
      const connection = state.providerConnections.find((item) => item.connection_id === value);
      if (connection) state.registryEditor.connection = editorFromProviderConnection(connection);
    }
    state.setup.editorTouched = false;
    state.setup.error = null;
    render();
    return;
  }
  if (state.setup.open && (field.startsWith("connection.") || field === "setup.model")) {
    state.setup.editorTouched = true;
  }

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
  if (field === "desktop.projectName") {
    state.desktop.projectDraft.name = value;
    document
      .querySelectorAll('[data-action="create-desktop-project"], [data-action="create-sidebar-project"]')
      .forEach((createButton) => {
        createButton.disabled = state.desktop.loading || !value.trim();
      });
    return;
  }
  if (field === "desktop.projectDescription") {
    state.desktop.projectDraft.description = value;
    return;
  }
  if (field === "desktop.outputRelativePath") {
    state.desktop.projectDraft.outputRelativePath = value;
    return;
  }
  if (field === "desktop.taskSidebarQuery") {
    state.ui.taskSidebarQuery = value;
    clearTimeout(taskSidebarSearchTimer);
    taskSidebarSearchTimer = setTimeout(() => {
      render();
      const input = document.querySelector('input[data-field="desktop.taskSidebarQuery"]');
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    }, 120);
    return;
  }
  if (field === "command.query") {
    state.commandPaletteQuery = value;
    state.commandPaletteIndex = 0;
    queueCommandPaletteFocus("end");
    render();
    return;
  }
  if (field === "dashboard.windowHours") {
    state.dashboardFilters.windowHours = Number(value) || 24;
    void loadDashboardSummary();
    return;
  }
  if (field === "dashboard.status") {
    state.dashboardFilters.status = value || "all";
    void loadDashboardSummary();
    return;
  }
  if (field === "dashboard.comparePrevious") {
    state.dashboardFilters.comparePrevious = target.checked === true;
    void loadDashboardSummary();
    return;
  }
  if (field === "memory.query") {
    state.memory.query = value;
    const searchButton = document.querySelector('[data-action="search-memory"]');
    if (searchButton) searchButton.disabled = state.memoryLoading || !value.trim();
    return;
  }
  if (field === "memory.statusFilter" || field === "memory.scopeFilter" || field === "memory.kindFilter") {
    const key = field.split(".").at(-1);
    state.memory[key] = value;
    void loadMemoryStatus();
    return;
  }
  if (field === "memory.editContent") {
    state.memory.editContent = value;
    const saveButton = document.querySelector('[data-action="save-memory-edit"]');
    if (saveButton) saveButton.disabled = state.memory.saving || !value.trim();
    return;
  }
  if (field === "memory.importText") {
    state.memory.importText = value;
    const importButton = document.querySelector('[data-action="import-memory"]');
    if (importButton) importButton.disabled = state.memory.saving || !value.trim();
    return;
  }
  if (field === "memory.importStrategy") {
    state.memory.importStrategy = value;
    return;
  }
  if (field === "memory.importDryRun") {
    state.memory.importDryRun = target.checked === true;
    return;
  }
  if (field === "memory.onboarding.responsePreferences") {
    state.memory.onboardingDraft.responsePreferences = value;
    return;
  }
  if (field === "memory.onboarding.validationConventions") {
    state.memory.onboardingDraft.validationConventions = value;
    return;
  }
  if (field === "memory.onboarding.projectConventions") {
    state.memory.onboardingDraft.projectConventions = value;
    return;
  }
  if (field === "memory.onboarding.private") {
    state.memory.onboardingDraft.private = target.checked === true;
    return;
  }
  if (field.startsWith("memory.settings.") && state.memory.settings) {
    const settings = state.memory.settings;
    if (field === "memory.settings.backgroundEnabled") settings.background_review.enabled = target.checked === true;
    if (field === "memory.settings.recallEnabled") settings.automatic_recall.enabled = target.checked === true;
    if (field === "memory.settings.extractionMode") settings.intelligence.extraction_mode = value;
    if (field === "memory.settings.intentModelEnabled") settings.intelligence.intent_model_enabled = target.checked === true;
    if (field === "memory.settings.intelligenceConnectionId") settings.intelligence.provider_connection_id = value || null;
    if (field === "memory.settings.intelligenceModel") settings.intelligence.model = value || null;
    if (field === "memory.settings.maxTurnCharacters") settings.intelligence.max_turn_characters = Number(value) || 12000;
    if (field === "memory.settings.minConfidence") settings.intelligence.min_confidence = Number(value) || 0.72;
    if (field === "memory.settings.modelTimeout") settings.intelligence.model_timeout_ms = Number(value) || 45000;
    if (field === "memory.settings.minReviewCharacters") settings.background_review.min_user_characters = Number(value) || 24;
    if (field === "memory.settings.maxReviewCandidates") settings.background_review.max_candidates_per_review = Number(value) || 3;
    if (field === "memory.settings.recallMaxResults") settings.automatic_recall.max_results = Number(value) || 4;
    if (field === "memory.settings.recallCharacterBudget") settings.automatic_recall.character_budget = Number(value) || 4000;
    if (field === "memory.settings.recallCacheTtl") settings.automatic_recall.cache_ttl_seconds = Math.max(0, Math.min(3600, Number(value) || 0));
    if (field === "memory.settings.projectEnabled") settings.scope_policy.project_memory_enabled = target.checked === true;
    if (field === "memory.settings.agentEnabled") settings.scope_policy.agent_memory_enabled = target.checked === true;
    if (field === "memory.settings.retentionDays") settings.retention.resolved_candidate_days = Number(value) || 90;
    if (field === "memory.settings.journalLimit") settings.retention.journal_max_records = Number(value) || 20000;
    if (field === "memory.settings.embeddingProvider") settings.embedding.provider = value;
    if (field === "memory.settings.connectionId") settings.embedding.provider_connection_id = value || null;
    if (field === "memory.settings.embeddingModel") settings.embedding.model = value || null;
    if (field === "memory.settings.knowledgeProvider") settings.knowledge_graph.provider = value;
    if (field === "memory.settings.palacePath") settings.knowledge_graph.palace_path = value || null;
    return;
  }
  if (field === "governance.policy.mode") {
    state.governance.policy.mode = value;
    return;
  }
  if (field === "governance.policy.requiredApprovals") {
    state.governance.policy.required_approvals = Math.max(1, Math.min(5, Number(value) || 1));
    return;
  }
  if (field === "governance.policy.allowSelfApproval") {
    state.governance.policy.allow_self_approval = target.checked === true;
    return;
  }
  if (field === "governance.draft.action") {
    state.governance.draft.action = value;
    return;
  }
  if (field === "governance.draft.resourceId") {
    state.governance.draft.resourceId = value;
    return;
  }
  if (field === "governance.draft.reason") {
    state.governance.draft.reason = value;
    return;
  }
  if (field === "governance.draft.payloadText") {
    state.governance.draft.payloadText = value;
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
  if (field === "route-compare.left") {
    setRouteCompareSelection("left", value);
    void refreshSelectedRouteCompare();
    return;
  }
  if (field === "route-compare.right") {
    setRouteCompareSelection("right", value);
    void refreshSelectedRouteCompare();
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
    const taskAction = document.querySelector('[data-action="orchestrator-send-message"]');
    if (taskAction) taskAction.disabled = state.planning || !value.trim();
    return;
  }
  if (field === "planner.conversationTarget") {
    const target = parseConversationTargetValue(value);
    state.planner.conversationProviderConnectionId = target?.connectionId || "";
    state.planner.conversationModel = target?.model || "";
    state.planner.error = null;
    render();
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
  if (field?.startsWith("mcp.")) {
    const key = field.slice(4);
    if (key === "presetId") {
      const preset = state.mcpConnectorPresets.find((item) => item.preset_id === value);
      state.registryEditor.mcpServer = preset ? editorFromMcpConnectorPreset(preset) : emptyMcpServerEditor();
      state.error = null;
      render();
      return;
    }
    if (key.startsWith("secret.")) {
      const secretName = key.slice(7);
      state.registryEditor.mcpServer.presetSecretValues[secretName] = value;
      state.error = null;
    }
    else if (key === "serverId") state.registryEditor.mcpServer.serverId = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, ".").replace(/^\.+|\.+$/gu, "");
    else if (key === "enabled") state.registryEditor.mcpServer.enabled = target.checked;
    else if (["connectTimeoutMs", "toolTimeoutMs"].includes(key)) state.registryEditor.mcpServer[key] = Number(value);
    else state.registryEditor.mcpServer[key] = value;
    if (key === "transport") render();
    return;
  }
  if (field === "agent.profileId") updateAgentProfileEditor({ profileId: slugify(value) });
  if (field === "agent.status") updateAgentProfileEditor({ status: value });
  if (field === "agent.name") updateAgentProfileEditor({ name: value });
  if (field === "agent.description") updateAgentProfileEditor({ description: value });
  if (field === "agent.agentRuntime") {
    const selected = state.providerConnections.find(
      (connection) => connection.connection_id === state.registryEditor.profile.providerConnectionId,
    );
    const compatible = state.providerConnections.filter(
      (connection) => connection.agent_runtime === value && connection.status === "active",
    );
    const nextConnection = selected?.agent_runtime === value
      ? selected
      : compatible.length === 1
        ? compatible[0]
        : null;
    updateAgentProfileEditor({
      agentRuntime: value,
      providerConnectionId: nextConnection?.connection_id || "",
      openclawProvider: nextConnection?.provider || state.registryEditor.profile.openclawProvider,
    });
    render();
    return;
  }
  if (field === "agent.providerConnectionId") {
    const selected = state.providerConnections.find((connection) => connection.connection_id === value);
    updateAgentProfileEditor({
      providerConnectionId: value,
      agentRuntime: selected?.agent_runtime || state.registryEditor.profile.agentRuntime,
      openclawProvider: selected?.provider || state.registryEditor.profile.openclawProvider,
      openclawAgentId: selected?.models?.includes(state.registryEditor.profile.openclawAgentId)
        ? state.registryEditor.profile.openclawAgentId
        : "",
    });
    render();
    return;
  }
  if (field === "agent.harnessProfile") updateAgentProfileEditor({ harnessProfile: value });
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
  if (field === "connection.connectionId") {
    updateProviderConnectionEditor({ connectionId: slugify(value) });
  }
  if (field === "connection.status") updateProviderConnectionEditor({ status: value });
  if (field === "connection.name") updateProviderConnectionEditor({ name: value });
  if (field === "connection.preset") {
    const preset = PROVIDER_PRESETS[value] || PROVIDER_PRESETS.custom;
    const model = preset.model || "";
    const defaults = PROVIDER_DEFAULTS[preset.runtime] || {};
    updateProviderConnectionEditor({
      preset: value,
      agentRuntime: preset.runtime,
      provider: preset.provider,
      protocol: preset.protocol,
      baseUrl: "",
      models: [model],
      defaultModel: model,
      credentialEnv: defaults.credentialEnv || "",
      ...(state.setup.open && state.registryEditor.connection.mode === "new"
        ? { name: `${preset.label} default` }
        : {}),
    });
    render();
    return;
  }
  if (field === "connection.agentRuntime") {
    const defaults = PROVIDER_DEFAULTS[value] || {};
    updateProviderConnectionEditor({
      agentRuntime: value,
      provider: defaults.provider || value,
      credentialEnv: defaults.credentialEnv || "",
    });
    render();
    return;
  }
  if (field === "connection.protocol") updateProviderConnectionEditor({ protocol: value });
  if (field === "connection.provider") updateProviderConnectionEditor({ provider: value });
  if (field === "connection.baseUrl") updateProviderConnectionEditor({ baseUrl: value });
  if (field === "setup.model") {
    const previous = state.registryEditor.connection.defaultModel;
    const models = [...state.registryEditor.connection.models];
    const index = Math.max(0, models.indexOf(previous));
    models[index] = value;
    updateProviderConnectionEditor({ models, defaultModel: value });
  }
  if (field === "connection.model") {
    const models = [...state.registryEditor.connection.models];
    const previous = models[index] || "";
    models[index] = value;
    const shouldDefault = !state.registryEditor.connection.defaultModel || state.registryEditor.connection.defaultModel === previous;
    updateProviderConnectionEditor({
      models,
      ...(shouldDefault ? { defaultModel: value } : {}),
    });
    const radio = target.closest(".provider-model-row")?.querySelector('input[type="radio"]');
    if (radio) {
      radio.value = value;
      if (shouldDefault) radio.checked = true;
    }
    const countLabel = target.closest(".provider-modal")?.querySelector(".provider-model-header span");
    if (countLabel) countLabel.textContent = `${models.filter((item) => item.trim()).length} configured`;
  }
  if (field === "connection.defaultModelChoice") {
    updateProviderConnectionEditor({ defaultModel: state.registryEditor.connection.models[index] || "" });
  }
  if (field === "connection.apiKey") updateProviderConnectionEditor({ apiKey: value });
  if (field === "connection.credentialSource") {
    updateProviderConnectionEditor({ credentialSource: value });
    render();
    return;
  }
  if (field === "connection.credentialEnv") updateProviderConnectionEditor({ credentialEnv: value });
  if (field === "connection.maxInputTokens") updateProviderConnectionEditor({ maxInputTokens: Number(value) });
  if (field === "connection.maxOutputTokens") updateProviderConnectionEditor({ maxOutputTokens: Number(value) });
  if (field === "connection.contextCompressionEnabled") updateProviderConnectionEditor({ contextCompressionEnabled: target.checked });
  if (field === "connection.contextCompressionThresholdPercent") updateProviderConnectionEditor({ contextCompressionThresholdPercent: Number(value) });
  if (field === "connection.maxContinuationRounds") updateProviderConnectionEditor({ maxContinuationRounds: Number(value) });
  if (field === "connection.metadataText") updateProviderConnectionEditor({ metadataText: value });
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
  if (field === "edge.from_port") updateEdge(index, { from_port: value.trim() || null });
  if (field === "edge.to_port") updateEdge(index, { to_port: value.trim() || null });
  if (field === "edge.label") updateEdge(index, { label: value || null });
  if (field === "edge.condition") {
    if (!value.trim()) updateEdge(index, { condition: null });
    else {
      const parsed = parseJsonObject(value);
      if (parsed.ok) updateEdge(index, { condition: parsed.value });
    }
  }
}

function syncTextareaState(target) {
  const field = target.dataset.field;
  if (!field) return;
  const value = target.value;
  const index = Number(target.dataset.index);

  if (field === "memory.editContent" || field === "memory.importText") {
    handleChange(target);
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
    const taskAction = document.querySelector('[data-action="orchestrator-send-message"]');
    if (taskAction) taskAction.disabled = state.planning || !value.trim();
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
  if (field === "connection.metadataText") state.registryEditor.connection.metadataText = value;
  if (field?.startsWith("mcp.")) state.registryEditor.mcpServer[field.slice(4)] = value;
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

function selectRuntimeNode(nodeRunId) {
  if (!nodeRunId) return;
  state.ui.runtimeNodeRunId = nodeRunId;
  state.ui.runtimeDrawerOpen = true;
  pendingRuntimeNodeFocus = true;
  buildStudioLocationState();
  render();
}

function fitRuntimeGraphToView(source) {
  const panel = source.closest(".runtime-graph-v2");
  const viewport = panel?.querySelector("[data-runtime-graph-viewport]");
  const model = getCurrentRuntimeGraphModel();
  if (!viewport || !model.layout?.width || !model.layout?.height) return;
  const horizontal = Math.max(240, viewport.clientWidth - 32) / model.layout.width;
  const vertical = Math.max(220, viewport.clientHeight - 32) / model.layout.height;
  state.ui.runtimeGraphZoom = Math.max(0.5, Math.min(1.2, horizontal, vertical));
  render();
}

document.addEventListener("click", (event) => {
  if (event.target.matches?.(".workspace-modal-backdrop")) {
    closeWorkspaceCreator();
    return;
  }
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
    switchDesktopNav(button.dataset.nav || "orchestrator");
  }
  if (action === "switch-navigation-tab") {
    switchDesktopNavigationTab(button.dataset.tab || "task");
    return;
  }
  if (action === "new-task") {
    void beginNewTaskInProject(button.dataset.projectId || state.desktop.workspace?.projectId || "");
    return;
  }
  if (action === "select-sidebar-project") {
    void beginNewTaskInProject(button.dataset.projectId || "");
    return;
  }
  if (action === "open-workspace-creator") {
    openWorkspaceCreator(false);
    return;
  }
  if (action === "close-workspace-creator") {
    closeWorkspaceCreator();
    return;
  }
  if (action === "add-sidebar-workspace") {
    void chooseDesktopWorkspace(state.ui.workspaceCreatorStartTask);
    return;
  }
  if (action === "create-sidebar-project") {
    void createDesktopProject(state.ui.workspaceCreatorStartTask);
    return;
  }
  if (action === "hide-task-conversation") {
    state.ui.taskConversationVisible = false;
    render();
  }
  if (action === "show-task-conversation") {
    state.ui.taskConversationVisible = true;
    render();
    document.querySelector('textarea[data-field="planner.intent"]')?.focus();
  }
  if (action === "refresh-inbox") void loadInbox();
  if (action === "select-workspace-change-set") {
    selectWorkspaceChangeSetForReview(button.dataset.changeSetId || "");
  }
  if (action === "select-workspace-change-file") {
    selectWorkspaceChangeFileForReview(button.dataset.path || "");
  }
  if (action === "stage-workspace-change-action") {
    state.inbox.confirmWorkspaceChangeAction = button.dataset.mode || "";
    render();
  }
  if (action === "cancel-workspace-change-action") {
    state.inbox.confirmWorkspaceChangeAction = "";
    render();
  }
  if (action === "confirm-workspace-change-action") {
    void resolveWorkspaceChangeSet(button.dataset.mode || "");
  }
  if (action === "open-inbox-task") {
    const sessionId = button.dataset.sessionId || "";
    if (sessionId) void openSessionFromCommand("orchestrator", sessionId);
  }
  if (action === "open-supervision-alert-task") {
    const sessionId = button.dataset.sessionId || "";
    void openSupervisionAlertRecommendation(sessionId, button.dataset.recommendedAction || "");
  }
  if (action === "resolve-supervision-alert") {
    void resolveSupervisionAlert(button.dataset.alertId || "");
  }
  if (action === "use-library-workflow") {
    state.planner.templateId = button.dataset.id || "";
    state.activeNav = "orchestrator";
    state.selectedSessionId = null;
    state.workspaceDetail = null;
    state.notice = "Workflow selected. Describe the outcome to start the task.";
    buildStudioLocationState();
    render();
  }
  if (action === "open-workflow-builder") {
    switchDesktopNav("templates");
  }
  if (action === "save-autonomy-mode") {
    void saveProductAutonomyMode(button.dataset.mode || "assisted");
  }
  if (action === "open-environment-setup") {
    openStudioSetup("environment");
    if (!state.setup.hostReport && !state.setup.dockerReport) void runSetupEnvironmentChecks();
  }
  if (action === "open-system-details") {
    switchDesktopNav("operations");
  }
  if (action === "open-registry-advanced") {
    switchDesktopNav("registry");
  }
  if (action === "refresh-security") void refreshStudioSecurityAndWorkspace();
  if (action === "save-security-settings") void saveStudioSecuritySettings();
  if (action === "select-security-workspace") {
    void switchSecurityWorkspace(button.dataset.workspaceId || "");
  }
  if (action === "set-security-member-role") {
    void updateStudioMemberRole(button.dataset.principalId || "", button.dataset.role || "");
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
  if (action === "choose-desktop-workspace") void chooseDesktopWorkspace();
  if (action === "create-desktop-project") void createDesktopProject();
  if (action === "select-desktop-project") void selectDesktopProject(button.dataset.projectId || "");
  if (action === "archive-desktop-project") void archiveDesktopProject(button.dataset.projectId || "");
  if (action === "authorize-desktop-workspace-write") void authorizeDesktopWorkspaceWrite();
  if (action === "refresh-desktop-workspace") {
    void loadDesktopWorkspaceDirectory(state.desktop.listing?.relativePath || "");
  }
  if (action === "open-desktop-workspace-directory") {
    void loadDesktopWorkspaceDirectory(button.dataset.path || "");
  }
  if (action === "attach-desktop-workspace-file") {
    void attachDesktopWorkspaceFile(button.dataset.path || "");
  }
  if (action === "pick-context-file") {
    const input = document.querySelector("input[data-field='attachment.filePicker']");
    if (input) input.click();
  }
  if (action === "pick-conversation-file") {
    const input = document.querySelector("input[data-field='conversation.filePicker']");
    if (input) input.click();
  }
  if (action === "remove-conversation-attachment") {
    void removeWorkspaceAttachment(button.dataset.attachmentId || "");
  }
  if (action === "open-artifact-preview") {
    void openArtifactPreview(button.dataset.artifactId || "");
  }
  if (action === "close-artifact-preview") {
    closeArtifactPreview();
  }
  if (action === "select-artifact-preview-tab") {
    const tab = button.dataset.tab === "changes" ? "changes" : "preview";
    state.artifactPreview.tab = tab;
    if (tab === "changes" && !state.artifactPreview.compare && state.artifactPreview.detail?.previous_artifact_id) {
      void loadArtifactComparison();
    } else {
      render();
    }
  }
  if (action === "toggle-artifact-mermaid-source") {
    toggleArtifactMermaidSource(button);
  }
  if (action === "attach-workspace-context-reference") {
    void attachWorkspaceContextReference(button.dataset.key || "");
  }
  if (action === "orchestrator-send-message") void sendOrchestratorMessage();
  if (action === "resume-task-checkpoint") void resumeTaskCheckpoint();
  if (action === "start-task-work" || action === "refresh-task-plan") {
    void sendTaskGuidanceDirective(action);
  }
  if (action === "open-task-inbox") {
    switchDesktopNav("inbox");
  }
  if (action === "open-task-settings") {
    switchDesktopNav("settings");
  }
  if (action === "open-task-library") {
    switchDesktopNav("library");
  }
  if (action === "review-task-plan") {
    state.ui.taskPlanExpanded = true;
    pendingWorkspaceFocus = "task-plan";
    render();
  }
  if (action === "scan-task-recovery") {
    state.ui.taskRuntimeExpanded = true;
    void scanRuntimeRecovery();
  }
  if (action === "check-task-quality") {
    void checkTaskQuality();
  }
  if (action === "task-autopilot-pause") void controlTaskAutopilot("pause");
  if (action === "task-autopilot-resume") void controlTaskAutopilot("resume");
  if (action === "task-autopilot-tick") void controlTaskAutopilot("tick");
  if (action === "review-task-results") {
    pendingWorkspaceFocus = "task-results";
    render();
  }
  if (action === "view-task-progress" || action === "review-task-recovery" || action === "review-task-evidence") {
    state.ui.taskRuntimeExpanded = true;
    pendingWorkspaceFocus = action === "review-task-evidence" ? "task-quality" : "task-runtime";
    render();
  }
  if (action === "review-task-conversation") {
    state.ui.taskConversationExpanded = true;
    pendingWorkspaceFocus = "task-conversation";
    render();
  }
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
  if (action === "refresh-route-compare") void refreshSelectedRouteCompare();
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
  if (action === "pick-route-compare-history") {
    const key = button.dataset.key || "";
    const selection = state.ui.routeCompareSelection || { leftKey: "", rightKey: "" };
    if (!selection.leftKey || selection.leftKey === key) {
      setRouteCompareSelection("left", key);
    } else {
      setRouteCompareSelection("right", key);
    }
    void refreshSelectedRouteCompare();
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
  if (action === "refresh-runtime-projection") void loadRuntimeGraphForWorkspace();
  if (action === "toggle-runtime-overlay") {
    state.ui.runtimeOverlayOpen = !state.ui.runtimeOverlayOpen;
    document.body.classList.toggle("runtime-overlay-active", state.ui.runtimeOverlayOpen);
    render();
  }
  if (action === "select-runtime-node" || action === "select-runtime-edge" || action === "select-runtime-trace" || action === "select-runtime-evidence") {
    selectRuntimeNode(button.dataset.nodeRunId || "");
  }
  if (action === "close-runtime-node") {
    state.ui.runtimeDrawerOpen = false;
    state.ui.runtimeNodeRunId = "";
    buildStudioLocationState();
    render();
  }
  if (action === "runtime-zoom-in") {
    state.ui.runtimeGraphZoom = Math.min(1.35, state.ui.runtimeGraphZoom + 0.1);
    render();
  }
  if (action === "runtime-zoom-out") {
    state.ui.runtimeGraphZoom = Math.max(0.5, state.ui.runtimeGraphZoom - 0.1);
    render();
  }
  if (action === "runtime-fit-view") {
    fitRuntimeGraphToView(button);
  }
  if (action === "toggle-runtime-list") {
    state.ui.runtimeGraphListFallback = !state.ui.runtimeGraphListFallback;
    render();
  }
  if (action === "select-runtime-tab") {
    state.ui.runtimeGraphTab = button.dataset.runtimeTab || "timeline";
    render();
  }
  if (action === "create-runtime-scorecard") void createRuntimeScorecard();
  if (action === "run-runtime-evaluation") {
    void runRuntimeEvaluation(button.dataset.evaluator || "deterministic-v1");
  }
  if (action === "verify-runtime-replay") void verifyRuntimeReplay();
  if (action === "scan-runtime-recovery") void scanRuntimeRecovery();
  if (action === "replay-runtime-node") void replayFailedRuntimeNode();
  if (action === "refresh-dashboard") {
    void Promise.all([loadRuntimeSummary(false), loadDashboardSummary(false)]).then(() => render());
  }
  if (action === "refresh-memory") void loadMemoryStatus();
  if (action === "memory-recommendation-action") {
    void applyMemoryRecommendationAction(button.dataset.recommendationId || "", button.dataset.memoryAction || "");
  }
  if (action === "remove-memory-overlay") {
    void removeMemoryOverlay(button.dataset.overlayId || "", button.dataset.recommendationId || "");
  }
  if (action === "start-memory-onboarding") void startMemoryOnboardingFromStudio();
  if (action === "advance-memory-onboarding") void advanceMemoryOnboarding(false);
  if (action === "complete-memory-onboarding") void advanceMemoryOnboarding(true);
  if (action === "dismiss-memory-onboarding") void dismissMemoryOnboardingFromStudio();
  if (action === "filter-memory") void loadMemoryStatus();
  if (action === "search-memory") void searchMemoryFromStudio();
  if (action === "rebuild-memory-index") void rebuildMemoryFromStudio("retrieval");
  if (action === "rebuild-memory-knowledge") void rebuildMemoryFromStudio("knowledge");
  if (action === "approve-memory-candidate") void resolveMemoryCandidate(button.dataset.candidateId || "", "approve");
  if (action === "reject-memory-candidate") void resolveMemoryCandidate(button.dataset.candidateId || "", "reject");
  if (action === "edit-memory") {
    const memory = state.memory.records.find((item) => item.memory_id === button.dataset.memoryId);
    state.memory.editingId = memory?.memory_id || "";
    state.memory.editContent = memory?.content || "";
    render();
  }
  if (action === "cancel-memory-edit") {
    state.memory.editingId = "";
    state.memory.editContent = "";
    render();
  }
  if (action === "save-memory-edit") void saveMemoryEdit(button.dataset.memoryId || "");
  if (action === "delete-memory") void changeMemoryStatus(button.dataset.memoryId || "", "delete");
  if (action === "restore-memory") void changeMemoryStatus(button.dataset.memoryId || "", "restore");
  if (action === "save-memory-settings") void saveMemorySettings();
  if (action === "run-memory-maintenance") void runMemoryMaintenanceFromStudio();
  if (action === "run-memory-maintenance-sweep") void runMemoryMaintenanceSweepFromStudio();
  if (action === "import-memory") void importMemoryFromStudio();
  if (action === "export-memory") void exportMemoryFromStudio(button.dataset.format || "json");
  if (action === "set-dashboard-cost-group") {
    state.dashboardFilters.costGroupBy = button.dataset.value || "agent";
    render();
  }
  if (action === "open-dashboard-hotspot") {
    void openDashboardHotspotSession(
      button.dataset.sessionId || "",
      button.dataset.focusKind || "",
      button.dataset.runId || "",
    );
  }
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
    state.activeNav = state.activeNav === "orchestrator"
      ? "orchestrator"
      : state.activeNav === "sessions" ? "sessions" : "missions";
    const nextSessionId = button.dataset.id || "";
    prepareWorkspaceSessionChange(nextSessionId);
    state.selectedSessionId = nextSessionId;
    pendingSessionInventoryScroll = true;
    void loadSessionWorkspace(state.selectedSessionId);
  }
  if (action === "select-registry-section") {
    state.ui.registrySection = button.dataset.section || "connections";
    state.error = null;
    render();
  }
  if (action === "open-studio-setup") openStudioSetup("model");
  if (action === "dismiss-studio-setup") dismissStudioSetup();
  if (action === "select-setup-tab") {
    const tab = button.dataset.setupTab || "model";
    state.setup.tab = tab;
    state.setup.error = null;
    render();
    if (tab === "environment" && !state.setup.hostReport && !state.setup.dockerReport) {
      void runSetupEnvironmentChecks();
    }
  }
  if (action === "save-setup-model") void saveSetupModel();
  if (action === "run-setup-environment") void runSetupEnvironmentChecks();
  if (action === "finish-studio-setup") finishStudioSetup();
  if (action === "open-provider-advanced") {
    state.setup.open = false;
    state.ui.providerConnectionModalOpen = true;
    render();
  }
  if (action === "refresh-registry") void Promise.all([loadRegistry(false), loadGovernance(false)]).then(() => render());
  if (action === "refresh-governance") void loadGovernance();
  if (action === "save-governance-policy") void saveGovernancePolicy();
  if (action === "submit-governance-proposal") void submitGovernanceProposal();
  if (action === "approve-governance-change") {
    void decideStudioGovernanceChange(button.dataset.id || "", "approve");
  }
  if (action === "reject-governance-change") {
    void decideStudioGovernanceChange(button.dataset.id || "", "reject");
  }
  if (action === "apply-governance-change") {
    void decideStudioGovernanceChange(button.dataset.id || "", "apply");
  }
  if (action === "new-agent-profile") {
    state.activeNav = "registry";
    state.ui.registrySection = "agents";
    state.registryEditor.profile = emptyAgentProfileEditor();
    render();
  }
  if (action === "new-provider-connection") {
    state.ui.registrySection = "connections";
    state.registryEditor.connection = emptyProviderConnectionEditor();
    state.ui.providerConnectionModalOpen = true;
    state.error = null;
    render();
  }
  if (action === "new-mcp-server") {
    state.ui.registrySection = "mcp";
    state.registryEditor.mcpServer = state.mcpConnectorPresets.length
      ? editorFromMcpConnectorPreset(state.mcpConnectorPresets[0])
      : emptyMcpServerEditor();
    state.ui.mcpServerModalOpen = true;
    state.error = null;
    render();
  }
  if (action === "edit-mcp-server") {
    const server = state.mcpServers.find((item) => item.server_id === button.dataset.id);
    if (server) {
      state.ui.registrySection = "mcp";
      state.registryEditor.mcpServer = editorFromMcpServer(server);
      state.ui.mcpServerModalOpen = true;
      state.error = null;
      render();
    }
  }
  if (action === "close-mcp-server-modal") {
    state.ui.mcpServerModalOpen = false;
    state.error = null;
    render();
  }
  if (action === "save-mcp-server") void saveMcpServer();
  if (action === "test-mcp-server") void testMcpServer(button.dataset.id || "");
  if (action === "toggle-mcp-server") {
    void setMcpServerEnabled(button.dataset.id || "", button.dataset.enabled === "true");
  }
  if (action === "close-provider-connection-modal") {
    state.ui.providerConnectionModalOpen = false;
    state.error = null;
    render();
  }
  if (action === "add-provider-model") {
    state.registryEditor.connection.models = [...state.registryEditor.connection.models, ""];
    render();
  }
  if (action === "remove-provider-model") {
    const index = Number(button.dataset.index);
    const removed = state.registryEditor.connection.models[index] || "";
    const models = state.registryEditor.connection.models.filter((_, itemIndex) => itemIndex !== index);
    const nextModels = models.length ? models : [""];
    state.registryEditor.connection.models = nextModels;
    if (state.registryEditor.connection.defaultModel === removed) {
      state.registryEditor.connection.defaultModel = nextModels.find(Boolean) || "";
    }
    render();
  }
  if (action === "new-skill") {
    state.activeNav = "registry";
    state.ui.registrySection = "skills";
    state.registryEditor.skill = emptySkillEditor();
    render();
  }
  if (action === "edit-agent-profile") {
    const profile = state.agentProfiles.find((item) => item.profile_id === button.dataset.id);
    if (profile) {
      state.ui.registrySection = "agents";
      state.registryEditor.profile = editorFromAgentProfile(profile);
      render();
    }
  }
  if (action === "edit-agent-profile-from-hosting") {
    const profile = state.agentProfiles.find((item) => item.profile_id === button.dataset.id);
    if (profile) {
      state.activeNav = "registry";
      state.ui.registrySection = "agents";
      state.registryEditor.profile = editorFromAgentProfile(profile);
      render();
    }
  }
  if (action === "edit-provider-connection") {
    const connection = state.providerConnections.find(
      (item) => item.connection_id === button.dataset.id,
    );
    if (connection) {
      state.ui.registrySection = "connections";
      state.registryEditor.connection = editorFromProviderConnection(connection);
      state.ui.providerConnectionModalOpen = true;
      state.error = null;
      render();
    }
  }
  if (action === "edit-skill") {
    const skill = state.skills.find((item) => item.skill_id === button.dataset.id);
    if (skill) {
      state.ui.registrySection = "skills";
      state.registryEditor.skill = editorFromSkill(skill);
      render();
    }
  }
  if (action === "save-agent-profile") void saveAgentProfile();
  if (action === "disable-agent-profile") void disableAgentProfile();
  if (action === "save-provider-connection") void saveProviderConnection();
  if (action === "test-provider-connection") void testProviderConnection();
  if (action === "disable-provider-connection") void disableProviderConnection();
  if (action === "save-skill") void saveSkill();
  if (action === "disable-skill") void disableSkill();
  if (action === "new-template") {
    state.activeNav = "templates";
    state.selectedId = null;
    state.lineage = null;
    resetAuthoringGraphSelection();
    state.editor = emptyEditor();
    resetAuthoringEditorState();
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
  if (action === "select-authoring-node") selectAuthoringGraphItem("node", button.dataset.index);
  if (action === "select-authoring-edge") selectAuthoringGraphItem("edge", button.dataset.index);
  if (action === "authoring-port-out") handleAuthoringPortOut(Number(button.dataset.index));
  if (action === "authoring-port-in") handleAuthoringPortIn(Number(button.dataset.index));
  if (action === "undo-authoring") undoAuthoringGraph();
  if (action === "redo-authoring") redoAuthoringGraph();
  if (action === "add-node") addNode();
  if (action === "remove-node") removeNode(Number(button.dataset.index));
  if (action === "add-edge") addEdge();
  if (action === "remove-edge") removeEdge(Number(button.dataset.index));
});

document.addEventListener("change", (event) => handleChange(event.target));
document.addEventListener("input", (event) => {
  if (event.target.matches("textarea[data-field]")) syncTextareaState(event.target);
  if (event.target.matches("input[data-field^='proposal.']")) syncProposalOverrideField(event.target);
  if (event.target.matches("input[data-field='mission.query'], input[data-field='session.query'], input[data-field='command.query'], input[data-field='memory.query'], input[data-field^='memory.settings.'], input[data-field^='attachment.'], input[data-field^='desktop.'], input[data-field^='orchestrator.'], input[data-field^='agent.'], input[data-field^='connection.'], input[data-field^='mcp.'], input[data-field^='setup.'], input[data-field^='skill.'], textarea[data-field='execution.interventionText']")) {
    handleChange(event.target);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("input[data-field='attachment.filePicker']")) {
    void createWorkspaceAttachmentsFromFiles(event.target.files);
    event.target.value = "";
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("input[data-field='conversation.filePicker']")) {
    void createWorkspaceAttachmentsFromFiles(event.target.files);
    event.target.value = "";
  }
});

document.addEventListener("pointerdown", (event) => {
  const nodeElement = event.target.closest(".authoring-graph-node");
  if (
    !nodeElement ||
    event.target.closest(".authoring-port") ||
    event.button !== 0 ||
    state.activeNav !== "templates" ||
    state.activeView !== "dag"
  ) return;
  const nodeId = nodeElement.dataset.nodeId;
  const position = getAuthoringPositions()[nodeId] || {
    x: Number.parseFloat(nodeElement.style.left) || 0,
    y: Number.parseFloat(nodeElement.style.top) || 0,
  };
  authoringNodeDrag = {
    nodeId,
    element: nodeElement,
    startX: event.clientX,
    startY: event.clientY,
    originX: position.x,
    originY: position.y,
    x: position.x,
    y: position.y,
    moved: false,
  };
  nodeElement.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (!authoringNodeDrag) return;
  const dx = event.clientX - authoringNodeDrag.startX;
  const dy = event.clientY - authoringNodeDrag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) authoringNodeDrag.moved = true;
  authoringNodeDrag.x = Math.max(8, authoringNodeDrag.originX + dx);
  authoringNodeDrag.y = Math.max(8, authoringNodeDrag.originY + dy);
  authoringNodeDrag.element.style.left = `${authoringNodeDrag.x}px`;
  authoringNodeDrag.element.style.top = `${authoringNodeDrag.y}px`;
});

document.addEventListener("pointerup", () => {
  if (!authoringNodeDrag) return;
  const drag = authoringNodeDrag;
  authoringNodeDrag = null;
  if (!drag.moved) return;
  setAuthoringNodePosition(drag.nodeId, { x: drag.x, y: drag.y });
  recordAuthoringMutation();
  render();
});

function clearWorkspaceTaskDragState() {
  draggedWorkspaceTaskSessionId = "";
  document.querySelectorAll(".workspace-task-item.dragging, .workspace-tree-project.is-drop-target")
    .forEach((element) => element.classList.remove("dragging", "is-drop-target"));
}

document.addEventListener("dragstart", (event) => {
  const task = event.target.closest?.("[data-workspace-task-drag-session-id]");
  if (!task) return;
  const sessionId = task.dataset.workspaceTaskDragSessionId || "";
  if (!sessionId || state.ui.taskMoveSessionId) {
    event.preventDefault();
    return;
  }
  draggedWorkspaceTaskSessionId = sessionId;
  task.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", sessionId);
});

document.addEventListener("dragend", () => {
  clearWorkspaceTaskDragState();
});

document.addEventListener("dragover", (event) => {
  const projectDropZone = event.target.closest?.("[data-workspace-drop-project-id]");
  if (projectDropZone && canMoveTaskToProject(
    draggedWorkspaceTaskSessionId,
    projectDropZone.dataset.workspaceDropProjectId || "",
  )) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".workspace-tree-project.is-drop-target")
      .forEach((element) => element.classList.toggle("is-drop-target", element === projectDropZone));
    return;
  }
  const dropZone = event.target.closest?.("[data-attachment-drop-zone='true'], [data-conversation-file-drop='true']");
  if (!dropZone) return;
  event.preventDefault();
  dropZone.classList.add("dragging");
});

document.addEventListener("dragleave", (event) => {
  const projectDropZone = event.target.closest?.("[data-workspace-drop-project-id]");
  const relatedTarget = event.relatedTarget;
  if (projectDropZone && !(relatedTarget instanceof Node && projectDropZone.contains(relatedTarget))) {
    projectDropZone.classList.remove("is-drop-target");
  }
  const dropZone = event.target.closest?.("[data-attachment-drop-zone='true'], [data-conversation-file-drop='true']");
  if (!dropZone || (relatedTarget instanceof Node && dropZone.contains(relatedTarget))) return;
  dropZone.classList.remove("dragging");
});

document.addEventListener("drop", (event) => {
  const projectDropZone = event.target.closest?.("[data-workspace-drop-project-id]");
  const projectId = projectDropZone?.dataset.workspaceDropProjectId || "";
  const sessionId = draggedWorkspaceTaskSessionId || event.dataTransfer?.getData("text/plain") || "";
  if (projectDropZone && canMoveTaskToProject(sessionId, projectId)) {
    event.preventDefault();
    clearWorkspaceTaskDragState();
    void moveTaskToDesktopProject(sessionId, projectId);
    return;
  }
  const dropZone = event.target.closest?.("[data-attachment-drop-zone='true'], [data-conversation-file-drop='true']");
  if (!dropZone) return;
  event.preventDefault();
  dropZone.classList.remove("dragging");
  void createWorkspaceAttachmentsFromFiles(event.dataTransfer?.files);
});

document.addEventListener("keydown", (event) => {
  const key = event.key;
  if (key === "Escape" && state.artifactPreview.open) {
    event.preventDefault();
    closeArtifactPreview();
    return;
  }
  if (key === "Escape" && state.ui.workspaceCreatorOpen) {
    event.preventDefault();
    closeWorkspaceCreator();
    return;
  }
  if (key === "Escape" && state.setup.open) {
    event.preventDefault();
    state.setup.open = false;
    state.setup.error = null;
    render();
    return;
  }
  if (key === "Escape" && state.ui.providerConnectionModalOpen) {
    event.preventDefault();
    state.ui.providerConnectionModalOpen = false;
    state.error = null;
    render();
    return;
  }
  if (key === "Escape" && state.ui.mcpServerModalOpen) {
    event.preventDefault();
    state.ui.mcpServerModalOpen = false;
    state.error = null;
    render();
    return;
  }
  if (key === "Escape" && state.ui.runtimeDrawerOpen) {
    event.preventDefault();
    state.ui.runtimeDrawerOpen = false;
    state.ui.runtimeNodeRunId = "";
    buildStudioLocationState();
    render();
    return;
  }
  if (key === "Escape" && state.ui.runtimeOverlayOpen) {
    event.preventDefault();
    state.ui.runtimeOverlayOpen = false;
    document.body.classList.remove("runtime-overlay-active");
    render();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }

  if (
    key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.target?.matches?.('textarea[data-field="planner.intent"]') &&
    state.activeNav === "orchestrator"
  ) {
    event.preventDefault();
    if (!state.planning && state.planner.intent.trim()) void sendOrchestratorMessage();
    return;
  }

  if (
    key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.target?.matches?.('input[data-field="memory.query"]') &&
    state.activeNav === "memory"
  ) {
    event.preventDefault();
    void searchMemoryFromStudio();
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
  if (state.activeNav === "templates" && state.activeView === "dag") {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redoAuthoringGraph();
      else undoAuthoringGraph();
      return;
    }
    if (modifier && key.toLowerCase() === "y") {
      event.preventDefault();
      redoAuthoringGraph();
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      deleteAuthoringSelection();
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      authoringGraphConnection = null;
      resetAuthoringGraphSelection();
      render();
      return;
    }
  }
  if (state.ui.runtimeDrawerOpen && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
    event.preventDefault();
    const direction = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    }[key];
    const neighbor = findRuntimeNeighbor(getCurrentRuntimeGraphModel(), state.ui.runtimeNodeRunId, direction);
    if (neighbor) selectRuntimeNode(neighbor.nodeRunId);
    return;
  }
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
void initializeDesktopHost();
void loadSecurity(false).then(async (securityLoaded) => {
  if (!securityLoaded) {
    resetWorkspaceScopedState();
    render();
    return;
  }
  await loadWorkspaceData();
  await restoreWorkspaceSessionFromLocation();
});
