import fs from "node:fs";
import path from "node:path";
import type {
  ExecutionArtifactRecord,
  HarnessResult,
  NodeHandoff,
  NormalizedExecutionReport,
  RuntimeWorkerJob,
} from "../types.js";

export type LocalHarnessResult = HarnessResult;

function nowIso(): string {
  return new Date().toISOString();
}

function buildRawRef(job: RuntimeWorkerJob) {
  return {
    dispatch_id: `runtime-worker:${job.job_id}`,
    provider_refs: {
      task_id: `local-task:${job.node_run_id}`,
      session_id: `local-session:${job.node_run_id}`,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveUpstreamContent(job: RuntimeWorkerJob): string {
  const inputPayload = asRecord(job.envelope.input_payload);
  const handoffs = Array.isArray(inputPayload?.upstream_handoffs)
    ? inputPayload.upstream_handoffs
    : [];
  const latest = asRecord(handoffs.at(-1));
  const content = latest?.content;
  if (typeof content === "string") {
    return content;
  }
  const contentRecord = asRecord(content);
  if (typeof contentRecord?.summary === "string") {
    return contentRecord.summary;
  }
  return content === undefined ? "" : JSON.stringify(content);
}

function resolveDeterministicOutput(job: RuntimeWorkerJob, intent: string): string {
  const inputPayload = asRecord(job.envelope.input_payload);
  const nodeConfig = asRecord(inputPayload?.node_config);
  const configured =
    typeof nodeConfig?.deterministic_output === "string"
      ? nodeConfig.deterministic_output.trim()
      : "";
  const fallback = `${job.node_name} completed local deterministic execution.`;
  return (configured || fallback)
    .replaceAll("{{intent}}", intent)
    .replaceAll("{{upstream}}", resolveUpstreamContent(job));
}

function buildArtifacts(job: RuntimeWorkerJob): {
  artifacts: ExecutionArtifactRecord[];
  output: string;
} {
  const workspace = process.env.MY_MATE_WORKSPACE || "/workspace";
  const artifactDir = path.join(workspace, "artifacts", job.run_id, job.node_run_id);
  const artifactPath = path.join(artifactDir, "summary.txt");
  const envelope = job.envelope as Record<string, unknown>;
  const intent = typeof envelope.intent === "string" ? envelope.intent : job.node_name;
  const output = resolveDeterministicOutput(job, intent);
  const summary = [
    `Node: ${job.node_name}`,
    `Runtime: ${job.harness.agent_runtime}`,
    `Intent: ${intent}`,
    "",
    output,
    `Completed at: ${nowIso()}`,
  ].join("\n");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(artifactPath, `${summary}\n`, "utf-8");
  return {
    output,
    artifacts: [{
      artifact_id: `artifact_${job.node_run_id}`,
      type: "summary",
      name: `${job.node_name}.summary.txt`,
      storage_uri: `workspace://artifacts/${job.run_id}/${job.node_run_id}/summary.txt`,
      mime_type: "text/plain",
      size_bytes: Buffer.byteLength(`${summary}\n`, "utf-8"),
    }],
  };
}

export async function runLocalHarness(job: RuntimeWorkerJob): Promise<LocalHarnessResult> {
  const acceptedAt = nowIso();
  const runningAt = nowIso();
  const completedAt = nowIso();

  const { artifacts, output } = buildArtifacts(job);
  const inputPayload = asRecord(job.envelope.input_payload);
  const nodeConfig = asRecord(inputPayload?.node_config);
  const gateConfig = asRecord(nodeConfig?.deterministic_human_gate);
  const handoff: NodeHandoff = {
    type: "node_handoff",
    handoff_id: `handoff:${job.job_id}:success`,
    job_id: job.job_id,
    run_id: job.run_id,
    node_run_id: job.node_run_id,
    node_id: job.node_id,
    port: "success",
    content: {
      artifacts,
      summary: output,
    },
    content_ref: artifacts[0]?.storage_uri || null,
    summary: `${job.node_name} handed off its workspace artifact.`,
    created_at: completedAt,
  };

  const reports: NormalizedExecutionReport[] = [
      {
        run_id: job.run_id,
        node_run_id: job.node_run_id,
        status: "accepted",
        progress: {
          percent: 0,
          message: "Worker accepted local runtime job",
        },
        artifacts: [],
        error: null,
        raw_ref: buildRawRef(job),
        created_at: acceptedAt,
      },
      {
        run_id: job.run_id,
        node_run_id: job.node_run_id,
        status: "running",
        progress: {
          percent: 60,
          message: `Worker is processing ${job.node_name}`,
        },
        artifacts: [],
        error: null,
        raw_ref: buildRawRef(job),
        created_at: runningAt,
      },
    ];
  if (gateConfig) {
    const requestedAt = nowIso();
    const kind = gateConfig.kind === "human_input" ? "human_input" : "approval";
    reports.push({
      run_id: job.run_id,
      node_run_id: job.node_run_id,
      status: "waiting_human",
      progress: {
        percent: 75,
        message:
          typeof gateConfig.summary === "string"
            ? gateConfig.summary
            : `Human confirmation required for ${job.node_name}`,
      },
      artifacts: [],
      error: null,
      raw_ref: buildRawRef(job),
      human_gate: {
        gate_id:
          typeof gateConfig.gate_id === "string" && gateConfig.gate_id.trim()
            ? gateConfig.gate_id
            : `gate:${job.job_id}:1`,
        kind,
        summary:
          typeof gateConfig.summary === "string"
            ? gateConfig.summary
            : `Human confirmation required for ${job.node_name}`,
        input_schema:
          kind === "human_input" ? asRecord(gateConfig.input_schema) || {} : null,
        requested_at: requestedAt,
      },
      created_at: requestedAt,
    });
  }
  reports.push(
      {
        run_id: job.run_id,
        node_run_id: job.node_run_id,
        status: "completed",
        progress: {
          percent: 100,
          message: `${job.node_name} completed by runtime worker`,
        },
        artifacts,
        error: null,
        raw_ref: buildRawRef(job),
        created_at: completedAt,
      },
  );
  return {
    reports,
    handoffs: [handoff],
  };
}
