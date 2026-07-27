import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  CONVERSATION_CODING_WORKSPACES_DIR,
  RUNTIME_DOCKER_BIN,
  RUNTIME_WORKER_IMAGE,
} from "./config.js";
import {
  finalizeSandboxWorkspace,
  getRuntimeWorkspaceChangeSet,
  inspectSandboxWorkspace,
  prepareSandboxWorkspace,
  type RuntimeWorkspaceChangeSet,
} from "./runtime/workspace-change-set.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { SessionRecord, WorkspaceBindingRecord } from "./types.js";
import { ensureDir, nowIso, writeJsonAtomic } from "./utils.js";
import { getActiveSessionWorkspaceBinding } from "./workspace-binding-store.js";

const execFileAsync = promisify(execFile);
const MAX_BATCH_OPERATIONS = 200;
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const MAX_BATCH_WRITE_BYTES = 16 * 1024 * 1024;
const MAX_SEARCH_FILES = 20_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const SENSITIVE_SEGMENTS = new Set([".git", ".ssh", ".aws", ".azure", ".gnupg", "credentials", "secrets"]);
const SENSITIVE_NAMES = /^(?:\.env(?:\..+)?|\.npmrc|\.netrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|p12|pfx|key|keystore|kdbx))$/iu;

export type CodingTransactionStatus = "active" | "awaiting_review" | "closed";

export interface CodingOperationLedgerEntry {
  idempotency_key: string;
  kind: "file_batch" | "command";
  status: "succeeded" | "failed";
  summary: string;
  result: Record<string, unknown>;
  created_at: string;
}

export interface ConversationCodingTransaction {
  schema_version: 1;
  transaction_id: string;
  workspace_id: string;
  session_id: string;
  workspace_binding_id: string;
  source_root: string;
  sandbox_root: string;
  status: CodingTransactionStatus;
  operation_ledger: CodingOperationLedgerEntry[];
  path_claims: Record<string, {
    owner_key: string;
    owner_session_id: string;
    agent_task_id: string | null;
    last_sha256: string | null;
    updated_at: string;
  }>;
  change_set_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export type WorkspaceOperation =
  | { kind: "write"; path: string; content: string; expected_sha256?: string | null }
  | { kind: "replace"; path: string; old_text: string; new_text: string; replace_all?: boolean; expected_sha256?: string | null }
  | { kind: "delete"; path: string; expected_sha256?: string | null }
  | { kind: "move"; path: string; destination: string; expected_sha256?: string | null }
  | { kind: "mkdir"; path: string };

export class ConversationCodingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function conversationWorkspaceSessionId(session: SessionRecord): string {
  const owner = session.metadata?.coding_workspace_owner_session_id;
  return typeof owner === "string" && owner.trim() ? owner.trim() : session.session_id;
}

function sessionRoot(sessionId: string): string {
  return path.join(CONVERSATION_CODING_WORKSPACES_DIR, encodeURIComponent(sessionId));
}

function transactionPath(sessionId: string): string {
  return path.join(sessionRoot(sessionId), "current.json");
}

function saveTransaction(transaction: ConversationCodingTransaction): ConversationCodingTransaction {
  ensureDir(sessionRoot(transaction.session_id));
  writeJsonAtomic(transactionPath(transaction.session_id), transaction);
  return transaction;
}

function readTransaction(sessionId: string): ConversationCodingTransaction | null {
  const file = transactionPath(sessionId);
  const storage = getJsonStorageBackend();
  if (!storage.exists(file)) return null;
  const transaction = storage.readJson<ConversationCodingTransaction>(file);
  return {
    ...transaction,
    operation_ledger: Array.isArray(transaction.operation_ledger) ? transaction.operation_ledger : [],
    path_claims: transaction.path_claims && typeof transaction.path_claims === "object"
      ? transaction.path_claims
      : {},
  };
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function relativePath(value: unknown): string {
  if (typeof value !== "string") throw new ConversationCodingError("invalid_arguments", "A relative Workspace path is required.");
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized === "." || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized)) {
    throw new ConversationCodingError("workspace_path_invalid", "Workspace paths must be non-root relative paths.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ConversationCodingError("workspace_path_invalid", "Workspace path traversal is not allowed.");
  }
  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment.toLowerCase()) || SENSITIVE_NAMES.test(segment))) {
    throw new ConversationCodingError("workspace_path_sensitive", "Sensitive Workspace paths are not available to Conversation Agent.");
  }
  return segments.join("/");
}

