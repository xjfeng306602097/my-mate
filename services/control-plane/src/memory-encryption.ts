import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MEMORY_SECRETS_DIR } from "./config.js";
import type {
  CoreMemorySnapshot,
  MemoryCandidateRecord,
  MemoryOnboardingRecord,
  MemoryOverlayRecord,
  MemoryRecord,
  TurnMemoryContextSnapshot,
} from "./types.js";
import { nowIso } from "./utils.js";

interface EncryptedPayload {
  schema_version: 1 | 2;
  algorithm: "aes-256-gcm";
  key_id?: string;
  iv: string;
  auth_tag: string;
  ciphertext: string;
  updated_at: string;
}

interface PersistedPrivateMemory extends Omit<MemoryRecord, "content" | "tags"> {
  content: "[encrypted]";
  tags: [];
  private_payload: EncryptedPayload;
}

interface PersistedPrivateCandidate extends Omit<MemoryCandidateRecord, "proposed_memory" | "source" | "rationale"> {
  proposed_memory: null;
  source: MemoryCandidateRecord["source"];
  rationale: "Encrypted private memory candidate.";
  private_payload: EncryptedPayload;
}

interface PersistedPrivateSnapshot {
  schema_version: 1;
  snapshot_id: string;
  session_id: string;
  workspace_id: string;
  private_snapshot: EncryptedPayload;
}

interface PersistedPrivateContext {
  schema_version: 1;
  context_id: string;
  session_id: string;
  workspace_id: string;
  private_context: EncryptedPayload;
}

interface PersistedPrivateOverlay {
  schema_version: 1;
  overlay_id: string;
  session_id: string;
  workspace_id: string;
  private_overlay: EncryptedPayload;
}

interface PersistedPrivateOnboarding {
  schema_version: 1;
  workspace_id: string;
  principal_id: string;
  private_onboarding: EncryptedPayload;
}

type EncryptedKind = "memory" | "candidate" | "snapshot" | "turn-context" | "overlay" | "onboarding";

const MASTER_KEY_FILE = ".memory-master-key";
const KEYRING_SUFFIX = ".memory-keyring.json";

interface WrappedWorkspaceKey {
  key_id: string;
  status: "active" | "retired";
  created_at: string;
  retired_at: string | null;
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

interface WorkspaceKeyring {
  schema_version: 1;
  workspace_id: string;
  active_key_id: string;
  keys: WrappedWorkspaceKey[];
  last_rotated_at: string | null;
}

function decodeConfiguredKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/iu.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Arbitrary deployment secrets are hashed to the required key size.
  }
  return crypto.createHash("sha256").update(trimmed, "utf8").digest();
}

function localMasterKey(): Buffer {
  fs.mkdirSync(MEMORY_SECRETS_DIR, { recursive: true });
  const file = path.join(MEMORY_SECRETS_DIR, MASTER_KEY_FILE);
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
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows filesystems may not expose POSIX modes.
  }
  return decodeConfiguredKey(fs.readFileSync(file, "utf8"));
}

function masterKey(): Buffer {
  const configured = process.env.MY_MATE_MEMORY_SECRET_KEY || process.env.MY_MATE_PROVIDER_SECRET_KEY;
  return configured?.trim() ? decodeConfiguredKey(configured) : localMasterKey();
}

function keyringPath(workspaceId: string): string {
  return path.join(MEMORY_SECRETS_DIR, `${encodeURIComponent(workspaceId)}${KEYRING_SUFFIX}`);
}

function rootSource(): "environment" | "local_file" {
  return (process.env.MY_MATE_MEMORY_SECRET_KEY || process.env.MY_MATE_PROVIDER_SECRET_KEY)?.trim()
    ? "environment"
    : "local_file";
}

