import { compileRunPlan } from "../run-plan-compiler.js";
import { listAgentProfiles, listSkills } from "../registry-store.js";
import { getTemplate, listTemplates } from "../template-store.js";
import type {
  AgentProfileRecord,
  PlannerCandidatePlanRequest,
  PlannerCandidatePlanResponse,
  PlannerDagDraftRequest,
  PlannerDagDraftResponse,
  PlannerRegistryRecommendation,
  PlannerTemplateCandidate,
  PlannerTemplateSelectionResponse,
  SkillRecord,
  WorkflowTemplateRecord,
} from "../types.js";
import { isPlainObject, nowIso } from "../utils.js";
import type { PlannerProvider } from "./provider.js";
import {
  collectRegistryValidation,
  ruleBasedGenerateDagDraftSync,
  ruleBasedGenerateCandidatePlanSync,
  ruleBasedRecommendTemplateSync,
  ruleBasedScoreTemplate,
  ruleBasedTokenizeIntent,
  validateRunRequestForTemplate,
} from "./rule-based.js";
import { registerPlannerProvider } from "./registry.js";

const PROVIDER_ID = "local_semantic_v1";

interface DomainDefinition {
  id: string;
  label: string;
  cues: string[];
}

const DOMAINS: DomainDefinition[] = [
  {
    id: "coding",
    label: "Software engineering",
    cues: [
      "code", "coding", "bug", "fix", "refactor", "merge", "pr", "review",
      "backend", "frontend", "api", "schema", "test", "unit", "integration",
      "deploy", "release", "build", "compile", "typescript", "python",
      "代码", "编码", "实现", "修复", "重构", "测试", "联调", "上线", "部署", "构建",
      "接口", "后端", "前端", "数据库", "脚本",
    ],
  },
  {
    id: "research",
    label: "Research and analysis",
    cues: [
      "research", "investigate", "analyze", "analysis", "insight", "summary",
      "summarize", "report", "compare", "comparison", "competitor",
      "调研", "研究", "分析", "对比", "竞品", "总结", "汇总", "报告", "洞察",
      "市场", "现状",
    ],
  },
  {
    id: "content",
    label: "Content and creative",
    cues: [
      "write", "draft", "copy", "post", "blog", "article", "tweet", "newsletter",
      "image", "poster", "design", "creative", "translate", "translation",
      "文案", "稿件", "稿子", "推文", "种草", "小红书", "公众号", "海报", "设计",
      "图片", "图像", "翻译", "改写", "润色", "排版",
    ],
  },
  {
    id: "ops",
    label: "Operations and automation",
    cues: [
      "monitor", "alert", "metric", "incident", "rotate", "backup", "schedule",
      "cron", "deploy", "rollout", "rollback",
      "监控", "告警", "排查", "运维", "巡检", "备份", "回滚", "调度", "定时",
    ],
  },
  {
    id: "customer",
    label: "Customer and follow-up",
    cues: [
      "follow", "followup", "customer", "lead", "client", "ticket", "support",
      "outreach", "campaign", "crm",
      "客户", "跟进", "回访", "线索", "工单", "售后", "外联", "客服",
    ],
  },
  {
    id: "review",
    label: "Approval and review",
    cues: [
      "approve", "approval", "review", "audit", "checkpoint", "sign-off", "gate",
      "审批", "审核", "审查", "复核", "把关", "卡点", "确认",
    ],
  },
];

const DOMAIN_INDEX: Map<string, string[]> = new Map();
for (const domain of DOMAINS) {
  for (const cue of domain.cues) {
    const list = DOMAIN_INDEX.get(cue) || [];
    list.push(domain.id);
    DOMAIN_INDEX.set(cue, list);
  }
}

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function detectDomains(text: string): Map<string, number> {
  const hits = new Map<string, number>();
  if (!text) {
    return hits;
  }
  const haystack = text.toLowerCase();
  for (const [cue, domainIds] of DOMAIN_INDEX) {
    if (!cue || !haystack.includes(cue)) {
      continue;
    }
    for (const domainId of domainIds) {
      hits.set(domainId, (hits.get(domainId) || 0) + 1);
    }
  }
  return hits;
}

