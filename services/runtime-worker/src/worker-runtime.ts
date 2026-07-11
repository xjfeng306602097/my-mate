import { getHarness } from "./harness/factory.js";
import { buildWorkerEvidenceV2 } from "./evidence-normalizer.js";
import {
  runtimeEventIdempotencyKey,
  type HarnessEvidenceEvent,
  type NormalizedExecutionReport,
  type RuntimeWorkerJob,
  type WorkerEvidence,
  type WorkerEvent,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function eventKindFromReportStatus(
  status: NormalizedExecutionReport["status"],
):
  | "worker.accepted"
  | "worker.progress"
  | "worker.waiting_human"
  | "worker.completed"
  | "worker.failed"
  | "worker.cancelled" {
  if (status === "accepted") {
    return "worker.accepted";
  }
  if (status === "running") {
    return "worker.progress";
  }
  if (status === "waiting_human") {
    return "worker.waiting_human";
  }
  if (status === "failed") {
    return "worker.failed";
  }
  if (status === "cancelled") {
    return "worker.cancelled";
  }
  return "worker.completed";
}

export interface RuntimeWorkerRunResult {
  events: WorkerEvent[];
  evidence: WorkerEvidence[];
}

export async function runRuntimeWorkerJob(
  job: RuntimeWorkerJob,
  options?: {
    workerId?: string;
    signal?: AbortSignal;
    emitEvidence?: (evidence: WorkerEvidence) => Promise<void> | void;
  },
): Promise<RuntimeWorkerRunResult> {
  const workerId = options?.workerId || "runtime-worker-local";
  const harness = getHarness(job);
  const signal = options?.signal || new AbortController().signal;
  const evidence: WorkerEvidence[] = [];
  let evidenceSequence = 0;
  const emitEvidence = async (event: HarnessEvidenceEvent): Promise<void> => {
    const record = buildWorkerEvidenceV2({
      job,
      workerId,
      sequence: ++evidenceSequence,
      event,
    });
    evidence.push(record);
    await options?.emitEvidence?.(record);
  };
  const envelope = job.envelope as Record<string, unknown>;
  await emitEvidence({
    kind: "prompt",
    summary: typeof envelope.intent === "string" ? envelope.intent : `Execute ${job.node_name}`,
    source: {
      provider: job.harness.agent_runtime,
      model: null,
      native_event_id: null,
      synthetic: true,
    },
    inline_payload: {
      node_name: job.node_name,
      agent_runtime: job.harness.agent_runtime,
      runtime_agent_ref: job.harness.runtime_agent_ref,
      allowed_skills: job.harness.allowed_skills,
      allowed_tools: job.harness.allowed_tools,
    },
  });
  const result = await harness.execute(job, emitEvidence, signal);
  const timeline: Array<
    | { kind: "report"; report: NormalizedExecutionReport }
    | { kind: "handoff"; handoff: NonNullable<typeof result.handoffs>[number] }
  > = [];
  let handoffsAdded = false;
  for (const report of result.reports) {
    timeline.push({ kind: "report", report });
    if (!handoffsAdded && report.status === "running") {
      for (const handoff of result.handoffs || []) {
        timeline.push({ kind: "handoff", handoff });
      }
      handoffsAdded = true;
    }
  }
  if (!handoffsAdded) {
    for (const handoff of result.handoffs || []) {
      timeline.push({ kind: "handoff", handoff });
    }
  }
  return {
    events: timeline.map((item, index) => {
      const sequence = index + 1;
      const common = (kind: WorkerEvent["kind"], createdAt: string) => ({
        event_id: `${job.job_id}:evt:${sequence}`,
        idempotency_key: runtimeEventIdempotencyKey({
          runId: job.run_id,
          nodeRunId: job.node_run_id,
          jobId: job.job_id,
          sequence,
          kind,
        }),
        sequence,
        kind,
        job_id: job.job_id,
        run_id: job.run_id,
        node_run_id: job.node_run_id,
        worker_id: workerId,
        created_at: createdAt,
      });
      if (item.kind === "handoff") {
        const kind = "worker.handoff" as const;
        return {
          ...common(kind, item.handoff.created_at || nowIso()),
          kind,
          handoff: item.handoff,
        } satisfies WorkerEvent;
      }
      const kind = eventKindFromReportStatus(item.report.status);
      return {
        ...common(kind, item.report.created_at || nowIso()),
        kind,
        report: item.report,
      } satisfies WorkerEvent;
    }),
    evidence,
  };
}
