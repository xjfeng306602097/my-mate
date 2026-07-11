import { compileRunPlan } from "../run-plan-compiler.js";
import { listAgentProfiles, listSkills } from "../registry-store.js";
import { getTemplate, listTemplates } from "../template-store.js";
import type {
  CreateTemplateRequest,
  AgentProfileRecord,
  PlannerCandidatePlanRequest,
  PlannerCandidatePlanResponse,
  PlannerDagDraftRequest,
  PlannerDagDraftResponse,
  PlannerRegistryRecommendation,
  PlannerTemplateCandidate,
  PlannerTemplateSelectionResponse,
  SkillRecord,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTemplateRecord,
} from "../types.js";
import { isPlainObject, nowIso, slugify } from "../utils.js";
import type { PlannerInvocationOptions, PlannerProvider } from "./provider.js";
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.trim()).map((item) => item.trim()))];
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function overlapScore(targetTokens: string[], candidateTokens: string[]): number {
  if (targetTokens.length === 0) {
    return 0;
  }
  const candidateSet = new Set(candidateTokens);
  const matched = targetTokens.filter((token) => candidateSet.has(token));
  return matched.length / targetTokens.length;
}

function stringAndSlugSet(values: string[]): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    result.add(trimmed);
    const slug = slugify(trimmed);
    if (slug) {
      result.add(slug);
    }
  }
  return result;
}

function domainMapFromIds(domainIds: string[]): Map<string, number> {
  return new Map(domainIds.map((domainId) => [domainId, 1] as const));
}

function buildPreferredProfileRankMap(preferredProfileIds: string[] = []): Map<string, number> {
  const result = new Map<string, number>();
  preferredProfileIds.forEach((value, index) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (!result.has(trimmed)) {
      result.set(trimmed, index);
    }
    const slug = slugify(trimmed);
    if (slug && !result.has(slug)) {
      result.set(slug, index);
    }
  });
  return result;
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
    getRuntimeAgentRef(profile),
    ...profile.default_skills,
    ...profile.allowed_tools,
    ...profile.policy_tags,
    ...Object.values(profile.metadata || {})
      .filter((value): value is string => typeof value === "string"),
  ]
    .filter((part) => part)
    .join(" ");
}

