import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const startedAt = Date.now();
const serviceRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(serviceRoot, "..", "..");
const sourceDataRoot = path.join(serviceRoot, "data");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const reportRoot = path.join(repoRoot, "tmp", "conversation-2m-dag", stamp);
const dataRoot = path.join(reportRoot, "data");
const workspaceRoot = path.join(reportRoot, "workspace");
const requestedConnectionId = (process.env.MY_MATE_2M_DAG_CONNECTION_ID || "openai-default").trim();

function findVerifiedConnection(): { connectionId: string; connection: Record<string, any> } {
  const requested = path.join(sourceDataRoot, "provider-connections", `${requestedConnectionId}.json`);
  const discovered = fs.readdirSync(path.join(sourceDataRoot, "provider-connections"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(sourceDataRoot, "provider-connections", entry.name));
  const candidates = fs.existsSync(requested)
    ? [requested, ...discovered.filter((candidate) => candidate !== requested)]
    : discovered;
  for (const candidate of candidates) {
    const connection = JSON.parse(fs.readFileSync(candidate, "utf8")) as Record<string, any>;
    if (connection.status === "active" && connection.verification?.status === "verified" && connection.default_model) {
      return { connectionId: String(connection.connection_id || path.basename(candidate, ".json")), connection };
    }
  }
  throw new Error("A verified active Provider Connection is required for the isolated smoke fixture.");
}

const source = findVerifiedConnection();
const connectionId = source.connectionId;
const model = String(source.connection.default_model);
fs.mkdirSync(path.join(dataRoot, "provider-connections"), { recursive: true });
fs.mkdirSync(workspaceRoot, { recursive: true });
if (fs.existsSync(path.join(sourceDataRoot, "provider-secrets"))) {
  fs.cpSync(path.join(sourceDataRoot, "provider-secrets"), path.join(dataRoot, "provider-secrets"), { recursive: true });
}
fs.writeFileSync(path.join(dataRoot, "provider-connections", `${connectionId}.json`), `${JSON.stringify({
  ...source.connection,
  provider: "anthropic-compatible",
  protocol: "anthropic-messages",
  base_url: "https://deterministic-provider.invalid",
  models: [model],
  default_model: model,
  max_input_tokens: 256_000,
  max_output_tokens: 8_192,
  context_compression_enabled: true,
  context_compression_threshold_percent: 50,
  max_continuation_rounds: 20,
  max_tool_rounds: 24,
}, null, 2)}\n`, "utf8");

process.env.MY_MATE_DATA_DIR = dataRoot;
process.env.MY_MATE_CONVERSATION_TIMEOUT_MS = String(15 * 60_000);
process.env.MY_MATE_AGENT_DAG_LEASE_TTL_MS = "3000";

const [
  { createApp },
  { ConversationWebSocketHub },
  { executeConversationTool },
  { getAgentDefinition, listAgentRuns, upsertAgentDefinition },
  { getAgentDag, listAgentMessages, listAgentResults, listAgentTasks },
  { getAgentDagLease },
  { listAgentRunEvents },
  { getDagProposal, listSessionDagProposals },
  { listConversationActions },
  { listConversationEvents },
  { getTaskCheckpoint },
  { createSession, getSession, saveSession },
  { registerWorkspaceBinding },
  { applyRuntimeWorkspaceChangeSet, getRuntimeWorkspaceChangeSet },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/conversation-websocket.js"),
  import("../src/conversation-tools.js"),
  import("../src/agent-runtime-store.js"),
  import("../src/agent-orchestration-store.js"),
  import("../src/agent-dag-lease-store.js"),
  import("../src/agent-run-event-store.js"),
  import("../src/dag-proposal-store.js"),
  import("../src/conversation-action-store.js"),
  import("../src/conversation-event-store.js"),
  import("../src/task-checkpoint-store.js"),
  import("../src/session-store.js"),
  import("../src/workspace-binding-store.js"),
  import("../src/runtime/workspace-change-set.js"),
]);

const agentSuffix = stamp.toLowerCase();
const agentIds = {
  orchestrator: `smoke-orchestrator-${agentSuffix}`,
  product: `smoke-product-${agentSuffix}`,
  frontend: `smoke-frontend-${agentSuffix}`,
  backend: `smoke-backend-${agentSuffix}`,
  test: `smoke-test-${agentSuffix}`,
  reviewer: `smoke-reviewer-${agentSuffix}`,
  deployment: `smoke-deployment-${agentSuffix}`,
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
  if (existing) return existing;
  return upsertAgentDefinition({
    agentId: input.agentId,
    name: input.name,
    description: `Isolated 2M Conversation and AgentDag smoke Agent: ${input.name}`,
    createdBy: "conversation-2m-dag-smoke",
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
        runtime: "native",
        sandbox: "docker",
        timeout_seconds: 600,
      },
    },
  });
}