function wrapWorkspaceKey(workspaceId: string, keyId: string, key: Buffer): WrappedWorkspaceKey {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(`my-mate:memory-key:${workspaceId}:${keyId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  return {
    key_id: keyId,
    status: "active",
    created_at: nowIso(),
    retired_at: null,
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function unwrapWorkspaceKey(workspaceId: string, record: WrappedWorkspaceKey): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(record.iv, "base64"));
  decipher.setAAD(Buffer.from(`my-mate:memory-key:${workspaceId}:${record.key_id}`, "utf8"));
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]);
}

function writeKeyring(keyring: WorkspaceKeyring): void {
  fs.mkdirSync(MEMORY_SECRETS_DIR, { recursive: true });
  const file = keyringPath(keyring.workspace_id);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(keyring, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows filesystems may not expose POSIX modes.
  }
}

function readKeyring(workspaceId: string): WorkspaceKeyring {
  fs.mkdirSync(MEMORY_SECRETS_DIR, { recursive: true });
  const file = keyringPath(workspaceId);
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as WorkspaceKeyring;
    if (parsed.schema_version !== 1 || parsed.workspace_id !== workspaceId || !parsed.active_key_id) {
      throw new Error("MEMORY_KEYRING_INVALID");
    }
    return parsed;
  }
  const keyId = `memkey_${crypto.randomUUID()}`;
  const keyring: WorkspaceKeyring = {
    schema_version: 1,
    workspace_id: workspaceId,
    active_key_id: keyId,
    keys: [wrapWorkspaceKey(workspaceId, keyId, crypto.randomBytes(32))],
    last_rotated_at: null,
  };
  writeKeyring(keyring);
  return keyring;
}

function workspaceKey(workspaceId: string, keyId?: string): { keyId: string; key: Buffer } {
  const keyring = readKeyring(workspaceId);
  const targetId = keyId || keyring.active_key_id;
  const record = keyring.keys.find((item) => item.key_id === targetId);
  if (!record) throw new Error("MEMORY_ENCRYPTION_KEY_NOT_FOUND");
  return { keyId: targetId, key: unwrapWorkspaceKey(workspaceId, record) };
}

export function getMemoryKeyStatus(workspaceId: string): import("./types.js").MemoryKeyStatus {
  const keyring = readKeyring(workspaceId);
  const active = keyring.keys.find((item) => item.key_id === keyring.active_key_id);
  if (!active) throw new Error("MEMORY_KEYRING_INVALID");
  return {
    schema_version: 1,
    workspace_id: workspaceId,
    active_key_id: active.key_id,
    active_key_created_at: active.created_at,
    retained_key_count: keyring.keys.length,
    last_rotated_at: keyring.last_rotated_at,
    root_source: rootSource(),
  };
}

export function beginMemoryKeyRotation(workspaceId: string): { previous_key_id: string; active_key_id: string } {
  const keyring = readKeyring(workspaceId);
  const timestamp = nowIso();
  const keyId = `memkey_${crypto.randomUUID()}`;
  keyring.keys = keyring.keys.map((item) => item.key_id === keyring.active_key_id
    ? { ...item, status: "retired", retired_at: timestamp }
    : item);
  const previousKeyId = keyring.active_key_id;
  keyring.active_key_id = keyId;
  keyring.keys.push(wrapWorkspaceKey(workspaceId, keyId, crypto.randomBytes(32)));
  keyring.last_rotated_at = timestamp;
  writeKeyring(keyring);
  return { previous_key_id: previousKeyId, active_key_id: keyId };
}

export function discardRetiredMemoryKeys(workspaceId: string): number {
  const keyring = readKeyring(workspaceId);
  const before = keyring.keys.length;
  keyring.keys = keyring.keys.filter((item) => item.key_id === keyring.active_key_id);
  writeKeyring(keyring);
  return before - keyring.keys.length;
}

function aad(kind: EncryptedKind, workspaceId: string, recordId: string): Buffer {
  return Buffer.from(`my-mate:${kind}:${workspaceId}:${recordId}`, "utf8");
}

function encrypt(kind: EncryptedKind, workspaceId: string, recordId: string, value: unknown): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const resolved = workspaceKey(workspaceId);
  const cipher = crypto.createCipheriv("aes-256-gcm", resolved.key, iv);
  cipher.setAAD(aad(kind, workspaceId, recordId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    schema_version: 2,
    algorithm: "aes-256-gcm",
    key_id: resolved.keyId,
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updated_at: nowIso(),
  };
}

function decrypt<T>(kind: EncryptedKind, workspaceId: string, recordId: string, payload: EncryptedPayload): T {
  if (![1, 2].includes(payload?.schema_version) || payload.algorithm !== "aes-256-gcm") {
    throw new Error("MEMORY_PRIVATE_PAYLOAD_INVALID");
  }
  const key = payload.schema_version === 2 && payload.key_id
    ? workspaceKey(workspaceId, payload.key_id).key
    : masterKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAAD(aad(kind, workspaceId, recordId));
  decipher.setAuthTag(Buffer.from(payload.auth_tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")) as T;
}

export function serializeMemoryRecord(record: MemoryRecord): MemoryRecord | PersistedPrivateMemory {
  if (record.sensitivity !== "private") return record;
  return {
    ...record,
    content: "[encrypted]",
    tags: [],
    private_payload: encrypt("memory", record.workspace_id, record.memory_id, {
      content: record.content,
      tags: record.tags,
    }),
  };
}

export function deserializeMemoryRecord(value: unknown): { record: MemoryRecord; legacyPlaintext: boolean } {
  const raw = value as MemoryRecord & { private_payload?: EncryptedPayload };
  if (raw.sensitivity !== "private" || !raw.private_payload) {
    return { record: raw, legacyPlaintext: raw.sensitivity === "private" };
  }
  const privateValue = decrypt<{ content: string; tags: string[] }>(
    "memory",
    raw.workspace_id,
    raw.memory_id,
    raw.private_payload,
  );
  const { private_payload: _privatePayload, ...publicRecord } = raw;
  return {
    record: {
      ...publicRecord,
      content: privateValue.content,
      tags: Array.isArray(privateValue.tags) ? privateValue.tags : [],
    },
    legacyPlaintext: false,
  };
}

export function serializeMemoryCandidate(record: MemoryCandidateRecord): MemoryCandidateRecord | PersistedPrivateCandidate {
  if (record.proposed_memory?.sensitivity !== "private") return record;
  return {
    ...record,
    proposed_memory: null,
    rationale: "Encrypted private memory candidate.",
    private_payload: encrypt("candidate", record.workspace_id, record.candidate_id, {
      proposed_memory: record.proposed_memory,
      source: record.source,
      rationale: record.rationale,
    }),
  };
}

export function deserializeMemoryCandidate(value: unknown): { record: MemoryCandidateRecord; legacyPlaintext: boolean } {
  const raw = value as MemoryCandidateRecord & { private_payload?: EncryptedPayload };
  if (!raw.private_payload) {
    return {
      record: raw,
      legacyPlaintext: raw.proposed_memory?.sensitivity === "private",
    };
  }
  const privateValue = decrypt<Pick<MemoryCandidateRecord, "proposed_memory" | "source" | "rationale">>(
    "candidate",
    raw.workspace_id,
    raw.candidate_id,
    raw.private_payload,
  );
  const { private_payload: _privatePayload, ...publicRecord } = raw;
  return {
    record: { ...publicRecord, ...privateValue },
    legacyPlaintext: false,
  };
}

export function serializeCoreMemorySnapshot(snapshot: CoreMemorySnapshot): CoreMemorySnapshot | PersistedPrivateSnapshot {
  const containsPrivate = [...snapshot.entries, ...snapshot.project_entries]
    .some((entry) => entry.sensitivity === "private");
  if (!containsPrivate) return snapshot;
  return {
    schema_version: 1,
    snapshot_id: snapshot.snapshot_id,
    session_id: snapshot.session_id,
    workspace_id: snapshot.workspace_id,
    private_snapshot: encrypt("snapshot", snapshot.workspace_id, snapshot.snapshot_id, snapshot),
  };
}

export function deserializeCoreMemorySnapshot(value: unknown): {
  snapshot: CoreMemorySnapshot;
  legacyPlaintext: boolean;
} {
  const raw = value as CoreMemorySnapshot & { private_snapshot?: EncryptedPayload };
  if (!raw.private_snapshot) {
    return {
      snapshot: raw,
      legacyPlaintext: [...(raw.entries || []), ...(raw.project_entries || [])]
        .some((entry) => entry.sensitivity === "private"),
    };
  }
  return {
    snapshot: decrypt<CoreMemorySnapshot>("snapshot", raw.workspace_id, raw.snapshot_id, raw.private_snapshot),
    legacyPlaintext: false,
  };
}

export function serializeTurnMemoryContext(
  snapshot: TurnMemoryContextSnapshot,
): TurnMemoryContextSnapshot | PersistedPrivateContext {
  if (!snapshot.entries.some((entry) => entry.sensitivity === "private")) return snapshot;
  return {
    schema_version: 1,
    context_id: snapshot.context_id,
    session_id: snapshot.session_id,
    workspace_id: snapshot.workspace_id,
    private_context: encrypt("turn-context", snapshot.workspace_id, snapshot.context_id, snapshot),
  };
}

export function deserializeTurnMemoryContext(value: unknown): {
  snapshot: TurnMemoryContextSnapshot;
  legacyPlaintext: boolean;
} {
  const raw = value as TurnMemoryContextSnapshot & { private_context?: EncryptedPayload };
  if (!raw.private_context) {
    return {
      snapshot: raw,
      legacyPlaintext: (raw.entries || []).some((entry) => entry.sensitivity === "private"),
    };
  }
  return {
    snapshot: decrypt<TurnMemoryContextSnapshot>(
      "turn-context",
      raw.workspace_id,
      raw.context_id,
      raw.private_context,
    ),
    legacyPlaintext: false,
  };
}

export function serializeMemoryOverlay(
  overlay: MemoryOverlayRecord,
): MemoryOverlayRecord | PersistedPrivateOverlay {
  if (overlay.entry.sensitivity !== "private") return overlay;
  return {
    schema_version: 1,
    overlay_id: overlay.overlay_id,
    session_id: overlay.session_id,
    workspace_id: overlay.workspace_id,
    private_overlay: encrypt("overlay", overlay.workspace_id, overlay.overlay_id, overlay),
  };
}

export function deserializeMemoryOverlay(value: unknown): {
  overlay: MemoryOverlayRecord;
  legacyPlaintext: boolean;
} {
  const raw = value as MemoryOverlayRecord & { private_overlay?: EncryptedPayload };
  if (!raw.private_overlay) {
    return { overlay: raw, legacyPlaintext: raw.entry?.sensitivity === "private" };
  }
  return {
    overlay: decrypt<MemoryOverlayRecord>("overlay", raw.workspace_id, raw.overlay_id, raw.private_overlay),
    legacyPlaintext: false,
  };
}

export function serializeMemoryOnboarding(
  record: MemoryOnboardingRecord,
): MemoryOnboardingRecord | PersistedPrivateOnboarding {
  if (!record.draft_entries.some((entry) => entry.sensitivity === "private")) return record;
  return {
    schema_version: 1,
    workspace_id: record.workspace_id,
    principal_id: record.principal_id,
    private_onboarding: encrypt(
      "onboarding",
      record.workspace_id,
      `${record.principal_id}:${record.workspace_id}`,
      record,
    ),
  };
}

export function deserializeMemoryOnboarding(value: unknown): {
  record: MemoryOnboardingRecord;
  legacyPlaintext: boolean;
} {
  const raw = value as MemoryOnboardingRecord & { private_onboarding?: EncryptedPayload };
  if (!raw.private_onboarding) {
    return {
      record: raw,
      legacyPlaintext: (raw.draft_entries || []).some((entry) => entry.sensitivity === "private"),
    };
  }
  return {
    record: decrypt<MemoryOnboardingRecord>(
      "onboarding",
      raw.workspace_id,
      `${raw.principal_id}:${raw.workspace_id}`,
      raw.private_onboarding,
    ),
    legacyPlaintext: false,
  };
}
