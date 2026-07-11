import { appendRunEvent } from "./event-store.js";
import { saveNodeRuns } from "./node-run-store.js";
import { getReadyNodeRuns } from "./node-scheduler.js";
import { saveRunInitialization } from "./run-initialization-store.js";
import { saveInitialRunPlan } from "./run-initial-plan-store.js";
import { saveRunPlan } from "./run-plan-store.js";
import { saveRunRoute } from "./run-route-store.js";
import { saveRun } from "./run-store.js";
import type {
  NodeRunRecord,
  RunInitializationRecord,
  RunPlanRecord,
  RunRecord,
  RunRouteSnapshot,
  RunValidationMode,
} from "./types.js";
import { nowIso } from "./utils.js";

const REQUIRED_RECORDS = [
  "run",
  "plan",
  "initial_plan",
  "route",
  "node_runs",
  "creation_events",
] as const;

export function persistRunBundle(input: {
  run: RunRecord;
  plan: RunPlanRecord;
  route: RunRouteSnapshot;
  nodeRuns: NodeRunRecord[];
  validationMode: RunValidationMode;
  validationPassed: boolean;
  validationWarningCount: number;
}): {
  run: RunRecord;
  plan: RunPlanRecord;
  route: RunRouteSnapshot;
  readyNodeRunIds: string[];
} {
  const timestamp = input.run.created_at;
  const initialization: RunInitializationRecord = {
    schema_version: 1,
    run_id: input.run.run_id,
    state: "preparing",
    required_records: [...REQUIRED_RECORDS],
    completed_records: [],
    error: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const complete = (record: string) => {
    if (!initialization.completed_records.includes(record)) {
      initialization.completed_records.push(record);
    }
    initialization.updated_at = nowIso();
    saveRunInitialization(initialization);
  };

  saveRunInitialization(initialization);
  try {
    saveRun(input.run);
    complete("run");
    saveRunPlan(input.plan);
    complete("plan");
    saveInitialRunPlan(input.plan);
    complete("initial_plan");
    saveRunRoute(input.route);
    complete("route");
    saveNodeRuns(input.run.run_id, input.nodeRuns);
    complete("node_runs");

    appendRunEvent({
      run_id: input.run.run_id,
      type: "run.created",
      actor_type: "user",
      actor_id: input.run.requested_by,
      payload: {
        template_id: input.run.template_id,
        template_version: input.run.template_version,
        route_id: input.route.route_id,
        route_source_kind: input.route.source_kind,
        validation_mode: input.validationMode,
        validation_passed: input.validationPassed,
        validation_warning_count: input.validationWarningCount,
        proposal_id: input.route.proposal_id,
      },
      created_at: timestamp,
    });
    const queuedEvent = appendRunEvent({
      run_id: input.run.run_id,
      type: "run.queued",
      actor_type: "system",
      actor_id: "control-plane",
      payload: {
        current_summary: input.run.current_summary,
        route_id: input.route.route_id,
      },
      created_at: timestamp,
    });

    let lastEventId = queuedEvent.event_id;
    const readyNodes = getReadyNodeRuns(input.plan);
    for (const node of readyNodes) {
      const readyEvent = appendRunEvent({
        run_id: input.run.run_id,
        node_run_id: node.node_run_id,
        type: "node.ready",
        actor_type: "system",
        actor_id: "scheduler",
        payload: {
          node_id: node.node_id,
          node_name: node.name,
          node_type: node.type,
          work_package_key: node.work_package?.key || null,
        },
        created_at: timestamp,
      });
      lastEventId = readyEvent.event_id;
    }
    complete("creation_events");

    if (readyNodes.length > 0) {
      input.run.current_summary = `${readyNodes.length} node(s) ready for dispatch`;
      input.run.updated_at = timestamp;
    }
    input.run.last_event_id = lastEventId;
    saveRun(input.run);

    initialization.state = "ready";
    initialization.updated_at = nowIso();
    saveRunInitialization(initialization);
    return {
      run: input.run,
      plan: input.plan,
      route: input.route,
      readyNodeRunIds: readyNodes.map((node) => node.node_run_id),
    };
  } catch (error) {
    initialization.state = "failed";
    initialization.error = error instanceof Error ? error.message : "Run bundle persistence failed.";
    initialization.updated_at = nowIso();
    saveRunInitialization(initialization);
    throw error;
  }
}
