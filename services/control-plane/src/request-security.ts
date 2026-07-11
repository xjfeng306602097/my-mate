import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ROLE_PERMISSIONS,
  WORKSPACE_ROLES,
  type RequestAuthContext,
  type WorkspacePermission,
  type WorkspaceRole,
} from "@my-mate/shared-types/identity";
import type { Request } from "express";
import { reconcileMembership } from "./workspace-store.js";

const requestContext = new AsyncLocalStorage<RequestAuthContext>();

export interface SecurityOptions {
  internalAuthSecret?: string;
  allowDevelopmentIdentity?: boolean;
}

export type AuthResolution =
  | { ok: true; context: RequestAuthContext }
  | { ok: false; status: 401 | 403; code: string; message: string };

function developmentContext(workspaceId: string): RequestAuthContext {
  const workspace = {
    workspace_id: workspaceId || "default",
    workspace_name: workspaceId === "default" ? "Default" : workspaceId,
    role: "owner" as const,
  };
  return {
    schema_version: 1,
    principal: {
      principal_id: "dev-user",
      display_name: "Development User",
      principal_type: "development",
    },
    memberships: [workspace],
    selected_workspace: workspace,
    permissions: ROLE_PERMISSIONS.owner,
    auth_method: "development",
    issued_at: new Date().toISOString(),
    request_id: "direct-development-request",
  };
}

function validRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && WORKSPACE_ROLES.includes(value as WorkspaceRole);
}

function parseContext(payload: string): RequestAuthContext | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as RequestAuthContext;
    if (
      parsed?.schema_version !== 1 ||
      typeof parsed.principal?.principal_id !== "string" ||
      typeof parsed.selected_workspace?.workspace_id !== "string" ||
      !validRole(parsed.selected_workspace.role) ||
      !Array.isArray(parsed.memberships)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function resolveTrustedRequestContext(
  req: Request,
  options: SecurityOptions,
): AuthResolution {
  const payload = req.header("x-my-mate-auth-context");
  const signature = req.header("x-my-mate-auth-signature");
  const secret = options.internalAuthSecret || "";
  if (!payload || !signature) {
    if (options.allowDevelopmentIdentity !== false && !secret) {
      const context = developmentContext(req.header("x-my-mate-workspace-id") || "default");
      reconcileMembership(context.selected_workspace, context.principal);
      return { ok: true, context };
    }
    return { ok: false, status: 401, code: "trusted_identity_required", message: "A trusted Gateway identity is required." };
  }
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return { ok: false, status: 401, code: "invalid_identity_signature", message: "The Gateway identity signature is invalid." };
  }
  const parsed = parseContext(payload);
  if (!parsed) {
    return { ok: false, status: 401, code: "invalid_identity_context", message: "The Gateway identity context is invalid." };
  }
  const issuedAt = Date.parse(parsed.issued_at);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 5 * 60 * 1000) {
    return { ok: false, status: 401, code: "identity_context_expired", message: "The Gateway identity context has expired." };
  }
  if (!parsed.memberships.some((membership) =>
    membership.workspace_id === parsed.selected_workspace.workspace_id && validRole(membership.role))) {
    return { ok: false, status: 403, code: "workspace_forbidden", message: "Selected workspace membership is missing." };
  }
  const membership = reconcileMembership(parsed.selected_workspace, parsed.principal);
  if (membership.status !== "active") {
    return { ok: false, status: 403, code: "workspace_membership_revoked", message: "Workspace membership has been revoked." };
  }
  const selectedWorkspace = {
    workspace_id: membership.workspace_id,
    workspace_name: parsed.selected_workspace.workspace_name,
    role: membership.role,
  };
  return {
    ok: true,
    context: {
      ...parsed,
      selected_workspace: selectedWorkspace,
      permissions: ROLE_PERMISSIONS[membership.role],
    },
  };
}

export function runWithRequestContext<T>(context: RequestAuthContext, callback: () => T): T {
  return requestContext.run(context, callback);
}

export function getRequestAuthContext(): RequestAuthContext | null {
  return requestContext.getStore() || null;
}

export function getActiveWorkspaceId(): string | null {
  return getRequestAuthContext()?.selected_workspace.workspace_id || null;
}

export function getActivePrincipalId(): string | null {
  const principal = getRequestAuthContext()?.principal;
  return principal && principal.principal_type !== "development" ? principal.principal_id : null;
}

export function hasPermission(permission: WorkspacePermission): boolean {
  return getRequestAuthContext()?.permissions.includes(permission) === true;
}

export function requiredPermission(req: Request): WorkspacePermission {
  const method = req.method.toUpperCase();
  const path = req.path;
  if (method === "GET") return path === "/audit-events" ? "audit.read" : "workspace.read";
  if (path === "/diagnostics/doctor") return "workspace.read";
  if (path.startsWith("/workspaces")) return "workspace.manage_members";
  if (
    path.startsWith("/templates") ||
    path.startsWith("/registry") ||
    path.startsWith("/orchestrator-profiles") ||
    path.startsWith("/agents")
  ) return "registry.manage";
  if (path.startsWith("/approvals") || path.startsWith("/human-inputs")) {
    return "gate.resolve";
  }
  if (/^\/runs\/[^/]+\/(scorecards|evaluations|replays|replay-plans)/.test(path)) {
    return "run.evaluate";
  }
  if (/^\/runs\/[^/]+\/(actions|nodes\/[^/]+\/actions|reruns)/.test(path)) {
    return "run.control";
  }
  if (method === "POST" && path === "/runs") return "run.create";
  if (method === "POST" && path === "/sessions") return "mission.create";
  if (path.startsWith("/sessions") || path.startsWith("/missions") || path.startsWith("/planner")) {
    return "mission.edit";
  }
  return "run.control";
}
