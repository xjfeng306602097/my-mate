import path from "node:path";
import { normalizeExecutionRef } from "./execution-ref.js";
import { RUN_PLANS_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { CompiledNodeRecord, RegistryProvenance, RunPlanRecord } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";
import { validateRunPlan } from "./validators.js";
import { normalizeCompiledWorkPackage } from "./work-package.js";

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
    registry_provenance?: Partial<RegistryProvenance>;
  };
  const existing = legacyNode.registry_provenance;
  const requestedProfile = node.agent_profile?.trim() || null;
  const runtimeAgentRef = node.runtime_agent_ref ?? node.openclaw_agent_id ?? null;
  const runtimeSource =
    existing?.runtime_agent_ref_source ||
    existing?.openclaw_agent_id_source ||
    (runtimeAgentRef ? "fallback" : "none");

  return {
    agent_profile_requested: existing?.agent_profile_requested ?? requestedProfile,
    agent_profile_resolved: existing?.agent_profile_resolved ?? null,
    agent_profile_status: existing?.agent_profile_status ?? (requestedProfile ? "missing" : null),
    agent_profile_source: existing?.agent_profile_source ?? (requestedProfile ? "fallback" : "none"),
    runtime_agent_ref_source: runtimeSource,
    openclaw_agent_id_source: existing?.openclaw_agent_id_source || runtimeSource,
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
    compiled_nodes: plan.compiled_nodes.map((node, index) => {
      const runtimeAgentRef = node.runtime_agent_ref ?? node.openclaw_agent_id ?? null;
      const normalizedNode: CompiledNodeRecord = {
        ...node,
        runtime_agent_ref: runtimeAgentRef,
        agent_runtime: node.agent_runtime ?? null,
        harness_profile: node.harness_profile ?? null,
        openclaw_agent_id: node.openclaw_agent_id ?? runtimeAgentRef,
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

export function saveRunPlan(plan: RunPlanRecord): RunPlanRecord {
  ensureDir(RUN_PLANS_DIR);
  const normalized = normalizeRunPlanRecord(plan);
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
