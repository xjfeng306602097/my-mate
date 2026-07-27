import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Badge, PrimaryButton } from "@/components/ui";
import {
  buildRuntimeNodeEvidence,
  buildRuntimeTopology,
  latestRuntimeEvaluationBundle,
} from "@/lib/runtime-evaluation";
import type {
  EvaluationResult,
  ReplayResult,
  RuntimeGraphSummary,
  RuntimeRunProjection,
  RuntimeWorkerEvidence,
  ScorecardFinding,
  ScorecardResult,
  TraceProjection,
} from "@/lib/types";

type Tone = "neutral" | "warn" | "success" | "danger";
type RuntimeAction = "scorecard" | "evaluation" | "replay" | null;

interface RuntimeTopologyProps {
  graph: RuntimeGraphSummary;
  projection: RuntimeRunProjection | null;
  trace: TraceProjection | null;
  scorecards: ScorecardResult[];
  evaluations: EvaluationResult[];
  replay: ReplayResult | null;
  mode?: "compact" | "full";
  title?: string;
  detail?: string;
  actionLoading?: RuntimeAction;
  onOpenFull?: () => void;
  onCreateScorecard?: () => void;
  onRunEvaluation?: (evaluator: "deterministic-v1" | "none") => void;
  onVerifyReplay?: () => void;
}

function label(value: string | null | undefined): string {
  return String(value || "unavailable").replaceAll("_", " ");
}

function tone(value: string | null | undefined): Tone {
  if (["pass", "complete", "completed", "ok", "satisfied", "done"].includes(value || "")) return "success";
  if (["fail", "failed", "error", "reject", "blocked", "cancelled"].includes(value || "")) return "danger";
  if (["running", "queued", "ready", "waiting_human", "partial", "incomplete"].includes(value || "")) return "warn";
  return "neutral";
}

