import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  ROLE_PERMISSIONS,
  type RequestAuthContext,
  type WorkspaceRole,
} from "@my-mate/shared-types/identity";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

const SECRET = "memory-test-secret";

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
    request_id: `memory-${input.principalId}-${input.workspaceId}`,
  };
  const payload = Buffer.from(JSON.stringify(context), "utf-8").toString("base64url");
  const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return {
    "x-my-mate-auth-context": payload,
    "x-my-mate-auth-signature": signature,
    "x-my-mate-workspace-id": input.workspaceId,
  };
}

async function requestJson(
  url: string,
  method: "PATCH" | "DELETE",
  body: unknown,
  headers: Record<string, string>,
) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.trim() ? JSON.parse(text) : null,
  };
}

test("memory records are structured, governed, and isolated by Workspace", async () => {
  resetTestRoot();
  const server = await startTestServer({
    security: { internalAuthSecret: SECRET, allowDevelopmentIdentity: false },
  });
  const alphaOwner = authHeaders({ principalId: "alpha-owner", workspaceId: "alpha", role: "owner" });
  const alphaOperator = authHeaders({ principalId: "alpha-operator", workspaceId: "alpha", role: "operator" });
  const alphaViewer = authHeaders({ principalId: "alpha-viewer", workspaceId: "alpha", role: "viewer" });
  const betaOwner = authHeaders({ principalId: "beta-owner", workspaceId: "beta", role: "owner" });
  try {
    const created = await postJson(`${server.baseUrl}/api/memories`, {
      scope_kind: "user",
      kind: "preference",
      content: "User prefers concise engineering explanations.",
      importance: 0.8,
      expires_at: "2030-01-01T00:00:00.000Z",
      tags: ["Communication", "communication"],
      source: {
        origin: "explicit_user",
        session_id: "session-alpha",
        message_ids: ["message-alpha"],
      },
    }, alphaOperator);
    assert.equal(created.status, 201);
    assert.match(created.body.memory_id, /^mem_/u);
    assert.equal(created.body.workspace_id, "alpha");
    assert.equal(created.body.scope_id, "alpha-operator");
    assert.equal(created.body.confidence, 1);
    assert.deepEqual(created.body.tags, ["communication"]);
    assert.equal(created.body.version, 1);

    const alphaList = await getJson(`${server.baseUrl}/api/memories`, alphaViewer);
    assert.equal(alphaList.status, 200);
    assert.equal(alphaList.body.items.length, 1);
    const betaList = await getJson(`${server.baseUrl}/api/memories`, betaOwner);
    assert.equal(betaList.status, 200);
    assert.equal(betaList.body.items.length, 0);

    const viewerWrite = await postJson(`${server.baseUrl}/api/memories`, {
      content: "Viewer must not write this memory.",
    }, alphaViewer);
    assert.equal(viewerWrite.status, 403);
    assert.equal(viewerWrite.body.code, "permission_denied");

    const rejectedSecret = await postJson(`${server.baseUrl}/api/memories`, {
      content: "api_key=sk-abcdefghijklmnopqrstuvwxyz123456",
    }, alphaOwner);
    assert.equal(rejectedSecret.status, 422);
    assert.equal(rejectedSecret.body.code, "memory_sensitive_content");

    const updated = await requestJson(
      `${server.baseUrl}/api/memories/${encodeURIComponent(created.body.memory_id)}`,
      "PATCH",
      {
        content: "User prefers concise, evidence-backed engineering explanations.",
        expires_at: null,
      },
      alphaOperator,
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal(updated.body.expires_at, null);

    const candidate = await postJson(`${server.baseUrl}/api/memory-candidates`, {
      proposed_memory: {
        scope_kind: "workspace",
        kind: "convention",
        content: "Generated deliverables belong in the task output directory.",
        confidence: 0.85,
        source: {
          origin: "background_review",
          session_id: "session-alpha",
          message_ids: ["message-review"],
        },
      },
      rationale: "Repeated durable workspace convention.",
      risk: "low",
      autonomy_mode: "assisted",
    }, alphaOperator);
    assert.equal(candidate.status, 201);
    assert.equal(candidate.body.status, "pending");
    assert.equal(candidate.body.operation, "create");

    const viewerCandidates = await getJson(`${server.baseUrl}/api/memory-candidates`, alphaViewer);
    assert.equal(viewerCandidates.status, 403);

    const approved = await postJson(
      `${server.baseUrl}/api/memory-candidates/${encodeURIComponent(candidate.body.candidate_id)}/approve`,
      { note: "Confirmed by workspace owner." },
      alphaOwner,
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.candidate.status, "approved");
    assert.equal(approved.body.candidate.committed_memory_id, approved.body.memory.memory_id);
    assert.equal(approved.body.memory.source.origin, "background_review");

    const approveAgain = await postJson(
      `${server.baseUrl}/api/memory-candidates/${encodeURIComponent(candidate.body.candidate_id)}/approve`,
      {},
      alphaOwner,
    );
    assert.equal(approveAgain.status, 409);
    assert.equal(approveAgain.body.code, "memory_candidate_resolved");

    const removed = await requestJson(
      `${server.baseUrl}/api/memories/${encodeURIComponent(created.body.memory_id)}`,
      "DELETE",
      null,
      alphaOperator,
    );
    assert.equal(removed.status, 200);
    assert.equal(removed.body.status, "deleted");
    assert.equal(removed.body.version, 3);

    const active = await getJson(`${server.baseUrl}/api/memories`, alphaViewer);
    assert.equal(active.body.items.length, 1);
    const all = await getJson(`${server.baseUrl}/api/memories?status=all`, alphaViewer);
    assert.equal(all.body.items.length, 2);

    const audit = await getJson(`${server.baseUrl}/api/audit-events?limit=100`, alphaOwner);
    assert.equal(audit.body.chain_verified, true);
    assert.ok(audit.body.items.some((event: { action: string }) => event.action === "memory.write"));
    assert.ok(audit.body.items.some((event: { action: string }) => event.action === "memory.review"));
  } finally {
    await server.close();
  }
});
