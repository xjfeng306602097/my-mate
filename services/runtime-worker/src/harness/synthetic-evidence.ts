import type {
  HarnessEvidenceEvent,
  HarnessResult,
  RuntimeWorkerJob,
} from "../types.js";
import { unavailableUsage } from "../evidence-normalizer.js";

export async function emitSyntheticResultEvidence(
  job: RuntimeWorkerJob,
  result: HarnessResult,
  emit: (event: HarnessEvidenceEvent) => Promise<void>,
  options?: { includeTerminal?: boolean; includeUsage?: boolean },
): Promise<void> {
  const source = {
    provider: job.harness.agent_runtime,
    model: null,
    native_event_id: null,
    synthetic: true,
  };
  const terminal = [...result.reports].reverse().find((report) =>
    ["completed", "failed", "cancelled"].includes(report.status),
  );
  if (terminal && options?.includeTerminal !== false) {
    await emit({
      kind: terminal.status === "failed" ? "error" : job.harness.agent_runtime === "local" ? "log" : "model_text",
      summary: terminal.progress.message,
      source,
      inline_payload: {
        status: terminal.status,
        percent: terminal.progress.percent,
      },
      created_at: terminal.created_at,
    });
  }

  const artifacts = new Map(
    result.reports.flatMap((report) => report.artifacts).map((artifact) => [artifact.artifact_id, artifact]),
  );
  for (const artifact of artifacts.values()) {
    await emit({
      kind: "artifact_ref",
      summary: artifact.name,
      source,
      output_ref: artifact.storage_uri,
      storage_uri: artifact.storage_uri,
      inline_payload: artifact,
      created_at: terminal?.created_at,
    });
  }
  for (const handoff of result.handoffs || []) {
    await emit({
      kind: "handoff",
      summary: handoff.summary || `Handoff through ${handoff.port}`,
      source,
      input_ref: handoff.content_ref || null,
      output_ref: handoff.content_ref || null,
      storage_uri: handoff.content_ref || null,
      inline_payload: {
        port: handoff.port,
        content: handoff.content,
      },
      created_at: handoff.created_at,
    });
  }
  if (options?.includeUsage !== false) {
    await emit({
      kind: "usage",
      summary: "Provider-native usage is unavailable for this synthetic harness.",
      source,
      inline_payload: { availability: "unavailable" },
      usage: unavailableUsage(),
      created_at: terminal?.created_at,
    });
  }
}

export async function emitUnavailableNativeUsage(
  job: RuntimeWorkerJob,
  emit: (event: HarnessEvidenceEvent) => Promise<void>,
): Promise<void> {
  await emit({
    kind: "usage",
    summary: "The provider stream did not report usage.",
    source: {
      provider: job.harness.agent_runtime,
      model: null,
      native_event_id: null,
      synthetic: true,
    },
    inline_payload: { availability: "unavailable", reason: "missing_provider_usage" },
    usage: unavailableUsage(),
  });
}
