import { createHash } from "node:crypto";
import {
  getLatestInterviewDecision,
  getLatestMissionInterview,
  orchestrationFactId,
  saveInterviewDecision,
  saveMissionInterview,
  touchMissionInterview,
} from "./orchestration-fact-store.js";
import type {
  AgentCapabilityGap,
  InterviewDecisionRecord,
  MissionDeltaRecord,
  MissionInterviewMode,
  MissionInterviewQuestion,
  MissionInterviewRecord,
  MissionSpecRevisionRecord,
} from "./types.js";
import { nowIso } from "./utils.js";

export const INTERVIEW_POLICY_VERSION = "interview-policy-v1";

function keyFor(value: string): string {
  return createHash("sha256").update(value.trim().toLocaleLowerCase()).digest("hex").slice(0, 16);
}

function recommendationFor(question: string): string {
  if (/accept|success|验收|成功|完成标准/iu.test(question)) {
    return "Use observable deliverables and executable checks as the acceptance criteria.";
  }
  if (/file|format|output|文件|格式|产出/iu.test(question)) {
    return "Use the format implied by the active workspace and preserve an editable source artifact.";
  }
  if (/permission|risk|delete|publish|权限|风险|删除|发布/iu.test(question)) {
    return "Keep risky or external side effects behind explicit user approval.";
  }
  return "Use the lowest-risk option that keeps the task reversible and verifiable.";
}

function capabilityGapQuestion(gap: AgentCapabilityGap): string {
  return `The workflow requires ${gap.kind} '${gap.value}', but no ready Agent currently provides it. Should My Mate create a task-scoped Agent or revise the workflow?`;
}

function buildQuestions(
  revision: MissionSpecRevisionRecord,
  capabilityGaps: AgentCapabilityGap[],
): MissionInterviewQuestion[] {
  const prompts = [
    ...revision.mission_spec_contract.openQuestions,
    ...capabilityGaps.filter((gap) => gap.blocking).map(capabilityGapQuestion),
  ];
  return [...new Set(prompts.map((prompt) => prompt.trim()).filter(Boolean))].map((prompt) => {
    const key = keyFor(prompt);
    return {
      question_id: `interview_question_${key}`,
      decision_key: `decision_${key}`,
      dependency_keys: [],
      blocking_level: "hard",
      prompt,
      reason: "The answer can change the execution route, Agent binding, or acceptance contract.",
      recommended_answer: recommendationFor(prompt),
      answer: null,
      answer_source: null,
      affected_node_ids: [],
      status: "open",
      answered_at: null,
    };
  });
}

export function evaluateInterviewPolicy(input: {
  revision: MissionSpecRevisionRecord;
  delta: MissionDeltaRecord;
  capabilityGaps?: AgentCapabilityGap[];
  userForcedMode?: MissionInterviewMode | null;
  createdAt?: string;
}): { decision: InterviewDecisionRecord; questions: MissionInterviewQuestion[] } {
  const capabilityGaps = input.capabilityGaps || [];
  const questions = buildQuestions(input.revision, capabilityGaps);
  const blockingDecisions = questions
    .filter((question) => question.blocking_level === "hard")
    .map((question) => question.decision_key);
  const reasonCodes: string[] = [];
  if (input.revision.revision === 1) reasonCodes.push("mission_baseline");
  if (input.delta.classification === "material") reasonCodes.push("material_scope_change");
  if (input.delta.classification === "topology") reasonCodes.push("topology_change");
  if (input.delta.classification === "critical") reasonCodes.push("critical_risk_change");
  if (questions.length) reasonCodes.push("blocking_unknowns");
  if (capabilityGaps.some((gap) => gap.blocking)) reasonCodes.push("blocking_capability_gap");

  let mode: MissionInterviewMode = "skip";
  if (questions.length === 1 || questions.length === 2) mode = "focused";
  if (
    questions.length >= 3 ||
    (questions.length > 0 && ["topology", "critical"].includes(input.delta.classification))
  ) mode = "deep";
  if (input.userForcedMode) mode = input.userForcedMode;
  if (mode === "skip") reasonCodes.push("no_blocking_unknowns");

  const timestamp = input.createdAt || nowIso();
  const decision: InterviewDecisionRecord = {
    schema_version: 1,
    decision_id: orchestrationFactId("interview_decision"),
    mission_id: input.revision.mission_id,
    session_id: input.revision.session_id,
    mission_revision_id: input.revision.revision_id,
    mode,
    reason_codes: reasonCodes,
    blocking_decisions: blockingDecisions,
    recommended_defaults: Object.fromEntries(
      questions.map((question) => [question.decision_key, question.recommended_answer || ""]),
    ),
    invalidated_question_ids: [],
    decided_by: input.userForcedMode ? "user" : "policy",
    policy_version: INTERVIEW_POLICY_VERSION,
    created_at: timestamp,
  };
  return { decision, questions };
}

