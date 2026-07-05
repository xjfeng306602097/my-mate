import test from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  recommendTemplate,
  setAnthropicClientFactory,
  llmClaudePlannerProvider,
} from "../src/planner/index.js";
import {
  buildPublishedTemplate,
  resetTestRoot,
  seedTemplate,
} from "./helpers.js";

function clearProviderEnv(): void {
  delete process.env.MY_MATE_PLANNER_PROVIDER;
}

function setProviderEnv(value: string): void {
  process.env.MY_MATE_PLANNER_PROVIDER = value;
}

function buildMockToolMessage(toolInput: Record<string, unknown>): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "select_template",
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
      orchestratorProfileId: "studio-llm-orchestrator",
      orchestratorSystemPrompt: "Prefer rollout-safe templates with an explicit handoff.",
    });
    assert.ok(result, "recommendation expected");
    assert.equal(result?.planner_context.provider_id, "llm_claude_v1");
    const context = result?.planner_context as Record<string, unknown>;
    assert.equal(context.requested_model, "claude-profile-model");
    assert.equal(context.orchestrator_profile_id, "studio-llm-orchestrator");
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

test("llm_claude_v1 generateDagDraft is unsupported and falls back", async () => {
  // The provider's own throw is what triggers the registry fallback. Verify
  // the throw happens (the fallback wiring is exercised in the broader
  // planner.test.ts; here we only cover the provider's contract).
  await assert.rejects(
    () => llmClaudePlannerProvider.generateDagDraft({ intent: "x" }),
    /falling back/,
  );
});
