import type {
  CreateRunResponse,
  CreateSessionInterventionResponse,
  CreateSessionMessageResponse,
  ConfirmSessionPlanResponse,
  MobileHomeResponse,
  MobileInboxItem,
  MissionDetailResponse,
  MissionListItem,
  MobileRunFollowUp,
  MobileRunSummary,
  PlannerCandidatePlanResponse,
  PlannerValidationResult,
  PlannerTemplateSelectionResponse,
  RouteCompareSummary,
  RuntimeGraphSummary,
  RunValidationMode,
  RunSummary,
  SessionDetailResponse,
  SessionDagDraftResponse,
  SessionMessageRecord,
  SessionPlanResponse,
  SessionRunResponse,
  SessionSummary,
  TemplateSummary,
} from "./types";

const DEFAULT_BASE_URL = "http://127.0.0.1:4030";

export class ApiError extends Error {
  status: number;
  code: string | null;
  validation: PlannerValidationResult | null;

  constructor(
    message: string,
    input: {
      status: number;
      code: string | null;
      validation: PlannerValidationResult | null;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
    this.validation = input.validation;
  }
}

function isPlannerValidationResult(value: unknown): value is PlannerValidationResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { passed?: unknown }).passed === "boolean" &&
    Array.isArray((value as { warnings?: unknown }).warnings) &&
    Array.isArray((value as { details?: unknown }).details)
  );
}

function getBaseUrl(): string {
  return (
    process.env.EXPO_PUBLIC_MY_MATE_API_BASE_URL ||
    process.env.EXPO_PUBLIC_CONTROL_PLANE_BASE_URL ||
    DEFAULT_BASE_URL
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      body && typeof body.message === "string"
        ? body.message
        : `Request failed: ${response.status}`;
    throw new ApiError(message, {
      status: response.status,
      code: body && typeof body.code === "string" ? body.code : null,
      validation:
        body && isPlannerValidationResult(body.validation) ? body.validation : null,
    });
  }

  return body as T;
}

export async function getMobileHome(): Promise<MobileHomeResponse> {
  return await request<MobileHomeResponse>("/api/mobile/home");
}

export async function getMobileInbox(): Promise<{ items: MobileInboxItem[] }> {
  return await request<{ items: MobileInboxItem[] }>("/api/mobile/inbox");
}

export async function getMobileRuns(): Promise<{ items: MobileRunSummary[] }> {
  return await request<{ items: MobileRunSummary[] }>("/api/mobile/runs");
}

export async function getRuns(): Promise<{ items: RunSummary[] }> {
  return await request<{ items: RunSummary[] }>("/api/runs");
}

export type SessionListVisibility = "active" | "archived" | "hidden" | "all";

function buildSessionListQuery(input?: {
  q?: string;
  visibility?: SessionListVisibility;
  include_archived?: boolean;
  include_hidden?: boolean;
}): string {
  const params = new URLSearchParams();
  if (input?.q?.trim()) {
    params.set("q", input.q.trim());
  }
  if (input?.visibility && input.visibility !== "active") {
    params.set("visibility", input.visibility);
  }
  if (input?.include_archived) {
    params.set("include_archived", "true");
  }
  if (input?.include_hidden) {
    params.set("include_hidden", "true");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getSessions(input?: {
  q?: string;
  visibility?: SessionListVisibility;
}): Promise<{ items: SessionSummary[] }> {
  return await request<{ items: SessionSummary[] }>(`/api/sessions${buildSessionListQuery(input)}`);
}

export async function getMissions(input?: {
  q?: string;
  visibility?: SessionListVisibility;
}): Promise<{ items: MissionListItem[] }> {
  return await request<{ items: MissionListItem[] }>(`/api/missions${buildSessionListQuery(input)}`);
}

export async function getMission(sessionId: string): Promise<MissionDetailResponse> {
  return await request<MissionDetailResponse>(`/api/missions/${sessionId}`);
}

export async function createSession(input: {
  title?: string;
  initial_message?: string;
  created_by?: string;
}): Promise<SessionDetailResponse> {
  return await request<SessionDetailResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getSession(sessionId: string): Promise<SessionDetailResponse> {
  return await request<SessionDetailResponse>(`/api/sessions/${sessionId}`);
}

export async function archiveSession(input: {
  sessionId: string;
  reason?: string;
  requestedBy?: string;
}): Promise<{ session: SessionSummary }> {
  return await request<{ session: SessionSummary }>(
    `/api/sessions/${input.sessionId}/archive`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: input.reason,
        requested_by: input.requestedBy,
      }),
    },
  );
}

