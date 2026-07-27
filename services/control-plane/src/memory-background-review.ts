import { createHash } from "node:crypto";
import path from "node:path";
import { MEMORY_REVIEWS_DIR } from "./config.js";
import { decideMemoryMutation, deriveMemoryRisk } from "./memory-policy.js";
import { recordMemoryBackgroundReview } from "./memory-observability.js";
import { extractModelMemoryProposals } from "./memory-intelligence.js";
import { getMemorySettings } from "./memory-settings-store.js";
import {
  createMemory,
  createMemoryCandidate,
  deleteMemory,
  findExactMemory,
  getMemory,
  listMemoryCandidates,
  updateMemory,
  type MemoryProposalInput,
} from "./memory-store.js";
import { getActivePrincipalId } from "./request-security.js";
import { listSessionMessages } from "./session-message-store.js";
import { getSession } from "./session-store.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { getTaskWorkspace } from "./task-workspace-store.js";
import type { MemoryIntelligenceProposal, MemoryKind, MemoryReviewRecord, MemoryReviewTrigger, MemoryScopeKind, SessionMessageRecord } from "./types.js";
import { nowIso } from "./utils.js";
import { sessionAgentMemoryPolicy } from "./agent-memory-policy.js";
import { resolveSessionAgentId } from "./session-agent-id.js";

interface ExtractedMemory {
  operation: "create";
  target_memory_id: null;
  kind: MemoryKind;
  content: string;
  scopeKind: MemoryScopeKind;
  scopeId: string;
  confidence: number;
  importance: number;
  tags: string[];
}

function reviewPath(workspaceId: string, sessionId: string, digest: string): string {
  return path.join(
    MEMORY_REVIEWS_DIR,
    encodeURIComponent(workspaceId),
    encodeURIComponent(sessionId),
    `${digest}.json`,
  );
}

