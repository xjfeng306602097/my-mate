import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClientLike } from "../src/client.js";
import { executeDoctor } from "../src/commands/doctor.js";
import { executeEvaluation } from "../src/commands/evaluation.js";
import { executeRun } from "../src/commands/run.js";
import { executeScorecard } from "../src/commands/scorecard.js";
import { executeSupervise, type SuperviseResponse } from "../src/commands/supervise.js";
import { executeTrace } from "../src/commands/trace.js";
import { executeReplay } from "../src/commands/replay.js";
import { executeReplayPlan } from "../src/commands/replay-plan.js";
import { executeRerun } from "../src/commands/rerun.js";
import { executeRecovery } from "../src/commands/recovery.js";
import { executeFailureReplay } from "../src/commands/failure-replay.js";
import { executeAudit, executeWhoAmI } from "../src/commands/identity.js";
import {
  executeGovernanceDecision,
  executeGovernanceList,
  executeGovernancePropose,
} from "../src/commands/governance.js";
import { executeCostReport } from "../src/commands/cost-report.js";
import type { CommandIo } from "../src/output.js";

function captureIo(): CommandIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout(line) { out.push(line); },
    stderr(line) { err.push(line); },
  };
}

function stubClient(input: {
  get?: (path: string) => unknown | Promise<unknown>;
  post?: (path: string, body: unknown, headers?: Record<string, string>) => unknown | Promise<unknown>;
}): ApiClientLike {
  return {
    async get<T>(path: string) { return await input.get?.(path) as T; },
    async post<T>(path: string, body: unknown, headers?: Record<string, string>) { return await input.post?.(path, body, headers) as T; },
  };
}

function supervision(status: string, settled: boolean, cursor: string): SuperviseResponse {
  return {
    schema_version: 1,
    run_id: "run-cli-test",
    route: {} as SuperviseResponse["route"],
    status,
    settled,
    graph_revision: 1,
    frontier: [],
    changed_nodes: [],
    resources: {
      active_jobs: settled ? 0 : 1,
      connected_ephemeral_workers: 0,
      active_leases: settled ? 0 : 1,
    },
    gates: { approvals: [], human_inputs: [] },
    deltas: { events: [], evidence: [], handoffs: [], artifacts: [] },
    cursor,
    has_more: false,
    next_poll_after_ms: 1,
  };
}

test("doctor exit code follows the readiness dimension requested by mode", async () => {
  const io = captureIo();
  const client = stubClient({
    post: () => ({
      runtime_ready: true,
      deterministic_ready: true,
      model_ready: false,
      model_verified: null,
      storage_backend: "file-json",
      runtime_dispatcher: "docker-runtime-worker",
      checks: [],
    }),
  });
  assert.equal(await executeDoctor(client, { mode: "docker", json: true }, io), 0);
  assert.equal(await executeDoctor(client, { mode: "model", json: true }, io), 3);
});

test("supervise follow advances the opaque cursor and emits JSON Lines until settled", async () => {
  const paths: string[] = [];
  const responses = [
    supervision("running", false, "cursor-one"),
    supervision("completed", true, "cursor-two"),
  ];
  const client = stubClient({
    get: (requestPath) => {
      paths.push(requestPath);
      return responses.shift();
    },
  });
  const io = captureIo();
  const outcome = await executeSupervise(
    client,
    "run-cli-test",
    { follow: true, jsonLines: true, timeout: 5 },
    io,
    { sleep: async () => undefined },
  );
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.last?.settled, true);
  assert.equal(io.out.length, 2);
  assert.match(paths[1] || "", /cursor=cursor-one/);
});

test("supervise follow returns timeout exit code 4", async () => {
  const io = captureIo();
  const times = [0, 1_500];
  const outcome = await executeSupervise(
    stubClient({ get: () => supervision("running", false, "cursor") }),
    "run-cli-test",
    { follow: true, timeout: 1 },
    io,
    {
      sleep: async () => undefined,
      now: () => times.shift() ?? 1_500,
    },
  );
  assert.equal(outcome.exitCode, 4);
  assert.match(io.err[0] || "", /timed out/i);
});

test("scorecard command converts pipeline verdict into verification exit code", async () => {
  const io = captureIo();
  const base = {
    scorecard_id: "scorecard-cli",
    run_id: "run-cli",
    profile: "pipeline-v1",
    gate_verdict: "not_enforced" as const,
    passed_checks: 13,
    total_checks: 14,
    hard_error_count: 1,
    warning_count: 0,
    blind_spot_count: 0,
    findings: [],
  };
  const failed = await executeScorecard(
    stubClient({ post: () => ({ ...base, pipeline_verdict: "fail" }) }),
    "run-cli",
    { json: true },
    io,
  );
  const passed = await executeScorecard(
    stubClient({ post: () => ({
      ...base,
      pipeline_verdict: "pass",
      passed_checks: 14,
      hard_error_count: 0,
    }) }),
    "run-cli",
    { json: true },
    io,
  );
  assert.equal(failed.exitCode, 1);
  assert.equal(passed.exitCode, 0);
});

