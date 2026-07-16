import { buildDispatchEnvelope } from "../adapter-contracts.js";
import {
  createApprovalRecord,
  findPendingApprovalForNode,
  saveApproval,
} from "../approval-store.js";
import { saveRuntimeHumanGate } from "./human-gate-store.js";
import { materializeDynamicFanout } from "./dynamic-fanout.js";
import {
  createArtifactRecord,
  listArtifacts,
  upsertArtifacts,
} from "../artifact-store.js";
import { publishRuntimeArtifact } from "../durable-artifact-publisher.js";
import type { ExecutionAdapter } from "../execution-adapter.js";
import { appendRunEvent } from "../event-store.js";
import {
  createEmptyExecutionRef,
  createExecutionRefFromRawRef,
  createExecutionRefFromRuntimeDispatch,
} from "../execution-ref.js";
import {
  createHumanInputRecord,
  findPendingHumanInputForNode,
  saveHumanInput,
} from "../human-input-store.js";
import {
  applyNodeStatus,
  getCompiledNode,
  getMutableNodeRun,
  getReadyNodeRuns,
  unlockReadyNodeRuns,
} from "../node-scheduler.js";
import { listNodeRuns, saveNodeRuns } from "../node-run-store.js";
import { getRunPlan, saveRunPlan } from "../run-plan-store.js";
import { getRun, saveRun } from "../run-store.js";
import { getWorkspaceBinding } from "../workspace-binding-store.js";
import { finalizeRunWorkspace } from "./run-workspace.js";
import {
  ExecutionAdapterRuntimeDispatcher,
  type RuntimeDispatchResult,
  type RuntimeDispatcher,
} from "../runtime-dispatcher.js";
import {
  buildRuntimeWorkerJob,
  type WorkerEvent,
} from "../runtime-protocol.js";
import type {
  CompiledNodeRecord,
  NodeRunRecord,
  NormalizedExecutionReport,
  OpenClawReportCallbackRequest,
  RunRecord,
  RunPlanRecord,
} from "../types.js";
import { nowIso } from "../utils.js";
import {
  applyRuntimeDispatchResultToJobRecord,
  createRuntimeJobRecord,
  findLatestRuntimeJobRecordForNode,
  getRuntimeJobRecord,
  nextRuntimeDispatchSequence,
  saveRuntimeJobRecord,
  type RuntimeJobRecord,
  type RuntimeJobStatus,
} from "./runtime-job-store.js";
import {
  decideRuntimeEvent,
  recordRuntimeEventDecision,
  type RuntimeEventDecision,
} from "./runtime-event-cursor-store.js";
import {
  listNodeHandoffRecords,
  saveNodeHandoffRecord,
  type NodeHandoffRoutingDecision,
} from "./node-handoff-store.js";
import {
  evaluateEdgeCondition,
  isFailureRoutingPort,
  normalizeRoutingPort,
  outcomeFromHandoffPort,
  routingPortsMatch,
  type EdgeConditionContext,
  type EdgeOutcomeStatus,
} from "./edge-condition.js";
import {
  findDispatchableExecutionReplayForNode,
  findExecutionReplayByJobId,
  saveExecutionReplay,
} from "./execution-replay-store.js";
import { getWorkspaceContextSnapshotForRun } from "./workspace-context-snapshot.js";

export type RuntimeQueueReason =
  | "run_created"
  | "run_resumed"
  | "node_unlocked"
  | "runtime_patch"
  | "manual"
  | (string & {});

export interface RuntimeQueueResult {
  run_id: string;
  scanned_ready_nodes: number;
  dispatched_nodes: number;
  completed_end_nodes: number;
  skipped_reason: string | null;
}

export interface RuntimeEngineOptions {
  executionAdapter?: ExecutionAdapter;
  dispatcher?: RuntimeDispatcher;
  now?: () => string;
  retryDelayMs?: number;
  refreshSessionsLinkedToRun?: (runId: string, runStatus: string) => void;
}

export type RuntimeExecutionReport =
  | OpenClawReportCallbackRequest
  | NormalizedExecutionReport;

function countActiveDispatchNodes(plan: RunPlanRecord): number {
  return plan.compiled_nodes.filter((node) =>
    node.status === "running" || node.status === "waiting_human",
  ).length;
}

function resolveMaxParallelNodes(plan: RunPlanRecord): number {
  const raw =
    typeof plan.policy_snapshot.max_parallel_nodes === "number"
      ? plan.policy_snapshot.max_parallel_nodes
      : null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.floor(raw));
  }
  return 1;
}

function recoveredFailureNodeRunIds(runId: string): string[] {
  return [...new Set(
    listNodeHandoffRecords(runId)
      .filter((handoff) =>
        handoff.routed_node_run_ids.length > 0 &&
        (handoff.source_outcome === "failed" || isFailureRoutingPort(handoff.port))
      )
      .map((handoff) => handoff.node_run_id),
  )];
}

function findLatestNodeHandoffForJob(
  runId: string,
  nodeRunId: string,
  jobId?: string | null,
) {
  return listNodeHandoffRecords(runId)
    .filter((handoff) =>
      handoff.node_run_id === nodeRunId && (!jobId || handoff.job_id === jobId)
    )
    .at(-1) || null;
}

function areAllNodesCompletedOrRecovered(runId: string, nodeRuns: NodeRunRecord[]): {
  completed: boolean;
  recovered_failed_node_run_ids: string[];
} {
  const recovered = recoveredFailureNodeRunIds(runId);
  const recoveredSet = new Set(recovered);
  return {
    completed:
      nodeRuns.length > 0 &&
      nodeRuns.every((nodeRun) =>
        ["completed", "skipped", "cancelled"].includes(nodeRun.status) ||
        (nodeRun.status === "failed" && recoveredSet.has(nodeRun.node_run_id)),
      ),
    recovered_failed_node_run_ids: recovered,
  };
}

function finalizeBoundRunWorkspace(
  run: RunRecord,
  nodeRunId: string,
  jobId: string,
): { ok: true; changeSetId: string | null } | { ok: false; error: string } {
  if (!run.workspace_binding_id) return { ok: true, changeSetId: null };
  try {
    const changeSet = finalizeRunWorkspace({ runId: run.run_id, nodeRunId, jobId });
    return { ok: true, changeSetId: changeSet?.change_set_id || null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Run Workspace finalization failed.",
    };
  }
}

interface NodeHandoffRoutingResult {
  routed_node_run_ids: string[];
  skipped_node_run_ids: string[];
  routing_decisions: NodeHandoffRoutingDecision[];
  source_outcome: EdgeOutcomeStatus;
}

function isRoutedEdgeSatisfied(
  runId: string,
  plan: RunPlanRecord,
  edge: RunPlanRecord["edges"][number],
): boolean {
  const source = plan.compiled_nodes.find((candidate) => candidate.node_id === edge.from);
  const target = plan.compiled_nodes.find((candidate) => candidate.node_id === edge.to);
  if (!source || !target) {
    return false;
  }
  const edgeIndex = plan.edges.indexOf(edge);
  const edgeKey = `${edge.from}:${edgeIndex}:${edge.to}`;
  return listNodeHandoffRecords(runId).some((handoff) =>
    handoff.node_run_id === source.node_run_id &&
    handoff.routed_node_run_ids.includes(target.node_run_id) &&
    (
      !handoff.routing_decisions?.length ||
      handoff.routing_decisions.some((decision) => decision.edge_key === edgeKey && decision.matched)
    )
  );
}

export class RuntimeEngine {
  private readonly runtimeDispatcher: RuntimeDispatcher;
  private readonly usesLegacyExecutionAdapterBridge: boolean;
  private readonly getNow: () => string;
  private readonly retryDelayMs: number;
  private readonly refreshSessionsLinkedToRun?: (
    runId: string,
    runStatus: string,
  ) => void;

  constructor(options: RuntimeEngineOptions) {
    if (!options.dispatcher && !options.executionAdapter) {
      throw new Error("RuntimeEngine requires a RuntimeDispatcher or ExecutionAdapter.");
    }
    this.runtimeDispatcher =
      options.dispatcher ||
      new ExecutionAdapterRuntimeDispatcher(options.executionAdapter as ExecutionAdapter);
    this.usesLegacyExecutionAdapterBridge = !options.dispatcher;
    this.getNow = options.now || nowIso;
    this.retryDelayMs =
      options.retryDelayMs ?? Number(process.env.MY_MATE_RUNTIME_RETRY_DELAY_MS || 250);
    this.refreshSessionsLinkedToRun = options.refreshSessionsLinkedToRun;
  }

