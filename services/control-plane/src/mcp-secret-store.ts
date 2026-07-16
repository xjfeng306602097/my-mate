import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MCP_SECRETS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { nowIso } from "./utils.js";

interface EncryptedMcpSecretRecord {
  schema_version: 1;
  server_id: string;
  workspace_id: string;
  algorithm: "aes-256-gcm";
  iv: string;
  auth_tag: string;
  ciphertext: string;
  secret_names: string[];
  updated_at: string;
}

const MASTER_KEY_FILE = ".mcp-master-key";
const SECRET_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/u;

function secretPath(workspaceId: string, serverId: string): string {
  return path.join(MCP_SECRETS_DIR, `${encodeURIComponent(workspaceId)}--${encodeURIComponent(serverId)}.json`);
}

function decodeConfiguredKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/iu.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Arbitrary deployment secrets are hashed below.
  }
  return crypto.createHash("sha256").update(trimmed, "utf8").digest();
}

function localMasterKey(): Buffer {
  fs.mkdirSync(MCP_SECRETS_DIR, { recursive: true });
  const file = path.join(MCP_SECRETS_DIR, MASTER_KEY_FILE);
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code !== "EEXIST") throw error;
  }
  try { fs.chmodSync(file, 0o600); } catch {}
  return decodeConfiguredKey(fs.readFileSync(file, "utf8"));
}

function masterKey(): Buffer {
  const configured = process.env.MY_MATE_MCP_SECRET_KEY || process.env.MY_MATE_PROVIDER_SECRET_KEY;
  return configured?.trim() ? decodeConfiguredKey(configured) : localMasterKey();
}

function additionalData(serverId: string, workspaceId: string): Buffer {
  return Buffer.from(`my-mate:mcp:${workspaceId}:${serverId}`, "utf8");
}

function normalizedSecrets(value: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim().toUpperCase();
    const secret = rawValue.trim();
    if (!SECRET_NAME_PATTERN.test(name)) throw new Error(`Invalid MCP secret name: ${rawName}`);
    if (!secret || secret.length > 32768 || /[\0\r\n]/u.test(secret)) {
      throw new Error(`MCP secret ${name} must be 1-32768 characters without line breaks.`);
    }
    result[name] = secret;
  }
  return result;
}

export function setMcpServerSecrets(input: {
  serverId: string;
  workspaceId: string;
  secrets: Record<string, string>;
}): void {
  const secrets = normalizedSecrets(input.secrets);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(additionalData(input.serverId, input.workspaceId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets), "utf8"),
    cipher.final(),
  ]);
  const record: EncryptedMcpSecretRecord = {
    schema_version: 1,
    server_id: input.serverId,
    workspace_id: input.workspaceId,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    secret_names: Object.keys(secrets).sort(),
    updated_at: nowIso(),
  };
  getJsonStorageBackend().writeJson(secretPath(input.workspaceId, input.serverId), record);
}

export function getMcpServerSecrets(serverId: string, workspaceId: string): Record<string, string> {
  const file = secretPath(workspaceId, serverId);
  const storage = getJsonStorageBackend();
  if (!storage.exists(file)) return {};
  const record = storage.readJson<EncryptedMcpSecretRecord>(file);
  if (record.schema_version !== 1 || record.server_id !== serverId || record.algorithm !== "aes-256-gcm") return {};
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(record.iv, "base64"));
    decipher.setAAD(additionalData(record.server_id, record.workspace_id));
    decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
    const parsed = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

export function listMcpServerSecretNames(serverId: string, workspaceId: string): string[] {
  const file = secretPath(workspaceId, serverId);
  const storage = getJsonStorageBackend();
  if (!storage.exists(file)) return [];
  const record = storage.readJson<EncryptedMcpSecretRecord>(file);
  return Array.isArray(record.secret_names) ? record.secret_names.filter((item) => typeof item === "string") : [];
}

export function removeMcpServerSecrets(serverId: string, workspaceId: string): void {
  getJsonStorageBackend().removeJson(secretPath(workspaceId, serverId));
}
