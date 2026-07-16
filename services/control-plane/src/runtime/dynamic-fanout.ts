import { createEmptyExecutionRef } from "../execution-ref.js";
import type {
  CompiledNodeRecord,
  NodeRunRecord,
  RunPlanRecord,
  WorkflowEdge,
} from "../types.js";

interface DynamicFanoutConfig {
  target_node_id: string;
  source_path: string;
  max_items: number;
  item_input_key: string;
  index_input_key: string;
}

export interface DynamicFanoutResult {
  applied: boolean;
  generated_node_run_ids: string[];
  item_count: number;
  template_node_id: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readConfig(source: CompiledNodeRecord): DynamicFanoutConfig | null {
  const nodeConfig = asRecord(source.input_payload.node_config);
  const raw = asRecord(nodeConfig?.dynamic_fanout);
  if (!raw || typeof raw.target_node_id !== "string" || !raw.target_node_id.trim()) return null;
  return {
    target_node_id: raw.target_node_id.trim(),
    source_path:
      typeof raw.source_path === "string" && raw.source_path.trim()
        ? raw.source_path.trim()
        : "items",
    max_items:
      typeof raw.max_items === "number" && Number.isFinite(raw.max_items)
        ? Math.max(0, Math.floor(raw.max_items))
        : 32,
    item_input_key:
      typeof raw.item_input_key === "string" && raw.item_input_key.trim()
        ? raw.item_input_key.trim()
        : "fanout_item",
    index_input_key:
      typeof raw.index_input_key === "string" && raw.index_input_key.trim()
        ? raw.index_input_key.trim()
        : "fanout_index",
  };
}

function resolvePath(content: unknown, sourcePath: string): unknown {
  const parts = sourcePath.split(".").filter(Boolean);
  if (parts[0] === "handoff") parts.shift();
  if (parts[0] === "content") parts.shift();
  let current: unknown = content;
  for (const part of parts) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[part];
  }
  return current;
}

function cloneEdge(edge: WorkflowEdge, overrides: Partial<WorkflowEdge>): WorkflowEdge {
  return { ...edge, ...overrides };
}

export function materializeDynamicFanout(input: {
  plan: RunPlanRecord;
  nodeRuns: NodeRunRecord[];
  source: CompiledNodeRecord;
  handoffId: string;
  content: unknown;
  timestamp: string;
}): DynamicFanoutResult {
  const config = readConfig(input.source);
  if (!config) {
    return { applied: false, generated_node_run_ids: [], item_count: 0, template_node_id: null };
  }
  const existing = input.plan.compiled_nodes.filter(
    (node) => node.dynamic_fanout?.source_handoff_id === input.handoffId,
  );
  if (existing.length > 0) {
    return {
      applied: false,
      generated_node_run_ids: existing.map((node) => node.node_run_id),
      item_count: existing[0]?.dynamic_fanout?.item_count || existing.length,
      template_node_id: config.target_node_id,
    };
  }
  const resolved = resolvePath(input.content, config.source_path);
  if (!Array.isArray(resolved)) {
    throw new Error(`Dynamic fanout source path ${config.source_path} did not resolve to an array.`);
  }
  if (resolved.length > config.max_items) {
    throw new Error(
      `Dynamic fanout produced ${resolved.length} items, exceeding max_items ${config.max_items}.`,
    );
  }
  const template = input.plan.compiled_nodes.find(
    (node) => node.node_id === config.target_node_id,
  );
  if (!template) throw new Error(`Dynamic fanout template node ${config.target_node_id} was not found.`);
  const templateRunIndex = input.nodeRuns.findIndex(
    (nodeRun) => nodeRun.node_run_id === template.node_run_id,
  );
  if (template.status !== "pending" || templateRunIndex < 0) {
    throw new Error(`Dynamic fanout template node ${config.target_node_id} is no longer pending.`);
  }

  const inbound = input.plan.edges.filter((edge) => edge.to === template.node_id);
  if (!inbound.some((edge) => edge.from === input.source.node_id)) {
    throw new Error("Dynamic fanout template must be a direct downstream node of the source.");
  }
  const outbound = input.plan.edges.filter((edge) => edge.from === template.node_id);
  const unrelated = input.plan.edges.filter(
    (edge) => edge.to !== template.node_id && edge.from !== template.node_id,
  );
  const generated: CompiledNodeRecord[] = resolved.map((item, index) => {
    const nodeId = `${template.node_id}__fanout_${String(index + 1).padStart(3, "0")}`;
    const nodeRunId = `${template.node_run_id}:fanout:${String(index + 1).padStart(3, "0")}`;
    const provenance = {
      source_node_id: input.source.node_id,
      source_node_run_id: input.source.node_run_id,
      source_handoff_id: input.handoffId,
      template_node_id: template.node_id,
      item_index: index,
      item_count: resolved.length,
    };
    return {
      ...template,
      node_id: nodeId,
      node_run_id: nodeRunId,
      name: `${template.name} ${index + 1}/${resolved.length}`,
      status: "pending",
      retry_policy: { ...template.retry_policy, attempt: 0 },
      input_payload: {
        ...template.input_payload,
        run_inputs: {
          ...(asRecord(template.input_payload.run_inputs) || {}),
          [config.item_input_key]: item,
          [config.index_input_key]: index,
        },
      },
      execution_ref: createEmptyExecutionRef(),
      dynamic_fanout: provenance,
    };
  });

  input.plan.compiled_nodes = input.plan.compiled_nodes
    .filter((node) => node.node_run_id !== template.node_run_id)
    .concat(generated);
  input.nodeRuns.splice(templateRunIndex, 1, ...generated.map((node) => ({
    node_run_id: node.node_run_id,
    run_id: input.plan.run_id,
    status: "pending" as const,
    progress: { percent: 0, message: "Waiting for fanout source", updated_at: input.timestamp },
    attempt: 0,
    started_at: null,
    finished_at: null,
    dynamic_fanout: node.dynamic_fanout,
  })));
  if (generated.length === 0) {
    input.plan.edges = [
      ...unrelated,
      ...outbound.map((edge) => cloneEdge(edge, { from: input.source.node_id })),
    ];
  } else {
    input.plan.edges = [
      ...unrelated,
      ...generated.flatMap((node) => [
        ...inbound.map((edge) => cloneEdge(edge, { to: node.node_id })),
        ...outbound.map((edge) => cloneEdge(edge, { from: node.node_id })),
      ]),
    ];
  }
  return {
    applied: true,
    generated_node_run_ids: generated.map((node) => node.node_run_id),
    item_count: resolved.length,
    template_node_id: template.node_id,
  };
}