  getRuntimeStatus(): {
    dispatcher_kind: string;
    dispatch_mainline: "runtime-worker-job";
    legacy_execution_adapter_bridge: boolean;
    node_provisioner_kind: string;
    node_provisioner_status: "not_wired" | "ready" | "deferred";
    worker_hub_kind: string | null;
    connected_workers: number;
    busy_workers: number;
    stale_workers: number;
    worker_capacity_limit: number;
    worker_capacity_active: number;
    worker_queue_depth: number;
    worker_queue_limit: number;
    worker_queue_timeout_ms: number;
    worker_cleanup_pending: number;
    worker_cleanup_failed: number;
    worker_reconciliation_at: string | null;
    worker_reconciliation_status: "not_run" | "healthy" | "degraded" | "failed";
    worker_reconciliation_discovered: number;
    worker_reconciliation_orphans: number;
    worker_reconciliation_removed: number;
    worker_reconciliation_failures: number;
  } {
    const dispatcherStatus = this.runtimeDispatcher.getRuntimeStatus?.();
    return {
      dispatcher_kind: this.runtimeDispatcher.kind,
      dispatch_mainline: "runtime-worker-job",
      legacy_execution_adapter_bridge: this.usesLegacyExecutionAdapterBridge,
      node_provisioner_kind: dispatcherStatus?.node_provisioner_kind || "deferred",
      node_provisioner_status: dispatcherStatus?.node_provisioner_status || "not_wired",
      worker_hub_kind: dispatcherStatus?.worker_hub_kind || null,
      connected_workers: dispatcherStatus?.connected_workers || 0,
      busy_workers: dispatcherStatus?.busy_workers || 0,
      stale_workers: dispatcherStatus?.stale_workers || 0,
      worker_capacity_limit: dispatcherStatus?.worker_capacity_limit || 0,
      worker_capacity_active: dispatcherStatus?.worker_capacity_active || 0,
      worker_queue_depth: dispatcherStatus?.worker_queue_depth || 0,
      worker_queue_limit: dispatcherStatus?.worker_queue_limit || 0,
      worker_queue_timeout_ms: dispatcherStatus?.worker_queue_timeout_ms || 0,
      worker_cleanup_pending: dispatcherStatus?.worker_cleanup_pending || 0,
      worker_cleanup_failed: dispatcherStatus?.worker_cleanup_failed || 0,
      worker_reconciliation_at: dispatcherStatus?.worker_reconciliation_at || null,
      worker_reconciliation_status:
        dispatcherStatus?.worker_reconciliation_status || "not_run",
      worker_reconciliation_discovered:
        dispatcherStatus?.worker_reconciliation_discovered || 0,
      worker_reconciliation_orphans: dispatcherStatus?.worker_reconciliation_orphans || 0,
      worker_reconciliation_removed: dispatcherStatus?.worker_reconciliation_removed || 0,
      worker_reconciliation_failures:
        dispatcherStatus?.worker_reconciliation_failures || 0,
    };
  }

  private canRetryNode(node: CompiledNodeRecord, nodeRun: NodeRunRecord): boolean {
    return nodeRun.attempt < Math.max(1, node.retry_policy.max_attempts);
  }

  private prepareNodeRetry(input: {
    run: RunRecord;
    plan: RunPlanRecord;
    nodeRuns: NodeRunRecord[];
    node: CompiledNodeRecord;
    nodeRun: NodeRunRecord;
    timestamp: string;
    reason: string;
    failedEventId: string;
  }): string {
    const nextAttempt = input.nodeRun.attempt + 1;
    const maxAttempts = Math.max(1, input.node.retry_policy.max_attempts);
    applyNodeStatus(
      input.plan,
      input.nodeRuns,
      input.node.node_run_id,
      "ready",
      input.timestamp,
      `Retrying after failure (${nextAttempt}/${maxAttempts})`,
      0,
    );
    input.node.execution_ref = createEmptyExecutionRef();
    input.nodeRun.finished_at = null;
    const readyEvent = appendRunEvent({
      run_id: input.run.run_id,
      node_run_id: input.node.node_run_id,
      type: "node.ready",
      actor_type: "system",
      actor_id: "runtime-retry",
      payload: {
        node_id: input.node.node_id,
        node_name: input.node.name,
        previous_event_id: input.failedEventId,
        previous_attempt: input.nodeRun.attempt,
        next_attempt: nextAttempt,
        max_attempts: maxAttempts,
        reason: input.reason,
      },
      created_at: input.timestamp,
    });
    input.run.status = "running";
    input.run.current_summary = `Retrying node: ${input.node.name}`;
    input.run.blocked_reason = null;
    input.run.finished_at = null;
    input.run.updated_at = input.timestamp;
    input.run.last_event_id = readyEvent.event_id;
    input.plan.status = "running";
    saveRun(input.run);
    saveRunPlan(input.plan);
    saveNodeRuns(input.run.run_id, input.nodeRuns);
    this.refreshSessionsLinkedToRun?.(input.run.run_id, input.run.status);
    this.scheduleRetry(input.run.run_id);
    return readyEvent.event_id;
  }

  private scheduleRetry(runId: string): void {
    const timer = setTimeout(() => {
      void this.queueReadyNodes(runId, "automatic_retry");
    }, Math.max(0, this.retryDelayMs));
    timer.unref();
  }

