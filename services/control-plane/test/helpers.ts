import fs from "node:fs";
import path from "node:path";
import type { ExecutionAdapter } from "../src/execution-adapter.js";
import type { NodeAction, RunAction } from "../src/control-actions.js";
import { createApp } from "../src/app.js";
import {
  APPROVALS_DIR,
  ARTIFACTS_DIR,
  EVENTS_DIR,
  AGENT_PROFILES_DIR,
  HUMAN_INPUTS_DIR,
  NODE_RUNS_DIR,
  overrideDataDir,
  RUN_PLANS_DIR,
  RUNS_DIR,
  SESSION_ATTACHMENTS_DIR,
  SESSION_INTERVENTIONS_DIR,
  SESSION_MESSAGES_DIR,
  SESSIONS_DIR,
  SKILLS_DIR,
  TEMPLATES_DIR,
} from "../src/config.js";
import { listApprovals } from "../src/approval-store.js";
import { listHumanInputs } from "../src/human-input-store.js";
import { upsertAgentProfile, upsertSkill } from "../src/registry-store.js";
import type { DispatchEnvelope, UpsertAgentProfileRequest, UpsertSkillRequest } from "../src/types.js";

export const TEST_ROOT = path.join(
  path.resolve("C:/project/my-mate"),
  "tmp",
  "test-control-plane",
);

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function resetTestRoot(): void {
  ensureDir(TEST_ROOT);
  const nextDataDir = path.join(TEST_ROOT, `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  process.env.MY_MATE_DATA_DIR = nextDataDir;
  overrideDataDir(nextDataDir);
}

export function buildPublishedTemplate(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-06-07T00:00:00.000Z";
  return {
    template_id: "mobile-test-template",
    version: 1,
    name: "Mobile Test Template",
    status: "published",
    description: "Published template for control-plane tests",
    workspace_scope: "default",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string" },
      },
      required: ["goal"],
    },
    policy: {
      max_parallel_nodes: 1,
      default_timeout_seconds: 900,
      budget_policy: {},
      approval_policy: {},
    },
    agent_profile_bindings: {
      backend: "backend",
    },
    nodes: [
      {
        id: "node_backend",
        name: "Backend Task",
        type: "agent_task",
        agent_profile: "backend",
        allowed_skills: ["coding-agent"],
        config: {
          allowed_tools: ["read", "write", "shell"],
          output_contract: {
            expected_artifacts: ["agent-report"],
          },
        },
        retry_policy: {
          max_attempts: 1,
          backoff_seconds: 5,
        },
        timeout_seconds: 900,
        parallelism: 1,
        approval_kind: null,
        human_input_schema: null,
      },
    ],
    edges: [],
    metadata: {},
    created_at: timestamp,
    updated_at: timestamp,
    published_at: timestamp,
    ...overrides,
  };
}

export function seedTemplate(template = buildPublishedTemplate()): void {
  writeJson(path.join(TEMPLATES_DIR, `${template.template_id}.json`), template);
}

export function seedAgentProfile(input: UpsertAgentProfileRequest): void {
  upsertAgentProfile(input);
}

export function seedSkill(input: UpsertSkillRequest): void {
  upsertSkill(input);
}

export function cleanupTestArtifacts(input: {
  templateId?: string;
  runId?: string;
  agentProfileId?: string;
  skillId?: string;
  sessionId?: string;
}): void {
  if (input.templateId) {
    fs.rmSync(path.join(TEMPLATES_DIR, `${input.templateId}.json`), {
      force: true,
    });
  }

  if (input.runId) {
    fs.rmSync(path.join(RUNS_DIR, `${input.runId}.json`), { force: true });
    fs.rmSync(path.join(RUN_PLANS_DIR, `${input.runId}.json`), { force: true });
    fs.rmSync(path.join(NODE_RUNS_DIR, input.runId), { recursive: true, force: true });
    fs.rmSync(path.join(EVENTS_DIR, input.runId), { recursive: true, force: true });
    fs.rmSync(path.join(ARTIFACTS_DIR, input.runId), { recursive: true, force: true });

    for (const approval of listApprovals()) {
      if (approval.run_id === input.runId) {
        fs.rmSync(path.join(APPROVALS_DIR, `${approval.approval_id}.json`), {
          force: true,
        });
      }
    }

    for (const humanInput of listHumanInputs()) {
      if (humanInput.run_id === input.runId) {
        fs.rmSync(path.join(HUMAN_INPUTS_DIR, `${humanInput.input_request_id}.json`), {
          force: true,
        });
      }
    }
  }

  if (input.agentProfileId) {
    fs.rmSync(path.join(AGENT_PROFILES_DIR, `${input.agentProfileId}.json`), {
      force: true,
    });
  }

  if (input.skillId) {
    fs.rmSync(path.join(SKILLS_DIR, `${input.skillId}.json`), {
      force: true,
    });
  }

  if (input.sessionId) {
    fs.rmSync(path.join(SESSIONS_DIR, `${input.sessionId}.json`), {
      force: true,
    });
    fs.rmSync(path.join(SESSION_MESSAGES_DIR, input.sessionId), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(SESSION_INTERVENTIONS_DIR, input.sessionId), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(SESSION_ATTACHMENTS_DIR, input.sessionId), {
      recursive: true,
      force: true,
    });
  }
}

export interface StubExecutionAdapter extends ExecutionAdapter {
  runActions: Array<{ runId: string; action: RunAction }>;
  nodeActions: Array<{ runId: string; nodeRunId: string; action: NodeAction }>;
  maintenanceActions: string[];
  dispatchEnvelopes: DispatchEnvelope[];
}

export function createStubExecutionAdapter(options?: {
  maintenanceResult?: Awaited<ReturnType<ExecutionAdapter["runMaintenance"]>>;
}): StubExecutionAdapter {
  const runActions: Array<{ runId: string; action: RunAction }> = [];
  const nodeActions: Array<{ runId: string; nodeRunId: string; action: NodeAction }> = [];
  const maintenanceActions: string[] = [];
  const dispatchEnvelopes: DispatchEnvelope[] = [];

  return {
    kind: "stub",
    enqueueRun() {
      // no-op
    },
    notifyRunAction(runId, action) {
      runActions.push({ runId, action });
    },
    notifyNodeAction(runId, nodeRunId, action) {
      nodeActions.push({ runId, nodeRunId, action });
    },
    async dispatchNode(envelope) {
      dispatchEnvelopes.push(envelope);
      return {
        dispatch_id: `disp_stub_${envelope.node_run_id}`,
        openclaw_task_id: null,
        openclaw_session_id: null,
        status: "accepted",
      };
    },
    async handleReport() {
      // no-op
    },
    async runMaintenance(action) {
      maintenanceActions.push(action);
      return (
        options?.maintenanceResult || {
          action: "dispatch_sweep",
          adapter_kind: "stub",
          supported: false,
          message: "Stub adapter does not maintain external dispatch records.",
          summary: null,
        }
      );
    },
    runActions,
    nodeActions,
    maintenanceActions,
    dispatchEnvelopes,
  };
}

export async function startTestServer(input?: { executionAdapter?: ExecutionAdapter }) {
  const app = createApp(input);
  return await new Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose an address.");
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              done();
            });
          }),
      });
    });
  });
}

export async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: text.trim() ? JSON.parse(text) : null,
  };
}

export async function putJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: text.trim() ? JSON.parse(text) : null,
  };
}

export async function getJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers,
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: text.trim() ? JSON.parse(text) : null,
  };
}
