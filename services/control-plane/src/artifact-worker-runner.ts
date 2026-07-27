import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { ARTIFACT_WORKER_IMAGE, RUNTIME_DOCKER_BIN } from "./config.js";

const execFileAsync = promisify(execFile);
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx"]);

type DockerExec = (
  executable: string,
  args: string[],
  options: Record<string, unknown>,
) => Promise<{ stdout: string; stderr: string }>;

export interface ArtifactWorkerRequest {
  outputName: string;
  content?: string | null;
  sourceName?: string | null;
  sourceContent?: Buffer | null;
  preferSourceConversion?: boolean;
  title?: string | null;
}

export interface ArtifactWorkerResult {
  outputName: string;
  mimeType: string;
  content: Buffer;
  extractedText: string;
  previewPdf: Buffer | null;
  sha256: string;
  workerVersion: string;
  validation: Record<string, unknown>;
}

export class ArtifactWorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function safeLeaf(value: string, fallback: string): string {
  const leaf = path.basename(value.trim().replaceAll("\\", "/"));
  if (!leaf || leaf === "." || leaf === ".." || leaf.includes("\0")) return fallback;
  return leaf.slice(0, 180);
}

function extensionOf(fileName: string): string {
  return path.extname(fileName).slice(1).toLowerCase();
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertZipStructure(content: Buffer, extension: string): void {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(content);
  } catch {
    throw new ArtifactWorkerError("artifact_validation_failed", "The generated Office artifact is not a valid ZIP package.");
  }
  const required = extension === "docx"
    ? ["[Content_Types].xml", "word/document.xml"]
    : extension === "pptx"
      ? ["[Content_Types].xml", "ppt/presentation.xml"]
      : ["[Content_Types].xml", "xl/workbook.xml"];
  if (required.some((name) => !files[name])) {
    throw new ArtifactWorkerError("artifact_validation_failed", `The generated ${extension.toUpperCase()} package is incomplete.`);
  }
}

function validateMagic(content: Buffer, extension: string): void {
  if (!content.length) throw new ArtifactWorkerError("artifact_output_missing", "Artifact Worker returned an empty file.");
  if (extension === "pdf") {
    if (content.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new ArtifactWorkerError("artifact_validation_failed", "Artifact Worker returned an invalid PDF signature.");
    }
    return;
  }
  if (content[0] !== 0x50 || content[1] !== 0x4b) {
    throw new ArtifactWorkerError("artifact_validation_failed", "Artifact Worker returned an invalid Office package signature.");
  }
  assertZipStructure(content, extension);
}

function readBoundedFile(filePath: string, maxBytes: number, code: string): Buffer {
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > maxBytes) {
    throw new ArtifactWorkerError(code, "Artifact Worker output is missing or exceeds the configured size limit.");
  }
  return fs.readFileSync(filePath);
}

function resolveOutputFile(root: string, value: unknown, expectedName?: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ArtifactWorkerError("artifact_manifest_invalid", "Artifact Worker manifest is missing an output file.");
  }
  const leaf = path.basename(value);
  if (leaf !== value || (expectedName && leaf !== expectedName)) {
    throw new ArtifactWorkerError("artifact_manifest_invalid", "Artifact Worker manifest contains an invalid output path.");
  }
  const resolved = path.resolve(root, leaf);
  if (path.dirname(resolved) !== path.resolve(root)) {
    throw new ArtifactWorkerError("artifact_manifest_invalid", "Artifact Worker output escaped its output directory.");
  }
  return resolved;
}

function parseManifest(outputRoot: string, outputName: string): Record<string, unknown> {
  const manifestPath = path.join(outputRoot, "manifest.json");
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).ok !== true) {
      throw new Error("invalid");
    }
    const manifest = value as Record<string, unknown>;
    resolveOutputFile(outputRoot, manifest.output_file, outputName);
    return manifest;
  } catch (error) {
    if (error instanceof ArtifactWorkerError) throw error;
    throw new ArtifactWorkerError("artifact_manifest_invalid", "Artifact Worker did not return a valid result manifest.");
  }
}

function dockerFailure(error: unknown): ArtifactWorkerError {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(value.code || "");
  const diagnostic = [value.stderr, value.stdout, value.message]
    .map((part) => String(part || ""))
    .join("\n");
  if (code === "ENOENT") {
    return new ArtifactWorkerError("artifact_worker_docker_unavailable", "Docker is unavailable, so the Artifact Worker could not start.");
  }
  if (/cannot connect|daemon is not running|docker engine/iu.test(diagnostic)) {
    return new ArtifactWorkerError("artifact_worker_docker_unavailable", "Docker Desktop is not running, so the Artifact Worker could not start.");
  }
  if (/no such image|pull access denied|unable to find image .* locally/iu.test(diagnostic)) {
    return new ArtifactWorkerError("artifact_worker_image_unavailable", `Artifact Worker image ${ARTIFACT_WORKER_IMAGE} is not available locally.`);
  }
  if (/tls handshake timeout|proxyconnect|i\/o timeout|network is unreachable|connection (?:reset|refused)|unexpected eof|failed to (?:resolve|authorize)|temporary failure in name resolution/iu.test(diagnostic)) {
    return new ArtifactWorkerError(
      "artifact_worker_registry_unavailable",
      "The Artifact Worker image registry is unavailable. Build or install the pinned image locally before retrying.",
    );
  }
  return new ArtifactWorkerError("artifact_worker_execution_failed", "The sandboxed Artifact Worker failed without exposing private output.");
}

