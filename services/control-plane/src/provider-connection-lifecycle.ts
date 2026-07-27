import {
  getAgentDefinition,
  getPublishedAgentVersion,
  listAgentDefinitions,
  listAgentRuns,
  upsertAgentDefinition,
} from "./agent-runtime-store.js";
import { listAgentDags, listAgentTasks } from "./agent-orchestration-store.js";
import {
  deleteProviderConnectionRecord,
  getProviderConnection,
  providerConnectionStatus,
} from "./provider-connection-store.js";
import { deleteManagedProviderCredential } from "./provider-secret-store.js";
import { getActiveWorkspaceId } from "./request-security.js";
import { listRunPlans } from "./run-plan-store.js";
import { listRuns } from "./run-store.js";
import { listSessions, rebindSessionProviderConnection } from "./session-store.js";
import { runJsonStorageTransaction } from "./storage-backend.js";
import {
  listTemplates,
  migrateWorkflowProviderConnectionBindings,
} from "./template-store.js";
import {
  listUserSchedules,
  rebindUserScheduleProviderConnection,
} from "./user-schedule-store.js";
import type {
  DeleteProviderConnectionResult,
  ProviderConnectionMigrationResult,
  ProviderConnectionReference,
  ProviderConnectionReferenceReport,
} from "./types.js";

const ACTIVE_AGENT_RUN_STATUSES = new Set(["queued", "running", "waiting_human"]);
const ACTIVE_DAG_STATUSES = new Set(["draft", "ready", "running", "waiting_human"]);
const ACTIVE_WORKFLOW_RUN_STATUSES = new Set(["draft", "queued", "running", "waiting_human", "paused", "blocked"]);

export class ProviderConnectionLifecycleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly report?: ProviderConnectionReferenceReport,
  ) {
    super(message);
    this.name = "ProviderConnectionLifecycleError";
  }
}

function workspaceIdForConnection(connectionId: string): string {
  const connection = getProviderConnection(connectionId);
  if (!connection) {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_not_found",
      "Provider Connection not found.",
      404,
    );
  }
  const activeWorkspaceId = getActiveWorkspaceId();
  if (activeWorkspaceId && connection.workspace_id !== activeWorkspaceId) {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_not_found",
      "Provider Connection not found.",
      404,
    );
  }
  return connection.workspace_id || activeWorkspaceId || "default";
}

function reference(input: ProviderConnectionReference): ProviderConnectionReference {
  return input;
}

