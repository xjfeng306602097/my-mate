import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { startManagedNodeService } from "./lib/node-service-launcher.mjs";

const repoRoot = path.resolve("C:/project/my-mate");
const controlPlaneDir = path.join(repoRoot, "services", "control-plane");
const executionAdapterDir = path.join(repoRoot, "services", "execution-adapter");
const scenarioRoot = path.join(repoRoot, "tmp", "openclaw-isolated-e2e");
const controlPlaneDataDir = path.join(scenarioRoot, "control-plane-data");
const executionAdapterDataDir = path.join(scenarioRoot, "execution-adapter-data");
const logsDir = path.join(scenarioRoot, "logs");

const controlPlanePort = 4111;
const executionAdapterPort = 4120;
const controlPlaneBaseUrl = `http://127.0.0.1:${controlPlanePort}`;
const executionAdapterBaseUrl = `http://127.0.0.1:${executionAdapterPort}`;

const bridgeApiKey = "e2e-bridge-key";
const callbackToken = "e2e-callback-token";
const timeoutMs = 180000;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rimraf(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function parseLooseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findTaskFromListJson(listJson, lookup) {
  const tasks = Array.isArray(listJson?.tasks) ? listJson.tasks : [];
  return (
    tasks.find((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }
      return (
        item.requesterSessionKey === lookup ||
        item.childSessionKey === lookup ||
        item.taskId === lookup ||
        item.runId === lookup
      );
    }) || null
  );
}

async function waitForHealth(url, label, waitMs = 20000) {
  const deadline = Date.now() + waitMs;
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

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed (${response.status}): ${text}`);
  }
  return text.trim() ? JSON.parse(text) : null;
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
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

async function waitFor(check, label, waitMs = timeoutMs, intervalMs = 1500) {
  const deadline = Date.now() + waitMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) {
      return lastValue;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function isTerminalRunStatus(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function seedControlPlaneData() {
  const template = readJson(
    path.join(controlPlaneDir, "data", "templates", "e2e-backend-single-node.json"),
  );
  const backendProfile = readJson(
    path.join(controlPlaneDir, "data", "agent-profiles", "backend.json"),
  );
  const codingSkill = readJson(
    path.join(controlPlaneDir, "data", "skills", "coding-agent.json"),
  );

  writeJson(
    path.join(controlPlaneDataDir, "templates", "e2e-backend-single-node.json"),
    template,
  );
  writeJson(path.join(controlPlaneDataDir, "agent-profiles", "backend.json"), backendProfile);
  writeJson(path.join(controlPlaneDataDir, "skills", "coding-agent.json"), codingSkill);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function verifyDockerRuntime(dispatch) {
  const sessionKey = dispatch.openclaw_result_session_key;
  const trajectoryDir = dispatch.openclaw_result_trajectory_dir;

  if (!sessionKey) {
    return null;
  }

  const taskResult = await runCommand("docker", [
    "exec",
    "openclaw-local",
    "/home/node/.npm-global/bin/openclaw",
    "tasks",
    "show",
    "--json",
    sessionKey,
  ]);
  let taskJson =
    taskResult.code === 0 ? parseLooseJson(taskResult.stdout) : null;
  if (!taskJson) {
    const listResult = await runCommand("docker", [
      "exec",
      "openclaw-local",
      "/home/node/.npm-global/bin/openclaw",
      "tasks",
      "list",
      "--json",
    ]);
    if (listResult.code !== 0) {
      throw new Error(
        `openclaw tasks show/list failed: ${taskResult.stderr || taskResult.stdout || listResult.stderr || listResult.stdout}`,
      );
    }
    const listJson = parseLooseJson(listResult.stdout);
    taskJson = listJson ? findTaskFromListJson(listJson, sessionKey) : null;
  }
  if (!taskJson) {
    throw new Error("openclaw task lookup did not return task JSON.");
  }

  let trajectory = null;
  if (trajectoryDir) {
    const metadataResult = await runCommand("docker", [
      "exec",
      "openclaw-local",
      "cat",
      `${trajectoryDir}/metadata.json`,
    ]);
    if (metadataResult.code !== 0) {
      throw new Error(
        `Unable to read exported trajectory metadata (${metadataResult.code}): ${metadataResult.stderr || metadataResult.stdout}`,
      );
    }

    let metadataJson = null;
    try {
      metadataJson = JSON.parse(metadataResult.stdout.trim());
    } catch (error) {
      throw new Error(
        `Trajectory metadata is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    trajectory = {
      outputDir: trajectoryDir,
      finalAssistantRawText: metadataJson.finalAssistantRawText || null,
      finalAssistantVisibleText: metadataJson.finalAssistantVisibleText || null,
      promptError: metadataJson.promptError || null,
    };
  }

  return {
    task: {
      taskId: taskJson.taskId || null,
      runId: taskJson.runId || null,
      status: taskJson.status || null,
      requesterSessionKey: taskJson.requesterSessionKey || null,
      childSessionKey: taskJson.childSessionKey || null,
      error: taskJson.error || null,
      terminalSummary: taskJson.terminalSummary || null,
    },
    trajectory,
  };
}

