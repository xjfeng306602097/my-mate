import fs from "node:fs";
import path from "node:path";
import {
  OPENCLAW_DEFAULT_PROJECT_REPO,
  OPENCLAW_DEFAULT_PROJECT_SLUG,
  OPENCLAW_HANDOFFS_DIR,
} from "./config.js";
import type { DispatchRecord, DispatchRequest } from "./types.js";
import { ensureDir, nowIso, slugify, writeJsonAtomic } from "./utils.js";

export type OpenClawStage = "backend" | "review" | "devops" | "tester";

export interface OpenClawRequirementBundle {
  requirementId: string;
  projectSlug: string;
  projectRepo: string;
  stage: OpenClawStage;
  hostStatePath: string;
  hostRequirementDir: string;
  hostTechDesignPath: string;
  runtimeStatePath: string;
  runtimeRequirementDir: string;
}

export interface ParsedRegisterTaskOutput {
  taskId: string | null;
  dispatchFile: string | null;
  shortTask: string | null;
  outputJson: Record<string, unknown> | null;
}

interface MaterializeRequirementBundleInput {
  record: DispatchRecord;
  localRequirementsRoot: string;
  runtimeRequirementsRoot: string;
  runtimePathJoin: (...segments: string[]) => string;
  projectSlugFallback?: string | null;
  projectRepoFallback?: string | null;
}

type UpstreamArtifactSummary = {
  artifact_id: string;
  type: string;
  name: string;
  storage_uri: string;
  mime_type?: string;
  size_bytes?: number;
};

type UpstreamNodeSummary = {
  node_run_id: string;
  node_id: string;
  node_name: string;
  status: string;
  summary: string;
  artifacts: UpstreamArtifactSummary[];
};

function resolveDesignDocsRoot(requirementDir: string): string {
  const separator = requirementDir.includes("\\") ? "\\" : "/";
  return requirementDir.endsWith(separator) ? requirementDir : `${requirementDir}${separator}`;
}

export function resolveProjectSlug(
  request: DispatchRequest,
  fallbackSlug?: string | null,
): string {
  const raw = request.input_payload.project_slug;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (typeof fallbackSlug === "string" && fallbackSlug.trim()) {
    return fallbackSlug.trim();
  }
  return OPENCLAW_DEFAULT_PROJECT_SLUG.trim();
}

export function resolveProjectRepo(
  request: DispatchRequest,
  fallbackRepo?: string | null,
): string {
  const raw = request.input_payload.project_local_repo;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (typeof fallbackRepo === "string" && fallbackRepo.trim()) {
    return fallbackRepo.trim();
  }
  return OPENCLAW_DEFAULT_PROJECT_REPO.trim();
}

export function resolveStageFromAgent(request: DispatchRequest): OpenClawStage {
  const raw = String(request.openclaw_agent_id || request.node_type || "").trim().toLowerCase();
  if (raw === "review" || raw === "devops" || raw === "tester") {
    return raw;
  }
  return "backend";
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line || !line.startsWith("{") || !line.endsWith("}")) {
      continue;
    }
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

export function extractBlock(text: string, begin: string, end: string): string | null {
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (start < 0 || finish < 0 || finish <= start) {
    return null;
  }
  return text
    .slice(start + begin.length, finish)
    .trim()
    .replace(/\r\n/g, "\n");
}

function buildRequirementId(record: DispatchRecord): string {
  const token = slugify(record.dispatch_id).replace(/-/g, "").toUpperCase();
  return `REQ-MM-${token.slice(0, 20) || "DISPATCH"}`;
}

function asCleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function looksEncodingDamaged(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const questionMarks = (value.match(/\?/g) || []).length;
  return questionMarks >= 4 && questionMarks / Math.max(value.length, 1) >= 0.15;
}

function readExpectedArtifacts(request: DispatchRequest): string[] {
  const outputContract = request.output_contract;
  const expectedArtifacts = Array.isArray(outputContract?.expected_artifacts)
    ? outputContract.expected_artifacts
    : [];
  return expectedArtifacts
    .map((item) => asCleanString(item))
    .filter((item): item is string => Boolean(item));
}

