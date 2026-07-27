import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function normalizeRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return "";
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Invalid storage path "${value}"`);
  }
  return normalized;
}

function parentPath(value) {
  const normalized = normalizeRelativePath(value);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function baseName(value) {
  const normalized = normalizeRelativePath(value);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
}

function ensureSchema(database) {
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
}

function ensureDir(database, value) {
  const normalized = normalizeRelativePath(value);
  const insert = database.prepare(
    "INSERT OR IGNORE INTO logical_dirs(path, parent_path, name) VALUES(?, ?, ?)",
  );
  let current = "";
  for (const part of normalized ? normalized.split("/") : []) {
    const next = current ? `${current}/${part}` : part;
    insert.run(next, current, part);
    current = next;
  }
}

function absolutePaths(dataDir, rows) {
  return rows.map((row) => path.normalize(path.join(dataDir, row.path)));
}

function execute(database, request) {
  const target = normalizeRelativePath(request.target_path);
  switch (request.action) {
    case "apply_batch":
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const operation of request.operations || []) {
          execute(database, {
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
    case "ensure_dir":
      ensureDir(database, target);
      return { ok: true };
    case "exists":
      return {
        ok: true,
        exists: Boolean(database.prepare("SELECT 1 FROM json_records WHERE path = ?").get(target)),
      };
    case "list_dirs":
      ensureDir(database, target);
      return {
        ok: true,
        paths: absolutePaths(
          request.data_dir,
          database.prepare(
            "SELECT path FROM logical_dirs WHERE parent_path = ? AND path <> ? ORDER BY path",
          ).all(target, target),
        ),
      };
    case "list_json_files":
      ensureDir(database, target);
      return {
        ok: true,
        paths: absolutePaths(
          request.data_dir,
          database.prepare("SELECT path FROM json_records WHERE parent_path = ? ORDER BY path").all(target),
        ),
      };
    case "read_json": {
      const row = database.prepare("SELECT json_text FROM json_records WHERE path = ?").get(target);
      if (!row) throw new Error(`Storage record not found: ${target}`);
      return { ok: true, data: JSON.parse(row.json_text) };
    }
    case "write_json":
      ensureDir(database, parentPath(target));
      database.prepare(`
        INSERT INTO json_records(path, parent_path, name, json_text)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          parent_path = excluded.parent_path,
          name = excluded.name,
          json_text = excluded.json_text
      `).run(target, parentPath(target), baseName(target), `${JSON.stringify(request.payload, null, 2)}\n`);
      return { ok: true };
    case "remove_json":
      database.prepare("DELETE FROM json_records WHERE path = ?").run(target);
      return { ok: true };
    default:
      throw new Error(`Unsupported sqlite storage action: ${request.action}`);
  }
}

let database;
try {
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  fs.mkdirSync(path.dirname(request.db_path), { recursive: true });
  database = new DatabaseSync(request.db_path);
  ensureSchema(database);
  process.stdout.write(JSON.stringify(execute(database, request)));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
} finally {
  database?.close();
}
