import createClient, {
  type Client,
  type ClientOptions,
} from "openapi-fetch";
import type {
  components,
  operations,
  paths,
} from "./generated/control-plane.js";

export type { components, operations, paths } from "./generated/control-plane.js";

export type ControlPlaneSchemas = components["schemas"];
export type ControlPlaneSchema<Name extends keyof ControlPlaneSchemas> =
  ControlPlaneSchemas[Name];

export type DoctorReport = ControlPlaneSchema<"DoctorReport">;
export type DoctorRequest = ControlPlaneSchema<"DoctorRequest">;
export type ScorecardResult = ControlPlaneSchema<"ScorecardResult">;
export type CreateScorecardRequest = ControlPlaneSchema<"CreateScorecardRequest">;
export type EvaluationResult = ControlPlaneSchema<"EvaluationResult">;
export type CreateEvaluationRequest = ControlPlaneSchema<"CreateEvaluationRequest">;
export type TraceProjection = ControlPlaneSchema<"TraceProjection">;
export type TraceSpan = ControlPlaneSchema<"TraceSpan">;
export type ReplayResult = ControlPlaneSchema<"ReplayResult">;
export type ReplayPlanResult = ControlPlaneSchema<"ReplayPlanResult">;
export type CreateReplayPlanRequest = ControlPlaneSchema<"CreateReplayPlanRequest">;
export type SuperviseRunResponse = ControlPlaneSchema<"SuperviseRunResponse">;
export type RunDetail = ControlPlaneSchema<"RunDetail">;
export type RunRoute = ControlPlaneSchema<"RunRoute">;
export type GeneratedAuthMeResponse = ControlPlaneSchema<"AuthMeResponse">;
export type GeneratedWorkspaceRecord = ControlPlaneSchema<"WorkspaceRecord">;
export type GeneratedWorkspaceMemberRecord = ControlPlaneSchema<"WorkspaceMemberRecord">;
export type GeneratedSecurityAuditEvent = ControlPlaneSchema<"SecurityAuditEvent">;
export type CreateWorkspaceRequest = ControlPlaneSchema<"CreateWorkspaceRequest">;
export type UpdateWorkspaceMemberRequest = ControlPlaneSchema<"UpdateWorkspaceMemberRequest">;

export type ControlPlaneClient = Client<paths>;
export type ControlPlaneOperation<Name extends keyof operations> = operations[Name];

export interface CreateControlPlaneClientOptions {
  baseUrl: string;
  apiKey?: string | null;
  workspaceId?: string | null;
  fetch?: ClientOptions["fetch"];
  headers?: Record<string, string>;
}

export function createControlPlaneClient(
  options: CreateControlPlaneClientOptions,
): ControlPlaneClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  return createClient<paths>({
    baseUrl,
    fetch: options.fetch,
    headers: {
      accept: "application/json",
      ...(options.headers || {}),
      ...(options.workspaceId ? { "x-my-mate-workspace-id": options.workspaceId } : {}),
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
    },
  });
}
