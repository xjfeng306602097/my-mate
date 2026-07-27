import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getCapabilityRegistry } from "./capability-registry.js";
import { DATA_DIR, REPO_ROOT, SKILL_INVOCATIONS_DIR, SKILL_PACKAGES_DIR } from "./config.js";
import { getJsonStorageBackend, renameWithRetry } from "./storage-backend.js";
import { getSkillWorkspaceProfile, recordSkillEvaluation } from "./skill-platform-store.js";
import type {
  SessionRecord,
  SkillInvocationRecord,
  SkillPackageManifest,
  SkillPackageSource,
  SkillPackageStatus,
  SkillScriptDeclaration,
} from "./types.js";
import { nowIso } from "./utils.js";

const MANIFEST_NAME = "my-mate.skill.json";
const INSTRUCTIONS_NAME = "SKILL.md";
const INSTALLATION_NAME = "my-mate.installation.json";
const SKILL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const SCOPE_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const MAX_PACKAGE_FILES = 128;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 256 * 1024;
const CONTROL_TOOLS = ["skill_search", "skill_load", "skill_resource_read"] as const;
const SENSITIVE_SEGMENTS = new Set([".git", ".ssh", ".aws", ".azure", ".gnupg", "node_modules", "credentials", "secrets"]);
const SENSITIVE_NAMES = /^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|p12|pfx|key|keystore))$/iu;

interface SkillHostState {
  schema_version: 1;
  workspaces: Record<string, { enabled: string[]; disabled: string[] }>;
}

interface DiscoveredSkillPackage {
  manifest: SkillPackageManifest;
  source: SkillPackageSource;
  workspaceId: string | null;
  rootPath: string;
  manifestPath: string;
  instructions: string;
  instructionsDigest: string;
  error: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function safeResourcePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized)) throw new Error("Skill resources must use relative paths.");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || SENSITIVE_SEGMENTS.has(segment.toLowerCase()) || SENSITIVE_NAMES.test(segment))) {
    throw new Error(`Unsafe Skill resource path: ${value}`);
  }
  return segments.join("/");
}