function targetPath(root: string, value: unknown): { relative: string; absolute: string } {
  const relative = relativePath(value);
  const absolute = path.resolve(root, ...relative.split("/"));
  const relation = path.relative(root, absolute);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new ConversationCodingError("workspace_path_invalid", "Workspace path escaped its authorized root.");
  }
  return { relative, absolute };
}

function activeWritableBinding(session: SessionRecord): WorkspaceBindingRecord {
  const binding = getActiveSessionWorkspaceBinding(conversationWorkspaceSessionId(session));
  if (!binding || binding.status !== "active") {
    throw new ConversationCodingError("workspace_not_bound", "This Session has no active Desktop-authorized Workspace.");
  }
  if (binding.access !== "sandbox-write") {
    throw new ConversationCodingError("workspace_write_not_authorized", "The active Workspace is not authorized for sandboxed writes.");
  }
  return binding;
}

function synchronizeTransaction(transaction: ConversationCodingTransaction): ConversationCodingTransaction {
  if (transaction.status !== "awaiting_review" || !transaction.change_set_id) return transaction;
  const changeSet = getRuntimeWorkspaceChangeSet(transaction.change_set_id);
  if (changeSet && ["applied", "rejected", "apply_failed"].includes(changeSet.status)) {
    transaction.status = "closed";
    transaction.closed_at = changeSet.resolved_at || nowIso();
    transaction.updated_at = nowIso();
    return saveTransaction(transaction);
  }
  return transaction;
}

export function getConversationCodingTransaction(sessionId: string): ConversationCodingTransaction | null {
  const transaction = readTransaction(sessionId);
  return transaction ? synchronizeTransaction(transaction) : null;
}

export function ensureConversationCodingTransaction(session: SessionRecord): ConversationCodingTransaction {
  const ownerSessionId = conversationWorkspaceSessionId(session);
  const binding = activeWritableBinding(session);
  const current = getConversationCodingTransaction(ownerSessionId);
  if (current?.status === "active") {
    if (current.workspace_binding_id !== binding.binding_id || current.source_root !== binding.root_path) {
      throw new ConversationCodingError("workspace_binding_changed", "The Workspace authorization changed during this coding transaction.");
    }
    return current;
  }
  if (current?.status === "awaiting_review") {
    throw new ConversationCodingError("workspace_review_pending", "Apply or reject the pending Workspace Change Set before starting another write transaction.");
  }
  const transactionId = `codingtx_${randomUUID()}`;
  const sandboxRoot = path.join(sessionRoot(ownerSessionId), transactionId, "workspace");
  prepareSandboxWorkspace({ sourceRoot: binding.root_path, sandboxRoot });
  const timestamp = nowIso();
  return saveTransaction({
    schema_version: 1,
    transaction_id: transactionId,
    workspace_id: session.workspace_id || "default",
    session_id: ownerSessionId,
    workspace_binding_id: binding.binding_id,
    source_root: binding.root_path,
    sandbox_root: sandboxRoot,
    status: "active",
    operation_ledger: [],
    path_claims: {},
    change_set_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    closed_at: null,
  });
}

export function conversationWorkspaceRoot(sessionId: string, binding: WorkspaceBindingRecord): string {
  const transaction = getConversationCodingTransaction(sessionId);
  if (transaction && ["active", "awaiting_review"].includes(transaction.status) && fs.existsSync(transaction.sandbox_root)) {
    return transaction.sandbox_root;
  }
  return binding.root_path;
}

function expectedHash(target: string, expected: string | null | undefined): void {
  if (!expected) return;
  const actual = fs.existsSync(target) && fs.statSync(target).isFile() ? sha256File(target) : null;
  if (actual !== expected) throw new ConversationCodingError("workspace_content_conflict", `Expected SHA-256 does not match ${path.basename(target)}.`);
}

