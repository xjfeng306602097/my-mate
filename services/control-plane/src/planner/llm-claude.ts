import Anthropic from "@anthropic-ai/sdk";
import { listTemplates } from "../template-store.js";
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
  WorkflowTemplateRecord,
} from "../types.js";
import type { PlannerProvider } from "./provider.js";
import type { PlannerInvocationOptions } from "./provider.js";
import { registerPlannerProvider } from "./registry.js";

export const LLM_CLAUDE_PROVIDER_ID = "llm_claude_v1";

const SELECT_TEMPLATE_TOOL_NAME = "select_template";

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

function templateLine(template: WorkflowTemplateRecord): string {
  const description = (template.description || "").replace(/\s+/g, " ").trim();
  const scope = template.workspace_scope || "default";
  return `- ${template.template_id} | ${template.name} | scope=${scope} | ${description}`.slice(0, 280);
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

async function recommendTemplate(
  intent: string,
  options?: PlannerInvocationOptions,
): Promise<PlannerTemplateSelectionResponse | null> {
  const intentTrimmed = intent.trim();
  if (!intentTrimmed) {
    return null;
  }
  const publishedTemplates = listTemplates().filter((t) => t.status === "published");
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
  async generateDagDraft(_request: PlannerDagDraftRequest): Promise<PlannerDagDraftResponse> {
    // LLM provider only handles template selection; bubble up so the registry
    // falls back to rule-based for DAG synthesis and candidate plan compilation.
    throw new Error("LLM planner does not synthesize DAG drafts; falling back");
  },
  async generateCandidatePlan(
    _request: PlannerCandidatePlanRequest,
  ): Promise<PlannerCandidatePlanResponse> {
    throw new Error("LLM planner does not compile candidate plans; falling back");
  },
};

registerPlannerProvider(llmClaudePlannerProvider);