ensureAgent({ agentId: agentIds.orchestrator, name: "2M Delivery Orchestrator", role: "orchestrator", write: true, tools: ["agent_list", "dag_propose", "dag_status", "dag_run", "workspace_status", "workspace_list", "workspace_read_text", "workspace_apply_operations"], prompt: "Convert confirmed production missions into one durable AgentDag and supervise every result." });
ensureAgent({ agentId: agentIds.product, name: "Product Manager", role: "specialist", write: true, tools: ["workspace_list", "workspace_read_text", "workspace_apply_operations"], prompt: "Turn the mission into an explicit product contract and acceptance plan." });
ensureAgent({ agentId: agentIds.frontend, name: "Frontend Engineer", role: "specialist", write: true, tools: ["workspace_list", "workspace_read_text", "workspace_apply_operations"], prompt: "Implement the accessible browser client in the shared Task workspace." });
ensureAgent({ agentId: agentIds.backend, name: "Backend Engineer", role: "specialist", write: true, tools: ["workspace_list", "workspace_read_text", "workspace_apply_operations"], prompt: "Implement the bounded Node.js service in the shared Task workspace." });
ensureAgent({ agentId: agentIds.test, name: "Test Engineer", role: "specialist", write: true, tools: ["workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"], prompt: "Add executable integration coverage after implementation completes." });
ensureAgent({ agentId: agentIds.reviewer, name: "Independent Reviewer", role: "reviewer", write: false, tools: ["workspace_list", "workspace_read_text", "workspace_search"], prompt: "Accept only results supported by durable workspace and test evidence." });
ensureAgent({ agentId: agentIds.deployment, name: "Deployment Engineer", role: "specialist", write: true, tools: ["workspace_list", "workspace_read_text", "workspace_apply_operations"], prompt: "Create a deterministic local release package only after Reviewer acceptance." });

const session = createSession({
  title: `2M Conversation and production DAG ${stamp}`,
  initial_message: "Run a reconnectable two-million-token task, then execute a production delivery DAG.",
  created_by: "conversation-2m-dag-smoke",
  autonomy_mode: "assisted",
  provider_connection_id: connectionId,
  model,
  agent_id: agentIds.orchestrator,
  agent_binding_mode: "pinned",
});
session.metadata = {
  ...session.metadata,
  // This is an orchestration runtime acceptance task, so it must use the
  // normal tool loop rather than the document-generation fast path.
  orchestration_reduce: true,
  long_task_budget: {
    max_wall_time_ms: 2 * 60 * 60 * 1_000,
    max_turn_attempts: 32,
    max_total_tokens: 4_000_000,
  },
};
saveSession(session);
registerWorkspaceBinding({
  workspaceId: session.workspace_id || "default",
  sessionId: session.session_id,
  desktopInstanceId: "conversation-2m-dag-smoke",
  capabilityId: `conversation-2m-dag:${stamp}`,
  rootPath: workspaceRoot,
  displayName: "2M DAG smoke workspace",
  access: "snapshot-read",
  scope: "session",
  metadata: { smoke_run: stamp },
});