function validateOperations(root: string, operations: WorkspaceOperation[]): Array<WorkspaceOperation & { absolute: string; destinationAbsolute?: string }> {
  if (!operations.length || operations.length > MAX_BATCH_OPERATIONS) {
    throw new ConversationCodingError("invalid_arguments", `A batch must contain 1-${MAX_BATCH_OPERATIONS} operations.`);
  }
  let writeBytes = 0;
  return operations.map((operation) => {
    if (!operation || typeof operation !== "object") throw new ConversationCodingError("invalid_arguments", "Each operation must be an object.");
    const target = targetPath(root, operation.path);
    if (operation.kind === "write") {
      if (typeof operation.content !== "string") throw new ConversationCodingError("invalid_arguments", "write requires UTF-8 text content.");
      const bytes = Buffer.byteLength(operation.content, "utf8");
      if (bytes > MAX_WRITE_BYTES) throw new ConversationCodingError("workspace_write_too_large", `One write is limited to ${MAX_WRITE_BYTES} bytes.`);
      writeBytes += bytes;
    } else if (operation.kind === "replace") {
      if (typeof operation.old_text !== "string" || !operation.old_text || typeof operation.new_text !== "string") {
        throw new ConversationCodingError("invalid_arguments", "replace requires non-empty old_text and string new_text.");
      }
      writeBytes += Buffer.byteLength(operation.new_text, "utf8");
    } else if (operation.kind === "move") {
      const destination = targetPath(root, operation.destination);
      return { ...operation, path: target.relative, absolute: target.absolute, destination: destination.relative, destinationAbsolute: destination.absolute };
    } else if (operation.kind !== "delete" && operation.kind !== "mkdir") {
      throw new ConversationCodingError("invalid_arguments", "Unsupported Workspace operation kind.");
    }
    if (writeBytes > MAX_BATCH_WRITE_BYTES) throw new ConversationCodingError("workspace_batch_too_large", `One batch is limited to ${MAX_BATCH_WRITE_BYTES} bytes of new text.`);
    return { ...operation, path: target.relative, absolute: target.absolute };
  });
}

function rollback(undo: Array<() => void>): void {
  for (const action of [...undo].reverse()) {
    try { action(); } catch { /* Preserve the original operation failure. */ }
  }
}

