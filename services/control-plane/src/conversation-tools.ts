import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  completeConversationAction,
  createConversationAction,
  findConversationActionByIdempotencyKey,
  getConversationAction,
  markConversationActionApproved,
  markConversationActionPendingApproval,
} from "./conversation-action-store.js";
import { getActiveSessionWorkspaceBinding } from "./workspace-binding-store.js";
import { CapabilityToolError, getCapabilityRegistry } from "./capability-registry.js";
import { runSkillScript } from "./skill-script-runner.js";
import { getProviderConnection } from "./provider-connection-store.js";
import {
  createUserSchedule,
  deleteUserSchedule,
  getUserSchedule,
  listUserSchedules,
  updateUserSchedule,
  type ScheduleAutonomyMode,
} from "./user-schedule-store.js";
import {
  applyConversationWorkspaceOperations,
  conversationWorkspaceSessionId,
  ConversationCodingError,
  conversationWorkspaceRoot,
  conversationWorkspaceStatus,
  runConversationWorkspaceCommand,
  searchConversationWorkspace,
  type WorkspaceOperation,
} from "./conversation-coding-workspace.js";
import type {
  ConversationActionRecord,
  ConversationActionRiskLevel,
  DagDefinition,
  SessionRecord,
  WorkspaceBindingRecord,
} from "./types.js";
import {
  addAgentDagTask,
  cancelAgentDag,
  createAgentDag,
  ensureDefaultExecutionPolicy,
  getAgentDag,
  listAgentDags,
  listAgentDagGates,
  listAgentMessages,
  listAgentTasks,
  listAgentTeams,
} from "./agent-orchestration-store.js";
import { createAgentBindingSnapshot, evaluateAgentVersionReadiness, getPublishedAgentVersion, listAgentDefinitions, resolveSessionAgentBinding } from "./agent-runtime-store.js";
import {
  createDagProposal,
  getConfirmedProposalForAgentDag,
  getDagProposalById,
  listSessionDagProposals,
} from "./dag-proposal-store.js";
import { normalizeDagDefinition } from "./orchestration-protocol.js";
import { evaluateOrchestrationPolicy } from "./orchestration-policy.js";
import { getSession, saveSession } from "./session-store.js";
import { nowIso } from "./utils.js";

export type AgentDagExecutionHandler = (input: { workspaceId: string; dagId: string; operation?: "run" | "cancel" | "retry"; reason?: string }) => Promise<Record<string, unknown>>;
let agentDagExecutionHandler: AgentDagExecutionHandler | null = null;
export function configureAgentDagExecutionHandler(handler: AgentDagExecutionHandler | null): void {
  agentDagExecutionHandler = handler;
}

export interface ConversationToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ConversationToolResult {
  tool_call_id: string;
  tool_name: string;
  action_id: string;
  is_error: boolean;
  content: Record<string, unknown>;
}

export interface ConversationToolProgress {
  action_id: string;
  tool_call_id: string;
  tool_name: string;
  risk_level: ConversationActionRiskLevel;
  status: "running" | "pending_approval" | "succeeded" | "failed";
  summary: string;
}

export interface ConversationDesktopCapabilityRequest {
  action_id: string;
  session_id: string;
  type: "application.open" | "capability.execute" | "capability.approve" | "workspace.authorize";
  application_name?: string;
  capability_id?: string;
  executor?: "desktop" | "browser" | "mcp" | "worker";
  risk_level?: ConversationActionRiskLevel;
  arguments?: Record<string, unknown>;
  workspace_access?: "sandbox-write";
  workspace_scope?: "session";
}

export interface ConversationWebTurnState {
  search_calls: number;
  fetch_calls: number;
  budget_exhausted: boolean;
  seen_search_queries: Set<string>;
  fetched_pages: Map<string, Record<string, unknown>>;
  blocked_hosts: Map<string, string>;
  browser_navigation_calls: number;
  seen_browser_urls: Set<string>;
  duplicate_read_calls: number;
}

export function createConversationWebTurnState(): ConversationWebTurnState {
  return {
    search_calls: 0,
    fetch_calls: 0,
    budget_exhausted: false,
    seen_search_queries: new Set(),
    fetched_pages: new Map(),
    blocked_hosts: new Map(),
    browser_navigation_calls: 0,
    seen_browser_urls: new Set(),
    duplicate_read_calls: 0,
  };
}

const MAX_WEB_SEARCH_CALLS_PER_TURN = 8;
const MAX_WEB_FETCH_CALLS_PER_TURN = 6;
const MAX_BROWSER_NAVIGATIONS_PER_TURN = 4;
const WEB_FETCH_BROWSER_FALLBACK_CODES = new Set([
  "web_fetch_access_denied",
  "web_fetch_rate_limited",
  "web_fetch_server_error",
  "web_request_failed",
  "web_request_timeout",
  "web_response_read_failed",
  "web_response_timeout",
]);

