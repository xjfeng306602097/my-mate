import Anthropic from "@anthropic-ai/sdk";
import { listCurrentPublishedTemplates } from "../template-store.js";
import {
  PLANNER_LLM_MAX_TOKENS,
  PLANNER_LLM_MODEL,
  PLANNER_LLM_TIMEOUT_MS,
} from "../config.js";
import type {
  PlannerCandidatePlanRequest,
  PlannerCandidatePlanResponse,
  PlannerDagDraftRequest,
  PlannerDagDraftResponse,
  PlannerTemplateCandidate,
  PlannerTemplateSelectionResponse,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTemplateRecord,
} from "../types.js";
import { isPlainObject, nowIso } from "../utils.js";
import type { PlannerProvider } from "./provider.js";
import type { PlannerInvocationOptions } from "./provider.js";
import { localSemanticPlannerProvider } from "./local-semantic.js";
import { registerPlannerProvider } from "./registry.js";
import { validateRunRequestForTemplate } from "./rule-based.js";

export const LLM_CLAUDE_PROVIDER_ID = "llm_claude_v1";

const SELECT_TEMPLATE_TOOL_NAME = "select_template";
const SHAPE_DAG_TOOL_NAME = "shape_dag";

// Allow tests / future providers to inject a custom client factory.
export type AnthropicClientFactory = () => Anthropic;

let clientFactory: AnthropicClientFactory | null = null;

export function setAnthropicClientFactory(factory: AnthropicClientFactory | null): void {
  clientFactory = factory;
}

function buildDefaultClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return new Anthropic({ apiKey });
}

function getClient(): Anthropic {
  if (clientFactory) {
    return clientFactory();
  }
  return buildDefaultClient();
}

interface SelectTemplateToolInput {
  selected_template_id: string;
  candidates: Array<{
    template_id: string;
    score: number;
    reason: string;
  }>;
  reasoning?: string;
}

interface ShapeDagToolInput {
  edges: Array<{
    from: string;
    to: string;
    label?: string | null;
  }>;
  reasoning?: string;
}

function templateLine(template: WorkflowTemplateRecord): string {
  const description = (template.description || "").replace(/\s+/g, " ").trim();
  const scope = template.workspace_scope || "default";
  return `- ${template.template_id} | ${template.name} | scope=${scope} | ${description}`.slice(0, 280);
}

function buildDagShapeSystemPrompt(options?: PlannerInvocationOptions): string {
  const lines = [
    "You are the DAG-shaping planner for My Mate.",
    "You will receive an already-safe deterministic draft DAG.",
    "You may improve only the dependency edges between the provided nodes.",
    "Constraints:",
    "- You MUST call the `shape_dag` tool exactly once and never reply with free-form text.",
    "- You MUST NOT invent, remove, or rename nodes.",
    "- Every `from` and `to` value MUST be one of the provided node ids.",
    "- The graph MUST be acyclic.",
    "- Every non-terminal node MUST have a path to `node_end`.",
    "- `node_end` MUST NOT have outgoing edges.",
    "- If `node_review_gate` is present, all terminal work must pass through it before `node_end`.",
  ];
  const profilePrompt = options?.orchestratorSystemPrompt?.trim();
  if (profilePrompt) {
    lines.push(
      "",
      "Selected orchestrator profile guidance:",
      profilePrompt,
      "",
      "Use that guidance only to refine dependencies; all graph safety constraints above remain higher priority.",
    );
  }
  return lines.join("\n");
}

function buildDagShapeUserPrompt(
  request: PlannerDagDraftRequest,
  baseDraft: PlannerDagDraftResponse,
): string {
  const recommendationByNodeId = new Map(
    baseDraft.registry_recommendations.map((recommendation) => [recommendation.node_id, recommendation]),
  );
  const nodeLines = baseDraft.draft_template.nodes.map((node) => {
    const recommendation = recommendationByNodeId.get(node.id);
    const evidence = recommendation?.evidence || {};
    const domains = [
      ...(Array.isArray(evidence.coverage_domains) ? evidence.coverage_domains : []),
      ...(Array.isArray(evidence.matched_domains) ? evidence.matched_domains : []),
    ];
    return [
      `- ${node.id}`,
      `type=${node.type}`,
      `name=${node.name}`,
      `agent=${node.agent_id || node.agent_binding_snapshot?.agent_id || "none"}`,
      `skills=${node.allowed_skills.join(",") || "none"}`,
      `domains=${[...new Set(domains)].join(",") || "none"}`,
    ].join(" | ");
  });
  const edgeLines = baseDraft.draft_template.edges.map((edge) =>
    `- ${edge.from} -> ${edge.to}${edge.label ? ` | label=${edge.label}` : ""}`,
  );
  return [
    `User intent: ${request.intent.trim()}`,
    "",
    "Provided nodes:",
    nodeLines.join("\n"),
    "",
    "Current deterministic edges:",
    edgeLines.join("\n") || "- none",
    "",
    "Return only via the `shape_dag` tool.",
  ].join("\n");
}

