import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { appendAuditEvent } from "./audit-store.js";
import { GOVERNANCE_CHANGES_DIR, GOVERNANCE_POLICIES_DIR } from "./config.js";
import { getRequestAuthContext } from "./request-security.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getTemplate, archiveTemplate, publishTemplate } from "./template-store.js";
import {
  disableAgentDefinition,
  getAgentDefinition,
  upsertAgentDefinition,
} from "./agent-runtime-store.js";
import {
  disableSkill,
  getSkill,
  upsertSkill,
} from "./registry-store.js";
import type {
  AgentDefinitionRecord,
  CreateGovernanceChangeRequest,
  GovernanceChangeRecord,
  GovernanceDecisionRequest,
  GovernancePolicyRecord,
  GovernanceProtectedAction,
  SkillRecord,
  UpsertSkillRequest,
  WorkflowTemplateRecord,
} from "./types.js";
import { isPlainObject, nowIso, slugify } from "./utils.js";

export const GOVERNANCE_PROTECTED_ACTIONS: readonly GovernanceProtectedAction[] = [
  "agent.upsert",
  "agent.disable",
  "skill.upsert",
  "skill.disable",
  "template.publish",
  "template.archive",
];

function policyPath(workspaceId: string): string {
  return path.join(GOVERNANCE_POLICIES_DIR, `${encodeURIComponent(workspaceId)}.json`);
}

function changesDir(workspaceId: string): string {
  return path.join(GOVERNANCE_CHANGES_DIR, encodeURIComponent(workspaceId));
}

function changePath(workspaceId: string, changeId: string): string {
  return path.join(changesDir(workspaceId), `${encodeURIComponent(changeId)}.json`);
}

