import type { WorkerEvidence } from "../runtime-protocol.js";
import type { RuntimeJobRecord } from "./runtime-job-store.js";
import { sumDecimalStrings } from "../evaluation/pricing/decimal.js";

type Completeness = "complete" | "partial" | "unavailable";

function completeness(totalJobs: number, availableJobs: number): Completeness {
  if (totalJobs === 0 || availableJobs === 0) return "unavailable";
  return availableJobs === totalJobs ? "complete" : "partial";
}

export function latestUsageEvidenceByJob(
  evidence: WorkerEvidence[],
): Map<string, WorkerEvidence> {
  const latest = new Map<string, WorkerEvidence>();
  for (const item of evidence) {
    if (item.kind === "usage" && item.usage) latest.set(item.job_id, item);
  }
  return latest;
}

export function classifyEvidenceCostCompleteness(
  modelJobIds: string[],
  evidence: WorkerEvidence[],
): Completeness {
  const latest = latestUsageEvidenceByJob(evidence);
  const availableJobs = modelJobIds.filter((jobId) => {
    const usage = latest.get(jobId)?.usage;
    return Boolean(usage?.provider_reported_cost || usage?.estimated_cost);
  }).length;
  return completeness(modelJobIds.length, availableJobs);
}

function aggregateMoney(
  values: Array<{ currency: string; amount_decimal: string }>,
): Record<string, string> {
  const byCurrency = new Map<string, string[]>();
  for (const value of values) {
    byCurrency.set(value.currency, [...(byCurrency.get(value.currency) || []), value.amount_decimal]);
  }
  return Object.fromEntries(
    [...byCurrency.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amounts]) => [currency, sumDecimalStrings(amounts)]),
  );
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

export function buildProviderEvidenceProjection(
  jobs: RuntimeJobRecord[],
  evidence: WorkerEvidence[],
) {
  const modelJobs = jobs.filter((job) => job.agent_runtime !== "local");
  const latest = latestUsageEvidenceByJob(evidence);
  const latestUsage = modelJobs.map((job) => {
    const item = latest.get(job.job_id);
    return {
      job_id: job.job_id,
      provider: item?.source?.provider ?? job.agent_runtime,
      model: item?.source?.model ?? null,
      evidence_id: item?.evidence_id ?? null,
      usage: item?.usage ?? null,
    };
  });
  const completeTokenJobs = latestUsage.filter((item) =>
    item.usage?.input_tokens !== null && item.usage?.input_tokens !== undefined &&
    item.usage?.output_tokens !== null && item.usage?.output_tokens !== undefined,
  ).length;
  const providerCostJobs = latestUsage.filter((item) => item.usage?.provider_reported_cost).length;
  const estimatedCostJobs = latestUsage.filter((item) => item.usage?.estimated_cost).length;
  const toolCalls = evidence.filter((item) => item.kind === "tool_call").map((item) => ({
    evidence_id: item.evidence_id,
    job_id: item.job_id,
    tool_call_id: item.trace?.tool_call_id ?? null,
    summary: item.summary,
    created_at: item.created_at,
  }));
  const toolResults = evidence.filter((item) => item.kind === "tool_result").map((item) => ({
    evidence_id: item.evidence_id,
    job_id: item.job_id,
    tool_call_id: item.trace?.tool_call_id ?? null,
    summary: item.summary,
    created_at: item.created_at,
  }));
  const resultIds = new Set(
    toolResults.map((item) => item.tool_call_id).filter((item): item is string => Boolean(item)),
  );
  const openToolCallIds = [...new Set(
    toolCalls.map((item) => item.tool_call_id)
      .filter((item): item is string => Boolean(item) && !resultIds.has(item as string)),
  )];
  return {
    model_job_count: modelJobs.length,
    native_evidence_count: evidence.filter((item) => item.source?.synthetic === false).length,
    usage: {
      latest_by_job: latestUsage,
      token_completeness: completeness(modelJobs.length, completeTokenJobs),
      provider_reported_cost_completeness: completeness(modelJobs.length, providerCostJobs),
      estimated_cost_completeness: completeness(modelJobs.length, estimatedCostJobs),
      aggregate_tokens: {
        input_tokens: sumKnown(latestUsage.map((item) => item.usage?.input_tokens ?? null)),
        output_tokens: sumKnown(latestUsage.map((item) => item.usage?.output_tokens ?? null)),
        cache_read_tokens: sumKnown(latestUsage.map((item) => item.usage?.cache_read_tokens ?? null)),
        cache_write_tokens: sumKnown(latestUsage.map((item) => item.usage?.cache_write_tokens ?? null)),
        reasoning_tokens: sumKnown(latestUsage.map((item) => item.usage?.reasoning_tokens ?? null)),
        total_tokens: sumKnown(latestUsage.map((item) => item.usage?.total_tokens ?? null)),
      },
      provider_reported_costs: aggregateMoney(
        latestUsage.flatMap((item) => item.usage?.provider_reported_cost ? [item.usage.provider_reported_cost] : []),
      ),
      estimated_costs: aggregateMoney(
        latestUsage.flatMap((item) => item.usage?.estimated_cost ? [item.usage.estimated_cost] : []),
      ),
    },
    tools: {
      calls: toolCalls,
      results: toolResults,
      open_tool_call_ids: openToolCallIds,
    },
  };
}
