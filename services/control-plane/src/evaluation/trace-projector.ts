import type { EventRecord, NodeRunRecord, RunRecord } from "../types.js";
import { buildRunEvidenceSnapshot } from "./run-evidence-snapshot.js";
import type {
  TraceProjection,
  TraceSpan,
  TraceSpanKind,
} from "./types.js";

const TERMINAL_RUNS = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_NODES = new Set(["completed", "failed", "skipped", "cancelled"]);
const TERMINAL_JOBS = new Set(["completed", "failed", "cancelled", "rejected"]);

function runStatus(run: RunRecord): TraceSpan["status"] {
  if (run.status === "completed") return "ok";
  if (run.status === "failed" || run.status === "cancelled") return "error";
  return "unknown";
}

function nodeStatus(node: NodeRunRecord): TraceSpan["status"] {
  if (node.status === "completed" || node.status === "skipped") return "ok";
  if (node.status === "failed" || node.status === "cancelled") return "error";
  return "unknown";
}

function eventStatus(event: EventRecord): TraceSpan["status"] {
  if (/failed|rejected|cancelled|blocked/.test(event.type)) return "error";
  return "ok";
}

function encodeCursor(runId: string, offset: number, spanId: string): string {
  return Buffer.from(JSON.stringify({ version: 1, run_id: runId, offset, span_id: spanId }), "utf-8")
    .toString("base64url");
}

function decodeCursor(
  runId: string,
  cursor: string | null | undefined,
): { offset: number; spanId: string | null } {
  if (!cursor) return { offset: 0, spanId: null };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      parsed.run_id !== runId ||
      typeof parsed.offset !== "number" ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 0 ||
      typeof parsed.span_id !== "string"
    ) {
      throw new Error("INVALID_TRACE_CURSOR");
    }
    return { offset: parsed.offset, spanId: parsed.span_id };
  } catch {
    throw new Error("INVALID_TRACE_CURSOR");
  }
}

function sortSpans(spans: TraceSpan[]): TraceSpan[] {
  const kindOrder: Record<TraceSpanKind, number> = {
    run: 0,
    node: 1,
    job: 2,
    model: 3,
    tool: 4,
    handoff: 5,
    artifact: 6,
    control: 7,
  };
  const compare = (left: TraceSpan, right: TraceSpan) =>
    left.started_at.localeCompare(right.started_at) ||
    kindOrder[left.kind] - kindOrder[right.kind] ||
    left.span_id.localeCompare(right.span_id);
  const byId = new Map(spans.map((span) => [span.span_id, span]));
  const children = new Map<string | null, TraceSpan[]>();
  for (const span of spans) {
    const parent = span.parent_span_id && byId.has(span.parent_span_id)
      ? span.parent_span_id
      : null;
    children.set(parent, [...(children.get(parent) || []), span]);
  }
  const ordered: TraceSpan[] = [];
  const visited = new Set<string>();
  const visit = (span: TraceSpan) => {
    if (visited.has(span.span_id)) return;
    visited.add(span.span_id);
    ordered.push(span);
    for (const child of (children.get(span.span_id) || []).sort(compare)) visit(child);
  };
  for (const root of (children.get(null) || []).sort(compare)) visit(root);
  for (const span of [...spans].sort(compare)) visit(span);
  return ordered;
}

