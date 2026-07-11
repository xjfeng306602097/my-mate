import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DATA_DIR, SERVICE_ROOT } from "./config.js";

const WINDOWS_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const RENAME_RETRY_DELAYS_MS = [5, 10, 20, 40, 80];
const retryWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

function renameWithRetry(sourcePath: string, targetPath: string): void {
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
}

class FileJsonStorageBackend implements JsonStorageBackend {
  readonly kind = "file-json";

  ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  exists(filePath: string): boolean {
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
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dirPath, entry.name));
  }

  readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  }

  writeJson(filePath: string, data: unknown): void {
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
    fs.rmSync(filePath, { force: true });
  }
}

interface PythonSqliteRequest {
  action: "ensure_dir" | "exists" | "list_dirs" | "list_json_files" | "read_json" | "write_json" | "remove_json";
  db_path: string;
  data_dir: string;
  target_path: string;
  payload?: unknown;
}

interface PythonSqliteResponse {
  ok: boolean;
  exists?: boolean;
  paths?: string[];
  data?: unknown;
  error?: string;
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

  private readonly dbPath: string;
  private readonly helperPath: string;
  private readonly pythonCommand: string;

  constructor(options?: { dbPath?: string; helperPath?: string; pythonCommand?: string }) {
    this.dbPath = path.resolve(
      options?.dbPath ||
        process.env.MY_MATE_SQLITE_PATH ||
        path.join(path.resolve(DATA_DIR), "_storage", "control-plane.sqlite3"),
    );
    this.helperPath =
      options?.helperPath || path.join(SERVICE_ROOT, "src", "storage-sqlite.py");
    this.pythonCommand = options?.pythonCommand || detectPythonCommand();
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
    return response.paths || [];
  }

  readJson<T>(filePath: string): T {
    const response = this.run({
      action: "read_json",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeStoragePath(filePath),
    });
    return response.data as T;
  }

  writeJson(filePath: string, data: unknown): void {
    this.run({
      action: "write_json",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeStoragePath(filePath),
      payload: data,
    });
  }

  removeJson(filePath: string): void {
    this.run({
      action: "remove_json",
      db_path: this.dbPath,
      data_dir: path.resolve(DATA_DIR),
      target_path: normalizeStoragePath(filePath),
    });
  }

  private run(request: PythonSqliteRequest): PythonSqliteResponse {
    const helperRequest = {
      ...request,
      target_path: normalizeRelativeStoragePath(request.target_path),
    };

    const result = spawnSync(
      this.pythonCommand,
      [this.helperPath],
      {
        encoding: "utf-8",
        input: JSON.stringify(helperRequest),
        windowsHide: true,
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

export function setJsonStorageBackend(backend: JsonStorageBackend | null): void {
  currentJsonStorageBackend = backend || createJsonStorageBackend();
}
