import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startManagedNodeService } from "./lib/node-service-launcher.mjs";

const repoRoot = path.resolve("C:/project/my-mate");
const controlPlaneDir = path.join(repoRoot, "services", "control-plane");
const executionAdapterDir = path.join(repoRoot, "services", "execution-adapter");
const smokeRoot = path.join(repoRoot, "tmp", "restart-recovery-smoke");
const controlPlaneDataDir = path.join(smokeRoot, "control-plane-data");
const executionAdapterDataDir = path.join(smokeRoot, "execution-adapter-data");
const logsDir = path.join(smokeRoot, "logs");

const controlPlanePort = 4111;
const executionAdapterPort = 4120;
const controlPlaneBaseUrl = `http://127.0.0.1:${controlPlanePort}`;
const executionAdapterBaseUrl = `http://127.0.0.1:${executionAdapterPort}`;

const bridgeApiKey = "smoke-bridge-key";
const callbackToken = "smoke-callback-token";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function rimraf(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

async function waitForHealth(url, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError}`);
}

async function postJson(url, input, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  let json = null;
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    body: json,
  };
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed (${response.status}): ${text}`);
  }
  return text.trim() ? JSON.parse(text) : null;
}

function createDispatchRecord(overrides = {}) {
  const request = {
    run_id: "run_smoke_001",
    node_run_id: "node_run_smoke_001",
    node_id: "node_backend",
    node_name: "Backend Task",
    node_type: "agent_task",
    template_id: "e2e-backend-single-node",
    template_version: 1,
    workspace_id: "default",
    requested_by: "smoke",
    intent: "Restart recovery smoke verification",
    openclaw_agent_id: "backend",
    allowed_skills: ["coding-agent"],
    allowed_tools: ["read", "write", "shell"],
    timeout_seconds: 900,
    parallelism_budget: 1,
    retry_policy: {
      max_attempts: 1,
      attempt: 1,
    },
    input_payload: {
      run_inputs: {
        project_slug: "edgedev",
        goal: "Restart recovery smoke verification",
        title: "Restart Recovery Smoke",
        description: "Verify startup recovery and dispatch sweep plumbing.",
      },
    },
    output_contract: {
      expected_artifacts: ["agent-report", "handoff"],
    },
    callback: {
      report_url: `${controlPlaneBaseUrl}/api/internal/openclaw/reports`,
      bearer_token: callbackToken,
    },
    trace_context: {
      run_id: "run_smoke_001",
      node_run_id: "node_run_smoke_001",
      requested_by: "smoke",
    },
    openclaw_runtime: {
      execution_mode: "container-exec",
      gateway_base_url: "http://127.0.0.1:18789",
      approval_console_base_url: "http://127.0.0.1:4315",
      container_name: "openclaw-local",
    },
  };

  return {
    dispatch_id: "disp_smoke_001",
    run_id: request.run_id,
    node_run_id: request.node_run_id,
    node_id: request.node_id,
    node_name: request.node_name,
    openclaw_agent_id: request.openclaw_agent_id,
    status: "running",
    mode: "container-exec",
    callback_url: request.callback.report_url,
    callback_bearer_token: request.callback.bearer_token,
    openclaw_task_id: "task_smoke_001",
    openclaw_session_id: "bridge-disp_smoke_001",
    created_at: "2026-06-07T08:00:00.000Z",
    updated_at: "2026-06-07T08:00:00.000Z",
    last_error: null,
    native_handoff_file: null,
    openclaw_state_path: null,
    openclaw_dispatch_file: null,
    openclaw_result_session_id: "bridge-disp_smoke_001",
    openclaw_result_session_key: "agent:backend:explicit:bridge-disp_smoke_001",
    openclaw_result_session_file: null,
    openclaw_result_run_id: "runid_smoke_001",
    openclaw_result_trajectory_dir: null,
    poll_started_at: "2026-06-07T08:00:00.000Z",
    last_polled_at: "2026-06-07T08:00:00.000Z",
    last_reported_status: "running",
    direct_agent: {
      attempted: true,
      sessionId: "bridge-disp_smoke_001",
      sessionKey: "agent:backend:explicit:bridge-disp_smoke_001",
      sessionFile: null,
      runId: null,
      taskId: null,
      stdout: "",
      stderr: "",
      exitCode: 0,
      completionText: null,
      reportText: null,
      mode: "async-task",
    },
    request_snapshot: request,
    ...overrides,
  };
}

