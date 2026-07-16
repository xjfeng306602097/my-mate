import fs from "node:fs";
import path from "node:path";
import type {
  ExecutionArtifactRecord,
  HarnessResult,
  NodeHandoff,
  NormalizedExecutionReport,
  RuntimeWorkerJob,
} from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function buildAgentHarnessResult(input: {
  job: RuntimeWorkerJob;
  output: string;
  backend: string;
}): HarnessResult {
  const workspace = process.env.MY_MATE_WORKSPACE || "/workspace";
  const artifactDir = path.join(
    workspace,
    "artifacts",
    input.job.run_id,
    input.job.node_run_id,
  );
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, "agent-output.txt");
  fs.writeFileSync(artifactPath, `${input.output}\n`, "utf-8");
  const artifact: ExecutionArtifactRecord = {
    artifact_id: `artifact_${input.job.node_run_id}_${input.job.dispatch_sequence}`,
    type: "agent_output",
    name: `${input.job.node_name}.agent-output.txt`,
    storage_uri: `workspace://artifacts/${input.job.run_id}/${input.job.node_run_id}/agent-output.txt`,
    mime_type: "text/plain",
    size_bytes: Buffer.byteLength(`${input.output}\n`, "utf-8"),
  };
  const timestamp = nowIso();
  const rawRef = {
    job_id: input.job.job_id,
    worker_id: process.env.MY_MATE_WORKER_ID || null,
    lease_id: process.env.MY_MATE_WORKER_LEASE_ID || null,
    target_kind: input.job.provision.target_kind,
    dispatch_id: `${input.backend}:${input.job.job_id}`,
    provider_refs: {
      runtime: input.job.harness.agent_runtime,
      harness: input.backend,
    },
    openclaw_task_id: null,
    openclaw_session_id: null,
  };
  const reports: NormalizedExecutionReport[] = [
    {
      run_id: input.job.run_id,
      node_run_id: input.job.node_run_id,
      status: "accepted",
      progress: { percent: 0, message: `${input.backend} accepted the job` },
      artifacts: [],
      error: null,
      raw_ref: rawRef,
      created_at: timestamp,
    },
    {
      run_id: input.job.run_id,
      node_run_id: input.job.node_run_id,
      status: "running",
      progress: { percent: 50, message: `Running ${input.backend}` },
      artifacts: [],
      error: null,
      raw_ref: rawRef,
      created_at: timestamp,
    },
    {
      run_id: input.job.run_id,
      node_run_id: input.job.node_run_id,
      status: "completed",
      progress: { percent: 100, message: input.output.slice(0, 500) },
      artifacts: [artifact],
      error: null,
      raw_ref: rawRef,
      created_at: timestamp,
    },
  ];
  const handoff: NodeHandoff = {
    type: "node_handoff",
    handoff_id: `handoff:${input.job.job_id}:success`,
    job_id: input.job.job_id,
    run_id: input.job.run_id,
    node_run_id: input.job.node_run_id,
    node_id: input.job.node_id,
    port: "success",
    content: { summary: input.output.slice(0, 2000), artifacts: [artifact] },
    content_ref: artifact.storage_uri,
    summary: `${input.job.node_name} completed through ${input.backend}.`,
    created_at: timestamp,
  };
  return { reports, handoffs: [handoff] };
}
