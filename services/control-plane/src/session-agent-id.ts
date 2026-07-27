import type { SessionRecord } from "./types.js";

/** Normalize historical Session metadata at the storage boundary. */
export function resolveSessionAgentId(session: Pick<SessionRecord, "metadata">): string {
  const canonical = session.metadata.agent_id;
  if (typeof canonical === "string" && canonical.trim()) return canonical.trim();
  const legacy = session.metadata.agent_profile_id;
  return typeof legacy === "string" && legacy.trim() ? legacy.trim() : "default-agent";
}