export function applyConversationWorkspaceOperations(input: {
  session: SessionRecord;
  idempotencyKey: string;
  operations: WorkspaceOperation[];
}): Record<string, unknown> {
  const key = input.idempotencyKey.trim();
  if (!key || key.length > 160) throw new ConversationCodingError("invalid_arguments", "A bounded idempotency_key is required.");
  const transaction = ensureConversationCodingTransaction(input.session);
  const prior = transaction.operation_ledger.find((entry) => entry.idempotency_key === key);
  if (prior) return { ...prior.result, idempotent_replay: true };
  const operations = validateOperations(transaction.sandbox_root, input.operations);
  const actorTaskId = typeof input.session.metadata?.agent_task_id === "string"
    ? input.session.metadata.agent_task_id
    : null;
  const actorKey = actorTaskId || `session:${input.session.session_id}`;
  const claimedPaths = operations.flatMap((operation) => operation.kind === "move"
    ? [operation.path, operation.destination]
    : operation.kind === "mkdir"
      ? []
      : [operation.path]);
  for (const claimedPath of claimedPaths) {
    const claim = transaction.path_claims[claimedPath];
    if (!claim || claim.owner_key === actorKey) continue;
    const operation = operations.find((item) => item.path === claimedPath || (item.kind === "move" && item.destination === claimedPath));
    const suppliedHash = operation && "expected_sha256" in operation && typeof operation.expected_sha256 === "string"
      ? operation.expected_sha256
      : null;
    if (!suppliedHash) {
      throw new ConversationCodingError(
        "workspace_path_claim_conflict",
        `${claimedPath} was changed by another Agent. Read the current file and retry with expected_sha256 to take ownership explicitly.`,
      );
    }
  }
  const claimsBefore = structuredClone(transaction.path_claims);
  const undo: Array<() => void> = [];
  const cleanup: Array<() => void> = [];
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const operation of operations) {
      if ("expected_sha256" in operation) expectedHash(operation.absolute, operation.expected_sha256);
      if (operation.kind === "mkdir") {
        const existed = fs.existsSync(operation.absolute);
        if (existed && !fs.statSync(operation.absolute).isDirectory()) throw new ConversationCodingError("workspace_path_conflict", `${operation.path} is not a directory.`);
        fs.mkdirSync(operation.absolute, { recursive: true });
        if (!existed) undo.push(() => fs.rmSync(operation.absolute, { recursive: true, force: true }));
      } else if (operation.kind === "write" || operation.kind === "replace") {
        const existed = fs.existsSync(operation.absolute);
        if (existed && !fs.statSync(operation.absolute).isFile()) throw new ConversationCodingError("workspace_path_conflict", `${operation.path} is not a file.`);
        const before = existed ? fs.readFileSync(operation.absolute) : null;
        let content = operation.kind === "write" ? operation.content : before?.toString("utf8") || "";
        if (operation.kind === "replace") {
          const matches = content.split(operation.old_text).length - 1;
          if (matches === 0) throw new ConversationCodingError("workspace_replace_not_found", `old_text was not found in ${operation.path}.`);
          if (!operation.replace_all && matches !== 1) throw new ConversationCodingError("workspace_replace_ambiguous", `old_text occurs ${matches} times in ${operation.path}; use replace_all or a more specific match.`);
          content = operation.replace_all ? content.split(operation.old_text).join(operation.new_text) : content.replace(operation.old_text, operation.new_text);
        }
        fs.mkdirSync(path.dirname(operation.absolute), { recursive: true });
        const temporary = `${operation.absolute}.my-mate-${randomUUID()}.tmp`;
        fs.writeFileSync(temporary, content, "utf8");
        try {
          fs.renameSync(temporary, operation.absolute);
        } catch (error) {
          if (!fs.existsSync(operation.absolute)) throw error;
          fs.copyFileSync(temporary, operation.absolute);
          fs.rmSync(temporary, { force: true });
        }
        undo.push(() => before ? fs.writeFileSync(operation.absolute, before) : fs.rmSync(operation.absolute, { force: true }));
      } else if (operation.kind === "delete") {
        if (!fs.existsSync(operation.absolute)) throw new ConversationCodingError("workspace_path_missing", `${operation.path} does not exist.`);
        const backup = path.join(path.dirname(transaction.sandbox_root), `undo-${randomUUID()}`);
        fs.renameSync(operation.absolute, backup);
        undo.push(() => { fs.mkdirSync(path.dirname(operation.absolute), { recursive: true }); fs.renameSync(backup, operation.absolute); });
        cleanup.push(() => fs.rmSync(backup, { recursive: true, force: true }));
      } else if (operation.kind === "move") {
        if (!fs.existsSync(operation.absolute)) throw new ConversationCodingError("workspace_path_missing", `${operation.path} does not exist.`);
        if (!operation.destinationAbsolute) throw new ConversationCodingError("invalid_arguments", "move requires destination.");
        if (fs.existsSync(operation.destinationAbsolute)) throw new ConversationCodingError("workspace_path_conflict", `${operation.destination} already exists.`);
        fs.mkdirSync(path.dirname(operation.destinationAbsolute), { recursive: true });
        fs.renameSync(operation.absolute, operation.destinationAbsolute);
        undo.push(() => { fs.mkdirSync(path.dirname(operation.absolute), { recursive: true }); fs.renameSync(operation.destinationAbsolute!, operation.absolute); });
      }
      results.push({ kind: operation.kind, path: operation.path, destination: operation.kind === "move" ? operation.destination : undefined, ok: true });
      const claimTargets = operation.kind === "move" ? [operation.path, operation.destination] : operation.kind === "mkdir" ? [] : [operation.path];
      for (const claimPath of claimTargets) {
        const claimAbsolute = targetPath(transaction.sandbox_root, claimPath).absolute;
        transaction.path_claims[claimPath] = {
          owner_key: actorKey,
          owner_session_id: input.session.session_id,
          agent_task_id: actorTaskId,
          last_sha256: fs.existsSync(claimAbsolute) && fs.statSync(claimAbsolute).isFile() ? sha256File(claimAbsolute) : null,
          updated_at: nowIso(),
        };
      }
    }
    for (const action of cleanup) action();
    const result = { ok: true, transaction_id: transaction.transaction_id, operations: results, idempotent_replay: false };
    transaction.operation_ledger.push({ idempotency_key: key, kind: "file_batch", status: "succeeded", summary: `${results.length} Workspace operations completed.`, result, created_at: nowIso() });
    transaction.updated_at = nowIso();
    saveTransaction(transaction);
    return result;
  } catch (error) {
    rollback(undo);
    transaction.path_claims = claimsBefore;
    const message = error instanceof Error ? error.message : "Workspace operation batch failed.";
    const result = { ok: false, transaction_id: transaction.transaction_id, operations: results, error: message };
    transaction.operation_ledger.push({ idempotency_key: key, kind: "file_batch", status: "failed", summary: message, result, created_at: nowIso() });
    transaction.updated_at = nowIso();
    saveTransaction(transaction);
    throw error;
  }
}

