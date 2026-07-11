import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getCurrentIdentity, setActiveWorkspaceId } from "../lib/api";

test("mobile API sends bearer and selected workspace identity headers", async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = process.env.EXPO_PUBLIC_MY_MATE_API_KEY;
  const observed: Array<{ authorization: string | null; workspaceId: string | null }> = [];
  process.env.EXPO_PUBLIC_MY_MATE_API_KEY = "mobile-token";
  setActiveWorkspaceId("workspace-mobile");
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    observed.push({
      authorization: headers.get("authorization"),
      workspaceId: headers.get("x-my-mate-workspace-id"),
    });
    return new Response(JSON.stringify({
      schema_version: 1,
      principal: { principal_id: "mobile-user", display_name: "Mobile User", principal_type: "user" },
      memberships: [{ workspace_id: "workspace-mobile", workspace_name: "Mobile", role: "operator" }],
      selected_workspace: { workspace_id: "workspace-mobile", workspace_name: "Mobile", role: "operator" },
      permissions: ["workspace.read"],
      auth_method: "bearer",
      issued_at: "2026-07-11T00:00:00.000Z",
      request_id: "mobile-test",
      available_workspaces: [{ workspace_id: "workspace-mobile", workspace_name: "Mobile", role: "operator" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const identity = await getCurrentIdentity();
    assert.equal(identity.principal.principal_id, "mobile-user");
    assert.deepEqual(observed, [{
      authorization: "Bearer mobile-token",
      workspaceId: "workspace-mobile",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.EXPO_PUBLIC_MY_MATE_API_KEY;
    else process.env.EXPO_PUBLIC_MY_MATE_API_KEY = previousApiKey;
  }
});

test("mobile account surface exposes workspace, members, roles, and audit", () => {
  const source = fs.readFileSync(path.resolve("app/account.tsx"), "utf-8");
  for (const marker of [
    "available_workspaces",
    "getWorkspaceMembers",
    "updateWorkspaceMember",
    "getSecurityAuditEvents",
    "workspace.manage_members",
  ]) assert.ok(source.includes(marker), `missing account marker: ${marker}`);
});