function buildSystemPrompt(options?: PlannerInvocationOptions): string {
  const lines = [
    "You are the template-selection planner for a Chinese-and-English mobile agent product called My Mate.",
    "Pick the single best published template that matches the user's intent, plus a small ranked candidate list.",
    "Constraints:",
    "- You MUST call the `select_template` tool exactly once and never reply with free-form text.",
    "- `selected_template_id` MUST be one of the template ids in the provided list. Never invent ids.",
    "- `candidates` is the top 1-5 templates ranked by suitability, score in [0, 1].",
    "- Each candidate `reason` must be one short sentence in the same language as the user's intent.",
    "- If the user's intent is ambiguous, pick the most generally useful template instead of refusing.",
  ];
  const profilePrompt = options?.orchestratorSystemPrompt?.trim();
  if (profilePrompt) {
    lines.push(
      "",
      "Selected orchestrator profile guidance:",
      profilePrompt,
      "",
      "Use that guidance only to rank templates and handoff style; all constraints above remain higher priority.",
    );
  }
  return lines.join("\n");
}

function buildUserPrompt(intent: string, templates: WorkflowTemplateRecord[]): string {
  const templateLines = templates.map(templateLine).join("\n");
  return [
    `User intent: ${intent.trim()}`,
    "",
    "Available published templates:",
    templateLines,
    "",
    "Return only via the `select_template` tool.",
  ].join("\n");
}

const SELECT_TEMPLATE_TOOL_SCHEMA = {
  name: SELECT_TEMPLATE_TOOL_NAME,
  description: "Pick the best matching template for the user's intent.",
  input_schema: {
    type: "object" as const,
    properties: {
      selected_template_id: {
        type: "string",
        description: "Must be one of the provided template ids.",
      },
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            template_id: { type: "string" },
            score: { type: "number" },
            reason: { type: "string" },
          },
          required: ["template_id", "score", "reason"],
        },
      },
      reasoning: { type: "string" },
    },
    required: ["selected_template_id", "candidates"],
  },
};

const SHAPE_DAG_TOOL_SCHEMA = {
  name: SHAPE_DAG_TOOL_NAME,
  description: "Return a safe dependency edge set for the provided DAG nodes.",
  input_schema: {
    type: "object" as const,
    properties: {
      edges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            label: { type: "string" },
          },
          required: ["from", "to"],
        },
      },
      reasoning: {
        type: "string",
        description: "Short explanation of the dependency shape.",
      },
    },
    required: ["edges"],
  },
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function parseToolCall(message: Anthropic.Message): SelectTemplateToolInput | null {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === SELECT_TEMPLATE_TOOL_NAME) {
      const input = block.input as SelectTemplateToolInput;
      if (
        input &&
        typeof input.selected_template_id === "string" &&
        Array.isArray(input.candidates)
      ) {
        return input;
      }
    }
  }
  return null;
}

function parseDagShapeToolCall(message: Anthropic.Message): ShapeDagToolInput | null {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === SHAPE_DAG_TOOL_NAME) {
      const input = block.input as ShapeDagToolInput;
      if (input && Array.isArray(input.edges)) {
        return input;
      }
    }
  }
  return null;
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length >= 2);
}

