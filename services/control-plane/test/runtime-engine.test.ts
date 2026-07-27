import assert from "node:assert/strict";
import test from "node:test";
import { listApprovals } from "../src/approval-store.js";
import { listArtifacts } from "../src/artifact-store.js";
import { createEmptyExecutionRef } from "../src/execution-ref.js";
import { listRunEvents } from "../src/event-store.js";
import { saveRunRoute } from "../src/run-route-store.js";
import { createSession } from "../src/session-store.js";
import { createSessionAttachment } from "../src/session-attachment-store.js";
import { listNodeRuns, saveNodeRuns } from "../src/node-run-store.js";
import { saveRunPlan, getRunPlan } from "../src/run-plan-store.js";
import { createRun, getRun, saveRun } from "../src/run-store.js";
import type {
  RuntimeDispatchResult,
  RuntimeDispatcher,
} from "../src/runtime-dispatcher.js";
import { listRuntimeJobRecords } from "../src/runtime/runtime-job-store.js";
import { getRuntimeHumanGate } from "../src/runtime/human-gate-store.js";
import { getRuntimeEventCursor } from "../src/runtime/runtime-event-cursor-store.js";
import { RuntimeEngine } from "../src/runtime/runtime-engine.js";
import { buildRuntimeRunProjection } from "../src/runtime/runtime-run-projection.js";
import { buildRunEvidenceSnapshot } from "../src/evaluation/run-evidence-snapshot.js";
import { evaluatePipelineChecks } from "../src/evaluation/checks/pipeline.js";
import { recoverRuntimeState } from "../src/runtime/runtime-recovery.js";
import {
  getWorkerLeaseRecord,
  saveWorkerLeaseRecord,
} from "../src/runtime/worker-lease-store.js";
import { listNodeHandoffRecords } from "../src/runtime/node-handoff-store.js";
import type { NodeProvisioner } from "../src/node-provisioner.js";
import type { RuntimeWorkerJob, WorkerEvent } from "../src/runtime-protocol.js";
import type {
  CompiledNodeRecord,
  NodeRunRecord,
  NormalizedExecutionReport,
  RunPlanRecord,
  RunRecord,
} from "../src/types.js";
import { createStubExecutionAdapter, resetTestRoot } from "./helpers.js";

const timestamp = "2026-07-10T00:00:00.000Z";

function compiledNode(input: {
  nodeRunId: string;
  nodeId: string;
  name: string;
  status?: CompiledNodeRecord["status"];
  agentRuntime?: string | null;
  runtimeAgentRef?: string | null;
  harnessProfile?: string | null;
  nodeConfig?: Record<string, unknown>;
  maxAttempts?: number;
}): CompiledNodeRecord {
  const runtimeAgentRef = input.runtimeAgentRef ?? "backend-runtime";
  return {
    node_run_id: input.nodeRunId,
    node_id: input.nodeId,
    name: input.name,
    type: "agent_task",
    agent_profile: "backend",
    runtime_agent_ref: runtimeAgentRef,
    agent_runtime: input.agentRuntime ?? "local",
    harness_profile: input.harnessProfile ?? null,
    allowed_skills: [],
    allowed_tools: [],
    approval_kind: null,
    human_input_schema: null,
    status: input.status || "ready",
    retry_policy: {
      max_attempts: input.maxAttempts ?? 1,
      attempt: 0,
    },
    timeout_seconds: 900,
    parallelism_budget: 1,
    input_payload: {
      run_inputs: {
        goal: "Test runtime engine",
      },
      node_config: input.nodeConfig || {},
    },
    output_contract: {},
    execution_ref: createEmptyExecutionRef(),
    registry_provenance: {
      agent_id_requested: "backend",
      agent_id_resolved: "backend",
      agent_status: "active",
      agent_source: "registry",
      runtime_agent_ref_source: "registry",
      skill_bindings: [],
      tool_bindings: [],
    },
  };
}

function persistRuntimeRun(input: {
  intent: string;
  compiledNodes: CompiledNodeRecord[];
  nodeRuns: NodeRunRecord[];
  edges?: RunPlanRecord["edges"];
  frontier?: string[];
  runStatus?: RunRecord["status"];
  planStatus?: RunPlanRecord["status"];
}): RunRecord {
  const run = createRun({
    intent: input.intent,
    template_id: "runtime-engine-template",
    inputs: {
      goal: input.intent,
    },
    validation_mode: "bypass",
  });
  run.status = input.runStatus || "running";
  run.current_summary = "Runtime engine test run";
  run.started_at = run.started_at ?? timestamp;
  run.updated_at = timestamp;
  saveRun(run);

  const plan: RunPlanRecord = {
    run_id: run.run_id,
    template_id: run.template_id,
    template_version: run.template_version,
    workspace_id: run.workspace_id,
    requested_by: run.requested_by,
    intent: run.intent,
    inputs: run.inputs,
    compiled_nodes: input.compiledNodes,
    edges: input.edges || [],
    frontier: input.frontier || [],
    policy_snapshot: {
      max_parallel_nodes: 1,
    },
    planner_context: {},
    status: input.planStatus || "running",
    created_at: timestamp,
  };
  saveRunPlan(plan);
  saveNodeRuns(
    run.run_id,
    input.nodeRuns.map((nodeRun) => ({
      ...nodeRun,
      run_id: run.run_id,
    })),
  );
  return run;
}

class CapturingRuntimeDispatcher implements RuntimeDispatcher {
  readonly kind = "capturing-runtime";
  readonly jobs: RuntimeWorkerJob[] = [];
  readonly reports: NormalizedExecutionReport[] = [];

  enqueueRun(_runId: string): void {
    // no-op
  }

  notifyRunAction(): void {
    // no-op
  }

  notifyNodeAction(): void {
    // no-op
  }

  async dispatchJob(job: RuntimeWorkerJob): Promise<RuntimeDispatchResult> {
    this.jobs.push(job);
    return {
      status: "accepted",
      dispatch_id: `runtime-dispatch-${job.node_run_id}`,
      job,
      target_kind: job.provision.target_kind,
      worker_id: null,
      lease_id: null,
      accepted_at: timestamp,
      compatibility: {
        adapter_kind: null,
        raw_ref: {
          dispatch_id: `runtime-dispatch-${job.node_run_id}`,
          provider_refs: {},
        },
      },
    };
  }

  async handleWorkerEvent(event: WorkerEvent): Promise<void> {
    if ("report" in event) {
      this.reports.push(event.report);
    }
  }

  async handleReport(report: NormalizedExecutionReport): Promise<void> {
    this.reports.push(report);
  }
}

