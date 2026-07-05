import { useCallback, useEffect, useState } from "react";
import { Link } from "expo-router";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { approve, getMobileInbox, reject, submitHumanInput } from "@/lib/api";
import {
  buildSchemaPayload,
  SchemaForm,
  validateRequiredFields,
  type SchemaValue,
} from "@/components/schema-form";
import { EmptyState } from "@/components/empty-state";
import { Badge, Panel, PrimaryButton, Screen, Section, uiStyles } from "@/components/ui";
import { formatStatus, formatTime } from "@/lib/format";
import type { MobileInboxItem } from "@/lib/types";

export default function InboxScreen() {
  const [items, setItems] = useState<MobileInboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inputDrafts, setInputDrafts] = useState<Record<string, Record<string, SchemaValue>>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await getMobileInbox();
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
  }, [load]);

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      Alert.alert("Submitted", successMessage);
      await load();
    } catch (nextError) {
      Alert.alert("Action failed", nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setBusyId(null);
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
        <Section title="Inbox">
          {error ? (
            <Panel>
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton label="Retry" onPress={() => void load()} />
            </Panel>
          ) : loading ? (
            <Panel>
              <Text style={styles.loadingText}>Loading inbox...</Text>
            </Panel>
          ) : items.length === 0 ? (
            <EmptyState
              title="No pending items"
              description="Approvals and human input requests will appear here."
            />
          ) : (
            items.map((item) => {
              const busy = busyId === item.request_id;
              const draft = inputDrafts[item.request_id] || {};
              const inputSchema = item.input_schema || { properties: {}, required: [] };

              return (
                <Panel key={item.request_id}>
                  <View style={[uiStyles.row, styles.header]}>
                    <Badge label={item.kind === "approval" ? "Approval" : "Input"} tone="warn" />
                    <Badge label={formatStatus(item.run_status)} />
                  </View>

                  <Link href={`/runs/${item.run_id}`} asChild>
                    <Pressable>
                      <Text style={styles.intent}>{item.intent}</Text>
                    </Pressable>
                  </Link>

                  <Text style={styles.summary}>{item.summary}</Text>

                  {item.task ? (
                    <View style={styles.taskBox}>
                      <Text style={styles.taskName}>{item.task.name}</Text>
                      <Text style={styles.taskMeta}>
                        {formatStatus(item.task.status)} / {item.task.progress.percent}% /{" "}
                        {formatTime(item.requested_at)}
                      </Text>
                    </View>
                  ) : null}

                  {item.kind === "approval" ? (
                    <View style={[uiStyles.row, uiStyles.gap8]}>
                      <PrimaryButton
                        label="Approve"
                        loading={busy}
                        onPress={() => {
                          setBusyId(item.request_id);
                          void runAction(
                            () => approve(item.request_id, "Approved from mobile inbox"),
                            "Approval accepted.",
                          );
                        }}
                      />
                      <PrimaryButton
                        label="Reject"
                        tone="danger"
                        loading={busy}
                        onPress={() => {
                          setBusyId(item.request_id);
                          void runAction(
                            () => reject(item.request_id, "Rejected from mobile inbox"),
                            "Approval rejected.",
                          );
                        }}
                      />
                    </View>
                  ) : (
                    <View style={styles.inputBlock}>
                      <SchemaForm
                        schema={inputSchema}
                        value={draft}
                        onChange={(key, value) =>
                          setInputDrafts((current) => ({
                            ...current,
                            [item.request_id]: {
                              ...(current[item.request_id] || {}),
                              [key]: value,
                            },
                          }))
                        }
                      />
                      <PrimaryButton
                        label="Submit input"
                        loading={busy}
                        onPress={() => {
                          const missing = validateRequiredFields(inputSchema, draft);
                          if (missing) {
                            Alert.alert("Cannot submit", `Fill required field: ${missing}`);
                            return;
                          }

                          setBusyId(item.request_id);
                          void runAction(
                            () =>
                              submitHumanInput(
                                item.request_id,
                                buildSchemaPayload(inputSchema, draft),
                              ),
                            "Human input submitted.",
                          );
                        }}
                      />
                    </View>
                  )}
                </Panel>
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
  header: {
    justifyContent: "space-between",
  },
  intent: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  taskBox: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  taskName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  taskMeta: {
    fontSize: 12,
    color: "#64748b",
  },
  inputBlock: {
    gap: 10,
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
