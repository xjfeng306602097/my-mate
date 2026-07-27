import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DATA_DIR,
  RUNTIME_WORKSPACE_CHANGE_SETS_DIR,
  RUNTIME_WORKSPACE_FILE_PROJECTIONS_DIR,
} from "../config.js";
import { getJsonStorageBackend } from "../storage-backend.js";
import { ensureDir, nowIso, writeJsonAtomic } from "../utils.js";

const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_DIFF_TEXT_BYTES = 256 * 1024;
const MAX_DIFF_LINES = 600;
const MAX_DIFF_LINE_CHARS = 2_000;
const DIFF_CONTEXT_LINES = 3;
const EXCLUDED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".ds_store",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const BLOCKED_FILE_NAMES = new Set([".npmrc", ".netrc", ".pypirc"]);

export interface WorkspaceFileSnapshot {
  sha256: string;
  size_bytes: number;
  mode: number;
  text_content?: string | null;
}

export interface WorkspaceDiffLine {
  kind: "context" | "added" | "deleted" | "skip";
  text: string;
  old_line: number | null;
  new_line: number | null;
}

export interface WorkspaceTextDiff {
  status: "available" | "binary" | "too_large";
  truncated: boolean;
  lines: WorkspaceDiffLine[];
}

export interface WorkspaceBaseline {
  schema_version: 1;
  source_root: string;
  sandbox_root: string;
  created_at: string;
  files: Record<string, WorkspaceFileSnapshot>;
}

export interface WorkspaceChange {
  relative_path: string;
  kind: "added" | "modified" | "deleted";
  before_sha256: string | null;
  after_sha256: string | null;
  before_size_bytes: number | null;
  after_size_bytes: number | null;
  mode: number | null;
  diff: WorkspaceTextDiff;
}

export interface RuntimeWorkspaceChangeSet {
  schema_version: 1;
  change_set_id: string;
  run_id: string;
  node_run_id: string;
  job_id: string;
  origin?: "runtime" | "conversation";
  session_id?: string | null;
  workspace_binding_id?: string | null;
  source_root: string;
  sandbox_root: string;
  status: "pending" | "applied" | "rejected" | "blocked" | "apply_failed";
  changes: WorkspaceChange[];
  blocked_reason: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_comment: string | null;
}

export interface RuntimeWorkspaceFileProjectionRecord {
  relative_path: string;
  kind: "added" | "modified" | "deleted";
  status: "pending" | "applied";
  change_set_id: string;
  source_root: string;
  before_size_bytes: number | null;
  after_size_bytes: number | null;
  added_lines: number;
  deleted_lines: number;
  created_at: string;
}

export interface RuntimeWorkspaceFileProjection {
  schema_version: 1;
  session_id: string;
  generated_at: string;
  source_root: string;
  latest_change_set_id: string | null;
  latest_pending_change_set_id: string | null;
  file_count: number;
  files: RuntimeWorkspaceFileProjectionRecord[];
  recent_change_sets: Array<{
    change_set_id: string;
    status: RuntimeWorkspaceChangeSet["status"];
    origin: "runtime" | "conversation";
    source_root: string;
    changes: Array<{
      relative_path: string;
      kind: WorkspaceChange["kind"];
      before_size_bytes: number | null;
      after_size_bytes: number | null;
      added_lines: number;
      deleted_lines: number;
    }>;
    blocked_reason: string | null;
    created_at: string;
    resolved_at: string | null;
  }>;
}

export interface WorkspaceChangePreview {
  source_root: string;
  sandbox_root: string;
  changes: WorkspaceChange[];
  blocked_reason: string | null;
}

function normalizedRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isBlockedName(name: string): boolean {
  const lower = name.toLowerCase();
  if (EXCLUDED_NAMES.has(lower)) return true;
  if (BLOCKED_FILE_NAMES.has(lower)) return true;
  if (lower === ".env") return true;
  if (lower.startsWith(".env.") && !/[.](example|sample|template|dist)$/u.test(lower)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(?:\..+)?$/u.test(lower) && !lower.endsWith(".pub")) return true;
  if (/[.](kdbx|p12|pem|pfx)$/u.test(lower)) return true;
  return false;
}