test("run rejects scorecard without follow before sending an API request", async () => {
  let called = false;
  const io = captureIo();
  const exitCode = await executeRun(
    stubClient({ post: () => { called = true; return {}; } }),
    {
      templateId: "template",
      intent: "intent",
      scorecard: true,
      follow: false,
    },
    io,
  );
  assert.equal(exitCode, 2);
  assert.equal(called, false);
});

test("eval keeps not_evaluated explicit and require-quality controls only CLI exit", async () => {
  const result = {
    evaluation_id: "evaluation-cli",
    run_id: "run-cli",
    evaluator: { id: "none", kind: "none" as const },
    pipeline_verdict: "pass" as const,
    contract_verdict: "not_applicable" as const,
    evidence_verdict: "complete" as const,
    usage_verdict: "unavailable" as const,
    quality_verdict: "not_evaluated" as const,
    gate_verdict: "not_enforced" as const,
    status: "completed" as const,
    error: null,
    findings: [],
  };
  const normal = await executeEvaluation(stubClient({ post: () => result }), "run-cli", { json: true }, captureIo());
  const required = await executeEvaluation(stubClient({ post: () => result }), "run-cli", { json: true, requireQuality: true }, captureIo());
  assert.equal(normal.exitCode, 0);
  assert.equal(required.exitCode, 1);
});

test("eval polls asynchronous model evaluation until terminal", async () => {
  const responses = [
    { status: "running" as const, quality_verdict: "not_evaluated" as const },
    { status: "completed" as const, quality_verdict: "pass" as const },
  ];
  const base = {
    evaluation_id: "evaluation-model-cli",
    run_id: "run-cli",
    evaluator: { id: "model-v1", kind: "model" as const },
    pipeline_verdict: "pass" as const,
    contract_verdict: "pass" as const,
    evidence_verdict: "complete" as const,
    usage_verdict: "complete" as const,
    gate_verdict: "not_enforced" as const,
    error: null,
    findings: [],
  };
  const outcome = await executeEvaluation(
    stubClient({
      post: () => ({ ...base, status: "queued", quality_verdict: "not_evaluated" }),
      get: () => ({ ...base, ...responses.shift()! }),
    }),
    "run-cli",
    { json: true, timeout: 5 },
    captureIo(),
    { sleep: async () => undefined },
  );
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.result?.quality_verdict, "pass");
});

test("trace follows cursors and renders a stable hierarchy", async () => {
  const responses = [
    {
      schema_version: 1 as const,
      run_id: "run-cli",
      trace_id: "trace:run-cli",
      completeness: "complete" as const,
      spans: [{
        span_id: "run:run-cli", parent_span_id: null, kind: "run", name: "Run", status: "ok" as const,
        started_at: "2026-07-10T00:00:00.000Z", finished_at: "2026-07-10T00:00:01.000Z",
        provider: null, model: null, tool_call_id: null, usage: null,
      }],
      cursor: "next-trace",
      has_more: true,
    },
    {
      schema_version: 1 as const,
      run_id: "run-cli",
      trace_id: "trace:run-cli",
      completeness: "complete" as const,
      spans: [{
        span_id: "node:one", parent_span_id: "run:run-cli", kind: "node", name: "Node", status: "ok" as const,
        started_at: "2026-07-10T00:00:00.100Z", finished_at: "2026-07-10T00:00:00.900Z",
        provider: null, model: null, tool_call_id: null, usage: null,
      }],
      cursor: null,
      has_more: false,
    },
  ];
  const paths: string[] = [];
  const io = captureIo();
  const outcome = await executeTrace(stubClient({ get: (requestPath) => {
    paths.push(requestPath);
    return responses.shift();
  } }), "run-cli", {}, io);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.result?.spans.length, 2);
  assert.match(paths[1] || "", /cursor=next-trace/);
  assert.match(io.out[2] || "", /^  \[ok\] node/);
});

