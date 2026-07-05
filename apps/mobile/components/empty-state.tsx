import { StyleSheet, Text, View } from "react-native";
import { Panel } from "./ui";

export function EmptyState(props: { title: string; description: string }) {
  return (
    <Panel style={styles.panel}>
      <View style={styles.icon} />
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.description}>{props.description}</Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignItems: "center",
    paddingVertical: 28,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#dbeafe",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    color: "#64748b",
  },
});
