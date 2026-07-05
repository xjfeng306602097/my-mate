import fs from "node:fs";
import path from "node:path";
import { TEMPLATES_DIR } from "./config.js";
import type {
  CreateTemplateRequest,
  DeriveTemplateRequest,
  TemplateLineageResponse,
  TemplateVersioningMetadata,
  UpdateTemplateRequest,
  WorkflowTemplateRecord,
} from "./types.js";
import { ensureDir, isPlainObject, nowIso, slugify, writeJsonAtomic } from "./utils.js";
import { validateWorkflowTemplate } from "./validators.js";

function templatePath(templateId: string): string {
  return path.join(TEMPLATES_DIR, `${templateId}.json`);
}

function loadTemplate(filePath: string): WorkflowTemplateRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as WorkflowTemplateRecord;
}

function assertValidTemplate(template: WorkflowTemplateRecord): void {
  const ok = validateWorkflowTemplate(template);
  if (!ok) {
    const errorText =
      validateWorkflowTemplate.errors
        ?.map((e) => `${e.instancePath} ${e.message}`)
        .join("; ") || "unknown schema error";
    throw new Error(`Template validation failed: ${errorText}`);
  }

  const nodeIds = new Set<string>();
  for (const node of template.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Template validation failed: duplicate node id "${node.id}"`);
    }
    nodeIds.add(node.id);
  }

  for (const edge of template.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new Error(`Template validation failed: edge.from "${edge.from}" not found`);
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(`Template validation failed: edge.to "${edge.to}" not found`);
    }
  }

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const nodeId of nodeIds) {
    outgoing.set(nodeId, []);
    indegree.set(nodeId, 0);
  }

  for (const edge of template.edges) {
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of indegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    visited += 1;
    for (const next of outgoing.get(current) || []) {
      const nextDegree = (indegree.get(next) || 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
      }
    }
  }

  if (visited !== nodeIds.size) {
    throw new Error("Template validation failed: graph contains a cycle");
  }
}

function saveTemplate(template: WorkflowTemplateRecord): WorkflowTemplateRecord {
  ensureDir(TEMPLATES_DIR);
  assertValidTemplate(template);
  writeJsonAtomic(templatePath(template.template_id), template);
  return template;
}

function resolveTemplateId(preferredId: string): string {
  const baseId = slugify(preferredId) || "template";
  let candidate = baseId;
  let suffix = 2;

  while (fs.existsSync(templatePath(candidate))) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function normalizeVersioning(
  template: WorkflowTemplateRecord,
): TemplateVersioningMetadata {
  const existing = template.metadata.versioning;
  if (isPlainObject(existing)) {
    const familyId =
      typeof existing.family_id === "string" && existing.family_id.trim()
        ? existing.family_id
        : template.template_id;
    const rootTemplateId =
      typeof existing.root_template_id === "string" && existing.root_template_id.trim()
        ? existing.root_template_id
        : familyId;

    return {
      family_id: familyId,
      root_template_id: rootTemplateId,
      source_template_id:
        typeof existing.source_template_id === "string" && existing.source_template_id.trim()
          ? existing.source_template_id
          : null,
      source_version:
        typeof existing.source_version === "number" && Number.isFinite(existing.source_version)
          ? existing.source_version
          : null,
      previous_template_id:
        typeof existing.previous_template_id === "string" && existing.previous_template_id.trim()
          ? existing.previous_template_id
          : null,
      previous_version:
        typeof existing.previous_version === "number" && Number.isFinite(existing.previous_version)
          ? existing.previous_version
          : null,
      derivation_kind:
        existing.derivation_kind === "derive" || existing.derivation_kind === "version"
          ? existing.derivation_kind
          : "initial",
      generation:
        typeof existing.generation === "number" && Number.isFinite(existing.generation)
          ? existing.generation
          : Math.max(1, template.version),
    };
  }

  return {
    family_id: template.template_id,
    root_template_id: template.template_id,
    source_template_id: null,
    source_version: null,
    previous_template_id: null,
    previous_version: null,
    derivation_kind: "initial",
    generation: Math.max(1, template.version),
  };
}

function withVersioningMetadata(
  template: WorkflowTemplateRecord,
  versioning: TemplateVersioningMetadata,
): WorkflowTemplateRecord {
  return {
    ...template,
    metadata: {
      ...template.metadata,
      versioning,
    },
  };
}

function resolveTemplateIdForClone(input: {
  preferredId?: string;
  fallbackName: string;
}): string {
  const preferred =
    typeof input.preferredId === "string" && input.preferredId.trim()
      ? slugify(input.preferredId)
      : "";
  if (preferred) {
    if (fs.existsSync(templatePath(preferred))) {
      throw new Error("TEMPLATE_EXISTS");
    }
    return preferred;
  }
  return resolveTemplateId(input.fallbackName);
}

export function listTemplates(): WorkflowTemplateRecord[] {
  ensureDir(TEMPLATES_DIR);
  const files = fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(TEMPLATES_DIR, entry.name));

  const templates = files.map(loadTemplate);
  templates.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return templates;
}

export function getTemplate(templateId: string): WorkflowTemplateRecord | null {
  const filePath = templatePath(templateId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return loadTemplate(filePath);
}

export function createTemplate(input: CreateTemplateRequest): WorkflowTemplateRecord {
  ensureDir(TEMPLATES_DIR);

  const explicitTemplateId =
    typeof input.template_id === "string" && input.template_id.trim()
      ? slugify(input.template_id)
      : "";
  const templateId = explicitTemplateId || resolveTemplateId(input.name);

  if (explicitTemplateId && fs.existsSync(templatePath(templateId))) {
    throw new Error("TEMPLATE_EXISTS");
  }

  const timestamp = nowIso();
  const template: WorkflowTemplateRecord = {
    template_id: templateId,
    version: 1,
    name: input.name,
    status: "draft",
    description: input.description,
    workspace_scope: input.workspace_scope || "default",
    input_schema: input.input_schema,
    policy: input.policy,
    agent_profile_bindings: input.agent_profile_bindings || {},
    nodes: input.nodes,
    edges: input.edges,
    metadata: input.metadata || {},
    created_at: timestamp,
    updated_at: timestamp,
    published_at: null,
  };

  return saveTemplate(
    withVersioningMetadata(template, {
      family_id: templateId,
      root_template_id: templateId,
      source_template_id: null,
      source_version: null,
      previous_template_id: null,
      previous_version: null,
      derivation_kind: "initial",
      generation: 1,
    }),
  );
}

export function updateTemplateDraft(
  templateId: string,
  patch: UpdateTemplateRequest,
): WorkflowTemplateRecord {
  const current = getTemplate(templateId);
  if (!current) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }
  if (current.status !== "draft") {
    throw new Error("TEMPLATE_NOT_DRAFT");
  }

  const next: WorkflowTemplateRecord = {
    ...current,
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    input_schema: patch.input_schema ?? current.input_schema,
    policy: patch.policy ?? current.policy,
    nodes: patch.nodes ?? current.nodes,
    edges: patch.edges ?? current.edges,
    workspace_scope: patch.workspace_scope ?? current.workspace_scope,
    agent_profile_bindings:
      patch.agent_profile_bindings ?? current.agent_profile_bindings,
    metadata: patch.metadata ?? current.metadata,
    updated_at: nowIso(),
  };

  return saveTemplate(next);
}

export function publishTemplate(templateId: string): WorkflowTemplateRecord {
  const current = getTemplate(templateId);
  if (!current) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }
  if (current.status === "archived") {
    throw new Error("TEMPLATE_ARCHIVED");
  }
  if (current.status === "published") {
    return current;
  }

  const timestamp = nowIso();
  const next: WorkflowTemplateRecord = {
    ...current,
    status: "published",
    updated_at: timestamp,
    published_at: timestamp,
  };

  return saveTemplate(next);
}

export function archiveTemplate(templateId: string): WorkflowTemplateRecord {
  const current = getTemplate(templateId);
  if (!current) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }
  if (current.status === "archived") {
    return current;
  }

  const timestamp = nowIso();
  return saveTemplate({
    ...current,
    status: "archived",
    updated_at: timestamp,
  });
}

export function deriveTemplateDraft(
  sourceTemplateId: string,
  input: DeriveTemplateRequest = {},
): WorkflowTemplateRecord {
  const source = getTemplate(sourceTemplateId);
  if (!source) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }
  if (source.status === "archived") {
    throw new Error("TEMPLATE_ARCHIVED");
  }

  const sourceVersioning = normalizeVersioning(source);
  const name = input.name?.trim() || `${source.name} Variant`;
  const templateId = resolveTemplateIdForClone({
    preferredId: input.template_id,
    fallbackName: name,
  });
  const timestamp = nowIso();
  const next: WorkflowTemplateRecord = {
    ...source,
    template_id: templateId,
    version: 1,
    name,
    status: "draft",
    description: input.description?.trim() || `Derived from ${source.template_id}`,
    metadata: {
      ...source.metadata,
      ...(input.metadata || {}),
    },
    created_at: timestamp,
    updated_at: timestamp,
    published_at: null,
  };

  return saveTemplate(
    withVersioningMetadata(next, {
      family_id: templateId,
      root_template_id: templateId,
      source_template_id: source.template_id,
      source_version: source.version,
      previous_template_id: source.template_id,
      previous_version: source.version,
      derivation_kind: "derive",
      generation: 1,
    }),
  );
}

export function createNextTemplateVersion(
  sourceTemplateId: string,
  input: DeriveTemplateRequest = {},
): WorkflowTemplateRecord {
  const source = getTemplate(sourceTemplateId);
  if (!source) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }
  if (source.status !== "published") {
    throw new Error("TEMPLATE_NOT_PUBLISHED");
  }

  const sourceVersioning = normalizeVersioning(source);
  const nextVersion = source.version + 1;
  const name = input.name?.trim() || `${source.name} v${nextVersion}`;
  const templateId = resolveTemplateIdForClone({
    preferredId: input.template_id,
    fallbackName: `${source.template_id}-v${nextVersion}`,
  });
  const timestamp = nowIso();
  const next: WorkflowTemplateRecord = {
    ...source,
    template_id: templateId,
    version: nextVersion,
    name,
    status: "draft",
    description: input.description?.trim() || source.description,
    metadata: {
      ...source.metadata,
      ...(input.metadata || {}),
    },
    created_at: timestamp,
    updated_at: timestamp,
    published_at: null,
  };

  return saveTemplate(
    withVersioningMetadata(next, {
      family_id: sourceVersioning.family_id,
      root_template_id: sourceVersioning.root_template_id,
      source_template_id: source.template_id,
      source_version: source.version,
      previous_template_id: source.template_id,
      previous_version: source.version,
      derivation_kind: "version",
      generation: sourceVersioning.generation + 1,
    }),
  );
}

export function getTemplateLineage(templateId: string): TemplateLineageResponse | null {
  const template = getTemplate(templateId);
  if (!template) {
    return null;
  }

  const targetVersioning = normalizeVersioning(template);
  const items = listTemplates()
    .filter((item) => normalizeVersioning(item).family_id === targetVersioning.family_id)
    .map((item) => ({
      template_id: item.template_id,
      version: item.version,
      name: item.name,
      status: item.status,
      description: item.description,
      updated_at: item.updated_at,
      published_at: item.published_at,
      versioning: normalizeVersioning(item),
    }))
    .sort((a, b) => {
      if (a.versioning.generation !== b.versioning.generation) {
        return a.versioning.generation - b.versioning.generation;
      }
      return a.version - b.version;
    });

  return {
    family_id: targetVersioning.family_id,
    root_template_id: targetVersioning.root_template_id,
    items,
  };
}

export function assertTemplateDraftBody(
  value: unknown,
): value is CreateTemplateRequest | UpdateTemplateRequest {
  if (!isPlainObject(value)) {
    return false;
  }

  if ("name" in value && typeof value.name !== "string") {
    return false;
  }
  if ("description" in value && typeof value.description !== "string") {
    return false;
  }
  if ("input_schema" in value && !isPlainObject(value.input_schema)) {
    return false;
  }
  if ("policy" in value && !isPlainObject(value.policy)) {
    return false;
  }
  if ("nodes" in value && !Array.isArray(value.nodes)) {
    return false;
  }
  if ("edges" in value && !Array.isArray(value.edges)) {
    return false;
  }
  if ("workspace_scope" in value && typeof value.workspace_scope !== "string") {
    return false;
  }
  if (
    "agent_profile_bindings" in value &&
    !isPlainObject(value.agent_profile_bindings)
  ) {
    return false;
  }
  if ("metadata" in value && !isPlainObject(value.metadata)) {
    return false;
  }

  return true;
}