export function searchConversationWorkspace(input: {
  session: SessionRecord;
  query: string;
  path?: string;
  maxResults?: number;
}): Record<string, unknown> {
  const ownerSessionId = conversationWorkspaceSessionId(input.session);
  const binding = getActiveSessionWorkspaceBinding(ownerSessionId);
  if (!binding) throw new ConversationCodingError("workspace_not_bound", "This Session has no active Workspace.");
  const root = conversationWorkspaceRoot(ownerSessionId, binding);
  const start = input.path && input.path !== "." ? targetPath(root, input.path).absolute : root;
  const query = input.query.trim().toLowerCase();
  if (!query || query.length > 500) throw new ConversationCodingError("invalid_arguments", "A bounded search query is required.");
  const maxResults = Math.min(MAX_SEARCH_RESULTS, Math.max(1, input.maxResults || 100));
  const results: Array<{ path: string; line: number | null; preview: string }> = [];
  const queue = [start];
  let scanned = 0;
  while (queue.length && results.length < maxResults) {
    const directory = queue.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) { queue.push(absolute); continue; }
      if (!entry.isFile() || ++scanned > MAX_SEARCH_FILES) break;
      if (entry.name.toLowerCase().includes(query)) results.push({ path: relative, line: null, preview: entry.name });
      const stat = fs.statSync(absolute);
      if (stat.size > 512 * 1024 || results.length >= maxResults) continue;
      const buffer = fs.readFileSync(absolute);
      if (buffer.includes(0)) continue;
      const lines = buffer.toString("utf8").split(/\r?\n/u);
      for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
        if (lines[index]!.toLowerCase().includes(query)) results.push({ path: relative, line: index + 1, preview: lines[index]!.trim().slice(0, 500) });
      }
    }
  }
  return { ok: true, root: ".", query: input.query, scanned_files: scanned, truncated: results.length >= maxResults || scanned >= MAX_SEARCH_FILES, results };
}

export function conversationWorkspaceStatus(session: SessionRecord): Record<string, unknown> {
  const transaction = getConversationCodingTransaction(conversationWorkspaceSessionId(session));
  if (!transaction) return { ok: true, transaction: null, changes: [], operation_ledger: [] };
  const preview = fs.existsSync(transaction.sandbox_root) ? inspectSandboxWorkspace(transaction.sandbox_root) : null;
  const changeSet = transaction.change_set_id ? getRuntimeWorkspaceChangeSet(transaction.change_set_id) : null;
  return {
    ok: true,
    transaction: {
      transaction_id: transaction.transaction_id,
      status: transaction.status,
      change_set_id: transaction.change_set_id,
      change_set_status: changeSet?.status || null,
    },
    changes: preview?.changes.map((change) => ({ path: change.relative_path, kind: change.kind, before_sha256: change.before_sha256, after_sha256: change.after_sha256 })) || [],
    operation_ledger: transaction.operation_ledger,
  };
}