function getRuntimeAgentRef(profile: AgentProfileRecord): string {
  return (profile.runtime_agent_ref || profile.openclaw_agent_id || "").trim();
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

interface SkillSemanticScore {
  skill: SkillRecord;
  domainScore: number;
  tokenScore: number;
  combinedScore: number;
}

function scoreSkillForIntent(
  skill: SkillRecord,
  intentDomains: Map<string, number>,
  intentTokens: string[],
): SkillSemanticScore {
  const skillDomains = detectDomains(skillText(skill).toLowerCase());
  const { overlap: domainScore } = domainOverlap(intentDomains, skillDomains);
  const tokenScore = overlapScore(intentTokens, ruleBasedTokenizeIntent(skillText(skill)));
  const combinedScore = Number((domainScore * 0.65 + tokenScore * 0.35).toFixed(4));
  return {
    skill,
    domainScore,
    tokenScore,
    combinedScore,
  };
}

interface ProfileSemanticScore {
  profile: AgentProfileRecord;
  overlap: number;
  matched: string[];
  profileTokenScore: number;
  defaultSkillMaxScore: number;
  defaultSkillMeanScore: number;
  combinedSkillScore: number;
  readinessScore: number;
  defaultSkillHealth: number;
  disallowedHitCount: number;
  disallowedPenalty: number;
  openclawReady: boolean;
  preferredRank: number | null;
  score: number;
}

interface SelectedProfileSemanticScore {
  entry: ProfileSemanticScore;
  coverageDomains: string[];
}

interface RegistryDagNode {
  node: WorkflowNode;
  phase: number;
  domains: string[];
  recommendationIndex: number;
}

function scoreProfileForIntent(
  profile: AgentProfileRecord,
  intentDomains: Map<string, number>,
  intentTokens: string[],
  activeSkillMap: Map<string, SkillRecord>,
  preferredRanks: Map<string, number>,
): ProfileSemanticScore {
  const profileDomains = detectDomains(profileText(profile).toLowerCase());
  const { overlap, matched } = domainOverlap(intentDomains, profileDomains);
  const profileTokenScore = overlapScore(intentTokens, ruleBasedTokenizeIntent(profileText(profile)));
  const disallowedSet = stringAndSlugSet(profile.disallowed_skills);
  const defaultSkillEntries = profile.default_skills.map((skillId) => ({
    skillId,
    skill: activeSkillMap.get(skillId) || activeSkillMap.get(slugify(skillId)) || null,
  }));
  const eligibleDefaultSkills = defaultSkillEntries
    .filter((entry): entry is { skillId: string; skill: SkillRecord } => Boolean(entry.skill))
    .filter(
      ({ skillId, skill }) =>
        !disallowedSet.has(skillId) &&
        !disallowedSet.has(slugify(skillId)) &&
        !disallowedSet.has(skill.skill_id) &&
        !disallowedSet.has(slugify(skill.skill_id)),
    )
    .map((entry) => entry.skill);
  const defaultSkillScores = eligibleDefaultSkills.map(
    (skill) => scoreSkillForIntent(skill, intentDomains, intentTokens).combinedScore,
  );
  const defaultSkillMaxScore = defaultSkillScores.length > 0 ? Math.max(...defaultSkillScores) : 0;
  const defaultSkillMeanScore = mean(defaultSkillScores);
  const combinedSkillScore = defaultSkillMaxScore * 0.7 + defaultSkillMeanScore * 0.3;
  const disallowedMatchedSkillScores = defaultSkillEntries
    .filter((entry): entry is { skillId: string; skill: SkillRecord } => Boolean(entry.skill))
    .filter(
      ({ skillId, skill }) =>
        disallowedSet.has(skillId) ||
        disallowedSet.has(slugify(skillId)) ||
        disallowedSet.has(skill.skill_id) ||
        disallowedSet.has(slugify(skill.skill_id)),
    )
    .map((entry) => scoreSkillForIntent(entry.skill, intentDomains, intentTokens).combinedScore)
    .filter((score) => score > 0);
  const disallowedTokenHits = profile.disallowed_skills
    .map((value) => overlapScore(intentTokens, ruleBasedTokenizeIntent(value)))
    .filter((score) => score > 0);
  const defaultSkillHealth =
    profile.default_skills.length === 0 ? 1 : eligibleDefaultSkills.length / profile.default_skills.length;
  const disallowedHitCount = disallowedMatchedSkillScores.length + disallowedTokenHits.length;
  const disallowedSignal = Math.max(0, ...disallowedMatchedSkillScores, ...disallowedTokenHits);
  const disallowedPenalty = Number(
    Math.min(0.35, disallowedSignal * 0.3 + (disallowedHitCount > 0 ? 0.05 : 0)).toFixed(4),
  );
  const openclawReady = getRuntimeAgentRef(profile).length > 0;
  const readinessScore = (openclawReady ? 0.6 : 0) + defaultSkillHealth * 0.4;
  const preferredRank = preferredRanks.get(profile.profile_id) ?? preferredRanks.get(slugify(profile.profile_id)) ?? null;
  const score = Number(
    Math.max(
      0,
      Math.min(1, overlap * 0.55 + profileTokenScore * 0.2 + combinedSkillScore * 0.15 + readinessScore * 0.1 - disallowedPenalty),
    ).toFixed(4),
  );

  return {
    profile,
    overlap,
    matched,
    profileTokenScore,
    defaultSkillMaxScore,
    defaultSkillMeanScore,
    combinedSkillScore,
    readinessScore,
    defaultSkillHealth,
    disallowedHitCount,
    disallowedPenalty: Number(disallowedPenalty.toFixed(4)),
    openclawReady,
    preferredRank,
    score,
  };
}

function compareProfileSemanticScore(a: ProfileSemanticScore, b: ProfileSemanticScore): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (b.overlap !== a.overlap) {
    return b.overlap - a.overlap;
  }
  if (b.readinessScore !== a.readinessScore) {
    return b.readinessScore - a.readinessScore;
  }
  if (a.disallowedPenalty !== b.disallowedPenalty) {
    return a.disallowedPenalty - b.disallowedPenalty;
  }
  if (b.profileTokenScore !== a.profileTokenScore) {
    return b.profileTokenScore - a.profileTokenScore;
  }
  return a.profile.profile_id.localeCompare(b.profile.profile_id);
}

function compareCoverageGain(
  a: ProfileSemanticScore,
  b: ProfileSemanticScore,
  coveredDomains: Set<string>,
): number {
  const aGain = a.matched.filter((domainId) => !coveredDomains.has(domainId)).length;
  const bGain = b.matched.filter((domainId) => !coveredDomains.has(domainId)).length;
  if (bGain !== aGain) {
    return bGain - aGain;
  }
  return compareProfileSemanticScore(a, b);
}