async function flushAsyncDispatch(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

test("RuntimeEngine applyExecutionReport completes terminal node and persists artifacts", async () => {
  resetTestRoot();
  const run = createRun({
    intent: "Runtime engine completed report",
    template_id: "runtime-engine-template",
    inputs: {
      goal: "Test completed report",
    },
    validation_mode: "bypass",
  });
  run.status = "running";
  run.current_summary = "Dispatching node: Node A";
  run.started_at = timestamp;
  run.updated_at = timestamp;
  saveRun(run);

  const plan: RunPlanRecord = {
    run_id: run.run_id,
    template_id: run.template_id,
    template_version: run.template_version,
    workspace_id: run.workspace_id,
    requested_by: run.requested_by,
    intent: run.intent,
    inputs: run.inputs,
    compiled_nodes: [
      compiledNode({
        nodeRunId: "node-run-a",
        nodeId: "node_a",
        name: "Node A",
        status: "running",
      }),
    ],
    edges: [],
    frontier: [],
    policy_snapshot: {
      max_parallel_nodes: 1,
    },
    planner_context: {},
    status: "running",
    created_at: timestamp,
  };
  saveRunPlan(plan);
  saveNodeRuns(run.run_id, [
    {
      node_run_id: "node-run-a",
      run_id: run.run_id,
      status: "running",
      progress: {
        percent: 50,
        message: "Node running",
        updated_at: timestamp,
      },
      attempt: 1,
      started_at: timestamp,
      finished_at: null,
    },
  ]);

  const refreshCalls: Array<{ runId: string; status: string }> = [];
  const engine = new RuntimeEngine({
    executionAdapter: createStubExecutionAdapter(),
    now: () => timestamp,
    refreshSessionsLinkedToRun(runId, status) {
      refreshCalls.push({ runId, status });
    },
  });

  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: "node-run-a",
    status: "completed",
    progress: {
      percent: 100,
      message: "Node A completed",
    },
    artifacts: [
      {
        artifact_id: "artifact_runtime_001",
        type: "summary",
        name: "runtime-report.txt",
        storage_uri: "bridge://dispatches/disp_runtime_001/report",
        mime_type: "text/plain",
        size_bytes: 64,
      },
    ],
    raw_ref: {
      dispatch_id: "disp_runtime_001",
      provider_refs: {
        task_id: "task_runtime_001",
        session_id: "sess_runtime_001",
      },
    },
    created_at: timestamp,
  });

  const refreshedRun = getRun(run.run_id);
  assert.equal(refreshedRun?.status, "completed");
  assert.equal(refreshedRun?.current_summary, "Run completed");

  const refreshedPlan = getRunPlan(run.run_id);
  assert.equal(refreshedPlan?.status, "completed");
  assert.equal(refreshedPlan?.compiled_nodes[0]?.status, "completed");
  assert.deepEqual(refreshedPlan?.compiled_nodes[0]?.execution_ref, {
    job_id: null,
    worker_id: null,
    lease_id: null,
    target_kind: null,
    dispatch_id: "disp_runtime_001",
    provider_refs: {
      task_id: "task_runtime_001",
      session_id: "sess_runtime_001",
    },
  });

  const refreshedNodeRuns = listNodeRuns(run.run_id);
  assert.equal(refreshedNodeRuns[0]?.status, "completed");
  assert.equal(refreshedNodeRuns[0]?.progress.message, "Node A completed");
  assert.equal(refreshedNodeRuns[0]?.finished_at, timestamp);

  const artifacts = listArtifacts(run.run_id);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.artifact_id, "artifact_runtime_001");

  const eventTypes = listRunEvents(run.run_id).map((event) => event.type);
  assert.ok(eventTypes.includes("artifact.created"));
  assert.ok(eventTypes.includes("node.completed"));
  assert.equal(eventTypes.at(-1), "run.completed");
  assert.deepEqual(refreshCalls, [{ runId: run.run_id, status: "completed" }]);
});

test("RuntimeEngine applyExecutionReport unlocks downstream nodes after completion", async () => {
  resetTestRoot();
  const run = persistRuntimeRun({
    intent: "Runtime engine downstream unlock",
    compiledNodes: [
      compiledNode({
        nodeRunId: "node-run-a",
        nodeId: "node_a",
        name: "Node A",
        status: "running",
      }),
      compiledNode({
        nodeRunId: "node-run-b",
        nodeId: "node_b",
        name: "Node B",
        status: "pending",
      }),
    ],
    edges: [{ from: "node_a", to: "node_b", condition: null, label: null }],
    nodeRuns: [
      {
        node_run_id: "node-run-a",
        run_id: "pending-run-id",
        status: "running",
        progress: {
          percent: 50,
          message: "Node running",
          updated_at: timestamp,
        },
        attempt: 1,
        started_at: timestamp,
        finished_at: null,
      },
      {
        node_run_id: "node-run-b",
        run_id: "pending-run-id",
        status: "pending",
        progress: {
          percent: 0,
          message: "Waiting for dependencies",
          updated_at: timestamp,
        },
        attempt: 0,
        started_at: null,
        finished_at: null,
      },
    ],
  });
  const adapter = createStubExecutionAdapter();
  const engine = new RuntimeEngine({
    executionAdapter: adapter,
    now: () => timestamp,
  });

  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: "node-run-a",
    status: "completed",
    progress: {
      percent: 100,
      message: "Node A completed",
    },
    artifacts: [],
    raw_ref: {
      dispatch_id: "disp_runtime_unlock_a",
      provider_refs: {
        task_id: "task_runtime_unlock_a",
        session_id: "sess_runtime_unlock_a",
      },
    },
    created_at: timestamp,
  });

  const refreshedRun = getRun(run.run_id);
  assert.equal(refreshedRun?.status, "running");
  assert.equal(refreshedRun?.current_summary, "Dispatching node: Node B");

  const refreshedPlan = getRunPlan(run.run_id);
  assert.equal(refreshedPlan?.status, "running");
  assert.equal(refreshedPlan?.compiled_nodes[0]?.status, "completed");
  assert.equal(refreshedPlan?.compiled_nodes[1]?.status, "running");

  const refreshedNodeRuns = listNodeRuns(run.run_id);
  assert.equal(refreshedNodeRuns[0]?.status, "completed");
  assert.equal(refreshedNodeRuns[1]?.status, "running");
  assert.equal(adapter.dispatchEnvelopes.length, 1);
  assert.equal(adapter.dispatchEnvelopes[0]?.node_run_id, "node-run-b");

  const eventTypes = listRunEvents(run.run_id).map((event) => event.type);
  assert.ok(eventTypes.includes("node.ready"));
  assert.ok(eventTypes.includes("node.started"));
});

test("RuntimeEngine applyExecutionReport creates approval gate for waiting_human", async () => {
  resetTestRoot();
  const run = persistRuntimeRun({
    intent: "Runtime engine approval gate",
    compiledNodes: [
      compiledNode({
        nodeRunId: "node-run-a",
        nodeId: "node_a",
        name: "Node A",
        status: "running",
      }),
    ],
    nodeRuns: [
      {
        node_run_id: "node-run-a",
        run_id: "pending-run-id",
        status: "running",
        progress: {
          percent: 50,
          message: "Node running",
          updated_at: timestamp,
        },
        attempt: 1,
        started_at: timestamp,
        finished_at: null,
      },
    ],
  });
  const engine = new RuntimeEngine({
    executionAdapter: createStubExecutionAdapter(),
    now: () => timestamp,
  });

  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: "node-run-a",
    status: "waiting_human",
    progress: {
      percent: 60,
      message: "Need approval before continuing",
    },
    artifacts: [],
    raw_ref: {
      dispatch_id: "disp_runtime_wait_a",
      provider_refs: {
        task_id: "task_runtime_wait_a",
        session_id: "sess_runtime_wait_a",
      },
    },
    human_gate: {
      gate_id: "gate-runtime-a",
      kind: "approval",
      summary: "Need approval before continuing",
      input_schema: null,
      requested_at: timestamp,
    },
    created_at: timestamp,
  }, {
    jobId: "job-runtime-wait-a",
    workerId: "worker-runtime-wait-a",
  });

  const refreshedRun = getRun(run.run_id);
  assert.equal(refreshedRun?.status, "waiting_human");
  assert.equal(refreshedRun?.waiting_reason, "Need approval before continuing");

  const approvals = listApprovals("pending");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]?.run_id, run.run_id);
  assert.equal(approvals[0]?.node_run_id, "node-run-a");
  assert.equal(approvals[0]?.gate_id, "gate-runtime-a");
  const gate = getRuntimeHumanGate(run.run_id, "gate-runtime-a");
  assert.equal(gate?.status, "suspended");
  assert.equal(gate?.job_id, "job-runtime-wait-a");
  assert.equal(gate?.worker_id, "worker-runtime-wait-a");

  const eventTypes = listRunEvents(run.run_id).map((event) => event.type);
  assert.ok(eventTypes.includes("approval.requested"));
});

