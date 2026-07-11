import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type {
  AuthMeResponse,
  SecurityAuditEvent,
  WorkspaceMemberRecord,
  WorkspaceRole,
} from "@my-mate/shared-types/identity";
import {
  getCurrentIdentity,
  getSecurityAuditEvents,
  getWorkspaceMembers,
  setActiveWorkspaceId,
  updateWorkspaceMember,
} from "@/lib/api";
import { Badge, Panel, Screen, Section } from "@/components/ui";

const ROLES: WorkspaceRole[] = ["owner", "admin", "operator", "viewer"];

export default function AccountScreen() {
  const [identity, setIdentity] = useState<AuthMeResponse | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberRecord[]>([]);
  const [audit, setAudit] = useState<SecurityAuditEvent[]>([]);
  const [chainVerified, setChainVerified] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const nextIdentity = await getCurrentIdentity();
      const [memberResult, auditResult] = await Promise.all([
        getWorkspaceMembers(nextIdentity.selected_workspace.workspace_id),
        getSecurityAuditEvents(30),
      ]);
      setIdentity(nextIdentity);
      setMembers(memberResult.items);
      setAudit(auditResult.items);
      setChainVerified(auditResult.chain_verified);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Account load failed");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectWorkspace = async (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    setRefreshing(true);
    await load();
  };

  const changeRole = async (member: WorkspaceMemberRecord, role: WorkspaceRole) => {
    if (!identity) return;
    await updateWorkspaceMember({ workspaceId: identity.selected_workspace.workspace_id, member, role });
    await load();
  };

  return (
    <Screen>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        contentContainerStyle={styles.content}
      >
        <Section title="Identity">
          <Panel>
            <View style={styles.rowBetween}>
              <View style={styles.grow}>
                <Text style={styles.title}>{identity?.principal.display_name || "Not authenticated"}</Text>
                <Text style={styles.meta}>{identity?.principal.principal_id || error || "Unavailable"}</Text>
              </View>
              {identity ? <Badge label={identity.selected_workspace.role} tone="neutral" /> : null}
            </View>
          </Panel>
        </Section>

        <Section title="Workspace">
          <View style={styles.segmented}>
            {identity?.available_workspaces.map((workspace) => {
              const selected = workspace.workspace_id === identity.selected_workspace.workspace_id;
              return (
                <Pressable
                  key={workspace.workspace_id}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  onPress={() => void selectWorkspace(workspace.workspace_id)}
                >
                  <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={17} color={selected ? "#ffffff" : "#475569"} />
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{workspace.workspace_name}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="Members">
          {members.map((member) => (
            <Panel key={member.principal_id}>
              <View style={styles.rowBetween}>
                <View style={styles.grow}>
                  <Text style={styles.memberName}>{member.display_name}</Text>
                  <Text style={styles.meta}>{member.principal_id} | {member.status}</Text>
                </View>
                <Badge label={member.principal_type} tone="neutral" />
              </View>
              {identity?.permissions.includes("workspace.manage_members") ? (
                <View style={styles.roleSegments}>
                  {ROLES.map((role) => (
                    <Pressable
                      key={role}
                      style={[styles.roleSegment, member.role === role && styles.roleSelected]}
                      onPress={() => void changeRole(member, role)}
                    >
                      <Text style={[styles.roleText, member.role === role && styles.roleTextSelected]}>{role}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Panel>
          ))}
        </Section>

        <Section title="Security Audit" action={<Badge label={chainVerified ? "Verified" : "Unverified"} tone={chainVerified ? "success" : "danger"} />}>
          {audit.slice(0, 12).map((event) => (
            <Panel key={event.audit_id}>
              <View style={styles.rowBetween}>
                <Text style={styles.auditAction}>{event.action}</Text>
                <Badge label={event.outcome} tone={event.outcome === "allowed" ? "success" : event.outcome === "denied" ? "danger" : "warn"} />
              </View>
              <Text style={styles.meta}>{event.principal_id} | {new Date(event.created_at).toLocaleString()}</Text>
            </Panel>
          ))}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 28 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  grow: { flex: 1 },
  title: { color: "#0f172a", fontSize: 18, fontWeight: "700" },
  memberName: { color: "#0f172a", fontSize: 15, fontWeight: "700" },
  meta: { color: "#64748b", fontSize: 12, marginTop: 4 },
  segmented: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  segment: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: "#cbd5e1", paddingHorizontal: 12, borderRadius: 6, backgroundColor: "#ffffff" },
  segmentSelected: { backgroundColor: "#0f766e", borderColor: "#0f766e" },
  segmentText: { color: "#475569", fontSize: 13, fontWeight: "600" },
  segmentTextSelected: { color: "#ffffff" },
  roleSegments: { flexDirection: "row", flexWrap: "wrap", marginTop: 12, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 6, overflow: "hidden" },
  roleSegment: { paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#ffffff" },
  roleSelected: { backgroundColor: "#1d4ed8" },
  roleText: { color: "#475569", fontSize: 12, fontWeight: "600" },
  roleTextSelected: { color: "#ffffff" },
  auditAction: { color: "#0f172a", fontSize: 14, fontWeight: "700" },
});
