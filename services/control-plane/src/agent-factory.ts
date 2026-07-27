import { getProviderConnection } from "./provider-connection-store.js";
import { createAgentBindingSnapshot, resolveSessionAgentBinding } from "./agent-runtime-store.js";
import type { AgentBindingSnapshot, AgentRunKind, AgentRunRecord, ProviderConnectionRecord, SessionRecord } from "./types.js";
import { createAgentRun } from "./agent-runtime-store.js";

export interface AgentRuntimeContext {
  binding: AgentBindingSnapshot;
  connection: ProviderConnectionRecord;
  model: string;
}

/** Single construction point for all execution subjects. Transport records are resolved here, not treated as Agents. */
export class AgentFactory {
  bindSession(session: SessionRecord): AgentRuntimeContext {
    return this.fromBinding(resolveSessionAgentBinding(session));
  }

  bind(input: Parameters<typeof createAgentBindingSnapshot>[0]): AgentRuntimeContext {
    return this.fromBinding(createAgentBindingSnapshot(input));
  }

  fromBinding(binding: AgentBindingSnapshot): AgentRuntimeContext {
    const connection = getProviderConnection(binding.provider_connection_id);
    if (!connection || connection.status !== "active" || connection.verification?.status !== "verified") {
      throw Object.assign(new Error("The Agent Provider Connection is unavailable or unverified."), { code: "agent_provider_unavailable" });
    }
    if (!connection.models.includes(binding.model)) {
      throw Object.assign(new Error(`Pinned Agent model ${binding.model} is no longer available.`), { code: "agent_binding_drift" });
    }
    return { binding, connection, model: binding.model };
  }

  startRun(context: AgentRuntimeContext, input: { workspaceId: string; kind: AgentRunKind; sessionId?: string | null; scheduleId?: string | null; scheduleRunId?: string | null; parentAgentRunId?: string | null }): AgentRunRecord {
    return createAgentRun({ workspaceId: input.workspaceId, kind: input.kind, bindingSnapshot: context.binding, sessionId: input.sessionId, scheduleId: input.scheduleId, scheduleRunId: input.scheduleRunId, parentAgentRunId: input.parentAgentRunId });
  }
}

let singleton: AgentFactory | null = null;
export function getAgentFactory(): AgentFactory {
  singleton ||= new AgentFactory();
  return singleton;
}

