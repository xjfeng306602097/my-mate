import { createEmptyExecutionRef } from "../execution-ref.js";
import { materializeInitialNodeRuns } from "../node-scheduler.js";
import { getRunPlan } from "../run-plan-store.js";
import { getRunRouteOrLegacy } from "../run-route-store.js";
import { buildRunRecord, getRun, listRuns } from "../run-store.js";
import { persistRunBundle } from "../run-bundle-writer.js";
import type {
  CompiledNodeRecord,
  RunPlanRecord,
  RunRecord,
  RunRouteSnapshot,
} from "../types.js";
import { generateNodeRunId } from "../utils.js";
import { buildRunWorkPackages } from "../work-package.js";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function cloneFrozenPlan(input: {
  source: RunPlanRecord;
  run: RunRecord;
}): RunPlanRecord {
  const incoming = new Map(input.source.compiled_nodes.map((node) => [node.node_id, 0]));
  for (const edge of input.source.edges) incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
  const clonedNodes: CompiledNodeRecord[] = input.source.compiled_nodes.map((sourceNode) => ({
    ...structuredClone(sourceNode),
    node_run_id: generateNodeRunId(sourceNode.node_id),
    status: (incoming.get(sourceNode.node_id) || 0) === 0 ? "ready" : "pending",
    retry_policy: {
      ...sourceNode.retry_policy,
      attempt: 0,
    },
    input_payload: {
      ...structuredClone(sourceNode.input_payload),
      run_inputs: structuredClone(input.run.inputs),
    },
    execution_ref: createEmptyExecutionRef(),
  }));
  return {
    ...structuredClone(input.source),
    run_id: input.run.run_id,
    workspace_id: input.run.workspace_id,
    requested_by: input.run.requested_by,
    intent: input.run.intent,
    inputs: structuredClone(input.run.inputs),
    compiled_nodes: clonedNodes,
    frontier: clonedNodes.filter((node) => node.status === "ready").map((node) => node.node_run_id),
    planner_context: {
      ...structuredClone(input.source.planner_context),
      rerun_source_run_id: input.run.source_run_id,
      rerun_mode: "frozen_effective_plan",
    },
    status: "queued",
    created_at: input.run.created_at,
  };
}

function buildRerunRoute(input: {
  source: RunRouteSnapshot;
  run: RunRecord;
  plan: RunPlanRecord;
}): RunRouteSnapshot {
  return {
    ...structuredClone(input.source),
    run_id: input.run.run_id,
    route_id: input.source.route_id,
    source_kind: "rerun",
    source_run_id: input.run.source_run_id || null,
    proposal_id: input.source.proposal_id,
    node_count: input.plan.compiled_nodes.length,
    edge_count: input.plan.edges.length,
    work_packages: buildRunWorkPackages(input.plan),
    created_at: input.run.created_at,
  };
}

export function createOrGetRerun(input: {
  sourceRunId: string;
  reason: string;
  inputOverrides?: Record<string, unknown>;
  idempotencyKey?: string | null;
}): {
  run: RunRecord;
  route: RunRouteSnapshot;
  readyNodeRunIds: string[];
  created: boolean;
} {
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const sourceRun = getRun(input.sourceRunId);
  const sourcePlan = getRunPlan(input.sourceRunId);
  const sourceRoute = getRunRouteOrLegacy(input.sourceRunId);
  if (!sourceRun || !sourcePlan || !sourceRoute) throw new Error("SOURCE_RUN_NOT_FOUND");
  if (!TERMINAL_STATUSES.has(sourceRun.status)) throw new Error("SOURCE_RUN_NOT_TERMINAL");
  const mergedInputs = {
    ...structuredClone(sourceRun.inputs),
    ...(input.inputOverrides ? structuredClone(input.inputOverrides) : {}),
  };
  if (idempotencyKey) {
    const existing = listRuns().find((run) => run.rerun_idempotency_key === idempotencyKey);
    if (existing) {
      if (
        existing.source_run_id !== input.sourceRunId ||
        existing.rerun_reason !== input.reason.trim() ||
        stableJson(existing.inputs) !== stableJson(mergedInputs)
      ) {
        throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      }
      const route = getRunRouteOrLegacy(existing.run_id);
      if (!route) throw new Error("RERUN_ROUTE_NOT_FOUND");
      return { run: existing, route, readyNodeRunIds: [], created: false };
    }
  }
  const run = buildRunRecord(
    {
      intent: sourceRun.intent,
      template_id: sourceRun.template_id,
      inputs: mergedInputs,
      validation_mode: "bypass",
      proposal_id: sourceRun.proposal_id || undefined,
    },
    {
      requestedBy: sourceRun.requested_by,
      workspaceId: sourceRun.workspace_id,
      templateVersion: sourceRun.template_version,
    },
  );
  run.source_run_id = sourceRun.run_id;
  run.rerun_reason = input.reason.trim();
  run.rerun_idempotency_key = idempotencyKey;
  const plan = cloneFrozenPlan({ source: sourcePlan, run });
  const route = buildRerunRoute({ source: sourceRoute, run, plan });
  const nodeRuns = materializeInitialNodeRuns(plan, run.created_at);
  const persisted = persistRunBundle({
    run,
    plan,
    route,
    nodeRuns,
    validationMode: "bypass",
    validationPassed: true,
    validationWarningCount: 0,
  });
  return {
    run: persisted.run,
    route: persisted.route,
    readyNodeRunIds: persisted.readyNodeRunIds,
    created: true,
  };
}