function readUpstreamContext(request: DispatchRequest): UpstreamNodeSummary[] {
  const upstreamContext = request.input_payload.upstream_context;
  const nodes = Array.isArray((upstreamContext as { nodes?: unknown[] } | undefined)?.nodes)
    ? (upstreamContext as { nodes: unknown[] }).nodes
    : [];

  return nodes
    .map((item) => {
      const record = item as Record<string, unknown>;
      const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
      return {
        node_run_id: asCleanString(record.node_run_id) || "",
        node_id: asCleanString(record.node_id) || "",
        node_name: asCleanString(record.node_name) || "",
        status: asCleanString(record.status) || "unknown",
        summary: asCleanString(record.summary) || "",
        artifacts: artifacts
          .map((artifact) => {
            const artifactRecord = artifact as Record<string, unknown>;
            const name = asCleanString(artifactRecord.name);
            const storageUri = asCleanString(artifactRecord.storage_uri);
            if (!name || !storageUri) {
              return null;
            }
            return {
              artifact_id: asCleanString(artifactRecord.artifact_id) || "",
              type: asCleanString(artifactRecord.type) || "artifact",
              name,
              storage_uri: storageUri,
              mime_type: asCleanString(artifactRecord.mime_type) || undefined,
              size_bytes:
                typeof artifactRecord.size_bytes === "number" &&
                Number.isFinite(artifactRecord.size_bytes)
                  ? artifactRecord.size_bytes
                  : undefined,
            };
          })
          .filter(
            (
              artifact,
            ): artifact is {
              artifact_id: string;
              type: string;
              name: string;
              storage_uri: string;
              mime_type: string | undefined;
              size_bytes: number | undefined;
            } => artifact !== null,
          ),
      };
    })
    .filter((node) => node.node_id || node.node_name || node.summary || node.artifacts.length > 0);
}

function resolveTaskTitle(request: DispatchRequest): string {
  return asCleanString(request.input_payload.title) || request.node_name;
}

function resolveTaskDescription(request: DispatchRequest): string {
  const explicitDescription = asCleanString(request.input_payload.description);
  if (explicitDescription && !looksEncodingDamaged(explicitDescription)) {
    return explicitDescription;
  }
  if (!looksEncodingDamaged(request.intent)) {
    return request.intent;
  }
  const expectedArtifacts = readExpectedArtifacts(request);
  if (request.node_name.toLowerCase().includes("report") || expectedArtifacts.includes("research-report")) {
    return "Compose a final report from the completed upstream research context and artifacts.";
  }
  return `Complete node ${request.node_name} using the available runtime inputs and upstream artifacts.`;
}

function buildAcceptanceCriteria(request: DispatchRequest): string[] {
  const explicit = Array.isArray(request.input_payload.acceptance_criteria)
    ? request.input_payload.acceptance_criteria
        .map((item) => asCleanString(item))
        .filter((item): item is string => Boolean(item) && !looksEncodingDamaged(item))
    : [];
  if (explicit.length >= 2) {
    return explicit;
  }

  const expectedArtifacts = readExpectedArtifacts(request);
  const artifactLabel = expectedArtifacts.join(", ") || "documented output";
  const defaults = [
    `AC-1: When the node finishes, it produces the expected artifact set: ${artifactLabel}.`,
    "AC-2: The output clearly references the upstream context, assumptions, and resulting deliverable.",
  ];
  if (request.node_name.toLowerCase().includes("report")) {
    defaults[1] =
      "AC-2: The report synthesizes upstream research findings into a readable final deliverable with clear sections.";
  }
  return defaults;
}