const BUILT_IN_CONVERSATION_TOOL_DEFINITIONS = [
  {
    name: "system_clock_read",
    description: "Read the trusted current date, time, timezone, and UTC offset of the host running My Mate.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "system_host_info",
    description: "Read basic non-secret host information: operating system, architecture, hostname, and process runtime. For CPU, GPU, and memory details use system_hardware_info.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "system_hardware_info",
    description: "Read trusted CPU, GPU, processor-count, and memory information from the local host.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "system_recycle_bin_inspect",
    description: "Inspect whether the current user's operating-system recycle bin contains items. This is a read-only operation and returns a bounded list of item names.",
    input_schema: {
      type: "object",
      properties: {
        max_items: { type: "integer", minimum: 0, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "desktop_application_open",
    description: "Find and open an installed Desktop application by its user-facing name. Use only when the user explicitly asks to open an application. The Desktop will always request real user confirmation before launching it.",
    input_schema: {
      type: "object",
      properties: {
        application_name: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["application_name"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_list",
    description: "List one directory inside the Session's already-authorized Workspace. Paths are relative to the Workspace root.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path. Use . for the Workspace root." },
        max_entries: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "workspace_read_text",
    description: "Read a UTF-8 text file inside the Session's already-authorized Workspace. Paths are relative to the Workspace root.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path inside the Workspace." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_search",
    description: "Search file names and UTF-8 text in the current Workspace transaction. Once editing starts, this reads the persistent sandbox, not the real source folder.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        path: { type: "string", description: "Optional relative directory. Use . for the Workspace root." },
        max_results: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_apply_operations",
    description: "Atomically apply a batch of create, replace, delete, move, or mkdir operations to a persistent sandbox. Never writes the real Workspace. Use stable idempotency_key values so resumed tasks do not repeat completed work.",
    input_schema: {
      type: "object",
      properties: {
        idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
        operations: {
          type: "array", minItems: 1, maxItems: 200,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["write", "replace", "delete", "move", "mkdir"] },
              path: { type: "string" },
              content: { type: "string" },
              old_text: { type: "string" },
              new_text: { type: "string" },
              replace_all: { type: "boolean" },
              destination: { type: "string" },
              expected_sha256: { type: ["string", "null"] },
            },
            required: ["kind", "path"],
            additionalProperties: false,
          },
        },
      },
      required: ["idempotency_key", "operations"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_run_command",
    description: "Run one executable with structured arguments in the persistent Workspace sandbox using the pinned Runtime Worker Docker image. Network is disabled. Use this for formatting, builds, and tests, with a stable idempotency_key.",
    input_schema: {
      type: "object",
      properties: {
        idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
        command: { type: "string", minLength: 1, maxLength: 80 },
        args: { type: "array", maxItems: 200, items: { type: "string", maxLength: 8000 } },
        cwd: { type: "string" },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 900 },
        env: { type: "object", additionalProperties: { type: "string", maxLength: 4000 } },
        network: { type: "string", enum: ["none", "public"], description: "Defaults to none. public requires one-time Desktop approval." },
      },
      required: ["idempotency_key", "command"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_status",
    description: "Inspect the current coding transaction, operation ledger, changed paths, hashes, and pending Change Set. Call this before resuming interrupted work and before claiming completion.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "schedule_create",
    description: "Create a durable User Schedule. For recurring work use a valid five-field cron_expression; for one-time future work use an exact ISO run_at instead. Preserve the requested timezone and call this tool before claiming that a scheduled task exists.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160 },
        prompt: { type: "string", minLength: 1, maxLength: 32000, description: "The instruction sent to the model whenever the schedule fires." },
        cron_expression: { type: "string", minLength: 5, maxLength: 160, description: "A five-field cron expression, for example 0 9 * * * for 09:00 every day." },
        run_at: { type: "string", minLength: 10, maxLength: 80, description: "An exact ISO timestamp for a one-time future run. Use this instead of cron_expression for requests such as 'in 5 minutes'." },
        timezone: { type: "string", minLength: 1, maxLength: 120, description: "IANA timezone such as Asia/Shanghai." },
        task_mode: { type: "string", enum: ["new_task", "resume_task"], default: "new_task" },
        session_id: { type: "string", minLength: 1, maxLength: 160, description: "Optional existing Task id. Defaults to the current Task for resume_task." },
        task_title: { type: "string", maxLength: 160 },
        autonomy_mode: { type: "string", enum: ["review_first", "assisted", "autopilot"] },
        provider_connection_id: { type: "string", maxLength: 160 },
        model: { type: "string", maxLength: 200 },
        agent_id: { type: "string", maxLength: 160, description: "Optional Agent definition id. Defaults to the current Session Agent." },
        agent_version: { type: "integer", minimum: 1, description: "Optional immutable Agent version." },
        enabled: { type: "boolean", default: true },
      },
      required: ["name", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "schedule_list",
    description: "List the current Workspace's durable User Schedules with their cron expression, timezone, next run, enabled state, model, and latest result.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "schedule_update",
    description: "Update, pause, enable, or retime one existing User Schedule. Use the exact schedule_id returned by schedule_create or schedule_list.",
    input_schema: {
      type: "object",
      properties: {
        schedule_id: { type: "string", minLength: 1, maxLength: 200 },
        name: { type: "string", minLength: 1, maxLength: 160 },
        prompt: { type: "string", minLength: 1, maxLength: 32000 },
        cron_expression: { type: "string", minLength: 5, maxLength: 160 },
        run_at: { type: "string", minLength: 10, maxLength: 80, description: "An exact ISO timestamp for a one-time future run." },
        timezone: { type: "string", minLength: 1, maxLength: 120 },
        autonomy_mode: { type: "string", enum: ["review_first", "assisted", "autopilot"] },
        provider_connection_id: { type: ["string", "null"], maxLength: 160 },
        model: { type: ["string", "null"], maxLength: 200 },
        enabled: { type: "boolean" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    name: "schedule_delete",
    description: "Delete one User Schedule only when the user explicitly asks to remove it. Use an exact schedule_id.",
    input_schema: {
      type: "object",
      properties: { schedule_id: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_list",
    description: "List active versioned Agents and their Roles, tools, Skills, and model policy before designing a DAG.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_team_list",
    description: "List versioned Agent Teams available to the Main Agent for DAG planning and delegation.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "dag_propose",
    description: "Atomically propose one complete editable multi-Agent DAG for the current Task. Use this instead of repeated dag_create and dag_add_task calls. It never starts execution; Agent versions and permissions are pinned only after confirmation.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        objective: { type: "string", minLength: 1, maxLength: 32000 },
        idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
        team_id: { type: "string", maxLength: 160 },
        reason: { type: "string", maxLength: 2000 },
        risk_level: { type: "string", enum: ["low", "medium", "high"] },
        state_schema: { type: "object" },
        initial_state: { type: "object" },
        nodes: {
          type: "array", minItems: 1, maxItems: 100,
          items: {
            type: "object",
            properties: {
              node_id: { type: "string", minLength: 1, maxLength: 160 },
              name: { type: "string", minLength: 1, maxLength: 160 },
              kind: { type: "string", enum: ["agent_task", "reviewer", "human_gate", "condition", "fanout", "combine", "end"] },
              objective: { type: "string", minLength: 1, maxLength: 32000 },
              agent_id: { type: ["string", "null"], maxLength: 160 },
              agent_version: { type: ["integer", "null"], minimum: 1 },
              role: { type: ["string", "null"], enum: ["orchestrator", "supervisor", "worker", "reviewer", "specialist", null] },
              capability_tags: { type: "array", maxItems: 100, items: { type: "string" } },
              depends_on: { type: "array", maxItems: 100, items: { type: "string" } },
              join_policy: { type: "string", enum: ["all", "any", "quorum"] },
              join_quorum: { type: ["integer", "null"], minimum: 1, maximum: 100 },
              condition: {
                type: ["object", "null"],
                properties: { path: { type: "string" }, operator: { type: "string", enum: ["exists", "truthy", "equals", "not_equals", "contains"] }, value: {} },
                required: ["path", "operator"],
                additionalProperties: false,
              },
              state_input: { type: "object", additionalProperties: { type: "string" } },
              state_output: {
                type: "array",
                items: {
                  type: "object",
                  properties: { source_path: { type: "string" }, target_path: { type: "string" }, reducer: { type: "string", enum: ["replace", "merge", "append"] } },
                  required: ["source_path", "target_path", "reducer"],
                  additionalProperties: false,
                },
              },
              human_gate: {
                type: ["object", "null"],
                properties: { gate_type: { type: "string", enum: ["approval", "input"] }, prompt: { type: "string" }, input_schema: { type: "object" }, auto_resume: { type: "boolean" } },
                required: ["gate_type", "prompt"],
                additionalProperties: false,
              },
              retry_policy: {
                type: "object",
                properties: {
                  max_attempts: { type: "integer", minimum: 1, maximum: 10 },
                  backoff_seconds: { type: "integer", minimum: 0, maximum: 300 },
                },
                required: ["max_attempts", "backoff_seconds"],
                additionalProperties: false,
              },
              allowed_tools: { type: "array", maxItems: 200, items: { type: "string" } },
              allowed_skills: { type: "array", maxItems: 100, items: { type: "string" } },
              input_contract: { type: "object" },
              output_contract: { type: "object" },
              acceptance_criteria: { type: "array", maxItems: 50, items: { type: "string", maxLength: 2000 } },
              verification_steps: { type: "array", maxItems: 50, items: { type: "string", maxLength: 2000 } },
              autonomy_mode: { type: "string", enum: ["review_first", "assisted", "autopilot"] },
              max_tool_rounds: { type: ["integer", "null"], minimum: 1, maximum: 128 },
              max_runtime_seconds: { type: ["integer", "null"], minimum: 30, maximum: 86400 },
              reviewer_node_id: { type: ["string", "null"], maxLength: 160 },
            },
            required: ["node_id", "name", "kind", "objective", "depends_on"],
            additionalProperties: false,
          },
        },
        policy: { type: "object" },
      },
      required: ["title", "objective", "nodes", "idempotency_key"],
      additionalProperties: false,
    },
  },
  {
    name: "dag_status",
    description: "Inspect a durable Agent DAG, its Sub Agent tasks, protocol messages, budgets, failures, and verification state.",
    input_schema: { type: "object", properties: { dag_id: { type: "string", minLength: 1, maxLength: 200 } }, required: ["dag_id"], additionalProperties: false },
  },
  {
    name: "dag_run",
    description: "Start or resume ready tasks in a durable Agent DAG through the server Agent DAG Runner.",
    input_schema: { type: "object", properties: { dag_id: { type: "string", minLength: 1, maxLength: 200 } }, required: ["dag_id"], additionalProperties: false },
  },
  {
    name: "dag_cancel",
    description: "Cancel a durable Agent DAG and cascade cancellation to unfinished Sub Agent tasks.",
    input_schema: { type: "object", properties: { dag_id: { type: "string", minLength: 1, maxLength: 200 }, reason: { type: "string", maxLength: 2000 } }, required: ["dag_id"], additionalProperties: false },
  },
  {
    name: "delegate_task",
    description: "Delegate one focused task to a pinned Sub Agent. The delegation is always materialized as a durable Agent DAG and returns real DAG, task, node, and AgentRun handles.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160 },
        objective: { type: "string", minLength: 1, maxLength: 32000 },
        agent_id: { type: "string", minLength: 1, maxLength: 160 },
        agent_version: { type: "integer", minimum: 1 },
        role: { type: "string", enum: ["orchestrator", "supervisor", "worker", "reviewer", "specialist"] },
        allowed_tools: { type: "array", maxItems: 200, items: { type: "string" } },
        autonomy_mode: { type: "string", enum: ["review_first", "assisted", "autopilot"] },
        max_tool_rounds: { type: "integer", minimum: 1, maximum: 128 },
        max_runtime_seconds: { type: "integer", minimum: 30, maximum: 86400 },
        require_reviewer: { type: "boolean" },
        reviewer_agent_id: { type: "string", maxLength: 160, description: "Required when require_reviewer=true to create an independent Reviewer Agent task." },
        reviewer_agent_version: { type: "integer", minimum: 1 },
        idempotency_key: { type: "string", minLength: 1, maxLength: 160 },
      },
      required: ["name", "objective", "agent_id", "idempotency_key"],
      additionalProperties: false,
    },
  },
] as const;

getCapabilityRegistry().reserveCapabilityIds(
  BUILT_IN_CONVERSATION_TOOL_DEFINITIONS.map((tool) => tool.name),
);

export function getConversationToolDefinitions(workspaceId?: string, allowedToolNames?: Iterable<string>): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  const builtIn = BUILT_IN_CONVERSATION_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: structuredClone(tool.input_schema) as Record<string, unknown>,
  }));
  const occupied = new Set<string>(builtIn.map((tool) => tool.name));
  const pluginTools = getCapabilityRegistry()
    .listToolDefinitions(workspaceId)
    .filter((tool) => !occupied.has(tool.name));
  const all = [...builtIn, ...pluginTools];
  if (!allowedToolNames) return all;
  const allowed = new Set(allowedToolNames);
  return all.filter((tool) => allowed.has(tool.name));
}

const MAX_TEXT_BYTES = 256 * 1024;
const execFileAsync = promisify(execFile);
const SENSITIVE_SEGMENTS = new Set([
  ".git",
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  "credentials",
  "secrets",
]);
const SENSITIVE_NAMES = /^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|p12|pfx|key|keystore))$/iu;

class ConversationToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function errorResult(code: string, message: string): Record<string, unknown> {
  return { ok: false, code, message };
}

function normalizedRelativePath(value: unknown, allowRoot: boolean): string {
  if (typeof value !== "string") {
    if (allowRoot && value === undefined) return ".";
    throw new ConversationToolError("invalid_arguments", "A relative Workspace path is required.");
  }
  const raw = value.trim().replaceAll("\\", "/");
  if (allowRoot && (raw === "" || raw === ".")) return ".";
  if (!raw || path.posix.isAbsolute(raw) || /^[A-Za-z]:/u.test(raw)) {
    throw new ConversationToolError("workspace_path_invalid", "Workspace paths must be relative.");
  }
  const segments = raw.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ConversationToolError("workspace_path_invalid", "Workspace path traversal is not allowed.");
  }
  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment.toLowerCase())) ||
      segments.some((segment) => SENSITIVE_NAMES.test(segment))) {
    throw new ConversationToolError("workspace_path_sensitive", "Sensitive Workspace paths cannot be accessed by Conversation tools.");
  }
  return segments.join("/");
}

function activeBinding(sessionId: string): WorkspaceBindingRecord {
  const binding = getActiveSessionWorkspaceBinding(sessionId);
  if (!binding || binding.status !== "active") {
    throw new ConversationToolError(
      "workspace_unavailable",
      "No active Desktop Workspace is bound to this Session.",
    );
  }
  return binding;
}

function resolvedWorkspacePath(binding: WorkspaceBindingRecord, relativePath: string): string {
  const root = fs.realpathSync(binding.root_path);
  const candidate = path.resolve(root, relativePath === "." ? "" : relativePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ConversationToolError("workspace_path_invalid", "Workspace path traversal is not allowed.");
  }
  const parts = relative ? relative.split(path.sep) : [];
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ConversationToolError("workspace_path_not_found", "The requested Workspace path does not exist.");
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new ConversationToolError("workspace_symlink_rejected", "Symbolic links cannot be accessed by Conversation tools.");
    }
  }
  return candidate;
}

function readClock(): Record<string, unknown> {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return {
    ok: true,
    local_date: new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now),
    local_time: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now),
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(now),
    timezone,
    utc_offset: `${sign}${hours}:${minutes}`,
    iso_utc: now.toISOString(),
  };
}

function readHostInfo(): Record<string, unknown> {
  return {
    ok: true,
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    hostname: os.hostname(),
    runtime: `node ${process.version}`,
  };
}

async function runPowerShellJson(script: string): Promise<unknown> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    {
      encoding: "utf-8",
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    },
  );
  const text = stdout.trim();
  return text ? JSON.parse(text) as unknown : null;
}

async function readHardwareInfo(): Promise<Record<string, unknown>> {
  const cpus = os.cpus();
  const cpuModels = [...new Set(cpus.map((cpu) => cpu.model.trim()).filter(Boolean))];
  let gpus: Array<Record<string, unknown>> = [];
  let gpuStatus: "available" | "unavailable" = "unavailable";
  if (process.platform === "win32") {
    try {
      const raw = await runPowerShellJson(
        "@(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor) | ConvertTo-Json -Compress",
      );
      const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
      gpus = items.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const value = item as Record<string, unknown>;
        return [{
          name: typeof value.Name === "string" ? value.Name : "Unknown GPU",
          adapter_memory_bytes: typeof value.AdapterRAM === "number" ? value.AdapterRAM : null,
          driver_version: typeof value.DriverVersion === "string" ? value.DriverVersion : null,
          video_processor: typeof value.VideoProcessor === "string" ? value.VideoProcessor : null,
        }];
      });
      gpuStatus = "available";
    } catch {
      gpuStatus = "unavailable";
    }
  }
  return {
    ok: true,
    cpu: {
      models: cpuModels,
      logical_processors: cpus.length,
      speed_mhz: cpus[0]?.speed || null,
    },
    memory: {
      total_bytes: os.totalmem(),
      free_bytes: os.freemem(),
    },
    gpu: {
      status: gpuStatus,
      devices: gpus,
    },
  };
}

