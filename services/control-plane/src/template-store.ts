import path from "node:path";
import { TEMPLATES_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getActiveWorkspaceId } from "./request-security.js";
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
import { createAgentBindingSnapshot, normalizeAgentBindingSnapshot } from "./agent-runtime-store.js";

function templatePath(templateId: string): string {
  return path.join(TEMPLATES_DIR, `${templateId}.json`);
}

function loadTemplate(filePath: string): WorkflowTemplateRecord {
  return canonicalizeTemplate(
    getJsonStorageBackend().readJson<WorkflowTemplateRecord>(filePath),
  );
}

function canonicalizeTemplate(template: WorkflowTemplateRecord): WorkflowTemplateRecord {
  const legacy = template as WorkflowTemplateRecord & {
    agent_profile_bindings?: Record<string, unknown>;
  };
  const { agent_profile_bindings: _legacyBindings, ...canonicalTemplate } = legacy;
  return {
    ...canonicalTemplate,
    nodes: template.nodes.map((node) => {
      const legacyNode = node as typeof node & { agent_profile?: string | null; openclaw_agent_id?: string | null };
      const { agent_profile: legacyAgentId, openclaw_agent_id: _legacyRuntimeAgentId, ...canonicalNode } = legacyNode;
      return {
        ...canonicalNode,
        agent_id: canonicalNode.agent_id || legacyAgentId || null,
        agent_binding_snapshot: canonicalNode.agent_binding_snapshot
          ? normalizeAgentBindingSnapshot(canonicalNode.agent_binding_snapshot)
          : null,
      };
    }),
  };
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
  const activeWorkspaceId = getActiveWorkspaceId();
  if (activeWorkspaceId && template.workspace_scope !== activeWorkspaceId) {
    throw new Error("WORKSPACE_SCOPE_MISMATCH");
  }
  const canonical = canonicalizeTemplate(template);
  assertValidTemplate(canonical);
  writeJsonAtomic(templatePath(canonical.template_id), canonical);
  return canonical;
}