function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function readTextContent(filePath: string, size: number): string | null {
  if (size > MAX_DIFF_TEXT_BYTES) return null;
  const content = fs.readFileSync(filePath);
  if (content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

function textLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function lineDiff(before: string, after: string): WorkspaceTextDiff {
  const oldLines = textLines(before);
  const newLines = textLines(after);
  const lineContentTruncated = oldLines.some((line) => line.length > MAX_DIFF_LINE_CHARS) ||
    newLines.some((line) => line.length > MAX_DIFF_LINE_CHARS);
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return { status: "too_large", truncated: true, lines: [] };
  }
  const table = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint16Array(newLines.length + 1),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }
  const operations: WorkspaceDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      operations.push({
        kind: "context",
        text: oldLines[oldIndex].slice(0, MAX_DIFF_LINE_CHARS),
        old_line: oldIndex + 1,
        new_line: newIndex + 1,
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newLines.length &&
      (oldIndex >= oldLines.length || table[oldIndex][newIndex + 1] > table[oldIndex + 1][newIndex])
    ) {
      operations.push({
        kind: "added",
        text: newLines[newIndex].slice(0, MAX_DIFF_LINE_CHARS),
        old_line: null,
        new_line: newIndex + 1,
      });
      newIndex += 1;
    } else {
      operations.push({
        kind: "deleted",
        text: oldLines[oldIndex].slice(0, MAX_DIFF_LINE_CHARS),
        old_line: oldIndex + 1,
        new_line: null,
      });
      oldIndex += 1;
    }
  }

  const visible = new Set<number>();
  operations.forEach((line, index) => {
    if (line.kind === "context") return;
    for (
      let cursor = Math.max(0, index - DIFF_CONTEXT_LINES);
      cursor <= Math.min(operations.length - 1, index + DIFF_CONTEXT_LINES);
      cursor += 1
    ) {
      visible.add(cursor);
    }
  });
  const lines: WorkspaceDiffLine[] = [];
  let previous = -1;
  for (const index of [...visible].sort((left, right) => left - right)) {
    if (previous >= 0 && index > previous + 1) {
      lines.push({
        kind: "skip",
        text: `${index - previous - 1} unchanged lines`,
        old_line: null,
        new_line: null,
      });
    }
    lines.push(operations[index]);
    previous = index;
  }
  return {
    status: "available",
    truncated: lineContentTruncated || lines.length < operations.length,
    lines,
  };
}

function buildTextDiff(
  before: WorkspaceFileSnapshot | undefined,
  after: WorkspaceFileSnapshot | undefined,
): WorkspaceTextDiff {
  const tooLarge = (before?.size_bytes || 0) > MAX_DIFF_TEXT_BYTES ||
    (after?.size_bytes || 0) > MAX_DIFF_TEXT_BYTES;
  if (tooLarge) return { status: "too_large", truncated: true, lines: [] };
  const beforeText = before ? before.text_content : "";
  const afterText = after ? after.text_content : "";
  if (beforeText === null || beforeText === undefined || afterText === null || afterText === undefined) {
    return { status: "binary", truncated: false, lines: [] };
  }
  return lineDiff(beforeText, afterText);
}

function scanWorkspace(root: string): { files: Record<string, WorkspaceFileSnapshot>; symlinks: string[] } {
  const files: Record<string, WorkspaceFileSnapshot> = {};
  const symlinks: string[] = [];
  const queue = [root];
  let totalBytes = 0;
  let fileCount = 0;
  while (queue.length > 0) {
    const directory = queue.pop();
    if (!directory) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (isBlockedName(entry.name)) continue;
      const target = path.join(directory, entry.name);
      const relative = normalizedRelative(root, target);
      if (entry.isSymbolicLink()) {
        symlinks.push(relative);
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(target);
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`Workspace file exceeds ${MAX_FILE_BYTES} bytes: ${relative}`);
      }
      totalBytes += stat.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Workspace exceeds the sandbox byte limit.");
      fileCount += 1;
      if (fileCount > MAX_FILES) throw new Error("Workspace exceeds the sandbox file limit.");
      files[relative] = {
        sha256: sha256File(target),
        size_bytes: stat.size,
        mode: stat.mode,
        text_content: readTextContent(target, stat.size),
      };
    }
  }
  return { files, symlinks };
}

