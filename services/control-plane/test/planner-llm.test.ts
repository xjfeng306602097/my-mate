import test from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  generateDagDraft,
  recommendTemplate,
  setAnthropicClientFactory,
  llmClaudePlannerProvider,
} from "../src/planner/index.js";
import {
  buildPublishedTemplate,
  resetTestRoot,
  seedAgentProfile,
  seedSkill,
  seedTemplate,
} from "./helpers.js";

function clearProviderEnv(): void {
  delete process.env.MY_MATE_PLANNER_PROVIDER;
}

function setProviderEnv(value: string): void {
  process.env.MY_MATE_PLANNER_PROVIDER = value;
}

function buildMockToolMessage(
  toolInput: Record<string, unknown>,
  toolName = "select_template",
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: toolName,
        input: toolInput,
      } as Anthropic.ToolUseBlock,
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    } as Anthropic.Usage,
  } as Anthropic.Message;
}

function buildMockClient(
  handler: (request: Anthropic.MessageCreateParams) => Promise<Anthropic.Message>,
): Anthropic {
  return {
    messages: {
      create: handler,
    },
  } as unknown as Anthropic;
}

function seedTwoTemplates(): void {
  seedTemplate(
    buildPublishedTemplate({
      template_id: "alpha-template",
      name: "Alpha",
      description: "Alpha workflow",
    }),
  );
  seedTemplate(
    buildPublishedTemplate({
      template_id: "beta-template",
      name: "Beta",
      description: "Beta workflow",
    }),
  );
}