for (const terminalStatus of ["failed", "cancelled"] as const) {
  test(`RuntimeEngine applyExecutionReport marks run ${terminalStatus}`, async () => {
    resetTestRoot();
    const run = persistRuntimeRun({
      intent: `Runtime engine ${terminalStatus} report`,
      compiledNodes: [
        compiledNode({
          nodeRunId: "node-run-a",
          nodeId: "node_a",
          name: "Node A",
          status: "running",
        }),
      ],
      nodeRuns: [
        {
          node_run_id: "node-run-a",
          run_id: "pending-run-id",
          status: "running",
          progress: {
            percent: 50,
            message: "Node running",
            updated_at: timestamp,
          },
          attempt: 1,
          started_at: timestamp,
          finished_at: null,
        },
      ],
    });
    const engine = new RuntimeEngine({
      executionAdapter: createStubExecutionAdapter(),
      now: () => timestamp,
    });

    await engine.applyExecutionReport({
      run_id: run.run_id,
      node_run_id: "node-run-a",
      status: terminalStatus,
      progress: {
        percent: 100,
        message: `Node A ${terminalStatus}`,
      },
      artifacts: [],
      error: {
        code: "runtime_terminal",
        message: `Node A ${terminalStatus}`,
      },
      raw_ref: {
        dispatch_id: `disp_runtime_${terminalStatus}_a`,
        provider_refs: {
          task_id: `task_runtime_${terminalStatus}_a`,
          session_id: `sess_runtime_${terminalStatus}_a`,
        },
      },
      created_at: timestamp,
    });

    const refreshedRun = getRun(run.run_id);
    assert.equal(refreshedRun?.status, terminalStatus);
    assert.equal(refreshedRun?.blocked_reason, `Node A ${terminalStatus}`);
    assert.equal(refreshedRun?.finished_at, timestamp);

    const refreshedPlan = getRunPlan(run.run_id);
    assert.equal(refreshedPlan?.status, terminalStatus);
    assert.equal(refreshedPlan?.compiled_nodes[0]?.status, terminalStatus);

    const refreshedNodeRuns = listNodeRuns(run.run_id);
    assert.equal(refreshedNodeRuns[0]?.status, terminalStatus);
    assert.equal(refreshedNodeRuns[0]?.finished_at, timestamp);

    const eventTypes = listRunEvents(run.run_id).map((event) => event.type);
    assert.ok(eventTypes.includes("node.failed"));
  });
}

test("RuntimeEngine queueReadyNodes dispatches RuntimeWorkerJob through dispatcher", async () => {
  resetTestRoot();
  const run = createRun({
    intent: "Runtime engine worker job dispatch",
    template_id: "runtime-engine-template",
    inputs: {
      goal: "Dispatch through runtime job",
    },
    validation_mode: "bypass",
  });
  const session = createSession({
    title: "Runtime context session",
    initial_message: "Use the attached local brief.",
  });
  createSessionAttachment({
    sessionId: session.session_id,
    createdAt: timestamp,
    request: {
      name: "brief.md",
      storage_uri: "file:///workspace/docs/brief.md",
      mime_type: "text/markdown",
      size_bytes: 22,
      kind: "context",
      created_by: "studio-desktop",
      metadata: {
        source: "desktop_workspace",
        relative_path: "docs/brief.md",
        desktop_text_content: "Runtime context brief.\n",
      },
    },
  });
  saveRunRoute({
    schema_version: 1,
    run_id: run.run_id,
    route_id: `template:${run.template_id}@${run.template_version}`,
    source_kind: "direct_template",
    session_id: session.session_id,
    proposal_id: null,
    plan_revision: null,
    plan_option: null,
    source_run_id: null,
    template_id: run.template_id,
    template_version: run.template_version,
    template_name: "Runtime Engine Template",
    node_count: 1,
    edge_count: 0,
    work_packages: [],
    created_at: run.created_at,
  });

  const plan: RunPlanRecord = {
    run_id: run.run_id,
    template_id: run.template_id,
    template_version: run.template_version,
    workspace_id: run.workspace_id,
    requested_by: run.requested_by,
    intent: run.intent,
    inputs: run.inputs,
    compiled_nodes: [
      compiledNode({
        nodeRunId: "node-run-codex",
        nodeId: "node_codex",
        name: "Codex Node",
        agentRuntime: "codex",
        runtimeAgentRef: "codex-runtime",
        harnessProfile: "coding",
        nodeConfig: {
          worker_image: "my-mate-runtime-worker:0.1.0",
        },
      }),
    ],
    edges: [],
    frontier: ["node-run-codex"],
    policy_snapshot: {
      max_parallel_nodes: 1,
    },
    planner_context: {},
    status: "queued",
    created_at: timestamp,
  };
  saveRunPlan(plan);
  saveNodeRuns(run.run_id, [
    {
      node_run_id: "node-run-codex",
      run_id: run.run_id,
      status: "ready",
      progress: {
        percent: 0,
        message: "Ready for dispatch",
        updated_at: timestamp,
      },
      attempt: 0,
      started_at: null,
      finished_at: null,
    },
  ]);

  const dispatcher = new CapturingRuntimeDispatcher();
  const engine = new RuntimeEngine({
    dispatcher,
    now: () => timestamp,
  });

  const result = await engine.queueReadyNodes(run.run_id, "run_created");
  await flushAsyncDispatch();

  assert.equal(result.dispatched_nodes, 1);
  assert.equal(dispatcher.jobs.length, 1);
  const job = dispatcher.jobs[0];
  assert.ok(job);
  assert.equal(
    job.job_id,
    `${run.run_id}:node-run-codex:attempt-1:dispatch-1`,
  );
  assert.equal(job.harness.agent_runtime, "codex");
  assert.equal(job.harness.runtime_agent_ref, "codex-runtime");
  assert.equal(job.provision.target_kind, "docker-worker");
  assert.equal(job.provision.required, true);
  assert.equal(job.provision.workspace.context?.source_session_id, session.session_id);
  assert.equal(job.provision.workspace.context?.files[0]?.relative_path, "docs/brief.md");
  assert.equal(job.provision.workspace.context?.files[0]?.content, "Runtime context brief.\n");

  const jobRecords = listRuntimeJobRecords(run.run_id);
  assert.equal(jobRecords.length, 1);
  assert.equal(jobRecords[0]?.job_id, job.job_id);
  assert.equal(jobRecords[0]?.status, "accepted");
  assert.equal(jobRecords[0]?.target_kind, "docker-worker");
  assert.equal(jobRecords[0]?.agent_runtime, "codex");
  assert.equal(jobRecords[0]?.runtime_agent_ref, "codex-runtime");
  assert.equal(jobRecords[0]?.compatibility.dispatch_id, "runtime-dispatch-node-run-codex");

  const events = listRunEvents(run.run_id);
  const startedEvent = events.find((event) => event.type === "node.started");
  assert.ok(startedEvent);
  assert.equal(startedEvent.payload.job_id, job.job_id);
  assert.equal(startedEvent.payload.target_kind, "docker-worker");
  assert.equal(startedEvent.payload.agent_runtime, "codex");
  assert.equal(startedEvent.payload.runtime_agent_ref, "codex-runtime");
  const createdEvent = events.find((event) => event.type === "job.created");
  assert.equal((createdEvent?.payload.workspace_context as Record<string, unknown>)?.file_count, 1);

  assert.equal(dispatcher.reports.length, 1);
  assert.equal(dispatcher.reports[0]?.status, "accepted");
  assert.equal(dispatcher.reports[0]?.raw_ref.dispatch_id, "runtime-dispatch-node-run-codex");
});

