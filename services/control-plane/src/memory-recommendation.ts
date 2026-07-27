import {
  listMemoryOverlays,
  listRecommendationFeedback,
  listTurnMemoryContexts,
  recommendationDigest,
} from "./memory-activation-store.js";
import { getMemorySettings } from "./memory-settings-store.js";
import { getCoreMemorySnapshot } from "./memory-snapshot-store.js";
import { listMemories } from "./memory-store.js";
import { listSharedMemoryViews } from "./memory-sharing-store.js";
import { getActivePrincipalId } from "./request-security.js";
import { listSessionMessages } from "./session-message-store.js";
import { getTaskWorkspace } from "./task-workspace-store.js";
import type {
  MemoryRecommendation,
  MemoryRecord,
  SessionMessageRecord,
  SessionRecord,
} from "./types.js";
import { resolveSessionAgentId } from "./session-agent-id.js";

const MAX_RECOMMENDATIONS = 8;
const MIN_RELEVANCE_SCORE = 0.12;

function messageText(message: SessionMessageRecord): string {
  for (const key of ["text", "narrative_reply", "turn_summary", "summary"]) {
    const value = message.content?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function searchTerms(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/\s+/gu, " ").trim();
  const terms = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 2));
  for (const segment of normalized.match(/\p{Script=Han}+/gu) || []) {
    for (let index = 0; index < segment.length - 1; index += 1) terms.add(segment.slice(index, index + 2));
  }
  return terms;
}

function relevanceScore(query: Set<string>, memory: MemoryRecord): number {
  if (!query.size) return 0;
  const candidate = searchTerms(`${memory.content} ${memory.tags.join(" ")}`);
  let matches = 0;
  for (const term of query) if (candidate.has(term)) matches += 1;
  if (!matches) return 0;
  const overlap = matches / query.size;
  return Number(Math.min(1, overlap * 0.72 + memory.importance * 0.18 + memory.confidence * 0.1).toFixed(4));
}

function currentlyValid(memory: MemoryRecord, timestamp: string): boolean {
  if (memory.status !== "active") return false;
  if (memory.valid_from && memory.valid_from > timestamp) return false;
  if (memory.valid_until && memory.valid_until <= timestamp) return false;
  if (memory.expires_at && memory.expires_at <= timestamp) return false;
  return true;
}

function visibleToSession(memory: MemoryRecord, session: SessionRecord, principalId: string): boolean {
  const workspaceId = session.workspace_id || "default";
  if (memory.workspace_id !== workspaceId || memory.sensitivity === "restricted") return false;
  if (memory.scope_kind === "workspace") return memory.scope_id === workspaceId;
  if (memory.scope_kind === "user") return memory.scope_id === principalId;
  if (memory.scope_kind === "project") return memory.scope_id === getTaskWorkspace(session.session_id)?.project_id;
  return getMemorySettings(workspaceId).scope_policy.agent_memory_enabled && memory.scope_id === resolveSessionAgentId(session);
}

function summary(memory: MemoryRecord): string {
  return memory.content.length > 180 ? `${memory.content.slice(0, 177).trimEnd()}...` : memory.content;
}

function reason(memory: MemoryRecord, score: number, alreadyInSnapshot: boolean): string {
  const location = `${memory.scope_kind} ${memory.kind}`;
  const state = alreadyInSnapshot
    ? "is already available in this Task's frozen Core Memory snapshot"
    : "was not included in this Task's frozen Core Memory snapshot";
  return `This ${location} matches the current goal or latest request (relevance ${score.toFixed(2)}) and ${state}.`;
}