function createRunRecord() {
  return {
    run_id: "run_smoke_001",
    template_id: "e2e-backend-single-node",
    template_version: 1,
    workspace_id: "default",
    requested_by: "smoke",
    intent: "Restart recovery smoke verification",
    status: "running",
    current_summary: "Smoke run seeded for maintenance verification",
    waiting_reason: null,
    blocked_reason: null,
    started_at: "2026-06-07T08:00:00.000Z",
    finished_at: null,
    last_event_id: null,
    created_at: "2026-06-07T08:00:00.000Z",
    updated_at: "2026-06-07T08:00:00.000Z",
    inputs: {
      project_slug: "edgedev",
      goal: "Restart recovery smoke verification",
    },
  };
}

function createRunPlanRecord() {
  return {
    run_id: "run_smoke_001",
    template_id: "e2e-backend-single-node",
    template_version: 1,
    workspace_id: "default",
    requested_by: "smoke",
    intent: "Restart recovery smoke verification",
    inputs: {
      project_slug: "edgedev",
      goal: "Restart recovery smoke verification",
    },
    compiled_nodes: [
      {
        node_run_id: "node_run_smoke_001",
        node_id: "node_backend",
        name: "Backend Task",
        type: "agent_task",
        agent_profile: "backend",
        openclaw_agent_id: "backend",
        allowed_skills: ["coding-agent"],
        allowed_tools: ["read", "write", "shell"],
        approval_kind: null,
        human_input_schema: null,
        status: "running",
        retry_policy: {
          max_attempts: 1,
          attempt: 1,
        },
        timeout_seconds: 900,
        parallelism_budget: 1,
        input_payload: {
          run_inputs: {
            project_slug: "edgedev",
          },
          node_config: {
            allowed_tools: ["read", "write", "shell"],
          },
        },
        output_contract: {
          expected_artifacts: ["agent-report", "handoff"],
        },
        execution_ref: {
          openclaw_task_id: "task_smoke_001",
          openclaw_session_id: "bridge-disp_smoke_001",
        },
      },
    ],
    edges: [],
    frontier: [],
    policy_snapshot: {},
    planner_context: {},
    status: "running",
    created_at: "2026-06-07T08:00:00.000Z",
  };
}

function createNodeRunRecord() {
  return {
    node_run_id: "node_run_smoke_001",
    run_id: "run_smoke_001",
    status: "running",
    progress: {
      percent: 50,
      message: "Smoke node seeded for maintenance verification",
      updated_at: "2026-06-07T08:00:00.000Z",
    },
    attempt: 1,
    started_at: "2026-06-07T08:00:00.000Z",
    finished_at: null,
  };
}

function seedControlPlaneData() {
  writeJson(
    path.join(controlPlaneDataDir, "templates", "e2e-backend-single-node.json"),
    JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "services", "control-plane", "data", "templates", "e2e-backend-single-node.json"),
        "utf-8",
      ),
    ),
  );
  writeJson(path.join(controlPlaneDataDir, "runs", "run_smoke_001.json"), createRunRecord());
  writeJson(
    path.join(controlPlaneDataDir, "run-plans", "run_smoke_001.json"),
    createRunPlanRecord(),
  );
  writeJson(
    path.join(controlPlaneDataDir, "node-runs", "run_smoke_001", "node_run_smoke_001.json"),
    createNodeRunRecord(),
  );
}