test("RuntimeEngine queueReadyNodes respects max_parallel_nodes", async () => {
  resetTestRoot();
  const run = createRun({
    intent: "Runtime engine parallelism",
    template_id: "runtime-engine-template",
    inputs: {
      goal: "Test runtime engine",
    },
    validation_mode: "bypass",
  });

  const plan: RunPlanRecord = {
    run_id: run.run_id,
    template_id: run.template_id,
    template_version: run.template_version,
    workspace_id: run.workspace_id,
    requested_by: run.requested_by,
    intent: run.intent,
    inputs: run.inputs,
    compiled_nodes: [
      compiledNode({
        nodeRunId: "node-run-a",
        nodeId: "node_a",
        name: "Node A",
      }),
      compiledNode({
        nodeRunId: "node-run-b",
        nodeId: "node_b",
        name: "Node B",
      }),
    ],
    edges: [],
    frontier: ["node-run-a", "node-run-b"],
    policy_snapshot: {
      max_parallel_nodes: 1,
    },
    planner_context: {},
    status: "queued",
    created_at: timestamp,
  };
  saveRunPlan(plan);
  saveNodeRuns(run.run_id, [
    {
      node_run_id: "node-run-a",
      run_id: run.run_id,
      status: "ready",
      progress: {
        percent: 0,
        message: "Ready for dispatch",
        updated_at: timestamp,
      },
      attempt: 0,
      started_at: null,
      finished_at: null,
    },
    {
      node_run_id: "node-run-b",
      run_id: run.run_id,
      status: "ready",
      progress: {
        percent: 0,
        message: "Ready for dispatch",
        updated_at: timestamp,
      },
      attempt: 0,
      started_at: null,
      finished_at: null,
    },
  ]);

  const adapter = createStubExecutionAdapter();
  const engine = new RuntimeEngine({
    executionAdapter: adapter,
    now: () => timestamp,
  });

  const result = await engine.queueReadyNodes(run.run_id, "run_created");

  assert.equal(result.scanned_ready_nodes, 2);
  assert.equal(result.dispatched_nodes, 1);
  assert.equal(adapter.dispatchEnvelopes.length, 1);
  assert.equal(adapter.dispatchEnvelopes[0]?.node_run_id, "node-run-a");

  const refreshedPlan = getRunPlan(run.run_id);
  assert.ok(refreshedPlan);
  assert.equal(refreshedPlan.compiled_nodes[0]?.status, "running");
  assert.equal(refreshedPlan.compiled_nodes[1]?.status, "ready");

  const refreshedNodeRuns = listNodeRuns(run.run_id);
  assert.equal(refreshedNodeRuns[0]?.status, "running");
  assert.equal(refreshedNodeRuns[1]?.status, "ready");
});

test("RuntimeEngine ignores duplicate, out-of-order, and post-terminal worker events", async () => {
  resetTestRoot();
  const nodeRunId = "node-run-event-order";
  const run = persistRuntimeRun({
    intent: "Verify worker event delivery",
    compiledNodes: [
      compiledNode({
        nodeRunId,
        nodeId: "node_event_order",
        name: "Event order node",
        status: "running",
      }),
    ],
    nodeRuns: [
      {
        node_run_id: nodeRunId,
        run_id: "placeholder",
        status: "running",
        progress: { percent: 10, message: "Started", updated_at: timestamp },
        attempt: 1,
        started_at: timestamp,
        finished_at: null,
      },
    ],
    frontier: [nodeRunId],
  });
  const dispatcher = new CapturingRuntimeDispatcher();
  const engine = new RuntimeEngine({
    dispatcher,
    now: () => timestamp,
  });
  const jobId = `${run.run_id}:${nodeRunId}:attempt-1:dispatch-1`;
  const buildReportEvent = (input: {
    eventId: string;
    idempotencyKey: string;
    sequence: number;
    kind: "worker.progress" | "worker.completed";
    status: "running" | "completed";
    percent: number;
  }): WorkerEvent => ({
    event_id: input.eventId,
    idempotency_key: input.idempotencyKey,
    sequence: input.sequence,
    kind: input.kind,
    job_id: jobId,
    run_id: run.run_id,
    node_run_id: nodeRunId,
    worker_id: "worker-event-order",
    created_at: timestamp,
    report: {
      run_id: run.run_id,
      node_run_id: nodeRunId,
      status: input.status,
      progress: { percent: input.percent, message: input.status },
      artifacts: [],
      error: null,
      raw_ref: {
        job_id: jobId,
        worker_id: "worker-event-order",
        lease_id: null,
        target_kind: "docker-worker",
        dispatch_id: `dispatch:${jobId}`,
        provider_refs: {},
      },
      created_at: timestamp,
    },
  });
  const progressEvent = buildReportEvent({
    eventId: "event-progress-1",
    idempotencyKey: "event-order-progress-1",
    sequence: 1,
    kind: "worker.progress",
    status: "running",
    percent: 50,
  });

  assert.deepEqual(await engine.applyWorkerEvent(progressEvent), {
    apply: true,
    reason: "new_event",
  });
  const eventCountAfterProgress = listRunEvents(run.run_id).length;
  assert.deepEqual(await engine.applyWorkerEvent(progressEvent), {
    apply: false,
    reason: "duplicate",
  });
  assert.equal(listRunEvents(run.run_id).length, eventCountAfterProgress);

  const outOfOrder = buildReportEvent({
    eventId: "event-progress-replayed",
    idempotencyKey: "event-order-progress-replayed",
    sequence: 1,
    kind: "worker.progress",
    status: "running",
    percent: 40,
  });
  assert.deepEqual(await engine.applyWorkerEvent(outOfOrder), {
    apply: false,
    reason: "out_of_order",
  });
  assert.equal(listRunEvents(run.run_id).length, eventCountAfterProgress);

  const completedEvent = buildReportEvent({
    eventId: "event-completed-2",
    idempotencyKey: "event-order-completed-2",
    sequence: 2,
    kind: "worker.completed",
    status: "completed",
    percent: 100,
  });
  assert.deepEqual(await engine.applyWorkerEvent(completedEvent), {
    apply: true,
    reason: "new_event",
  });
  const eventCountAfterTerminal = listRunEvents(run.run_id).length;

  const postTerminal = buildReportEvent({
    eventId: "event-progress-3",
    idempotencyKey: "event-order-progress-3",
    sequence: 3,
    kind: "worker.progress",
    status: "running",
    percent: 90,
  });
  assert.deepEqual(await engine.applyWorkerEvent(postTerminal), {
    apply: false,
    reason: "terminal_closed",
  });
  assert.equal(listRunEvents(run.run_id).length, eventCountAfterTerminal);

  const cursor = getRuntimeEventCursor(jobId);
  assert.ok(cursor);
  assert.equal(cursor.last_sequence, 2);
  assert.equal(cursor.terminal_event_id, completedEvent.event_id);
  assert.equal(cursor.ignored_event_count, 3);
});

