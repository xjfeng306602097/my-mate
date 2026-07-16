import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

function resolveServiceRoot(currentDir: string): string {
  const parent = path.dirname(currentDir);
  if (path.basename(currentDir) === "src" && path.basename(parent) === "dist") {
    return path.dirname(parent);
  }
  return parent;
}

export const SERVICE_ROOT = resolveServiceRoot(__dirname);
export const REPO_ROOT = path.resolve(SERVICE_ROOT, "..", "..");

function readRuntimeWorkerReleaseVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "services", "runtime-worker", "package.json"), "utf-8"),
    ) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    // Packaged deployments can provide the release version explicitly.
  }
  return "0.1.0";
}

function resolveDataDir(): string {
  return process.env.MY_MATE_DATA_DIR || path.join(SERVICE_ROOT, "data");
}

export let DATA_DIR = resolveDataDir();
export let RUNS_DIR = path.join(DATA_DIR, "runs");
export let EVENTS_DIR = path.join(DATA_DIR, "events");
export let TEMPLATES_DIR = path.join(DATA_DIR, "templates");
export let RUN_PLANS_DIR = path.join(DATA_DIR, "run-plans");
export let NODE_RUNS_DIR = path.join(DATA_DIR, "node-runs");
export let ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
export let APPROVALS_DIR = path.join(DATA_DIR, "approvals");
export let HUMAN_INPUTS_DIR = path.join(DATA_DIR, "human-inputs");
export let RUNTIME_HUMAN_GATES_DIR = path.join(DATA_DIR, "runtime-human-gates");
export let ORCHESTRATOR_PROFILES_DIR = path.join(DATA_DIR, "orchestrator-profiles");
export let AGENT_PROFILES_DIR = path.join(DATA_DIR, "agent-profiles");
export let PROVIDER_CONNECTIONS_DIR = path.join(DATA_DIR, "provider-connections");
export let PROVIDER_SECRETS_DIR = path.join(DATA_DIR, "provider-secrets");
export let RUNTIME_SECRET_ENVS_DIR = path.join(DATA_DIR, "runtime-secret-envs");
export let SKILLS_DIR = path.join(DATA_DIR, "skills");
export let SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export let SESSION_MESSAGES_DIR = path.join(DATA_DIR, "session-messages");
export let SESSION_INTERVENTIONS_DIR = path.join(DATA_DIR, "session-interventions");
export let SESSION_ATTACHMENTS_DIR = path.join(DATA_DIR, "session-attachments");
export let DAG_PATCHES_DIR = path.join(DATA_DIR, "dag-patches");
export let DAG_PROPOSALS_DIR = path.join(DATA_DIR, "dag-proposals");
export let RUNTIME_JOBS_DIR = path.join(DATA_DIR, "runtime-jobs");
export let RUNTIME_WORKERS_DIR = path.join(DATA_DIR, "runtime-workers");
export let WORKER_LEASES_DIR = path.join(DATA_DIR, "worker-leases");
export let WORKER_EVIDENCE_DIR = path.join(DATA_DIR, "worker-evidence");
export let NODE_HANDOFFS_DIR = path.join(DATA_DIR, "node-handoffs");
export let RUNTIME_EVENT_CURSORS_DIR = path.join(DATA_DIR, "runtime-event-cursors");
export let RUNTIME_WORKSPACES_DIR = path.join(DATA_DIR, "runtime-workspaces");
export let RUNTIME_WORKSPACE_CHANGE_SETS_DIR = path.join(DATA_DIR, "runtime-workspace-change-sets");
export let RUN_ROUTES_DIR = path.join(DATA_DIR, "run-routes");
export let RUN_INITIALIZATION_DIR = path.join(DATA_DIR, "run-initialization");
export let RUN_PLAN_INITIAL_DIR = path.join(DATA_DIR, "run-plan-initial");
export let EVALUATION_SNAPSHOTS_DIR = path.join(DATA_DIR, "evaluation-snapshots");
export let DIAGNOSTICS_DIR = path.join(DATA_DIR, "diagnostics");
export let SCORECARDS_DIR = path.join(DATA_DIR, "scorecards");
export let EVALUATIONS_DIR = path.join(DATA_DIR, "evaluations");
export let REPLAYS_DIR = path.join(DATA_DIR, "replays");
export let REPLAY_PLANS_DIR = path.join(DATA_DIR, "replay-plans");
export let RUNTIME_COMPENSATIONS_DIR = path.join(DATA_DIR, "runtime-compensations");
export let EXECUTION_REPLAYS_DIR = path.join(DATA_DIR, "execution-replays");
export let OBSERVABILITY_RUN_INDEX_DIR = path.join(DATA_DIR, "observability-run-index");
export let OBSERVABILITY_DIRTY_DIR = path.join(DATA_DIR, "observability-dirty");
export let WORKSPACES_DIR = path.join(DATA_DIR, "workspaces");
export let WORKSPACE_MEMBERS_DIR = path.join(DATA_DIR, "workspace-members");
export let AUDIT_EVENTS_DIR = path.join(DATA_DIR, "audit-events");
export let GOVERNANCE_POLICIES_DIR = path.join(DATA_DIR, "governance-policies");
export let GOVERNANCE_CHANGES_DIR = path.join(DATA_DIR, "governance-changes");
export let MISSION_MATERIALIZER_EVENTS_DIR = path.join(DATA_DIR, "mission-materializer-events");
export let MISSION_MATERIALIZER_CHECKPOINTS_DIR = path.join(DATA_DIR, "mission-materializer-checkpoints");
export let MISSION_MATERIALIZER_PROJECTIONS_DIR = path.join(DATA_DIR, "mission-materializer-projections");
export let SUPERVISION_ALERTS_DIR = path.join(DATA_DIR, "supervision-alerts");
export let AUTOPILOT_CONTROLLERS_DIR = path.join(DATA_DIR, "autopilot-controllers");
export let WORKSPACE_BINDINGS_DIR = path.join(DATA_DIR, "workspace-bindings");
export let LOCAL_PROJECTS_DIR = path.join(DATA_DIR, "local-projects");
export let TASK_WORKSPACES_DIR = path.join(DATA_DIR, "task-workspaces");
export let CONVERSATION_ACTIONS_DIR = path.join(DATA_DIR, "conversation-actions");
export let MCP_SERVERS_DIR = path.join(DATA_DIR, "mcp-servers");
export let MCP_SECRETS_DIR = path.join(DATA_DIR, "mcp-secrets");
export let MEMORIES_DIR = path.join(DATA_DIR, "memories");
export let MEMORY_CANDIDATES_DIR = path.join(DATA_DIR, "memory-candidates");
export let MEMORY_SNAPSHOTS_DIR = path.join(DATA_DIR, "memory-snapshots");
export let MEMORY_SETTINGS_DIR = path.join(DATA_DIR, "memory-settings");
export let MEMORY_OBSERVABILITY_DIR = path.join(DATA_DIR, "memory-observability");
export let MEMORY_REVIEWS_DIR = path.join(DATA_DIR, "memory-reviews");
export let MEMORY_MAINTENANCE_DIR = path.join(DATA_DIR, "memory-maintenance");
export let MEMORY_SECRETS_DIR = path.join(DATA_DIR, "memory-secrets");
export let MEMORY_TURN_CONTEXTS_DIR = path.join(DATA_DIR, "memory-turn-contexts");
export let MEMORY_OVERLAYS_DIR = path.join(DATA_DIR, "memory-overlays");
export let MEMORY_FEEDBACK_DIR = path.join(DATA_DIR, "memory-feedback");
export let MEMORY_ONBOARDING_DIR = path.join(DATA_DIR, "memory-onboarding");
export let MEMORY_OPERATIONS_DIR = path.join(DATA_DIR, "memory-operations");
export let MEMORY_BACKUPS_DIR = path.join(DATA_DIR, "memory-backups");
export let MEMORY_COLLECTIONS_DIR = path.join(DATA_DIR, "memory-collections");
export let MEMORY_SHARES_DIR = path.join(DATA_DIR, "memory-shares");
export let MEMORY_CONFLICTS_DIR = path.join(DATA_DIR, "memory-conflicts");
export let MEMORY_EXTERNAL_SOURCES_DIR = path.join(DATA_DIR, "memory-external-sources");
export let MEMORY_EXTERNAL_BINDINGS_DIR = path.join(DATA_DIR, "memory-external-bindings");
export let MEMORY_SYNC_RUNS_DIR = path.join(DATA_DIR, "memory-sync-runs");
export let SESSION_RECALL_INDEX_DIR = path.join(DATA_DIR, "_indexes", "session-recall");
export let MEMORY_RETRIEVAL_INDEX_DIR = path.join(DATA_DIR, "_indexes", "memory-retrieval");
export let MEMORY_KNOWLEDGE_INDEX_DIR = path.join(DATA_DIR, "_indexes", "memory-knowledge");
export let TASK_CHECKPOINTS_DIR = path.join(DATA_DIR, "task-checkpoints");