function requestIdentity(): { workspaceId: string; principalId: string } {
  const context = getRequestAuthContext();
  if (!context) throw new Error("GOVERNANCE_REQUEST_CONTEXT_REQUIRED");
  return {
    workspaceId: context.selected_workspace.workspace_id,
    principalId: context.principal.principal_id,
  };
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForHash(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(normalizeForHash(value)), "utf-8")
    .digest("hex")}`;
}

function defaultPolicy(workspaceId: string): GovernancePolicyRecord {
  const timestamp = nowIso();
  return {
    schema_version: 1,
    workspace_id: workspaceId,
    mode: "advisory",
    required_approvals: 1,
    allow_self_approval: false,
    protected_actions: [...GOVERNANCE_PROTECTED_ACTIONS],
    updated_by: "system",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function isProtectedAction(value: unknown): value is GovernanceProtectedAction {
  return typeof value === "string" && GOVERNANCE_PROTECTED_ACTIONS.includes(
    value as GovernanceProtectedAction,
  );
}

function normalizeProtectedAction(value: unknown): GovernanceProtectedAction | null {
  if (value === "agent_profile.upsert") return "agent.upsert";
  if (value === "agent_profile.disable") return "agent.disable";
  return isProtectedAction(value) ? value : null;
}

function normalizeGovernanceChange(change: GovernanceChangeRecord): GovernanceChangeRecord {
  const action = normalizeProtectedAction(change.action);
  if (!action) return change;
  const payload = { ...change.payload };
  if (typeof payload.profile_id === "string" && payload.agent_id === undefined) {
    payload.agent_id = payload.profile_id;
    delete payload.profile_id;
  }
  return {
    ...change,
    action,
    resource_type: action.startsWith("agent.") ? "agent" : change.resource_type,
    payload,
  };
}

function resourceType(action: GovernanceProtectedAction): GovernanceChangeRecord["resource_type"] {
  if (action.startsWith("agent.")) return "agent";
  if (action.startsWith("skill.")) return "skill";
  return "template";
}

function currentResource(
  action: GovernanceProtectedAction,
  resourceId: string,
): AgentDefinitionRecord | SkillRecord | WorkflowTemplateRecord | null {
  if (action.startsWith("agent.")) return getAgentDefinition(resourceId, requestIdentity().workspaceId);
  if (action.startsWith("skill.")) return getSkill(resourceId);
  return getTemplate(resourceId);
}

function validateChangeInput(input: CreateGovernanceChangeRequest): {
  action: GovernanceProtectedAction;
  resourceId: string;
  reason: string;
  payload: Record<string, unknown>;
} {
  if (!isProtectedAction(input.action)) throw new Error("GOVERNANCE_ACTION_INVALID");
  const resourceId = slugify(input.resource_id || "");
  if (!resourceId) throw new Error("GOVERNANCE_RESOURCE_ID_REQUIRED");
  const reason = input.reason?.trim();
  if (!reason) throw new Error("GOVERNANCE_REASON_REQUIRED");
  const payload = input.payload === undefined ? {} : input.payload;
  if (!isPlainObject(payload)) throw new Error("GOVERNANCE_PAYLOAD_INVALID");

  if (input.action === "agent.upsert") {
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      throw new Error("GOVERNANCE_AGENT_PROFILE_NAME_REQUIRED");
    }
    if (payload.agent_id && slugify(String(payload.agent_id)) !== resourceId) {
      throw new Error("GOVERNANCE_RESOURCE_ID_MISMATCH");
    }
  }
  if (input.action === "skill.upsert") {
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      throw new Error("GOVERNANCE_SKILL_NAME_REQUIRED");
    }
    if (payload.skill_id && slugify(String(payload.skill_id)) !== resourceId) {
      throw new Error("GOVERNANCE_RESOURCE_ID_MISMATCH");
    }
  }

  const current = currentResource(input.action, resourceId);
  if (
    ["agent.disable", "skill.disable", "template.publish", "template.archive"].includes(
      input.action,
    ) && !current
  ) {
    throw new Error("GOVERNANCE_RESOURCE_NOT_FOUND");
  }
  return { action: input.action, resourceId, reason, payload };
}

function writeChange(change: GovernanceChangeRecord): GovernanceChangeRecord {
  getJsonStorageBackend().writeJson(changePath(change.workspace_id, change.change_id), change);
  return change;
}

function governanceAudit(
  change: GovernanceChangeRecord,
  action: string,
  outcome: "allowed" | "denied" | "error",
  statusCode: number,
  metadata: Record<string, string | number | boolean | null> = {},
): void {
  appendAuditEvent({
    context: getRequestAuthContext(),
    action,
    permission: action === "governance.change.proposed" ? "registry.manage" : "governance.review",
    method: "POST",
    path: `/api/governance/changes/${change.change_id}`,
    resourceType: change.resource_type,
    resourceId: change.resource_id,
    outcome,
    statusCode,
    metadata: {
      change_id: change.change_id,
      protected_action: change.action,
      ...metadata,
    },
  });
}

export function getGovernancePolicy(): GovernancePolicyRecord {
  const { workspaceId } = requestIdentity();
  const storage = getJsonStorageBackend();
  const filePath = policyPath(workspaceId);
  if (!storage.exists(filePath)) return defaultPolicy(workspaceId);
  const policy = storage.readJson<GovernancePolicyRecord>(filePath);
  return {
    ...policy,
    protected_actions: policy.protected_actions
      .map(normalizeProtectedAction)
      .filter((action): action is GovernanceProtectedAction => action !== null),
  };
}

export function updateGovernancePolicy(input: {
  mode?: unknown;
  required_approvals?: unknown;
  allow_self_approval?: unknown;
  protected_actions?: unknown;
}): GovernancePolicyRecord {
  const { workspaceId, principalId } = requestIdentity();
  const current = getGovernancePolicy();
  const mode = input.mode === undefined ? current.mode : input.mode;
  if (mode !== "advisory" && mode !== "enforced") {
    throw new Error("GOVERNANCE_MODE_INVALID");
  }
  const requiredApprovals = input.required_approvals === undefined
    ? current.required_approvals
    : Number(input.required_approvals);
  if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1 || requiredApprovals > 5) {
    throw new Error("GOVERNANCE_REQUIRED_APPROVALS_INVALID");
  }
  const allowSelfApproval = input.allow_self_approval === undefined
    ? current.allow_self_approval
    : input.allow_self_approval;
  if (typeof allowSelfApproval !== "boolean") {
    throw new Error("GOVERNANCE_SELF_APPROVAL_INVALID");
  }
  const protectedActions = input.protected_actions === undefined
    ? current.protected_actions
    : input.protected_actions;
  if (!Array.isArray(protectedActions) || !protectedActions.every(isProtectedAction)) {
    throw new Error("GOVERNANCE_PROTECTED_ACTIONS_INVALID");
  }
  const timestamp = nowIso();
  const policy: GovernancePolicyRecord = {
    ...current,
    workspace_id: workspaceId,
    mode,
    required_approvals: requiredApprovals,
    allow_self_approval: allowSelfApproval,
    protected_actions: [...new Set(protectedActions)],
    updated_by: principalId,
    updated_at: timestamp,
  };
  getJsonStorageBackend().writeJson(policyPath(workspaceId), policy);
  appendAuditEvent({
    context: getRequestAuthContext(),
    action: "governance.policy.updated",
    permission: "governance.review",
    method: "POST",
    path: "/api/governance/policy",
    resourceType: "governance_policy",
    resourceId: workspaceId,
    outcome: "allowed",
    statusCode: 200,
    metadata: {
      mode: policy.mode,
      required_approvals: policy.required_approvals,
      allow_self_approval: policy.allow_self_approval,
    },
  });
  return policy;
}

export function governanceApprovalRequired(action: GovernanceProtectedAction): boolean {
  const context = getRequestAuthContext();
  if (!context) return false;
  const policy = getGovernancePolicy();
  return policy.mode === "enforced" && policy.protected_actions.includes(action);
}

export function createGovernanceChange(
  input: CreateGovernanceChangeRequest,
): GovernanceChangeRecord {
  const { workspaceId, principalId } = requestIdentity();
  const validated = validateChangeInput(input);
  const policy = getGovernancePolicy();
  const current = currentResource(validated.action, validated.resourceId);
  const timestamp = nowIso();
  const change: GovernanceChangeRecord = {
    schema_version: 1,
    change_id: `gch_${randomUUID()}`,
    workspace_id: workspaceId,
    action: validated.action,
    resource_type: resourceType(validated.action),
    resource_id: validated.resourceId,
    reason: validated.reason,
    payload: validated.payload,
    payload_digest: digest(validated.payload),
    base_digest: digest(current),
    status: "pending",
    required_approvals: policy.required_approvals,
    allow_self_approval: policy.allow_self_approval,
    approvals: [],
    proposed_by: principalId,
    proposed_at: timestamp,
    approved_at: null,
    applied_by: null,
    applied_at: null,
    result: null,
    conflict_reason: null,
    updated_at: timestamp,
  };
  writeChange(change);
  governanceAudit(change, "governance.change.proposed", "allowed", 201);
  return change;
}

export function listGovernanceChanges(input: {
  status?: string;
  action?: string;
  limit?: number;
} = {}): GovernanceChangeRecord[] {
  const { workspaceId } = requestIdentity();
  const limit = Math.min(500, Math.max(1, Math.floor(input.limit || 100)));
  return getJsonStorageBackend()
    .listJsonFiles(changesDir(workspaceId))
    .map((file) => normalizeGovernanceChange(
      getJsonStorageBackend().readJson<GovernanceChangeRecord>(file),
    ))
    .filter((change) => !input.status || change.status === input.status)
    .filter((change) => !input.action || change.action === input.action)
    .sort((left, right) => right.proposed_at.localeCompare(left.proposed_at))
    .slice(0, limit);
}

export function getGovernanceChange(changeId: string): GovernanceChangeRecord | null {
  const { workspaceId } = requestIdentity();
  const filePath = changePath(workspaceId, changeId);
  const storage = getJsonStorageBackend();
  return storage.exists(filePath)
    ? normalizeGovernanceChange(storage.readJson<GovernanceChangeRecord>(filePath))
    : null;
}

export function decideGovernanceChange(
  changeId: string,
  decision: "approved" | "rejected",
  input: GovernanceDecisionRequest = {},
): GovernanceChangeRecord {
  const { principalId } = requestIdentity();
  const current = getGovernanceChange(changeId);
  if (!current) throw new Error("GOVERNANCE_CHANGE_NOT_FOUND");
  if (current.status !== "pending") throw new Error("GOVERNANCE_CHANGE_NOT_PENDING");
  if (!current.allow_self_approval && current.proposed_by === principalId) {
    governanceAudit(current, `governance.change.${decision}`, "denied", 409, {
      reason: "self_approval_forbidden",
    });
    throw new Error("GOVERNANCE_SELF_APPROVAL_FORBIDDEN");
  }
  if (current.approvals.some((approval) => approval.principal_id === principalId)) {
    throw new Error("GOVERNANCE_DUPLICATE_DECISION");
  }
  const timestamp = nowIso();
  const approvals = [
    ...current.approvals,
    {
      principal_id: principalId,
      decision,
      comment: input.comment?.trim() || null,
      decided_at: timestamp,
    },
  ];
  const approvalCount = approvals.filter((approval) => approval.decision === "approved").length;
  const status = decision === "rejected"
    ? "rejected" as const
    : approvalCount >= current.required_approvals
      ? "approved" as const
      : "pending" as const;
  const next = writeChange({
    ...current,
    approvals,
    status,
    approved_at: status === "approved" ? timestamp : null,
    updated_at: timestamp,
  });
  governanceAudit(next, `governance.change.${decision}`, "allowed", 200, {
    approval_count: approvalCount,
    status,
  });
  return next;
}

function applyMutation(change: GovernanceChangeRecord): Record<string, unknown> {
  let record: AgentDefinitionRecord | SkillRecord | WorkflowTemplateRecord;
  switch (change.action) {
    case "agent.upsert": {
      const result = upsertAgentDefinition({
        workspaceId: change.workspace_id,
        agentId: change.resource_id,
        name: String(change.payload.name || change.resource_id),
        description: typeof change.payload.description === "string"
          ? change.payload.description
          : "",
        version: isPlainObject(change.payload.version) ? change.payload.version : undefined,
        metadata: isPlainObject(change.payload.metadata) ? change.payload.metadata : undefined,
        createdBy: change.applied_by || "governance",
      });
      record = result.definition;
      break;
    }
    case "agent.disable":
      record = disableAgentDefinition(change.resource_id, change.workspace_id);
      break;
    case "skill.upsert":
      record = upsertSkill({
        ...(change.payload as unknown as UpsertSkillRequest),
        skill_id: change.resource_id,
      });
      break;
    case "skill.disable":
      record = disableSkill(change.resource_id);
      break;
    case "template.publish":
      record = publishTemplate(change.resource_id);
      break;
    case "template.archive":
      record = archiveTemplate(change.resource_id);
      break;
  }
  return {
    resource_type: change.resource_type,
    resource_id: change.resource_id,
    status: record.status,
    updated_at: record.updated_at,
  };
}

export function applyGovernanceChange(changeId: string): GovernanceChangeRecord {
  const { principalId } = requestIdentity();
  const current = getGovernanceChange(changeId);
  if (!current) throw new Error("GOVERNANCE_CHANGE_NOT_FOUND");
  if (current.status !== "approved") throw new Error("GOVERNANCE_CHANGE_NOT_APPROVED");
  const latest = currentResource(current.action, current.resource_id);
  if (digest(latest) !== current.base_digest) {
    const conflicted = writeChange({
      ...current,
      status: "conflicted",
      conflict_reason: "RESOURCE_CHANGED_SINCE_PROPOSAL",
      updated_at: nowIso(),
    });
    governanceAudit(conflicted, "governance.change.apply", "error", 409, {
      reason: conflicted.conflict_reason,
    });
    return conflicted;
  }
  const result = applyMutation(current);
  const timestamp = nowIso();
  const applied = writeChange({
    ...current,
    status: "applied",
    applied_by: principalId,
    applied_at: timestamp,
    result,
    conflict_reason: null,
    updated_at: timestamp,
  });
  governanceAudit(applied, "governance.change.apply", "allowed", 200);
  return applied;
}
