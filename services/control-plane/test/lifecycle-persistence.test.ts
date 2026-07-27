import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AGENT_RUNS_DIR, AGENT_TASKS_DIR, SESSIONS_DIR } from "../src/config.js";
import { getAgentTask } from "../src/agent-orchestration-store.js";
import { getAgentRun } from "../src/agent-runtime-store.js";
import { DomainError } from "../src/domain-error.js";
import { createSession, getSession, saveSession } from "../src/session-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

function writeJson(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value)}\n`, "utf8");
}

test("persistence readers reject unknown Session, AgentTask, and AgentRun statuses", () => {
  resetTestRoot();
  const session = createSession({ title: "Invalid persisted status" });
  writeJson(path.join(SESSIONS_DIR, `${session.session_id}.json`), { ...session, status: "mystery" });
  assert.throws(() => getSession(session.session_id), (error: unknown) => (error as { code?: string }).code === "invalid_lifecycle_status");

  writeJson(path.join(AGENT_TASKS_DIR, "default", "task-invalid.json"), { status: "mystery" });
  assert.throws(() => getAgentTask("default", "task-invalid"), (error: unknown) => (error as { code?: string }).code === "invalid_lifecycle_status");

  writeJson(path.join(AGENT_RUNS_DIR, "run-invalid.json"), { status: "mystery" });
  assert.throws(() => getAgentRun("run-invalid"), (error: unknown) => (error as { code?: string }).code === "invalid_lifecycle_status");
});

test("Session completion can reopen for a new conversation turn while invalid schema writes fail closed", () => {
  resetTestRoot();
  const session = createSession({ title: "Multi-turn Session" });
  session.status = "completed";
  saveSession(session);
  session.status = "running";
  assert.equal(saveSession(session).status, "running");

  assert.throws(
    () => saveSession({ ...session, title: 42 as unknown as string }),
    (error: unknown) => error instanceof DomainError && error.code === "schema_validation_failed" && error.httpStatus === 422,
  );
});

test("Agent DAG HTTP errors expose the stable DomainError contract", async () => {
  resetTestRoot();
  const server = await startTestServer();
  try {
    const response = await postJson(`${server.baseUrl}/api/agent-dags/missing/retry`, {});
    assert.equal(response.status, 404);
    assert.equal(response.body.code, "agent_dag_not_found");
    assert.equal(response.body.retryable, false);
    assert.equal(response.body.severity, "error");
    assert.equal(response.body.domain, "orchestration");
    assert.match(String(response.body.remediation), /Refresh/u);

    const detail = await getJson(`${server.baseUrl}/api/agent-dags/missing`);
    assert.equal(detail.status, 404);
  } finally {
    await server.close();
  }
});
