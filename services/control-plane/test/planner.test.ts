import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCandidatePlan,
  generateDagDraft,
  recommendTemplate,
  registerPlannerProvider,
  ruleBasedPlannerProvider,
  localSemanticPlannerProvider,
  type PlannerProvider,
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

function seedCodingTemplate(): void {
  seedTemplate(
    buildPublishedTemplate({
      template_id: "coding-template",
      name: "Coding Repair",
      description: "Fix backend bug, refactor coding agent task",
      metadata: { domain: "coding" },
    }),
  );
}

function seedContentTemplate(): void {
  seedTemplate(
    buildPublishedTemplate({
      template_id: "content-template",
      name: "Content Studio",
      description: "Write 文案 海报 小红书 推文",
      metadata: { domain: "content" },
      nodes: [
        {
          id: "node_writer",
          name: "Writer Task",
          type: "agent_task",
          agent_profile: "content-writer",
          allowed_skills: ["copy-writing"],
          config: {},
          retry_policy: { max_attempts: 1, backoff_seconds: 5 },
          timeout_seconds: 600,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
    }),
  );
}

function seedRegistry(): void {
  seedAgentProfile({
    profile_id: "backend",
    name: "Backend Coding Agent",
    description: "Backend code refactor and bug fix",
    openclaw_agent_id: "backend",
    default_skills: ["coding-agent"],
    allowed_tools: ["read", "write", "shell"],
    policy_tags: ["coding"],
  });
  seedAgentProfile({
    profile_id: "content-writer",
    name: "Content Writer",
    description: "小红书 文案 海报 写作",
    openclaw_agent_id: "content-writer",
    default_skills: ["copy-writing"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });
  seedSkill({
    skill_id: "coding-agent",
    name: "Coding Agent",
    description: "代码 编码 refactor bug",
    category: "coding",
    allowed_tools: ["read", "write", "shell"],
    tags: ["coding"],
  });
  seedSkill({
    skill_id: "copy-writing",
    name: "Copy Writing",
    description: "文案 写作 海报",
    category: "content",
    allowed_tools: ["read", "write"],
    tags: ["content"],
  });
}

test("rule_based provider annotates planner_context with provider_id and no fallback", async () => {
  resetTestRoot();
  clearProviderEnv();
  seedCodingTemplate();
  const result = await recommendTemplate("Fix backend bug");
  assert.ok(result, "recommendation expected");
  assert.equal(result?.planner_context.provider_id, "rule_based_v1");
  assert.equal(result?.planner_context.fallback_used, false);
});

test("unknown provider id silently falls back to rule_based without crashing", async () => {
  resetTestRoot();
  setProviderEnv("does_not_exist_v9");
  seedCodingTemplate();
  const result = await recommendTemplate("Fix backend bug");
  assert.ok(result, "recommendation expected");
  assert.equal(result?.planner_context.provider_id, "rule_based_v1");
  assert.equal(result?.planner_context.fallback_used, false);
  clearProviderEnv();
});

test("primary provider error triggers fallback annotation", async () => {
  resetTestRoot();
  seedCodingTemplate();

  const explodingProvider: PlannerProvider = {
    id: "exploding_v1",
    displayName: "Exploding test provider",
    async recommendTemplate() {
      throw new Error("boom");
    },
    async generateDagDraft() {
      throw new Error("boom");
    },
    async generateCandidatePlan() {
      throw new Error("boom");
    },
  };
  registerPlannerProvider(explodingProvider);
  setProviderEnv("exploding_v1");

  const result = await recommendTemplate("Fix backend bug");
  assert.ok(result, "recommendation expected after fallback");
  assert.equal(result?.planner_context.provider_id, "rule_based_v1");
  assert.equal(result?.planner_context.fallback_used, true);
  assert.equal(result?.planner_context.fallback_reason, "boom");

  clearProviderEnv();
});

test("local_semantic_v1 reranks template with coding domain match", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedRegistry();
  seedCodingTemplate();
  seedContentTemplate();

  const result = await recommendTemplate("帮我修一个后端 backend bug，refactor 代码");
  assert.ok(result, "recommendation expected");
  assert.equal(result?.planner_context.provider_id, "local_semantic_v1");
  assert.equal(result?.selected_template.template_id, "coding-template");
  const codingCandidate = result?.candidates.find(
    (candidate) => candidate.template_id === "coding-template",
  );
  assert.ok(
    codingCandidate?.reason.includes("Domain match"),
    `expected coding candidate to mention domain match, got: ${codingCandidate?.reason}`,
  );

  clearProviderEnv();
});

test("local_semantic_v1 reranks toward content template for chinese content intent", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedRegistry();
  seedCodingTemplate();
  seedContentTemplate();

  const result = await recommendTemplate("帮我写一篇小红书文案，配一张海报");
  assert.ok(result, "recommendation expected");
  assert.equal(result?.planner_context.provider_id, "local_semantic_v1");
  assert.equal(result?.selected_template.template_id, "content-template");

  clearProviderEnv();
});

test("local_semantic_v1 candidate plan still compiles via rule-based when template is published", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedRegistry();
  seedCodingTemplate();

  const result = await generateCandidatePlan({
    intent: "Fix backend bug",
    template_id: "coding-template",
    inputs: { goal: "Fix bug" },
  });
  assert.ok(result.candidate_plan);
  assert.equal(
    (result.candidate_plan.planner_context as Record<string, unknown>).provider_id,
    "local_semantic_v1",
  );

  clearProviderEnv();
});

test("dag draft falls back to rule-based behavior when no domain match", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedRegistry();
  seedCodingTemplate();

  const result = await generateDagDraft({
    intent: "do something abstract without domain cues",
    inputs: { goal: "abstract" },
  });
  assert.ok(result.draft_template);
  assert.equal(typeof result.planner_context.provider_id, "string");

  clearProviderEnv();
});

test("local_semantic_v1 prefers metadata-claimed domain over textual cue match", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedRegistry();
  // Tight, metadata-self-declared research template.
  seedTemplate(
    buildPublishedTemplate({
      template_id: "research-tight",
      name: "Research Tight",
      description: "Research and analysis report",
      metadata: { domain: "research" },
    }),
  );
  // Loose template that does not self-declare a known domain but happens to
  // surface research cues through node profile / skill text.
  seedTemplate(
    buildPublishedTemplate({
      template_id: "research-loose",
      name: "Research Loose",
      description: "Generic chain backed by research workers",
      metadata: { domain: "demo" },
      nodes: [
        {
          id: "node_research",
          name: "Research Step",
          type: "agent_task",
          agent_profile: "research-analyst",
          allowed_skills: ["competitive-research"],
          config: {},
          retry_policy: { max_attempts: 1, backoff_seconds: 5 },
          timeout_seconds: 600,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
    }),
  );

  const result = await recommendTemplate("帮我做一个竞品调研报告");
  assert.ok(result, "recommendation expected");
  assert.equal(result?.planner_context.provider_id, "local_semantic_v1");
  // The metadata-claimed template must beat the textual-cue template even
  // though both end up matching the research domain.
  assert.equal(
    result?.selected_template.template_id,
    "research-tight",
    "metadata.domain claim should outrank textual cue match on tie",
  );

  clearProviderEnv();
});

test("provider registry contains rule_based and local_semantic", () => {
  assert.equal(ruleBasedPlannerProvider.id, "rule_based_v1");
  assert.equal(localSemanticPlannerProvider.id, "local_semantic_v1");
});
