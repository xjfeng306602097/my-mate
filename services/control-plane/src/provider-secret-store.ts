import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROVIDER_SECRETS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { nowIso } from "./utils.js";

interface EncryptedProviderSecretRecord {
  schema_version: 1;
  connection_id: string;
  workspace_id: string;
  algorithm: "aes-256-gcm";
  iv: string;
  auth_tag: string;
  ciphertext: string;
  updated_at: string;
}

const MASTER_KEY_FILE = ".provider-master-key";

function secretPath(connectionId: string): string {
  return path.join(PROVIDER_SECRETS_DIR, `${connectionId}.json`);
}

function decodeConfiguredKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Hash arbitrary deployment secrets into the required key length.
  }
  return crypto.createHash("sha256").update(trimmed, "utf8").digest();
}

function localMasterKey(): Buffer {
  fs.mkdirSync(PROVIDER_SECRETS_DIR, { recursive: true });
  const file = path.join(PROVIDER_SECRETS_DIR, MASTER_KEY_FILE);
  try {
    const generated = crypto.randomBytes(32).toString("base64");
    fs.writeFileSync(file, generated, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code !== "EEXIST") throw error;
  }
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Some Windows filesystems do not expose POSIX mode enforcement.
  }
  return decodeConfiguredKey(fs.readFileSync(file, "utf8"));
}

function masterKey(): Buffer {
  const configured = process.env.MY_MATE_PROVIDER_SECRET_KEY;
  return configured?.trim() ? decodeConfiguredKey(configured) : localMasterKey();
}

function additionalData(connectionId: string, workspaceId: string): Buffer {
  return Buffer.from(`my-mate:provider:${workspaceId}:${connectionId}`, "utf8");
}

export function setManagedProviderCredential(input: {
  connectionId: string;
  workspaceId: string;
  apiKey: string;
}): void {
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 8 || apiKey.length > 32768 || /[\r\n\0]/.test(apiKey)) {
    throw new Error("API key must be 8-32768 characters and cannot contain line breaks.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(additionalData(input.connectionId, input.workspaceId));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const record: EncryptedProviderSecretRecord = {
    schema_version: 1,
    connection_id: input.connectionId,
    workspace_id: input.workspaceId,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updated_at: nowIso(),
  };
  getJsonStorageBackend().writeJson(secretPath(input.connectionId), record);
}

export function getManagedProviderCredential(connectionId: string): string | null {
  const file = secretPath(connectionId);
  if (!getJsonStorageBackend().exists(file)) return null;
  const record = getJsonStorageBackend().readJson<EncryptedProviderSecretRecord>(file);
  if (
    record.schema_version !== 1 ||
    record.connection_id !== connectionId ||
    record.algorithm !== "aes-256-gcm"
  ) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      masterKey(),
      Buffer.from(record.iv, "base64"),
    );
    decipher.setAAD(additionalData(record.connection_id, record.workspace_id));
    decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function hasManagedProviderCredential(connectionId: string): boolean {
  return !!getManagedProviderCredential(connectionId);
}

export function deleteManagedProviderCredential(connectionId: string): boolean {
  const file = secretPath(connectionId);
  const storage = getJsonStorageBackend();
  if (!storage.exists(file)) return false;
  storage.removeJson(file);
  return true;
}
