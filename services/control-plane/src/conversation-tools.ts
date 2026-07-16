import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  completeConversationAction,
  createConversationAction,
  getConversationAction,
  markConversationActionPendingApproval,
} from "./conversation-action-store.js";
import { getActiveSessionWorkspaceBinding } from "./workspace-binding-store.js";
import { CapabilityToolError, getCapabilityRegistry } from "./capability-registry.js";
import type {
  ConversationActionRecord,
  ConversationActionRiskLevel,
  SessionRecord,
  WorkspaceBindingRecord,
} from "./types.js";

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
  type: "application.open" | "capability.execute" | "capability.approve";
  application_name?: string;
  capability_id?: string;
  executor?: "desktop" | "browser" | "mcp";
  risk_level?: ConversationActionRiskLevel;
  arguments?: Record<string, unknown>;
}

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
] as const;

getCapabilityRegistry().reserveCapabilityIds(
  BUILT_IN_CONVERSATION_TOOL_DEFINITIONS.map((tool) => tool.name),
);

export function getConversationToolDefinitions(workspaceId?: string): Array<{
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
  return [...builtIn, ...pluginTools];
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
  const target = resolvedWorkspacePath(binding, relativePath);
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
  const target = resolvedWorkspacePath(binding, relativePath);
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
  if (toolName.startsWith("system_")) return "T0";
  const capabilityRisk = getCapabilityRegistry().toolRiskLevel(toolName, workspaceId);
  return capabilityRisk || "T1";
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
            : getCapabilityRegistry().toolProgressLabel(toolName, workspaceId) || "Running Conversation tool";
  return status === "running" ? label : status === "pending_approval" ? `${label} requires confirmation` : `${label} ${status}`;
}

export async function executeConversationTool(input: {
  session: SessionRecord;
  call: ConversationToolCall;
  onProgress?: (progress: ConversationToolProgress) => void | Promise<void>;
  onDesktopCapability?: (request: ConversationDesktopCapabilityRequest) => void | Promise<void>;
}): Promise<ConversationToolResult> {
  const workspaceId = input.session.workspace_id || "default";
  const riskLevel = toolRiskLevel(input.call.name, workspaceId);
  const capabilityExecutor = getCapabilityRegistry().toolExecutor(input.call.name, workspaceId);
  const action = createConversationAction({
    workspaceId: input.session.workspace_id || "default",
    sessionId: input.session.session_id,
    toolCallId: input.call.id,
    toolName: input.call.name,
    arguments: input.call.arguments,
    riskLevel,
    executor: capabilityExecutor === "worker" ? "runtime-worker" : capabilityExecutor || "control-plane",
  });
  const emit = async (
    record: ConversationActionRecord,
    status: "running" | "pending_approval" | "succeeded" | "failed",
  ) => {
    try {
      await input.onProgress?.({
        action_id: record.action_id,
        tool_call_id: record.tool_call_id,
        tool_name: record.tool_name,
        risk_level: record.risk_level,
        status,
        summary: progressSummary(record.tool_name, status, workspaceId),
      });
    } catch {
      // Progress reporting is observational and must not change tool execution state.
    }
  };
  await emit(action, "running");
  try {
    validateToolArguments(input.call.name, input.call.arguments, workspaceId);
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
    else if (input.call.name === "workspace_list") result = listWorkspace(input.session.session_id, input.call.arguments);
    else if (input.call.name === "workspace_read_text") result = readWorkspaceText(input.session.session_id, input.call.arguments);
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
    else if (capabilityExecutor === "mcp") {
      if (riskLevel === "T2" || riskLevel === "T3") {
        if (!input.onDesktopCapability) {
          throw new ConversationToolError(
            "desktop_approval_unavailable",
            "This MCP action requires approval from My Mate Desktop.",
          );
        }
        const pending = markConversationActionPendingApproval(action);
        await emit(pending, "pending_approval");
        await input.onDesktopCapability({
          action_id: action.action_id,
          session_id: input.session.session_id,
          type: "capability.approve",
          capability_id: input.call.name,
          executor: "mcp",
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
            "Desktop did not return a verified approval for the MCP action.",
          );
        }
        await emit(attested, "running");
      }
      result = await getCapabilityRegistry().executeTool({
        toolName: input.call.name,
        session: input.session,
        arguments: input.call.arguments,
        actionId: action.action_id,
      });
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
    const exposedError = error instanceof ConversationToolError || error instanceof CapabilityToolError;
    const code = exposedError ? error.code : "tool_execution_failed";
    const message = exposedError
      ? error.message
      : "The Conversation tool could not complete safely.";
    const result = errorResult(code, message);
    const completed = completeConversationAction({ action, result, errorCode: code });
    await emit(completed, "failed");
    return {
      tool_call_id: input.call.id,
      tool_name: input.call.name,
      action_id: action.action_id,
      is_error: true,
      content: result,
    };
  }
}