const longWriteOperations = [{
  kind: "write",
  path: "LONG_TASK_NOTES.md",
  content: `# Durable long-task evidence\n\nRun: ${stamp}\n\nThis file proves that a side effect survived context compaction, a client reconnect, explicit Desktop authorization, and idempotent replay.\n`,
}];
const productFiles = [{ kind: "write", path: "docs/product-plan.md", content: "# Delivery plan\n\nBuild frontend and backend in parallel, integrate them through one ticket contract, run tests, obtain independent review, then package the release.\n" }];
const frontendFiles = [
  { kind: "write", path: "web/index.html", content: "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Release Desk</title><link rel=\"stylesheet\" href=\"styles.css\"></head><body><main><h1>Release Desk</h1><form id=\"ticket-form\"><label for=\"title\">Ticket title</label><input id=\"title\" required><button>Create</button></form><p id=\"status\" role=\"status\">Loading</p><ul id=\"tickets\"></ul></main><script type=\"module\" src=\"app.js\"></script></body></html>" },
  { kind: "write", path: "web/styles.css", content: ":root{font-family:Segoe UI,sans-serif;color:#16202a;background:#edf2f4}body{margin:0}main{max-width:720px;margin:auto;padding:32px 20px}form{display:grid;gap:8px}input,button{font:inherit;padding:10px}button{background:#176b64;color:white;border:0}li{background:white;margin:8px 0;padding:12px;list-style:none}ul{padding:0}" },
  { kind: "write", path: "web/app.js", content: "const form=document.querySelector('#ticket-form');const status=document.querySelector('#status');const list=document.querySelector('#tickets');let tickets=[];function render(){list.replaceChildren(...tickets.map(ticket=>{const item=document.createElement('li');item.textContent=ticket.title;return item}));status.textContent=tickets.length?`${tickets.length} ticket(s)`:'No tickets'}form.addEventListener('submit',async event=>{event.preventDefault();const response=await fetch('/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:document.querySelector('#title').value})});tickets.push(await response.json());form.reset();render()});fetch('/api/tickets').then(response=>response.json()).then(value=>{tickets=value.items;render()}).catch(()=>status.textContent='Unable to load tickets');" },
];
const backendFiles = [
  { kind: "write", path: "package.json", content: `${JSON.stringify({ name: "two-million-dag-release", private: true, type: "module", scripts: { test: "node --test test/system.test.js", start: "node server/server.js" } }, null, 2)}\n` },
  { kind: "write", path: "server/store.js", content: "export class TicketStore { #items=[]; list(){return this.#items.map(item=>({...item}))} create(input){const title=String(input?.title||'').trim();if(!title)throw new Error('title is required');const item={id:String(this.#items.length+1),title,status:'open'};this.#items.push(item);return {...item}} }\n" },
  { kind: "write", path: "server/server.js", content: "import http from 'node:http';import{TicketStore}from'./store.js';export function createServer(store=new TicketStore()){return http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.method==='GET'&&req.url==='/api/tickets')return res.end(JSON.stringify({items:store.list()}));if(req.method==='POST'&&req.url==='/api/tickets'){let body='';for await(const chunk of req)body+=chunk;try{res.statusCode=201;return res.end(JSON.stringify(store.create(JSON.parse(body||'{}'))))}catch(error){res.statusCode=400;return res.end(JSON.stringify({message:error.message}))}}res.statusCode=404;res.end(JSON.stringify({message:'not found'}))})}\n" },
];
const testFiles = [{ kind: "write", path: "test/system.test.js", content: "import assert from 'node:assert/strict';import test from 'node:test';import{TicketStore}from'../server/store.js';import{createServer}from'../server/server.js';test('store validates and persists tickets',()=>{const store=new TicketStore();assert.throws(()=>store.create({title:' '}),/required/);assert.equal(store.create({title:'Ship release'}).status,'open');assert.equal(store.list().length,1)});test('HTTP contract creates and lists tickets',async()=>{const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();const base=`http://127.0.0.1:${address.port}`;try{const created=await fetch(base+'/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Verify DAG'})});assert.equal(created.status,201);const listed=await fetch(base+'/api/tickets');assert.deepEqual((await listed.json()).items.map(item=>item.title),['Verify DAG'])}finally{await new Promise(resolve=>server.close(resolve))}});\n" }];
const deploymentFiles = [
  { kind: "write", path: "deploy/release.json", content: `${JSON.stringify({ name: "two-million-dag-release", command: "npm test", health: "/api/tickets", immutable: true }, null, 2)}\n` },
  { kind: "write", path: "deploy/README.md", content: "# Release\n\nRun `npm test`, then start with `npm start`. The service exposes `/api/tickets`; serve `web/` from the same origin in production.\n" },
];