function seedExecutionAdapterData() {
  const staleFailed = createDispatchRecord({
    dispatch_id: "disp_smoke_stale_failed",
    run_id: "run_smoke_001",
    node_run_id: "node_run_smoke_001",
    updated_at: "2026-06-07T08:00:00.000Z",
    last_polled_at: "2026-06-07T08:00:00.000Z",
    openclaw_result_session_key: "agent:backend:explicit:bridge-disp_smoke_stale_failed",
    openclaw_result_session_id: "bridge-disp_smoke_stale_failed",
    openclaw_session_id: "bridge-disp_smoke_stale_failed",
    direct_agent: {
      attempted: true,
      sessionId: "bridge-disp_smoke_stale_failed",
      sessionKey: "agent:backend:explicit:bridge-disp_smoke_stale_failed",
      sessionFile: null,
      runId: null,
      taskId: null,
      stdout: "",
      stderr: "FallbackSummaryError: all providers failed after timeout",
      exitCode: 1,
      completionText: null,
      reportText: null,
      mode: "async-task",
    },
  });

  const driftedCompleted = createDispatchRecord({
    dispatch_id: "disp_smoke_align_completed",
    status: "running",
    last_reported_status: "completed",
    last_error: "smoke drift record",
    openclaw_result_session_key: "agent:backend:explicit:bridge-disp_smoke_align_completed",
    openclaw_result_session_id: "bridge-disp_smoke_align_completed",
    openclaw_session_id: "bridge-disp_smoke_align_completed",
    direct_agent: {
      attempted: true,
      sessionId: "bridge-disp_smoke_align_completed",
      sessionKey: "agent:backend:explicit:bridge-disp_smoke_align_completed",
      sessionFile: null,
      runId: null,
      taskId: null,
      stdout: "",
      stderr: "",
      exitCode: 0,
      completionText: null,
      reportText: null,
      mode: "async-task",
    },
  });

  writeJson(
    path.join(executionAdapterDataDir, "dispatches", "disp_smoke_stale_failed.json"),
    staleFailed,
  );
  writeJson(
    path.join(executionAdapterDataDir, "dispatches", "disp_smoke_align_completed.json"),
    driftedCompleted,
  );
}

