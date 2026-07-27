import path from "node:path";
import { MEMORY_TIER_STATE_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { MemoryRecord, MemoryRetrievalEvidence } from "./types.js";
import { nowIso } from "./utils.js";

export type MemoryTemperatureTier = "core" | "working" | "peripheral";

export interface MemoryTierState {
  schema_version: 1;
  memory_id: string;
  workspace_id: string;
  tier: MemoryTemperatureTier;
  access_count: number;
  consecutive_hits: number;
  activation_score: number;
  last_accessed_at: string | null;
  last_promoted_at: string | null;
  last_demoted_at: string | null;
  updated_at: string;
}

function tierPath(workspaceId: string, memoryId: string): string {
  return path.join(
    MEMORY_TIER_STATE_DIR,
    encodeURIComponent(workspaceId),
    `${encodeURIComponent(memoryId)}.json`,
  );
}

function initialTier(memory: MemoryRecord): MemoryTemperatureTier {
  const durableKind = memory.kind === "preference" || memory.kind === "decision" || memory.kind === "convention";
  if (memory.importance >= 0.9 || (durableKind && memory.importance >= 0.8 && memory.confidence >= 0.8)) {
    return "core";
  }
  if (memory.importance >= 0.55 || memory.confidence >= 0.75) return "working";
  return "peripheral";
}

function initialScore(memory: MemoryRecord): number {
  return Number(Math.min(1, memory.importance * 0.62 + memory.confidence * 0.38).toFixed(6));
}

function normalizeState(memory: MemoryRecord, value?: Partial<MemoryTierState> | null): MemoryTierState {
  const timestamp = nowIso();
  return {
    schema_version: 1,
    memory_id: memory.memory_id,
    workspace_id: memory.workspace_id,
    tier: value?.tier === "core" || value?.tier === "working" || value?.tier === "peripheral"
      ? value.tier
      : initialTier(memory),
    access_count: Number.isFinite(value?.access_count) ? Math.max(0, Math.floor(value!.access_count!)) : 0,
    consecutive_hits: Number.isFinite(value?.consecutive_hits) ? Math.max(0, Math.floor(value!.consecutive_hits!)) : 0,
    activation_score: Number.isFinite(value?.activation_score)
      ? Math.max(0, Math.min(1, Number(value!.activation_score)))
      : initialScore(memory),
    last_accessed_at: typeof value?.last_accessed_at === "string" ? value.last_accessed_at : null,
    last_promoted_at: typeof value?.last_promoted_at === "string" ? value.last_promoted_at : null,
    last_demoted_at: typeof value?.last_demoted_at === "string" ? value.last_demoted_at : null,
    updated_at: typeof value?.updated_at === "string" ? value.updated_at : timestamp,
  };
}

export function getMemoryTierState(memory: MemoryRecord): MemoryTierState {
  const storage = getJsonStorageBackend();
  const file = tierPath(memory.workspace_id, memory.memory_id);
  if (!storage.exists(file)) return normalizeState(memory);
  try {
    return normalizeState(memory, storage.readJson<Partial<MemoryTierState>>(file));
  } catch {
    return normalizeState(memory);
  }
}

function tierRank(tier: MemoryTemperatureTier): number {
  return tier === "core" ? 3 : tier === "working" ? 2 : 1;
}

function tierForScore(memory: MemoryRecord, score: number, accessCount: number): MemoryTemperatureTier {
  if (memory.importance >= 0.92 || score >= 0.86 || (score >= 0.78 && accessCount >= 5)) return "core";
  if (score >= 0.43 || accessCount >= 2) return "working";
  return "peripheral";
}

export function recordMemoryAccesses(memories: MemoryRecord[], accessedAt = nowIso()): MemoryTierState[] {
  const storage = getJsonStorageBackend();
  return memories.map((memory) => {
    const current = getMemoryTierState(memory);
    const accessCount = current.access_count + 1;
    const activationScore = Number(Math.min(
      1,
      current.activation_score * 0.72 + memory.importance * 0.16 + memory.confidence * 0.08 + 0.12,
    ).toFixed(6));
    const tier = tierForScore(memory, activationScore, accessCount);
    const promoted = tierRank(tier) > tierRank(current.tier);
    const state: MemoryTierState = {
      ...current,
      tier,
      access_count: accessCount,
      consecutive_hits: current.consecutive_hits + 1,
      activation_score: activationScore,
      last_accessed_at: accessedAt,
      last_promoted_at: promoted ? accessedAt : current.last_promoted_at,
      updated_at: accessedAt,
    };
    storage.writeJson(tierPath(memory.workspace_id, memory.memory_id), state);
    return state;
  });
}

export function maintainMemoryTiers(memories: MemoryRecord[], maintainedAt = nowIso()): MemoryTierState[] {
  const storage = getJsonStorageBackend();
  const now = Date.parse(maintainedAt);
  return memories.map((memory) => {
    const current = getMemoryTierState(memory);
    const ageDays = current.last_accessed_at
      ? Math.max(0, (now - Date.parse(current.last_accessed_at)) / 86_400_000)
      : Math.max(0, (now - Date.parse(memory.updated_at)) / 86_400_000);
    const halfLifeDays = current.tier === "core" ? 180 : current.tier === "working" ? 45 : 14;
    const decay = Math.pow(0.5, ageDays / halfLifeDays);
    const floor = memory.importance * 0.42 + memory.confidence * 0.18;
    const activationScore = Number(Math.max(floor, current.activation_score * decay).toFixed(6));
    const tier = tierForScore(memory, activationScore, current.access_count);
    const demoted = tierRank(tier) < tierRank(current.tier);
    const state: MemoryTierState = {
      ...current,
      tier,
      consecutive_hits: ageDays >= 1 ? 0 : current.consecutive_hits,
      activation_score: activationScore,
      last_demoted_at: demoted ? maintainedAt : current.last_demoted_at,
      updated_at: maintainedAt,
    };
    storage.writeJson(tierPath(memory.workspace_id, memory.memory_id), state);
    return state;
  });
}

export function memoryWorkingSetScore(input: {
  memory: MemoryRecord;
  evidence: Pick<MemoryRetrievalEvidence, "fused_score">;
  pinned: boolean;
}): { score: number; tier: MemoryTemperatureTier; state: MemoryTierState } {
  const state = getMemoryTierState(input.memory);
  const tierBoost = state.tier === "core" ? 0.16 : state.tier === "working" ? 0.07 : 0;
  const score = Math.min(1, input.evidence.fused_score * 0.58
    + input.memory.importance * 0.16
    + input.memory.confidence * 0.08
    + state.activation_score * 0.12
    + tierBoost
    + (input.pinned ? 0.18 : 0));
  return { score: Number(score.toFixed(8)), tier: state.tier, state };
}
