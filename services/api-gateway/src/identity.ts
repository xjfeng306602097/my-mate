import { createHmac, randomUUID } from "node:crypto";
import {
  ROLE_PERMISSIONS,
  type RequestAuthContext,
  type WorkspaceMembership,
} from "@my-mate/shared-types/identity";
import type { GatewayConfig, GatewayIdentity } from "./config.js";

export interface HeaderRequest {
  header(name: string): string | undefined;
}

export type IdentityResolution =
  | { ok: true; context: RequestAuthContext }
  | { ok: false; status: 401 | 403; code: string; message: string };

const developmentIdentity: GatewayIdentity = {
  token: "",
  principal: {
    principal_id: "dev-user",
    display_name: "Development User",
    principal_type: "development",
  },
  memberships: [{ workspace_id: "default", workspace_name: "Default", role: "owner" }],
};

function bearerToken(req: HeaderRequest): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(req.header("authorization") || "");
  return match?.[1]?.trim() || null;
}

function configuredIdentities(config: GatewayConfig): GatewayIdentity[] {
  const identities = [...config.identities];
  if (config.apiKey && !identities.some((identity) => identity.token === config.apiKey)) {
    identities.push({ ...developmentIdentity, token: config.apiKey });
  }
  return identities;
}

function selectWorkspace(
  memberships: WorkspaceMembership[],
  requestedWorkspaceId: string | undefined,
): WorkspaceMembership | null {
  const requested = requestedWorkspaceId?.trim();
  return requested
    ? memberships.find((membership) => membership.workspace_id === requested) || null
    : memberships[0] || null;
}

export function resolveRequestIdentity(req: HeaderRequest, config: GatewayConfig): IdentityResolution {
  const identities = configuredIdentities(config);
  const token = bearerToken(req);
  const identity = identities.length > 0
    ? identities.find((candidate) => candidate.token === token)
    : developmentIdentity;
  if (!identity) {
    return { ok: false, status: 401, code: "unauthorized", message: "Invalid API gateway token." };
  }
  const workspace = selectWorkspace(identity.memberships, req.header("x-my-mate-workspace-id"));
  if (!workspace) {
    return {
      ok: false,
      status: 403,
      code: "workspace_forbidden",
      message: "The authenticated principal is not a member of the requested workspace.",
    };
  }
  return {
    ok: true,
    context: {
      schema_version: 1,
      principal: identity.principal,
      memberships: identity.memberships,
      selected_workspace: workspace,
      permissions: ROLE_PERMISSIONS[workspace.role],
      auth_method: identities.length > 0 ? "bearer" : "development",
      issued_at: new Date().toISOString(),
      request_id: req.header("x-request-id") || `gw-${randomUUID()}`,
    },
  };
}

export function encodeSignedIdentity(
  context: RequestAuthContext,
  secret: string,
): { payload: string; signature: string } {
  const payload = Buffer.from(JSON.stringify(context), "utf-8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { payload, signature };
}
