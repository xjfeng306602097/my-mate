import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeWorkerImage } from "./runtime-worker-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const image = resolveRuntimeWorkerImage();
const dockerBin = process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";
const outputPath = path.resolve(
  repoRoot,
  process.env.MY_MATE_DOCKER_AGENT_HARNESS_OUTPUT ||
    "tmp/live-acceptance/docker-agent-harness.json",
);
const basePort = Math.max(1024, Number(process.env.MY_MATE_DOCKER_AGENT_HARNESS_PORT) || 4280);
const timeoutMs = Math.max(30_000, Number(process.env.MY_MATE_LIVE_TIMEOUT_MS) || 180_000);
const requireConfigured = process.env.MY_MATE_DOCKER_AGENT_HARNESS_REQUIRE_CONFIGURED !== "false";

const providerConfigs = {
  codex: {
    credentialNames: ["OPENAI_API_KEY", "CODEX_API_KEY"],
    envNames: ["OPENAI_API_KEY", "CODEX_API_KEY", "MY_MATE_CODEX_MODEL"],
    modelEnv: "MY_MATE_CODEX_MODEL",
  },
  "claude-sdk": {
    credentialNames: ["ANTHROPIC_API_KEY"],
    envNames: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "MY_MATE_CLAUDE_MODEL"],
    modelEnv: "MY_MATE_CLAUDE_MODEL",
  },
  glm: {
    credentialNames: ["GLM_API_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
    envNames: [
      "GLM_API_KEY",
      "ZAI_API_KEY",
      "ZHIPU_API_KEY",
      "MY_MATE_GLM_ANTHROPIC_BASE_URL",
      "MY_MATE_GLM_MODEL",
    ],
    modelEnv: "MY_MATE_GLM_MODEL",
    requiredNames: ["MY_MATE_GLM_ANTHROPIC_BASE_URL"],
  },
};

function configured(name) {
  return typeof process.env[name] === "string" && process.env[name].trim().length > 0;
}