function copyWorkspace(sourceRoot: string, sandboxRoot: string): void {
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
  fs.mkdirSync(sandboxRoot, { recursive: true });
  const excludedAbsoluteRoots = [path.resolve(DATA_DIR), path.resolve(sandboxRoot)];
  const queue: Array<{ source: string; target: string }> = [{ source: sourceRoot, target: sandboxRoot }];
  let fileCount = 0;
  let totalBytes = 0;
  while (queue.length > 0) {
    const item = queue.pop();
    if (!item) continue;
    for (const entry of fs.readdirSync(item.source, { withFileTypes: true })) {
      if (isBlockedName(entry.name) || entry.isSymbolicLink()) continue;
      const source = path.join(item.source, entry.name);
      const target = path.join(item.target, entry.name);
      if (excludedAbsoluteRoots.some((excluded) => source === excluded || isInside(excluded, source))) {
        continue;
      }
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        queue.push({ source, target });
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(source);
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`Workspace file exceeds ${MAX_FILE_BYTES} bytes: ${normalizedRelative(sourceRoot, source)}`);
      }
      fileCount += 1;
      totalBytes += stat.size;
      if (fileCount > MAX_FILES) throw new Error("Workspace exceeds the sandbox file limit.");
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Workspace exceeds the sandbox byte limit.");
      fs.copyFileSync(source, target);
      try {
        fs.chmodSync(target, stat.mode);
      } catch {
        // Windows does not preserve all POSIX mode bits.
      }
    }
  }
}

function baselinePath(sandboxRoot: string): string {
  return path.join(path.dirname(sandboxRoot), "baseline.json");
}

function changeSetPath(changeSetId: string): string {
  return path.join(RUNTIME_WORKSPACE_CHANGE_SETS_DIR, `${encodeURIComponent(changeSetId)}.json`);
}

function workspaceFileProjectionPath(sessionId: string): string {
  return path.join(RUNTIME_WORKSPACE_FILE_PROJECTIONS_DIR, `${encodeURIComponent(sessionId)}.json`);
}

function readJson<T>(filePath: string): T {
  return getJsonStorageBackend().readJson<T>(filePath);
}

function saveChangeSet(changeSet: RuntimeWorkspaceChangeSet): RuntimeWorkspaceChangeSet {
  ensureDir(RUNTIME_WORKSPACE_CHANGE_SETS_DIR);
  writeJsonAtomic(changeSetPath(changeSet.change_set_id), changeSet);
  if (changeSet.session_id) rebuildRuntimeWorkspaceFileProjection(changeSet.session_id);
  return changeSet;
}

export function prepareSandboxWorkspace(input: {
  sourceRoot: string;
  sandboxRoot: string;
}): WorkspaceBaseline {
  const sourceRoot = fs.realpathSync(path.resolve(input.sourceRoot));
  if (!fs.statSync(sourceRoot).isDirectory()) throw new Error("Project workspace must be a directory.");
  const sandboxRoot = path.resolve(input.sandboxRoot);
  copyWorkspace(sourceRoot, sandboxRoot);
  const baseline: WorkspaceBaseline = {
    schema_version: 1,
    source_root: sourceRoot,
    sandbox_root: sandboxRoot,
    created_at: nowIso(),
    files: scanWorkspace(sandboxRoot).files,
  };
  writeJsonAtomic(baselinePath(sandboxRoot), baseline);
  return baseline;
}

export function ensureSandboxWorkspace(input: {
  sourceRoot: string;
  sandboxRoot: string;
}): WorkspaceBaseline {
  const sourceRoot = fs.realpathSync(path.resolve(input.sourceRoot));
  const sandboxRoot = path.resolve(input.sandboxRoot);
  const baselineFile = baselinePath(sandboxRoot);
  if (getJsonStorageBackend().exists(baselineFile) && fs.existsSync(sandboxRoot)) {
    const baseline = readJson<WorkspaceBaseline>(baselineFile);
    if (baseline.source_root !== sourceRoot || baseline.sandbox_root !== sandboxRoot) {
      throw new Error("RUN_WORKSPACE_BASELINE_MISMATCH");
    }
    return baseline;
  }
  return prepareSandboxWorkspace({ sourceRoot, sandboxRoot });
}