export function listSessionMemoryRecommendations(
  session: SessionRecord,
  options: { limit?: number; now?: string } = {},
): MemoryRecommendation[] {
  const workspaceId = session.workspace_id || "default";
  const principalId = getActivePrincipalId() || session.created_by;
  const messages = listSessionMessages(session.session_id);
  const latestUser = [...messages].reverse().find((message) => message.role === "user" && messageText(message));
  const queryText = [session.current_goal, latestUser ? messageText(latestUser) : "", session.title]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join("\n");
  const query = searchTerms(queryText);
  if (!query.size) return [];

  const timestamp = options.now || new Date().toISOString();
  const snapshot = getCoreMemorySnapshot(session.session_id, workspaceId);
  const snapshotVersions = snapshot?.memory_versions || {};
  const limit = Math.min(MAX_RECOMMENDATIONS, Math.max(1, Math.floor(options.limit || 5)));
  const feedback = listRecommendationFeedback(session.session_id, workspaceId);
  const overlays = listMemoryOverlays(session.session_id, workspaceId);
  const contexts = listTurnMemoryContexts(session.session_id, workspaceId);

  return [
    ...listMemories({ status: "active", limit: 500 }),
    ...listSharedMemoryViews(workspaceId).map((item) => item.projected_memory),
  ]
    .filter((memory) => currentlyValid(memory, timestamp))
    .filter((memory) => visibleToSession(memory, session, principalId))
    .filter((memory) => !feedback.some((item) =>
      item.memory_id === memory.memory_id &&
      item.memory_version === memory.version &&
      item.action === "dismiss_for_session",
    ))
    .map((memory) => {
      const base = relevanceScore(query, memory);
      const matching = feedback.filter((item) => item.memory_id === memory.memory_id && item.memory_version === memory.version);
      const boost = Math.min(0.08, matching.filter((item) => item.action === "use_next_turn" || item.action === "keep_for_session").length * 0.02);
      const penalty = Math.min(0.08, matching.filter((item) => item.action === "not_relevant").length * 0.02);
      return { memory, score: Number(Math.max(0, Math.min(1, base + boost - penalty)).toFixed(4)) };
    })
    .filter(({ score }) => score >= MIN_RELEVANCE_SCORE)
    .sort((left, right) => right.score - left.score || right.memory.updated_at.localeCompare(left.memory.updated_at))
    .slice(0, limit)
    .map(({ memory, score }) => {
      const snapshotVersion = snapshotVersions[memory.memory_id] || null;
      const alreadyInSnapshot = snapshotVersion === memory.version;
      const recommendationId = recommendationDigest(session.session_id, memory.memory_id, memory.version, queryText);
      const overlay = overlays.find((item) =>
        item.memory_id === memory.memory_id && item.memory_version === memory.version &&
        (item.status === "queued" || item.status === "active"),
      );
      const appliedContext = contexts.find((context) => context.entries.some((entry) =>
        entry.memory_id === memory.memory_id && entry.memory_version === memory.version,
      ));
      const applicationState: MemoryRecommendation["application_state"] = overlay
        ? overlay.mode === "next_turn" ? "queued" : "kept"
        : appliedContext ? "applied" : "available";
      return {
        schema_version: 1,
        session_id: session.session_id,
        memory_id: memory.memory_id,
        memory_version: memory.version,
        scope_kind: memory.scope_kind,
        scope_id: memory.scope_id,
        kind: memory.kind,
        sensitivity: memory.sensitivity as MemoryRecommendation["sensitivity"],
        title: `${memory.kind[0].toUpperCase()}${memory.kind.slice(1)} memory`,
        summary: summary(memory),
        reason: reason(memory, score, alreadyInSnapshot),
        score,
        already_in_snapshot: alreadyInSnapshot,
        applied_automatically: Boolean(appliedContext),
        snapshot_version: snapshotVersion,
        updated_at: memory.updated_at,
        recommendation_id: recommendationId,
        application_state: applicationState,
        last_applied_context_id: appliedContext?.context_id || null,
        available_actions: [
          "use_next_turn",
          "keep_for_session",
          "dismiss_for_session",
          "not_relevant",
          ...(memory.source.provider_id === "memory-sharing" ? [] : ["edit_requested", "forget_requested"] as const),
        ],
      };
    });
}

export function isRecommendationNewerThanSnapshot(
  recommendation: MemoryRecommendation,
  snapshotCreatedAt: string | null,
): boolean {
  if (recommendation.snapshot_version !== null) {
    return recommendation.memory_version > recommendation.snapshot_version;
  }
  return Boolean(snapshotCreatedAt && recommendation.updated_at > snapshotCreatedAt);
}
