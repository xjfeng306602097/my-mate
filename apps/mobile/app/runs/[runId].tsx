import { useCallback, useEffect, useState } from "react";
import { Link, useLocalSearchParams } from "expo-router";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { cancelRun, getRunFollowUp, pauseRun, resumeRun } from "@/lib/api";
import { formatStatus, formatTime } from "@/lib/format";
import type { MobileRunFollowUp, TimelineItem } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { Badge, Panel, PrimaryButton, Screen, Section, uiStyles } from "@/components/ui";

export default function RunFollowUpScreen() {
  const params = useLocalSearchParams<{ runId: string }>();
  const runId = typeof params.runId === "string" ? params.runId : "";
  const [data, setData] = useState<MobileRunFollowUp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) {
      setError("Missing runId");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setError(null);
      const next = await getRunFollowUp(runId);
      setData(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Load failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function execute(label: string, action: () => Promise<unknown>) {
    setBusyAction(label);
    try {
      await action();
      await load();
    } catch (nextError) {
      Alert.alert("Action failed", nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        contentContainerStyle={styles.content}
      >
        <Section title="Mission Execution">
          {error ? (
            <Panel>
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton label="Retry" onPress={() => void load()} />
            </Panel>
          ) : loading ? (
            <Panel>
              <Text style={styles.loadingText}>Loading mission execution...</Text>
            </Panel>
          ) : data ? (
            <Panel>
              <View style={[uiStyles.row, styles.header]}>
                <Text style={styles.intent}>
                  {data.mission?.mission_view?.title || data.run.intent}
                </Text>
                <Badge label={formatStatus(data.run.status)} tone={statusTone(data.run.status)} />
              </View>
              {data.mission?.mission_view?.summary ? (
                <Text style={styles.summary}>{data.mission.mission_view.summary}</Text>
              ) : null}
              {data.session_id ? (
                <View style={styles.overviewActions}>
                  <Link href={`/tasks/${data.session_id}` as never} asChild>
                    <Pressable>
                      <Text style={styles.linkText}>Open mission</Text>
                    </Pressable>
                  </Link>
                </View>
              ) : null}
              <Text style={styles.summary}>{data.run.current_summary}</Text>
              {data.mission?.mission_view?.nextActionLabel ? (
                <Text style={styles.lineageText}>
                  Next: {data.mission.mission_view.nextActionLabel}
                </Text>
              ) : null}
              {data.run.proposal_id ? (
                <Text style={styles.lineageText}>
                  Proposal: {formatShortId(data.run.proposal_id)}
                </Text>
              ) : null}
              {data.blocker ? <Text style={styles.blocker}>Blocker: {data.blocker}</Text> : null}
              <View style={[uiStyles.row, uiStyles.wrap, uiStyles.gap8]}>
                <Badge label={`Gates ${data.pending_approvals.length}`} tone="warn" />
                <Badge label={`Inputs ${data.pending_human_inputs.length}`} tone="warn" />
                <Badge label={`Outputs ${data.artifact_count}`} />
              </View>

              <View style={[uiStyles.row, uiStyles.gap8]}>
                {data.run.status === "running" ? (
                  <PrimaryButton
                    label="Pause"
                    loading={busyAction === "pause"}
                    onPress={() => void execute("pause", () => pauseRun(data.run.run_id))}
                  />
                ) : null}
                {data.run.status === "paused" ? (
                  <PrimaryButton
                    label="Resume"
                    loading={busyAction === "resume"}
                    onPress={() => void execute("resume", () => resumeRun(data.run.run_id))}
                  />
                ) : null}
                {["running", "paused", "waiting_human"].includes(data.run.status) ? (
                  <PrimaryButton
                    label="Cancel"
                    tone="danger"
                    loading={busyAction === "cancel"}
                    onPress={() => void execute("cancel", () => cancelRun(data.run.run_id))}
                  />
                ) : null}
              </View>
            </Panel>
          ) : (
            <EmptyState title="Run not found" description="No matching mission execution was returned." />
          )}
        </Section>

        {data?.active_task ? (
          <Section title="Live Work">
            <Panel>
              <Text style={styles.taskName}>{data.active_task.name}</Text>
              <Text style={styles.taskMeta}>
                {formatStatus(data.active_task.status)} / {data.active_task.progress.percent}% / attempt{" "}
                {data.active_task.attempt}
              </Text>
              <Text style={styles.summary}>{data.active_task.progress.message}</Text>
            </Panel>
          </Section>
        ) : null}

        <Section title="Execution Timeline">
          {data?.latest_timeline.length ? (
            data.latest_timeline.map((item) => (
              <Panel key={item.event_id}>
                <View style={[uiStyles.row, styles.header]}>
                  <Text style={styles.timelineType}>{formatTimelineType(item)}</Text>
                  <Text style={styles.timelineTime}>{formatTime(item.created_at)}</Text>
                </View>
                <Text style={styles.summary}>{formatTimelineSummary(item)}</Text>
              </Panel>
            ))
          ) : (
            <EmptyState title="No timeline" description="Execution events will appear here after the run starts." />
          )}
        </Section>

        <Section title="Returned Outputs">
          {data?.artifacts.length ? (
            data.artifacts.map((artifact) => (
              <Panel key={artifact.artifact_id}>
                <Text style={styles.artifactName}>{artifact.name}</Text>
                <Text style={styles.artifactMeta}>
                  {artifact.type} / {artifact.mime_type} / {artifact.size_bytes} bytes
                </Text>
                <Text style={styles.artifactUri}>{artifact.storage_uri}</Text>
              </Panel>
            ))
          ) : (
            <EmptyState
              title="No outputs"
              description={
                data?.run.status === "completed"
                  ? "This mission execution completed without returning artifact files."
                  : "Returned outputs will appear here."
              }
            />
          )}
        </Section>

        <Section title="Pending Gates">
          <Link href="/inbox" asChild>
            <Pressable>
              <Panel>
                <Text style={styles.inboxTitle}>Open inbox for approvals and requested input</Text>
                <Text style={styles.summary}>
                  All pending gates for this mission execution are handled from the shared mobile inbox.
                </Text>
              </Panel>
            </Pressable>
          </Link>
        </Section>
      </ScrollView>
    </Screen>
  );
}

function statusTone(status: string): "neutral" | "warn" | "success" | "danger" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  if (status === "waiting_human" || status === "paused") {
    return "warn";
  }
  return "neutral";
}

function formatShortId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 18) {
    return trimmed;
  }
  const parts = trimmed.split("_");
  const prefix = parts[0] || "proposal";
  const suffix = parts[parts.length - 1] || trimmed.slice(-6);
  return `${prefix}...${suffix}`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTimelineType(item: TimelineItem): string {
  switch (item.type) {
    case "run.completed":
      return "Execution completed";
    case "run.failed":
      return "Execution failed";
    case "run.cancelled":
      return "Execution cancelled";
    case "node.started":
      return "Node started";
    case "node.ready":
      return "Node ready";
    case "node.completed":
      return "Node completed";
    case "node.failed":
      return "Node failed";
    case "node.progress":
      return "Node progress";
    case "approval.requested":
      return "Approval gate requested";
    case "approval.granted":
      return "Approval gate cleared";
    case "human_input.requested":
      return "Input requested";
    case "human_input.submitted":
      return "Input submitted";
    default:
      return item.type.replace(/[._]+/g, " ");
  }
}

function formatTimelineSummary(item: TimelineItem): string {
  if (item.summary && item.summary.trim()) {
    return item.summary.trim();
  }

  const nodeName = asString(item.payload.node_name);
  const message = asString(item.payload.message);
  const percent = asNumber(item.payload.percent);

  switch (item.type) {
    case "run.completed":
      return "The mission execution finished successfully.";
    case "run.failed":
      return "The mission execution finished with a failure.";
    case "run.cancelled":
      return "The mission execution was cancelled before completion.";
    case "node.started":
      return nodeName ? `${nodeName} started.` : "A node started.";
    case "node.ready":
      return nodeName ? `${nodeName} is ready to run.` : "A node is ready to run.";
    case "node.completed":
      return nodeName ? `${nodeName} completed.` : "A node completed.";
    case "node.failed":
      return nodeName ? `${nodeName} failed.` : "A node failed.";
    case "node.progress":
      if (message && percent !== null) {
        return `${message} (${percent}%)`;
      }
      if (message) {
        return message;
      }
      return nodeName ? `${nodeName} reported progress.` : "A node reported progress.";
    case "approval.requested":
      return nodeName ? `${nodeName} is waiting for approval.` : "The mission execution is waiting for approval.";
    case "approval.granted":
      return nodeName ? `${nodeName} was approved.` : "The approval gate was cleared.";
    case "human_input.requested":
      return nodeName ? `${nodeName} is waiting for structured input.` : "The run is waiting for structured input.";
    case "human_input.submitted":
      return nodeName ? `Input was submitted for ${nodeName}.` : "Structured input was submitted.";
    default:
      return "No summary";
  }
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 28,
  },
  header: {
    justifyContent: "space-between",
    gap: 12,
  },
  overviewActions: {
    marginTop: 4,
    marginBottom: 4,
  },
  intent: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  blocker: {
    fontSize: 13,
    lineHeight: 19,
    color: "#b45309",
    fontWeight: "600",
  },
  lineageText: {
    fontSize: 12,
    color: "#166534",
    fontWeight: "700",
  },
  taskName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  taskMeta: {
    fontSize: 13,
    color: "#64748b",
  },
  timelineType: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  timelineTime: {
    fontSize: 12,
    color: "#64748b",
  },
  artifactName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  artifactMeta: {
    fontSize: 12,
    color: "#64748b",
  },
  artifactUri: {
    fontSize: 12,
    lineHeight: 18,
    color: "#2563eb",
  },
  inboxTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
  },
  linkText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2563eb",
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#b91c1c",
  },
  loadingText: {
    fontSize: 14,
    color: "#475569",
  },
});