function parseScripts(value: unknown, manifestPath: string): SkillScriptDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${manifestPath} scripts must be an array.`);
  const ids = new Set<string>();
  return value.map((raw) => {
    if (!isPlainObject(raw)) throw new Error(`${manifestPath} contains an invalid script declaration.`);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const runtime = raw.runtime;
    const entrypoint = safeResourcePath(String(raw.entrypoint || ""));
    if (!SKILL_ID_PATTERN.test(id) || ids.has(id)) throw new Error(`${manifestPath} contains an invalid or duplicate script id.`);
    if (!["node", "python", "shell"].includes(String(runtime))) throw new Error(`${manifestPath} contains an unsupported script runtime.`);
    ids.add(id);
    return {
      id,
      runtime: runtime as SkillScriptDeclaration["runtime"],
      entrypoint,
      input_schema: isPlainObject(raw.input_schema) ? raw.input_schema : {},
      timeout_seconds: Math.min(900, Math.max(1, Number(raw.timeout_seconds || 120))),
      network: raw.network === "public" ? "public" : "none",
      workspace_access: raw.workspace_access === "write" ? "write" : "read",
      digest: typeof raw.digest === "string" && /^[a-f0-9]{64}$/u.test(raw.digest) ? raw.digest : null,
    };
  });
}

function parseManifest(value: unknown, manifestPath: string): SkillPackageManifest {
  if (!isPlainObject(value) || value.schema_version !== 1) throw new Error(`${manifestPath} must declare schema_version 1.`);
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const version = typeof value.version === "string" ? value.version.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const category = typeof value.category === "string" ? value.category.trim() : "general";
  const riskLevel = typeof value.risk_level === "string" ? value.risk_level : "T1";
  if (!SKILL_ID_PATTERN.test(id)) throw new Error(`${manifestPath} has an invalid Skill id.`);
  if (!name || !description || !category) throw new Error(`${manifestPath} requires name, description, and category.`);
  if (!VERSION_PATTERN.test(version)) throw new Error(`${manifestPath} requires a semantic version.`);
  if (!["T0", "T1", "T2", "T3"].includes(riskLevel)) throw new Error(`${manifestPath} has an invalid risk level.`);
  const allowedTools = uniqueStrings(value.allowed_tools, "allowed_tools");
  const requiredCapabilities = uniqueStrings(value.required_capabilities, "required_capabilities");
  const permissionScopes = uniqueStrings(value.permission_scopes, "permission_scopes");
  const activationKeywords = uniqueStrings(value.activation_keywords, "activation_keywords");
  const negativeKeywords = uniqueStrings(value.negative_keywords, "negative_keywords");
  const platforms = uniqueStrings(value.platforms, "platforms");
  const resources = uniqueStrings(value.resources, "resources").map(safeResourcePath);
  const scripts = parseScripts(value.scripts, manifestPath);
  const activationPolicy = ["explicit_only", "advisory", "auto"].includes(String(value.activation_policy))
    ? value.activation_policy as SkillPackageManifest["activation_policy"]
    : "advisory";
  for (const identifier of [...allowedTools, ...requiredCapabilities]) {
    if (!SKILL_ID_PATTERN.test(identifier)) throw new Error(`${manifestPath} contains an invalid capability id: ${identifier}`);
  }
  for (const scope of permissionScopes) {
    if (!SCOPE_PATTERN.test(scope)) throw new Error(`${manifestPath} contains an invalid permission scope: ${scope}`);
  }
  return {
    schema_version: 1,
    id,
    name,
    version,
    description,
    category,
    risk_level: riskLevel as SkillPackageManifest["risk_level"],
    allowed_tools: allowedTools,
    required_capabilities: requiredCapabilities,
    permission_scopes: permissionScopes,
    activation_keywords: activationKeywords,
    negative_keywords: negativeKeywords,
    activation_policy: activationPolicy,
    platforms,
    resources,
    scripts,
    input_schema: isPlainObject(value.input_schema) ? value.input_schema : {},
    output_contract: isPlainObject(value.output_contract) ? value.output_contract : {},
    enabled_by_default: value.enabled_by_default === true,
    publisher: typeof value.publisher === "string" ? value.publisher.trim() || null : null,
    license: typeof value.license === "string" ? value.license.trim() || null : null,
    trust_level: ["bundled", "official", "workspace", "community", "unverified"].includes(String(value.trust_level))
      ? value.trust_level as SkillPackageManifest["trust_level"]
      : "unverified",
    metadata: isPlainObject(value.metadata) ? value.metadata : {},
  };
}

function readPackage(rootPath: string, source: SkillPackageSource, workspaceId: string | null): DiscoveredSkillPackage {
  const rootStat = fs.lstatSync(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`${rootPath} must be a real directory.`);
  const realRoot = fs.realpathSync(rootPath);
  const manifestPath = path.join(realRoot, MANIFEST_NAME);
  const instructionsPath = path.join(realRoot, INSTRUCTIONS_NAME);
  if (!fs.existsSync(manifestPath) || !fs.existsSync(instructionsPath)) {
    throw new Error(`${rootPath} requires ${MANIFEST_NAME} and ${INSTRUCTIONS_NAME}.`);
  }
  const manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf-8")), manifestPath);
  const instructionStat = fs.lstatSync(instructionsPath);
  if (!instructionStat.isFile() || instructionStat.isSymbolicLink() || instructionStat.size > MAX_RESOURCE_BYTES) {
    throw new Error(`${instructionsPath} must be a bounded regular file.`);
  }
  const instructions = fs.readFileSync(instructionsPath, "utf-8").trim();
  if (!instructions) throw new Error(`${instructionsPath} cannot be empty.`);
  for (const resource of manifest.resources) {
    const resolved = path.resolve(realRoot, resource);
    if (!resolved.startsWith(`${realRoot}${path.sep}`)) throw new Error(`Skill resource escapes its package: ${resource}`);
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RESOURCE_BYTES) {
      throw new Error(`Skill resource must be a bounded regular file: ${resource}`);
    }
  }
  for (const script of manifest.scripts) {
    const resolved = path.resolve(realRoot, script.entrypoint);
    if (!resolved.startsWith(`${realRoot}${path.sep}`)) throw new Error(`Skill script escapes its package: ${script.entrypoint}`);
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RESOURCE_BYTES) throw new Error(`Skill script must be a bounded regular file: ${script.entrypoint}`);
    if (script.digest && createHash("sha256").update(fs.readFileSync(resolved)).digest("hex") !== script.digest) throw new Error(`Skill script digest mismatch: ${script.entrypoint}`);
  }
  return {
    manifest,
    source,
    workspaceId,
    rootPath: realRoot,
    manifestPath,
    instructions,
    instructionsDigest: createHash("sha256").update(instructions).digest("hex"),
    error: null,
  };
}

function statePath(): string {
  return path.join(DATA_DIR, "skill-host", "state.json");
}

function readState(): SkillHostState {
  try {
    const value = JSON.parse(fs.readFileSync(statePath(), "utf-8")) as unknown;
    if (!isPlainObject(value) || value.schema_version !== 1 || !isPlainObject(value.workspaces)) throw new Error();
    return { schema_version: 1, workspaces: value.workspaces as SkillHostState["workspaces"] };
  } catch {
    return { schema_version: 1, workspaces: {} };
  }
}

function writeState(state: SkillHostState): void {
  const target = statePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  renameWithRetry(temporary, target);
}

function invocationPath(record: Pick<SkillInvocationRecord, "workspace_id" | "session_id" | "invocation_id">): string {
  return path.join(SKILL_INVOCATIONS_DIR, encodeURIComponent(record.workspace_id), encodeURIComponent(record.session_id), `${record.invocation_id}.json`);
}

function workspaceState(state: SkillHostState, workspaceId: string) {
  return state.workspaces[workspaceId] || { enabled: [], disabled: [] };
}

function scanDirectories(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) return [];
  return fs.readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith("."))
    .map((entry) => path.join(rootPath, entry.name));
}

function packageKey(workspaceId: string | null, skillId: string): string {
  return `${workspaceId || "*"}:${skillId}`;
}

function versionRoot(workspaceId: string, skillId: string): string {
  return path.join(DATA_DIR, "skill-platform", "versions", encodeURIComponent(workspaceId), encodeURIComponent(skillId));
}

function copyPackageSource(sourceRoot: string, targetRoot: string): void {
  const files: Array<{ source: string; relative: string; size: number }> = [];
  const visit = (current: string, relativeRoot: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Skill packages cannot contain symbolic links.");
      if (SENSITIVE_SEGMENTS.has(entry.name.toLowerCase()) || SENSITIVE_NAMES.test(entry.name)) {
        throw new Error(`Skill packages cannot contain sensitive paths: ${entry.name}`);
      }
      const source = path.join(current, entry.name);
      const relative = relativeRoot ? path.join(relativeRoot, entry.name) : entry.name;
      if (entry.isDirectory()) visit(source, relative);
      else if (entry.isFile()) files.push({ source, relative, size: fs.statSync(source).size });
      else throw new Error(`Unsupported Skill package entry: ${relative}`);
    }
  };
  visit(sourceRoot, "");
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length > MAX_PACKAGE_FILES || total > MAX_PACKAGE_BYTES || files.some((file) => file.size > MAX_RESOURCE_BYTES)) {
    throw new Error("Skill package exceeds the file or size limit.");
  }
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of files) {
    const destination = path.join(targetRoot, file.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file.source, destination);
  }
}

function installedPackageSource(directory: string): "installed" | "marketplace" {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, INSTALLATION_NAME), "utf-8")) as Record<string, unknown>;
    return value.source === "marketplace" ? "marketplace" : "installed";
  } catch {
    return "installed";
  }
}

export class SkillHost {
  private readonly packages = new Map<string, DiscoveredSkillPackage>();
  private readonly errors: SkillPackageStatus[] = [];
  private discovered = false;

  discover(): SkillPackageStatus[] {
    this.packages.clear();
    this.errors.length = 0;
    const add = (directory: string, source: SkillPackageSource, workspaceId: string | null) => {
      try {
        const item = readPackage(directory, source, workspaceId);
        const key = packageKey(workspaceId, item.manifest.id);
        if (this.packages.has(key)) throw new Error(`Duplicate Skill package ${item.manifest.id}.`);
        this.packages.set(key, item);
      } catch (error) {
        this.errors.push({
          skill_id: path.basename(directory), workspace_id: workspaceId, name: path.basename(directory), version: "0.0.0",
          description: "Skill package discovery failed.", category: "invalid", risk_level: "T1", allowed_tools: [],
          required_capabilities: [], permission_scopes: [], activation_keywords: [], negative_keywords: [],
          activation_policy: "advisory", platforms: [], resources: [], scripts: [],
          input_schema: {}, output_contract: {}, source,
          enabled: false, status: "error", error: error instanceof Error ? error.message : "Skill discovery failed.",
          compatibility: "blocked", missing_requirements: [], instructions_digest: "", root_path: directory,
          manifest_path: path.join(directory, MANIFEST_NAME), metadata: {}, publisher: null, license: null, trust_level: "unverified",
        });
      }
    };
    for (const directory of scanDirectories(path.join(REPO_ROOT, "skills"))) add(directory, "bundled", null);
    for (const workspaceRoot of scanDirectories(SKILL_PACKAGES_DIR)) {
      const workspaceId = decodeURIComponent(path.basename(workspaceRoot));
      for (const directory of scanDirectories(workspaceRoot)) add(directory, installedPackageSource(directory), workspaceId);
    }
    for (const customRoot of (process.env.MY_MATE_SKILL_DIRS || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean)) {
      for (const directory of scanDirectories(path.resolve(customRoot))) add(directory, "custom", null);
    }
    this.discovered = true;
    return this.listPackages("default");
  }

  ensureDiscovered(): void {
    if (!this.discovered) this.discover();
  }

  private resolvedPackages(workspaceId: string): DiscoveredSkillPackage[] {
    this.ensureDiscovered();
    const byId = new Map<string, DiscoveredSkillPackage>();
    for (const item of this.packages.values()) if (item.workspaceId === null) byId.set(item.manifest.id, item);
    for (const item of this.packages.values()) if (item.workspaceId === workspaceId) byId.set(item.manifest.id, item);
    return [...byId.values()];
  }

  private status(item: DiscoveredSkillPackage, workspaceId: string): SkillPackageStatus {
    const state = workspaceState(readState(), workspaceId);
    const explicitlyEnabled = state.enabled.includes(item.manifest.id);
    const explicitlyDisabled = state.disabled.includes(item.manifest.id);
    const enabled = !explicitlyDisabled && (explicitlyEnabled || item.source === "installed" || item.source === "bundled" && item.manifest.enabled_by_default);
    const capabilities = new Set(getCapabilityRegistry().listCapabilities(workspaceId).map((capability) => capability.capability_id));
    const missing = item.manifest.required_capabilities.filter((capabilityId) => !capabilities.has(capabilityId));
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
    const platformBlocked = item.manifest.platforms.length > 0 && !item.manifest.platforms.includes(platform);
    const missingRequirements = [...missing, ...(platformBlocked ? [`platform:${platform}`] : [])];
    return {
      skill_id: item.manifest.id,
      workspace_id: item.workspaceId,
      name: item.manifest.name,
      version: item.manifest.version,
      description: item.manifest.description,
      category: item.manifest.category,
      risk_level: item.manifest.risk_level,
      allowed_tools: [...item.manifest.allowed_tools],
      required_capabilities: [...item.manifest.required_capabilities],
      permission_scopes: [...item.manifest.permission_scopes],
      activation_keywords: [...item.manifest.activation_keywords],
      negative_keywords: [...item.manifest.negative_keywords],
      activation_policy: item.manifest.activation_policy,
      platforms: [...item.manifest.platforms],
      resources: [...item.manifest.resources],
      scripts: structuredClone(item.manifest.scripts),
      input_schema: structuredClone(item.manifest.input_schema),
      output_contract: structuredClone(item.manifest.output_contract),
      source: item.source,
      enabled,
      status: !enabled ? "disabled" : missingRequirements.length ? "incompatible" : "ready",
      compatibility: missingRequirements.length ? "blocked" : "ready",
      missing_requirements: missingRequirements,
      error: missingRequirements.length ? `Missing requirements: ${missingRequirements.join(", ")}` : item.error,
      instructions_digest: item.instructionsDigest,
      root_path: item.rootPath,
      manifest_path: item.manifestPath,
      metadata: { ...item.manifest.metadata },
      publisher: item.manifest.publisher,
      license: item.manifest.license,
      trust_level: item.source === "bundled" ? "bundled" : item.manifest.trust_level,
    };
  }

  listPackages(workspaceId: string): SkillPackageStatus[] {
    return [
      ...this.resolvedPackages(workspaceId).map((item) => this.status(item, workspaceId)),
      ...this.errors.filter((item) => item.workspace_id === null || item.workspace_id === workspaceId),
    ].sort((left, right) => left.skill_id.localeCompare(right.skill_id));
  }

  getPackage(workspaceId: string, skillId: string): { status: SkillPackageStatus; instructions: string } | null {
    const item = this.resolvedPackages(workspaceId).find((candidate) => candidate.manifest.id === skillId);
    return item ? { status: this.status(item, workspaceId), instructions: item.instructions } : null;
  }

  search(workspaceId: string, query: string, limit = 5): SkillPackageStatus[] {
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
    return this.listPackages(workspaceId)
      .filter((item) => item.status === "ready")
      .map((item) => {
        const haystack = [item.skill_id, item.name, item.description, item.category, ...item.activation_keywords].join(" ").toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.skill_id.localeCompare(right.item.skill_id))
      .slice(0, Math.min(12, Math.max(1, limit)))
      .map((entry) => entry.item);
  }

  recommend(workspaceId: string, text: string): { status: SkillPackageStatus; source: "explicit" | "intent" } | null {
    const normalized = text.trim().toLowerCase();
    if (!normalized || /(?:what|which|list|available).{0,20}skills?|skills?.{0,20}(?:available|list)|(?:有什么|有哪些|列出|可用).{0,8}skill/iu.test(normalized)) return null;
    const profile = getSkillWorkspaceProfile(workspaceId);
    const ready = this.listPackages(workspaceId).filter((item) =>
      item.status === "ready" &&
      profile.trusted_sources.includes(item.trust_level) &&
      (!profile.enabled_categories.length || profile.enabled_categories.includes(item.category)));
    const explicit = ready.find((item) =>
      normalized.includes(item.skill_id.toLowerCase()) &&
      /(?:use|using|with|activate|load|使用|启用|调用|用)/iu.test(normalized));
    if (explicit) return { status: explicit, source: "explicit" };
    if (!profile.auto_activation) return null;
    const ranked = ready
      .filter((item) => item.activation_policy === "auto")
      .map((item) => {
        const negative = item.negative_keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
        const matches = item.activation_keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
        const specificity = matches.reduce((score, keyword) => score + Math.min(24, [...keyword].length), 0);
        return { item, score: negative ? -1 : specificity };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.skill_id.localeCompare(right.item.skill_id));
    return ranked[0] ? { status: ranked[0].item, source: "intent" } : null;
  }

  load(input: { workspaceId: string; session: SessionRecord; skillId: string; actionId: string | null; activationSource?: SkillInvocationRecord["activation_source"] }) {
    const resolved = this.getPackage(input.workspaceId, input.skillId);
    if (!resolved) throw new Error("SKILL_PACKAGE_NOT_FOUND");
    if (resolved.status.status !== "ready") throw new Error(resolved.status.error || "SKILL_PACKAGE_NOT_READY");
    const existing = this.listInvocations(input.workspaceId, input.session.session_id)
      .find((item) => item.status === "loaded" && item.skill_id === input.skillId);
    if (existing) return { status: resolved.status, instructions: resolved.instructions, invocation: existing };
    const timestamp = nowIso();
    const invocation: SkillInvocationRecord = {
      schema_version: 1,
      invocation_id: `skillinv_${randomUUID()}`,
      workspace_id: input.workspaceId,
      session_id: input.session.session_id,
      skill_id: resolved.status.skill_id,
      skill_version: resolved.status.version,
      instructions_digest: resolved.status.instructions_digest,
      action_id: input.actionId,
      activation_source: input.activationSource || "model",
      status: "loaded",
      allowed_tools: [...resolved.status.allowed_tools],
      required_capabilities: [...resolved.status.required_capabilities],
      tool_action_ids: [],
      error_code: null,
      verification_status: Object.keys(resolved.status.output_contract).length ? "pending" : "not_applicable",
      output_contract: structuredClone(resolved.status.output_contract),
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
    };
    getJsonStorageBackend().writeJson(invocationPath(invocation), invocation);
    return { status: resolved.status, instructions: resolved.instructions, invocation };
  }

  readResource(workspaceId: string, skillId: string, resource: string, sessionId?: string): { content: string; digest: string } {
    const normalized = safeResourcePath(resource);
    const resolved = this.getPackage(workspaceId, skillId);
    if (!resolved) throw new Error("SKILL_PACKAGE_NOT_FOUND");
    if (resolved.status.status !== "ready") throw new Error("SKILL_PACKAGE_NOT_READY");
    if (sessionId) {
      const active = this.listInvocations(workspaceId, sessionId).find((item) => item.status === "loaded");
      if (!active || active.skill_id !== skillId) throw new Error("SKILL_NOT_ACTIVE_FOR_SESSION");
    }
    if (!resolved.status.resources.includes(normalized)) throw new Error("SKILL_RESOURCE_NOT_DECLARED");
    const root = fs.realpathSync(resolved.status.root_path);
    const target = path.resolve(root, normalized);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("SKILL_RESOURCE_PATH_INVALID");
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RESOURCE_BYTES) throw new Error("SKILL_RESOURCE_UNAVAILABLE");
    const content = fs.readFileSync(target, "utf-8");
    return { content, digest: createHash("sha256").update(content).digest("hex") };
  }

  resolveActiveScript(workspaceId: string, sessionId: string, skillId: string, scriptId: string) {
    const resolved = this.getPackage(workspaceId, skillId);
    if (!resolved || resolved.status.status !== "ready") throw new Error("SKILL_PACKAGE_NOT_READY");
    const active = this.listInvocations(workspaceId, sessionId).find((item) => item.status === "loaded");
    if (!active || active.skill_id !== skillId) throw new Error("SKILL_NOT_ACTIVE_FOR_SESSION");
    const script = resolved.status.scripts.find((item) => item.id === scriptId);
    if (!script) throw new Error("SKILL_SCRIPT_NOT_DECLARED");
    return { script, packageRoot: resolved.status.root_path, status: resolved.status };
  }

  setEnabled(workspaceId: string, skillId: string, enabled: boolean): SkillPackageStatus {
    if (!this.getPackage(workspaceId, skillId)) throw new Error("SKILL_PACKAGE_NOT_FOUND");
    const state = readState();
    const current = workspaceState(state, workspaceId);
    const next = {
      enabled: [...new Set(current.enabled.filter((id) => id !== skillId).concat(enabled ? [skillId] : []))],
      disabled: [...new Set(current.disabled.filter((id) => id !== skillId).concat(enabled ? [] : [skillId]))],
    };
    state.workspaces[workspaceId] = next;
    writeState(state);
    return this.getPackage(workspaceId, skillId)!.status;
  }

  installPermissionDelta(workspaceId: string, sourcePath: string) {
    const sourceRoot = fs.realpathSync(path.resolve(sourcePath));
    const source = readPackage(sourceRoot, "installed", workspaceId);
    const current = this.getPackage(workspaceId, source.manifest.id)?.status || null;
    const added = (next: string[], previous: string[]) => next.filter((item) => !previous.includes(item)).sort();
    const currentScripts = (current?.scripts || []).map((item) => `${item.id}:${item.runtime}:${item.workspace_access}:${item.network}`);
    const nextScripts = source.manifest.scripts.map((item) => `${item.id}:${item.runtime}:${item.workspace_access}:${item.network}`);
    const delta = {
      skill_id: source.manifest.id,
      from_version: current?.version || null,
      to_version: source.manifest.version,
      added_tools: added(source.manifest.allowed_tools, current?.allowed_tools || []),
      added_capabilities: added(source.manifest.required_capabilities, current?.required_capabilities || []),
      added_permission_scopes: added(source.manifest.permission_scopes, current?.permission_scopes || []),
      added_scripts: added(nextScripts, currentScripts),
      requires_review: false,
    };
    delta.requires_review = current !== null && [
      ...delta.added_tools,
      ...delta.added_capabilities,
      ...delta.added_permission_scopes,
      ...delta.added_scripts,
    ].length > 0;
    return delta;
  }

  install(
    workspaceId: string,
    sourcePath: string,
    options: { source?: "installed" | "marketplace"; sourceId?: string | null } = {},
  ): SkillPackageStatus {
    const sourceRoot = fs.realpathSync(path.resolve(sourcePath));
    const source = readPackage(sourceRoot, "installed", workspaceId);
    const workspaceRoot = path.resolve(SKILL_PACKAGES_DIR, encodeURIComponent(workspaceId));
    const target = path.resolve(workspaceRoot, source.manifest.id);
    if (!target.startsWith(`${workspaceRoot}${path.sep}`) || sourceRoot === target || sourceRoot.startsWith(`${target}${path.sep}`)) {
      throw new Error("SKILL_INSTALL_PATH_INVALID");
    }
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const staging = path.join(workspaceRoot, `.install-${source.manifest.id}-${randomUUID()}`);
    const backup = path.join(workspaceRoot, `.backup-${source.manifest.id}-${randomUUID()}`);
    try {
      copyPackageSource(sourceRoot, staging);
      readPackage(staging, "installed", workspaceId);
      if (fs.existsSync(target)) {
        const previous = readPackage(target, "installed", workspaceId);
        const snapshot = path.join(versionRoot(workspaceId, previous.manifest.id), `${previous.manifest.version}-${previous.instructionsDigest.slice(0, 12)}`);
        if (!fs.existsSync(snapshot)) copyPackageSource(target, snapshot);
        renameWithRetry(target, backup);
      }
      renameWithRetry(staging, target);
      getJsonStorageBackend().writeJson(path.join(target, INSTALLATION_NAME), {
        schema_version: 1,
        source: options.source === "marketplace" ? "marketplace" : "installed",
        source_id: options.sourceId || null,
        installed_at: nowIso(),
      });
      if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      if (fs.existsSync(backup) && !fs.existsSync(target)) renameWithRetry(backup, target);
      throw error;
    }
    const state = readState();
    const current = workspaceState(state, workspaceId);
    state.workspaces[workspaceId] = {
      enabled: [...new Set([...current.enabled.filter((id) => id !== source.manifest.id), source.manifest.id])],
      disabled: current.disabled.filter((id) => id !== source.manifest.id),
    };
    writeState(state);
    this.discover();
    return this.getPackage(workspaceId, source.manifest.id)!.status;
  }

  listVersions(workspaceId: string, skillId: string): Array<{ version: string; digest: string; path: string }> {
    return scanDirectories(versionRoot(workspaceId, skillId)).flatMap((directory) => {
      try {
        const item = readPackage(directory, "installed", workspaceId);
        return [{ version: item.manifest.version, digest: item.instructionsDigest, path: directory }];
      } catch { return []; }
    }).sort((left, right) => right.version.localeCompare(left.version));
  }

  rollback(workspaceId: string, skillId: string, version: string): SkillPackageStatus {
    const candidate = this.listVersions(workspaceId, skillId).find((item) => item.version === version);
    if (!candidate) throw new Error("SKILL_VERSION_NOT_FOUND");
    const currentSource = this.getPackage(workspaceId, skillId)?.status.source;
    return this.install(workspaceId, candidate.path, {
      source: currentSource === "marketplace" ? "marketplace" : "installed",
    });
  }

  listInvocations(workspaceId: string, sessionId?: string): SkillInvocationRecord[] {
    const workspaceRoot = path.join(SKILL_INVOCATIONS_DIR, encodeURIComponent(workspaceId));
    const sessionRoots = sessionId ? [path.join(workspaceRoot, encodeURIComponent(sessionId))] : scanDirectories(workspaceRoot);
    return sessionRoots.flatMap((root) => getJsonStorageBackend().listJsonFiles(root)
      .map((file) => getJsonStorageBackend().readJson<SkillInvocationRecord>(file)))
      .filter((item) => item.workspace_id === workspaceId && (!sessionId || item.session_id === sessionId))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  completeInvocations(session: SessionRecord, actionIds: string[], invocationIds: string[] = []): void {
    const workspaceId = session.workspace_id || "default";
    const actionSet = new Set(actionIds);
    const invocationSet = new Set(invocationIds);
    const timestamp = nowIso();
    for (const invocation of this.listInvocations(workspaceId, session.session_id)) {
      if (invocation.status !== "loaded") continue;
      if (invocation.action_id ? !actionSet.has(invocation.action_id) : !invocationSet.has(invocation.invocation_id)) continue;
      const completed = {
        ...invocation,
        status: "completed",
        verification_status: invocation.verification_status,
        tool_action_ids: [...actionIds],
        updated_at: timestamp,
        completed_at: timestamp,
      } satisfies SkillInvocationRecord;
      getJsonStorageBackend().writeJson(invocationPath(invocation), completed);
      recordSkillEvaluation({
        workspace_id: workspaceId,
        skill_id: invocation.skill_id,
        skill_version: invocation.skill_version,
        invocation_id: invocation.invocation_id,
        verdict: completed.verification_status === "failed" ? "failed" : completed.verification_status === "passed" || completed.verification_status === "not_applicable" ? "passed" : "partial",
        output_contract_passed: completed.verification_status === "passed" || completed.verification_status === "not_applicable",
        tool_policy_passed: true,
        latency_ms: Math.max(0, Date.parse(timestamp) - Date.parse(invocation.created_at)),
        tool_rounds: actionIds.length,
        error_code: null,
      });
    }
  }

  verifyInvocations(
    session: SessionRecord,
    invocationIds: string[],
    verificationStatus: "passed" | "failed",
    errorCode: string | null = null,
  ): void {
    const workspaceId = session.workspace_id || "default";
    const invocationSet = new Set(invocationIds);
    const timestamp = nowIso();
    for (const invocation of this.listInvocations(workspaceId, session.session_id)) {
      if (!invocationSet.has(invocation.invocation_id)) continue;
      const verified = {
        ...invocation,
        status: verificationStatus === "passed" ? "completed" : "failed",
        verification_status: verificationStatus,
        error_code: verificationStatus === "failed" ? errorCode || "skill_output_verification_failed" : null,
        updated_at: timestamp,
        completed_at: invocation.completed_at || timestamp,
      } satisfies SkillInvocationRecord;
      getJsonStorageBackend().writeJson(invocationPath(invocation), verified);
      recordSkillEvaluation({
        workspace_id: workspaceId,
        skill_id: verified.skill_id,
        skill_version: verified.skill_version,
        invocation_id: verified.invocation_id,
        verdict: verificationStatus === "passed" ? "passed" : "failed",
        output_contract_passed: verificationStatus === "passed",
        tool_policy_passed: true,
        latency_ms: Math.max(0, Date.parse(timestamp) - Date.parse(verified.created_at)),
        tool_rounds: verified.tool_action_ids.length,
        error_code: verified.error_code,
      });
    }
  }

  failInvocations(session: SessionRecord, errorCode: string): void {
    const workspaceId = session.workspace_id || "default";
    const timestamp = nowIso();
    for (const invocation of this.listInvocations(workspaceId, session.session_id)) {
      if (invocation.status !== "loaded") continue;
      const failed = {
        ...invocation,
        status: "failed",
        verification_status: "failed",
        error_code: errorCode,
        updated_at: timestamp,
        completed_at: timestamp,
      } satisfies SkillInvocationRecord;
      getJsonStorageBackend().writeJson(invocationPath(invocation), failed);
      recordSkillEvaluation({
        workspace_id: workspaceId,
        skill_id: failed.skill_id,
        skill_version: failed.skill_version,
        invocation_id: failed.invocation_id,
        verdict: "failed",
        output_contract_passed: false,
        tool_policy_passed: false,
        latency_ms: Math.max(0, Date.parse(timestamp) - Date.parse(failed.created_at)),
        tool_rounds: failed.tool_action_ids.length,
        error_code: errorCode,
      });
    }
  }
}

const skillHost = new SkillHost();

export function getSkillHost(): SkillHost {
  return skillHost;
}

export function skillControlToolNames(): string[] {
  return [...CONTROL_TOOLS];
}

export function renderSkillCatalog(workspaceId: string): string | null {
  const items = skillHost.listPackages(workspaceId).filter((item) => item.status === "ready");
  if (!items.length) return null;
  const categories = new Map<string, string[]>();
  for (const item of items) categories.set(item.category, [...(categories.get(item.category) || []), item.skill_id]);
  return [
    `Enabled Skill catalog (${items.length} available; metadata only; call skill_load before following one):`,
    ...[...categories.entries()].map(([category, ids]) => `- ${category}: ${ids.map((id) => {
      const item = items.find((candidate) => candidate.skill_id === id)!;
      return `${id} v${item.version}`;
    }).join(", ")}`),
    "Highlighted Skill descriptions:",
    ...items.slice(0, 12).map((item) => `- ${item.skill_id} v${item.version}: ${item.description}`),
  ].join("\n");
}