  private async applyNodeHandoff(
    event: Extract<WorkerEvent, { kind: "worker.handoff" }>,
    options?: {
      sourceOutcome?: EdgeOutcomeStatus;
      error?: Record<string, unknown> | null;
      synthetic?: boolean;
    },
  ): Promise<NodeHandoffRoutingResult> {
    const run = getRun(event.run_id);
    const plan = getRunPlan(event.run_id);
    const nodeRuns = listNodeRuns(event.run_id);
    if (!run || !plan) {
      throw new Error("RUN_NOT_FOUND");
    }
    const source = getCompiledNode(plan, event.node_run_id);
    if (!source) {
      throw new Error("NODE_NOT_FOUND");
    }

    const timestamp = event.handoff.created_at || event.created_at || this.getNow();
    const fanout = materializeDynamicFanout({
      plan,
      nodeRuns,
      source,
      handoffId: event.handoff.handoff_id || `handoff:${event.event_id}`,
      content: event.handoff.content,
      timestamp,
    });
    if (fanout.applied) {
      appendRunEvent({
        run_id: run.run_id,
        node_run_id: source.node_run_id,
        type: "runtime.fanout_materialized",
        actor_type: "system",
        actor_id: "runtime-fanout",
        payload: {
          handoff_id: event.handoff.handoff_id || `handoff:${event.event_id}`,
          template_node_id: fanout.template_node_id,
          item_count: fanout.item_count,
          generated_node_run_ids: fanout.generated_node_run_ids,
        },
        created_at: timestamp,
        idempotency_key: `runtime.fanout:${run.run_id}:${event.handoff.handoff_id || event.event_id}`,
      });
    }

    const outgoing = plan.edges.filter((edge) => edge.from === source.node_id);
    const hasExplicitPorts = outgoing.some(
      (edge) => typeof edge.from_port === "string" && !!edge.from_port.trim(),
    );
    const sourceOutcome = options?.sourceOutcome || outcomeFromHandoffPort(event.handoff.port);
    const sourceNodeRun = getMutableNodeRun(nodeRuns, source.node_run_id);
    const deferFailureRouting =
      sourceOutcome === "failed" &&
      options?.synthetic !== true &&
      !!sourceNodeRun &&
      this.canRetryNode(source, sourceNodeRun);
    const conditionContext: EdgeConditionContext = {
      outcome: { status: sourceOutcome },
      handoff: {
        port: normalizeRoutingPort(event.handoff.port),
        content: event.handoff.content,
        content_ref: event.handoff.content_ref || null,
        summary: event.handoff.summary,
      },
      error: options?.error || null,
      source: {
        node_id: source.node_id,
        node_run_id: source.node_run_id,
        name: source.name,
        attempt: getMutableNodeRun(nodeRuns, source.node_run_id)?.attempt || 0,
      },
      run: {
        run_id: run.run_id,
        status: run.status,
      },
    };
    const evaluatedEdges = outgoing.map((edge, index) => {
      const portMatched = hasExplicitPorts
        ? routingPortsMatch(edge.from_port, event.handoff.port)
        : true;
      const evaluated =
        !edge.condition && sourceOutcome === "failed" && isFailureRoutingPort(edge.from_port)
          ? {
              matched: true,
              valid: true,
              reason: "default_on_failure_port",
              observed_path: "outcome.status",
              observed_value: sourceOutcome,
            }
          : evaluateEdgeCondition(edge.condition, conditionContext);
      const decision: NodeHandoffRoutingDecision = {
        edge_key: `${source.node_id}:${index}:${edge.to}`,
        from_node_id: edge.from,
        to_node_id: edge.to,
        from_port: edge.from_port || null,
        to_port: edge.to_port || null,
        port_matched: portMatched,
        condition_matched: evaluated.matched,
        condition_valid: evaluated.valid,
        matched: portMatched && evaluated.valid && evaluated.matched,
        reason: !portMatched ? "port_mismatch" : evaluated.reason,
      };
      return { edge, decision };
    });
    const matchingEdges = evaluatedEdges
      .filter((entry) => entry.decision.matched)
      .map((entry) => entry.edge);
    const activatedEdges = deferFailureRouting ? [] : matchingEdges;
    const routingDecisions = evaluatedEdges.map((entry) => entry.decision);
    const routedNodeRunIds: string[] = [];
    const skippedNodeRunIds: string[] = [];

    for (const edge of activatedEdges) {
      const target = plan.compiled_nodes.find((candidate) => candidate.node_id === edge.to);
      if (!target) {
        continue;
      }
      const targetRun = getMutableNodeRun(nodeRuns, target.node_run_id);
      if (!targetRun || targetRun.status !== "pending") {
        continue;
      }
      const otherDependenciesReady = plan.edges
        .filter((candidate) => candidate.to === target.node_id && candidate.from !== source.node_id)
        .every((candidate) => {
          const dependency = plan.compiled_nodes.find((node) => node.node_id === candidate.from);
          const dependencyRun = dependency
            ? getMutableNodeRun(nodeRuns, dependency.node_run_id)
            : null;
          if (!dependency || !dependencyRun) {
            return false;
          }
          if (["completed", "skipped"].includes(dependencyRun.status)) {
            return !candidate.from_port && !candidate.condition
              ? true
              : isRoutedEdgeSatisfied(run.run_id, plan, candidate);
          }
          if (dependencyRun.status !== "failed") {
            return false;
          }
          return isRoutedEdgeSatisfied(run.run_id, plan, candidate);
        });
      if (!otherDependenciesReady) {
        continue;
      }
      const existingHandoffs = Array.isArray(target.input_payload.upstream_handoffs)
        ? target.input_payload.upstream_handoffs
        : [];
      target.input_payload = {
        ...target.input_payload,
        upstream_handoffs: [
          ...existingHandoffs,
          {
            source_node_id: source.node_id,
            source_node_run_id: source.node_run_id,
            port: event.handoff.port,
            content: event.handoff.content,
            content_ref: event.handoff.content_ref,
            summary: event.handoff.summary,
            source_outcome: sourceOutcome,
            synthetic: options?.synthetic === true,
          },
        ],
      };
      applyNodeStatus(
        plan,
        nodeRuns,
        target.node_run_id,
        "ready",
        timestamp,
        `Ready from ${source.name} handoff on ${event.handoff.port}`,
        0,
      );
      routedNodeRunIds.push(target.node_run_id);
      appendRunEvent({
        run_id: run.run_id,
        node_run_id: target.node_run_id,
        type: "node.ready",
        actor_type: "system",
        actor_id: "runtime-handoff-router",
        payload: {
          source_node_run_id: source.node_run_id,
          handoff_port: event.handoff.port,
          job_id: event.job_id,
        },
        created_at: timestamp,
      });
    }

    if (
      !deferFailureRouting &&
      (hasExplicitPorts || outgoing.some((edge) => !!edge.condition) || sourceOutcome === "failed")
    ) {
      const matchedTargets = new Set(matchingEdges.map((edge) => edge.to));
      for (const edge of outgoing) {
        if (matchedTargets.has(edge.to)) {
          continue;
        }
        const target = plan.compiled_nodes.find((candidate) => candidate.node_id === edge.to);
        const targetRun = target ? getMutableNodeRun(nodeRuns, target.node_run_id) : null;
        if (!target || !targetRun || targetRun.status !== "pending") {
          continue;
        }
        const inboundEdges = plan.edges.filter((candidate) => candidate.to === target.node_id);
        if (!inboundEdges.every((candidate) => candidate.from === source.node_id)) {
          continue;
        }
        applyNodeStatus(
          plan,
          nodeRuns,
          target.node_run_id,
          "skipped",
          timestamp,
          `Branch not selected by ${event.handoff.port} handoff`,
          100,
        );
        skippedNodeRunIds.push(target.node_run_id);
        appendRunEvent({
          run_id: run.run_id,
          node_run_id: target.node_run_id,
          type: "node.skipped",
          actor_type: "system",
          actor_id: "runtime-handoff-router",
          payload: {
            source_node_run_id: source.node_run_id,
            handoff_port: event.handoff.port,
            job_id: event.job_id,
          },
          created_at: timestamp,
        });
      }
    }

    saveNodeHandoffRecord({
      ...event.handoff,
      handoff_id: event.handoff.handoff_id || `handoff:${event.event_id}`,
      job_id: event.job_id,
      routed_node_run_ids: routedNodeRunIds,
      skipped_node_run_ids: skippedNodeRunIds,
      source_outcome: sourceOutcome,
      synthetic: options?.synthetic === true,
      routing_decisions: routingDecisions,
    });
    const recordedHandoffEvent = appendRunEvent({
      run_id: run.run_id,
      node_run_id: source.node_run_id,
      type: "handoff.recorded",
      actor_type: "agent",
      actor_id: event.worker_id ? `runtime-worker:${event.worker_id}` : "runtime-worker",
      payload: {
        handoff_id: event.handoff.handoff_id || `handoff:${event.event_id}`,
        job_id: event.job_id,
        port: event.handoff.port,
        source_outcome: sourceOutcome,
        synthetic: options?.synthetic === true,
        routed_node_run_ids: routedNodeRunIds,
        skipped_node_run_ids: skippedNodeRunIds,
        routing_decisions: routingDecisions,
      },
      created_at: timestamp,
      causation_id: event.event_id,
      idempotency_key: `handoff:${event.event_id}`,
    });
    const handoffEvent = sourceNodeRun && ["completed", "failed", "skipped", "cancelled"].includes(sourceNodeRun.status)
      ? recordedHandoffEvent
      : appendRunEvent({
          run_id: run.run_id,
          node_run_id: source.node_run_id,
          type: "node.progress",
          actor_type: "agent",
          actor_id: event.worker_id ? `runtime-worker:${event.worker_id}` : "runtime-worker",
          payload: {
            kind: "node_handoff",
            port: event.handoff.port,
            summary: event.handoff.summary,
            job_id: event.job_id,
            source_outcome: sourceOutcome,
            synthetic: options?.synthetic === true,
            routed_node_run_ids: routedNodeRunIds,
            skipped_node_run_ids: skippedNodeRunIds,
          },
          created_at: timestamp,
          causation_id: recordedHandoffEvent.event_id,
        });
    run.last_event_id = handoffEvent.event_id;
    run.updated_at = timestamp;
    run.current_summary =
      event.handoff.summary ||
      `Handoff ${event.handoff.port} routed to ${routedNodeRunIds.length} node(s)`;
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(run.run_id, nodeRuns);
    this.refreshSessionsLinkedToRun?.(run.run_id, run.status);
    return {
      routed_node_run_ids: routedNodeRunIds,
      skipped_node_run_ids: skippedNodeRunIds,
      routing_decisions: routingDecisions,
      source_outcome: sourceOutcome,
    };
  }

  async applyWorkerEvent(event: WorkerEvent): Promise<RuntimeEventDecision> {
    const decision = decideRuntimeEvent(event);
    if (!decision.apply) {
      recordRuntimeEventDecision(event, decision);
      return decision;
    }

    if (event.kind === "worker.handoff") {
      await this.applyNodeHandoff(event);
    } else if ("report" in event) {
      await this.applyExecutionReport(event.report, {
        actorId: event.worker_id ? `runtime-worker:${event.worker_id}` : "runtime-worker",
        workerId: event.worker_id,
        workerEventId: event.event_id,
        jobId: event.job_id,
      });
    } else if (event.kind === "worker.provisioning_failed") {
      await this.applyExecutionReport(
        {
          run_id: event.run_id,
          node_run_id: event.node_run_id,
          status: "failed",
          progress: {
            percent: 100,
            message: event.reason,
          },
          artifacts: [],
          error: {
            code: "worker_provisioning_failed",
            message: event.reason,
          },
          raw_ref: {
            dispatch_id: null,
            openclaw_task_id: null,
            openclaw_session_id: null,
          },
          created_at: event.created_at,
        },
        {
          actorId: "runtime-provisioner",
          workerEventId: event.event_id,
          jobId: event.job_id,
        },
      );
    }

    recordRuntimeEventDecision(event, decision);
    return decision;
  }

  private buildAcceptedReportFromDispatch(
    result: RuntimeDispatchResult,
  ): NormalizedExecutionReport {
    return {
      run_id: result.job.run_id,
      node_run_id: result.job.node_run_id,
      status: "accepted",
      progress: {
        percent: 0,
        message: "Dispatch accepted",
      },
      artifacts: [],
      error: null,
      raw_ref: result.compatibility.raw_ref,
      created_at: this.getNow(),
    };
  }