export async function unarchiveSession(input: {
  sessionId: string;
  requestedBy?: string;
}): Promise<{ session: SessionSummary }> {
  return await request<{ session: SessionSummary }>(
    `/api/sessions/${input.sessionId}/unarchive`,
    {
      method: "POST",
      body: JSON.stringify({
        requested_by: input.requestedBy,
      }),
    },
  );
}

export async function getSessionRouteCompare(input: {
  sessionId: string;
  left_revision?: number;
  left_option?: "primary" | "alternative";
  right_revision?: number;
  right_option?: "primary" | "alternative";
}): Promise<RouteCompareSummary> {
  const params = new URLSearchParams();
  if (typeof input.left_revision === "number") {
    params.set("left_revision", String(input.left_revision));
  }
  if (input.left_option) {
    params.set("left_option", input.left_option);
  }
  if (typeof input.right_revision === "number") {
    params.set("right_revision", String(input.right_revision));
  }
  if (input.right_option) {
    params.set("right_option", input.right_option);
  }
  const query = params.toString();
  return await request<RouteCompareSummary>(
    `/api/sessions/${input.sessionId}/compare${query ? `?${query}` : ""}`,
  );
}

export async function getSessionMessages(
  sessionId: string,
): Promise<{ items: SessionMessageRecord[] }> {
  return await request<{ items: SessionMessageRecord[] }>(`/api/sessions/${sessionId}/messages`);
}

export async function sendSessionMessage(
  sessionId: string,
  content: string,
): Promise<CreateSessionMessageResponse> {
  return await request<CreateSessionMessageResponse>(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function createSessionIntervention(input: {
  sessionId: string;
  content: string;
  kind?: "guidance" | "change_request" | "pause_request" | "resume_request" | "skip_request" | "add_node_request" | "parallelism_request";
  target_run_id?: string;
  target_node_run_id?: string;
  metadata?: Record<string, unknown>;
}): Promise<CreateSessionInterventionResponse> {
  return await request<CreateSessionInterventionResponse>(
    `/api/sessions/${input.sessionId}/interventions`,
    {
      method: "POST",
      body: JSON.stringify({
        content: input.content,
        kind: input.kind,
        target_run_id: input.target_run_id,
        target_node_run_id: input.target_node_run_id,
        metadata: input.metadata,
      }),
    },
  );
}

export async function confirmDagPatch(input: {
  sessionId: string;
  patchId: string;
  requestedBy?: string;
}): Promise<{
  session: { session_id: string };
  patch: {
    patch_id: string;
    status: string;
    operation_outcomes?: Array<{
      op: string;
      node_run_id: string | null;
      node_id: string | null;
      node_name: string | null;
      applied: boolean;
      error: string | null;
      details?: Record<string, unknown>;
    }>;
    application_errors?: string[];
    resumed_topology?: Record<string, unknown> | null;
  };
  operation_outcomes: Array<{
    op: string;
    node_run_id?: string | null;
    node_id?: string | null;
    node_name?: string | null;
    applied: boolean;
    error: string | null;
    details?: Record<string, unknown>;
  }>;
}> {
  return await request(
    `/api/sessions/${input.sessionId}/patches/${input.patchId}/confirm`,
    {
      method: "POST",
      body: JSON.stringify({
        requested_by: input.requestedBy,
      }),
    },
  );
}

export async function rejectDagPatch(input: {
  sessionId: string;
  patchId: string;
  reason?: string;
  requestedBy?: string;
}): Promise<{
  session: { session_id: string };
  patch: { patch_id: string; status: string; reason: string };
}> {
  return await request(
    `/api/sessions/${input.sessionId}/patches/${input.patchId}/reject`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: input.reason,
        requested_by: input.requestedBy,
      }),
    },
  );
}

export async function planSession(input: {
  sessionId: string;
  template_id?: string;
  draft_message_id?: string;
  inputs?: Record<string, unknown>;
}): Promise<SessionPlanResponse> {
  return await request<SessionPlanResponse>(`/api/sessions/${input.sessionId}/plan`, {
    method: "POST",
    body: JSON.stringify({
      template_id: input.template_id,
      draft_message_id: input.draft_message_id,
      inputs: input.inputs || {},
    }),
  });
}

