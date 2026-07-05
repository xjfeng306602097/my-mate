import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  OPENCLAW_CONTAINER_CLI,
  OPENCLAW_CONTAINER_AUTH_PROBE,
  OPENCLAW_CONTAINER_EXECUTION_STRATEGY,
  OPENCLAW_CONTAINER_NAME,
  OPENCLAW_CONTAINER_PYTHON,
  OPENCLAW_CONTAINER_RUNTIME_ROOT,
  OPENCLAW_DIRECT_AGENT_MODEL,
  OPENCLAW_DIRECT_AGENT_THINKING,
  OPENCLAW_DIRECT_AGENT_TIMEOUT_SECONDS,
  OPENCLAW_DOCKER_BIN,
  OPENCLAW_STAGING_DIR,
} from "./config.js";
import {
  materializeRequirementBundle,
  parseRegisterTaskOutput,
  resolveStageFromAgent,
  writeOpenClawHandoff,
} from "./openclaw-materialization.js";
import type { ArtifactRecord, DirectAgentReference, DispatchRecord } from "./types.js";
import { ensureDir, normalizeSummaryText, nowIso } from "./utils.js";

export interface OpenClawPreparationResult {
  handoffFile: string;
  statePath: string;
  requirementDir: string;
  dispatchFile: string | null;
  shortTask: string | null;
  taskId: string | null;
  taskRegisterStdout: string;
  taskRegisterStderr: string;
  directAgent?: DirectAgentReference;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface ContainerProjectContext {
  projectSlugFallback: string | null;
  projectRepoFallback: string | null;
  requirementsRoot: string;
  scriptsRoot: string;
  registryPath: string;
}

interface ParsedAgentReport {
  raw: string;
  status: "completed" | "failed" | "waiting_human";
  stageStatus: string | null;
  summary: string | null;
  filesChanged: string[];
}

export interface ContainerTaskSnapshot {
  taskId: string | null;
  runId: string | null;
  requesterSessionKey: string | null;
  childSessionKey: string | null;
  agentId: string | null;
  status: string | null;
  terminalSummary: string | null;
  error: string | null;
}

interface AgentRoutingModel {
  primary: string | null;
  fallbacks: string[];
}

export interface TrajectoryExportSnapshot {
  outputDir: string;
  displayPath: string | null;
  metadata: Record<string, unknown> | null;
  finalAssistantText: string | null;
  reportText: string | null;
  promptError: string | null;
}

interface TaskListJson {
  tasks?: unknown[];
}

export class OpenClawContainerAuthError extends Error {
  code:
    | "OPENCLAW_CONTAINER_AWS_AUTH_EXPIRED"
    | "OPENCLAW_CONTAINER_AWS_AUTH_FAILED"
    | "OPENCLAW_CONTAINER_BEDROCK_AUTH_MISSING";
  details: string | null;