  private updateRuntimeJobFromReport(input: {
    report: RuntimeExecutionReport;
    status: RuntimeJobStatus;
    timestamp: string;
    lastEventId?: string | null;
    lastError?: string | null;
  }): void {
    const record = findLatestRuntimeJobRecordForNode(
      input.report.run_id,
      input.report.node_run_id,
    );
    if (!record) {
      return;
    }

    record.status = input.status;
    if (input.status === "accepted") {
      record.accepted_at = record.accepted_at || input.timestamp;
    }
    if (input.status === "completed" || input.status === "failed" || input.status === "cancelled") {
      record.finished_at = record.finished_at || input.timestamp;
    }
    if (input.lastEventId !== undefined) {
      record.last_event_id = input.lastEventId;
    }
    if (input.lastError !== undefined) {
      record.last_error = input.lastError;
    }
    if (input.report.raw_ref) {
      record.compatibility = {
        ...record.compatibility,
        dispatch_id: input.report.raw_ref.dispatch_id,
        openclaw_task_id: input.report.raw_ref.openclaw_task_id,
        openclaw_session_id: input.report.raw_ref.openclaw_session_id,
      };
    }
    saveRuntimeJobRecord(record);
    const replay = findExecutionReplayByJobId(record.run_id, record.job_id);
    if (replay) {
      replay.status = input.status === "completed"
        ? "completed"
        : input.status === "failed"
          ? "failed"
          : input.status === "cancelled"
            ? "cancelled"
            : input.status === "running" || input.status === "waiting_human"
              ? "running"
              : "dispatching";
      replay.updated_at = input.timestamp;
      replay.completed_at = ["completed", "failed", "cancelled"].includes(input.status)
        ? input.timestamp
        : null;
      replay.last_error = input.lastError ?? replay.last_error;
      if (["completed", "failed", "cancelled"].includes(input.status)) {
        const replayEvent = appendRunEvent({
          run_id: record.run_id,
          node_run_id: record.node_run_id,
          type: input.status === "completed" ? "recovery.replay_completed" : "recovery.replay_failed",
          actor_type: "system",
          actor_id: "runtime-replay",
          payload: {
            replay_id: replay.replay_id,
            source_job_id: replay.source_job_id,
            replay_job_id: record.job_id,
            status: input.status,
            error: input.lastError ?? null,
          },
          created_at: input.timestamp,
          idempotency_key: `recovery.replay_terminal:${replay.replay_id}:${input.status}`,
        });
        if (!replay.lineage_event_ids.includes(replayEvent.event_id)) replay.lineage_event_ids.push(replayEvent.event_id);
      }
      saveExecutionReplay(replay);
    }
  }

  private markRuntimeJobDispatchFailed(input: {
    record: RuntimeJobRecord;
    error: unknown;
    failedAt: string;
    lastEventId?: string | null;
  }): void {
    const message = input.error instanceof Error ? input.error.message : "Runtime dispatch failed";
    input.record.status = "failed";
    input.record.finished_at = input.failedAt;
    input.record.last_error = message;
    if (input.lastEventId !== undefined) {
      input.record.last_event_id = input.lastEventId;
    }
    saveRuntimeJobRecord(input.record);
    const replay = findExecutionReplayByJobId(input.record.run_id, input.record.job_id);
    if (replay) {
      replay.status = "failed";
      replay.updated_at = input.failedAt;
      replay.completed_at = input.failedAt;
      replay.last_error = message;
      const event = appendRunEvent({
        run_id: replay.run_id,
        node_run_id: replay.node_run_id,
        type: "recovery.replay_failed",
        actor_type: "system",
        actor_id: "runtime-replay",
        payload: {
          replay_id: replay.replay_id,
          source_job_id: replay.source_job_id,
          replay_job_id: input.record.job_id,
          error: message,
          phase: "dispatch",
        },
        created_at: input.failedAt,
        idempotency_key: `recovery.replay_failed:${replay.replay_id}:dispatch`,
      });
      replay.lineage_event_ids.push(event.event_id);
      saveExecutionReplay(replay);
    }
  }

  async applyExecutionReport(
    report: RuntimeExecutionReport,
    context?: {
      actorId?: string;
      workerEventId?: string;
      jobId?: string;
      workerId?: string | null;
    },
  ): Promise<void> {
    const run = getRun(report.run_id);
    const plan = getRunPlan(report.run_id);
    const nodeRuns = listNodeRuns(report.run_id);
    if (!run || !plan) {
      throw new Error("RUN_NOT_FOUND");
    }

    const node = getCompiledNode(plan, report.node_run_id);
    const nodeRun = getMutableNodeRun(nodeRuns, report.node_run_id);
    if (!node || !nodeRun) {
      throw new Error("NODE_NOT_FOUND");
    }

    const timestamp = report.created_at || this.getNow();
    const actorId = context?.actorId || "execution-runtime";
    const progress = report.progress || null;
    const normalizedMessage =
      progress?.message ||
      (report.status === "completed"
        ? "Node completed"
        : report.status === "failed"
          ? report.error?.message || "Node failed"
          : report.status === "accepted"
            ? "Dispatch accepted"
            : "Node running");
    const normalizedPercent =
      typeof progress?.percent === "number"
        ? progress.percent
        : report.status === "completed" || report.status === "failed"
          ? 100
          : report.status === "accepted"
            ? 0
            : 50;
    const routingJobId =
      context?.jobId || `${run.run_id}:${node.node_run_id}:attempt-${nodeRun.attempt}`;
    const humanGate = "human_gate" in report ? report.human_gate : null;

    if (report.raw_ref) {
      node.execution_ref = createExecutionRefFromRawRef(report.raw_ref, node.execution_ref);
    }

    if (report.status === "accepted") {
      nodeRun.progress = {
        percent: normalizedPercent,
        message: normalizedMessage,
        updated_at: timestamp,
      };
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      const jobEvent = appendRunEvent({
        run_id: run.run_id,
        node_run_id: report.node_run_id,
        type: "job.accepted",
        actor_type: "system",
        actor_id: actorId,
        payload: {
          job_id: context?.jobId || null,
          worker_event_id: context?.workerEventId || null,
        },
        created_at: timestamp,
        causation_id: context?.workerEventId || null,
      });
      this.updateRuntimeJobFromReport({
        report,
        status: "accepted",
        timestamp,
        lastEventId: jobEvent.event_id,
      });
      return;
    }

    if (report.status === "running" || report.status === "waiting_human") {
      applyNodeStatus(
        plan,
        nodeRuns,
        report.node_run_id,
        report.status,
        timestamp,
        normalizedMessage,
        normalizedPercent,
      );

      let eventType:
        | "approval.requested"
        | "approval.granted"
        | "human_input.requested"
        | "human_input.submitted"
        | "node.progress" =
        "node.progress";
      let shouldAutoResumeNode = false;
      if (report.status === "waiting_human") {
        const nativeGate = humanGate;
        if (nativeGate && context?.jobId) {
          saveRuntimeHumanGate({
            gate_id: nativeGate.gate_id,
            kind: nativeGate.kind,
            status: "suspended",
            transport: "worker_native",
            run_id: run.run_id,
            node_run_id: report.node_run_id,
            job_id: context.jobId,
            worker_id: context.workerId || null,
            summary: nativeGate.summary,
            input_schema: nativeGate.input_schema,
            request_payload: null,
            response_payload: null,
            requested_at: nativeGate.requested_at,
            suspended_at: timestamp,
            resolved_at: null,
            control_id: null,
            last_error: null,
          });
        }
        if ((process.env.MY_MATE_AUTO_APPROVE_HUMAN_GATES || "false").toLowerCase() === "true") {
          shouldAutoResumeNode = true;
          eventType = node.human_input_schema ? "human_input.submitted" : "approval.granted";
        } else {
          if (node.human_input_schema) {
            eventType = "human_input.requested";
            const pendingInput = findPendingHumanInputForNode(run.run_id, report.node_run_id);
            if (!pendingInput) {
              saveHumanInput(
                createHumanInputRecord({
                  runId: run.run_id,
                  nodeRunId: report.node_run_id,
                  summary: normalizedMessage,
                  inputSchema: node.human_input_schema,
                  requestedAt: timestamp,
                  gateId: nativeGate?.gate_id || null,
                }),
              );
            }
          } else {
            eventType = "approval.requested";
            const pendingApproval = findPendingApprovalForNode(run.run_id, report.node_run_id);
            if (!pendingApproval) {
              saveApproval(
                createApprovalRecord({
                  runId: run.run_id,
                  nodeRunId: report.node_run_id,
                  kind: node.approval_kind || "human_review",
                  summary: normalizedMessage,
                  requestedAt: timestamp,
                  gateId: nativeGate?.gate_id || null,
                }),
              );
            }
          }
        }
      }

      const event = appendRunEvent({
        run_id: run.run_id,
        node_run_id: report.node_run_id,
        type: eventType,
        actor_type: "agent",
        actor_id: actorId,
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          message: normalizedMessage,
          percent: normalizedPercent,
          auto_approved: shouldAutoResumeNode,
          job_id: context?.jobId || null,
          worker_event_id: context?.workerEventId || null,
          gate_id: humanGate?.gate_id || null,
        },
        created_at: timestamp,
      });
      const jobEvent = appendRunEvent({
        run_id: run.run_id,
        node_run_id: report.node_run_id,
        type: report.status === "waiting_human" ? "job.waiting_human" : "job.running",
        actor_type: "agent",
        actor_id: actorId,
        payload: {
          job_id: context?.jobId || null,
          worker_event_id: context?.workerEventId || null,
          percent: normalizedPercent,
        },
        created_at: timestamp,
        causation_id: event.event_id,
      });

      if (shouldAutoResumeNode) {
        node.status = "ready";
        node.execution_ref = createEmptyExecutionRef();
        node.retry_policy.attempt = nodeRun.attempt;
        nodeRun.status = "ready";
        nodeRun.progress = {
          percent: 0,
          message: "Human gate auto-approved; ready for dispatch",
          updated_at: timestamp,
        };
        nodeRun.finished_at = null;
      }

      run.status =
        report.status === "waiting_human" && !shouldAutoResumeNode
          ? "waiting_human"
          : "running";
      run.current_summary = shouldAutoResumeNode
        ? `Human gate auto-approved: ${node.name}`
        : normalizedMessage;
      run.waiting_reason =
        report.status === "waiting_human" && !shouldAutoResumeNode
          ? normalizedMessage
          : run.waiting_reason;
      run.updated_at = timestamp;
      run.last_event_id = event.event_id;
      plan.status = run.status;
      saveRun(run);
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      this.updateRuntimeJobFromReport({
        report,
        status: report.status,
        timestamp,
        lastEventId: jobEvent.event_id,
      });
      this.refreshSessionsLinkedToRun?.(run.run_id, run.status);
      if (shouldAutoResumeNode) {
        void this.queueReadyNodes(run.run_id);
      }
      return;
    }