export function inspectSandboxWorkspace(sandboxRootInput: string): WorkspaceChangePreview | null {
  const sandboxRoot = path.resolve(sandboxRootInput);
  const baselineFile = baselinePath(sandboxRoot);
  if (!getJsonStorageBackend().exists(baselineFile) || !fs.existsSync(sandboxRoot)) return null;
  const baseline = readJson<WorkspaceBaseline>(baselineFile);
  const current = scanWorkspace(sandboxRoot);
  const paths = [...new Set([...Object.keys(baseline.files), ...Object.keys(current.files)])].sort();
  const changes: WorkspaceChange[] = [];
  for (const relativePath of paths) {
    const before = baseline.files[relativePath];
    const after = current.files[relativePath];
    if (before?.sha256 === after?.sha256 && before?.mode === after?.mode) continue;
    changes.push({
      relative_path: relativePath,
      kind: !before ? "added" : !after ? "deleted" : "modified",
      before_sha256: before?.sha256 ?? null,
      after_sha256: after?.sha256 ?? null,
      before_size_bytes: before?.size_bytes ?? null,
      after_size_bytes: after?.size_bytes ?? null,
      mode: after?.mode ?? null,
      diff: buildTextDiff(before, after),
    });
  }
  if (changes.length === 0 && current.symlinks.length === 0) return null;
  return {
    source_root: baseline.source_root,
    sandbox_root: baseline.sandbox_root,
    changes,
    blocked_reason: current.symlinks.length > 0
      ? `Sandbox contains unsupported symbolic links: ${current.symlinks.slice(0, 10).join(", ")}`
      : null,
  };
}

export function finalizeSandboxWorkspace(input: {
  runId: string;
  nodeRunId: string;
  jobId: string;
  sandboxRoot: string;
  origin?: "runtime" | "conversation";
  sessionId?: string | null;
  workspaceBindingId?: string | null;
}): RuntimeWorkspaceChangeSet | null {
  const preview = inspectSandboxWorkspace(input.sandboxRoot);
  if (!preview) return null;
  const changeSet: RuntimeWorkspaceChangeSet = {
    schema_version: 1,
    change_set_id: `wschange_${randomUUID()}`,
    run_id: input.runId,
    node_run_id: input.nodeRunId,
    job_id: input.jobId,
    origin: input.origin || "runtime",
    session_id: input.sessionId || null,
    workspace_binding_id: input.workspaceBindingId || null,
    source_root: preview.source_root,
    sandbox_root: preview.sandbox_root,
    status: preview.blocked_reason ? "blocked" : "pending",
    changes: preview.changes,
    blocked_reason: preview.blocked_reason,
    created_at: nowIso(),
    resolved_at: null,
    resolved_by: null,
    resolution_comment: null,
  };
  return saveChangeSet(changeSet);
}

export function getRuntimeWorkspaceChangeSet(changeSetId: string): RuntimeWorkspaceChangeSet | null {
  const filePath = changeSetPath(changeSetId);
  return getJsonStorageBackend().exists(filePath) ? readJson<RuntimeWorkspaceChangeSet>(filePath) : null;
}

