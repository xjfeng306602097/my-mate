import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const reportRoot = path.join(repoRoot, "tmp", "multi-agent-medium-system", stamp);
const workspaceRoot = path.join(reportRoot, "workspace");
fs.mkdirSync(workspaceRoot, { recursive: true });

const [
  { createApp },
  { executeConversationTool },
  { getAgentDefinition, upsertAgentDefinition },
  { getAgentDag },
  { getDagProposal, listSessionDagProposals },
  { createSession, getSession },
  { createSessionMessage },
  { registerWorkspaceBinding },
  { getRuntimeWorkspaceChangeSet, applyRuntimeWorkspaceChangeSet },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/conversation-tools.js"),
  import("../src/agent-runtime-store.js"),
  import("../src/agent-orchestration-store.js"),
  import("../src/dag-proposal-store.js"),
  import("../src/session-store.js"),
  import("../src/session-message-store.js"),
  import("../src/workspace-binding-store.js"),
  import("../src/runtime/workspace-change-set.js"),
]);

const connectionId = "big-model-smart-agi";
const model = "gpt-5.4";
const agentIds = {
  orchestrator: "e2e-medium-orchestrator",
  frontend: "e2e-medium-frontend",
  backend: "e2e-medium-backend",
  test: "e2e-medium-test",
  reviewer: "e2e-medium-reviewer",
};

function ensureAgent(input: {
  agentId: string;
  name: string;
  role: "orchestrator" | "specialist" | "reviewer";
  tools: string[];
  write: boolean;
  prompt: string;
}) {
  const existing = getAgentDefinition(input.agentId);
  if (existing?.status === "active" && input.agentId !== agentIds.orchestrator) return existing;
  return upsertAgentDefinition({
    agentId: input.agentId,
    name: input.name,
    description: `Persistent Agent used by the medium-system multi-Agent E2E: ${input.name}`,
    createdBy: "multi-agent-medium-system-e2e",
    version: {
      role: input.role,
      system_prompt: input.prompt,
      model_policy: {
        deployment_id: null,
        provider_connection_id: connectionId,
        model,
        allow_runtime_override: false,
      },
      tool_policy: {
        allowed_tools: input.tools,
        denied_tools: [],
        max_tool_rounds: 12,
      },
      workspace_policy: {
        read: true,
        write: input.write,
        allowed_project_ids: [],
      },
      autonomy_ceiling: input.write ? "autopilot" : "review_first",
      runtime_policy: {
        runtime: "codex",
        sandbox: "docker",
        timeout_seconds: 600,
      },
    },
  });
}

ensureAgent({ agentId: agentIds.orchestrator, name: "E2E Product Orchestrator", role: "orchestrator", tools: ["agent_list", "dag_propose", "dag_status", "dag_run", "workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"], write: true, prompt: "Design complete product delivery DAGs, carry the maximum delegable workspace permission ceiling, and wait for Proposal confirmation." });
ensureAgent({ agentId: agentIds.frontend, name: "E2E Frontend Engineer", role: "specialist", tools: ["workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"], write: true, prompt: "Implement accessible dependency-free browser interfaces in the shared Task workspace." });
ensureAgent({ agentId: agentIds.backend, name: "E2E Backend Engineer", role: "specialist", tools: ["workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"], write: true, prompt: "Implement bounded Node.js HTTP services in the shared Task workspace." });
ensureAgent({ agentId: agentIds.test, name: "E2E Test Engineer", role: "specialist", tools: ["workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"], write: true, prompt: "Inspect frontend and backend outputs, then add executable Node.js integration tests." });
ensureAgent({ agentId: agentIds.reviewer, name: "E2E Independent Reviewer", role: "reviewer", tools: ["workspace_list", "workspace_read_text", "workspace_search"], write: false, prompt: "Review the shared workspace independently and return a structured acceptance verdict." });

const session = createSession({
  title: `Multi-Agent Support Desk ${stamp}`,
  initial_message: "Build a medium-sized support ticket system using Frontend, Backend, Test, and Reviewer Agents.",
  created_by: "multi-agent-medium-system-e2e",
  autonomy_mode: "autopilot",
  provider_connection_id: connectionId,
  model,
  agent_id: agentIds.orchestrator,
  agent_binding_mode: "pinned",
});
createSessionMessage({
  session_id: session.session_id,
  role: "user",
  kind: "text",
  content: {
    text: "Build a dependency-free support ticket system. Backend and Frontend work in parallel. Tests start only after both complete. An independent Reviewer performs final acceptance. Use one confirmed Proposal-backed AgentDag.",
  },
});
registerWorkspaceBinding({
  workspaceId: session.workspace_id || "default",
  sessionId: session.session_id,
  desktopInstanceId: "multi-agent-medium-system-e2e",
  capabilityId: `multi-agent-medium-system:${stamp}`,
  rootPath: workspaceRoot,
  displayName: "Multi-Agent Support Desk",
  access: "sandbox-write",
  scope: "session",
  metadata: { test_run: stamp, preauthorized_by: "user_requested_e2e" },
});