export function projectTraceSpans(runId: string): {
  traceId: string;
  completeness: TraceProjection["completeness"];
  spans: TraceSpan[];
} {
  const snapshot = buildRunEvidenceSnapshot(runId, { allowIncomplete: true });
  const traceId = `trace:${runId}`;
  const spans: TraceSpan[] = [];
  const runSpanId = `run:${runId}`;
  spans.push({
    span_id: runSpanId,
    parent_span_id: null,
    trace_id: traceId,
    run_id: runId,
    node_run_id: null,
    job_id: null,
    kind: "run",
    name: snapshot.route.template_name,
    status: runStatus(snapshot.run),
    started_at: snapshot.run.created_at,
    finished_at: TERMINAL_RUNS.has(snapshot.run.status) ? snapshot.run.finished_at : null,
    input_ref: `run-inputs:${runId}`,
    output_ref: snapshot.run.finished_at ? `run:${runId}` : null,
    tool_call_id: null,
    provider: null,
    model: null,
    usage: null,
    attributes: {
      route_id: snapshot.route.route_id,
      route_source: snapshot.route.source_kind,
      status: snapshot.run.status,
      source_run_id: snapshot.run.source_run_id || null,
    },
  });

  const compiledByRunId = new Map(
    snapshot.effective_plan.compiled_nodes.map((node) => [node.node_run_id, node]),
  );
  for (const node of snapshot.node_runs) {
    const compiled = compiledByRunId.get(node.node_run_id);
    spans.push({
      span_id: `node:${node.node_run_id}`,
      parent_span_id: runSpanId,
      trace_id: traceId,
      run_id: runId,
      node_run_id: node.node_run_id,
      job_id: null,
      kind: "node",
      name: compiled?.name || compiled?.node_id || node.node_run_id,
      status: nodeStatus(node),
      started_at: node.started_at || node.progress.updated_at || snapshot.run.created_at,
      finished_at: TERMINAL_NODES.has(node.status) ? node.finished_at : null,
      input_ref: `plan-node:${node.node_run_id}`,
      output_ref: node.finished_at ? `node-run:${node.node_run_id}` : null,
      tool_call_id: null,
      provider: null,
      model: null,
      usage: null,
      attributes: {
        node_id: compiled?.node_id || null,
        node_type: compiled?.type || null,
        status: node.status,
        attempt: node.attempt,
        work_package: compiled?.work_package?.key || null,
      },
    });
  }

  const evidenceByJob = new Map<string, typeof snapshot.evidence>();
  for (const item of snapshot.evidence) {
    evidenceByJob.set(item.job_id, [...(evidenceByJob.get(item.job_id) || []), item]);
  }
  for (const job of snapshot.runtime_jobs) {
    const jobSpanId = `job:${job.job_id}`;
    const jobEvidence = evidenceByJob.get(job.job_id) || [];
    spans.push({
      span_id: jobSpanId,
      parent_span_id: `node:${job.node_run_id}`,
      trace_id: traceId,
      run_id: runId,
      node_run_id: job.node_run_id,
      job_id: job.job_id,
      kind: "job",
      name: `Attempt ${job.attempt}`,
      status: job.status === "completed" ? "ok" : TERMINAL_JOBS.has(job.status) ? "error" : "unknown",
      started_at: job.created_at,
      finished_at: TERMINAL_JOBS.has(job.status) ? job.finished_at : null,
      input_ref: `runtime-job:${job.job_id}`,
      output_ref: job.finished_at ? `runtime-job-result:${job.job_id}` : null,
      tool_call_id: null,
      provider: job.agent_runtime,
      model: null,
      usage: null,
      attributes: {
        status: job.status,
        target_kind: job.target_kind,
        worker_id: job.worker_id,
        lease_id: job.lease_id,
        dispatch_sequence: job.dispatch_sequence,
      },
    });

    if (jobEvidence.length > 0) {
      const first = jobEvidence[0]!;
      const last = jobEvidence.at(-1)!;
      const usage = [...jobEvidence].reverse().find((item) => item.kind === "usage" && item.usage)?.usage || null;
      const modelSpanId = `model:${job.job_id}`;
      const synthetic = jobEvidence.every((item) => item.source?.synthetic !== false);
      spans.push({
        span_id: modelSpanId,
        parent_span_id: jobSpanId,
        trace_id: traceId,
        run_id: runId,
        node_run_id: job.node_run_id,
        job_id: job.job_id,
        kind: "model",
        name: synthetic ? "Harness evidence" : `${first.source?.provider || job.agent_runtime} model turn`,
        status: jobEvidence.some((item) => item.kind === "error")
          ? "error"
          : TERMINAL_JOBS.has(job.status)
            ? "ok"
            : "unknown",
        started_at: first.created_at,
        finished_at: TERMINAL_JOBS.has(job.status) ? last.created_at : null,
        input_ref: jobEvidence.find((item) => item.kind === "prompt")?.input_ref || null,
        output_ref: [...jobEvidence].reverse().find((item) => item.kind === "model_text")?.output_ref || null,
        tool_call_id: null,
        provider: first.source?.provider || job.agent_runtime,
        model: first.source?.model || null,
        usage,
        attributes: {
          evidence_count: jobEvidence.length,
          synthetic,
          redacted_count: jobEvidence.filter((item) => item.redaction_status === "redacted").length,
          blocked_count: jobEvidence.filter((item) => item.redaction_status === "blocked").length,
        },
      });

      const calls = jobEvidence.filter((item) => item.kind === "tool_call");
      for (const call of calls) {
        const nativeToolCallId = call.trace?.tool_call_id || null;
        const toolCallId = nativeToolCallId || call.evidence_id;
        const result = nativeToolCallId
          ? jobEvidence.find((item) =>
              item.kind === "tool_result" && item.trace?.tool_call_id === nativeToolCallId,
            )
          : undefined;
        spans.push({
          span_id: `tool:${job.job_id}:${toolCallId}`,
          parent_span_id: modelSpanId,
          trace_id: traceId,
          run_id: runId,
          node_run_id: job.node_run_id,
          job_id: job.job_id,
          kind: "tool",
          name: call.summary,
          status: result ? "ok" : "unknown",
          started_at: call.created_at,
          finished_at: result?.created_at || null,
          input_ref: call.input_ref || null,
          output_ref: result?.output_ref || null,
          tool_call_id: call.trace?.tool_call_id || null,
          provider: call.source?.provider || null,
          model: call.source?.model || null,
          usage: null,
          attributes: {
            call_evidence_id: call.evidence_id,
            result_evidence_id: result?.evidence_id || null,
            synthetic: call.source?.synthetic ?? true,
          },
        });
      }
    }
  }

  const jobByNode = new Map(snapshot.runtime_jobs.map((job) => [job.node_run_id, job]));
  for (const handoff of snapshot.handoffs) {
    const job = snapshot.runtime_jobs.find((item) => item.job_id === handoff.job_id) || jobByNode.get(handoff.node_run_id);
    spans.push({
      span_id: `handoff:${handoff.handoff_id}`,
      parent_span_id: job ? `job:${job.job_id}` : `node:${handoff.node_run_id}`,
      trace_id: traceId,
      run_id: runId,
      node_run_id: handoff.node_run_id,
      job_id: handoff.job_id || job?.job_id || null,
      kind: "handoff",
      name: handoff.summary || `Handoff ${handoff.port}`,
      status: "ok",
      started_at: handoff.created_at,
      finished_at: handoff.created_at,
      input_ref: null,
      output_ref: handoff.content_ref || null,
      tool_call_id: null,
      provider: null,
      model: null,
      usage: null,
      attributes: {
        port: handoff.port,
        routed_nodes: handoff.routed_node_run_ids.length,
        skipped_nodes: handoff.skipped_node_run_ids.length,
      },
    });
  }

  for (const artifact of snapshot.artifacts) {
    const job = artifact.node_run_id ? jobByNode.get(artifact.node_run_id) : null;
    spans.push({
      span_id: `artifact:${artifact.artifact_id}`,
      parent_span_id: job
        ? `job:${job.job_id}`
        : artifact.node_run_id
          ? `node:${artifact.node_run_id}`
          : runSpanId,
      trace_id: traceId,
      run_id: runId,
      node_run_id: artifact.node_run_id,
      job_id: job?.job_id || null,
      kind: "artifact",
      name: artifact.name,
      status: "ok",
      started_at: artifact.created_at,
      finished_at: artifact.created_at,
      input_ref: null,
      output_ref: artifact.storage_uri,
      tool_call_id: null,
      provider: null,
      model: null,
      usage: null,
      attributes: {
        artifact_type: artifact.type,
        mime_type: artifact.mime_type,
        size_bytes: artifact.size_bytes,
      },
    });
  }

  const controlTypes = /^(approval\.|human_input\.|runtime\.patch_|run\.(paused|resumed|blocked|cancelled|failed)|scorecard\.|evaluation\.)/;
  for (const event of snapshot.events.filter((item) => controlTypes.test(item.type))) {
    spans.push({
      span_id: `control:${event.event_id}`,
      parent_span_id: event.node_run_id ? `node:${event.node_run_id}` : runSpanId,
      trace_id: traceId,
      run_id: runId,
      node_run_id: event.node_run_id,
      job_id: typeof event.payload.job_id === "string" ? event.payload.job_id : null,
      kind: "control",
      name: event.type,
      status: eventStatus(event),
      started_at: event.created_at,
      finished_at: event.created_at,
      input_ref: null,
      output_ref: `event:${event.event_id}`,
      tool_call_id: null,
      provider: null,
      model: null,
      usage: null,
      attributes: {
        actor_type: event.actor_type,
        actor_id: event.actor_id,
        run_sequence: event.run_sequence || null,
      },
    });
  }

  return {
    traceId,
    completeness: snapshot.completeness.events === "complete" ? "complete" : "legacy_partial",
    spans: sortSpans(spans),
  };
}

export function buildTraceProjection(input: {
  runId: string;
  nodeRunId?: string | null;
  kind?: TraceSpanKind | null;
  cursor?: string | null;
  limit?: number;
}): TraceProjection {
  const projected = projectTraceSpans(input.runId);
  let spans = projected.spans;
  if (input.nodeRunId) {
    spans = spans.filter((span) => span.kind === "run" || span.node_run_id === input.nodeRunId);
  }
  if (input.kind) spans = spans.filter((span) => span.kind === input.kind);
  const decoded = decodeCursor(input.runId, input.cursor);
  const offset = decoded.offset;
  if (
    offset > spans.length ||
    (offset > 0 && decoded.spanId !== spans[offset - 1]?.span_id)
  ) {
    throw new Error("INVALID_TRACE_CURSOR");
  }
  const limit = Math.min(500, Math.max(1, Math.floor(input.limit || 200)));
  const page = spans.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < spans.length;
  return {
    schema_version: 1,
    run_id: input.runId,
    trace_id: projected.traceId,
    completeness: projected.completeness,
    spans: page,
    cursor: hasMore && page.length > 0
      ? encodeCursor(input.runId, nextOffset, page.at(-1)!.span_id)
      : null,
    has_more: hasMore,
  };
}
