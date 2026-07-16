import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  SESSION_MESSAGES_DIR,
  SESSION_RECALL_INDEX_DIR,
  SESSIONS_DIR,
  SERVICE_ROOT,
} from "./config.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type {
  SessionMessageRecord,
  SessionRecallContextMessage,
  SessionRecallHit,
  SessionRecallResult,
  SessionRecord,
} from "./types.js";

interface RecallJournalRecord {
  schema_version: 1;
  message_id: string;
  workspace_id: string;
  session_id: string;
  session_title: string;
  role: SessionMessageRecord["role"];
  kind: SessionMessageRecord["kind"];
  text: string;
  created_at: string;
}

interface RecallIndexHit {
  message_id: string;
  session_id: string;
  score: number;
}

const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/gu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*[^\s,;]+/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /\b(?:ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{16,}\b/gu,
] as const;

function journalPath(): string {
  return path.join(SESSION_RECALL_INDEX_DIR, "journal.jsonl");
}

function databasePath(): string {
  return path.join(SESSION_RECALL_INDEX_DIR, "session-recall.sqlite3");
}

function helperPath(): string {
  return path.join(SERVICE_ROOT, "src", "session-recall-sqlite.py");
}

function messageText(message: SessionMessageRecord): string {
  for (const key of ["text", "narrative_reply", "turn_summary", "summary", "user_text"]) {
    const value = message.content?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function redactSecrets(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[REDACTED]");
  return redacted;
}

function rawSessions(): SessionRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(SESSIONS_DIR).map((file) => storage.readJson<SessionRecord>(file));
}

function rawMessages(sessionId: string): SessionMessageRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(path.join(SESSION_MESSAGES_DIR, sessionId))
    .map((file) => storage.readJson<SessionMessageRecord>(file))
    .sort((left, right) =>
      left.created_at.localeCompare(right.created_at) || left.message_id.localeCompare(right.message_id),
    );
}

function journalRecord(session: SessionRecord, message: SessionMessageRecord): RecallJournalRecord | null {
  const text = messageText(message);
  if (!text || (message.role !== "user" && message.role !== "orchestrator")) return null;
  return {
    schema_version: 1,
    message_id: message.message_id,
    workspace_id: session.workspace_id || "default",
    session_id: session.session_id,
    session_title: session.title,
    role: message.role,
    kind: message.kind,
    text,
    created_at: message.created_at,
  };
}

export function appendSessionRecallJournal(session: SessionRecord, message: SessionMessageRecord): void {
  const record = journalRecord(session, message);
  if (!record) return;
  fs.mkdirSync(SESSION_RECALL_INDEX_DIR, { recursive: true });
  fs.appendFileSync(journalPath(), `${JSON.stringify(record)}\n`, "utf-8");
}

export function rebuildSessionRecallJournal(): number {
  fs.mkdirSync(SESSION_RECALL_INDEX_DIR, { recursive: true });
  const records = rawSessions().flatMap((session) =>
    rawMessages(session.session_id).flatMap((message) => {
      const record = journalRecord(session, message);
      return record ? [record] : [];
    }),
  );
  const temporary = `${journalPath()}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), "utf-8");
  fs.renameSync(temporary, journalPath());
  return records.length;
}

function detectPython(): string {
  const configured = process.env.MY_MATE_STORAGE_PYTHON?.trim();
  if (configured) return configured;
  const candidates = process.platform === "win32"
    ? [
        ...["Python313", "Python312", "Python311", "Python310"].map((version) =>
          path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", version, "python.exe"),
        ),
        "py",
        "python",
        "python3",
      ]
    : ["python3", "python"];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf-8", windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  throw new Error("Session Recall requires Python 3 with SQLite FTS5 support.");
}

function runIndexSearch(input: {
  query: string;
  workspaceId: string;
  currentSessionId: string;
  limit: number;
}): RecallIndexHit[] {
  const result = spawnSync(detectPython(), ["-X", "utf8", helperPath()], {
    encoding: "utf-8",
    input: JSON.stringify({
      action: "search",
      db_path: databasePath(),
      journal_path: journalPath(),
      workspace_id: input.workspaceId,
      current_session_id: input.currentSessionId,
      query: input.query,
      limit: input.limit,
    }),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim() || "Session Recall index failed.");
  }
  const response = JSON.parse(result.stdout) as { ok?: boolean; hits?: RecallIndexHit[]; error?: string };
  if (!response.ok) throw new Error(response.error || "Session Recall index failed.");
  return response.hits || [];
}

function ensureJournal(): boolean {
  if (fs.existsSync(journalPath())) return false;
  rebuildSessionRecallJournal();
  return true;
}

function indexHits(input: {
  query: string;
  workspaceId: string;
  currentSessionId: string;
  limit: number;
}): { hits: RecallIndexHit[]; rebuilt: boolean } {
  let rebuilt = ensureJournal();
  try {
    return { hits: runIndexSearch(input), rebuilt };
  } catch {
    rebuildSessionRecallJournal();
    fs.rmSync(databasePath(), { force: true });
    rebuilt = true;
    return { hits: runIndexSearch(input), rebuilt };
  }
}

function contextWindow(messages: SessionMessageRecord[], matchedMessageId: string, radius: number): SessionRecallContextMessage[] {
  const index = messages.findIndex((message) => message.message_id === matchedMessageId);
  if (index < 0) return [];
  return messages
    .slice(Math.max(0, index - radius), Math.min(messages.length, index + radius + 1))
    .flatMap((message) => {
      const text = messageText(message);
      if (!text || (message.role !== "user" && message.role !== "orchestrator")) return [];
      return [{
        message_id: message.message_id,
        role: message.role,
        kind: message.kind,
        text: redactSecrets(text),
        created_at: message.created_at,
        matched: message.message_id === matchedMessageId,
      }];
    });
}

export function recallSessions(input: {
  query: string;
  currentSessionId: string;
  limit?: number;
  contextRadius?: number;
}): SessionRecallResult {
  const query = input.query.trim();
  if (!query) throw new Error("SESSION_RECALL_QUERY_REQUIRED");
  const workspaceId = getActiveWorkspaceId() || "default";
  const limit = Math.min(10, Math.max(1, Math.floor(input.limit || 5)));
  const radius = Math.min(4, Math.max(0, Math.floor(input.contextRadius ?? 2)));
  const indexed = indexHits({ query, workspaceId, currentSessionId: input.currentSessionId, limit: limit * 4 });
  const sessions = new Map(rawSessions()
    .filter((session) => (session.workspace_id || "default") === workspaceId)
    .map((session) => [session.session_id, session]));
  const hits: SessionRecallHit[] = [];
  const seen = new Set<string>();
  for (const indexedHit of indexed.hits) {
    if (hits.length >= limit || indexedHit.session_id === input.currentSessionId || seen.has(indexedHit.message_id)) continue;
    const session = sessions.get(indexedHit.session_id);
    if (!session) continue;
    const context = contextWindow(rawMessages(session.session_id), indexedHit.message_id, radius);
    const matched = context.find((message) => message.matched);
    if (!matched) continue;
    seen.add(indexedHit.message_id);
    hits.push({
      session_id: session.session_id,
      session_title: session.title,
      matched_message_id: indexedHit.message_id,
      matched_at: matched.created_at,
      score: indexedHit.score,
      context,
    });
  }
  return {
    query,
    workspace_id: workspaceId,
    current_session_id: input.currentSessionId,
    count: hits.length,
    index_rebuilt: indexed.rebuilt,
    hits,
  };
}

export function sessionRecallPathsForTests(): { journal: string; database: string } {
  return { journal: journalPath(), database: databasePath() };
}