test("replay exits 1 only for verified projection failure", async () => {
  const base = {
    replay_id: "replay-cli",
    run_id: "run-cli",
    event_completeness: "complete" as const,
    processed_events: 12,
    projection_differences: [],
    missing_references: [],
  };
  const passed = await executeReplay(stubClient({ post: () => ({ ...base, verification: "pass" }) }), "run-cli", { json: true }, captureIo());
  const partial = await executeReplay(stubClient({ post: () => ({ ...base, event_completeness: "legacy_partial", verification: "partial" }) }), "run-cli", { json: true }, captureIo());
  const failed = await executeReplay(stubClient({ post: () => ({ ...base, verification: "fail" }) }), "run-cli", { json: true }, captureIo());
  assert.equal(passed.exitCode, 0);
  assert.equal(partial.exitCode, 0);
  assert.equal(failed.exitCode, 1);
});

test("replay-plan renders categorized recommendations", async () => {
  const io = captureIo();
  const outcome = await executeReplayPlan(stubClient({ post: () => ({
    replay_plan_id: "plan-cli",
    run_id: "run-cli",
    replay_id: "replay-cli",
    summary: "One recommendation.",
    recommendations: [{
      category: "provider_harness",
      priority: "high",
      summary: "Close tool calls.",
      rationale: "A result is missing.",
      change_target: "adapter",
    }],
  }) }), "run-cli", {}, io);
  assert.equal(outcome.exitCode, 0);
  assert.match(io.out.join("\n"), /provider_harness.*Close tool calls/);
});

test("rerun sends input overrides and Idempotency-Key", async () => {
  let capturedHeaders: Record<string, string> | undefined;
  let capturedBody: unknown;
  const outcome = await executeRerun(stubClient({ post: (_path, body, headers) => {
    capturedBody = body;
    capturedHeaders = headers;
    return {
      run_id: "run-rerun",
      status: "queued",
      source_run_id: "run-source",
      rerun_reason: "retry",
      rerun_idempotency_key: "stable-key",
      route: { route_id: "template:t@1", source_kind: "rerun" },
    };
  } }), "run-source", {
    reason: "retry",
    input: ["count=2"],
    idempotencyKey: "stable-key",
    json: true,
  }, captureIo());
  assert.equal(outcome.exitCode, 0);
  assert.equal(capturedHeaders?.["idempotency-key"], "stable-key");
  assert.deepEqual(capturedBody, { reason: "retry", input_overrides: { count: 2 } });
});

test("identity commands render selected workspace and verified audit state", async () => {
  const identityIo = captureIo();
  const whoami = await executeWhoAmI(stubClient({ get: () => ({
    principal: { principal_id: "operator", display_name: "Operator", principal_type: "user" },
    selected_workspace: { workspace_id: "alpha", workspace_name: "Alpha", role: "operator" },
    permissions: ["workspace.read", "run.control"],
  }) }), {}, identityIo);
  assert.equal(whoami, 0);
  assert.match(identityIo.out.join("\n"), /Alpha.*operator/);

  const auditIo = captureIo();
  const audit = await executeAudit(stubClient({ get: () => ({ items: [], chain_verified: true }) }), {}, auditIo);
  assert.equal(audit, 0);
  assert.match(auditIo.out[0] || "", /verified/);
});

test("governance commands list, propose, and review protected changes", async () => {
  const listIo = captureIo();
  const list = await executeGovernanceList(stubClient({ get: () => ({
    policy: {
      mode: "enforced",
      required_approvals: 1,
      allow_self_approval: false,
    },
    items: [{
      change_id: "gch-one",
      status: "pending",
      action: "skill.upsert",
      resource_type: "skill",
      resource_id: "review-skill",
      approvals: [],
      required_approvals: 1,
    }],
  }) }), {}, listIo);
  assert.equal(list, 0);
  assert.match(listIo.out.join("\n"), /Governance enforced/);
  assert.match(listIo.out.join("\n"), /gch-one.*skill\.upsert/);

  let proposalPath = "";
  let proposalBody: unknown;
  const propose = await executeGovernancePropose(stubClient({ post: (path, body) => {
    proposalPath = path;
    proposalBody = body;
    return {
      change_id: "gch-two",
      status: "pending",
      action: "skill.upsert",
      resource_type: "skill",
      resource_id: "review-skill",
      approvals: [],
      required_approvals: 1,
    };
  } }), {
    action: "skill.upsert",
    resourceId: "review-skill",
    reason: "Add reviewed skill",
    payload: '{"name":"Review Skill"}',
  }, captureIo());
  assert.equal(propose, 0);
  assert.equal(proposalPath, "/api/governance/changes");
  assert.deepEqual(proposalBody, {
    action: "skill.upsert",
    resource_id: "review-skill",
    reason: "Add reviewed skill",
    payload: { name: "Review Skill" },
  });

  let decisionPath = "";
  const approve = await executeGovernanceDecision(stubClient({ post: (path) => {
    decisionPath = path;
    return {
      change_id: "gch-two",
      status: "approved",
      action: "skill.upsert",
      resource_type: "skill",
      resource_id: "review-skill",
      approvals: [{ principal_id: "reviewer" }],
      required_approvals: 1,
    };
  } }), "gch-two", "approve", { comment: "Reviewed" }, captureIo());
  assert.equal(approve, 0);
  assert.equal(decisionPath, "/api/governance/changes/gch-two/approve");
});