async function inspectRecycleBin(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      code: "recycle_bin_platform_unsupported",
      message: "Recycle-bin inspection is currently available on Windows only.",
    };
  }
  const maxItems = typeof args.max_items === "number"
    ? Math.min(100, Math.max(0, args.max_items))
    : 20;
  try {
    const raw = await runPowerShellJson([
      "$shell = New-Object -ComObject Shell.Application",
      "$folder = $shell.Namespace(0xA)",
      "$all = @($folder.Items())",
      `$rows = @($all | Select-Object -First ${maxItems} | ForEach-Object { [pscustomobject]@{ name = $_.Name; size_bytes = [int64]$_.Size; modified_at = if ($_.ModifyDate) { [string]$_.ModifyDate } else { $null } } })`,
      "[pscustomobject]@{ count = $all.Count; items = $rows } | ConvertTo-Json -Depth 4 -Compress",
    ].join("; "));
    const value = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const items = Array.isArray(value.items)
      ? value.items
      : value.items && typeof value.items === "object"
        ? [value.items]
        : [];
    return {
      ok: true,
      count: typeof value.count === "number" ? value.count : items.length,
      is_empty: (typeof value.count === "number" ? value.count : items.length) === 0,
      items,
      truncated: (typeof value.count === "number" ? value.count : items.length) > items.length,
    };
  } catch {
    throw new ConversationToolError(
      "recycle_bin_inspection_failed",
      "The Windows recycle bin could not be inspected safely.",
    );
  }
}

function listWorkspace(sessionId: string, args: Record<string, unknown>): Record<string, unknown> {
  const relativePath = normalizedRelativePath(args.path, true);
  const requestedLimit = typeof args.max_entries === "number" && Number.isInteger(args.max_entries)
    ? args.max_entries
    : 200;
  const maxEntries = Math.min(500, Math.max(1, requestedLimit));
  const binding = activeBinding(sessionId);
  const target = resolvedWorkspacePath({
    ...binding,
    root_path: conversationWorkspaceRoot(sessionId, binding),
  }, relativePath);
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) throw new ConversationToolError("workspace_not_directory", "The requested Workspace path is not a directory.");
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => !SENSITIVE_SEGMENTS.has(entry.name.toLowerCase()) && !SENSITIVE_NAMES.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, maxEntries)
    .map((entry) => {
      const childRelative = relativePath === "." ? entry.name : `${relativePath}/${entry.name}`;
      const childPath = path.join(target, entry.name);
      const childStat = fs.lstatSync(childPath);
      return {
        path: childRelative.replaceAll("\\", "/"),
        type: childStat.isSymbolicLink()
          ? "symlink_unavailable"
          : childStat.isDirectory()
            ? "directory"
            : childStat.isFile()
              ? "file"
              : "other",
        size_bytes: childStat.isFile() ? childStat.size : null,
        modified_at: childStat.mtime.toISOString(),
      };
    });
  return {
    ok: true,
    path: relativePath,
    entries,
    truncated: fs.readdirSync(target).length > entries.length,
  };
}

function readWorkspaceText(sessionId: string, args: Record<string, unknown>): Record<string, unknown> {
  const relativePath = normalizedRelativePath(args.path, false);
  const binding = activeBinding(sessionId);
  const target = resolvedWorkspacePath({
    ...binding,
    root_path: conversationWorkspaceRoot(sessionId, binding),
  }, relativePath);
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new ConversationToolError("workspace_not_file", "The requested Workspace path is not a file.");
  if (stat.size > MAX_TEXT_BYTES) {
    throw new ConversationToolError("workspace_file_too_large", `Text files are limited to ${MAX_TEXT_BYTES} bytes.`);
  }
  const buffer = fs.readFileSync(target);
  if (buffer.includes(0)) throw new ConversationToolError("workspace_file_binary", "The requested file is not UTF-8 text.");
  const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  return {
    ok: true,
    path: relativePath,
    size_bytes: buffer.byteLength,
    content,
  };
}

function toolRiskLevel(toolName: string, workspaceId: string): ConversationActionRiskLevel {
  if (toolName === "desktop_application_open") return "T2";
  if (toolName === "workspace_apply_operations" || toolName === "workspace_run_command") return "T2";
  if (["system_clock_read", "system_host_info", "system_hardware_info", "system_recycle_bin_inspect", "workspace_list", "workspace_read_text", "workspace_search", "workspace_status", "schedule_list", "agent_list", "agent_team_list", "dag_status"].includes(toolName)) return "T0";
  if (["schedule_create", "schedule_update", "schedule_delete", "dag_propose", "dag_run", "dag_cancel", "delegate_task"].includes(toolName)) return "T1";
  if (toolName.startsWith("system_")) return "T0";
  const capabilityRisk = getCapabilityRegistry().toolRiskLevel(toolName, workspaceId);
  return capabilityRisk || "T1";
}

export function scheduledConversationToolNames(
  workspaceId: string,
  mode: ScheduleAutonomyMode,
): string[] {
  const maxRank = mode === "review_first" ? 0 : mode === "assisted" ? 1 : 2;
  const ranks: Record<ConversationActionRiskLevel, number> = { T0: 0, T1: 1, T2: 2, T3: 3 };
  const registry = getCapabilityRegistry();
  return getConversationToolDefinitions(workspaceId)
    .map((tool) => tool.name)
    .filter((toolName) => {
      if (toolName.startsWith("schedule_") && toolName !== "schedule_list") return false;
      if (["dag_propose", "dag_run", "dag_cancel", "delegate_task"].includes(toolName)) return false;
      if (toolName === "desktop_application_open") return false;
      const executor = registry.toolExecutor(toolName, workspaceId);
      if (executor === "desktop" || executor === "browser" || executor === "mcp") return false;
      if (executor === "worker" && mode !== "autopilot") return false;
      return ranks[toolRiskLevel(toolName, workspaceId)] <= maxRank;
    });
}

function validateToolArguments(toolName: string, args: Record<string, unknown>, workspaceId: string): void {
  const keys = Object.keys(args);
  if (toolName === "system_clock_read" || toolName === "system_host_info" || toolName === "system_hardware_info") {
    if (keys.length) throw new ConversationToolError("invalid_arguments", `${toolName} does not accept arguments.`);
    return;
  }
  if (toolName === "system_recycle_bin_inspect") {
    if (keys.some((key) => key !== "max_items") ||
        (args.max_items !== undefined && (typeof args.max_items !== "number" || !Number.isInteger(args.max_items) || args.max_items < 0 || args.max_items > 100))) {
      throw new ConversationToolError("invalid_arguments", "system_recycle_bin_inspect arguments do not match its schema.");
    }
    return;
  }
  if (toolName === "desktop_application_open") {
    if (keys.some((key) => key !== "application_name") ||
        typeof args.application_name !== "string" ||
        !args.application_name.trim() ||
        args.application_name.trim().length > 120) {
      throw new ConversationToolError("invalid_arguments", "desktop_application_open requires one application name.");
    }
    return;
  }
  if (toolName === "workspace_list") {
    if (keys.some((key) => key !== "path" && key !== "max_entries") ||
        (args.path !== undefined && typeof args.path !== "string") ||
        (args.max_entries !== undefined && (typeof args.max_entries !== "number" || !Number.isInteger(args.max_entries)))) {
      throw new ConversationToolError("invalid_arguments", "workspace_list arguments do not match its schema.");
    }
    return;
  }
  if (toolName === "workspace_read_text") {
    if (keys.some((key) => key !== "path") || typeof args.path !== "string" || !args.path.trim()) {
      throw new ConversationToolError("invalid_arguments", "workspace_read_text requires one relative path.");
    }
    return;
  }
  if (toolName === "workspace_search") {
    if (keys.some((key) => !["query", "path", "max_results"].includes(key)) ||
        typeof args.query !== "string" || !args.query.trim() ||
        (args.path !== undefined && typeof args.path !== "string") ||
        (args.max_results !== undefined && (typeof args.max_results !== "number" || !Number.isInteger(args.max_results)))) {
      throw new ConversationToolError("invalid_arguments", "workspace_search arguments do not match its schema.");
    }
    return;
  }
  if (toolName === "workspace_apply_operations") {
    if (keys.some((key) => key !== "idempotency_key" && key !== "operations") ||
        typeof args.idempotency_key !== "string" || !args.idempotency_key.trim() ||
        !Array.isArray(args.operations)) {
      throw new ConversationToolError("invalid_arguments", "workspace_apply_operations requires an idempotency key and operation array.");
    }
    return;
  }
  if (toolName === "workspace_run_command") {
    if (keys.some((key) => !["idempotency_key", "command", "args", "cwd", "timeout_seconds", "env", "network"].includes(key)) ||
        typeof args.idempotency_key !== "string" || !args.idempotency_key.trim() ||
        typeof args.command !== "string" || !args.command.trim() ||
        (args.args !== undefined && (!Array.isArray(args.args) || !args.args.every((value) => typeof value === "string"))) ||
        (args.cwd !== undefined && typeof args.cwd !== "string") ||
        (args.timeout_seconds !== undefined && (typeof args.timeout_seconds !== "number" || !Number.isInteger(args.timeout_seconds))) ||
        (args.env !== undefined && (!args.env || typeof args.env !== "object" || Array.isArray(args.env))) ||
        (args.network !== undefined && args.network !== "none" && args.network !== "public")) {
      throw new ConversationToolError("invalid_arguments", "workspace_run_command arguments do not match its schema.");
    }
    return;
  }
  if (toolName === "workspace_status") {
    if (keys.length) throw new ConversationToolError("invalid_arguments", "workspace_status does not accept arguments.");
    return;
  }
  if (toolName === "schedule_list") {
    if (keys.length) throw new ConversationToolError("invalid_arguments", "schedule_list does not accept arguments.");
    return;
  }
  if (toolName === "schedule_create") {
    const allowed = ["name", "prompt", "cron_expression", "run_at", "timezone", "task_mode", "session_id", "task_title", "autonomy_mode", "provider_connection_id", "model", "agent_id", "agent_version", "enabled"];
    if (keys.some((key) => !allowed.includes(key)) || typeof args.name !== "string" || !args.name.trim() ||
        typeof args.prompt !== "string" || !args.prompt.trim() ||
        (typeof args.cron_expression !== "string" && typeof args.run_at !== "string") ||
        (typeof args.cron_expression === "string" && typeof args.run_at === "string")) {
      throw new ConversationToolError("invalid_arguments", "schedule_create requires name, prompt, and exactly one of cron_expression or run_at.");
    }
    return;
  }
  if (toolName === "schedule_update") {
    const allowed = ["schedule_id", "name", "prompt", "cron_expression", "run_at", "timezone", "autonomy_mode", "provider_connection_id", "model", "enabled"];
    if (keys.some((key) => !allowed.includes(key)) || typeof args.schedule_id !== "string" || !args.schedule_id.trim() || keys.length < 2) {
      throw new ConversationToolError("invalid_arguments", "schedule_update requires schedule_id and at least one change.");
    }
    if (typeof args.cron_expression === "string" && typeof args.run_at === "string") {
      throw new ConversationToolError("invalid_arguments", "schedule_update accepts only one of cron_expression or run_at.");
    }
    return;
  }
  if (toolName === "schedule_delete") {
    if (keys.length !== 1 || typeof args.schedule_id !== "string" || !args.schedule_id.trim()) {
      throw new ConversationToolError("invalid_arguments", "schedule_delete requires one schedule_id.");
    }
    return;
  }
  if (toolName === "agent_list" || toolName === "agent_team_list") {
    if (keys.length) throw new ConversationToolError("invalid_arguments", `${toolName} does not accept arguments.`);
    return;
  }
  if (toolName === "dag_propose") {
    if (keys.some((key) => !["title", "objective", "nodes", "policy", "team_id", "reason", "risk_level", "state_schema", "initial_state", "idempotency_key"].includes(key)) ||
        typeof args.title !== "string" || !args.title.trim() ||
        typeof args.objective !== "string" || !args.objective.trim() ||
        !Array.isArray(args.nodes) || !args.nodes.length ||
        typeof args.idempotency_key !== "string" || !args.idempotency_key.trim()) {
      throw new ConversationToolError("invalid_arguments", "dag_propose requires title, objective, a non-empty nodes array, and idempotency_key.");
    }
    return;
  }
  if (toolName === "dag_create") {
    throw new ConversationToolError("dag_incremental_tools_retired", "dag_create was retired. Submit one complete editable workflow with dag_propose.");
  }
  if (toolName === "dag_add_task") {
    throw new ConversationToolError("dag_incremental_tools_retired", "dag_add_task was retired. Revise the current DagProposal instead.");
  }
  if (toolName === "dag_status" || toolName === "dag_run") {
    if (keys.length !== 1 || typeof args.dag_id !== "string" || !args.dag_id.trim()) throw new ConversationToolError("invalid_arguments", `${toolName} requires dag_id.`);
    return;
  }
  if (toolName === "dag_cancel") {
    if (keys.some((key) => key !== "dag_id" && key !== "reason") || typeof args.dag_id !== "string" || !args.dag_id.trim()) throw new ConversationToolError("invalid_arguments", "dag_cancel requires dag_id and accepts an optional reason.");
    return;
  }
  if (toolName === "delegate_task") {
    const required = [args.name, args.objective, args.agent_id, args.idempotency_key];
    if (required.some((value) => typeof value !== "string" || !value.trim())) throw new ConversationToolError("invalid_arguments", "delegate_task requires name, objective, agent_id, and idempotency_key.");
    return;
  }
  if (getCapabilityRegistry().hasTool(toolName, workspaceId)) {
    try {
      getCapabilityRegistry().validateToolArguments(toolName, args, workspaceId);
      return;
    } catch (error) {
      throw new ConversationToolError(
        "invalid_arguments",
        error instanceof Error ? error.message : `${toolName} arguments do not match its schema.`,
      );
    }
  }
  throw new ConversationToolError("tool_not_allowed", "This tool is not available to Conversation Agent.");
}