function templateCandidateFromTool(
  template: WorkflowTemplateRecord,
  scored: { score: number; reason: string },
  intentTokens: string[],
): PlannerTemplateCandidate {
  const lowerName = template.name.toLowerCase();
  const lowerDesc = (template.description || "").toLowerCase();
  const matched = intentTokens.filter(
    (token) => lowerName.includes(token) || lowerDesc.includes(token),
  );
  const score = Math.max(0, Math.min(1, Number(scored.score.toFixed(4))));
  return {
    template_id: template.template_id,
    version: template.version,
    name: template.name,
    description: template.description,
    workspace_scope: template.workspace_scope,
    score,
    matched_terms: matched,
    reason: scored.reason || "Selected by LLM planner.",
    evidence: {
      coverage_score: matched.length > 0 && intentTokens.length > 0
        ? Number((matched.length / intentTokens.length).toFixed(4))
        : 0,
    },
  };
}

async function callLlmForTemplate(
  intent: string,
  publishedTemplates: WorkflowTemplateRecord[],
  options?: PlannerInvocationOptions,
): Promise<SelectTemplateToolInput> {
  const client = getClient();
  const model = options?.model?.trim() || PLANNER_LLM_MODEL;
  const request = client.messages.create({
    model,
    max_tokens: PLANNER_LLM_MAX_TOKENS,
    system: buildSystemPrompt(options),
    tools: [SELECT_TEMPLATE_TOOL_SCHEMA],
    tool_choice: { type: "tool", name: SELECT_TEMPLATE_TOOL_NAME },
    messages: [
      { role: "user", content: buildUserPrompt(intent, publishedTemplates) },
    ],
  });
  const message = (await withTimeout(
    request as Promise<Anthropic.Message>,
    PLANNER_LLM_TIMEOUT_MS,
    "planner LLM call",
  )) as Anthropic.Message;
  const tool = parseToolCall(message);
  if (!tool) {
    throw new Error("planner LLM did not return select_template tool call");
  }
  return tool;
}

async function callLlmForDagShape(
  request: PlannerDagDraftRequest,
  baseDraft: PlannerDagDraftResponse,
  options?: PlannerInvocationOptions,
): Promise<ShapeDagToolInput> {
  const client = getClient();
  const model = options?.model?.trim() || PLANNER_LLM_MODEL;
  const llmRequest = client.messages.create({
    model,
    max_tokens: PLANNER_LLM_MAX_TOKENS,
    system: buildDagShapeSystemPrompt(options),
    tools: [SHAPE_DAG_TOOL_SCHEMA],
    tool_choice: { type: "tool", name: SHAPE_DAG_TOOL_NAME },
    messages: [
      { role: "user", content: buildDagShapeUserPrompt(request, baseDraft) },
    ],
  });
  const message = (await withTimeout(
    llmRequest as Promise<Anthropic.Message>,
    PLANNER_LLM_TIMEOUT_MS,
    "planner DAG LLM call",
  )) as Anthropic.Message;
  const tool = parseDagShapeToolCall(message);
  if (!tool) {
    throw new Error("planner LLM did not return shape_dag tool call");
  }
  return tool;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "planner DAG shape error";
}