function anthropicStream(input: {
  inputTokens: number;
  stopReason: "tool_use" | "end_turn";
  text?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
}): Response {
  const events = [`data: ${JSON.stringify({ type: "message_start", message: { model, usage: { input_tokens: input.inputTokens } } })}\n\n`];
  if (input.text) events.push(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: input.text } })}\n\n`);
  if (input.toolCall) events.push(`data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: input.toolCall.id, name: input.toolCall.name, input: input.toolCall.arguments } })}\n\n`);
  events.push(`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: input.stopReason }, usage: { output_tokens: 180 } })}\n\n`, "data: {\"type\":\"message_stop\"}\n\n");
  return new Response(events.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const dagProposalArguments = {
  title: "Production full-stack delivery",
  objective: "Plan, build, test, independently review, and package a dependency-free ticket workspace.",
  idempotency_key: `production-dag-${stamp}`,
  risk_level: "medium",
  policy: { max_concurrency: 2, max_delegation_depth: 1, max_total_agent_runs: 12, max_total_tool_rounds: 72, max_runtime_seconds: 1800, require_reviewer: true },
  nodes: [
    { node_id: "product", name: "Product planning", kind: "agent_task", objective: "Create docs/product-plan.md with the mission boundary, delivery stages, and acceptance contract. Return JSON with product_plan and files.", agent_id: agentIds.product, role: "specialist", depends_on: [], allowed_tools: ["workspace_list", "workspace_read_text", "workspace_apply_operations"], autonomy_mode: "assisted", max_tool_rounds: 8, output_contract: { product_plan: "string", files: "array" } },
    { node_id: "frontend", name: "Frontend implementation", kind: "agent_task", objective: "After product planning, create the accessible dependency-free browser client in web/index.html, web/styles.css, and web/app.js. Return JSON with frontend_summary and files.", agent_id: agentIds.frontend, role: "specialist", depends_on: ["product"], allowed_tools: ["workspace_list", "workspace_read_text", "workspace_apply_operations"], autonomy_mode: "assisted", max_tool_rounds: 8, output_contract: { frontend_summary: "string", files: "array" } },
    { node_id: "backend", name: "Backend implementation", kind: "agent_task", objective: "After product planning, create package.json, server/store.js, and server/server.js implementing the ticket API. Return JSON with backend_summary and files.", agent_id: agentIds.backend, role: "specialist", depends_on: ["product"], allowed_tools: ["workspace_list", "workspace_read_text", "workspace_apply_operations"], autonomy_mode: "assisted", max_tool_rounds: 8, output_contract: { backend_summary: "string", files: "array" } },
    { node_id: "tests", name: "System verification", kind: "agent_task", objective: "After frontend and backend finish, create test/system.test.js with executable store and HTTP contract tests. Return JSON with test_summary and files.", agent_id: agentIds.test, role: "specialist", depends_on: ["frontend", "backend"], join_policy: "all", allowed_tools: ["workspace_list", "workspace_read_text", "workspace_search", "workspace_apply_operations"], autonomy_mode: "assisted", max_tool_rounds: 8, output_contract: { test_summary: "string", files: "array" } },
    { node_id: "review", name: "Independent acceptance review", kind: "reviewer", objective: "Inspect product, frontend, backend, and test evidence. Accept only when the implementation and executable tests satisfy the mission. Return the required Reviewer JSON plus review_summary.", agent_id: agentIds.reviewer, role: "reviewer", depends_on: ["tests"], allowed_tools: ["workspace_list", "workspace_read_text", "workspace_search"], autonomy_mode: "review_first", max_tool_rounds: 8, output_contract: { review_summary: "string" } },
    { node_id: "deployment", name: "Release packaging", kind: "agent_task", objective: "Only after independent acceptance, create deploy/release.json and deploy/README.md with deterministic test, start, and health instructions. Return JSON with deployment_summary and files.", agent_id: agentIds.deployment, role: "specialist", depends_on: ["review"], allowed_tools: ["workspace_list", "workspace_read_text", "workspace_apply_operations"], autonomy_mode: "assisted", max_tool_rounds: 8, output_contract: { deployment_summary: "string", files: "array" } },
  ],
};

let longRound = 0;
let providerRounds = 0;
let compactionCalls = 0;
let dagProposalCompleted = false;
let releaseReconnectBarrier!: () => void;
const reconnectBarrier = new Promise<void>((resolve) => { releaseReconnectBarrier = resolve; });
const syntheticFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
  const serialized = JSON.stringify(body);
  if (serialized.includes("Compress a long-running task conversation")) {
    compactionCalls += 1;
    return new Response(JSON.stringify({
      model,
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Preserve every completed tool action, the immutable acceptance contract, the reconnect cursor, and continue from the next unfinished verification step." }],
      usage: { input_tokens: 1_200, output_tokens: 80 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  providerRounds += 1;
  const prompt = serialized;
  const respondForNode = (marker: string, toolName: string, toolArguments: Record<string, unknown>, finalText: string) => {
    if (!prompt.includes(marker)) return anthropicStream({ inputTokens: 4_500, stopReason: "tool_use", toolCall: { id: marker, name: toolName, arguments: toolArguments } });
    return anthropicStream({ inputTokens: 5_000, stopReason: "end_turn", text: finalText });
  };
  if (prompt.includes("PROPOSE_PRODUCTION_DAG_V1") && !dagProposalCompleted) {
    if (!prompt.includes("dag-proposal-call")) return anthropicStream({ inputTokens: 12_000, stopReason: "tool_use", toolCall: { id: "dag-proposal-call", name: "dag_propose", arguments: dagProposalArguments } });
    dagProposalCompleted = true;
    return anthropicStream({ inputTokens: 13_000, stopReason: "end_turn", text: "The six-role production AgentDag proposal is ready for confirmation. It keeps frontend and backend parallel, gates tests on both, requires independent review, and permits packaging only after acceptance." });
  }
  if (prompt.includes("Create docs/product-plan.md")) return respondForNode("subagent-product-call", "workspace_apply_operations", { idempotency_key: `dag-product-${stamp}`, operations: productFiles }, JSON.stringify({ product_plan: "Mission, parallel implementation, verification, review, and release boundaries recorded.", files: productFiles.map((item) => item.path) }));
  if (prompt.includes("accessible dependency-free browser client")) return respondForNode("subagent-frontend-call", "workspace_apply_operations", { idempotency_key: `dag-frontend-${stamp}`, operations: frontendFiles }, JSON.stringify({ frontend_summary: "Accessible ticket client completed.", files: frontendFiles.map((item) => item.path) }));
  if (prompt.includes("implementing the ticket API")) return respondForNode("subagent-backend-call", "workspace_apply_operations", { idempotency_key: `dag-backend-${stamp}`, operations: backendFiles }, JSON.stringify({ backend_summary: "Bounded ticket service completed.", files: backendFiles.map((item) => item.path) }));
  if (prompt.includes("executable store and HTTP contract tests")) return respondForNode("subagent-tests-call", "workspace_apply_operations", { idempotency_key: `dag-tests-${stamp}`, operations: testFiles }, JSON.stringify({ test_summary: "Executable store and HTTP tests completed.", files: testFiles.map((item) => item.path) }));
  if (prompt.includes("Inspect product, frontend, backend, and test evidence")) return respondForNode("subagent-review-call", "workspace_search", { query: "TicketStore", path: ".", max_results: 20 }, JSON.stringify({ verdict: "accepted", review_summary: "All required layers and executable verification evidence are present.", criteria: [{ name: "delivery contract", passed: true, detail: "Product, frontend, backend, and tests are durable workspace outputs." }, { name: "verification", passed: true, detail: "The test suite covers store validation and the HTTP create/list contract." }], issues: [], required_revisions: [] }));
  if (prompt.includes("Only after independent acceptance")) return respondForNode("subagent-deployment-call", "workspace_apply_operations", { idempotency_key: `dag-deployment-${stamp}`, operations: deploymentFiles }, JSON.stringify({ deployment_summary: "Deterministic local release package completed after Reviewer acceptance.", files: deploymentFiles.map((item) => item.path) }));
  // Hold the second Provider round until the replacement Desktop client has
  // attached. This makes the write authorization cross a real reconnect
  // boundary without relying on scheduler timing.
  if (longRound === 1) await reconnectBarrier;
  longRound += 1;
  const inputTokens = 145_000;
  const verificationCalls = [
    { id: "long-status-1", name: "workspace_status", arguments: {} },
    { id: "long-write", name: "workspace_apply_operations", arguments: { idempotency_key: `long-notes-${stamp}`, operations: longWriteOperations } },
    { id: "long-list-1", name: "workspace_list", arguments: {} },
    { id: "long-read-1", name: "workspace_read_text", arguments: { path: "LONG_TASK_NOTES.md" } },
    { id: "long-status-2", name: "workspace_status", arguments: {} },
    { id: "long-list-2", name: "workspace_list", arguments: {} },
    { id: "long-read-2", name: "workspace_read_text", arguments: { path: "LONG_TASK_NOTES.md" } },
    { id: "long-status-3", name: "workspace_status", arguments: {} },
    { id: "long-list-3", name: "workspace_list", arguments: {} },
    { id: "long-read-3", name: "workspace_read_text", arguments: { path: "LONG_TASK_NOTES.md" } },
    { id: "long-status-4", name: "workspace_status", arguments: {} },
    { id: "long-list-4", name: "workspace_list", arguments: {} },
    { id: "long-read-4", name: "workspace_read_text", arguments: { path: "LONG_TASK_NOTES.md" } },
    { id: "long-status-5", name: "workspace_status", arguments: {} },
    { id: "long-list-5", name: "workspace_list", arguments: {} },
  ];
  const next = verificationCalls[longRound - 1];
  if (next) return anthropicStream({ inputTokens, stopReason: "tool_use", text: longRound === 1 ? "Starting the durable long task and preserving progress across reconnects. " : undefined, toolCall: next });
  return anthropicStream({ inputTokens, stopReason: "end_turn", text: "The two-million-token durable Conversation completed. Workspace authorization, persisted verification actions, compaction, reconnect recovery, and final readback all succeeded." });
};

const app = createApp({ conversation: { fetchImpl: syntheticFetch }, productIntelligenceWatchdog: false });
const server = http.createServer(app);
const hub = new ConversationWebSocketHub({ security: app.locals.conversationSecurity, turnHandler: app.locals.streamConversationTurn });
hub.attach(server);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
const socketUrl = `ws://127.0.0.1:${address.port}/api/sessions/${session.session_id}/conversation`;

