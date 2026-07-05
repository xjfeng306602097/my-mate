import { useCallback, useEffect, useState } from "react";
import { Link } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { getMobileHome } from "@/lib/api";
import { formatStatus, formatTime } from "@/lib/format";
import type { MobileHomeResponse } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { RunCard } from "@/components/run-card";
import { Badge, Panel, PrimaryButton, Screen, Section } from "@/components/ui";

export default function HomeScreen() {
  const [data, setData] = useState<MobileHomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await getMobileHome();
      setData(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Load failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const focusSession = data?.focus_session || null;
  const focusView = focusSession?.mission_view || null;

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
        <Section
          title="Mission Attention"
          action={
            <Link href="/tasks" asChild>
              <Pressable>
                <Text style={styles.linkText}>Open missions</Text>
              </Pressable>
            </Link>
          }
        >
          <View style={styles.metricGrid}>
            <MetricCard
              label="Needs Attention"
              value={data?.missions?.missions_needing_attention ?? 0}
              accent="#b45309"
            />
            <MetricCard label="Active Missions" value={data?.missions?.active_missions ?? 0} />
            <MetricCard label="Waiting" value={data?.missions?.waiting_missions ?? 0} accent="#b45309" />
            <MetricCard label="Pending Inbox" value={data?.inbox.pending_count ?? 0} accent="#b91c1c" />
          </View>
        </Section>

        <Section title="Focus Mission">
          {error ? (
            <Panel>
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton label="Retry" onPress={() => void load()} />
            </Panel>
          ) : loading ? (
            <Panel>
              <Text style={styles.loadingText}>Loading mission workspace...</Text>
            </Panel>
          ) : focusSession ? (
            <Link href={`/tasks/${focusSession.session_id}` as never} asChild>
              <Pressable>
                <Panel>
                  <View style={styles.header}>
                    <Text style={styles.title} numberOfLines={2}>
                      {focusView?.title || focusSession.mission_snapshot?.missionTitle || focusSession.title}
                    </Text>
                    <Badge
                      label={
                        focusView?.statusLabel ||
                        focusSession.mission_snapshot?.missionStatusLabel ||
                        formatStatus(focusSession.status)
                      }
                      tone={focusView?.statusTone || focusSession.mission_snapshot?.missionStatusTone || "neutral"}
                    />
                  </View>
                  {focusSession.mission_snapshot?.objective ? (
                    <Text style={styles.objective} numberOfLines={2}>
                      {focusSession.mission_snapshot.objective}
                    </Text>
                  ) : null}
                  <Text style={styles.summary} numberOfLines={3}>
                    {focusView?.summary || focusSession.mission_snapshot?.missionSummary || "Mission summary not ready yet."}
                  </Text>
                  <View style={styles.signalRow}>
                    {focusView?.nextActionLabel || focusSession.mission_snapshot?.nextActionLabel ? (
                      <SignalChip
                        label="Next"
                        value={focusView?.nextActionLabel || focusSession.mission_snapshot?.nextActionLabel || ""}
                      />
                    ) : null}
                    {focusView?.routeLabel || focusSession.mission_snapshot?.activeRouteRevision ? (
                      <SignalChip
                        label="Route"
                        value={
                          focusView?.routeLabel ||
                          `v${focusSession.mission_snapshot?.activeRouteRevision} / ${
                            focusSession.mission_snapshot?.activeRouteOption || "primary"
                          }`
                        }
                      />
                    ) : null}
                    {focusView?.checkpointLabel || focusSession.mission_snapshot?.checkpoints?.length ? (
                      <SignalChip
                        label="Checkpoints"
                        value={focusView?.checkpointLabel || String(focusSession.mission_snapshot?.checkpoints?.length || 0)}
                      />
                    ) : null}
                    <SignalChip
                      label="Work"
                      value={focusView?.workLabel || `${focusSession.message_count} updates`}
                    />
                  </View>
                  <Text style={styles.meta}>Updated {formatTime(focusSession.updated_at)}</Text>
                </Panel>
              </Pressable>
            </Link>
          ) : (
            <EmptyState
              title="No missions yet"
              description="Start a mission in Tasks and the workspace will track route, execution, and outputs here."
            />
          )}
        </Section>

        <Section title="Recent Missions">
          {data?.recent_sessions?.length ? (
            data.recent_sessions.slice(0, 3).map((session) => (
              <Link key={session.session_id} href={`/tasks/${session.session_id}` as never} asChild>
                <Pressable>
                  <Panel>
                    <View style={styles.rowHeader}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {session.mission_view?.title || session.mission_snapshot?.missionTitle || session.title}
                      </Text>
                      <Badge
                        label={
                          session.mission_view?.statusLabel ||
                          session.mission_snapshot?.missionStatusLabel ||
                          formatStatus(session.status)
                        }
                        tone={session.mission_view?.statusTone || session.mission_snapshot?.missionStatusTone || "neutral"}
                      />
                    </View>
                    <Text style={styles.rowSummary} numberOfLines={2}>
                      {session.mission_view?.nextActionDetail ||
                        session.mission_view?.summary ||
                        session.mission_snapshot?.nextActionDetail ||
                        session.mission_snapshot?.missionSummary ||
                        "No mission summary yet."}
                    </Text>
                    <Text style={styles.meta}>Updated {formatTime(session.updated_at)}</Text>
                  </Panel>
                </Pressable>
              </Link>
            ))
          ) : (
            <EmptyState title="No recent missions" description="Mission workspaces will appear here." />
          )}
        </Section>

        <Section title="Run Overview">
          <View style={styles.metricGrid}>
            <MetricCard label="Active Runs" value={data?.overview.active_runs ?? 0} />
            <MetricCard label="Waiting" value={data?.overview.waiting_runs ?? 0} accent="#b45309" />
            <MetricCard label="Failed" value={data?.overview.failed_runs ?? 0} accent="#b91c1c" />
            <MetricCard label="Completed" value={data?.overview.completed_runs ?? 0} accent="#166534" />
          </View>
        </Section>

        <Section title="Focus Run">
          {data?.focus_run ? (
            <RunCard run={data.focus_run} />
          ) : (
            <EmptyState title="No focus run" description="No run currently needs your attention." />
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

function MetricCard(props: { label: string; value: number; accent?: string }) {
  return (
    <Panel style={styles.metricCard}>
      <View style={[styles.metricDot, props.accent ? { backgroundColor: props.accent } : null]} />
      <Text style={styles.metricValue}>{props.value}</Text>
      <Text style={styles.metricLabel}>{props.label}</Text>
    </Panel>
  );
}

function SignalChip(props: { label: string; value: string }) {
  return (
    <View style={styles.signalChip}>
      <Text style={styles.signalLabel}>{props.label}</Text>
      <Text style={styles.signalValue} numberOfLines={1}>
        {props.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 28,
  },
  linkText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2563eb",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metricCard: {
    width: "47%",
    minHeight: 112,
    justifyContent: "space-between",
  },
  metricDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2563eb",
  },
  metricValue: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0f172a",
  },
  metricLabel: {
    fontSize: 13,
    color: "#64748b",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  objective: {
    fontSize: 13,
    lineHeight: 18,
    color: "#0f172a",
    fontWeight: "600",
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  signalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  signalChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    maxWidth: "100%",
  },
  signalLabel: {
    fontSize: 11,
    color: "#64748b",
  },
  signalValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
  },
  rowSummary: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  meta: {
    fontSize: 12,
    color: "#64748b",
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