test("RuntimeEngine routes handoff ports and skips untaken branches", async () => {
  resetTestRoot();
  const sourceNodeRunId = "node-run-handoff-source";
  const successNodeRunId = "node-run-handoff-success";
  const failureNodeRunId = "node-run-handoff-failure";
  const run = persistRuntimeRun({
    intent: "Route a worker handoff",
    compiledNodes: [
      compiledNode({
        nodeRunId: sourceNodeRunId,
        nodeId: "source",
        name: "Source",
        status: "running",
      }),
      compiledNode({
        nodeRunId: successNodeRunId,
        nodeId: "success_target",
        name: "Success target",
        status: "pending",
      }),
      compiledNode({
        nodeRunId: failureNodeRunId,
        nodeId: "failure_target",
        name: "Failure target",
        status: "pending",
      }),
    ],
    nodeRuns: [
      {
        node_run_id: sourceNodeRunId,
        run_id: "placeholder",
        status: "running",
        progress: { percent: 60, message: "Running", updated_at: timestamp },
        attempt: 1,
        started_at: timestamp,
        finished_at: null,
      },
      {
        node_run_id: successNodeRunId,
        run_id: "placeholder",
        status: "pending",
        progress: { percent: 0, message: "Pending", updated_at: timestamp },
        attempt: 0,
        started_at: null,
        finished_at: null,
      },
      {
        node_run_id: failureNodeRunId,
        run_id: "placeholder",
        status: "pending",
        progress: { percent: 0, message: "Pending", updated_at: timestamp },
        attempt: 0,
        started_at: null,
        finished_at: null,
      },
    ],
    edges: [
      {
        from: "source",
        to: "success_target",
        from_port: "success",
        to_port: null,
        label: "success route",
        condition: null,
      },
      {
        from: "source",
        to: "failure_target",
        from_port: "failure",
        to_port: null,
        label: "failure route",
        condition: null,
      },
    ],
    frontier: [sourceNodeRunId],
  });
  const dispatcher = new CapturingRuntimeDispatcher();
  const engine = new RuntimeEngine({
    dispatcher,
    now: () => timestamp,
  });
  const jobId = `${run.run_id}:${sourceNodeRunId}:attempt-1:dispatch-1`;

  const decision = await engine.applyWorkerEvent({
    event_id: "event-handoff-success",
    idempotency_key: "handoff-success-1",
    sequence: 1,
    kind: "worker.handoff",
    job_id: jobId,
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    worker_id: "worker-handoff",
    created_at: timestamp,
    handoff: {
      type: "node_handoff",
      handoff_id: "handoff-success",
      job_id: jobId,
      run_id: run.run_id,
      node_run_id: sourceNodeRunId,
      node_id: "source",
      port: "success",
      content: { result: "ok" },
      content_ref: null,
      summary: "Routed through success",
      created_at: timestamp,
    },
  });

  assert.deepEqual(decision, { apply: true, reason: "new_event" });
  const nodeRuns = listNodeRuns(run.run_id);
  assert.equal(nodeRuns.find((node) => node.node_run_id === successNodeRunId)?.status, "ready");
  assert.equal(nodeRuns.find((node) => node.node_run_id === failureNodeRunId)?.status, "skipped");
  const handoff = listNodeHandoffRecords(run.run_id)[0];
  assert.deepEqual(handoff?.routed_node_run_ids, [successNodeRunId]);
  assert.deepEqual(handoff?.skipped_node_run_ids, [failureNodeRunId]);
  const routedNode = getRunPlan(run.run_id)?.compiled_nodes.find(
    (node) => node.node_run_id === successNodeRunId,
  );
  assert.deepEqual(routedNode?.input_payload.upstream_handoffs, [
    {
      source_node_id: "source",
      source_node_run_id: sourceNodeRunId,
      port: "success",
      content: { result: "ok" },
      content_ref: null,
      summary: "Routed through success",
      source_outcome: "completed",
      synthetic: false,
    },
  ]);

  await engine.applyWorkerEvent({
    event_id: "event-handoff-source-completed",
    idempotency_key: "handoff-source-completed-2",
    sequence: 2,
    kind: "worker.completed",
    job_id: jobId,
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    worker_id: "worker-handoff",
    created_at: timestamp,
    report: {
      run_id: run.run_id,
      node_run_id: sourceNodeRunId,
      status: "completed",
      progress: { percent: 100, message: "Source completed" },
      artifacts: [],
      error: null,
      raw_ref: {
        job_id: jobId,
        worker_id: "worker-handoff",
        lease_id: null,
        target_kind: "docker-worker",
        dispatch_id: `dispatch:${jobId}`,
        provider_refs: {},
      },
      created_at: timestamp,
    },
  });

  const deadline = Date.now() + 1000;
  while (dispatcher.jobs.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(dispatcher.jobs[0]?.node_run_id, successNodeRunId);
});

test("RuntimeEngine evaluates conditions independently for edges sharing a handoff port", async () => {
  resetTestRoot();
  const sourceNodeRunId = "node-run-conditioned-source";
  const acceptedNodeRunId = "node-run-conditioned-accepted";
  const rejectedNodeRunId = "node-run-conditioned-rejected";
  const run = persistRuntimeRun({
    intent: "Route by structured handoff content",
    compiledNodes: [
      compiledNode({ nodeRunId: sourceNodeRunId, nodeId: "source", name: "Source", status: "running" }),
      compiledNode({ nodeRunId: acceptedNodeRunId, nodeId: "accepted", name: "Accepted", status: "pending" }),
      compiledNode({ nodeRunId: rejectedNodeRunId, nodeId: "rejected", name: "Rejected", status: "pending" }),
    ],
    nodeRuns: [
      { node_run_id: sourceNodeRunId, run_id: "placeholder", status: "running", progress: { percent: 60, message: "Running", updated_at: timestamp }, attempt: 1, started_at: timestamp, finished_at: null },
      { node_run_id: acceptedNodeRunId, run_id: "placeholder", status: "pending", progress: { percent: 0, message: "Pending", updated_at: timestamp }, attempt: 0, started_at: null, finished_at: null },
      { node_run_id: rejectedNodeRunId, run_id: "placeholder", status: "pending", progress: { percent: 0, message: "Pending", updated_at: timestamp }, attempt: 0, started_at: null, finished_at: null },
    ],
    edges: [
      { from: "source", to: "accepted", from_port: "result", to_port: null, label: "accepted", condition: { path: "handoff.content.score", op: "gte", value: 90 } },
      { from: "source", to: "rejected", from_port: "result", to_port: null, label: "rejected", condition: { path: "handoff.content.score", op: "lt", value: 90 } },
    ],
    frontier: [sourceNodeRunId],
  });
  const engine = new RuntimeEngine({ dispatcher: new CapturingRuntimeDispatcher(), now: () => timestamp });

  await engine.applyWorkerEvent({
    event_id: "event-conditioned-handoff",
    idempotency_key: "event-conditioned-handoff",
    sequence: 1,
    kind: "worker.handoff",
    job_id: "job-conditioned-handoff",
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    worker_id: "worker-conditioned",
    created_at: timestamp,
    handoff: {
      type: "node_handoff",
      handoff_id: "handoff-conditioned",
      job_id: "job-conditioned-handoff",
      run_id: run.run_id,
      node_run_id: sourceNodeRunId,
      node_id: "source",
      port: "result",
      content: { score: 94 },
      content_ref: null,
      summary: "Scored result",
      created_at: timestamp,
    },
  });

  const nodeRuns = listNodeRuns(run.run_id);
  assert.equal(nodeRuns.find((node) => node.node_run_id === acceptedNodeRunId)?.status, "ready");
  assert.equal(nodeRuns.find((node) => node.node_run_id === rejectedNodeRunId)?.status, "skipped");
  const handoff = listNodeHandoffRecords(run.run_id)[0];
  assert.deepEqual(handoff?.routing_decisions?.map((decision) => decision.matched), [true, false]);
});

test("RuntimeEngine routes terminal failure to recovery and completes with failed source evidence", async () => {
  resetTestRoot();
  const sourceNodeRunId = "node-run-failure-source";
  const recoveryNodeRunId = "node-run-failure-recovery";
  const run = persistRuntimeRun({
    intent: "Recover a terminal node failure",
    compiledNodes: [
      compiledNode({ nodeRunId: sourceNodeRunId, nodeId: "source", name: "Source", status: "running", maxAttempts: 1 }),
      compiledNode({ nodeRunId: recoveryNodeRunId, nodeId: "recovery", name: "Recovery", status: "pending" }),
    ],
    nodeRuns: [
      { node_run_id: sourceNodeRunId, run_id: "placeholder", status: "running", progress: { percent: 50, message: "Running", updated_at: timestamp }, attempt: 1, started_at: timestamp, finished_at: null },
      { node_run_id: recoveryNodeRunId, run_id: "placeholder", status: "pending", progress: { percent: 0, message: "Pending", updated_at: timestamp }, attempt: 0, started_at: null, finished_at: null },
    ],
    edges: [
      { from: "source", to: "recovery", from_port: "failure", to_port: null, label: "recover", condition: { kind: "on_failure" } },
    ],
    frontier: [sourceNodeRunId],
  });
  const dispatcher = new CapturingRuntimeDispatcher();
  const engine = new RuntimeEngine({ dispatcher, now: () => timestamp });

  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    status: "failed",
    progress: { percent: 100, message: "Provider failed" },
    artifacts: [],
    error: { code: "provider_failed", message: "Provider failed" },
    raw_ref: { dispatch_id: "dispatch-failure-source", provider_refs: {} },
    created_at: timestamp,
  }, { workerEventId: "event-failure-source", jobId: "job-failure-source" });

  assert.equal(getRun(run.run_id)?.status, "running");
  assert.equal(listNodeRuns(run.run_id).find((node) => node.node_run_id === sourceNodeRunId)?.status, "failed");
  assert.ok(["ready", "running"].includes(
    listNodeRuns(run.run_id).find((node) => node.node_run_id === recoveryNodeRunId)?.status || "",
  ));
  assert.equal(listNodeHandoffRecords(run.run_id)[0]?.synthetic, true);
  const recoveryDispatchDeadline = Date.now() + 1000;
  while (
    !dispatcher.jobs.some((job) => job.node_run_id === recoveryNodeRunId) &&
    Date.now() < recoveryDispatchDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(dispatcher.jobs.some((job) => job.node_run_id === recoveryNodeRunId));
  await flushAsyncDispatch();

  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: recoveryNodeRunId,
    status: "completed",
    progress: { percent: 100, message: "Recovery completed" },
    artifacts: [],
    error: null,
    raw_ref: { dispatch_id: "dispatch-failure-recovery", provider_refs: {} },
    created_at: timestamp,
  }, { workerEventId: "event-failure-recovery", jobId: "job-failure-recovery" });

  assert.equal(getRun(run.run_id)?.status, "completed");
  assert.equal(listNodeRuns(run.run_id).find((node) => node.node_run_id === sourceNodeRunId)?.status, "failed");
  const completedEvent = listRunEvents(run.run_id).find((event) => event.type === "run.completed");
  assert.deepEqual(completedEvent?.payload.recovered_failed_node_run_ids, [sourceNodeRunId]);
  const graph = buildRuntimeRunProjection(run.run_id)?.graph;
  assert.ok(graph?.nodes.find((node) => node.nodeRunId === sourceNodeRunId)?.markers.includes("recovered_failure"));
  assert.equal(graph?.edges[0]?.status, "satisfied");
  assert.equal(graph?.runtimeMonitoring.progress.blockedNodes, 0);
  const findings = evaluatePipelineChecks(buildRunEvidenceSnapshot(run.run_id, {
    allowIncomplete: true,
    generatedAt: "2026-07-10T00:01:00.000Z",
  }));
  assert.equal(
    findings.find((finding) => finding.check_id === "pipeline.terminal_projection_consistency")?.passed,
    true,
  );
  assert.equal(
    findings.find((finding) => finding.check_id === "pipeline.required_handoffs")?.passed,
    true,
  );
  const terminalRegressionFinding = findings.find(
    (finding) => finding.check_id === "pipeline.no_terminal_regression",
  );
  assert.equal(terminalRegressionFinding?.passed, true, terminalRegressionFinding?.detail);
});

