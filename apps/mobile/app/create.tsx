import { useState } from "react";
import { router } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createSession } from "@/lib/api";
import { Panel, PrimaryButton, Screen, Section } from "@/components/ui";

export default function CreateRunScreen() {
  const [intent, setIntent] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!intent.trim()) {
      Alert.alert("Cannot start", "Enter the mission intent first.");
      return;
    }

    setCreating(true);
    try {
      const created = await createSession({
        initial_message: intent.trim(),
      });
      router.replace(`/tasks/${created.session.session_id}` as never);
    } catch (error) {
      Alert.alert("Create failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Create Mission">
          <Panel>
            <Text style={styles.label}>Describe the mission</Text>
            <TextInput
              value={intent}
              onChangeText={setIntent}
              placeholder="Example: prepare today's account follow-up, compare two route options, then run the chosen path"
              multiline
              textAlignVertical="top"
              style={styles.input}
            />
            <View style={styles.noteBlock}>
              <Text style={styles.noteTitle}>Mission workspace flow</Text>
              <Text style={styles.noteText}>
                This entry creates a mission workspace first. Drafting, route comparison,
                confirmation, and run execution all continue inside the mission.
              </Text>
            </View>
            <PrimaryButton
              label="Create and open mission"
              loading={creating}
              disabled={!intent.trim()}
              onPress={() => void handleCreate()}
            />
          </Panel>
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
    minHeight: 120,
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
  noteBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#eff6ff",
    padding: 12,
    gap: 4,
  },
  noteTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  noteText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
  },
});
