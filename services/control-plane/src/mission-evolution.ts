import { createHash } from "node:crypto";
import {
  getLatestMissionDelta,
  getLatestMissionSpecRevision,
  orchestrationFactId,
  saveMissionDelta,
  saveMissionSpecRevision,
} from "./orchestration-fact-store.js";
import type {
  MissionDeltaChange,
  MissionDeltaClassification,
  MissionDeltaRecord,
  MissionSpecContract,
  MissionSpecRevisionRecord,
} from "./types.js";
import { nowIso } from "./utils.js";

const CRITICAL_SIDE_EFFECT =
  /\b(delete|overwrite|deploy|publish|production|payment|credential|secret)\b|删除|覆盖|部署|发布|生产环境|付款|凭据|密钥/iu;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function normalizedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function semanticMissionSpec(contract: MissionSpecContract): Record<string, unknown> {
  return {
    title: contract.title.trim(),
    objective: contract.objective?.trim() || null,
    sourceBrief: contract.sourceBrief?.trim() || null,
    constraints: normalizedStrings(contract.constraints),
    requestedOutputs: normalizedStrings(contract.requestedOutputs),
    openQuestions: normalizedStrings(contract.openQuestions),
    decisionFocus: contract.decisionFocus?.trim() || null,
    route: {
      selectedTemplateId: contract.route.selectedTemplateId,
      confirmedRevision: contract.route.confirmedRevision,
      confirmedOption: contract.route.confirmedOption,
    },
  };
}

function impactForField(field: string): MissionDeltaChange["impact"] {
  if (field.startsWith("route.")) return "topology";
  if (["objective", "sourceBrief", "constraints", "requestedOutputs"].includes(field)) return "execution";
  return "informational";
}

function flatten(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const [childKey, child] of Object.entries(item as Record<string, unknown>)) {
        result[`${key}.${childKey}`] = child;
      }
    } else {
      result[key] = item;
    }
  }
  return result;
}

function changesBetween(
  previous: MissionSpecContract | null,
  current: MissionSpecContract,
): MissionDeltaChange[] {
  if (!previous) {
    return [{
      field: "mission",
      operation: "added",
      impact: "execution",
      before: null,
      after: semanticMissionSpec(current),
    }];
  }
  const before = flatten(semanticMissionSpec(previous));
  const after = flatten(semanticMissionSpec(current));
  const changes: MissionDeltaChange[] = [];
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(canonicalize(before[field])) === JSON.stringify(canonicalize(after[field]))) continue;
    changes.push({
      field,
      operation: before[field] == null ? "added" : after[field] == null ? "removed" : "replaced",
      impact: impactForField(field),
      before: before[field] ?? null,
      after: after[field] ?? null,
    });
  }
  return changes.sort((left, right) => left.field.localeCompare(right.field));
}

function classify(
  previous: MissionSpecContract | null,
  current: MissionSpecContract,
  changes: MissionDeltaChange[],
): { classification: MissionDeltaClassification; evidence: string[] } {
  if (!previous) return { classification: "baseline", evidence: ["Initial MissionSpec baseline recorded."] };
  const changedFields = new Set(changes.map((change) => change.field));
  const changedText = changes.map((change) => JSON.stringify(change.after)).join("\n");
  if (CRITICAL_SIDE_EFFECT.test(changedText)) {
    return { classification: "critical", evidence: ["The mission change introduced a high-risk side effect."] };
  }
  if ([...changedFields].some((field) => field.startsWith("route."))) {
    return { classification: "topology", evidence: ["The confirmed route or template binding changed."] };
  }
  if ([...changedFields].some((field) => ["objective", "sourceBrief", "constraints", "requestedOutputs"].includes(field))) {
    return { classification: "material", evidence: ["The objective, brief, constraints, or requested outputs changed."] };
  }
  return { classification: "minor", evidence: ["Only non-execution mission details changed."] };
}

export interface MissionEvolutionResult {
  revision: MissionSpecRevisionRecord;
  delta: MissionDeltaRecord;
  created: boolean;
}

export function synchronizeMissionEvolution(input: {
  missionSpec: MissionSpecContract;
  sourceMessageId?: string | null;
  createdAt?: string;
}): MissionEvolutionResult {
  const currentDigest = digest(semanticMissionSpec(input.missionSpec));
  const previousRevision = getLatestMissionSpecRevision(input.missionSpec.sessionId);
  if (previousRevision?.semantic_digest === currentDigest) {
    const delta = getLatestMissionDelta(input.missionSpec.sessionId);
    if (!delta || delta.delta_id !== previousRevision.delta_id) {
      throw new Error("MISSION_EVOLUTION_DELTA_MISSING");
    }
    return { revision: previousRevision, delta, created: false };
  }

  const timestamp = input.createdAt || nowIso();
  const revisionId = orchestrationFactId("mission_revision");
  const deltaId = orchestrationFactId("mission_delta");
  const previousContract = previousRevision?.mission_spec_contract || null;
  const changes = changesBetween(previousContract, input.missionSpec);
  const classification = classify(previousContract, input.missionSpec, changes);
  const revision: MissionSpecRevisionRecord = {
    schema_version: 1,
    revision_id: revisionId,
    mission_id: input.missionSpec.missionId,
    session_id: input.missionSpec.sessionId,
    revision: (previousRevision?.revision || 0) + 1,
    parent_revision_id: previousRevision?.revision_id || null,
    source_message_id: input.sourceMessageId || input.missionSpec.latestUserMessageId,
    mission_spec_contract: input.missionSpec,
    semantic_digest: currentDigest,
    delta_id: deltaId,
    created_at: timestamp,
  };
  const changedFields = changes.map((change) => change.field);
  const delta: MissionDeltaRecord = {
    schema_version: 1,
    delta_id: deltaId,
    mission_id: revision.mission_id,
    session_id: revision.session_id,
    from_revision_id: previousRevision?.revision_id || null,
    to_revision_id: revisionId,
    source_message_id: revision.source_message_id,
    classification: classification.classification,
    changed_fields: changedFields,
    changes,
    requires_interview_reassessment: classification.classification !== "minor",
    requires_orchestration_reassessment: classification.classification !== "minor",
    invalidates_confirmed_proposal:
      !!previousContract?.route.confirmedRevision &&
      (classification.classification === "material" ||
        classification.classification === "topology" ||
        classification.classification === "critical"),
    evidence: classification.evidence,
    created_at: timestamp,
  };
  saveMissionDelta(delta);
  saveMissionSpecRevision(revision);
  return { revision, delta, created: true };
}