function templateMetadataDomains(template: WorkflowTemplateRecord): string[] {
  const raw = (template.metadata || {}).domain;
  if (typeof raw !== "string") {
    return [];
  }
  const claimed = raw.toLowerCase().trim();
  if (!claimed) {
    return [];
  }
  // Only honor a metadata.domain value that maps to one of our known domains.
  // Free-form values like "demo" or "acceptance" should not be treated as a
  // signal — those templates fall through to the textual cue scan instead.
  return DOMAINS.some((d) => d.id === claimed) ? [claimed] : [];
}

function templateText(template: WorkflowTemplateRecord): string {
  const metadataParts: string[] = [];
  for (const [key, value] of Object.entries(template.metadata || {})) {
    metadataParts.push(key);
    if (typeof value === "string") {
      metadataParts.push(value);
    }
    if (Array.isArray(value)) {
      metadataParts.push(...value.filter((item): item is string => typeof item === "string"));
    }
  }
  const nodeParts = template.nodes.flatMap((node) => [
    node.id,
    node.name,
    node.type,
    node.agent_profile || "",
    ...node.allowed_skills,
  ]);
  return [
    template.template_id,
    template.name,
    template.description,
    template.workspace_scope,
    ...metadataParts,
    ...nodeParts,
  ]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ");
}

function profileText(profile: AgentProfileRecord): string {
  return [
    profile.profile_id,
    profile.name,
    profile.description,
    profile.openclaw_agent_id,
    ...profile.default_skills,
    ...profile.allowed_tools,
    ...profile.policy_tags,
    ...Object.values(profile.metadata || {})
      .filter((value): value is string => typeof value === "string"),
  ]
    .filter((part) => part)
    .join(" ");
}

function skillText(skill: SkillRecord): string {
  return [
    skill.skill_id,
    skill.name,
    skill.description,
    skill.category,
    ...skill.allowed_tools,
    ...skill.tags,
  ]
    .filter((part) => part)
    .join(" ");
}

function domainOverlap(intentDomains: Map<string, number>, candidateDomains: Map<string, number>):
  { overlap: number; matched: string[] } {
  if (intentDomains.size === 0 || candidateDomains.size === 0) {
    return { overlap: 0, matched: [] };
  }
  const matched: string[] = [];
  for (const domainId of intentDomains.keys()) {
    if (candidateDomains.has(domainId)) {
      matched.push(domainId);
    }
  }
  if (matched.length === 0) {
    return { overlap: 0, matched };
  }
  // Jaccard-style: penalize candidates whose domain set is much wider than the
  // intent (e.g. the generic "phone collab demo" that hits writer/review/research
  // at once). Otherwise a multi-domain catch-all template would shadow a
  // tightly-focused one for every intent.
  const union = new Set<string>();
  intentDomains.forEach((_v, k) => union.add(k));
  candidateDomains.forEach((_v, k) => union.add(k));
  return { overlap: matched.length / union.size, matched };
}

function blendScores(ruleScore: number, domainBoost: number): number {
  return Number(Math.min(1, ruleScore * 0.7 + domainBoost * 0.3).toFixed(4));
}

function isPublishedTemplate(template: WorkflowTemplateRecord): boolean {
  return template.status === "published";
}