    if (report.status === "failed" || report.status === "cancelled") {
      applyNodeStatus(
        plan,
        nodeRuns,
        report.node_run_id,
        report.status,
        timestamp,
        normalizedMessage,
        normalizedPercent,
      );

      const event = appendRunEvent({
        run_id: run.run_id,
        node_run_id: report.node_run_id,
        type: "node.failed",
        actor_type: "agent",
        actor_id: actorId,
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          error: report.error || null,
          job_id: context?.jobId || null,
          worker_event_id: context?.workerEventId || null,
        },
        created_at: timestamp,
      });
      const jobEvent = appendRunEvent({
        run_id: run.run_id,
        node_run_id: report.node_run_id,
        type: report.status === "cancelled" ? "job.cancelled" : "job.failed",
        actor_type: "agent",
        actor_id: actorId,
        payload: {
          job_id: context?.jobId || null,
          worker_event_id: context?.workerEventId || null,
          error: report.error || null,
        },
        created_at: timestamp,
        causation_id: event.event_id,
      });

      run.status = report.status === "cancelled" ? "cancelled" : "failed";
      run.current_summary = normalizedMessage;
      run.blocked_reason = report.error?.message || normalizedMessage;
      run.finished_at = timestamp;
      run.updated_at = timestamp;
      run.last_event_id = event.event_id;
      plan.status = run.status;
      saveRun(run);
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      this.updateRuntimeJobFromReport({
        report,
        status: report.status,
        timestamp,
        lastEventId: jobEvent.event_id,
        lastError: report.error?.message || normalizedMessage,
      });
      if (
        report.status === "failed" &&
        !!context?.workerEventId &&
        (!context.jobId || getRuntimeJobRecord(run.run_id, context.jobId)?.execution_kind !== "failure_replay") &&
        this.canRetryNode(node, nodeRun)
      ) {
        this.prepareNodeRetry({
          run,
          plan,
          nodeRuns,
          node,
          nodeRun,
          timestamp,
          reason: report.error?.message || normalizedMessage,
          failedEventId: event.event_id,
        });
        return;
      }

