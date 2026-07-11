import type { RunEvidenceSnapshot } from "./types.js";

export interface EvaluationEvidenceView {
  schema_version: 1;
  run: {
    run_id: string;
    intent: string;
    status: string;
    current_summary: string;
  };
  route: {
    route_id: string;
    template_name: string;
    work_packages: Array<{ key: string; label: string; node_run_ids: string[] }>;
  };
  nodes: Array<{
    node_run_id: string;
    node_id: string;
    name: string;
    status: string;
    progress_message: string;
  }>;
  artifacts: Array<{
    artifact_id: string;
    node_run_id: string | null;
    type: string;
    name: string;
    mime_type: string;
    storage_uri: string;
    size_bytes: number;
  }>;
  handoffs: Array<{
    handoff_id: string;
    node_run_id: string;
    port: string;
    summary: string | null;
    content_ref: string | null;
  }>;
  evidence: Array<{
    evidence_id: string;
    node_run_id: string;
    kind: string;
    summary: string;
    provider: string | null;
    model: string | null;
    synthetic: boolean;
    input_ref: string | null;
    output_ref: string | null;
    usage: unknown;
    redaction_status: string;
  }>;
  completeness: RunEvidenceSnapshot["completeness"];
}

function compact(value: string | null | undefined, maximum = 2000): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function buildEvaluationEvidenceView(snapshot: RunEvidenceSnapshot): EvaluationEvidenceView {
  const compiledByRunId = new Map(
    snapshot.effective_plan.compiled_nodes.map((node) => [node.node_run_id, node]),
  );
  return {
    schema_version: 1,
    run: {
      run_id: snapshot.run.run_id,
      intent: compact(snapshot.run.intent),
      status: snapshot.run.status,
      current_summary: compact(snapshot.run.current_summary),
    },
    route: {
      route_id: snapshot.route.route_id,
      template_name: snapshot.route.template_name,
      work_packages: snapshot.route.work_packages.map((item) => ({
        key: item.key,
        label: item.label,
        node_run_ids: item.node_run_ids,
      })),
    },
    nodes: snapshot.node_runs.map((node) => {
      const compiled = compiledByRunId.get(node.node_run_id);
      return {
        node_run_id: node.node_run_id,
        node_id: compiled?.node_id || node.node_run_id,
        name: compiled?.name || node.node_run_id,
        status: node.status,
        progress_message: compact(node.progress.message, 500),
      };
    }),
    artifacts: snapshot.artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      node_run_id: artifact.node_run_id,
      type: artifact.type,
      name: artifact.name,
      mime_type: artifact.mime_type,
      storage_uri: artifact.storage_uri,
      size_bytes: artifact.size_bytes,
    })),
    handoffs: snapshot.handoffs.map((handoff) => ({
      handoff_id: handoff.handoff_id,
      node_run_id: handoff.node_run_id,
      port: handoff.port,
      summary: handoff.summary ? compact(handoff.summary, 1000) : null,
      content_ref: handoff.content_ref || null,
    })),
    evidence: snapshot.evidence.map((item) => ({
      evidence_id: item.evidence_id,
      node_run_id: item.node_run_id,
      kind: item.kind,
      summary: compact(item.summary),
      provider: item.source?.provider ?? null,
      model: item.source?.model ?? null,
      synthetic: item.source?.synthetic ?? true,
      input_ref: item.input_ref ?? null,
      output_ref: item.output_ref ?? null,
      usage: item.usage ?? null,
      redaction_status: item.redaction_status,
    })),
    completeness: snapshot.completeness,
  };
}
