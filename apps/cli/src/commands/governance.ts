import type {
  GeneratedGovernanceChange,
  GeneratedGovernanceChangeList,
  GeneratedGovernancePolicy,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

function renderChange(io: CommandIo, change: GeneratedGovernanceChange): void {
  io.stdout(
    `${change.change_id} | ${change.status} | ${change.action} | ${change.resource_type}/${change.resource_id} | approvals=${change.approvals.length}/${change.required_approvals}`,
  );
}

export async function executeGovernanceList(
  client: ApiClientLike,
  options: { status?: string; action?: string; limit?: number; json?: boolean },
  io: CommandIo,
): Promise<number> {
  try {
    const params = new URLSearchParams({ limit: String(options.limit || 100) });
    if (options.status) params.set("status", options.status);
    if (options.action) params.set("action", options.action);
    const result = await client.get<GeneratedGovernanceChangeList>(
      `/api/governance/changes?${params}`,
    );
    if (options.json) writeJson(io, result);
    else {
      io.stdout(
        `Governance ${result.policy.mode} | approvals=${result.policy.required_approvals} | self=${result.policy.allow_self_approval ? "allowed" : "forbidden"}`,
      );
      for (const change of result.items) renderChange(io, change);
    }
    return 0;
  } catch (error) {
    return reportCommandError(io, error);
  }
}

export async function executeGovernancePolicy(
  client: ApiClientLike,
  options: {
    mode?: "advisory" | "enforced";
    requiredApprovals?: number;
    selfApproval?: "allow" | "deny";
    protectedActions?: string;
    json?: boolean;
  },
  io: CommandIo,
): Promise<number> {
  try {
    const hasUpdate = Boolean(
      options.mode ||
      options.requiredApprovals !== undefined ||
      options.selfApproval ||
      options.protectedActions,
    );
    const policy = hasUpdate
      ? await client.post<GeneratedGovernancePolicy>("/api/governance/policy", {
          ...(options.mode ? { mode: options.mode } : {}),
          ...(options.requiredApprovals !== undefined
            ? { required_approvals: options.requiredApprovals }
            : {}),
          ...(options.selfApproval
            ? { allow_self_approval: options.selfApproval === "allow" }
            : {}),
          ...(options.protectedActions
            ? {
                protected_actions: options.protectedActions
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              }
            : {}),
        })
      : await client.get<GeneratedGovernancePolicy>("/api/governance/policy");
    if (options.json) writeJson(io, policy);
    else {
      io.stdout(`Mode ${policy.mode}`);
      io.stdout(`Required approvals ${policy.required_approvals}`);
      io.stdout(`Self approval ${policy.allow_self_approval ? "allowed" : "forbidden"}`);
      io.stdout(`Protected ${policy.protected_actions.join(", ")}`);
    }
    return 0;
  } catch (error) {
    return reportCommandError(io, error);
  }
}

export async function executeGovernancePropose(
  client: ApiClientLike,
  options: {
    action: string;
    resourceId: string;
    reason: string;
    payload?: string;
    json?: boolean;
  },
  io: CommandIo,
): Promise<number> {
  try {
    let payload: Record<string, unknown> = {};
    if (options.payload?.trim()) {
      const parsed = JSON.parse(options.payload) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Governance payload must be a JSON object.");
      }
      payload = parsed as Record<string, unknown>;
    }
    const change = await client.post<GeneratedGovernanceChange>("/api/governance/changes", {
      action: options.action,
      resource_id: options.resourceId,
      reason: options.reason,
      payload,
    });
    if (options.json) writeJson(io, change);
    else renderChange(io, change);
    return 0;
  } catch (error) {
    return reportCommandError(io, error);
  }
}

export async function executeGovernanceDecision(
  client: ApiClientLike,
  changeId: string,
  decision: "approve" | "reject" | "apply",
  options: { comment?: string; json?: boolean },
  io: CommandIo,
): Promise<number> {
  try {
    const change = await client.post<GeneratedGovernanceChange>(
      `/api/governance/changes/${encodeURIComponent(changeId)}/${decision}`,
      decision === "apply" ? {} : { comment: options.comment || undefined },
    );
    if (options.json) writeJson(io, change);
    else renderChange(io, change);
    return change.status === "conflicted" || change.status === "rejected" ? 1 : 0;
  } catch (error) {
    return reportCommandError(io, error);
  }
}
