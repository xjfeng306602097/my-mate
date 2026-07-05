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
export const OPENCLAW_GATEWAY_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_OPENCLAW_GATEWAY_BASE_URL || "",
);
export const OPENCLAW_APPROVAL_CONSOLE_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL || "",
);
export const OPENCLAW_CONTAINER_NAME =
  process.env.MY_MATE_OPENCLAW_CONTAINER_NAME || "openclaw-local";

export const PLANNER_LLM_MODEL =
  process.env.MY_MATE_PLANNER_LLM_MODEL || "claude-haiku-4-5";
export const PLANNER_LLM_MAX_TOKENS = Number(
  process.env.MY_MATE_PLANNER_LLM_MAX_TOKENS || 1024,
);
export const PLANNER_LLM_TIMEOUT_MS = Number(
  process.env.MY_MATE_PLANNER_LLM_TIMEOUT_MS || 8000,
);