export function listRuntimeWorkspaceChangeSets(status?: RuntimeWorkspaceChangeSet["status"]): RuntimeWorkspaceChangeSet[] {
  return getJsonStorageBackend().listJsonFiles(RUNTIME_WORKSPACE_CHANGE_SETS_DIR)
    .map((filePath) => readJson<RuntimeWorkspaceChangeSet>(filePath))
    .filter((item) => !status || item.status === status)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function projectChangeSetSummary(changeSet: RuntimeWorkspaceChangeSet): RuntimeWorkspaceFileProjection["recent_change_sets"][number] {
  return {
    change_set_id: changeSet.change_set_id,
    status: changeSet.status,
    origin: changeSet.origin || "runtime",
    source_root: changeSet.source_root,
    changes: changeSet.changes.map((change) => ({
      relative_path: change.relative_path,
      kind: change.kind,
      before_size_bytes: change.before_size_bytes,
      after_size_bytes: change.after_size_bytes,
      added_lines: change.diff.lines.filter((line) => line.kind === "added").length,
      deleted_lines: change.diff.lines.filter((line) => line.kind === "deleted").length,
    })),
    blocked_reason: changeSet.blocked_reason,
    created_at: changeSet.created_at,
    resolved_at: changeSet.resolved_at,
  };
}

export function rebuildRuntimeWorkspaceFileProjection(sessionId: string): RuntimeWorkspaceFileProjection {
  const history = listRuntimeWorkspaceChangeSets()
    .filter((changeSet) => changeSet.session_id === sessionId)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const effective = new Map<string, RuntimeWorkspaceFileProjectionRecord>();
  for (const changeSet of history) {
    if (changeSet.status !== "applied" && changeSet.status !== "pending") continue;
    for (const change of changeSet.changes) {
      effective.set(change.relative_path, {
        relative_path: change.relative_path,
        kind: change.kind,
        status: changeSet.status,
        change_set_id: changeSet.change_set_id,
        source_root: changeSet.source_root,
        before_size_bytes: change.before_size_bytes,
        after_size_bytes: change.after_size_bytes,
        added_lines: change.diff.lines.filter((line) => line.kind === "added").length,
        deleted_lines: change.diff.lines.filter((line) => line.kind === "deleted").length,
        created_at: changeSet.created_at,
      });
    }
  }
  const latest = history.at(-1) || null;
  const latestPending = [...history].reverse().find((changeSet) => changeSet.status === "pending") || null;
  const projection: RuntimeWorkspaceFileProjection = {
    schema_version: 1,
    session_id: sessionId,
    generated_at: nowIso(),
    source_root: latest?.source_root || latestPending?.source_root || "",
    latest_change_set_id: latest?.change_set_id || null,
    latest_pending_change_set_id: latestPending?.change_set_id || null,
    file_count: effective.size,
    files: [...effective.values()].sort((left, right) => left.relative_path.localeCompare(right.relative_path)),
    recent_change_sets: history.slice(-20).reverse().map(projectChangeSetSummary),
  };
  ensureDir(RUNTIME_WORKSPACE_FILE_PROJECTIONS_DIR);
  writeJsonAtomic(workspaceFileProjectionPath(sessionId), projection);
  return projection;
}

export function getRuntimeWorkspaceFileProjection(sessionId: string): RuntimeWorkspaceFileProjection | null {
  const filePath = workspaceFileProjectionPath(sessionId);
  if (getJsonStorageBackend().exists(filePath)) return readJson<RuntimeWorkspaceFileProjection>(filePath);
  const hasChangeSet = listRuntimeWorkspaceChangeSets().some((changeSet) => changeSet.session_id === sessionId);
  return hasChangeSet ? rebuildRuntimeWorkspaceFileProjection(sessionId) : null;
}

function targetPath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("Change set contains an invalid relative path.");
  }
  const target = path.resolve(root, relativePath);
  if (!isInside(root, target)) throw new Error("Change set path escapes its workspace root.");
  return target;
}

function currentSnapshot(filePath: string): WorkspaceFileSnapshot | null {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile()) throw new Error(`Workspace conflict: expected a regular file at ${filePath}.`);
  return { sha256: sha256File(filePath), size_bytes: stat.size, mode: stat.mode };
}

