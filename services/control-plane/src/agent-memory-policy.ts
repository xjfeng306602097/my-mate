import type { AgentBindingSnapshot, AgentVersionRecord, SessionRecord } from "./types.js";

export type AgentMemoryPolicy = AgentVersionRecord["memory_policy"];

const DEFAULT_AGENT_MEMORY_POLICY: AgentMemoryPolicy = {
  enabled: true,
  automatic_recall: true,
  write_mode: "review",
};

export function sessionAgentMemoryPolicy(session: SessionRecord): AgentMemoryPolicy {
  const snapshot = session.metadata?.agent_binding_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ...DEFAULT_AGENT_MEMORY_POLICY };
  }
  const policy = (snapshot as Partial<AgentBindingSnapshot>).memory_policy;
  if (!policy || typeof policy !== "object") return { ...DEFAULT_AGENT_MEMORY_POLICY };
  return {
    enabled: policy.enabled !== false,
    automatic_recall: policy.automatic_recall !== false,
    write_mode: policy.write_mode === "disabled" || policy.write_mode === "automatic"
      ? policy.write_mode
      : "review",
  };
}
