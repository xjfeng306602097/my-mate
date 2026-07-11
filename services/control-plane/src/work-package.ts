import type {
  CompiledNodeRecord,
  CompiledWorkPackageBinding,
  RunPlanRecord,
  RunWorkPackageSnapshot,
  WorkflowNode,
} from "./types.js";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

export function compileWorkPackage(
  node: WorkflowNode,
  index: number,
): CompiledWorkPackageBinding {
  const key = asNonEmptyString(node.work_package?.key);
  const label = asNonEmptyString(node.work_package?.label);
  const order = asNonNegativeInteger(node.work_package?.order);
  if (key && label && order !== null) {
    return {
      key,
      label,
      order,
      identity_source: "declared",
    };
  }
  return {
    key: `node:${node.id}`,
    label: node.name || node.id,
    order: index,
    identity_source: "compiler_default",
  };
}

export function inferLegacyWorkPackage(
  node: Pick<CompiledNodeRecord, "node_id" | "name" | "type" | "approval_kind" | "human_input_schema" | "output_contract">,
  index: number,
): CompiledWorkPackageBinding {
  const name = `${node.name} ${node.node_id} ${node.type}`.toLowerCase();
  if (node.approval_kind || node.type === "approval") {
    return { key: "review", label: "Review and approval", order: index, identity_source: "legacy_inferred" };
  }
  if (node.human_input_schema || node.type === "human_input") {
    return { key: "human-input", label: "Human input", order: index, identity_source: "legacy_inferred" };
  }
  if (/deliver|final|handoff|publish|notify|send/.test(name)) {
    return { key: "deliver", label: "Delivery", order: index, identity_source: "legacy_inferred" };
  }
  if (/collect|research|context|gather|scan|intake/.test(name)) {
    return { key: "research", label: "Context collection", order: index, identity_source: "legacy_inferred" };
  }
  if (/draft|write|compose|generate|summar/i.test(name)) {
    return { key: "draft", label: "Drafting", order: index, identity_source: "legacy_inferred" };
  }
  const expectedArtifacts =
    node.output_contract && Array.isArray(node.output_contract.expected_artifacts)
      ? node.output_contract.expected_artifacts
      : [];
  if (expectedArtifacts.length > 0) {
    return { key: "deliver", label: "Delivery", order: index, identity_source: "legacy_inferred" };
  }
  return { key: "other", label: "Execution", order: index, identity_source: "legacy_inferred" };
}

export function normalizeCompiledWorkPackage(
  node: CompiledNodeRecord,
  index: number,
): CompiledWorkPackageBinding {
  const candidate = node.work_package;
  const key = asNonEmptyString(candidate?.key);
  const label = asNonEmptyString(candidate?.label);
  const order = asNonNegativeInteger(candidate?.order);
  const source = candidate?.identity_source;
  if (
    key &&
    label &&
    order !== null &&
    (source === "declared" || source === "compiler_default" || source === "legacy_inferred")
  ) {
    return { key, label, order, identity_source: source };
  }
  return inferLegacyWorkPackage(node, index);
}

export function buildRunWorkPackages(plan: RunPlanRecord): RunWorkPackageSnapshot[] {
  const groups = new Map<string, RunWorkPackageSnapshot>();
  plan.compiled_nodes.forEach((node, index) => {
    const binding = normalizeCompiledWorkPackage(node, index);
    const current = groups.get(binding.key);
    if (current) {
      current.node_run_ids.push(node.node_run_id);
      current.order = Math.min(current.order, binding.order);
      if (binding.identity_source === "legacy_inferred") {
        current.identity_source = "legacy_inferred";
      } else if (
        binding.identity_source === "compiler_default" &&
        current.identity_source === "declared"
      ) {
        current.identity_source = "compiler_default";
      }
      return;
    }
    groups.set(binding.key, {
      key: binding.key,
      label: binding.label,
      order: binding.order,
      node_run_ids: [node.node_run_id],
      identity_source: binding.identity_source,
    });
  });
  return [...groups.values()].sort(
    (left, right) => left.order - right.order || left.key.localeCompare(right.key),
  );
}
