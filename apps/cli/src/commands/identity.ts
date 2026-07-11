import type {
  GeneratedAuthMeResponse,
  GeneratedSecurityAuditEvent,
  GeneratedWorkspaceRecord,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export async function executeWhoAmI(
  client: ApiClientLike,
  options: { json?: boolean },
  io: CommandIo,
): Promise<number> {
  try {
    const identity = await client.get<GeneratedAuthMeResponse>("/api/auth/me");
    if (options.json) writeJson(io, identity);
    else {
      io.stdout(`${identity.principal.display_name} (${identity.principal.principal_id})`);
      io.stdout(`Workspace ${identity.selected_workspace.workspace_name} | role=${identity.selected_workspace.role}`);
      io.stdout(`Permissions ${identity.permissions.join(", ")}`);
    }
    return 0;
  } catch (error) {
    return reportCommandError(io, error);
  }
}

export async function executeWorkspaces(
  client: ApiClientLike,
  options: { json?: boolean },
  io: CommandIo,
): Promise<number> {
  try {
    const result = await client.get<{ items: GeneratedWorkspaceRecord[] }>("/api/workspaces");
    if (options.json) writeJson(io, result);
    else for (const workspace of result.items) {
      io.stdout(`${workspace.workspace_id} | ${workspace.name} | ${workspace.status}`);
    }
    return 0;
  } catch (error) {
    return reportCommandError(io, error);
  }
}

export async function executeAudit(
  client: ApiClientLike,
  options: { limit?: number; outcome?: string; actor?: string; json?: boolean },
  io: CommandIo,
): Promise<number> {
  try {
    const params = new URLSearchParams({ limit: String(options.limit || 50) });
    if (options.outcome) params.set("outcome", options.outcome);
    if (options.actor) params.set("principal_id", options.actor);
    const result = await client.get<{
      items: GeneratedSecurityAuditEvent[];
      chain_verified: boolean;
    }>(`/api/audit-events?${params}`);
    if (options.json) writeJson(io, result);
    else {
      io.stdout(`Audit chain ${result.chain_verified ? "verified" : "invalid"} | ${result.items.length} events`);
      for (const event of result.items) {
        io.stdout(`${event.created_at} [${event.outcome}] ${event.principal_id} ${event.action} ${event.resource_type || "request"}${event.resource_id ? `/${event.resource_id}` : ""}`);
      }
    }
    return result.chain_verified ? 0 : 1;
  } catch (error) {
    return reportCommandError(io, error);
  }
}
