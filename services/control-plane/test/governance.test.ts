import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  ROLE_PERMISSIONS,
  type RequestAuthContext,
  type WorkspaceRole,
} from "@my-mate/shared-types/identity";
import { upsertAgentDefinition } from "../src/agent-runtime-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

const SECRET = "governance-test-secret";

function authHeaders(input: {
  principalId: string;
  workspaceId: string;
  role: WorkspaceRole;
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
    request_id: `governance-${input.principalId}-${input.workspaceId}`,
  };
  const payload = Buffer.from(JSON.stringify(context), "utf-8").toString("base64url");
  const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return {
    "x-my-mate-auth-context": payload,
    "x-my-mate-auth-signature": signature,
    "x-my-mate-workspace-id": input.workspaceId,
  };
}

const agentPayload = {
  agent_id: "governed-agent",
  name: "Governed Agent",
  description: "Governance protocol fixture",
  version: {
    role: "worker" as const,
    responsibility: "Execute governed test work.",
    tool_policy: { allowed_tools: ["read"], denied_tools: [], max_tool_rounds: 8 },
    runtime_policy: { runtime: "native" as const, sandbox: "auto" as const, timeout_seconds: 300 },
  },
};

const templateDraftPayload = {
  template_id: "governed-template",
  name: "Governed Template",
  description: "Governance route protection fixture",
  workspace_scope: "alpha",
  input_schema: {},
  policy: {
    max_parallel_nodes: 1,
    default_timeout_seconds: 300,
    budget_policy: {},
    approval_policy: {},
  },
  agent_profile_bindings: {},
  nodes: [
    {
      id: "node_governed",
      name: "Governed Task",
      type: "agent_task",
      agent_profile: "governed-agent",
      allowed_skills: [],
      config: { allowed_tools: [], output_contract: {} },
      retry_policy: { max_attempts: 1, backoff_seconds: 0 },
      timeout_seconds: 300,
      parallelism: 1,
      approval_kind: null,
      human_input_schema: null,
    },
  ],
  edges: [],
  metadata: {},
};