function normalizeLlmEdges(nodes: WorkflowNode[], tool: ShapeDagToolInput): WorkflowEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const edges: WorkflowEdge[] = [];
  for (const rawEdge of tool.edges) {
    const from = typeof rawEdge.from === "string" ? rawEdge.from.trim() : "";
    const to = typeof rawEdge.to === "string" ? rawEdge.to.trim() : "";
    if (!from || !to) {
      throw new Error("LLM DAG edge is missing from/to.");
    }
    if (!nodeIds.has(from) || !nodeIds.has(to)) {
      throw new Error(`LLM DAG edge references unknown node: ${from} -> ${to}`);
    }
    if (from === to) {
      throw new Error(`LLM DAG edge creates a self-loop on ${from}.`);
    }
    if (from === "node_end") {
      throw new Error("LLM DAG edge cannot originate from node_end.");
    }
    const key = `${from}->${to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const label = typeof rawEdge.label === "string" && rawEdge.label.trim()
      ? rawEdge.label.trim().slice(0, 80)
      : null;
    edges.push({
      from,
      to,
      condition: null,
      label,
    });
  }
  if (edges.length === 0) {
    throw new Error("LLM DAG shape returned no edges.");
  }
  return edges;
}

function assertAcyclic(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const queue = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([nodeId]) => nodeId);
  let visited = 0;
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(nodeId) || []) {
      const nextCount = (incoming.get(next) || 0) - 1;
      incoming.set(next, nextCount);
      if (nextCount === 0) {
        queue.push(next);
      }
    }
  }
  if (visited !== nodes.length) {
    throw new Error("LLM DAG shape must be acyclic.");
  }
}

function assertPathToEnd(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
  }
  const canReachEnd = (nodeId: string, seen = new Set<string>()): boolean => {
    if (nodeId === "node_end") {
      return true;
    }
    if (seen.has(nodeId)) {
      return false;
    }
    seen.add(nodeId);
    return (outgoing.get(nodeId) || []).some((next) => canReachEnd(next, seen));
  };
  for (const node of nodes) {
    if (node.id === "node_end") {
      continue;
    }
    if (!canReachEnd(node.id)) {
      throw new Error(`LLM DAG node ${node.id} has no path to node_end.`);
    }
  }
}

function assertReviewGatePreserved(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  const hasReviewGate = nodes.some((node) => node.id === "node_review_gate");
  if (!hasReviewGate) {
    return;
  }
  if (!edges.some((edge) => edge.from === "node_review_gate" && edge.to === "node_end")) {
    throw new Error("LLM DAG shape must connect node_review_gate to node_end.");
  }
  const bypass = edges.find((edge) => edge.to === "node_end" && edge.from !== "node_review_gate");
  if (bypass) {
    throw new Error(`LLM DAG shape bypasses the review gate: ${bypass.from} -> node_end`);
  }
}

function assertSafeLlmDag(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  if (!nodes.some((node) => node.id === "node_end")) {
    throw new Error("DAG draft has no node_end.");
  }
  assertAcyclic(nodes, edges);
  assertPathToEnd(nodes, edges);
  assertReviewGatePreserved(nodes, edges);
}

function templateRecordFromDraft(
  draft: PlannerDagDraftResponse["draft_template"],
): WorkflowTemplateRecord {
  const timestamp = nowIso();
  return {
    template_id: draft.template_id,
    version: 1,
    name: draft.name,
    status: "draft",
    description: draft.description,
    workspace_scope: draft.workspace_scope || "default",
    input_schema: draft.input_schema,
    policy: draft.policy,
    nodes: draft.nodes,
    edges: draft.edges,
    metadata: draft.metadata || {},
    created_at: timestamp,
    updated_at: timestamp,
    published_at: null,
  };
}

function applyLlmDagShape(
  request: PlannerDagDraftRequest,
  baseDraft: PlannerDagDraftResponse,
  tool: ShapeDagToolInput,
): PlannerDagDraftResponse {
  const edges = normalizeLlmEdges(baseDraft.draft_template.nodes, tool);
  assertSafeLlmDag(baseDraft.draft_template.nodes, edges);
  const baseMetadata = isPlainObject(baseDraft.draft_template.metadata)
    ? baseDraft.draft_template.metadata
    : {};
  const draftTemplate = {
    ...baseDraft.draft_template,
    edges,
    metadata: {
      ...baseMetadata,
      planner_dag_shape_base: baseMetadata.planner_dag_shape || null,
      planner_dag_shape: "llm_shaped",
      planner_dag_shape_provider: LLM_CLAUDE_PROVIDER_ID,
      planner_llm_dag_shape_applied: true,
      planner_llm_dag_shape_reasoning: tool.reasoning || null,
    },
  };
  const validation = validateRunRequestForTemplate(
    {
      intent: request.intent,
      template_id: draftTemplate.template_id,
      inputs: isPlainObject(request.inputs) ? request.inputs : {},
    },
    templateRecordFromDraft(draftTemplate),
  );
  if (!validation.passed) {
    throw new Error(`LLM DAG shape failed validation: ${validation.warnings.join("; ")}`);
  }
  return {
    ...baseDraft,
    draft_template: draftTemplate,
    validation,
    planner_context: {
      ...baseDraft.planner_context,
      planner_model: LLM_CLAUDE_PROVIDER_ID,
      dag_shape_provider: LLM_CLAUDE_PROVIDER_ID,
      dag_shape_strategy: "llm_edge_rewrite",
    } as PlannerDagDraftResponse["planner_context"],
  };
}

function annotateDagShapeFallback(
  baseDraft: PlannerDagDraftResponse,
  reason: string,
): PlannerDagDraftResponse {
  const baseMetadata = isPlainObject(baseDraft.draft_template.metadata)
    ? baseDraft.draft_template.metadata
    : {};
  return {
    ...baseDraft,
    draft_template: {
      ...baseDraft.draft_template,
      metadata: {
        ...baseMetadata,
        planner_dag_shape_provider: "local_semantic_v1",
        planner_llm_dag_shape_applied: false,
        planner_llm_dag_shape_fallback_reason: reason,
      },
    },
    planner_context: {
      ...baseDraft.planner_context,
      planner_model: LLM_CLAUDE_PROVIDER_ID,
      dag_shape_provider: "local_semantic_v1",
      dag_shape_strategy: "deterministic_fallback",
      dag_shape_fallback_reason: reason,
    } as PlannerDagDraftResponse["planner_context"],
  };
}

async function recommendTemplate(
  intent: string,
  options?: PlannerInvocationOptions,
): Promise<PlannerTemplateSelectionResponse | null> {
  const intentTrimmed = intent.trim();
  if (!intentTrimmed) {
    return null;
  }
  const publishedTemplates = listCurrentPublishedTemplates();
  if (publishedTemplates.length === 0) {
    return null;
  }

  const tool = await callLlmForTemplate(intentTrimmed, publishedTemplates, options);
  const intentTokens = tokenize(intentTrimmed);
  const validIds = new Set(publishedTemplates.map((t) => t.template_id));
  if (!validIds.has(tool.selected_template_id)) {
    throw new Error(
      `LLM returned unknown template id ${tool.selected_template_id}; falling back`,
    );
  }
  const validCandidates = tool.candidates
    .filter((c) => validIds.has(c.template_id))
    .map((c) => {
      const template = publishedTemplates.find((t) => t.template_id === c.template_id);
      if (!template) {
        return null;
      }
      return templateCandidateFromTool(template, c, intentTokens);
    })
    .filter((c): c is PlannerTemplateCandidate => c !== null);

  if (validCandidates.length === 0) {
    throw new Error("LLM returned no valid candidates");
  }
  if (!validCandidates.some((c) => c.template_id === tool.selected_template_id)) {
    const selectedTemplate = publishedTemplates.find(
      (t) => t.template_id === tool.selected_template_id,
    )!;
    validCandidates.unshift(
      templateCandidateFromTool(
        selectedTemplate,
        { score: 0.9, reason: "LLM-selected primary template." },
        intentTokens,
      ),
    );
  }
  validCandidates.sort((a, b) => b.score - a.score);
  const selected =
    validCandidates.find((c) => c.template_id === tool.selected_template_id) ||
    validCandidates[0];

  return {
    selected_template: selected,
    candidates: validCandidates.slice(0, 5),
    planner_context: {
      planner_model: LLM_CLAUDE_PROVIDER_ID,
      intent_tokens: intentTokens,
    } as PlannerTemplateSelectionResponse["planner_context"],
  };
}

export const llmClaudePlannerProvider: PlannerProvider = {
  id: LLM_CLAUDE_PROVIDER_ID,
  displayName: "Claude API planner v1",
  async recommendTemplate(intent: string, options?: PlannerInvocationOptions) {
    return recommendTemplate(intent, options);
  },
  async generateDagDraft(
    request: PlannerDagDraftRequest,
    options?: PlannerInvocationOptions,
  ): Promise<PlannerDagDraftResponse> {
    const baseDraft = await localSemanticPlannerProvider.generateDagDraft(request, options);
    const executableNodes = baseDraft.draft_template.nodes.filter((node) => node.type !== "end");
    if (baseDraft.planner_context.draft_strategy !== "registry_synthesis" || executableNodes.length < 2) {
      return annotateDagShapeFallback(
        baseDraft,
        "LLM DAG shaping skipped for template variants or single-node drafts.",
      );
    }
    try {
      const tool = await callLlmForDagShape(request, baseDraft, options);
      return applyLlmDagShape(request, baseDraft, tool);
    } catch (error) {
      return annotateDagShapeFallback(baseDraft, describeError(error));
    }
  },
  async generateCandidatePlan(
    _request: PlannerCandidatePlanRequest,
  ): Promise<PlannerCandidatePlanResponse> {
    throw new Error("LLM planner does not compile candidate plans; falling back");
  },
};

registerPlannerProvider(llmClaudePlannerProvider);