async function request(method: string, pathname: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${pathname}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json() as Record<string, any>;
  assert.equal(response.ok, true, `${method} ${pathname} failed: ${response.status} ${JSON.stringify(value)}`);
  return value;
}

function openSocket(): Promise<WebSocket> {
  const socket = new WebSocket(socketUrl);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.close(1000, "Smoke phase complete");
  });
}

const acceptanceMatrix = Array.from({ length: 3_200 }, (_, index) => `LC-${String(index + 1).padStart(5, "0")}: retain the task objective, explicit authorization boundary, idempotent write identity, reconnect cursor, checkpoint, compaction summary, verification order, and auditable completion evidence.`).join("\n");
const longPrompt = [
  "LONG_CONTEXT_DURABILITY_V1",
  "Run a durable long Conversation that performs one governed Workspace side effect only after Desktop authorization and then repeatedly verifies the resulting state.",
  "Use one tool per Provider round. Do not stop at a plan. Preserve every completed action across compaction and client reconnect. This is a runtime durability test, not a file-deliverable request.",
  "The following acceptance matrix is intentional context pressure. Do not reproduce it in the answer:",
  acceptanceMatrix,
].join("\n\n");

let firstCursor = 0;
let longCheckpointId = "";
const firstEvents: Array<Record<string, any>> = [];
const firstSocket = await openSocket();
await new Promise<void>((resolve, reject) => {
  const onMessage = (data: WebSocket.RawData) => {
    const event = JSON.parse(data.toString()) as Record<string, any>;
    firstEvents.push(event);
    if (event.type === "conversation.started") longCheckpointId = String(event.checkpoint_id || "");
    if (event.type === "conversation.delta" && Number(event.sequence) > 0) {
      firstCursor = Number(event.sequence);
      firstSocket.off("message", onMessage);
      resolve();
    }
    if (event.type === "conversation.error") reject(new Error(String(event.message || "Conversation failed.")));
  };
  firstSocket.on("message", onMessage);
  firstSocket.send(JSON.stringify({ type: "conversation.send", request_id: "long-turn", content: longPrompt, provider_connection_id: connectionId, model }));
});
assert.ok(firstCursor > 0, "The first client did not receive a persisted sequence before disconnecting.");
await closeSocket(firstSocket);

