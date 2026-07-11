import type {
  TraceProjection,
  TraceSpan,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export type TraceResponse = TraceProjection;

export interface TraceCommandOptions {
  node?: string;
  kind?: string;
  json?: boolean;
}

function query(runId: string, options: TraceCommandOptions, cursor?: string | null): string {
  const params = new URLSearchParams({ limit: "200" });
  if (options.node) params.set("node_run_id", options.node);
  if (options.kind) params.set("kind", options.kind);
  if (cursor) params.set("cursor", cursor);
  return `/api/runs/${encodeURIComponent(runId)}/trace?${params}`;
}

function duration(span: TraceSpan): string {
  if (!span.finished_at) return "open";
  const milliseconds = Date.parse(span.finished_at) - Date.parse(span.started_at);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? `${milliseconds}ms` : "unknown";
}

function render(response: TraceResponse, io: CommandIo): void {
  io.stdout(`${response.run_id} trace=${response.trace_id} completeness=${response.completeness}`);
  const byId = new Map(response.spans.map((span) => [span.span_id, span]));
  const depth = (span: TraceSpan): number => {
    let current = span.parent_span_id;
    let value = 0;
    const visited = new Set<string>();
    while (current && byId.has(current) && !visited.has(current)) {
      visited.add(current);
      value += 1;
      current = byId.get(current)!.parent_span_id;
    }
    return value;
  };
  for (const span of response.spans) {
    const detail = [
      span.provider ? `provider=${span.provider}` : null,
      span.model ? `model=${span.model}` : null,
      span.tool_call_id ? `tool_call=${span.tool_call_id}` : null,
      span.usage?.total_tokens !== null && span.usage?.total_tokens !== undefined
        ? `tokens=${span.usage.total_tokens}`
        : null,
    ].filter(Boolean).join(" ");
    io.stdout(`${"  ".repeat(depth(span))}[${span.status}] ${span.kind} ${span.name} (${duration(span)})${detail ? ` ${detail}` : ""}`);
  }
}

export async function executeTrace(
  client: ApiClientLike,
  runId: string,
  options: TraceCommandOptions,
  io: CommandIo,
): Promise<{ exitCode: number; result: TraceResponse | null }> {
  try {
    let response = await client.get<TraceResponse>(query(runId, options));
    const spans = [...response.spans];
    while (response.has_more && response.cursor) {
      response = await client.get<TraceResponse>(query(runId, options, response.cursor));
      spans.push(...response.spans);
    }
    const result = { ...response, spans, cursor: null, has_more: false };
    if (options.json) writeJson(io, result);
    else render(result, io);
    return { exitCode: 0, result };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
