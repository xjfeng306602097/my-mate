export const WORKSPACE_ROLES = ["owner", "admin", "operator", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_PERMISSIONS = [
  "workspace.read",
  "workspace.manage_members",
  "registry.manage",
  "governance.review",
  "mission.create",
  "mission.edit",
  "run.create",
  "run.control",
  "run.evaluate",
  "gate.resolve",
  "audit.read",
] as const;
export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly WorkspacePermission[]>> = {
  owner: WORKSPACE_PERMISSIONS,
  admin: WORKSPACE_PERMISSIONS,
  operator: [
    "workspace.read",
    "mission.create",
    "mission.edit",
    "run.create",
    "run.control",
    "run.evaluate",
    "gate.resolve",
    "audit.read",
  ],
  viewer: ["workspace.read", "audit.read"],
};

export interface WorkspaceMembership {
  workspace_id: string;
  workspace_name: string;
  role: WorkspaceRole;
}

export interface AuthenticatedPrincipal {
  principal_id: string;
  display_name: string;
  principal_type: "user" | "service" | "development";
}

export interface RequestAuthContext {
  schema_version: 1;
  principal: AuthenticatedPrincipal;
  memberships: readonly WorkspaceMembership[];
  selected_workspace: WorkspaceMembership;
  permissions: readonly WorkspacePermission[];
  auth_method: "bearer" | "development";
  issued_at: string;
  request_id: string;
}

export interface AuthMeResponse extends RequestAuthContext {
  available_workspaces: readonly WorkspaceMembership[];
}

export interface WorkspaceRecord {
  workspace_id: string;
  name: string;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMemberRecord {
  workspace_id: string;
  principal_id: string;
  display_name: string;
  principal_type: AuthenticatedPrincipal["principal_type"];
  role: WorkspaceRole;
  status: "active" | "revoked";
  created_at: string;
  updated_at: string;
}

export interface SecurityAuditEvent {
  schema_version: 1;
  audit_id: string;
  workspace_id: string;
  principal_id: string;
  principal_type: AuthenticatedPrincipal["principal_type"] | "unknown";
  action: string;
  permission: WorkspacePermission | null;
  method: string;
  path: string;
  resource_type: string | null;
  resource_id: string | null;
  outcome: "allowed" | "denied" | "error";
  status_code: number;
  request_id: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  previous_hash: string | null;
  hash: string;
  created_at: string;
}
