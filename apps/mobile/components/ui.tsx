import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { PropsWithChildren, ReactNode } from "react";

export function Screen({ children }: PropsWithChildren) {
  return <View style={styles.screen}>{children}</View>;
}

export function Section({ title, action, children }: PropsWithChildren<{ title?: string; action?: ReactNode }>) {
  return (
    <View style={styles.section}>
      {title || action ? (
        <View style={styles.sectionHeader}>
          {title ? <Text style={styles.sectionTitle}>{title}</Text> : <View />}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Panel({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "default" | "danger" | "muted";
}) {
  const toneStyle =
    props.tone === "danger"
      ? styles.buttonDanger
      : props.tone === "muted"
        ? styles.buttonMuted
        : styles.buttonDefault;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled || props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        toneStyle,
        (props.disabled || props.loading) && styles.buttonDisabled,
        pressed && !props.disabled && !props.loading && styles.buttonPressed,
      ]}
    >
      {props.loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.buttonText}>{props.label}</Text>}
    </Pressable>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warn" | "success" | "danger" }) {
  const toneStyle =
    tone === "warn"
      ? styles.badgeWarn
      : tone === "success"
        ? styles.badgeSuccess
        : tone === "danger"
          ? styles.badgeDanger
          : styles.badgeNeutral;
  return (
    <View style={[styles.badge, toneStyle]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export const uiStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  gap8: {
    gap: 8,
  },
  gap12: {
    gap: 12,
  },
  spacer: {
    flex: 1,
  },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f3f6fb",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#14213d",
  },
  panel: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dfeb",
    padding: 14,
    gap: 10,
  },
  button: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonDefault: {
    backgroundColor: "#2563eb",
  },
  buttonMuted: {
    backgroundColor: "#475569",
  },
  buttonDanger: {
    backgroundColor: "#dc2626",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: 8,
    minHeight: 26,
    borderRadius: 999,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  badgeNeutral: {
    backgroundColor: "#dbeafe",
  },
  badgeWarn: {
    backgroundColor: "#fef3c7",
  },
  badgeSuccess: {
    backgroundColor: "#dcfce7",
  },
  badgeDanger: {
    backgroundColor: "#fee2e2",
  },
  badgeText: {
    color: "#1f2937",
    fontSize: 12,
    fontWeight: "600",
  },
});