async function main() {
  rimraf(scenarioRoot);
  ensureDir(logsDir);
  seedControlPlaneData();

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
      MY_MATE_OPENCLAW_DIRECT_AGENT_MODEL: "deepseek/deepseek-v4-pro",
    },
  });

  try {
    await waitForHealth(`${controlPlaneBaseUrl}/health`, "control-plane");
    await waitForHealth(`${executionAdapterBaseUrl}/health`, "execution-adapter");

    const createRunResponse = await postJson(`${controlPlaneBaseUrl}/api/runs`, {
      intent: "Verify real OpenClaw isolated e2e dispatch",
      template_id: "e2e-backend-single-node",
      validation_mode: "strict",
      inputs: {
        goal: "Verify real OpenClaw isolated e2e dispatch",
        project_slug: "my-mate",
        title: "OpenClaw Isolated E2E",
        description: "Create a fresh run and prove it completes through the OpenClaw bridge.",
      },
    });

    if (!createRunResponse.ok) {
      throw new Error(
        `Create run failed (${createRunResponse.status}): ${JSON.stringify(createRunResponse.body)}`,
      );
    }

    const runId = createRunResponse.body?.run_id;
    if (typeof runId !== "string" || !runId.trim()) {
      throw new Error(`Create run did not return run_id: ${JSON.stringify(createRunResponse.body)}`);
    }

    const terminalRun = await waitFor(
      async () => {
        const run = await getJson(`${controlPlaneBaseUrl}/api/runs/${runId}`);
        return isTerminalRunStatus(run.status) ? run : null;
      },
      `run ${runId} to reach terminal state`,
    );

    const [events, artifacts, nodes, plan, dispatches] = await Promise.all([
      getJson(`${controlPlaneBaseUrl}/api/runs/${runId}/events`),
      getJson(`${controlPlaneBaseUrl}/api/runs/${runId}/artifacts`),
      getJson(`${controlPlaneBaseUrl}/api/runs/${runId}/nodes`),
      getJson(`${controlPlaneBaseUrl}/api/runs/${runId}/plan`),
      getJson(`${executionAdapterBaseUrl}/api/v1/dispatches`, {
        authorization: `Bearer ${bridgeApiKey}`,
      }),
    ]);

    const nodeRun = Array.isArray(nodes?.items) ? nodes.items[0] : null;
    if (!nodeRun?.node_run_id) {
      throw new Error(`Node run data missing for ${runId}: ${JSON.stringify(nodes)}`);
    }

    const eventTypes = Array.isArray(events?.items) ? events.items.map((item) => item.type) : [];
    const requiredEventTypes = ["node.progress"];
    for (const eventType of requiredEventTypes) {
      if (!eventTypes.includes(eventType)) {
        throw new Error(`Expected event ${eventType} for ${runId}, got ${JSON.stringify(eventTypes)}`);
      }
    }

    const dispatch = Array.isArray(dispatches?.items)
      ? dispatches.items.find((item) => item.run_id === runId && item.node_run_id === nodeRun.node_run_id)
      : null;
    if (!dispatch) {
      throw new Error(`Execution adapter did not persist dispatch for run ${runId}`);
    }
    if (dispatch.mode !== "container-exec") {
      throw new Error(`Dispatch mode expected container-exec, got ${dispatch.mode}`);
    }
    const failureEvent = Array.isArray(events?.items)
      ? [...events.items].reverse().find((item) => item.type === "node.failed" || item.type === "run.failed") || null
      : null;

    if (
      dispatch.status === "completed" &&
      (!dispatch.openclaw_task_id || !dispatch.openclaw_result_session_key)
    ) {
      throw new Error(
        `Dispatch missing OpenClaw task/session refs: ${JSON.stringify({
          openclaw_task_id: dispatch.openclaw_task_id,
          openclaw_result_session_key: dispatch.openclaw_result_session_key,
        })}`,
      );
    }

    const dispatchDetail = await getJson(
      `${executionAdapterBaseUrl}/api/v1/dispatches/${dispatch.dispatch_id}`,
      { authorization: `Bearer ${bridgeApiKey}` },
    );
    const dockerRuntime = await verifyDockerRuntime(dispatchDetail);
    const artifactTypes = Array.isArray(artifacts?.items)
      ? artifacts.items.map((item) => item.type)
      : [];
    const verification = {
      run_terminal_status: terminalRun.status,
      completed_through_openclaw: terminalRun.status === "completed" && dispatchDetail.status === "completed",
      entered_bridge: eventTypes.includes("node.progress"),
      callback_accepted_received: eventTypes.includes("node.progress"),
      callback_completed_received: eventTypes.includes("node.completed") || eventTypes.includes("run.completed"),
      callback_failed_received: eventTypes.includes("node.failed"),
      has_openclaw_task_ref: Boolean(dispatchDetail.openclaw_task_id),
      has_openclaw_session_ref: Boolean(dispatchDetail.openclaw_result_session_key),
      handoff_artifact_persisted: artifactTypes.includes("report"),
      agent_report_artifact_persisted: artifactTypes.includes("summary"),
    };

    const summary = {
      verified_at: new Date().toISOString(),
      control_plane_base_url: controlPlaneBaseUrl,
      execution_adapter_base_url: executionAdapterBaseUrl,
      run: {
        run_id: runId,
        status: terminalRun.status,
        current_summary: terminalRun.current_summary,
        blocked_reason: terminalRun.blocked_reason || null,
      },
      node: {
        node_run_id: nodeRun.node_run_id,
        status: nodeRun.status,
        progress: nodeRun.progress || null,
      },
      plan: {
        template_id: plan.template_id,
        compiled_node_count: Array.isArray(plan.compiled_nodes) ? plan.compiled_nodes.length : null,
        openclaw_agent_id:
          Array.isArray(plan.compiled_nodes) && plan.compiled_nodes[0]
            ? plan.compiled_nodes[0].openclaw_agent_id
            : null,
        registry_provenance:
          Array.isArray(plan.compiled_nodes) && plan.compiled_nodes[0]
            ? plan.compiled_nodes[0].registry_provenance || null
            : null,
      },
      events: {
        total: eventTypes.length,
        types: eventTypes,
        terminal_failure: failureEvent?.payload?.error || null,
      },
      artifacts: {
        total: Array.isArray(artifacts?.items) ? artifacts.items.length : 0,
        items: artifacts?.items || [],
      },
      dispatch: {
        dispatch_id: dispatchDetail.dispatch_id,
        status: dispatchDetail.status,
        mode: dispatchDetail.mode,
        openclaw_task_id: dispatchDetail.openclaw_task_id,
        openclaw_session_id: dispatchDetail.openclaw_session_id,
        openclaw_result_session_key: dispatchDetail.openclaw_result_session_key,
        openclaw_result_run_id: dispatchDetail.openclaw_result_run_id,
        openclaw_result_trajectory_dir: dispatchDetail.openclaw_result_trajectory_dir,
        direct_agent: dispatchDetail.direct_agent,
      },
      docker_runtime: dockerRuntime,
      verification,
      logs: {
        control_plane_out: path.join(logsDir, "control-plane-4111.out.log"),
        control_plane_err: path.join(logsDir, "control-plane-4111.err.log"),
        execution_adapter_out: path.join(logsDir, "execution-adapter-4120.out.log"),
        execution_adapter_err: path.join(logsDir, "execution-adapter-4120.err.log"),
      },
    };

    writeJson(path.join(scenarioRoot, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));

    if (!verification.completed_through_openclaw) {
      throw new Error(
        `OpenClaw isolated e2e did not complete successfully. run=${terminalRun.status} dispatch=${dispatchDetail.status}`,
      );
    }
  } finally {
    await controlPlane.stop();
    await executionAdapter.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