type DockerExec = (executable: string, args: string[], options: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>;

export async function runConversationWorkspaceCommand(input: {
  session: SessionRecord;
  idempotencyKey: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  env?: Record<string, string>;
  network?: "none" | "public";
  execDocker?: DockerExec;
}): Promise<Record<string, unknown>> {
  const key = input.idempotencyKey.trim();
  if (!key || key.length > 160) throw new ConversationCodingError("invalid_arguments", "A bounded idempotency_key is required.");
  if (!/^[A-Za-z0-9._+-]{1,80}$/u.test(input.command)) throw new ConversationCodingError("invalid_arguments", "command must be one executable name without shell syntax.");
  if (input.args?.some((value) => typeof value !== "string" || value.length > 8_000) || (input.args?.length || 0) > 200) {
    throw new ConversationCodingError("invalid_arguments", "Command arguments exceed the bounded schema.");
  }
  const transaction = ensureConversationCodingTransaction(input.session);
  const prior = transaction.operation_ledger.find((entry) => entry.idempotency_key === key);
  if (prior) return { ...prior.result, idempotent_replay: true };
  const cwd = !input.cwd || input.cwd === "." ? "/workspace" : `/workspace/${relativePath(input.cwd)}`;
  const timeoutSeconds = Math.min(900, Math.max(1, input.timeoutSeconds || 120));
  const network = input.network === "public" ? "bridge" : "none";
  const dependencyCache = path.join(path.dirname(transaction.sandbox_root), "dependency-cache", "npm");
  fs.mkdirSync(dependencyCache, { recursive: true });
  const dockerArgs = [
    "run", "--rm", "--network", network, "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "512", "--memory", "2g", "--cpus", "2", "--workdir", cwd,
    "--mount", `type=bind,source=${transaction.sandbox_root},target=/workspace`,
    "--mount", `type=bind,source=${dependencyCache},target=/root/.npm`,
  ];
  for (const [name, value] of Object.entries(input.env || {})) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/u.test(name) || value.length > 4_000) throw new ConversationCodingError("invalid_arguments", "Command environment contains an invalid entry.");
    dockerArgs.push("--env", `${name}=${value}`);
  }
  dockerArgs.push("--entrypoint", input.command, RUNTIME_WORKER_IMAGE, ...(input.args || []));
  const executeDocker = input.execDocker || execFileAsync as DockerExec;
  const started = Date.now();
  try {
    const output = await executeDocker(RUNTIME_DOCKER_BIN, dockerArgs, {
      timeout: timeoutSeconds * 1_000,
      windowsHide: true,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      env: { ...process.env },
    });
    const result = { ok: true, transaction_id: transaction.transaction_id, command: input.command, exit_code: 0, stdout: output.stdout.slice(-MAX_COMMAND_OUTPUT_BYTES), stderr: output.stderr.slice(-MAX_COMMAND_OUTPUT_BYTES), duration_ms: Date.now() - started, network: input.network === "public" ? "public" : "disabled", idempotent_replay: false };
    transaction.operation_ledger.push({ idempotency_key: key, kind: "command", status: "succeeded", summary: `${input.command} completed successfully.`, result, created_at: nowIso() });
    transaction.updated_at = nowIso();
    saveTransaction(transaction);
    return result;
  } catch (error) {
    const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const message = String(detail.message || "Sandbox command failed.");
    const result = { ok: false, transaction_id: transaction.transaction_id, command: input.command, exit_code: typeof detail.code === "number" ? detail.code : null, stdout: String(detail.stdout || "").slice(-MAX_COMMAND_OUTPUT_BYTES), stderr: String(detail.stderr || "").slice(-MAX_COMMAND_OUTPUT_BYTES), duration_ms: Date.now() - started, network: input.network === "public" ? "public" : "disabled", error: message, idempotent_replay: false };
    transaction.operation_ledger.push({ idempotency_key: key, kind: "command", status: "failed", summary: message, result, created_at: nowIso() });
    transaction.updated_at = nowIso();
    saveTransaction(transaction);
    return result;
  }
}

export function finalizeConversationCodingTransaction(session: SessionRecord): RuntimeWorkspaceChangeSet | null {
  if (session.metadata?.defer_workspace_finalization === true) return null;
  const ownerSessionId = conversationWorkspaceSessionId(session);
  const transaction = getConversationCodingTransaction(ownerSessionId);
  if (!transaction || transaction.status !== "active") return null;
  const preview = inspectSandboxWorkspace(transaction.sandbox_root);
  if (!preview?.changes.length && !preview?.blocked_reason) return null;
  const changeSet = finalizeSandboxWorkspace({
    runId: `conversation:${ownerSessionId}`,
    nodeRunId: transaction.transaction_id,
    jobId: `conversation:${transaction.transaction_id}`,
    sandboxRoot: transaction.sandbox_root,
    origin: "conversation",
    sessionId: ownerSessionId,
    workspaceBindingId: transaction.workspace_binding_id,
  });
  if (!changeSet) return null;
  transaction.status = "awaiting_review";
  transaction.change_set_id = changeSet.change_set_id;
  transaction.updated_at = nowIso();
  saveTransaction(transaction);
  return changeSet;
}
