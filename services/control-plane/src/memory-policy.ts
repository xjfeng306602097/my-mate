import { listSessionMessages } from "./session-message-store.js";
import type {
  AutopilotMode,
  MemoryCandidateOperation,
  MemoryCandidateRisk,
  MemoryKind,
  MemorySensitivity,
  MemorySourceOrigin,
  SessionMessageRecord,
  SessionRecord,
} from "./types.js";

export type MemoryPolicyOutcome = "commit" | "stage" | "reject";

export interface MemoryPolicyDecision {
  outcome: MemoryPolicyOutcome;
  mode: AutopilotMode;
  origin: MemorySourceOrigin;
  risk: MemoryCandidateRisk;
  reason: string;
}

function messageText(message: SessionMessageRecord): string {
  const content = message.content || {};
  for (const key of ["text", "narrative_reply", "turn_summary", "summary"]) {
    const value = content[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function latestUserMemoryEvidence(sessionId: string): {
  messageId: string | null;
  text: string;
} {
  const latest = listSessionMessages(sessionId)
    .filter((message) => message.role === "user")
    .filter((message) => !!messageText(message))
    .at(-1);
  return {
    messageId: latest?.message_id || null,
    text: latest ? messageText(latest) : "",
  };
}

const REMEMBER_INTENT = /(?:\b(?:remember|memorize|save this|keep (?:this|that) in mind|do not forget|don't forget)\b|记住|帮我记|请记|记下来|保存.{0,8}记忆|以后.{0,12}(?:都|请|要)|下次.{0,12}记得)/iu;
const FORGET_INTENT = /(?:\b(?:forget|remove|delete|clear)\b.{0,24}\bmemor(?:y|ies)\b|\bdo not remember\b|\bdon't remember\b|忘记|别记|不要记|删除.{0,12}记忆|清除.{0,12}记忆)/iu;

export function resolveMemorySourceOrigin(
  session: SessionRecord,
  operation: MemoryCandidateOperation,
): { origin: "explicit_user" | "inferred"; messageId: string | null } {
  const evidence = latestUserMemoryEvidence(session.session_id);
  const explicit = operation === "delete"
    ? FORGET_INTENT.test(evidence.text)
    : REMEMBER_INTENT.test(evidence.text);
  return {
    origin: explicit ? "explicit_user" : "inferred",
    messageId: evidence.messageId,
  };
}

export function resolveMemoryAutonomyMode(session: SessionRecord): AutopilotMode {
  const value = session.metadata?.autonomy_mode;
  return value === "review_first" || value === "autopilot" ? value : "assisted";
}

export function deriveMemoryRisk(input: {
  operation: MemoryCandidateOperation;
  kind?: MemoryKind;
  sensitivity: MemorySensitivity;
  confidence?: number;
}): MemoryCandidateRisk {
  if (input.sensitivity === "restricted" || input.operation === "delete") return "high";
  if (input.sensitivity === "private" || input.kind === "decision" || input.kind === "lesson") {
    return "medium";
  }
  if (typeof input.confidence === "number" && input.confidence < 0.85) return "medium";
  return "low";
}

export function decideMemoryMutation(input: {
  session: SessionRecord;
  operation: MemoryCandidateOperation;
  origin: MemorySourceOrigin;
  risk: MemoryCandidateRisk;
  sensitivity: MemorySensitivity;
}): MemoryPolicyDecision {
  const mode = resolveMemoryAutonomyMode(input.session);
  if (input.sensitivity === "restricted") {
    return {
      outcome: "stage",
      mode,
      origin: input.origin,
      risk: "high",
      reason: "Restricted memory always requires human review.",
    };
  }
  if (mode === "review_first") {
    return {
      outcome: "stage",
      mode,
      origin: input.origin,
      risk: input.risk,
      reason: "Review First requires approval for every durable memory mutation.",
    };
  }
  if (input.operation === "delete" && input.origin !== "explicit_user") {
    return {
      outcome: "stage",
      mode,
      origin: input.origin,
      risk: "high",
      reason: "Inferred deletion is never applied without review.",
    };
  }
  if (mode === "assisted") {
    return input.origin === "explicit_user"
      ? {
          outcome: "commit",
          mode,
          origin: input.origin,
          risk: input.risk,
          reason: "Assisted mode accepts an explicit user memory request.",
        }
      : {
          outcome: "stage",
          mode,
          origin: input.origin,
          risk: input.risk,
          reason: "Assisted mode stages inferred memory for review.",
        };
  }
  if (input.origin === "explicit_user" || input.risk === "low") {
    return {
      outcome: "commit",
      mode,
      origin: input.origin,
      risk: input.risk,
      reason: input.origin === "explicit_user"
        ? "Autopilot accepts an explicit user memory request."
        : "Autopilot may commit low-risk inferred memory with an auditable tool result.",
    };
  }
  return {
    outcome: "stage",
    mode,
    origin: input.origin,
    risk: input.risk,
    reason: "Autopilot stages medium- and high-risk inferred memory for review.",
  };
}