function buildTechDesignBody(request: DispatchRequest, projectRepo: string): string {
  const title = resolveTaskTitle(request);
  const description = resolveTaskDescription(request);
  const runInputs = request.input_payload.run_inputs as Record<string, unknown> | undefined;
  const upstreamNodes = readUpstreamContext(request);
  const expectedArtifacts = readExpectedArtifacts(request);

  const body: string[] = [
    `# ${title}`,
    "",
    "## Goal",
    "",
    description,
    "",
    "## Node Context",
    "",
    `- node_id: ${request.node_id}`,
    `- node_name: ${request.node_name}`,
    `- openclaw_agent_id: ${request.openclaw_agent_id || "backend"}`,
    `- project_repo: ${projectRepo}`,
  ];

  if (runInputs && Object.keys(runInputs).length > 0) {
    body.push("", "## Runtime Inputs", "");
    for (const [key, value] of Object.entries(runInputs)) {
      const rendered =
        typeof value === "string" ? value : JSON.stringify(value, null, 2);
      body.push(`- ${key}: ${rendered}`);
    }
  }

  if (upstreamNodes.length > 0) {
    body.push("", "## Upstream Context", "");
    for (const node of upstreamNodes) {
      body.push(`### ${node.node_name || node.node_id || "Upstream Node"}`);
      body.push(`- node_id: ${node.node_id || "unknown"}`);
      body.push(`- status: ${node.status}`);
      if (node.summary) {
        body.push(`- summary: ${node.summary}`);
      }
      if (node.artifacts.length > 0) {
        body.push("- artifacts:");
        for (const artifact of node.artifacts) {
          body.push(
            `  - ${artifact.name} [${artifact.type}] -> ${artifact.storage_uri}`,
          );
        }
      }
      body.push("");
    }
  }

  body.push("## Expected Output", "");
  if (expectedArtifacts.length > 0) {
    body.push(`- Produce artifact(s): ${expectedArtifacts.join(", ")}`);
  } else {
    body.push("- Produce the expected node deliverable and summarize the result.");
  }
  if (request.node_name.toLowerCase().includes("report")) {
    body.push(
      "- Use the upstream research summaries and artifacts as the primary source material.",
      "- Return a concise final report rather than a code-change-only response unless the spec explicitly requires code edits.",
    );
  } else {
    body.push("- See bridge handoff metadata and dispatch file for execution details.");
  }
  body.push("");

  return body.join("\n");
}

function buildRequirementYaml(input: {
  request: DispatchRequest;
  requirementId: string;
  projectSlug: string;
  projectRepo: string;
  runtimeRequirementDir: string;
  stage: OpenClawStage;
}): string {
  const affectedModules = Array.isArray(input.request.input_payload.affected_modules)
    ? input.request.input_payload.affected_modules
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];

  const acceptanceCriteria = buildAcceptanceCriteria(input.request);
  const title = resolveTaskTitle(input.request);
  const description = resolveTaskDescription(input.request);

  const affectedBlock =
    affectedModules.length > 0
      ? affectedModules.map((item) => `  - ${item}`).join("\n")
      : "  - core";

  const acBlock = acceptanceCriteria.map((item) => `  - ${JSON.stringify(item)}`).join("\n");
  const today = nowIso().slice(0, 10);

  return [
    `requirement_id: ${input.requirementId}`,
    `project_slug: ${input.projectSlug}`,
    `project_local_repo: ${input.projectRepo || ""}`,
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    "type: platform_task",
    "mode: spec",
    "status: in_progress",
    `created_at: ${JSON.stringify(today)}`,
    `updated_at: ${JSON.stringify(today)}`,
    `design_docs_root: ${resolveDesignDocsRoot(input.runtimeRequirementDir)}`,
    "workflow_stage: analysis",
    "stage_status: in_progress",
    "review_required: false",
    "root_cause_confirmed: false",
    "affected_modules:",
    affectedBlock,
    "acceptance_criteria:",
    acBlock,
    "review_notification:",
    "  sent: false",
    "  sent_at: ''",
    "  sent_by: ''",
    "  summary: ''",
    "human_review:",
    "  reviewed: false",
    "  reviewer_id: ''",
    "  reviewed_at: ''",
    "  review_comment: ''",
    "stage_artifacts:",
    "  analysis: []",
    "  backend: []",
    "  review: []",
    "  devops: []",
    "  tester: []",
    "architect_dispatch:",
    `  dispatched_to: ${input.stage}`,
    "  dispatched_at: ''",
    "  dispatch_message_id: ''",
    "  last_report_at: ''",
    "  last_report_from: ''",
    "  last_report_summary: ''",
    "deployment_report:",
    "  status: pending",
    "  environment: ''",
    "  deployed_at: ''",
    "  deployed_by: ''",
    "  deployment_method: none",
    "  duration_seconds: 0",
    "  resources:",
    "    lambda: []",
    "    apigw: []",
    "    dynamodb: []",
    "    s3: []",
    "    cloudformation:",
    "      stack_id: ''",
    "      changeset_id: ''",
    "  summary: ''",
    "environment_deployments:",
    "  dev:",
    "    status: not_deployed",
    "    deployed_at: ''",
    "    deployed_by: ''",
    "    summary: ''",
    "",
  ].join("\n");
}