function selectProfilesForRegistrySynthesis(
  scored: ProfileSemanticScore[],
  intentDomains: Map<string, number>,
  maxAgentNodes: number,
): SelectedProfileSemanticScore[] {
  const selected: SelectedProfileSemanticScore[] = [];
  const selectedProfileIds = new Set<string>();
  const coveredDomains = new Set<string>();
  const desiredCount = Math.max(1, maxAgentNodes);

  const selectEntry = (entry: ProfileSemanticScore) => {
    if (selectedProfileIds.has(entry.profile.profile_id)) {
      return;
    }
    const coverageDomains = entry.matched.filter((domainId) => !coveredDomains.has(domainId));
    selected.push({
      entry,
      coverageDomains,
    });
    selectedProfileIds.add(entry.profile.profile_id);
    for (const domainId of coverageDomains) {
      coveredDomains.add(domainId);
    }
  };

  const preferredSelected = [...scored]
    .filter((entry) => entry.preferredRank !== null)
    .sort((a, b) => {
      const rankDiff = (a.preferredRank ?? Number.MAX_SAFE_INTEGER) - (b.preferredRank ?? Number.MAX_SAFE_INTEGER);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return compareProfileSemanticScore(a, b);
    });

  const remaining = scored.slice();
  if (selected.length === 0 && remaining.length > 0) {
    const preferredDomainMatch = preferredSelected.find((entry) => entry.overlap > 0);
    const firstPick = preferredDomainMatch || remaining.find((entry) => entry.overlap > 0) || remaining[0];
    const firstPickIndex = remaining.findIndex((entry) => entry.profile.profile_id === firstPick?.profile.profile_id);
    const [topScoring] = firstPickIndex >= 0 ? remaining.splice(firstPickIndex, 1) : [];
    if (topScoring) {
      selectEntry(topScoring);
    }
  }
  while (selected.length < desiredCount && remaining.length > 0) {
    const uncoveredDomains = [...intentDomains.keys()].filter((domainId) => !coveredDomains.has(domainId));
    let bestIndex = 0;
    if (uncoveredDomains.length > 0) {
      for (let index = 1; index < remaining.length; index += 1) {
        if (compareCoverageGain(remaining[index], remaining[bestIndex], coveredDomains) < 0) {
          bestIndex = index;
        }
      }
      const bestGain = remaining[bestIndex].matched.filter((domainId) => !coveredDomains.has(domainId)).length;
      if (bestGain === 0) {
        bestIndex = 0;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    if (!next) {
      break;
    }
    selectEntry(next);
  }

  return selected;
}

function isPublishedTemplate(template: WorkflowTemplateRecord): boolean {
  return template.status === "published";
}

function recommendTemplate(
  intent: string,
  options?: PlannerInvocationOptions,
): PlannerTemplateSelectionResponse | null {
  const ruleResult = ruleBasedRecommendTemplateSync(intent);
  if (!ruleResult) {
    return null;
  }
  if (options?.preferDomainMatch === false) {
    return ruleResult;
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
      evidence: {
        ...(baseCandidate.evidence || {}),
        domain_overlap_score: Number(overlap.toFixed(4)),
        matched_domains: matched,
        metadata_domain_match: claimedHit,
      },
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
  preferredProfileIds: string[] = [],
): PlannerRegistryRecommendation[] {
  const intentDomains = detectDomains(lower(intent));
  const intentTokens = ruleBasedTokenizeIntent(intent);
  const activeProfiles = listAgentProfiles("active");
  const activeSkills = listSkills("active");
  if (activeProfiles.length === 0 || intentDomains.size === 0) {
    return [];
  }
  const preferredRanks = buildPreferredProfileRankMap(preferredProfileIds);
  const activeSkillMap = new Map<string, SkillRecord>();
  for (const skill of activeSkills) {
    activeSkillMap.set(skill.skill_id, skill);
    activeSkillMap.set(slugify(skill.skill_id), skill);
  }

  const scored = activeProfiles
    .map((profile) => scoreProfileForIntent(profile, intentDomains, intentTokens, activeSkillMap, preferredRanks))
    .filter((entry) => entry.overlap > 0 || entry.preferredRank !== null)
    .sort(compareProfileSemanticScore);
  const selected = selectProfilesForRegistrySynthesis(scored, intentDomains, maxAgentNodes);

  if (selected.length === 0) {
    return [];
  }

  return selected.map(({ entry, coverageDomains }, index) => {
    const {
      profile,
      overlap,
      matched,
      preferredRank,
      profileTokenScore,
      combinedSkillScore,
      readinessScore,
      defaultSkillHealth,
      disallowedHitCount,
      disallowedPenalty,
      openclawReady,
      score: profileScore,
    } = entry;
    const matchedDomains = matched
      .map((id) => DOMAINS.find((d) => d.id === id)?.label || id)
      .join(", ");
    const disallowedSet = stringAndSlugSet(profile.disallowed_skills);
    const defaultSkills = profile.default_skills.filter((skillId) =>
      activeSkills.some((skill) => skill.skill_id === skillId),
    );
    const defaultSkillSet = stringAndSlugSet(defaultSkills);
    const skillDomainScope = matched.length > 0 ? domainMapFromIds(matched) : intentDomains;
    const rankedSkills = activeSkills
      .map((skill) => scoreSkillForIntent(skill, skillDomainScope, intentTokens))
      .filter(({ skill, combinedScore, domainScore }) => {
        if (disallowedSet.has(skill.skill_id) || disallowedSet.has(slugify(skill.skill_id))) {
          return false;
        }
        if (defaultSkillSet.has(skill.skill_id) || defaultSkillSet.has(slugify(skill.skill_id))) {
          return true;
        }
        return matched.length > 0 ? domainScore > 0 : combinedScore > 0;
      })
      .sort((a, b) => {
        if (b.combinedScore !== a.combinedScore) {
          return b.combinedScore - a.combinedScore;
        }
        if (b.domainScore !== a.domainScore) {
          return b.domainScore - a.domainScore;
        }
        if (b.tokenScore !== a.tokenScore) {
          return b.tokenScore - a.tokenScore;
        }
        return a.skill.skill_id.localeCompare(b.skill.skill_id);
      })
      .slice(0, 3)
      .map(({ skill }) => skill.skill_id);
    const skillIds = uniqueStrings([...defaultSkills, ...rankedSkills]).filter(
      (skillId) => !disallowedSet.has(skillId) && !disallowedSet.has(slugify(skillId)),
    );
    const allowedTools = uniqueStrings(profile.allowed_tools);
    const warnings: string[] = [];
    if (!openclawReady) {
      warnings.push(`Agent profile ${profile.profile_id} has no runtime agent ref.`);
    }
    if (defaultSkillHealth < 1 && profile.default_skills.length > 0) {
      warnings.push(
        `Agent profile ${profile.profile_id} has disabled default skills; ${(defaultSkillHealth * 100).toFixed(0)}% of defaults are active.`,
      );
    }
    if (disallowedHitCount > 0) {
      warnings.push(`Intent terms overlap with disallowed skills on agent profile ${profile.profile_id}.`);
    }
    if (skillIds.length === 0) {
      warnings.push(`Agent profile ${profile.profile_id} has no domain-aligned skill.`);
    }
    const score = preferredRank !== null ? Number(Math.max(profileScore, 0.1).toFixed(4)) : profileScore;
    const coverageLabels = coverageDomains
      .map((id) => DOMAINS.find((d) => d.id === id)?.label || id)
      .join(", ");
    const coveragePrefix =
      coverageLabels && preferredRank === null
        ? `Selected to cover remaining domain(s): ${coverageLabels}. `
        : "";
    const penaltySuffix =
      disallowedPenalty > 0 ? ` Disallowed overlap penalty ${disallowedPenalty.toFixed(2)} applied.` : "";
    return {
      node_id: `node_task_${index + 1}`,
      node_name: selected.length === 1 ? "Execute Task" : `Execute Task ${index + 1}`,
      agent_profile_id: profile.profile_id,
      agent_profile_name: profile.name,
      runtime_agent_ref: getRuntimeAgentRef(profile) || null,
      openclaw_agent_id: profile.openclaw_agent_id || getRuntimeAgentRef(profile) || null,
      skill_ids: skillIds,
      allowed_tools: allowedTools,
      score,
      reason:
        preferredRank !== null
          ? matchedDomains
            ? `Matched intent domain(s): ${matchedDomains}. Selected from orchestrator default subagent order. Token fit ${profileTokenScore.toFixed(2)}; skill fit ${combinedSkillScore.toFixed(2)}; readiness ${readinessScore.toFixed(2)}.${penaltySuffix}`
            : "Selected from orchestrator default subagent order without a direct intent-domain match."
          : `${coveragePrefix}Matched intent domain(s): ${matchedDomains}. Token fit ${profileTokenScore.toFixed(2)}; skill fit ${combinedSkillScore.toFixed(2)}; readiness ${readinessScore.toFixed(2)}.${penaltySuffix}`,
      warnings,
      evidence: {
        preferred_rank: preferredRank,
        profile_token_score: Number(profileTokenScore.toFixed(4)),
        skill_score: Number(combinedSkillScore.toFixed(4)),
        readiness_score: Number(readinessScore.toFixed(4)),
        disallowed_penalty: disallowedPenalty,
        domain_overlap_score: Number(overlap.toFixed(4)),
        matched_domains: matched,
        coverage_domains: coverageDomains,
      },
    };
  });
}

function recommendationDomains(recommendation: PlannerRegistryRecommendation): string[] {
  const evidence = recommendation.evidence || {};
  return uniqueStrings([
    ...(Array.isArray(evidence.coverage_domains) ? evidence.coverage_domains : []),
    ...(Array.isArray(evidence.matched_domains) ? evidence.matched_domains : []),
  ]);
}

function dagPhaseForDomains(domains: string[]): number {
  if (domains.includes("review")) {
    return 90;
  }
  if (domains.includes("research") || domains.includes("customer")) {
    return 10;
  }
  if (domains.includes("coding") || domains.includes("ops") || domains.includes("content")) {
    return 20;
  }
  return 50;
}

function buildRegistryTaskNode(recommendation: PlannerRegistryRecommendation, index: number): WorkflowNode {
  return {
    id: recommendation.node_id,
    name: recommendation.node_name,
    type: "agent_task",
    agent_profile: recommendation.agent_profile_id,
    allowed_skills: recommendation.skill_ids,
    config: {
      allowed_tools: recommendation.allowed_tools.length
        ? recommendation.allowed_tools
        : ["read", "write", "shell"],
      output_contract: {
        expected_artifacts: [`task-${index + 1}-report`],
      },
      planner_recommendation: {
        score: recommendation.score,
        reason: recommendation.reason,
      },
      planner_dag_phase: dagPhaseForDomains(recommendationDomains(recommendation)),
    },
    retry_policy: { max_attempts: 1, backoff_seconds: 5 },
    timeout_seconds: 900,
    parallelism: 1,
    approval_kind: null,
    human_input_schema: null,
  };
}

function buildReviewGateNode(): WorkflowNode {
  return {
    id: "node_review_gate",
    name: "Review Gate",
    type: "approval",
    agent_profile: null,
    allowed_skills: [],
    config: {
      planner_review_gate: true,
      output_contract: {
        expected_artifacts: ["review-decision"],
      },
    },
    retry_policy: { max_attempts: 1, backoff_seconds: 5 },
    timeout_seconds: 600,
    parallelism: 1,
    approval_kind: "human_review",
    human_input_schema: null,
  };
}

function buildEndNode(): WorkflowNode {
  return {
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
}

function buildDomainAwareRegistryDag(
  recommendations: PlannerRegistryRecommendation[],
  requireReview: boolean,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; shape: string } {
  const dagNodes: RegistryDagNode[] = recommendations.map((recommendation, index) => {
    const domains = recommendationDomains(recommendation);
    return {
      node: buildRegistryTaskNode(recommendation, index),
      phase: dagPhaseForDomains(domains),
      domains,
      recommendationIndex: index,
    };
  });
  const nodesByPhase = new Map<number, RegistryDagNode[]>();
  for (const dagNode of dagNodes) {
    const list = nodesByPhase.get(dagNode.phase) || [];
    list.push(dagNode);
    nodesByPhase.set(dagNode.phase, list);
  }
  const orderedPhases = [...nodesByPhase.keys()].sort((a, b) => a - b);
  const orderedStages = orderedPhases.map((phase) =>
    [...(nodesByPhase.get(phase) || [])].sort((a, b) => a.recommendationIndex - b.recommendationIndex),
  );
  const edges: WorkflowEdge[] = [];
  for (let index = 0; index < orderedStages.length - 1; index += 1) {
    const fromStage = orderedStages[index];
    const toStage = orderedStages[index + 1];
    const toReviewStage = toStage.some((entry) => entry.domains.includes("review"));
    for (const from of fromStage) {
      for (const to of toStage) {
        edges.push({
          from: from.node.id,
          to: to.node.id,
          condition: null,
          label: toReviewStage ? "review" : "then",
        });
      }
    }
  }

  const reviewGate = requireReview ? buildReviewGateNode() : null;
  const terminalStage = orderedStages[orderedStages.length - 1] || [];
  if (reviewGate) {
    for (const from of terminalStage) {
      edges.push({
        from: from.node.id,
        to: reviewGate.id,
        condition: null,
        label: "human review",
      });
    }
    edges.push({
      from: reviewGate.id,
      to: "node_end",
      condition: null,
      label: null,
    });
  } else {
    for (const from of terminalStage) {
      edges.push({
        from: from.node.id,
        to: "node_end",
        condition: null,
        label: null,
      });
    }
  }

  return {
    nodes: [
      ...dagNodes.map((entry) => entry.node),
      ...(reviewGate ? [reviewGate] : []),
      buildEndNode(),
    ],
    edges,
    shape: reviewGate ? "domain_ordered_with_review_gate" : "domain_ordered",
  };
}

function generateDagDraft(
  request: PlannerDagDraftRequest,
  options?: PlannerInvocationOptions,
): PlannerDagDraftResponse {
  const intent = request.intent.trim();
  const intentDomains = detectDomains(lower(intent));
  const inputs = isPlainObject(request.inputs) ? request.inputs : {};
  const ruleResult = ruleBasedGenerateDagDraftSync(request, options);

  if (options?.preferDomainMatch === false) {
    return ruleResult;
  }

  if (intentDomains.size === 0) {
    return ruleResult;
  }

  // If the rule-based planner picked a template variant and semantic rerank
  // chooses a different source template, regenerate the draft so the returned
  // recommendation and draft stay aligned.
  if (ruleResult.template_recommendation) {
    const reranked = recommendTemplate(intent, options);
    if (
      reranked &&
      reranked.selected_template.template_id !== ruleResult.template_recommendation.selected_template.template_id
    ) {
      const rerankedResult = ruleBasedGenerateDagDraftSync(
        {
          ...request,
          template_id: reranked.selected_template.template_id,
          inputs,
        },
        options,
      );
      const draftMetadata =
        rerankedResult.draft_template.metadata && typeof rerankedResult.draft_template.metadata === "object"
          ? rerankedResult.draft_template.metadata
          : {};
      const draftTemplate: CreateTemplateRequest & { template_id: string } = {
        ...rerankedResult.draft_template,
        metadata: {
          ...draftMetadata,
          planner_source_template_selected_by: "template_selection",
        },
      };
      return {
        ...rerankedResult,
        draft_template: draftTemplate,
        template_recommendation: reranked,
        planner_context: {
          ...rerankedResult.planner_context,
          planner_model: PROVIDER_ID,
          intent_domains: [...intentDomains.keys()],
        } as PlannerDagDraftResponse["planner_context"],
      };
    }
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
      : options?.defaultMaxAgentNodes && options.defaultMaxAgentNodes > 0
        ? options.defaultMaxAgentNodes
        : ruleResult.registry_recommendations.length || 1,
    options?.preferredSubagentProfileIds || [],
  );

  if (synthesizedRecommendations.length === 0) {
    return ruleResult;
  }

  // Replace the registry_recommendations and rebuild the draft template
  // to keep the compiled DAG aligned with the new agent picks.
  const draftTemplate = ruleResult.draft_template;
  const requireReview = options?.requireReview === true;
  const synthesizedDag = buildDomainAwareRegistryDag(synthesizedRecommendations, requireReview);
  const agentProfileBindings: Record<string, string> = {};
  for (const recommendation of synthesizedRecommendations) {
    if (recommendation.agent_profile_id && recommendation.runtime_agent_ref) {
      agentProfileBindings[recommendation.agent_profile_id] = recommendation.runtime_agent_ref;
    }
  }

  const updatedDraft = {
    ...draftTemplate,
    name: draftTemplate.name,
    description: `Domain-aware planner draft for: ${intent}`,
    nodes: synthesizedDag.nodes,
    edges: synthesizedDag.edges,
    agent_profile_bindings: agentProfileBindings,
    metadata: {
      ...(draftTemplate.metadata || {}),
      planner_strategy: "domain_aligned_synthesis",
      planner_dag_shape: synthesizedDag.shape,
      planner_intent_domains: [...intentDomains.keys()],
      planner_human_confirmation_required: true,
      planner_require_review: requireReview,
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
      require_review: requireReview,
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
  async recommendTemplate(intent: string, options?: PlannerInvocationOptions) {
    return recommendTemplate(intent, options);
  },
  async generateDagDraft(request, options) {
    return generateDagDraft(request, options);
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
