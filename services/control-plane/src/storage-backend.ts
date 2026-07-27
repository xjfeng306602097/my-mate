import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { DATA_DIR, SERVICE_ROOT } from "./config.js";

const WINDOWS_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const RENAME_RETRY_DELAYS_MS = [5, 10, 20, 40, 80];
const retryWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

export function renameWithRetry(sourcePath: string, targetPath: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(sourcePath, targetPath);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      const delayMs = RENAME_RETRY_DELAYS_MS[attempt];
      if (
        process.platform !== "win32" ||
        !WINDOWS_RENAME_RETRY_CODES.has(code) ||
        delayMs === undefined
      ) {
        throw error;
      }
      Atomics.wait(retryWaitBuffer, 0, 0, delayMs);
    }
  }
}

export interface JsonStorageBackend {
  readonly kind: string;
  ensureDir(dirPath: string): void;
  exists(filePath: string): boolean;
  listDirs(dirPath: string): string[];
  listJsonFiles(dirPath: string): string[];
  readJson<T>(filePath: string): T;
  writeJson(filePath: string, data: unknown): void;
  removeJson(filePath: string): void;
  transaction?<T>(callback: () => T): T;
}

type PendingJsonOperation =
  | { kind: "write"; filePath: string; data: unknown }
  | { kind: "remove"; filePath: string };

interface FileJsonTransactionJournal {
  schema_version: 1;
  transaction_id: string;
  status: "prepared" | "committed";
  snapshots: Array<{ file_path: string; existed: boolean; data?: unknown }>;
  created_at: string;
}

class FileJsonStorageBackend implements JsonStorageBackend {
  readonly kind = "file-json";
  private pendingOperations: Map<string, PendingJsonOperation> | null = null;

  constructor() {
    this.recoverTransactions();
  }

  ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  exists(filePath: string): boolean {
    const pending = this.pendingOperations?.get(path.resolve(filePath));
    if (pending) return pending.kind === "write";
    return fs.existsSync(filePath);
  }

