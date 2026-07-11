import type {
  RunPlanRecord,
  RunRecord,
  RunRouteSnapshot,
  RunRouteSource,
  WorkflowTemplateRecord,
} from "./types.js";
import { buildRunWorkPackages } from "./work-package.js";

function routeIdForSource(
  run: RunRecord,
  source: RunRouteSource,
): string {
  if (source.route_id?.trim()) {
    return source.route_id.trim();
  }
  if (source.kind === "proposal" && source.proposal_id) {
    return `proposal:${source.proposal_id}`;
  }
  if (
    source.kind === "session_plan" &&
    source.session_id &&
    source.plan_revision &&
    source.plan_option
  ) {
    return `session:${source.session_id}:r${source.plan_revision}:${source.plan_option}`;
  }
  return `template:${run.template_id}@${run.template_version}`;
}

export function buildRunRouteSnapshot(input: {
  run: RunRecord;
  plan: RunPlanRecord;
  template: WorkflowTemplateRecord;
  source: RunRouteSource;
}): RunRouteSnapshot {
  return {
    schema_version: 1,
    run_id: input.run.run_id,
    route_id: routeIdForSource(input.run, input.source),
    source_kind: input.source.kind,
    session_id: input.source.session_id || null,
    proposal_id: input.source.proposal_id || input.run.proposal_id || null,
    plan_revision: input.source.plan_revision || null,
    plan_option: input.source.plan_option || null,
    source_run_id: input.source.source_run_id || input.run.source_run_id || null,
    template_id: input.run.template_id,
    template_version: input.run.template_version,
    template_name: input.template.name,
    node_count: input.plan.compiled_nodes.length,
    edge_count: input.plan.edges.length,
    work_packages: buildRunWorkPackages(input.plan),
    created_at: input.run.created_at,
  };
}

export function buildLegacyRunRouteSnapshot(input: {
  run: RunRecord;
  plan: RunPlanRecord;
  templateName?: string | null;
}): RunRouteSnapshot {
  return {
    schema_version: 1,
    run_id: input.run.run_id,
    route_id: `legacy:${input.run.run_id}`,
    source_kind: "legacy",
    session_id: null,
    proposal_id: input.run.proposal_id,
    plan_revision: null,
    plan_option: null,
    source_run_id: input.run.source_run_id,
    template_id: input.run.template_id,
    template_version: input.run.template_version,
    template_name: input.templateName || input.run.template_id,
    node_count: input.plan.compiled_nodes.length,
    edge_count: input.plan.edges.length,
    work_packages: buildRunWorkPackages(input.plan).map((item) => ({
      ...item,
      identity_source:
        item.identity_source === "declared" ? "declared" : "legacy_inferred",
    })),
    created_at: input.run.created_at,
  };
}
