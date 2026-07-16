import type { ConversationActionRiskLevel } from "./types.js";
import type { UpsertMcpServerInput } from "./mcp-server-store.js";

export interface McpConnectorPresetSecret {
  name: string;
  label: string;
  description: string;
  required: boolean;
  placeholder: string;
  help_url: string | null;
}

export interface McpConnectorPreset {
  schema_version: 1;
  preset_id: string;
  name: string;
  provider: string;
  description: string;
  documentation_url: string;
  transport: UpsertMcpServerInput["transport"];
  server: Omit<UpsertMcpServerInput, "secrets">;
  secrets: McpConnectorPresetSecret[];
}

const GITHUB_READ_ONLY_TOOLS = [
  "get_commit",
  "get_file_contents",
  "get_label",
  "get_latest_release",
  "get_me",
  "get_release_by_tag",
  "get_tag",
  "get_team_members",
  "get_teams",
  "issue_read",
  "list_branches",
  "list_commits",
  "list_issues",
  "list_notifications",
  "list_pull_requests",
  "list_releases",
  "list_repository_collaborators",
  "list_starred_repositories",
  "list_tags",
  "pull_request_read",
  "search_code",
  "search_commits",
  "search_issues",
  "search_pull_requests",
  "search_repositories",
  "search_users",
] as const;

const GITHUB_WRITE_TOOLS = [
  "add_comment_to_pending_review",
  "add_issue_comment",
  "assign_copilot_to_issue",
  "create_branch",
  "create_issue",
  "create_or_update_file",
  "create_pull_request",
  "create_pull_request_review",
  "create_pull_request_with_copilot",
  "fork_repository",
  "manage_notification_subscription",
  "manage_repository_notification_subscription",
  "mark_all_notifications_read",
  "push_files",
  "request_copilot_review",
  "star_repository",
  "submit_pending_pull_request_review",
  "update_issue",
  "update_pull_request",
  "update_pull_request_branch",
] as const;

const GITHUB_DESTRUCTIVE_TOOLS = [
  "delete_file",
  "delete_pending_pull_request_review",
  "dismiss_notification",
  "merge_pull_request",
  "unstar_repository",
] as const;

function riskOverrides(): Record<string, ConversationActionRiskLevel> {
  return Object.fromEntries([
    ...GITHUB_READ_ONLY_TOOLS.map((name) => [name, "T1"] as const),
    ...GITHUB_WRITE_TOOLS.map((name) => [name, "T2"] as const),
    ...GITHUB_DESTRUCTIVE_TOOLS.map((name) => [name, "T3"] as const),
  ]);
}

const PRESETS: readonly McpConnectorPreset[] = Object.freeze([
  {
    schema_version: 1,
    preset_id: "github",
    name: "GitHub",
    provider: "GitHub",
    description: "Official GitHub Remote MCP for repositories, issues, pull requests, code search, and related workflows.",
    documentation_url: "https://github.com/github/github-mcp-server",
    transport: "streamable-http",
    server: {
      server_id: "github",
      name: "GitHub MCP",
      description: "Official GitHub Remote MCP connector.",
      transport: "streamable-http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: {
        Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}",
      },
      enabled: false,
      connect_timeout_ms: 30_000,
      tool_timeout_ms: 120_000,
      tool_filter: { include: [], exclude: [] },
      default_risk_level: null,
      tool_risk_overrides: riskOverrides(),
    },
    secrets: [
      {
        name: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "Personal access token",
        description: "Stored encrypted and sent only as the GitHub MCP Authorization header.",
        required: true,
        placeholder: "github_pat_...",
        help_url: "https://github.com/settings/personal-access-tokens/new",
      },
    ],
  },
]);

export function listMcpConnectorPresets(): McpConnectorPreset[] {
  return PRESETS.map((preset) => structuredClone(preset));
}

export function getMcpConnectorPreset(presetId: string): McpConnectorPreset | null {
  const preset = PRESETS.find((item) => item.preset_id === presetId);
  return preset ? structuredClone(preset) : null;
}

export function expandMcpConnectorPreset(
  presetId: string,
  secrets: Record<string, string> = {},
): UpsertMcpServerInput {
  const preset = getMcpConnectorPreset(presetId);
  if (!preset) throw new Error(`Unknown MCP connector preset: ${presetId}`);
  const allowedSecretNames = new Set(preset.secrets.map((secret) => secret.name));
  const selectedSecrets = Object.fromEntries(
    Object.entries(secrets).filter(([name, value]) => allowedSecretNames.has(name) && value.trim()),
  );
  return {
    ...preset.server,
    headers: { ...(preset.server.headers || {}) },
    environment: { ...(preset.server.environment || {}) },
    args: [...(preset.server.args || [])],
    tool_filter: {
      include: [...(preset.server.tool_filter?.include || [])],
      exclude: [...(preset.server.tool_filter?.exclude || [])],
    },
    tool_risk_overrides: { ...(preset.server.tool_risk_overrides || {}) },
    ...(Object.keys(selectedSecrets).length ? { secrets: selectedSecrets } : {}),
  };
}