export async function confirmSessionPlan(input: {
  sessionId: string;
  revision: number;
  option?: "primary" | "alternative";
}): Promise<ConfirmSessionPlanResponse> {
  return await request<ConfirmSessionPlanResponse>(`/api/sessions/${input.sessionId}/plan/confirm`, {
    method: "POST",
    body: JSON.stringify({
      revision: input.revision,
      option: input.option,
    }),
  });
}

export async function reviseSessionPlan(input: {
  sessionId: string;
  instructions: string;
  revision?: number;
  option?: "primary" | "alternative";
}): Promise<SessionPlanResponse> {
  return await request<SessionPlanResponse>(`/api/sessions/${input.sessionId}/plan/revise`, {
    method: "POST",
    body: JSON.stringify({
      instructions: input.instructions,
      revision: input.revision,
      option: input.option,
    }),
  });
}

export async function createRunFromSession(input: {
  sessionId: string;
  template_id?: string;
  inputs?: Record<string, unknown>;
  validation_mode?: RunValidationMode;
  plan_revision?: number;
  plan_option?: "primary" | "alternative";
}): Promise<SessionRunResponse> {
  return await request<SessionRunResponse>(`/api/sessions/${input.sessionId}/runs`, {
    method: "POST",
    body: JSON.stringify({
      template_id: input.template_id,
      inputs: input.inputs || {},
      validation_mode: input.validation_mode,
      plan_revision: input.plan_revision,
      plan_option: input.plan_option,
    }),
  });
}

export async function createSessionDraft(input: {
  sessionId: string;
  template_id?: string;
  inputs?: Record<string, unknown>;
  max_agent_nodes?: number;
}): Promise<SessionDagDraftResponse> {
  return await request<SessionDagDraftResponse>(`/api/sessions/${input.sessionId}/dag-draft`, {
    method: "POST",
    body: JSON.stringify({
      template_id: input.template_id,
      inputs: input.inputs || {},
      max_agent_nodes: input.max_agent_nodes,
    }),
  });
}

export async function getTemplates(): Promise<{ items: TemplateSummary[] }> {
  return await request<{ items: TemplateSummary[] }>("/api/templates");
}

export async function createRun(input: {
  intent: string;
  template_id: string;
  inputs: Record<string, unknown>;
  validation_mode?: RunValidationMode;
}) {
  return await request<CreateRunResponse>("/api/runs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function selectTemplateForIntent(input: {
  intent: string;
}): Promise<PlannerTemplateSelectionResponse> {
  return await request<PlannerTemplateSelectionResponse>("/api/planner/template-selection", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function generateCandidatePlan(input: {
  intent: string;
  template_id: string;
  inputs: Record<string, unknown>;
}): Promise<PlannerCandidatePlanResponse> {
  return await request<PlannerCandidatePlanResponse>("/api/planner/candidate-plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getRunFollowUp(runId: string): Promise<MobileRunFollowUp> {
  return await request<MobileRunFollowUp>(`/api/mobile/runs/${runId}/follow-up`);
}

export async function getRunGraph(runId: string): Promise<RuntimeGraphSummary> {
  return await request<RuntimeGraphSummary>(`/api/runs/${runId}/graph`);
}

export async function approve(approvalId: string, comment = "Approved from mobile") {
  return await request<{ approval_id: string; status: string }>(
    `/api/approvals/${approvalId}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ comment }),
    },
  );
}

export async function reject(approvalId: string, comment = "Rejected from mobile") {
  return await request<{ approval_id: string; status: string }>(
    `/api/approvals/${approvalId}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ comment }),
    },
  );
}

export async function submitHumanInput(
  inputRequestId: string,
  payload: Record<string, unknown>,
) {
  return await request<{ input_request_id: string; status: string }>(
    `/api/human-inputs/${inputRequestId}/submit`,
    {
      method: "POST",
      body: JSON.stringify({ payload }),
    },
  );
}

export async function pauseRun(runId: string) {
  return await request<{ run_id: string; status: string }>(
    `/api/runs/${runId}/actions/pause`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function resumeRun(runId: string) {
  return await request<{ run_id: string; status: string }>(
    `/api/runs/${runId}/actions/resume`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function cancelRun(runId: string) {
  return await request<{ run_id: string; status: string }>(
    `/api/runs/${runId}/actions/cancel`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}
