import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CONTEXT_COMPACTION_LEASES_DIR } from "./config.js";
import type { SessionMessageRecord, SessionRecord } from "./types.js";
import { maintainMemoryTiers } from "./memory-tier-store.js";
import { listAllMemories } from "./memory-store.js";

export interface ContextWorkingSetMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ContextSegment {
  id: string;
  content: string | null;
  priority: number;
  required?: boolean;
  max_token_share?: number;
}

export interface ContextAssemblyResult {
  system: string;
  history: ContextWorkingSetMessage[];
  query: string;
  metrics: {
    schema_version: 1;
    max_input_tokens: number;
    reserved_tokens: number;
    system_tokens: number;
    history_tokens: number;
    included_segments: string[];
    omitted_segments: string[];
  };
}

export interface ContextEngine {
  ingest(session: SessionRecord, messages: SessionMessageRecord[], textOf: (message: SessionMessageRecord) => string): string;
  assemble(input: {
    session: SessionRecord;
    messages: SessionMessageRecord[];
    segments: ContextSegment[];
    maxInputTokens: number;
    reservedTokens: number;
    estimateTokens: (value: string) => number;
    selectHistory: (maxTokens: number) => ContextWorkingSetMessage[];
    truncate: (value: string, maxTokens: number) => string;
    textOf: (message: SessionMessageRecord) => string;
  }): ContextAssemblyResult;
  compact<T>(input: { workspaceId: string; sessionId: string; execute: () => Promise<T> }): Promise<{ acquired: boolean; value: T | null }>;
  afterTurn(session: SessionRecord, assembly: ContextAssemblyResult): void;
  maintain(workspaceId: string): void;
}

interface CompactionLease {
  lease_id: string;
  owner_id: string;
  expires_at: string;
}

function leasePath(workspaceId: string, sessionId: string): string {
  return path.join(
    CONTEXT_COMPACTION_LEASES_DIR,
    encodeURIComponent(workspaceId),
    `${encodeURIComponent(sessionId)}.json`,
  );
}

function readLease(file: string): CompactionLease | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as CompactionLease;
  } catch {
    return null;
  }
}

function compactionLeaseTtlMs(): number {
  const configured = Number(process.env.MY_MATE_CONTEXT_COMPACTION_LEASE_TTL_MS);
  return Number.isFinite(configured)
    ? Math.max(120_000, Math.min(60 * 60_000, Math.trunc(configured)))
    : 35 * 60_000;
}

function acquireLease(workspaceId: string, sessionId: string): { file: string; lease: CompactionLease } | null {
  const file = leasePath(workspaceId, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = readLease(file);
  if (current && Date.parse(current.expires_at) > Date.now()) return null;
  if (current) {
    try { fs.rmSync(file, { force: true }); } catch { return null; }
  }
  const lease: CompactionLease = {
    lease_id: randomUUID(),
    owner_id: `${os.hostname()}:${process.pid}`,
    expires_at: new Date(Date.now() + compactionLeaseTtlMs()).toISOString(),
  };
  try {
    const descriptor = fs.openSync(file, "wx");
    try { fs.writeFileSync(descriptor, `${JSON.stringify(lease, null, 2)}\n`, "utf8"); } finally { fs.closeSync(descriptor); }
    return { file, lease };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String(error.code) === "EEXIST") return null;
    throw error;
  }
}

function releaseLease(acquired: { file: string; lease: CompactionLease }): void {
  const current = readLease(acquired.file);
  if (current?.lease_id !== acquired.lease.lease_id) return;
  try { fs.rmSync(acquired.file, { force: true }); } catch { /* the lease expires if cleanup is interrupted */ }
}

