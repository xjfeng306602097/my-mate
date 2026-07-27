import path from "node:path";
import { normalizeExecutionRef } from "./execution-ref.js";
import { RUN_PLANS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { CompiledNodeRecord, RegistryProvenance, RunPlanRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";
import { validateRunPlan } from "./validators.js";
import { normalizeCompiledWorkPackage } from "./work-package.js";
import { normalizeAgentBindingSnapshot } from "./agent-runtime-store.js";
import {
  NODE_LIFECYCLE,
  RUN_LIFECYCLE,
  assertLifecycleTransition,
  parseLifecycleStatus,
} from "@my-mate/shared-types/domain-lifecycle";

function runPlanPath(runId: string): string {
  return path.join(RUN_PLANS_DIR, `${runId}.json`);
}

function assertValidRunPlan(plan: RunPlanRecord): void {
  const ok = validateRunPlan(plan);
  if (!ok) {
    const errorText =
      validateRunPlan.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ") ||
      "unknown schema error";
    throw new Error(`RunPlan validation failed: ${errorText}`);
  }
}

function normalizeRegistryProvenance(node: CompiledNodeRecord): RegistryProvenance {
  const legacyNode = node as CompiledNodeRecord & {
    registry_provenance?: Partial<RegistryProvenance> & {
      agent_profile_requested?: string | null;
      agent_profile_resolved?: string | null;
      agent_profile_status?: RegistryProvenance["agent_status"];
      agent_profile_source?: RegistryProvenance["agent_source"];
      openclaw_agent_id_source?: RegistryProvenance["runtime_agent_ref_source"];
    };
  };
  const existing = legacyNode.registry_provenance;
  const requestedAgent = existing?.agent_id_requested || node.agent_id || node.agent_profile?.trim() || null;
  const runtimeAgentRef = node.runtime_agent_ref ?? node.openclaw_agent_id ?? null;
  const runtimeSource =
    existing?.runtime_agent_ref_source ||
    existing?.openclaw_agent_id_source ||
    (runtimeAgentRef ? "fallback" : "none");

  return {
    agent_id_requested: requestedAgent,
    agent_id_resolved: existing?.agent_id_resolved ?? existing?.agent_profile_resolved ?? null,
    agent_status: existing?.agent_status ?? existing?.agent_profile_status ?? (requestedAgent ? "missing" : null),
    agent_source: existing?.agent_source ?? existing?.agent_profile_source ?? (requestedAgent ? "fallback" : "none"),
    runtime_agent_ref_source: runtimeSource,
    skill_bindings:
      existing?.skill_bindings ||
      (node.allowed_skills || []).map((skillId) => ({
        skill_id: skillId,
        sources: ["node_allowed"],
        registry_status: "missing",
        included: true,
        excluded_reason: null,
      })),
    tool_bindings:
      existing?.tool_bindings ||
      (node.allowed_tools || []).map((toolId) => ({
        tool_id: toolId,
        sources: ["node_allowed"],
      })),
  };
}

function normalizeRunPlanRecord(plan: RunPlanRecord): RunPlanRecord {
  return {
    ...plan,
    status: parseLifecycleStatus(RUN_LIFECYCLE, plan.status),
    compiled_nodes: plan.compiled_nodes.map((node, index) => {
      const runtimeAgentRef = node.runtime_agent_ref ?? node.openclaw_agent_id ?? null;
      const { agent_profile: _legacyProfile, openclaw_agent_id: _legacyOpenClawId, ...canonicalNode } = node;
      const normalizedNode: CompiledNodeRecord = {
        ...canonicalNode,
        status: parseLifecycleStatus(NODE_LIFECYCLE, node.status),
        agent_id: node.agent_id ?? node.agent_binding_snapshot?.agent_id ?? node.agent_profile?.trim() ?? null,
        agent_version: node.agent_version ?? node.agent_binding_snapshot?.agent_version ?? null,
        agent_binding_snapshot: node.agent_binding_snapshot ? normalizeAgentBindingSnapshot(node.agent_binding_snapshot) : null,
        runtime_agent_ref: runtimeAgentRef,
        agent_runtime: node.agent_runtime ?? null,
        harness_profile: node.harness_profile ?? null,
        allowed_skills: node.allowed_skills || [],
        allowed_tools: node.allowed_tools || [],
        approval_kind: node.approval_kind ?? null,
        human_input_schema: node.human_input_schema ?? null,
        execution_ref: normalizeExecutionRef(node.execution_ref),
        work_package: normalizeCompiledWorkPackage(node, index),
        registry_provenance: node.registry_provenance,
      };
      normalizedNode.registry_provenance = normalizeRegistryProvenance(normalizedNode);
      return normalizedNode;
    }),
  };
}

export function saveRunPlan(plan: RunPlanRecord, options: { recovery?: boolean } = {}): RunPlanRecord {
  ensureDir(RUN_PLANS_DIR);
  const normalized = normalizeRunPlanRecord(plan);
  const storage = getJsonStorageBackend();
  const target = runPlanPath(normalized.run_id);
  if (storage.exists(target)) {
    const previous = normalizeRunPlanRecord(storage.readJson<RunPlanRecord>(target));
    assertLifecycleTransition(RUN_LIFECYCLE, previous.status, normalized.status, options);
    const previousNodes = new Map(previous.compiled_nodes.map((node) => [node.node_run_id, node]));
    for (const node of normalized.compiled_nodes) {
      const previousNode = previousNodes.get(node.node_run_id);
      if (previousNode) assertLifecycleTransition(NODE_LIFECYCLE, previousNode.status, node.status, options);
    }
  }
  assertValidRunPlan(normalized);
  writeJsonAtomic(runPlanPath(normalized.run_id), normalized);
  return normalized;
}

export function getRunPlan(runId: string): RunPlanRecord | null {
  const storage = getJsonStorageBackend();
  const filePath = runPlanPath(runId);
  if (!storage.exists(filePath)) {
    return null;
  }
  return normalizeRunPlanRecord(storage.readJson<RunPlanRecord>(filePath));
}

export function listRunPlans(workspaceId?: string): RunPlanRecord[] {
  const storage = getJsonStorageBackend();
  return storage.listJsonFiles(RUN_PLANS_DIR)
    .map((file) => normalizeRunPlanRecord(storage.readJson<RunPlanRecord>(file)))
    .filter((plan) => !workspaceId || plan.workspace_id === workspaceId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}