test("RuntimeEngine fails closed when failure conditions do not match", async () => {
  resetTestRoot();
  const sourceNodeRunId = "node-run-mismatch-source";
  const recoveryNodeRunId = "node-run-mismatch-recovery";
  const run = persistRuntimeRun({
    intent: "Reject unmatched failure recovery",
    compiledNodes: [
      compiledNode({ nodeRunId: sourceNodeRunId, nodeId: "source", name: "Source", status: "running", maxAttempts: 1 }),
      compiledNode({ nodeRunId: recoveryNodeRunId, nodeId: "recovery", name: "Recovery", status: "pending" }),
    ],
    nodeRuns: [
      { node_run_id: sourceNodeRunId, run_id: "placeholder", status: "running", progress: { percent: 50, message: "Running", updated_at: timestamp }, attempt: 1, started_at: timestamp, finished_at: null },
      { node_run_id: recoveryNodeRunId, run_id: "placeholder", status: "pending", progress: { percent: 0, message: "Pending", updated_at: timestamp }, attempt: 0, started_at: null, finished_at: null },
    ],
    edges: [
      { from: "source", to: "recovery", from_port: "failure", to_port: null, label: "quota only", condition: { path: "error.code", op: "eq", value: "quota" } },
    ],
    frontier: [sourceNodeRunId],
  });
  const engine = new RuntimeEngine({ dispatcher: new CapturingRuntimeDispatcher(), now: () => timestamp });

  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    status: "failed",
    progress: { percent: 100, message: "Authentication failed" },
    artifacts: [],
    error: { code: "auth", message: "Authentication failed" },
    raw_ref: { dispatch_id: "dispatch-mismatch", provider_refs: {} },
    created_at: timestamp,
  }, { workerEventId: "event-mismatch", jobId: "job-mismatch" });

  assert.equal(getRun(run.run_id)?.status, "failed");
  assert.equal(listNodeRuns(run.run_id).find((node) => node.node_run_id === recoveryNodeRunId)?.status, "skipped");
  assert.deepEqual(listNodeHandoffRecords(run.run_id)[0]?.routed_node_run_ids, []);
});

test("RuntimeEngine leaves the run failed for an explicit unrouted failure handoff", async () => {
  resetTestRoot();
  const sourceNodeRunId = "node-run-explicit-failure-source";
  const recoveryNodeRunId = "node-run-explicit-failure-target";
  const run = persistRuntimeRun({
    intent: "Reject an unrouted explicit failure",
    compiledNodes: [
      compiledNode({ nodeRunId: sourceNodeRunId, nodeId: "source", name: "Source", status: "running", maxAttempts: 1 }),
      compiledNode({ nodeRunId: recoveryNodeRunId, nodeId: "recovery", name: "Recovery", status: "pending" }),
    ],
    nodeRuns: [
      { node_run_id: sourceNodeRunId, run_id: "placeholder", status: "running", progress: { percent: 50, message: "Running", updated_at: timestamp }, attempt: 1, started_at: timestamp, finished_at: null },
      { node_run_id: recoveryNodeRunId, run_id: "placeholder", status: "pending", progress: { percent: 0, message: "Pending", updated_at: timestamp }, attempt: 0, started_at: null, finished_at: null },
    ],
    edges: [
      { from: "source", to: "recovery", from_port: "failure", to_port: null, label: "quota only", condition: { path: "handoff.content.code", op: "eq", value: "quota" } },
    ],
    frontier: [sourceNodeRunId],
  });
  const engine = new RuntimeEngine({ dispatcher: new CapturingRuntimeDispatcher(), now: () => timestamp });
  await engine.applyWorkerEvent({
    event_id: "event-explicit-failure-handoff",
    idempotency_key: "event-explicit-failure-handoff",
    sequence: 1,
    kind: "worker.handoff",
    job_id: "job-explicit-failure",
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    worker_id: "worker-explicit-failure",
    created_at: timestamp,
    handoff: {
      type: "node_handoff",
      handoff_id: "handoff-explicit-failure",
      job_id: "job-explicit-failure",
      run_id: run.run_id,
      node_run_id: sourceNodeRunId,
      node_id: "source",
      port: "failure",
      content: { code: "auth" },
      content_ref: null,
      summary: "Authentication failure",
      created_at: timestamp,
    },
  });
  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    status: "failed",
    progress: { percent: 100, message: "Authentication failure" },
    artifacts: [],
    error: { code: "auth", message: "Authentication failure" },
    raw_ref: { dispatch_id: "dispatch-explicit-failure", provider_refs: {} },
    created_at: timestamp,
  }, { workerEventId: "event-explicit-failure-report", jobId: "job-explicit-failure" });

  assert.equal(getRun(run.run_id)?.status, "failed");
  assert.ok(listNodeHandoffRecords(run.run_id).every((handoff) => handoff.routed_node_run_ids.length === 0));
});