function seedResearchContentRegistry(): void {
  seedSkill({
    skill_id: "research-analysis",
    name: "Research Analysis",
    description: "Research analysis report",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research", "analysis"],
  });
  seedSkill({
    skill_id: "article-writing",
    name: "Article Writing",
    description: "Write article content copy",
    category: "content",
    allowed_tools: ["read", "write"],
    tags: ["content", "write"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    description: "Research analysis specialist",
    default_skills: ["research-analysis"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Article content writer",
    default_skills: ["article-writing"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });
}

test("llm_claude_v1 success path returns LLM-provided selection", async () => {
  resetTestRoot();
  setProviderEnv("llm_claude_v1");
  seedTwoTemplates();

  setAnthropicClientFactory(() =>
    buildMockClient(async () =>
      buildMockToolMessage({
        selected_template_id: "beta-template",
        candidates: [
          { template_id: "beta-template", score: 0.92, reason: "Beta fits the task." },
          { template_id: "alpha-template", score: 0.41, reason: "Alpha is a fallback." },
        ],
      }),
    ),
  );

  try {
    const result = await recommendTemplate("ship a beta integration");
    assert.ok(result, "recommendation expected");
    assert.equal(result?.selected_template.template_id, "beta-template");
    assert.equal(result?.planner_context.provider_id, "llm_claude_v1");
    assert.equal(result?.planner_context.fallback_used, false);
    assert.ok((result?.selected_template.evidence?.coverage_score || 0) >= 0);
  } finally {
    setAnthropicClientFactory(null);
    clearProviderEnv();
  }
});

test("llm_claude_v1 uses invocation model and orchestrator system prompt", async () => {
  resetTestRoot();
  clearProviderEnv();
  seedTwoTemplates();
  const capturedRequests: Array<Record<string, unknown>> = [];

  setAnthropicClientFactory(() =>
    buildMockClient(async (request) => {
      capturedRequests.push(request as unknown as Record<string, unknown>);
      return buildMockToolMessage({
        selected_template_id: "beta-template",
        candidates: [
          { template_id: "beta-template", score: 0.9, reason: "Beta fits the profile." },
        ],
      });
    }),
  );

  try {
    const result = await recommendTemplate("ship a beta integration", {
      providerId: "llm_claude_v1",
      model: "claude-profile-model",
      orchestratorAgentId: "studio-llm-orchestrator",
      orchestratorSystemPrompt: "Prefer rollout-safe templates with an explicit handoff.",
    });
    assert.ok(result, "recommendation expected");
    assert.equal(result?.planner_context.provider_id, "llm_claude_v1");
    const context = result?.planner_context as Record<string, unknown>;
    assert.equal(context.requested_model, "claude-profile-model");
    assert.equal(context.orchestrator_agent_id, "studio-llm-orchestrator");
    assert.equal(capturedRequests.length, 1);
    assert.equal(capturedRequests[0]?.model, "claude-profile-model");
    assert.match(
      String(capturedRequests[0]?.system || ""),
      /Prefer rollout-safe templates with an explicit handoff/,
    );
  } finally {
    setAnthropicClientFactory(null);
    clearProviderEnv();
  }
});

test("llm_claude_v1 SDK error falls back to rule-based", async () => {
  resetTestRoot();
  setProviderEnv("llm_claude_v1");
  seedTwoTemplates();

  setAnthropicClientFactory(() =>
    buildMockClient(async () => {
      throw new Error("network down");
    }),
  );

  try {
    const result = await recommendTemplate("anything goes");
    assert.ok(result, "fallback should still produce a recommendation");
    assert.equal(result?.planner_context.provider_id, "rule_based_v1");
    assert.equal(result?.planner_context.fallback_used, true);
    assert.equal(result?.planner_context.fallback_reason, "network down");
  } finally {
    setAnthropicClientFactory(null);
    clearProviderEnv();
  }
});

test("llm_claude_v1 unknown template id falls back to rule-based", async () => {
  resetTestRoot();
  setProviderEnv("llm_claude_v1");
  seedTwoTemplates();

  setAnthropicClientFactory(() =>
    buildMockClient(async () =>
      buildMockToolMessage({
        selected_template_id: "ghost-template",
        candidates: [
          { template_id: "ghost-template", score: 1, reason: "Hallucinated id." },
        ],
      }),
    ),
  );

  try {
    const result = await recommendTemplate("anything goes");
    assert.ok(result);
    assert.equal(result?.planner_context.provider_id, "rule_based_v1");
    assert.equal(result?.planner_context.fallback_used, true);
    assert.ok(
      String(result?.planner_context.fallback_reason || "").includes("ghost-template"),
    );
  } finally {
    setAnthropicClientFactory(null);
    clearProviderEnv();
  }
});

test("llm_claude_v1 missing tool call falls back to rule-based", async () => {
  resetTestRoot();
  setProviderEnv("llm_claude_v1");
  seedTwoTemplates();

  setAnthropicClientFactory(() =>
    buildMockClient(async () => ({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [{ type: "text", text: "I cannot help" } as Anthropic.TextBlock],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 5,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      } as Anthropic.Usage,
    } as Anthropic.Message)),
  );

  try {
    const result = await recommendTemplate("anything goes");
    assert.ok(result);
    assert.equal(result?.planner_context.provider_id, "rule_based_v1");
    assert.equal(result?.planner_context.fallback_used, true);
  } finally {
    setAnthropicClientFactory(null);
    clearProviderEnv();
  }
});

test("llm_claude_v1 generateDagDraft safely applies LLM-provided DAG edges", async () => {
  resetTestRoot();
  setProviderEnv("llm_claude_v1");
  seedResearchContentRegistry();
  const capturedRequests: Array<Record<string, unknown>> = [];

  setAnthropicClientFactory(() =>
    buildMockClient(async (request) => {
      capturedRequests.push(request as unknown as Record<string, unknown>);
      return buildMockToolMessage(
        {
          edges: [
            { from: "node_task_2", to: "node_task_1", label: "llm dependency" },
            { from: "node_task_1", to: "node_end" },
          ],
          reasoning: "Use the second task as upstream context before the first task.",
        },
        "shape_dag",
      );
    }),
  );

  try {
    const result = await generateDagDraft({
      intent: "Need research analysis and write article content",
      inputs: { goal: "Need research analysis and write article content" },
      max_agent_nodes: 2,
    });
    assert.equal(result.planner_context.provider_id, "llm_claude_v1");
    assert.equal(result.planner_context.fallback_used, false);
    assert.equal(result.draft_template.metadata?.planner_dag_shape, "llm_shaped");
    assert.equal(result.draft_template.metadata?.planner_llm_dag_shape_applied, true);
    assert.deepEqual(result.draft_template.edges.map((edge) => [edge.from, edge.to]), [
      ["node_task_2", "node_task_1"],
      ["node_task_1", "node_end"],
    ]);
    assert.equal(result.validation.passed, true);
    const toolChoice = capturedRequests[0]?.tool_choice as { name?: unknown } | undefined;
    assert.equal(toolChoice?.name, "shape_dag");
  } finally {
    setAnthropicClientFactory(null);
    clearProviderEnv();
  }
});

test("llm_claude_v1 generateDagDraft rejects unsafe DAG edges and keeps deterministic base", async () => {
  resetTestRoot();
  setProviderEnv("llm_claude_v1");
  seedResearchContentRegistry();

  setAnthropicClientFactory(() =>
    buildMockClient(async () =>
      buildMockToolMessage(
        {
          edges: [
            { from: "ghost_node", to: "node_end" },
          ],
          reasoning: "Invalid hallucinated node.",
        },
        "shape_dag",
      ),
    ),
  );

  try {
    const result = await generateDagDraft({
      intent: "Need research analysis and write article content",
      inputs: { goal: "Need research analysis and write article content" },
      max_agent_nodes: 2,
    });
    assert.equal(result.planner_context.provider_id, "llm_claude_v1");
    assert.equal(result.planner_context.fallback_used, false);
    assert.equal(result.draft_template.metadata?.planner_llm_dag_shape_applied, false);
    assert.match(
      String(result.draft_template.metadata?.planner_llm_dag_shape_fallback_reason || ""),
      /ghost_node/,
    );
    assert.equal(result.draft_template.metadata?.planner_dag_shape, "domain_ordered");
    assert.equal(result.validation.passed, true);
  } finally {
    setAnthropicClientFactory(null);
    clearProviderEnv();
  }
});
