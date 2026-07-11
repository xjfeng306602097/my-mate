import { buildDispatchEnvelope } from "../adapter-contracts.js";
import {
  createApprovalRecord,
  findPendingApprovalForNode,
  saveApproval,
} from "../approval-store.js";
import {
  createArtifactRecord,
  listArtifacts,
  upsertArtifacts,
} from "../artifact-store.js";
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
  areAllNodesCompleted,
  getCompiledNode,
  getMutableNodeRun,
  getReadyNodeRuns,
  unlockReadyNodeRuns,
} from "../node-scheduler.js";
import { listNodeRuns, saveNodeRuns } from "../node-run-store.js";
import { getRunPlan, saveRunPlan } from "../run-plan-store.js";
import { getRun, saveRun } from "../run-store.js";
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
  findLatestNodeHandoff,
  saveNodeHandoffRecord,
} from "./node-handoff-store.js";

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
  ): Promise<void> {
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

    const normalizePort = (value: string | null | undefined): string =>
      (value || "success").trim().toLowerCase();
    const portsMatch = (edgePortValue: string | null | undefined, handoffPortValue: string): boolean => {
      const edgePort = normalizePort(edgePortValue);
      const handoffPort = normalizePort(handoffPortValue);
      if (edgePort === handoffPort) {
        return true;
      }
      const successPorts = new Set(["success", "completed", "complete", "done", "default"]);
      const failurePorts = new Set(["failure", "failed", "error", "rejected"]);
      return (
        (successPorts.has(edgePort) && successPorts.has(handoffPort)) ||
        (failurePorts.has(edgePort) && failurePorts.has(handoffPort))
      );
    };

    const outgoing = plan.edges.filter((edge) => edge.from === source.node_id);
    const hasExplicitPorts = outgoing.some(
      (edge) => typeof edge.from_port === "string" && !!edge.from_port.trim(),
    );
    const matchingEdges = outgoing.filter((edge) =>
      hasExplicitPorts ? portsMatch(edge.from_port, event.handoff.port) : true,
    );
    const routedNodeRunIds: string[] = [];
    const skippedNodeRunIds: string[] = [];
    const timestamp = event.handoff.created_at || event.created_at || this.getNow();

    for (const edge of matchingEdges) {
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
          return dependencyRun ? ["completed", "skipped"].includes(dependencyRun.status) : false;
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

    if (hasExplicitPorts) {
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
        routed_node_run_ids: routedNodeRunIds,
        skipped_node_run_ids: skippedNodeRunIds,
      },
      created_at: timestamp,
      causation_id: event.event_id,
      idempotency_key: `handoff:${event.event_id}`,
    });
    const handoffEvent = appendRunEvent({
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
  }

  async applyExecutionReport(
    report: RuntimeExecutionReport,
    context?: {
      actorId?: string;
      workerEventId?: string;
      jobId?: string;
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
      this.refreshSessionsLinkedToRun?.(run.run_id, run.status);
      return;
    }

    if (report.status !== "completed") {
      throw new Error("INVALID_REPORT_STATUS");
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
      createArtifactRecord({
        runId: run.run_id,
        nodeRunId: report.node_run_id,
        artifact,
        createdAt: timestamp,
      }),
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
        const edgePort =
          typeof edge.from_port === "string" && edge.from_port.trim()
            ? edge.from_port.trim()
            : null;
        if (!edgePort) {
          return true;
        }
        const source = plan.compiled_nodes.find((candidate) => candidate.node_id === edge.from);
        const target = plan.compiled_nodes.find((candidate) => candidate.node_id === edge.to);
        if (!source || !target) {
          return false;
        }
        const handoff = findLatestNodeHandoff(run.run_id, source.node_run_id);
        return handoff?.routed_node_run_ids.includes(target.node_run_id) === true;
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

    if (areAllNodesCompleted(nodeRuns)) {
      const completedEvent = appendRunEvent({
        run_id: run.run_id,
        type: "run.completed",
        actor_type: "system",
        actor_id: "control-plane",
        payload: {
          completed_nodes: nodeRuns.length,
        },
        created_at: timestamp,
      });
      run.status = "completed";
      run.current_summary = "Run completed";
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

    const maxParallelNodes = resolveMaxParallelNodes(plan);
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

        if (areAllNodesCompleted(nodeRuns)) {
          const runCompletedEvent = appendRunEvent({
            run_id: runId,
            type: "run.completed",
            actor_type: "system",
            actor_id: "control-plane",
            payload: {
              completed_nodes: nodeRuns.length,
            },
            created_at: dispatchTime,
          });
          run.status = "completed";
          run.current_summary = "Run completed";
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
          const explicitProjectLocalRepo =
            typeof run.inputs.project_local_repo === "string" && run.inputs.project_local_repo.trim()
              ? run.inputs.project_local_repo.trim()
              : null;

          if (explicitProjectSlug) {
            value.project_slug = explicitProjectSlug;
          }
          if (explicitProjectLocalRepo) {
            value.project_local_repo = explicitProjectLocalRepo;
          }

          return Object.keys(value).length > 0 ? value : undefined;
        })();

      const envelope = buildDispatchEnvelope(run, plan, node, {
        extraInputPayload,
      });
      const dispatchSequence = nextRuntimeDispatchSequence(runId, node.node_run_id);
      const job = buildRuntimeWorkerJob(envelope, {
        createdAt: dispatchTime,
        dispatchSequence,
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

      const runtimeJobRecord = saveRuntimeJobRecord(
        createRuntimeJobRecord({
          job,
          status: "dispatching",
          lastEventId: startedEvent.event_id,
        }),
      );
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