function resolveTemplateId(preferredId: string): string {
  const storage = getJsonStorageBackend();
  const baseId = slugify(preferredId) || "template";
  let candidate = baseId;
  let suffix = 2;

  while (storage.exists(templatePath(candidate))) {
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
  const storage = getJsonStorageBackend();
  const preferred =
    typeof input.preferredId === "string" && input.preferredId.trim()
      ? slugify(input.preferredId)
      : "";
  if (preferred) {
    if (storage.exists(templatePath(preferred))) {
      throw new Error("TEMPLATE_EXISTS");
    }
    return preferred;
  }
  return resolveTemplateId(input.fallbackName);
}

export function listTemplates(): WorkflowTemplateRecord[] {
  const storage = getJsonStorageBackend();
  const files = storage.listJsonFiles(TEMPLATES_DIR);
  const activeWorkspaceId = getActiveWorkspaceId();
  const templates = files
    .map(loadTemplate)
    .filter((template) => !activeWorkspaceId || template.workspace_scope === activeWorkspaceId);
  templates.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return templates;
}

export function listCurrentPublishedTemplates(): WorkflowTemplateRecord[] {
  const families = new Map<string, WorkflowTemplateRecord[]>();
  for (const template of listTemplates()) {
    if (template.status !== "published") continue;
    const familyId = normalizeVersioning(template).family_id;
    const items = families.get(familyId) || [];
    items.push(template);
    families.set(familyId, items);
  }
  return [...families.values()]
    .map((items) => items.sort((left, right) => {
      const leftVersioning = normalizeVersioning(left);
      const rightVersioning = normalizeVersioning(right);
      if (leftVersioning.generation !== rightVersioning.generation) {
        return rightVersioning.generation - leftVersioning.generation;
      }
      if (left.version !== right.version) return right.version - left.version;
      return right.updated_at.localeCompare(left.updated_at);
    })[0])
    .filter((item): item is WorkflowTemplateRecord => Boolean(item))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function migrateWorkflowAgentBindings(workspaceId = "default"): {
  scanned_templates: number;
  migrated_templates: number;
  migrated_nodes: number;
  unresolved_nodes: Array<{ template_id: string; node_id: string; agent_id: string | null; error: string }>;
  compatibility_fields_retained: boolean;
} {
  const templates = listTemplates().filter((template) => template.workspace_scope === workspaceId);
  let migratedTemplates = 0;
  let migratedNodes = 0;
  const unresolvedNodes: Array<{ template_id: string; node_id: string; agent_id: string | null; error: string }> = [];
  for (const template of templates) {
    let changed = false;
    let templateUnresolved = false;
    const nodes = template.nodes.map((node) => {
      const existing = node.agent_binding_snapshot;
      if (existing?.schema_version === 2 && existing.agent_role) {
        return node;
      }
      const agentId = node.agent_id || node.agent_profile || null;
      if (!agentId) {
        if (node.type === "agent_task") {
          templateUnresolved = true;
          unresolvedNodes.push({
            template_id: template.template_id,
            node_id: node.id,
            agent_id: null,
            error: "Agent task has no Agent selector or binding snapshot.",
          });
        }
        return node;
      }
      try {
        const snapshot = createAgentBindingSnapshot({
          workspaceId,
          agentId,
          agentVersion: node.agent_version || null,
          bindingMode: "pinned",
        });
        changed = true;
        migratedNodes += 1;
        return { ...node, agent_id: snapshot.agent_id, agent_version: snapshot.agent_version, agent_binding_snapshot: snapshot };
      } catch (error) {
        templateUnresolved = true;
        unresolvedNodes.push({ template_id: template.template_id, node_id: node.id, agent_id: agentId, error: error instanceof Error ? error.message : "Agent binding migration failed." });
        return node;
      }
    });
    if (!changed) continue;
    const timestamp = nowIso();
    saveTemplate({
      ...template,
      nodes,
      metadata: {
        ...template.metadata,
        agent_binding_migration: {
          schema_version: 2,
          migrated_at: timestamp,
          compatibility_fields_retained: templateUnresolved,
        },
      },
      updated_at: timestamp,
    });
    migratedTemplates += 1;
  }
  return {
    scanned_templates: templates.length,
    migrated_templates: migratedTemplates,
    migrated_nodes: migratedNodes,
    unresolved_nodes: unresolvedNodes,
    compatibility_fields_retained: unresolvedNodes.length > 0,
  };
}

export function getTemplate(templateId: string): WorkflowTemplateRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = templatePath(templateId);
  if (!storage.exists(filePath)) {
    return null;
  }
  const template = loadTemplate(filePath);
  const activeWorkspaceId = getActiveWorkspaceId();
  return activeWorkspaceId && template.workspace_scope !== activeWorkspaceId ? null : template;
}

export function createTemplate(input: CreateTemplateRequest): WorkflowTemplateRecord {
  ensureDir(TEMPLATES_DIR);
  const storage = getJsonStorageBackend();

  const explicitTemplateId =
    typeof input.template_id === "string" && input.template_id.trim()
      ? slugify(input.template_id)
      : "";
  const templateId = explicitTemplateId || resolveTemplateId(input.name);

  if (explicitTemplateId && storage.exists(templatePath(templateId))) {
    throw new Error("TEMPLATE_EXISTS");
  }

  const timestamp = nowIso();
  const template: WorkflowTemplateRecord = {
    template_id: templateId,
    version: 1,
    name: input.name,
    status: "draft",
    description: input.description,
    workspace_scope: getActiveWorkspaceId() || input.workspace_scope || "default",
    input_schema: input.input_schema,
    policy: input.policy,
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
  const requestedSource = getTemplate(sourceTemplateId);
  if (!requestedSource) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }
  if (requestedSource.status !== "published") {
    throw new Error("TEMPLATE_NOT_PUBLISHED");
  }

  const requestedVersioning = normalizeVersioning(requestedSource);
  const family = listTemplates().filter(
    (template) => normalizeVersioning(template).family_id === requestedVersioning.family_id,
  );
  const existingDraft = family
    .filter((template) => template.status === "draft" && normalizeVersioning(template).derivation_kind === "version")
    .sort((left, right) => normalizeVersioning(right).generation - normalizeVersioning(left).generation)[0];
  if (existingDraft) return existingDraft;

  const source = family
    .filter((template) => template.status === "published")
    .sort((left, right) => {
      const generationDelta = normalizeVersioning(right).generation - normalizeVersioning(left).generation;
      return generationDelta || right.version - left.version;
    })[0] || requestedSource;
  const sourceVersioning = normalizeVersioning(source);
  const nextVersion = source.version + 1;
  const name = input.name?.trim() || source.name;
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
