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
export let ORCHESTRATOR_PROFILES_DIR = path.join(DATA_DIR, "orchestrator-profiles");
export let AGENT_PROFILES_DIR = path.join(DATA_DIR, "agent-profiles");
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
  ORCHESTRATOR_PROFILES_DIR = path.join(DATA_DIR, "orchestrator-profiles");
  AGENT_PROFILES_DIR = path.join(DATA_DIR, "agent-profiles");
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