function recommendTemplate(intent: string): PlannerTemplateSelectionResponse | null {
  const ruleResult = ruleBasedRecommendTemplateSync(intent);
  if (!ruleResult) {
    return null;
  }
  const intentDomains = detectDomains(lower(intent));
  if (intentDomains.size === 0) {
    return ruleResult;
  }

  // Score every published template ourselves so domain rerank is not limited
  // to the rule-based top-5 (which can drop a domain-aligned template before
  // it ever reaches the rerank step).
  const publishedTemplates = listTemplates().filter((t) => t.status === "published");
  const intentTokens = ruleBasedTokenizeIntent(intent);
  const reranked: PlannerTemplateCandidate[] = publishedTemplates.map((template) => {
    const baseCandidate = ruleBasedScoreTemplate(template, intentTokens);
    const claimed = templateMetadataDomains(template);
    // If the template explicitly claims a known domain in metadata, trust that
    // alone — it prevents schema field names like `approval_policy` or node
    // profile ids from leaking spurious domain hits via templateText scan.
    const candidateDomains = claimed.length > 0
      ? new Map(claimed.map((id) => [id, 1] as const))
      : detectDomains(templateText(template).toLowerCase());
    const { overlap, matched } = domainOverlap(intentDomains, candidateDomains);
    if (overlap === 0) {
      return baseCandidate;
    }
    // Templates that explicitly self-declare one of the matched domains in
    // metadata get a small authority bonus over peers that only inherit a
    // domain hit through textual cue scanning. This breaks ties cleanly when
    // a generic demo template happens to surface the same cue word. The
    // bonus is added after blending so it survives even when overlap is
    // already saturated at 1.0 (Jaccard with a single matched domain).
    const claimedHit = claimed.some((id) => matched.includes(id));
    const blended = blendScores(baseCandidate.score, overlap);
    const score = claimedHit
      ? Number(Math.min(1, blended + 0.03).toFixed(4))
      : blended;
    const matchedLabels = matched
      .map((id) => DOMAINS.find((d) => d.id === id)?.label || id)
      .join(", ");
    return {
      ...baseCandidate,
      score,
      reason: `${baseCandidate.reason} Domain match: ${matchedLabels}.`,
    };
  });

  reranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.template_id.localeCompare(b.template_id);
  });

  // Match the public planner contract by capping the candidate list size.
  const trimmed = reranked.slice(0, 5);
  const selected = trimmed[0];
  if (!selected) {
    return ruleResult;
  }

  return {
    selected_template: selected,
    candidates: trimmed,
    planner_context: {
      ...ruleResult.planner_context,
      planner_model: PROVIDER_ID,
      intent_domains: [...intentDomains.keys()],
    } as PlannerTemplateSelectionResponse["planner_context"],
  };
}

