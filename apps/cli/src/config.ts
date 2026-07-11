import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:4030";

export interface CliGlobalOptions {
  baseUrl?: string;
  apiKey?: string;
  config?: string;
  workspace?: string;
}

export interface CliConfig {
  baseUrl: string;
  apiKey: string | null;
  configPath: string;
  workspaceId: string | null;
}

interface UserConfigFile {
  base_url?: unknown;
  api_key_env?: unknown;
  api_key?: unknown;
  workspace_id?: unknown;
}

export class CliConfigError extends Error {}

export function defaultConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".my-mate", "config.json");
}

function readUserConfig(configPath: string): UserConfigFile {
  if (!fs.existsSync(configPath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a JSON object");
    }
    return value as UserConfigFile;
  } catch (error) {
    throw new CliConfigError(
      `Invalid CLI config ${configPath}: ${error instanceof Error ? error.message : "parse failed"}`,
    );
  }
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("only http and https URLs are supported");
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    throw new CliConfigError(
      `Invalid Gateway base URL "${value}": ${error instanceof Error ? error.message : "invalid URL"}`,
    );
  }
}

export function resolveCliConfig(input: {
  options?: CliGlobalOptions;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): CliConfig {
  const env = input.env || process.env;
  const configPath = input.options?.config || defaultConfigPath(input.homeDir);
  const file = readUserConfig(configPath);
  const fileBaseUrl = typeof file.base_url === "string" ? file.base_url : undefined;
  const baseUrl = normalizeBaseUrl(
    input.options?.baseUrl || env.MY_MATE_BASE_URL || fileBaseUrl || DEFAULT_GATEWAY_URL,
  );
  const credentialEnv =
    typeof file.api_key_env === "string" && file.api_key_env.trim()
      ? file.api_key_env.trim()
      : null;
  const fileApiKey = typeof file.api_key === "string" ? file.api_key : null;
  const apiKey =
    input.options?.apiKey ||
    env.MY_MATE_API_KEY ||
    (credentialEnv ? env[credentialEnv] : undefined) ||
    fileApiKey ||
    null;
  const workspaceId =
    input.options?.workspace ||
    env.MY_MATE_WORKSPACE_ID ||
    (typeof file.workspace_id === "string" ? file.workspace_id : null) ||
    null;
  return { baseUrl, apiKey, configPath, workspaceId };
}
