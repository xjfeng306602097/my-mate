import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = path.resolve("C:/project/my-mate");
const outRoot = path.join(repoRoot, "tmp", "main-openclaw-proposal-e2e");

const gatewayBaseUrl = "http://127.0.0.1:4030";
const studioBaseUrl = "http://127.0.0.1:5174";
const bridgeBaseUrl = "http://127.0.0.1:4020";
const bridgeApiKey = "local-dev-openclaw";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function makeStamp() {
  return new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "");
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestJson(method, url, body, headers = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`${method} ${url} failed (${response.status}): ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function getJson(url, headers = {}) {
  return requestJson("GET", url, undefined, headers);
}

async function postJson(url, body, headers = {}) {
  return requestJson("POST", url, body, headers);
}

async function assertHttpOk(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} is not healthy (${response.status}): ${body}`);
  }
  return response.text();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readRunSnapshot(runId) {
  const [run, nodes, events, artifacts] = await Promise.all([
    getJson(`${gatewayBaseUrl}/api/runs/${encodeURIComponent(runId)}`),
    getJson(`${gatewayBaseUrl}/api/runs/${encodeURIComponent(runId)}/nodes`),
    getJson(`${gatewayBaseUrl}/api/runs/${encodeURIComponent(runId)}/events`),
    getJson(`${gatewayBaseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts`),
  ]);
  return { run, nodes, events, artifacts };
}

async function pollRun(runId, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  const observations = [];
  while (Date.now() < deadline) {
    const { run, nodes, events, artifacts } = await readRunSnapshot(runId);
    const node = Array.isArray(nodes.items) ? nodes.items[0] : null;
    observations.push({
      checked_at: new Date().toISOString(),
      status: run.status,
      summary: run.current_summary,
      node_status: node?.status || null,
      node_progress: node?.progress?.message || null,
      event_count: Array.isArray(events.items) ? events.items.length : 0,
      artifact_count: Array.isArray(artifacts.items) ? artifacts.items.length : 0,
    });
    if (["completed", "failed", "cancelled", "waiting_human", "paused"].includes(run.status)) {
      return { run, nodes, events, artifacts, observations };
    }
    await sleep(5000);
  }
  const finalSnapshot = await readRunSnapshot(runId);
  if (["completed", "failed", "cancelled", "waiting_human", "paused"].includes(finalSnapshot.run.status)) {
    return { ...finalSnapshot, observations };
  }
  throw new Error(`Timed out waiting for run ${runId} to reach a terminal state. Last status: ${finalSnapshot.run.status}`);
}

function findDispatchId(events) {
  const items = Array.isArray(events?.items) ? events.items : [];
  for (const event of items) {
    if (typeof event?.payload?.dispatch_id === "string" && event.payload.dispatch_id.trim()) {
      return event.payload.dispatch_id.trim();
    }
  }
  return null;
}

async function verifyServiceHealth() {
  const [runtimeSummary, bridgeHealth] = await Promise.all([
    getJson(`${gatewayBaseUrl}/api/runtime/summary`),
    getJson(`${bridgeBaseUrl}/health`),
    assertHttpOk(studioBaseUrl, "Studio"),
  ]);
  const runtime = runtimeSummary?.execution_runtime || {};
  assert(runtime.adapter_kind === "openclaw", `Expected adapter_kind=openclaw, got ${runtime.adapter_kind}`);
  assert(runtime.local_execution_enabled === false, "Expected local execution to be disabled.");
  assert(runtime.bridge_base_url === bridgeBaseUrl, `Expected bridge_base_url=${bridgeBaseUrl}, got ${runtime.bridge_base_url}`);
  assert(runtime.bridge_execution_mode === "container-exec", `Expected bridge_execution_mode=container-exec, got ${runtime.bridge_execution_mode}`);
  assert(bridgeHealth?.status === "ok", `Expected bridge health ok, got ${JSON.stringify(bridgeHealth)}`);
  return { runtimeSummary, bridgeHealth };
}

