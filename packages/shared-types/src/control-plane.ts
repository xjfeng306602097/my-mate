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
export type RuntimeCompensationRecord = ControlPlaneSchema<"RuntimeCompensationRecord">;
export type ExecutionReplayResult = ControlPlaneSchema<"ExecutionReplayResult">;
export type RuntimeRecoveryView = ControlPlaneSchema<"RuntimeRecoveryView">;
export type RuntimeRecoveryScanResponse = ControlPlaneSchema<"RuntimeRecoveryScanResponse">;
export type MissionMaterializerStatus = ControlPlaneSchema<"MissionMaterializerStatus">;
export type MissionMaterializerRebuildResponse = ControlPlaneSchema<"MissionMaterializerRebuildResponse">;
export type MissionMaterializerConsistencyReport = ControlPlaneSchema<"MissionMaterializerConsistencyReport">;
export type SuperviseRunResponse = ControlPlaneSchema<"SuperviseRunResponse">;
export type RunDetail = ControlPlaneSchema<"RunDetail">;
export type RunRoute = ControlPlaneSchema<"RunRoute">;
export type DashboardSummaryResponse = ControlPlaneSchema<"DashboardSummaryResponse">;
export type DashboardCostReport = ControlPlaneSchema<"DashboardCostReport">;
export type DashboardCostAttributionGroup = ControlPlaneSchema<"DashboardCostAttributionGroup">;
export type GeneratedAuthMeResponse = ControlPlaneSchema<"AuthMeResponse">;
export type GeneratedWorkspaceRecord = ControlPlaneSchema<"WorkspaceRecord">;
export type GeneratedWorkspaceMemberRecord = ControlPlaneSchema<"WorkspaceMemberRecord">;
export type GeneratedSecurityAuditEvent = ControlPlaneSchema<"SecurityAuditEvent">;
export type GeneratedGovernancePolicy = ControlPlaneSchema<"GovernancePolicyRecord">;
export type GeneratedGovernanceChange = ControlPlaneSchema<"GovernanceChangeRecord">;
export type GeneratedGovernanceChangeList = ControlPlaneSchema<"GovernanceChangeListResponse">;
export type CreateGovernanceChangeRequest = ControlPlaneSchema<"CreateGovernanceChangeRequest">;
export type UpdateGovernancePolicyRequest = ControlPlaneSchema<"UpdateGovernancePolicyRequest">;
export type GovernanceDecisionRequest = ControlPlaneSchema<"GovernanceDecisionRequest">;
export type CreateWorkspaceRequest = ControlPlaneSchema<"CreateWorkspaceRequest">;
export type UpdateWorkspaceMemberRequest = ControlPlaneSchema<"UpdateWorkspaceMemberRequest">;
export type SupervisionAlert = ControlPlaneSchema<"SupervisionAlert">;
export type SupervisionScanResult = ControlPlaneSchema<"SupervisionScanResult">;
export type AutopilotController = ControlPlaneSchema<"AutopilotController">;
export type UpdateAutopilotRequest = ControlPlaneSchema<"UpdateAutopilotRequest">;
export type PublicWorkspaceBinding = ControlPlaneSchema<"PublicWorkspaceBinding">;
export type WorkspaceBindingResponse = ControlPlaneSchema<"WorkspaceBindingResponse">;
export type LocalProject = ControlPlaneSchema<"LocalProject">;
export type LocalProjectListResponse = ControlPlaneSchema<"LocalProjectListResponse">;
export type TaskWorkspace = ControlPlaneSchema<"TaskWorkspace">;
export type TaskWorkspaceResponse = ControlPlaneSchema<"TaskWorkspaceResponse">;
export type MissionUiBlock = ControlPlaneSchema<"MissionUiBlock">;
export type MissionUiPlan = ControlPlaneSchema<"MissionUiPlan">;
export type McpServer = ControlPlaneSchema<"McpServer">;
export type McpDiscoveredTool = ControlPlaneSchema<"McpDiscoveredTool">;
export type UpsertMcpServerRequest = ControlPlaneSchema<"UpsertMcpServerRequest">;
export type MemoryRecord = ControlPlaneSchema<"MemoryRecord">;
export type MemoryCandidateRecord = ControlPlaneSchema<"MemoryCandidateRecord">;
export type CreateMemoryRequest = ControlPlaneSchema<"CreateMemoryRequest">;
export type UpdateMemoryRequest = ControlPlaneSchema<"UpdateMemoryRequest">;
export type CreateMemoryCandidateRequest = ControlPlaneSchema<"CreateMemoryCandidateRequest">;
export type ResolveMemoryCandidateRequest = ControlPlaneSchema<"ResolveMemoryCandidateRequest">;
export type CoreMemorySnapshot = ControlPlaneSchema<"CoreMemorySnapshot">;
export type MemorySettings = ControlPlaneSchema<"MemorySettings">;
export type MemoryObservability = ControlPlaneSchema<"MemoryObservability">;
export type MemoryReviewRecord = ControlPlaneSchema<"MemoryReviewRecord">;
export type ConversationIntentEvaluationResult = ControlPlaneSchema<"ConversationIntentEvaluationResult">;
export type MemoryMaintenanceResult = ControlPlaneSchema<"MemoryMaintenanceResult">;
export type MemoryImportRequest = ControlPlaneSchema<"MemoryImportRequest">;
export type MemoryImportResult = ControlPlaneSchema<"MemoryImportResult">;
export type SessionRecallResult = ControlPlaneSchema<"SessionRecallResult">;
export type SessionRecallRequest = ControlPlaneSchema<"SessionRecallRequest">;
export type TaskCheckpoint = ControlPlaneSchema<"TaskCheckpoint">;
export type TaskCheckpointListResponse = ControlPlaneSchema<"TaskCheckpointListResponse">;
export type ResumeTaskCheckpointRequest = ControlPlaneSchema<"ResumeTaskCheckpointRequest">;
export type ResumeTaskCheckpointResponse = ControlPlaneSchema<"ResumeTaskCheckpointResponse">;

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