async function main() {
  rimraf(smokeRoot);
  ensureDir(logsDir);
  seedControlPlaneData();
  seedExecutionAdapterData();

  const controlPlane = startManagedNodeService({
    name: "control-plane",
    workdir: controlPlaneDir,
    logDir: logsDir,
    logPrefix: "control-plane-4111",
    env: {
      PORT: String(controlPlanePort),
      MY_MATE_DATA_DIR: controlPlaneDataDir,
      MY_MATE_ENABLE_LOCAL_EXECUTION: "false",
      MY_MATE_EXECUTION_ADAPTER: "openclaw",
      MY_MATE_PUBLIC_BASE_URL: controlPlaneBaseUrl,
      MY_MATE_OPENCLAW_BRIDGE_BASE_URL: executionAdapterBaseUrl,
      MY_MATE_OPENCLAW_BRIDGE_API_KEY: bridgeApiKey,
      MY_MATE_OPENCLAW_CALLBACK_TOKEN: callbackToken,
      MY_MATE_OPENCLAW_BRIDGE_EXECUTION_MODE: "container-exec",
      MY_MATE_OPENCLAW_GATEWAY_BASE_URL: "http://127.0.0.1:18789",
      MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL: "http://127.0.0.1:4315",
      MY_MATE_OPENCLAW_CONTAINER_NAME: "openclaw-local",
    },
  });

  const executionAdapter = startManagedNodeService({
    name: "execution-adapter",
    workdir: executionAdapterDir,
    logDir: logsDir,
    logPrefix: "execution-adapter-4120",
    env: {
      PORT: String(executionAdapterPort),
      MY_MATE_EXECUTION_ADAPTER_MODE: "container-exec",
      MY_MATE_EXECUTION_ADAPTER_API_KEY: bridgeApiKey,
      MY_MATE_EXECUTION_ADAPTER_DATA_DIR: executionAdapterDataDir,
      MY_MATE_OPENCLAW_GATEWAY_BASE_URL: "http://127.0.0.1:18789",
      MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL: "http://127.0.0.1:4315",
      MY_MATE_OPENCLAW_CONTAINER_NAME: "openclaw-local",
      MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY: "direct-agent",
    },
  });

  try {
    await waitForHealth(`${controlPlaneBaseUrl}/health`, "control-plane");
    await waitForHealth(`${executionAdapterBaseUrl}/health`, "execution-adapter");
    await sleep(2000);

    const bridgeHeaders = {
      authorization: `Bearer ${bridgeApiKey}`,
    };
    const staleFailed = await getJson(
      `${executionAdapterBaseUrl}/api/v1/dispatches/disp_smoke_stale_failed`,
      bridgeHeaders,
    );
    const driftedCompleted = await getJson(
      `${executionAdapterBaseUrl}/api/v1/dispatches/disp_smoke_align_completed`,
      bridgeHeaders,
    );

    if (staleFailed.status !== "failed") {
      throw new Error(
        `Expected stale failed dispatch to finalize as failed, got ${staleFailed.status}`,
      );
    }
    if (driftedCompleted.status !== "completed") {
      throw new Error(
        `Expected drifted dispatch to align to completed, got ${driftedCompleted.status}`,
      );
    }

    writeJson(
      path.join(executionAdapterDataDir, "dispatches", "disp_smoke_manual_sweep.json"),
      createDispatchRecord({
        dispatch_id: "disp_smoke_manual_sweep",
        status: "running",
        last_reported_status: "completed",
        last_error: "manual sweep alignment",
        openclaw_result_session_key: "agent:backend:explicit:bridge-disp_smoke_manual_sweep",
        openclaw_result_session_id: "bridge-disp_smoke_manual_sweep",
        openclaw_session_id: "bridge-disp_smoke_manual_sweep",
        direct_agent: {
          attempted: true,
          sessionId: "bridge-disp_smoke_manual_sweep",
          sessionKey: "agent:backend:explicit:bridge-disp_smoke_manual_sweep",
          sessionFile: null,
          runId: null,
          taskId: null,
          stdout: "",
          stderr: "",
          exitCode: 0,
          completionText: null,
          reportText: null,
          mode: "async-task",
        },
      }),
    );

    const sweepResponse = await postJson(
      `${controlPlaneBaseUrl}/api/internal/ops/execution/dispatch-sweep`,
      {},
    );
    if (!sweepResponse.ok) {
      throw new Error(
        `Dispatch sweep failed (${sweepResponse.status}): ${JSON.stringify(sweepResponse.body)}`,
      );
    }

    const sweepBody = sweepResponse.body;
    if (!sweepBody?.supported || !sweepBody.summary) {
      throw new Error(`Dispatch sweep did not return a supported summary: ${JSON.stringify(sweepBody)}`);
    }
    if (sweepBody.summary.aligned < 1) {
      throw new Error(`Expected dispatch sweep to align at least one record: ${JSON.stringify(sweepBody)}`);
    }

    const manualSweepDispatch = await getJson(
      `${executionAdapterBaseUrl}/api/v1/dispatches/disp_smoke_manual_sweep`,
      bridgeHeaders,
    );
    if (manualSweepDispatch.status !== "completed") {
      throw new Error(
        `Expected manual sweep dispatch to become completed, got ${manualSweepDispatch.status}`,
      );
    }

    const summary = {
      control_plane_base_url: controlPlaneBaseUrl,
      execution_adapter_base_url: executionAdapterBaseUrl,
      startup_recovery: {
        stale_failed_status: staleFailed.status,
        drifted_completed_status: driftedCompleted.status,
      },
      manual_sweep: sweepBody,
      verified_at: new Date().toISOString(),
    };
    writeJson(path.join(smokeRoot, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await controlPlane.stop();
    await executionAdapter.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