function selectedProviders() {
  const raw = process.env.MY_MATE_DOCKER_LIVE_PROVIDERS ||
    process.env.MY_MATE_LIVE_PROVIDERS || "auto";
  const requested = new Set(raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean));
  if (requested.has("auto")) {
    return Object.entries(providerConfigs)
      .filter(([, config]) =>
        config.credentialNames.some(configured) &&
        (config.requiredNames || []).every(configured))
      .map(([provider]) => provider);
  }
  return [...requested].filter((provider) => provider in providerConfigs);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed.`);
  }
  return (result.stdout || "").trim();
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Runtime Worker container did not become healthy.");
}

function buildJob(provider, model, token) {
  const runId = `run-docker-agent-${randomUUID()}`;
  const nodeRunId = `node-docker-agent-${randomUUID()}`;
  return {
    job_id: `${runId}:${nodeRunId}:attempt-1:dispatch-1`,
    run_id: runId,
    node_run_id: nodeRunId,
    node_id: "docker_agent_harness",
    node_name: "Docker Agent Harness Acceptance",
    node_type: "agent_task",
    attempt: 1,
    dispatch_sequence: 1,
    envelope: {
      run_id: runId,
      node_run_id: nodeRunId,
      template_id: "docker-agent-harness-acceptance",
      template_version: 1,
      workspace_id: "docker-agent-harness-workspace",
      requested_by: "live-acceptance",
      intent: [
        "Use a file-reading or shell tool to read live-acceptance-input.json from the workspace.",
        "Return only <verification_token>|<sum of values> using the file contents.",
        "Do not guess the token and do not modify any file.",
      ].join(" "),
      node_id: "docker_agent_harness",
      node_name: "Docker Agent Harness Acceptance",
      node_type: "agent_task",
      agent_profile: null,
      runtime_agent_ref: model,
      agent_runtime: provider,
      harness_profile: "agent-harness-v1",
      allowed_skills: [],
      allowed_tools: ["read", "shell"],
      registry_provenance: {
        agent_profile_requested: null,
        agent_profile_resolved: null,
        agent_profile_status: null,
        agent_profile_source: "none",
        runtime_agent_ref_source: model ? "template_binding" : "none",
        skill_bindings: [],
        tool_bindings: [],
      },
      timeout_seconds: Math.ceil(timeoutMs / 1000),
      parallelism_budget: 1,
      retry_policy: { max_attempts: 1, attempt: 1 },
      input_payload: { node_config: {}, acceptance_token_digest: digest(token) },
      output_contract: { expected_artifacts: ["agent-output"] },
      trace_context: { run_id: runId, node_run_id: nodeRunId, requested_by: "live-acceptance" },
    },
    harness: {
      agent_runtime: provider,
      runtime_agent_ref: model,
      harness_profile: "agent-harness-v1",
      allowed_skills: [],
      allowed_tools: ["read", "shell"],
    },
    provision: {
      required: true,
      target_kind: "docker-worker",
      image,
      container_group: null,
      required_capabilities: [provider],
      env: {},
      workspace: {
        workspace_id: "docker-agent-harness-workspace",
        mode: "isolated",
        project_slug: null,
        project_local_repo: null,
        container_path: "/workspace",
        metadata: {},
      },
    },
    trace_context: { run_id: runId, node_run_id: nodeRunId, requested_by: "live-acceptance" },
    created_at: new Date().toISOString(),
  };
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function redact(value) {
  let result = String(value || "");
  for (const config of Object.values(providerConfigs)) {
    for (const envName of config.credentialNames) {
      const secret = process.env[envName];
      if (secret && secret.length >= 6) result = result.replaceAll(secret, "[REDACTED]");
    }
  }
  return result.slice(-2000);
}

async function stopContainer(name, child) {
  spawnSync(dockerBin, ["stop", "--time", "3", name], {
    cwd: repoRoot,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}

async function runProvider(provider, index) {
  const config = providerConfigs[provider];
  const missing = [
    ...(!config.credentialNames.some(configured)
      ? [`one of ${config.credentialNames.join(", ")}`]
      : []),
    ...(config.requiredNames || []).filter((name) => !configured(name)),
  ];
  if (missing.length > 0) throw new Error(`Missing configuration: ${missing.join("; ")}`);
  const sourceCaPath = configured("NODE_EXTRA_CA_CERTS")
    ? path.resolve(process.env.NODE_EXTRA_CA_CERTS)
    : null;
  if (sourceCaPath && !fs.statSync(sourceCaPath).isFile()) {
    throw new Error(`NODE_EXTRA_CA_CERTS is not a file: ${sourceCaPath}`);
  }

  const started = Date.now();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `my-mate-docker-${provider}-`));
  const token = `token_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  fs.writeFileSync(
    path.join(workspace, "live-acceptance-input.json"),
    `${JSON.stringify({ verification_token: token, values: [17, 25] }, null, 2)}\n`,
    "utf-8",
  );
  let containerCaPath = null;
  if (sourceCaPath) {
    const caDirectory = path.join(workspace, ".my-mate");
    fs.mkdirSync(caDirectory, { recursive: true });
    fs.copyFileSync(sourceCaPath, path.join(caDirectory, "provider-ca.pem"));
    containerCaPath = "/workspace/.my-mate/provider-ca.pem";
  }
  const port = basePort + index;
  const name = `my-mate-agent-harness-${provider.replaceAll(/[^a-z0-9_.-]/g, "-")}-${process.pid}`;
  const args = [
    "run", "--rm", "--name", name,
    "--init", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "-p", `127.0.0.1:${port}:4040`,
    "--mount", `type=bind,source=${workspace},target=/workspace`,
  ];
  for (const envName of config.envNames.filter(configured)) args.push("-e", envName);
  if (containerCaPath) args.push("-e", `NODE_EXTRA_CA_CERTS=${containerCaPath}`);
  args.push(image);
  const serializedArgs = JSON.stringify(args);
  for (const envName of config.credentialNames.filter(configured)) {
    if (serializedArgs.includes(process.env[envName])) {
      throw new Error(`Credential ${envName} was embedded in Docker arguments.`);
    }
  }
  const child = spawn(dockerBin, args, {
    cwd: repoRoot,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdoutTail = "";
  let stderrTail = "";
  child.stdout.on("data", (chunk) => { stdoutTail = `${stdoutTail}${chunk}`.slice(-4000); });
  child.stderr.on("data", (chunk) => { stderrTail = `${stderrTail}${chunk}`.slice(-4000); });
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitForHealth(baseUrl);
    if (!health.supported_harnesses?.includes(provider)) {
      throw new Error(`Container does not advertise the ${provider} harness.`);
    }
    const model = configured(config.modelEnv) ? process.env[config.modelEnv].trim() : null;
    const job = buildJob(provider, model, token);
    const serializedJob = JSON.stringify(job);
    for (const envName of config.credentialNames.filter(configured)) {
      if (serializedJob.includes(process.env[envName])) {
        throw new Error(`Credential ${envName} was embedded in RuntimeWorkerJob.`);
      }
    }
    const response = await fetch(`${baseUrl}/api/runtime-worker/jobs/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: serializedJob,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json();
    if (response.status !== 202) {
      throw new Error(`Runtime Worker returned ${response.status}: ${body.message || JSON.stringify(body)}`);
    }
    const native = (body.evidence || []).filter((item) => item.source?.synthetic === false);
    const modelText = native
      .filter((item) => item.kind === "model_text")
      .map((item) => item.summary)
      .join("\n");
    if (!modelText.includes(`${token}|42`)) {
      throw new Error(`${provider} did not return the workspace-derived verification value.`);
    }
    const toolCalls = native.filter((item) => item.kind === "tool_call");
    const toolResults = native.filter((item) => item.kind === "tool_result");
    const callIds = new Set(toolCalls.map((item) => item.trace?.tool_call_id).filter(Boolean));
    const correlated = toolResults.some((item) => callIds.has(item.trace?.tool_call_id));
    if (toolCalls.length === 0 || toolResults.length === 0 || !correlated) {
      throw new Error(`${provider} did not preserve a correlated native tool call and result.`);
    }
    const usage = native.find((item) => item.kind === "usage")?.usage;
    if (!usage || usage.availability === "unavailable") {
      throw new Error(`${provider} did not provide native usage evidence.`);
    }
    return {
      provider,
      model,
      status: "passed",
      duration_ms: Date.now() - started,
      image,
      credential_source: config.credentialNames.find(configured),
      credential_transport: "docker_env_name",
      job_secret_free: true,
      output_digest: digest(modelText),
      evidence: {
        scenario: "docker_workspace_tool_usage",
        output_verified: true,
        native_evidence_count: native.length,
        tool_call_count: toolCalls.length,
        tool_result_count: toolResults.length,
        tool_correlation_verified: true,
        usage_availability: usage.availability,
      },
      error: null,
    };
  } catch (error) {
    const detail = `${stderrTail}\n${stdoutTail}`.trim().slice(-1500);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? `\n${detail}` : ""}`);
  } finally {
    await stopContainer(name, child);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

run(dockerBin, ["version", "--format", "{{.Server.Version}}"]);
run(dockerBin, ["image", "inspect", image, "--format", "{{.Id}}"]);
const providers = selectedProviders();
const results = [];
for (let index = 0; index < providers.length; index += 1) {
  const provider = providers[index];
  try {
    results.push(await runProvider(provider, index));
  } catch (error) {
    results.push({
      provider,
      model: process.env[providerConfigs[provider].modelEnv]?.trim() || null,
      status: "failed",
      image,
      credential_source: providerConfigs[provider].credentialNames.find(configured) || null,
      credential_transport: "docker_env_name",
      job_secret_free: true,
      output_digest: null,
      evidence: null,
      error: redact(error instanceof Error ? error.message : error),
    });
  }
}
const result = {
  schema_version: 1,
  status: results.some((item) => item.status === "failed")
    ? "failed"
    : results.length > 0 ? "passed" : "unavailable",
  image,
  providers,
  lanes: results,
  completed_at: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
console.log(JSON.stringify({ ...result, output: path.relative(repoRoot, outputPath) }, null, 2));
if (result.status === "failed" || (requireConfigured && result.status === "unavailable")) {
  process.exitCode = 1;
}