export async function checkArtifactWorkerAvailability(
  dependencies: { execDocker?: DockerExec } = {},
): Promise<void> {
  const executeDocker = dependencies.execDocker || execFileAsync as DockerExec;
  try {
    await executeDocker(RUNTIME_DOCKER_BIN, ["version", "--format", "{{.Server.Version}}"], {
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      env: { ...process.env },
    });
    await executeDocker(RUNTIME_DOCKER_BIN, ["image", "inspect", ARTIFACT_WORKER_IMAGE, "--format", "{{.Id}}"], {
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      env: { ...process.env },
    });
  } catch (error) {
    throw dockerFailure(error);
  }
}

export async function runArtifactWorker(
  input: ArtifactWorkerRequest,
  dependencies: { execDocker?: DockerExec } = {},
): Promise<ArtifactWorkerResult> {
  const outputName = safeLeaf(input.outputName, "generated-output.bin");
  const extension = extensionOf(outputName);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ArtifactWorkerError(
      "artifact_format_unsupported",
      `Artifact Worker supports PDF, DOCX, PPTX, and XLSX; .${extension || "bin"} is not enabled.`,
    );
  }
  const inputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-artifact-input-"));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-artifact-output-"));
  try {
    fs.chmodSync(inputRoot, 0o755);
    fs.chmodSync(outputRoot, 0o777);
    const sourceName = input.sourceContent?.length
      ? safeLeaf(input.sourceName || `source.${extension}`, `source.${extension}`)
      : null;
    if (sourceName && input.sourceContent) {
      fs.writeFileSync(path.join(inputRoot, sourceName), input.sourceContent, { mode: 0o644 });
    }
    const request = {
      schema_version: 1,
      output_name: outputName,
      source_file: sourceName,
      content: String(input.content || "").slice(0, 8_000_000),
      title: String(input.title || path.basename(outputName, path.extname(outputName))).slice(0, 200),
      prefer_source_conversion: input.preferSourceConversion === true,
    };
    fs.writeFileSync(path.join(inputRoot, "request.json"), JSON.stringify(request), { encoding: "utf8", mode: 0o644 });
    const args = [
      "run", "--pull", "never", "--rm", "--read-only", "--network", "none", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--memory", "2g", "--cpus", "2", "--pids-limit", "256",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
      "--mount", `type=bind,source=${inputRoot},target=/input,readonly`,
      "--mount", `type=bind,source=${outputRoot},target=/output`,
      ARTIFACT_WORKER_IMAGE,
    ];
    try {
      const executeDocker = dependencies.execDocker || execFileAsync as DockerExec;
      await executeDocker(RUNTIME_DOCKER_BIN, args, {
        timeout: 180_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env },
      });
    } catch (error) {
      throw dockerFailure(error);
    }
    const manifest = parseManifest(outputRoot, outputName);
    const outputPath = resolveOutputFile(outputRoot, manifest.output_file, outputName);
    const content = readBoundedFile(outputPath, MAX_ARTIFACT_BYTES, "artifact_output_invalid");
    validateMagic(content, extension);
    const digest = sha256(content);
    if (manifest.sha256 !== digest || manifest.size_bytes !== content.byteLength) {
      throw new ArtifactWorkerError("artifact_digest_mismatch", "Artifact Worker output did not match its signed manifest metadata.");
    }
    const extractedPath = resolveOutputFile(outputRoot, manifest.extracted_text_file);
    const extractedText = fs.readFileSync(extractedPath, "utf8").slice(0, 2_000_000);
    let previewPdf: Buffer | null = null;
    if (typeof manifest.preview_file === "string" && manifest.preview_file) {
      const previewPath = resolveOutputFile(outputRoot, manifest.preview_file);
      previewPdf = readBoundedFile(previewPath, MAX_PREVIEW_BYTES, "artifact_preview_invalid");
      validateMagic(previewPdf, "pdf");
    }
    return {
      outputName,
      mimeType: String(manifest.mime_type || "application/octet-stream"),
      content,
      extractedText,
      previewPdf,
      sha256: digest,
      workerVersion: String(manifest.worker_version || "unknown"),
      validation: manifest.validation && typeof manifest.validation === "object" && !Array.isArray(manifest.validation)
        ? manifest.validation as Record<string, unknown>
        : {},
    };
  } finally {
    fs.rmSync(inputRoot, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}