  listDirs(dirPath: string): string[] {
    this.ensureDir(dirPath);
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dirPath, entry.name));
  }

  listJsonFiles(dirPath: string): string[] {
    this.ensureDir(dirPath);
    const files = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dirPath, entry.name));
    if (!this.pendingOperations) return files;
    const resolvedDir = path.resolve(dirPath);
    const merged = new Set(files.map((file) => path.resolve(file)));
    for (const operation of this.pendingOperations.values()) {
      if (path.dirname(operation.filePath) !== resolvedDir || !operation.filePath.endsWith(".json")) continue;
      if (operation.kind === "write") merged.add(operation.filePath);
      else merged.delete(operation.filePath);
    }
    return [...merged].sort((left, right) => left.localeCompare(right));
  }

  readJson<T>(filePath: string): T {
    const pending = this.pendingOperations?.get(path.resolve(filePath));
    if (pending?.kind === "write") return structuredClone(pending.data) as T;
    if (pending?.kind === "remove") throw new Error(`Storage record not found: ${filePath}`);
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  }

  writeJson(filePath: string, data: unknown): void {
    if (this.pendingOperations) {
      this.pendingOperations.set(path.resolve(filePath), { kind: "write", filePath: path.resolve(filePath), data: structuredClone(data) });
      return;
    }
    this.writeJsonDirect(filePath, data);
  }

  private writeJsonDirect(filePath: string, data: unknown): void {
    this.ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
      renameWithRetry(tempPath, filePath);
    } finally {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // Preserve the original write error if a transient lock also blocks cleanup.
      }
    }
  }

  removeJson(filePath: string): void {
    if (this.pendingOperations) {
      this.pendingOperations.set(path.resolve(filePath), { kind: "remove", filePath: path.resolve(filePath) });
      return;
    }
    fs.rmSync(filePath, { force: true });
  }

  transaction<T>(callback: () => T): T {
    if (this.pendingOperations) return callback();
    this.pendingOperations = new Map();
    try {
      const result = callback();
      const operations = [...this.pendingOperations.values()];
      this.pendingOperations = null;
      this.commitOperations(operations);
      return result;
    } catch (error) {
      this.pendingOperations = null;
      throw error;
    }
  }

  private transactionDirectory(): string {
    return path.join(path.resolve(DATA_DIR), "_storage", "transactions");
  }

  private commitOperations(operations: PendingJsonOperation[]): void {
    if (!operations.length) return;
    const transactionId = `json_tx_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const journalPath = path.join(this.transactionDirectory(), `${transactionId}.json`);
    const snapshots = operations.map((operation) => ({
      file_path: operation.filePath,
      existed: fs.existsSync(operation.filePath),
      ...(fs.existsSync(operation.filePath)
        ? { data: JSON.parse(fs.readFileSync(operation.filePath, "utf8")) as unknown }
        : {}),
    }));
    const journal: FileJsonTransactionJournal = {
      schema_version: 1,
      transaction_id: transactionId,
      status: "prepared",
      snapshots,
      created_at: new Date().toISOString(),
    };
    this.writeJsonDirect(journalPath, journal);
    try {
      for (const operation of operations) {
        if (operation.kind === "write") this.writeJsonDirect(operation.filePath, operation.data);
        else fs.rmSync(operation.filePath, { force: true });
      }
      this.writeJsonDirect(journalPath, { ...journal, status: "committed" });
      fs.rmSync(journalPath, { force: true });
    } catch (error) {
      this.restoreSnapshots(snapshots);
      fs.rmSync(journalPath, { force: true });
      throw error;
    }
  }

  private restoreSnapshots(snapshots: FileJsonTransactionJournal["snapshots"]): void {
    for (const snapshot of [...snapshots].reverse()) {
      if (snapshot.existed) this.writeJsonDirect(snapshot.file_path, snapshot.data);
      else fs.rmSync(snapshot.file_path, { force: true });
    }
  }

  private recoverTransactions(): void {
    const directory = this.transactionDirectory();
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const journalPath = path.join(directory, entry.name);
      try {
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as FileJsonTransactionJournal;
        if (journal.schema_version === 1 && journal.status === "prepared") this.restoreSnapshots(journal.snapshots || []);
        fs.rmSync(journalPath, { force: true });
      } catch {
        // Preserve an unreadable journal for operator recovery rather than guessing.
      }
    }
  }
}

interface PythonSqliteRequest {
  action: "ensure_dir" | "exists" | "list_dirs" | "list_json_files" | "read_json" | "write_json" | "remove_json" | "apply_batch";
  db_path: string;
  data_dir: string;
  target_path: string;
  payload?: unknown;
  operations?: Array<{ kind: "write" | "remove"; target_path: string; payload?: unknown }>;
}

interface PythonSqliteResponse {
  ok: boolean;
  exists?: boolean;
  paths?: string[];
  data?: unknown;
  error?: string;
}

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

function openNodeSqliteDatabase(dbPath: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (filename: string) => SqliteDatabase;
  };
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new sqlite.DatabaseSync(dbPath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS json_records (
      path TEXT PRIMARY KEY,
      parent_path TEXT NOT NULL,
      name TEXT NOT NULL,
      json_text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logical_dirs (
      path TEXT PRIMARY KEY,
      parent_path TEXT NOT NULL,
      name TEXT NOT NULL
    );
    INSERT OR IGNORE INTO logical_dirs(path, parent_path, name) VALUES('', '', '');
  `);
  return database;
}

function sqliteParentPath(value: string): string {
  const index = value.lastIndexOf("/");
  return index < 0 ? "" : value.slice(0, index);
}

function sqliteBaseName(value: string): string {
  const index = value.lastIndexOf("/");
  return index < 0 ? value : value.slice(index + 1);
}

function ensureSqliteDirectory(database: SqliteDatabase, target: string): void {
  const insert = database.prepare(
    "INSERT OR IGNORE INTO logical_dirs(path, parent_path, name) VALUES(?, ?, ?)",
  );
  let current = "";
  for (const part of target ? target.split("/") : []) {
    const next = current ? `${current}/${part}` : part;
    insert.run(next, current, part);
    current = next;
  }
}

