import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  ROLE_PERMISSIONS,
  type RequestAuthContext,
  type WorkspaceRole,
} from "@my-mate/shared-types/identity";
import { getSession } from "../src/session-store.js";
import { SESSIONS_DIR } from "../src/config.js";
import { getJsonStorageBackend } from "../src/storage-backend.js";
import { migrateLegacyWorkspaceRecords } from "../src/workspace-migration.js";
import path from "node:path";
import { getJson, postJson, putJson, resetTestRoot, startTestServer } from "./helpers.js";

const SECRET = "tenancy-test-secret";

function authHeaders(input: {
  principalId: string;
  workspaceId: string;
  role: WorkspaceRole;
  signatureSecret?: string;
}): Record<string, string> {
  const workspace = {
    workspace_id: input.workspaceId,
    workspace_name: input.workspaceId.toUpperCase(),
    role: input.role,
  };
  const context: RequestAuthContext = {
    schema_version: 1,
    principal: {
      principal_id: input.principalId,
      display_name: input.principalId,
      principal_type: "user",
    },
    memberships: [workspace],
    selected_workspace: workspace,
    permissions: ROLE_PERMISSIONS[input.role],
    auth_method: "bearer",
    issued_at: new Date().toISOString(),
    request_id: `request-${input.principalId}-${input.workspaceId}`,
  };
  const payload = Buffer.from(JSON.stringify(context), "utf-8").toString("base64url");
  const signature = createHmac("sha256", input.signatureSecret ?? SECRET)
    .update(payload)
    .digest("base64url");
  return {
    "x-my-mate-auth-context": payload,
    "x-my-mate-auth-signature": signature,
    "x-my-mate-workspace-id": input.workspaceId,
  };
}

test("legacy workspace records migrate deterministically to default", () => {
  resetTestRoot();
  const storage = getJsonStorageBackend();
  const legacyPath = path.join(SESSIONS_DIR, "legacy-session.json");
  storage.writeJson(legacyPath, { session_id: "legacy-session", title: "Legacy" });
  const first = migrateLegacyWorkspaceRecords();
  const second = migrateLegacyWorkspaceRecords();
  assert.equal(first.migrated, 1);
  assert.equal(second.migrated, 0);
  assert.equal(storage.readJson<{ workspace_id: string }>(legacyPath).workspace_id, "default");
});

test("trusted identities enforce workspace isolation, actor integrity, roles, and audit chain", async () => {
  resetTestRoot();
  const server = await startTestServer({
    security: { internalAuthSecret: SECRET, allowDevelopmentIdentity: false },
  });
  const alphaOwner = authHeaders({ principalId: "alpha-owner", workspaceId: "alpha", role: "owner" });
  const betaOwner = authHeaders({ principalId: "beta-owner", workspaceId: "beta", role: "owner" });
  const betaViewer = authHeaders({ principalId: "beta-viewer", workspaceId: "beta", role: "viewer" });
  try {
    const invalid = await getJson(`${server.baseUrl}/api/auth/me`, authHeaders({
      principalId: "attacker",
      workspaceId: "alpha",
      role: "owner",
      signatureSecret: "wrong-secret",
    }));
    assert.equal(invalid.status, 401);

    const alphaCreate = await postJson(
      `${server.baseUrl}/api/sessions`,
      { title: "Alpha mission", created_by: "spoofed-user" },
      alphaOwner,
    );
    const betaCreate = await postJson(
      `${server.baseUrl}/api/sessions`,
      { title: "Beta mission" },
      betaOwner,
    );
    assert.equal(alphaCreate.status, 201);
    assert.equal(betaCreate.status, 201);
    const alphaSessionId = alphaCreate.body.session.session_id as string;
    const betaSessionId = betaCreate.body.session.session_id as string;
    assert.equal(getSession(alphaSessionId)?.workspace_id, "alpha");
    assert.equal(getSession(alphaSessionId)?.created_by, "alpha-owner");

    const crossWorkspace = await getJson(
      `${server.baseUrl}/api/sessions/${alphaSessionId}`,
      betaOwner,
    );
    assert.equal(crossWorkspace.status, 404);

    const betaList = await getJson(`${server.baseUrl}/api/sessions`, betaOwner);
    assert.deepEqual(betaList.body.items.map((item: { session_id: string }) => item.session_id), [betaSessionId]);

    const denied = await postJson(
      `${server.baseUrl}/api/sessions`,
      { title: "Viewer cannot create" },
      betaViewer,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "permission_denied");

    const lastOwner = await putJson(
      `${server.baseUrl}/api/workspaces/beta/members/beta-owner`,
      { display_name: "Beta Owner", principal_type: "user", role: "viewer", status: "active" },
      betaOwner,
    );
    assert.equal(lastOwner.status, 409);
    assert.equal(lastOwner.body.code, "last_workspace_owner");

    const sharedProfile = {
      profile_id: "shared-agent-id",
      name: "Alpha Shared Agent",
      description: "Tenant ownership test",
      openclaw_agent_id: "alpha-agent",
      default_skills: [],
      allowed_tools: ["read"],
      policy_tags: [],
    };
    const alphaProfile = await postJson(
      `${server.baseUrl}/api/registry/agent-profiles`,
      sharedProfile,
      alphaOwner,
    );
    assert.equal(alphaProfile.status, 201);
    const betaProfiles = await getJson(`${server.baseUrl}/api/registry/agent-profiles`, betaOwner);
    assert.equal(betaProfiles.body.items.length, 0);
    const conflictingProfile = await postJson(
      `${server.baseUrl}/api/registry/agent-profiles`,
      { ...sharedProfile, name: "Beta Overwrite Attempt" },
      betaOwner,
    );
    assert.equal(conflictingProfile.status, 400);
    const alphaProfiles = await getJson(`${server.baseUrl}/api/registry/agent-profiles`, alphaOwner);
    assert.equal(alphaProfiles.body.items[0].name, "Alpha Shared Agent");

    const promote = await putJson(
      `${server.baseUrl}/api/workspaces/beta/members/beta-viewer`,
      { display_name: "Beta Viewer", principal_type: "user", role: "operator", status: "active" },
      betaOwner,
    );
    assert.equal(promote.status, 200);
    const allowedAfterPromotion = await postJson(
      `${server.baseUrl}/api/sessions`,
      { title: "Operator mission" },
      betaViewer,
    );
    assert.equal(allowedAfterPromotion.status, 201);

    const audit = await getJson(`${server.baseUrl}/api/audit-events?limit=100`, betaOwner);
    assert.equal(audit.status, 200);
    assert.equal(audit.body.chain_verified, true);
    assert.ok(audit.body.items.some((event: { outcome: string; principal_id: string }) =>
      event.outcome === "denied" && event.principal_id === "beta-viewer"));
    assert.ok(audit.body.items.every((event: { path: string }) => !event.path.startsWith("/api/api/")));
    assert.ok(audit.body.items.some((event: { path: string; resource_type: string }) =>
      event.path === "/api/sessions" && event.resource_type === "sessions"));
  } finally {
    await server.close();
  }
});
