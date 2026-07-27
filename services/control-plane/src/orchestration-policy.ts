import { createOrchestrationDecision } from "./orchestration-protocol.js";
import {
  getLatestExecutionShapeDecision,
  orchestrationFactId,
  saveExecutionShapeDecision,
} from "./orchestration-fact-store.js";
import type {
  AgentAutonomyMode,
  AgentCapabilityPlanRecord,
  ExecutionProposalSource,
  ExecutionShape,
  ExecutionShapeDecisionRecord,
  InterviewDecisionRecord,
  MissionSpecContract,
  MissionSpecRevisionRecord,
  OrchestrationDecision,
  OrchestrationDecisionMode,
} from "./types.js";
import { nowIso } from "./utils.js";

export const EXECUTION_SHAPE_POLICY_VERSION = "execution-shape-policy-v1";

export interface OrchestrationPolicyInput {
  missionSpec: MissionSpecContract | null;
  userText?: string | null;
  selectedTemplateId?: string | null;
  forcedMode?: OrchestrationDecisionMode | null;
  sourceReason?: string | null;
}

interface PolicySignals {
  signals: string[];
  rationale: string[];
  scores: Record<ExecutionShape, number>;
}

function policyText(missionSpec: MissionSpecContract | null, userText?: string | null): string {
  return [userText, missionSpec?.title, missionSpec?.objective, missionSpec?.sourceBrief]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLocaleLowerCase();
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function collectSignals(input: {
  missionSpec: MissionSpecContract | null;
  userText?: string | null;
  selectedTemplateId?: string | null;
  proposalSource?: ExecutionProposalSource;
}): PolicySignals {
  const value = policyText(input.missionSpec, input.userText);
  const signals: string[] = [];
  const rationale: string[] = [];
  const scores: Record<ExecutionShape, number> = { direct: 50, delegated: 0, durable_dag: 0 };
  if (input.selectedTemplateId) {
    signals.push("template_selected");
    scores.durable_dag += 100;
    rationale.push(`A published template was selected: ${input.selectedTemplateId}.`);
  }
  if (input.proposalSource === "manual") {
    signals.push("manual_graph_submitted");
    scores.durable_dag += 100;
    rationale.push("A graph was submitted through the manual editor.");
  }
  if (hasAny(value, [/\b(dag|workflow|graph|orchestrat(?:e|ion))\b|多\s*agent|多智能体|编排|工作流|流程图|节点/iu])) {
    signals.push("explicit_orchestration_request");
    scores.durable_dag += 45;
    rationale.push("The request explicitly asks for orchestration, a workflow, or a graph.");
  }
  if (hasAny(value, [/\b(parallel|fan.?out|concurrent)\b|并行|同时处理|多个(?:角色|agent|智能体)|调研.*实现|研究.*开发/iu])) {
    signals.push("parallel_or_multi_role");
    scores.delegated += 35;
    scores.durable_dag += 25;
    rationale.push("The task contains parallel or multi-role work.");
  }
  if (hasAny(value, [/\b(reviewer|review|human.?gate|approval|acceptance)\b|审核|验收|复核|评审|人工确认|审批/iu])) {
    signals.push("review_or_human_gate");
    scores.durable_dag += 30;
    rationale.push("The task requests independent review or a human approval boundary.");
  }
  if (hasAny(value, [/\b(checkpoint|resume|recover|long.?running|long task|retry)\b|长任务|断点|恢复|重试|续回|上下文压缩/iu])) {
    signals.push("durability_or_recovery");
    scores.durable_dag += 35;
    rationale.push("The task needs durable checkpoints, recovery, or long-running execution.");
  }
  if (hasAny(value, [/\b(schedule|cron|reusable|repeatable|template)\b|定时|周期|复用|模板化/iu])) {
    signals.push("reusable_or_scheduled");
    scores.durable_dag += 30;
    rationale.push("The task is reusable or scheduled and benefits from a durable workflow.");
  }
  if (hasAny(value, [/\b(research|analy[sz]e|implement|develop|test|translate|generate)\b|调研|研究|分析|实现|开发|测试|翻译|生成文件/iu])) {
    signals.push("specialized_capability_mix");
    scores.delegated += 15;
    scores.durable_dag += 10;
    rationale.push("The task may benefit from specialist Agent capabilities.");
  }
  if (hasAny(value, [/\b(delete|overwrite|deploy|production|publish|payment)\b|删除|覆盖|部署|生产环境|发布|付款/iu])) {
    signals.push("high_risk_side_effect");
    rationale.push("The task contains a high-risk side effect that requires approval evidence.");
  }
  if (hasAny(value, [/shared (file|workspace)|same file|共享文件|同一文件|同一个工作区/iu])) {
    signals.push("shared_mutable_contention");
    scores.delegated = Math.max(0, scores.delegated - 25);
    rationale.push("Shared mutable content reduces the value of temporary parallel delegation.");
  }
  scores.direct = Math.max(0, scores.direct - Math.max(scores.delegated, scores.durable_dag) / 2);
  return { signals, rationale, scores };
}

function recommendedShape(signals: PolicySignals): ExecutionShape {
  if (signals.scores.durable_dag >= 40) return "durable_dag";
  if (signals.scores.delegated >= 25) return "delegated";
  return "direct";
}

export function evaluateExecutionShapePolicy(input: {
  revision: MissionSpecRevisionRecord;
  interviewDecision: InterviewDecisionRecord;
  capabilityPlan?: AgentCapabilityPlanRecord | null;
  autonomyMode?: AgentAutonomyMode;
  selectedTemplateId?: string | null;
  proposalSource?: ExecutionProposalSource;
  previousDecision?: ExecutionShapeDecisionRecord | null;
  userSelectedShape?: ExecutionShape | null;
  confirmedDag?: boolean;
  durableDagPreauthorized?: boolean;
  createdAt?: string;
}): ExecutionShapeDecisionRecord {
  const signals = collectSignals({
    missionSpec: input.revision.mission_spec_contract,
    userText: input.revision.mission_spec_contract.sourceBrief,
    selectedTemplateId: input.selectedTemplateId,
    proposalSource: input.proposalSource,
  });
  if (input.capabilityPlan?.gaps.some((gap) => gap.blocking)) {
    signals.signals.push("blocking_capability_gap");
    signals.rationale.push("At least one required Agent capability is unavailable.");
  }

  let recommended = recommendedShape(signals);
  if (input.previousDecision?.recommended_shape === "durable_dag" && recommended !== "durable_dag") {
    recommended = "durable_dag";
    signals.signals.push("durable_dag_hysteresis");
    signals.rationale.push("A durable DAG recommendation is retained until explicitly superseded.");
  }
  if (input.confirmedDag) recommended = "durable_dag";
  if (input.userSelectedShape) recommended = input.userSelectedShape;

  const capabilityBlocked = input.capabilityPlan?.status === "blocked";
  const interviewBlocked = input.interviewDecision.mode !== "skip";
  const autonomyMode = input.autonomyMode || "assisted";
  let selectedShape: ExecutionShape | null = null;
  let selectionStatus: ExecutionShapeDecisionRecord["selection_status"] = "recommended";
  let decidedBy: ExecutionShapeDecisionRecord["decided_by"] = "policy";
  if (input.confirmedDag) {
    selectedShape = "durable_dag";
    selectionStatus = "confirmed";
    decidedBy = "confirmed_state";
  } else if (capabilityBlocked || interviewBlocked) {
    selectionStatus = "blocked";
  } else if (input.userSelectedShape) {
    selectedShape = input.userSelectedShape;
    selectionStatus = "confirmed";
    decidedBy = "user";
  } else if (recommended === "direct") {
    selectedShape = "direct";
    selectionStatus = "automatic";
  } else if (recommended === "delegated" && autonomyMode !== "review_first") {
    selectedShape = "delegated";
    selectionStatus = "automatic";
  } else if (recommended === "durable_dag" && autonomyMode === "autopilot" && input.durableDagPreauthorized) {
    selectedShape = "durable_dag";
    selectionStatus = "automatic";
  }

  const riskLevel: ExecutionShapeDecisionRecord["risk_level"] = signals.signals.includes("high_risk_side_effect")
    ? "high"
    : recommended === "durable_dag" || signals.signals.includes("review_or_human_gate")
      ? "medium"
      : "low";
  const approvalRequired = riskLevel === "high" || selectedShape === null;
  const timestamp = input.createdAt || nowIso();
  return {
    schema_version: 1,
    decision_id: orchestrationFactId("execution_shape_decision"),
    mission_id: input.revision.mission_id,
    session_id: input.revision.session_id,
    mission_revision_id: input.revision.revision_id,
    recommended_shape: recommended,
    selected_shape: selectedShape,
    proposal_source: input.proposalSource || (input.selectedTemplateId ? "template" : recommended === "durable_dag" ? "dynamic" : null),
    selection_status: selectionStatus,
    decided_by: decidedBy,
    reason: signals.rationale[0] || "The mission remains suitable for direct execution.",
    reason_codes: signals.signals,
    evidence: signals,
    risk_level: riskLevel,
    approval_required: approvalRequired,
    policy_version: EXECUTION_SHAPE_POLICY_VERSION,
    supersedes_decision_id: input.previousDecision?.decision_id || null,
    created_at: timestamp,
  };
}

export function synchronizeExecutionShapeDecision(
  input: Omit<Parameters<typeof evaluateExecutionShapePolicy>[0], "previousDecision">,
): { decision: ExecutionShapeDecisionRecord; created: boolean } {
  const previous = getLatestExecutionShapeDecision(input.revision.session_id);
  if (previous?.mission_revision_id === input.revision.revision_id && !input.userSelectedShape && !input.confirmedDag) {
    return { decision: previous, created: false };
  }
  const decision = evaluateExecutionShapePolicy({ ...input, previousDecision: previous });
  saveExecutionShapeDecision(decision);
  return { decision, created: true };
}

export function evaluateOrchestrationPolicy(input: OrchestrationPolicyInput): OrchestrationDecision {
  const selectedTemplateId = input.selectedTemplateId?.trim() || null;
  const proposalSource: ExecutionProposalSource = input.forcedMode === "manual" ? "manual" : selectedTemplateId ? "template" : null;
  const evidence = collectSignals({
    missionSpec: input.missionSpec,
    userText: input.userText,
    selectedTemplateId,
    proposalSource,
  });
  const forced = input.forcedMode || null;
  const shape = recommendedShape(evidence);
  const mode: OrchestrationDecisionMode = forced || (selectedTemplateId ? "template" : shape === "durable_dag" ? "dynamic" : "direct");
  const requiresDag = mode !== "direct";
  const riskLevel: OrchestrationDecision["risk_level"] = evidence.signals.includes("high_risk_side_effect")
    ? "high"
    : requiresDag || evidence.signals.includes("review_or_human_gate")
      ? "medium"
      : "low";
  return createOrchestrationDecision({
    missionSpec: input.missionSpec,
    mode,
    selectedTemplateId,
    requiredCapabilities: evidence.signals.filter((signal) => signal !== "template_selected"),
    reason: input.sourceReason?.trim() || evidence.rationale[0] || "No durable orchestration signal crossed the policy threshold.",
    requiresDag,
    riskLevel,
    approvalRequired: requiresDag || riskLevel !== "low",
    evidence: {
      signals: evidence.signals,
      scores: {
        direct: evidence.scores.direct,
        template: selectedTemplateId ? 100 : 0,
        dynamic: evidence.scores.durable_dag,
        manual: proposalSource === "manual" ? 100 : 0,
      },
      matched_template_id: selectedTemplateId,
      rationale: evidence.rationale,
    },
  });
}