export function applyRuntimeWorkspaceChangeSet(input: {
  changeSetId: string;
  actor: string;
  comment?: string;
}): RuntimeWorkspaceChangeSet {
  const changeSet = getRuntimeWorkspaceChangeSet(input.changeSetId);
  if (!changeSet) throw new Error("WORKSPACE_CHANGE_SET_NOT_FOUND");
  if (changeSet.status !== "pending") throw new Error("WORKSPACE_CHANGE_SET_NOT_PENDING");

  const prepared = changeSet.changes.map((change) => {
    const source = targetPath(changeSet.source_root, change.relative_path);
    const sandbox = targetPath(changeSet.sandbox_root, change.relative_path);
    const current = currentSnapshot(source);
    if (change.kind === "added" && current) {
      throw new Error(`WORKSPACE_CONFLICT: ${change.relative_path} was created after sandbox dispatch.`);
    }
    if (change.kind !== "added" && current?.sha256 !== change.before_sha256) {
      throw new Error(`WORKSPACE_CONFLICT: ${change.relative_path} changed after sandbox dispatch.`);
    }
    if (change.kind !== "deleted") {
      const result = currentSnapshot(sandbox);
      if (result?.sha256 !== change.after_sha256) {
        throw new Error(`SANDBOX_CHANGED: ${change.relative_path} no longer matches the reviewed change set.`);
      }
    }
    return { change, source, sandbox };
  });

  const journal: Array<(typeof prepared)[number] & {
    existed: boolean;
    backup: string | null;
    temporary: string | null;
  }> = [];
  try {
    for (const item of prepared) {
      fs.mkdirSync(path.dirname(item.source), { recursive: true });
      const existed = fs.existsSync(item.source);
      const backup = existed ? `${item.source}.my-mate-${randomUUID()}.bak` : null;
      const temporary = item.change.kind === "deleted"
        ? null
        : `${item.source}.my-mate-${randomUUID()}.tmp`;
      if (backup) fs.copyFileSync(item.source, backup);
      if (temporary) {
        fs.copyFileSync(item.sandbox, temporary);
        if (item.change.mode !== null) {
          try {
            fs.chmodSync(temporary, item.change.mode);
          } catch {
            // Windows does not preserve all POSIX mode bits.
          }
        }
      }
      journal.push({ ...item, existed, backup, temporary });
    }
  } catch (error) {
    for (const item of journal) {
      if (item.temporary) fs.rmSync(item.temporary, { force: true });
      if (item.backup) fs.rmSync(item.backup, { force: true });
    }
    changeSet.status = "apply_failed";
    changeSet.blocked_reason = error instanceof Error ? error.message : "Workspace change preparation failed.";
    saveChangeSet(changeSet);
    throw error;
  }

  try {
    for (const item of journal) {
      if (item.change.kind === "deleted") {
        fs.rmSync(item.source, { force: true });
        continue;
      }
      if (!item.temporary) throw new Error(`Missing staged file for ${item.change.relative_path}.`);
      try {
        fs.renameSync(item.temporary, item.source);
      } catch (error) {
        if (!fs.existsSync(item.source)) throw error;
        fs.copyFileSync(item.temporary, item.source);
        fs.rmSync(item.temporary, { force: true });
      }
    }
    changeSet.status = "applied";
  } catch (error) {
    for (const item of [...journal].reverse()) {
      try {
        if (item.backup && fs.existsSync(item.backup)) {
          fs.copyFileSync(item.backup, item.source);
        } else if (!item.existed) {
          fs.rmSync(item.source, { force: true });
        }
      } catch {
        // Keep the original application error as the primary failure.
      }
    }
    changeSet.status = "apply_failed";
    changeSet.blocked_reason = error instanceof Error ? error.message : "Workspace change application failed.";
    saveChangeSet(changeSet);
    throw error;
  } finally {
    for (const item of journal) {
      if (item.temporary) fs.rmSync(item.temporary, { force: true });
      if (item.backup) fs.rmSync(item.backup, { force: true });
    }
  }
  changeSet.resolved_at = nowIso();
  changeSet.resolved_by = input.actor;
  changeSet.resolution_comment = input.comment?.trim() || null;
  return saveChangeSet(changeSet);
}

export function rejectRuntimeWorkspaceChangeSet(input: {
  changeSetId: string;
  actor: string;
  comment?: string;
}): RuntimeWorkspaceChangeSet {
  const changeSet = getRuntimeWorkspaceChangeSet(input.changeSetId);
  if (!changeSet) throw new Error("WORKSPACE_CHANGE_SET_NOT_FOUND");
  if (!["pending", "blocked", "apply_failed"].includes(changeSet.status)) {
    throw new Error("WORKSPACE_CHANGE_SET_NOT_PENDING");
  }
  changeSet.status = "rejected";
  changeSet.resolved_at = nowIso();
  changeSet.resolved_by = input.actor;
  changeSet.resolution_comment = input.comment?.trim() || null;
  return saveChangeSet(changeSet);
}
