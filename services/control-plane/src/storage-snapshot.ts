import path from "node:path";
import { DATA_DIR } from "./config.js";
import {
  getJsonStorageBackend,
  getJsonStorageBackendKind,
  type JsonStorageBackend,
} from "./storage-backend.js";
import { nowIso } from "./utils.js";

export interface JsonStorageSnapshotEntry {
  relative_path: string;
  data: unknown;
}

export interface JsonStorageSnapshot {
  schema_version: 1;
  created_at: string;
  source_backend_kind: string;
  data_dir: string;
  entries: JsonStorageSnapshotEntry[];
}

export interface JsonStorageImportResult {
  written_entries: number;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveSnapshotPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Invalid storage snapshot path "${relativePath}": absolute paths are not allowed.`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Invalid storage snapshot path "${relativePath}": path traversal is not allowed.`);
  }
  if (!normalized.endsWith(".json")) {
    throw new Error(`Invalid storage snapshot path "${relativePath}": only JSON files are supported.`);
  }
  return path.join(DATA_DIR, normalized);
}

function collectJsonFiles(
  storage: JsonStorageBackend,
  dirPath: string,
  visited = new Set<string>(),
): string[] {
  const resolvedDir = path.resolve(dirPath);
  if (visited.has(resolvedDir)) {
    return [];
  }
  visited.add(resolvedDir);

  const directFiles = storage.listJsonFiles(resolvedDir);
  const childFiles = storage
    .listDirs(resolvedDir)
    .flatMap((childDir) => collectJsonFiles(storage, childDir, visited));

  return [...directFiles, ...childFiles].sort((a, b) => a.localeCompare(b));
}

export function exportJsonStorageSnapshot(
  storage = getJsonStorageBackend(),
): JsonStorageSnapshot {
  const dataDir = path.resolve(DATA_DIR);
  const files = collectJsonFiles(storage, dataDir);
  const entries = files.map((filePath) => ({
    relative_path: normalizeRelativePath(path.relative(dataDir, filePath)),
    data: storage.readJson<unknown>(filePath),
  }));

  entries.sort((a, b) => a.relative_path.localeCompare(b.relative_path));

  return {
    schema_version: 1,
    created_at: nowIso(),
    source_backend_kind: getJsonStorageBackendKind(),
    data_dir: dataDir,
    entries,
  };
}

export function importJsonStorageSnapshot(
  snapshot: JsonStorageSnapshot,
  storage = getJsonStorageBackend(),
): JsonStorageImportResult {
  if (!snapshot || snapshot.schema_version !== 1 || !Array.isArray(snapshot.entries)) {
    throw new Error("Invalid storage snapshot: expected schema_version 1 with entries.");
  }

  for (const entry of snapshot.entries) {
    if (!entry || typeof entry.relative_path !== "string") {
      throw new Error("Invalid storage snapshot entry: relative_path is required.");
    }
    storage.writeJson(resolveSnapshotPath(entry.relative_path), entry.data);
  }

  return {
    written_entries: snapshot.entries.length,
  };
}
