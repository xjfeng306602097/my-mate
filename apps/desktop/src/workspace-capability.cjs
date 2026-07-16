const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MAX_DIRECTORY_ENTRIES = 500;
const MAX_TEXT_BYTES = 256 * 1024;
const SAFE_ENV_SUFFIXES = new Set(["dist", "example", "sample", "template"]);
const SENSITIVE_EXTENSIONS = new Set([".kdbx", ".p12", ".pem", ".pfx"]);
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cjs", ".cpp", ".css", ".csv", ".go", ".h", ".hpp", ".html",
  ".ini", ".java", ".js", ".json", ".jsx", ".log", ".md", ".mjs", ".py", ".rb",
  ".rs", ".scss", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsx", ".txt", ".xml",
  ".yaml", ".yml",
]);

function capabilityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sensitivePathReason(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  const basename = path.basename(normalized);
  const extension = path.extname(basename);
  if (!basename) return null;
  if (normalized.includes("/.ssh/")) return "SSH key and configuration files are blocked.";
  if (normalized.includes("/.gnupg/")) return "GPG key material is blocked.";
  if (normalized.endsWith("/.aws/credentials")) return "AWS credentials are blocked.";
  if (basename === ".env") return ".env files are blocked.";
  if (basename.startsWith(".env.") && !SAFE_ENV_SUFFIXES.has(basename.slice(5))) {
    return `${basename} appears to contain environment secrets.`;
  }
  if (/^id_(rsa|dsa|ecdsa|ed25519)(?:\..+)?$/u.test(basename) && !basename.endsWith(".pub")) {
    return "SSH private keys are blocked.";
  }
  if (SENSITIVE_EXTENSIONS.has(extension)) return `${extension} key or certificate files are blocked.`;
  if ([".npmrc", ".netrc", ".pypirc"].includes(basename)) return `${basename} may contain credentials.`;
  return null;
}

function rejectUnsafeRelativePath(relativePath) {
  if (relativePath === undefined || relativePath === null || relativePath === "") return "";
  if (typeof relativePath !== "string" || relativePath.includes("\0")) {
    throw capabilityError("invalid-path", "Workspace path is invalid.");
  }
  const raw = relativePath.trim();
  const deviceSyntax = raw.replace(/\\/g, "/").toLowerCase();
  if (path.isAbsolute(raw) || deviceSyntax.startsWith("//") || deviceSyntax.includes("globalroot/device")) {
    throw capabilityError("invalid-path", "Workspace paths must be relative to the selected root.");
  }
  return raw;
}

function isWithinRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalDirectory(directoryPath, fsImpl = fs) {
  const resolved = path.resolve(directoryPath);
  const stat = await fsImpl.promises.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw capabilityError("workspace-unavailable", "Selected workspace is not a readable directory.");
  return await fsImpl.promises.realpath(resolved);
}

async function resolveWithinRoot(rootPath, relativePath, options = {}) {
  const fsImpl = options.fs || fs;
  const purpose = options.purpose || "Workspace access";
  const safeRelative = rejectUnsafeRelativePath(relativePath);
  const candidate = path.resolve(rootPath, safeRelative);
  if (!isWithinRoot(rootPath, candidate)) {
    throw capabilityError("outside-workspace", `${purpose} blocked: path escapes the selected workspace.`);
  }
  const realPath = await fsImpl.promises.realpath(candidate).catch((error) => {
    throw capabilityError(error?.code || "read-error", `${purpose} failed: path does not exist.`);
  });
  if (!isWithinRoot(rootPath, realPath)) {
    throw capabilityError("outside-workspace", `${purpose} blocked: resolved path escapes the selected workspace.`);
  }
  const sensitiveReason = sensitivePathReason(realPath);
  if (sensitiveReason) throw capabilityError("sensitive-file", `${purpose} blocked: ${sensitiveReason}`);
  return realPath;
}

function toWorkspaceRelative(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const known = {
    ".css": "text/css", ".csv": "text/csv", ".html": "text/html", ".js": "text/javascript",
    ".json": "application/json", ".jsx": "text/jsx", ".md": "text/markdown", ".mjs": "text/javascript",
    ".py": "text/x-python", ".svg": "image/svg+xml", ".ts": "text/typescript", ".tsx": "text/tsx",
    ".txt": "text/plain", ".xml": "application/xml", ".yaml": "application/yaml", ".yml": "application/yaml",
  };
  return known[extension] || "text/plain";
}

async function listWorkspaceDirectory(rootPath, relativePath = "", options = {}) {
  const fsImpl = options.fs || fs;
  const directory = await resolveWithinRoot(rootPath, relativePath, { fs: fsImpl, purpose: "Directory listing" });
  const stat = await fsImpl.promises.stat(directory);
  if (!stat.isDirectory()) throw capabilityError("not-directory", "Directory listing failed: path is not a directory.");
  const entries = await fsImpl.promises.readdir(directory, { withFileTypes: true });
  const visible = entries
    .filter((entry) => !sensitivePathReason(path.join(directory, entry.name)))
    .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
    .slice(0, options.maxEntries || MAX_DIRECTORY_ENTRIES);
  const items = [];
  for (const entry of visible) {
    const entryPath = path.join(directory, entry.name);
    const entryRelative = toWorkspaceRelative(rootPath, entryPath);
    const entryStat = await fsImpl.promises.stat(entryPath).catch(() => null);
    const isDirectory = entryStat?.isDirectory() || false;
    const isFile = entryStat?.isFile() || false;
    items.push({
      name: entry.name,
      relativePath: entryRelative,
      kind: isDirectory ? "directory" : isFile ? "file" : "other",
      sizeBytes: isFile ? entryStat.size : null,
      modifiedAt: entryStat ? entryStat.mtime.toISOString() : null,
      readableText: isFile && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    });
  }
  const currentRelativePath = toWorkspaceRelative(rootPath, directory);
  return {
    relativePath: currentRelativePath,
    parentRelativePath: currentRelativePath ? toWorkspaceRelative(rootPath, path.dirname(directory)) : null,
    truncated: entries.length > visible.length,
    items,
  };
}

async function readWorkspaceText(rootPath, relativePath, options = {}) {
  const fsImpl = options.fs || fs;
  const maxBytes = options.maxBytes || MAX_TEXT_BYTES;
  const filePath = await resolveWithinRoot(rootPath, relativePath, { fs: fsImpl, purpose: "File read" });
  const stat = await fsImpl.promises.stat(filePath);
  if (!stat.isFile()) throw capabilityError("not-file", "File read failed: path is not a regular file.");
  if (stat.size > maxBytes) {
    throw capabilityError("file-too-large", `File read blocked: text files are limited to ${maxBytes} bytes.`);
  }
  if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw capabilityError("unsupported-file", "File read blocked: only recognized text files are supported.");
  }
  const buffer = await fsImpl.promises.readFile(filePath);
  if (buffer.includes(0)) throw capabilityError("binary-file", "File read blocked: binary content is not supported.");
  return {
    name: path.basename(filePath),
    relativePath: toWorkspaceRelative(rootPath, filePath),
    fileUrl: pathToFileURL(filePath).href,
    mimeType: mimeTypeFor(filePath),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    content: buffer.toString("utf8"),
  };
}

module.exports = {
  MAX_DIRECTORY_ENTRIES,
  MAX_TEXT_BYTES,
  canonicalDirectory,
  isWithinRoot,
  listWorkspaceDirectory,
  readWorkspaceText,
  rejectUnsafeRelativePath,
  resolveWithinRoot,
  sensitivePathReason,
};