function ensureRequiredDocs(
  requirementDir: string,
  request: DispatchRequest,
  projectRepo: string,
): void {
  const techDesignPath = path.join(requirementDir, "TECH_DESIGN.md");
  if (fs.existsSync(techDesignPath)) {
    return;
  }

  const body = buildTechDesignBody(request, projectRepo);
  fs.writeFileSync(techDesignPath, body, "utf-8");
}

export function materializeRequirementBundle(
  input: MaterializeRequirementBundleInput,
): OpenClawRequirementBundle {
  const request = input.record.request_snapshot;
  const projectSlug = resolveProjectSlug(request, input.projectSlugFallback);
  const projectRepo = resolveProjectRepo(request, input.projectRepoFallback);
  const requirementId = buildRequirementId(input.record);
  const stage = resolveStageFromAgent(request);
  const hostRequirementDir = path.join(input.localRequirementsRoot, requirementId);
  const hostTechDesignPath = path.join(hostRequirementDir, "TECH_DESIGN.md");
  const hostStatePath = path.join(input.localRequirementsRoot, `${requirementId}.yaml`);
  const runtimeRequirementDir = input.runtimePathJoin(input.runtimeRequirementsRoot, requirementId);
  const runtimeStatePath = input.runtimePathJoin(
    input.runtimeRequirementsRoot,
    `${requirementId}.yaml`,
  );

  ensureDir(input.localRequirementsRoot);
  ensureDir(hostRequirementDir);
  ensureRequiredDocs(hostRequirementDir, request, projectRepo);
  fs.writeFileSync(
    hostStatePath,
    buildRequirementYaml({
      request,
      requirementId,
      projectSlug,
      projectRepo,
      runtimeRequirementDir,
      stage,
    }),
    "utf-8",
  );

  return {
    requirementId,
    projectSlug,
    projectRepo,
    stage,
    hostStatePath,
    hostRequirementDir,
    hostTechDesignPath,
    runtimeStatePath,
    runtimeRequirementDir,
  };
}

export function parseRegisterTaskOutput(text: string): ParsedRegisterTaskOutput {
  const outputJson = extractJsonObject(text);
  const dispatchFile =
    typeof outputJson?.dispatch_file === "string" && outputJson.dispatch_file.trim()
      ? outputJson.dispatch_file.trim()
      : extractBlock(text, "DISPATCH_FILE_BEGIN", "DISPATCH_FILE_END");
  const shortTask = extractBlock(
    text,
    "DISPATCH_SHORT_TASK_BEGIN",
    "DISPATCH_SHORT_TASK_END",
  );
  const taskId =
    typeof outputJson?.task_id === "string" && outputJson.task_id.trim()
      ? outputJson.task_id.trim()
      : null;

  return {
    taskId,
    dispatchFile: dispatchFile || null,
    shortTask: shortTask || null,
    outputJson,
  };
}

export function writeOpenClawHandoff(
  dispatchId: string,
  payload: Record<string, unknown>,
): string {
  ensureDir(OPENCLAW_HANDOFFS_DIR);
  const handoffFile = path.join(OPENCLAW_HANDOFFS_DIR, `${dispatchId}.json`);
  writeJsonAtomic(handoffFile, payload);
  return handoffFile;
}