  constructor(
    code:
      | "OPENCLAW_CONTAINER_AWS_AUTH_EXPIRED"
      | "OPENCLAW_CONTAINER_AWS_AUTH_FAILED"
      | "OPENCLAW_CONTAINER_BEDROCK_AUTH_MISSING",
    message: string,
    details: string | null,
  ) {
    super(message);
    this.name = "OpenClawContainerAuthError";
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runDocker(args: string[]): Promise<CommandResult> {
  return runCommand(OPENCLAW_DOCKER_BIN, args);
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function parseAgentJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // fall through to loose parsing
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function commandOutputText(result: CommandResult): string | null {
  const text = [result.stderr, result.stdout]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || null;
}

export function isExpiredAwsAuthMessage(text: string | null): boolean {
  if (!text) {
    return false;
  }
  const normalized = text.toLowerCase();
  return (
    normalized.includes("token has expired") ||
    normalized.includes("token is expired") ||
    normalized.includes("expiredtoken") ||
    normalized.includes("refresh failed") ||
    normalized.includes("aws sso login")
  );
}

export function classifyContainerAuthProbeFailure(
  detail: string | null,
): OpenClawContainerAuthError {
  if (isExpiredAwsAuthMessage(detail)) {
    return new OpenClawContainerAuthError(
      "OPENCLAW_CONTAINER_AWS_AUTH_EXPIRED",
      "OpenClaw container AWS credentials are expired. Refresh the configured AWS SSO session inside openclaw-local.",
      detail,
    );
  }

  return new OpenClawContainerAuthError(
    "OPENCLAW_CONTAINER_AWS_AUTH_FAILED",
    detail
      ? `OpenClaw container authentication probe failed: ${detail}`
      : "OpenClaw container authentication probe failed.",
    detail,
  );
}

export function hasMissingBedrockAuth(modelsStatusOutput: string | null): boolean {
  if (!modelsStatusOutput) {
    return false;
  }
  return /missing auth[\s\S]*amazon-bedrock/i.test(stripAnsi(modelsStatusOutput));
}

function normalizeModelId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseProviderFromModelId(modelId: string | null): string | null {
  if (!modelId) {
    return null;
  }
  const slash = modelId.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  return modelId.slice(0, slash).trim().toLowerCase() || null;
}

function readAgentRoutingModelFromJson(
  openclawJson: Record<string, unknown>,
  agentId: string,
): AgentRoutingModel {
  const agents = isRecord(openclawJson.agents) ? openclawJson.agents : null;
  const list = Array.isArray(agents?.list) ? agents.list : [];
  const defaults = isRecord(agents?.defaults) ? agents.defaults : null;
  const fallback = isRecord(defaults?.model) ? defaults.model : null;

  const agentEntry =
    list.find((item) => isRecord(item) && asString(item.id) === agentId) || null;
  const modelEntry =
    agentEntry && isRecord(agentEntry) && isRecord(agentEntry.model)
      ? agentEntry.model
      : fallback;

  const primary = normalizeModelId(asString(modelEntry?.primary));
  const fallbacks = Array.isArray(modelEntry?.fallbacks)
    ? modelEntry.fallbacks
        .map((item) => normalizeModelId(asString(item)))
        .filter((item): item is string => Boolean(item))
    : [];

  return { primary, fallbacks };
}

async function readContainerAgentRoutingModel(agentId: string): Promise<AgentRoutingModel> {
  const result = await runDocker([
    "exec",
    OPENCLAW_CONTAINER_NAME,
    "cat",
    path.posix.join(OPENCLAW_CONTAINER_RUNTIME_ROOT, "openclaw.json"),
  ]);
  if (result.code !== 0) {
    return { primary: null, fallbacks: [] };
  }

  const parsed = parseAgentJson(result.stdout);
  if (!parsed) {
    return { primary: null, fallbacks: [] };
  }

  return readAgentRoutingModelFromJson(parsed, agentId);
}

async function resolveDirectAgentModel(agentId: string): Promise<string | null> {
  const explicit = normalizeModelId(OPENCLAW_DIRECT_AGENT_MODEL);
  if (explicit) {
    return explicit;
  }

  const routing = await readContainerAgentRoutingModel(agentId);
  return routing.primary;
}

export function extractAgentReport(text: string | null): string | null {
  if (!text) {
    return null;
  }
  const start = text.indexOf("[AGENT_REPORT]");
  if (start < 0) {
    return null;
  }
  return text.slice(start).trim();
}

export function extractReportFromTrajectoryEvents(eventsJsonl: string): string | null {
  const lines = eventsJsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const data = isRecord(parsed.data) ? parsed.data : null;
    const message = isRecord(data?.message) ? data.message : null;
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const item of content) {
      if (!isRecord(item) || typeof item.text !== "string") {
        continue;
      }
      const report = extractAgentReport(String(item.text));
      if (report) {
        return report;
      }
    }

    if (typeof parsed.finalAssistantRawText === "string") {
      const report = extractAgentReport(parsed.finalAssistantRawText);
      if (report) {
        return report;
      }
    }
  }

  return extractAgentReport(eventsJsonl);
}

function inferNodeStatusFromReport(reportText: string | null): "completed" | "failed" | "waiting_human" {
  if (!reportText) {
    return "completed";
  }
  const normalized = reportText.toLowerCase();
  if (normalized.includes("status: blocked")) {
    return "waiting_human";
  }
  if (normalized.includes("status: failed")) {
    return "failed";
  }
  return "completed";
}

function extractReportField(reportText: string, field: string): string | null {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "im");
  const match = reportText.match(pattern);
  return match?.[1]?.trim() || null;
}

function extractReportSummary(reportText: string): string | null {
  const match = reportText.match(/summary:\s*\|([\s\S]*)$/i);
  if (!match) {
    return normalizeSummaryText(extractReportField(reportText, "summary"));
  }

  const lines = match[1]
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("[/AGENT_REPORT]"));
  return normalizeSummaryText(lines.length > 0 ? lines.join("\n").trim() : null);
}