test("cost report renders attributed effective cost and completeness", async () => {
  let requestPath = "";
  const io = captureIo();
  const exitCode = await executeCostReport(stubClient({ get: (path) => {
    requestPath = path;
    return {
      observability: {
        query: { window_hours: 168, status: "completed" },
        cost_report: {
          basis: "provider_reported_preferred",
          coverage: {
            runs_observed: 1,
            model_jobs: 2,
            costed_jobs: 1,
            provider_reported_jobs: 1,
            estimated_only_jobs: 0,
            unavailable_jobs: 1,
            cost_completeness: "partial",
          },
          totals: {
            effective_costs: { USD: "0.12" },
            provider_reported_costs: { USD: "0.12" },
            estimated_costs: { USD: "0.1" },
          },
          by_agent: [{
            key: "research-agent",
            label: "Research Agent",
            run_count: 1,
            model_jobs: 2,
            usage_records: 1,
            costed_jobs: 1,
            unavailable_jobs: 1,
            failed_jobs: 1,
            retry_attempts: 1,
            total_tokens: 150,
            cost_source: "provider_reported",
            cost_completeness: "partial",
            effective_costs: { USD: "0.12" },
            provider_reported_costs: { USD: "0.12" },
            estimated_costs: { USD: "0.1" },
          }],
          by_provider_model: [],
          by_work_package: [],
        },
      },
    };
  } }), {
    windowHours: 168,
    status: "completed",
    groupBy: "agent",
  }, io);
  assert.equal(exitCode, 0);
  assert.match(requestPath, /window_hours=168/);
  assert.match(requestPath, /status=completed/);
  assert.match(io.out[0] || "", /partial 1\/2 jobs.*USD 0\.12/);
  assert.match(io.out.join("\n"), /Research Agent.*source=provider_reported.*failures=1.*retries=1/);
});

test("recovery command renders posture and can trigger a bounded scan", async () => {
  const io = captureIo();
  let path = "";
  const result = await executeRecovery(stubClient({ post: (requestPath) => {
    path = requestPath;
    return {
      detected: 1,
      completed: 1,
      failed: 0,
      records: [],
      recovery: {
        run_id: "run-oc02",
        generated_at: "2026-07-11T00:00:00.000Z",
        posture: "healthy",
        summary: {
          compensations: 1,
          pending_compensations: 0,
          cleanup_failures: 0,
          execution_replays: 0,
          active_replays: 0,
        },
        compensations: [],
        execution_replays: [],
      },
    };
  } }), "run-oc02", { scan: true }, io);
  assert.equal(result.exitCode, 0);
  assert.equal(path, "/api/runs/run-oc02/recovery/scan");
  assert.match(io.out.join("\n"), /scan detected=1 completed=1 failed=0/);
});

test("failure replay sends a stable idempotency key and prints lineage", async () => {
  let headers: Record<string, string> | undefined;
  const io = captureIo();
  const result = await executeFailureReplay(stubClient({ post: (_path, _body, requestHeaders) => {
    headers = requestHeaders;
    return {
      schema_version: 1,
      replay_id: "execution-replay:one",
      idempotency_key: "stable-key",
      run_id: "run-oc02",
      node_run_id: "node-oc02",
      source_job_id: "job-source",
      replay_job_id: "job-replay",
      source_attempt: 1,
      replay_attempt: 2,
      status: "dispatching",
      requested_by: "operator",
      requested_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
      completed_at: null,
      identity_digest: "digest",
      plan_identity: { template_id: "template", template_version: 1, node_id: "node", node_run_id: "node-oc02" },
      runtime_identity: { target_kind: "docker-worker", agent_runtime: "codex", runtime_agent_ref: null, harness_profile: null },
      lineage_event_ids: [],
      last_error: null,
      frozen_input: { intent: "test", input_keys: [], allowed_skills: [], allowed_tools: [] },
    };
  } }), "run-oc02", "node-oc02", { idempotencyKey: "stable-key" }, io);
  assert.equal(result.exitCode, 0);
  assert.equal(headers?.["idempotency-key"], "stable-key");
  assert.match(io.out.join("\n"), /source-job=job-source replay-job=job-replay/);
});