function messageText(message: SessionMessageRecord): string {
  for (const key of ["text", "narrative_reply", "turn_summary", "summary"]) {
    const value = message.content?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeContent(value: string): string {
  return value.replace(/\s+/gu, " ").replace(/^[\s,，。.!！?？:：;；-]+|[\s]+$/gu, "").slice(0, 800);
}

function sentenceCandidates(text: string): string[] {
  return text
    .split(/(?<=[。！？!?;；\n])/u)
    .map(normalizeContent)
    .filter((item) => item.length >= 6 && item.length <= 800);
}

function classify(sentence: string): { kind: MemoryKind; confidence: number; importance: number; tags: string[] } | null {
  if (/(?:我(?:更)?(?:喜欢|偏好|习惯|希望)|请(?:始终|默认)|以后(?:请|都)|\bI (?:prefer|like|usually|always want)\b|\bplease always\b)/iu.test(sentence)) {
    return { kind: "preference", confidence: 0.92, importance: 0.72, tags: ["background-review", "preference"] };
  }
  if (/(?:我们|这个项目|本项目).{0,18}(?:决定|采用|使用|约定|统一)|(?:决定|约定).{0,18}(?:使用|采用)|\bwe (?:decided|will use|agreed)\b|\bthis project (?:uses|will use)\b/iu.test(sentence)) {
    return { kind: "decision", confidence: 0.88, importance: 0.78, tags: ["background-review", "decision"] };
  }
  if (/(?:代码|项目|仓库|团队).{0,18}(?:必须|统一|应该|约定|规范)|\b(?:code|project|repository|team).{0,24}(?:must|should|convention)\b/iu.test(sentence)) {
    return { kind: "convention", confidence: 0.88, importance: 0.7, tags: ["background-review", "convention"] };
  }
  if (/(?:我是|我在|我的(?:职位|角色|时区|语言)|\bI am\b|\bmy (?:role|timezone|language) is\b)/iu.test(sentence)) {
    return { kind: "fact", confidence: 0.86, importance: 0.58, tags: ["background-review", "fact"] };
  }
  return null;
}

function extract(message: SessionMessageRecord, max: number): ExtractedMemory[] {
  const session = getSession(message.session_id);
  if (!session) return [];
  const settings = getMemorySettings(session.workspace_id || "default");
  const taskWorkspace = getTaskWorkspace(message.session_id);
  const principalId = getActivePrincipalId() || session.created_by;
  const agentId = resolveSessionAgentId(session);
  const extracted: ExtractedMemory[] = [];
  for (const sentence of sentenceCandidates(messageText(message))) {
    const classification = classify(sentence);
    if (!classification) continue;
    const projectOrConvention = classification.kind === "decision" || classification.kind === "convention";
    const agentSpecific = /(?:这个|当前)?agent|智能体|助手/iu.test(sentence);
    const scopeKind: MemoryScopeKind = agentSpecific && settings.scope_policy.agent_memory_enabled
      ? "agent"
      : projectOrConvention && settings.scope_policy.project_memory_enabled && taskWorkspace
        ? "project"
        : "user";
    const scopeId = scopeKind === "agent" ? agentId! : scopeKind === "project" ? taskWorkspace!.project_id : principalId;
    extracted.push({ ...classification, operation: "create", target_memory_id: null, content: sentence, scopeKind, scopeId });
    if (extracted.length >= max) break;
  }
  return extracted;
}

function saveReview(record: MemoryReviewRecord): MemoryReviewRecord {
  getJsonStorageBackend().writeJson(
    reviewPath(record.workspace_id, record.session_id, record.message_digest),
    record,
  );
  return record;
}

function normalizeReviewRecord(record: MemoryReviewRecord): MemoryReviewRecord {
  return {
    ...record,
    extractor: record.extractor || "deterministic",
    provider_connection_id: record.provider_connection_id || null,
    proposed_operations: record.proposed_operations || { create: 0, update: 0, supersede: 0, delete: 0 },
    trigger: record.trigger || "conversation_turn",
    trigger_id: record.trigger_id || record.message_digest,
  };
}

export async function runBackgroundMemoryReview(
  sessionId: string,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    trigger?: MemoryReviewTrigger;
    triggerId?: string;
    sourceText?: string;
    sourceMessageId?: string;
  } = {},
): Promise<MemoryReviewRecord> {
  const session = getSession(sessionId);
  if (!session) throw new Error("SESSION_NOT_FOUND");
  const workspaceId = session.workspace_id || "default";
  const settings = getMemorySettings(workspaceId);
  const agentMemoryPolicy = sessionAgentMemoryPolicy(session);
  const latestUser = listSessionMessages(sessionId).filter((message) => message.role === "user" && message.kind === "text").at(-1);
  const text = options.sourceText?.trim() || (latestUser ? messageText(latestUser) : "");
  const trigger = options.trigger || "conversation_turn";
  const triggerId = options.triggerId || latestUser?.message_id || "latest";
  const digest = createHash("sha256").update(JSON.stringify([latestUser?.message_id || null, options.sourceMessageId || null, text, trigger, triggerId])).digest("hex");
  const file = reviewPath(workspaceId, sessionId, digest);
  const storage = getJsonStorageBackend();
  if (storage.exists(file)) return normalizeReviewRecord(storage.readJson<MemoryReviewRecord>(file));
  const base: MemoryReviewRecord = {
    schema_version: 1,
    workspace_id: workspaceId,
    session_id: sessionId,
    message_digest: digest,
    status: "completed",
    reviewed_message_ids: options.sourceMessageId ? [options.sourceMessageId] : latestUser ? [latestUser.message_id] : [],
    candidate_ids: [],
    committed_memory_ids: [],
    extractor: "deterministic",
    provider_connection_id: null,
    proposed_operations: { create: 0, update: 0, supersede: 0, delete: 0 },
    reason: null,
    reviewed_at: nowIso(),
    trigger,
    trigger_id: triggerId,
  };
  if (!agentMemoryPolicy.enabled || agentMemoryPolicy.write_mode === "disabled" || !settings.background_review.enabled || !text || text.length < settings.background_review.min_user_characters) {
    base.status = "skipped";
    base.reason = !agentMemoryPolicy.enabled
      ? "agent_memory_disabled"
      : agentMemoryPolicy.write_mode === "disabled"
        ? "agent_memory_write_disabled"
        : !settings.background_review.enabled
          ? "background_review_disabled"
      : "insufficient_event_content";
    return saveReview(base);
  }
  try {
    const sourceMessage: SessionMessageRecord = latestUser && !options.sourceText
      ? latestUser
      : {
          message_id: options.sourceMessageId || `memory-event:${triggerId}`,
          session_id: sessionId,
          role: "user",
          kind: "text",
          content: { text },
          created_at: nowIso(),
          linked_run_id: null,
          linked_node_run_id: null,
        };
    const modeled = options.sourceText
      ? null
      : await extractModelMemoryProposals({ session, fetchImpl: options.fetchImpl, signal: options.signal });
    const items: Array<MemoryIntelligenceProposal | ExtractedMemory> = modeled
      ? modeled.proposals.filter((proposal) => proposal.operation !== "ignore")
      : extract(sourceMessage, settings.background_review.max_candidates_per_review);
    if (modeled) {
      base.extractor = "model";
      base.provider_connection_id = modeled.providerConnectionId;
    }
    for (const item of items) {
      if (item.operation === "ignore") continue;
      const scopeKind = "scopeKind" in item ? item.scopeKind : item.scope_kind;
      const scopeId = "scopeId" in item ? item.scopeId : item.scope_id;
      base.proposed_operations[item.operation] += 1;
      if (item.operation === "create" && findExactMemory({ content: item.content, scopeKind, scopeId, kind: item.kind })) continue;
      const pendingDuplicate = listMemoryCandidates("pending").some((candidate) =>
        candidate.operation === (item.operation === "supersede" ? "create" : item.operation) &&
        candidate.target_memory_id === item.target_memory_id &&
        candidate.proposed_memory?.scope_kind === scopeKind &&
        candidate.proposed_memory.scope_id === scopeId &&
        candidate.proposed_memory.kind === item.kind &&
        candidate.proposed_memory.content.toLowerCase() === item.content.toLowerCase(),
      );
      if (pendingDuplicate) continue;
      const target = item.target_memory_id ? getMemory(item.target_memory_id) : null;
      const proposal: MemoryProposalInput = {
        scope_kind: scopeKind,
        scope_id: scopeId,
        kind: item.kind,
        content: item.content,
        confidence: item.confidence,
        importance: item.importance,
        sensitivity: "sensitivity" in item ? item.sensitivity : "normal",
        tags: item.tags,
          source: {
            origin: "background_review",
            session_id: sessionId,
            message_ids: options.sourceMessageId ? [options.sourceMessageId] : latestUser ? [latestUser.message_id] : [],
          action_id: null,
          provider_id: modeled?.providerConnectionId || null,
          note: "Extracted after a successful Conversation turn.",
        },
        supersedes_memory_id: item.operation === "supersede" ? item.target_memory_id : null,
      };
      const policyOperation = item.operation === "supersede" ? "create" : item.operation;
      const sensitivity = "sensitivity" in item ? item.sensitivity : "normal";
      const risk = deriveMemoryRisk({ operation: policyOperation, kind: item.kind, sensitivity, confidence: item.confidence });
      const decision = decideMemoryMutation({ session, operation: policyOperation, origin: "background_review", risk, sensitivity });
      if (decision.outcome === "commit" && agentMemoryPolicy.write_mode === "automatic") {
        const memory = item.operation === "delete"
          ? item.target_memory_id ? deleteMemory(item.target_memory_id, "agent:background-review") : null
          : item.operation === "update"
            ? item.target_memory_id ? updateMemory(item.target_memory_id, proposal, "agent:background-review") : null
            : createMemory(proposal, { origin: "background_review", createdBy: "agent:background-review" });
        if (memory) base.committed_memory_ids.push(memory.memory_id);
      } else {
        const candidate = createMemoryCandidate({
          operation: policyOperation,
          target_memory_id: item.target_memory_id,
          proposed_memory: policyOperation === "delete" ? undefined : proposal,
          source: proposal.source,
          rationale: `${decision.reason} ${"rationale" in item ? item.rationale : ""}`.trim(),
          risk: decision.risk,
          autonomy_mode: decision.mode,
          proposed_by: "agent:background-review",
        });
        base.candidate_ids.push(candidate.candidate_id);
      }
    }
    base.reason = base.candidate_ids.length || base.committed_memory_ids.length ? null : "no_durable_memory_detected";
    recordMemoryBackgroundReview(base.candidate_ids.length, base.committed_memory_ids.length);
    return saveReview(base);
  } catch (error) {
    base.status = "failed";
    base.reason = error instanceof Error ? error.message : "background_review_failed";
    recordMemoryBackgroundReview(0, 0);
    return saveReview(base);
  }
}