function shortId(value: string | null | undefined): string {
  if (!value) return "not recorded";
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined) return "not recorded";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)} s`;
}

function formatMoney(value: RuntimeWorkerEvidence["usage"]): string {
  const provider = value?.provider_reported_cost;
  const estimated = value?.estimated_cost;
  if (provider) return `${provider.currency} ${provider.amount_decimal} provider reported`;
  if (estimated) return `${estimated.currency} ${estimated.amount_decimal} estimated`;
  return "Cost unavailable";
}

function payloadLines(payload: unknown): string[] {
  if (payload === null || payload === undefined) return [];
  if (typeof payload === "string") return [payload];
  if (typeof payload === "number" || typeof payload === "boolean") return [String(payload)];
  if (Array.isArray(payload)) {
    return payload.slice(0, 12).map((item, index) => `${index + 1}. ${payloadLines(item)[0] || "item"}`);
  }
  if (typeof payload === "object") {
    return Object.entries(payload as Record<string, unknown>)
      .slice(0, 16)
      .map(([key, value]) => {
        const rendered = payloadLines(value).join(" / ") || "not recorded";
        return `${label(key)}: ${rendered}`;
      });
  }
  return [String(payload)];
}

function EvidenceSection(props: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <View style={styles.sheetSection}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{props.title}</Text>
        {typeof props.count === "number" ? <Text style={styles.sectionCount}>{props.count}</Text> : null}
      </View>
      {props.children}
    </View>
  );
}

function EvidenceRow(props: { title: string; detail?: string | null; meta?: string | null; rowTone?: Tone }) {
  return (
    <View style={[styles.evidenceRow, props.rowTone === "danger" ? styles.evidenceRowDanger : null]}>
      <Text style={styles.evidenceTitle}>{props.title}</Text>
      {props.detail ? <Text style={styles.evidenceDetail}>{props.detail}</Text> : null}
      {props.meta ? <Text style={styles.evidenceMeta}>{props.meta}</Text> : null}
    </View>
  );
}

function FindingRow({ finding }: { finding: ScorecardFinding }) {
  return (
    <View style={[styles.findingRow, finding.passed ? null : styles.findingRowFailed]}>
      <View style={styles.findingHeading}>
        <Badge label={finding.severity.toUpperCase()} tone={finding.passed ? "neutral" : tone(finding.severity)} />
        <Text style={styles.findingTitle}>{finding.summary}</Text>
      </View>
      <Text style={styles.findingDetail}>{finding.detail}</Text>
    </View>
  );
}

function VerdictRow({ labelText, value }: { labelText: string; value: string | null | undefined }) {
  return (
    <View style={styles.verdictRow}>
      <Text style={styles.verdictLabel}>{labelText}</Text>
      <Badge label={label(value)} tone={tone(value)} />
    </View>
  );
}

export function RuntimeTopology(props: RuntimeTopologyProps) {
  const [selectedNodeRunId, setSelectedNodeRunId] = useState<string | null>(null);
  const stages = useMemo(() => buildRuntimeTopology(props.graph), [props.graph]);
  const evidence = useMemo(
    () => selectedNodeRunId
      ? buildRuntimeNodeEvidence(props.graph, props.projection, props.trace, selectedNodeRunId)
      : null,
    [props.graph, props.projection, props.trace, selectedNodeRunId],
  );
  const evaluation = latestRuntimeEvaluationBundle({
    scorecards: props.scorecards,
    evaluations: props.evaluations,
    replay: props.replay,
  });
  const compact = props.mode === "compact";
  const visibleStages = compact ? stages.slice(0, 3) : stages;
  const terminal = ["completed", "failed", "cancelled"].includes(props.graph.runStatus);
  const usage = props.projection?.provider_evidence?.usage;

  return (
    <View style={styles.surface}>
      <View style={styles.summaryBand}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryCopy}>
            <Text style={styles.eyebrow}>Runtime topology</Text>
            <Text style={styles.title}>{props.title || "Live execution map"}</Text>
            <Text style={styles.detail}>
              {props.detail || `${props.graph.nodes.length} nodes across ${stages.length} stages.`}
            </Text>
          </View>
          <Badge label={label(props.graph.runStatus)} tone={tone(props.graph.runStatus)} />
        </View>
        <View style={styles.metricStrip}>
          <View style={styles.metric}><Text style={styles.metricValue}>{props.graph.nodes.length}</Text><Text style={styles.metricLabel}>Nodes</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{stages.length}</Text><Text style={styles.metricLabel}>Stages</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{props.graph.frontier.length}</Text><Text style={styles.metricLabel}>Frontier</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{usage?.aggregate_tokens.total_tokens ?? "-"}</Text><Text style={styles.metricLabel}>Tokens</Text></View>
        </View>
      </View>

      <View style={styles.stageList}>
        {visibleStages.map((stage, stageIndex) => (
          <View key={`runtime-stage-${stage.depth}`} style={styles.stageBlock}>
            <View style={styles.stageHeader}>
              <View>
                <Text style={styles.stageLabel}>{stage.label}</Text>
                <Text style={styles.stageMeta}>{stage.nodeCount} node(s) in {stage.groups.length} work package(s)</Text>
              </View>
              <View style={styles.stageSignals}>
                {stage.branchCount ? <Badge label={`${stage.branchCount} branch`} tone="warn" /> : null}
                {stage.convergenceCount ? <Badge label={`${stage.convergenceCount} merge`} tone="success" /> : null}
              </View>
            </View>
            {stage.groups.map((group) => (
              <View key={`${stage.depth}-${group.key}`} style={styles.groupBlock}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.nodeRail}
                >
                  {group.nodes.map((item) => {
                    const nodeEvidenceCount = (props.projection?.evidence || []).filter(
                      (candidate) => candidate.node_run_id === item.node.nodeRunId,
                    ).length;
                    const latestJob = [...(props.projection?.jobs || [])]
                      .reverse()
                      .find((candidate) => candidate.node_run_id === item.node.nodeRunId);
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open evidence for ${item.node.name}`}
                        key={item.node.nodeRunId}
                        onPress={() => setSelectedNodeRunId(item.node.nodeRunId)}
                        style={({ pressed }) => [styles.node, pressed ? styles.nodePressed : null]}
                      >
                        <View style={styles.nodeHeader}>
                          <View style={[styles.statusDot, { backgroundColor: toneColor(tone(item.node.status)) }]} />
                          <Text numberOfLines={2} style={styles.nodeTitle}>{item.node.name}</Text>
                          <Ionicons name="chevron-forward" size={16} color="#64748b" />
                        </View>
                        <Text numberOfLines={1} style={styles.nodeMeta}>{item.node.type}{item.node.agentId ? ` / ${item.node.agentId}` : ""}</Text>
                        {item.node.progress.message ? <Text numberOfLines={2} style={styles.nodeDetail}>{item.node.progress.message}</Text> : null}
                        <View style={styles.nodeSignals}>
                          <Badge label={label(item.node.status)} tone={tone(item.node.status)} />
                          {latestJob ? <Badge label={`attempt ${latestJob.attempt}`} tone={latestJob.attempt > 1 ? "warn" : "neutral"} /> : null}
                          <Badge label={`${nodeEvidenceCount} evidence`} tone={nodeEvidenceCount ? "neutral" : "warn"} />
                        </View>
                        {item.isBranch || item.isConvergence ? (
                          <Text style={styles.nodeFlowLabel}>
                            {item.isBranch ? `${item.outgoingCount} outgoing paths` : ""}
                            {item.isBranch && item.isConvergence ? " / " : ""}
                            {item.isConvergence ? `${item.incomingCount} paths converge` : ""}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ))}
            {stageIndex < visibleStages.length - 1 ? (
              <View style={styles.stageConnector}>
                <View style={styles.connectorLine} />
                <Ionicons name="arrow-down" size={14} color="#64748b" />
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {compact && stages.length > visibleStages.length && props.onOpenFull ? (
        <Pressable accessibilityRole="button" onPress={props.onOpenFull} style={styles.openFullButton}>
          <Text style={styles.openFullText}>Open all {stages.length} stages</Text>
          <Ionicons name="arrow-forward" size={16} color="#1d4ed8" />
        </Pressable>
      ) : null}

      <View style={styles.evaluationBand}>
        <View style={styles.evaluationHeader}>
          <View style={styles.summaryCopy}>
            <Text style={styles.eyebrow}>Evaluation loop</Text>
            <Text style={styles.evaluationTitle}>Score, evaluate, replay</Text>
          </View>
          <Badge label={terminal ? "Ready" : "Run active"} tone={terminal ? "success" : "warn"} />
        </View>

        <View style={styles.verdictList}>
          <VerdictRow labelText="Pipeline" value={evaluation.scorecard?.pipeline_verdict} />
          <VerdictRow labelText="Contract" value={evaluation.scorecard?.contract_verdict} />
          <VerdictRow labelText="Evidence" value={evaluation.evaluation?.evidence_verdict} />
          <VerdictRow labelText="Usage" value={evaluation.evaluation?.usage_verdict} />
          <VerdictRow labelText="Quality" value={evaluation.evaluation?.quality_verdict} />
          <VerdictRow labelText="Replay" value={evaluation.replay?.verification} />
        </View>

        {evaluation.scorecard ? (
          <Text style={styles.evaluationMeta}>
            Scorecard {evaluation.scorecard.passed_checks}/{evaluation.scorecard.total_checks} checks / {evaluation.scorecard.hard_error_count} hard errors / {evaluation.scorecard.blind_spot_count} blind spots
          </Text>
        ) : <Text style={styles.emptyText}>No scorecard has been recorded for this run.</Text>}
        {evaluation.evaluation ? (
          <Text style={styles.evaluationMeta}>
            {evaluation.evaluation.evaluator.id} / attempt {evaluation.evaluation.attempt} / {label(evaluation.evaluation.status)}
          </Text>
        ) : <Text style={styles.emptyText}>No independent evaluation has been recorded.</Text>}
        {evaluation.replay ? (
          <Text style={styles.evaluationMeta}>
            {evaluation.replay.processed_events} events / {evaluation.replay.projection_differences.length} differences / {evaluation.replay.missing_references.length} missing references
          </Text>
        ) : null}

        {[...(evaluation.scorecard?.findings || []), ...(evaluation.evaluation?.findings || [])]
          .filter((finding) => !finding.passed || finding.severity !== "info")
          .slice(0, compact ? 2 : 6)
          .map((finding) => <FindingRow key={`${finding.check_id}-${finding.summary}`} finding={finding} />)}

        {terminal && props.onCreateScorecard && props.onRunEvaluation && props.onVerifyReplay ? (
          <View style={styles.actionList}>
            <PrimaryButton label="Create scorecard" tone="muted" loading={props.actionLoading === "scorecard"} disabled={Boolean(props.actionLoading && props.actionLoading !== "scorecard")} onPress={props.onCreateScorecard} />
            <PrimaryButton label="Run deterministic evaluation" tone="muted" loading={props.actionLoading === "evaluation"} disabled={Boolean(props.actionLoading && props.actionLoading !== "evaluation")} onPress={() => props.onRunEvaluation?.("deterministic-v1")} />
            <PrimaryButton label="Record-only evaluation" tone="muted" disabled={Boolean(props.actionLoading)} onPress={() => props.onRunEvaluation?.("none")} />
            <PrimaryButton label="Verify replay" tone="muted" loading={props.actionLoading === "replay"} disabled={Boolean(props.actionLoading && props.actionLoading !== "replay")} onPress={props.onVerifyReplay} />
          </View>
        ) : !terminal ? <Text style={styles.emptyText}>Evaluation actions unlock after the run reaches a terminal state.</Text> : null}
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedNodeRunId(null)}
        presentationStyle="fullScreen"
        visible={Boolean(evidence)}
      >
        <SafeAreaView style={styles.sheetSafeArea}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <Text style={styles.sheetEyebrow}>Node evidence</Text>
              <Text numberOfLines={2} style={styles.sheetTitle}>{evidence?.node.name || "Runtime node"}</Text>
            </View>
            <Pressable accessibilityLabel="Close node evidence" accessibilityRole="button" onPress={() => setSelectedNodeRunId(null)} style={styles.closeButton}>
              <Ionicons name="close" size={22} color="#0f172a" />
            </Pressable>
          </View>
          {evidence ? (
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <EvidenceSection title="Summary">
                <View style={styles.summaryGrid}>
                  <EvidenceRow title="Status" detail={label(evidence.node.status)} meta={`${evidence.node.workPackageLabel} / ${evidence.node.type}`} />
                  <EvidenceRow title="Runtime identity" detail={evidence.node.runtimeAgentRef || evidence.node.agentId || "not recorded"} meta={`Node ${shortId(evidence.node.nodeRunId)}`} />
                </View>
              </EvidenceSection>

              <EvidenceSection title="Attempts" count={evidence.jobs.length}>
                {evidence.jobs.length ? evidence.jobs.map((job) => (
                  <EvidenceRow
                    key={job.job_id}
                    title={`Attempt ${job.attempt} / ${label(job.status)}`}
                    detail={`${job.agent_runtime} / ${job.target_kind} / worker ${shortId(job.worker_id)}`}
                    meta={job.last_error || `Job ${shortId(job.job_id)}`}
                    rowTone={job.last_error ? "danger" : tone(job.status)}
                  />
                )) : <Text style={styles.emptyText}>No runtime attempts were recorded.</Text>}
              </EvidenceSection>

              <EvidenceSection title="Prompt" count={evidence.prompts.length}>
                {evidence.prompts.length ? evidence.prompts.map((item) => (
                  <View key={item.evidence_id} style={styles.payloadBlock}>
                    <Text style={styles.evidenceTitle}>{item.summary}</Text>
                    {payloadLines(item.inline_payload).map((line, index) => <Text key={`${item.evidence_id}-${index}`} style={styles.payloadLine}>{line}</Text>)}
                    <Text style={styles.evidenceMeta}>{item.source?.provider || "runtime"} / {item.source?.model || "model not recorded"}</Text>
                  </View>
                )) : <Text style={styles.emptyText}>Prompt evidence is unavailable.</Text>}
              </EvidenceSection>

              <EvidenceSection title="Tools" count={evidence.toolEvents.length}>
                {evidence.toolEvents.length ? evidence.toolEvents.map((item) => (
                  <EvidenceRow key={item.evidence_id} title={`${label(item.kind)} / ${item.summary}`} detail={item.trace?.tool_call_id ? `Call ${shortId(item.trace.tool_call_id)}` : "Native call id unavailable"} meta={item.created_at} rowTone={item.kind === "tool_result" ? "success" : "neutral"} />
                )) : <Text style={styles.emptyText}>No provider-native tool events were recorded.</Text>}
              </EvidenceSection>

              <EvidenceSection title="Usage and cost" count={evidence.usageEvents.length}>
                {evidence.usageEvents.length ? evidence.usageEvents.map((item) => (
                  <EvidenceRow key={item.evidence_id} title={`${item.usage?.total_tokens ?? "-"} total tokens`} detail={`${item.usage?.input_tokens ?? "-"} input / ${item.usage?.output_tokens ?? "-"} output / ${item.usage?.reasoning_tokens ?? "-"} reasoning`} meta={`${formatMoney(item.usage)} / ${formatDuration(item.usage?.duration_ms)}`} />
                )) : <Text style={styles.emptyText}>Usage and cost evidence is unavailable.</Text>}
              </EvidenceSection>

              <EvidenceSection title="Handoffs" count={evidence.handoffs.length}>
                {evidence.handoffs.length ? evidence.handoffs.map((item) => <EvidenceRow key={item.handoff_id} title={`${item.port} / ${item.summary || "Payload routed"}`} detail={`${item.routed_node_run_ids.length} routed / ${item.skipped_node_run_ids.length} skipped`} meta={item.created_at} />) : <Text style={styles.emptyText}>No handoffs were emitted.</Text>}
              </EvidenceSection>

              <EvidenceSection title="Artifacts" count={evidence.artifacts.length}>
                {evidence.artifacts.length ? evidence.artifacts.map((item) => <EvidenceRow key={item.artifact_id} title={item.name} detail={`${item.type} / ${item.mime_type} / ${item.size_bytes} bytes`} meta={item.storage_uri} />) : <Text style={styles.emptyText}>No artifacts are attached to this node.</Text>}
              </EvidenceSection>

              <EvidenceSection title="Errors" count={evidence.errors.length}>
                {evidence.errors.length ? evidence.errors.map((item) => <EvidenceRow key={item.id} title={item.summary} meta={item.createdAt || "time not recorded"} rowTone="danger" />) : <Text style={styles.emptyText}>No runtime errors were recorded.</Text>}
              </EvidenceSection>

              <EvidenceSection title="Trace" count={evidence.traceSpans.length}>
                {evidence.traceSpans.length ? evidence.traceSpans.map((span) => <EvidenceRow key={span.span_id} title={`${label(span.kind)} / ${span.name}`} detail={`${span.provider || "runtime"}${span.model ? ` / ${span.model}` : ""}`} meta={`${label(span.status)} / ${shortId(span.span_id)}`} rowTone={tone(span.status)} />) : <Text style={styles.emptyText}>Trace spans are unavailable for this node.</Text>}
              </EvidenceSection>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function toneColor(value: Tone): string {
  if (value === "success") return "#16a34a";
  if (value === "danger") return "#dc2626";
  if (value === "warn") return "#d97706";
  return "#64748b";
}

const styles = StyleSheet.create({
  surface: { gap: 12 },
  summaryBand: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#d7dfeb", backgroundColor: "#f8fafc", paddingVertical: 12, gap: 12 },
  summaryHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  summaryCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { fontSize: 11, fontWeight: "800", color: "#1d4ed8", textTransform: "uppercase" },
  title: { fontSize: 17, fontWeight: "800", color: "#0f172a" },
  detail: { fontSize: 13, lineHeight: 18, color: "#475569" },
  metricStrip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { minWidth: 68, flexGrow: 1, borderLeftWidth: 2, borderLeftColor: "#cbd5e1", paddingLeft: 8 },
  metricValue: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  metricLabel: { fontSize: 10, fontWeight: "700", color: "#64748b", textTransform: "uppercase" },
  stageList: { gap: 0 },
  stageBlock: { gap: 8 },
  stageHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, paddingTop: 4 },
  stageLabel: { fontSize: 13, fontWeight: "800", color: "#0f172a" },
  stageMeta: { marginTop: 2, fontSize: 11, color: "#64748b" },
  stageSignals: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 5 },
  groupBlock: { gap: 6 },
  groupLabel: { fontSize: 11, fontWeight: "800", color: "#475569", textTransform: "uppercase" },
  nodeRail: { gap: 8, paddingRight: 12 },
  node: { width: 224, minHeight: 132, borderWidth: 1, borderColor: "#d7dfeb", borderRadius: 8, backgroundColor: "#ffffff", padding: 10, gap: 7 },
  nodePressed: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  nodeHeader: { minHeight: 36, flexDirection: "row", alignItems: "flex-start", gap: 7 },
  statusDot: { width: 9, height: 9, borderRadius: 5, marginTop: 4 },
  nodeTitle: { flex: 1, fontSize: 13, lineHeight: 17, fontWeight: "800", color: "#0f172a" },
  nodeMeta: { fontSize: 11, color: "#64748b" },
  nodeDetail: { fontSize: 11, lineHeight: 16, color: "#334155" },
  nodeSignals: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  nodeFlowLabel: { marginTop: "auto", paddingTop: 3, borderTopWidth: 1, borderTopColor: "#e2e8f0", fontSize: 10, color: "#475569" },
  stageConnector: { height: 30, alignItems: "center", justifyContent: "center" },
  connectorLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "#cbd5e1" },
  openFullButton: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#bfdbfe", backgroundColor: "#eff6ff" },
  openFullText: { fontSize: 13, fontWeight: "700", color: "#1d4ed8" },
  evaluationBand: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#d7dfeb", paddingVertical: 12, gap: 10 },
  evaluationHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  evaluationTitle: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  verdictList: { borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  verdictRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  verdictLabel: { fontSize: 12, fontWeight: "700", color: "#475569" },
  evaluationMeta: { fontSize: 11, lineHeight: 16, color: "#475569" },
  emptyText: { fontSize: 12, lineHeight: 17, color: "#64748b" },
  actionList: { gap: 8, paddingTop: 2 },
  findingRow: { paddingVertical: 8, gap: 5, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  findingRowFailed: { borderLeftWidth: 2, borderLeftColor: "#dc2626", paddingLeft: 8 },
  findingHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  findingTitle: { flex: 1, fontSize: 12, fontWeight: "700", color: "#0f172a" },
  findingDetail: { fontSize: 11, lineHeight: 16, color: "#475569" },
  sheetSafeArea: { flex: 1, backgroundColor: "#ffffff" },
  sheetHeader: { minHeight: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#d7dfeb" },
  sheetHeaderCopy: { flex: 1, minWidth: 0 },
  sheetEyebrow: { fontSize: 10, fontWeight: "800", color: "#1d4ed8", textTransform: "uppercase" },
  sheetTitle: { fontSize: 17, lineHeight: 21, fontWeight: "800", color: "#0f172a" },
  closeButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#d7dfeb", borderRadius: 8 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 36 },
  sheetSection: { paddingVertical: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  sectionCount: { minWidth: 24, textAlign: "right", fontSize: 12, fontWeight: "800", color: "#64748b" },
  summaryGrid: { gap: 8 },
  evidenceRow: { gap: 3, paddingVertical: 7, borderLeftWidth: 2, borderLeftColor: "#cbd5e1", paddingLeft: 9 },
  evidenceRowDanger: { borderLeftColor: "#dc2626", backgroundColor: "#fef2f2", paddingRight: 8 },
  evidenceTitle: { fontSize: 12, lineHeight: 17, fontWeight: "700", color: "#0f172a" },
  evidenceDetail: { fontSize: 11, lineHeight: 16, color: "#334155" },
  evidenceMeta: { fontSize: 10, lineHeight: 15, color: "#64748b" },
  payloadBlock: { gap: 5, paddingVertical: 8, borderLeftWidth: 2, borderLeftColor: "#2563eb", paddingLeft: 9 },
  payloadLine: { fontSize: 11, lineHeight: 17, color: "#334155" },
});