function headTail(value: string, maxTokens: number, estimateTokens: (value: string) => number, truncate: (value: string, maxTokens: number) => string): string {
  if (estimateTokens(value) <= maxTokens) return value;
  const headBudget = Math.max(1, Math.floor(maxTokens * 0.7));
  const tailBudget = Math.max(1, maxTokens - headBudget - 16);
  const characters = Array.from(value);
  let tail = "";
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const candidate = `${characters[index]}${tail}`;
    if (estimateTokens(candidate) > tailBudget) break;
    tail = candidate;
  }
  return `${truncate(value, headBudget)}\n[Context segment truncated]\n${tail}`;
}

export class DefaultContextEngine implements ContextEngine {
  ingest(session: SessionRecord, messages: SessionMessageRecord[], textOf: (message: SessionMessageRecord) => string): string {
    const recentUserTurns = messages
      .filter((message) => message.role === "user")
      .map(textOf)
      .filter(Boolean)
      .slice(-3);
    return [session.current_goal, session.current_plan_summary, ...recentUserTurns]
      .filter((value): value is string => typeof value === "string" && !!value.trim())
      .join("\n\n")
      .slice(0, 8_000);
  }

  assemble(input: Parameters<ContextEngine["assemble"]>[0]): ContextAssemblyResult {
    const query = this.ingest(input.session, input.messages, input.textOf);
    let available = Math.max(0, input.maxInputTokens - input.reservedTokens);
    const included: string[] = [];
    const omitted: string[] = [];
    const rendered: string[] = [];
    const populated = input.segments
      .filter((segment): segment is ContextSegment & { content: string } => !!segment.content?.trim())
      .sort((left, right) => Number(right.required) - Number(left.required) || right.priority - left.priority);
    const historyFloor = Math.min(Math.floor(available * 0.3), 16_384);
    for (const segment of populated) {
      const contentTokens = input.estimateTokens(segment.content);
      const maximum = segment.max_token_share
        ? Math.max(128, Math.floor(input.maxInputTokens * segment.max_token_share))
        : contentTokens;
      const spendable = segment.required ? available : Math.max(0, available - historyFloor);
      const budget = Math.min(contentTokens, maximum, spendable);
      if (budget <= 0 || (!segment.required && budget < 64)) {
        omitted.push(segment.id);
        continue;
      }
      const content = headTail(segment.content, budget, input.estimateTokens, input.truncate);
      if (!content) {
        omitted.push(segment.id);
        continue;
      }
      rendered.push(content);
      included.push(segment.id);
      available -= input.estimateTokens(content);
    }
    const history = input.selectHistory(available);
    const historyTokens = history.reduce((total, message) => total + input.estimateTokens(message.content) + 8, 0);
    const system = rendered.join("\n\n");
    return {
      system,
      history,
      query,
      metrics: {
        schema_version: 1,
        max_input_tokens: input.maxInputTokens,
        reserved_tokens: input.reservedTokens,
        system_tokens: input.estimateTokens(system),
        history_tokens: historyTokens,
        included_segments: included,
        omitted_segments: omitted,
      },
    };
  }

  async compact<T>(input: { workspaceId: string; sessionId: string; execute: () => Promise<T> }): Promise<{ acquired: boolean; value: T | null }> {
    const acquired = acquireLease(input.workspaceId, input.sessionId);
    if (!acquired) return { acquired: false, value: null };
    try {
      return { acquired: true, value: await input.execute() };
    } finally {
      releaseLease(acquired);
    }
  }

  afterTurn(session: SessionRecord, assembly: ContextAssemblyResult): void {
    session.metadata = {
      ...(session.metadata || {}),
      context_engine: "default-v1",
      context_working_set_query: assembly.query,
      context_assembly_metrics: assembly.metrics,
      context_assembled_at: new Date().toISOString(),
    };
  }

  maintain(workspaceId: string): void {
    maintainMemoryTiers(listAllMemories({ status: "active" }).filter((memory) => memory.workspace_id === workspaceId));
  }
}

let contextEngine: ContextEngine = new DefaultContextEngine();

export function getContextEngine(): ContextEngine {
  return contextEngine;
}

export function setContextEngineForTests(engine?: ContextEngine): void {
  contextEngine = engine || new DefaultContextEngine();
}
