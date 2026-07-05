import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileRunSummary } from "@/lib/types";
import { formatStatus, formatTime } from "@/lib/format";
import { Badge, Panel, uiStyles } from "./ui";

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

export function RunCard({ run, highlighted = false }: { run: MobileRunSummary; highlighted?: boolean }) {
  return (
    <Link href={`/runs/${run.run_id}`} asChild>
      <Pressable>
        <Panel style={highlighted ? styles.highlightedPanel : undefined}>
          <View style={[uiStyles.row, styles.header]}>
            <Text style={styles.title} numberOfLines={2}>
              {run.intent}
            </Text>
            <Badge label={formatStatus(run.status)} tone={statusTone(run.status)} />
          </View>

          <Text style={styles.summary} numberOfLines={2}>
            {run.current_summary}
          </Text>

          {run.active_task ? (
            <View style={styles.taskBox}>
              <Text style={styles.taskName}>{run.active_task.name}</Text>
              <Text style={styles.taskMeta}>
                {formatStatus(run.active_task.status)} / {run.active_task.progress.percent}%
              </Text>
            </View>
          ) : null}

          <View style={[uiStyles.row, uiStyles.wrap, uiStyles.gap8]}>
            {run.pending_approval_count > 0 ? (
              <Badge label={`Gates ${run.pending_approval_count}`} tone="warn" />
            ) : null}
            {run.pending_human_input_count > 0 ? (
              <Badge label={`Inputs ${run.pending_human_input_count}`} tone="warn" />
            ) : null}
            {run.proposal_id ? (
              <Badge label={`Proposal ${formatShortId(run.proposal_id)}`} tone="success" />
            ) : null}
            <Badge label={`Outputs ${run.artifact_count}`} />
          </View>

          <Text style={styles.updatedAt}>Updated {formatTime(run.updated_at)}</Text>
        </Panel>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  highlightedPanel: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  header: {
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
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
  updatedAt: {
    fontSize: 12,
    color: "#64748b",
  },
});