function runNodeSqlite(
  database: SqliteDatabase,
  request: PythonSqliteRequest,
): PythonSqliteResponse {
  const target = request.target_path;
  switch (request.action) {
    case "apply_batch": {
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const operation of request.operations || []) {
          runNodeSqlite(database, {
            ...request,
            action: operation.kind === "write" ? "write_json" : "remove_json",
            target_path: operation.target_path,
            payload: operation.payload,
            operations: undefined,
          });
        }
        database.exec("COMMIT");
        return { ok: true };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
    case "ensure_dir":
      ensureSqliteDirectory(database, target);
      return { ok: true };
    case "exists":
      return {
        ok: true,
        exists: Boolean(database.prepare("SELECT 1 FROM json_records WHERE path = ?").get(target)),
      };
    case "list_dirs": {
      ensureSqliteDirectory(database, target);
      const rows = database.prepare(
        "SELECT path FROM logical_dirs WHERE parent_path = ? AND path <> ? ORDER BY path",
      ).all(target, target) as Array<{ path: string }>;
      return {
        ok: true,
        paths: rows.map((row) => path.normalize(path.join(request.data_dir, row.path))),
      };
    }
    case "list_json_files": {
      ensureSqliteDirectory(database, target);
      const rows = database.prepare(
        "SELECT path FROM json_records WHERE parent_path = ? ORDER BY path",
      ).all(target) as Array<{ path: string }>;
      return {
        ok: true,
        paths: rows.map((row) => path.normalize(path.join(request.data_dir, row.path))),
      };
    }
    case "read_json": {
      const row = database.prepare("SELECT json_text FROM json_records WHERE path = ?")
        .get(target) as { json_text: string } | undefined;
      if (!row) throw new Error(`Storage record not found: ${target}`);
      return { ok: true, data: JSON.parse(row.json_text) as unknown };
    }
    case "write_json": {
      const parent = sqliteParentPath(target);
      ensureSqliteDirectory(database, parent);
      database.prepare(`
        INSERT INTO json_records(path, parent_path, name, json_text)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          parent_path = excluded.parent_path,
          name = excluded.name,
          json_text = excluded.json_text
      `).run(target, parent, sqliteBaseName(target), `${JSON.stringify(request.payload, null, 2)}\n`);
      return { ok: true };
    }
    case "remove_json":
      database.prepare("DELETE FROM json_records WHERE path = ?").run(target);
      return { ok: true };
  }
}

export interface FileJsonMigrationManifest {
  schema_version: 1;
  status: "complete";
  source_backend: "file-json";
  target_backend: "sqlite";
  record_count: number;
  verified_count: number;
  backup_relative_path: string | null;
  completed_at: string;
}

function listPhysicalJsonFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "_storage" || entry.name === ".control-plane.lock") continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
    }
  };
  visit(rootPath);
  return files.sort((left, right) => left.localeCompare(right));
}

function writePhysicalJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameWithRetry(tempPath, filePath);
}

export function migratePhysicalFileJsonToSqlite(input: {
  storage: JsonStorageBackend;
  dataDir?: string;
  now?: () => Date;
}): FileJsonMigrationManifest {
  if (input.storage.kind !== "sqlite") {
    throw new Error("File JSON migration requires the sqlite storage backend.");
  }
  const dataDir = path.resolve(input.dataDir || DATA_DIR);
  const storageRoot = path.join(dataDir, "_storage");
  const manifestPath = path.join(storageRoot, "file-json-migration.json");
  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as FileJsonMigrationManifest;
    if (existing.schema_version === 1 && existing.status === "complete") return existing;
  }

  const files = listPhysicalJsonFiles(dataDir);
  const completedAt = (input.now || (() => new Date()))().toISOString();
  const backupRelativePath = files.length
    ? path.join("_storage", "backups", `file-json-${completedAt.replace(/[:.]/g, "-")}`)
    : null;
  const backupRoot = backupRelativePath ? path.join(dataDir, backupRelativePath) : null;
  let verifiedCount = 0;

  for (const filePath of files) {
    const relativePath = path.relative(dataDir, filePath);
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (backupRoot) {
      const backupPath = path.join(backupRoot, "records", relativePath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
    }
    input.storage.writeJson(path.join(dataDir, relativePath), value);
    const roundTrip = input.storage.readJson<unknown>(path.join(dataDir, relativePath));
    if (!isDeepStrictEqual(roundTrip, value)) {
      throw new Error(`SQLite migration verification failed for ${relativePath}.`);
    }
    verifiedCount += 1;
  }

  const manifest: FileJsonMigrationManifest = {
    schema_version: 1,
    status: "complete",
    source_backend: "file-json",
    target_backend: "sqlite",
    record_count: files.length,
    verified_count: verifiedCount,
    backup_relative_path: backupRelativePath?.split(path.sep).join("/") || null,
    completed_at: completedAt,
  };
  writePhysicalJsonAtomic(manifestPath, manifest);
  if (backupRoot) writePhysicalJsonAtomic(path.join(backupRoot, "manifest.json"), manifest);
  return manifest;
}