export function overrideDataDir(dataDir: string): void {
  DATA_DIR = dataDir;
  RUNS_DIR = path.join(DATA_DIR, "runs");
  EVENTS_DIR = path.join(DATA_DIR, "events");
  TEMPLATES_DIR = path.join(DATA_DIR, "templates");
  RUN_PLANS_DIR = path.join(DATA_DIR, "run-plans");
  NODE_RUNS_DIR = path.join(DATA_DIR, "node-runs");
  ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
  APPROVALS_DIR = path.join(DATA_DIR, "approvals");
  HUMAN_INPUTS_DIR = path.join(DATA_DIR, "human-inputs");
  RUNTIME_HUMAN_GATES_DIR = path.join(DATA_DIR, "runtime-human-gates");
  ORCHESTRATOR_PROFILES_DIR = path.join(DATA_DIR, "orchestrator-profiles");
  AGENT_PROFILES_DIR = path.join(DATA_DIR, "agent-profiles");
  PROVIDER_CONNECTIONS_DIR = path.join(DATA_DIR, "provider-connections");
  PROVIDER_SECRETS_DIR = path.join(DATA_DIR, "provider-secrets");
  RUNTIME_SECRET_ENVS_DIR = path.join(DATA_DIR, "runtime-secret-envs");
  SKILLS_DIR = path.join(DATA_DIR, "skills");
  SESSIONS_DIR = path.join(DATA_DIR, "sessions");
  SESSION_MESSAGES_DIR = path.join(DATA_DIR, "session-messages");
  SESSION_INTERVENTIONS_DIR = path.join(DATA_DIR, "session-interventions");
  SESSION_ATTACHMENTS_DIR = path.join(DATA_DIR, "session-attachments");
  DAG_PATCHES_DIR = path.join(DATA_DIR, "dag-patches");
  DAG_PROPOSALS_DIR = path.join(DATA_DIR, "dag-proposals");
  RUNTIME_JOBS_DIR = path.join(DATA_DIR, "runtime-jobs");
  RUNTIME_WORKERS_DIR = path.join(DATA_DIR, "runtime-workers");
  WORKER_LEASES_DIR = path.join(DATA_DIR, "worker-leases");
  WORKER_EVIDENCE_DIR = path.join(DATA_DIR, "worker-evidence");
  NODE_HANDOFFS_DIR = path.join(DATA_DIR, "node-handoffs");
  RUNTIME_EVENT_CURSORS_DIR = path.join(DATA_DIR, "runtime-event-cursors");
  RUNTIME_WORKSPACES_DIR = path.join(DATA_DIR, "runtime-workspaces");
  RUNTIME_WORKSPACE_CHANGE_SETS_DIR = path.join(DATA_DIR, "runtime-workspace-change-sets");
  RUN_ROUTES_DIR = path.join(DATA_DIR, "run-routes");
  RUN_INITIALIZATION_DIR = path.join(DATA_DIR, "run-initialization");
  RUN_PLAN_INITIAL_DIR = path.join(DATA_DIR, "run-plan-initial");
  EVALUATION_SNAPSHOTS_DIR = path.join(DATA_DIR, "evaluation-snapshots");
  DIAGNOSTICS_DIR = path.join(DATA_DIR, "diagnostics");
  SCORECARDS_DIR = path.join(DATA_DIR, "scorecards");
  EVALUATIONS_DIR = path.join(DATA_DIR, "evaluations");
  REPLAYS_DIR = path.join(DATA_DIR, "replays");
  REPLAY_PLANS_DIR = path.join(DATA_DIR, "replay-plans");
  RUNTIME_COMPENSATIONS_DIR = path.join(DATA_DIR, "runtime-compensations");
  EXECUTION_REPLAYS_DIR = path.join(DATA_DIR, "execution-replays");
  OBSERVABILITY_RUN_INDEX_DIR = path.join(DATA_DIR, "observability-run-index");
  OBSERVABILITY_DIRTY_DIR = path.join(DATA_DIR, "observability-dirty");
  WORKSPACES_DIR = path.join(DATA_DIR, "workspaces");
  WORKSPACE_MEMBERS_DIR = path.join(DATA_DIR, "workspace-members");
  AUDIT_EVENTS_DIR = path.join(DATA_DIR, "audit-events");
  GOVERNANCE_POLICIES_DIR = path.join(DATA_DIR, "governance-policies");
  GOVERNANCE_CHANGES_DIR = path.join(DATA_DIR, "governance-changes");
  MISSION_MATERIALIZER_EVENTS_DIR = path.join(DATA_DIR, "mission-materializer-events");
  MISSION_MATERIALIZER_CHECKPOINTS_DIR = path.join(DATA_DIR, "mission-materializer-checkpoints");
  MISSION_MATERIALIZER_PROJECTIONS_DIR = path.join(DATA_DIR, "mission-materializer-projections");
  SUPERVISION_ALERTS_DIR = path.join(DATA_DIR, "supervision-alerts");
  AUTOPILOT_CONTROLLERS_DIR = path.join(DATA_DIR, "autopilot-controllers");
  WORKSPACE_BINDINGS_DIR = path.join(DATA_DIR, "workspace-bindings");
  LOCAL_PROJECTS_DIR = path.join(DATA_DIR, "local-projects");
  TASK_WORKSPACES_DIR = path.join(DATA_DIR, "task-workspaces");
  CONVERSATION_ACTIONS_DIR = path.join(DATA_DIR, "conversation-actions");
  MCP_SERVERS_DIR = path.join(DATA_DIR, "mcp-servers");
  MCP_SECRETS_DIR = path.join(DATA_DIR, "mcp-secrets");
  MEMORIES_DIR = path.join(DATA_DIR, "memories");
  MEMORY_CANDIDATES_DIR = path.join(DATA_DIR, "memory-candidates");
  MEMORY_SNAPSHOTS_DIR = path.join(DATA_DIR, "memory-snapshots");
  MEMORY_SETTINGS_DIR = path.join(DATA_DIR, "memory-settings");
  MEMORY_OBSERVABILITY_DIR = path.join(DATA_DIR, "memory-observability");
  MEMORY_REVIEWS_DIR = path.join(DATA_DIR, "memory-reviews");
  MEMORY_MAINTENANCE_DIR = path.join(DATA_DIR, "memory-maintenance");
  MEMORY_SECRETS_DIR = path.join(DATA_DIR, "memory-secrets");
  MEMORY_TURN_CONTEXTS_DIR = path.join(DATA_DIR, "memory-turn-contexts");
  MEMORY_OVERLAYS_DIR = path.join(DATA_DIR, "memory-overlays");
  MEMORY_FEEDBACK_DIR = path.join(DATA_DIR, "memory-feedback");
  MEMORY_ONBOARDING_DIR = path.join(DATA_DIR, "memory-onboarding");
  MEMORY_OPERATIONS_DIR = path.join(DATA_DIR, "memory-operations");
  MEMORY_BACKUPS_DIR = path.join(DATA_DIR, "memory-backups");
  MEMORY_COLLECTIONS_DIR = path.join(DATA_DIR, "memory-collections");
  MEMORY_SHARES_DIR = path.join(DATA_DIR, "memory-shares");
  MEMORY_CONFLICTS_DIR = path.join(DATA_DIR, "memory-conflicts");
  MEMORY_EXTERNAL_SOURCES_DIR = path.join(DATA_DIR, "memory-external-sources");
  MEMORY_EXTERNAL_BINDINGS_DIR = path.join(DATA_DIR, "memory-external-bindings");
  MEMORY_SYNC_RUNS_DIR = path.join(DATA_DIR, "memory-sync-runs");
  SESSION_RECALL_INDEX_DIR = path.join(DATA_DIR, "_indexes", "session-recall");
  MEMORY_RETRIEVAL_INDEX_DIR = path.join(DATA_DIR, "_indexes", "memory-retrieval");
  MEMORY_KNOWLEDGE_INDEX_DIR = path.join(DATA_DIR, "_indexes", "memory-knowledge");
  TASK_CHECKPOINTS_DIR = path.join(DATA_DIR, "task-checkpoints");
}
export const PORT = Number(process.env.PORT || 4010);
export const SCHEMAS_ROOT = path.join(REPO_ROOT, "schemas");
export const ENABLE_LOCAL_EXECUTION =
  (process.env.MY_MATE_ENABLE_LOCAL_EXECUTION || "true").toLowerCase() !== "false";