function progressSummary(
  toolName: string,
  status: "running" | "pending_approval" | "succeeded" | "failed",
  workspaceId: string,
): string {
  const label = toolName === "system_clock_read"
    ? "Reading system time"
    : toolName === "system_host_info"
      ? "Reading host information"
      : toolName === "system_hardware_info"
        ? "Reading CPU and GPU information"
        : toolName === "system_recycle_bin_inspect"
          ? "Inspecting recycle bin"
          : toolName === "desktop_application_open"
            ? "Opening Desktop application"
      : toolName === "workspace_list"
        ? "Listing Workspace files"
      : toolName === "workspace_read_text"
        ? "Reading Workspace file"
        : toolName === "workspace_search"
          ? "Searching Workspace"
          : toolName === "workspace_apply_operations"
            ? "Editing sandbox Workspace"
            : toolName === "workspace_run_command"
              ? "Running sandbox command"
      : toolName === "workspace_status"
        ? "Inspecting Workspace changes"
      : toolName === "schedule_create"
        ? "Creating scheduled Task"
      : toolName === "schedule_list"
        ? "Listing scheduled Tasks"
      : toolName === "schedule_update"
        ? "Updating scheduled Task"
      : toolName === "schedule_delete"
        ? "Deleting scheduled Task"
      : toolName === "agent_list"
        ? "Listing Agents"
      : toolName === "agent_team_list"
        ? "Listing execution policies"
      : toolName === "dag_propose"
        ? "Proposing complete Agent DAG"
      : toolName === "dag_create"
        ? "Creating Agent DAG"
      : toolName === "dag_add_task"
        ? "Adding Sub Agent task"
      : toolName === "dag_status"
        ? "Inspecting Agent DAG"
      : toolName === "dag_run"
        ? "Running Agent DAG"
      : toolName === "dag_cancel"
        ? "Cancelling Agent DAG"
      : toolName === "delegate_task"
        ? "Delegating to Sub Agent"
            : getCapabilityRegistry().toolProgressLabel(toolName, workspaceId) || "Running Conversation tool";
  return status === "running" ? label : status === "pending_approval" ? `${label} requires confirmation` : `${label} ${status}`;
}

function scheduleMode(value: unknown, fallback: unknown): ScheduleAutonomyMode {
  if (value === "review_first" || value === "autopilot") return value;
  if (value === "assisted") return value;
  return fallback === "review_first" || fallback === "autopilot" ? fallback : "assisted";
}

function scheduleMutation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ConversationToolError) throw error;
    const message = error instanceof Error ? error.message : "SCHEDULE_OPERATION_FAILED";
    throw new ConversationToolError(message.toLowerCase(), message);
  }
}

function scheduleProviderSelection(input: {
  session: SessionRecord;
  args: Record<string, unknown>;
  current?: { provider_connection_id: string | null; model: string | null };
}): { providerConnectionId: string | null; model: string | null } {
  const metadata = input.session.metadata || {};
  let providerConnectionId = typeof input.args.provider_connection_id === "string"
    ? input.args.provider_connection_id.trim()
    : input.current?.provider_connection_id ||
      (typeof metadata.conversation_provider_connection_id === "string"
        ? metadata.conversation_provider_connection_id.trim()
        : "");
  let model = typeof input.args.model === "string"
    ? input.args.model.trim()
    : input.current?.model ||
      (typeof metadata.conversation_model === "string" ? metadata.conversation_model.trim() : "");

  let connection = providerConnectionId ? getProviderConnection(providerConnectionId) : null;
  if (!connection && providerConnectionId.includes("/")) {
    const candidate = providerConnectionId.split("/")[0]?.trim() || "";
    const parsed = candidate ? getProviderConnection(candidate) : null;
    if (parsed) {
      connection = parsed;
      providerConnectionId = parsed.connection_id;
    }
  }
  if (!connection) return {
    providerConnectionId: providerConnectionId || null,
    model: model || null,
  };

  providerConnectionId = connection.connection_id;
  if (!model) model = connection.default_model || connection.models[0] || "";
  const normalizedModel = model.includes("/") ? model.split("/").at(-1)?.trim() || model : model;
  const selectedModel = connection.models.find((candidate) =>
    candidate.toLocaleLowerCase() === normalizedModel.toLocaleLowerCase(),
  );
  if (!selectedModel) {
    throw new ConversationToolError(
      "schedule_model_not_available",
      `Model ${model || "(empty)"} is not available on Provider Connection ${connection.connection_id}.`,
    );
  }
  return { providerConnectionId, model: selectedModel };
}

function scheduleToolResult(session: SessionRecord, toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const workspaceId = session.workspace_id || "default";
  if (toolName === "schedule_list") {
    const schedules = listUserSchedules(workspaceId);
    return { ok: true, schedules, count: schedules.length };
  }
  if (toolName === "schedule_create") {
    const taskMode = args.task_mode === "resume_task" ? "resume_task" : "new_task";
    const metadata = session.metadata || {};
    const providerSelection = scheduleProviderSelection({ session, args });
    const schedule = scheduleMutation(() => createUserSchedule({
      workspaceId,
      name: String(args.name || ""),
      prompt: String(args.prompt || ""),
      taskMode,
      sessionId: taskMode === "resume_task" ? String(args.session_id || session.session_id) : null,
      taskTitle: typeof args.task_title === "string" ? args.task_title : null,
      autonomyMode: scheduleMode(args.autonomy_mode, metadata.autonomy_mode),
      providerConnectionId: providerSelection.providerConnectionId,
      model: providerSelection.model,
      agentId: typeof args.agent_id === "string" ? args.agent_id : (typeof metadata.agent_id === "string" ? metadata.agent_id : null),
      agentVersion: typeof args.agent_version === "number" ? args.agent_version : (typeof metadata.agent_version === "number" ? metadata.agent_version : null),
      timezone: typeof args.timezone === "string" && args.timezone.trim()
        ? args.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      recurrence: typeof args.run_at === "string"
        ? { kind: "once", run_at: args.run_at }
        : { kind: "cron", expression: String(args.cron_expression || "") },
      enabled: args.enabled !== false,
      createdBy: session.created_by || "conversation-agent",
    }));
    return { ok: true, created: true, schedule };
  }
  const scheduleId = String(args.schedule_id || "").trim();
  const current = getUserSchedule(workspaceId, scheduleId);
  if (!current) throw new ConversationToolError("schedule_not_found", "The requested schedule does not exist in this Workspace.");
  if (toolName === "schedule_delete") {
    if (!deleteUserSchedule(workspaceId, scheduleId)) throw new ConversationToolError("schedule_not_found", "The requested schedule no longer exists.");
    return { ok: true, deleted: true, schedule_id: scheduleId };
  }
  const providerSelection = scheduleProviderSelection({ session, args, current });
  const updated = scheduleMutation(() => updateUserSchedule(current, {
    ...(typeof args.name === "string" ? { name: args.name } : {}),
    ...(typeof args.prompt === "string" ? { prompt: args.prompt } : {}),
    ...(typeof args.timezone === "string" ? { timezone: args.timezone } : {}),
    ...(typeof args.run_at === "string"
      ? { recurrence: { kind: "once", run_at: args.run_at } as const }
      : typeof args.cron_expression === "string"
        ? { recurrence: { kind: "cron", expression: args.cron_expression } as const }
        : {}),
    ...(args.autonomy_mode === "review_first" || args.autonomy_mode === "assisted" || args.autonomy_mode === "autopilot"
      ? { autonomy_mode: args.autonomy_mode } : {}),
    ...(args.provider_connection_id !== undefined || args.model !== undefined
      ? {
          provider_connection_id: providerSelection.providerConnectionId,
          model: providerSelection.model,
        }
      : {}),
    ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
  }));
  return { ok: true, updated: true, schedule: updated };
}

function agentRole(value: unknown): "orchestrator" | "supervisor" | "worker" | "reviewer" | "specialist" {
  return value === "orchestrator" || value === "supervisor" || value === "reviewer" || value === "specialist" ? value : "worker";
}

function autonomyMode(value: unknown): "review_first" | "assisted" | "autopilot" {
  return value === "review_first" || value === "autopilot" ? value : "assisted";
}

function dagProposalToolProjection(proposal: ReturnType<typeof createDagProposal>): Record<string, unknown> {
  const runtimeDagId = proposal.compiled_agent_dag_id || null;
  return {
    proposal_id: proposal.proposal_id,
    status: proposal.status,
    title: proposal.title,
    summary: proposal.summary,
    compiled_agent_dag_id: runtimeDagId,
    confirmation_required: !runtimeDagId,
    next_action: runtimeDagId
      ? `Use dag_run with dag_id=${runtimeDagId}.`
      : "Wait for the user to confirm this Proposal in Studio. Do not call dag_run with a DagDefinition id and do not create a replacement Proposal.",
  };
}