function normalizeStoragePath(filePath: string): string {
  return path.resolve(filePath);
}

function normalizeDirectoryPath(dirPath: string): string {
  return path.resolve(dirPath);
}

function normalizeRelativeStoragePath(targetPath: string): string {
  const relative = path.relative(path.resolve(DATA_DIR), path.resolve(targetPath));
  const normalized = relative.split(path.sep).join("/");
  if (!normalized || normalized === ".") {
    return "";
  }
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error(
      `Storage path "${targetPath}" is outside MY_MATE_DATA_DIR "${path.resolve(DATA_DIR)}".`,
    );
  }
  return normalized;
}

function detectPythonCommand(): string {
  const configured = process.env.MY_MATE_STORAGE_PYTHON?.trim();
  if (configured) {
    return configured;
  }

  const absoluteCandidates =
    process.platform === "win32"
      ? ["Python313", "Python312", "Python311", "Python310"].map((version) =>
          path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", version, "python.exe"),
        )
      : [];
  const commandCandidates =
    process.platform === "win32"
      ? ["py", "python", "python3"]
      : ["python3", "python"];
  const candidates = [...absoluteCandidates, ...commandCandidates].filter(
    (candidate, index, list) => candidate && list.indexOf(candidate) === index,
  );

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
      continue;
    }
    try {
      const probe = spawnSync(candidate, ["--version"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      if (probe.status === 0) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    "SQLite storage backend requires Python 3 with sqlite3 available. " +
      "Set MY_MATE_STORAGE_PYTHON to a working interpreter path.",
  );
}

class SqliteJsonStorageBackend implements JsonStorageBackend {
  readonly kind = "sqlite";
  private pendingOperations: Map<string, PendingJsonOperation> | null = null;

  private readonly dbPath: string;
  private readonly helperPath: string;
  private readonly helperCommand: string;
  private readonly nodeHelper: boolean;
  private readonly nodeDatabase: SqliteDatabase | null;

  constructor(options?: { dbPath?: string; helperPath?: string; pythonCommand?: string }) {
    this.dbPath = path.resolve(
      options?.dbPath ||
        process.env.MY_MATE_SQLITE_PATH ||
        path.join(path.resolve(DATA_DIR), "_storage", "control-plane.sqlite3"),
    );
    const useNodeHelper = process.env.MY_MATE_STORAGE_SQLITE_HELPER_RUNTIME === "node";
    this.helperPath = options?.helperPath || path.join(
      SERVICE_ROOT,
      "src",
      useNodeHelper ? "storage-sqlite.mjs" : "storage-sqlite.py",
    );
    this.nodeHelper = this.helperPath.endsWith(".mjs");
    this.nodeDatabase = useNodeHelper ? openNodeSqliteDatabase(this.dbPath) : null;
    this.helperCommand = this.nodeHelper
      ? process.execPath
      : options?.pythonCommand || detectPythonCommand();
    if (process.env.MY_MATE_STORAGE_AUTO_MIGRATE === "true") {
      migratePhysicalFileJsonToSqlite({ storage: this });
    }
  }

  ensureDir(dirPath: string): void {
    this.run({
      action: "ensure_dir",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeDirectoryPath(dirPath),
    });
  }

  exists(filePath: string): boolean {
    const pending = this.pendingOperations?.get(path.resolve(filePath));
    if (pending) return pending.kind === "write";
    const response = this.run({
      action: "exists",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeStoragePath(filePath),
    });
    return response.exists === true;
  }

  listDirs(dirPath: string): string[] {
    const response = this.run({
      action: "list_dirs",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeDirectoryPath(dirPath),
    });
    return response.paths || [];
  }

  listJsonFiles(dirPath: string): string[] {
    const response = this.run({
      action: "list_json_files",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeDirectoryPath(dirPath),
    });
    const files = response.paths || [];
    if (!this.pendingOperations) return files;
    const resolvedDir = path.resolve(dirPath);
    const merged = new Set(files.map((file) => path.resolve(file)));
    for (const operation of this.pendingOperations.values()) {
      if (path.dirname(operation.filePath) !== resolvedDir || !operation.filePath.endsWith(".json")) continue;
      if (operation.kind === "write") merged.add(operation.filePath);
      else merged.delete(operation.filePath);
    }
    return [...merged].sort((left, right) => left.localeCompare(right));
  }

  readJson<T>(filePath: string): T {
    const pending = this.pendingOperations?.get(path.resolve(filePath));
    if (pending?.kind === "write") return structuredClone(pending.data) as T;
    if (pending?.kind === "remove") throw new Error(`Storage record not found: ${filePath}`);
    const response = this.run({
      action: "read_json",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeStoragePath(filePath),
    });
    return response.data as T;
  }

  writeJson(filePath: string, data: unknown): void {
    if (this.pendingOperations) {
      this.pendingOperations.set(path.resolve(filePath), { kind: "write", filePath: path.resolve(filePath), data: structuredClone(data) });
      return;
    }
    this.run({
      action: "write_json",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeStoragePath(filePath),
      payload: data,
    });
  }

  removeJson(filePath: string): void {
    if (this.pendingOperations) {
      this.pendingOperations.set(path.resolve(filePath), { kind: "remove", filePath: path.resolve(filePath) });
      return;
    }
    this.run({
      action: "remove_json",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeStoragePath(filePath),
    });
  }

  transaction<T>(callback: () => T): T {
    if (this.pendingOperations) return callback();
    this.pendingOperations = new Map();
    try {
      const result = callback();
      const operations = [...this.pendingOperations.values()];
      this.pendingOperations = null;
      if (operations.length) {
        this.run({
          action: "apply_batch",
          db_path: this.dbPath,
          data_dir: path.resolve(DATA_DIR),
          target_path: path.resolve(DATA_DIR),
          operations: operations.map((operation) => ({
            kind: operation.kind,
            target_path: operation.filePath,
            ...(operation.kind === "write" ? { payload: operation.data } : {}),
          })),
        });
      }
      return result;
    } catch (error) {
      this.pendingOperations = null;
      throw error;
    }
  }

  private run(request: PythonSqliteRequest): PythonSqliteResponse {
    const helperRequest = {
      ...request,
      target_path: normalizeRelativeStoragePath(request.target_path),
      operations: request.operations?.map((operation) => ({
        ...operation,
        target_path: normalizeRelativeStoragePath(operation.target_path),
      })),
    };
    if (this.nodeDatabase) {
      return runNodeSqlite(this.nodeDatabase, helperRequest);
    }

    const result = spawnSync(
      this.helperCommand,
      [this.helperPath],
      {
        encoding: "utf-8",
        input: JSON.stringify(helperRequest),
        windowsHide: true,
        env: this.nodeHelper
          ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
          : { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      },
    );

    if (result.error) {
      throw new Error(`SQLite storage helper failed to launch: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      const stdout = result.stdout?.trim();
      throw new Error(
        `SQLite storage helper failed: ${stderr || stdout || `exit code ${result.status}`}`,
      );
    }

    const stdout = result.stdout?.trim();
    if (!stdout) {
      throw new Error("SQLite storage helper returned no output.");
    }

    const response = JSON.parse(stdout) as PythonSqliteResponse;
    if (!response.ok) {
      throw new Error(response.error || "SQLite storage helper returned an unknown error.");
    }
    return response;
  }
}

export function createJsonStorageBackend(kind = process.env.MY_MATE_STORAGE_BACKEND): JsonStorageBackend {
  const normalized = (kind || "file-json").trim().toLowerCase();
  if (normalized === "file" || normalized === "json" || normalized === "file-json") {
    return new FileJsonStorageBackend();
  }
  if (normalized === "sqlite" || normalized === "sqlite-json" || normalized === "db") {
    return new SqliteJsonStorageBackend();
  }

  throw new Error(
    `Unsupported MY_MATE_STORAGE_BACKEND "${kind}". ` +
      "Supported backends are file-json and sqlite.",
  );
}

let currentJsonStorageBackend: JsonStorageBackend = createJsonStorageBackend();

export function getJsonStorageBackend(): JsonStorageBackend {
  return currentJsonStorageBackend;
}

export function getJsonStorageBackendKind(): string {
  return currentJsonStorageBackend.kind;
}

export function runJsonStorageTransaction<T>(callback: () => T): T {
  const backend = getJsonStorageBackend();
  return backend.transaction ? backend.transaction(callback) : callback();
}

export function setJsonStorageBackend(backend: JsonStorageBackend | null): void {
  currentJsonStorageBackend = backend || createJsonStorageBackend();
}