function extractFilesChanged(reportText: string): string[] {
  const match = reportText.match(/files_changed:\s*([\s\S]*?)(?:\n[a-z_]+:|\n\[\/AGENT_REPORT\]|$)/i);
  if (!match) {
    return [];
  }

  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function parseAgentReport(reportText: string | null): ParsedAgentReport | null {
  if (!reportText) {
    return null;
  }

  return {
    raw: reportText,
    status: inferNodeStatusFromReport(reportText),
    stageStatus: extractReportField(reportText, "stage_status"),
    summary:
      extractReportSummary(reportText) || normalizeSummaryText(extractReportField(reportText, "status")),
    filesChanged: extractFilesChanged(reportText),
  };
}

function buildDirectAgentArtifacts(input: {
  dispatchId: string;
  handoffFile: string;
  parsedReport: ParsedAgentReport | null;
}): ArtifactRecord[] {
  const items: ArtifactRecord[] = [
    {
      artifact_id: `artifact_${input.dispatchId}_handoff`,
      type: "report",
      name: `${input.dispatchId}-handoff.json`,
      storage_uri: `file://${input.handoffFile.replace(/\\/g, "/")}`,
      mime_type: "application/json",
      size_bytes: fs.existsSync(input.handoffFile) ? fs.statSync(input.handoffFile).size : 0,
    },
  ];

  if (input.parsedReport) {
    items.push({
      artifact_id: `artifact_${input.dispatchId}_agent-report`,
      type: "summary",
      name: `${input.dispatchId}-agent-report.txt`,
      storage_uri: `bridge://dispatches/${input.dispatchId}/agent-report`,
      mime_type: "text/plain",
      size_bytes: Buffer.byteLength(input.parsedReport.raw, "utf-8"),
    });
  }

  return items;
}

function buildDirectAgentMessage(input: {
  stage: string;
  requirementId: string;
  dispatchFile: string;
  token: string;
}): string {
  return [
    `[ARCHITECT_DISPATCH] requirement_id=${input.requirementId} stage=${input.stage}`,
    `Your first action: read(path="${input.dispatchFile}") — that file is the full task.`,
    `Echo DISPATCH_TOKEN in [AGENT_REPORT]. Expected token: ${input.token}`,
    "Bridge override: in this direct execution mode, output the final [AGENT_REPORT] in the current session instead of calling sessions_send(label=\"architect\", ...).",
  ].join("\n");
}

function parseDockerJsonResult(
  result: CommandResult,
  context: string,
): Record<string, unknown> {
  if (result.code !== 0) {
    throw new Error(`${context} failed (${result.code}): ${result.stderr || result.stdout}`);
  }

  const json = parseAgentJson(result.stdout);
  if (!json) {
    throw new Error(`${context} returned non-JSON output.`);
  }
  return json;
}

export function taskSnapshotFromJson(json: Record<string, unknown>): ContainerTaskSnapshot {
  return {
    taskId: asString(json.taskId),
    runId: asString(json.runId),
    requesterSessionKey: asString(json.requesterSessionKey),
    childSessionKey: asString(json.childSessionKey),
    agentId: asString(json.agentId),
    status: asString(json.status),
    terminalSummary: asString(json.terminalSummary),
    error: asString(json.error),
  };
}

async function ensureContainerAuthForDirectAgent(agentId: string): Promise<string | null> {
  if (OPENCLAW_CONTAINER_EXECUTION_STRATEGY !== "direct-agent") {
    return null;
  }
  if (OPENCLAW_CONTAINER_AUTH_PROBE === "off") {
    return null;
  }

  const directAgentModel = await resolveDirectAgentModel(agentId);
  const provider = parseProviderFromModelId(directAgentModel);
  const needsBedrockAuth = provider === "amazon-bedrock";

  if (OPENCLAW_CONTAINER_AUTH_PROBE !== "aws-sts" && needsBedrockAuth) {
    const modelsStatus = await runDocker([
      "exec",
      OPENCLAW_CONTAINER_NAME,
      "sh",
      "-lc",
      `${OPENCLAW_CONTAINER_CLI} --no-color models status`,
    ]);
    const modelsStatusText = commandOutputText(modelsStatus);
    if (hasMissingBedrockAuth(modelsStatusText)) {
      throw new OpenClawContainerAuthError(
        "OPENCLAW_CONTAINER_BEDROCK_AUTH_MISSING",
        "OpenClaw container Bedrock model auth is missing or not ready. Check model/provider auth inside openclaw-local.",
        modelsStatusText,
      );
    }
    if (modelsStatus.code !== 0) {
      throw classifyContainerAuthProbeFailure(modelsStatusText);
    }
  }

  if (!needsBedrockAuth) {
    return directAgentModel;
  }

  const probeScript = [
    'profile="${AWS_PROFILE:-${AWS_DEFAULT_PROFILE:-}}"',
    'if [ "${CLAUDE_CODE_USE_BEDROCK:-}" = "1" ] || [ -n "$profile" ]; then',
    "  aws sts get-caller-identity >/dev/null",
    "fi",
  ].join("\n");

  const result = await runDocker(["exec", OPENCLAW_CONTAINER_NAME, "sh", "-lc", probeScript]);
  if (result.code !== 0) {
    throw classifyContainerAuthProbeFailure(commandOutputText(result));
  }
  return directAgentModel;
}

async function readContainerProjectContext(record: DispatchRecord): Promise<ContainerProjectContext> {
  const runtimeRoot = OPENCLAW_CONTAINER_RUNTIME_ROOT.replace(/\/+$/g, "");
  const scriptsRoot = path.posix.join(runtimeRoot, "workspace-architect", "scripts");
  const registryPath = path.posix.join(runtimeRoot, "workspace-architect", "projects", "registry.json");
  const registryResult = await runDocker(["exec", OPENCLAW_CONTAINER_NAME, "cat", registryPath]);
  if (registryResult.code !== 0) {
    throw new Error(
      `Unable to read container registry (${registryResult.code}): ${registryResult.stderr || registryResult.stdout}`,
    );
  }

  let registryJson: Record<string, unknown>;
  try {
    registryJson = JSON.parse(registryResult.stdout) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Container registry is not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const projects = isRecord(registryJson.projects) ? registryJson.projects : {};
  const currentSlug =
    typeof registryJson.current === "string" && registryJson.current.trim()
      ? registryJson.current.trim()
      : null;
  const requestSlug =
    typeof record.request_snapshot.input_payload.project_slug === "string" &&
    record.request_snapshot.input_payload.project_slug.trim()
      ? record.request_snapshot.input_payload.project_slug.trim()
      : null;
  const envSlug =
    typeof process.env.MY_MATE_OPENCLAW_DEFAULT_PROJECT_SLUG === "string" &&
    process.env.MY_MATE_OPENCLAW_DEFAULT_PROJECT_SLUG.trim()
      ? process.env.MY_MATE_OPENCLAW_DEFAULT_PROJECT_SLUG.trim()
      : null;

  const selectedSlug =
    [requestSlug, envSlug, currentSlug].find((item) => item && isRecord(projects[item])) || null;
  const fallbackSlug = firstNonEmpty([requestSlug, envSlug, currentSlug, "my-mate"]);
  const projectSlugFallback = selectedSlug || fallbackSlug;
  const projectEntry =
    projectSlugFallback && isRecord(projects[projectSlugFallback])
      ? projects[projectSlugFallback]
      : null;
  const requirementsRoot =
    typeof projectEntry?.requirements_dir === "string" && projectEntry.requirements_dir.trim()
      ? projectEntry.requirements_dir.trim()
      : path.posix.join(
          runtimeRoot,
          "workspace-architect",
          "projects",
          projectSlugFallback || "my-mate",
          "requirements",
        );
  const projectRepoFallback =
    typeof projectEntry?.local_repo === "string" && projectEntry.local_repo.trim()
      ? projectEntry.local_repo.trim()
      : null;

  return {
    projectSlugFallback,
    projectRepoFallback,
    requirementsRoot,
    scriptsRoot,
    registryPath,
  };
}

async function ensureContainerRequirementsRoot(requirementsRoot: string): Promise<void> {
  const result = await runDocker(["exec", OPENCLAW_CONTAINER_NAME, "mkdir", "-p", requirementsRoot]);
  if (result.code !== 0) {
    throw new Error(
      `Unable to create container requirements root (${result.code}): ${result.stderr || result.stdout}`,
    );
  }
}

function buildContainerWriterScript(input: {
  requirementDir: string;
  statePath: string;
  yamlContent: string;
  techDesignContent: string;
}): string {
  return [
    "from pathlib import Path",
    "",
    `requirement_dir = Path(${JSON.stringify(input.requirementDir)})`,
    `state_path = Path(${JSON.stringify(input.statePath)})`,
    `yaml_content = ${JSON.stringify(input.yamlContent)}`,
    `tech_design_content = ${JSON.stringify(input.techDesignContent)}`,
    "",
    "requirement_dir.mkdir(parents=True, exist_ok=True)",
    "state_path.parent.mkdir(parents=True, exist_ok=True)",
    "state_path.write_text(yaml_content, encoding='utf-8')",
    "(requirement_dir / 'TECH_DESIGN.md').write_text(tech_design_content, encoding='utf-8')",
    "print('BRIDGE_CONTAINER_WRITE_OK')",
    "",
  ].join("\n");
}

async function writeBundleIntoContainer(input: {
  requirementDir: string;
  statePath: string;
  yamlContent: string;
  techDesignContent: string;
}): Promise<void> {
  const localScriptPath = path.join(
    OPENCLAW_STAGING_DIR,
    "scripts",
    `write-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`,
  );
  ensureDir(path.dirname(localScriptPath));
  fs.writeFileSync(
    localScriptPath,
    buildContainerWriterScript({
      requirementDir: input.requirementDir,
      statePath: input.statePath,
      yamlContent: input.yamlContent,
      techDesignContent: input.techDesignContent,
    }),
    "utf-8",
  );

  const containerScriptPath = `/tmp/${path.basename(localScriptPath).replace(/\\/g, "/")}`;
  try {
    const copyResult = await runDocker([
      "cp",
      localScriptPath,
      `${OPENCLAW_CONTAINER_NAME}:${containerScriptPath}`,
    ]);
    if (copyResult.code !== 0) {
      throw new Error(
        `docker cp failed for container writer script: ${copyResult.stderr || copyResult.stdout}`,
      );
    }

    const execResult = await runDocker([
      "exec",
      OPENCLAW_CONTAINER_NAME,
      OPENCLAW_CONTAINER_PYTHON,
      containerScriptPath,
    ]);
    if (execResult.code !== 0) {
      throw new Error(
        `Container writer script failed (${execResult.code}): ${execResult.stderr || execResult.stdout}`,
      );
    }
  } finally {
    try {
      fs.unlinkSync(localScriptPath);
    } catch {
      // ignore cleanup failure
    }
    void runDocker(["exec", OPENCLAW_CONTAINER_NAME, "rm", "-f", containerScriptPath]);
  }
}

async function runRegisterTaskInContainer(input: {
  scriptsRoot: string;
  statePath: string;
  stage: string;
  description: string;
  timeoutSeconds: number;
}): Promise<CommandResult> {
  return runDocker([
    "exec",
    OPENCLAW_CONTAINER_NAME,
    OPENCLAW_CONTAINER_PYTHON,
    path.posix.join(input.scriptsRoot, "register_task.py"),
    "--state-path",
    input.statePath,
    "--stage",
    input.stage,
    "--owner",
    `workspace-${input.stage}`,
    "--description",
    input.description,
    "--run-timeout-seconds",
    String(input.timeoutSeconds),
  ]);
}

async function runDirectAgentTurn(input: {
  agentId: string;
  dispatchId: string;
  requirementId: string;
  dispatchFile: string;
  token: string;
  timeoutSeconds: number;
  model?: string | null;
}): Promise<DirectAgentReference> {
  const sessionId = `bridge-${input.dispatchId}`;
  const sessionKey = `agent:${input.agentId}:explicit:${sessionId.toLowerCase()}`;
  const message = buildDirectAgentMessage({
    stage: input.agentId,
    requirementId: input.requirementId,
    dispatchFile: input.dispatchFile,
    token: input.token,
  });
  const result = await runDocker([
    "exec",
    "-d",
    OPENCLAW_CONTAINER_NAME,
    OPENCLAW_CONTAINER_CLI,
    "agent",
    "--agent",
    input.agentId,
    "--session-id",
    sessionId,
    "--message",
    message,
    "--json",
    "--timeout",
    String(input.timeoutSeconds || OPENCLAW_DIRECT_AGENT_TIMEOUT_SECONDS),
    "--thinking",
    OPENCLAW_DIRECT_AGENT_THINKING,
    ...(input.model ? ["--model", input.model] : []),
  ]);
  if (result.code !== 0) {
    return {
      attempted: true,
      sessionId,
      sessionKey,
      sessionFile: null,
      runId: null,
      taskId: null,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      reportText: null,
      completionText: null,
      mode: "async-task",
    };
  }

  return {
    attempted: true,
    sessionId,
    sessionKey,
    sessionFile: null,
    runId: null,
    taskId: null,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
    reportText: null,
    completionText: null,
    mode: "async-task",
  };
}

export async function runContainerOpenClawPreparation(
  record: DispatchRecord,
): Promise<OpenClawPreparationResult> {
  const directAgentId = resolveStageFromAgent(record.request_snapshot);
  const directAgentModel = await ensureContainerAuthForDirectAgent(directAgentId);
  const projectContext = await readContainerProjectContext(record);
  console.info("[execution-adapter] resolved container project context", {
    dispatchId: record.dispatch_id,
    projectSlug: projectContext.projectSlugFallback,
    projectRepo: projectContext.projectRepoFallback,
    requirementsRoot: projectContext.requirementsRoot,
  });
  const stagingRequirementsRoot = path.join(OPENCLAW_STAGING_DIR, record.dispatch_id, "requirements");
  ensureDir(stagingRequirementsRoot);

  const bundle = materializeRequirementBundle({
    record,
    localRequirementsRoot: stagingRequirementsRoot,
    runtimeRequirementsRoot: projectContext.requirementsRoot,
    runtimePathJoin: path.posix.join,
    projectSlugFallback: projectContext.projectSlugFallback,
    projectRepoFallback: projectContext.projectRepoFallback,
  });

  if (!bundle.projectRepo.trim()) {
    throw new Error(
      `Unable to resolve project_local_repo for container dispatch. registry=${projectContext.registryPath}`,
    );
  }

  const yamlContent = fs.readFileSync(bundle.hostStatePath, "utf-8");
  const techDesignContent = fs.readFileSync(bundle.hostTechDesignPath, "utf-8");

  await ensureContainerRequirementsRoot(projectContext.requirementsRoot);
  await writeBundleIntoContainer({
    requirementDir: bundle.runtimeRequirementDir,
    statePath: bundle.runtimeStatePath,
    yamlContent,
    techDesignContent,
  });

  const registerResult = await runRegisterTaskInContainer({
    scriptsRoot: projectContext.scriptsRoot,
    statePath: bundle.runtimeStatePath,
    stage: bundle.stage,
    description: record.request_snapshot.intent,
    timeoutSeconds: record.request_snapshot.timeout_seconds || 600,
  });
  if (registerResult.code !== 0) {
    throw new Error(
      `Container register_task.py failed (${registerResult.code}): ${registerResult.stderr || registerResult.stdout}`,
    );
  }

  const parsed = parseRegisterTaskOutput(registerResult.stdout);
  const outputJson = parsed.outputJson;
  const dispatchToken =
    typeof outputJson?.dispatch_token === "string" && outputJson.dispatch_token.trim()
      ? outputJson.dispatch_token.trim()
      : null;

  let directAgent: DirectAgentReference | undefined;
  if (
    OPENCLAW_CONTAINER_EXECUTION_STRATEGY === "direct-agent" &&
    parsed.dispatchFile &&
    dispatchToken
  ) {
      directAgent = await runDirectAgentTurn({
      agentId: directAgentId,
      dispatchId: record.dispatch_id,
      requirementId: bundle.requirementId,
      dispatchFile: parsed.dispatchFile,
      token: dispatchToken,
      timeoutSeconds:
        record.request_snapshot.timeout_seconds || OPENCLAW_DIRECT_AGENT_TIMEOUT_SECONDS,
      model: directAgentModel,
    });
  }

  const handoffFile = writeOpenClawHandoff(record.dispatch_id, {
    generated_at: nowIso(),
    mode: "container-exec",
    execution_strategy: OPENCLAW_CONTAINER_EXECUTION_STRATEGY,
    container_name: OPENCLAW_CONTAINER_NAME,
    container_runtime_root: OPENCLAW_CONTAINER_RUNTIME_ROOT,
    dispatch_id: record.dispatch_id,
    run_id: record.run_id,
    node_run_id: record.node_run_id,
    stage: bundle.stage,
    project_slug: bundle.projectSlug,
    project_local_repo: bundle.projectRepo,
    requirement_id: bundle.requirementId,
    host_state_path: bundle.hostStatePath,
    host_requirement_dir: bundle.hostRequirementDir,
    runtime_state_path: bundle.runtimeStatePath,
    runtime_requirement_dir: bundle.runtimeRequirementDir,
    task_id: parsed.taskId,
    dispatch_file: parsed.dispatchFile,
    short_task: parsed.shortTask,
    dispatch_token: dispatchToken,
    register_stdout: registerResult.stdout,
    register_stderr: registerResult.stderr,
    direct_agent: directAgent,
    note:
      OPENCLAW_CONTAINER_EXECUTION_STRATEGY === "direct-agent"
        ? "Container-exec mode registered the task and attempted a direct OpenClaw agent turn using an isolated session."
        : "Container-exec mode registered the task and persisted the handoff for a downstream runtime worker.",
  });

  return {
    handoffFile,
    statePath: bundle.runtimeStatePath,
    requirementDir: bundle.runtimeRequirementDir,
    dispatchFile: parsed.dispatchFile,
    shortTask: parsed.shortTask,
    taskId: parsed.taskId,
    taskRegisterStdout: registerResult.stdout,
    taskRegisterStderr: registerResult.stderr,
    directAgent,
  };
}

export async function getContainerTaskSnapshot(lookup: string): Promise<ContainerTaskSnapshot | null> {
  const result = await runDocker([
    "exec",
    OPENCLAW_CONTAINER_NAME,
    OPENCLAW_CONTAINER_CLI,
    "tasks",
    "show",
    "--json",
    lookup,
  ]);
  if (result.code !== 0) {
    const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
    if (text.includes("task not found")) {
      return null;
    }
    throw new Error(`openclaw tasks show ${lookup} failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  const json = parseAgentJson(result.stdout);
  if (json) {
    return taskSnapshotFromJson(json);
  }

  const listResult = await runDocker([
    "exec",
    OPENCLAW_CONTAINER_NAME,
    OPENCLAW_CONTAINER_CLI,
    "tasks",
    "list",
    "--json",
  ]);
  const listJson = parseDockerJsonResult(listResult, "openclaw tasks list");
  const tasks = Array.isArray((listJson as TaskListJson).tasks)
    ? ((listJson as TaskListJson).tasks as unknown[])
    : [];
  const matched = tasks.find((item) => {
    if (!isRecord(item)) {
      return false;
    }
    return (
      asString(item.requesterSessionKey) === lookup ||
      asString(item.childSessionKey) === lookup ||
      asString(item.taskId) === lookup ||
      asString(item.runId) === lookup
    );
  });

  return isRecord(matched) ? taskSnapshotFromJson(matched) : null;
}

export async function exportContainerTrajectory(
  sessionKey: string,
): Promise<TrajectoryExportSnapshot> {
  const exportResult = await runDocker([
    "exec",
    OPENCLAW_CONTAINER_NAME,
    OPENCLAW_CONTAINER_CLI,
    "sessions",
    "export-trajectory",
    "--json",
    "--session-key",
    sessionKey,
  ]);
  const exportJson = parseDockerJsonResult(
    exportResult,
    `openclaw sessions export-trajectory ${sessionKey}`,
  );
  const outputDir = asString(exportJson.outputDir);
  if (!outputDir) {
    throw new Error("Trajectory export did not return outputDir.");
  }

  const metadataResult = await runDocker([
    "exec",
    OPENCLAW_CONTAINER_NAME,
    "cat",
    path.posix.join(outputDir, "metadata.json"),
  ]);
  const metadata =
    metadataResult.code === 0 ? parseAgentJson(metadataResult.stdout) : null;

  const eventsResult = await runDocker([
    "exec",
    OPENCLAW_CONTAINER_NAME,
    "cat",
    path.posix.join(outputDir, "events.jsonl"),
  ]);
  const eventsText = eventsResult.code === 0 ? eventsResult.stdout : "";

  const finalAssistantText =
    asString(metadata?.finalAssistantRawText) ||
    asString(metadata?.finalAssistantVisibleText) ||
    (Array.isArray(metadata?.assistantTexts)
      ? metadata?.assistantTexts
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .join("\n\n") || null
      : null);
  const reportText =
    extractAgentReport(finalAssistantText) || extractReportFromTrajectoryEvents(eventsText);

  return {
    outputDir,
    displayPath: asString(exportJson.displayPath),
    metadata,
    finalAssistantText,
    reportText,
    promptError: asString(metadata?.promptError),
  };
}

export function evaluateDirectAgentOutcome(result: OpenClawPreparationResult): {
  enabled: boolean;
  succeeded: boolean;
  status: "completed" | "failed" | "waiting_human";
  summary: string | null;
  reportText: string | null;
  sessionId: string | null;
  error: string | null;
  artifacts: ArtifactRecord[];
  parsedReport: ParsedAgentReport | null;
} {
  const direct = result.directAgent;
  if (!direct || !direct.attempted) {
    return {
      enabled: false,
      succeeded: false,
      status: "failed",
      summary: null,
      reportText: null,
      sessionId: null,
      error: null,
      artifacts: [],
      parsedReport: null,
    };
  }

  if (direct.mode !== "completed-inline") {
    return {
      enabled: false,
      succeeded: false,
      status: "failed",
      summary: normalizeSummaryText(direct.completionText),
      reportText: direct.reportText,
      sessionId: direct.sessionId,
      error: null,
      artifacts: [],
      parsedReport: null,
    };
  }

  const parsedReport = parseAgentReport(direct.reportText);
  const artifacts = buildDirectAgentArtifacts({
    dispatchId:
      path.basename(result.handoffFile, path.extname(result.handoffFile)) || "dispatch",
    handoffFile: result.handoffFile,
    parsedReport,
  });

  if (direct.exitCode !== 0) {
    return {
      enabled: true,
      succeeded: false,
      status: "failed",
      summary: null,
      reportText: null,
      sessionId: direct.sessionId,
      error: direct.stderr || direct.stdout || "Direct agent execution failed.",
      artifacts,
      parsedReport,
    };
  }

  if (!direct.reportText) {
    return {
      enabled: true,
      succeeded: false,
      status: "failed",
      summary: normalizeSummaryText(direct.completionText),
      reportText: null,
      sessionId: direct.sessionId,
      error: "Direct agent execution completed but did not emit [AGENT_REPORT].",
      artifacts,
      parsedReport,
    };
  }

  return {
    enabled: true,
    succeeded: true,
    status: parsedReport?.status || inferNodeStatusFromReport(direct.reportText),
    summary: parsedReport?.summary || normalizeSummaryText(direct.completionText),
    reportText: direct.reportText,
    sessionId: direct.sessionId,
    error: null,
    artifacts,
    parsedReport,
  };
}