export function inspectProviderConnectionReferences(connectionId: string): ProviderConnectionReferenceReport {
  const workspaceId = workspaceIdForConnection(connectionId);
  const connection = getProviderConnection(connectionId)!;
  const references: ProviderConnectionReference[] = [];
  let historicalCount = 0;

  for (const definition of listAgentDefinitions(workspaceId)) {
    const version = getPublishedAgentVersion(definition.agent_id, workspaceId);
    if (version?.model_policy.provider_connection_id !== connectionId) continue;
    if (definition.status !== "active") {
      historicalCount += 1;
      continue;
    }
    references.push(reference({
      kind: "agent",
      reference_id: definition.agent_id,
      label: definition.name,
      status: definition.status,
      blocking: false,
      migratable: true,
      detail: `Published Agent v${version.version} is bound to this Connection.`,
    }));
  }

  for (const session of listSessions()) {
    const metadata = session.metadata || {};
    const snapshot = metadata.agent_binding_snapshot as { provider_connection_id?: unknown } | undefined;
    const matches = metadata.conversation_provider_connection_id === connectionId || snapshot?.provider_connection_id === connectionId;
    if (!matches) continue;
    if (session.archived || session.hidden) {
      historicalCount += 1;
      continue;
    }
    references.push(reference({
      kind: "session",
      reference_id: session.session_id,
      label: session.title,
      status: session.status,
      blocking: false,
      migratable: true,
      detail: "Future conversation turns use this Connection.",
    }));
  }

  for (const schedule of listUserSchedules(workspaceId)) {
    const matches = schedule.provider_connection_id === connectionId || schedule.agent_binding_snapshot?.provider_connection_id === connectionId;
    if (!matches) continue;
    references.push(reference({
      kind: "schedule",
      reference_id: schedule.schedule_id,
      label: schedule.name,
      status: schedule.enabled ? "enabled" : "disabled",
      blocking: false,
      migratable: true,
      detail: schedule.enabled
        ? "The next scheduled run would use this Connection."
        : "The disabled schedule retains this Connection for a future re-enable.",
    }));
  }

  for (const template of listTemplates()) {
    if (template.workspace_scope !== workspaceId) continue;
    const count = template.nodes.filter((node) => node.agent_binding_snapshot?.provider_connection_id === connectionId).length;
    if (!count) continue;
    if (template.status === "archived") {
      historicalCount += 1;
      continue;
    }
    references.push(reference({
      kind: "workflow_template",
      reference_id: template.template_id,
      label: template.name,
      status: template.status,
      blocking: false,
      migratable: true,
      detail: `${count} workflow step${count === 1 ? "" : "s"} retain a pinned Agent binding.`,
    }));
  }

  for (const run of listAgentRuns(workspaceId)) {
    if (run.binding_snapshot.provider_connection_id !== connectionId) continue;
    if (!ACTIVE_AGENT_RUN_STATUSES.has(run.status)) {
      historicalCount += 1;
      continue;
    }
    references.push(reference({
      kind: "agent_run",
      reference_id: run.agent_run_id,
      label: `${run.binding_snapshot.agent_name} run`,
      status: run.status,
      blocking: true,
      migratable: false,
      detail: "An Agent run cannot change Provider while it is executing.",
    }));
  }

  for (const dag of listAgentDags(workspaceId)) {
    const usesConnection = listAgentTasks(workspaceId, dag.dag_id)
      .some((task) => task.binding_snapshot.provider_connection_id === connectionId);
    if (!usesConnection) continue;
    if (!ACTIVE_DAG_STATUSES.has(dag.status)) {
      historicalCount += 1;
      continue;
    }
    references.push(reference({
      kind: "agent_dag",
      reference_id: dag.dag_id,
      label: dag.title,
      status: dag.status,
      blocking: true,
      migratable: false,
      detail: "Cancel or finish this DAG before migrating the Connection.",
    }));
  }

  const runsById = new Map(listRuns().filter((run) => run.workspace_id === workspaceId).map((run) => [run.run_id, run]));
  for (const plan of listRunPlans(workspaceId)) {
    const usesConnection = plan.compiled_nodes.some((node) =>
      node.provider_connection?.connection_id === connectionId ||
      node.agent_binding_snapshot?.provider_connection_id === connectionId,
    );
    if (!usesConnection) continue;
    const run = runsById.get(plan.run_id);
    if (!run || !ACTIVE_WORKFLOW_RUN_STATUSES.has(run.status)) {
      historicalCount += 1;
      continue;
    }
    references.push(reference({
      kind: "workflow_run",
      reference_id: run.run_id,
      label: run.intent || run.run_id,
      status: run.status,
      blocking: true,
      migratable: false,
      detail: "Cancel or finish this Workflow run before migrating the Connection.",
    }));
  }

  references.sort((left, right) => Number(right.blocking) - Number(left.blocking) || left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label));
  const blockingCount = references.filter((item) => item.blocking).length;
  const migratableCount = references.filter((item) => item.migratable).length;
  return {
    connection_id: connection.connection_id,
    workspace_id: workspaceId,
    connection_status: connection.status,
    references,
    blocking_count: blockingCount,
    migratable_count: migratableCount,
    historical_count: historicalCount,
    can_delete: connection.status === "disabled" && blockingCount === 0 && migratableCount === 0,
  };
}

