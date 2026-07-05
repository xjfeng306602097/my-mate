import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { getMobileRuns } from "@/lib/api";
import type { MobileRunSummary, RunStatus } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { RunCard } from "@/components/run-card";
import { Panel, PrimaryButton, Screen, Section } from "@/components/ui";

type RunFilter = "all" | "active" | "waiting" | "done" | "failed";

const FILTERS: Array<{ key: RunFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "waiting", label: "Waiting" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
];

export default function RunsScreen() {
  const params = useLocalSearchParams<{ createdRunId?: string }>();
  const createdRunId =
    typeof params.createdRunId === "string" ? params.createdRunId : undefined;
  const [items, setItems] = useState<MobileRunSummary[]>([]);
  const [filter, setFilter] = useState<RunFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await getMobileRuns();
      setItems(next.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Load failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, createdRunId]);

  const filteredItems = useMemo(
    () => items.filter((run) => matchesFilter(run.status, filter)),
    [filter, items],
  );

  const createdRun = useMemo(
    () => items.find((run) => run.run_id === createdRunId),
    [createdRunId, items],
  );

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
        <Section title="Mission Runs">
          {createdRunId ? (
            <Panel style={styles.createdPanel}>
              <Text style={styles.createdTitle}>Mission run created</Text>
              <Text style={styles.createdText}>
                {createdRun
                  ? `Now tracking this mission execution: ${createdRun.intent}`
                  : `Created mission run: ${createdRunId}`}
              </Text>
            </Panel>
          ) : null}

          <View style={styles.filters}>
            {FILTERS.map((item) => {
              const selected = filter === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setFilter(item.key)}
                  style={[styles.filterChip, selected && styles.filterChipSelected]}
                >
                  <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {error ? (
            <Panel>
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton label="Retry" onPress={() => void load()} />
            </Panel>
          ) : loading ? (
            <Panel>
              <Text style={styles.loadingText}>Loading runs...</Text>
            </Panel>
          ) : filteredItems.length ? (
            filteredItems.map((run) => (
              <RunCard
                key={run.run_id}
                run={run}
                highlighted={run.run_id === createdRunId}
              />
            ))
          ) : items.length ? (
            <EmptyState
              title="No runs in this filter"
              description="Switch filters or refresh to see the latest mission executions."
            />
          ) : (
            <EmptyState
              title="No mission runs"
              description="Created mission executions will appear here for tracking."
            />
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

function matchesFilter(status: RunStatus, filter: RunFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "active") {
    return ["draft", "queued", "running", "blocked"].includes(status);
  }
  if (filter === "waiting") {
    return ["waiting_human", "paused"].includes(status);
  }
  if (filter === "done") {
    return status === "completed";
  }
  return ["failed", "cancelled"].includes(status);
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 28,
  },
  createdPanel: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  createdTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  createdText: {
    fontSize: 13,
    lineHeight: 19,
    color: "#334155",
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  filterChipSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#dbeafe",
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  filterTextSelected: {
    color: "#1d4ed8",
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