const proposed = await executeConversationTool({
  session,
  call: {
    id: `proposal-${stamp}`,
    name: "dag_propose",
    arguments: {
      title: "Support Desk delivery DAG",
      objective: "Build, test, and independently review a dependency-free support ticket system in one shared authorized workspace.",
      idempotency_key: `medium-system-${stamp}`,
      risk_level: "medium",
      policy: { max_concurrency: 2, max_delegation_depth: 1, max_total_agent_runs: 8, max_total_tool_rounds: 48, max_runtime_seconds: 1800, require_reviewer: true },
      nodes: [
        {
          node_id: "backend",
          name: "Backend API",
          kind: "agent_task",
          objective: "Implement the backend support-ticket API. Use workspace_apply_operations once to create package.json, server/store.js, and server/server.js. The server must export createServer, support GET /api/tickets and POST /api/tickets, validate title, and use an in-memory TicketStore. Do not stop at a plan. Return JSON with backend_summary and files.",
          agent_id: agentIds.backend,
          role: "specialist",
          depends_on: [],
          allowed_tools: ["workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"],
          autonomy_mode: "autopilot",
          max_tool_rounds: 8,
          output_contract: { backend_summary: "string", files: "array" },
        },
        {
          node_id: "frontend",
          name: "Frontend workspace",
          kind: "agent_task",
          objective: "Implement the frontend support-ticket workspace. Use workspace_apply_operations once to create web/index.html, web/styles.css, and web/app.js. Include ticket creation, status filtering, empty/loading/error states, accessible labels, responsive layout, and fetch calls to /api/tickets. Do not stop at a plan. Return JSON with frontend_summary and files.",
          agent_id: agentIds.frontend,
          role: "specialist",
          depends_on: [],
          allowed_tools: ["workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"],
          autonomy_mode: "autopilot",
          max_tool_rounds: 8,
          output_contract: { frontend_summary: "string", files: "array" },
        },
        {
          node_id: "tests",
          name: "Contract and integration tests",
          kind: "agent_task",
          objective: "Inspect the Backend and Frontend files in the shared workspace. Use workspace_apply_operations once to create test/system.test.js with executable node:test coverage for TicketStore and the HTTP create/list contract. Return JSON with test_summary and files.",
          agent_id: agentIds.test,
          role: "specialist",
          depends_on: ["backend", "frontend"],
          join_policy: "all",
          allowed_tools: ["workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"],
          autonomy_mode: "autopilot",
          max_tool_rounds: 8,
          output_contract: { test_summary: "string", files: "array" },
        },
        {
          node_id: "review",
          name: "Independent acceptance review",
          kind: "reviewer",
          objective: "Inspect all server, web, and test files in the shared workspace. Verify completeness, API/frontend agreement, executable tests, security basics, and maintainability. Return a structured accepted verdict only if the complete system is present.",
          agent_id: agentIds.reviewer,
          role: "reviewer",
          depends_on: ["tests"],
          join_policy: "all",
          allowed_tools: ["workspace_list", "workspace_read_text", "workspace_search"],
          autonomy_mode: "review_first",
          max_tool_rounds: 8,
          output_contract: { review_summary: "string" },
        },
      ],
    },
  },
});
assert.equal(proposed.is_error, false, JSON.stringify(proposed.content));
const proposalId = String((proposed.content.proposal as { proposal_id?: string })?.proposal_id || "");
assert.ok(proposalId.startsWith("prop_"));