test("RuntimeEngine exhausts retry before evaluating failure recovery", async () => {
  resetTestRoot();
  const sourceNodeRunId = "node-run-retry-before-recovery-source";
  const recoveryNodeRunId = "node-run-retry-before-recovery-target";
  const run = persistRuntimeRun({
    intent: "Retry before recovery",
    compiledNodes: [
      compiledNode({ nodeRunId: sourceNodeRunId, nodeId: "source", name: "Source", status: "running", maxAttempts: 2 }),
      compiledNode({ nodeRunId: recoveryNodeRunId, nodeId: "recovery", name: "Recovery", status: "pending" }),
    ],
    nodeRuns: [
      { node_run_id: sourceNodeRunId, run_id: "placeholder", status: "running", progress: { percent: 50, message: "Running", updated_at: timestamp }, attempt: 1, started_at: timestamp, finished_at: null },
      { node_run_id: recoveryNodeRunId, run_id: "placeholder", status: "pending", progress: { percent: 0, message: "Pending", updated_at: timestamp }, attempt: 0, started_at: null, finished_at: null },
    ],
    edges: [
      { from: "source", to: "recovery", from_port: "failure", to_port: null, label: "recover", condition: { kind: "on_failure" } },
    ],
    frontier: [sourceNodeRunId],
  });
  const engine = new RuntimeEngine({ dispatcher: new CapturingRuntimeDispatcher(), now: () => timestamp, retryDelayMs: 60000 });
  await engine.applyWorkerEvent({
    event_id: "event-retry-before-recovery-handoff",
    idempotency_key: "event-retry-before-recovery-handoff",
    sequence: 1,
    kind: "worker.handoff",
    job_id: "job-retry-before-recovery",
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    worker_id: "worker-retry-before-recovery",
    created_at: timestamp,
    handoff: {
      type: "node_handoff",
      handoff_id: "handoff-retry-before-recovery",
      job_id: "job-retry-before-recovery",
      run_id: run.run_id,
      node_run_id: sourceNodeRunId,
      node_id: "source",
      port: "failure",
      content: { code: "transient" },
      content_ref: null,
      summary: "Transient failure",
      created_at: timestamp,
    },
  });
  assert.deepEqual(listNodeHandoffRecords(run.run_id)[0]?.routed_node_run_ids, []);
  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    status: "failed",
    progress: { percent: 100, message: "Transient failure" },
    artifacts: [],
    error: { code: "transient", message: "Transient failure" },
    raw_ref: { dispatch_id: "dispatch-retry-before-recovery", provider_refs: {} },
    created_at: timestamp,
  }, { workerEventId: "event-retry-before-recovery", jobId: "job-retry-before-recovery" });

  assert.equal(getRun(run.run_id)?.status, "running");
  assert.equal(listNodeRuns(run.run_id).find((node) => node.node_run_id === sourceNodeRunId)?.status, "ready");
  assert.equal(listNodeRuns(run.run_id).find((node) => node.node_run_id === recoveryNodeRunId)?.status, "pending");
  assert.equal(listNodeHandoffRecords(run.run_id).length, 1);

  await engine.applyExecutionReport({
    run_id: run.run_id,
    node_run_id: sourceNodeRunId,
    status: "completed",
    progress: { percent: 100, message: "Retry succeeded" },
    artifacts: [],
    error: null,
    raw_ref: { dispatch_id: "dispatch-retry-success", provider_refs: {} },
    created_at: timestamp,
  }, { workerEventId: "event-retry-success", jobId: "job-retry-success" });
  assert.equal(getRun(run.run_id)?.status, "completed");
  assert.equal(listNodeRuns(run.run_id).find((node) => node.node_run_id === sourceNodeRunId)?.status, "completed");
  assert.equal(listNodeRuns(run.run_id).find((node) => node.node_run_id === recoveryNodeRunId)?.status, "skipped");
  assert.equal(
    listNodeHandoffRecords(run.run_id).find(
      (handoff) => handoff.job_id === "job-retry-success",
    )?.source_outcome,
    "completed",
  );
});

test("RuntimeEngine retries a failed worker node while retry budget remains", async () => {
  resetTestRoot();
  const nodeRunId = "node-run-auto-retry";
  const run = persistRuntimeRun({
    intent: "Retry failed runtime node",
    compiledNodes: [
      compiledNode({
        nodeRunId,
        nodeId: "node_auto_retry",
        name: "Retry node",
        status: "running",
        maxAttempts: 2,
      }),
    ],
    nodeRuns: [
      {
        node_run_id: nodeRunId,
        run_id: "placeholder",
        status: "running",
        progress: { percent: 50, message: "Running", updated_at: timestamp },
        attempt: 1,
        started_at: timestamp,
        finished_at: null,
      },
    ],
    frontier: [nodeRunId],
  });
  const engine = new RuntimeEngine({
    dispatcher: new CapturingRuntimeDispatcher(),
    now: () => timestamp,
    retryDelayMs: 60000,
  });

  await engine.applyExecutionReport(
    {
      run_id: run.run_id,
      node_run_id: nodeRunId,
      status: "failed",
      progress: { percent: 100, message: "Transient backend failure" },
      artifacts: [],
      error: { code: "transient", message: "Transient backend failure" },
      raw_ref: {
        dispatch_id: "dispatch-auto-retry",
        provider_refs: {},
      },
      created_at: timestamp,
    },
    { workerEventId: "worker-event-auto-retry", jobId: "job-auto-retry" },
  );

  assert.equal(getRun(run.run_id)?.status, "running");
  assert.equal(getRunPlan(run.run_id)?.compiled_nodes[0]?.status, "ready");
  const nodeRun = listNodeRuns(run.run_id)[0];
  assert.equal(nodeRun?.status, "ready");
  assert.equal(nodeRun?.attempt, 1);
  assert.equal(nodeRun?.finished_at, null);
  const eventTypes = listRunEvents(run.run_id).map((event) => event.type);
  assert.ok(eventTypes.includes("node.failed"));
  assert.ok(eventTypes.includes("node.ready"));
});