export function migrateProviderConnectionReferences(input: {
  sourceConnectionId: string;
  targetConnectionId: string;
  targetModel?: string | null;
  actorId?: string;
}): ProviderConnectionMigrationResult {
  if (input.sourceConnectionId === input.targetConnectionId) {
    throw new ProviderConnectionLifecycleError("provider_connection_same_target", "Choose a different target Connection.", 400);
  }
  const workspaceId = workspaceIdForConnection(input.sourceConnectionId);
  const source = getProviderConnection(input.sourceConnectionId)!;
  if (source.status !== "disabled") {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_must_be_disabled",
      "Disable the Provider Connection before migrating its references.",
      409,
    );
  }
  const target = getProviderConnection(input.targetConnectionId);
  if (!target || target.workspace_id !== workspaceId || target.status !== "active") {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_target_unavailable",
      "The replacement Provider Connection must be active in the same Workspace.",
      409,
    );
  }
  if (target.verification?.status !== "verified" || !providerConnectionStatus(target).credential_configured) {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_target_unverified",
      "Verify the replacement Provider Connection and configure its credential before migration.",
      409,
    );
  }
  const targetModel = input.targetModel?.trim() || target.default_model || target.models[0] || "";
  if (!targetModel || !target.models.includes(targetModel)) {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_target_model_unavailable",
      "Choose a model exposed by the replacement Provider Connection.",
      400,
    );
  }
  const before = inspectProviderConnectionReferences(source.connection_id);
  if (before.blocking_count > 0) {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_has_running_references",
      "Cancel or finish running Agent, DAG, and Workflow executions before migration.",
      409,
      before,
    );
  }

  let migratedAgents = 0;
  let migratedSessions = 0;
  let migratedSchedules = 0;
  let migratedWorkflowTemplates = 0;
  const migratedAgentVersions = new Map<string, number>();

  runJsonStorageTransaction(() => {
    for (const ref of before.references.filter((item) => item.kind === "agent" && item.migratable)) {
      const definition = getAgentDefinition(ref.reference_id, workspaceId);
      const version = getPublishedAgentVersion(ref.reference_id, workspaceId);
      if (!definition || !version) continue;
      const migrated = upsertAgentDefinition({
        workspaceId,
        agentId: definition.agent_id,
        name: definition.name,
        description: definition.description,
        metadata: definition.metadata,
        createdBy: input.actorId || "user",
        version: {
          ...version,
          model_policy: {
            ...version.model_policy,
            deployment_id: null,
            provider_connection_id: target.connection_id,
            model: targetModel,
            fallback_models: (version.model_policy.fallback_models || []).filter((model) => target.models.includes(model)),
          },
          metadata: {
            ...version.metadata,
            provider_connection_migration: {
              source_connection_id: source.connection_id,
              target_connection_id: target.connection_id,
              migrated_at: new Date().toISOString(),
            },
          },
        },
      });
      migratedAgentVersions.set(definition.agent_id, migrated.version.version);
      migratedAgents += 1;
    }

    for (const ref of before.references.filter((item) => item.kind === "session" && item.migratable)) {
      const session = listSessions().find((item) => item.session_id === ref.reference_id);
      if (!session) continue;
      const agentId = typeof session.metadata.agent_id === "string" ? session.metadata.agent_id : "";
      rebindSessionProviderConnection(
        session.session_id,
        target.connection_id,
        targetModel,
        migratedAgentVersions.get(agentId) || null,
      );
      migratedSessions += 1;
    }

    for (const ref of before.references.filter((item) => item.kind === "schedule" && item.migratable)) {
      const schedule = listUserSchedules(workspaceId).find((item) => item.schedule_id === ref.reference_id);
      if (!schedule) continue;
      const agentId = schedule.agent_binding_snapshot?.agent_id || "";
      rebindUserScheduleProviderConnection(
        schedule,
        target.connection_id,
        targetModel,
        migratedAgentVersions.get(agentId) || null,
      );
      migratedSchedules += 1;
    }

    const templateMigration = migrateWorkflowProviderConnectionBindings({
      workspaceId,
      sourceConnectionId: source.connection_id,
      targetConnectionId: target.connection_id,
      targetModel,
      migratedAgentVersions,
    });
    migratedWorkflowTemplates = templateMigration.migrated_templates;
  });

  const remaining = inspectProviderConnectionReferences(source.connection_id);
  return {
    source_connection_id: source.connection_id,
    target_connection_id: target.connection_id,
    target_model: targetModel,
    migrated_agents: migratedAgents,
    migrated_sessions: migratedSessions,
    migrated_schedules: migratedSchedules,
    migrated_workflow_templates: migratedWorkflowTemplates,
    remaining,
  };
}

export function deleteProviderConnection(connectionId: string): DeleteProviderConnectionResult {
  const source = getProviderConnection(connectionId);
  if (!source) {
    throw new ProviderConnectionLifecycleError("provider_connection_not_found", "Provider Connection not found.", 404);
  }
  if (source.status !== "disabled") {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_must_be_disabled",
      "Disable the Provider Connection before deleting it.",
      409,
    );
  }
  const report = inspectProviderConnectionReferences(connectionId);
  if (!report.can_delete) {
    throw new ProviderConnectionLifecycleError(
      "provider_connection_has_references",
      report.blocking_count
        ? "Cancel or finish running work before deleting this Connection."
        : "Migrate active references before deleting this Connection.",
      409,
      report,
    );
  }
  let credentialDeleted = false;
  runJsonStorageTransaction(() => {
    credentialDeleted = deleteManagedProviderCredential(connectionId);
    deleteProviderConnectionRecord(connectionId);
  });
  return { connection_id: connectionId, deleted: true, credential_deleted: credentialDeleted };
}