      if (report.status === "failed") {
        const outgoing = plan.edges.filter((edge) => edge.from === node.node_id);
        const latestHandoff = findLatestNodeHandoffForJob(
          run.run_id,
          node.node_run_id,
          routingJobId,
        );
        let recoveryRouting: NodeHandoffRoutingResult | null =
          latestHandoff &&
          latestHandoff.routed_node_run_ids.length > 0 &&
          (latestHandoff.source_outcome === "failed" || isFailureRoutingPort(latestHandoff.port))
            ? {
                routed_node_run_ids: latestHandoff.routed_node_run_ids,
                skipped_node_run_ids: latestHandoff.skipped_node_run_ids,
                routing_decisions: latestHandoff.routing_decisions || [],
                source_outcome: "failed" as const,
              }
            : null;

        if (
          !recoveryRouting &&
          outgoing.some((edge) => isFailureRoutingPort(edge.from_port) || !!edge.condition)
        ) {
          const stableSource = routingJobId;
          const handoffId = `handoff:failure:${stableSource}`;
          const errorContent = report.error || {
            code: "runtime_node_failed",
            message: normalizedMessage,
          };
          recoveryRouting = await this.applyNodeHandoff(
            {
              event_id: `${context?.workerEventId || handoffId}:failure-routing`,
              idempotency_key: `failure-routing:${stableSource}`,
              sequence: 0,
              kind: "worker.handoff",
              job_id: context?.jobId || stableSource,
              run_id: run.run_id,
              node_run_id: node.node_run_id,
              worker_id: null,
              created_at: timestamp,
              handoff: {
                type: "node_handoff",
                handoff_id: handoffId,
                job_id: context?.jobId || stableSource,
                run_id: run.run_id,
                node_run_id: node.node_run_id,
                node_id: node.node_id,
                port: "failure",
                content: {
                  outcome: "failed",
                  error: errorContent,
                },
                content_ref: null,
                summary: `Failure routed from ${node.name}: ${normalizedMessage}`,
                created_at: timestamp,
              },
            },
            {
              sourceOutcome: "failed",
              error: errorContent,
              synthetic: true,
            },
          );
        }

        if (recoveryRouting && recoveryRouting.routed_node_run_ids.length > 0) {
          const recoveredRun = getRun(run.run_id);
          const recoveredPlan = getRunPlan(run.run_id);
          if (!recoveredRun || !recoveredPlan) {
            throw new Error("RUN_NOT_FOUND");
          }
          const recoveryEvent = appendRunEvent({
            run_id: run.run_id,
            node_run_id: node.node_run_id,
            type: "recovery.failure_routed",
            actor_type: "system",
            actor_id: "runtime-failure-router",
            payload: {
              kind: "failure_recovery_routed",
              job_id: context?.jobId || null,
              failed_node_run_id: node.node_run_id,
              recovery_node_run_ids: recoveryRouting.routed_node_run_ids,
            },
            created_at: timestamp,
            causation_id: event.event_id,
            idempotency_key: `failure-recovery-routed:${context?.jobId || node.node_run_id}:${nodeRun.attempt}`,
          });
          recoveredRun.status = "running";
          recoveredRun.current_summary =
            `Failure recovery routed to ${recoveryRouting.routed_node_run_ids.length} node(s)`;
          recoveredRun.blocked_reason = null;
          recoveredRun.finished_at = null;
          recoveredRun.updated_at = timestamp;
          recoveredRun.last_event_id = recoveryEvent.event_id;
          recoveredPlan.status = "running";
          saveRun(recoveredRun);
          saveRunPlan(recoveredPlan);
          this.refreshSessionsLinkedToRun?.(run.run_id, recoveredRun.status);
          void this.queueReadyNodes(run.run_id, "failure_recovery");
          return;
        }
      }
      const partialWorkspaceFinalization = finalizeBoundRunWorkspace(
        run,
        report.node_run_id,
        report.raw_ref?.job_id || `run:${run.run_id}:partial`,
      );
      if (partialWorkspaceFinalization.ok && partialWorkspaceFinalization.changeSetId) {
        run.current_summary = `${run.current_summary}; partial Workspace changes are ready for review`;
        saveRun(run);
      } else if (!partialWorkspaceFinalization.ok) {
        run.blocked_reason = `${run.blocked_reason || normalizedMessage}; ${partialWorkspaceFinalization.error}`;
        saveRun(run);
      }
      this.refreshSessionsLinkedToRun?.(run.run_id, run.status);
      return;
    }

    if (report.status !== "completed") {
      throw new Error("INVALID_REPORT_STATUS");
    }

    const outgoing = plan.edges.filter((edge) => edge.from === node.node_id);
    let currentHandoff = findLatestNodeHandoffForJob(
      run.run_id,
      node.node_run_id,
      routingJobId,
    );
    if (
      !currentHandoff &&
      outgoing.some((edge) => !!edge.from_port || !!edge.condition)
    ) {
      const stableSource = routingJobId;
      const handoffId = `handoff:success:${stableSource}`;
      await this.applyNodeHandoff(
        {
          event_id: `${context?.workerEventId || handoffId}:success-routing`,
          idempotency_key: `success-routing:${stableSource}`,
          sequence: 0,
          kind: "worker.handoff",
          job_id: context?.jobId || stableSource,
          run_id: run.run_id,
          node_run_id: node.node_run_id,
          worker_id: null,
          created_at: timestamp,
          handoff: {
            type: "node_handoff",
            handoff_id: handoffId,
            job_id: context?.jobId || stableSource,
            run_id: run.run_id,
            node_run_id: node.node_run_id,
            node_id: node.node_id,
            port: "success",
            content: {
              outcome: "completed",
              progress: report.progress,
              artifacts: report.artifacts || [],
            },
            content_ref: null,
            summary: `Success routed from ${node.name}: ${normalizedMessage}`,
            created_at: timestamp,
          },
        },
        {
          sourceOutcome: "completed",
          synthetic: true,
        },
      );
      await this.applyExecutionReport(report, context);
      return;
    }

    const terminalFailureHandoff = currentHandoff;
    if (
      terminalFailureHandoff &&
      terminalFailureHandoff.routed_node_run_ids.length === 0 &&
      (terminalFailureHandoff.source_outcome === "failed" ||
        isFailureRoutingPort(terminalFailureHandoff.port))
    ) {
      await this.applyExecutionReport(
        {
          ...report,
          status: "failed",
          progress: {
            percent: 100,
            message: `Failure handoff ${terminalFailureHandoff.port} has no matching recovery edge`,
          },
          error: {
            code: "unrouted_failure_handoff",
            message: `Failure handoff ${terminalFailureHandoff.port} has no matching recovery edge`,
          },
        },
        context,
      );
      return;
    }

    applyNodeStatus(
      plan,
      nodeRuns,
      report.node_run_id,
      "completed",
      timestamp,
      normalizedMessage,
      normalizedPercent,
    );

    const artifactRecords = (report.artifacts || []).map((artifact) =>
      publishRuntimeArtifact(run.run_id, createArtifactRecord({
        runId: run.run_id,
        nodeRunId: report.node_run_id,
        artifact,
        createdAt: timestamp,
      })),
    );
    if (artifactRecords.length > 0) {
      upsertArtifacts(artifactRecords);
      for (const artifactRecord of artifactRecords) {
        appendRunEvent({
          run_id: run.run_id,
          node_run_id: report.node_run_id,
          type: "artifact.created",
          actor_type: "agent",
            actor_id: actorId,
          payload: {
            artifact_id: artifactRecord.artifact_id,
            name: artifactRecord.name,
            type: artifactRecord.type,
              storage_uri: artifactRecord.storage_uri,
              job_id: context?.jobId || null,
              worker_event_id: context?.workerEventId || null,
          },
          created_at: timestamp,
        });
      }
    }

    const nodeCompletedEvent = appendRunEvent({
      run_id: run.run_id,
      node_run_id: report.node_run_id,
      type: "node.completed",
      actor_type: "agent",
      actor_id: actorId,
      payload: {
        node_id: node.node_id,
        node_name: node.name,
        artifacts: report.artifacts || [],
        job_id: context?.jobId || null,
        worker_event_id: context?.workerEventId || null,
      },
      created_at: timestamp,
    });
    const jobCompletedEvent = appendRunEvent({
      run_id: run.run_id,
      node_run_id: report.node_run_id,
      type: "job.completed",
      actor_type: "agent",
      actor_id: actorId,
      payload: {
        job_id: context?.jobId || null,
        worker_event_id: context?.workerEventId || null,
        artifact_ids: artifactRecords.map((artifact) => artifact.artifact_id),
      },
      created_at: timestamp,
      causation_id: nodeCompletedEvent.event_id,
    });
    let lastEventId = nodeCompletedEvent.event_id;

    const unlockedNodes = unlockReadyNodeRuns(plan, nodeRuns, timestamp, {
      isInboundEdgeSatisfied: (edge) => {
        if (!edge.from_port && !edge.condition) {
          return true;
        }
        return isRoutedEdgeSatisfied(run.run_id, plan, edge);
      },
    });
    for (const unlockedNode of unlockedNodes) {
      const readyEvent = appendRunEvent({
        run_id: run.run_id,
        node_run_id: unlockedNode.node_run_id,
        type: "node.ready",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          node_id: unlockedNode.node_id,
          node_name: unlockedNode.name,
          node_type: unlockedNode.type,
        },
        created_at: timestamp,
      });
      lastEventId = readyEvent.event_id;
    }

    const completion = areAllNodesCompletedOrRecovered(run.run_id, nodeRuns);
    if (completion.completed) {
      const workspaceFinalization = finalizeBoundRunWorkspace(
        run,
        report.node_run_id,
        report.raw_ref?.job_id || `run:${run.run_id}:finalize`,
      );
      if (!workspaceFinalization.ok) {
        const blockedEvent = appendRunEvent({
          run_id: run.run_id,
          node_run_id: report.node_run_id,
          type: "run.paused",
          actor_type: "system",
          actor_id: "workspace-finalizer",
          payload: { reason: workspaceFinalization.error },
          created_at: timestamp,
        });
        run.status = "blocked";
        run.blocked_reason = workspaceFinalization.error;
        run.current_summary = "Run Workspace finalization failed";
        run.updated_at = timestamp;
        run.last_event_id = blockedEvent.event_id;
        plan.status = "blocked";
        saveRun(run);
        saveRunPlan(plan);
        saveNodeRuns(run.run_id, nodeRuns);
        this.refreshSessionsLinkedToRun?.(run.run_id, run.status);
        return;
      }
      const completedEvent = appendRunEvent({
        run_id: run.run_id,
        type: "run.completed",
        actor_type: "system",
        actor_id: "control-plane",
        payload: {
          completed_nodes: nodeRuns.length,
          recovered_failed_node_run_ids: completion.recovered_failed_node_run_ids,
          workspace_change_set_id: workspaceFinalization.changeSetId,
        },
        created_at: timestamp,
      });
      run.status = "completed";
      run.current_summary = completion.recovered_failed_node_run_ids.length > 0
        ? `Run completed with ${completion.recovered_failed_node_run_ids.length} recovered failure(s)`
        : "Run completed";
      run.finished_at = timestamp;
      run.updated_at = timestamp;
      run.last_event_id = completedEvent.event_id;
      plan.status = "completed";
      saveRun(run);
      saveRunPlan(plan);
      saveNodeRuns(run.run_id, nodeRuns);
      this.updateRuntimeJobFromReport({
        report,
        status: "completed",
        timestamp,
        lastEventId: jobCompletedEvent.event_id,
      });
      this.refreshSessionsLinkedToRun?.(run.run_id, run.status);
      return;
    }

    run.status = "running";
    run.current_summary =
      unlockedNodes.length > 0
        ? `${unlockedNodes.length} downstream node(s) unlocked`
        : "Waiting for next node callback";
    run.updated_at = timestamp;
    run.last_event_id = lastEventId;
    plan.status = "running";
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(run.run_id, nodeRuns);
    this.updateRuntimeJobFromReport({
      report,
      status: "completed",
      timestamp,
      lastEventId: jobCompletedEvent.event_id,
    });
    this.refreshSessionsLinkedToRun?.(run.run_id, run.status);

    if (getReadyNodeRuns(plan).length > 0) {
      void this.queueReadyNodes(run.run_id);
    }
  }

  async queueReadyNodes(
    runId: string,
    _reason: RuntimeQueueReason = "manual",
  ): Promise<RuntimeQueueResult> {
    const skipped = (skippedReason: string | null): RuntimeQueueResult => ({
      run_id: runId,
      scanned_ready_nodes: 0,
      dispatched_nodes: 0,
      completed_end_nodes: 0,
      skipped_reason: skippedReason,
    });

    const run = getRun(runId);
    const plan = getRunPlan(runId);
    if (!run || !plan) {
      return skipped("missing_run_or_plan");
    }
    if (["paused", "completed", "failed", "cancelled"].includes(run.status)) {
      return skipped(`run_${run.status}`);
    }

    const readyNodes = getReadyNodeRuns(plan);
    if (readyNodes.length === 0) {
      return skipped("no_ready_nodes");
    }

    const maxParallelNodes = run.workspace_binding_id ? 1 : resolveMaxParallelNodes(plan);
    const activeDispatchNodes = countActiveDispatchNodes(plan);
    const availableSlots = Math.max(0, maxParallelNodes - activeDispatchNodes);
    if (availableSlots <= 0) {
      return {
        ...skipped("parallelism_saturated"),
        scanned_ready_nodes: readyNodes.length,
      };
    }
    const readyNodesToDispatch = readyNodes.slice(0, availableSlots);
    if (readyNodesToDispatch.length === 0) {
      return {
        ...skipped("no_dispatchable_ready_nodes"),
        scanned_ready_nodes: readyNodes.length,
      };
    }

    const nodeRuns = listNodeRuns(runId);
    const dispatchTime = this.getNow();

    if (run.status === "queued") {
      const runStartedEvent = appendRunEvent({
        run_id: runId,
        type: "run.started",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          ready_nodes: readyNodesToDispatch.length,
        },
        created_at: dispatchTime,
      });
      run.status = "running";
      run.started_at = run.started_at ?? dispatchTime;
      run.updated_at = dispatchTime;
      run.last_event_id = runStartedEvent.event_id;
    } else if (run.status !== "paused" && run.status !== "cancelled") {
      run.status = "running";
      run.updated_at = dispatchTime;
    }

    let lastEventId = run.last_event_id;
    let dispatchedNodes = 0;
    let completedEndNodes = 0;

    for (const node of readyNodesToDispatch) {
      const nodeRun = getMutableNodeRun(nodeRuns, node.node_run_id);
      if (!nodeRun || nodeRun.status !== "ready") {
        continue;
      }

      if (node.type === "end") {
        applyNodeStatus(
          plan,
          nodeRuns,
          node.node_run_id,
          "completed",
          dispatchTime,
          "Workflow completed",
          100,
        );
        completedEndNodes += 1;

        const completedEvent = appendRunEvent({
          run_id: runId,
          node_run_id: node.node_run_id,
          type: "node.completed",
          actor_type: "system",
          actor_id: "scheduler",
          payload: {
            node_id: node.node_id,
            node_name: node.name,
            artifacts: [],
          },
          created_at: dispatchTime,
        });
        lastEventId = completedEvent.event_id;
        run.current_summary = "Workflow completed";

        const completion = areAllNodesCompletedOrRecovered(runId, nodeRuns);
        if (completion.completed) {
          const workspaceFinalization = finalizeBoundRunWorkspace(
            run,
            node.node_run_id,
            `run:${run.run_id}:finalize`,
          );
          if (!workspaceFinalization.ok) {
            const blockedEvent = appendRunEvent({
              run_id: runId,
              node_run_id: node.node_run_id,
              type: "run.paused",
              actor_type: "system",
              actor_id: "workspace-finalizer",
              payload: { reason: workspaceFinalization.error },
              created_at: dispatchTime,
            });
            run.status = "blocked";
            run.blocked_reason = workspaceFinalization.error;
            run.current_summary = "Run Workspace finalization failed";
            run.updated_at = dispatchTime;
            run.last_event_id = blockedEvent.event_id;
            plan.status = "blocked";
            saveRun(run);
            saveRunPlan(plan);
            saveNodeRuns(runId, nodeRuns);
            this.refreshSessionsLinkedToRun?.(run.run_id, run.status);
            return {
              run_id: runId,
              scanned_ready_nodes: readyNodes.length,
              dispatched_nodes: dispatchedNodes,
              completed_end_nodes: completedEndNodes,
              skipped_reason: "workspace_finalization_failed",
            };
          }
          const runCompletedEvent = appendRunEvent({
            run_id: runId,
            type: "run.completed",
            actor_type: "system",
            actor_id: "control-plane",
            payload: {
              completed_nodes: nodeRuns.length,
              recovered_failed_node_run_ids: completion.recovered_failed_node_run_ids,
              workspace_change_set_id: workspaceFinalization.changeSetId,
            },
            created_at: dispatchTime,
          });
          run.status = "completed";
          run.current_summary = completion.recovered_failed_node_run_ids.length > 0
            ? `Run completed with ${completion.recovered_failed_node_run_ids.length} recovered failure(s)`
            : "Run completed";
          run.finished_at = dispatchTime;
          run.updated_at = dispatchTime;
          run.last_event_id = runCompletedEvent.event_id;
          plan.status = "completed";
          saveRun(run);
          saveRunPlan(plan);
          saveNodeRuns(runId, nodeRuns);
          return {
            run_id: runId,
            scanned_ready_nodes: readyNodes.length,
            dispatched_nodes: dispatchedNodes,
            completed_end_nodes: completedEndNodes,
            skipped_reason: null,
          };
        }
        continue;
      }

      applyNodeStatus(
        plan,
        nodeRuns,
        node.node_run_id,
        "running",
        dispatchTime,
        "Dispatching runtime job",
        5,
      );

      const upstreamNodeIds = new Set(
        plan.edges
          .filter((edge) => edge.to === node.node_id)
          .map((edge) => edge.from),
      );
      const upstreamCompiledNodes = plan.compiled_nodes.filter((compiled) =>
        upstreamNodeIds.has(compiled.node_id),
      );
      const artifactsByNodeRunId = new Map<string, ReturnType<typeof listArtifacts>>(
        upstreamCompiledNodes.map((compiled) => [
          compiled.node_run_id,
          listArtifacts(runId).filter((artifact) => artifact.node_run_id === compiled.node_run_id),
        ]),
      );
      const upstreamContext = upstreamCompiledNodes.map((compiled) => {
        const upstreamRun = getMutableNodeRun(nodeRuns, compiled.node_run_id);
        const upstreamArtifacts = artifactsByNodeRunId.get(compiled.node_run_id) || [];
        return {
          node_run_id: compiled.node_run_id,
          node_id: compiled.node_id,
          node_name: compiled.name,
          status: upstreamRun?.status || compiled.status,
          summary: upstreamRun?.progress.message || "",
          artifacts: upstreamArtifacts.map((artifact) => ({
            artifact_id: artifact.artifact_id,
            type: artifact.type,
            name: artifact.name,
            storage_uri: artifact.storage_uri,
            mime_type: artifact.mime_type,
            size_bytes: artifact.size_bytes,
          })),
        };
      });
      const extraInputPayload =
        (() => {
          const value: Record<string, unknown> = {};
          if (upstreamContext.length > 0) {
            value.upstream_context = {
              nodes: upstreamContext,
            };
          }

          const explicitProjectSlug =
            typeof run.inputs.project_slug === "string" && run.inputs.project_slug.trim()
              ? run.inputs.project_slug.trim()
              : typeof run.inputs.subject === "string" &&
                  /^[a-z0-9_-]+$/i.test(run.inputs.subject.trim())
                ? run.inputs.subject.trim()
                : null;
          const workspaceBinding = run.workspace_binding_id
            ? getWorkspaceBinding(run.workspace_binding_id)
            : null;
          if (
            run.workspace_binding_id &&
            (!workspaceBinding || workspaceBinding.status !== "active" || workspaceBinding.access !== "sandbox-write")
          ) {
            throw new Error("The Run Workspace Binding is missing, expired, or revoked.");
          }
          const explicitProjectLocalRepo = workspaceBinding?.root_path ||
            (typeof run.inputs.project_local_repo === "string" && run.inputs.project_local_repo.trim()
              ? run.inputs.project_local_repo.trim()
              : null);

          if (explicitProjectSlug) {
            value.project_slug = explicitProjectSlug;
          }
          if (explicitProjectLocalRepo) {
            value.project_local_repo = explicitProjectLocalRepo;
          }

          return Object.keys(value).length > 0 ? value : undefined;
        })();

      const failureReplay = findDispatchableExecutionReplayForNode(runId, node.node_run_id);
      const envelope = failureReplay
        ? {
            ...JSON.parse(JSON.stringify(failureReplay.frozen_job.envelope)),
            retry_policy: {
              ...failureReplay.frozen_job.envelope.retry_policy,
              attempt: nodeRun.attempt,
            },
          }
        : buildDispatchEnvelope(run, plan, node, { extraInputPayload });
      const dispatchSequence = nextRuntimeDispatchSequence(runId, node.node_run_id);
      const workspaceContext = failureReplay?.frozen_job.provision.workspace.context ||
        getWorkspaceContextSnapshotForRun(runId, dispatchTime);
      const job = buildRuntimeWorkerJob(envelope, {
        jobId: failureReplay ? `${runId}:${node.node_run_id}:replay-${failureReplay.replay_id.split(":").at(-1)}` : undefined,
        createdAt: dispatchTime,
        dispatchSequence,
        targetKind: failureReplay?.frozen_job.provision.target_kind,
        workspaceContext,
      });
      const jobCreatedEvent = appendRunEvent({
        run_id: runId,
        node_run_id: node.node_run_id,
        type: "job.created",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          job_id: job.job_id,
          attempt: job.attempt,
          dispatch_sequence: job.dispatch_sequence,
          target_kind: job.provision.target_kind,
          agent_runtime: job.harness.agent_runtime,
          execution_kind: failureReplay ? "failure_replay" : nodeRun.attempt > 1 ? "retry" : "standard",
          replay_id: failureReplay?.replay_id || null,
          source_job_id: failureReplay?.source_job_id || null,
          workspace_context: workspaceContext
            ? {
                schema_version: workspaceContext.schema_version,
                source_session_id: workspaceContext.source_session_id,
                file_count: workspaceContext.files.length,
                total_size_bytes: workspaceContext.total_size_bytes,
                manifest_sha256: workspaceContext.manifest_sha256,
              }
            : null,
        },
        created_at: dispatchTime,
        idempotency_key: `job.created:${job.job_id}`,
      });
      const jobDispatchingEvent = appendRunEvent({
        run_id: runId,
        node_run_id: node.node_run_id,
        type: "job.dispatching",
        actor_type: "system",
        actor_id: "runtime-dispatcher",
        payload: {
          job_id: job.job_id,
          dispatcher: this.runtimeDispatcher.kind,
          execution_kind: failureReplay ? "failure_replay" : nodeRun.attempt > 1 ? "retry" : "standard",
          replay_id: failureReplay?.replay_id || null,
        },
        created_at: dispatchTime,
        causation_id: jobCreatedEvent.event_id,
        idempotency_key: `job.dispatching:${job.job_id}`,
      });
      const startedEvent = appendRunEvent({
        run_id: runId,
        node_run_id: node.node_run_id,
        type: "node.started",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          node_type: node.type,
          adapter: this.runtimeDispatcher.kind,
          dispatcher: this.runtimeDispatcher.kind,
          job_id: job.job_id,
          target_kind: job.provision.target_kind,
          agent_runtime: job.harness.agent_runtime,
          runtime_agent_ref: job.harness.runtime_agent_ref,
        },
        created_at: dispatchTime,
        causation_id: jobDispatchingEvent.event_id,
      });
      lastEventId = startedEvent.event_id;
      run.current_summary = `Dispatching node: ${node.name}`;

      const createdRuntimeJobRecord = createRuntimeJobRecord({
          job,
          status: "dispatching",
          lastEventId: startedEvent.event_id,
        });
      createdRuntimeJobRecord.execution_kind = failureReplay
        ? "failure_replay"
        : nodeRun.attempt > 1
          ? "retry"
          : "standard";
      createdRuntimeJobRecord.replay_id = failureReplay?.replay_id || null;
      createdRuntimeJobRecord.source_job_id = failureReplay?.source_job_id || null;
      createdRuntimeJobRecord.identity_digest = failureReplay?.identity_digest || null;
      const runtimeJobRecord = saveRuntimeJobRecord(createdRuntimeJobRecord);
      if (failureReplay) {
        failureReplay.replay_job_id = job.job_id;
        failureReplay.replay_attempt = job.attempt;
        failureReplay.status = "dispatching";
        failureReplay.updated_at = dispatchTime;
        const replayEvent = appendRunEvent({
          run_id: runId,
          node_run_id: node.node_run_id,
          type: "recovery.replay_dispatched",
          actor_type: "system",
          actor_id: "runtime-replay",
          payload: {
            replay_id: failureReplay.replay_id,
            source_job_id: failureReplay.source_job_id,
            replay_job_id: job.job_id,
            identity_digest: failureReplay.identity_digest,
          },
          created_at: dispatchTime,
          causation_id: failureReplay.lineage_event_ids.at(-1) || null,
          idempotency_key: `recovery.replay_dispatched:${failureReplay.replay_id}`,
        });
        failureReplay.lineage_event_ids.push(replayEvent.event_id);
        saveExecutionReplay(failureReplay);
      }
      dispatchedNodes += 1;
      void this.runtimeDispatcher
        .dispatchJob(job)
        .then(async (dispatch) => {
          const latestJobRecord =
            getRuntimeJobRecord(runId, job.job_id) || runtimeJobRecord;
          applyRuntimeDispatchResultToJobRecord(latestJobRecord, dispatch);

          const rawRef = dispatch.compatibility.raw_ref;
          node.execution_ref = createExecutionRefFromRuntimeDispatch(dispatch);
          saveRunPlan(plan);
          await this.runtimeDispatcher.handleReport(
            this.buildAcceptedReportFromDispatch(dispatch),
          );
          for (const event of dispatch.worker_events || []) {
            if (event.kind === "worker.accepted" || !("report" in event)) {
              continue;
            }
            await this.applyExecutionReport(event.report);
          }

          const payload: Record<string, unknown> = {
            job_id: job.job_id,
            target_kind: job.provision.target_kind,
            agent_runtime: job.harness.agent_runtime,
            runtime_agent_ref: job.harness.runtime_agent_ref,
            dispatch_id: dispatch.dispatch_id,
            openclaw_task_id: rawRef.openclaw_task_id,
            openclaw_session_id: rawRef.openclaw_session_id,
            dispatch_status: dispatch.status,
          };

          appendRunEvent({
            run_id: runId,
            node_run_id: node.node_run_id,
            type: "node.progress",
            actor_type: "system",
            actor_id: "runtime-dispatcher",
            payload,
            created_at: this.getNow(),
          });
        })
        .catch((error) => {
          const failedAt = this.getNow();
          const latestRun = getRun(runId);
          const latestPlan = getRunPlan(runId);
          const latestNodeRuns = listNodeRuns(runId);
          if (!latestRun || !latestPlan) {
            return;
          }

          const latestNode = getCompiledNode(latestPlan, node.node_run_id);
          const latestNodeRun = getMutableNodeRun(latestNodeRuns, node.node_run_id);
          if (!latestNode || !latestNodeRun) {
            return;
          }
          this.markRuntimeJobDispatchFailed({
            record: getRuntimeJobRecord(runId, job.job_id) || runtimeJobRecord,
            error,
            failedAt,
          });

          applyNodeStatus(
            latestPlan,
            latestNodeRuns,
            node.node_run_id,
            "failed",
            failedAt,
            error instanceof Error ? error.message : "Runtime dispatch failed",
            100,
          );

          const failedEvent = appendRunEvent({
            run_id: runId,
            node_run_id: node.node_run_id,
            type: "node.failed",
            actor_type: "system",
            actor_id: "runtime-dispatcher",
            payload: {
              node_id: latestNode.node_id,
              node_name: latestNode.name,
              job_id: job.job_id,
              target_kind: job.provision.target_kind,
              agent_runtime: job.harness.agent_runtime,
              runtime_agent_ref: job.harness.runtime_agent_ref,
              error: error instanceof Error ? error.message : "Runtime dispatch failed",
            },
            created_at: failedAt,
          });
          const jobFailedEvent = appendRunEvent({
            run_id: runId,
            node_run_id: node.node_run_id,
            type: "job.failed",
            actor_type: "system",
            actor_id: "runtime-dispatcher",
            payload: {
              job_id: job.job_id,
              error: error instanceof Error ? error.message : "Runtime dispatch failed",
              phase: "dispatch",
            },
            created_at: failedAt,
            causation_id: failedEvent.event_id,
            idempotency_key: `job.failed:${job.job_id}:dispatch`,
          });
          this.markRuntimeJobDispatchFailed({
            record: getRuntimeJobRecord(runId, job.job_id) || runtimeJobRecord,
            error,
            failedAt,
            lastEventId: jobFailedEvent.event_id,
          });

          if (this.canRetryNode(latestNode, latestNodeRun)) {
            this.prepareNodeRetry({
              run: latestRun,
              plan: latestPlan,
              nodeRuns: latestNodeRuns,
              node: latestNode,
              nodeRun: latestNodeRun,
              timestamp: failedAt,
              reason: error instanceof Error ? error.message : "Runtime dispatch failed",
              failedEventId: failedEvent.event_id,
            });
            return;
          }

          latestRun.status = "failed";
          latestRun.current_summary =
            error instanceof Error ? error.message : "Runtime dispatch failed";
          latestRun.blocked_reason = latestRun.current_summary;
          latestRun.finished_at = failedAt;
          latestRun.updated_at = failedAt;
          latestRun.last_event_id = failedEvent.event_id;
          latestPlan.status = "failed";
          saveRun(latestRun);
          saveRunPlan(latestPlan);
          saveNodeRuns(runId, latestNodeRuns);
        });
    }

    run.last_event_id = lastEventId ?? run.last_event_id;
    saveRun(run);
    saveRunPlan(plan);
    saveNodeRuns(runId, nodeRuns);

    return {
      run_id: runId,
      scanned_ready_nodes: readyNodes.length,
      dispatched_nodes: dispatchedNodes,
      completed_end_nodes: completedEndNodes,
      skipped_reason: null,
    };
  }
}