test("runtime recovery releases interrupted leases and redispatches retryable nodes", async () => {
  resetTestRoot();
  const nodeRunId = "node-run-recovery";
  const run = persistRuntimeRun({
    intent: "Recover interrupted runtime",
    compiledNodes: [
      compiledNode({
        nodeRunId,
        nodeId: "node_recovery",
        name: "Recovery node",
        status: "running",
        maxAttempts: 2,
        agentRuntime: "codex",
        runtimeAgentRef: "codex-recovery",
      }),
    ],
    nodeRuns: [
      {
        node_run_id: nodeRunId,
        run_id: "placeholder",
        status: "running",
        progress: { percent: 40, message: "Running before restart", updated_at: timestamp },
        attempt: 1,
        started_at: timestamp,
        finished_at: null,
      },
    ],
    frontier: [nodeRunId],
  });
  saveWorkerLeaseRecord({
    lease_id: "lease-recovery",
    worker_id: "worker-recovery",
    job_id: "job-recovery",
    target_kind: "docker-worker",
    run_id: run.run_id,
    node_run_id: nodeRunId,
    container_id: "container-recovery",
    execution_ref: null,
    acquired_at: timestamp,
    last_heartbeat_at: timestamp,
    expires_at: null,
    released_at: null,
    release_reason: null,
    status: "active",
    last_error: null,
    metadata: { container_name: "container-recovery" },
  });
  const released: string[] = [];
  const provisioner: NodeProvisioner = {
    kind: "recovery-test",
    async provisionWorker() {
      throw new Error("Recovery test dispatcher does not provision directly.");
    },
    async releaseWorker(lease, reason) {
      released.push(`${lease.lease_id}:${reason}`);
    },
  };
  const dispatcher = new CapturingRuntimeDispatcher();
  const engine = new RuntimeEngine({ dispatcher, now: () => timestamp });

  const summary = await recoverRuntimeState({
    engine,
    provisioner,
    now: () => "2026-07-10T00:01:00.000Z",
  });

  assert.deepEqual(summary.recovered_runs, [run.run_id]);
  assert.deepEqual(summary.redispatched_runs, [run.run_id]);
  assert.deepEqual(summary.retried_nodes, [nodeRunId]);
  assert.deepEqual(summary.released_leases, ["lease-recovery"]);
  assert.deepEqual(released, ["lease-recovery:control_plane_recovery"]);
  assert.equal(dispatcher.jobs.length, 1);
  assert.equal(dispatcher.jobs[0]?.node_run_id, nodeRunId);
  assert.equal(dispatcher.jobs[0]?.attempt, 2);
  assert.equal(listNodeRuns(run.run_id)[0]?.status, "running");
  assert.equal(getRun(run.run_id)?.status, "running");
});

test("runtime recovery cleans leases for terminal runs without duplicating audit events", async () => {
  resetTestRoot();
  const nodeRunId = "node-run-terminal-recovery";
  const run = persistRuntimeRun({
    intent: "Clean terminal runtime resources",
    compiledNodes: [compiledNode({
      nodeRunId,
      nodeId: "node_terminal_recovery",
      name: "Terminal recovery node",
      status: "completed",
    })],
    nodeRuns: [{
      node_run_id: nodeRunId,
      run_id: "placeholder",
      status: "completed",
      progress: { percent: 100, message: "Completed", updated_at: timestamp },
      attempt: 1,
      started_at: timestamp,
      finished_at: timestamp,
    }],
    runStatus: "completed",
    planStatus: "completed",
  });
  saveWorkerLeaseRecord({
    lease_id: "lease-terminal-recovery",
    worker_id: "worker-terminal-recovery",
    job_id: "job-terminal-recovery",
    target_kind: "docker-worker",
    run_id: run.run_id,
    node_run_id: nodeRunId,
    container_id: "container-terminal-recovery",
    execution_ref: null,
    acquired_at: timestamp,
    last_heartbeat_at: timestamp,
    expires_at: null,
    released_at: null,
    release_reason: null,
    status: "active",
    last_error: null,
    metadata: { container_name: "container-terminal-recovery" },
  });
  const provisioner: NodeProvisioner = {
    kind: "terminal-recovery-test",
    async provisionWorker() {
      throw new Error("not used");
    },
    async releaseWorker() {},
  };
  const engine = new RuntimeEngine({ dispatcher: new CapturingRuntimeDispatcher() });

  const first = await recoverRuntimeState({ engine, provisioner, now: () => timestamp });
  const firstAuditCount = listRunEvents(run.run_id).filter((event) =>
    event.type.startsWith("lease.cleanup_"),
  ).length;
  const second = await recoverRuntimeState({ engine, provisioner, now: () => timestamp });
  const secondAuditCount = listRunEvents(run.run_id).filter((event) =>
    event.type.startsWith("lease.cleanup_"),
  ).length;

  assert.equal(first.scanned_runs, 0);
  assert.deepEqual(first.released_leases, ["lease-terminal-recovery"]);
  assert.deepEqual(second.released_leases, []);
  assert.equal(firstAuditCount, 2);
  assert.equal(secondAuditCount, firstAuditCount);
  assert.equal(
    getWorkerLeaseRecord(run.run_id, "lease-terminal-recovery")?.status,
    "released",
  );
});

test("runtime recovery cleans an active lease even when its run plan is missing", async () => {
  resetTestRoot();
  const run = createRun({
    intent: "Legacy run without a plan",
    template_id: "legacy-template",
    inputs: {},
    validation_mode: "bypass",
  });
  run.status = "running";
  saveRun(run);
  saveWorkerLeaseRecord({
    lease_id: "lease-missing-plan",
    worker_id: "worker-missing-plan",
    job_id: "job-missing-plan",
    target_kind: "docker-worker",
    run_id: run.run_id,
    node_run_id: "node-missing-plan",
    container_id: "container-missing-plan",
    execution_ref: null,
    acquired_at: timestamp,
    last_heartbeat_at: timestamp,
    expires_at: null,
    released_at: null,
    release_reason: null,
    status: "active",
    last_error: null,
    metadata: {},
  });
  const released: string[] = [];
  const provisioner: NodeProvisioner = {
    kind: "missing-plan-test",
    async provisionWorker() {
      throw new Error("not used");
    },
    async releaseWorker(lease) {
      released.push(lease.lease_id);
    },
  };

  const summary = await recoverRuntimeState({
    engine: new RuntimeEngine({ dispatcher: new CapturingRuntimeDispatcher() }),
    provisioner,
    now: () => timestamp,
  });

  assert.equal(summary.scanned_runs, 1);
  assert.deepEqual(summary.released_leases, ["lease-missing-plan"]);
  assert.deepEqual(released, ["lease-missing-plan"]);
});

test("runtime recovery blocks redispatch when lease cleanup fails", async () => {
  resetTestRoot();
  const nodeRunId = "node-run-cleanup-failure";
  const run = persistRuntimeRun({
    intent: "Do not redispatch before cleanup",
    compiledNodes: [compiledNode({
      nodeRunId,
      nodeId: "node_cleanup_failure",
      name: "Cleanup failure node",
      status: "running",
      maxAttempts: 2,
    })],
    nodeRuns: [{
      node_run_id: nodeRunId,
      run_id: "placeholder",
      status: "running",
      progress: { percent: 50, message: "Running", updated_at: timestamp },
      attempt: 1,
      started_at: timestamp,
      finished_at: null,
    }],
    frontier: [nodeRunId],
  });
  saveWorkerLeaseRecord({
    lease_id: "lease-cleanup-failure",
    worker_id: "worker-cleanup-failure",
    job_id: "job-cleanup-failure",
    target_kind: "docker-worker",
    run_id: run.run_id,
    node_run_id: nodeRunId,
    container_id: "container-cleanup-failure",
    execution_ref: null,
    acquired_at: timestamp,
    last_heartbeat_at: timestamp,
    expires_at: null,
    released_at: null,
    release_reason: null,
    status: "active",
    last_error: null,
    metadata: {},
  });
  const provisioner: NodeProvisioner = {
    kind: "cleanup-failure-test",
    async provisionWorker() {
      throw new Error("not used");
    },
    async releaseWorker() {
      throw new Error("Docker daemon rejected cleanup");
    },
  };
  const dispatcher = new CapturingRuntimeDispatcher();

  const summary = await recoverRuntimeState({
    engine: new RuntimeEngine({ dispatcher }),
    provisioner,
    now: () => timestamp,
  });

  assert.deepEqual(summary.cleanup_failed_leases, ["lease-cleanup-failure"]);
  assert.deepEqual(summary.redispatch_blocked_runs, [run.run_id]);
  assert.deepEqual(summary.redispatched_runs, []);
  assert.equal(dispatcher.jobs.length, 0);
  assert.equal(getWorkerLeaseRecord(run.run_id, "lease-cleanup-failure")?.status, "cleanup_failed");
  assert.match(getRun(run.run_id)?.blocked_reason || "", /could not be cleaned up/);
});
