import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MEMORY_SECRETS_DIR } from "./config.js";
import type { CoreMemorySnapshot, MemoryCandidateRecord, MemoryRecord } from "./types.js";
import { nowIso } from "./utils.js";

interface EncryptedPayload {
  schema_version: 1;
  algorithm: "aes-256-gcm";
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

type EncryptedKind = "memory" | "candidate" | "snapshot";

const MASTER_KEY_FILE = ".memory-master-key";

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

function aad(kind: EncryptedKind, workspaceId: string, recordId: string): Buffer {
  return Buffer.from(`my-mate:${kind}:${workspaceId}:${recordId}`, "utf8");
}

function encrypt(kind: EncryptedKind, workspaceId: string, recordId: string, value: unknown): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(aad(kind, workspaceId, recordId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    schema_version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updated_at: nowIso(),
  };
}

function decrypt<T>(kind: EncryptedKind, workspaceId: string, recordId: string, payload: EncryptedPayload): T {
  if (payload?.schema_version !== 1 || payload.algorithm !== "aes-256-gcm") {
    throw new Error("MEMORY_PRIVATE_PAYLOAD_INVALID");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(payload.iv, "base64"));
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