function resolveConversationAgentDagId(session: SessionRecord, requestedId: string): string {
  const proposal = requestedId.startsWith("prop_")
    ? getDagProposalById(requestedId)
    : requestedId.startsWith("dag_definition_")
      ? listSessionDagProposals(session.session_id)
        .find((item) => item.dag_definition?.definition_id === requestedId) || null
      : null;
  if (proposal && proposal.session_id !== session.session_id) {
    throw new ConversationToolError("agent_dag_session_mismatch", "The DAG Proposal belongs to another Session.");
  }
  if (proposal && (!proposal.compiled_agent_dag_id || proposal.status !== "confirmed")) {
    throw new ConversationToolError(
      "agent_dag_not_confirmed",
      "This id belongs to a DAG Proposal definition, not an executable Agent DAG. Wait for the user to confirm the Proposal in Studio; do not create another Proposal.",
    );
  }
  const dagId = proposal?.compiled_agent_dag_id || requestedId;
  const dag = getAgentDag(session.workspace_id || "default", dagId);
  if (!dag) throw new ConversationToolError("agent_dag_not_found", "The requested Agent DAG does not exist.");
  const delegated = dag.idempotency_key.startsWith("delegate:");
  const confirmedOwner = getConfirmedProposalForAgentDag(session.session_id, dag.dag_id);
  if (!delegated && !confirmedOwner) {
    throw new ConversationToolError(
      "agent_dag_proposal_required",
      "This Agent DAG was not compiled from the Session's confirmed DagProposal and cannot be executed.",
    );
  }
  return dag.dag_id;
}

async function agentOrchestrationToolResult(session: SessionRecord, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const workspaceId = session.workspace_id || "default";
  if (toolName === "agent_list") {
    const availableToolNames = getConversationToolDefinitions(workspaceId).map((tool) => tool.name);
    const agents = listAgentDefinitions(workspaceId).filter((item) => item.status === "active").flatMap((definition) => {
      const version = getPublishedAgentVersion(definition.agent_id, workspaceId);
      if (!version) return [];
      const readiness = evaluateAgentVersionReadiness(version, { workspaceId, availableToolNames });
      return [{
        agent_id: definition.agent_id,
        name: definition.name,
        description: definition.description,
        version: version.version,
        role: version.role,
        allowed_tools: version.tool_policy.allowed_tools,
        locked_skills: version.skill_policy.locked_skills,
        workspace_policy: version.workspace_policy,
        autonomy_ceiling: version.autonomy_ceiling,
        readiness,
        assignable: readiness.state === "ready",
      }];
    });
    return { ok: true, agents, count: agents.length, ready_count: agents.filter((agent) => agent.assignable).length };
  }
  if (toolName === "agent_team_list") {
    const availableToolNames = getConversationToolDefinitions(workspaceId).map((tool) => tool.name);
    ensureDefaultExecutionPolicy(workspaceId, {
      isVersionReady: (version) => evaluateAgentVersionReadiness(version, { workspaceId, availableToolNames }).state === "ready",
    });
    const teams = listAgentTeams(workspaceId);
    return { ok: true, teams, count: teams.length };
  }
  if (toolName === "dag_status") {
    const dagId = resolveConversationAgentDagId(session, String(args.dag_id));
    const dag = getAgentDag(workspaceId, dagId);
    if (!dag) throw new ConversationToolError("agent_dag_not_found", "The requested Agent DAG does not exist.");
    return { ok: true, dag, tasks: listAgentTasks(workspaceId, dag.dag_id), messages: listAgentMessages(workspaceId, dag.dag_id), gates: listAgentDagGates(workspaceId, dag.dag_id) };
  }
  if (toolName === "dag_cancel") {
    const reason = typeof args.reason === "string" ? args.reason : "Cancelled by Main Agent.";
    if (agentDagExecutionHandler) return await agentDagExecutionHandler({ workspaceId, dagId: String(args.dag_id), operation: "cancel", reason });
    const dag = cancelAgentDag(workspaceId, String(args.dag_id), reason);
    return { ok: true, cancelled: true, dag };
  }
  if (toolName === "dag_run") {
    if (!agentDagExecutionHandler) throw new ConversationToolError("agent_dag_runner_unavailable", "The Agent DAG Runner is not available.");
    const dagId = resolveConversationAgentDagId(session, String(args.dag_id));
    return await agentDagExecutionHandler({ workspaceId, dagId, operation: "run" });
  }
  const orchestratorBinding = resolveSessionAgentBinding(session);
  if (orchestratorBinding.agent_role !== "orchestrator") {
    throw new ConversationToolError("agent_role_not_orchestrator", "Only a Main Agent with role=orchestrator can create or delegate Agent DAG work.");
  }
  const parentDagId = typeof session.metadata?.agent_dag_id === "string" ? session.metadata.agent_dag_id : null;
  const parentDag = parentDagId ? getAgentDag(workspaceId, parentDagId) : null;
  const childDelegationDepth = parentDagId ? Math.max(1, Number(session.metadata?.delegation_depth || 0) + 1) : 0;
  if (toolName === "dag_propose") {
    const idempotencyKey = String(args.idempotency_key);
    const proposals = listSessionDagProposals(session.session_id);
    const duplicate = proposals.find((proposal) => proposal.metadata.idempotency_key === idempotencyKey);
    if (duplicate) return { ok: true, created: false, converged: true, proposal: dagProposalToolProjection(duplicate) };
    const unresolved = [...proposals].reverse().find((proposal) => {
      if (proposal.status === "draft" || proposal.status === "review_ready") return true;
      if (proposal.status !== "confirmed") return false;
      const compiled = proposal.compiled_agent_dag_id ? getAgentDag(workspaceId, proposal.compiled_agent_dag_id) : null;
      return !compiled || !["completed", "failed", "cancelled"].includes(compiled.status);
    });
    if (unresolved) {
      return {
        ok: true,
        created: false,
        converged: true,
        reason: "An unresolved Proposal already owns this Session's orchestration decision.",
        proposal: dagProposalToolProjection(unresolved),
      };
    }
    const rawNodes = args.nodes as Array<Record<string, unknown>>;
    const definition = normalizeDagDefinition({
      schema_version: 1,
      definition_id: `dag_definition_${idempotencyKey}`,
      revision: 1,
      source: { kind: "model", template_id: null, message_id: null },
      title: String(args.title),
      objective: String(args.objective),
      nodes: rawNodes.map((node) => {
        const kind = ["reviewer", "human_gate", "condition", "fanout", "combine", "end"].includes(String(node.kind))
          ? node.kind as DagDefinition["nodes"][number]["kind"]
          : "agent_task";
        const selectedRole = typeof node.role === "string" ? agentRole(node.role) : kind === "reviewer" ? "reviewer" : null;
        return {
          node_id: String(node.node_id || ""),
          name: String(node.name || node.node_id || "DAG node"),
          kind,
          objective: String(node.objective || node.name || ""),
          agent_selector: kind === "agent_task" || kind === "reviewer" ? {
            agent_id: typeof node.agent_id === "string" ? node.agent_id : null,
            agent_version: typeof node.agent_version === "number" ? node.agent_version : null,
            role: selectedRole,
            capability_tags: Array.isArray(node.capability_tags) ? node.capability_tags.filter((item): item is string => typeof item === "string") : [],
          } : null,
          depends_on: Array.isArray(node.depends_on) ? node.depends_on.filter((item): item is string => typeof item === "string") : [],
          join_policy: node.join_policy === "any" || node.join_policy === "quorum" ? node.join_policy : "all",
          join_quorum: typeof node.join_quorum === "number" ? node.join_quorum : null,
          condition: node.condition && typeof node.condition === "object" && !Array.isArray(node.condition) ? node.condition as DagDefinition["nodes"][number]["condition"] : null,
          state_input: node.state_input && typeof node.state_input === "object" && !Array.isArray(node.state_input) ? node.state_input as Record<string, string> : {},
          state_output: Array.isArray(node.state_output) ? node.state_output as DagDefinition["nodes"][number]["state_output"] : [],
          human_gate: node.human_gate && typeof node.human_gate === "object" && !Array.isArray(node.human_gate) ? {
            gate_type: (node.human_gate as Record<string, unknown>).gate_type === "input" ? "input" : "approval",
            prompt: String((node.human_gate as Record<string, unknown>).prompt || node.objective || node.name || "Human review required."),
            input_schema: (node.human_gate as Record<string, unknown>).input_schema && typeof (node.human_gate as Record<string, unknown>).input_schema === "object" ? (node.human_gate as Record<string, unknown>).input_schema as Record<string, unknown> : {},
            auto_resume: (node.human_gate as Record<string, unknown>).auto_resume !== false,
          } : null,
          retry_policy: node.retry_policy && typeof node.retry_policy === "object" && !Array.isArray(node.retry_policy) ? {
            max_attempts: Number((node.retry_policy as Record<string, unknown>).max_attempts || 1),
            backoff_seconds: Number((node.retry_policy as Record<string, unknown>).backoff_seconds || 0),
          } : { max_attempts: 1, backoff_seconds: 0 },
          allowed_tools: Array.isArray(node.allowed_tools) ? node.allowed_tools.filter((item): item is string => typeof item === "string") : [],
          allowed_skills: Array.isArray(node.allowed_skills) ? node.allowed_skills.filter((item): item is string => typeof item === "string") : [],
          input_contract: node.input_contract && typeof node.input_contract === "object" && !Array.isArray(node.input_contract) ? node.input_contract as Record<string, unknown> : {},
          output_contract: node.output_contract && typeof node.output_contract === "object" && !Array.isArray(node.output_contract) ? node.output_contract as Record<string, unknown> : {},
          acceptance_criteria: Array.isArray(node.acceptance_criteria) ? node.acceptance_criteria.filter((item): item is string => typeof item === "string") : [],
          verification_steps: Array.isArray(node.verification_steps) ? node.verification_steps.filter((item): item is string => typeof item === "string") : [],
          autonomy_mode: autonomyMode(node.autonomy_mode),
          max_tool_rounds: typeof node.max_tool_rounds === "number" ? node.max_tool_rounds : null,
          max_runtime_seconds: typeof node.max_runtime_seconds === "number" ? node.max_runtime_seconds : null,
          reviewer_node_id: typeof node.reviewer_node_id === "string" ? node.reviewer_node_id : null,
          metadata: {},
        };
      }),
      state_schema: args.state_schema && typeof args.state_schema === "object" && !Array.isArray(args.state_schema) ? args.state_schema as Record<string, unknown> : {},
      initial_state: args.initial_state && typeof args.initial_state === "object" && !Array.isArray(args.initial_state) ? args.initial_state as Record<string, unknown> : {},
      policy: args.policy && typeof args.policy === "object" && !Array.isArray(args.policy) ? args.policy as DagDefinition["policy"] : {},
      metadata: { team_id: typeof args.team_id === "string" ? args.team_id : null },
      created_at: nowIso(),
    });
    const decision = evaluateOrchestrationPolicy({
      missionSpec: session.mission_spec_contract || null,
      userText: definition.objective,
      forcedMode: "dynamic",
      sourceReason: typeof args.reason === "string" ? args.reason : "The Main Agent decomposed the MissionSpec into multiple specialized Agent tasks.",
    });
    decision.required_capabilities = definition.nodes.flatMap((node) => node.agent_selector?.capability_tags || []);
    decision.risk_level = args.risk_level === "high" || args.risk_level === "low" ? args.risk_level : "medium";
    const assignments = definition.nodes.filter((node) => node.agent_selector).map((node) => ({
      node_id: node.node_id,
      node_name: node.name,
      agent_id: node.agent_selector?.agent_id || null,
      provider: null,
      model: null,
      allowed_tools: node.allowed_tools,
      allowed_skills: node.allowed_skills,
      input_context: Object.keys(node.input_contract).length ? JSON.stringify(node.input_contract) : null,
      output_contract: Object.keys(node.output_contract).length ? JSON.stringify(node.output_contract) : null,
      metadata: { role: node.agent_selector?.role || null, node_kind: node.kind },
    }));
    const proposal = createDagProposal({
      missionId: session.mission_spec_contract?.missionId || session.session_id,
      sessionId: session.session_id,
      orchestratorAgentId: orchestratorBinding.agent_id,
      sourceMessageId: null,
      sourceRevision: session.confirmed_plan_revision || null,
      sourceOption: session.confirmed_plan_option || null,
      title: definition.title,
      summary: definition.objective,
      missionSpecContract: session.mission_spec_contract || null,
      plannerContext: {
        provider_id: orchestratorBinding.provider_id,
        model: orchestratorBinding.model,
        orchestrator_agent_id: orchestratorBinding.agent_id,
        system_prompt_summary: orchestratorBinding.system_prompt.slice(0, 240),
        fallback_used: false,
        fallback_reason: null,
      },
      dagDraft: { protocol_version: 1, definition_id: definition.definition_id },
      routeCompare: null,
      assignments,
      orchestrationDecision: decision,
      dagDefinition: definition,
      warnings: [],
      checklist: ["Review DAG structure and assignments.", "Confirm before execution."],
      metadata: { protocol_version: 1, source_kind: "model", idempotency_key: idempotencyKey, team_id: typeof args.team_id === "string" ? args.team_id : null },
    });
    return { ok: true, created: true, converged: false, proposal: dagProposalToolProjection(proposal) };
  }
  if (toolName === "delegate_task") {
    const dag = createAgentDag({ workspaceId, sessionId: session.session_id, sourceMessageId: null, idempotencyKey: `delegate:${String(args.idempotency_key)}`, title: String(args.name), objective: String(args.objective), orchestratorBinding, parentDagId, delegationDepth: childDelegationDepth, policy: { ...(parentDag?.policy || {}), require_reviewer: args.require_reviewer === true }, createdBy: session.created_by || "main-agent" });
    const binding = createAgentBindingSnapshot({ workspaceId, agentId: String(args.agent_id), agentVersion: typeof args.agent_version === "number" ? args.agent_version : null, bindingMode: "pinned" });
    const added = addAgentDagTask({ dag, name: String(args.name), objective: String(args.objective), binding, role: typeof args.role === "string" ? agentRole(args.role) : binding.agent_role, requestedAutonomy: autonomyMode(args.autonomy_mode), ...(Array.isArray(args.allowed_tools) ? { allowedTools: args.allowed_tools as string[] } : {}), maxToolRounds: typeof args.max_tool_rounds === "number" ? args.max_tool_rounds : undefined, maxRuntimeSeconds: typeof args.max_runtime_seconds === "number" ? args.max_runtime_seconds : undefined, idempotencyKey: String(args.idempotency_key) });
    let reviewerTaskId: string | null = null;
    if (args.require_reviewer === true) {
      if (typeof args.reviewer_agent_id !== "string" || !args.reviewer_agent_id.trim()) throw new ConversationToolError("reviewer_agent_required", "require_reviewer=true requires reviewer_agent_id.");
      const reviewerBinding = createAgentBindingSnapshot({ workspaceId, agentId: args.reviewer_agent_id, agentVersion: typeof args.reviewer_agent_version === "number" ? args.reviewer_agent_version : null, bindingMode: "pinned" });
      const review = addAgentDagTask({ dag, name: `Review: ${String(args.name)}`, objective: `Independently verify the delegated result for: ${String(args.objective)}. Report evidence, defects, and whether the result is acceptable.`, binding: reviewerBinding, role: "reviewer", dependsOn: [added.node.node_id], context: { review_task_id: added.task.task_id }, requestedAutonomy: "review_first", ...(Array.isArray(args.allowed_tools) ? { allowedTools: args.allowed_tools as string[] } : {}), idempotencyKey: `${String(args.idempotency_key)}:review` });
      reviewerTaskId = review.task.task_id;
    }
    const ownerSessionId = conversationWorkspaceSessionId(session);
    const ownerSession = getSession(ownerSessionId);
    if (ownerSession) {
      const ownerMetadata = ownerSession.metadata && typeof ownerSession.metadata === "object"
        ? ownerSession.metadata
        : {};
      const activeDagIds = Array.isArray(ownerMetadata.active_agent_dag_ids)
        ? ownerMetadata.active_agent_dag_ids.filter((item): item is string => typeof item === "string")
        : [];
      ownerSession.metadata = {
        ...ownerMetadata,
        latest_agent_dag_id: parentDagId
          ? typeof ownerMetadata.latest_agent_dag_id === "string"
            ? ownerMetadata.latest_agent_dag_id
            : parentDagId
          : dag.dag_id,
        active_agent_dag_ids: [...new Set([...activeDagIds, dag.dag_id])],
        latest_delegated_agent_dag_id: dag.dag_id,
        latest_orchestrator_intent: parentDagId ? "agent_dag_expanded" : "agent_task_delegated",
        pending_decision: "Monitor delegated Agent work, evidence, and any Human Gate.",
      };
      ownerSession.status = "running";
      ownerSession.current_plan_summary = parentDagId
        ? `Agent DAG ${parentDagId} delegated child DAG ${dag.dag_id}.`
        : `Delegated Agent DAG ${dag.dag_id} is starting.`;
      ownerSession.updated_at = nowIso();
      saveSession(ownerSession);
    }
    const execution = agentDagExecutionHandler ? await agentDagExecutionHandler({ workspaceId, dagId: dag.dag_id }) : { queued: true, reason: "Agent DAG Runner is unavailable." };
    return { ok: true, delegated: true, dag_id: dag.dag_id, task_id: added.task.task_id, node_id: added.node.node_id, reviewer_task_id: reviewerTaskId, execution };
  }
  throw new ConversationToolError("tool_not_allowed", "Unsupported Agent orchestration tool.");
}