const replayEvents: Array<Record<string, any>> = [];
const authorizationRequestIds = new Set<string>();
const secondSocket = await openSocket();
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for the reconnectable long Conversation.")), 10 * 60_000);
  secondSocket.on("message", (data) => {
    const event = JSON.parse(data.toString()) as Record<string, any>;
    replayEvents.push(event);
    if (event.type === "conversation.started" && !longCheckpointId) longCheckpointId = String(event.checkpoint_id || "");
    if (event.type === "conversation.desktop_action" && event.action_type === "workspace.authorize") {
      const requestId = String(event.capability_request_id || "");
      authorizationRequestIds.add(requestId);
      registerWorkspaceBinding({
        workspaceId: session.workspace_id || "default",
        sessionId: session.session_id,
        desktopInstanceId: "conversation-2m-dag-smoke",
        capabilityId: `conversation-2m-dag:${stamp}`,
        rootPath: workspaceRoot,
        displayName: "2M DAG smoke workspace",
        access: "sandbox-write",
        scope: "session",
        metadata: { smoke_run: stamp, authorized_by: "simulated_desktop_user" },
      });
      secondSocket.send(JSON.stringify({ type: "conversation.desktop_result", capability_request_id: requestId, action_id: String(event.action_id || "") }));
    }
    if (event.type === "conversation.completed" && event.request_id === "long-turn") {
      clearTimeout(timeout);
      resolve();
    }
    if (event.type === "conversation.error") {
      clearTimeout(timeout);
      reject(new Error(`${event.code || "conversation_failed"}: ${event.message || "Conversation failed."}`));
    }
  });
  secondSocket.send(JSON.stringify({ type: "conversation.attach", after_sequence: firstCursor }));
  releaseReconnectBarrier();
});
await closeSocket(secondSocket);

assert.ok(longCheckpointId, "The long Conversation checkpoint id was not observed.");
const checkpoint = getTaskCheckpoint(session.session_id, longCheckpointId);
assert.ok(checkpoint, "The long Conversation checkpoint is missing.");
// Assisted mode deliberately stops at the review boundary even though the
// Provider completion contract is satisfied. The test applies the accepted
// aggregate Change Set only after the Reviewer-backed DAG completes.
assert.equal(checkpoint.status, "waiting_human");
assert.equal(checkpoint.reason, "waiting_input");
assert.equal(checkpoint.provider_state?.completion_contract.status, "satisfied");
assert.ok((checkpoint.provider_state?.compaction_count || 0) >= 1, "Context compaction was not exercised.");
assert.ok(checkpoint.long_task_runtime.cumulative_reported_input_tokens >= 2_000_000, `Expected at least 2,000,000 cumulative reported input tokens; received ${checkpoint.long_task_runtime.cumulative_reported_input_tokens}.`);
assert.equal(authorizationRequestIds.size, 1, "Workspace authorization was not requested exactly once.");
assert.equal(replayEvents.filter((event) => typeof event.sequence === "number").every((event) => Number(event.sequence) > firstCursor), true, "Reconnect replay returned an event at or below after_sequence.");

const persistedConversationEvents = listConversationEvents({ workspaceId: session.workspace_id || "default", sessionId: session.session_id, afterSequence: 0, limit: 1_000 });
assert.equal(new Set(persistedConversationEvents.map((event) => event.sequence)).size, persistedConversationEvents.length, "Conversation event sequences are not unique.");
assert.equal(persistedConversationEvents.every((event, index) => index === 0 || event.sequence > persistedConversationEvents[index - 1]!.sequence), true, "Conversation event sequences are not monotonic.");
const rawReplaySequences = replayEvents.filter((event) => typeof event.sequence === "number").map((event) => Number(event.sequence));
const uniqueReplaySequences = [...new Set(rawReplaySequences)].sort((left, right) => left - right);
const expectedReplaySequences = persistedConversationEvents.filter((event) => event.sequence > firstCursor).map((event) => event.sequence);
assert.deepEqual(uniqueReplaySequences, expectedReplaySequences, "Client sequence de-duplication did not reconstruct the complete persisted event stream.");

