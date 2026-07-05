import { useCallback, useEffect, useState } from "react";
import { Link, router, useFocusEffect } from "expo-router";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from "react-native";
import { archiveSession, createSession, getMissions, unarchiveSession, type SessionListVisibility } from "@/lib/api";
import { formatStatus, formatTime } from "@/lib/format";
import type { MissionListItem, MissionRouteSummary } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { Badge, Panel, PrimaryButton, Screen, Section } from "@/components/ui";

function getMissionListRouteLabel(route: MissionRouteSummary | null | undefined): string {
  if (!route) {
    return "Unrouted";
  }

  const revision = route.activeRevision ?? route.confirmedRevision ?? route.latestRevision;
  const option = route.activeOption || route.confirmedOption || "primary";
  if (typeof revision === "number") {
    return `v${revision} / ${option}`;
  }

  if (route.selectedTemplateName) {
    return route.selectedTemplateName;
  }

  return route.stale ? "Needs refresh" : "Unrouted";
}

export default function TasksScreen() {
  const [items, setItems] = useState<MissionListItem[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<SessionListVisibility>("active");
  const [busyArchiveId, setBusyArchiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await getMissions({
        q: query,
        visibility,
      });
      setItems(next.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Load failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, visibility]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleCreate() {
    if (!draft.trim()) {
      Alert.alert("Cannot start", "Enter the task you want the orchestrator to handle.");
      return;
    }

    setCreating(true);
    try {
      const created = await createSession({
        initial_message: draft.trim(),
      });
      setDraft("");
      router.push(`/tasks/${created.session.session_id}` as never);
    } catch (nextError) {
      Alert.alert("Create failed", nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  async function handleArchiveAction(
    event: GestureResponderEvent,
    mission: MissionListItem,
  ) {
    event.stopPropagation();
    setBusyArchiveId(mission.session_id);
    try {
      if (mission.archived) {
        await unarchiveSession({
          sessionId: mission.session_id,
          requestedBy: "mobile",
        });
      } else {
        await archiveSession({
          sessionId: mission.session_id,
          requestedBy: "mobile",
          reason: "Archived from mobile mission list.",
        });
      }
      await load();
    } catch (nextError) {
      Alert.alert(
        mission.archived ? "Restore failed" : "Archive failed",
        nextError instanceof Error ? nextError.message : "Unknown error",
      );
    } finally {
      setBusyArchiveId(null);
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
        <Section title="New Mission">
          <Panel>
            <Text style={styles.label}>Describe the mission</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Example: prepare today's account follow-up plan, compare the safest route, and draft the first outreach message"
              multiline
              textAlignVertical="top"
              style={styles.input}
            />
            <PrimaryButton
              label="Start mission"
              loading={creating}
              disabled={!draft.trim()}
              onPress={() => void handleCreate()}
            />
          </Panel>
        </Section>

        <Section title="Mission Inventory">
          <Panel>
            <Text style={styles.label}>Search missions</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by mission, session id, route, output, or run"
              style={styles.searchInput}
            />
            <View style={styles.segmentedControl}>
              {(["active", "archived"] as const).map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  onPress={() => setVisibility(option)}
                  style={[
                    styles.segmentButton,
                    visibility === option ? styles.segmentButtonSelected : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentButtonText,
                      visibility === option ? styles.segmentButtonTextSelected : null,
                    ]}
                  >
                    {option === "active" ? "Active" : "Archived"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Panel>
          {error ? (
            <Panel>
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton label="Retry" onPress={() => void load()} />
            </Panel>
          ) : loading ? (
            <Panel>
              <Text style={styles.loadingText}>Loading missions...</Text>
            </Panel>
          ) : items.length === 0 ? (
            <EmptyState
              title={visibility === "archived" ? "No archived missions" : "No missions found"}
              description={
                query.trim()
                  ? "Adjust the search or switch inventory views."
                  : visibility === "archived"
                    ? "Archived missions will appear here when you move them out of the active list."
                    : "Start one mission and the orchestrator will keep route, run, and output updates inside the workspace."
              }
            />
          ) : (
            items.map((mission) => {
              const spec = mission.mission_spec || mission.mission_snapshot?.spec || null;
              const view = mission.mission_view;
              const routeLabel = view?.routeLabel || getMissionListRouteLabel(spec?.route);
              const pipelineSummary = spec?.pipelineSummary;
              const checkpointSummary = spec?.checkpointSummary;
              const title = view?.title || mission.mission_snapshot?.missionTitle || spec?.objective || mission.title;
              const objective = spec?.objective || mission.mission_snapshot?.objective;
              const summary =
                view?.summary ||
                mission.mission_snapshot?.missionSummary ||
                spec?.decisionFocus ||
                spec?.sourceBrief ||
                "No mission summary yet";
              const nextActionLabel = view?.nextActionLabel || mission.mission_snapshot?.nextActionLabel || null;
              const workLabel = view?.workLabel ||
                (pipelineSummary
                  ? `${pipelineSummary.active} live / ${pipelineSummary.total} total`
                  : null);
              const checkpointLabel = view?.checkpointLabel ||
                (checkpointSummary
                  ? `${checkpointSummary.completed}/${checkpointSummary.total}`
                  : mission.mission_snapshot?.checkpoints?.length
                    ? String(mission.mission_snapshot.checkpoints.length)
                    : null);

              return (
                <Link
                  key={mission.mission_id}
                  href={`/tasks/${mission.session_id}` as never}
                  asChild
                >
                  <Pressable>
                    <Panel>
                      <View style={styles.header}>
                        <Text style={styles.title} numberOfLines={2}>
                          {title}
                        </Text>
                        <Badge
                          label={
                            view?.statusLabel ||
                            mission.mission_snapshot?.missionStatusLabel ||
                            formatStatus(mission.status)
                          }
                          tone={view?.statusTone || mission.mission_snapshot?.missionStatusTone || "neutral"}
                        />
                      </View>
                      <View style={styles.inventoryMetaRow}>
                        <Badge label={mission.archived ? "Archived" : "Active"} tone={mission.archived ? "neutral" : "success"} />
                        {mission.latest_run_id ? <Badge label="Run linked" tone="warn" /> : null}
                        <Text style={styles.meta}>Updated {formatTime(mission.updated_at)}</Text>
                      </View>
                      {objective ? (
                        <Text style={styles.objective} numberOfLines={2}>
                          {objective}
                        </Text>
                      ) : null}
                      <Text style={styles.summary} numberOfLines={2}>
                        {summary}
                      </Text>
                      <View style={styles.signalRow}>
                        {routeLabel ? (
                          <View style={styles.signalChip}>
                            <Text style={styles.signalLabel}>Route</Text>
                            <Text style={styles.signalValue}>{routeLabel}</Text>
                          </View>
                        ) : null}
                        {workLabel ? (
                          <View style={styles.signalChip}>
                            <Text style={styles.signalLabel}>Work</Text>
                            <Text style={styles.signalValue}>{workLabel}</Text>
                          </View>
                        ) : null}
                        {checkpointLabel ? (
                          <View style={styles.signalChip}>
                            <Text style={styles.signalLabel}>Checkpoints</Text>
                            <Text style={styles.signalValue}>{checkpointLabel}</Text>
                          </View>
                        ) : null}
                        {nextActionLabel ? (
                          <View style={styles.signalChip}>
                            <Text style={styles.signalLabel}>Next</Text>
                            <Text style={styles.signalValue}>{nextActionLabel}</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.footer}>
                        <Text style={styles.meta}>Mission {mission.session_id}</Text>
                        <Text style={styles.meta}>
                          {mission.message_count} workspace update{mission.message_count === 1 ? "" : "s"}
                        </Text>
                      </View>
                      <View style={styles.cardActions}>
                        <Pressable
                          accessibilityRole="button"
                          disabled={busyArchiveId === mission.session_id}
                          onPress={(event) => void handleArchiveAction(event, mission)}
                          style={({ pressed }) => [
                            styles.secondaryAction,
                            pressed ? styles.secondaryActionPressed : null,
                            busyArchiveId === mission.session_id ? styles.secondaryActionDisabled : null,
                          ]}
                        >
                          <Text style={styles.secondaryActionText}>
                            {busyArchiveId === mission.session_id
                              ? "Working..."
                              : mission.archived
                                ? "Restore"
                                : "Archive"}
                          </Text>
                        </Pressable>
                      </View>
                    </Panel>
                  </Pressable>
                </Link>
              );
            })
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 28,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  input: {
    minHeight: 110,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a",
  },
  searchInput: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a",
  },
  segmentedControl: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    padding: 3,
    gap: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  segmentButtonSelected: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748b",
  },
  segmentButtonTextSelected: {
    color: "#0f172a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  objective: {
    fontSize: 13,
    lineHeight: 18,
    color: "#0f172a",
    fontWeight: "600",
  },
  inventoryMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
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
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  cardActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  secondaryAction: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryActionPressed: {
    backgroundColor: "#f8fafc",
  },
  secondaryActionDisabled: {
    opacity: 0.6,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
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