const backendFiles = [
  { kind: "write", path: "package.json", content: JSON.stringify({ name: "multi-agent-support-desk", private: true, type: "module", scripts: { test: "node --test test/system.test.js", start: "node server/server.js" } }, null, 2) + "\n" },
  { kind: "write", path: "server/store.js", content: `export class TicketStore {
  #tickets = [];
  list() { return this.#tickets.map((ticket) => ({ ...ticket })); }
  create(input) {
    const title = String(input?.title || "").trim();
    if (!title) throw Object.assign(new Error("title is required"), { code: "invalid_title" });
    const ticket = { id: String(this.#tickets.length + 1), title, status: "open", createdAt: new Date().toISOString() };
    this.#tickets.push(ticket);
    return { ...ticket };
  }
}
` },
  { kind: "write", path: "server/server.js", content: `import http from "node:http";
import { TicketStore } from "./store.js";

export function createServer(store = new TicketStore()) {
  return http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (req.method === "GET" && req.url === "/api/tickets") return res.end(JSON.stringify({ items: store.list() }));
    if (req.method === "POST" && req.url === "/api/tickets") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try { res.statusCode = 201; return res.end(JSON.stringify(store.create(JSON.parse(body || "{}")))); }
      catch (error) { res.statusCode = 400; return res.end(JSON.stringify({ code: error.code || "invalid_request", message: error.message })); }
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ code: "not_found" }));
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\\\", "/"))) createServer().listen(4178);
` },
];
const frontendFiles = [
  { kind: "write", path: "web/index.html", content: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Support Desk</title><link rel="stylesheet" href="styles.css"></head><body><main><header><p>Operations</p><h1>Support Desk</h1></header><form id="ticket-form"><label for="title">Ticket title</label><div><input id="title" name="title" required maxlength="120"><button>Create ticket</button></div></form><nav aria-label="Ticket filters"><button data-filter="all" aria-pressed="true">All</button><button data-filter="open">Open</button></nav><p id="status" role="status">Loading tickets...</p><ul id="tickets" aria-live="polite"></ul></main><script type="module" src="app.js"></script></body></html>` },
  { kind: "write", path: "web/styles.css", content: `:root{font-family:Inter,Segoe UI,sans-serif;color:#1f2933;background:#eef2f5}body{margin:0}main{max-width:760px;margin:auto;padding:32px 20px}header{border-bottom:3px solid #12736b}h1{margin:4px 0 20px;font-size:32px}form div{display:flex;gap:8px}input{flex:1;padding:10px;border:1px solid #aeb8c2}button{padding:9px 14px;border:1px solid #73808c;background:white;cursor:pointer}form button{background:#12736b;color:white;border-color:#12736b}nav{display:flex;gap:8px;margin:24px 0}li{background:white;border-left:4px solid #d59b18;margin:8px 0;padding:12px;list-style:none}ul{padding:0}@media(max-width:520px){form div{display:grid}h1{font-size:26px}}` },
  { kind: "write", path: "web/app.js", content: `const form=document.querySelector("#ticket-form");const list=document.querySelector("#tickets");const status=document.querySelector("#status");let tickets=[];let filter="all";function render(){const visible=filter==="all"?tickets:tickets.filter(t=>t.status===filter);list.replaceChildren(...visible.map(t=>{const li=document.createElement("li");li.textContent=t.title+" - "+t.status;return li}));status.textContent=visible.length?visible.length+" ticket(s)":"No tickets found"}async function load(){try{const response=await fetch("/api/tickets");if(!response.ok)throw new Error();tickets=(await response.json()).items;render()}catch{status.textContent="Tickets could not be loaded"}}form.addEventListener("submit",async event=>{event.preventDefault();status.textContent="Creating ticket...";try{const response=await fetch("/api/tickets",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:new FormData(form).get("title")})});if(!response.ok)throw new Error();tickets.push(await response.json());form.reset();render()}catch{status.textContent="Ticket could not be created"}});document.querySelector("nav").addEventListener("click",event=>{if(!event.target.dataset.filter)return;filter=event.target.dataset.filter;document.querySelectorAll("nav button").forEach(button=>button.setAttribute("aria-pressed",String(button===event.target)));render()});load();` },
];
const testFiles = [{ kind: "write", path: "test/system.test.js", content: `import assert from "node:assert/strict";
import test from "node:test";
import { TicketStore } from "../server/store.js";
import { createServer } from "../server/server.js";

test("TicketStore validates, creates, and lists tickets", () => {
  const store = new TicketStore();
  assert.throws(() => store.create({ title: " " }), /title is required/);
  assert.equal(store.create({ title: "Investigate outage" }).status, "open");
  assert.equal(store.list().length, 1);
});

test("HTTP API creates and lists a ticket", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = "http://127.0.0.1:" + address.port;
  try {
    const created = await fetch(base + "/api/tickets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Reset account" }) });
    assert.equal(created.status, 201);
    const listed = await fetch(base + "/api/tickets");
    assert.deepEqual((await listed.json()).items.map((item) => item.title), ["Reset account"]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
` }];

let providerRounds = 0;
function openAiSse(payload: Record<string, unknown>): Response {
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const syntheticFetch: typeof fetch = async (_url, init) => {
  providerRounds += 1;
  const body = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ role?: string; content?: unknown }> };
  const messages = body.messages || [];
  const prompt = messages.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
  const hasToolResult = messages.some((message) => message.role === "tool");
  let toolName = "workspace_apply_operations";
  let toolArguments: Record<string, unknown> | null = null;
  let finalText = "";
  if (/Implement the backend support-ticket API/u.test(prompt)) {
    toolArguments = { idempotency_key: "medium-backend-v1", operations: backendFiles };
    finalText = JSON.stringify({ backend_summary: "Node HTTP API and bounded TicketStore completed.", files: backendFiles.map((item) => item.path) });
  } else if (/Implement the frontend support-ticket workspace/u.test(prompt)) {
    toolArguments = { idempotency_key: "medium-frontend-v1", operations: frontendFiles };
    finalText = JSON.stringify({ frontend_summary: "Accessible responsive support workspace completed.", files: frontendFiles.map((item) => item.path) });
  } else if (/Contract and integration tests|Inspect the Backend and Frontend files/u.test(prompt)) {
    toolArguments = { idempotency_key: "medium-tests-v1", operations: testFiles };
    finalText = JSON.stringify({ test_summary: "Store and HTTP integration tests added after both implementations.", files: testFiles.map((item) => item.path) });
  } else {
    toolName = "workspace_search";
    toolArguments = { query: "TicketStore", path: ".", max_results: 20 };
    finalText = JSON.stringify({ review_summary: "Backend, frontend, and executable integration tests are present in the shared workspace.", verdict: "accepted", criteria: [{ name: "complete system", passed: true, detail: "All required layers and contracts are present." }, { name: "independent tests", passed: true, detail: "Store and HTTP behavior are covered." }], issues: [], required_revisions: [] });
  }
  if (!hasToolResult) {
    return openAiSse({ model, choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${providerRounds}`, type: "function", function: { name: toolName, arguments: JSON.stringify(toolArguments) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3000, completion_tokens: 500 } });
  }
  return openAiSse({ model, choices: [{ delta: { content: finalText }, finish_reason: "stop" }], usage: { prompt_tokens: 3500, completion_tokens: 400 } });
};

const app = createApp({ conversation: { fetchImpl: syntheticFetch } });
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
async function request(method: string, pathname: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${pathname}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json() as Record<string, any>;
  assert.equal(response.ok, true, `${method} ${pathname} failed: ${response.status} ${JSON.stringify(value)}`);
  return value;
}

try {
  const confirmed = await request("POST", `/api/sessions/${session.session_id}/dag-proposals/${proposalId}/confirm`, { confirmed_by: "multi-agent-medium-system-e2e" });
  const dagId = String(confirmed.proposal.compiled_agent_dag_id || "");
  assert.ok(dagId.startsWith("agent_dag_"));
  await request("POST", `/api/agent-dags/${dagId}/run`, {});
  const deadline = Date.now() + 60_000;
  let dag = getAgentDag("default", dagId);
  while (dag && !["completed", "failed", "waiting_human", "cancelled"].includes(dag.status)) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${dagId}; status=${dag.status}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    dag = getAgentDag("default", dagId);
  }
  assert.equal(dag?.status, "completed", JSON.stringify(dag));
  assert.deepEqual(dag?.nodes.map((node) => node.status), ["completed", "completed", "completed", "completed"]);
  assert.equal(dag?.nodes.find((node) => node.role === "reviewer")?.metadata.review_verdict, "accepted");

  let finalSession = getSession(session.session_id)!;
  const projectionDeadline = Date.now() + 10_000;
  while (!finalSession.metadata.latest_workspace_change_set_id && Date.now() < projectionDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    finalSession = getSession(session.session_id)!;
  }
  const changeSetId = String(finalSession.metadata.latest_workspace_change_set_id || "");
  const changeSet = getRuntimeWorkspaceChangeSet(changeSetId);
  assert.ok(changeSet, "AgentDag did not finalize its shared workspace into a Change Set.");
  assert.equal(changeSet.status, "pending");
  assert.equal(changeSet.changes.length, 7);
  applyRuntimeWorkspaceChangeSet({ changeSetId, actor: "multi-agent-medium-system-e2e", comment: "Apply the user-requested E2E system after accepted Reviewer verdict." });
  const testRun = await execFileAsync(process.execPath, ["--test", "test/system.test.js"], { cwd: workspaceRoot, timeout: 30_000, windowsHide: true });
  assert.match(testRun.stdout, /pass 2/u);
  const storedProposal = getDagProposal(session.session_id, proposalId)!;
  assert.equal(storedProposal.status, "confirmed");
  assert.equal(listSessionDagProposals(session.session_id).length, 1);

  const report = {
    ok: true,
    mode: "deterministic-provider-simulation",
    verified_at: new Date().toISOString(),
    session_id: session.session_id,
    proposal_id: proposalId,
    agent_dag_id: dagId,
    workspace_change_set_id: changeSetId,
    workspace_root: workspaceRoot,
    provider_rounds: providerRounds,
    nodes: dag.nodes.map((node) => ({ node_id: node.node_id, name: node.name, role: node.role, status: node.status, agent_id: node.binding_snapshot.agent_id, reviewer_verdict: node.metadata.review_verdict || null })),
    budget_usage: dag.budget_usage,
    files: changeSet.changes.map((change) => change.relative_path),
    test_stdout: testRun.stdout,
  };
  fs.writeFileSync(path.join(reportRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
