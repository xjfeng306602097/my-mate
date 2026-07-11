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

function hasDraftEdge(
  result: Awaited<ReturnType<typeof generateDagDraft>>,
  from: string | undefined,
  to: string | undefined,
): boolean {
  return !!from && !!to && result.draft_template.edges.some((edge) => edge.from === from && edge.to === to);
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
  assert.ok((codingCandidate?.evidence?.domain_overlap_score || 0) > 0);
  assert.ok(codingCandidate?.evidence?.matched_domains?.includes("coding"));

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

test("local_semantic_v1 dag draft keeps template recommendation and draft source aligned after rerank", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedRegistry();
  seedTemplate(
    buildPublishedTemplate({
      template_id: "generic-template",
      name: "General Follow Up",
      description: "Need followup note for customer outreach",
      metadata: { domain: "customer" },
    }),
  );
  seedTemplate(
    buildPublishedTemplate({
      template_id: "content-template",
      name: "Content Studio",
      description: "Write article and social post content",
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

  const result = await generateDagDraft({
    intent: "Write a social post content draft",
    inputs: { goal: "Write a social post content draft" },
  });
  assert.equal(result.planner_context.provider_id, "local_semantic_v1");
  assert.equal(result.planner_context.draft_strategy, "template_variant");
  assert.equal(result.template_recommendation?.selected_template.template_id, "content-template");
  assert.equal(result.planner_context.source_template_id, "content-template");
  assert.equal(result.draft_template.metadata?.planner_source_template_id, "content-template");
  assert.equal(result.draft_template.metadata?.planner_source_template_selected_by, "template_selection");
  assert.equal(result.registry_recommendations[0]?.agent_profile_id, "content-writer");

  clearProviderEnv();
});

test("rule_based dag draft respects preferred subagent profile order for registry synthesis", async () => {
  resetTestRoot();
  clearProviderEnv();
  seedSkill({
    skill_id: "research-skill",
    name: "Research Skill",
    description: "Research investigation analysis",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research"],
  });
  seedSkill({
    skill_id: "writing-skill",
    name: "Writing Skill",
    description: "Draft write article content",
    category: "content",
    allowed_tools: ["read", "write"],
    tags: ["content"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    description: "Investigate and analyze",
    openclaw_agent_id: "research-openclaw",
    default_skills: ["research-skill"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Draft content and summaries",
    openclaw_agent_id: "writer-openclaw",
    default_skills: ["writing-skill"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });

  const result = await generateDagDraft(
    {
      intent: "Do something abstract without published templates",
      inputs: { goal: "Abstract goal" },
      max_agent_nodes: 1,
    },
    {
      preferredSubagentProfileIds: ["writer-agent"],
    },
  );
  assert.equal(result.planner_context.provider_id, "rule_based_v1");
  assert.deepEqual(result.planner_context.preferred_subagent_profile_ids, ["writer-agent"]);
  assert.equal(result.registry_recommendations[0]?.agent_profile_id, "writer-agent");
  assert.deepEqual(result.registry_recommendations[0]?.allowed_tools, ["read", "write"]);
  assert.deepEqual(result.draft_template.nodes[0]?.config?.allowed_tools, ["read", "write"]);
  assert.equal(result.registry_recommendations[0]?.evidence?.preferred_rank, 0);
  assert.ok((result.registry_recommendations[0]?.evidence?.profile_token_score || 0) >= 0);
});

test("local_semantic_v1 preferred subagent does not hide a stronger single-node domain fit", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedSkill({
    skill_id: "research-skill",
    name: "Research Skill",
    description: "Research investigation analysis report",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research"],
  });
  seedSkill({
    skill_id: "writing-skill",
    name: "Writing Skill",
    description: "Write article copy content",
    category: "content",
    allowed_tools: ["read", "write"],
    tags: ["content"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    description: "Research investigator",
    openclaw_agent_id: "research-openclaw",
    default_skills: ["research-skill"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Content writer",
    openclaw_agent_id: "writer-openclaw",
    default_skills: ["writing-skill"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });

  const result = await generateDagDraft(
    {
      intent: "帮我做调研分析报告",
      inputs: { goal: "做调研分析报告" },
      max_agent_nodes: 1,
    },
    {
      providerId: "local_semantic_v1",
      preferredSubagentProfileIds: ["writer-agent"],
    },
  );
  assert.equal(result.planner_context.provider_id, "local_semantic_v1");
  assert.deepEqual(result.planner_context.preferred_subagent_profile_ids, ["writer-agent"]);
  assert.equal(result.registry_recommendations[0]?.agent_profile_id, "research-agent");
  assert.deepEqual(result.registry_recommendations[0]?.allowed_tools, ["read", "search"]);
  assert.deepEqual(result.draft_template.nodes[0]?.config?.allowed_tools, ["read", "search"]);
  assert.ok(result.registry_recommendations[0]?.evidence?.matched_domains?.includes("research"));
  assert.equal(result.registry_recommendations[0]?.evidence?.preferred_rank, null);

  clearProviderEnv();
});

test("local_semantic_v1 still uses a preferred subagent when it matches the intent domain", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedSkill({
    skill_id: "research-skill",
    name: "Research Skill",
    description: "Research investigation analysis report",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research"],
  });
  seedSkill({
    skill_id: "writing-skill",
    name: "Writing Skill",
    description: "Write article copy content",
    category: "content",
    allowed_tools: ["read", "write"],
    tags: ["content"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    description: "Research investigator",
    openclaw_agent_id: "research-openclaw",
    default_skills: ["research-skill"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Content writer",
    openclaw_agent_id: "writer-openclaw",
    default_skills: ["writing-skill"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });

  const result = await generateDagDraft(
    {
      intent: "Write article copy content for a newsletter",
      inputs: { goal: "Write article copy content for a newsletter" },
      max_agent_nodes: 1,
    },
    {
      providerId: "local_semantic_v1",
      preferredSubagentProfileIds: ["writer-agent"],
    },
  );
  assert.equal(result.planner_context.provider_id, "local_semantic_v1");
  assert.deepEqual(result.planner_context.preferred_subagent_profile_ids, ["writer-agent"]);
  assert.equal(result.registry_recommendations[0]?.agent_profile_id, "writer-agent");
  assert.deepEqual(result.registry_recommendations[0]?.allowed_tools, ["read", "write"]);
  assert.deepEqual(result.draft_template.nodes[0]?.config?.allowed_tools, ["read", "write"]);
  assert.equal(result.registry_recommendations[0]?.evidence?.preferred_rank, 0);

  clearProviderEnv();
});

test("local_semantic_v1 registry synthesis breaks same-domain ties with token fit and readiness", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedSkill({
    skill_id: "research-skill",
    name: "Research Skill",
    description: "Research analysis reporting",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research", "analysis"],
  });
  seedAgentProfile({
    profile_id: "research-generic",
    name: "Research Generic",
    description: "General research support",
    openclaw_agent_id: "",
    default_skills: ["research-skill"],
    allowed_tools: ["read"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "research-analyst",
    name: "Research Analyst",
    description: "Competitive analysis and reporting specialist",
    openclaw_agent_id: "research-analyst-openclaw",
    default_skills: ["research-skill"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });

  const result = await generateDagDraft({
    intent: "Need competitive analysis research report",
    inputs: { goal: "Competitive analysis research report" },
    max_agent_nodes: 1,
  });
  assert.equal(result.planner_context.provider_id, "local_semantic_v1");
  assert.equal(result.registry_recommendations[0]?.agent_profile_id, "research-analyst");
  assert.match(result.registry_recommendations[0]?.reason || "", /Token fit/);
  assert.ok((result.registry_recommendations[0]?.evidence?.domain_overlap_score || 0) > 0);
  assert.ok(result.registry_recommendations[0]?.evidence?.matched_domains?.includes("research"));

  clearProviderEnv();
});

test("local_semantic_v1 registry synthesis uses token-ranked skills within a matched domain", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedSkill({
    skill_id: "generic-research",
    name: "Generic Research",
    description: "Research summary work",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research"],
  });
  seedSkill({
    skill_id: "competitor-analysis",
    name: "Competitor Analysis",
    description: "Competitive analysis competitor benchmarking report",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research", "competitor", "analysis"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    description: "Research investigations and reporting",
    openclaw_agent_id: "research-openclaw",
    default_skills: ["generic-research"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });

  const result = await generateDagDraft({
    intent: "Need a competitor analysis report",
    inputs: { goal: "Competitor analysis report" },
    max_agent_nodes: 1,
  });
  assert.equal(result.planner_context.provider_id, "local_semantic_v1");
  assert.equal(result.registry_recommendations[0]?.agent_profile_id, "research-agent");
  assert.ok(
    result.registry_recommendations[0]?.skill_ids.includes("competitor-analysis"),
    `expected competitor-analysis in ${JSON.stringify(result.registry_recommendations[0]?.skill_ids)}`,
  );
  assert.ok(
    result.draft_template.nodes[0]?.allowed_skills.includes("competitor-analysis"),
    `expected competitor-analysis in node skills ${JSON.stringify(result.draft_template.nodes[0]?.allowed_skills)}`,
  );

  clearProviderEnv();
});

test("local_semantic_v1 registry synthesis penalizes disallowed overlap and warns on inactive defaults", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedSkill({
    skill_id: "backend-fix",
    name: "Backend Fix",
    description: "Backend bug fix repair",
    category: "coding",
    allowed_tools: ["read", "write"],
    tags: ["coding", "bug", "fix"],
  });
  seedSkill({
    skill_id: "code-review",
    name: "Code Review",
    description: "Backend bug review audit signoff",
    category: "coding",
    allowed_tools: ["read"],
    tags: ["coding", "review", "audit"],
  });
  seedAgentProfile({
    profile_id: "restricted-reviewer",
    name: "Restricted Reviewer",
    description: "Backend bug review specialist",
    openclaw_agent_id: "restricted-reviewer-openclaw",
    default_skills: ["backend-fix", "code-review", "missing-review-default"],
    disallowed_skills: ["code-review"],
    allowed_tools: ["read", "write"],
    policy_tags: ["coding"],
  });
  seedAgentProfile({
    profile_id: "backend-fixer",
    name: "Backend Fixer",
    description: "Backend bug fix specialist",
    openclaw_agent_id: "backend-fixer-openclaw",
    default_skills: ["backend-fix"],
    allowed_tools: ["read", "write"],
    policy_tags: ["coding"],
  });

  const result = await generateDagDraft({
    intent: "Need backend bug review",
    inputs: { goal: "Need backend bug review" },
    max_agent_nodes: 2,
  });
  assert.equal(result.planner_context.provider_id, "local_semantic_v1");
  assert.equal(result.registry_recommendations[0]?.agent_profile_id, "backend-fixer");
  const restricted = result.registry_recommendations.find(
    (recommendation) => recommendation.agent_profile_id === "restricted-reviewer",
  );
  assert.ok(restricted, "restricted reviewer recommendation expected");
  assert.ok((restricted?.evidence?.disallowed_penalty || 0) > 0);
  assert.ok((restricted?.evidence?.readiness_score || 0) < 1);
  assert.match(restricted?.reason || "", /Disallowed overlap penalty/i);
  assert.ok(
    restricted?.warnings.some((warning) => /disallowed skills/i.test(warning)),
    `expected disallowed warning in ${JSON.stringify(restricted?.warnings)}`,
  );
  assert.ok(
    restricted?.warnings.some((warning) => /disabled default skills/i.test(warning)),
    `expected inactive default skill warning in ${JSON.stringify(restricted?.warnings)}`,
  );

  clearProviderEnv();
});

test("local_semantic_v1 registry synthesis spreads multi-domain intents across distinct domain coverage", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedSkill({
    skill_id: "research-analysis",
    name: "Research Analysis",
    description: "Competitive research analysis reporting",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research", "analysis", "competitor"],
  });
  seedSkill({
    skill_id: "research-summary",
    name: "Research Summary",
    description: "Research summary report synthesis",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research", "summary"],
  });
  seedSkill({
    skill_id: "approval-review",
    name: "Approval Review",
    description: "Approval review audit signoff gate",
    category: "review",
    allowed_tools: ["read"],
    tags: ["review", "approval", "audit"],
  });
  seedAgentProfile({
    profile_id: "research-lead",
    name: "Research Lead",
    description: "Competitive analysis and research reporting specialist",
    openclaw_agent_id: "research-lead-openclaw",
    default_skills: ["research-analysis"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "research-support",
    name: "Research Support",
    description: "Research summary support specialist",
    openclaw_agent_id: "research-support-openclaw",
    default_skills: ["research-summary"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "review-approver",
    name: "Review Approver",
    description: "Approval review and audit signoff specialist",
    openclaw_agent_id: "review-approver-openclaw",
    default_skills: ["approval-review"],
    allowed_tools: ["read"],
    policy_tags: ["review"],
  });

  const result = await generateDagDraft({
    intent: "Need competitive research plus approval review signoff",
    inputs: { goal: "Need competitive research plus approval review signoff" },
    max_agent_nodes: 2,
  });
  assert.equal(result.planner_context.provider_id, "local_semantic_v1");
  assert.equal(result.registry_recommendations.length, 2);
  assert.equal(result.registry_recommendations[0]?.agent_profile_id, "review-approver");
  assert.equal(result.registry_recommendations[1]?.agent_profile_id, "research-lead");
  assert.ok(hasDraftEdge(result, result.registry_recommendations[1]?.node_id, result.registry_recommendations[0]?.node_id));
  assert.ok(hasDraftEdge(result, result.registry_recommendations[0]?.node_id, "node_end"));
  assert.deepEqual(result.registry_recommendations[0]?.skill_ids, ["approval-review"]);
  assert.ok(
    !result.registry_recommendations[0]?.skill_ids.includes("research-analysis"),
    `review recommendation should not borrow research skills: ${JSON.stringify(result.registry_recommendations[0]?.skill_ids)}`,
  );
  assert.deepEqual(result.registry_recommendations[1]?.skill_ids, ["research-analysis", "research-summary"]);
  assert.ok(
    !result.registry_recommendations[1]?.skill_ids.includes("approval-review"),
    `research recommendation should not borrow review skills: ${JSON.stringify(result.registry_recommendations[1]?.skill_ids)}`,
  );
  assert.deepEqual(result.registry_recommendations[1]?.evidence?.coverage_domains, ["research"]);
  assert.match(
    result.registry_recommendations[1]?.reason || "",
    /Selected to cover remaining domain\(s\): Research and analysis/i,
  );

  clearProviderEnv();
});

test("local_semantic_v1 registry synthesis orders research before content in the DAG", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
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
    openclaw_agent_id: "research-openclaw",
    default_skills: ["research-analysis"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Article content writer",
    openclaw_agent_id: "writer-openclaw",
    default_skills: ["article-writing"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });

  const result = await generateDagDraft({
    intent: "Need research analysis and write article content",
    inputs: { goal: "Need research analysis and write article content" },
    max_agent_nodes: 2,
  });
  const research = result.registry_recommendations.find((item) => item.agent_profile_id === "research-agent");
  const writer = result.registry_recommendations.find((item) => item.agent_profile_id === "writer-agent");
  assert.equal(result.planner_context.provider_id, "local_semantic_v1");
  assert.ok(research, "research recommendation expected");
  assert.ok(writer, "writer recommendation expected");
  assert.ok(hasDraftEdge(result, research?.node_id, writer?.node_id));
  assert.ok(hasDraftEdge(result, writer?.node_id, "node_end"));
  assert.equal(result.draft_template.metadata?.planner_dag_shape, "domain_ordered");

  clearProviderEnv();
});

test("local_semantic_v1 registry synthesis keeps peer execution domains parallel", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedSkill({
    skill_id: "backend-fix",
    name: "Backend Fix",
    description: "Backend bug fix coding",
    category: "coding",
    allowed_tools: ["read", "write"],
    tags: ["coding", "bug", "fix"],
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
    profile_id: "backend-agent",
    name: "Backend Agent",
    description: "Backend bug fix specialist",
    openclaw_agent_id: "backend-openclaw",
    default_skills: ["backend-fix"],
    allowed_tools: ["read", "write"],
    policy_tags: ["coding"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Article content writer",
    openclaw_agent_id: "writer-openclaw",
    default_skills: ["article-writing"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });

  const result = await generateDagDraft({
    intent: "Need backend bug fix and article content draft",
    inputs: { goal: "Need backend bug fix and article content draft" },
    max_agent_nodes: 2,
  });
  const backend = result.registry_recommendations.find((item) => item.agent_profile_id === "backend-agent");
  const writer = result.registry_recommendations.find((item) => item.agent_profile_id === "writer-agent");
  assert.ok(backend, "backend recommendation expected");
  assert.ok(writer, "writer recommendation expected");
  assert.ok(hasDraftEdge(result, backend?.node_id, "node_end"));
  assert.ok(hasDraftEdge(result, writer?.node_id, "node_end"));
  assert.ok(!hasDraftEdge(result, backend?.node_id, writer?.node_id));
  assert.ok(!hasDraftEdge(result, writer?.node_id, backend?.node_id));

  clearProviderEnv();
});

test("local_semantic_v1 registry synthesis adds an explicit review gate when policy requires review", async () => {
  resetTestRoot();
  setProviderEnv("local_semantic_v1");
  seedSkill({
    skill_id: "article-writing",
    name: "Article Writing",
    description: "Write article content copy",
    category: "content",
    allowed_tools: ["read", "write"],
    tags: ["content", "write"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Article content writer",
    openclaw_agent_id: "writer-openclaw",
    default_skills: ["article-writing"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });

  const result = await generateDagDraft(
    {
      intent: "Write article content",
      inputs: { goal: "Write article content" },
      max_agent_nodes: 1,
    },
    {
      providerId: "local_semantic_v1",
      requireReview: true,
    },
  );
  const task = result.registry_recommendations[0];
  const reviewGate = result.draft_template.nodes.find((node) => node.id === "node_review_gate");
  assert.equal(result.planner_context.require_review, true);
  assert.equal(result.draft_template.metadata?.planner_require_review, true);
  assert.equal(result.draft_template.metadata?.planner_dag_shape, "domain_ordered_with_review_gate");
  assert.equal(reviewGate?.type, "approval");
  assert.equal(reviewGate?.approval_kind, "human_review");
  assert.ok(hasDraftEdge(result, task?.node_id, "node_review_gate"));
  assert.ok(hasDraftEdge(result, "node_review_gate", "node_end"));
  assert.equal(result.validation.passed, true);

  clearProviderEnv();
});

test("rule_based dag draft uses policy fallback max_agent_nodes and require_review", async () => {
  resetTestRoot();
  clearProviderEnv();
  seedSkill({
    skill_id: "research-skill",
    name: "Research Skill",
    description: "Research investigation analysis",
    category: "research",
    allowed_tools: ["read", "search"],
    tags: ["research"],
  });
  seedSkill({
    skill_id: "writing-skill",
    name: "Writing Skill",
    description: "Draft write content",
    category: "content",
    allowed_tools: ["read", "write"],
    tags: ["content"],
  });
  seedAgentProfile({
    profile_id: "research-agent",
    name: "Research Agent",
    description: "Investigate and analyze",
    openclaw_agent_id: "research-openclaw",
    default_skills: ["research-skill"],
    allowed_tools: ["read", "search"],
    policy_tags: ["research"],
  });
  seedAgentProfile({
    profile_id: "writer-agent",
    name: "Writer Agent",
    description: "Draft content and summaries",
    openclaw_agent_id: "writer-openclaw",
    default_skills: ["writing-skill"],
    allowed_tools: ["read", "write"],
    policy_tags: ["content"],
  });

  const result = await generateDagDraft(
    {
      intent: "Do something abstract without published templates",
      inputs: { goal: "Abstract goal" },
    },
    {
      defaultMaxAgentNodes: 2,
      requireReview: true,
    },
  );
  assert.equal(result.planner_context.provider_id, "rule_based_v1");
  assert.equal(result.planner_context.default_max_agent_nodes, 2);
  assert.equal(result.planner_context.require_review, true);
  assert.equal(result.registry_recommendations.length, 2);
  assert.equal(result.draft_template.nodes.length, 3);
  assert.equal(result.draft_template.metadata?.planner_require_review, true);
});

test("local_semantic_v1 can disable domain rerank via preferDomainMatch false", async () => {
  resetTestRoot();
  clearProviderEnv();
  seedRegistry();
  seedCodingTemplate();
  seedContentTemplate();
  const ruleResult = await recommendTemplate("鍐欎竴绡囧皬绾功鏂囨");

  const result = await recommendTemplate(
    "甯垜鍐欎竴绡囧皬绾功鏂囨锛岄厤涓€寮犳捣鎶?",
    {
      providerId: "local_semantic_v1",
      preferDomainMatch: false,
    },
  );
  assert.ok(result, "recommendation expected");
  assert.ok(ruleResult, "rule-based recommendation expected");
  assert.equal(result?.planner_context.provider_id, "local_semantic_v1");
  assert.equal(result?.planner_context.prefer_domain_match, false);
  assert.equal(result?.selected_template.template_id, ruleResult?.selected_template.template_id);
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