function generateRegistryRecommendations(
  intent: string,
  maxAgentNodes: number,
): PlannerRegistryRecommendation[] {
  const intentDomains = detectDomains(lower(intent));
  const activeProfiles = listAgentProfiles("active");
  const activeSkills = listSkills("active");
  if (activeProfiles.length === 0 || intentDomains.size === 0) {
    return [];
  }

  const scored = activeProfiles
    .map((profile) => {
      const profileDomains = detectDomains(profileText(profile).toLowerCase());
      const { overlap, matched } = domainOverlap(intentDomains, profileDomains);
      return { profile, overlap, matched };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => {
      if (b.overlap !== a.overlap) {
        return b.overlap - a.overlap;
      }
      return a.profile.profile_id.localeCompare(b.profile.profile_id);
    })
    .slice(0, Math.max(1, maxAgentNodes));

  if (scored.length === 0) {
    return [];
  }

  return scored.map(({ profile, overlap, matched }, index) => {
    const matchedDomains = matched
      .map((id) => DOMAINS.find((d) => d.id === id)?.label || id)
      .join(", ");
    const skillsByDomain = activeSkills
      .map((skill) => {
        const skillDomains = detectDomains(skillText(skill).toLowerCase());
        const { overlap: skillOverlap } = domainOverlap(intentDomains, skillDomains);
        return { skill, skillOverlap };
      })
      .filter(({ skillOverlap }) => skillOverlap > 0)
      .sort((a, b) => {
        if (b.skillOverlap !== a.skillOverlap) {
          return b.skillOverlap - a.skillOverlap;
        }
        return a.skill.skill_id.localeCompare(b.skill.skill_id);
      })
      .slice(0, 3)
      .map(({ skill }) => skill.skill_id);
    const defaultSkills = profile.default_skills.filter((skillId) =>
      activeSkills.some((skill) => skill.skill_id === skillId),
    );
    const skillIds = [...new Set([...defaultSkills, ...skillsByDomain])];
    const warnings: string[] = [];
    if (!profile.openclaw_agent_id.trim()) {
      warnings.push(`Agent profile ${profile.profile_id} has no OpenClaw agent id.`);
    }
    if (skillIds.length === 0) {
      warnings.push(`Agent profile ${profile.profile_id} has no domain-aligned skill.`);
    }
    return {
      node_id: `node_task_${index + 1}`,
      node_name: scored.length === 1 ? "Execute Task" : `Execute Task ${index + 1}`,
      agent_profile_id: profile.profile_id,
      agent_profile_name: profile.name,
      openclaw_agent_id: profile.openclaw_agent_id || null,
      skill_ids: skillIds,
      score: Number(overlap.toFixed(4)),
      reason: `Matched intent domain(s): ${matchedDomains}.`,
      warnings,
    };
  });
}

function generateDagDraft(request: PlannerDagDraftRequest): PlannerDagDraftResponse {
  const intent = request.intent.trim();
  const intentDomains = detectDomains(lower(intent));
  const ruleResult = ruleBasedGenerateDagDraftSync(request);

  if (intentDomains.size === 0) {
    return ruleResult;
  }

  // If the rule-based planner picked a template variant, only re-rank its
  // template recommendation to reflect domain match. The compiled draft
  // is left untouched so existing behavior is preserved.
  if (ruleResult.template_recommendation) {
    const reranked = recommendTemplate(intent);
    return {
      ...ruleResult,
      template_recommendation: reranked || ruleResult.template_recommendation,
      planner_context: {
        ...ruleResult.planner_context,
        planner_model: PROVIDER_ID,
        intent_domains: [...intentDomains.keys()],
      } as PlannerDagDraftResponse["planner_context"],
    };
  }

  // Registry-synthesis path: try to swap the registry recommendations for
  // domain-aligned ones when we can find any.
  const synthesizedRecommendations = generateRegistryRecommendations(
    intent,
    typeof request.max_agent_nodes === "number" && request.max_agent_nodes > 0
      ? request.max_agent_nodes
      : ruleResult.registry_recommendations.length || 1,
  );

  if (synthesizedRecommendations.length === 0) {
    return ruleResult;
  }

  // Replace the registry_recommendations and rebuild the draft template
  // to keep the compiled DAG aligned with the new agent picks.
  const inputs = isPlainObject(request.inputs) ? request.inputs : {};
  const draftTemplate = ruleResult.draft_template;
  const newNodes = synthesizedRecommendations.map((recommendation, index) => ({
    id: recommendation.node_id,
    name: recommendation.node_name,
    type: "agent_task" as const,
    agent_profile: recommendation.agent_profile_id,
    allowed_skills: recommendation.skill_ids,
    config: {
      allowed_tools: ["read", "write", "shell"],
      output_contract: {
        expected_artifacts: [`task-${index + 1}-report`],
      },
      planner_recommendation: {
        score: recommendation.score,
        reason: recommendation.reason,
      },
    },
    retry_policy: { max_attempts: 1, backoff_seconds: 5 },
    timeout_seconds: 900,
    parallelism: 1,
    approval_kind: null,
    human_input_schema: null,
  }));
  const endNode = {
    id: "node_end",
    name: "End",
    type: "end",
    agent_profile: null,
    allowed_skills: [],
    config: {},
    retry_policy: { max_attempts: 0, backoff_seconds: 0 },
    timeout_seconds: 60,
    parallelism: 1,
    approval_kind: null,
    human_input_schema: null,
  };
  const newEdges = newNodes.map((node) => ({
    from: node.id,
    to: endNode.id,
    condition: null,
    label: null,
  }));
  const agentProfileBindings: Record<string, string> = {};
  for (const recommendation of synthesizedRecommendations) {
    if (recommendation.agent_profile_id && recommendation.openclaw_agent_id) {
      agentProfileBindings[recommendation.agent_profile_id] = recommendation.openclaw_agent_id;
    }
  }

  const updatedDraft = {
    ...draftTemplate,
    name: draftTemplate.name,
    description: `Domain-aware planner draft for: ${intent}`,
    nodes: [...newNodes, endNode],
    edges: newEdges,
    agent_profile_bindings: agentProfileBindings,
    metadata: {
      ...(draftTemplate.metadata || {}),
      planner_strategy: "domain_aligned_synthesis",
      planner_intent_domains: [...intentDomains.keys()],
      planner_human_confirmation_required: true,
    },
  };

  const syntheticTemplate: WorkflowTemplateRecord = {
    template_id: updatedDraft.template_id,
    version: 1,
    name: updatedDraft.name,
    status: "draft",
    description: updatedDraft.description,
    workspace_scope: updatedDraft.workspace_scope || "default",
    input_schema: updatedDraft.input_schema,
    policy: updatedDraft.policy,
    agent_profile_bindings: updatedDraft.agent_profile_bindings || {},
    nodes: updatedDraft.nodes,
    edges: updatedDraft.edges,
    metadata: updatedDraft.metadata || {},
    created_at: nowIso(),
    updated_at: nowIso(),
    published_at: null,
  };

  const validation = validateRunRequestForTemplate(
    {
      intent,
      template_id: syntheticTemplate.template_id,
      inputs,
    },
    syntheticTemplate,
  );

  return {
    draft_template: updatedDraft,
    template_recommendation: null,
    registry_recommendations: synthesizedRecommendations,
    validation,
    planner_context: {
      ...ruleResult.planner_context,
      planner_model: PROVIDER_ID,
      intent_domains: [...intentDomains.keys()],
      draft_strategy: "registry_synthesis",
      source_template_id: null,
      human_confirmation_required: true,
    } as PlannerDagDraftResponse["planner_context"],
  };
}

function generateCandidatePlan(
  request: PlannerCandidatePlanRequest,
): PlannerCandidatePlanResponse {
  // Candidate plan compilation is deterministic and template-bound; the
  // semantic provider does not change it. We only annotate planner_context.
  const ruleResult = ruleBasedGenerateCandidatePlanSync(request);
  const intentDomains = detectDomains(lower(request.intent));
  if (intentDomains.size === 0) {
    return ruleResult;
  }
  const planContext = isPlainObject(ruleResult.candidate_plan.planner_context)
    ? { ...ruleResult.candidate_plan.planner_context }
    : {};
  planContext.planner_model = PROVIDER_ID;
  planContext.intent_domains = [...intentDomains.keys()];
  return {
    ...ruleResult,
    candidate_plan: {
      ...ruleResult.candidate_plan,
      planner_context: planContext,
    },
  };
}

export const localSemanticPlannerProvider: PlannerProvider = {
  id: PROVIDER_ID,
  displayName: "Local semantic planner v1",
  async recommendTemplate(intent: string) {
    return recommendTemplate(intent);
  },
  async generateDagDraft(request) {
    return generateDagDraft(request);
  },
  async generateCandidatePlan(request) {
    return generateCandidatePlan(request);
  },
};

registerPlannerProvider(localSemanticPlannerProvider);

// Reference unused imports so linters/strict tsconfig are happy if they appear unused.
void compileRunPlan;
void getTemplate;
void collectRegistryValidation;