async function main() {
  const stamp = makeStamp();
  const outDir = path.join(outRoot, stamp);
  ensureDir(outDir);

  const health = await verifyServiceHealth();
  const missionTitle = `Main OpenClaw proposal E2E ${stamp}`;
  const objective =
    `${missionTitle}: create a single backend verification run through a confirmed DAG proposal, ` +
    "prove callback/artifacts, and do not modify repository files.";
  const inputs = {
    goal: objective,
    project_slug: `main-openclaw-proposal-e2e-${stamp.toLowerCase()}`,
    title: missionTitle,
    description: "Automated main-stack proposal-confirm-run regression through OpenClaw bridge.",
  };

  const sessionResponse = await postJson(`${gatewayBaseUrl}/api/sessions`, {
    title: missionTitle,
    initial_message: objective,
    created_by: "main-openclaw-proposal-e2e",
  });
  const sessionId = sessionResponse?.session?.session_id;
  assert(sessionId, `Session creation did not return a session_id: ${JSON.stringify(sessionResponse)}`);

  const proposalResponse = await postJson(
    `${gatewayBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals`,
    {
      template_id: "e2e-backend-single-node",
      inputs,
    },
  );
  const proposal = proposalResponse?.proposal;
  const proposalId = proposal?.proposal_id;
  assert(proposalId, `DAG proposal creation did not return a proposal_id: ${JSON.stringify(proposalResponse)}`);
  assert(proposal.status === "review_ready", `Expected proposal status review_ready, got ${proposal.status}`);

  const confirmed = await postJson(
    `${gatewayBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals/${encodeURIComponent(proposalId)}/confirm`,
    { confirmed_by: "main-openclaw-proposal-e2e" },
  );
  assert(confirmed?.proposal?.status === "confirmed", `Expected confirmed proposal, got ${JSON.stringify(confirmed?.proposal)}`);

  const runResponse = await postJson(`${gatewayBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/runs`, {
    proposal_id: proposalId,
    validation_mode: "strict",
    inputs,
  });
  const runId = runResponse?.run_id;
  assert(runId, `Run creation did not return a run_id: ${JSON.stringify(runResponse)}`);

  const terminal = await pollRun(runId, 960000);
  assert(terminal.run.status === "completed", `Expected completed run, got ${terminal.run.status}: ${terminal.run.current_summary}`);
  assert(terminal.run.proposal_id === proposalId, `Run proposal_id mismatch: ${terminal.run.proposal_id}`);
  assert(Array.isArray(terminal.artifacts.items) && terminal.artifacts.items.length >= 2, "Expected at least two run artifacts.");

  const dispatchId = findDispatchId(terminal.events);
  assert(dispatchId, "Run events did not include a dispatch_id.");
  const dispatch = await getJson(`${bridgeBaseUrl}/api/v1/dispatches/${encodeURIComponent(dispatchId)}`, {
    authorization: `Bearer ${bridgeApiKey}`,
  });
  assert(dispatch.status === "completed", `Expected completed dispatch, got ${dispatch.status}`);
  assert(dispatch.mode === "container-exec", `Expected container-exec dispatch, got ${dispatch.mode}`);
  assert(Boolean(dispatch.openclaw_task_id), "Dispatch is missing openclaw_task_id.");
  assert(Boolean(dispatch.openclaw_result_run_id), "Dispatch is missing openclaw_result_run_id.");

  const [studioSession, studioGraph, studioArtifacts, studioCompare, studioProposal] = await Promise.all([
    getJson(`${studioBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}`),
    getJson(`${studioBaseUrl}/api/runs/${encodeURIComponent(runId)}/graph`),
    getJson(`${studioBaseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts`),
    getJson(`${studioBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/compare`),
    getJson(`${studioBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/dag-proposals/${encodeURIComponent(proposalId)}`),
  ]);
  assert(studioSession?.session?.latest_run_id === runId, "Studio session API did not expose the latest run id.");
  assert(studioGraph?.runStatus === "completed", `Studio graph status mismatch: ${studioGraph?.runStatus}`);
  assert(Array.isArray(studioArtifacts?.items) && studioArtifacts.items.length >= 2, "Studio artifacts API did not expose returned artifacts.");
  assert(studioCompare === null || typeof studioCompare === "object", "Studio compare API returned an unexpected payload.");
  assert(studioProposal?.proposal?.status === "confirmed", "Studio proposal API did not expose confirmed proposal.");

  const summary = {
    ok: true,
    verified_at: new Date().toISOString(),
    services: {
      gateway_base_url: gatewayBaseUrl,
      studio_base_url: studioBaseUrl,
      bridge_base_url: bridgeBaseUrl,
      runtime: {
        adapter_kind: health.runtimeSummary.execution_runtime.adapter_kind,
        bridge_execution_mode: health.runtimeSummary.execution_runtime.bridge_execution_mode,
      },
    },
    ids: {
      session_id: sessionId,
      proposal_id: proposalId,
      run_id: runId,
      dispatch_id: dispatchId,
    },
    run: {
      status: terminal.run.status,
      artifact_count: terminal.artifacts.items.length,
      event_count: terminal.events.items.length,
    },
    dispatch: {
      status: dispatch.status,
      mode: dispatch.mode,
      openclaw_task_id: dispatch.openclaw_task_id,
      openclaw_result_run_id: dispatch.openclaw_result_run_id,
    },
    evidence: {
      summary_path: path.join(outDir, "summary.json"),
      observations_path: path.join(outDir, "observations.json"),
    },
  };

  writeJson(path.join(outDir, "observations.json"), terminal.observations);
  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