test("governance enforced mode requires independent approval and detects baseline drift", async () => {
  resetTestRoot();
  const server = await startTestServer({
    security: { internalAuthSecret: SECRET, allowDevelopmentIdentity: false },
  });
  const owner = authHeaders({ principalId: "alpha-owner", workspaceId: "alpha", role: "owner" });
  const reviewer = authHeaders({ principalId: "alpha-admin", workspaceId: "alpha", role: "admin" });
  const operator = authHeaders({ principalId: "alpha-operator", workspaceId: "alpha", role: "operator" });
  const betaOwner = authHeaders({ principalId: "beta-owner", workspaceId: "beta", role: "owner" });

  try {
    const initialPolicy = await getJson(`${server.baseUrl}/api/governance/policy`, owner);
    assert.equal(initialPolicy.status, 200);
    assert.equal(initialPolicy.body.mode, "advisory");

    const templateDraft = await postJson(
      `${server.baseUrl}/api/templates`,
      templateDraftPayload,
      owner,
    );
    assert.equal(templateDraft.status, 201);

    const enforced = await postJson(
      `${server.baseUrl}/api/governance/policy`,
      {
        mode: "enforced",
        required_approvals: 1,
        allow_self_approval: false,
      },
      owner,
    );
    assert.equal(enforced.status, 200);
    assert.equal(enforced.body.mode, "enforced");

    const protectedRequests = [
      {
        action: "agent.upsert",
        path: "/api/agents",
        body: agentPayload,
      },
      {
        action: "agent.disable",
        path: "/api/agents/governed-agent/disable",
        body: {},
      },
      {
        action: "skill.upsert",
        path: "/api/registry/skills",
        body: { skill_id: "governed-skill", name: "Governed Skill" },
      },
      {
        action: "skill.disable",
        path: "/api/registry/skills/governed-skill/disable",
        body: {},
      },
      {
        action: "template.publish",
        path: "/api/templates/governed-template/publish",
        body: {},
      },
      {
        action: "template.archive",
        path: "/api/templates/governed-template/archive",
        body: {},
      },
    ] as const;
    for (const request of protectedRequests) {
      const direct = await postJson(`${server.baseUrl}${request.path}`, request.body, owner);
      assert.equal(direct.status, 409, request.action);
      assert.equal(direct.body.code, "governance_approval_required", request.action);
      assert.equal(direct.body.protected_action, request.action);
    }

    const proposed = await postJson(
      `${server.baseUrl}/api/governance/changes`,
      {
        action: "agent.upsert",
        resource_id: "governed-agent",
        reason: "Introduce a reviewed Native Agent",
        payload: agentPayload,
      },
      owner,
    );
    assert.equal(proposed.status, 201);
    assert.equal(proposed.body.status, "pending");
    const changeId = proposed.body.change_id as string;

    const selfApproval = await postJson(
      `${server.baseUrl}/api/governance/changes/${changeId}/approve`,
      { comment: "Self approval must fail" },
      owner,
    );
    assert.equal(selfApproval.status, 409);

    const operatorApproval = await postJson(
      `${server.baseUrl}/api/governance/changes/${changeId}/approve`,
      { comment: "Operator cannot review governance" },
      operator,
    );
    assert.equal(operatorApproval.status, 403);

    const approved = await postJson(
      `${server.baseUrl}/api/governance/changes/${changeId}/approve`,
      { comment: "Reviewed runtime and tool policy" },
      reviewer,
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, "approved");
    assert.equal(approved.body.approvals[0].principal_id, "alpha-admin");

    const applied = await postJson(
      `${server.baseUrl}/api/governance/changes/${changeId}/apply`,
      {},
      reviewer,
    );
    assert.equal(applied.status, 200);
    assert.equal(applied.body.status, "applied");
    assert.equal(applied.body.result.resource_id, "governed-agent");

    const agents = await getJson(`${server.baseUrl}/api/agents`, owner);
    assert.equal(agents.body.items.length, 1);
    assert.equal(agents.body.items[0].name, "Governed Agent");

    const driftProposal = await postJson(
      `${server.baseUrl}/api/governance/changes`,
      {
        action: "agent.upsert",
        resource_id: "governed-agent",
        reason: "Rename the governed Agent",
        payload: { ...agentPayload, name: "Governed Agent V2" },
      },
      owner,
    );
    assert.equal(driftProposal.status, 201);
    const driftChangeId = driftProposal.body.change_id as string;

    upsertAgentDefinition({
      workspaceId: "alpha",
      agentId: "governed-agent",
      name: "Concurrent Update",
      version: agentPayload.version,
    });

    const driftApproved = await postJson(
      `${server.baseUrl}/api/governance/changes/${driftChangeId}/approve`,
      {},
      reviewer,
    );
    assert.equal(driftApproved.body.status, "approved");
    const conflicted = await postJson(
      `${server.baseUrl}/api/governance/changes/${driftChangeId}/apply`,
      {},
      reviewer,
    );
    assert.equal(conflicted.status, 409);
    assert.equal(conflicted.body.status, "conflicted");
    assert.equal(conflicted.body.conflict_reason, "RESOURCE_CHANGED_SINCE_PROPOSAL");

    const crossWorkspace = await getJson(
      `${server.baseUrl}/api/governance/changes/${changeId}`,
      betaOwner,
    );
    assert.equal(crossWorkspace.status, 404);
    const betaChanges = await getJson(`${server.baseUrl}/api/governance/changes`, betaOwner);
    assert.equal(betaChanges.body.items.length, 0);

    const audit = await getJson(`${server.baseUrl}/api/audit-events?limit=100`, owner);
    assert.equal(audit.body.chain_verified, true);
    assert.ok(audit.body.items.some((event: { action: string }) =>
      event.action === "governance.change.proposed"));
    assert.ok(audit.body.items.some((event: { action: string; outcome: string }) =>
      event.action === "governance.change.apply" && event.outcome === "error"));
  } finally {
    await server.close();
  }
});
