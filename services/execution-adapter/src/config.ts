import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeExecutionMode } from "./types.js";

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
export const DATA_DIR =
  process.env.MY_MATE_EXECUTION_ADAPTER_DATA_DIR || path.join(SERVICE_ROOT, "data");
export const DISPATCHES_DIR = path.join(DATA_DIR, "dispatches");
export const OPENCLAW_HANDOFFS_DIR = path.join(DATA_DIR, "openclaw-handoffs");
export const OPENCLAW_STAGING_DIR = path.join(DATA_DIR, "openclaw-staging");
export const PORT = Number(process.env.PORT || 4020);
export const BRIDGE_API_KEY = process.env.MY_MATE_EXECUTION_ADAPTER_API_KEY || "";
export const BRIDGE_EXECUTION_MODE = (
  process.env.MY_MATE_EXECUTION_ADAPTER_MODE || "mock"
) as BridgeExecutionMode;
export const MOCK_STEP_DELAY_MS = Number(
  process.env.MY_MATE_EXECUTION_ADAPTER_MOCK_STEP_DELAY_MS || 250,
);
export const OPENCLAW_GATEWAY_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_OPENCLAW_GATEWAY_BASE_URL || "",
);
export const OPENCLAW_APPROVAL_CONSOLE_BASE_URL = trimTrailingSlash(
  process.env.MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL || "",
);
export const OPENCLAW_CONTAINER_NAME =
  process.env.MY_MATE_OPENCLAW_CONTAINER_NAME || "openclaw-local";
export const OPENCLAW_DOCKER_BIN =
  process.env.MY_MATE_OPENCLAW_DOCKER_BIN || "docker";
export const OPENCLAW_CONTAINER_CLI =
  process.env.MY_MATE_OPENCLAW_CONTAINER_CLI || "/home/node/.npm-global/bin/openclaw";
export const OPENCLAW_CONTAINER_RUNTIME_ROOT =
  process.env.MY_MATE_OPENCLAW_CONTAINER_RUNTIME_ROOT ||
  "/home/node/.openclaw/.openclaw";
export const OPENCLAW_CONTAINER_PYTHON =
  process.env.MY_MATE_OPENCLAW_CONTAINER_PYTHON || "python3";
export const OPENCLAW_CONTAINER_EXECUTION_STRATEGY =
  process.env.MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY || "register-only";
export const OPENCLAW_CONTAINER_AUTH_PROBE =
  process.env.MY_MATE_OPENCLAW_CONTAINER_AUTH_PROBE || "aws-sts-auto";
export const OPENCLAW_DIRECT_AGENT_TIMEOUT_SECONDS = Number(
  process.env.MY_MATE_OPENCLAW_DIRECT_AGENT_TIMEOUT_SECONDS || 900,
);
export const OPENCLAW_DIRECT_AGENT_THINKING =
  process.env.MY_MATE_OPENCLAW_DIRECT_AGENT_THINKING || "low";
export const OPENCLAW_DIRECT_AGENT_MODEL =
  process.env.MY_MATE_OPENCLAW_DIRECT_AGENT_MODEL || "";
export const OPENCLAW_RUNTIME_ROOT =
  process.env.MY_MATE_OPENCLAW_RUNTIME_ROOT || "";
export const OPENCLAW_RUNTIME_PYTHON =
  process.env.MY_MATE_OPENCLAW_RUNTIME_PYTHON || "python3";
export const OPENCLAW_DEFAULT_PROJECT_SLUG =
  process.env.MY_MATE_OPENCLAW_DEFAULT_PROJECT_SLUG || "my-mate";
export const OPENCLAW_DEFAULT_PROJECT_REPO =
  process.env.MY_MATE_OPENCLAW_DEFAULT_PROJECT_REPO || "";