const replay = await executeConversationTool({
  session: getSession(session.session_id)!,
  call: { id: "manual-idempotent-replay", name: "workspace_apply_operations", arguments: { idempotency_key: `long-notes-${stamp}`, operations: longWriteOperations } },
});
assert.equal(replay.is_error, false, JSON.stringify(replay.content));
assert.equal(replay.content.idempotent_replay, true, "The repeated side effect did not reuse its durable result.");
const longChangeSetId = String(getSession(session.session_id)?.metadata.latest_workspace_change_set_id || "");
const longChangeSet = getRuntimeWorkspaceChangeSet(longChangeSetId);
assert.ok(longChangeSet, "The long Conversation did not produce its reviewable Change Set.");
assert.equal(longChangeSet.status, "pending");
applyRuntimeWorkspaceChangeSet({
  changeSetId: longChangeSetId,
  actor: "desktop-e2e-user",
  comment: "Approve the governed long-task side effect before starting the next write transaction.",
});
assert.ok(fs.existsSync(path.join(workspaceRoot, "LONG_TASK_NOTES.md")), "The approved long-task output was not applied.");

const proposalSocket = await openSocket();
const proposalEvents: Array<Record<string, any>> = [];
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for the DAG proposal Conversation turn.")), 120_000);
  proposalSocket.on("message", (data) => {
    const event = JSON.parse(data.toString()) as Record<string, any>;
    proposalEvents.push(event);
    if (event.type === "conversation.completed" && event.request_id === "proposal-turn") {
      clearTimeout(timeout);
      resolve();
    }
    if (event.type === "conversation.error") {
      clearTimeout(timeout);
      reject(new Error(`${event.code || "conversation_failed"}: ${event.message || "Conversation failed."}`));
    }
  });
  proposalSocket.send(JSON.stringify({
    type: "conversation.send",
    request_id: "proposal-turn",
    content: "PROPOSE_PRODUCTION_DAG_V1: Use the registered Product, Frontend, Backend, Test, Reviewer, and Deployment Agents. Propose one production workflow, keep Frontend and Backend parallel, require test evidence and Reviewer acceptance, and do not execute before confirmation.",
    provider_connection_id: connectionId,
    model,
  }));
});
await closeSocket(proposalSocket);

const proposals = listSessionDagProposals(session.session_id);
assert.equal(proposals.length, 1, "The Conversation did not persist exactly one DAG proposal.");
const proposalId = proposals[0]!.proposal_id;
assert.ok(["review_ready", "needs_confirmation"].includes(String(getDagProposal(session.session_id, proposalId)?.status || "")), "The DAG proposal is not ready for user confirmation.");
const confirmed = await request("POST", `/api/sessions/${session.session_id}/dag-proposals/${proposalId}/confirm`, { confirmed_by: "desktop-e2e-user", start: false });
const dagId = String(confirmed.proposal.compiled_agent_dag_id || "");
assert.ok(dagId.startsWith("agent_dag_"), "Proposal confirmation did not compile a canonical AgentDag.");

