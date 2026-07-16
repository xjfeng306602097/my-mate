import fs from "node:fs";
import path from "node:path";
import type { ExecutionArtifactRecord, RuntimeWorkerJob } from "./types.js";

export const MAX_OUTPUT_FILES = 64;
export const MAX_OUTPUT_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_OUTPUT_TOTAL_BYTES = 256 * 1024 * 1024;

const SENSITIVE_FILE_PATTERN = /^(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|credentials?|secrets?|auth(?:orization)?)(?:\..*)?$|\.(?:pem|key|p12|pfx|keystore)$/iu;

function safeJobSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function workspaceRoot(job: RuntimeWorkerJob): string {
  return path.resolve(
    job.provision.env.MY_MATE_WORKSPACE ||
      process.env.MY_MATE_WORKSPACE ||
      process.cwd(),
  );
}

export function artifactOutputDirectory(job: RuntimeWorkerJob): string {
  return path.join(workspaceRoot(job), ".my-mate", "outputs", safeJobSegment(job.node_run_id));
}

export function artifactOutputRelativeDirectory(job: RuntimeWorkerJob): string {
  return [".my-mate", "outputs", safeJobSegment(job.node_run_id)].join("/");
}

export function prepareArtifactOutputDirectory(job: RuntimeWorkerJob): string {
  const outputDir = artifactOutputDirectory(job);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  job.provision.env = {
    ...job.provision.env,
    MY_MATE_OUTPUT_DIR: outputDir,
  };
  job.provision.workspace.metadata = {
    ...job.provision.workspace.metadata,
    artifact_output_directory: artifactOutputRelativeDirectory(job),
  };
  return outputDir;
}

export function artifactOutputPrompt(job: RuntimeWorkerJob): string {
  const relativeDir = artifactOutputRelativeDirectory(job);
  return [
    "Artifact output contract:",
    `- Write every user-requested deliverable under ${relativeDir}.`,
    "- Preserve the requested file extension and create real file bytes; do not substitute a prose description or base64 text.",
    "- You may create nested directories inside that output directory when the deliverable requires multiple files.",
    "- Do not write credentials, private keys, .env files, or symlinks into the output directory.",
    "- Before claiming completion, verify that each requested deliverable exists and is non-empty.",
    "- In the final response, list the relative paths actually created. The runtime will publish only files it can verify on disk.",
  ].join("\n");
}

function mimeTypeFor(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const mapping: Record<string, string> = {
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".properties": "text/plain; charset=utf-8",
    ".ini": "text/plain; charset=utf-8",
    ".cfg": "text/plain; charset=utf-8",
    ".conf": "text/plain; charset=utf-8",
    ".java": "text/x-java-source; charset=utf-8",
    ".py": "text/x-python; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".cjs": "text/javascript; charset=utf-8",
    ".ts": "text/typescript; charset=utf-8",
    ".tsx": "text/typescript; charset=utf-8",
    ".jsx": "text/jsx; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jsonl": "application/x-ndjson; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".yaml": "application/yaml; charset=utf-8",
    ".yml": "application/yaml; charset=utf-8",
    ".toml": "application/toml; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".sql": "application/sql; charset=utf-8",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".epub": "application/epub+zip",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".7z": "application/x-7z-compressed",
    ".rar": "application/vnd.rar",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
  };
  return mapping[extension] || "application/octet-stream";
}

function outputFiles(root: string): Array<{ absolutePath: string; relativePath: string; size: number }> {
  const files: Array<{ absolutePath: string; relativePath: string; size: number }> = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Artifact output contains a forbidden symlink: ${path.relative(root, absolutePath)}`);
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const segments = relativePath.split("/");
      if (segments.some((segment) => SENSITIVE_FILE_PATTERN.test(segment))) {
        throw new Error(`Artifact output contains a sensitive file name: ${relativePath}`);
      }
      if (stat.size <= 0) {
        throw new Error(`Artifact output is empty: ${relativePath}`);
      }
      if (stat.size > MAX_OUTPUT_FILE_BYTES) {
        throw new Error(`Artifact output exceeds ${MAX_OUTPUT_FILE_BYTES} bytes: ${relativePath}`);
      }
      files.push({ absolutePath, relativePath, size: stat.size });
      if (files.length > MAX_OUTPUT_FILES) {
        throw new Error(`Artifact output exceeds ${MAX_OUTPUT_FILES} files.`);
      }
    }
  };
  visit(root);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_OUTPUT_TOTAL_BYTES) {
    throw new Error(`Artifact output exceeds ${MAX_OUTPUT_TOTAL_BYTES} total bytes.`);
  }
  return files;
}

export function collectArtifactOutputs(job: RuntimeWorkerJob): ExecutionArtifactRecord[] {
  const root = artifactOutputDirectory(job);
  if (!fs.existsSync(root)) return [];
  const storageRoot = artifactOutputRelativeDirectory(job);
  return outputFiles(root).map((file, index) => ({
    artifact_id: `artifact_${safeJobSegment(job.node_run_id)}_${job.dispatch_sequence}_${index + 1}`,
    type: "deliverable",
    name: path.posix.basename(file.relativePath),
    storage_uri: `workspace://${storageRoot}/${file.relativePath}`,
    mime_type: mimeTypeFor(file.relativePath),
    size_bytes: file.size,
  }));
}
