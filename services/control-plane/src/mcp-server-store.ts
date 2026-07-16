import path from "node:path";
import type { ConversationActionRiskLevel } from "./types.js";
import { MCP_SERVERS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { nowIso, slugify } from "./utils.js";
import { listMcpServerSecretNames, setMcpServerSecrets } from "./mcp-secret-store.js";
import { getActiveWorkspaceId } from "./request-security.js";

export type McpServerTransport = "stdio" | "streamable-http";
export type McpServerStatus = "disabled" | "disconnected" | "connecting" | "ready" | "error";

export interface McpDiscoveredToolRecord {
  capability_id: string;
  tool_name: string;
  description: string;
  risk_level: ConversationActionRiskLevel;
  read_only: boolean;
  destructive: boolean;
}

export interface McpServerRecord {
  schema_version: 1;
  server_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  transport: McpServerTransport;
  command: string | null;
  args: string[];
  url: string | null;
  headers: Record<string, string>;
  environment: Record<string, string>;
  enabled: boolean;
  status: McpServerStatus;
  last_error: string | null;
  connect_timeout_ms: number;
  tool_timeout_ms: number;
  tool_filter: {
    include: string[];
    exclude: string[];
  };
  default_risk_level: ConversationActionRiskLevel | null;
  tool_risk_overrides: Record<string, ConversationActionRiskLevel>;
  discovered_tools: McpDiscoveredToolRecord[];
  server_version: { name: string; version: string } | null;
  created_at: string;
  updated_at: string;
  last_connected_at: string | null;
}

export interface UpsertMcpServerInput {
  server_id?: string;
  name: string;
  description?: string | null;
  transport: McpServerTransport;
  command?: string | null;
  args?: string[];
  url?: string | null;
  headers?: Record<string, string>;
  environment?: Record<string, string>;
  enabled?: boolean;
  connect_timeout_ms?: number;
  tool_timeout_ms?: number;
  tool_filter?: { include?: string[]; exclude?: string[] };
  default_risk_level?: ConversationActionRiskLevel | null;
  tool_risk_overrides?: Record<string, ConversationActionRiskLevel>;
  secrets?: Record<string, string>;
}

const SERVER_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ENV_TEMPLATE_PATTERN = /^\$\{([A-Z_][A-Z0-9_]{0,127})\}$/u;
const SENSITIVE_HEADER_TEMPLATE_PATTERN = /^(?:(?:Bearer|token)\s+)?\$\{[A-Z_][A-Z0-9_]{0,127}\}$/u;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const RISK_LEVELS = new Set<ConversationActionRiskLevel>(["T0", "T1", "T2", "T3"]);
const BLOCKED_COMMANDS = new Set([
  "bash", "bash.exe", "cmd", "cmd.exe", "dash", "fish", "powershell", "powershell.exe",
  "pwsh", "pwsh.exe", "sh", "sh.exe", "zsh",
]);
const INLINE_CODE_COMMANDS = new Set(["node", "node.exe", "python", "python.exe", "python3", "ruby", "ruby.exe", "perl", "perl.exe"]);
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-api-key"]);

function serverPath(workspaceId: string, serverId: string): string {
  return path.join(MCP_SERVERS_DIR, `${encodeURIComponent(workspaceId)}--${encodeURIComponent(serverId)}.json`);
}

function normalizedStringArray(value: unknown, label: string, maximum = 128): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of at most ${maximum} strings.`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizedTemplates(
  value: unknown,
  label: string,
  options: { requireTemplate?: boolean; sensitiveKeys?: Set<string> } = {},
): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const result: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64) throw new Error(`${label} supports at most 64 entries.`);
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    const text = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!key || key.length > 128 || /[\0\r\n]/u.test(key) || !text || text.length > 4096 || /[\0\r\n]/u.test(text)) {
      throw new Error(`${label} contains an invalid key or value.`);
    }
    if (label === "environment" && !ENV_NAME_PATTERN.test(key)) {
      throw new Error(`Invalid MCP environment variable name: ${key}`);
    }
    const requiresEnvironmentTemplate = options.requireTemplate;
    const requiresSensitiveHeaderTemplate = options.sensitiveKeys?.has(key.toLowerCase()) === true;
    if (requiresEnvironmentTemplate && !ENV_TEMPLATE_PATTERN.test(text)) {
      throw new Error(`${label}.${key} must reference an encrypted or process secret as \${NAME}.`);
    }
    if (requiresSensitiveHeaderTemplate && !SENSITIVE_HEADER_TEMPLATE_PATTERN.test(text)) {
      throw new Error(`${label}.${key} must be a secret reference, optionally prefixed by Bearer or token.`);
    }
    result[key] = text;
  }
  return result;
}

function normalizedRisk(value: unknown, label: string, nullable = false): ConversationActionRiskLevel | null {
  if ((value === null || value === undefined) && nullable) return null;
  if (typeof value !== "string" || !RISK_LEVELS.has(value as ConversationActionRiskLevel)) {
    throw new Error(`${label} must be T0, T1, T2, or T3.`);
  }
  return value as ConversationActionRiskLevel;
}

function validateStdio(command: string, args: string[]): void {
  if (!command || command.length > 1024 || /[\0\r\n;&|<>]/u.test(command)) {
    throw new Error("MCP stdio command must be one executable path without shell operators.");
  }
  const basename = path.basename(command).toLowerCase();
  if (BLOCKED_COMMANDS.has(basename)) {
    throw new Error(`MCP stdio command ${basename} is blocked because shell interpreters are not valid server executables.`);
  }
  if (INLINE_CODE_COMMANDS.has(basename) && args.some((arg) => ["-e", "--eval", "-c", "--command"].includes(arg))) {
    throw new Error(`MCP stdio command ${basename} cannot execute inline code.`);
  }
  if (args.some((arg) => arg.length > 4096 || /[\0\r\n]/u.test(arg))) {
    throw new Error("MCP stdio arguments contain an invalid value.");
  }
  const flattened = `${command} ${args.join(" ")}`.toLowerCase();
  if (/(?:authorized_keys|hermes-0day|\/etc\/sudoers|\/etc\/pam\.d|\bcrontab\b)/u.test(flattened)) {
    throw new Error("MCP stdio configuration matches a blocked persistence indicator.");
  }
}

function normalizedTimeout(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(1_000, Math.floor(parsed)));
}

export function getMcpServer(serverId: string, workspaceId?: string): McpServerRecord | null {
  const storage = getJsonStorageBackend();
  const selectedWorkspaceId = workspaceId || getActiveWorkspaceId() || null;
  if (selectedWorkspaceId) {
    const file = serverPath(selectedWorkspaceId, serverId);
    if (storage.exists(file)) return storage.readJson<McpServerRecord>(file);
    const legacyFile = path.join(MCP_SERVERS_DIR, `${serverId}.json`);
    if (!storage.exists(legacyFile)) return null;
    const legacy = storage.readJson<McpServerRecord>(legacyFile);
    return legacy.workspace_id === selectedWorkspaceId ? legacy : null;
  }
  const matches = listMcpServers().filter((record) => record.server_id === serverId);
  return matches.length === 1 ? matches[0] : null;
}

export function listMcpServers(workspaceId?: string): McpServerRecord[] {
  const selectedWorkspaceId = workspaceId || getActiveWorkspaceId() || undefined;
  const records = new Map<string, McpServerRecord>();
  for (const file of getJsonStorageBackend().listJsonFiles(MCP_SERVERS_DIR)) {
    const record = getJsonStorageBackend().readJson<McpServerRecord>(file);
    if (selectedWorkspaceId && record.workspace_id !== selectedWorkspaceId) continue;
    const key = `${record.workspace_id}\0${record.server_id}`;
    if (records.has(key) && !path.basename(file).includes("--")) continue;
    records.set(key, record);
  }
  return [...records.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function saveMcpServer(record: McpServerRecord): McpServerRecord {
  const storage = getJsonStorageBackend();
  storage.writeJson(serverPath(record.workspace_id, record.server_id), record);
  const legacyFile = path.join(MCP_SERVERS_DIR, `${record.server_id}.json`);
  if (storage.exists(legacyFile)) {
    const legacy = storage.readJson<McpServerRecord>(legacyFile);
    if (legacy.workspace_id === record.workspace_id) storage.removeJson(legacyFile);
  }
  return record;
}

export function upsertMcpServer(workspaceId: string, input: UpsertMcpServerInput): McpServerRecord {
  const generatedId = slugify(input.name).replaceAll("-", ".");
  const serverId = (input.server_id || generatedId).trim().toLowerCase();
  if (!SERVER_ID_PATTERN.test(serverId)) throw new Error("MCP server id must use lowercase letters, digits, dots, dashes, or underscores.");
  const existing = getMcpServer(serverId, workspaceId);
  if (existing && existing.workspace_id !== workspaceId) throw new Error("MCP server belongs to another Workspace.");
  const name = input.name.trim();
  if (!name || name.length > 160) throw new Error("MCP server name is required and limited to 160 characters.");
  if (!["stdio", "streamable-http"].includes(input.transport)) throw new Error("Unsupported MCP transport.");
  const args = normalizedStringArray(input.args, "args");
  const command = typeof input.command === "string" ? input.command.trim() : "";
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (input.transport === "stdio") validateStdio(command, args);
  if (input.transport === "streamable-http") {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("MCP HTTP server requires an absolute URL."); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("MCP HTTP server supports only credential-free HTTP or HTTPS URLs.");
    }
  }
  const headers = normalizedTemplates(input.headers, "headers", { sensitiveKeys: SENSITIVE_HEADERS });
  const environment = normalizedTemplates(input.environment, "environment", { requireTemplate: true });
  const include = normalizedStringArray(input.tool_filter?.include, "tool_filter.include");
  const exclude = normalizedStringArray(input.tool_filter?.exclude, "tool_filter.exclude");
  const overrides: Record<string, ConversationActionRiskLevel> = {};
  for (const [toolName, risk] of Object.entries(input.tool_risk_overrides || {})) {
    const normalizedName = toolName.trim();
    if (!normalizedName || normalizedName.length > 256) throw new Error("Invalid MCP tool risk override name.");
    overrides[normalizedName] = normalizedRisk(risk, `tool_risk_overrides.${toolName}`) as ConversationActionRiskLevel;
  }
  const timestamp = nowIso();
  const enabled = input.enabled !== false;
  const record: McpServerRecord = {
    schema_version: 1,
    server_id: serverId,
    workspace_id: workspaceId,
    name,
    description: typeof input.description === "string" && input.description.trim() ? input.description.trim().slice(0, 1000) : null,
    transport: input.transport,
    command: input.transport === "stdio" ? command : null,
    args: input.transport === "stdio" ? args : [],
    url: input.transport === "streamable-http" ? url : null,
    headers: input.transport === "streamable-http" ? headers : {},
    environment: input.transport === "stdio" ? environment : {},
    enabled,
    status: enabled ? "disconnected" : "disabled",
    last_error: null,
    connect_timeout_ms: normalizedTimeout(input.connect_timeout_ms, 30_000, 120_000),
    tool_timeout_ms: normalizedTimeout(input.tool_timeout_ms, 60_000, 300_000),
    tool_filter: { include, exclude },
    default_risk_level: normalizedRisk(input.default_risk_level, "default_risk_level", true),
    tool_risk_overrides: overrides,
    discovered_tools: existing?.discovered_tools || [],
    server_version: existing?.server_version || null,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
    last_connected_at: existing?.last_connected_at || null,
  };
  saveMcpServer(record);
  if (input.secrets && Object.keys(input.secrets).length) {
    setMcpServerSecrets({ serverId, workspaceId, secrets: input.secrets });
  }
  return record;
}

export function publicMcpServer(record: McpServerRecord): Record<string, unknown> {
  return {
    ...record,
    secret_names: listMcpServerSecretNames(record.server_id, record.workspace_id),
    secret_configured: listMcpServerSecretNames(record.server_id, record.workspace_id).length > 0,
  };
}