const primaryRun = app.locals.runAgentDag(session.workspace_id || "default", dagId);
let observedLease = null as ReturnType<typeof getAgentDagLease>;
const leaseDeadline = Date.now() + 5_000;
while (!observedLease && Date.now() < leaseDeadline) {
  observedLease = getAgentDagLease(session.workspace_id || "default", dagId);
  if (!observedLease || observedLease.status !== "active") {
    observedLease = null;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
assert.ok(observedLease?.status === "active", "The persistent AgentDag execution lease was not observable.");
const duplicateRun = await app.locals.runAgentDag(session.workspace_id || "default", dagId);
assert.equal(duplicateRun.already_running, true, "A duplicate DAG start did not converge on the active execution.");
await primaryRun;

let dag = getAgentDag(session.workspace_id || "default", dagId);
const dagDeadline = Date.now() + 120_000;
while (dag && !["completed", "failed", "waiting_human", "cancelled"].includes(dag.status)) {
  assert.ok(Date.now() < dagDeadline, `Timed out waiting for ${dagId}; status=${dag.status}`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  dag = getAgentDag(session.workspace_id || "default", dagId);
}
assert.equal(dag?.status, "completed", JSON.stringify(dag));
assert.equal(dag?.nodes.length, 6);
assert.equal(dag?.nodes.every((node) => node.status === "completed"), true);
assert.equal(dag?.nodes.find((node) => node.role === "reviewer")?.metadata.review_verdict, "accepted");
const reviewNode = dag?.nodes.find((node) => node.metadata.definition_node_id === "review");
const deploymentNode = dag?.nodes.find((node) => node.metadata.definition_node_id === "deployment");
assert.ok(reviewNode && deploymentNode?.depends_on.includes(reviewNode.node_id), "Deployment is not gated by the compiled Reviewer node.");

const tasks = listAgentTasks(session.workspace_id || "default", dagId);
const agentRuns = listAgentRuns(session.workspace_id || "default").filter((run) => run.workflow_run_id === dagId);
const childRuns = agentRuns.filter((run) => run.node_run_id);
assert.equal(tasks.length, 6);
assert.equal(childRuns.length, 6);
assert.equal(childRuns.every((run) => run.status === "completed" && !!run.session_id && !!run.parent_agent_run_id), true, "Child AgentRun lifecycle or parent relation is incomplete.");
const runEventEvidence = childRuns.map((run) => {
  const events = listAgentRunEvents({ workspaceId: session.workspace_id || "default", agentRunId: run.agent_run_id, afterSequence: 0, limit: 1_000 });
  assert.ok(events.length >= 5, `AgentRun ${run.agent_run_id} has insufficient observable events.`);
  assert.equal(events.every((event, index) => index === 0 || event.sequence > events[index - 1]!.sequence), true, `AgentRun ${run.agent_run_id} event sequence is not monotonic.`);
  return { agent_run_id: run.agent_run_id, child_session_id: run.session_id, node_id: run.node_run_id, event_count: events.length, last_sequence: events.at(-1)?.sequence || 0 };
});
assert.equal(tasks.every((task) => listAgentResults(task.task_id).length >= 1), true, "One or more Agent tasks have no durable result.");
assert.ok(listAgentMessages(session.workspace_id || "default", dagId).length >= 18, "The A2A protocol trail is incomplete.");

let finalSession = getSession(session.session_id)!;
const projectionDeadline = Date.now() + 15_000;
while (Date.now() < projectionDeadline) {
  const candidate = String(finalSession.metadata.latest_workspace_change_set_id || "");
  const projected = candidate ? getRuntimeWorkspaceChangeSet(candidate) : null;
  if (projected && projected.changes.some((change) => change.relative_path === "deploy/release.json")) break;
  await new Promise((resolve) => setTimeout(resolve, 50));
  finalSession = getSession(session.session_id)!;
}
const changeSetId = String(finalSession.metadata.latest_workspace_change_set_id || "");
const changeSet = getRuntimeWorkspaceChangeSet(changeSetId);
assert.ok(changeSet, "The completed AgentDag did not produce a Workspace Change Set.");
assert.equal(changeSet.status, "pending");
for (const expected of ["docs/product-plan.md", "web/index.html", "server/server.js", "test/system.test.js", "deploy/release.json"]) {
  assert.ok(changeSet.changes.some((change) => change.relative_path === expected), `The final Change Set is missing ${expected}.`);
}
applyRuntimeWorkspaceChangeSet({ changeSetId, actor: "conversation-2m-dag-smoke", comment: "Apply the user-requested accepted 2M Conversation and AgentDag output." });
const testRun = await execFileAsync(process.execPath, ["--test", "test/system.test.js"], { cwd: workspaceRoot, timeout: 30_000, windowsHide: true });
assert.match(testRun.stdout, /pass 2/u);

const report = {
  ok: true,
  mode: "deterministic-provider-production-path",
  context_measurement: "cumulative_reported_model_input_tokens",
  required_context_tokens: 2_000_000,
  cumulative_reported_input_tokens: checkpoint.long_task_runtime.cumulative_reported_input_tokens,
  cumulative_total_tokens: checkpoint.long_task_runtime.cumulative_total_tokens,
  final_checkpoint_tool_rounds: checkpoint.provider_state?.tool_rounds,
  continuation_rounds: checkpoint.provider_state?.continuation_rounds,
  compaction_count: checkpoint.provider_state?.compaction_count,
  compression_provider_calls: compactionCalls,
  provider_rounds: providerRounds,
  session_id: session.session_id,
  checkpoint_id: checkpoint.checkpoint_id,
  checkpoint_status: checkpoint.status,
  disconnect_after_sequence: firstCursor,
  persisted_conversation_events: persistedConversationEvents.length,
  replayed_events_after_cursor_raw: rawReplaySequences.length,
  replayed_events_after_cursor_unique: uniqueReplaySequences.length,
  replay_duplicates_discarded: rawReplaySequences.length - uniqueReplaySequences.length,
  authorization_requests: authorizationRequestIds.size,
  long_task_actions: listConversationActions(session.session_id).filter((action) => action.tool_call_id.startsWith("long-")).length,
  idempotent_replay: replay.content.idempotent_replay === true,
  original_action_id: replay.content.original_action_id || null,
  long_task_change_set_id: longChangeSetId,
  proposal_id: proposalId,
  agent_dag_id: dagId,
  dag_status: dag.status,
  dag_nodes: dag.nodes.map((node) => ({ node_id: node.node_id, name: node.name, role: node.role, status: node.status, agent_id: node.binding_snapshot.agent_id, depends_on: node.depends_on, reviewer_verdict: node.metadata.review_verdict || null })),
  dag_budget_usage: dag.budget_usage,
  persistent_lease_observed: observedLease?.status === "active",
  duplicate_start_converged: duplicateRun.already_running === true,
  child_agent_runs: runEventEvidence,
  a2a_message_count: listAgentMessages(session.workspace_id || "default", dagId).length,
  workspace_change_set_id: changeSetId,
  changed_files: ["LONG_TASK_NOTES.md", ...changeSet.changes.map((change) => change.relative_path)],
  executable_test_stdout: testRun.stdout,
  workspace_root: workspaceRoot,
  isolated_data_root: dataRoot,
  report_root: reportRoot,
  duration_ms: Date.now() - startedAt,
};
fs.writeFileSync(path.join(reportRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

hub.close();
await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