function workspaceToolNeedsDesktopApproval(
  session: SessionRecord,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (toolName !== "workspace_apply_operations" && toolName !== "workspace_run_command") return false;
  if (toolName === "workspace_run_command" && args.network === "public") return true;
  const mode = session.metadata?.autonomy_mode;
  if (mode === "review_first") return true;
  if (mode === "assisted" && toolName === "workspace_apply_operations" && Array.isArray(args.operations)) {
    const destructive = args.operations.filter((item) => item && typeof item === "object" &&
      ["delete", "move"].includes(String((item as Record<string, unknown>).kind || ""))).length;
    return destructive >= 20;
  }
  return false;
}

function normalizedWebTarget(value: unknown): { url: string; hostname: string } | null {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    url.searchParams.sort();
    return { url: url.toString(), hostname: url.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function browserSnapshotHasUsefulContent(snapshot: Record<string, unknown>, hostname: string): boolean {
  const title = String(snapshot.title || "").trim();
  const text = String(snapshot.text || "").replace(/\s+/gu, " ").trim();
  const suspicious = /(?:让每一次点击都充满意义|enable javascript|access denied|just a moment|checking your browser|verify you are human|captcha)/iu;
  if (suspicious.test(`${title}\n${text}`)) return false;
  if (text.length >= 400) return true;
  const normalizedTitle = title.toLowerCase().replace(/^www\./u, "");
  const normalizedHost = hostname.toLowerCase().replace(/^www\./u, "");
  return text.length >= 120 && Boolean(normalizedTitle) && normalizedTitle !== normalizedHost;
}

function markDuplicateWebRead(state: ConversationWebTurnState): void {
  state.duplicate_read_calls += 1;
  if (state.duplicate_read_calls >= 2) state.budget_exhausted = true;
}

function normalizedSearchQuery(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/gu, " ");
}

function resultError(result: ConversationToolResult): { code: string; message: string } {
  return {
    code: String(result.content.code || "browser_fallback_failed"),
    message: String(result.content.message || "The isolated browser fallback failed."),
  };
}

function relatedActionIds(results: ConversationToolResult[]): string[] {
  return results.map((result) => result.action_id).filter(Boolean);
}

export async function executeConversationTool(input: {
  session: SessionRecord;
  call: ConversationToolCall;
  onProgress?: (progress: ConversationToolProgress) => void | Promise<void>;
  onDesktopCapability?: (request: ConversationDesktopCapabilityRequest) => void | Promise<void>;
  webTurnState?: ConversationWebTurnState;
  internalBrowserFallback?: boolean;
}): Promise<ConversationToolResult> {
  const workspaceId = input.session.workspace_id || "default";
  const riskLevel = toolRiskLevel(input.call.name, workspaceId);
  const capabilityExecutor = getCapabilityRegistry().toolExecutor(input.call.name, workspaceId);
  const executionPolicy = getCapabilityRegistry().toolExecutionPolicy(input.call.name, workspaceId);
  const idempotencyKey = typeof input.call.arguments.idempotency_key === "string"
    ? input.call.arguments.idempotency_key.trim()
    : "";
  const governedWorkspaceWorker = input.call.name === "workspace_apply_operations" ||
    input.call.name === "workspace_run_command";
  const action = createConversationAction({
    workspaceId: input.session.workspace_id || "default",
    sessionId: input.session.session_id,
    toolCallId: input.call.id,
    toolName: input.call.name,
    arguments: input.call.arguments,
    idempotencyKey: idempotencyKey || null,
    riskLevel,
    executor: governedWorkspaceWorker || capabilityExecutor === "worker"
      ? "runtime-worker"
      : capabilityExecutor || "control-plane",
  });
  const emit = async (
    record: ConversationActionRecord,
    status: "running" | "pending_approval" | "succeeded" | "failed",
    summary?: string,
  ) => {
    try {
      await input.onProgress?.({
        action_id: record.action_id,
        tool_call_id: record.tool_call_id,
        tool_name: record.tool_name,
        risk_level: record.risk_level,
        status,
        summary: summary || progressSummary(record.tool_name, status, workspaceId),
      });
    } catch {
      // Progress reporting is observational and must not change tool execution state.
    }
  };
  await emit(action, "running");
  try {
    if (executionPolicy?.idempotency_required && !idempotencyKey) {
      throw new ConversationToolError(
        "idempotency_key_required",
        `Capability tool ${input.call.name} requires a stable idempotency_key for this side effect.`,
      );
    }
    validateToolArguments(input.call.name, input.call.arguments, workspaceId);
    if (executionPolicy?.idempotency_required && idempotencyKey) {
      const previous = findConversationActionByIdempotencyKey(input.session.session_id, input.call.name, idempotencyKey, action.action_id);
      if (previous && previous.action_id !== action.action_id) {
        if (previous.status === "running" || previous.status === "pending_approval") {
          throw new ConversationToolError(
            "idempotency_action_in_progress",
            `The idempotency_key ${idempotencyKey} is already running; wait for its existing action to finish.`,
          );
        }
        if (previous.arguments_digest !== action.arguments_digest) {
          throw new ConversationToolError(
            "idempotency_key_conflict",
            `The idempotency_key ${idempotencyKey} was already used with different arguments.`,
          );
        }
        const replayResult = {
          ...(previous.result || { ok: false, code: previous.error_code || "idempotent_action_failed" }),
          idempotent_replay: true,
          original_action_id: previous.action_id,
        };
        const replayed = completeConversationAction({
          action,
          result: replayResult,
          errorCode: previous.status === "failed" ? previous.error_code : null,
        });
        await emit(replayed, previous.status === "failed" ? "failed" : "succeeded", "Reused the persisted idempotent action result");
        return {
          tool_call_id: input.call.id,
          tool_name: input.call.name,
          action_id: action.action_id,
          is_error: previous.status === "failed",
          content: replayResult,
        };
      }
    }
    const webState = input.webTurnState;
    if (input.call.name === "web_search" && webState) {
      const query = normalizedSearchQuery(input.call.arguments.query);
      if (webState.seen_search_queries.has(query)) {
        throw new ConversationToolError(
          "web_search_duplicate_skipped",
          "This search query already ran in the current turn. Use the evidence already collected.",
        );
      }
      if (webState.search_calls >= MAX_WEB_SEARCH_CALLS_PER_TURN) {
        webState.budget_exhausted = true;
        throw new ConversationToolError(
          "web_research_budget_reached",
          "The bounded web research budget is complete. Answer from the evidence already collected or continue with a non-web tool.",
        );
      }
      webState.seen_search_queries.add(query);
      webState.search_calls += 1;
      if (webState.search_calls >= MAX_WEB_SEARCH_CALLS_PER_TURN) webState.budget_exhausted = true;
    }
    if (input.call.name === "web_fetch" && webState) {
      const target = normalizedWebTarget(input.call.arguments.url);
      const cached = target ? webState.fetched_pages.get(target.url) : null;
      if (cached) {
        markDuplicateWebRead(webState);
        const result = { ...structuredClone(cached), cache_hit: true };
        const completed = completeConversationAction({ action, result });
        await emit(completed, "succeeded", "Using webpage already read in this turn");
        return {
          tool_call_id: input.call.id,
          tool_name: input.call.name,
          action_id: action.action_id,
          is_error: false,
          content: result,
        };
      }
      const blockedReason = target ? webState.blocked_hosts.get(target.hostname) : null;
      if (blockedReason) {
        throw new ConversationToolError(
          "web_host_circuit_open",
          `Further reads from ${target!.hostname} are paused for this turn after ${blockedReason}. Choose another source or use existing evidence.`,
        );
      }
      if (webState.fetch_calls >= MAX_WEB_FETCH_CALLS_PER_TURN) {
        webState.budget_exhausted = true;
        throw new ConversationToolError(
          "web_research_budget_reached",
          "The bounded webpage read budget is complete. Answer from the evidence already collected or continue with a non-web tool.",
        );
      }
      webState.fetch_calls += 1;
      if (webState.fetch_calls >= MAX_WEB_FETCH_CALLS_PER_TURN) webState.budget_exhausted = true;
    }
    if (input.call.name === "browser_navigate" && webState && !input.internalBrowserFallback) {
      const target = normalizedWebTarget(input.call.arguments.url);
      if (target && (webState.fetched_pages.has(target.url) || webState.seen_browser_urls.has(target.url))) {
        markDuplicateWebRead(webState);
        const cached = webState.fetched_pages.get(target.url);
        const result = {
          ok: true,
          skipped: true,
          already_read: true,
          url: target.url,
          browser_session_available: false,
          do_not_snapshot: true,
          message: "This exact webpage was already read in the current turn. Use the evidence already collected.",
          ...(cached ? { evidence: structuredClone(cached) } : {}),
        };
        const completed = completeConversationAction({ action, result });
        await emit(completed, "succeeded", "Using webpage already read in this turn");
        return {
          tool_call_id: input.call.id,
          tool_name: input.call.name,
          action_id: action.action_id,
          is_error: false,
          content: result,
        };
      }
      if (webState.browser_navigation_calls >= MAX_BROWSER_NAVIGATIONS_PER_TURN) {
        webState.budget_exhausted = true;
        throw new ConversationToolError(
          "web_research_budget_reached",
          "The bounded browser navigation budget is complete. Use the evidence already collected.",
        );
      }
      webState.browser_navigation_calls += 1;
      if (target) webState.seen_browser_urls.add(target.url);
    }
    if (governedWorkspaceWorker) {
      const workspaceSessionId = conversationWorkspaceSessionId(input.session);
      const binding = getActiveSessionWorkspaceBinding(workspaceSessionId);
      const autonomyMode = input.session.metadata?.autonomy_mode;
      const workspaceNeedsAuthorization =
        (!binding || binding.status !== "active" || binding.access !== "sandbox-write") &&
        autonomyMode !== "review_first";
      if (workspaceNeedsAuthorization) {
        if (!input.onDesktopCapability) {
          throw new ConversationToolError(
            "desktop_workspace_authorization_unavailable",
            "Sandboxed Workspace writes require an active My Mate Desktop authorization flow.",
          );
        }
        const pending = markConversationActionPendingApproval(action);
        await emit(pending, "pending_approval", "Workspace sandbox access requires confirmation");
        await input.onDesktopCapability({
          action_id: action.action_id,
          session_id: input.session.session_id,
          type: "workspace.authorize",
          capability_id: input.call.name,
          executor: "worker",
          risk_level: riskLevel,
          arguments: structuredClone(input.call.arguments),
          workspace_access: "sandbox-write",
          workspace_scope: "session",
        });
        const authorized = getActiveSessionWorkspaceBinding(workspaceSessionId);
        if (!authorized || authorized.status !== "active" || authorized.access !== "sandbox-write") {
          throw new ConversationToolError(
            "workspace_write_not_authorized",
            "The Task Workspace was not authorized for sandboxed writes.",
          );
        }
        const approved = markConversationActionApproved(pending);
        await emit(approved, "running", "Workspace sandbox access authorized; continuing the original action");
      }
    }
    if (workspaceToolNeedsDesktopApproval(input.session, input.call.name, input.call.arguments)) {
      if (!input.onDesktopCapability) {
        throw new ConversationToolError(
          "desktop_approval_unavailable",
          "This sandbox action requires one-time approval from My Mate Desktop.",
        );
      }
      const pending = markConversationActionPendingApproval(action);
      await emit(pending, "pending_approval");
      await input.onDesktopCapability({
        action_id: action.action_id,
        session_id: input.session.session_id,
        type: "capability.approve",
        capability_id: input.call.name,
        executor: "worker",
        risk_level: riskLevel,
        arguments: structuredClone(input.call.arguments),
      });
      const attested = getConversationAction(input.session.session_id, action.action_id);
      if (attested?.status === "failed" && attested.result) {
        await emit(attested, "failed");
        return {
          tool_call_id: input.call.id,
          tool_name: input.call.name,
          action_id: action.action_id,
          is_error: true,
          content: attested.result,
        };
      }
      if (attested?.status !== "running" || attested.result?.approved !== true) {
        throw new ConversationToolError(
          "desktop_approval_unattested",
          "Desktop did not return a verified approval for the sandbox action.",
        );
      }
      await emit(attested, "running");
    }
    let result: Record<string, unknown>;
    if (input.call.name === "system_clock_read") result = readClock();
    else if (input.call.name === "system_host_info") result = readHostInfo();
    else if (input.call.name === "system_hardware_info") result = await readHardwareInfo();
    else if (input.call.name === "system_recycle_bin_inspect") result = await inspectRecycleBin(input.call.arguments);
    else if (input.call.name === "desktop_application_open") {
      if (!input.onDesktopCapability) {
        throw new ConversationToolError(
          "desktop_capability_unavailable",
          "Opening applications requires an active My Mate Desktop connection.",
        );
      }
      const pending = markConversationActionPendingApproval(action);
      await emit(pending, "pending_approval");
      await input.onDesktopCapability({
        action_id: action.action_id,
        session_id: input.session.session_id,
        type: "application.open",
        application_name: String(input.call.arguments.application_name).trim(),
      });
      const attested = getConversationAction(input.session.session_id, action.action_id);
      if (!attested || !["succeeded", "failed"].includes(attested.status) || !attested.result) {
        throw new ConversationToolError(
          "desktop_capability_unattested",
          "The Desktop did not return a verified application launch result.",
        );
      }
      await emit(attested, attested.status);
      return {
        tool_call_id: input.call.id,
        tool_name: input.call.name,
        action_id: action.action_id,
        is_error: attested.status === "failed",
        content: attested.result,
      };
    }
    else if (input.call.name === "workspace_list") result = listWorkspace(conversationWorkspaceSessionId(input.session), input.call.arguments);
    else if (input.call.name === "workspace_read_text") result = readWorkspaceText(conversationWorkspaceSessionId(input.session), input.call.arguments);
    else if (input.call.name === "workspace_search") result = searchConversationWorkspace({
      session: input.session,
      query: String(input.call.arguments.query || ""),
      path: typeof input.call.arguments.path === "string" ? input.call.arguments.path : undefined,
      maxResults: typeof input.call.arguments.max_results === "number" ? input.call.arguments.max_results : undefined,
    });
    else if (input.call.name === "workspace_apply_operations") result = applyConversationWorkspaceOperations({
      session: input.session,
      idempotencyKey: String(input.call.arguments.idempotency_key || ""),
      operations: input.call.arguments.operations as WorkspaceOperation[],
    });
    else if (input.call.name === "workspace_run_command") result = await runConversationWorkspaceCommand({
      session: input.session,
      idempotencyKey: String(input.call.arguments.idempotency_key || ""),
      command: String(input.call.arguments.command || ""),
      args: Array.isArray(input.call.arguments.args) ? input.call.arguments.args as string[] : undefined,
      cwd: typeof input.call.arguments.cwd === "string" ? input.call.arguments.cwd : undefined,
      timeoutSeconds: typeof input.call.arguments.timeout_seconds === "number" ? input.call.arguments.timeout_seconds : undefined,
      env: input.call.arguments.env && typeof input.call.arguments.env === "object" && !Array.isArray(input.call.arguments.env)
        ? input.call.arguments.env as Record<string, string>
        : undefined,
      network: input.call.arguments.network === "public" ? "public" : "none",
    });
    else if (input.call.name === "workspace_status") result = conversationWorkspaceStatus(input.session);
    else if (input.call.name.startsWith("schedule_")) result = scheduleToolResult(input.session, input.call.name, input.call.arguments);
    else if (["agent_list", "agent_team_list", "dag_propose", "dag_status", "dag_run", "dag_cancel", "delegate_task"].includes(input.call.name)) result = await agentOrchestrationToolResult(input.session, input.call.name, input.call.arguments);
    else if (capabilityExecutor === "desktop" || capabilityExecutor === "browser") {
      if (!input.onDesktopCapability) {
        throw new ConversationToolError(
          "desktop_capability_unavailable",
          `The ${capabilityExecutor} capability requires an active My Mate Desktop connection.`,
        );
      }
      if (riskLevel === "T2" || riskLevel === "T3") {
        const pending = markConversationActionPendingApproval(action);
        await emit(pending, "pending_approval");
      }
      await input.onDesktopCapability({
        action_id: action.action_id,
        session_id: input.session.session_id,
        type: "capability.execute",
        capability_id: input.call.name,
        executor: capabilityExecutor,
        risk_level: riskLevel,
        arguments: structuredClone(input.call.arguments),
      });
      const attested = getConversationAction(input.session.session_id, action.action_id);
      if (!attested || !["succeeded", "failed"].includes(attested.status) || !attested.result) {
        throw new ConversationToolError(
          "desktop_capability_unattested",
          `The Desktop did not return a verified ${capabilityExecutor} capability result.`,
        );
      }
      await emit(attested, attested.status);
      return {
        tool_call_id: input.call.id,
        tool_name: input.call.name,
        action_id: action.action_id,
        is_error: attested.status === "failed",
        content: attested.result,
      };
    }
    else if (capabilityExecutor === "mcp" || capabilityExecutor === "worker") {
      if (riskLevel === "T2" || riskLevel === "T3") {
        if (!input.onDesktopCapability) {
          throw new ConversationToolError(
            "desktop_approval_unavailable",
            `This ${capabilityExecutor} action requires approval from My Mate Desktop.`,
          );
        }
        const pending = markConversationActionPendingApproval(action);
        await emit(pending, "pending_approval");
        await input.onDesktopCapability({
          action_id: action.action_id,
          session_id: input.session.session_id,
          type: "capability.approve",
          capability_id: input.call.name,
          executor: capabilityExecutor,
          risk_level: riskLevel,
          arguments: structuredClone(input.call.arguments),
        });
        const attested = getConversationAction(input.session.session_id, action.action_id);
        if (attested?.status === "failed" && attested.result) {
          await emit(attested, "failed");
          return {
            tool_call_id: input.call.id,
            tool_name: input.call.name,
            action_id: action.action_id,
            is_error: true,
            content: attested.result,
          };
        }
        if (attested?.status !== "running" || attested.result?.approved !== true) {
          throw new ConversationToolError(
            "desktop_approval_unattested",
            `Desktop did not return a verified approval for the ${capabilityExecutor} action.`,
          );
        }
        await emit(attested, "running");
      }
      if (capabilityExecutor === "worker") {
        if (input.call.name !== "skill_script_run") {
          throw new CapabilityToolError(
            "worker_capability_unavailable",
            `No governed Worker adapter is available for ${input.call.name}.`,
          );
        }
        const scriptArguments = input.call.arguments.arguments;
        result = await runSkillScript({
          session: input.session,
          skillId: String(input.call.arguments.skill_id || ""),
          scriptId: String(input.call.arguments.script_id || ""),
          idempotencyKey,
          arguments: scriptArguments && typeof scriptArguments === "object" && !Array.isArray(scriptArguments)
            ? scriptArguments as Record<string, unknown>
            : {},
        });
      } else {
        result = await getCapabilityRegistry().executeTool({
          toolName: input.call.name,
          session: input.session,
          arguments: input.call.arguments,
          actionId: action.action_id,
        });
      }
    }
    else if (getCapabilityRegistry().hasTool(input.call.name, workspaceId)) {
      result = await getCapabilityRegistry().executeTool({
        toolName: input.call.name,
        session: input.session,
        arguments: input.call.arguments,
        actionId: action.action_id,
      });
    }
    else throw new ConversationToolError("tool_not_allowed", "This tool is not available to Conversation Agent.");
    if (input.call.name === "web_fetch" && input.webTurnState) {
      const target = normalizedWebTarget(input.call.arguments.url);
      if (target) input.webTurnState.fetched_pages.set(target.url, structuredClone(result));
    }
    const completed = completeConversationAction({ action, result });
    await emit(completed, "succeeded");
    return {
      tool_call_id: input.call.id,
      tool_name: input.call.name,
      action_id: action.action_id,
      is_error: false,
      content: result,
    };
  } catch (error) {
    const exposedError = error instanceof ConversationToolError ||
      error instanceof CapabilityToolError ||
      error instanceof ConversationCodingError;
    const code = exposedError ? error.code : "tool_execution_failed";
    const message = exposedError
      ? error.message
      : "The Conversation tool could not complete safely.";
    const target = input.call.name === "web_fetch"
      ? normalizedWebTarget(input.call.arguments.url)
      : null;
    const canUseBrowserFallback = input.call.name === "web_fetch" &&
      !input.internalBrowserFallback &&
      WEB_FETCH_BROWSER_FALLBACK_CODES.has(code) &&
      Boolean(input.onDesktopCapability) &&
      getCapabilityRegistry().hasTool("browser_navigate", workspaceId) &&
      getCapabilityRegistry().hasTool("browser_snapshot", workspaceId);
    if (canUseBrowserFallback && target) {
      const browserResults: ConversationToolResult[] = [];
      let browserSessionId = "";
      let fallbackError: { code: string; message: string } | null = null;
      await emit(action, "running", "Direct read blocked; trying an isolated browser");
      const navigate = await executeConversationTool({
        session: input.session,
        call: {
          id: `${input.call.id}:browser-navigate`,
          name: "browser_navigate",
          arguments: { url: target.url, mode: "isolated", read_only_extract: true },
        },
        onProgress: input.onProgress,
        onDesktopCapability: input.onDesktopCapability,
        internalBrowserFallback: true,
      });
      browserResults.push(navigate);
      if (navigate.is_error) {
        fallbackError = resultError(navigate);
      } else {
        browserSessionId = String(navigate.content.browser_session_id || "");
        let snapshot = await executeConversationTool({
          session: input.session,
          call: {
            id: `${input.call.id}:browser-snapshot`,
            name: "browser_snapshot",
            arguments: {
              browser_session_id: browserSessionId,
              max_chars: Math.min(50_000, Number(input.call.arguments.max_chars || 30_000)),
            },
          },
          onProgress: input.onProgress,
          onDesktopCapability: input.onDesktopCapability,
          internalBrowserFallback: true,
        });
        browserResults.push(snapshot);
        if (snapshot.is_error) {
          fallbackError = resultError(snapshot);
        } else {
          if (!browserSnapshotHasUsefulContent(snapshot.content, target.hostname)) {
            const fullNavigate = await executeConversationTool({
              session: input.session,
              call: {
                id: `${input.call.id}:browser-full-navigate`,
                name: "browser_navigate",
                arguments: {
                  url: target.url,
                  mode: "isolated",
                  browser_session_id: browserSessionId,
                  read_only_extract: false,
                },
              },
              onProgress: input.onProgress,
              onDesktopCapability: input.onDesktopCapability,
              internalBrowserFallback: true,
            });
            browserResults.push(fullNavigate);
            if (fullNavigate.is_error) {
              fallbackError = resultError(fullNavigate);
            } else {
              snapshot = await executeConversationTool({
                session: input.session,
                call: {
                  id: `${input.call.id}:browser-full-snapshot`,
                  name: "browser_snapshot",
                  arguments: {
                    browser_session_id: browserSessionId,
                    max_chars: Math.min(50_000, Number(input.call.arguments.max_chars || 30_000)),
                  },
                },
                onProgress: input.onProgress,
                onDesktopCapability: input.onDesktopCapability,
                internalBrowserFallback: true,
              });
              browserResults.push(snapshot);
              if (snapshot.is_error) fallbackError = resultError(snapshot);
            }
          }
          if (!fallbackError && !browserSnapshotHasUsefulContent(snapshot.content, target.hostname)) {
            fallbackError = {
              code: "browser_content_insufficient",
              message: "The isolated browser loaded the page but did not expose meaningful page content.",
            };
          }
          if (!fallbackError) {
            if (browserSessionId && getCapabilityRegistry().hasTool("browser_close", workspaceId)) {
              const closed = await executeConversationTool({
                session: input.session,
                call: {
                  id: `${input.call.id}:browser-close`,
                  name: "browser_close",
                  arguments: { browser_session_id: browserSessionId },
                },
                onDesktopCapability: input.onDesktopCapability,
                internalBrowserFallback: true,
              });
              browserResults.push(closed);
              browserSessionId = "";
            }
            const result: Record<string, unknown> = {
            ok: true,
            url: String(snapshot.content.url || target.url),
            status: null,
            content_type: "text/html; browser-rendered",
            title: String(snapshot.content.title || target.hostname),
            description: "",
            format: "text",
            content: String(snapshot.content.text || ""),
            truncated: snapshot.content.truncated === true,
            untrusted_content: true,
            fetch_mode: "isolated_browser",
            direct_fetch_error: { code, message },
            related_action_ids: relatedActionIds(browserResults),
          };
            if (input.webTurnState) {
              input.webTurnState.fetched_pages.set(target.url, structuredClone(result));
              input.webTurnState.seen_browser_urls.add(target.url);
            }
            const completed = completeConversationAction({ action, result });
            await emit(completed, "succeeded", "Webpage read in an isolated browser");
            return {
              tool_call_id: input.call.id,
              tool_name: input.call.name,
              action_id: action.action_id,
              is_error: false,
              content: result,
            };
          }
        }
      }
      if (browserSessionId && getCapabilityRegistry().hasTool("browser_close", workspaceId)) {
        const closed = await executeConversationTool({
          session: input.session,
          call: {
            id: `${input.call.id}:browser-close`,
            name: "browser_close",
            arguments: { browser_session_id: browserSessionId },
          },
          onDesktopCapability: input.onDesktopCapability,
          internalBrowserFallback: true,
        });
        browserResults.push(closed);
      }
      if (input.webTurnState) {
        input.webTurnState.blocked_hosts.set(target.hostname, `${code}; isolated browser fallback failed`);
      }
      const result = errorResult(code, message) as Record<string, unknown>;
      result.browser_fallback_error = fallbackError;
      result.related_action_ids = relatedActionIds(browserResults);
      const completed = completeConversationAction({ action, result, errorCode: code });
      await emit(completed, "failed", `Could not read ${target.hostname}; use another source`);
      return {
        tool_call_id: input.call.id,
        tool_name: input.call.name,
        action_id: action.action_id,
        is_error: true,
        content: result,
      };
    }
    if (target && input.webTurnState && WEB_FETCH_BROWSER_FALLBACK_CODES.has(code)) {
      input.webTurnState.blocked_hosts.set(target.hostname, code);
    }
    const result = errorResult(code, message);
    const completed = completeConversationAction({ action, result, errorCode: code });
    await emit(
      completed,
      "failed",
      target ? `Could not read ${target.hostname}; use another source` : undefined,
    );
    return {
      tool_call_id: input.call.id,
      tool_name: input.call.name,
      action_id: action.action_id,
      is_error: true,
      content: result,
    };
  }
}