export const AUTO_APPROVE_HUMAN_GATES =
  (process.env.MY_MATE_AUTO_APPROVE_HUMAN_GATES || "false").toLowerCase() === "true";
export const LOCAL_EXECUTION_STEP_DELAY_MS = Number(
  process.env.MY_MATE_LOCAL_STEP_DELAY_MS || 150,
);
export const EXECUTION_ADAPTER_KIND = (
  process.env.MY_MATE_EXECUTION_ADAPTER ||
  (ENABLE_LOCAL_EXECUTION ? "local" : "openclaw")
).toLowerCase();
export const PUBLIC_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`,
);
export const OPENCLAW_BRIDGE_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_OPENCLAW_BRIDGE_BASE_URL || "",
);
export const OPENCLAW_BRIDGE_API_KEY =
  process.env.MY_MATE_OPENCLAW_BRIDGE_API_KEY || "";
export const OPENCLAW_BRIDGE_EXECUTION_MODE =
  process.env.MY_MATE_OPENCLAW_BRIDGE_EXECUTION_MODE || "native-agent";
export const OPENCLAW_BRIDGE_DISPATCH_PATH =
  process.env.MY_MATE_OPENCLAW_BRIDGE_DISPATCH_PATH || "/api/v1/dispatches";
export const OPENCLAW_BRIDGE_CONTROL_PATH =
  process.env.MY_MATE_OPENCLAW_BRIDGE_CONTROL_PATH || "/api/v1/controls";
export const OPENCLAW_BRIDGE_SWEEP_PATH =
  process.env.MY_MATE_OPENCLAW_BRIDGE_SWEEP_PATH || "/api/v1/dispatches/sweep";
export const OPENCLAW_CALLBACK_PATH =
  process.env.MY_MATE_OPENCLAW_CALLBACK_PATH || "/api/internal/openclaw/reports";
export const OPENCLAW_CALLBACK_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_OPENCLAW_CALLBACK_BASE_URL || PUBLIC_BASE_URL,
);
export const OPENCLAW_CALLBACK_TOKEN =
  process.env.MY_MATE_OPENCLAW_CALLBACK_TOKEN || "";
export const INTERNAL_AUTH_SECRET = process.env.MY_MATE_INTERNAL_AUTH_SECRET || "";
export const DESKTOP_BRIDGE_TOKEN = process.env.MY_MATE_DESKTOP_BRIDGE_TOKEN || "";
export const OPENCLAW_GATEWAY_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_OPENCLAW_GATEWAY_BASE_URL || "",
);
export const OPENCLAW_APPROVAL_CONSOLE_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL || "",
);
export const OPENCLAW_CONTAINER_NAME =
  process.env.MY_MATE_OPENCLAW_CONTAINER_NAME || "openclaw-local";

export const RUNTIME_DISPATCHER_KIND = (
  process.env.MY_MATE_RUNTIME_DISPATCHER || "legacy"
).toLowerCase();
export const RUNTIME_WORKER_RELEASE_VERSION =
  process.env.MY_MATE_RUNTIME_WORKER_RELEASE_VERSION || readRuntimeWorkerReleaseVersion();
export const RUNTIME_WORKER_IMAGE =
  process.env.MY_MATE_RUNTIME_WORKER_IMAGE ||
  `${process.env.MY_MATE_RUNTIME_WORKER_IMAGE_REPOSITORY || "my-mate-runtime-worker"}:${RUNTIME_WORKER_RELEASE_VERSION}`;
export const RUNTIME_DOCKER_BIN = process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";
export const RUNTIME_WORKER_MANAGER_WS_URL = trimTrailingSlash(
  process.env.MY_MATE_RUNTIME_WORKER_MANAGER_WS_URL || "",
);
export const RUNTIME_WORKER_TOKEN = process.env.MY_MATE_RUNTIME_WORKER_TOKEN || "";
export const RUNTIME_WORKER_REGISTER_TIMEOUT_MS = Number(
  process.env.MY_MATE_RUNTIME_WORKER_REGISTER_TIMEOUT_MS || 30000,
);
export const RUNTIME_WORKER_ACK_TIMEOUT_MS = Number(
  process.env.MY_MATE_RUNTIME_WORKER_ACK_TIMEOUT_MS || 10000,
);
export const RUNTIME_WORKER_HEARTBEAT_INTERVAL_MS = Number(
  process.env.MY_MATE_RUNTIME_WORKER_HEARTBEAT_INTERVAL_MS || 10000,
);
export const RUNTIME_WORKER_STALE_AFTER_MS = Number(
  process.env.MY_MATE_RUNTIME_WORKER_STALE_AFTER_MS || 30000,
);
export const RUNTIME_WORKER_AUTO_REMOVE =
  (process.env.MY_MATE_RUNTIME_WORKER_AUTO_REMOVE || "true").toLowerCase() !== "false";
function positiveRuntimeNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export const RUNTIME_WORKER_MAX_CONCURRENT = Math.max(
  1,
  Math.floor(positiveRuntimeNumber("MY_MATE_RUNTIME_WORKER_MAX_CONCURRENT", 4)),
);
export const RUNTIME_WORKER_QUEUE_LIMIT = Math.max(
  1,
  Math.floor(positiveRuntimeNumber("MY_MATE_RUNTIME_WORKER_QUEUE_LIMIT", 100)),
);
export const RUNTIME_WORKER_QUEUE_TIMEOUT_MS = Math.max(
  1000,
  Math.floor(positiveRuntimeNumber("MY_MATE_RUNTIME_WORKER_QUEUE_TIMEOUT_MS", 120000)),
);
export const RUNTIME_WORKER_HEALTH_TIMEOUT_MS = Math.max(
  1000,
  Math.floor(positiveRuntimeNumber("MY_MATE_RUNTIME_WORKER_HEALTH_TIMEOUT_MS", 15000)),
);
export const RUNTIME_WORKER_DEFAULT_CPUS = positiveRuntimeNumber(
  "MY_MATE_RUNTIME_WORKER_DEFAULT_CPUS",
  1,
);
export const RUNTIME_WORKER_DEFAULT_MEMORY_MB = Math.max(
  128,
  Math.floor(positiveRuntimeNumber("MY_MATE_RUNTIME_WORKER_DEFAULT_MEMORY_MB", 1024)),
);
export const RUNTIME_WORKER_DEFAULT_PIDS = Math.max(
  32,
  Math.floor(positiveRuntimeNumber("MY_MATE_RUNTIME_WORKER_DEFAULT_PIDS", 256)),
);
export const EVIDENCE_SETTLE_QUIET_MS = Number(
  process.env.MY_MATE_EVIDENCE_SETTLE_QUIET_MS || 500,
);
export const EVALUATOR_MODEL = process.env.MY_MATE_EVALUATOR_MODEL || "claude-haiku-4-5";
export const EVALUATOR_MAX_TOKENS = Number(process.env.MY_MATE_EVALUATOR_MAX_TOKENS || 1200);
export const EVALUATOR_TIMEOUT_MS = Number(process.env.MY_MATE_EVALUATOR_TIMEOUT_MS || 30000);
const configuredEvaluationAttempts = Number(process.env.MY_MATE_EVALUATION_MAX_ATTEMPTS || 2);
const configuredEvaluationStaleMs = Number(process.env.MY_MATE_EVALUATION_STALE_AFTER_MS || 60000);
export const EVALUATION_MAX_ATTEMPTS = Number.isFinite(configuredEvaluationAttempts)
  ? Math.max(1, Math.floor(configuredEvaluationAttempts))
  : 2;
export const EVALUATION_STALE_AFTER_MS = Number.isFinite(configuredEvaluationStaleMs)
  ? Math.max(1000, Math.floor(configuredEvaluationStaleMs))
  : 60000;

export function getObservabilityRetentionHours(): number | null {
  const configured = process.env.MY_MATE_OBSERVABILITY_RETENTION_HOURS;
  const parsed = configured === undefined ? 90 * 24 : Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return 90 * 24;
  if (parsed === 0) return null;
  return Math.max(1, Math.floor(parsed));
}

export const PLANNER_LLM_MODEL =
  process.env.MY_MATE_PLANNER_LLM_MODEL || "claude-haiku-4-5";
export const PLANNER_LLM_MAX_TOKENS = Number(
  process.env.MY_MATE_PLANNER_LLM_MAX_TOKENS || 1024,
);
export const PLANNER_LLM_TIMEOUT_MS = Number(
  process.env.MY_MATE_PLANNER_LLM_TIMEOUT_MS || 8000,
);
