import { createHash, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_FILES = 128;
const MAX_BYTES = 4 * 1024 * 1024;
const BLOCKED_NAMES = /^(?:\.env(?:\..+)?|.*\.(?:pem|p12|pfx|key)|id_(?:rsa|ed25519))$/iu;
const DANGEROUS_PATTERNS = [
  { id: "destructive_shell", pattern: /(?:rm\s+-rf|Remove-Item\s+.*-Recurse|format\s+[A-Z]:)/iu },
  {
    id: "credential_access",
    pattern: /(?:[\\/](?:\.ssh|\.aws|credentials|passwords?|api[_-]?keys?)(?:[\\/]|["'`])|(?:readFileSync|readFile|Get-Content|cat)\s*\([^\)\n]{0,160}(?:\.ssh|\.aws|credentials|passwords?|api[_-]?keys?)|process\.env\.[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))/iu,
  },
  { id: "shell_download_execute", pattern: /(?:curl|wget|Invoke-WebRequest)[^\n]{0,200}(?:\||&&|;)[^\n]{0,80}(?:sh|bash|powershell|cmd)/iu },
  { id: "prompt_policy_override", pattern: /(?:ignore|override|bypass).{0,40}(?:system|policy|permission|approval)/iu },
];

export interface SkillScanResult {
  source_path: string;
  package_digest: string;
  file_count: number;
  total_bytes: number;
  blockers: Array<{ code: string; file: string; message: string }>;
  warnings: Array<{ code: string; file: string; message: string }>;
  signature: "verified" | "missing" | "invalid" | "not_configured";
  installable: boolean;
}

function packageFiles(root: string): Array<{ path: string; relative: string; bytes: Buffer }> {
  const result: Array<{ path: string; relative: string; bytes: Buffer }> = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const relative = path.relative(root, target).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${relative}`);
      if (BLOCKED_NAMES.test(entry.name) || [".git", ".ssh", "node_modules", "secrets", "credentials"].includes(entry.name.toLowerCase())) {
        throw new Error(`Sensitive package path is not allowed: ${relative}`);
      }
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) result.push({ path: target, relative, bytes: fs.readFileSync(target) });
      else throw new Error(`Unsupported package entry: ${relative}`);
    }
  };
  visit(root);
  return result.sort((left, right) => left.relative.localeCompare(right.relative));
}

export function scanSkillPackage(sourcePath: string, publicKey?: string | null): SkillScanResult {
  const root = fs.realpathSync(path.resolve(sourcePath));
  const blockers: SkillScanResult["blockers"] = [];
  const warnings: SkillScanResult["warnings"] = [];
  let files: ReturnType<typeof packageFiles> = [];
  try { files = packageFiles(root); }
  catch (error) { blockers.push({ code: "unsafe_structure", file: ".", message: error instanceof Error ? error.message : "Unsafe package structure." }); }
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (files.length > MAX_FILES || totalBytes > MAX_BYTES) blockers.push({ code: "package_too_large", file: ".", message: "Package exceeds the file or byte limit." });
  if (!files.some((file) => file.relative === "SKILL.md") || !files.some((file) => file.relative === "my-mate.skill.json")) blockers.push({ code: "package_contract_missing", file: ".", message: "SKILL.md and my-mate.skill.json are required." });
  for (const file of files) {
    if (file.bytes.includes(0)) continue;
    const text = file.bytes.toString("utf-8");
    for (const rule of DANGEROUS_PATTERNS) if (rule.pattern.test(text)) blockers.push({ code: rule.id, file: file.relative, message: `Blocked pattern ${rule.id} was detected.` });
    if (/https?:\/\//iu.test(text)) warnings.push({ code: "external_reference", file: file.relative, message: "Package references an external URL." });
  }
  const digest = createHash("sha256");
  for (const file of files.filter((item) => item.relative !== "my-mate.signature.json")) digest.update(file.relative).update("\0").update(file.bytes).update("\0");
  const packageDigest = digest.digest("hex");
  let signature: SkillScanResult["signature"] = publicKey ? "missing" : "not_configured";
  const signatureFile = files.find((file) => file.relative === "my-mate.signature.json");
  if (signatureFile && publicKey) {
    try {
      const parsed = JSON.parse(signatureFile.bytes.toString("utf-8")) as { digest?: string; signature?: string };
      signature = parsed.digest === packageDigest && typeof parsed.signature === "string" && verify(null, Buffer.from(packageDigest), publicKey, Buffer.from(parsed.signature, "base64")) ? "verified" : "invalid";
    } catch { signature = "invalid"; }
    if (signature !== "verified") blockers.push({ code: "signature_invalid", file: "my-mate.signature.json", message: "Package signature verification failed." });
  } else if (publicKey) blockers.push({ code: "signature_missing", file: "my-mate.signature.json", message: "This source requires a package signature." });
  return { source_path: root, package_digest: packageDigest, file_count: files.length, total_bytes: totalBytes, blockers, warnings, signature, installable: blockers.length === 0 };
}