export function synchronizeMissionInterview(input: {
  revision: MissionSpecRevisionRecord;
  delta: MissionDeltaRecord;
  capabilityGaps?: AgentCapabilityGap[];
  userForcedMode?: MissionInterviewMode | null;
  createdAt?: string;
}): { decision: InterviewDecisionRecord; interview: MissionInterviewRecord; created: boolean } {
  const currentDecision = getLatestInterviewDecision(input.revision.session_id);
  const currentInterview = getLatestMissionInterview(input.revision.session_id);
  if (
    currentDecision?.mission_revision_id === input.revision.revision_id &&
    currentInterview?.mission_revision_id === input.revision.revision_id
  ) {
    return { decision: currentDecision, interview: currentInterview, created: false };
  }

  const evaluated = evaluateInterviewPolicy(input);
  const timestamp = input.createdAt || nowIso();
  if (currentInterview && currentInterview.status !== "superseded") {
    touchMissionInterview(currentInterview, { status: "superseded" });
    evaluated.decision.invalidated_question_ids = currentInterview.questions
      .filter((question) => question.status === "open")
      .map((question) => question.question_id);
  }
  const interview: MissionInterviewRecord = {
    schema_version: 1,
    interview_id: orchestrationFactId("mission_interview"),
    mission_id: input.revision.mission_id,
    session_id: input.revision.session_id,
    mission_revision_id: input.revision.revision_id,
    decision_id: evaluated.decision.decision_id,
    mode: evaluated.decision.mode,
    status: evaluated.decision.mode === "skip" ? "ready" : "active",
    readiness_score: evaluated.decision.mode === "skip"
      ? 100
      : Math.max(0, 80 - evaluated.questions.length * 15),
    questions: evaluated.questions,
    supersedes_interview_id: currentInterview?.interview_id || null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  saveInterviewDecision(evaluated.decision);
  saveMissionInterview(interview);
  return { decision: evaluated.decision, interview, created: true };
}

export function answerMissionInterviewQuestion(input: {
  sessionId: string;
  questionId: string;
  answer: string;
  answerSource: NonNullable<MissionInterviewQuestion["answer_source"]>;
  answeredAt?: string;
}): MissionInterviewRecord {
  const interview = getLatestMissionInterview(input.sessionId);
  if (!interview || interview.status !== "active") {
    throw Object.assign(new Error("No active mission interview is available."), {
      code: "mission_interview_not_active",
    });
  }
  const answeredAt = input.answeredAt || nowIso();
  let found = false;
  const questions = interview.questions.map((question) => {
    if (question.question_id !== input.questionId) return question;
    found = true;
    return {
      ...question,
      answer: input.answer.trim(),
      answer_source: input.answerSource,
      status: input.answerSource === "user" ? "answered" as const : "inferred" as const,
      answered_at: answeredAt,
    };
  });
  if (!found) {
    throw Object.assign(new Error("Mission interview question was not found."), {
      code: "mission_interview_question_not_found",
    });
  }
  const remaining = questions.filter(
    (question) => question.blocking_level === "hard" && question.status === "open",
  ).length;
  return touchMissionInterview(interview, {
    questions,
    status: remaining === 0 ? "ready" : "active",
    readiness_score: Math.round(((questions.length - remaining) / Math.max(1, questions.length)) * 100),
  });
}
